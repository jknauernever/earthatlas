"""Fetch Global Fishing Watch 4Wings vessel-presence tiles for the whole world at
one zoom and cache them raw (resumable). Server-side only: the token never leaves
this machine (GFW Terms 2.G). Storing API data is encouraged by GFW's rate-limit
guidance; license CC BY-NC 4.0, "Powered by Global Fishing Watch."

  python3 fetch_presence_grid.py --z 5 --from 2025-07-01 --to 2026-07-01
"""
import argparse, os, sys, time, urllib.request, urllib.parse, urllib.error
from concurrent.futures import ThreadPoolExecutor

ap = argparse.ArgumentParser()
ap.add_argument('--z', type=int, default=5)
ap.add_argument('--from', dest='frm', required=True)
ap.add_argument('--to', required=True)
ap.add_argument('--dataset', default='public-global-presence:latest')
ap.add_argument('--workers', type=int, default=6)
a = ap.parse_args()

token = os.environ.get('GFW_API_TOKEN')
if not token:
    sys.exit('GFW_API_TOKEN not set')
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'cache', 'gfw4w', f"{a.dataset.split(':')[0]}_z{a.z}_{a.frm}_{a.to}")
os.makedirs(out, exist_ok=True)
qs = urllib.parse.urlencode({'datasets[0]': a.dataset, 'date-range': f'{a.frm},{a.to}',
                             'temporal-aggregation': 'true', 'format': 'MVT', 'interval': 'DAY'})

def one(xy):
    x, y = xy
    f = os.path.join(out, f'{x}_{y}.pbf')
    if os.path.exists(f):
        return 'cached'
    url = f'https://gateway.api.globalfishingwatch.org/v3/4wings/tile/heatmap/{a.z}/{x}/{y}?{qs}'
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token}', 'Accept-Encoding': 'identity', 'User-Agent': 'earthatlas-bake/1.0 (+https://earthatlas.org)'})
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read() if r.status == 200 else b''
            open(f + '.tmp', 'wb').write(body); os.replace(f + '.tmp', f)
            return 'ok' if body else 'empty'
        except urllib.error.HTTPError as e:
            if e.code in (204, 404):
                open(f, 'wb').close(); return 'empty'
            if e.code in (429, 500, 502, 503, 504, 524):
                time.sleep(10 * (attempt + 1)); continue
            return f'http {e.code}'
        except Exception as e:  # timeouts, resets
            time.sleep(10 * (attempt + 1))
    return 'failed'

n = 2 ** a.z
jobs = [(x, y) for y in range(n) for x in range(n)]
stats, done, t0 = {}, 0, time.time()
with ThreadPoolExecutor(a.workers) as ex:
    for s in ex.map(one, jobs):
        stats[s] = stats.get(s, 0) + 1; done += 1
        if done % 64 == 0:
            print(f'{done}/{len(jobs)} {stats} {time.time()-t0:.0f}s', flush=True)
print('done', stats, out)
