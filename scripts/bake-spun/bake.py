#!/usr/bin/env python3
"""
SPUN underground-fungi bake → /inmotion "Underground fungi" layer grids.

One-time (static) bake from the SPUN data-request GeoTIFFs. The download link
is personal and expires after 7 days, so the files live OUTSIDE the repo
(default ~/Projects/spun-data, see manifest.txt there). Nothing from the
download is committed; only these derived grids are published.

Inputs (all EPSG:4326, Float32, LZW, ~1 km):
  AM_fungi/, EcM_fungi/   {Richness, RWR_Empirical, RWR_HighSampling} ×
                          {Predicted, CoeffVar, Extrapolation}
                          (Van Nuland et al. 2025, Nature 645:414–422)
  Hyphal_Density/         hyphal_density_m_cm3_Classified_{mean,sd}
                          (Stewart, Bisot et al. 2026, Science 392:1171–1176)

Outputs, in the standard /systems grid format (SYSTEMS-NOTES.md §1:
*-meta.json + Int16 LE *-grid.bin, north-first):
  spun-<measure>        0.1° display grid (block average of the 1 km pixels)
  spun-<measure>-cv     0.25° companion: bootstrap coefficient of variation
                        (hyphae: the published standard deviation)
  spun-<measure>-cover  0.25° companion: SPUN's "Extrapolation" layer — share
                        of the model's environmental space covered by training
                        data (1 = well covered; the paper flags < 0.95)

Why a block average and not a stride: a stride would pick one arbitrary 1 km
pixel per cell (and drop coastal cells whose sampled pixel is masked — the
SST stair-step lesson, SYSTEMS-NOTES §2b-bis). Averaging uses every pixel.

Usage (needs GDAL's python bindings, e.g. Homebrew `gdal`):
  /opt/homebrew/bin/python3 scripts/bake-spun/bake.py [--src ~/Projects/spun-data] [--out public/dev-data/systems]
"""

import argparse
import json
import os
import subprocess
import time

import numpy as np
from osgeo import gdal

gdal.UseExceptions()

NATURE = 'Van Nuland et al. 2025, Nature 645:414–422, doi:10.1038/s41586-025-09277-4'
SCIENCE = 'Stewart, Bisot et al. 2026, Science 392:1171–1176, doi:10.1126/science.adu4373'

# measure id → (main file, cv file, cover file or None, Int16 scale, citation)
MEASURES = {
    'hyphae': ('Hyphal_Density/hyphal_density_m_cm3_Classified_mean.tif',
               'Hyphal_Density/hyphal_density_m_cm3_Classified_sd.tif', None, 1000, SCIENCE),
    'am-rich': ('AM_fungi/AM_Fungi_Richness_Predicted.tif',
                'AM_fungi/AM_Fungi_Richness_CoeffVar.tif',
                'AM_fungi/AM_Fungi_Richness_Extrapolation.tif', 100, NATURE),
    'ecm-rich': ('EcM_fungi/EcM_Fungi_Richness_Predicted.tif',
                 'EcM_fungi/EcM_Fungi_Richness_CoeffVar.tif',
                 'EcM_fungi/EcM_Fungi_Richness_Extrapolation.tif', 100, NATURE),
    'am-rare': ('AM_fungi/AM_Fungi_RWR_HighSampling_Predicted.tif',
                'AM_fungi/AM_Fungi_RWR_HighSampling_CoeffVar.tif',
                'AM_fungi/AM_Fungi_RWR_HighSampling_Extrapolation.tif', 10000, NATURE),
    'ecm-rare': ('EcM_fungi/EcM_Fungi_RWR_HighSampling_Predicted.tif',
                 'EcM_fungi/EcM_Fungi_RWR_HighSampling_CoeffVar.tif',
                 'EcM_fungi/EcM_Fungi_RWR_HighSampling_Extrapolation.tif', 5000, NATURE),
    'am-rare-emp': ('AM_fungi/AM_Fungi_RWR_Empirical_Predicted.tif',
                    'AM_fungi/AM_Fungi_RWR_Empirical_CoeffVar.tif',
                    'AM_fungi/AM_Fungi_RWR_Empirical_Extrapolation.tif', 10000, NATURE),
    'ecm-rare-emp': ('EcM_fungi/EcM_Fungi_RWR_Empirical_Predicted.tif',
                     'EcM_fungi/EcM_Fungi_RWR_Empirical_CoeffVar.tif',
                     'EcM_fungi/EcM_Fungi_RWR_Empirical_Extrapolation.tif', 5000, NATURE),
}
# EcM rarity runs to ~4.9 (as sampled), so it takes ×5000, not ×10000.
MISSING = -32768


def average_to(src, res, tmpdir):
    """Block-average the 1 km GeoTIFF onto a global res° grid (cell-centred, north-first)."""
    out = os.path.join(tmpdir, f'{os.path.basename(src)}.{res}.tif')
    if not os.path.exists(out):
        subprocess.run([
            'gdalwarp', '-q', '-overwrite', '-t_srs', 'EPSG:4326', '-te', '-180', '-90', '180', '90',
            '-tr', str(res), str(res), '-r', 'average', '-ot', 'Float32', '-dstnodata', 'nan',
            '-wo', 'NUM_THREADS=ALL_CPUS', '-multi', src, out,
        ], check=True)
    a = gdal.Open(out).ReadAsArray().astype(np.float64)
    a[~np.isfinite(a) | (a < -1e30)] = np.nan
    return a


def write_pair(outdir, name, arr, res, scale, kind, source):
    """arr: one 2-D plane, or a list of planes (concatenated, SYSTEMS-NOTES §1)."""
    planes = arr if isinstance(arr, list) else [arr]
    qs = []
    for a in planes:
        q = np.full(a.shape, MISSING, dtype='<i2')
        ok = np.isfinite(a)
        v = np.round(a[ok] * scale)
        if v.size and (v.max() > 32767 or v.min() < -32767):
            raise SystemExit(f'{name}: value overflows Int16 at scale {scale}')
        q[ok] = v.astype('<i2')
        qs.append(q)
    ok = np.isfinite(planes[0])
    n_lat, n_lon = planes[0].shape
    meta = {
        'version': 1, 'kind': kind,
        # A static research product: "valid" is its publication, not a clock.
        'run_ms': None, 'valid_ms': None, 'fetched_ms': int(time.time() * 1000),
        'nLat': n_lat, 'nLon': n_lon,
        'lat0': 90 - res / 2, 'dLat': -res, 'lon0': -180 + res / 2, 'dLon': res,
        'scale': scale, 'missing': MISSING, 'source': source,
        'valid_cells': int(ok.sum()),
    }
    # Grid before meta: meta is the client's pointer (SYSTEMS-NOTES §1 cron rules).
    with open(os.path.join(outdir, f'{name}-grid.bin'), 'wb') as f:
        for q in qs:
            f.write(q.tobytes())
    with open(os.path.join(outdir, f'{name}-meta.json'), 'w') as f:
        json.dump(meta, f)
    return int(ok.sum())


# Hotspots, as in the paper's Figs. 4 (AM) and 5 (EcM): pixels at or above the
# 95th percentile of predicted richness / rarity (high-sampling), using the
# paper's own global cut-offs. Classified at the native ~1 km BEFORE any
# averaging — averaging first would shave the peaks off exactly the small,
# intense hotspots the view exists to show.
HOTSPOTS = {
    'am-hot': ('AM_fungi/AM_Fungi_Richness_Predicted.tif', 39.9,
               'AM_fungi/AM_Fungi_RWR_HighSampling_Predicted.tif', 0.24),
    'ecm-hot': ('EcM_fungi/EcM_Fungi_Richness_Predicted.tif', 60.0,
                'EcM_fungi/EcM_Fungi_RWR_HighSampling_Predicted.tif', 1.27),
}


def hotspot_mask(src, cut, out, rows=1024):
    """1 km Byte GeoTIFF: 1 = at/above cut, 0 = below, 255 = no prediction.
    Returns the area-weighted share of predicted land that is hotspot, which
    should come out near the paper's 5% (it ranked equal-area pixels)."""
    if os.path.exists(out):
        return None
    ds = gdal.Open(src)
    b = ds.GetRasterBand(1)
    gt = ds.GetGeoTransform()
    drv = gdal.GetDriverByName('GTiff')
    o = drv.Create(out, ds.RasterXSize, ds.RasterYSize, 1, gdal.GDT_Byte, ['COMPRESS=DEFLATE', 'TILED=YES'])
    o.SetGeoTransform(gt)
    o.SetProjection(ds.GetProjection())
    ob = o.GetRasterBand(1)
    ob.SetNoDataValue(255)
    hot_area = land_area = 0.0
    for y in range(0, ds.RasterYSize, rows):
        n = min(rows, ds.RasterYSize - y)
        a = b.ReadAsArray(0, y, ds.RasterXSize, n)
        valid = np.isfinite(a) & (a > -1e30)
        m = np.full(a.shape, 255, np.uint8)
        m[valid] = (a[valid] >= cut).astype(np.uint8)
        ob.WriteArray(m, 0, y)
        lat = gt[3] + (y + np.arange(n) + 0.5) * gt[5]
        w = np.cos(np.radians(lat))[:, None]
        land_area += (valid * w).sum()
        hot_area += ((m == 1) * w).sum()
    ob.FlushCache()
    o = None
    return hot_area / land_area


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.expanduser('~/Projects/spun-data'))
    ap.add_argument('--out', default='public/dev-data/systems')
    ap.add_argument('--tmp', default=None, help='cache for averaged intermediates (default: <src>/derived-bake)')
    args = ap.parse_args()
    tmpdir = args.tmp or os.path.join(args.src, 'derived-bake')
    os.makedirs(tmpdir, exist_ok=True)
    os.makedirs(args.out, exist_ok=True)

    for mid, (main_f, cv_f, cover_f, scale, cite) in MEASURES.items():
        src = f'SPUN (Society for the Protection of Underground Networks) · {cite} · CC BY 4.0'
        main = average_to(os.path.join(args.src, main_f), 0.1, tmpdir)
        n = write_pair(args.out, f'spun-{mid}', main, 0.1, scale, f'spun-{mid}', src)
        cv = average_to(os.path.join(args.src, cv_f), 0.25, tmpdir)
        # CV is a ratio (≤ ~2); hyphal SD is in m/cm³ (≤ ~0.4) — both fit ×10000.
        write_pair(args.out, f'spun-{mid}-cv', cv, 0.25, 10000, f'spun-{mid}-cv', src)
        if cover_f:
            cover = average_to(os.path.join(args.src, cover_f), 0.25, tmpdir)
            write_pair(args.out, f'spun-{mid}-cover', cover, 0.25, 10000, f'spun-{mid}-cover', src)
        v = main[np.isfinite(main)]
        p = np.percentile(v, [1, 25, 50, 75, 95, 99])
        print(f'{mid:13s} cells={n:8d}  p1/25/50/75/95/99 = ' + ' '.join(f'{x:.4g}' for x in p))

    # Two planes per hotspot grid at 0.1°: the share of each cell's predicted
    # 1 km pixels that are richness hotspots, then rarity hotspots. The client
    # classifies a cell as a hotspot of a kind when that share is ≥ 0.5.
    for hid, (rich_f, rich_cut, rare_f, rare_cut) in HOTSPOTS.items():
        shares = []
        for kind, f, cut in (('rich', rich_f, rich_cut), ('rare', rare_f, rare_cut)):
            mask = os.path.join(tmpdir, f'{hid}-{kind}-mask.tif')
            frac = hotspot_mask(os.path.join(args.src, f), cut, mask)
            if frac is not None:
                print(f'{hid} {kind}: {frac * 100:.2f}% of predicted land (area-weighted) at/above {cut}')
            shares.append(average_to(mask, 0.1, tmpdir))
        src = f'SPUN (Society for the Protection of Underground Networks) · {NATURE} · CC BY 4.0 · hotspot = paper cut-off (95th percentile)'
        n = write_pair(args.out, f'spun-{hid}', shares, 0.1, 10000, f'spun-{hid}', src)
        r, q = shares
        both = np.isfinite(r) & np.isfinite(q)
        print(f'{hid}: cells={n}  rich≥0.5 {(r[both] >= 0.5).mean() * 100:.1f}%  rare≥0.5 {(q[both] >= 0.5).mean() * 100:.1f}%  both {((r[both] >= 0.5) & (q[both] >= 0.5)).mean() * 100:.1f}%  (unweighted cells)')


if __name__ == '__main__':
    main()
