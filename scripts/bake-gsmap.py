#!/usr/bin/env python3
"""
Bake JAXA GSMaP_NOW into the GLOBAL precipitation tier for /inmotion.

Why this replaces IMERG as the live global layer
------------------------------------------------
Not resolution — both are 0.1 deg (~11 km), so this is no sharper. It is
AGE, which turned out to be the thing that made the map feel broken.

    IMERG via NASA GIBS   0.1 deg, 30 min cadence, measured 6.4 HOURS behind
    GSMaP_NOW             0.1 deg, 30 min cadence, ~2 min behind its own
                          one-hour averaging window

The detail tier at the time (GOES RRQPE, removed 2026-09-23) was ten minutes old. Against a
six-hour-old global tier that is roughly 325 km of storm movement — about a
fifth of the screen at z5 — so rain visibly JUMPED when the map swapped
tiers on zoom. Against a half-hour-old global tier it is tens of kilometres.

GSMaP is also passive-microwave-based like IMERG, so it sees the light
stratiform ocean rain that the infrared GOES product misses. Measured on one
frame: GSMaP found 12.84% of its cells raining; GOES found 2.77% of its box.

Format (from /now/README.first.txt and /now/sample/GSMaP_NOW.hourly.rain.ctl)
----------------------------------------------------------------------------
    gsmap_now.YYYYMMDD.HHNN.dat.gz     ~2.1 MB gz, 17,280,000 bytes raw
    3600 x 1200 float32 LITTLE_ENDIAN, 0.1 deg
    XDEF  lon  0.05 .. 359.95      (0-360 EAST, not -180..180)
    YDEF  lat -59.95 .. 59.95, but OPTIONS YREV -> row 0 is the NORTH edge
    UNDEF -99;  -4 = sea ice, -8 = low temperature, -99 = no observation
    Units mm/hr, averaged over the hour the filename starts

YREV was verified against the GOES pyramid rather than trusted: sampling both
over the Americas, north-first agreed on 48.8% of GOES's raining points
(corr +0.24) and south-first on 6.6% (corr -0.01, i.e. noise).

Credit required by JAXA FAQ Q14/Q16, and carried in the layer:
    "(c)JAXA, provided by JAXA, Courtesy of JAXA"
We process the binary into our own rasters rather than redistributing JAXA's
files, which is the case their FAQ says needs no further procedure.
"""

import gzip
import json
import os
import re
import sys
from datetime import datetime, timezone
from ftplib import FTP

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _rain_common import (  # noqa: E402
    TILE, b64file, build_pyramid, load_ramp, pixel_lats, pixel_lons,
    publish, tile_window, write_pmtiles,
)

FTP_HOST = "hokusai.eorc.jaxa.jp"
NOW_DIR = "/now/latest"
NX, NY = 3600, 1200
DLON = DLAT = 0.1
LAT0_NORTH = 59.95          # centre of row 0 (YREV)
LON0 = 0.05                 # centre of column 0, degrees EAST

# Global. MAXZ 5 is a mild oversample of 0.1 deg (native is ~z4). The field
# is bilinearly smoothed at that level (see resample), and Mapbox's linear
# resampling carries the smooth field when it overzooms above it.
WEST, EAST = -180.0, 180.0
LAT_LIMIT = 60.0
MINZ, MAXZ = 0, 5
CREDIT = "(c)JAXA, provided by JAXA, Courtesy of JAXA"


def newest_frame():
    """Newest gsmap_now frame in /now/latest, as (name, bytes)."""
    user = os.environ.get("GSMAP_FTP_USER")
    pw = os.environ.get("GSMAP_FTP_PASS")
    if not (user and pw):
        raise SystemExit("set GSMAP_FTP_USER / GSMAP_FTP_PASS (JAXA GSMaP registration)")
    ftp = FTP(FTP_HOST, timeout=180)
    try:
        ftp.login(user, pw)
        ftp.set_pasv(True)
        ftp.cwd(NOW_DIR)
        names = [n for n in ftp.nlst()
                 if re.fullmatch(r"gsmap_now\.\d{8}\.\d{4}\.dat\.gz", n)]
        if not names:
            raise SystemExit("no gsmap_now frames in /now/latest")
        name = sorted(names)[-1]
        chunks = []
        ftp.retrbinary(f"RETR {name}", chunks.append)
    finally:
        try: ftp.quit()
        except Exception: ftp.close()
    return name, b"".join(chunks)


def read_grid(raw_gz):
    raw = gzip.decompress(raw_gz)
    if len(raw) != NX * NY * 4:
        raise SystemExit(f"unexpected frame size {len(raw)} (want {NX * NY * 4})")
    a = np.frombuffer(raw, dtype="<f4").reshape(NY, NX)
    # Every negative value is a missing-data flag, not a rate.
    return np.where(a < 0, np.nan, a).astype(np.float32)


def resample(src, x0, x1, y0, y1):
    """
    Equirectangular 0.1 deg -> Web Mercator, SMOOTHED: bilinear interpolation
    of the rain RATE between cell centres, then coloured.

    Josh chose a smoothed display (2026-09-23). Drawn as hard cells, an 11 km
    grid is a field of squares at z5 — the storm off Acapulco read as blocks.
    Interpolating the VALUES (not the colours) keeps every pixel a real rate
    on the one ramp: blending colours instead would invent shades that sit
    nowhere on the scale. Dry cells are 0, so a rain edge fades out across
    one cell instead of stopping on a cell boundary. What this adds is
    display, not measurement — the layer copy says so.

    Missing cells (flags, beyond 60 deg) are left out of the weighting rather
    than treated as dry; a pixel with no valid neighbour stays NaN.

    Latitude varies only down rows and longitude only across columns, so the
    weights are two 1-D lookups.
    """
    W, H = (x1 - x0) * TILE, (y1 - y0) * TILE
    lons = pixel_lons(x0, x1, MAXZ)
    fc = (np.mod(lons, 360.0) - LON0) / DLON           # fractional column
    c0 = np.floor(fc).astype(np.int64)
    wc = (fc - c0).astype(np.float32)
    c1 = (c0 + 1) % NX                                  # wraps the dateline
    c0 = c0 % NX
    valid = np.isfinite(src)
    vals = np.where(valid, src, 0.0).astype(np.float32)
    okf = valid.astype(np.float32)
    out = np.full((H, W), np.nan, dtype=np.float32)
    # Banded so peak memory stays in the hundreds of MB rather than gigabytes.
    for top in range(0, H, TILE * 4):
        rows_n = min(TILE * 4, H - top)
        lats = pixel_lats(y0, rows_n, MAXZ, offset=top)
        fr = (LAT0_NORTH - lats) / DLAT                 # fractional row
        inside = (fr >= -0.5) & (fr <= NY - 0.5)        # outside +-60: stays NaN
        r0 = np.clip(np.floor(fr), 0, NY - 1).astype(np.int64)
        r1 = np.clip(r0 + 1, 0, NY - 1)
        wr = np.clip(fr - np.floor(fr), 0, 1).astype(np.float32)
        num = np.zeros((rows_n, W), np.float32)
        den = np.zeros((rows_n, W), np.float32)
        for ri, wy in ((r0, 1 - wr), (r1, wr)):
            for ci, wx in ((c0, 1 - wc), (c1, wc)):
                w = wy[:, None] * wx[None, :] * okf[ri[:, None], ci[None, :]]
                num += w * vals[ri[:, None], ci[None, :]]
                den += w
        band = np.where(den > 0, num / np.maximum(den, 1e-6), np.nan)
        out[top:top + rows_n] = np.where(inside[:, None], band, np.nan)
    return spline_smooth(out, y0)


def _box(P, lo, hi, axis):
    """Sum of a prefix-summed array between fractional positions lo..hi."""
    n = P.shape[axis] - 1
    def at(p):
        p = np.clip(p, 0, n)
        k = np.minimum(np.floor(p).astype(np.int64), n - 1)
        f = (p - k).astype(np.float32)
        if axis == 1:
            return P[:, k] + (P[:, k + 1] - P[:, k]) * f[None, :]
        return P[k, :] + (P[k + 1, :] - P[k, :]) * f[:, None]
    return at(hi) - at(lo)


def spline_smooth(grid, y0):
    """
    One more one-cell box pass over the bilinear field, in RATE space —
    bilinear is itself one box pass over the cells, so together they are a
    quadratic B-spline (a third pass, i.e. cubic, blurred the cores visibly). Bilinear alone left the rain/dry boundary stepping along the grid
    (visible on Hurricane Polo's rim at z5, 2026-09-23); the spline's
    contours are smooth curves. Cost: an isolated single-cell peak is drawn at
    about 3/4 of its value; broad cores keep theirs. Missing data is carried
    as a weight, never as dry. api/imerg-tiles.js applies the same spline to
    the replay tier so the two look alike.
    """
    H, W = grid.shape
    ok = np.isfinite(grid).astype(np.float32)
    num = np.where(ok > 0, grid, 0).astype(np.float32)
    den = ok.copy()
    wx = TILE * (1 << MAXZ) * DLON / 360.0              # one cell, in pixels
    cols = np.arange(W, dtype=np.float64) + 0.5
    lats = pixel_lats(y0, H, MAXZ)
    wy = wx / np.maximum(0.05, np.cos(np.radians(lats)))
    rows = np.arange(H, dtype=np.float64) + 0.5
    for _ in range(1):
        for arr in (num, den):
            P = np.concatenate([np.zeros((H, 1), np.float32), np.cumsum(arr, axis=1, dtype=np.float32)], axis=1)
            arr[:] = _box(P, cols - wx / 2, cols + wx / 2, 1) / wx
        for arr in (num, den):
            P = np.concatenate([np.zeros((1, W), np.float32), np.cumsum(arr, axis=0, dtype=np.float32)], axis=0)
            arr[:] = _box(P, rows - wy / 2, rows + wy / 2, 0) / wy[:, None]
    out = np.where(den > 1e-3, num / np.maximum(den, 1e-6), np.nan).astype(np.float32)
    out[ok == 0] = np.where(den[ok == 0] > 0.5, out[ok == 0], np.nan)   # never grow into no-data
    return out


def main():
    ramp_v, ramp_c = load_ramp()
    name, raw_gz = newest_frame()
    print(f"frame: {name}  ({len(raw_gz) / 1048576:.2f} MB gz)")
    src = read_grid(raw_gz)
    print(f"  raining cells {100 * np.nanmean(src > 0):.2f}%  max {np.nanmax(src):.1f} mm/h")

    x0, x1, y0, y1 = tile_window(WEST, EAST, LAT_LIMIT, MINZ, MAXZ)
    print(f"pyramid z{MINZ}-{MAXZ}  tiles x[{x0},{x1}) y[{y0},{y1})")
    grid = resample(src, x0, x1, y0, y1)
    tiles, empty = build_pyramid(grid, x0, y0, MINZ, MAXZ, ramp_v, ramp_c)
    pmt = write_pmtiles(tiles, "gsmap-now", WEST, EAST, LAT_LIMIT, MINZ, MAXZ)
    print(f"tiles {len(tiles)} written, {empty} dry skipped · pmtiles {len(pmt) / 1048576:.2f} MB")

    m = re.fullmatch(r"gsmap_now\.(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})\.dat\.gz", name)
    start = datetime(*(int(g) for g in m.groups()), tzinfo=timezone.utc)
    meta = {
        "version": 1, "schema": 1, "kind": "gsmap-now",
        # The frame is an average over the hour that STARTS here, published a
        # couple of minutes after that hour ends. Stamping it with the start
        # would claim it is an hour older than it is; stamping it with the end
        # would claim observations we do not have. The midpoint is the honest
        # single number, and the layer says it is an hourly average.
        "valid_ms": int((start.timestamp() + 1800) * 1000),
        "window_start_ms": int(start.timestamp() * 1000),
        "window_end_ms": int((start.timestamp() + 3600) * 1000),
        "fetched_ms": int(datetime.now(timezone.utc).timestamp() * 1000),
        "west": WEST, "east": EAST, "lat_limit": LAT_LIMIT,
        "minzoom": MINZ, "maxzoom": MAXZ,
        "downsample": "max",
        "upsample": "quadratic B-spline on rate (display smoothing)",
        "frame": name,
        "credit": CREDIT,
        "source": "JAXA GSMaP_NOW (Global Satellite Mapping of Precipitation, real-time), "
                  "0.1 deg hourly rain rate, coloured with the NASA GIBS GPM rain-rate ramp",
    }
    publish([
        b64file("systems/gsmap-now.pmtiles", "application/octet-stream", pmt),
        b64file("systems/gsmap-now-meta.json", "application/json",
                json.dumps(meta).encode()),
    ], os.path.dirname(os.path.abspath(__file__)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
