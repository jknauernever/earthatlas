"""
Apply states.py's name rules to an existing state bake without re-running it (the national run takes hours): official
place names (`pc`, Census then USGS GNIS towns), real Census counties only (`county`), and iNaturalist ids on the
critical-habitat species list (`tx`/`txn`, from scripts/national/inat/lookup.py). The same rules states.py now applies.

  data/spills/venv/bin/python scripts/bake-spills/patch-names.py [version]     (default v2)
"""
import csv, glob, json, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national', 'nrc'))
from lib import ds  # noqa: E402
from named import STATE_USPS  # noqa: E402

VERSION = sys.argv[1] if len(sys.argv) > 1 else 'v2'
OUT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'spills-data'))
src = open(os.path.join(os.path.dirname(__file__), 'states.py')).read()


def grab(start, end):
    i = src.index(start)
    return src[i:src.index(end, i)]


ns = dict(re=re, csv=csv, glob=glob, ds=ds, STATE_USPS=STATE_USPS)
exec(grab('def norm_place(s):', '\n\n\n'), ns)
exec(grab('gaz_name = {}', 'def city_xy').replace('from named import STATE_USPS  # noqa: E402  (scripts/national/nrc/named.py)\n', '')
     .replace("sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national', 'nrc'))\n", ''), ns)
place_name, county_name = ns['place_name'], ns['county_name']

n = c = 0
for f in sorted(glob.glob(os.path.join(OUT, f'state-{VERSION}', '*.json'))):
    d = json.load(open(f))
    for p in d['points']:
        p['pc'] = place_name(p.get('city'), p['st'])
        p['county'] = county_name(p.get('county'), p['st'])
        n += 1
        c += 1 if p['pc'] else 0
    json.dump(d, open(f, 'w'), separators=(',', ':'))
species = json.load(open(ds('crithab', 'work', 'crithab_species.json')))
for name in (f'regions-{VERSION}.json', f'lm-spills-{VERSION}.json'):
    f = os.path.join(OUT, name)
    d = json.load(open(f))
    if 'ch_species' in d:
        d['ch_species'] = species
        json.dump(d, open(f, 'w'), separators=(',', ':'))
print(f'{n} reports: {c} with an official place name; species ids on {sum(1 for s in species if s.get("tx"))} of {len(species)} critical-habitat species')
