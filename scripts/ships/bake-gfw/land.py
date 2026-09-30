#!/usr/bin/env python3
"""
Land / water model for the GFW hourly track bake (scripts/ships/bake-gfw/).

A spot is WATER if ANY applicable source says it is water (Josh 2026-09-29), so a channel
that one map closes stays open. Equivalently, LAND = the intersection of the land of every
source that covers that spot:

  OSM   OpenStreetMap coastline land polygons (osmdata.openstreetmap.de, land-polygons-split-4326),
        everywhere. © OpenStreetMap contributors, ODbL 1.0.
  DNR   Alaska DNR "Alaska 1:63,360" coastline (digitised from USGS quads), all 37,362 polygons
        (3 "lagoon" features count as water). Alaska only: west of 129.9° W or east of 170° E,
        outside Canada (NHN work-unit index) and outside Russia (west of 168.97° W and north of
        64° N, or east of 170° E and north of 56° N). Credit: Alaska Department of Natural Resources.
  NHN   NRCan National Hydro Network (GeoBase, 1:50,000 or better), 48 BC coastal work units.
        NHN has no ocean polygon: sea = faces of polygonize(work-unit limit + HN_LITTORAL_1) that
        the littoral puts on its right ("the waterbody is located to the right of the littoral"),
        minus HD_ISLAND_2; canal / watercourse / tidal-river waterbodies are water too. Applies
        inside the downloaded work-unit limits. OGL-Canada; credit Natural Resources Canada, NHN.
  FLATS OSM natural=wetland / mud / shoal (+ tidal=yes flats) count as LAND: not navigable
        (fetch_flats.py, Josh 2026-09-30; high-water coastlines leave tidal flats as "water").
  Guard: another source may only open water that OSM calls land where that extra water is
        narrower than NARROW_M (morphological opening). Where an NHN littoral does not close,
        a whole mainland otherwise comes out as "sea".

Coordinates are native lon -180..180. Windows may extend past ±180 (a route across the
antimeridian): _draw() then also draws the geometries shifted by ±360.

Data (built by prepare_water.py, cached; CI restores them from the Actions cache / Blob):
  cache/land/osm/land_polygons.shp (+.dbf/.shx/.prj)   OSM split land polygons, global (~1.3 GB)
  cache/land/extras-v1.pkl                             DNR + NHN + Canada index (Pacific), ~100 MB
Only the OSM polygons inside the stage's boxes are loaded (ogr2ogr -spat, cached per box).
"""
import glob, gzip, hashlib, json, os, pickle, subprocess, time
import numpy as np
import shapely
from shapely.geometry import shape, box, Polygon, MultiPolygon
from shapely.ops import polygonize, unary_union
from PIL import Image, ImageDraw
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
LAND_DIR = os.environ.get('GFW_LAND_DIR', os.path.join(HERE, 'cache', 'land'))
OSM_SHP = os.path.join(LAND_DIR, 'osm', 'land_polygons.shp')
EXTRAS = os.path.join(LAND_DIR, 'extras-v1.pkl')
FLATS = os.path.join(LAND_DIR, 'flats-v1.pkl')   # fetch_flats.py: tidal flats / marsh / shoals = not navigable
NARROW_M = 400


def polys(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [q for p in getattr(g, 'geoms', []) for q in polys(p)]


# ─── extras: Alaska DNR + NRCan NHN (built once by prepare_water.py) ─────────
def nhn_unit(d):
    import shapefile

    def f(n):   # file prefixes differ per layer (NHN_08HB001___WORKUNIT_LIMIT_2 vs NHN_08HB001_2_1_HN_LITTORAL_1)
        g = glob.glob(os.path.join(d, f'*{n}.shp'))
        return g[0][:-4] if g else None
    rd = lambda n: shapefile.Reader(f(n))
    if not f('HN_LITTORAL_1') or not f('WORKUNIT_LIMIT_2'):
        return None
    lim = unary_union([shape(s.__geo_interface__) for s in rd('WORKUNIT_LIMIT_2').shapes()])
    lits = [shape(s.__geo_interface__) for s in rd('HN_LITTORAL_1').shapes()]
    lits = [l for g in lits for l in (g.geoms if hasattr(g, 'geoms') else [g])]
    faces = [x for x in polygonize(unary_union([lim.boundary] + lits)) if lim.contains(x.representative_point())]
    tree = shapely.STRtree(faces)
    wv = np.zeros(len(faces)); lv = np.zeros(len(faces))
    for l in lits:
        c = np.asarray(l.coords)
        for i in range(0, len(c) - 1, max(1, (len(c) - 1) // 8)):
            (x0, y0), (x1, y1) = c[i], c[i + 1]
            dx, dy = x1 - x0, y1 - y0
            L = (dx * dx + dy * dy) ** 0.5
            if L == 0:
                continue
            mx, my, e = (x0 + x1) / 2, (y0 + y1) / 2, 2e-6
            for k in tree.query(shapely.Point(mx + dy / L * e, my - dx / L * e), predicate='intersects'):
                wv[k] += 1   # right of the littoral = water
            for k in tree.query(shapely.Point(mx - dy / L * e, my + dx / L * e), predicate='intersects'):
                lv[k] += 1
    water = [x for x, a, b in zip(faces, wv, lv) if a > b]
    isl = [shape(s.__geo_interface__).buffer(0) for s in rd('HD_ISLAND_2').shapes()] if f('HD_ISLAND_2') else []
    wbs = []
    if f('HD_WATERBODY_2'):
        wb = rd('HD_WATERBODY_2')
        fi = [x[0] for x in wb.fields[1:]].index('DEFINITION')
        wbs = [shape(sr.shape.__geo_interface__).buffer(0) for sr in wb.iterShapeRecords() if sr.record[fi] in (1, 6, 7)]
    sea = unary_union(water).difference(unary_union(isl)) if water else Polygon()
    return lim, lim.difference(unary_union([sea] + wbs))


def build_extras(dnr_dir, nhn_dir, out=EXTRAS):
    """DNR polygons, NHN land + limits, and the Canada work-unit index, pickled (prepare_water.py)."""
    import shapefile
    t0 = time.time()
    dnr, lag = [], 0
    for f in sorted(glob.glob(os.path.join(dnr_dir, 'coast63360_*.geojson.gz'))):
        for ft in json.load(gzip.open(f))['features']:
            if ft['geometry'] is None:
                continue
            if (ft['properties'].get('FEATURE') or '').strip() == 'lagoon':
                lag += 1; continue
            g = shape(ft['geometry'])
            dnr.extend(polys(g if g.is_valid else shapely.make_valid(g)))
    nhn_land, nhn_lim = [], []
    for d in sorted(glob.glob(os.path.join(nhn_dir, 'u', '*'))):
        r = nhn_unit(d)
        if r:
            nhn_lim.append(r[0]); nhn_land.extend(polys(r[1]))
    canada = []
    idx = glob.glob(os.path.join(nhn_dir, 'NHN_INDEX_*_INDEX_WORKUNIT_LIMIT_2.shp'))[0][:-4]
    region = box(-180, 46.5, -121.5, 72.8)
    for sr in shapefile.Reader(idx).iterShapeRecords():
        bb = sr.shape.bbox
        if bb[0] > -121.5 or bb[3] < 46.5:
            continue
        g = shape(sr.shape.__geo_interface__)
        if g.intersects(region):
            canada.extend(polys(g.buffer(0)))
    data = dict(dnr=dnr, nhn_land=nhn_land, nhn_lim=nhn_lim, canada=canada,
                note=dict(dnr_polygons=len(dnr), dnr_lagoons_as_water=lag, nhn_units=len(nhn_lim), canada_units=len(canada)))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    pickle.dump(data, open(out + '.tmp', 'wb'), protocol=4); os.replace(out + '.tmp', out)
    print(f'extras → {out} {data["note"]} {time.time()-t0:.0f}s', flush=True)
    return data


# ─── OSM subset for a set of boxes ───────────────────────────────────────────
def osm_for(boxes, margin=1.0):
    """OSM land polygons intersecting the boxes (+margin°), via ogr2ogr, cached as GeoJSONSeq."""
    out = []
    for w, s, e, n in boxes:
        w, s, e, n = max(-180, w - margin), max(-90, s - margin), min(180, e + margin), min(90, n + margin)
        key = hashlib.sha1(f'{w:.2f},{s:.2f},{e:.2f},{n:.2f}'.encode()).hexdigest()[:12]
        f = os.path.join(LAND_DIR, 'osm-subsets', f'{key}.geojsonl')
        if not os.path.exists(f):
            os.makedirs(os.path.dirname(f), exist_ok=True)
            subprocess.run(['ogr2ogr', '-f', 'GeoJSONSeq', f + '.tmp', OSM_SHP, '-spat', str(w), str(s), str(e), str(n),
                            '-lco', 'COORDINATE_PRECISION=6'], check=True)
            os.replace(f + '.tmp', f)
        out.append(f)
    seen, geoms = set(), []
    for f in out:
        for line in open(f):
            j = json.loads(line)
            k = (j.get('properties') or {}).get('FID', line[:120])
            if k in seen:
                continue
            seen.add(k)
            geoms.extend(polys(shape(j['geometry'])))
    return geoms


class Land:
    def __init__(self, boxes):
        t0 = time.time()
        src = {'osm': osm_for(boxes)}
        if os.path.exists(EXTRAS) and any(w < -121.5 or e > 169 for w, s, e, n in boxes):
            ex = pickle.load(open(EXTRAS, 'rb'))
            for k in ('dnr', 'nhn_land', 'nhn_lim', 'canada'):
                src[k] = ex[k]
        if os.path.exists(FLATS):
            bb = shapely.box(min(b[0] for b in boxes) - 1, min(b[1] for b in boxes) - 1, max(b[2] for b in boxes) + 1, max(b[3] for b in boxes) + 1)
            fl = pickle.load(open(FLATS, 'rb'))['flats']
            src['flats'] = [g for g in fl if g.intersects(bb)]
        self.src = {k: (np.asarray(v, dtype=object), shapely.STRtree(v)) for k, v in src.items() if len(v)}
        print(f'land: {({k: len(v[0]) for k, v in self.src.items()})} {time.time()-t0:.0f}s', flush=True)

    def _draw(self, key, w, s, e, n, nx, ny):
        img = Image.new('L', (nx, ny), 0)
        if key not in self.src:
            return np.zeros((ny, nx), bool)
        geoms, tree = self.src[key]
        dr = ImageDraw.Draw(img)
        sx, sy = nx / (e - w), ny / (n - s)
        pad = 2 / sx
        drew = False
        for off in (0.0, 360.0, -360.0):   # a window past ±180 also sees the other side, shifted
            qw, qe = w - off, e - off
            if qe < -180 or qw > 180:
                continue
            idx = tree.query(box(qw, s, qe, n))
            if len(idx) == 0:
                continue
            try:
                clipped = shapely.clip_by_rect(geoms[idx], qw - pad, s - pad, qe + pad, n + pad)
            except shapely.errors.GEOSException:   # a degenerate ring in a source polygon: clip one by one
                clipped = []
                for g0 in geoms[idx]:
                    try:
                        clipped.append(shapely.clip_by_rect(g0, qw - pad, s - pad, qe + pad, n + pad))
                    except shapely.errors.GEOSException:
                        try:
                            clipped.append(shapely.make_valid(g0).intersection(box(qw - pad, s - pad, qe + pad, n + pad)))
                        except Exception:
                            pass
            for g in clipped:
                for p in polys(g):
                    for ring, fill in [(p.exterior, 1)] + [(h, 0) for h in p.interiors]:
                        c = shapely.get_coordinates(ring)
                        if len(c) < 3:
                            continue
                        dr.polygon(np.column_stack([(c[:, 0] + off - w) * sx, (n - c[:, 1]) * sy]).ravel().tolist(), fill=fill)
                        drew = True
        return np.asarray(img, dtype=bool) if drew else np.zeros((ny, nx), bool)

    def window(self, w, s, e, n, nx, ny):
        """Boolean LAND grid for the box (w may be < -180 or e > 180), row 0 = north."""
        osm = self._draw('osm', w, s, e, n, nx, ny)
        if not osm.any():
            return osm
        land = osm.copy()
        if 'nhn_lim' in self.src:
            lim = self._draw('nhn_lim', w, s, e, n, nx, ny)
            if lim.any():
                land &= ~lim | self._draw('nhn_land', w, s, e, n, nx, ny)
        if 'dnr' in self.src:
            xs = w + (np.arange(nx) + 0.5) * (e - w) / nx
            xs = (xs + 180) % 360 - 180
            ys = n - (np.arange(ny) + 0.5) * (n - s) / ny
            X, Y = np.meshgrid(xs, ys)
            ak = ((X < -129.9) | (X > 170)) & ~((X < -168.97) & (Y > 64.0)) & ~((X > 170) & (Y > 56.0))
            if ak.any():
                ak &= ~self._draw('canada', w, s, e, n, nx, ny)
                if ak.any():
                    land &= ~ak | self._draw('dnr', w, s, e, n, nx, ny)
        extra = osm & ~land
        if extra.any():   # guard: extra water only where narrow
            cell_m = (n - s) / ny * 111320
            r = max(1, int(round(NARROW_M / 2 / cell_m)))
            core = ndimage.distance_transform_edt(extra) > r
            if core.any():
                land |= extra & (ndimage.distance_transform_edt(~core) <= r + 0.5)
        # Tidal flats, marsh, mud and shoals are not navigable (fetch_flats.py), whatever the coastlines say.
        if 'flats' in self.src:
            land |= self._draw('flats', w, s, e, n, nx, ny)
        return land
