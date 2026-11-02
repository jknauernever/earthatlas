"""
/spills: every oil spill reported to the NRC anywhere in the U.S. that reached water, one file per state, checked against
the national datasets (docs/NATIONAL_DATA.md): critical habitat (crithab) and PAD-US protected areas (padus). Lake Michigan
keeps its own, richer bake (analyze.py: NOAA ESI shoreline and species); this step adds critical habitat to that file too.

  data/spills/venv/bin/python scripts/bake-spills/states.py --states WA     # one state (test)
  data/spills/venv/bin/python scripts/bake-spills/states.py                # every state

Inputs: data/national/nrc/work (extract.py, geocode.py), data/national/census (places, state boundaries),
data/national/crithab/work (crithab/build.py) and data/national/padus (raw parquet; the selection is cached in its work).
Outputs in public/spills-data/: regions-<VERSION>.json, state-<VERSION>/<ST>.json (points with `ch` and `pa`, plus the
state's `areas`), state-pa-<VERSION>/<ST>.geojson (its protected areas near reports, for the map), and `ch` on the
Lake Michigan file's points.
"""
import collections, csv, glob, json, math, os, re, sys
import shapely
from shapely.geometry import shape, Point, box, mapping
from shapely.strtree import STRtree
from shapely.ops import transform
from shapely.validation import make_valid
from pyproj import Transformer

sys.path.insert(0, os.path.dirname(__file__))
from common import ROOT, OIL, raw_coords, ds

OUT = os.path.normpath(os.path.join(ROOT, '..', '..', 'public', 'spills-data'))
VERSION = os.environ.get('SPILLS_VERSION', 'v2')
WORK = os.path.join(ROOT, 'work')   # /spills' own caches (protected areas near reports)
RADIUS = {'coords': 1000, 'text': 1000, 'address': 2000, 'place': 3000, 'offset': 3000, 'city': 5000}   # a GNIS bay's point sits mid-water: 3 km
MI_KM = 1.609344
only = set(sys.argv[sys.argv.index('--states') + 1].split(',')) if '--states' in sys.argv else None

from lib import ZONES, FWD, zone_of, in_us  # noqa: E402  (projection zones, scripts/national/lib.py)


# ─── Gazetteer (Census 2024 places, every state) ──────────────────────────────
def norm_place(s):
    s = re.sub(r'[^A-Z ]', ' ', (s or '').upper())
    s = re.sub(r'\b(SAINTE|SAINT|STE)\b', 'ST', s)
    s = re.sub(r'\b(CITY OF|VILLAGE OF|TOWN OF|TWSP|TWP|TOWNSHIP|CHARTER)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


gaz = {}
for f in glob.glob(ds('census', 'raw', '*Gaz_place*.txt')):
    for r in csv.DictReader(open(f, encoding='latin-1'), delimiter='\t'):
        r = {k.strip(): v for k, v in r.items()}
        nm = norm_place(re.sub(r'\s+(city|village|town|CDP|borough|municipality|zona urbana|comunidad)$', '', r['NAME']))
        gaz.setdefault((nm, r['USPS']), (float(r['INTPTLONG']), float(r['INTPTLAT'])))


# Official Census place names by state, keyed without spaces (EASTSOUND = EAST SOUND), for `pc`: the report's city as a
# real place, so "East Sound" / "Eastsound" and "Lopez" / "Lopez Island" read as one place in lists.
gaz_name = {}
for f in glob.glob(ds('census', 'raw', '*Gaz_place*.txt')):
    for r in csv.DictReader(open(f, encoding='latin-1'), delimiter='\t'):
        r = {k.strip(): v for k, v in r.items()}
        base = re.sub(r'\s+(city|village|town|CDP|borough|municipality|zona urbana|comunidad)$', '', r['NAME'])
        gaz_name.setdefault((norm_place(base).replace(' ', ''), r['USPS']), base)


# Census counties (and parishes, boroughs, census areas): a report's county is kept only when it is a real one in its
# state, so callers' free text ("British Columbia" under WA) doesn't become a county in lists.
COUNTY_WORDS = re.compile(r'\s+(County|Parish|Borough|Census Area|City and Borough|Municipality|Municipio|Island|District)$')
counties = {}
for f in glob.glob(ds('census', 'raw', '*Gaz_counties*.txt')):
    for r in csv.DictReader(open(f, encoding='latin-1'), delimiter='\t'):
        r = {k.strip(): v for k, v in r.items()}
        base = COUNTY_WORDS.sub('', r['NAME']).strip()
        counties[(norm_place(base).replace(' ', ''), r['USPS'])] = base


def county_name(c, st):
    k = norm_place(COUNTY_WORDS.sub('', (c or '').strip().title())).replace(' ', '')
    return counties.get((k, (st or '').strip().upper()), '') if k else ''


# USGS GNIS populated places, for towns the Census doesn't list (Eastsound, Lopez, Orcas…).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national', 'nrc'))
from named import STATE_USPS  # noqa: E402  (scripts/national/nrc/named.py)
gnis_town = {}
for r in csv.DictReader(open(ds('gnis', 'raw', 'DomesticNames_National.txt'), encoding='utf-8-sig'), delimiter='|'):
    if r['feature_class'] == 'Populated Place' and STATE_USPS.get(r['state_name']):
        gnis_town.setdefault((norm_place(r['feature_name']).replace(' ', ''), STATE_USPS[r['state_name']]), r['feature_name'])


def place_name(city, st):
    k = norm_place(city).replace(' ', '')
    if not k:
        return None
    st = (st or '').strip().upper()
    for key in (k, re.sub(r'ISLANDS?$', '', k), k + 'ISLAND'):
        hit = gaz_name.get((key, st)) or gnis_town.get((key, st))
        if hit:
            return hit
    return None


def city_xy(city, st):
    return gaz.get((norm_place(city), (st or '').strip().upper()))


def km_between(a, b):
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110.574)


# ─── Locating (as analyze.py, for the whole country) ──────────────────────────
DEC = re.compile(r'\b(\d{2}\.\d{3,})\s*°?\s*(?:N|NORTH)?\b[\s,/;]*(?:AND\s+|LONG?\w*\W*)?(-?\s?\d{2,3}\.\d{3,})\s*°?\s*(W|WEST)?')
DM = re.compile(r'\b(\d{2})\s*(?:°|DEG\w*|-|\s)\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:\'|MIN\w*|-|\s)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|\'\'|SEC\w*)?\s*)?(?:N|NORTH)\b'
                r'[\s,/;]*(?:AND\s+|LONG?\w*\W*)?(\d{2,3})\s*(?:°|DEG\w*|-|\s)\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:\'|MIN\w*|-|\s)?\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|\'\'|SEC\w*)?\s*)?(?:W|WEST)\b')


def text_coords(t):
    t = t.upper()
    m = DEC.search(t)
    if m:
        lat, lon = float(m.group(1)), -abs(float(m.group(2).replace(' ', '')))
        if in_us(lat, lon):
            return lat, lon
    for m in DM.finditer(t):
        f = lambda v: float(v.replace(',', '.')) if v else 0.0
        lm, ls, om, os_ = f(m.group(2)), f(m.group(3)), f(m.group(5)), f(m.group(6))
        if max(lm, om) >= 60 or max(ls, os_) >= 60:
            continue
        lat = int(m.group(1)) + lm / 60 + ls / 3600
        lon = -(int(m.group(4)) + om / 60 + os_ / 3600)
        if in_us(lat, lon):
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
    u = (u or '').upper()
    for k, v in UNIT_KM.items():
        if u.startswith(k):
            return v
    return None


def move(lon, lat, km, bearing):
    b = math.radians(bearing)
    return lon + km * math.sin(b) / (111.32 * math.cos(math.radians(lat))), lat + km * math.cos(b) / 110.574


def offset_point(r, cxy):
    try:
        d = float(r['DISTANCE_FROM_CITY'])
    except (TypeError, ValueError):
        d = None
    k = unit_km(r['DISTANCE_UNITS'])
    dr = (r['DIRECTION_FROM_CITY'] or '').strip().upper()
    if cxy and d and k and dr in DIRS and d * k <= 40:
        return move(cxy[0], cxy[1], d * k, DIRS[dr]), f"{r['DISTANCE_FROM_CITY']} {r['DISTANCE_UNITS']} {dr} of {r['LOCATION_NEAREST_CITY']}".lower()
    m = OFFSET.search((r['INCIDENT_LOCATION'] or '').upper())
    if not m:
        return None
    n = NUMWORD[m.group(1)] if m.group(1) in NUMWORD else float(m.group(1))
    km = n * unit_km(m.group(2))
    dr = WORDDIR.get(m.group(3).replace('  ', ' '), m.group(3).replace(' ', ''))
    dr = WORDDIR.get(dr, dr)
    ref_xy = city_xy(m.group(4).strip(), r['LOCATION_STATE'])
    if not ref_xy and cxy and norm_place(m.group(4)) in norm_place(r['LOCATION_NEAREST_CITY']):
        ref_xy = cxy
    if not ref_xy or dr not in DIRS or km > 40:
        return None
    return move(ref_xy[0], ref_xy[1], km, DIRS[dr]), m.group(0).strip().lower()


census = {}
cpath = ds('nrc', 'work', 'census_geocode.csv')
if os.path.exists(cpath):
    for r in csv.DictReader(open(cpath)):
        if r['match'] == 'Match' and r['lat']:
            census[r['seq']] = (float(r['lon']), float(r['lat']), r['exact'], r['matched_address'])


def locate(r):
    """(lon, lat, loc, how) or None, best first (see analyze.py; no ESI named sites outside Lake Michigan)."""
    cxy = city_xy(r['LOCATION_NEAREST_CITY'], r['LOCATION_STATE'])
    far = lambda p: cxy is not None and km_between(p, cxy) > 120   # a typo'd coordinate lands far from the named city
    c = raw_coords(r)
    if c and in_us(c[0], c[1]) and not far((c[1], c[0])):
        return c[1], c[0], 'coords', 'latitude/longitude in the report'
    for k in ('INCIDENT_LOCATION', 'LOCATION_ADDRESS', 'LOCATION_STREET1', 'DESCRIPTION_OF_INCIDENT'):
        c = text_coords(r[k] or '')
        # coordinates found in free text need a named city nearby to be trusted
        if c and cxy and not far((c[1], c[0])):
            return c[1], c[0], 'text', f'coordinates in the report text ({k.lower().replace("_", " ")})'
    g = census.get(r['SEQNOS'])
    if g and in_us(g[1], g[0]) and not far(g[:2]):
        return g[0], g[1], 'address', f'street address {g[3]} (U.S. Census Geocoder, {"exact" if g[2] == "Exact" else "close"} match)'
    n = NAMED.match(r, cxy) if NAMED else None
    if n:
        LINKS[r['SEQNOS']] = (n['src'], n['url'])
        if n['kind'] == 'place':
            return n['lon'], n['lat'], 'place', f"{n['name']}, named in the report ({n['src']})"
        return n['lon'], n['lat'], 'city', f"{n['name']}, the town named in the report ({n['src']} center)"
    o = offset_point(r, cxy)
    if o and in_us(o[0][1], o[0][0]):
        return o[0][0], o[0][1], 'offset', o[1]
    if cxy:
        return cxy[0], cxy[1], 'city', f'nearest city {r["LOCATION_NEAREST_CITY"].title()} (Census place center)'
    return None


def iso(s):
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


DRAIN = re.compile(r'DRAIN|SEWER|CATCH ?BASIN|OUTFALL|CULVERT|MANHOLE|SUMP|INLET|GUTTER|PIPE')
WATERWORD = re.compile(r'RIVER|CREEK|LAKE|BAY|HARBOR|CHANNEL|BROOK|STREAM|CANAL|SLIP|MARINA|SOUND|GULF|OCEAN|BAYOU|STRAIT|INLET')

# ─── State boundaries (for reports with no state, e.g. offshore) ──────────────
os.makedirs(WORK, exist_ok=True)


def to_geojson(src, out, *args):
    """Convert once with ogr2ogr (the bake venv has no shapefile/GeoPackage reader)."""
    if not os.path.exists(out):
        import subprocess
        # -skipfailures: a handful of the 900+ species files carry broken shapes; they are dropped, not the layer
        subprocess.run(['ogr2ogr', '-q', '-skipfailures', '-f', 'GeoJSON', '-lco', 'COORDINATE_PRECISION=6', out, src, *args], check=True)
    return json.load(open(out))['features']


STATE_GEOMS, STATE_NAMES = [], {}
for f in to_geojson(ds('census', 'raw', 'tl_2022_us_state.shp'), ds('census', 'work', 'states.geojson'), '-t_srs', 'EPSG:4326'):
    STATE_GEOMS.append((f['properties']['STUSPS'], make_valid(shape(f['geometry']))))
    STATE_NAMES[f['properties']['STUSPS']] = f['properties']['NAME']
stree = STRtree([g for _, g in STATE_GEOMS])


def state_at(lon, lat):
    pt = Point(lon, lat)
    hit = [STATE_GEOMS[k][0] for k in stree.query(pt, predicate='intersects')]
    if hit:
        return hit[0]
    k = stree.nearest(pt)
    return STATE_GEOMS[k][0] if STATE_GEOMS[k][1].distance(pt) < 1.0 else None   # within ~100 km offshore


# ─── Incidents ─────────────────────────────────────────────────────────────────
inc = {}
for f in sorted(glob.glob(ds('nrc', 'work', 'nrc_cand_*.csv'))):
    for r in csv.DictReader(open(f)):
        s = r['SEQNOS']
        i = inc.setdefault(s, dict(r=r, mats=[], oil=False, gal=0.0, galknown=False))
        nm = (r['NAME_OF_MATERIAL'] or '').strip().upper()
        if nm and nm not in i['mats']:
            i['mats'].append(nm)
        if OIL.search(nm):
            i['oil'] = True
            g = gallons(r['AMOUNT_IN_WATER'], r['UNIT_OF_MEASURE_REACH_WATER']) or gallons(r['AMOUNT_OF_MATERIAL'], r['UNIT_OF_MEASURE'])
            if g:
                i['gal'] += g
                i['galknown'] = True

# Places named in the location fields (scripts/national/nrc/named.py: USGS GNIS + Census places), prepared on every
# oil-to-water report first so names too big to point at (Puget Sound) are known.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national', 'nrc'))
from named import NamedPlaces  # noqa: E402
LINKS = {}   # NRC report → (source, URL) of the named place it was placed at
water_rows = [i['r'] for i in inc.values() if i['oil'] and (i['r']['MEDIUM_DESC'] or '').upper() == 'WATER']
NAMED = NamedPlaces()
NAMED.prepare(water_rows, lambda r: city_xy(r['LOCATION_NEAREST_CITY'], r['LOCATION_STATE']))
print(f'named places prepared over {len(water_rows)} reports', flush=True)

recs = []
for s, i in inc.items():
    r = i['r']
    if not i['oil'] or (r['MEDIUM_DESC'] or '').upper() != 'WATER':
        continue
    loc = locate(r)
    st = (r['LOCATION_STATE'] or '').strip().upper()
    if st not in STATE_NAMES:
        st = state_at(loc[0], loc[1]) if loc else None
    if not st or (only and st not in only):
        continue
    bw = (r['BODY_OF_WATER'] or '').upper()
    match = 'drain' if DRAIN.search(bw) and not WATERWORD.search(bw) else 'water'
    recs.append(dict(i, seq=s, loc=loc, match=match, st=st))

seen, incidents = {}, []
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
    incidents.append(i)
print(f'oil-to-water reports {len(recs)}; incidents {len(incidents)}; located {sum(1 for i in incidents if i["loc"])}', flush=True)

# ─── Critical habitat (national dataset crithab: scripts/national/crithab/build.py, then index.py) ─────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'national', 'crithab'))
import index as crithab  # noqa: E402
ch_species = crithab.species
crithab_near = crithab.near
print(f'critical habitat: {len(ch_species)} species', flush=True)


# ─── Protected areas (USGS PAD-US 4.1 Combined, national) ──────────────────────
# The same selection as padus.py (Lake Michigan): managed for nature or multiple uses (GAP 1-3), plus land a public agency
# owns outright (GAP 4 fee land of federal, state, local and regional agencies); no proclamation boundaries. The national
# file (dataset padus: raw/padus41_combined.parquet, the Source Cooperative copy of the USGS release) is filtered once with
# ogr2ogr, then reduced to the areas within 5 km of a located report (work/national/padus_near.json, on the laptop).
PA_NEAR = os.path.join(WORK, f"padus_near{'-' + '-'.join(sorted(only)) if only else ''}.json")   # a --states test keeps its own
PA_WHERE = ("FeatClass <> 'Proclamation' AND (GAP_Sts IN ('1','2','3') OR "
            "(GAP_Sts = '4' AND FeatClass = 'Fee' AND Mang_Type IN ('FED','STAT','LOC','DIST')))")
PA_FIELDS = 'FeatClass,Mang_Type,Mang_Name,Loc_Mang,Des_Tp,Loc_Ds,Unit_Nm,GAP_Sts,Pub_Access,GIS_Acres,Agg_Src,Src_Date,State_Nm'
located_pts = [(i['loc'][0], i['loc'][1]) for i in incidents if i['loc']]
if not os.path.exists(PA_NEAR) and os.path.exists(ds('padus', 'raw', 'padus41_combined.parquet')):
    import subprocess
    seq = ds('padus', 'work', 'padus_selected.geojsonl')
    if not os.path.exists(seq):
        subprocess.run(['ogr2ogr', '-q', '-skipfailures', '-f', 'GeoJSONSeq', '-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=6',
                        seq, ds('padus', 'raw', 'padus41_combined.parquet'), '-where', PA_WHERE, '-select', PA_FIELDS], check=True)
    # 5 km ≈ 0.05° of latitude; longitude degrees shrink toward the poles, so the boxes widen with latitude
    boxes = [box(x - 0.05 / max(0.2, math.cos(math.radians(y))), y - 0.05, x + 0.05 / max(0.2, math.cos(math.radians(y))), y + 0.05) for x, y in located_pts]
    ptree = STRtree(boxes)
    keep = []
    with open(seq) as fh:
        for line in fh:
            f = json.loads(line)
            if not f.get('geometry'):
                continue
            g = shape(f['geometry'])
            if len(ptree.query(g, predicate='intersects')):
                keep.append(f)
    json.dump(keep, open(PA_NEAR, 'w'))
pa_feats = json.load(open(PA_NEAR)) if os.path.exists(PA_NEAR) else []
DES = {}
des_csv = ds('padus', 'work', 'designations.csv')
if os.path.exists(des_csv):
    DES = {r['Code']: r['Dom'] for r in csv.DictReader(open(des_csv))}
# One area per name + manager + designation + state, its parcels merged (as analyze.py).
GAP_RANK = {'1': 1, '2': 2, '3': 3, '4': 4}
groups = {}
for f in pa_feats:
    p = f['properties']
    nm = ' '.join((p.get('Unit_Nm') or '').split()) or 'Unnamed protected area'
    key = (nm.upper(), p.get('Mang_Name') or '', p.get('Des_Tp') or '', p.get('State_Nm') or '')
    a = groups.get(key)
    if a is None:
        a = groups[key] = dict(n=nm, mt=p.get('Mang_Type') or 'UNK', mn=p.get('Mang_Name') or '', lm=(p.get('Loc_Mang') or '').strip(),
                               d=DES.get(p.get('Des_Tp') or '', p.get('Des_Tp') or ''), ld=(p.get('Loc_Ds') or '').strip(),
                               gap=p.get('GAP_Sts'), acc=p.get('Pub_Access') or 'UK', ac=0, fc=p.get('FeatClass'),
                               src=(p.get('Agg_Src') or '').strip(), sd=(p.get('Src_Date') or '').strip(), st=p.get('State_Nm') or '', parts=[])
    a['ac'] += p.get('GIS_Acres') or 0
    if GAP_RANK.get(p.get('GAP_Sts'), 9) < GAP_RANK.get(a['gap'], 9):
        a['gap'] = p.get('GAP_Sts')
    a['parts'].append(make_valid(shape(f['geometry'])))
pa_areas = list(groups.values())
pa_by_zone = collections.defaultdict(lambda: ([], []))
for k, a in enumerate(pa_areas):
    g = a['parts'][0] if len(a['parts']) == 1 else shapely.union_all([x.buffer(0) for x in a['parts']])
    a['geom'] = g
    del a['parts']
    c = g.representative_point()
    z = zone_of(c.x, c.y)
    if z:
        pa_by_zone[z][0].append(transform(FWD[z], g))
        pa_by_zone[z][1].append(k)
pa_tree = {z: (STRtree(gs), gs, ix) for z, (gs, ix) in pa_by_zone.items()}
print(f'protected areas near reports: {len(pa_feats)} parcels → {len(pa_areas)} areas', flush=True)


def areas_near(lon, lat, R):
    z = zone_of(lon, lat)
    if z not in pa_tree:
        return []
    tree, geoms, idx = pa_tree[z]
    x, y = FWD[z](lon, lat)
    pt = Point(x, y)
    return sorted([[idx[k], round(geoms[k].distance(pt) / 100) * 100] for k in tree.query(pt, predicate='dwithin', distance=R)], key=lambda v: v[1])


# ─── Output: one file per state ───────────────────────────────────────────────
by_state = collections.defaultdict(list)
for i in incidents:
    r = i['r']
    p = dict(seq=i['seq'], y=int(r['YEAR']), d=iso(r['INCIDENT_DATE_TIME']) or iso(r['DATE_TIME_RECEIVED']),
             rec=iso(r['DATE_TIME_RECEIVED']), t=clean(r['TYPE_OF_INCIDENT']).title(), c=clean(r['INCIDENT_CAUSE']).capitalize(),
             city=clean(r['LOCATION_NEAREST_CITY']).title(), pc=place_name(r['LOCATION_NEAREST_CITY'], i['st']),
             st=i['st'], county=county_name(r['LOCATION_COUNTY'], i['st']),
             il=clean(r['INCIDENT_LOCATION'], 200), addr=clean(r['LOCATION_ADDRESS'], 120), w=clean(r['BODY_OF_WATER'], 80),
             trib=clean(r['TRIBUTARY_OF'], 80), med=clean(r['MEDIUM_DESC']).lower(), m=i['mats'][:4],
             g=round(i['gal'], 1) if i['galknown'] else None,
             org=clean(r['RESPONSIBLE_ORG_TYPE']).capitalize(), pot=r['POTENTIAL_FLAG'] == 'Y', desc=clean(r['DESCRIPTION_OF_INCIDENT'], 900),
             match=i['match'], dups=i['dups'])
    if i['loc']:
        lon, lat, loc, how = i['loc']
        if i['seq'] in LINKS:
            p.update(hs=LINKS[i['seq']][0], hu=LINKS[i['seq']][1])   # the named place's own source, linked on the card
        p.update(lon=round(lon, 5), lat=round(lat, 5), loc=loc, how=how, r=RADIUS[loc], ch=crithab_near(lon, lat, RADIUS[loc]),
                 pa=areas_near(lon, lat, RADIUS[loc]))
    by_state[i['st']].append(p)

sdir = os.path.join(OUT, f'state-{VERSION}')
os.makedirs(sdir, exist_ok=True)
regions = []
pdir = os.path.join(OUT, f'state-pa-{VERSION}')
os.makedirs(pdir, exist_ok=True)
AREA_KEYS = ('n', 'mt', 'mn', 'lm', 'd', 'ld', 'gap', 'acc', 'fc', 'src', 'sd', 'st')
for st, pts in sorted(by_state.items()):
    used = sorted({s for p in pts for s, _ in p.get('ch', [])})
    # this state's protected areas, renumbered; its map file is simplified (about 15 m) like Lake Michigan's
    ids = sorted({k for p in pts for k, _ in p.get('pa', [])})
    ren = {k: n for n, k in enumerate(ids)}
    for p in pts:
        if p.get('pa'):
            p['pa'] = [[ren[k], m] for k, m in p['pa']]
    areas = [{x: pa_areas[k][x] for x in AREA_KEYS} | dict(ac=round(pa_areas[k]['ac'])) for k in ids]
    json.dump(dict(version=VERSION, region=st, name=STATE_NAMES.get(st, st), areas=areas, points=pts), open(os.path.join(sdir, f'{st}.json'), 'w'), separators=(',', ':'))
    feats = [dict(type='Feature', properties=dict(i=n, gap=int(pa_areas[k]['gap'] or 4), mt=pa_areas[k]['mt']),
                  geometry=mapping(shapely.transform(pa_areas[k]['geom'].simplify(0.00015, preserve_topology=True), lambda c: c.round(5)))) for n, k in enumerate(ids)]
    json.dump(dict(type='FeatureCollection', features=feats), open(os.path.join(pdir, f'{st}.geojson'), 'w'), separators=(',', ':'))
    ys = [p['y'] for p in pts]
    regions.append(dict(id=st, name=STATE_NAMES.get(st, st), n=len(pts), located=sum(1 for p in pts if p.get('loc')),
                        near_ch=sum(1 for p in pts if p.get('ch')), near_pa=sum(1 for p in pts if p.get('pa')), areas=len(ids),
                        years=[min(ys), max(ys)], species=len(used)))
rfile = os.path.join(OUT, f'regions-{VERSION}.json')
if only and os.path.exists(rfile):   # a --states test replaces its states in the list, keeping the rest
    regions = [r for r in json.load(open(rfile))['regions'] if r['id'] not in only] + regions
    regions.sort(key=lambda r: r['id'])
json.dump(dict(version=VERSION, regions=regions, ch_species=ch_species), open(rfile, 'w'), separators=(',', ':'))
print(json.dumps(dict(states=len(regions), incidents=len(incidents), near_ch=sum(r['near_ch'] for r in regions),
                      top=sorted(((r['n'], r['id']) for r in regions), reverse=True)[:8])), flush=True)

# ─── Lake Michigan: add critical habitat to its file ──────────────────────────
lmf = os.path.join(OUT, f'lm-spills-{VERSION}.json')
if os.path.exists(lmf) and not only:
    lm = json.load(open(lmf))
    for p in lm['points']:
        if p.get('loc'):
            p['ch'] = crithab_near(p['lon'], p['lat'], p['r'])
    lm['ch_species'] = ch_species
    json.dump(lm, open(lmf, 'w'), separators=(',', ':'))
    print(f'Lake Michigan: critical habitat near {sum(1 for p in lm["points"] if p.get("ch"))} reports', flush=True)
