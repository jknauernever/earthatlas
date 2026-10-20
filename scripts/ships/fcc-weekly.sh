#!/bin/zsh
# Weekly refresh of ships.fcc_ship_lookup, the FCC ship-licence name lookup the web intake page (earthatlas.org/ships/intake) uses
# (Josh 2026-10-20; same pattern as scripts/ships/mv-weekly.sh). launchd starts this every hour and at login
# (~/Library/LaunchAgents/org.earthatlas.fcc-weekly.plist); it only does work when the last successful run is 7+ days old, so a week
# missed while the Mac was off or asleep runs as soon as it is back. Steps:
#   1. HEAD the FCC file: Last-Modified the same as the last load → nothing to do (no 44 MB download);
#   2. a clean checkout of origin/main (~/Projects/earthatlas-fcc-weekly; never the shared working tree, whose uncommitted edits
#      from other sessions must not reach production), sharing the main repo's node_modules and .env.local;
#   3. `prod.sh fcc-weekly --fetch`: backs up only that table, downloads, and changes only rows that differ (scripts/ships/import-fcc-lookup.mjs:
#      never an empty table; refuses a file under 90% of the table, exit 3);
#   4. a macOS notification on failure or refusal, the log in scripts/ships/facilities/cache/fcc-weekly/run.log, and a GitHub issue
#      (label data-alert, emails Josh) once the table is 14+ days past its last successful refresh; closed by the next success.
# Run by hand:  zsh scripts/ships/fcc-weekly.sh --force
# Prove it on DEV (this working tree, dev database, just these names, nothing stamped):  zsh scripts/ships/fcc-weekly.sh --dev "ISLAND EXPRESS,LEEWAY"
set -uo pipefail
MAIN=${0:A:h:h:h}
DIR=$MAIN/scripts/ships/facilities/cache/fcc-weekly
STAMP=$DIR/last-success
SEEN=$DIR/last-modified      # FCC Last-Modified of the file last loaded
REFUSED=$DIR/refused-modified # FCC Last-Modified of a file the gate refused (not retried until FCC posts another)
LOCK=$DIR/lock
WT=~/Projects/earthatlas-fcc-weekly
REF=${FCC_WEEKLY_REF:-origin/main}   # a commit to test with before it is on main
URL=https://data.fcc.gov/download/pub/uls/complete/l_ship.zip
ALERT="FCC licence lookup (fcc_ship_lookup) not refreshed for 14+ days"
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
mkdir -p $DIR
log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >> $DIR/run.log }
notify() { osascript -e "display notification \"$2\" with title \"EarthAtlas\" subtitle \"$1\"" >/dev/null 2>&1 || true }
# 14+ days without a successful refresh → one open data-alert issue (gh must be signed in; skipped quietly if not).
stale_alert() {
  [[ -n $dev ]] && return
  local since=$(cat $STAMP 2>/dev/null || cat $DIR/installed 2>/dev/null || echo 0)
  (( $(date +%s) - since < 1209600 )) && return
  command -v gh >/dev/null || return
  [[ -n "$(gh issue list -R jknauernever/earthatlas --label data-alert --state open --search "\"$ALERT\" in:title" --json number -q '.[].number' 2>/dev/null)" ]] && return
  gh issue create -R jknauernever/earthatlas --label data-alert --assignee jknauernever --title "$ALERT" \
    --body "scripts/ships/fcc-weekly.sh (launchd org.earthatlas.fcc-weekly) has not refreshed ships.fcc_ship_lookup for 14+ days. Last lines of scripts/ships/facilities/cache/fcc-weekly/run.log:
\`\`\`
$(tail -15 $DIR/run.log)
\`\`\`" >/dev/null 2>&1 && log "opened data-alert issue"
}
fail() { log "$1"; notify "FCC licence refresh failed" "$2"; stale_alert; exit 1 }

dev=""
if [[ "${1:-}" == "--dev" ]]; then dev=${2:?--dev needs a comma-separated list of names}
else [[ -f $STAMP || -f $DIR/installed ]] || date +%s > $DIR/installed; fi   # the 14-day alert counts from the first run
if [[ -z $dev && "${1:-}" != "--force" && -f $STAMP ]]; then
  (( $(date +%s) - $(cat $STAMP) < 604800 )) && exit 0   # due? (7 days since the last successful run)
fi
# One run at a time (a stale lock older than 3 h is ignored).
if [[ -f $LOCK ]] && (( $(date +%s) - $(stat -f %m $LOCK) < 10800 )); then exit 0; fi
date +%s > $LOCK
trap 'rm -f $LOCK' EXIT

# Has FCC posted a new file? (offline → quietly retry next hour)
mod=$(curl -sSfI -m 30 $URL | tr -d '\r' | sed -n 's/^[Ll]ast-[Mm]odified: //p') || mod=""
[[ -z $mod ]] && { log "FCC not reachable; will retry"; [[ -z $dev ]] && stale_alert; exit 0 }
if [[ -z $dev && "$mod" == "$(cat $SEEN 2>/dev/null)" ]]; then
  log "unchanged since the last load ($mod)"; date +%s > $STAMP; exit 0
fi
if [[ -z $dev && "$mod" == "$(cat $REFUSED 2>/dev/null)" ]]; then stale_alert; exit 0; fi

log "start${dev:+ (dev: $dev)}: FCC file $mod"
if [[ -n $dev ]]; then
  cd $MAIN
  node --env-file=.env.local scripts/ships/import-fcc-lookup.mjs --fetch --dir $DIR/fcc --names "$dev" >> $DIR/run.log 2>&1
  rc=$?
else
  if [[ ! -d $WT ]]; then git -C $MAIN worktree add -q --detach $WT $REF || fail "worktree add failed" "git worktree add failed; see run.log"; fi
  git -C $WT fetch -q origin && git -C $WT checkout -q --detach $REF && git -C $WT reset -q --hard $REF || fail "git update failed" "git update failed; see run.log"
  for l in node_modules .env.local; do [[ -e $WT/$l ]] || ln -s $MAIN/$l $WT/$l; done
  cd $WT
  [[ -f scripts/ships/import-fcc-lookup.mjs ]] || { log "import-fcc-lookup.mjs not on $REF yet; nothing to do"; exit 0 }
  zsh scripts/ships/prod.sh fcc-weekly --fetch --dir $DIR/fcc >> $DIR/run.log 2>&1
  rc=$?
fi
rm -rf $DIR/fcc   # ~400 MB unzipped; fetched fresh each week
if (( rc == 3 )); then
  [[ -z $dev ]] && print -r -- "$mod" > $REFUSED
  log "gate refused the FCC file ($mod); table unchanged"
  notify "FCC licence refresh refused" "The new FCC file is much smaller than the table; nothing changed. See run.log"
  [[ -z $dev ]] && stale_alert
  exit 1
fi
(( rc != 0 )) && fail "import failed (exit $rc)" "Production not changed if the load did not finish. See scripts/ships/facilities/cache/fcc-weekly/run.log"
[[ -n $dev ]] && { log "dev run done"; exit 0 }

print -r -- "$mod" > $SEEN
date +%s > $STAMP
log "done"
# A refresh closes the stale alert, if one is open.
if command -v gh >/dev/null; then
  for n in $(gh issue list -R jknauernever/earthatlas --label data-alert --state open --search "\"$ALERT\" in:title" --json number -q '.[].number' 2>/dev/null); do
    gh issue close $n -R jknauernever/earthatlas -c "Refreshed $(date '+%Y-%m-%d %H:%M') from the FCC file of $mod." >/dev/null 2>&1
  done
fi
# Table-only backups from this job: keep 8 weeks.
find ~/Projects/earthatlas-backups -name 'ships-prod-*-before-fcc-weekly.dump' -mtime +56 -delete 2>/dev/null
exit 0
