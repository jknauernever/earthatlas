"""
Bake LiveOcean (UW) surface pH + aragonite for the /inmotion ocean-acidity
layer. Python (not node) because the source is a 3.1 GB daily HDF5 file on
UW's public kopah S3 — h5py + fsspec range-read just the metadata and the
two "now" chunks (~5 MB moved per run).

Source file: https://s3.kopah.uw.edu/liveocean-share/f<YYYY.MM.DD>/layers.nc
(the LiveOcean "layers1" post-processing product; PH/ARAG computed by their
pipeline with PyCO2SYS). Publishes ~12:45 UTC daily; we fall back up to 3
days so a late run never kills the layer.

Runs as a GitHub Actions cron (.github/workflows/liveocean-bake.yml) — the
Vercel project's Vite framework preset refuses to build python functions in
api/, so this bake lives in CI instead. Local runner: scripts/bake-liveocean.py.
Deps: scripts/liveocean-requirements.txt
"""
import datetime as dt
import json
import os
import time

MISSING = -32768
BUCKET = "https://s3.kopah.uw.edu/liveocean-share"
SOURCE = (
    "UW LiveOcean model (MacCready group) daily forecast — surface {long} "
    "computed with PyCO2SYS from model carbon chemistry; ~500 m ROMS grid (cas7)"
)

# Uniform target grid over the LiveOcean domain (~1.3 km, ~890 KB/variable).
LAT0, LAT1, DLAT = 42.0, 52.0, 0.012
LON0, LON1, DLON = -130.0, -122.0, 0.015

VARS = [
    {"h5": "PH_surface", "base": "liveocean-ph", "kind": "liveocean-ph-surface",
     "long": "pH (total scale)", "scale": 2000, "max_abs": 12},
    {"h5": "ARAG_surface", "base": "liveocean-arag", "kind": "liveocean-arag-surface",
     "long": "aragonite saturation state (omega)", "scale": 2000, "max_abs": 12},
]


def open_latest():
    import fsspec
    import h5py
    last_err = None
    for back in range(4):
        day = dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=back)
        url = f"{BUCKET}/f{day.strftime('%Y.%m.%d')}/layers.nc"
        try:
            f = fsspec.open(url, mode="rb", block_size=2 * 1024 * 1024).open()
            return h5py.File(f, "r"), day, url
        except Exception as e:  # noqa: BLE001 - fall back to the previous day
            last_err = e
    raise RuntimeError(f"no LiveOcean layers.nc found in last 4 days: {last_err}")


def fill_coastal_gaps(grid, iterations=2):
    """A missing cell with >=3 valid 8-neighbors takes their mean, extending
    the field one cell toward shore per pass so the client's bilinear sampler
    has corners; the renderer clips to the basemap's real water polygons."""
    import numpy as np
    g = grid
    for _ in range(iterations):
        v = np.isfinite(g)
        p = np.pad(g, 1, constant_values=np.nan)
        stacks = [p[r:r + g.shape[0], c:c + g.shape[1]]
                  for r in (0, 1, 2) for c in (0, 1, 2) if not (r == 1 and c == 1)]
        stack = np.stack(stacks)
        cnt = np.sum(np.isfinite(stack), axis=0)
        mean = np.nanmean(np.where(np.isfinite(stack), stack, np.nan), axis=0)
        g = np.where((~v) & (cnt >= 3), mean, g)
    return g


def bake():
    import numpy as np
    t_start = time.time()
    h, day, url = open_latest()

    times = h["ocean_time"][:]  # seconds since 1970
    ti = int(np.nanargmin(np.abs(times - time.time())))
    valid_ms = int(times[ti] * 1000)
    run_ms = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp() * 1000)

    # Plaid grid: lon constant along rows, lat constant along columns.
    src_lon = h["lon_rho"][0, :]
    src_lat = h["lat_rho"][:, 0]
    mask = h["mask_rho"][:] > 0  # 1 = water

    n_lat = int(round((LAT1 - LAT0) / DLAT)) + 1
    n_lon = int(round((LON1 - LON0) / DLON)) + 1
    tgt_lat = LAT0 + DLAT * np.arange(n_lat)
    tgt_lon = LON0 + DLON * np.arange(n_lon)

    def nearest_idx(src, tgt):
        idx = np.searchsorted(src, tgt)
        idx = np.clip(idx, 1, len(src) - 1)
        left, right = src[idx - 1], src[idx]
        idx = np.where(np.abs(tgt - left) <= np.abs(right - tgt), idx - 1, idx)
        half = max(float(np.abs(np.diff(src)).max()), 1e-6)
        idx[np.abs(src[idx] - tgt) > half] = -1
        return idx

    la_i = nearest_idx(src_lat, tgt_lat)
    lo_i = nearest_idx(src_lon, tgt_lon)
    ok_la, ok_lo = la_i >= 0, lo_i >= 0

    outputs = []
    stats = []
    for v in VARS:
        field = h[v["h5"]][ti]  # one chunk read: (1302, 663) float64
        field = np.where(mask & np.isfinite(field) & (np.abs(field) < 1e19), field, np.nan)
        grid = np.full((n_lat, n_lon), np.nan)
        grid[np.ix_(ok_la, ok_lo)] = field[np.ix_(la_i[ok_la], lo_i[ok_lo])]
        grid = fill_coastal_gaps(grid)

        enc = np.where(
            np.isfinite(grid) & (np.abs(grid) < v["max_abs"]),
            np.round(grid * v["scale"]),
            MISSING,
        ).astype("<i2")
        vals = grid[np.isfinite(grid)]
        stats.append({"var": v["h5"], "cells": int(np.sum(enc != MISSING)),
                      "min": round(float(vals.min()), 3), "max": round(float(vals.max()), 3)})

        meta = {
            "version": 1, "kind": v["kind"], "run_ms": run_ms, "valid_ms": valid_ms,
            "fetched_ms": int(time.time() * 1000),
            "nLat": n_lat, "nLon": n_lon,
            "lat0": float(tgt_lat[0]), "dLat": DLAT, "lon0": float(tgt_lon[0]), "dLon": DLON,
            "scale": v["scale"], "missing": MISSING,
            "source": SOURCE.format(long=v["long"]),
        }
        outputs.append((v["base"], enc.tobytes(), meta))

    return {
        "outputs": outputs,
        "summary": {"url": url, "valid": dt.datetime.fromtimestamp(valid_ms / 1000, dt.timezone.utc).isoformat(),
                    "stats": stats, "seconds": round(time.time() - t_start, 1)},
    }


def upload_to_blob(outputs, token):
    import urllib.request
    for base, buf, meta in outputs:
        for name, body, ctype in [
            (f"{base}-grid.bin", buf, "application/octet-stream"),
            (f"{base}-meta.json", json.dumps(meta).encode(), "application/json"),
        ]:
            req = urllib.request.Request(
                f"https://blob.vercel-storage.com/systems/{name}",
                data=body, method="PUT",
                headers={
                    "Authorization": f"Bearer {token}",
                    "x-content-type": ctype,
                    "x-add-random-suffix": "0",
                    "x-allow-overwrite": "1",
                    "x-cache-control-max-age": "300",
                },
            )
            urllib.request.urlopen(req, timeout=60).read()
