#!/usr/bin/env python3
"""
Bake global sea-surface pH from the Copernicus Marine biogeochemistry
forecast (GLOBAL_ANALYSISFORECAST_BGC_001_028, 0.25°, daily) for the
/inmotion ocean-acidity layer's zoomed-out view. The official toolbox
handles auth + download (needs COPERNICUSMARINE_SERVICE_USERNAME/PASSWORD,
or CMEMS_USERNAME/PASSWORD which this script maps across).

Runs in the same GitHub Actions cron as the LiveOcean bake
(.github/workflows/liveocean-bake.yml). Local:
  python3 scripts/bake-cmems-ph.py             # writes public/dev-data/systems/
  LIVEOCEAN_INGEST_URL=... CRON_SECRET=...     # uploads via the site's ingest
"""
import datetime as dt
import importlib.util
import json
import os
import sys
import tempfile
import time

MISSING = -32768
SCALE = 2000
MAX_ABS = 12
KIND = "cmems-ph-surface"
BASE = "cmems-ph"
SOURCE = (
    "Copernicus Marine global ocean biogeochemistry analysis & forecast — "
    "sea-surface pH on the total scale (0.25°, Mercator Ocean / E.U. Copernicus Marine Service)"
)

for a, b in [("CMEMS_USERNAME", "COPERNICUSMARINE_SERVICE_USERNAME"),
             ("CMEMS_PASSWORD", "COPERNICUSMARINE_SERVICE_PASSWORD")]:
    if os.environ.get(a) and not os.environ.get(b):
        os.environ[b] = os.environ[a]


def bake():
    import copernicusmarine as cm
    import numpy as np
    import xarray as xr

    t0 = time.time()
    day = dt.datetime.now(dt.timezone.utc).date()
    tmp = tempfile.mkdtemp()
    last_err = None
    for back in range(3):  # today's field, else step back
        d = day - dt.timedelta(days=back)
        try:
            cm.subset(
                dataset_id="cmems_mod_glo_bgc-car_anfc_0.25deg_P1D-m",
                variables=["ph"],
                start_datetime=str(d), end_datetime=str(d),
                minimum_depth=0, maximum_depth=1,
                output_filename="ph.nc", output_directory=tmp, overwrite=True,
            )
            break
        except Exception as e:  # noqa: BLE001
            last_err = e
    else:
        raise RuntimeError(f"no CMEMS ph field in last 3 days: {last_err}")

    ds = xr.open_dataset(os.path.join(tmp, "ph.nc"))
    grid = ds.ph.values.squeeze().astype("float64")  # (681, 1440), NaN on land
    lat = ds.latitude.values
    lon = ds.longitude.values
    valid_ms = int(ds.time.values[0].astype("datetime64[ms]").astype("int64"))

    # One dilation pass toward shore (longitude-wrapped) so the client's
    # bilinear sampler + water mask render clean coasts — same treatment as
    # the SST and LiveOcean bakes.
    g = np.pad(grid, ((1, 1), (0, 0)), constant_values=np.nan)
    g = np.concatenate([g[:, -1:], g, g[:, :1]], axis=1)
    stacks = [g[r:r + grid.shape[0], c:c + grid.shape[1]]
              for r in (0, 1, 2) for c in (0, 1, 2) if not (r == 1 and c == 1)]
    stack = np.stack(stacks)
    cnt = np.sum(np.isfinite(stack), axis=0)
    mean = np.nanmean(np.where(np.isfinite(stack), stack, np.nan), axis=0)
    grid = np.where((~np.isfinite(grid)) & (cnt >= 3), mean, grid)

    enc = np.where(np.isfinite(grid) & (np.abs(grid) < MAX_ABS),
                   np.round(grid * SCALE), MISSING).astype("<i2")
    vals = grid[np.isfinite(grid)]
    meta = {
        "version": 1, "kind": KIND, "run_ms": valid_ms, "valid_ms": valid_ms,
        "fetched_ms": int(time.time() * 1000),
        "nLat": len(lat), "nLon": len(lon),
        "lat0": float(lat[0]), "dLat": float((lat[-1] - lat[0]) / (len(lat) - 1)),
        "lon0": float(lon[0]), "dLon": float((lon[-1] - lon[0]) / (len(lon) - 1)),
        "scale": SCALE, "missing": MISSING, "source": SOURCE,
    }
    summary = {"valid": str(ds.time.values[0])[:16], "cells": int(np.sum(enc != MISSING)),
               "min": round(float(vals.min()), 3), "max": round(float(vals.max()), 3),
               "seconds": round(time.time() - t0, 1)}
    return [(BASE, enc.tobytes(), meta)], summary


def main():
    outputs, summary = bake()
    print(json.dumps(summary, indent=2))
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    spec = importlib.util.spec_from_file_location(
        "liveocean_bake", os.path.join(root, "scripts", "liveocean_bake.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    ingest = os.environ.get("LIVEOCEAN_INGEST_URL")
    secret = os.environ.get("CRON_SECRET")
    token = os.environ.get("BLOB_READ_WRITE_TOKEN")
    if ingest and secret:
        print("uploaded via ingest:", json.dumps(mod.upload_via_ingest(outputs, ingest, secret)))
    elif token:
        mod.upload_to_blob(outputs, token)
        print("uploaded to Vercel Blob")
    else:
        out_dir = os.path.join(root, "public", "dev-data", "systems")
        os.makedirs(out_dir, exist_ok=True)
        for base, buf, meta in outputs:
            open(os.path.join(out_dir, f"{base}-grid.bin"), "wb").write(buf)
            open(os.path.join(out_dir, f"{base}-meta.json"), "w").write(json.dumps(meta))
        print("wrote public/dev-data/systems/")


if __name__ == "__main__":
    sys.exit(main())
