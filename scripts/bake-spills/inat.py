"""
/spills step 2c: iNaturalist taxon ids for the ESI species, so each species links to its EarthAtlas page
(earthatlas.org/species/<iNaturalist id>-<slug>, src/species/SpeciesDetailPage.jsx).

Looks up each ESI scientific name (GEN_SPEC; "Melanitta spp." → the genus) on the public iNaturalist taxa API
(api.inaturalist.org/v1/taxa, no key, ~1 request a second) and keeps an exact, active name match only. Results, misses
included, are cached in data/spills/work/inat_taxa.csv; reruns send only names not yet cached.

  data/spills/venv/bin/python scripts/bake-spills/inat.py --limit 2   # test
  data/spills/venv/bin/python scripts/bake-spills/inat.py             # everything not yet cached
"""
import collections, csv, json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT, sci_name

CACHE = os.path.join(ROOT, 'work', 'inat_taxa.csv')
LAYERS = ('BIRDS', 'BIRDSPT', 'FISH', 'FISHPT', 'HERP', 'INVERT', 'T_MAMMAL', 'HABITATS')


def lookup(name):
    url = 'https://api.inaturalist.org/v1/taxa?' + urllib.parse.urlencode(dict(q=name, is_active='true', per_page=10))
    req = urllib.request.Request(url, headers={'User-Agent': 'EarthAtlas spills bake (earthatlas.org)'})
    res = json.load(urllib.request.urlopen(req, timeout=30))['results']
    for t in res:
        if t['name'].lower() == name.lower():
            return t['id'], t['name'], t['rank']
    # older names (e.g. "Stizostedion vitreum") resolve through iNaturalist's synonym matching
    for t in res:
        if any(n.lower() == name.lower() for n in (t.get('matched_term') or '',)):
            return t['id'], t['name'], t['rank']
    return None, '', ''


def main():
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    sci = collections.Counter()
    for layer in LAYERS:
        for f in json.load(open(os.path.join(ROOT, 'geo', f'{layer}.geojson')))['features']:
            p = f['properties']
            if p.get('GEN_SPEC') and p['GEN_SPEC'].strip():
                sci[sci_name(p['GEN_SPEC'])] += 1
    done = {}
    if os.path.exists(CACHE):
        done = {r['query']: r for r in csv.DictReader(open(CACHE))}
    todo = [s for s in sorted(sci) if s not in done][:limit]
    print(f'{len(sci)} names, {len(done)} cached, looking up {len(todo)}', flush=True)
    new = not os.path.exists(CACHE)
    with open(CACHE, 'a', newline='') as out:
        w = csv.DictWriter(out, fieldnames=['query', 'id', 'name', 'rank'])
        if new:
            w.writeheader()
        for s in todo:
            tid, nm, rank = lookup(s)
            w.writerow(dict(query=s, id=tid or '', name=nm, rank=rank))
            out.flush()
            print(s, '→', tid, nm, rank, flush=True)
            time.sleep(1.1)


main()
