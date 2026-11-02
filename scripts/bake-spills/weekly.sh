#!/bin/zsh
# Weekly /spills refresh (Josh 2026-11-01). launchd starts this every hour and at login
# (~/Library/LaunchAgents/org.earthatlas.spills-weekly.plist); it only does work when the last successful run is 7+ days
# old, so a week missed while the Mac was off or asleep runs as soon as it is back. Steps:
#   1. a clean checkout of origin/main (~/Projects/earthatlas-spills-weekly; never the shared working tree, whose
#      uncommitted edits from other sessions must not reach production), sharing the main repo's data/spills (raw inputs,
#      caches, python venv), node_modules and .env.local;
#   2. NRC: re-download this year's FOIA file (and last year's, January–March, while it is being finished) only when
#      nrc.uscg.mil has a newer one (If-Modified-Since);
#   3. PHMSA: phmsa.dot.gov refuses scripted downloads, so its zips are fetched by a person. A newer copy of any
#      PHMSA_ZIPS file in ~/Downloads (or data/spills/phmsa/inbox/) is moved in and unzipped into phmsa/raw/<name>/.
#      When ours is 30+ days old, a dialog (at most weekly) offers to open the PHMSA page;
#   4. if anything is new: national NRC extract → geocode (→ PHMSA build + national publish when new zips came in) →
#      /spills inat → analyze → states, with a date stamp, then upload.mjs publishes it to
#      Vercel Blob and repoints spills/manifest.json (production reads it; no deploy). upload.mjs refuses a bake that lost
#      data;
#   5. a macOS notification and data/spills/weekly/run.log.
# Run by hand:  zsh scripts/bake-spills/weekly.sh --force     (SPILLS_WEEKLY_TREE=<dir> runs from another checkout;
#               SPILLS_FORCE_BAKE=1 bakes and publishes even when nothing is new)
set -uo pipefail
MAIN=${0:A:h:h:h}
DATA=$MAIN/data/spills
NAT=$MAIN/data/national          # national datasets (docs/NATIONAL_DATA.md)
DIR=$DATA/weekly
STAMP_FILE=$DIR/last-success
LOCK=$DIR/lock
WT=${SPILLS_WEEKLY_TREE:-~/Projects/earthatlas-spills-weekly}
REF=${SPILLS_WEEKLY_REF:-origin/main}
PHMSA_PAGE='https://www.phmsa.dot.gov/data-and-statistics/pipeline/distribution-transmission-gathering-lng-and-liquid-accident-and-incident-data'
PHMSA_ZIP=accident_hazardous_liquid_jan2010_present.zip
PHMSA_ZIPS=(accident_hazardous_liquid_jan2010_present accident_gravity_reporting_regulated_jul2020_present
  incident_gas_transmission_gathering_jan2010_present incident_gas_distribution_jan2010_present incident_liquefied_natural_gas_jan2011_present)
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
mkdir -p $DIR $NAT/phmsa/raw/inbox
log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >> $DIR/run.log }
notify() { osascript -e "display notification \"$2\" with title \"EarthAtlas\" subtitle \"$1\"" >/dev/null 2>&1 || true }
age_days() { print $(( ($(date +%s) - $(stat -f %m $1)) / 86400 )) }

# Due? (7 days since the last successful run)
if [[ "${1:-}" != "--force" && -f $STAMP_FILE ]]; then
  (( $(date +%s) - $(cat $STAMP_FILE) < 604800 )) && exit 0
fi
# One run at a time (a stale lock older than 3 h is ignored).
if [[ -f $LOCK ]] && (( $(date +%s) - $(stat -f %m $LOCK) < 10800 )); then exit 0; fi
date +%s > $LOCK
trap 'rm -f $LOCK' EXIT

# Network? (quietly retry next hour when offline)
curl -s -o /dev/null -m 20 https://nrc.uscg.mil/ || { log "offline; will retry"; exit 0 }
log "start"

# 1. Checkout (skipped when SPILLS_WEEKLY_TREE points at an existing tree, e.g. to test before a push)
if [[ -z "${SPILLS_WEEKLY_TREE:-}" ]]; then
  if [[ ! -d $WT ]]; then git -C $MAIN worktree add -q --detach $WT $REF || { log "worktree add failed"; exit 1 }; fi
  git -C $WT fetch -q origin && git -C $WT checkout -q --detach $REF && git -C $WT reset -q --hard $REF || { log "git update failed"; exit 1 }
  for l in node_modules .env.local; do [[ -e $WT/$l ]] || ln -s $MAIN/$l $WT/$l; done
  [[ -L $WT/data/spills ]] || { mkdir -p $WT/data; rm -rf $WT/data/spills; ln -s $DATA $WT/data/spills }
  [[ -L $WT/data/national ]] || ln -s $NAT $WT/data/national
fi
cd $WT
[[ -f scripts/bake-spills/upload.mjs ]] || { log "bake-spills/upload.mjs not on $REF yet; nothing to do"; exit 0 }
PY=$DATA/venv/bin/python
new=()

# 2. NRC
yy=$(date +%y); mm=$(date +%m)
years=($yy); (( 10#$mm <= 3 )) && years+=($(printf %02d $(( 10#$yy - 1 ))))
for y in $years; do
  f=$NAT/nrc/raw/CY$y.xlsx
  since=(); [[ -f $f ]] && since=(-z $f)
  code=$(curl -s -m 600 -o $f.part -w '%{http_code}' $since "https://nrc.uscg.mil/FOIAFiles/CY$y.xlsx")
  if [[ $code == 200 && -s $f.part ]]; then mv $f.part $f; new+=(nrc$y); log "NRC CY$y updated"
  else rm -f $f.part; [[ $code == 304 ]] || log "NRC CY$y: HTTP $code"; fi
done

# 3. PHMSA (a person downloads the zips; see the header). Every known zip is picked up; the liquid ones feed the map.
P=$NAT/phmsa/raw
ours=$P/$PHMSA_ZIP
for z in $PHMSA_ZIPS; do
  for cand in ~/Downloads/$z.zip $P/inbox/$z.zip; do
    if [[ -f $cand && ( ! -f $P/$z.zip || $cand -nt $P/$z.zip ) ]] && unzip -tq $cand >/dev/null 2>&1; then
      mv $cand $P/$z.zip && rm -rf $P/$z && unzip -o -q $P/$z.zip -d $P/$z &&
        new+=(phmsa) && log "PHMSA $z picked up from $cand"
    fi
  done
done
if [[ -f $ours ]] && (( $(age_days $ours) >= 30 )) && { [[ ! -f $DIR/phmsa-asked ]] || (( $(age_days $DIR/phmsa-asked) >= 7 )) }; then
  touch $DIR/phmsa-asked
  ( r=$(osascript -e "button returned of (display dialog \"PHMSA pipeline accident data on /spills is $(age_days $ours) days old. On the PHMSA page, download the “January 2010 to present” and “January 2021 to present” ZIPs; the weekly job picks them up from Downloads.\" buttons {\"Later\", \"Open PHMSA page\"} default button 2 with title \"EarthAtlas /spills\" giving up after 86400)" 2>/dev/null)
    [[ $r == "Open PHMSA page" ]] && open $PHMSA_PAGE ) &!
fi

[[ -n "${SPILLS_FORCE_BAKE:-}" ]] && new+=(forced)
if (( ${#new} == 0 )); then log "nothing new"; date +%s > $STAMP_FILE; exit 0; fi

# 4. Bake and publish
stamp=$(date +%Y%m%d-%H%M)
export SPILLS_VERSION=$stamp
# national datasets first (NRC; PHMSA when new zips came in, published to the national catalog), then /spills' own bakes
{
  for y in $years; do $PY scripts/national/nrc/extract.py $y; done &&
  $PY scripts/national/nrc/geocode.py &&
  { [[ ${new[(Ie)phmsa]} -eq 0 ]] || { $PY scripts/national/phmsa/build.py $stamp && node --env-file=.env.local scripts/national/publish.mjs phmsa $stamp; } } &&
  $PY scripts/bake-spills/inat.py &&
  $PY scripts/bake-spills/analyze.py &&
  $PY scripts/bake-spills/states.py
} >> $DIR/bake.log 2>&1 || { log "bake failed (see bake.log)"; notify "/spills weekly bake failed" "See data/spills/weekly/bake.log"; exit 1 }
out=$(node --env-file=.env.local scripts/bake-spills/upload.mjs $stamp 2>&1); rc=$?
print -r -- "$out" >> $DIR/run.log
if (( rc != 0 )); then notify "/spills publish refused" "${out[(f)-1]}"; exit 1; fi
rm -rf public/spills-data/*-$stamp.* public/spills-data/state-$stamp public/spills-data/state-pa-$stamp   # published; the checkout keeps only its own files
log "published $stamp (${new[*]})"
notify "/spills updated" "New ${new[*]} data is live"
date +%s > $STAMP_FILE
