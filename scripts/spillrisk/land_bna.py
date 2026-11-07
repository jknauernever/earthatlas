"""GeoJSON land (Multi)Polygon -> PyGNOME BNA: exterior rings as land ("1"), holes (inland water: lakes, rivers,
inlets carved out of land) as lakes ("2", drawn as water), plus the map bounds.
usage: env/bin/python scripts/spillrisk/land_bna.py <land.geojson> <out.bna> W S E N"""
import json, sys
src, out = sys.argv[1], sys.argv[2]
w, s, e, n = map(float, sys.argv[3:7])
g = json.load(open(src))
if g.get('type') == 'FeatureCollection':
    g = g['features'][0]['geometry']
elif g.get('type') == 'Feature':
    g = g['geometry']
polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
nl = nh = 0
with open(out, 'w') as f:
    for i, p in enumerate(polys):
        for k, ring in enumerate(p):
            kind = '1' if k == 0 else '2'
            nl += k == 0; nh += k > 0
            f.write(f'"{i}.{k}","{kind}",{len(ring)}\n' + ''.join(f'{x:.6f},{y:.6f}\n' for x, y in ring))
    box = [(w, s), (e, s), (e, n), (w, n), (w, s)]
    f.write(f'"Map Bounds","1",{len(box)}\n' + ''.join(f'{x},{y}\n' for x, y in box))
print('land polygons', nl, 'inland-water holes', nh)
