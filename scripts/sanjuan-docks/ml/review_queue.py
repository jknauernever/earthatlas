#!/usr/bin/env python3
"""Pick the pilot photos worth a human look, most informative first, for the
/sanjuan-docks/review page — instead of all 377.

    python3 scripts/sanjuan-docks/ml/review_queue.py [--empty-sample 25]
    python3 scripts/sanjuan-docks/ml/review_queue.py --set westcott --detections data/sanjuan-docks/ml/detections-westcott.geojson

For a new set, its detections are copied to review/detections.geojson with ids
prefixed '<set>-' (each run numbers from ml0001; the prefix keeps earlier answers
attached to the right shapes) — the previous round's queue/detections are archived first.

Each item is shown once, on the tile where it sits most centrally:
  1. unknown   — a detection matching no known dock (new dock, or false alarm?)
  2. missed    — a precisely located known dock (OSM / Friends / WDFW) with no detection
  3. unsure    — a detection on a known dock but under 50% model confidence
  4. empty     — a random sample of tiles with neither (docks nobody has?)
Skipped: confident detections on known docks, and the rest of the empty shore.
Writes review/queue.json (with the area bbox, for the review page).
"""
import argparse, json, math, os, random
from shapely.geometry import shape, box, Point

ROOT = 'data/sanjuan-docks/ml'
R = 6378137.0
ap = argparse.ArgumentParser()
ap.add_argument('--empty-sample', type=int, default=25)
ap.add_argument('--set', default='pilot', help='tile set(s), comma-separated; the first names the area')
ap.add_argument('--kinds', default='unknown,missed,unsure,empty', help='which questions to ask (county run: unknown,missed,empty)')
ap.add_argument('--detections', default=None, help='a detect.py output to review (default: the current review/detections.geojson)')
args = ap.parse_args()


def merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


manifest = json.load(open(f'{ROOT}/manifest.json'))
SETS = args.set.split(',')
tiles = [t for t in manifest['tiles'] if t['set'] in SETS]
area = manifest['pilot_bbox'] if SETS[0] == 'pilot' else manifest['test_areas'][SETS[0]]
KINDS = set(args.kinds.split(','))
pilot_box = box(*area)
if args.detections:
    import os, shutil
    for fn in ('queue.json', 'detections.geojson'):  # archive the previous round
        if os.path.exists(f'{ROOT}/review/{fn}'):
            old = json.load(open(f'{ROOT}/review/queue.json')).get('set', 'pilot') if os.path.exists(f'{ROOT}/review/queue.json') else 'prev'
            shutil.copy(f'{ROOT}/review/{fn}', f'{ROOT}/review/{old}-{fn}')
    fc = json.load(open(args.detections))
    if SETS[0] != 'pilot':
        for f in fc['features']:
            f['properties']['detection_id'] = f"{SETS[0]}-{f['properties']['detection_id']}"
    json.dump(fc, open(f'{ROOT}/review/detections.geojson', 'w'))
dets = [f for f in json.load(open(f'{ROOT}/review/detections.geojson'))['features'] if f['properties']['kind'] == 'shape']
known = [f for f in json.load(open('public/hpa/dock-locations.geojson'))['features']
         if f['properties']['kind'] == 'point' and f['properties']['located_by'] in ('osm', 'friends', 'wdfw_permit')
         and pilot_box.contains(shape(f['geometry']))]


def best_tile(lon, lat):
    x, y = merc(lon, lat)
    t = min(tiles, key=lambda t: max(abs(x - (t['bbox'][0] + t['bbox'][2]) / 2), abs(y - (t['bbox'][1] + t['bbox'][3]) / 2)))
    return t['id']


M_LNG, M_LAT = 111320 * math.cos(math.radians(48.6)), 111320
det_geoms = [shape(f['geometry']) for f in dets]
items = []
for f, g in zip(dets, det_geoms):
    p = f['properties']
    c = g.centroid
    if not p['known_dock_id']:
        items.append({'kind': 'unknown', 'tile': best_tile(c.x, c.y), 'ref': p['detection_id'], 'conf': p['model_confidence']})
    elif p['model_confidence'] < 0.5:
        items.append({'kind': 'unsure', 'tile': best_tile(c.x, c.y), 'ref': p['detection_id'], 'conf': p['model_confidence']})
for f in known:
    pt = shape(f['geometry'])
    if not any(g.distance(pt) * M_LNG <= 20 for g in det_geoms):
        items.append({'kind': 'missed', 'tile': best_tile(pt.x, pt.y), 'ref': f['properties']['facility_id'], 'located_by': f['properties']['located_by']})
busy = {i['tile'] for i in items}
# Tiles touched by any detection or known dock aren't "empty".
def touches(t, pts):
    x0, y0, x1, y1 = t['bbox']
    return any(x0 <= x <= x1 and y0 <= y <= y1 for x, y in pts)
pts = [merc(g.centroid.x, g.centroid.y) for g in det_geoms] + [merc(*f['geometry']['coordinates']) for f in known]
empty = [t['id'] for t in tiles if t['id'] not in busy and not touches(t, pts)]
random.seed(11)
for tid in random.sample(empty, min(args.empty_sample, len(empty))):
    items.append({'kind': 'empty', 'tile': tid})

order = {'unknown': 0, 'missed': 1, 'unsure': 2, 'empty': 3}
items = [i for i in items if i['kind'] in KINDS]
# Never ask again about a photo already answered in an earlier round.
_done = json.load(open(f'{ROOT}/review/labels.json')).get('reviewed', {}) if os.path.exists(f'{ROOT}/review/labels.json') else {}
items = [i for i in items if i['tile'] not in _done]
queue, seen = [], set()
for it in sorted(items, key=lambda i: order[i['kind']]):
    if it['tile'] in seen:
        next(q for q in queue if q['tile'] == it['tile'])['reasons'].append(it)
        continue
    seen.add(it['tile'])
    queue.append({'tile': it['tile'], 'kind': it['kind'], 'reasons': [it]})
json.dump({'set': SETS[0], 'area_bbox': area, 'queue': queue, 'counts': {k: sum(1 for i in items if i['kind'] == k) for k in order},
           'skipped_tiles': len(tiles) - len(queue)}, open(f'{ROOT}/review/queue.json', 'w'), indent=1)
print({k: sum(1 for i in items if i['kind'] == k) for k in order}, '→', len(queue), 'photos to review of', len(tiles))
