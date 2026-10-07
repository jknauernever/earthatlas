#!/usr/bin/env python3
"""
Send one month of activity.py output (stops.csv + summary.json) to the ships database through
POST /api/ships?op=importActivity (CRON_SECRET bearer), one request per kind; each replaces that month
(lib/ships/activityEstimates.js). Run by ships-gfw-month.yml after activity.py.

  python3 post_activity.py --month 2026-10 --dir activity [--through 2026-10-02] [--url https://earthatlas.org/api/ships]
"""
import argparse, calendar, csv, hashlib, json, os, sys, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'earthatlas-bake/1.0 (+https://earthatlas.org)'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--month', required=True)
    ap.add_argument('--dir', required=True)
    ap.add_argument('--through', default='', help='last day of data (a current month is partial); default: month end')
    ap.add_argument('--url', default='https://earthatlas.org/api/ships')
    a = ap.parse_args()
    secret = os.environ.get('CRON_SECRET')
    if not secret:
        sys.exit('CRON_SECRET not set')
    y, m = map(int, a.month.split('-'))
    through = a.through or f'{a.month}-{calendar.monthrange(y, m)[1]:02d}'
    summary = json.load(open(os.path.join(a.dir, 'summary.json')))
    rows = list(csv.DictReader(open(os.path.join(a.dir, 'stops.csv'), newline='')))
    inputs_path = os.path.join(HERE, 'activity_inputs.json')
    inputs = dict(areas=summary.get('areas'), vessels=summary.get('vessels'),
                  inputs_sha256=hashlib.sha256(open(inputs_path, 'rb').read()).hexdigest(),
                  inputs_made=json.load(open(inputs_path)).get('made'))
    for kind in ('terminal', 'anchorage'):
        body = json.dumps(dict(kind=kind, month=a.month, through=through, rule=summary['rule'], inputs=inputs,
                               rows=[r for r in rows if r['kind'] == kind])).encode()
        req = urllib.request.Request(f'{a.url}?op=importActivity', data=body, method='POST', headers={
            'Authorization': f'Bearer {secret}', 'Content-Type': 'application/json', 'User-Agent': UA})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=280) as r:
                    print(kind, r.status, r.read().decode()[:300], flush=True)
                    break
            except urllib.error.HTTPError as e:
                msg = e.read().decode()[:300]
                if e.code < 500:   # a refusal (bad rows, unknown terminal, auth) won't fix itself
                    sys.exit(f'{kind}: HTTP {e.code} {msg}')
                print(f'{kind}: HTTP {e.code} {msg}; retrying', flush=True)
            except (TimeoutError, OSError) as e:
                print(f'{kind}: {e}; retrying', flush=True)
            time.sleep(20 * (attempt + 1))
        else:
            sys.exit(f'{kind}: gave up')


if __name__ == '__main__':
    main()
