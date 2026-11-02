"""
National dataset `species`: the EarthAtlas species crosswalk — one identity per species across iNaturalist, GBIF and
eBird, shared by every subsite (the homepage's resolveSpecies in src/services/taxonCrosswalk.js, /spills, species-of-
concern…). Species pages are earthatlas.org/species/<iNaturalist id>-<slug>.

  data/spills/venv/bin/python scripts/national/species/build.py [version] [--limit N]

Sources, first wins for a species:
  1. data/species-of-concern/*.json — lists whose IDs a person reviewed (iNaturalist, GBIF, eBird; resolve-ids.mjs)
  2. data/national/inat/work/taxa.csv + data/spills/work/inat_taxa.csv — iNaturalist exact-name matches
     (scripts/national/inat/lookup.py; /spills' NOAA ESI species and every critical-habitat species)
  3. common names from the ESI species (/spills Lake Michigan bake) and critical habitat (crithab)
Missing GBIF keys: GBIF species/match (strict), cached in work/gbif.csv. eBird codes: one eBird taxonomy download
(EBIRD key from .env.local), matched by scientific name.

Output build/<version>/crosswalk.json: { species: [{ inat, name, common, gbif, ebird, rank, reviewed }],
by_name: { lowercase scientific or common name → index } } + dataset.json.
"""
import csv, glob, json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds, REPO  # noqa: E402

VERSION = next((a for a in sys.argv[1:] if not a.startswith('--') and not a.isdigit()), None) or time.strftime('%Y%m%d')
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
UA = {'User-Agent': 'EarthAtlas species crosswalk (earthatlas.org)'}
WORK = ds('species', 'work')
os.makedirs(WORK, exist_ok=True)
low = lambda s: ' '.join((s or '').lower().replace('’', "'").split())


def get(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    return json.load(urllib.request.urlopen(req, timeout=60))


species, by_inat = [], {}


def add(inat, name, common=None, gbif=None, ebird=None, rank=None, reviewed=False):
    if not inat:
        return
    inat = int(inat)
    e = by_inat.get(inat)
    if e is None:
        e = by_inat[inat] = dict(inat=inat, name=name, common=common, gbif=gbif, ebird=ebird, rank=rank, reviewed=reviewed, aka=set())
        species.append(e)
    for k, v in (('common', common), ('gbif', gbif), ('ebird', ebird), ('rank', rank)):
        if v and not e.get(k):
            e[k] = v
    for n in (name, common):
        if n:
            e['aka'].add(low(n))


# 1. reviewed lists
for f in sorted(glob.glob(os.path.join(REPO, 'data', 'species-of-concern', '*.json'))):
    for r in json.load(open(f)).get('species', []):
        inat = r.get('inat_species_taxon_id') or r.get('inat_taxon_id')
        add(inat, r.get('scientific_name'), r.get('common_name'), r.get('gbif_species_key') or r.get('gbif_taxon_key'),
            r.get('ebird_species_code'), r.get('rank'), reviewed=True)
        for syn in r.get('synonyms') or []:
            if inat:
                by_inat[int(inat)]['aka'].add(low(syn))
n_reviewed = len(species)

# 2. iNaturalist matches made by the bakes (query name → id)
for f in (os.path.join(REPO, 'data', 'spills', 'work', 'inat_taxa.csv'), ds('inat', 'work', 'taxa.csv')):
    if os.path.exists(f):
        for r in csv.DictReader(open(f)):
            if r.get('id'):
                add(r['id'], r['name'], rank=r.get('rank'))
                by_inat[int(r['id'])]['aka'].add(low(r['query']))

# 3. common names: critical habitat and the Lake Michigan ESI species
chs = ds('crithab', 'work', 'crithab_species.json')
for x in (json.load(open(chs)) if os.path.exists(chs) else []):
    if x.get('tx') and int(x['tx']) in by_inat:
        e = by_inat[int(x['tx'])]
        e['aka'].add(low(x.get('n')))
        e['common'] = e['common'] or re.sub(r'\s*\(.*\)$', '', x.get('n') or '') or None
lm = sorted(glob.glob(os.path.join(REPO, 'public', 'spills-data', 'lm-spills-v*.json')))
for x in (json.load(open(lm[-1]))['species'] if lm else []):
    if x.get('tx') and int(x['tx']) in by_inat:
        e = by_inat[int(x['tx'])]
        e['aka'].add(low(x['n']))
        e['common'] = e['common'] or x['n']

# GBIF keys (strict match on the iNaturalist name), cached
gcache_f = os.path.join(WORK, 'gbif.csv')
gcache = {r['name']: r['key'] for r in csv.DictReader(open(gcache_f))} if os.path.exists(gcache_f) else {}
todo = [e for e in species if not e['gbif'] and e['name'] and e['name'] not in gcache][:LIMIT]
print(f'{len(species)} species ({n_reviewed} reviewed); asking GBIF for {len(todo)}', flush=True)
new = not os.path.exists(gcache_f)
with open(gcache_f, 'a', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=['name', 'key'])
    if new:
        w.writeheader()
    for e in todo:
        try:
            m = get('https://api.gbif.org/v1/species/match?' + urllib.parse.urlencode(dict(name=e['name'], strict='true')))
            key = m.get('usageKey') if m.get('matchType') in ('EXACT', 'FUZZY') and m.get('confidence', 0) >= 95 else ''
        except Exception:
            continue   # asked again next run
        gcache[e['name']] = str(key or '')
        w.writerow(dict(name=e['name'], key=key or ''))
        fh.flush()
        time.sleep(0.25)
for e in species:
    if not e['gbif'] and gcache.get(e['name']):
        e['gbif'] = int(gcache[e['name']])

# eBird species codes (birds), from one taxonomy download
env = {}
if os.path.exists(os.path.join(REPO, '.env.local')):
    for line in open(os.path.join(REPO, '.env.local')):
        m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            env[m[1]] = m[2].strip('"\'')
key = os.environ.get('EBIRD_API_KEY') or env.get('EBIRD_API_KEY') or env.get('VITE_EBIRD_API_KEY')
ebird_f = os.path.join(WORK, 'ebird_taxonomy.json')
if key and not os.path.exists(ebird_f):
    json.dump(get('https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&cat=species,issf', {'X-eBirdApiToken': key}), open(ebird_f, 'w'))
if os.path.exists(ebird_f):
    codes = {low(t['sciName']): t['speciesCode'] for t in json.load(open(ebird_f))}
    for e in species:
        if not e['ebird'] and low(e['name']) in codes:
            e['ebird'] = codes[low(e['name'])]

out = ds('species', 'build', VERSION)
os.makedirs(out, exist_ok=True)
rows, by_name = [], {}
for i, e in enumerate(sorted(species, key=lambda e: (e['name'] or '').lower())):
    rows.append({k: e[k] for k in ('inat', 'name', 'common', 'gbif', 'ebird', 'rank', 'reviewed')})
    for n in e['aka']:
        if n and (n not in by_name or e['reviewed']):
            by_name[n] = i
json.dump(dict(species=rows, by_name=by_name), open(os.path.join(out, 'crosswalk.json'), 'w'), separators=(',', ':'))
json.dump({
    'name': 'EarthAtlas species crosswalk (iNaturalist, GBIF, eBird)',
    'source': {'publisher': 'EarthAtlas, from iNaturalist, GBIF and eBird taxonomies', 'url': 'https://www.inaturalist.org/taxa',
               'gbif': 'https://www.gbif.org/species', 'ebird': 'https://ebird.org/science/use-ebird-data/the-ebird-taxonomy'},
    'license': 'IDs and names: iNaturalist (CC0 taxonomy data), GBIF Backbone (CC BY 4.0), eBird/Clements taxonomy',
    'coverage': 'species used anywhere on EarthAtlas (reviewed lists first)', 'cadence': 'rebuilt when a dataset adds species',
    'summary': {'species': len(rows), 'reviewed': n_reviewed, 'with_gbif': sum(1 for r in rows if r['gbif']),
                'with_ebird': sum(1 for r in rows if r['ebird']), 'names': len(by_name)},
}, open(os.path.join(out, 'dataset.json'), 'w'), indent=1)
print(f"→ {out}: {len(rows)} species, {sum(1 for r in rows if r['gbif'])} with GBIF, {sum(1 for r in rows if r['ebird'])} with eBird, {len(by_name)} names")
