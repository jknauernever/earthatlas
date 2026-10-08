#!/bin/zsh
# Weekly Metro Vancouver air-permit refresh (Josh 2026-10-08). launchd starts this every hour and at login
# (~/Library/LaunchAgents/org.earthatlas.mv-weekly.plist); it only does work when the last successful run is 7+ days old, so a week
# missed while the Mac was off or asleep runs as soon as it is back. Steps:
#   1. a clean checkout of origin/main (~/Projects/earthatlas-mv-weekly; never the shared working tree, whose uncommitted edits
#      from other sessions must not reach production), sharing the main repo's gitignored cache, node_modules and .env.local;
#   2. node scripts/ships/mv-weekly.mjs: re-read Metro Vancouver's files, list and search; report changed / gone / new;
#   3. only if a file changed in place: import-bc-permits on dev, then `prod.sh import-bc-permits` (backs up first), both from cache;
#   4. a macOS notification + the report in scripts/ships/facilities/cache/mv-weekly/<date>.md; gone/new files wait for a person.
# Run by hand:  zsh scripts/ships/mv-weekly.sh --force
set -uo pipefail
MAIN=${0:A:h:h:h}
CACHE=$MAIN/scripts/ships/facilities/cache
DIR=$CACHE/mv-weekly
STAMP=$DIR/last-success
LOCK=$DIR/lock
WT=~/Projects/earthatlas-mv-weekly
REF=${MV_WEEKLY_REF:-origin/main}   # a commit to test with before it is on main
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
mkdir -p $DIR
log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >> $DIR/run.log }
notify() { osascript -e "display notification \"$2\" with title \"EarthAtlas\" subtitle \"$1\"" >/dev/null 2>&1 || true }

# Due? (7 days = 604800 s since the last successful run)
if [[ "${1:-}" != "--force" && -f $STAMP ]]; then
  (( $(date +%s) - $(cat $STAMP) < 604800 )) && exit 0
fi
# One run at a time (a stale lock older than 3 h is ignored).
if [[ -f $LOCK ]] && (( $(date +%s) - $(stat -f %m $LOCK) < 10800 )); then exit 0; fi
date +%s > $LOCK
trap 'rm -f $LOCK' EXIT

# Network? (quietly retry next hour when offline)
curl -s -o /dev/null -m 20 https://metrovancouver.org/ || { log "offline; will retry"; exit 0 }

log "start"
if [[ ! -d $WT ]]; then git -C $MAIN worktree add -q --detach $WT $REF || { log "worktree add failed"; exit 1 }; fi
git -C $WT fetch -q origin && git -C $WT checkout -q --detach $REF && git -C $WT reset -q --hard $REF || { log "git update failed"; exit 1 }
for l in node_modules .env.local; do [[ -e $WT/$l ]] || ln -s $MAIN/$l $WT/$l; done
[[ -L $WT/scripts/ships/facilities/cache ]] || { rm -rf $WT/scripts/ships/facilities/cache; ln -s $CACHE $WT/scripts/ships/facilities/cache }
cd $WT
[[ -f scripts/ships/mv-weekly.mjs ]] || { log "mv-weekly.mjs not on $REF yet; nothing to do"; exit 0 }

PUPPETEER_DIR=$MAIN/data/sanjuan-docks/tools node scripts/ships/mv-weekly.mjs >> $DIR/run.log 2>&1
rc=$?
if (( rc == 2 )); then log "check could not run; will retry next hour"; exit 0; fi
(( rc != 0 )) && { log "check failed (exit $rc)"; notify "Metro Vancouver check failed" "See scripts/ships/facilities/cache/mv-weekly/run.log"; exit 1 }

changed=$(node -e 'const r=require(process.argv[1]);console.log(r.changed.length)' $DIR/last.json)
flagged=$(node -e 'const r=require(process.argv[1]);console.log(r.flagged)' $DIR/last.json)
if (( changed > 0 )); then
  log "$changed changed in place: importing to dev, then production"
  node --env-file=.env.local scripts/ships/import-bc-permits.mjs >> $DIR/run.log 2>&1 || { log "dev import failed"; notify "Metro Vancouver refresh: dev import failed" "Production not touched. See run.log"; exit 1 }
  zsh scripts/ships/prod.sh import-bc-permits >> $DIR/run.log 2>&1 || { log "production import failed"; notify "Metro Vancouver refresh: production import failed" "See run.log"; exit 1 }
fi
date +%s > $STAMP
log "done: $changed changed, $flagged to check"
if (( flagged > 0 )); then notify "Metro Vancouver permits: $flagged to check" "Report: scripts/ships/facilities/cache/mv-weekly/$(date +%F).md"
elif (( changed > 0 )); then notify "Metro Vancouver permits refreshed" "$changed file(s) updated on the live site"
fi
exit 0
