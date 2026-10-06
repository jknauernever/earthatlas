#!/usr/bin/env python3
"""Dock-footprint pilot: plan and fetch image tiles + training labels.

    python3 scripts/sanjuan-docks/ml/prepare_pilot.py            # plan only: prints tile counts
    python3 scripts/sanjuan-docks/ml/prepare_pilot.py --fetch    # download tiles, write labels

Imagery: San Juan County 2025 orthophotos (EagleView), rendered by the county's
ArcGIS export endpoint as 640 × 640 px JPEGs at 0.15 m/px (96 m squares).

  * PILOT area (Deer Harbor – West Sound, Orcas): one tile centred every 72 m along
    the shoreline — catches docks up to ~50 m long whole. Never used for training:
    the model is scored here against OSM docks + permit points.
  * TRAIN crops: one tile centred on each OpenStreetMap dock outside the pilot area
    (de-duplicated within 40 m), labelled with every OSM dock shape in the tile
    (lines buffered to a deck width: the OSM `width` tag, else 2.5 m), plus shoreline
    tiles with no OSM dock within 60 m as negatives. Labels are YOLO-seg polygons.

Everything lands in data/sanjuan-docks/ml/ (tiles cached; re-runs only fetch what's
missing). Each tile's Web-Mercator bbox is in manifest.json so detections can be
turned back into map coordinates.
"""
import json, math, os, random, sys, time, urllib.parse, urllib.request
from shapely.geometry import shape, box, Point, LineString, Polygon, MultiPolygon
from shapely.ops import unary_union, transform
from shapely.validation import make_valid

ROOT = 'data/sanjuan-docks/ml'
EXPORT = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer/export'
SHORELINES = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Polaris/Shorelines/MapServer/0'
OSM_DOCKS = 'public/hpa/dock-locations.geojson'  # only its OSM `shape` features are used
PILOT_BBOX = (-123.015, 48.605, -122.95, 48.64)  # lon/lat: Deer Harbor + West Sound, Orcas (~21 km of shore)
PX = 640
GSD = 0.15                     # ground metres per pixel
TILE_M = PX * GSD              # 96 m ground
COAST_STEP_M = 72              # pilot: one tile centred every 72 m along the shoreline (25% overlap)
DEDUPE_M = 40
NEG_CLEAR_M = 60
N_NEGATIVES = 120
UA = {'User-Agent': 'earthatlas.org dock research (josh@knauernever.com)'}
R = 6378137.0


def to_merc(lon, lat):
    return R * math.radians(lon), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def merc_scale(lat):  # Web-Mercator units per ground metre
    return 1 / math.cos(math.radians(lat))


def ll2m(geom):
    return transform(lambda x, y, z=None: to_merc(x, y), geom)


def get_json(url, data=None):
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=120) as r:
        return json.load(r)


def tile_bbox(cx, cy, lat):
    h = TILE_M * merc_scale(lat) / 2
    return (cx - h, cy - h, cx + h, cy + h)


# ─── Shoreline (land polygons → coastline) ───────────────────────────────────
def coastline():
    cache = f'{ROOT}/shorelines.geojson'
    if not os.path.exists(cache):
        ids = get_json(f"{SHORELINES}/query?{urllib.parse.urlencode({'where': '1=1', 'returnIdsOnly': 'true', 'f': 'json'})}")['objectIds']
        feats = []
        # Small chunks, simplified to ~1 m (0.00001°): full-detail island outlines 500 the server.
        for i in range(0, len(ids), 25):
            q = urllib.parse.urlencode({'objectIds': ','.join(map(str, ids[i:i + 25])), 'outFields': 'Island', 'outSR': 4326,
                                        'maxAllowableOffset': 0.00001, 'f': 'geojson'})
            feats += get_json(f'{SHORELINES}/query', q.encode())['features']
        json.dump({'type': 'FeatureCollection', 'features': feats}, open(cache, 'w'))
    # Simplified outlines can self-touch: repair each before merging.
    land = unary_union([make_valid(shape(f['geometry'])) for f in json.load(open(cache))['features'] if f.get('geometry')])
    return land.boundary  # lon/lat lines


# ─── OSM dock shapes (metres-ish polygons in Web Mercator) ────────────────────
def osm_shapes():
    out = []
    for f in json.load(open(OSM_DOCKS))['features']:
        p = f['properties']
        if p['kind'] != 'shape':
            continue
        g = shape(f['geometry'])
        lat = g.centroid.y
        gm = ll2m(g)
        if isinstance(g, LineString):
            try:
                width = float(str(p['osm_tags'].get('width', '2.5')).split()[0])
            except ValueError:
                width = 2.5
            gm = gm.buffer(width / 2 * merc_scale(lat), cap_style=2)
        out.append({'geom_ll': g, 'geom_m': gm, 'lat': lat, 'id': p['osm_id']})
    return out


def plan():
    os.makedirs(ROOT, exist_ok=True)
    coast = coastline()
    docks = osm_shapes()
    pilot_ll = box(*PILOT_BBOX)
    tiles = []

    # Pilot: tiles centred along the shoreline.
    coast_pilot = coast.intersection(pilot_ll)
    flat = lambda g: [x for sub in getattr(g, 'geoms', [g]) for x in (flat(sub) if hasattr(sub, 'geoms') else [sub])]
    for part in (g for g in flat(coast_pilot) if isinstance(g, LineString)):
        lat = part.centroid.y
        part_m = ll2m(part)
        n = max(1, int(part_m.length / (COAST_STEP_M * merc_scale(lat))))
        for k in range(n + 1):
            c = part_m.interpolate(k / n, normalized=True)
            tiles.append({'set': 'pilot', 'bbox': tile_bbox(c.x, c.y, lat)})

    # Training crops centred on OSM docks outside the pilot area.
    centres = []
    for d in docks:
        if pilot_ll.buffer(0.005).intersects(d['geom_ll']):
            continue
        c = d['geom_m'].centroid
        if all(math.hypot(c.x - o.x, c.y - o.y) > DEDUPE_M * merc_scale(d['lat']) for o in centres):
            centres.append(c)
            tiles.append({'set': 'train', 'bbox': tile_bbox(c.x, c.y, d['lat'])})

    # Negatives: shoreline points outside the pilot with no OSM dock nearby.
    random.seed(7)
    coast_out = coast.difference(pilot_ll.buffer(0.01))
    dock_union = unary_union([d['geom_m'] for d in docks])
    tries = 0
    negs = 0
    while negs < N_NEGATIVES and tries < 5000:
        tries += 1
        pt = coast_out.interpolate(random.random(), normalized=True)
        pm = Point(*to_merc(pt.x, pt.y))
        if dock_union.distance(pm) < NEG_CLEAR_M * merc_scale(pt.y):
            continue
        tiles.append({'set': 'negative', 'bbox': tile_bbox(pm.x, pm.y, pt.y)})
        negs += 1

    for i, t in enumerate(tiles):
        t['id'] = f"{t['set']}_{i:05d}"
    return tiles, docks


def yolo_label(tile, docks):
    """Every OSM dock polygon in the tile, clipped, as normalised YOLO-seg rows."""
    minx, miny, maxx, maxy = tile['bbox']
    tb = box(minx, miny, maxx, maxy)
    rows = []
    for d in docks:
        if not d['geom_m'].intersects(tb):
            continue
        clip = d['geom_m'].intersection(tb)
        polys = list(clip.geoms) if isinstance(clip, MultiPolygon) else [clip] if isinstance(clip, Polygon) else []
        for poly in polys:
            if poly.area < (1.0 * merc_scale(d['lat'])) ** 2:  # under ~1 m² of dock: skip slivers at the edge
                continue
            pts = [((x - minx) / (maxx - minx), (maxy - y) / (maxy - miny)) for x, y in poly.exterior.coords[:-1]]
            rows.append('0 ' + ' '.join(f'{min(max(u, 0), 1):.5f} {min(max(v, 0), 1):.5f}' for u, v in pts))
    return rows


def fetch(tile):
    path = f"{ROOT}/images/{tile['id']}.jpg"
    if os.path.exists(path):
        return False
    q = urllib.parse.urlencode({'bbox': ','.join(f'{v:.2f}' for v in tile['bbox']), 'bboxSR': 3857, 'imageSR': 3857,
                                'size': f'{PX},{PX}', 'format': 'jpg', 'transparent': 'false', 'f': 'image'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'{EXPORT}?{q}', headers=UA), timeout=60) as r:
                data = r.read()
            if data[:2] != b'\xff\xd8':
                raise ValueError('not a JPEG')
            open(path, 'wb').write(data)
            return True
        except Exception as e:  # noqa: BLE001 — retry, then report
            if attempt == 2:
                print(f"  {tile['id']}: {e}")
            time.sleep(2 * (attempt + 1))
    return False


if __name__ == '__main__':
    tiles, docks = plan()
    counts = {s: sum(1 for t in tiles if t['set'] == s) for s in ('pilot', 'train', 'negative')}
    print(f'tiles planned: {counts} — total {len(tiles)}')
    json.dump({'px': PX, 'gsd_m': GSD, 'pilot_bbox': PILOT_BBOX, 'tiles': tiles}, open(f'{ROOT}/manifest.json', 'w'))
    if '--fetch' not in sys.argv:
        sys.exit(0)
    os.makedirs(f'{ROOT}/images', exist_ok=True)
    os.makedirs(f'{ROOT}/labels', exist_ok=True)
    t0, n = time.time(), 0
    for i, t in enumerate(tiles):
        n += fetch(t)
        if t['set'] != 'pilot':  # pilot tiles stay unlabelled: they're the test
            open(f"{ROOT}/labels/{t['id']}.txt", 'w').write('\n'.join(yolo_label(t, docks)))
        if (i + 1) % 50 == 0:
            print(f'  {i + 1}/{len(tiles)} ({n} fetched, {time.time() - t0:.0f} s)')
    print(f'done: {n} tiles fetched in {time.time() - t0:.0f} s')
