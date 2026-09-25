#!/usr/bin/env python3
"""
SPUN underground fungi → value-encoded raster tile pyramids (PMTiles) for the
/inmotion "Underground fungi" layer's on-screen picture.

Why tiles: the scalar overlay (0.1° grid, and a single 2048 px world image at
globe zooms) blurs SPUN's ~1 km maps into blocks. These pyramids keep the
native detail down to z6 (~2.4 km/px at the equator, finer toward the poles)
and Mapbox over-zooms them smoothly past that. The 0.1° grids from bake.py
stay as the layer's DATA: click popups and Explain sample those.

Tiles carry VALUES, not colours: one byte per pixel,
  0 = no prediction (masked), 1..255 = lo + (b - 1) / 254 · (hi - lo)
and the client colours them on the GPU with Mapbox `raster-color`, so a ramp
change never needs a re-bake. Encoding ranges per measure are in ENC (the
client reads them from spun-tiles.json, written here). Hotspot maps carry the
class code + 1 (1 none, 2 richness, 3 rarity, 4 both), classified per ~1 km
pixel with the paper's cut-offs, pooled by MODE so a class never blends.

Pipeline per measure (GDAL does the geometry):
  1 km Float32 GeoTIFF → encoded Byte GeoTIFF (4326, nodata 0)
  → gdalwarp to EPSG:3857 at z6 resolution (average; mode for hotspots)
  → MBTiles PNG z6 + gdaladdo overviews z0..z5 → PMTiles (TMS rows flipped).

Usage (needs GDAL python + `pmtiles` + Pillow, e.g. a venv on Homebrew python):
  ~/Projects/spun-data/.venv/bin/python scripts/bake-spun/tiles.py [--only hyphae,am-hot]
"""

import argparse
import io
import json
import os
import sqlite3
import subprocess
import time

import numpy as np
from PIL import Image
from osgeo import gdal
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

gdal.UseExceptions()

MAXZ = 6
WORLD = 20037508.342789244

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


def mbtiles_to_pmtiles(mb, out, name):
    con = sqlite3.connect(mb)
    w = Writer(open(out, 'wb'))
    rows = con.execute('SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles').fetchall()
    tiles = {}
    for z, x, row, data in rows:
        if z > MAXZ:
            continue
        y = (1 << z) - 1 - row  # MBTiles rows are TMS (south-up)
        # GDAL writes RGBA; the value is in R (= G = B) and alpha only marks
        # nodata, which the value 0 already does. One grey channel is a
        # quarter of the bytes. All-empty (ocean) tiles are not stored; the
        # endpoint answers them with a transparent tile.
        im = Image.open(io.BytesIO(data)).convert('RGBA')
        a = np.asarray(im)
        v = np.where(a[..., 3] > 0, a[..., 0], 0).astype(np.uint8)
        if not v.any():
            continue
        buf = io.BytesIO()
        Image.fromarray(v, 'L').save(buf, format='PNG', optimize=True)
        tiles[zxy_to_tileid(z, x, y)] = buf.getvalue()
    for tid in sorted(tiles):
        w.write_tile(tid, tiles[tid])
    w.finalize({
        'tile_type': TileType.PNG, 'tile_compression': Compression.NONE,
        'min_zoom': 0, 'max_zoom': MAXZ,
        'min_lon_e7': -1800000000, 'min_lat_e7': -850511287, 'max_lon_e7': 1800000000, 'max_lat_e7': 850511287,
        'center_zoom': 0, 'center_lon_e7': 0, 'center_lat_e7': 0,
    }, {'name': name, 'format': 'png'})
    con.close()
    return len(tiles)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.expanduser('~/Projects/spun-data'))
    ap.add_argument('--out', default='public/dev-data/systems')
    ap.add_argument('--only', default='')
    args = ap.parse_args()
    work = os.path.join(args.src, 'tiles-work')
    os.makedirs(work, exist_ok=True)
    only = set(filter(None, args.only.split(',')))
    index = {'version': 1, 'kind': 'spun-tiles', 'fetched_ms': int(time.time() * 1000), 'maxzoom': MAXZ, 'measures': {}}
    idx_path = os.path.join(args.out, 'spun-tiles.json')
    if os.path.exists(idx_path):
        index['measures'] = json.load(open(idx_path)).get('measures', {})

    jobs = [(m, 'linear', v) for m, v in ENC.items()] + [(m, 'hot', v) for m, v in HOT.items()]
    res = 2 * WORLD / (256 << MAXZ)
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
        merc = os.path.join(work, f'{mid}-3857.tif')
        resamp = 'mode' if kind == 'hot' else 'average'
        run('gdalwarp', '-q', '-overwrite', '-t_srs', 'EPSG:3857', '-te', -WORLD, -WORLD, WORLD, WORLD,
            '-tr', res, res, '-r', resamp, '-srcnodata', 0, '-dstalpha', '-wo', 'NUM_THREADS=ALL_CPUS', '-multi',
            '-co', 'COMPRESS=DEFLATE', '-co', 'TILED=YES', '-co', 'BIGTIFF=YES', enc, merc)
        mb = os.path.join(work, f'{mid}.mbtiles')
        if os.path.exists(mb):
            os.remove(mb)
        run('gdal_translate', '-q', '-of', 'MBTiles', '-co', 'TILE_FORMAT=PNG', '-co', 'ZOOM_LEVEL_STRATEGY=LOWER', merc, mb)
        run('gdaladdo', '-q', '-r', resamp, mb, *[2 ** i for i in range(1, MAXZ + 1)])
        n = mbtiles_to_pmtiles(mb, os.path.join(args.out, f'spun-{mid}.pmtiles'), f'spun-{mid}')
        size = os.path.getsize(os.path.join(args.out, f'spun-{mid}.pmtiles'))
        index['measures'][mid] = {**meta, 'tiles': n, 'bytes': size, 'baked_ms': int(time.time() * 1000)}
        print(f'{mid:13s} {n:5d} tiles  {size / 1e6:6.1f} MB  {time.time() - t0:5.0f} s')
        json.dump(index, open(idx_path, 'w'))


if __name__ == '__main__':
    main()
