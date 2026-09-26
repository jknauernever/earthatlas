"""Render an equirectangular density grid (lat 85..-85, lon -180..180) into XYZ
PNG tiles for a side-by-side source comparison.
  python3 compare_tiles.py grid.bin W H outdir zmax [floor]
Colour is log-scaled between the 40th and 99.5th percentile of the source's own
non-empty cells, so sources with different units compare fairly. Values below
`floor` are treated as empty. At low zooms each pixel takes the MAX of the cells
under it, so thin lanes survive zooming out."""
import sys, os, numpy as np
from PIL import Image
path, W, H, out, zmax = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], int(sys.argv[5])
floor = float(sys.argv[6]) if len(sys.argv) > 6 else 0
pool = sys.argv[7] if len(sys.argv) > 7 else 'max'   # 'max' keeps thin lanes; 'mean' calms speckle
g = np.fromfile(path, np.float32).reshape(H, W); g[~np.isfinite(g)] = 0; g[g < max(floor, 1e-9)] = 0
lg = np.where(g > 0, np.log10(np.maximum(g, 1e-9)), -np.inf).astype(np.float32)
lo, hi = np.percentile(lg[g > 0], [60, 99.9]); print('log range', lo, hi, flush=True)
A = np.array([0xc9, 0x8a, 0x04], float); B = np.array([0xfd, 0xe0, 0x47], float); C = np.array([0xff, 0xf6, 0xb0], float)
def colour(v):
    q = np.clip((v - lo) / (hi - lo), 0, 1); q[~np.isfinite(v)] = 0
    a = np.where(np.isfinite(v) & (v >= lo), 0.9 * q ** 1.1, 0)
    t1 = np.clip(q / 0.75, 0, 1)[..., None]; t2 = np.clip((q - 0.75) / 0.25, 0, 1)[..., None]
    rgb = A + (B - A) * t1; rgb = rgb + (C - rgb) * t2
    return np.dstack([rgb, (a * 255)[..., None]]).astype(np.uint8)
res = 360 / W
for z in range(zmax + 1):
    n = 2 ** z
    k = max(1, int((360 / (256 * n)) / res))          # grid cells per output pixel (equator)
    if k > 1:
        Hk, Wk = H // k, W // k
        blk = g[:Hk * k, :Wk * k].reshape(Hk, k, Wk, k)
        pv = blk.max(axis=(1, 3)) if pool == 'max' else blk.mean(axis=(1, 3))
        pooled = np.where(pv > 0, np.log10(np.maximum(pv, 1e-9)), -np.inf).astype(np.float32)
    else:
        pooled, Hk, Wk = lg, H, W
    r = 170 / Hk; rl = 360 / Wk
    for x in range(n):
        for y in range(n):
            d = os.path.join(out, str(z), str(x)); os.makedirs(d, exist_ok=True)
            px = (np.arange(256) + 0.5) / 256
            lon = (x + px) / n * 360 - 180
            lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + px) / n))))
            col = np.clip(((lon + 180) / rl).astype(int), 0, Wk - 1)
            row = ((85 - lat) / r).astype(int); ok = (row >= 0) & (row < Hk)
            v = pooled[np.clip(row, 0, Hk - 1)][:, col]
            v = np.where(ok[:, None], v, -np.inf)
            Image.fromarray(colour(v)).save(os.path.join(d, f'{y}.png'))
    print('z', z, 'done', flush=True)
