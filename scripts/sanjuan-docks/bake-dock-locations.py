#!/usr/bin/env python3
"""Bake where San Juan County's docks are — OpenStreetMap tracings plus the Friends of
the San Juans shoreline survey — and match each dock to the permit map.

    python3 scripts/sanjuan-docks/bake-dock-locations.py [--refresh-osm]

The Overpass response is cached in data/sanjuan-docks/osm-piers.json; --refresh-osm
fetches it again.

1. OSM: every way tagged man_made=pier inside the San Juan County boundary
   (relation 1162038 — the islands' bbox also takes in Canadian Gulf Islands).
2. County waterfront tax parcels (WF_LGTH > 0, ~4,950) from the county's
   OpenData/Parcels layer — cached in data/sanjuan-docks/waterfront-parcels.geojson.
3. Marinas are traced float by float (Friday Harbor's A–K docks) and only the walkway
   reaches shore, so ways touching within 5 m form one dock/facility. For each, its
   shore end (the vertex nearest a waterfront parcel), the parcel there (within 40 m),
   and whether the permit map (public/hpa/san-juan-docks.geojson) has permits on that
   parcel or a WDFW dock point within 40 m.
4. Neighbouring parcel: a dock still unmatched whose parcel touches the parcel of a
   permit site still unmatched — kept only when it is one-to-one (that dock has no
   other such site, that site no other such dock), and labelled as the weaker match.
5. Friends of the San Juans dock survey (2008–2009, 474 GPS points; a read-only copy of
   Salish Sea Explorer's public/data/friends-docks.geojson in data/sanjuan-docks/). A
   point within 20 m of an OSM dock is that dock's survey record. So is one up to 60 m
   away on the same waterfront parcel, when that OSM dock has no survey record yet and
   it's one-to-one (GPS fixes sometimes landed on the house behind the dock). The rest
   are docks OSM hasn't traced, located by the survey point alone and matched like OSM
   docks.
6. Docks found in the 2025 county aerials and confirmed by a reviewer
   (data/sanjuan-docks/aerial-docks.geojson, from scripts/sanjuan-docks/ml/export_confirmed.py):
   the model's outline or the reviewer's drawn line, matched like OSM docks. One within
   20 m of an OSM or Friends dock is that dock already, and is skipped.
8. Every dock's parcel, from the full county parcel layer (19k parcels; read-only
   copy of Salish Sea Explorer's Tax_Parcels.geojson in data/sanjuan-docks/), with
   `parcel_method`: shore_end (the waterfront parcel at the dock's shore end, as used
   for permit matching), permit_record (a permit-only dock: its permits' parcel), or
   nearest_parcel (any parcel within 60 m). Plus the county address(es) on it.
10. Water: a parcel-point dock (approximate — the parcel's own point is mid-lot) moves
   to where its parcel meets the nearest water (the marine shore or a lake); and any
   dock on a lake or pond (OSM natural=water, not a lagoon, cached in
   data/sanjuan-docks/osm-water.json) more than 30 m from salt water is labelled
   `waterbody: lake/pond` with the lake's name — still a dock, just not a marine one.
7. Permit sites still without a located dock become docks of their own, at the permit
   map's point: a WDFW permit's dock location, else the county parcel point (the
   lot, not the shore — approximate). So every known dock, from any source, is here.

Output: public/hpa/dock-locations.geojson — each OSM way's traced shape (`kind: "shape"`)
plus one `kind: "point"` click target per dock/facility: an OSM dock's shore end, or a
Friends-only dock's survey point, or a permit-only dock's permit point. `located_by`
(osm | friends | aerial | wdfw_permit | parcel_point) says which; `friends_survey` carries the
survey records. OSM data © OpenStreetMap contributors, ODbL.
"""
import json, os, re, sys, urllib.parse, urllib.request
from shapely.geometry import shape, mapping, Point, LineString, Polygon
from shapely.ops import nearest_points
from shapely.strtree import STRtree

OVERPASS = 'https://overpass-api.de/api/interpreter'
COUNTY_AREA = 3600000000 + 1162038  # Overpass area id for OSM relation 1162038
PARCELS = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/OpenData/Parcels/MapServer/1'
PARCEL_CACHE = 'data/sanjuan-docks/waterfront-parcels.geojson'
PERMITS = 'public/hpa/san-juan-docks.geojson'
OSM_CACHE = 'data/sanjuan-docks/osm-piers.json'
FRIENDS = 'data/sanjuan-docks/friends-docks.geojson'
AERIAL = 'data/sanjuan-docks/aerial-docks.geojson'
ALL_PARCELS = 'data/sanjuan-docks/tax-parcels.geojson'   # San Juan County GIS tax parcels (all)
ADDRESSES = 'data/sanjuan-docks/address-lookup.json'      # county address points by parcel
NEAREST_PARCEL_M = 60
MARINE_LAND = 'data/sanjuan-docks/ml/shorelines.geojson'  # county land polygons (marine shoreline)
OSM_WATER = 'data/sanjuan-docks/osm-water.json'            # Overpass natural=water in the county
LAKE_NEAR_M, SALT_CLEAR_M, SNAP_MAX_M = 15, 30, 300
INLAND_M = 100  # a dock found in the water (OSM / Friends / aerial) this far inland is on fresh water, mapped lake or not
OUT = 'public/hpa/dock-locations.geojson'
FRIENDS_SAME_M = 20  # Friends point → OSM dock: 236 of 474 within 20 m, few more out to 50 m
FRIENDS_PARCEL_M = 60  # …or this far on the same parcel, one-to-one
OUTLINE_TO_POINT_M = 30  # an aerial outline this close to a Friends survey point is that dock's shape
MATCH_M = 40
NEIGHBOUR_M = 2  # parcels this close count as touching (survey slivers)
TOUCH_M = 5
FLOAT_JOIN_M = 25  # an offshore piece (no parcel within MATCH_M) joins a shore-reaching dock this close
UA = {'User-Agent': 'earthatlas.org dock research (josh@knauernever.com)'}

M_PER_DEG_LAT = 111320.0
M_PER_DEG_LNG = 111320.0 * 0.6626  # cos(48.5°) — fine for distances inside the county


def metres(a, b):
    return ((a.x - b.x) ** 2 * M_PER_DEG_LNG ** 2 + (a.y - b.y) ** 2 * M_PER_DEG_LAT ** 2) ** 0.5


def get_json(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


# ─── 1. OSM docks ───────────────────────────────────────────────────────────
q = f'[out:json][timeout:90];area({COUNTY_AREA})->.c;way["man_made"="pier"](area.c);out tags geom;'
if '--refresh-osm' in sys.argv or not os.path.exists(OSM_CACHE):
    os.makedirs(os.path.dirname(OSM_CACHE), exist_ok=True)
    json.dump(get_json(OVERPASS, urllib.parse.urlencode({'data': q}).encode()), open(OSM_CACHE, 'w'))
osm = json.load(open(OSM_CACHE))['elements']
docks = []
for w in osm:
    coords = [(p['lon'], p['lat']) for p in w.get('geometry', [])]
    if len(coords) < 2:
        continue
    closed = coords[0] == coords[-1] and len(coords) >= 4
    geom = Polygon(coords) if closed and w['tags'].get('area') != 'no' else LineString(coords)
    docks.append({'id': w['id'], 'tags': w['tags'], 'geom': geom})
print(f'OSM: {len(docks)} docks/piers in San Juan County')

# ─── 2. Waterfront parcels (cached) ──────────────────────────────────────────
if not os.path.exists(PARCEL_CACHE):
    # County map services reject paging, so fetch the object ids first, then chunks of them.
    ids = get_json(f"{PARCELS}/query?{urllib.parse.urlencode({'where': 'WF_LGTH > 0', 'returnIdsOnly': 'true', 'f': 'json'})}")['objectIds']
    feats = []
    for i in range(0, len(ids), 500):
        params = urllib.parse.urlencode({'objectIds': ','.join(map(str, ids[i:i + 500])), 'outFields': 'PIN,WF_LGTH,TidelandFt,Acres',
                                         'outSR': 4326, 'f': 'geojson'})
        feats += get_json(f'{PARCELS}/query', params.encode())['features']
    os.makedirs(os.path.dirname(PARCEL_CACHE), exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(PARCEL_CACHE, 'w'))
parcels = [f for f in json.load(open(PARCEL_CACHE))['features'] if f.get('geometry')]
pgeoms = [shape(f['geometry']) for f in parcels]
ptree = STRtree(pgeoms)
geoms_by_pin9 = {}
for f, g in zip(parcels, pgeoms):
    geoms_by_pin9.setdefault(f['properties']['PIN'][:9], []).append(g)
print(f'waterfront parcels: {len(parcels)}')

# ─── 3. Permit map: parcels with permits, WDFW dock points ───────────────────
sites = json.load(open(PERMITS))['features']
site_by_parcel, wdfw_points, site_pins, site_pt = {}, [], {}, {}
for s in sites:
    sid = s['properties']['site_id']
    site_pt[sid] = Point(s['geometry']['coordinates'])
    for p in s['properties']['permits']:
        for d in re.findall(r'\d{9,12}', str(p.get('parcel_number') or '')):
            site_by_parcel.setdefault(d[:9], sid)
            site_pins.setdefault(sid, set()).add(d[:9])
        if p['source'].startswith('WDFW') and p.get('longitude') is not None:
            wdfw_points.append((Point(p['longitude'], p['latitude']), s['properties']['site_id']))


def nearest_parcel(pt):
    i = ptree.nearest(pt)
    g = pgeoms[i]
    d = 0.0 if g.contains(pt) else metres(pt, nearest_points(g, pt)[0])
    return i, d


def vertices(g):
    return [Point(c) for c in (g.coords if isinstance(g, LineString) else g.exterior.coords)]


# ─── 4. Group touching ways into docks/facilities ────────────────────────────
touch_deg = TOUCH_M / M_PER_DEG_LNG
parent = list(range(len(docks)))


def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


dtree = STRtree([d['geom'] for d in docks])
for i, d in enumerate(docks):
    for j in dtree.query(d['geom'].buffer(touch_deg)):
        if j != i and d['geom'].distance(docks[j]['geom']) <= touch_deg:
            parent[find(i)] = find(j)
facilities = {}
for i in range(len(docks)):
    facilities.setdefault(find(i), []).append(i)

# Floats are often traced apart from their pier (the gangway between them isn't), so
# an offshore piece — no waterfront parcel within MATCH_M — joins the nearest
# shore-reaching dock within FLOAT_JOIN_M (Decatur's Hermitage Dock: float 20 m off).
reach = {root: min(nearest_parcel(e)[1] for i in members for e in vertices(docks[i]['geom'])) for root, members in facilities.items()}
float_deg = FLOAT_JOIN_M / M_PER_DEG_LNG
joined_floats = 0
for root, members in list(facilities.items()):
    if reach[root] <= MATCH_M:
        continue
    near = []
    for i in members:
        for j in dtree.query(docks[i]['geom'].buffer(float_deg)):
            rj = find(j)
            d = docks[i]['geom'].distance(docks[j]['geom'])
            if rj != root and reach.get(rj, 1e9) <= MATCH_M and d <= float_deg:
                near.append((d, rj))
    if near:
        parent[find(root)] = find(min(near)[1])
        joined_floats += 1
facilities = {}
for i in range(len(docks)):
    facilities.setdefault(find(i), []).append(i)
print(f'{joined_floats} offshore piece(s) joined to the dock they float off')

# ─── 4b. Friends survey: attach to the OSM dock it sits on, else a dock of its own ─
FRIENDS_FIELDS = ['OBJECTID', 'SurveyDateTime', 'Waypoint', 'RampOnly', 'Material', 'Grating', 'Creosote',
                  'PierHeight', 'FloatMaterial', 'GratingFloat', 'Condition']
friends = [f for f in json.load(open(FRIENDS))['features'] if f.get('geometry')]
fac_of_dock = {i: root for root, members in facilities.items() for i in members}
# Each OSM facility's shore end and the waterfront parcel there (reused in step 5).
fac_shore = {root: min(((e, *nearest_parcel(e)) for i in members for e in vertices(docks[i]['geom'])), key=lambda t: t[2])
             for root, members in facilities.items()}
fac_pin = {root: parcels[pi]['properties']['PIN'] for root, (_, pi, d) in fac_shore.items() if d <= MATCH_M}
survey_by_fac, friends_join, unjoined = {}, {}, []
for f in friends:
    pt = Point(f['geometry']['coordinates'])
    j = dtree.nearest(pt)
    rec = {k: f['properties'].get(k) for k in FRIENDS_FIELDS}
    d = metres(pt, nearest_points(docks[j]['geom'], pt)[0])
    if d <= FRIENDS_SAME_M:
        survey_by_fac.setdefault(fac_of_dock[j], []).append(rec)
        friends_join[fac_of_dock[j]] = {'method': 'within_20m', 'distance_m': round(d)}
    else:
        unjoined.append((pt, rec))
# Same parcel, one-to-one: an OSM dock with no survey record and a survey point on its
# parcel within 60 m, neither with another such candidate.
by_point, by_fac = {}, {}
parcel_deg = FRIENDS_PARCEL_M / M_PER_DEG_LNG
for k, (pt, rec) in enumerate(unjoined):
    i, pd = nearest_parcel(pt)
    pin = parcels[i]['properties']['PIN'] if pd <= MATCH_M else None
    if not pin:
        continue
    for j in dtree.query(pt.buffer(parcel_deg)):
        root = fac_of_dock[j]
        if root in survey_by_fac or fac_pin.get(root) != pin:
            continue
        d = metres(pt, nearest_points(docks[j]['geom'], pt)[0])
        if d <= FRIENDS_PARCEL_M:
            by_point.setdefault(k, {})[root] = min(d, by_point.get(k, {}).get(root, d))
            by_fac.setdefault(root, set()).add(k)
joined = set()
for k, roots in by_point.items():
    if len(roots) == 1:
        root, d = next(iter(roots.items()))
        if len(by_fac[root]) == 1:
            survey_by_fac[root] = [unjoined[k][1]]
            friends_join[root] = {'method': 'same_parcel', 'distance_m': round(d)}
            joined.add(k)
friends_only = [u for k, u in enumerate(unjoined) if k not in joined]
print(f'Friends survey: {len(friends)} docks — {len(friends) - len(unjoined)} within {FRIENDS_SAME_M} m of an OSM dock, '
      f'{len(joined)} on its parcel (one-to-one), {len(friends_only)} not in OSM')

# ─── 5. Match each facility: same parcel, then a WDFW dock point nearby ──────
cands = [{'members': members, 'survey': survey_by_fac.get(root, []), 'located_by': 'osm',
          'friends_join': friends_join.get(root), 'shore': fac_shore[root]}
         for root, members in facilities.items()]
cands += [{'members': [], 'survey': [rec], 'located_by': 'friends', 'friends_join': None, 'shore': (pt, *nearest_parcel(pt))}
          for pt, rec in friends_only]


def outline_vertices(g):
    # Model masks can come back as nested collections (make_valid): flatten fully.
    if hasattr(g, 'geoms'):
        return [v for part in g.geoms for v in outline_vertices(part)]
    if isinstance(g, (LineString, Point)):
        return [Point(c) for c in g.coords]
    return [Point(c) for c in g.exterior.coords] if not g.is_empty else []


# ─── 4c. Docks found in the 2025 aerials (reviewer-confirmed) ────────────────
aerial = json.load(open(AERIAL))['features'] if os.path.exists(AERIAL) else []
aerial_new = aerial_outlines = 0
friends_cands = [c for c in cands if c['located_by'] == 'friends']
for f in aerial:
    g = shape(f['geometry'])
    if any(metres(nearest_points(d['geom'], g)[0], nearest_points(g, d['geom'])[0]) <= FRIENDS_SAME_M
           for d in docks if d['geom'].distance(g) < 0.001):
        continue  # an OSM dock: already has its traced shape
    near = [(g.distance(c['shore'][0]), c) for c in friends_cands if not c.get('aerial') and g.distance(c['shore'][0]) < 0.001]
    near = [(d, c) for d, c in near if metres(nearest_points(g, c['shore'][0])[0], c['shore'][0]) <= OUTLINE_TO_POINT_M]
    if near:  # a Friends survey dock with only a point: the aerial outline is its shape
        c = min(near, key=lambda t: t[0])[1]
        c['aerial'] = f
        aerial_outlines += 1
        continue
    aerial_new += 1
    cands.append({'members': [], 'survey': [], 'located_by': 'aerial', 'friends_join': None, 'aerial': f,
                  'shore': min(((e, *nearest_parcel(e)) for e in outline_vertices(g)), key=lambda t: t[2])})
print(f'aerial: {len(aerial)} confirmed docks, {aerial_new} new, {aerial_outlines} gave a Friends survey dock its outline')
fac = []
for c in cands:
    members = c['members']
    shore, pi, pdist = c['shore']
    pin = parcels[pi]['properties']['PIN'] if pdist <= MATCH_M else None
    site = site_by_parcel.get(pin[:9]) if pin else None
    match = 'permit_parcel' if site else None
    if not site:
        near = [(metres(shore, wp), sid) for wp, sid in wdfw_points]
        near = [n for n in near if n[0] <= MATCH_M]
        if near:
            site, match = min(near)[1], 'near_wdfw_point'
    fac.append({'members': members, 'shore': shore, 'pi': pi, 'pdist': pdist, 'pin': pin, 'site': site,
                'match': match or ('no_permit_found' if pin else 'no_parcel'), 'survey': c['survey'], 'located_by': c['located_by'],
                'friends_join': c['friends_join'], 'aerial': c.get('aerial')})

# ─── 6. Neighbouring parcel, one-to-one only ────────────────────────────────
# A site's parcels: its permits' parcel numbers, or (WDFW point without one) the
# waterfront parcel under/next to that point.
claimed = {f['site'] for f in fac if f['site']}
near_deg = NEIGHBOUR_M / M_PER_DEG_LNG
site_parcels = {}
for sid, pt in site_pt.items():
    if sid in claimed:
        continue
    gs = [g for p9 in site_pins.get(sid, ()) for g in geoms_by_pin9.get(p9, [])]
    if not gs:
        i, d = nearest_parcel(pt)
        gs = [pgeoms[i]] if d <= MATCH_M else []
    if gs:
        site_parcels[sid] = gs
pair_by_fac, pair_by_site = {}, {}
for k, f in enumerate(fac):
    if f['match'] != 'no_permit_found':
        continue
    own = pgeoms[f['pi']]
    for sid, gs in site_parcels.items():
        if any(g is not own and g.distance(own) <= near_deg for g in gs):
            pair_by_fac.setdefault(k, set()).add(sid)
            pair_by_site.setdefault(sid, set()).add(k)
for k, sids in pair_by_fac.items():
    if len(sids) == 1:
        sid = next(iter(sids))
        if len(pair_by_site[sid]) == 1:
            fac[k]['site'], fac[k]['match'] = sid, 'neighbour_parcel'

# ─── 6b. A WDFW permit at a mapped dock joins it ─────────────────────────────
# WDFW records the dock itself, but often without a parcel number, so the permit map
# keeps it as its own site even when a county permit (or another source) already
# describes that dock. One still unclaimed within SITE_JOIN_M of a mapped dock is that
# dock's too: a dock can carry several permit sites (permit_site_ids).
SITE_JOIN_M = 25
claimed = {f['site'] for f in fac if f['site']}
fac_geoms = [[docks[i]['geom'] for i in f['members']] + ([shape(f['aerial']['geometry'])] if f.get('aerial') else [])
             + ([f['shore']] if not f['members'] and not f.get('aerial') else []) for f in fac]
fac_tree_geoms = [g for gs in fac_geoms for g in gs]
fac_of_geom = [k for k, gs in enumerate(fac_geoms) for _ in gs]
fac_tree = STRtree(fac_tree_geoms)
for f in fac:
    f['extra_sites'] = []
site_join = 0
for s_ in sites:
    sp = s_['properties']
    if sp['site_id'] in claimed or not sp['located_at'].startswith('dock'):
        continue
    pt = site_pt[sp['site_id']]
    best = None
    for j in fac_tree.query(pt.buffer(SITE_JOIN_M / M_PER_DEG_LNG)):
        d = metres(pt, nearest_points(fac_tree_geoms[j], pt)[0])
        if d <= SITE_JOIN_M and (best is None or d < best[0]):
            best = (d, fac_of_geom[j])
    if not best:
        # Same waterfront parcel: the WDFW point's parcel holds exactly one mapped dock.
        i, pd = nearest_parcel(pt)
        if pd <= MATCH_M:
            on_parcel = [k for k, f in enumerate(fac) if f['pin'] == parcels[i]['properties']['PIN']]
            if len(on_parcel) == 1:
                best = (None, on_parcel[0])
    if best:
        f = fac[best[1]]
        if f['site']:
            f['extra_sites'].append(sp['site_id'])
        else:  # a dock with no permit yet: these become its permits
            f['site'], f['match'] = sp['site_id'], 'near_wdfw_point'
        claimed.add(sp['site_id'])
        site_join += 1
print(f'{site_join} WDFW permit sites joined the mapped dock they sit on (within {SITE_JOIN_M} m, or alone on its parcel)')

# ─── 7. Output ──────────────────────────────────────────────────────────────
out, counts = [], {'permit_parcel': 0, 'near_wdfw_point': 0, 'neighbour_parcel': 0, 'no_permit_found': 0, 'no_parcel': 0}
for f in fac:
    members, shore, pin, site, match = f['members'], f['shore'], f['pin'], f['site'], f['match']
    counts[match] += 1
    ids = [docks[i]['id'] for i in members]
    a = f.get('aerial')
    sources = (['OpenStreetMap (© OpenStreetMap contributors, ODbL)'] if ids else []) + \
        (['Friends of the San Juans shoreline survey (2008–2009)'] if f['survey'] else []) + \
        ([a['properties']['source']] if a else [])
    facility = {
        'facility_id': f'osm{min(ids)}' if ids else f"friends{f['survey'][0]['OBJECTID']}" if f['survey'] else a['properties']['aerial_id'],
        'located_by': f['located_by'],
        'osm_ways': len(ids),
        'parcel_number': pin,
        'parcel_distance_m': round(f['pdist'], 1),
        'permit_match': match,
        'permit_site_id': site,
        'permit_site_ids': ([site] if site else []) + f['extra_sites'],
        'permit_site_distance_m': round(metres(shore, site_pt[site])) if site else None,
        'source': ' · '.join(sources),
        'friends_survey': f['survey'],
        'friends_join': f['friends_join'],  # how an OSM dock's survey record was tied to it
        'aerial': {k: v for k, v in a['properties'].items() if k != 'source'} if a else None,
    }
    if a:  # its outline (model mask) or drawn line, drawn like an OSM tracing
        out.append({'type': 'Feature', 'geometry': a['geometry'], 'properties': {**facility, 'kind': 'shape'}})
    for i in members:
        d = docks[i]
        out.append({'type': 'Feature', 'geometry': mapping(d['geom']), 'properties': {
            **facility, 'kind': 'shape', 'osm_id': d['id'], 'osm_url': f"https://www.openstreetmap.org/way/{d['id']}", 'osm_tags': d['tags']}})
    named = next((docks[i]['tags'].get('name') for i in members if docks[i]['tags'].get('name')), None)
    out.append({'type': 'Feature', 'geometry': mapping(shore), 'properties': {
        **facility, 'kind': 'point', 'name': named,
        'osm_urls': [f'https://www.openstreetmap.org/way/{x}' for x in ids]}})

# ─── 8. Permit sites with no located dock: a dock at the permit point ─────────
linked = {s for f in fac for s in ([f['site']] if f['site'] else []) + f['extra_sites']}
permit_only = 0
for s_ in sites:
    sp = s_['properties']
    if sp['site_id'] in linked:
        continue
    permit_only += 1
    counts['permit_only'] = counts.get('permit_only', 0) + 1
    out.append({'type': 'Feature', 'geometry': s_['geometry'], 'properties': {
        'facility_id': f"permit-{sp['site_id']}", 'friends_join': None, 'aerial': None,
        'located_by': 'wdfw_permit' if sp['located_at'].startswith('dock') else 'parcel_point',
        'osm_ways': 0, 'parcel_number': None, 'parcel_distance_m': None,
        'permit_match': 'permit_only', 'permit_site_id': sp['site_id'], 'permit_site_ids': [sp['site_id']], 'permit_site_distance_m': 0,
        'source': sp['sources'], 'friends_survey': [], 'kind': 'point', 'name': None, 'osm_urls': []}})

# ─── 8b. Known docks checked absent in the 2025 aerials ──────────────────────
ABSENT = 'data/sanjuan-docks/aerial-absent.json'
absent = set(json.load(open(ABSENT))['facility_ids']) if os.path.exists(ABSENT) else set()
for o in out:
    o['properties']['absent_2025'] = o['properties']['facility_id'] in absent
print(f"{sum(1 for o in out if o['properties']['kind'] == 'point' and o['properties']['absent_2025'])} docks flagged not visible in the 2025 aerials")

# ─── 9. Every dock's parcel ─────────────────────────────────────────────────
all_parcels = [f for f in json.load(open(ALL_PARCELS))['features'] if f.get('geometry')]
ap_geoms = [shape(f['geometry']) for f in all_parcels]
ap_tree = STRtree(ap_geoms)
by_pin = {f['properties']['PIN']: f['properties'] for f in all_parcels}
by_pin9 = {}
for pin in by_pin:
    by_pin9.setdefault(pin[:9], pin)
addresses = json.load(open(ADDRESSES))
site_props = {s_['properties']['site_id']: s_['properties'] for s_ in sites}


def parcel_info(pin, method):
    p = by_pin.get(pin, {})
    return {'parcel_number': pin, 'parcel_method': method,
            'parcel_address': '; '.join(sorted({a['FULLADDR'] for a in addresses.get(pin, []) if a.get('FULLADDR')})) or None,
            'parcel_area': (p.get('Tax_Area') or '').strip().title() or None,
            'parcel_acres': round(p['Acres'], 2) if p.get('Acres') else None,
            'parcel_url': f"{PARCELS}/query?where=PIN%3D%27{pin}%27&outFields=*&f=html"}


parcel_of, methods = {}, {}
for o in out:
    pr = o['properties']
    if pr['kind'] != 'point':
        continue
    info = None
    if pr['parcel_number']:
        info = parcel_info(pr['parcel_number'], 'shore_end')
    elif pr['located_by'] in ('parcel_point', 'wdfw_permit'):
        pins = [d for p in site_props[pr['permit_site_id']]['permits'] for d in re.findall(r'\d{9,12}', str(p.get('parcel_number') or ''))]
        pins = [by_pin.get(d) and d or by_pin9.get(d[:9]) for d in pins]
        pins = [d for d in pins if d]
        if pins:
            info = parcel_info(max(set(pins), key=pins.count), 'permit_record')
    if not info:
        pt = Point(o['geometry']['coordinates'])
        i = ap_tree.nearest(pt)
        d = 0.0 if ap_geoms[i].contains(pt) else metres(pt, nearest_points(ap_geoms[i], pt)[0])
        if d <= NEAREST_PARCEL_M:
            info = {**parcel_info(all_parcels[i]['properties']['PIN'], 'nearest_parcel'), 'parcel_distance_m': round(d, 1)}
    parcel_of[pr['facility_id']] = info or {'parcel_number': None, 'parcel_method': None}
    methods[(info or {}).get('parcel_method')] = methods.get((info or {}).get('parcel_method'), 0) + 1
for o in out:
    o['properties'].update(parcel_of.get(o['properties']['facility_id'], {}))
print('parcels:', methods)

# ─── 10. Water: snap parcel-point docks to the water's edge; label lake piers ───
from shapely.ops import unary_union, polygonize
from shapely.validation import make_valid
marine = unary_union([make_valid(shape(f['geometry'])) for f in json.load(open(MARINE_LAND))['features'] if f.get('geometry')]).boundary
marine_parts = list(getattr(marine, 'geoms', [marine]))
marine_tree = STRtree(marine_parts)
lakes = []
for e in json.load(open(OSM_WATER))['elements']:
    t = e.get('tags', {})
    if t.get('water') in ('lagoon', 'salt_pool', 'wastewater', 'basin'):
        continue
    if e['type'] == 'way' and len(e.get('geometry', [])) >= 4:
        polys = [Polygon([(p['lon'], p['lat']) for p in e['geometry']])]
    elif e['type'] == 'relation':
        rings = [LineString([(p['lon'], p['lat']) for p in m['geometry']]) for m in e.get('members', [])
                 if m.get('role') == 'outer' and len(m.get('geometry', [])) >= 2]
        polys = list(polygonize(rings))
    else:
        continue
    for pg in polys:
        pg = make_valid(pg)
        if not pg.is_empty:
            lakes.append((pg, t.get('name')))
# A "lake" right on the marine shore is a lagoon in all but tag — not freshwater.
lakes = [(pg, n) for pg, n in lakes if pg.distance(marine) * M_PER_DEG_LNG > SALT_CLEAR_M / 2]
lake_tree = STRtree([pg for pg, _ in lakes])
geoms_by_fac = {}
for o in out:
    geoms_by_fac.setdefault(o['properties']['facility_id'], []).append(shape(o['geometry']))
ap_by_pin = {f['properties']['PIN']: g for f, g in zip(all_parcels, ap_geoms)}
snapped = 0
for o in out:
    pr = o['properties']
    if pr['kind'] != 'point' or pr['located_by'] != 'parcel_point' or not pr.get('parcel_number'):
        continue
    pg = ap_by_pin.get(pr['parcel_number'])
    if pg is None:
        continue
    waters = [marine_parts[marine_tree.nearest(pg)]] + [lakes[i][0].boundary for i in lake_tree.query(pg.buffer(SNAP_MAX_M / M_PER_DEG_LNG))]
    w = min(waters, key=lambda w: pg.distance(w))
    if pg.distance(w) * M_PER_DEG_LNG > SNAP_MAX_M:
        continue
    edge = nearest_points(pg.boundary, w)[0]
    moved = metres(Point(o['geometry']['coordinates']), edge)
    o['geometry'] = mapping(edge)
    pr['position_note'] = f'moved {round(moved)} m from the parcel point to where the parcel meets the water'
    geoms_by_fac[pr['facility_id']] = [edge]
    snapped += 1
lake_docks = 0
for fid, gs in geoms_by_fac.items():
    salt = min(g.distance(marine) for g in gs) * M_PER_DEG_LNG
    near = [lakes[i] for g in gs for i in lake_tree.query(g.buffer(LAKE_NEAR_M / M_PER_DEG_LNG))
            if lakes[i][0].distance(g) * M_PER_DEG_LNG <= LAKE_NEAR_M]
    seen_in_water = any(o['properties']['located_by'] in ('osm', 'friends', 'aerial') for o in out if o['properties']['facility_id'] == fid)
    fresh = (near and salt > SALT_CLEAR_M) or (seen_in_water and salt > INLAND_M)  # OSM misses some lakes (Mountain Lake)
    wb = {'waterbody': 'lake/pond', 'waterbody_name': next((n for _, n in near if n), None)} if fresh else {'waterbody': 'marine', 'waterbody_name': None}
    lake_docks += wb['waterbody'] == 'lake/pond'
    for o in out:
        if o['properties']['facility_id'] == fid:
            o['properties'].update(wb)
lake_docks = sum(1 for o in out if o['properties']['kind'] == 'point' and o['properties']['waterbody'] == 'lake/pond')
print(f'water: {snapped} parcel-point docks moved to the water\'s edge; {lake_docks} docks on lakes/ponds')

json.dump({'type': 'FeatureCollection',
           'metadata': {'source': 'OpenStreetMap man_made=pier within San Juan County (relation 1162038); '
                                  'Friends of the San Juans shoreline survey of docks, 2008–2009',
                        'license': 'OSM: ODbL — © OpenStreetMap contributors. Friends survey: © Friends of the San Juans',
                        'match_radius_m': MATCH_M, 'touch_m': TOUCH_M, 'neighbour_m': NEIGHBOUR_M, 'friends_same_m': FRIENDS_SAME_M,
                        'way_count': len(docks), 'facility_count': len(fac) + permit_only,
                        'located_by_counts': {'osm': len(facilities), 'friends': len(friends_only), 'aerial': aerial_new,
                                              **{k: sum(1 for o in out if o['properties'].get('located_by') == k and o['properties']['kind'] == 'point')
                                                 for k in ('wdfw_permit', 'parcel_point')}},
                        'friends_survey_count': len(friends), 'friends_on_osm_count': len(friends) - len(friends_only),
                        'osm_with_friends_count': len(survey_by_fac), 'friends_parcel_m': FRIENDS_PARCEL_M,
                        'friends_same_parcel_count': len(joined),
                        'match_counts': counts, 'parcel_methods': {str(k): v for k, v in methods.items()},
                        'parcels_source': 'San Juan County GIS tax parcels and address points',
                        'lake_dock_count': lake_docks,
                        'absent_2025_count': sum(1 for o in out if o['properties']['kind'] == 'point' and o['properties']['absent_2025'])},
           'features': out}, open(OUT, 'w'))
print(f'→ {OUT}: {len(fac) + permit_only} docks ({len(facilities)} OSM, {len(friends_only)} Friends-only, {aerial_new} aerial, {permit_only} permit-only)', counts)
