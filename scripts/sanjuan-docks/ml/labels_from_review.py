#!/usr/bin/env python3
"""Turn the /sanjuan-docks/review answers into YOLO-seg training labels for the
reviewed pilot tiles.

    python3 scripts/sanjuan-docks/ml/labels_from_review.py

A reviewed tile's dock outlines: detections marked ✓ (the model's own mask), OSM
tracings, and the reviewer's drawn lines (buffered to a 2.5 m deck, as OSM lines are).
Detections marked ✗ stay unlabelled, which teaches "not a dock". A tile is left out
when it holds a dock with no outline (a known point marked ✓ or never answered, with
no shape within 15 m) or a detection never answered — training on it would teach
that a real dock isn't one. Writes labels/<tile>.txt and review/train_tiles.json.
"""
import json, math
from shapely.geometry import shape, box, Point, LineString, Polygon, MultiPolygon
from shapely.ops import transform, unary_union
from shapely.validation import make_valid

ROOT = 'data/sanjuan-docks/ml'
R = 6378137.0
DECK_M = 2.5
COVER_M = 15


def merc_xy(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


to_m = lambda g: transform(lambda x, y, z=None: merc_xy(x, y), g)
manifest = json.load(open(f'{ROOT}/manifest.json'))
px = manifest['px']
tiles = {t['id']: t for t in manifest['tiles']}
labels = json.load(open(f'{ROOT}/review/labels.json'))
# Every round's reviewed detections: the current one plus archived rounds (<set>-detections.geojson).
import glob
dets = [f for fn in sorted(glob.glob(f'{ROOT}/review/*detections.geojson'))
        for f in json.load(open(fn))['features'] if f['properties']['kind'] == 'shape']
known = json.load(open('public/hpa/dock-locations.geojson'))['features']
osm_shapes = [to_m(shape(f['geometry'])) for f in known if f['properties']['kind'] == 'shape']
known_pts = [(f['properties']['facility_id'], to_m(shape(f['geometry']))) for f in known
             if f['properties']['kind'] == 'point' and f['properties']['located_by'] in ('friends', 'wdfw_permit')]


def merc_scale(lat):  # Web-Mercator metres per ground metre
    return 1 / math.cos(math.radians(lat))


det_m = [(f['properties']['detection_id'], to_m(make_valid(shape(f['geometry'])))) for f in dets]
drawn_m = []
for d in labels.get('drawn', []):
    ln = LineString(d['coords'])
    drawn_m.append(to_m(ln).buffer(DECK_M / 2 * merc_scale(ln.centroid.y), cap_style=2))

kept, skipped = [], {}
for tid in labels['reviewed']:
    t = tiles[tid]
    tb = box(*t['bbox'])
    scale = (t['bbox'][2] - t['bbox'][0]) / R  # unused guard
    shapes = [g for g in osm_shapes if g.intersects(tb)] + [g for g in drawn_m if g.intersects(tb)] + \
             [g for i, g in det_m if g.intersects(tb) and labels['det'].get(i) == 'yes']
    if any(g.intersects(tb) and i not in labels['det'] for i, g in det_m):
        skipped[tid] = 'unanswered detection'
        continue
    cover = unary_union(shapes) if shapes else None
    lat = math.degrees(2 * math.atan(math.exp(((t['bbox'][1] + t['bbox'][3]) / 2) / R)) - math.pi / 2)
    cover_m = COVER_M * merc_scale(lat)
    lonely = [fid for fid, p in known_pts if tb.contains(p) and labels.get('known', {}).get(fid) != 'no'
              and (cover is None or cover.distance(p) > cover_m)]
    if lonely:
        skipped[tid] = f'dock without outline ({lonely[0]})'
        continue
    lines = []
    x0, y0, x1, y1 = t['bbox']
    for g in shapes:
        g = g.intersection(tb)
        for poly in (g.geoms if isinstance(g, MultiPolygon) else [g]):
            if not isinstance(poly, Polygon) or poly.is_empty or poly.area == 0:
                continue
            pts = [((x - x0) / (x1 - x0), (y1 - y) / (y1 - y0)) for x, y in poly.exterior.coords[:-1]]
            lines.append('0 ' + ' '.join(f'{u:.5f} {v:.5f}' for u, v in pts))
    open(f'{ROOT}/labels/{tid}.txt', 'w').write('\n'.join(lines) + ('\n' if lines else ''))
    kept.append(tid)
json.dump({'tiles': kept, 'skipped': skipped}, open(f'{ROOT}/review/train_tiles.json', 'w'), indent=1)
print(f'{len(kept)} reviewed tiles → training labels ({sum(1 for t in kept if open(f"{ROOT}/labels/{t}.txt").read().strip())} with docks); '
      f'{len(skipped)} left out:', {r: sum(v.split(' (')[0] == r for v in skipped.values()) for r in set(v.split(' (')[0] for v in skipped.values())})
