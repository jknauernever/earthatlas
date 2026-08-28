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


def bake_tape(mod, days=31):
    """Global daily tape: one frame per day for the last `days`, one toolbox
    subset call. Frames older than yesterday that already exist in the blob
    index are reused (analysis fields don't change) — only their index rows
    are kept; fresh PNGs are shipped for new/recent days."""
    import copernicusmarine as cm
    import numpy as np
    import xarray as xr

    base = "cmems-ph"
    today = dt.datetime.now(dt.timezone.utc).date()
    start = today - dt.timedelta(days=days - 1)
    tmp = tempfile.mkdtemp()
    cm.subset(
        dataset_id="cmems_mod_glo_bgc-car_anfc_0.25deg_P1D-m",
        variables=["ph"],
        start_datetime=str(start), end_datetime=str(today),
        minimum_depth=0, maximum_depth=1,
        output_filename="ph-tape.nc", output_directory=tmp, overwrite=True,
    )
    ds = xr.open_dataset(os.path.join(tmp, "ph-tape.nc"))
    lat, lon = ds.latitude.values, ds.longitude.values
    meta_like = {"nLat": len(lat), "nLon": len(lon),
                 "lat0": float(lat[0]), "dLat": float((lat[-1] - lat[0]) / (len(lat) - 1)),
                 "lon0": float(lon[0]), "dLon": float((lon[-1] - lon[0]) / (len(lon) - 1))}
    existing = mod.fetch_existing_index(base)
    have = {f["valid_ms"] for f in (existing or {}).get("frames", [])}
    keep_before = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).timestamp() * 1000

    files, frames = [], []
    for ti in range(ds.time.size):
        valid_ms = int(ds.time.values[ti].astype("datetime64[ms]").astype("int64"))
        stamp = dt.datetime.fromtimestamp(valid_ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d-%H")
        path = f"systems/{base}-tape/{stamp}.png"
        frames.append({"valid_ms": valid_ms, "run_ms": valid_ms, "lead_h": 0, "path": path})
        if valid_ms in have and valid_ms < keep_before:
            continue  # stable analysis day already in blob
        grid = ds.ph.values[ti].squeeze().astype("float64")
        files.append({"path": path, "contentType": "image/png",
                      "bytes": mod.encode_tape_frame(grid)})
    index = mod.build_tape_index("cmems-ph-surface", SOURCE, meta_like, 24, days,
                                 sorted(frames, key=lambda f: f["valid_ms"]))
    files.append({"path": f"systems/{base}-tape.json", "contentType": "application/json",
                  "bytes": json.dumps(index).encode()})
    return files, {"frames": len(frames), "png_uploads": len(files) - 1}


def main():
    outputs, summary = bake()
    print(json.dumps(summary, indent=2))
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    spec = importlib.util.spec_from_file_location(
        "liveocean_bake", os.path.join(root, "scripts", "liveocean_bake.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    files = mod.grid_pair_files(outputs)
    tape_files, tape_summary = bake_tape(mod)
    print("daily tape:", json.dumps(tape_summary))
    files += tape_files
    ingest = os.environ.get("LIVEOCEAN_INGEST_URL")
    secret = os.environ.get("CRON_SECRET")
    if ingest and secret:
        resp = mod.upload_files_via_ingest(files, ingest, secret)
        print(f"uploaded via ingest: {len(resp['written'])} files")
    else:
        out_dir = os.path.join(root, "public", "dev-data", "systems")
        for f in files:
            rel = f["path"].removeprefix("systems/")
            dest = os.path.join(out_dir, rel)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            open(dest, "wb").write(f["bytes"])
        print("wrote public/dev-data/systems/")


if __name__ == "__main__":
    sys.exit(main())
