"""
National dataset `crithab`, Canada part (docs/NATIONAL_DATA.md): Fisheries and Oceans Canada (DFO) critical habitat under the
Species at Risk Act, from DFO's open-data map service (open.canada.ca dataset db177a8c-5d7d-49eb-8290-31e6a45d786c,
Open Government Licence – Canada). Only the species in WANTED for now: the two resident killer whale populations, whose
Canadian critical habitat continues the NOAA Southern Resident area across the border. One request per species into
data/national/crithab/raw/dfo.geojson (the offload drive).

  data/spills/venv/bin/python scripts/national/crithab/fetch_dfo.py
"""
import json, os, sys, urllib.parse, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds

SVC = 'https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/dfo_sara_critical_habitat/MapServer/0'
WANTED = ["COMMON_E = 'Killer Whale'"]
UA = {'User-Agent': 'EarthAtlas national data bake (earthatlas.org)'}

feats = []
for where in WANTED:
    q = urllib.parse.urlencode(dict(where=where, outFields='*', returnGeometry='true', outSR=4326, f='geojson'))
    page = json.load(urllib.request.urlopen(urllib.request.Request(f'{SVC}/query?{q}', headers=UA), timeout=300))
    feats += page['features']
    for f in page['features']:
        print(f"{f['properties'].get('COMMON_E')} — {f['properties'].get('POP_E')} ({f['properties'].get('SARASTAT_E')})", flush=True)
json.dump(dict(type='FeatureCollection', features=feats), open(ds('crithab', 'raw', 'dfo.geojson'), 'w'))
print(f'{len(feats)} shapes → {ds("crithab", "raw", "dfo.geojson")}')
