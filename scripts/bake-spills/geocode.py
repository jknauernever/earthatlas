"""
/spills step 2: street-address locations for NRC reports that have no coordinates, from the U.S. Census Bureau
Geocoder's batch endpoint (geocoding.geo.census.gov, public, no key; up to 10,000 addresses per upload).

Only reports that can end up on the map are sent: oil/petroleum material, in IL/IN/WI/MI, medium WATER or a Lake
Michigan water named in the text, no usable coordinates, and an address that starts with a house number. Results are
cached in data/spills/work/census_geocode.csv keyed by NRC report number; reruns send only reports not yet cached.

  data/spills/venv/bin/python scripts/bake-spills/geocode.py --limit 10   # test
  data/spills/venv/bin/python scripts/bake-spills/geocode.py              # everything not yet cached
"""
import csv, glob, io, os, re, sys, urllib.request, uuid
sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT, OIL, LM_TEXT, STATES, report_text, has_coords

CACHE = os.path.join(ROOT, 'work', 'census_geocode.csv')
URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
HOUSE = re.compile(r'^\s*[NSEW]?\d+[A-Z]?\s+\S')


def candidates():
    seen = {}
    for f in sorted(glob.glob(os.path.join(ROOT, 'work', 'nrc_cand_*.csv'))):
        for r in csv.DictReader(open(f)):
            s = seen.setdefault(r['SEQNOS'], dict(r, oil=False))
            if OIL.search((r['NAME_OF_MATERIAL'] or '').upper()):
                s['oil'] = True
    for r in seen.values():
        if not r['oil'] or (r['LOCATION_STATE'] or '').upper() not in STATES or has_coords(r):
            continue
        if r['MEDIUM_DESC'] != 'WATER' and not LM_TEXT.search(report_text(r)):
            continue
        addr = (r['LOCATION_ADDRESS'] or r['LOCATION_STREET1'] or '').strip()
        if HOUSE.match(addr):
            yield r['SEQNOS'], addr, (r['LOCATION_NEAREST_CITY'] or '').strip(), r['LOCATION_STATE'].strip(), (r['LOCATION_ZIP'] or '').strip()[:5]


def main():
    limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
    done = set()
    if os.path.exists(CACHE):
        done = {r['seq'] for r in csv.DictReader(open(CACHE))}
    todo = [c for c in candidates() if c[0] not in done]
    if limit:
        todo = todo[:limit]
    print(f'{len(done)} cached, sending {len(todo)}', flush=True)
    if not todo:
        return
    body = io.StringIO()
    csv.writer(body).writerows(todo)
    bnd = uuid.uuid4().hex
    data = (f'--{bnd}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\nPublic_AR_Current\r\n'
            f'--{bnd}\r\nContent-Disposition: form-data; name="addressFile"; filename="a.csv"\r\nContent-Type: text/csv\r\n\r\n'
            f'{body.getvalue()}\r\n--{bnd}--\r\n').encode()
    req = urllib.request.Request(URL, data=data, headers={'Content-Type': f'multipart/form-data; boundary={bnd}'})
    out = urllib.request.urlopen(req, timeout=900).read().decode('utf-8', 'replace')
    new = not os.path.exists(CACHE)
    n = 0
    with open(CACHE, 'a', newline='') as fh:
        w = csv.writer(fh)
        if new:
            w.writerow(['seq', 'input', 'match', 'exact', 'matched_address', 'lon', 'lat'])
        for row in csv.reader(io.StringIO(out)):
            if len(row) < 3:
                continue
            seq, inp, match = row[0], row[1], row[2]
            exact = row[3] if len(row) > 3 else ''
            lon = lat = ''
            if match == 'Match' and len(row) > 5 and ',' in row[5]:
                lon, lat = row[5].split(',')
                n += 1
            w.writerow([seq, inp, match, exact, row[4] if len(row) > 4 else '', lon, lat])
    print(f'matched {n} of {len(todo)}')


if __name__ == '__main__':
    main()
