#!/usr/bin/env python3
"""
Water part of every ~1 km overlap square (Josh 2026-10-17: risk areas must not cover land).

The overlap grid (scripts/shiptraffic/overlap-bake.mjs BBOX + CELL) is fixed, so this runs once:
  python3 scripts/shiptraffic/water-cells.py [--out FILE]

Output JSON: { bbox, cell, nx, land: [cell index…], part: { "<cell index>": [[ring], …] } }
  - a square in neither list is all water (drawn whole)
  - land = all land (never drawn)
  - part = its water polygon(s), simplified to ~10 m, as outer rings (holes dropped; islets under a square stay red)
Land: OSM land polygons (osmdata.openstreetmap.de, ODbL), the copy scripts/ships/bake-gfw uses.
"""
import argparse, json, math, os, subprocess, time
import shapely
from shapely.geometry import box, shape
HERE = os.path.dirname(os.path.abspath(__file__))
OSM_SHP = os.path.join(HERE, '..', 'ships', 'bake-gfw', 'cache', 'land', 'osm', 'land_polygons.shp')  # same copy the /ships bakes use

W, S, E, N = -125.5, 46.9, -122.0, 49.9
LNG, LAT = 0.012, 0.0081
NX, NY = math.ceil((E - W) / LNG), math.ceil((N - S) / LAT)

ap = argparse.ArgumentParser()
ap.add_argument('--out', default=os.path.join(HERE, 'cache', 'water-cells.json'))
args = ap.parse_args()

t0 = time.time()
sub = os.path.join(HERE, 'cache', 'osm-land-salish.geojsonl')
if not os.path.exists(sub):
    subprocess.run(['ogr2ogr', '-f', 'GeoJSONSeq', sub, OSM_SHP, '-spat', str(W - 0.05), str(S - 0.05), str(E + 0.05), str(N + 0.05)], check=True)
geoms = []
for ln in open(sub):
    g = shape(json.loads(ln)['geometry'])
    geoms.extend(getattr(g, 'geoms', [g]))
tree = shapely.STRtree(geoms)
print(f'{len(geoms)} OSM land polygons ({time.time()-t0:.0f}s)', flush=True)

land_cells, part = [], {}
r5 = lambda v: round(v, 5)
for j in range(NY):
    for i in range(NX):
        cb = box(W + i * LNG, S + j * LAT, W + (i + 1) * LNG, S + (j + 1) * LAT)
        hits = [geoms[k] for k in tree.query(cb, predicate='intersects')]
        if not hits:
            continue
        lnd = shapely.union_all([h.intersection(cb) for h in hits])
        if lnd.area >= cb.area * 0.999:
            land_cells.append(j * NX + i); continue
        if lnd.area <= cb.area * 0.001:
            continue
        water = cb.difference(lnd).simplify(0.0001, preserve_topology=True)
        polys = [p for p in getattr(water, 'geoms', [water]) if p.geom_type == 'Polygon' and p.area > cb.area * 0.005]
        if not polys:
            land_cells.append(j * NX + i); continue
        part[str(j * NX + i)] = [[[r5(x), r5(y)] for x, y in p.exterior.coords] for p in polys]
    if j % 50 == 0:
        print(f'row {j}/{NY}  land {len(land_cells)}  coast {len(part)}  ({time.time()-t0:.0f}s)', flush=True)

os.makedirs(os.path.dirname(args.out), exist_ok=True)
out = {'bbox': [W, S, E, N], 'cell': {'lngStep': LNG, 'latStep': LAT}, 'nx': NX, 'source': 'OpenStreetMap land polygons (ODbL)',
       'land': land_cells, 'part': part}
json.dump(out, open(args.out, 'w'), separators=(',', ':'))
print(f'→ {args.out}  {os.path.getsize(args.out)/1e6:.1f} MB  land {len(land_cells)}  coast {len(part)}  ({time.time()-t0:.0f}s)')
