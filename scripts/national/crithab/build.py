"""
National dataset `crithab` (docs/NATIONAL_DATA.md): ESA critical habitat, both agencies, final designations.

  data/spills/venv/bin/python scripts/national/crithab/build.py [version]

Inputs (data/national/crithab/raw, on the offload drive):
  crithab.gpkg            every U.S. Fish and Wildlife Service species file (ecos.fws.gov crithab_all_shapefiles.zip,
                          one zip per species) merged into `poly` and `line` layers (scripts/national/crithab/merge_fws.sh)
  nmfs/<layer>.geojson    NOAA Fisheries, one per species layer (scripts/national/crithab/fetch_nmfs.py)
and data/national/esa-species/raw/ecos_listed.json (federal status and profile links; scripts/national/esa-species/fetch.sh).

Outputs:
  raw/crithab.json                    every final shape with species fields (offload drive)
  work/crithab_species.json           the species list: n, sci, fed (E/T), src, url
  work/crithab_zones.pkl              shapes projected and clipped per zone (lib.ZONES), for index.py (the laptop keeps these)
  build/<version>/species.json + dataset.json   (published by scripts/national/publish.mjs crithab <version>)
"""
import glob, json, os, pickle, re, subprocess, sys, time
import shapely
from shapely.geometry import shape, mapping, box
from shapely.ops import transform
from shapely.validation import make_valid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds, ZONES, FWD  # noqa: E402

VERSION = sys.argv[1] if len(sys.argv) > 1 else time.strftime('%Y%m%d')
NAT = ds('crithab', 'raw')
WORK = ds('crithab', 'work')
os.makedirs(WORK, exist_ok=True)


def clean(s, n=None):
    s = re.sub(r'\s+', ' ', str(s or '')).strip()
    return s[:n] if n else s


def to_geojson(src, out, *args):
    """Convert once with ogr2ogr (the bake venv has no GeoPackage reader). -skipfailures drops a few broken shapes."""
    if not os.path.exists(out):
        subprocess.run(['ogr2ogr', '-q', '-skipfailures', '-f', 'GeoJSON', '-lco', 'COORDINATE_PRECISION=6', out, src, *args], check=True)
    return json.load(open(out))['features']


# ─── Critical habitat, reduced once per projection zone ───────────────────────
# Species files spell their fields many ways (SCINAME, Sci_Name, SCINAM, SNAME…); the file name (FCH_<Genus>_<species>_<date>)
# is the last resort. Proposed and excluded areas are left out; FCH files without a status are final designations.
def first(p, *keys):
    for k in keys:
        if clean(p.get(k)):
            return clean(p.get(k))
    return ''


def sci_from_file(src):
    m = re.match(r'FCH_(.+?)_(\d{8}|Multiple)', src or '', re.I)
    return m.group(1).replace('_', ' ').capitalize() if m and not m.group(1).lower().startswith('multiple') else ''


CH_CACHE = os.path.join(NAT, 'crithab.json')
ZONE_CACHE = os.path.join(WORK, 'crithab_zones.pkl')
SPECIES_CACHE = os.path.join(WORK, 'crithab_species.json')
fresh = '--force' not in sys.argv and os.path.exists(ZONE_CACHE) and os.path.exists(SPECIES_CACHE) and (not os.path.exists(CH_CACHE) or os.path.getmtime(ZONE_CACHE) > os.path.getmtime(CH_CACHE))
if not fresh and not os.path.exists(CH_CACHE):
    feats = []
    for layer in ('poly', 'line'):
        for f in to_geojson(os.path.join(NAT, 'crithab.gpkg'), os.path.join(NAT, f'crithab_{layer}.geojson'), layer):
            p = f['properties']
            status = first(p, 'STATUS').upper()
            if not f['geometry'] or 'PROPOSED' in status or 'EXCLUDED' in status:
                continue
            feats.append(dict(sci=first(p, 'SCINAME', 'Sci_Name', 'SCINAM', 'SNAME', 'Species') or sci_from_file(p.get('srcfile')),
                              com=first(p, 'COMNAME', 'Comm_Name', 'COMNAM', 'CNAME', 'COMMON_NAM', 'COMNAMESP'),
                              geom=mapping(make_valid(shape(f['geometry']))), kind=layer, src='fws'))
    # NOAA Fisheries (fetch_nmfs.py): one GeoJSON per species layer; the "All_" compilations and proposed designations are left out
    for path in sorted(glob.glob(os.path.join(NAT, 'nmfs', '*.geojson'))):
        fc = json.load(open(path))
        if fc.get('name', '').startswith(('All_', 'Proposed_')):
            continue
        for f in fc['features']:
            p = f['properties']
            if not f['geometry'] or 'PROPOSED' in clean(p.get('CHSTATUS')).upper():
                continue
            feats.append(dict(sci=clean(p.get('SCIENAME')), com=clean(p.get('COMNAME')), entity=clean(p.get('LISTENTITY')),
                              fed=clean(p.get('LISTSTATUS')), url=clean(p.get('INPORTURL')),
                              geom=mapping(make_valid(shape(f['geometry']))), kind='nmfs', src='nmfs'))
    json.dump(feats, open(CH_CACHE, 'w'))
ch_feats = [] if fresh else json.load(open(CH_CACHE))

# Federal listing status and species profile from the FWS ECOS species catalog (dataset esa-species).
def norm_sci(s):
    s = re.sub(r'\(=[^)]*\)', ' ', (s or '').lower())
    return ' '.join(re.sub(r'[^a-z ]', ' ', s).split()[:3])


ecos = {}
for row in json.load(open(ds('esa-species', 'raw', 'ecos_listed.json')))['data']:
    com, sci, status, url = row[0], row[1]['value'], row[2], row[1]['url']
    for k in {norm_sci(sci), ' '.join(norm_sci(sci).split()[:2]), (com or '').lower()}:
        if k and (k not in ecos or status == 'Endangered'):
            ecos[k] = dict(fed='E' if status == 'Endangered' else 'T', url=url, com=com, sci=sci)
def nmfs_name(com, entity):
    """'Salmon, Chinook' + 'Salmon, Chinook [Puget Sound ESU]' → 'Chinook salmon (Puget Sound)'."""
    a, _, b = com.partition(', ')
    name = f'{b} {a.lower()}' if b else com
    name = name[:1].upper() + name[1:]
    pop = re.search(r'\[(.+?)\]', entity or '')
    pop = re.sub(r'\s+(ESU|DPS)$', '', pop.group(1)) if pop else ''
    return f'{name} ({pop})' if pop else name


ch_species, ch_index = [], {}
for f in ch_feats:
    if f.get('src') == 'nmfs':
        key = 'nmfs:' + (f['entity'] or f['sci']).lower()
        if key not in ch_index:
            ch_index[key] = len(ch_species)
            st = f['fed'].lower()
            ch_species.append(dict(n=nmfs_name(f['com'], f['entity']), sci=f['sci'], fed='E' if 'endangered' in st else 'T' if 'threatened' in st else None,
                                   src='NOAA Fisheries', url=f['url']))
        f['i'] = ch_index[key]
        continue
    key = norm_sci(f['sci']) or f['com'].lower()
    if not key:
        continue
    if key not in ch_index:
        e = ecos.get(key) or ecos.get(' '.join(key.split()[:2])) or ecos.get(f['com'].lower()) or {}
        ch_index[key] = len(ch_species)
        ch_species.append(dict(n=f['com'] or e.get('com') or f['sci'], sci=f['sci'] or e.get('sci', ''), fed=e.get('fed'),
                               src='U.S. Fish and Wildlife Service', url=e.get('url')))
    f['i'] = ch_index[key]
ch_feats = [f for f in ch_feats if 'i' in f]
if fresh:
    ch_species = json.load(open(SPECIES_CACHE))
else:
    json.dump(ch_species, open(SPECIES_CACHE, 'w'))
# Projected and clipped per zone once, then cached (the slow part of a run); rebuilt when crithab.json changes.
if fresh:
    raw = pickle.load(open(ZONE_CACHE, 'rb'))
else:
    raw = {}
    for z in ZONES:
        zb = box(z[2], z[3], z[4], z[5])
        geoms, idx = [], []
        for f in ch_feats:
            g = shape(f['geom'])
            if g.intersects(zb):
                geoms.append(transform(FWD[z[0]], g.intersection(zb)))
                idx.append(f['i'])
        raw[z[0]] = (shapely.to_wkb(geoms), idx)
    pickle.dump(raw, open(ZONE_CACHE, 'wb'))
print(f'critical habitat: {sum(len(v[1]) for v in raw.values())} zone shapes, {len(ch_species)} species', flush=True)


out = ds('crithab', 'build', VERSION)
os.makedirs(out, exist_ok=True)
json.dump(ch_species, open(os.path.join(out, 'species.json'), 'w'), separators=(',', ':'))
json.dump({
    'name': 'Critical habitat for threatened and endangered species (final designations)',
    'source': {'publisher': 'U.S. Fish and Wildlife Service and NOAA Fisheries',
               'url': 'https://ecos.fws.gov/ecp/report/table/critical-habitat.html',
               'url_noaa': 'https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper'},
    'license': 'Public domain (17 U.S.C. § 105)', 'coverage': 'United States and territories, land and sea',
    'cadence': 'Changes as designations are made or revised',
    'files_about': {'species.json': 'species list (n, sci, fed E/T, src, url) in the order index.py uses'},
    'summary': {'species': len(ch_species), 'zone_shapes': sum(len(v[1]) for v in raw.values())},
}, open(os.path.join(out, 'dataset.json'), 'w'), indent=1)
print(f'→ {out}')
