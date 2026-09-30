#!/bin/zsh
# Imports a freshly downloaded IMO GISIS Reg 4.2 file (IMO-*.csv dragged into ~/EarthAtlas-inbox) into PRODUCTION, then notifies.
# Run by launchd (org.earthatlas.gisis-watch, WatchPaths ~/EarthAtlas-inbox; ~/Downloads is privacy-protected from launchd) — Josh 2026-09-30, option A: a person downloads
# (GISIS login has a Cloudflare Turnstile CAPTCHA, so the download stays manual); everything after the download is automatic.
# Safe to run any time: it does nothing unless there is a complete, genuine, NEW file.
set -u
REPO=/Users/jknauer/Projects/earthatlas
RAW=$REPO/scripts/ships/gisis/raw
LOG=$REPO/scripts/ships/.logs/gisis-monthly.log
LOCK=/tmp/earthatlas-gisis-import.lock
HEADER='"Notifying Party","Type of equivalent compliance method","IMO Number, if applicable","Manufacturer","Type or model number","Submitted","Has Certificate","Has Additional Info"'
export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin

notify() { osascript -e "display notification \"$1\" with title \"EarthAtlas: IMO scrubber update\"" >/dev/null 2>&1 }
log() { print -r -- "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG" }

mkdir "$LOCK" 2>/dev/null || exit 0            # another run is importing
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

files=(${INBOX:-$HOME/Downloads}/IMO-*.csv(N.om))    # newest first; (N) = empty array when none (never list another folder)
(( ${#files} )) || exit 0
new=$files[1]
name=${new:t}
[ -e "$RAW/$name" ] && cmp -s "$new" "$RAW/$name" && exit 0                 # already imported this exact file

# Wait until the download has finished (size stable for 5 s).
s1=$(stat -f %z "$new"); sleep 5; s2=$(stat -f %z "$new")
[ "$s1" = "$s2" ] || exit 0

# Genuine GISIS Reg 4.2 export? (exact header; a UTF-8 BOM is allowed)
first=$(head -1 "$new" | sed $'s/^\xEF\xBB\xBF//' | tr -d '\r')
if [ "$first" != "$HEADER" ]; then log "skip $name: not a GISIS Reg 4.2 export (header differs)"; exit 0; fi

# Newer than what we hold? GISIS names files IMO-YYYYMMDD-HHMMSSxx.csv, so the name sorts by time.
latest=$(ls "$RAW"/IMO-*.csv(N) 2>/dev/null | sort | tail -1)
if [ -n "$latest" ] && [[ ! "$name" > "${latest:t}" ]]; then log "skip $name: not newer than ${latest:t}"; exit 0; fi
if [ -n "$latest" ] && cmp -s "$new" "$latest"; then log "skip $name: identical to ${latest:t}"; exit 0; fi

rows_new=$(( $(wc -l < "$new") - 1 )); rows_old=0; [ -n "$latest" ] && rows_old=$(( $(wc -l < "$latest") - 1 ))
cp "$new" "$RAW/$name"
log "import $name ($rows_new rows; previous ${latest:t} had $rows_old) → production"
notify "New GISIS file found ($rows_new rows). Importing to production (backed up first)…"

cd "$REPO" || exit 1
if zsh scripts/ships/prod.sh import-gisis >> "$LOG" 2>&1; then
  log "done $name"
  notify "Imported $name: $rows_new rows (was $rows_old). Log: scripts/ships/.logs/gisis-monthly.log"
else
  log "FAILED $name (see above)"
  notify "Import of $name FAILED. See scripts/ships/.logs/gisis-monthly.log"
fi
