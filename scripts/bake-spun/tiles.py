#!/usr/bin/env python3
"""
SPUN underground fungi → value-encoded raster tile pyramids (PMTiles) for the
/inmotion "Underground fungi" layer's on-screen picture.

Why tiles: the scalar overlay (0.1° grid, and a single 2048 px world image at
globe zooms) blurs SPUN's ~1 km maps into blocks. These pyramids reach z8
(~0.6 km/px at the equator, finer toward the poles), so every native 30″
SPUN cell is drawn as itself, and Mapbox over-zooms them past that. The 0.1°
grids from bake.py stay as the layer's DATA: click popups and Explain sample
those.

Coasts (Josh, 2026-09-30: "the data is rendering over water"): SPUN's maps
are already blank over open water, but a ~1 km cell still overhangs narrow
channels, and the old z6 bake gave a pixel colour if ANY land fell inside it.
Now every z8 pixel whose centre is not on land (OpenStreetMap land polygons,
the same coastline the Mapbox basemap draws) is cleared, and each coarser
level shows a pixel only where at least half of the finer pixels beneath it
carry data, so zoomed-out coasts don't swell either.

Tiles carry VALUES, not colours: one byte per pixel,
  0 = no prediction (masked), 1..255 = lo + (b - 1) / 254 · (hi - lo)
and the client colours them on the GPU with Mapbox `raster-color`, so a ramp
change never needs a re-bake. Encoding ranges per measure are in ENC (the
client reads them from spun-tiles.json, written here). Hotspot maps carry the
class code + 1 (1 none, 2 richness, 3 rarity, 4 both), classified per ~1 km
pixel with the paper's cut-offs; coarser levels take the most common class,
so a class never blends.

Pipeline per measure:
  1 km Float32 GeoTIFF → encoded Byte GeoTIFF (4326, nodata 0)
  → gdalwarp (nearest) to EPSG:3857 at z8 resolution
  → clear non-land pixels (OSM land polygons rasterised once, cached)
  → tiles z8, then each coarser level by 2×2 pooling, streamed in strips
  → PMTiles (all-empty tiles not stored; the endpoint answers them).

Usage (needs GDAL python + `pmtiles` + Pillow, e.g. a venv on Homebrew python):
  ~/Projects/spun-data/.venv/bin/python scripts/bake-spun/tiles.py \\
      --land ~/Projects/spun-data/osm-land/land-polygons-split-4326/land_polygons.shp [--only hyphae,am-hot]
Writes public/dev-data/systems/spun-<id>-z8.pmtiles + spun-tiles.json.
Test on a small area first (CLAUDE.md: test small): --bbox w,s,e,n --suffix=-test
writes spun-<id>-z8-test.pmtiles (levels --minz..maxz only) and leaves the index alone.
Land polygons: https://osmdata.openstreetmap.de/data/land-polygons.html (ODbL).
"""

import argparse
import hashlib
import io
import json
import math
import os
import subprocess
import time

import numpy as np
from PIL import Image
from osgeo import gdal
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

gdal.UseExceptions()

MAXZ = 8
WORLD = 20037508.342789244
MERC_LAT = 85.0511287798

# measure → (source(s), lo, hi). Ranges cover the native min/max (gdalinfo).
ENC = {
    'hyphae': ('Hyphal_Density/hyphal_density_m_cm3_Classified_mean.tif', 0.0, 12.7),
    'am-rich': ('AM_fungi/AM_Fungi_Richness_Predicted.tif', 0.0, 63.5),
    'ecm-rich': ('EcM_fungi/EcM_Fungi_Richness_Predicted.tif', 0.0, 190.5),
    'am-rare': ('AM_fungi/AM_Fungi_RWR_HighSampling_Predicted.tif', 0.0, 0.508),
    'am-rare-emp': ('AM_fungi/AM_Fungi_RWR_Empirical_Predicted.tif', 0.0, 0.508),
    'ecm-rare': ('EcM_fungi/EcM_Fungi_RWR_HighSampling_Predicted.tif', 0.0, 2.54),
    'ecm-rare-emp': ('EcM_fungi/EcM_Fungi_RWR_Empirical_Predicted.tif', 0.0, 5.08),
}
HOT = {
    'am-hot': ('AM_fungi/AM_Fungi_Richness_Predicted.tif', 39.9, 'AM_fungi/AM_Fungi_RWR_HighSampling_Predicted.tif', 0.24),
    'ecm-hot': ('EcM_fungi/EcM_Fungi_Richness_Predicted.tif', 60.0, 'EcM_fungi/EcM_Fungi_RWR_HighSampling_Predicted.tif', 1.27),
}


def run(*cmd):
    subprocess.run([str(c) for c in cmd], check=True)


def blockwise(srcs, out, fn, rows=1024):
    """Apply fn(list of float arrays) → uint8 array over row blocks of aligned 1 km sources."""
    ds = [gdal.Open(s) for s in srcs]
    b = [d.GetRasterBand(1) for d in ds]
    d0 = ds[0]
    o = gdal.GetDriverByName('GTiff').Create(out, d0.RasterXSize, d0.RasterYSize, 1, gdal.GDT_Byte,
                                             ['COMPRESS=DEFLATE', 'TILED=YES', 'BIGTIFF=IF_SAFER'])
    o.SetGeoTransform(d0.GetGeoTransform())
    o.SetProjection(d0.GetProjection())
    ob = o.GetRasterBand(1)
    ob.SetNoDataValue(0)
    for y in range(0, d0.RasterYSize, rows):
        n = min(rows, d0.RasterYSize - y)
        arrs = []
        for band in b:
            a = band.ReadAsArray(0, y, d0.RasterXSize, n).astype(np.float32)
            a[~np.isfinite(a) | (a < -1e30)] = np.nan
            arrs.append(a)
        ob.WriteArray(fn(arrs), 0, y)
    ob.FlushCache()
    o = None


def encode_linear(lo, hi):
    def fn(arrs):
        a = arrs[0]
        out = np.zeros(a.shape, np.uint8)
        ok = np.isfinite(a)
        out[ok] = (1 + np.round((np.clip(a[ok], lo, hi) - lo) / (hi - lo) * 254)).astype(np.uint8)
        return out
    return fn


def encode_hot(rich_cut, rare_cut):
    def fn(arrs):
        r, q = arrs
        ok = np.isfinite(r) | np.isfinite(q)
        code = (np.nan_to_num(r, nan=-1) >= rich_cut).astype(np.uint8) + 2 * (np.nan_to_num(q, nan=-1) >= rare_cut).astype(np.uint8)
        return np.where(ok, code + 1, 0).astype(np.uint8)
    return fn


def merc_bounds(bbox, z):
    """lon/lat bbox → EPSG:3857 bounds snapped out to whole z tiles."""
    w, s, e, n = bbox
    t = 2 * WORLD / (1 << z)
    x = lambda lon: lon * WORLD / 180
    y = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * WORLD / math.pi
    snap = lambda v, up: -WORLD + (math.ceil if up else math.floor)((v + WORLD) / t) * t
    return snap(x(w), False), snap(y(s), False), snap(x(e), True), snap(y(n), True)


def merc_to_lonlat(te):
    lon = lambda x: x / WORLD * 180
    lat = lambda y: math.degrees(2 * math.atan(math.exp(y / WORLD * math.pi)) - math.pi / 2)
    return lon(te[0]), max(-MERC_LAT, lat(te[1])), lon(te[2]), min(MERC_LAT, lat(te[3]))


def land_mask(land, te, res, work):
    """OSM land polygons rasterised onto the bake grid (1 = land), built once
    per grid and reused by every measure."""
    key = hashlib.sha1(f'{os.path.abspath(land)}|{te}|{res}'.encode()).hexdigest()[:10]
    mask = os.path.join(work, f'land-{key}.tif')
    if os.path.exists(mask):
        return mask
    # gdal_rasterize never reprojects: cut the (lon/lat) polygons to the area
    # (and to Web Mercator's latitude limit) and bring them into 3857 first.
    w, s, e, n = merc_to_lonlat(te)
    merc_land = os.path.join(work, f'land-{key}-3857.gpkg')
    if os.path.exists(merc_land):
        os.remove(merc_land)
    run('ogr2ogr', '-q', '-f', 'GPKG', '-spat', w, s, e, n, '-clipsrc', w, s, e, n,
        '-t_srs', 'EPSG:3857', '-nlt', 'PROMOTE_TO_MULTI', merc_land, land)
    tmp = mask + '.tmp.tif'
    run('gdal_rasterize', '-q', '-burn', 1, '-init', 0, '-ot', 'Byte', '-te', *te, '-tr', res, res,
        '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', '-co', 'BIGTIFF=YES', merc_land, tmp)
    os.replace(tmp, mask)
    os.remove(merc_land)
    return mask


def pool2(a, kind):
    """One level coarser: each 2×2 block → one pixel, kept only where at least
    2 of the 4 carry data (so coasts don't swell as you zoom out). Linear maps
    average their bytes (bytes are linear in value); hotspot maps take the
    most common class."""
    h, w = a.shape
    b = a.reshape(h // 2, 2, w // 2, 2)
    n = (b > 0).sum(axis=(1, 3))
    if kind == 'hot':
        counts = np.stack([(b == c).sum(axis=(1, 3)) for c in range(1, 5)])
        out = (counts.argmax(axis=0) + 1).astype(np.uint8)
    else:
        s = b.astype(np.uint16).sum(axis=(1, 3))
        out = np.round(s / np.maximum(n, 1)).astype(np.uint8)
    out[n < 2] = 0
    return out


def png(tile):
    buf = io.BytesIO()
    Image.fromarray(tile, 'L').save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def build_tiles(merc, mask, te, maxz, minz, kind):
    """Stream the z-max raster in 256-row strips: cut each strip into tiles,
    pool it into the next coarser level's rows, and so on down to minz.
    Returns {tileid: png bytes}, empty tiles left out."""
    ds = gdal.Open(merc)
    band = ds.GetRasterBand(1)
    mds = gdal.Open(mask) if mask else None  # keep the dataset alive while its band is read
    mb = mds.GetRasterBand(1) if mds else None
    W, H = ds.RasterXSize, ds.RasterYSize
    t_m = 2 * WORLD / (1 << maxz)
    x0 = round((te[0] + WORLD) / t_m)
    y0 = round((WORLD - te[3]) / t_m)
    tiles = {}
    pending = {z: [] for z in range(minz, maxz + 1)}  # rows waiting to fill a 256-row strip
    row_at = {z: 0 for z in range(minz, maxz + 1)}    # tile row (relative) of the next strip

    def emit(z, strip):
        k = maxz - z
        ty = (y0 >> k) + row_at[z]
        tx0 = x0 >> k
        for i in range(strip.shape[1] // 256):
            t = strip[:, i * 256:(i + 1) * 256]
            if t.any():
                tiles[zxy_to_tileid(z, tx0 + i, ty)] = png(np.ascontiguousarray(t))
        row_at[z] += 1

    def push(z, rows):
        pending[z].append(rows)
        have = sum(r.shape[0] for r in pending[z])
        if have < 256:
            return
        strip = np.concatenate(pending[z])
        pending[z] = []
        emit(z, strip[:256])
        if strip.shape[0] > 256:
            pending[z].append(strip[256:])
        if z > minz:
            push(z - 1, pool2(strip[:256], kind))

    for y in range(0, H, 256):
        a = band.ReadAsArray(0, y, W, 256)
        if mb is not None:
            a[mb.ReadAsArray(0, y, W, 256) == 0] = 0
        push(maxz, a)
    return tiles


def write_pmtiles(tiles, out, name, minz, maxz, te):
    w, s, e, n = merc_to_lonlat(te)
    wr = Writer(open(out, 'wb'))
    for tid in sorted(tiles):
        wr.write_tile(tid, tiles[tid])
    e7 = lambda v: int(round(v * 1e7))
    wr.finalize({
        'tile_type': TileType.PNG, 'tile_compression': Compression.NONE,
        'min_zoom': minz, 'max_zoom': maxz,
        'min_lon_e7': e7(w), 'min_lat_e7': e7(s), 'max_lon_e7': e7(e), 'max_lat_e7': e7(n),
        'center_zoom': minz, 'center_lon_e7': e7((w + e) / 2), 'center_lat_e7': e7((s + n) / 2),
    }, {'name': name, 'format': 'png'})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.expanduser('~/Projects/spun-data'))
    ap.add_argument('--out', default='public/dev-data/systems')
    ap.add_argument('--only', default='')
    ap.add_argument('--maxz', type=int, default=MAXZ)
    ap.add_argument('--minz', type=int, default=0, help='coarsest level; a --bbox is snapped to its tiles')
    ap.add_argument('--bbox', default='', help='w,s,e,n lon/lat: bake only this area (tests)')
    ap.add_argument('--land', default='', help='OSM land-polygons-split-4326 .shp: clear non-land pixels')
    ap.add_argument('--suffix', default='', help='output name suffix, e.g. -v2 (tests; index untouched)')
    args = ap.parse_args()
    maxz, minz = args.maxz, args.minz
    bbox = [float(v) for v in args.bbox.split(',')] if args.bbox else None
    work = os.path.join(args.src, 'tiles-work')
    os.makedirs(work, exist_ok=True)
    only = set(filter(None, args.only.split(',')))
    index = {'version': 1, 'kind': 'spun-tiles', 'fetched_ms': int(time.time() * 1000), 'maxzoom': maxz, 'measures': {}}
    idx_path = os.path.join(args.out, 'spun-tiles.json')
    if os.path.exists(idx_path) and not args.suffix:
        old = json.load(open(idx_path))
        if old.get('maxzoom') == maxz:  # a different pyramid depth means every map is re-baked
            index['measures'] = old.get('measures', {})

    res = 2 * WORLD / (256 << maxz)
    te = merc_bounds(bbox, minz) if bbox else (-WORLD, -WORLD, WORLD, WORLD)
    mask = land_mask(args.land, te, res, work) if args.land else None

    jobs = [(m, 'linear', v) for m, v in ENC.items()] + [(m, 'hot', v) for m, v in HOT.items()]
    for mid, kind, spec in jobs:
        if only and mid not in only:
            continue
        t0 = time.time()
        enc = os.path.join(work, f'{mid}-enc.tif')
        if kind == 'linear':
            src, lo, hi = spec
            blockwise([os.path.join(args.src, src)], enc, encode_linear(lo, hi))
            meta = {'enc': 'linear', 'lo': lo, 'hi': hi}
        else:
            rs, rc, qs, qc = spec
            blockwise([os.path.join(args.src, rs), os.path.join(args.src, qs)], enc, encode_hot(rc, qc))
            meta = {'enc': 'class', 'offset': 1}
        merc = os.path.join(work, f'{mid}{args.suffix}-3857.tif')
        # z8 pixels are finer than the ~1 km source: each native cell is copied as-is.
        run('gdalwarp', '-q', '-overwrite', '-t_srs', 'EPSG:3857', '-te', *te,
            '-tr', res, res, '-r', 'near', '-srcnodata', 0, '-dstnodata', 0, '-wo', 'NUM_THREADS=ALL_CPUS', '-multi',
            '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', '-co', 'BIGTIFF=YES', enc, merc)
        tiles = build_tiles(merc, mask, te, maxz, minz, kind)
        os.remove(merc)
        # The depth is in the name: a re-bake at a new depth lands beside the
        # live files instead of overwriting them under CDN caches.
        name = f'spun-{mid}-z{maxz}{args.suffix}'
        out = os.path.join(args.out, f'{name}.pmtiles')
        write_pmtiles(tiles, out, name, minz, maxz, te)
        n, size = len(tiles), os.path.getsize(out)
        if args.suffix:
            print(f'{mid}{args.suffix}: {n} tiles  {size / 1e6:.1f} MB  {time.time() - t0:.0f} s  (index untouched)')
            continue
        index['measures'][mid] = {**meta, 'tiles': n, 'bytes': size, 'baked_ms': int(time.time() * 1000)}
        print(f'{mid:13s} {n:6d} tiles  {size / 1e6:7.1f} MB  {time.time() - t0:5.0f} s')
        json.dump(index, open(idx_path, 'w'))


if __name__ == '__main__':
    main()
