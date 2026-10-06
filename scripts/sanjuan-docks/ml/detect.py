#!/usr/bin/env python3
"""Dock-footprint pilot: run the trained model over the pilot shoreline tiles, merge
detections across overlapping tiles into dock footprints, match each to parcels and
permits, and score against what we already know.

    ~/.venvs/sanjuan-docks/bin/python scripts/sanjuan-docks/ml/detect.py [--conf 0.35]

Output: public/hpa/ml-docks-pilot.geojson — each detected dock's footprint polygon
(`kind: "shape"`) plus a click point at its shore end (`kind: "point"`), with model
confidence, area, length, the waterfront parcel at the shore end and the permit match.
Prints recall against OSM docks and WDFW dock points inside the pilot area.
"""
import argparse, json, math, re
from shapely.geometry import Polygon, Point, mapping, shape, box
from shapely.ops import unary_union, transform, nearest_points
from shapely.strtree import STRtree
from shapely.validation import make_valid
from ultralytics import YOLO

ROOT = 'data/sanjuan-docks/ml'
OUT = 'data/sanjuan-docks/ml/ml-docks-pilot.geojson'  # internal pilot output — never in public/
R = 6378137.0
MATCH_M = 40

ap = argparse.ArgumentParser()
ap.add_argument('--conf', type=float, default=0.35)
ap.add_argument('--weights', default=f'{ROOT}/runs/pilot/weights/best.pt')
ap.add_argument('--device', default='mps')  # cpu while training holds the GPU
ap.add_argument('--set', default='pilot', help="tile set(s), comma-separated: 'pilot' and/or prepare_test_area.py names; the first names the area scored")
ap.add_argument('--out', default=None)
args = ap.parse_args()


def merc2ll(x, y, z=None):
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


M_LAT, M_LNG = 111320.0, 111320.0 * 0.6626


def metres(a, b):
    return math.hypot((a.x - b.x) * M_LNG, (a.y - b.y) * M_LAT)


manifest = json.load(open(f'{ROOT}/manifest.json'))
SETS = args.set.split(',')
pilot = [t for t in manifest['tiles'] if t['set'] in SETS]
AREA_BBOX = manifest['pilot_bbox'] if SETS[0] == 'pilot' else manifest['test_areas'][SETS[0]]
OUT = args.out or (OUT if args.set == 'pilot' else f'{ROOT}/detections-{SETS[0]}.geojson')
# Tiles the model trained on (original set; reviewed tiles are pilot_ and only count for 'pilot').
train_boxes = [box(*t['bbox']) for t in manifest['tiles'] if t['set'] in ('train', 'negative')]
px = manifest['px']
model = YOLO(args.weights)

# ─── Detect, tile by tile → polygons in lon/lat ──────────────────────────────
raw = []
for n_t, t in enumerate(pilot):
    if (n_t + 1) % 500 == 0:
        print(f'  {n_t + 1}/{len(pilot)} tiles', flush=True)
    res = model.predict(f"{ROOT}/images/{t['id']}.jpg", conf=args.conf, imgsz=px, device=args.device, verbose=False, retina_masks=True)[0]
    if res.masks is None:
        continue
    minx, miny, maxx, maxy = t['bbox']
    for poly_px, conf in zip(res.masks.xy, res.boxes.conf.tolist()):
        if len(poly_px) < 3:
            continue
        pts = [(minx + u / px * (maxx - minx), maxy - v / px * (maxy - miny)) for u, v in poly_px]
        g = make_valid(transform(merc2ll, Polygon(pts)))
        if not g.is_empty:
            raw.append((g, conf))
print(f'{len(raw)} raw detections in {len(pilot)} pilot tiles')

# Overlapping tiles see the same dock: merge detections that overlap / touch within ~1 m.
merged = []
for g in unary_union([g.buffer(0.00001) for g, _ in raw]).geoms if raw else []:
    confs = [c for r, c in raw if r.intersects(g)]
    merged.append((g.buffer(-0.00001), max(confs), len(confs)))
docks = [(g, c, n) for g, c, n in merged if not g.is_empty]

# ─── Shore end, parcel, permit match ─────────────────────────────────────────
land = unary_union([make_valid(shape(f['geometry'])) for f in json.load(open(f'{ROOT}/shorelines.geojson'))['features'] if f.get('geometry')])
coast = land.boundary
# A dock reaches out over the water; a detection wholly on land is a road or a roof
# (pilot run 2026-10-05: all 9 such were false, every known dock found was >15% water).
WATER_MIN = 0.15
before = len(docks)
docks = [(g, c, n) for g, c, n in docks if g.area and 1 - g.intersection(land).area / g.area >= WATER_MIN]
print(f'{before - len(docks)} detections dropped as entirely on land; {len(docks)} kept')
parcels = [f for f in json.load(open('data/sanjuan-docks/waterfront-parcels.geojson'))['features'] if f.get('geometry')]
pgeoms = [shape(f['geometry']) for f in parcels]
ptree = STRtree(pgeoms)
sites = json.load(open('public/hpa/san-juan-docks.geojson'))['features']
site_by_parcel, wdfw = {}, []
for s in sites:
    for p in s['properties']['permits']:
        for d in re.findall(r'\d{9,12}', str(p.get('parcel_number') or '')):
            site_by_parcel.setdefault(d[:9], s['properties']['site_id'])
        if p['source'].startswith('WDFW') and p.get('longitude') is not None:
            wdfw.append((Point(p['longitude'], p['latitude']), s['properties']['site_id']))
# Every known dock placed precisely (OSM tracing, Friends survey point, WDFW permit
# location) — parcel points are the lot, not the dock, so they can't score a detection.
PRECISE = ('osm', 'friends', 'wdfw_permit', 'aerial')  # aerial: earlier reviewer-confirmed finds
known = [(shape(f['geometry']), f['properties']['facility_id'], f['properties']['located_by'])
         for f in json.load(open('public/hpa/dock-locations.geojson'))['features']
         if f['properties']['kind'] == 'point' and f['properties']['located_by'] in PRECISE]
pilot_box = box(*AREA_BBOX)

features, counts = [], {'permit_parcel': 0, 'near_wdfw_point': 0, 'no_permit_found': 0, 'no_parcel': 0}
for k, (g, conf, n_tiles) in enumerate(sorted(docks, key=lambda d: -d[1])):
    shore = nearest_points(g, coast)[0]
    i = ptree.nearest(shore)
    pdist = 0.0 if pgeoms[i].contains(shore) else metres(shore, nearest_points(pgeoms[i], shore)[0])
    pin = parcels[i]['properties']['PIN'] if pdist <= MATCH_M else None
    site = site_by_parcel.get(pin[:9]) if pin else None
    match = 'permit_parcel' if site else None
    if not site:
        near = sorted((metres(shore, w), sid) for w, sid in wdfw if metres(shore, w) <= MATCH_M)
        if near:
            site, match = near[0][1], 'near_wdfw_point'
    match = match or ('no_permit_found' if pin else 'no_parcel')
    counts[match] += 1
    known_near = sorted((metres(shore, p), fid) for p, fid, _ in known if metres(shore, p) <= MATCH_M)
    rect = g.minimum_rotated_rectangle
    edges = [metres(Point(rect.exterior.coords[j]), Point(rect.exterior.coords[j + 1])) for j in range(2)] if rect.geom_type == 'Polygon' else [0, 0]
    props = {
        'detection_id': f'ml{k + 1:04d}',
        'model_confidence': round(conf, 3),
        'tiles_seen_in': n_tiles,
        'area_m2': round(g.area * M_LAT * M_LNG, 1),
        'length_m': round(max(edges), 1),
        'parcel_number': pin,
        'parcel_distance_m': round(pdist, 1),
        'permit_match': match,
        'permit_site_id': site,
        'known_dock_id': known_near[0][1] if known_near else None,  # None = possibly a dock no source has
        'source': 'EarthAtlas dock-detection pilot (YOLO11-seg) on San Juan County 2025 aerials (EagleView)',
    }
    features.append({'type': 'Feature', 'geometry': mapping(g), 'properties': {**props, 'kind': 'shape'}})
    features.append({'type': 'Feature', 'geometry': mapping(shore), 'properties': {**props, 'kind': 'point'}})

# ─── Score against what we know inside the pilot area ────────────────────────
det_shapes = [g for g, _, _ in docks]
def found(pt):
    return any(g.distance(pt) * M_LNG <= 20 for g in det_shapes)
known_in = [(p, fid, by) for p, fid, by in known if pilot_box.contains(p)]
def ll2merc_pt(p):
    return Point(R * math.radians(p.x), R * math.log(math.tan(math.pi / 4 + math.radians(p.y) / 2)))
# Fair score: only known docks no training photo showed the model.
unseen = [(p, fid, by) for p, fid, by in known_in if not any(b.contains(ll2merc_pt(p)) for b in train_boxes)]
score = {'detections': len(docks), 'tiles': len(pilot),
         'known_found': f"{sum(found(p) for p, _, _ in known_in)}/{len(known_in)}",
         'unseen_known_found': f"{sum(found(p) for p, _, _ in unseen)}/{len(unseen)}"}
for by in PRECISE:
    pts = [p for p, _, b in known_in if b == by]
    score[f'known_{by}_in_pilot'] = len(pts)
    score[f'known_{by}_found'] = sum(found(p) for p in pts)
score['detections_matching_known_dock'] = sum(1 for f in features if f['properties']['kind'] == 'point' and f['properties']['known_dock_id'])
score['detections_unknown'] = score['detections'] - score['detections_matching_known_dock']
score['match_counts'] = counts
json.dump({'type': 'FeatureCollection', 'metadata': {'set': SETS[0], 'sets': SETS, 'area_bbox': AREA_BBOX, 'conf': args.conf, 'score': score},
           'features': features}, open(OUT, 'w'))
print(json.dumps(score, indent=1))
print(f'→ {OUT}')
