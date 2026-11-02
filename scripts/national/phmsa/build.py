"""
National dataset `phmsa` (docs/NATIONAL_DATA.md): U.S. pipeline accidents from PHMSA (Pipeline and Hazardous Materials Safety Administration), the whole
country at once: hazardous liquid accident reports (form PHMSA F 7000-1), January 2010 to present.

Inputs, from phmsa.dot.gov/data-and-statistics/pipeline/distribution-transmission-gathering-lng-and-liquid-accident-and-incident-data
(the site refuses scripted downloads, so a person fetches the zips; weekly.sh unzips each into data/spills/phmsa/raw/<zip name>/):
  accident_hazardous_liquid_jan2010_present                  form F 7000-1, regulated liquid lines
  accident_gravity_reporting_regulated_jul2020_present        form F 7000-2, gravity lines and gathering lines that only
                                                              report (from 2021); fewer fields, the same ones used here

Operators file these after the fact, so they carry measured volumes (barrels released and recovered), the cause and
the operator; each names the NRC report(s) the operator phoned in, which links it to the NRC reports on the map.
People's names in the file (preparer, contacts) are not carried over.

  data/spills/venv/bin/python scripts/national/phmsa/build.py [version]
Outputs: data/national/phmsa/build/<version>/ — pipeline.json + pipeline/<year>.json (liquids), gas.json + gas/<year>.json
(gas), dataset.json (catalog entry) — and data/national/phmsa/work/phmsa.json (every liquid accident, for the /spills
analysis).
"""
import csv, glob, json, math, os, re, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds

VERSION = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('NATIONAL_VERSION') or __import__('time').strftime('%Y%m%d')
OUT = ds('phmsa', 'build', VERSION)   # published by scripts/national/publish.mjs phmsa <version>
os.makedirs(OUT, exist_ok=True)
csv.field_size_limit(10 ** 8)

COMMODITY = {
    'CRUDE OIL': 'crude',
    'REFINED AND/OR PETROLEUM PRODUCT (NON-HVL) WHICH IS A LIQUID AT AMBIENT CONDITIONS': 'refined',
    'HVL OR OTHER FLAMMABLE OR TOXIC FLUID WHICH IS A GAS AT AMBIENT CONDITIONS': 'hvl',
    'CO2 (CARBON DIOXIDE)': 'co2',
    'BIOFUEL / ALTERNATIVE FUEL(INCLUDING ETHANOL BLENDS)': 'bio',
}


def num(s):
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def yes(s):
    return (s or '').strip().upper() == 'YES'


def nrc_nums(*vals):
    out = []
    for v in vals:
        for n in re.findall(r'\b\d{6,8}\b', v or ''):
            if n not in out:
                out.append(n)
    return out


# Offshore incidents name no city or county: say which sea, how far off which state's coast, and the operator's own
# offshore fields (Outer Continental Shelf area and block, state-waters area, water depth).
_STATES = None


def offshore_place(r, lat, lon):
    global _STATES
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree
    if _STATES is None:
        feats = json.load(open(ds('census', 'work', 'states.geojson')))['features']
        geoms = [shape(f['geometry']) for f in feats]
        _STATES = (STRtree(geoms), geoms, [f['properties']['NAME'] for f in feats])
    tree, geoms, names = _STATES
    pt = Point(lon, lat)
    k = tree.nearest(pt)
    deg = geoms[k].distance(pt)
    miles = deg * 69.0 * (0.5 + 0.5 * math.cos(math.radians(lat)))   # rough degrees → miles at this latitude
    if -98 <= lon <= -80.5 and 18 <= lat <= 31:
        sea = 'Gulf of Mexico'
    elif lon < -129 and lat > 50:
        sea = 'Off Alaska'
    elif lon <= -117 and lat < 49:
        sea = 'Pacific Ocean'
    elif lon > -82 and lat > 24:
        sea = 'Atlantic Ocean'
    else:
        sea = 'Offshore'
    where = f'{sea}, about {round(miles)} mi off {names[k]}' if miles >= 3 else f'{sea}, off {names[k]}'
    bits = [where]
    ocs = clean(r.get('OFF_OCS_AREA')).title()
    if ocs:
        blk = clean(r.get('OFF_OCS_BLOCK'))
        bits.append(f'{ocs} block {blk} (Outer Continental Shelf)' if blk else f'{ocs} (Outer Continental Shelf)')
    elif clean(r.get('OFF_INSTATE_AREA')):
        blk = clean(r.get('OFF_INSTATE_BLOCK'))
        bits.append(f"{clean(r.get('OFF_INSTATE_AREA')).title()}{f' block {blk}' if blk else ''} (state waters)")
    depth = num(r.get('OFF_WATER_DEPTH'))
    if depth:
        bits.append(f'{round(depth):,} ft deep')
    return ' · '.join(bits)


def clean(s, n=None):
    s = ' '.join((s or '').split())
    return s[:n] if n else s


def iso(s):
    m = re.match(r'(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?', s or '')
    if not m:
        return None
    mo, d, y, hh, mm = m.groups()
    return f'{y}-{int(mo):02d}-{int(d):02d}' + (f'T{int(hh):02d}:{mm}' if hh else '')


SOURCES = {'accident_hazardous_liquid_jan2010_present': 'line', 'accident_gravity_reporting_regulated_jul2020_present': 'gathering'}
rows = []
for name, kind in SOURCES.items():
    for f in glob.glob(ds('phmsa', 'raw', name, '*.txt')):
        rows += [dict(r, _kind=kind) for r in csv.DictReader(open(f, encoding='cp1252'), delimiter='\t')]
acc, detail, seen = [], {}, set()
for r in rows:
    # the two forms number their reports separately (20260101 is a different accident on each), so gathering-line
    # reports get a G prefix
    rid = ('G' if r['_kind'] == 'gathering' else '') + r['REPORT_NUMBER']
    if rid in seen:
        continue
    seen.add(rid)
    lat, lon = num(r['LOCATION_LATITUDE']), num(r['LOCATION_LONGITUDE'])
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        continue
    d = iso(r['LOCAL_DATETIME'])
    rel, rec = num(r['UNINTENTIONAL_RELEASE_BBLS']), num(r['RECOVERED_BBLS'])
    a = dict(id=rid, y=int(d[:4]), d=d, lat=round(lat, 5), lon=round(lon, 5),
             c=COMMODITY.get(r['COMMODITY_RELEASED_TYPE'], 'other'), sub=clean(r['COMMODITY_SUBTYPE']).capitalize(),
             bbl=rel, rec=rec, op=clean(r['NAME']),
             st=clean(r['ONSHORE_STATE_ABBREVIATION']) or clean(r.get('OFFSHORE_STATE_ABBREVIATION')),
             city=clean(r['ONSHORE_CITY_NAME']).title(), county=clean(r['ONSHORE_COUNTY_NAME']).title(),
             off=r['ON_OFF_SHORE'] == 'OFFSHORE', nrc=nrc_nums(r['NRC_RPT_NUM'], r['ADDITIONAL_NRC_REPORT_NUMBERS']),
             wh=offshore_place(r, lat, lon) if r['ON_OFF_SHORE'] == 'OFFSHORE' or not (r['ONSHORE_CITY_NAME'] or r['ONSHORE_COUNTY_NAME']).strip() else '',
             fat=int(num(r['FATAL']) or 0), inj=int(num(r['INJURE']) or 0), fire=yes(r['IGNITE_IND']), boom=yes(r['EXPLODE_IND']),
             water=yes(r['WATER_CONTAM_IND']), wild=yes(r['WILDLIFE_IMPACT_IND']), drink=yes(r['DRINKING_WATER_CONTAM_IND']),
             k=r['_kind'], cause=clean(r['CAUSE']).capitalize())   # also in the layer, for the /spills/reports causes chart
    acc.append(a)
    detail[a['id']] = dict(
        cause=clean(r['CAUSE']).capitalize(), cause_d=clean(r['CAUSE_DETAILS']).capitalize(),
        cdet=clean(r['COMMODITY_DETAILS']), fac=clean(r.get('PIPE_FAC_NAME')), seg=clean(r.get('SEGMENT_NAME')),
        wn=clean(r['WATER_NAME']) or clean(r['REL_WATER_NAME']), hca=yes(r.get('COMMODITY_REACHED_HCA')),
        cost_env=num(r['EST_COST_ENVIRONMENTAL']), cost_em=num(r['EST_COST_EMERGENCY']),
        cost_prop=num(r['EST_COST_PROP_DAMAGE']), narr=clean(r['NARRATIVE'], 4000))

os.makedirs(ds('phmsa', 'work'), exist_ok=True)
json.dump(acc, open(ds('phmsa', 'work', 'phmsa.json'), 'w'), separators=(',', ':'))   # for the /spills analysis

# Map layer: one row per accident, fields named once; full records by year, loaded when a card opens.
def write_layer(name, items, details, fields):
    ops = sorted(set(a['op'] for a in items))
    oi = {o: i for i, o in enumerate(ops)}
    layer = dict(version=VERSION, fields=fields, operators=ops,
                 range=[min(a['d'] for a in items)[:10], max(a['d'] for a in items)[:10]],
                 rows=[[a[k] if k != 'o' else oi[a['op']] for k in fields] for a in items])
    json.dump(layer, open(os.path.join(OUT, f'{name}.json'), 'w'), separators=(',', ':'))
    ddir = os.path.join(OUT, name)
    os.makedirs(ddir, exist_ok=True)
    by_year = {}
    for a in items:
        by_year.setdefault(a['y'], {})[a['id']] = details[a['id']]
    for y, d in by_year.items():
        json.dump(d, open(os.path.join(ddir, f'{y}.json'), 'w'), separators=(',', ':'))
    print(f'{name}: {len(items)} {layer["range"]}; layer {os.path.getsize(os.path.join(OUT, f"{name}.json")) // 1024} KB; '
          f'{len(by_year)} detail files; with NRC numbers {sum(1 for a in items if a["nrc"])}')


write_layer('pipeline', acc, detail, ['id', 'y', 'd', 'lat', 'lon', 'c', 'sub', 'bbl', 'rec', 'o', 'st', 'city', 'county', 'off', 'nrc',
                                      'fat', 'inj', 'fire', 'boom', 'water', 'wild', 'drink', 'k', 'cause', 'wh'])

# ─── Gas pipeline incidents (forms F 7100.1 distribution, F 7100.2 transmission and gathering, F 7100.3 LNG) ───────
# Natural gas and other gases released to the air: volumes in thousand standard cubic feet (MCF), with deaths,
# injuries, evacuations, fire and explosion. Each form numbers its reports separately, so ids carry a prefix.
GAS = {  # zip name: (prefix, system, latitude field, longitude field, state, city, county)
    'incident_gas_transmission_gathering_jan2010_present': ('T', 'transmission', 'LOCATION_LATITUDE', 'LOCATION_LONGITUDE',
                                                            'ONSHORE_STATE_ABBREVIATION', 'ONSHORE_CITY_NAME', 'ONSHORE_COUNTY_NAME'),
    'incident_gas_distribution_jan2010_present': ('D', 'distribution', 'LOCATION_LATITUDE', 'LOCATION_LONGITUDE',
                                                  'LOCATION_STATE_ABBREVIATION', 'LOCATION_CITY_NAME', 'LOCATION_COUNTY_NAME'),
    'incident_liquefied_natural_gas_jan2011_present': ('L', 'lng', 'FACILITY_LATITUDE', 'FACILITY_LONGITUDE', 'FACILITY_STATE', None, None),
}
gas, gdetail = [], {}
for name, (pre, system, flat, flon, fst, fcity, fcounty) in GAS.items():
    for f in glob.glob(ds('phmsa', 'raw', name, '*.txt')):
        for r in csv.DictReader(open(f, encoding='cp1252'), delimiter='\t'):
            lat, lon = num(r.get(flat)), num(r.get(flon))
            d = iso(r['LOCAL_DATETIME'])
            if lat is None or lon is None or not d or not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
                continue
            gid = pre + r['REPORT_NUMBER']
            if gid in gdetail:
                continue
            g = dict(id=gid, y=int(d[:4]), d=d, lat=round(lat, 5), lon=round(lon, 5), s=system,
                     gas=clean(r['COMMODITY_RELEASED_TYPE']).capitalize(), mcf=num(r['UNINTENTIONAL_RELEASE']),
                     op=clean(r['NAME']), st=clean(r.get(fst)), city=clean(r.get(fcity)).title() if fcity else '',
                     county=clean(r.get(fcounty)).title() if fcounty else '',
                     nrc=nrc_nums(r['NRC_RPT_NUM'], r['ADDITIONAL_NRC_REPORT_NUMBERS']),
                     fat=int(num(r['FATAL']) or 0), inj=int(num(r['INJURE']) or 0), fire=yes(r['IGNITE_IND']), boom=yes(r['EXPLODE_IND']),
                     evac=int(num(r.get('NUM_PUB_EVACUATED')) or 0), cause=clean(r['CAUSE']).capitalize(),
                     wh=offshore_place(r, lat, lon) if (r.get('ON_OFF_SHORE') or '') == 'OFFSHORE' or not (clean(r.get(fcity)) if fcity else '') and not (clean(r.get(fcounty)) if fcounty else '') else '')
            gas.append(g)
            gdetail[gid] = dict(
                cause=clean(r['CAUSE']).capitalize(), cause_d=clean(r['CAUSE_DETAILS']).capitalize(),
                fac=clean(r.get('PIPE_FAC_NAME') or r.get('FACILITY_NAME')), seg=clean(r.get('SEGMENT_NAME')),
                planned=num(r.get('INTENTIONAL_RELEASE')), cost_gas=num(r.get('EST_COST_UNINTENTIONAL_RELEASE')),
                cost_em=num(r.get('EST_COST_EMERGENCY')), cost_prop=num(r.get('EST_COST_PROP_DAMAGE')), narr=clean(r['NARRATIVE'], 4000))
if gas:
    write_layer('gas', gas, gdetail, ['id', 'y', 'd', 'lat', 'lon', 's', 'gas', 'mcf', 'o', 'st', 'city', 'county', 'nrc',
                                      'fat', 'inj', 'fire', 'boom', 'evac', 'cause', 'wh'])

json.dump({
    'name': 'Pipeline accidents and incidents (PHMSA)',
    'source': {'publisher': 'U.S. Department of Transportation, Pipeline and Hazardous Materials Safety Administration',
               'url': 'https://www.phmsa.dot.gov/data-and-statistics/pipeline/distribution-transmission-gathering-lng-and-liquid-accident-and-incident-data'},
    'license': 'Public domain (17 U.S.C. § 105)', 'coverage': 'United States and offshore', 'cadence': 'PHMSA re-exports its files in batches; operators file within 30 days',
    'files_about': {'pipeline.json': 'hazardous liquid accidents (forms F 7000-1, F 7000-2), one compact row each',
                    'pipeline/<year>.json': 'their full records', 'gas.json': 'gas incidents (forms F 7100.1/.2/.3)', 'gas/<year>.json': 'their full records'},
    'summary': {'liquid': len(acc), 'gas': len(gas)},
}, open(os.path.join(OUT, 'dataset.json'), 'w'), indent=1)
print(f'→ {OUT}')
