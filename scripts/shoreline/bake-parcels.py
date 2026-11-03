#!/usr/bin/env python3
"""
Bake /shoreline's parcels + buildings from the county download (fetch-county.mjs) and the two stat files
(nearshore-stats.py, greenery-stats.py).

  scripts/bake-parcels/build/shoreline-sjc-<version>.pmtiles
      source-layer "parcels"    shape + fid + PIN only (light tiles at county zoom)
      source-layer "buildings"  shape + bid (hover id) + the building popup's fields (SSE popups.ts building spec)
  data/shoreline/build/detail/<fid % SHARDS>.json
      { "<fid>": { p: assessor fields, ad: address points, bl: buildings, ns: nearshore, gr: greenery } }
      everything the property popup reads, which SSE spread over 19,020 per-parcel files on GCS plus
      parcel_index.json / address_lookup.json / nearshore_parcel_stats.json / ndvi_parcel_stats.json.

The rules are SSE's: a parcel's buildings are the footprints that intersect it (popupSpatial.ts
countIntersectingBuildings); its greenery percentile ranks its NDVI mean among every parcel of the same
Tax_Area (FeaturePopup.tsx buildIslandIndex), with that island's count and median.

Usage:  python3 scripts/shoreline/bake-parcels.py <version>      e.g. 2026-11
Needs:  shapely>=2, tippecanoe
"""
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict

from shapely import STRtree, force_2d
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'data', 'shoreline', 'raw')
BUILD = os.path.join(ROOT, 'data', 'shoreline', 'build')
TILES = os.path.join(ROOT, 'scripts', 'bake-parcels', 'build')  # where api/parcel-tiles reads local PMTiles
SHARDS = 256  # ≈110 KB per file (≈1.5 KB per parcel), so a popup click fetches little

# County fields the popup never shows: internal file paths / ids.
DROP = {'FID', 'image_path', 'img_id'}
BUILDING_FIELDS = ['ADDRESS', 'Sq_Ft', 'Island', 'PIN', 'Discriptio', 'Source']
ADDRESS_FIELDS = ['FULLADDR', 'FULLNAME', 'PLACENAME', 'BLDGTYPE', 'MSAG', 'DESCRIPTIO', 'COMMENT', 'ISLAND']  # SSE address_lookup.json


def load(name, folder=RAW):
    with open(os.path.join(folder, name)) as f:
        return json.load(f)


def clean(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def main():
    version = sys.argv[1] if len(sys.argv) > 1 else None
    if not version:
        raise SystemExit('usage: bake-parcels.py <version>')
    parcels = load('parcels.geojson')['features']
    buildings = load('buildings.geojson')['features']
    addresses = load('addresses.geojson')['features']
    nearshore = load('nearshore.json', BUILD)['parcels']
    greenery = load('greenery.json', BUILD)

    # Address points by PIN (SSE address_lookup.json shape), skipping blank addresses
    by_pin = defaultdict(list)
    for a in addresses:
        p = a['properties']
        if not clean(p.get('FULLADDR')):
            continue
        by_pin[str(p.get('PIN') or '').strip()].append({k: clean(p.get(k)) for k in ADDRESS_FIELDS})

    # Greenery percentile per Tax_Area
    island_of = {str(f['properties']['FID']): clean(f['properties'].get('Tax_Area')) for f in parcels}
    groups = defaultdict(list)
    for fid, g in greenery.items():
        if island_of.get(fid):
            groups[island_of[fid]].append((g['mean'], fid))
    rank = {}
    for island, rows in groups.items():
        rows.sort()
        n = len(rows)
        median = rows[n // 2][0]
        for i, (_, fid) in enumerate(rows):
            rank[fid] = {'pct': round(i / (n - 1) * 100) if n > 1 else 50, 'island': island, 'n': n, 'median': median}

    bgeoms = [force_2d(shape(b['geometry'])) if b.get('geometry') else None for b in buildings]
    bidx = [i for i, g in enumerate(bgeoms) if g is not None and not g.is_empty]
    btree = STRtree([bgeoms[i] for i in bidx])

    # Fresh shard folder: a smaller run must not leave an earlier run's shards behind for upload.mjs
    shutil.rmtree(os.path.join(BUILD, 'detail'), ignore_errors=True)
    os.makedirs(os.path.join(BUILD, 'detail'))
    os.makedirs(TILES, exist_ok=True)
    shards = defaultdict(dict)
    with open(os.path.join(BUILD, 'parcels.ndjson'), 'w') as pout:
        for f in parcels:
            props = f['properties']
            fid = str(props['FID'])
            if not f.get('geometry'):
                continue
            pg = force_2d(shape(f['geometry']))
            bl = []
            for c in btree.query(pg, predicate='intersects'):
                bp = buildings[bidx[c]]['properties']
                bl.append({k: clean(bp.get(k)) for k in BUILDING_FIELDS})
            pin = str(props.get('PIN') or '').strip()
            rec = {'p': {k: clean(v) for k, v in props.items() if k not in DROP}, 'bl': bl}
            if by_pin.get(pin):
                rec['ad'] = by_pin[pin]
            if fid in nearshore:
                rec['ns'] = nearshore[fid]
            if fid in greenery:
                rec['gr'] = {**greenery[fid], **rank.get(fid, {})}
            shards[int(fid) % SHARDS][fid] = rec
            pout.write(json.dumps({'type': 'Feature', 'properties': {'fid': int(fid), 'PIN': pin},
                                   'geometry': f['geometry']}, separators=(',', ':')) + '\n')

    with open(os.path.join(BUILD, 'buildings.ndjson'), 'w') as bout:
        for i, b in enumerate(buildings):
            if not b.get('geometry'):
                continue
            p = b['properties']
            # bid: a per-bake building number, so the map can highlight the hovered building (Mapbox promoteId)
            bout.write(json.dumps({'type': 'Feature', 'tippecanoe': {'minzoom': 13},
                                   'properties': {'bid': i, **{k: clean(p.get(k)) for k in BUILDING_FIELDS if clean(p.get(k)) is not None}},
                                   'geometry': b['geometry']}, separators=(',', ':')) + '\n')

    for n, recs in shards.items():
        with open(os.path.join(BUILD, 'detail', f'{n}.json'), 'w') as f:
            json.dump(recs, f, separators=(',', ':'))

    out = os.path.join(TILES, f'shoreline-sjc-{version}.pmtiles')
    # SSE draws parcels from Google zoom 13.5 and buildings from 15 (Mapbox 12.5 / 14); tiles start one level earlier.
    subprocess.run([
        'tippecanoe', '-o', out, '--force',
        '-n', f'Shoreline Explorer parcels {version}', '-A', 'San Juan County GIS',
        '-Z12', '-z15', '--no-simplification-of-shared-nodes', '--detect-shared-borders',
        '-L', json.dumps({'file': os.path.join(BUILD, 'parcels.ndjson'), 'layer': 'parcels'}),
        '-L', json.dumps({'file': os.path.join(BUILD, 'buildings.ndjson'), 'layer': 'buildings'}),
    ], check=True)
    sizes = [os.path.getsize(os.path.join(BUILD, 'detail', f)) for f in os.listdir(os.path.join(BUILD, 'detail'))]
    print(f'{len(parcels):,} parcels, {len(buildings):,} buildings → {out} ({os.path.getsize(out) / 1e6:.2f} MB); '
          f'{len(sizes)} detail shards, {sum(sizes) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
