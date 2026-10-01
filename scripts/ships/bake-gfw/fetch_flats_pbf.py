#!/usr/bin/env python3
"""
Tidal flats, marsh and shoals for the GFW water routing, from Geofabrik regional OSM extracts (2026-10-01).

Same features and same output as fetch_flats.py (natural=wetland / mud / shoal, and tidal=yes on natural=wetland /
mud / sand / shoal / shingle → LAND for routing; cache/land/flats-v1.pkl), but read from downloaded .osm.pbf files
with osmium instead of the public Overpass API, which took 3+ hours for the Pacific Northwest and timed out GitHub jobs.
Minutes instead of hours, and it scales to the US / world stages (pick the extracts that cover the stage's boxes).

  python3 fetch_flats_pbf.py --stage pacnw [--sources DIR] [--extracts a,b]   # needs osmium-tool on PATH

Source: OpenStreetMap via Geofabrik extracts (download.geofabrik.de), © OpenStreetMap contributors, ODbL 1.0.
"""
import argparse, json, os, pickle, subprocess, time, urllib.request
import shapely
from shapely.geometry import shape, box as sbox
import areas, land

HERE = os.path.dirname(os.path.abspath(__file__))
UA = 'earthatlas-bake/1.0 (+https://earthatlas.org)'
GEOFABRIK = 'https://download.geofabrik.de'
FLATS = os.path.join(land.LAND_DIR, 'flats-v1.pkl')
TIDAL_NATURAL = ('wetland', 'mud', 'sand', 'shoal', 'shingle')

# Extracts whose land touches each stage's boxes (areas.py). pacnw: Salish (WA, OR's Columbia mouth, BC), BC, Alaska,
# the Yukon / NWT Arctic coast, and the Russian side of the Bering Sea / western Aleutian boxes (170–180°E).
EXTRACTS = {
    'pacnw': ['north-america/us/washington', 'north-america/us/oregon', 'north-america/canada/british-columbia',
              'north-america/us/alaska', 'north-america/canada/yukon', 'north-america/canada/northwest-territories',
              'russia/far-eastern-fed-district'],
}


def download(path, sources):
    f = os.path.join(sources, path.replace('/', '_') + '-latest.osm.pbf')
    if not os.path.exists(f):
        os.makedirs(sources, exist_ok=True)
        req = urllib.request.Request(f'{GEOFABRIK}/{path}-latest.osm.pbf', headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=600) as r, open(f + '.tmp', 'wb') as out:
            while chunk := r.read(1 << 20):
                out.write(chunk)
        os.replace(f + '.tmp', f)
    return f


def features(pbf, work):
    """osmium: keep only the flats tags (plus the nodes/ways their geometry needs), then export areas as GeoJSON lines."""
    base = os.path.join(work, os.path.basename(pbf)[:-len('.osm.pbf')])
    subprocess.run(['osmium', 'tags-filter', pbf, 'nwr/natural=wetland,mud,shoal', 'nwr/tidal=yes',
                    '-o', base + '.flats.pbf', '--overwrite'], check=True)
    subprocess.run(['osmium', 'export', base + '.flats.pbf', '-f', 'geojsonseq', '-x', 'print_record_separator=false',
                    '--geometry-types=polygon', '-o', base + '.flats.geojsonl', '--overwrite'], check=True)
    with open(base + '.flats.geojsonl') as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def keep(props):
    nat = props.get('natural')
    if nat in ('wetland', 'mud', 'shoal'):
        return True
    return props.get('tidal') == 'yes' and nat in TIDAL_NATURAL   # tidal=yes on a river / riverbank is water


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', default='pacnw')
    ap.add_argument('--sources', default=os.path.join(HERE, 'cache', 'sources', 'geofabrik'))
    ap.add_argument('--extracts', help='comma list overriding EXTRACTS[stage] (for a small test)')
    a = ap.parse_args()
    t0 = time.time()
    boxes = [sbox(*t[1:]) for t in areas.stage(a.stage)]
    tree = shapely.STRtree(boxes)
    work = os.path.join(a.sources, 'work'); os.makedirs(work, exist_ok=True)
    polys, n = [], 0
    for path in (a.extracts.split(',') if a.extracts else EXTRACTS[a.stage]):
        pbf = download(path, a.sources)
        k = 0
        for f in features(pbf, work):
            if not keep(f.get('properties') or {}):
                continue
            try:
                g = shapely.make_valid(shape(f['geometry']))
            except Exception:
                continue
            if not len(tree.query(g, predicate='intersects')):
                continue
            ps = land.polys(g)
            polys.extend(ps); k += 1
        n += k
        print(f'  {path}: {k} features in the stage boxes, {len(polys)} polygons total, {time.time()-t0:.0f}s', flush=True)
    os.makedirs(os.path.dirname(FLATS), exist_ok=True)
    pickle.dump(dict(flats=polys, note=dict(elements=n, polygons=len(polys), stage=a.stage, source='geofabrik')),
                open(FLATS + '.tmp', 'wb'), protocol=4)
    os.replace(FLATS + '.tmp', FLATS)
    print(f'flats → {FLATS}: {n} OSM features, {len(polys)} polygons, {time.time()-t0:.0f}s')


if __name__ == '__main__':
    main()
