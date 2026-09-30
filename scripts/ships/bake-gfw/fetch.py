#!/usr/bin/env python3
"""
Fetch GFW 4Wings hourly per-vessel presence for named area tiles (areas.py), cached raw.

  python3 fetch.py --stage pacnw --from 2026-08-01 --to 2026-09-01 [--areas salish,seak] [--span 7]
                   [--raw DIR] [--budget 2000] [--refetch-after 2026-08-25]

Request (docs/SHIP_TRACK_SOURCES.md, "GFW hourly lines"):
  POST /v3/4wings/report?datasets[0]=public-global-presence:latest&temporal-resolution=HOURLY
       &spatial-resolution=HIGH&spatial-aggregation=false&group-by=VESSEL_ID&format=JSON&date-range=a,b
  body {"geojson": <bbox polygon>}

- Token: GFW_API_TOKEN (env, else .env.local); server/CI only (GFW Terms 2.G). Generic User-Agent.
- GFW runs ONE report at a time per user (a second concurrent one is 429), so fetching is serial:
  never run two fetch jobs at once (the workflow's fetch job has max-parallel 1).
- A report that runs > ~100 s returns 524; it is then read from GET /v3/4wings/last-report.
- Adaptive split: a request that fails with 413/422-size/524-without-result, or returns more than
  MAX_ROWS rows, is re-asked as two halves in time (7 → 3+4 → … → 1 day), then as 4 quadrants.
- Resumable: one raw file per (area, start day, span, part); existing files are skipped unless they
  start on/after --refetch-after (GFW may revise the latest days; the weekly run re-fetches ~5 days).
- --budget caps the number of report requests this run may make (GFW limit: 50,000/day).
Output: RAW/<area>/<area>_<YYYY-MM-DD>_<n>d[_q<k>].json.gz   (raw body, gzip'd) + RAW/fetch-log.ndjson
"""
import argparse, datetime as dt, gzip, json, os, sys, time, urllib.error, urllib.parse, urllib.request
import areas

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BASE = 'https://gateway.api.globalfishingwatch.org/v3/4wings'
UA = 'earthatlas-bake/1.0 (+https://earthatlas.org)'
MAX_ROWS = 400_000   # ~190 MB of JSON; above this a request is split


class TooBig(Exception):
    pass


def token():
    t = os.environ.get('GFW_API_TOKEN')
    if not t and os.path.exists(os.path.join(ROOT, '.env.local')):
        for line in open(os.path.join(ROOT, '.env.local')):
            if line.startswith('GFW_API_TOKEN='):
                t = line.split('=', 1)[1].strip().strip('"').strip("'")
    if not t:
        sys.exit('GFW_API_TOKEN not set')
    return t


def _call(req):
    with urllib.request.urlopen(req, timeout=240) as r:
        body = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            body = gzip.decompress(body)
        return body, r.headers


def report(tok, box, day, span, stats):
    d1 = (dt.date.fromisoformat(day) + dt.timedelta(days=span)).isoformat()
    qs = urllib.parse.urlencode({'datasets[0]': 'public-global-presence:latest', 'temporal-resolution': 'HOURLY',
                                 'spatial-resolution': 'HIGH', 'spatial-aggregation': 'false', 'group-by': 'VESSEL_ID',
                                 'format': 'JSON', 'date-range': f'{day},{d1}'})
    hdr = {'Authorization': f'Bearer {tok}', 'User-Agent': UA, 'Accept-Encoding': 'gzip', 'Content-Type': 'application/json'}
    w, s, e, n = box
    data = json.dumps({'geojson': {'type': 'Polygon', 'coordinates': [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}}).encode()
    for attempt in range(8):
        stats['calls'] += 1
        try:
            body, h = _call(urllib.request.Request(f'{BASE}/report?{qs}', data=data, headers=hdr, method='POST'))
            return body, h
        except urllib.error.HTTPError as e:
            if e.code == 413:
                raise TooBig('413')
            if e.code in (524, 504):     # still running server-side: poll last-report (kept 30 min)
                for _ in range(90):
                    time.sleep(10); stats['calls'] += 1
                    try:
                        body, h = _call(urllib.request.Request(f'{BASE}/last-report', headers=hdr))
                    except urllib.error.HTTPError:
                        continue
                    j = json.loads(body)
                    if isinstance(j, dict) and j.get('status') == 'running':
                        continue
                    if isinstance(j, dict) and 'entries' in j:
                        return body, h
                    raise TooBig(f'last-report error: {body[:200]!r}')
                raise TooBig('last-report never finished')
            if e.code in (429, 500, 502, 503):
                time.sleep(30 * (attempt + 1)); continue
            raise RuntimeError(f'http {e.code}: {e.read()[:300]!r}')
        except (TimeoutError, OSError):
            time.sleep(30 * (attempt + 1))
    raise RuntimeError('gave up')


def rows_of(body):
    j = json.loads(body)
    return sum(len(v) for e in j.get('entries', []) for v in e.values())


def fetch_piece(tok, area, box, day, span, out, stats, log, budget, part=''):
    """Fetch one (box, day, span); split on failure or size. Writes one or more files."""
    f = os.path.join(out, f'{area}_{day}_{span}d{part}.json.gz')
    if os.path.exists(f):
        return
    split = os.path.exists(f + '.split')   # an earlier run already found this piece too big
    if not split and stats['calls'] >= budget:
        raise SystemExit(f'budget of {budget} requests reached; re-run to continue (resumable)')
    t0 = time.time()
    try:
        if split:
            raise TooBig('split earlier')
        body, h = report(tok, box, day, span, stats)
        nrows = rows_of(body)
        if nrows > MAX_ROWS:
            raise TooBig(f'{nrows} rows')
    except TooBig as why:
        stats['splits'] += 1
        open(f + '.split', 'w').write(str(why))
        if span > 1:
            a = span // 2
            d2 = (dt.date.fromisoformat(day) + dt.timedelta(days=a)).isoformat()
            fetch_piece(tok, area, box, day, a, out, stats, log, budget, part)
            fetch_piece(tok, area, box, d2, span - a, out, stats, log, budget, part)
            return
        if len(part) >= 8:
            raise RuntimeError(f'{area} {day}: still too big after spatial splits ({why})')
        w, s, e, n = box
        mx, my = (w + e) / 2, (s + n) / 2
        for k, q in enumerate([(w, s, mx, my), (mx, s, e, my), (w, my, mx, n), (mx, my, e, n)]):
            fetch_piece(tok, area, q, day, 1, out, stats, log, budget, f'{part}_q{k}')
        return
    open(f + '.tmp', 'wb').write(gzip.compress(body, 6)); os.replace(f + '.tmp', f)
    stats['rows'] += nrows; stats['bytes'] += len(body); stats['files'] += 1
    rec = dict(area=area, day=day, span=span, part=part, rows=nrows, bytes=len(body), secs=round(time.time() - t0, 1),
               remaining=h.get('x-ratelimit-daily-remaining-requests'))
    log.write(json.dumps(rec) + '\n'); log.flush()
    print(json.dumps(rec), flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', default='pacnw')
    ap.add_argument('--areas', help='comma list (default: every area of the stage)')
    ap.add_argument('--from', dest='frm', required=True)
    ap.add_argument('--to', required=True, help='exclusive')
    ap.add_argument('--span', type=int, default=7)
    ap.add_argument('--raw', default=os.path.join(HERE, 'cache', 'raw'))
    ap.add_argument('--budget', type=int, default=5000)
    ap.add_argument('--refetch-after', help='YYYY-MM-DD: re-fetch files starting on/after this day')
    a = ap.parse_args()
    tok = token()
    tiles = areas.stage(a.stage)
    if a.areas:
        want = set(a.areas.split(','))
        tiles = [t for t in tiles if t[0] in want]
    stats = dict(calls=0, rows=0, bytes=0, files=0, splits=0)
    os.makedirs(a.raw, exist_ok=True)
    log = open(os.path.join(a.raw, 'fetch-log.ndjson'), 'a')
    end = dt.date.fromisoformat(a.to)
    for name, *box in tiles:
        out = os.path.join(a.raw, name)
        os.makedirs(out, exist_ok=True)
        if a.refetch_after:
            for fn in os.listdir(out):
                if (fn.endswith('.json.gz') or fn.endswith('.split')) and fn.split('_')[1] >= a.refetch_after:
                    os.remove(os.path.join(out, fn))
        d = dt.date.fromisoformat(a.frm)
        while d < end:
            span = min(a.span, (end - d).days)
            fetch_piece(tok, name, tuple(box), d.isoformat(), span, out, stats, log, a.budget)
            d += dt.timedelta(days=span)
    print('done', json.dumps(stats))


if __name__ == '__main__':
    main()
