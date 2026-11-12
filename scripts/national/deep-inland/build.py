#!/usr/bin/env python3
"""
National dataset `deep-inland` (docs/NATIONAL_DATA.md): where a position is deep inland, i.e. land more than
INLAND_M from any sizeable water (sea, river, lake). Built for the /ships US track bake (a boat on a trailer or a
drifting GPS fix must not draw a "ship track" across land), and shared: anything that needs "is this point on the
water or far from it?" reads it through inland.py (Python) or lib/national/deepInland.js (Node).

Built in Google Earth Engine (EarthAtlas's account), at WORK_M (120 m; a cell is water if any 30 m pixel in it is,
read from the sources' own lower-resolution levels, so rivers 30 m wide survive):
  water  = JRC Global Surface Water v1.4 `max_extent` (anywhere water was seen 1984-2021: rivers, lakes,
           reservoirs, coast)  OR  not land in Hansen Global Forest Change v1.13 `datamask` (open sea, permanent
           water and no-data all count as water, so a gap in the data never makes the sea "inland")
           OR  herbaceous wetland / mangroves in ESA WorldCover v200 (marsh and swamp boats: the Everglades,
           Louisiana's bayous; a satellite water map sees no open water there)
  big    = water bodies of at least MIN_PX connected 120 m cells (~0.9 km²): rivers and lakes stay, farm ponds and
           pits go (a 500 m halo round every pond would excuse most highways)
  inland = not within INLAND_M of `big`, and (locally, after download) not within INLAND_M of a line of the US
           Navigable Waterway Network (USACE / BTS NTAD): narrow commercial channels (bayous, the Chicago ship
           canal, river reaches under tree canopy) that a 30 m satellite map misses. raw/nwn-lines.geojson
sampled at CELL_DEG (cell centres), downloaded in TILE_DEG tiles (about 7 s each; no export or asset needed), and
packed one bit per cell. (A 30 m version cost ~9x the Earth Engine compute for the same result at this grid size.)

Output: data/national/deep-inland/build/<version>/
  deep-inland.json   cell_deg, inland_m, work_m, min_px, sources, boxes {name: {w, s, e, n, nx, ny, file}}
  <box>.bits.gz      gzip of the packed bit rows, north row first, west cell = most significant bit; 1 = inland
  dataset.json       the national catalog entry

Usage:
  python3 build.py VERSION [--test] [--workers 8]   (--test: one 2° box at St. Louis, written to build/VERSION-test)
Tiles are cached in data/national/deep-inland/work/tiles/<version>/, so a re-run resumes.
Then: node --env-file=.env.local scripts/national/publish.mjs deep-inland VERSION
"""
import gzip, io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from lib import ds  # noqa: E402

PROJECT = 'salish-sea-property-mapper'
CELL_DEG = 0.0025          # ~280 m north-south, ~200 m east-west at 45°N
INLAND_M = 2000           # 500 m (first try) dropped shipyards, fleeting areas and side channels 1-3 km off the waterway lines
WORK_M = 120
MIN_PX = 64                # connected WORK_M cells: ~0.9 km²
TILE_DEG = 2.0
# Boxes (w, s, e, n): the land in and around NOAA MarineCadastre's AIS area. Outside every box nothing is inland;
# add a box (and re-run) to cover more of the world.
BOXES = {
    'lower48': (-128.0, 22.0, -60.0, 54.0),     # with southern Canada, northern Mexico, the Bahamas
    'alaska': (-170.0, 50.0, -128.0, 72.0),     # with Yukon and northern British Columbia
    'aleut-w': (-180.0, 50.0, -170.0, 56.0),
    'aleut-e': (172.0, 50.0, 180.0, 56.0),      # Aleutians west of 180°
    'hawaii': (-162.0, 18.0, -154.0, 24.0),
    'caribbean': (-68.0, 16.0, -64.0, 20.0),    # Puerto Rico, US and British Virgin Islands
    'guam': (144.0, 12.0, 146.0, 22.0),         # Guam, Northern Marianas
    'samoa': (-172.0, -16.0, -168.0, -14.0),
}
TEST = {'test': (-91.0, 38.0, -89.0, 40.0)}
NWN = ds('deep-inland', 'raw', 'nwn-lines.geojson')
NWN_URL = 'https://catalog.data.gov/dataset/national-waterway-network-lines'
SOURCES = [
    dict(name='JRC Global Surface Water v1.4 (max_extent)', by='EC JRC / Google', url='https://global-surface-water.appspot.com/', license='Copernicus open license; free use with attribution'),
    dict(name='Hansen Global Forest Change v1.13 (datamask)', by='University of Maryland', url='https://glad.earthengine.app/view/global-forest-change', license='CC BY 4.0'),
    dict(name='ESA WorldCover 10 m v200 (herbaceous wetland, mangroves)', by='ESA', url='https://esa-worldcover.org/', license='CC BY 4.0'),
    dict(name='Navigable Waterway Network (lines)', by='U.S. Army Corps of Engineers / BTS NTAD', url=NWN_URL, license='Public domain'),
]


def waterway_cells(box):
    """(rows, cols) of the box's cells within INLAND_M of a Navigable Waterway Network line."""
    w, s, e, n = box
    nx, ny = int(round((e - w) / CELL_DEG)), int(round((n - s) / CELL_DEG))
    pts = []
    for f in json.load(open(NWN))['features']:
        g = f.get('geometry') or {}
        lines = g.get('coordinates') or []
        if g.get('type') == 'LineString':
            lines = [lines]
        for ln in lines:
            c = np.asarray(ln, dtype=np.float64)[:, :2]
            if len(c) < 2 or c[:, 0].max() < w - 0.1 or c[:, 0].min() > e + 0.1 or c[:, 1].max() < s - 0.1 or c[:, 1].min() > n + 0.1:
                continue
            seg = np.hypot(np.diff(c[:, 0]) * np.cos(np.radians(c[:-1, 1])), np.diff(c[:, 1])) * 111.32  # km
            k = np.maximum(1, np.ceil(seg / 0.1).astype(int))                                         # a point every 100 m
            for (x0, y0), (x1, y1), kk in zip(c[:-1], c[1:], k):
                t = np.arange(kk) / kk
                pts.append(np.column_stack([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]))
            pts.append(c[-1:])
    if not pts:
        return np.zeros(0, int), np.zeros(0, int)
    p = np.concatenate(pts)
    col = np.floor((p[:, 0] - w) / CELL_DEG).astype(np.int64)
    row = np.floor((n - p[:, 1]) / CELL_DEG).astype(np.int64)
    lat = np.radians(p[:, 1])
    rr, cc = [], []
    reach = int(np.ceil(INLAND_M / (CELL_DEG * 111320))) + 1
    for dr in range(-reach, reach + 1):
        for dc in range(-3 * reach, 3 * reach + 1):
            d = np.hypot(dr * CELL_DEG * 111320, dc * CELL_DEG * 111320 * np.cos(lat))   # metres to that cell
            m = d <= INLAND_M
            rr.append(row[m] + dr); cc.append(col[m] + dc)
    rr, cc = np.concatenate(rr), np.concatenate(cc)
    ok = (rr >= 0) & (rr < ny) & (cc >= 0) & (cc < nx)
    return rr[ok], cc[ok]


def ee_init():
    import ee
    ee.Initialize(project=PROJECT)
    return ee


def inland_image(ee):
    proj = ee.Projection('EPSG:4326').atScale(WORK_M)
    gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('max_extent').unmask(0)
    dm = ee.Image('UMD/hansen/global_forest_change_2025_v1_13').select('datamask').unmask(0)
    # read at WORK_M from the sources' pyramids: GSW mean > 0 = some 30 m water pixel in the cell
    wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').unmask(0)
    water = gsw.gt(0).Or(dm.neq(1)).Or(wc.eq(90)).Or(wc.eq(95)).reproject(proj)
    big = water.selfMask().connectedPixelCount(MIN_PX, True).gte(MIN_PX).unmask(0).reproject(proj)
    near = big.focalMax(INLAND_M, 'circle', 'meters').reproject(proj)
    return near.Not().rename('inland').toByte()


def tiles(box):
    w, s, e, n = box
    nx, ny = int(round((e - w) / CELL_DEG)), int(round((n - s) / CELL_DEG))
    step = int(round(TILE_DEG / CELL_DEG))
    for r0 in range(0, ny, step):
        for c0 in range(0, nx, step):
            yield r0, c0, min(step, ny - r0), min(step, nx - c0)


def fetch_tile(img, box, r0, c0, th, tw, cache):
    f = os.path.join(cache, f'{r0}_{c0}.npy')
    if os.path.exists(f):
        return np.load(f)
    w, s, e, n = box
    x0, y0 = w + c0 * CELL_DEG, n - r0 * CELL_DEG
    url = img.getDownloadURL({'crs': 'EPSG:4326', 'crs_transform': [CELL_DEG, 0, x0, 0, -CELL_DEG, y0],
                              'dimensions': [tw, th], 'format': 'NPY'})
    for k in range(5):
        try:
            a = np.load(io.BytesIO(urllib.request.urlopen(url, timeout=300).read()))['inland'].astype(np.uint8)
            break
        except Exception:
            if k == 4:
                raise
            time.sleep(10 * (k + 1))
    assert a.shape == (th, tw), (a.shape, th, tw)
    np.save(f + '.tmp.npy', a)
    os.replace(f + '.tmp.npy', f)
    return a


def build(version, boxes, workers):
    ee = ee_init()
    img = inland_image(ee)
    out = ds('deep-inland', 'build', version)
    os.makedirs(out, exist_ok=True)
    if not os.path.exists(NWN):
        sys.exit(f'missing {NWN}: download the Navigable Waterway Network lines as GeoJSON ({NWN_URL})')
    meta = dict(cell_deg=CELL_DEG, inland_m=INLAND_M, work_m=WORK_M, min_px=MIN_PX, sources=SOURCES, boxes={})
    total, t0 = 0, time.time()
    for name, box in boxes.items():
        w, s, e, n = box
        nx, ny = int(round((e - w) / CELL_DEG)), int(round((n - s) / CELL_DEG))
        cache = ds('deep-inland', 'work', 'tiles', version, name)
        os.makedirs(cache, exist_ok=True)
        grid = np.zeros((ny, nx), np.uint8)
        jobs = list(tiles(box))
        with ThreadPoolExecutor(workers) as ex:
            futs = [(ex.submit(fetch_tile, img, box, *j, cache), j) for j in jobs]
            for i, (fu, (r0, c0, th, tw)) in enumerate(futs, 1):
                grid[r0:r0 + th, c0:c0 + tw] = fu.result()
                if i % 25 == 0 or i == len(jobs):
                    print(f'  {name}: {i}/{len(jobs)} tiles, {time.time() - t0:.0f}s', flush=True)
        rr, cc = waterway_cells(box)
        before = int(grid.sum())
        grid[rr, cc] = 0
        print(f'{name}: {before - int(grid.sum()):,} cells cleared near navigable waterways', flush=True)
        bits = np.packbits(grid.astype(bool), axis=1)
        fn = f'{name}.bits.gz'
        with gzip.open(os.path.join(out, fn), 'wb', 6) as fh:
            fh.write(bits.tobytes())
        inl = int(grid.sum())
        total += inl
        meta['boxes'][name] = dict(w=w, s=s, e=e, n=n, nx=nx, ny=ny, file=fn, inland_cells=inl)
        print(f'{name}: {nx}×{ny} cells, {inl:,} inland, {os.path.getsize(os.path.join(out, fn)) / 1e6:.1f} MB', flush=True)
    json.dump(meta, open(os.path.join(out, 'deep-inland.json'), 'w'), indent=1)
    json.dump(dict(
        name='Deep inland (land far from water)',
        summary=f'Land more than {INLAND_M} m from any sea, river, lake or marsh of about 1 km² or more, or any navigable '
                f'waterway, on a {CELL_DEG}° grid '
                '(about 250 m). A ship or boat position here is on a trailer, in a truck, or a bad GPS fix.',
        source=dict(name='EarthAtlas, from JRC Global Surface Water, Hansen Global Forest Change (datamask), ESA WorldCover '
                         'and the USACE Navigable Waterway Network',
                    url='https://global-surface-water.appspot.com/', parts=SOURCES),
        license='Derived from Copernicus open-license, CC BY 4.0 and public-domain data; credit the sources',
        coverage='The United States (lower 48, Alaska, Hawaii, Puerto Rico, Virgin Islands, Guam, Northern Marianas, '
                 'American Samoa) with southern Canada, northern Mexico and the Bahamas; elsewhere nothing is inland',
        cadence='Rebuilt when the water sources update', inland_cells=total,
        readers=['scripts/national/deep-inland/inland.py', 'lib/national/deepInland.js'],
    ), open(os.path.join(out, 'dataset.json'), 'w'), indent=1)
    print('→', out)


if __name__ == '__main__':
    argv = sys.argv[1:]
    workers = 8
    if '--workers' in argv:
        i = argv.index('--workers'); workers = int(argv[i + 1]); del argv[i:i + 2]
    test = '--test' in argv
    args = [a for a in argv if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    build(args[0] + ('-test' if test else ''), TEST if test else BOXES, workers)
