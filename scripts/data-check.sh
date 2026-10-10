#!/bin/zsh
# EarthAtlas data-import health check (READ ONLY). Run by the daily scheduled task "earthatlas-data-alerts" (Josh 2026-10-10)
# as ONE allow-listed command, so the check never stops for permission prompts. It only reads: GitHub run history and
# alert issues (gh), the published GFW index and changelog counts (curl). It prints a plain report:
#   - open data-alert issues (opened by .github/workflows/data-watchdog.yml)
#   - per data workflow: failed / timed-out runs in the last 24 h and runs stuck > 6 h, with the failed log's last lines
#   - whether the watchdog itself ran in the last 2 h
#   - freshness: GFW positions (stale > 6 days), changelog numbers (stale > 2 days)
#   zsh scripts/data-check.sh
set -uo pipefail
cd "${0:A:h}/.."
python3 - <<'EOF'
import datetime as dt, glob, json, os, subprocess, urllib.request

now = dt.datetime.now(dt.timezone.utc)
BAD = {'failure', 'timed_out', 'startup_failure'}
SKIP = {'gisis-monthly-reminder.yml'}
problems = []

def gh(*a):
    r = subprocess.run(['gh', *a], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr.strip()[:300])
    return r.stdout

def age(ts):
    return now - dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))

print(f'EarthAtlas data check — {now:%Y-%m-%d %H:%M} UTC\n')

# Open alert issues
try:
    issues = json.loads(gh('issue', 'list', '--label', 'data-alert', '--state', 'open', '--json', 'number,title,createdAt,url'))
    print(f'Open data-alert issues: {len(issues)}')
    for i in issues:
        print(f'  #{i["number"]} {i["title"]} (opened {i["createdAt"][:16]}) {i["url"]}')
except Exception as e:
    print(f'Open data-alert issues: could not read ({e})')
print()

# Runs per workflow
watchdog_ok = None
for path in sorted(glob.glob('.github/workflows/*.yml')):
    wf = os.path.basename(path)
    if wf in SKIP:
        continue
    try:
        runs = json.loads(gh('run', 'list', '--workflow', wf, '--limit', '15', '--json',
                             'databaseId,conclusion,status,createdAt,displayTitle,url,event,attempt'))
    except Exception as e:
        problems.append(f'{wf}: could not list runs ({e})')
        continue
    if wf == 'data-watchdog.yml':
        watchdog_ok = any(r['conclusion'] == 'success' and age(r['createdAt']) < dt.timedelta(hours=2) for r in runs)
    newest = {}
    for r in runs:
        if r['status'] == 'completed':
            newest.setdefault(r['displayTitle'], r)
    for r in runs:
        if r['status'] == 'completed' and r['conclusion'] in BAD and age(r['createdAt']) < dt.timedelta(hours=24):
            still = newest[r['displayTitle']] is r
            text = (f'{wf}: "{r["displayTitle"]}" {r["conclusion"]} at {r["createdAt"][:16]} UTC ({r["event"]}, attempt {r.get("attempt", 1)})'
                    f' — {"STILL FAILING (newest run of this title)" if still else "since succeeded"} — {r["url"]} [run id {r["databaseId"]}]')
            if still:
                try:
                    tail = [l.split('\t', 2)[-1][29:] for l in gh('run', 'view', str(r['databaseId']), '--log-failed').splitlines()]
                    keep = [l for l in tail if 'DeprecationWarning' not in l and any(k in l for k in ('rror', 'Traceback', 'rows', 'exit code', 'failed', 'FAIL', 'Did not'))][-12:]
                    text += '\n      log: ' + '\n      log: '.join(keep or tail[-8:])
                except Exception as e:
                    text += f'\n      (log unavailable: {e})'
            problems.append(text)
        elif r['status'] != 'completed' and age(r['createdAt']) > dt.timedelta(hours=6):
            problems.append(f'{wf}: "{r["displayTitle"]}" {r["status"]} for {age(r["createdAt"])} — {r["url"]}')
if watchdog_ok is False:
    problems.append('data-watchdog.yml: no successful run in the last 2 hours (alerts may not be firing)')
elif watchdog_ok is None:
    problems.append('data-watchdog.yml: not found or never ran (alerts are not live)')

# Freshness
def fetch(url):
    with urllib.request.urlopen(f'{url}?t={int(now.timestamp())}', timeout=60) as r:
        return json.load(r)
fresh = []
for name, url, key, limit in (
        ('GFW positions published through', 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/gfw-v1/index.json', 'fetched_through', 6),
        ('Changelog numbers as of', 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/changelog-counts.json', 'asOf', 2)):
    try:
        d = fetch(url)
        day = d.get(key)
        days = (now.date() - dt.date.fromisoformat(day)).days
        extra = ''
        if key == 'fetched_through':
            m = d['months'][sorted(d['months'])[-1]]
            extra = f' (newest month {sorted(d["months"])[-1]} built {m.get("built", "?")})'
        fresh.append(f'{name} {day} — {days} days ago{extra}')
        if days > limit:
            problems.append(f'STALE: {name} {day} ({days} days; limit {limit})')
    except Exception as e:
        problems.append(f'{name}: could not read {url} ({e})')

print(f'Problems: {len(problems)}')
for p in problems:
    print(f'  - {p}')
print('\nFreshness:')
for f in fresh:
    print(f'  - {f}')
EOF
