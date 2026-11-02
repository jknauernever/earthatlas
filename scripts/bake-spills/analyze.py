"""
/spills step 3: Lake Michigan oil-spill exposure from NRC initial reports.

  data/spills/venv/bin/python scripts/bake-spills/analyze.py --years 24     # one year (test)
  data/spills/venv/bin/python scripts/bake-spills/analyze.py                # every year

Reads data/national/nrc/work/nrc_cand_<yy>.csv and census_geocode.csv (scripts/national/nrc), the NOAA Lake Michigan
ESI 2025 GDB exports in data/spills/geo/, the Census 2024 place gazetteer, the USGS WBD HU4 basin polygons, PAD-US
protected areas (padus.py) and iNaturalist taxon ids (inat.py).
Writes public/spills-data/lm-spills-<VERSION>.json (reports, species, protected areas, hotspot cells, summary),
esi-shoreline-<VERSION>.geojson and protected-<VERSION>.geojson.

Steps
  1. oil: a petroleum material (common.OIL) on the report
  2. locate, best first; `loc` records which:
       coords   latitude/longitude entered in the report
       text     coordinates written in the report's location or description text
       address  the report's street address, matched by the Census Geocoder
       place    a marina, harbor, park or access site named in the location text, matched to the ESI's named sites
       offset   distance and direction from a city, from the report fields or its location text
       city     the report's nearest city only (Census place centroid)
  3. Lake Michigan scope; `match` records why:
       named    the water-body / location text names Lake Michigan or one of its bays, harbors or connected waters
       basin    medium WATER and the location falls inside the Lake Michigan basin (USGS WBD HU4 0403-0406) or ESI
                mapped water; for `city` locations the city must be in the basin
       drain    as basin, but the water body is a storm drain, sewer, catch basin or similar (no river, lake or harbor named)
  4. one entry per incident (same date, place, materials and amount reported more than once)
  5. exposure: the most sensitive ESI shoreline class and every ESI biological resource within a radius set by the
     location precision (1 km for coords/text, 2 km address/place, 3 km offset, 5 km city)
  6. 5 km hotspot cells (EPSG:3175 grid)
"""
import collections, csv, glob, json, math, os, re, sys
from shapely.geometry import shape, Point, box, mapping
from shapely.strtree import STRtree
from shapely.ops import transform, unary_union
from shapely.validation import make_valid
from pyproj import Transformer

sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT, OIL, LM_TEXT, OTHER_GL, STATES, report_text, in_box, report_coords, sci_name, ds

OUT = os.path.normpath(os.path.join(ROOT, '..', '..', 'public', 'spills-data'))
VERSION = os.environ.get('SPILLS_VERSION', 'v2')   # the weekly job (weekly.sh) passes a date stamp
T = Transformer.from_crs(4326, 3175, always_xy=True).transform
TI = Transformer.from_crs(3175, 4326, always_xy=True).transform
RADIUS = {'coords': 1000, 'text': 1000, 'address': 2000, 'place': 2000, 'offset': 3000, 'city': 5000}
MI_KM = 1.609344

years = None
if '--years' in sys.argv:
    years = set(sys.argv[sys.argv.index('--years') + 1].split(','))


def load_geo(name):
    return json.load(open(os.path.join(ROOT, 'geo', name)))['features']


# ─── Gazetteer (Census 2024 places) ────────────────────────────────────────────
def norm_place(s):
    s = re.sub(r'[^A-Z ]', ' ', (s or '').upper())
    s = re.sub(r'\b(SAINTE|SAINT|STE)\b', 'ST', s)
    s = re.sub(r'\b(CITY OF|VILLAGE OF|TOWN OF|TWSP|TWP|TOWNSHIP|CHARTER)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


gaz = {}
for f in glob.glob(ds('census', 'raw', '*Gaz_place*.txt')):
    for r in csv.DictReader(open(f, encoding='latin-1'), delimiter='\t'):
        r = {k.strip(): v for k, v in r.items()}
        if r['USPS'] not in STATES:
            continue
        nm = norm_place(re.sub(r'\s+(city|village|town|CDP|borough)$', '', r['NAME']))
        gaz[(nm, r['USPS'])] = (float(r['INTPTLONG']), float(r['INTPTLAT']))


def city_xy(city, st):
    g = gaz.get((norm_place(city), st))
    return g if g and in_box(g[1], g[0]) else None


# ─── Scope polygon: Lake Michigan basin + ESI-mapped water ─────────────────────
# The union of ~5,500 ESI water polygons takes minutes, so it is cached in work/ (delete the file to rebuild).
basin = unary_union([make_valid(shape(f['geometry'])).buffer(0) for f in load_geo('lm_basin_hu4.geojson')])
SCOPE_CACHE = os.path.join(ROOT, 'work', 'scope.geojson')
if os.path.exists(SCOPE_CACHE):
    scope = shape(json.load(open(SCOPE_CACHE)))
else:
    water = unary_union([shape(f['geometry']).buffer(0) for f in load_geo('hydrop.geojson') if f['properties'].get('WATER_CODE') == 'W'])
    scope = unary_union([basin, water.buffer(0.003)]).simplify(0.002)
    json.dump(mapping(scope), open(SCOPE_CACHE, 'w'))
scope_m = transform(T, scope)

# ─── ESI named sites (for `place`) ─────────────────────────────────────────────
GENERIC = re.compile(r'^(MARINA|BOAT RAMP|PUBLIC ACCESS|ACCESS|PARK|BEACH|HARBOR|DOCK|PIER|RAMP|LAUNCH|BOAT LAUNCH|STATE PARK|COUNTY PARK|CITY PARK|MUNICIPAL MARINA)$')
places = collections.defaultdict(list)
for layer in ('SOCECON_POINT', 'NAV_MARINE_POINT', 'RESOURCE_POINT'):
    path = os.path.join(ROOT, 'geo', f'{layer.lower()}.geojson')
    if not os.path.exists(path):
        continue
    for f in json.load(open(path))['features']:
        nm = (f['properties'].get('NAME') or '').upper().strip()
        nm = re.sub(r'\s+', ' ', re.sub(r'[^A-Z0-9 ]', ' ', nm)).strip()
        if len(nm) >= 8 and not GENERIC.match(nm) and f['geometry']:
            places[nm].append(tuple(f['geometry']['coordinates'][:2]))
PLACE_RE = re.compile(r'\b(' + '|'.join(sorted(map(re.escape, places), key=len, reverse=True)) + r')\b') if places else None

# ─── Locating ──────────────────────────────────────────────────────────────────
DEC = re.compile(r'\b(4[1-6]\.\d{3,})\s*°?\s*(?:N|NORTH)?\b[\s,/;]*(?:AND\s+|LONG?\w*\W*)?(-?\s?0?8[3-9]\.\d{3,})\s*°?\s*(W|WEST)?')
DM = re.compile(r'\b(4[1-6])\s*(?:°|DEG\w*|-|\s)\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:\'|MIN\w*|-|\s)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|\'\'|SEC\w*)?\s*)?(?:N|NORTH)\b'
                r'[\s,/;]*(?:AND\s+|LONG?\w*\W*)?(0?8[3-9])\s*(?:°|DEG\w*|-|\s)\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:\'|MIN\w*|-|\s)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|\'\'|SEC\w*)?\s*)?(?:W|WEST)\b')


def text_coords(t):
    t = t.upper()
    m = DEC.search(t)
    if m:
        lat, lon = float(m.group(1)), -abs(float(m.group(2).replace(' ', '')))
        if in_box(lat, lon):
            return lat, lon
    for m in DM.finditer(t):
        f = lambda v: float(v.replace(',', '.')) if v else 0.0
        lm, ls, om, os_ = f(m.group(2)), f(m.group(3)), f(m.group(5)), f(m.group(6))
        if max(lm, om) >= 60 or max(ls, os_) >= 60:
            continue
        lat = int(m.group(1)) + lm / 60 + ls / 3600
        lon = -(int(m.group(4)) + om / 60 + os_ / 3600)
        if in_box(lat, lon):
            return lat, lon
    return None


DIRS = {'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5, 'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5, 'S': 180, 'SSW': 202.5,
        'SW': 225, 'WSW': 247.5, 'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5}
WORDDIR = {'NORTH': 'N', 'SOUTH': 'S', 'EAST': 'E', 'WEST': 'W', 'NORTHEAST': 'NE', 'NORTHWEST': 'NW', 'SOUTHEAST': 'SE', 'SOUTHWEST': 'SW',
           'NORTH EAST': 'NE', 'NORTH WEST': 'NW', 'SOUTH EAST': 'SE', 'SOUTH WEST': 'SW'}
UNIT_KM = {'MILE': MI_KM, 'MI': MI_KM, 'NM': 1.852, 'NAUTICAL': 1.852, 'KM': 1.0, 'KILOMETER': 1.0, 'FEET': 0.0003048, 'FT': 0.0003048, 'YARD': 0.0009144}
OFFSET = re.compile(r'\b(\d+(?:\.\d+)?|ONE|TWO|THREE|FOUR|FIVE|HALF A|A HALF|A QUARTER|QUARTER)\s*-?\s*(NAUTICAL MILES?|NM|MILES?|MI|KM|KILOMETERS?|FEET|FT|YARDS?)\W+'
                    r'(?:DUE\s+)?(NORTH ?EAST|NORTH ?WEST|SOUTH ?EAST|SOUTH ?WEST|NORTH|SOUTH|EAST|WEST|NNE|ENE|ESE|SSE|SSW|WSW|WNW|NNW|NE|NW|SE|SW|N|S|E|W)\s+(?:OF|FROM)\s+'
                    r'(?:THE\s+)?([A-Z][A-Z .\']{2,30}?)(?=[,;.()]|\s+(?:ON|IN|AT|NEAR|HARBOR|PIER|LIGHT|BREAKWALL)\b|$)')
NUMWORD = {'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5, 'HALF A': 0.5, 'A HALF': 0.5, 'A QUARTER': 0.25, 'QUARTER': 0.25}


def unit_km(u):
    u = u.upper()
    for k, v in UNIT_KM.items():
        if u.startswith(k):
            return v
    return None


def move(lon, lat, km, bearing):
    b = math.radians(bearing)
    return lon + km * math.sin(b) / (111.32 * math.cos(math.radians(lat))), lat + km * math.cos(b) / 110.574


def offset_point(r, cxy):
    # report fields first
    try:
        d = float(r['DISTANCE_FROM_CITY'])
    except (TypeError, ValueError):
        d = None
    k = unit_km(r['DISTANCE_UNITS'] or '')
    dr = (r['DIRECTION_FROM_CITY'] or '').strip().upper()
    if cxy and d and k and dr in DIRS and d * k <= 40:
        return move(cxy[0], cxy[1], d * k, DIRS[dr]), f"{r['DISTANCE_FROM_CITY']} {r['DISTANCE_UNITS']} {dr} of {r['LOCATION_NEAREST_CITY']}".lower()
    t = (r['INCIDENT_LOCATION'] or '').upper()
    m = OFFSET.search(t)
    if not m:
        return None
    n = NUMWORD.get(m.group(1)) or float(m.group(1)) if m.group(1) not in NUMWORD else NUMWORD[m.group(1)]
    km = n * unit_km(m.group(2))
    dr = WORDDIR.get(m.group(3).replace('  ', ' '), m.group(3).replace(' ', ''))
    dr = WORDDIR.get(dr, dr)
    ref = m.group(4).strip()
    ref_xy = city_xy(ref, r['LOCATION_STATE'])
    if not ref_xy and PLACE_RE:
        pm = PLACE_RE.search(ref)
        if pm and len(places[pm.group(1)]) == 1:
            ref_xy = places[pm.group(1)][0]
    if not ref_xy and cxy and norm_place(ref) in norm_place(r['LOCATION_NEAREST_CITY']):
        ref_xy = cxy
    if not ref_xy or dr not in DIRS or km > 40:
        return None
    return move(ref_xy[0], ref_xy[1], km, DIRS[dr]), m.group(0).strip().lower()


def km_between(a, b):
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110.574)


census = {}
cpath = ds('nrc', 'work', 'census_geocode.csv')
if os.path.exists(cpath):
    for r in csv.DictReader(open(cpath)):
        if r['match'] == 'Match' and r['lat']:
            census[r['seq']] = (float(r['lon']), float(r['lat']), r['exact'], r['matched_address'])


def locate(r):
    """(lon, lat, loc, how) or None. `how` is the report text or match the location came from."""
    cxy = city_xy(r['LOCATION_NEAREST_CITY'], r['LOCATION_STATE'])
    far = lambda p: cxy is not None and km_between(p, cxy) > 120   # a typo'd coordinate lands far from the named city
    c = report_coords(r)
    if c and not far((c[1], c[0])):
        return c[1], c[0], 'coords', 'latitude/longitude in the report'
    for k in ('INCIDENT_LOCATION', 'LOCATION_ADDRESS', 'LOCATION_STREET1', 'DESCRIPTION_OF_INCIDENT'):
        c = text_coords(r[k] or '')
        if c and not far((c[1], c[0])):
            return c[1], c[0], 'text', f'coordinates in the report text ({k.lower().replace("_", " ")})'
    g = census.get(r['SEQNOS'])
    if g and in_box(g[1], g[0]) and not far(g[:2]):
        return g[0], g[1], 'address', f'street address {g[3]} (U.S. Census Geocoder, {"exact" if g[2] == "Exact" else "close"} match)'
    if PLACE_RE:
        for k in ('INCIDENT_LOCATION', 'LOCATION_ADDRESS'):
            for m in PLACE_RE.finditer((r[k] or '').upper()):
                pts = places[m.group(1)]
                near = [p for p in pts if cxy and km_between(p, cxy) < 30] if cxy else pts
                if len(near) == 1 or (len(pts) == 1 and not cxy):
                    p = near[0] if near else pts[0]
                    return p[0], p[1], 'place', f'{m.group(1).title()} (named site in the NOAA ESI)'
    o = offset_point(r, cxy)
    if o and in_box(o[0][1], o[0][0]):
        return o[0][0], o[0][1], 'offset', o[1]
    if cxy:
        return cxy[0], cxy[1], 'city', f'nearest city {r["LOCATION_NEAREST_CITY"].title()} (Census place centre)'
    return None


def iso(s):
    """NRC dates come as '2015-01-02 12:52:00' or '7/22/2019 13:05'; return 'YYYY-MM-DD HH:MM' (or '')."""
    s = clean(s)
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?', s)
    if m:
        return f'{m[1]}-{m[2]}-{m[3]}' + (f' {m[4]}:{m[5]}' if m[4] else '')
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?', s)
    if m:
        return f'{m[3]}-{int(m[1]):02d}-{int(m[2]):02d}' + (f' {int(m[4]):02d}:{m[5]}' if m[4] else '')
    return ''


def clean(s, n=None):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return s[:n] if n else s


DRAIN = re.compile(r'DRAIN|SEWER|CATCH ?BASIN|OUTFALL|CULVERT|MANHOLE|SUMP|INLET|GUTTER|PIPE')
WATERWORD = re.compile(r'RIVER|CREEK|LAKE|BAY|HARBOR|CHANNEL|BROOK|STREAM|CANAL|SLIP|MARINA')


# ─── Incidents ─────────────────────────────────────────────────────────────────
def gallons(amt, unit):
    try:
        a = float(amt)
    except (TypeError, ValueError):
        return None
    u = (unit or '').upper()
    if a <= 0:
        return None
    if 'GALLON' in u:
        return a
    if 'BARREL' in u:
        return a * 42
    if 'LITER' in u or 'LITRE' in u:
        return a / 3.785411784
    return None


inc = {}
files = sorted(glob.glob(ds('nrc', 'work', 'nrc_cand_*.csv')))
if years:
    files = [f for f in files if re.search(r'_(\d+)\.csv$', f).group(1) in years]
for f in files:
    for r in csv.DictReader(open(f)):
        s = r['SEQNOS']
        if s not in inc:
            inc[s] = dict(r=r, mats=[], oil=False, gal=0.0, galknown=False)
        i = inc[s]
        nm = (r['NAME_OF_MATERIAL'] or '').strip().upper()
        if nm and nm not in i['mats']:
            i['mats'].append(nm)
        if OIL.search(nm):
            i['oil'] = True
            g = gallons(r['AMOUNT_IN_WATER'], r['UNIT_OF_MEASURE_REACH_WATER']) or gallons(r['AMOUNT_OF_MATERIAL'], r['UNIT_OF_MEASURE'])
            if g:
                i['gal'] += g
                i['galknown'] = True

stats = collections.Counter()
recs = []
for s, i in inc.items():
    r = i['r']
    if not i['oil']:
        continue
    stats['oil'] += 1
    txt = report_text(r)
    st = (r['LOCATION_STATE'] or '').strip().upper()
    named = bool(LM_TEXT.search(txt))
    if not named and st not in STATES:
        continue
    loc = locate(r)
    water = (r['MEDIUM_DESC'] or '').upper() == 'WATER'
    in_scope = False
    if loc:
        pt = Point(loc[0], loc[1])
        in_scope = (basin.contains(pt) if loc[2] == 'city' else scope.contains(pt))
    basin_match = water and in_scope and not OTHER_GL.search(txt)
    if not (named or basin_match):
        continue
    # Drains and sewers are "water" to the NRC but may never reach the lake: their own class, so the map can leave them out.
    match = 'named' if named else ('drain' if DRAIN.search((r['BODY_OF_WATER'] or '').upper()) and not WATERWORD.search((r['BODY_OF_WATER'] or '').upper()) else 'basin')
    if named and st and st not in STATES and not loc:
        continue
    recs.append(dict(i, seq=s, loc=loc, match=match, water=water))

stats['lm_reports'] = len(recs)
# One entry per incident: the NRC often takes several calls about the same release.
seen, lm = {}, []
for i in recs:
    r = i['r']
    when = (iso(r['INCIDENT_DATE_TIME']) or iso(r['DATE_TIME_RECEIVED']))[:10]
    where = (round(i['loc'][0], 2), round(i['loc'][1], 2)) if i['loc'] else (r['LOCATION_NEAREST_CITY'] or '').upper()
    k = (when, where, tuple(sorted(i['mats'])), round(i['gal']))
    if k in seen:
        seen[k]['dups'].append(i['seq'])
        continue
    i['dups'] = []
    seen[k] = i
    lm.append(i)
located = [i for i in lm if i['loc']]
print(f'oil reports {stats["oil"]}; Lake Michigan reports {len(recs)}; incidents {len(lm)}; located {len(located)}', flush=True)

# ─── ESI shoreline + biology ───────────────────────────────────────────────────
esi = load_geo('esil.geojson')
eg = [transform(T, shape(f['geometry'])) for f in esi]
ep = [f['properties'] for f in esi]
etree = STRtree(eg)


def esi_rank(code):
    m = re.match(r'(\d+)([A-Z]?)', code or '')
    return (int(m.group(1)), m.group(2)) if m else None


class_names = collections.defaultdict(collections.Counter)
for p in ep:
    if p.get('ESI') and '/' not in p['ESI'] and p.get('LANDWARD_SHORETYPE'):
        class_names[p['ESI']][p['LANDWARD_SHORETYPE'].split(': ', 1)[-1]] += 1
ESI_NAMES = {k: v.most_common(1)[0][0] for k, v in class_names.items()}

MASKED = re.compile(r'^(federally\s+)?(endangered|threatened|special concern|rare)\b', re.I)
species, sp_index = [], {}
bio = []
for layer, el in (('BIRDS', 'bird'), ('BIRDSPT', 'bird'), ('FISH', 'fish'), ('FISHPT', 'fish'), ('HERP', 'reptile/amphibian'),
                  ('INVERT', 'invertebrate'), ('T_MAMMAL', 'mammal'), ('HABITATS', 'plant/habitat')):
    for f in load_geo(f'{layer}.geojson'):
        if f['geometry'] is None:
            continue
        p = f['properties']
        nm = (p.get('NAME') or '').strip()
        if not nm or MASKED.match(nm):
            continue   # the ESI withholds which species this is ("Endangered plant"), so there is nothing to verify
        key = (nm, el)
        if key not in sp_index:
            sp_index[key] = len(species)
            species.append(dict(n=nm, g=el, fed=None, st={}))
        sp = species[sp_index[key]]
        if p.get('GEN_SPEC') and p['GEN_SPEC'].strip() and 'sci' not in sp:
            sp['sci'] = sci_name(p['GEN_SPEC'])
        if p.get('F'):
            sp['fed'] = p['F'] if sp['fed'] in (None, 'T') or p['F'] == 'E' else sp['fed']
        if p.get('S') and p.get('STATE'):
            sp['st'][p['STATE']] = p['S']
        bio.append((transform(T, make_valid(shape(f['geometry'])).buffer(0)), sp_index[key]))
btree = STRtree([b[0] for b in bio])
# iNaturalist taxon ids (inat.py) → each species links to its EarthAtlas page
INAT = os.path.join(ROOT, 'work', 'inat_taxa.csv')
inat = {r['query']: r for r in csv.DictReader(open(INAT))} if os.path.exists(INAT) else {}
for sp in species:
    t = inat.get(sp.get('sci', ''))
    if t and t['id']:
        sp['tx'] = int(t['id'])
        sp['txn'] = t['name']
    sp.pop('sci', None)

# ─── Protected areas (USGS PAD-US 4.1, padus.py) ──────────────────────────────
# One area per name + manager + designation (PAD-US splits a park into its parcels and repeats it as fee land and as a
# designation); its parts are merged. Kept for the map: every area near a report, and every area within 1 km of the ESI
# shoreline.
PAD = os.path.join(ROOT, 'work', 'padus')
DES = {r['Code']: r['Dom'] for r in csv.DictReader(open(os.path.join(PAD, 'designations.csv')))}
GAP_RANK = {'1': 1, '2': 2, '3': 3, '4': 4}
groups = {}
for st in sorted(STATES):
    for f in json.load(open(os.path.join(PAD, f'{st}.geojson')))['features']:
        p = f['properties']
        if not f['geometry']:
            continue
        nm = ' '.join((p.get('Unit_Nm') or '').split()) or 'Unnamed protected area'
        key = (nm.upper(), p.get('Mang_Name') or '', p.get('Des_Tp') or '')
        a = groups.get(key)
        if a is None:
            a = groups[key] = dict(n=nm, mt=p.get('Mang_Type') or 'UNK', mn=p.get('Mang_Name') or '', lm=(p.get('Loc_Mang') or '').strip(),
                                   d=DES.get(p.get('Des_Tp') or '', p.get('Des_Tp') or ''), ld=(p.get('Loc_Ds') or '').strip(),
                                   gap=p.get('GAP_Sts'), acc=p.get('Pub_Access') or 'UK', ac=0, fc=p.get('FeatClass'),
                                   src=(p.get('Agg_Src') or '').strip(), sd=(p.get('Src_Date') or '').strip(), st=st, parts=[])
        a['ac'] += p.get('GIS_Acres') or 0
        if GAP_RANK.get(p.get('GAP_Sts'), 9) < GAP_RANK.get(a['gap'], 9):
            a['gap'] = p.get('GAP_Sts')
        a['parts'].append(transform(T, make_valid(shape(f['geometry']))))
areas = list(groups.values())
for a in areas:
    parts = a.pop('parts')
    a['geom'] = unary_union([g.buffer(0) for g in parts]) if len(parts) > 1 else parts[0]
atree = STRtree([a['geom'] for a in areas])
print(f'protected areas {len(areas)}', flush=True)

for i in located:
    lon, lat, loc, how = i['loc']
    pt = Point(T(lon, lat))
    R = RADIUS[loc]
    best, nearest = None, None
    for k in etree.query(pt.buffer(R)):
        d = eg[k].distance(pt)
        if not d <= R:
            continue
        code = re.sub(r'[^0-9A-Z]', '', ep[k].get('MOST_SENSITIVE') or (ep[k].get('ESI') or '').split('/')[0])
        rk = esi_rank(code)
        if rk and (best is None or rk > best[0]):
            best = (rk, code)
        if nearest is None or d < nearest[0]:
            nearest = (d, ep[k].get('ESI'))
    i['esi_max'] = best[1] if best else None
    i['esi_near'] = (nearest[1], round(nearest[0])) if nearest else None
    found = set()
    for k in btree.query(pt.buffer(R)):
        g, si = bio[k]
        if g.distance(pt) <= R:
            found.add(si)
    i['species'] = sorted(found)
    near = []
    for k in atree.query(pt, predicate='dwithin', distance=R):
        near.append((round(areas[k]['geom'].distance(pt) / 100) * 100, k))
    i['areas'] = sorted(near)

# ─── Pipeline accidents (PHMSA, phmsa.py) in the Lake Michigan scope ─────────
# Operators give coordinates, so the 1 km radius of reported coordinates applies. Each also gets the NRC report(s) it
# names, which links the NRC point on the map to its measured volumes.
PH = ds('phmsa', 'work', 'phmsa.json')
pipes = {}
for a in (json.load(open(PH)) if os.path.exists(PH) else []):
    if not in_box(a['lat'], a['lon']):
        continue
    pt = Point(T(a['lon'], a['lat']))
    if not scope_m.contains(pt):
        continue
    R = RADIUS['coords']
    best = None
    for k in etree.query(pt, predicate='dwithin', distance=R):
        code = re.sub(r'[^0-9A-Z]', '', ep[k].get('MOST_SENSITIVE') or (ep[k].get('ESI') or '').split('/')[0])
        rk = esi_rank(code)
        if rk and (best is None or rk > best[0]):
            best = (rk, code)
    sp = sorted({bio[k][1] for k in btree.query(pt, predicate='dwithin', distance=R)})
    near = sorted((round(areas[k]['geom'].distance(pt) / 100) * 100, k) for k in atree.query(pt, predicate='dwithin', distance=R))
    pipes[a['id']] = dict(r=R, e=best[1] if best else None, sp=sp, areas=near, nrc=a['nrc'])
nrc_to_pipe = {n: pid for pid, x in pipes.items() for n in x['nrc']}
for a in (json.load(open(PH)) if os.path.exists(PH) else []):
    for n in a['nrc']:
        nrc_to_pipe.setdefault(n, a['id'])
print(f'pipeline accidents in scope {len(pipes)}', flush=True)

# Areas kept for the map and the data file, renumbered.
used = {k for i in located for _, k in i['areas']} | {k for x in pipes.values() for _, k in x['areas']}
shore = set(etree.query([a['geom'] for a in areas], predicate='dwithin', distance=1000)[0].tolist())
keep = sorted(used | shore)
renum = {k: n for n, k in enumerate(keep)}
for i in located:
    i['areas'] = [[renum[k], d] for d, k in i['areas']]
pipe_out = {pid: dict(r=x['r'], e=x['e'], sp=x['sp'], pa=[[renum[k], d] for d, k in x['areas']]) for pid, x in pipes.items()}
print(f'protected areas kept {len(keep)} (near a report {len(used)}, on the shore {len(shore)})', flush=True)

# ─── Hotspot cells (5 km) ──────────────────────────────────────────────────────
C = 5000
cells = collections.defaultdict(list)
for i in located:
    x, y = T(i['loc'][0], i['loc'][1])
    cells[(int(x // C), int(y // C))].append(i)
hot = []
for (cx, cy), L in cells.items():
    ring = [TI(cx * C, cy * C), TI((cx + 1) * C, cy * C), TI((cx + 1) * C, (cy + 1) * C), TI(cx * C, (cy + 1) * C)]
    ring = [[round(a, 4), round(b, 4)] for a, b in ring]
    sp = set(s for i in L for s in i['species'])
    listed = [s for s in sp if species[s]['fed'] or species[s]['st']]
    em = [esi_rank(i['esi_max']) + (i['esi_max'],) for i in L if i['esi_max']]
    hot.append(dict(id=f'{cx}_{cy}', ring=ring + [ring[0]], n=len(L),
                    prec=dict(collections.Counter(i['loc'][2] for i in L)),
                    years=sorted(set(int(i['r']['YEAR']) for i in L)),
                    esi_max=max(em)[2] if em else None, n_species=len(sp), n_listed=len(listed),
                    places=[c for c, _ in collections.Counter((i['r']['LOCATION_NEAREST_CITY'] or '').title() for i in L if i['r']['LOCATION_NEAREST_CITY']).most_common(3)],
                    seqs=[i['seq'] for i in L]))
hot.sort(key=lambda h: -h['n'])

# ─── Output ────────────────────────────────────────────────────────────────────
points = []
for i in lm:
    r = i['r']
    p = dict(seq=i['seq'], y=int(r['YEAR']), d=iso(r['INCIDENT_DATE_TIME']) or iso(r['DATE_TIME_RECEIVED']),
             rec=iso(r['DATE_TIME_RECEIVED']), t=clean(r['TYPE_OF_INCIDENT']).title(), c=clean(r['INCIDENT_CAUSE']).capitalize(),
             city=clean(r['LOCATION_NEAREST_CITY']).title(), st=clean(r['LOCATION_STATE']), county=clean(r['LOCATION_COUNTY']).title(),
             il=clean(r['INCIDENT_LOCATION'], 200), addr=clean(r['LOCATION_ADDRESS'], 120), w=clean(r['BODY_OF_WATER'], 80),
             trib=clean(r['TRIBUTARY_OF'], 80), med=clean(r['MEDIUM_DESC']).lower(), m=i['mats'][:4],
             g=round(i['gal'], 1) if i['galknown'] else None, sheen=clean(' '.join(x for x in (r['SHEEN_SIZE'], r['SHEEN_SIZE_UNITS']) if x)),
             org=clean(r['RESPONSIBLE_ORG_TYPE']).capitalize(), pot=r['POTENTIAL_FLAG'] == 'Y', desc=clean(r['DESCRIPTION_OF_INCIDENT'], 900),
             match=i['match'], dups=i['dups'])
    ph = next((nrc_to_pipe[n] for n in [i['seq']] + i['dups'] if n in nrc_to_pipe), None)
    if ph:
        p['ph'] = ph
    if i['loc']:
        lon, lat, loc, how = i['loc']
        p.update(lon=round(lon, 5), lat=round(lat, 5), loc=loc, how=how, r=RADIUS[loc],
                 e=i['esi_max'], en=i['esi_near'], sp=i['species'], pa=i['areas'])
    points.append(p)

by_year = collections.Counter(p['y'] for p in points)
summary = dict(
    years=[min(by_year), max(by_year)] if by_year else None, oil_reports_considered=stats['oil'], lm_reports=len(recs), incidents=len(lm),
    located=len(located), by_year=dict(sorted(by_year.items())), by_loc=dict(collections.Counter(p.get('loc') or 'unlocated' for p in points)),
    by_match=dict(collections.Counter(p['match'] for p in points)), vol_known=sum(1 for p in points if p['g']), cells=len(hot),
    near_listed=sum(1 for p in points if any(species[s]['fed'] or species[s]['st'] for s in p.get('sp', []))),
    near_protected=sum(1 for p in points if p.get('pa')), protected_areas=len(keep),
)
area_out = []
for k in keep:
    a = areas[k]
    area_out.append({x: a[x] for x in ('n', 'mt', 'mn', 'lm', 'd', 'ld', 'gap', 'acc', 'fc', 'src', 'sd', 'st')} | dict(ac=round(a['ac'])))
os.makedirs(OUT, exist_ok=True)
json.dump(dict(version=VERSION, summary=summary, esi_names=ESI_NAMES, species=species, areas=area_out, pipes=pipe_out, points=points, hotspots=hot),
          open(os.path.join(OUT, f'lm-spills-{VERSION}.json'), 'w'), separators=(',', ':'))
web = os.path.join(ROOT, 'work', 'esil_web.geojson')
if os.path.exists(web):
    d = json.load(open(web))
    for f in d['features']:
        f['properties'] = dict(esi=f['properties'].get('ESI'), c=re.sub(r'[^0-9A-Z]', '', f['properties'].get('c') or ''))
    json.dump(d, open(os.path.join(OUT, f'esi-shoreline-{VERSION}.geojson'), 'w'), separators=(',', ':'))
pa_feats = []
for n, k in enumerate(keep):
    a = areas[k]
    g = transform(TI, a['geom'].simplify(15))
    if g.is_empty:
        continue
    pa_feats.append(dict(type='Feature', properties=dict(i=n, gap=int(a['gap'] or 4), mt=a['mt']), geometry=mapping(g)))
pa_path = os.path.join(OUT, f'protected-{VERSION}.geojson')
with open(pa_path, 'w') as f:
    json.dump(dict(type='FeatureCollection', features=pa_feats), f, separators=(',', ':'))
os.system(f"ogr2ogr -q -f GeoJSON -lco COORDINATE_PRECISION=5 {pa_path}.tmp {pa_path} && mv {pa_path}.tmp {pa_path}")
print(json.dumps(summary, indent=1))
for h in hot[:10]:
    print(h['n'], h['places'], h['prec'], h['esi_max'], h['n_listed'])
