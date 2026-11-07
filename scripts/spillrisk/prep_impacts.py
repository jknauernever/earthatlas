"""Spill scenarios: index the impact layers on the scenario grid (0.005 deg lat x 0.0075 deg lon, ~550 m), once.

For every feature we record the grid cells it touches (cell centers inside it, plus the cells along its outline every
~150 m, so beaches, shorelines and small kelp patches are caught). The scenario bake then intersects oil cells with this
index. Layers (all clipped to the Salish box):
  friends   Friends of the San Juans habitat (public/permits-data/friends-habitat.geojson): bull kelp, deepwater eelgrass
            edge, herring spawning grounds, surf smelt / sand lance documented and potential spawning beaches.
            San Juan County only. Friends logo must show with these.
  crithab   ESA critical habitat, final designations: U.S. Fish and Wildlife Service (crithab.gpkg) and NOAA Fisheries
            (raw/nmfs/*.geojson), from the national crithab dataset. U.S. waters only.
  padus     PAD-US 4.1 protected areas (USGS), excluding BOEM outer-continental-shelf lease blocks (Des_Tp OCS), which
            are lease geography, not protected areas. U.S. only.

usage: data/spillrisk/env/bin/python -I scripts/spillrisk/prep_impacts.py
out:   data/spillrisk/impact/index.json  {grid, features:[{id,layer,group,name,src,url}], cells:{"iy,ix":[fid,...]}}
"""
import glob, json, os, re
import numpy as np
import shapely
from shapely.geometry import shape, box
from shapely.validation import make_valid

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
OUT = os.path.join(ROOT, 'data/spillrisk/impact')
DLAT, DLON = 0.005, 0.0075
W, S, E, N = -125.3, 47.0, -121.9, 49.6
BOX = box(W, S, E, N)
STEP = 0.0015  # outline sampling, ~150 m

features, cells = [], {}


def add(layer, group, name, src, url, geom):
    geom = make_valid(geom).intersection(BOX)
    if geom.is_empty:
        return
    x0, y0, x1, y1 = geom.bounds
    iy = np.arange(int(np.floor(y0 / DLAT)), int(np.floor(y1 / DLAT)) + 1)
    ix = np.arange(int(np.floor(x0 / DLON)), int(np.floor(x1 / DLON)) + 1)
    got = set()
    if geom.geom_type in ('Polygon', 'MultiPolygon', 'GeometryCollection') and geom.area > 0:
        gx, gy = np.meshgrid(ix, iy)
        inside = shapely.contains_xy(geom, (gx + 0.5) * DLON, (gy + 0.5) * DLAT)
        got |= set(zip(gy[inside].tolist(), gx[inside].tolist()))
        outline = geom.boundary
    else:
        outline = geom
    pts = shapely.get_coordinates(shapely.segmentize(outline, STEP))
    if len(pts):
        got |= set(zip(np.floor(pts[:, 1] / DLAT).astype(int).tolist(), np.floor(pts[:, 0] / DLON).astype(int).tolist()))
    if not got:
        return
    fid = len(features)
    features.append(dict(id=fid, layer=layer, group=group, name=name, src=src, url=url))
    for c in got:
        cells.setdefault(f'{c[0]},{c[1]}', []).append(fid)


# Friends of the San Juans
FRIENDS_PAGE = 'https://sanjuans.org/our-work/shoreline-science-and-mapping/'
FR = {'hkb': 'Bull kelp', 'hee': 'Deepwater eelgrass edge', 'hhe': 'Herring spawning grounds',
      'hfd': 'Surf smelt & sand lance spawning beaches (documented)', 'hfp': 'Surf smelt & sand lance spawning beaches (potential)'}
for f in json.load(open(os.path.join(ROOT, 'public/permits-data/friends-habitat.geojson')))['features']:
    h = f['properties'].get('h')
    if h in FR and f['geometry']:
        add('friends', FR[h], f['properties'].get('name') or FR[h], 'Friends of the San Juans', FRIENDS_PAGE, shape(f['geometry']))
print('friends', len(features), flush=True)


def nmfs_name(com, entity):
    a, _, b = com.partition(', ')
    name = f'{b} {a.lower()}' if b else com
    name = name[:1].upper() + name[1:]
    pop = re.search(r'\[(.+?)\]', entity or '')
    pop = re.sub(r'\s+(ESU|DPS)$', '', pop.group(1)) if pop else ''
    return f'{name} ({pop})' if pop else name


# ESA critical habitat: FWS (pre-clipped with ogr2ogr to the box) and NOAA Fisheries
n0 = len(features)
for f in json.load(open(os.path.join(OUT, 'crithab_poly.geojson')))['features']:
    p = f['properties']
    if not f['geometry'] or 'PROPOSED' in str(p.get('STATUS') or '').upper():
        continue
    com = p.get('COMNAME') or p.get('CNAME') or p.get('SCINAME') or p.get('SNAME')
    if not com:
        continue
    com = com[:1].upper() + com[1:].lower() if com.isupper() else com
    add('crithab', com, com, 'U.S. Fish and Wildlife Service', 'https://ecos.fws.gov/ecp/report/table/critical-habitat.html',
        shape(f['geometry']))
for path in sorted(glob.glob(os.path.join(ROOT, 'data/national/crithab/raw/nmfs/*.geojson'))):
    fc = json.load(open(path))
    if fc.get('name', '').startswith(('All_', 'Proposed_')):
        continue
    for f in fc['features']:
        p = f['properties']
        if not f['geometry'] or 'PROPOSED' in str(p.get('CHSTATUS') or '').upper():
            continue
        g = shape(f['geometry'])
        if not g.intersects(BOX):
            continue
        nm = nmfs_name(str(p.get('COMNAME') or ''), p.get('LISTENTITY'))
        add('crithab', nm, nm, 'NOAA Fisheries', p.get('INPORTURL') or 'https://www.fisheries.noaa.gov/resource/map/national-esa-critical-habitat-mapper', g)
print('crithab', len(features) - n0, flush=True)

# PAD-US
n0 = len(features)
for f in json.load(open(os.path.join(OUT, 'padus.geojson')))['features']:
    p = f['properties']
    if not f['geometry'] or p.get('Des_Tp') == 'OCS':
        continue
    nm = p.get('Unit_Nm') or p.get('Loc_Nm') or 'Protected area'
    add('padus', nm, nm, f"PAD-US 4.1 (USGS); manager: {p.get('Mang_Name') or 'unknown'}",
        'https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview', shape(f['geometry']))
print('padus', len(features) - n0, flush=True)

json.dump(dict(grid=dict(dlat=DLAT, dlon=DLON), features=features, cells=cells),
          open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print('cells', len(cells), 'features', len(features))
