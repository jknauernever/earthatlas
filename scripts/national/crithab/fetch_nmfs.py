"""
National dataset `crithab`, NOAA Fisheries half (docs/NATIONAL_DATA.md): NOAA Fisheries (NMFS) Endangered Species Act critical habitat, every species, from its public map
service (maps.fisheries.noaa.gov/server/rest/services/All_NMFS_Critical_Habitat/MapServer). It covers the species NOAA
manages that the Fish and Wildlife Service file does not: salmon and steelhead, Southern Resident killer whales, sea
turtles at sea, whales, sturgeon, corals, abalone. One GeoJSON per layer (paged, 2,000 features a request) into
data/national/crithab/raw/nmfs/ (the offload drive); layers already saved are skipped, so a rerun only fetches what is new.

  data/spills/venv/bin/python scripts/national/crithab/fetch_nmfs.py --limit 2   # test: two layers
  data/spills/venv/bin/python scripts/national/crithab/fetch_nmfs.py
"""
import json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds

SVC = 'https://maps.fisheries.noaa.gov/server/rest/services/All_NMFS_Critical_Habitat/MapServer'
OUT = ds('crithab', 'raw', 'nmfs')
UA = {'User-Agent': 'EarthAtlas spills bake (earthatlas.org)'}


def get(url, **q):
    req = urllib.request.Request(url + ('?' + urllib.parse.urlencode(q) if q else ''), headers=UA)
    return json.load(urllib.request.urlopen(req, timeout=300))


os.makedirs(OUT, exist_ok=True)
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
layers = [l for l in get(f'{SVC}/layers', f='json')['layers'] if l.get('type') == 'Feature Layer'][:limit]
calls = 1
for l in layers:
    path = os.path.join(OUT, f"{l['id']}.geojson")
    if os.path.exists(path):
        continue
    feats, offset = [], 0
    while True:
        page = get(f"{SVC}/{l['id']}/query", where='1=1', outFields='*', returnGeometry='true', outSR=4326, f='geojson',
                   resultOffset=offset, resultRecordCount=2000, orderByFields='OBJECTID')
        calls += 1
        feats += page.get('features', [])
        if not page.get('exceededTransferLimit') and len(page.get('features', [])) < 2000:
            break
        offset += 2000
        time.sleep(0.5)
    json.dump(dict(type='FeatureCollection', name=l['name'], features=feats), open(path, 'w'))
    print(f"{l['id']:>4} {l['name'][:60]:60} {len(feats):>6}", flush=True)
    time.sleep(0.5)
print(f'{len(layers)} layers, {calls} requests')
