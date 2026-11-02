"""
National dataset helper `inat`: iNaturalist taxon ids for scientific names, so species anywhere on EarthAtlas link to
their EarthAtlas species page (earthatlas.org/species/<iNaturalist id>-<slug>). One shared cache for every dataset:
data/national/inat/work/taxa.csv (query, id, name, rank; misses kept too, so they are not asked again).

  data/spills/venv/bin/python scripts/national/inat/lookup.py --crithab --limit 3   # test
  data/spills/venv/bin/python scripts/national/inat/lookup.py --crithab            # every critical-habitat species
The --crithab run also writes `tx` (id) and `txn` (iNaturalist's name) into data/national/crithab/work/crithab_species.json.
Public API (api.inaturalist.org/v1/taxa), no key, ~1 request a second; exact name match only (a subspecies or population
name falls back to its species).
"""
import csv, json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds  # noqa: E402

CACHE = ds('inat', 'work', 'taxa.csv')
SEED = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'data', 'spills', 'work', 'inat_taxa.csv')   # /spills' own lookups


def load():
    rows = {}
    for f in (SEED, CACHE):
        if os.path.exists(f):
            for r in csv.DictReader(open(f)):
                rows[r['query']] = r
    return rows


def ask(name):
    url = 'https://api.inaturalist.org/v1/taxa?' + urllib.parse.urlencode(dict(q=name, is_active='true', per_page=10))
    req = urllib.request.Request(url, headers={'User-Agent': 'EarthAtlas national data (earthatlas.org)'})
    res = json.load(urllib.request.urlopen(req, timeout=30))['results']
    for t in res:
        if t['name'].lower() == name.lower() or (t.get('matched_term') or '').lower() == name.lower():
            return dict(query=name, id=t['id'], name=t['name'], rank=t['rank'])
    return dict(query=name, id='', name='', rank='')


def clean_sci(s):
    s = re.sub(r'\(=[^)]*\)|\([^)]*\)', ' ', s or '')
    s = re.sub(r'\b(ssp|subsp|var|pop)\.?\s', ' ', s)
    return ' '.join(re.sub(r'[^A-Za-z\- ]', ' ', s).split()).capitalize()


def taxa(names, limit=None):
    have = load()
    todo = [n for n in dict.fromkeys(names) if n and n not in have][:limit]
    print(f'{len(have)} cached, asking {len(todo)}', flush=True)
    new = not os.path.exists(CACHE)
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    with open(CACHE, 'a', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['query', 'id', 'name', 'rank'])
        if new:
            w.writeheader()
        for n in todo:
            r = ask(n)
            if not r['id'] and len(n.split()) > 2:          # trinomial → species
                r2 = ask(' '.join(n.split()[:2]))
                if r2['id']:
                    r = dict(r2, query=n)
            w.writerow(r)
            fh.flush()
            have[n] = r
            time.sleep(1.1)
    return have


if __name__ == '__main__':
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    if '--crithab' in sys.argv:
        path = ds('crithab', 'work', 'crithab_species.json')
        sp = json.load(open(path))
        got = taxa([clean_sci(x.get('sci')) for x in sp], limit)
        n = 0
        for x in sp:
            t = got.get(clean_sci(x.get('sci')))
            if t and t.get('id'):
                x['tx'], x['txn'] = int(t['id']), t['name']
                n += 1
        json.dump(sp, open(path, 'w'))
        print(f'{n} of {len(sp)} critical-habitat species have an iNaturalist id')
