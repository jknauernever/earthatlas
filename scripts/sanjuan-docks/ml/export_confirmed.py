#!/usr/bin/env python3
"""Export docks found in the 2025 county aerials and confirmed by a reviewer — the
fourth source for scripts/sanjuan-docks/bake-dock-locations.py.

    python3 scripts/sanjuan-docks/ml/export_confirmed.py

A confirmed dock is (a) a model detection the reviewer marked ✓ that matched no known
dock when detected, or (b) a dock the reviewer drew more than 25 m from any known dock.
A drawn dock within 15 m of a (a) detection is the same dock (the detection keeps it).
Reads every review round's detections (review/*detections.geojson) and
review/labels.json; writes data/sanjuan-docks/aerial-docks.geojson.
"""
import glob, json, math
from shapely.geometry import shape, mapping, LineString, Point
from shapely.validation import make_valid

ROOT = 'data/sanjuan-docks/ml'
OUT = 'data/sanjuan-docks/aerial-docks.geojson'
NEW_M = 25
SAME_M = 15
M_LNG, M_LAT = 111320 * math.cos(math.radians(48.55)), 111320.0
deg = lambda m: m / M_LNG

labels = json.load(open(f'{ROOT}/review/labels.json'))
reviewed_on = labels.get('saved_at', '')[:10]
known = [shape(f['geometry']) for f in json.load(open('public/hpa/dock-locations.geojson'))['features']
         if f['properties']['located_by'] in ('osm', 'friends', 'wdfw_permit')]

out = []
for fn in sorted(glob.glob(f'{ROOT}/review/*detections.geojson')):
    fc = json.load(open(fn))
    area = fc['metadata'].get('set', 'pilot')
    for f in fc['features']:
        p = f['properties']
        if p['kind'] != 'shape' or p['known_dock_id'] or labels['det'].get(p['detection_id']) != 'yes':
            continue
        out.append({'geom': make_valid(shape(f['geometry'])), 'props': {
            'aerial_id': f"aerial-{p['detection_id'] if '-' in p['detection_id'] else area + '-' + p['detection_id']}",
            'found_by': 'model detection, confirmed by reviewer',
            'model_confidence': p['model_confidence'], 'length_m': p['length_m'], 'area_m2': p['area_m2'], 'test_area': area}})
# Every drawn dock: new ones, and ones drawn at a known dock that only had a point —
# bake-dock-locations.py decides (OSM-traced: skipped; Friends point: its outline;
# else a dock of its own that picks up its parcel's permits).
for d in labels.get('drawn', []):
    ln = LineString(d['coords'])
    if any(ln.distance(o['geom']) <= deg(SAME_M) for o in out):
        continue
    length = sum(math.hypot((a[0] - b[0]) * M_LNG, (a[1] - b[1]) * M_LAT) for a, b in zip(d['coords'], d['coords'][1:]))
    out.append({'geom': ln, 'props': {
        'aerial_id': f"aerial-{d['id']}",
        'found_by': 'added by reviewer on the dock map' if d.get('source') == 'map' else 'drawn by reviewer on the aerial photo',
        'at_known_dock': any(ln.distance(k) <= deg(NEW_M) for k in known),
        'model_confidence': None, 'length_m': round(length, 1), 'area_m2': None, 'test_area': (d.get('tile') or 'map').split('_')[0]}})

# Known docks the reviewer checked on the 2025 photo and found NOT there (✗ "No dock
# here"): kept as historical records, flagged absent in 2025.
absent = sorted(k for k, v in labels.get('known', {}).items() if v == 'no')
json.dump({'reviewed_on': reviewed_on, 'facility_ids': absent}, open('data/sanjuan-docks/aerial-absent.json', 'w'), indent=1)
print(f'{len(absent)} known docks marked not visible in the 2025 aerials')

src = 'San Juan County 2025 aerials (EagleView), dock found by the EarthAtlas dock-detection pilot and confirmed by a reviewer'
json.dump({'type': 'FeatureCollection',
           'metadata': {'source': src, 'reviewed_on': reviewed_on, 'count': len(out),
                        'imagery': 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer'},
           'features': [{'type': 'Feature', 'geometry': mapping(o['geom']), 'properties': {**o['props'], 'source': src}} for o in out]},
          open(OUT, 'w'))
print(f"{len(out)} confirmed aerial docks → {OUT}:",
      sum(o['props']['found_by'].startswith('model') for o in out), 'model detections,',
      sum(o['props']['found_by'].startswith('drawn') for o in out), 'drawn')
