#!/usr/bin/env python3
"""
Build vessel-track vector tiles (PMTiles) for /shiptraffic from the REAL
MarineCadastre AIS GeoParquet — Salish Sea bbox, all of 2024 + 2025.

This is the display layer that REPLACES the Esri Living Atlas tiles. Each tile
feature is a real vessel track (LineString, clipped to the bbox) tagged with:
  - class : one of our 7 UI classes (reuses fetch_ais.vessel_class)
  - month : "YYYY-MM"  (lets the timeframe slider filter client-side)
  - mmsi  : stable vessel id (popups + future name/search work)

So the existing vessel-type filter + month range work unchanged — just point the
Mapbox source at tracks.pmtiles instead of the per-month Esri services.

One PMTiles PER MONTH is the deliverable (track_tiles/tracks-YYYY-MM.pmtiles):
  for each month:  DuckDB clip+simplify -> tmp NDJSON -> tippecanoe -> tracks-YM.pmtiles
                   (delete the multi-GB NDJSON immediately)

The app stacks the months in view (capped + sampled), one Mapbox source per month,
so each tile stays ~150-460 KB. We deliberately do NOT merge months into one
combined/aggregate tile: tile-join blows past the per-tile size limit (~16 MB tiles
that hung the Mapbox worker), and decode+re-tile duplicates edge tracks via the
render buffer into faint grid-line artifacts. Stacking clean per-month tiles avoids
both. Upload the per-month files with upload.mjs.

Resumable: months whose tracks-YM.pmtiles already exists are skipped.

Run:  python3 build_tracks_tiles.py             # all 24 months
      python3 build_tracks_tiles.py 2024-01      # one month (smoke test)
Deps: pip install duckdb ; brew install tippecanoe
"""

import json
import os
import sys
import time
import subprocess

import bake  # BBOX
from fetch_ais import vessel_class, TRACK_URL

HERE = os.path.dirname(__file__)
TILES_DIR = os.path.join(HERE, "track_tiles")         # per-month pmtiles (gitignored) → upload to Vercel Blob

# Full real range — independent of bake.MONTHS (which the concern grid may cap).
ALL_MONTHS = [f"{y}-{m:02d}" for y in (2024, 2025) for m in range(1, 13)]

# Raw AIS tracks are wildly over-sampled (a ping every few seconds → thousands of
# vertices per monthly track). Simplify to ~20 m before tiling: invisible at map
# zoom, but cuts vertex count (and tile size) by ~1-2 orders of magnitude.
SIMPLIFY_TOL = 0.0002  # degrees (~18 m lat, ~13 m lng at 48°N)


def extract_month(con, ym, path, tol=SIMPLIFY_TOL):
    """Write real clipped + simplified tracks for one month to an NDJSON file.
    (A server-side DuckDB COPY ... TO FORMAT JSON was tried and was ~2x SLOWER —
    the ST_AsGeoJSON::JSON re-parse + json_object cost more than this Python loop,
    so we keep streaming rows out here. The cost is the remote scan + clip, not this.)"""
    W, S, E, N = bake.BBOX["w"], bake.BBOX["s"], bake.BBOX["e"], bake.BBOX["n"]
    env = f"ST_MakeEnvelope({W},{S},{E},{N})"
    url = TRACK_URL.format(ym=ym)
    sql = f"""
      SELECT mmsi, vessel_type,
             ST_AsGeoJSON(ST_Simplify(ST_Intersection(geometry, {env}), {tol})) AS gj
      FROM read_parquet('{url}')
      WHERE ST_Intersects(geometry, {env})
    """
    cur = con.execute(sql)
    n = 0
    with open(path, "w") as fh:
        while True:
            rows = cur.fetchmany(5000)
            if not rows:
                break
            for mmsi, vt, gj in rows:
                if not gj:
                    continue
                geom = json.loads(gj)
                if geom.get("type") not in ("LineString", "MultiLineString"):
                    continue  # tangent intersections can yield points — skip
                fh.write(json.dumps({
                    "type": "Feature",
                    "properties": {
                        "class": vessel_class(vt),
                        "month": ym,
                        "mmsi": int(mmsi) if mmsi is not None else 0,
                    },
                    "geometry": geom,
                }) + "\n")
                n += 1
    return n


def tile_month(ndjson, out):
    # Cap at z10 — the app's source maxzoom is 10 and Mapbox over-zooms past it, so
    # z11+ tiles are never requested. NO --extend-zooms-if-still-dropping: under the
    # full-ecosystem bbox it extended to z16, exploding the file (~477 MB) and build
    # time (~35 min) on tiles nobody fetches. drop-densest caps each z10 tile instead.
    cmd = [
        "tippecanoe", "-o", out, "-l", "tracks", "-f", "-q",
        "-Z5", "-z10",
        "--simplification=10",
        "--drop-densest-as-needed",
        "--read-parallel",
        ndjson,
    ]
    subprocess.run(cmd, check=True)


_TRANSIENT = ("could not establish connection", "io error", "http", "connection",
              "timeout", "timed out", "reset", "temporarily")


def build_month(con, ym, retries=5):
    """Extract → tile → drop the multi-GB NDJSON. Skips if the monthly tile exists.
    Retries transient network errors with backoff so a brief drop (e.g. the laptop
    sleeping) just pauses that month instead of failing it."""
    monthly = os.path.join(TILES_DIR, f"tracks-{ym}.pmtiles")
    if os.path.exists(monthly):
        print(f"  {ym}: skip (tile exists, {os.path.getsize(monthly)/1e6:.1f} MB)")
        return monthly
    ndjson = os.path.join(HERE, f".tracks-{ym}.ndjson")
    for attempt in range(retries):
        t0 = time.time()
        try:
            n = extract_month(con, ym, ndjson)
            tile_month(ndjson, monthly)
            os.remove(ndjson)  # reclaim the multi-GB intermediate immediately
            print(f"  {ym}: {n:>7,} tracks → {os.path.getsize(monthly)/1e6:.1f} MB  ({time.time()-t0:.0f}s)")
            return monthly
        except Exception as e:
            msg = str(e)
            if os.path.exists(ndjson):
                os.remove(ndjson)
            transient = any(s in msg.lower() for s in _TRANSIENT)
            if transient and attempt < retries - 1:
                wait = 30 * (attempt + 1)
                print(f"  {ym}: transient error (try {attempt+1}/{retries}), retry in {wait}s — {msg[:70]}")
                time.sleep(wait)
                continue
            print(f"  {ym}: FAILED — {msg[:140]}")
            return None


def main():
    os.makedirs(TILES_DIR, exist_ok=True)
    months = [a for a in sys.argv[1:] if not a.startswith("--")] or ALL_MONTHS
    print(f"ShipTraffic track tiles — bbox {bake.BBOX}, {len(months)} month(s)")
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET enable_progress_bar=false;")
    # Bounded so a few month-range processes can run in parallel without OOM.
    con.execute("SET memory_limit='4GB'; SET threads=3;")
    built = [m for m in (build_month(con, ym) for ym in months) if m]
    print(f"\n✓ {len(built)} month(s) in {TILES_DIR} — upload with upload.mjs")


if __name__ == "__main__":
    main()
