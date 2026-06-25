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

The app stacks only the months in view (capped + sampled), one Mapbox source per
month, so each tile stays ~150-460 KB. We deliberately do NOT tile-join the months
into one file: tile-join concatenates features without re-applying the per-tile
size limit, which produced ~16 MB combined tiles that hung the Mapbox worker.
Upload the per-month files with upload.mjs.

Plus year + "all" AGGREGATES (tracks-2024/2025/all.pmtiles): one size-capped
tileset per year so the "2024"/"2025"/"All" views show true all-months traffic in
a single light source instead of stacking N per-month layers. See build_aggregate.

Resumable: months whose tracks-YM.pmtiles already exists are skipped.

Run:  python3 build_tracks_tiles.py                  # all 24 months + aggregates
      python3 build_tracks_tiles.py 2024-01          # one month (smoke test)
      python3 build_tracks_tiles.py --aggregates-only  # rebuild year/all from existing monthlies
Deps: pip install duckdb ; brew install tippecanoe jq
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


def extract_month(con, ym, path):
    """Write real clipped + simplified tracks for one month to an NDJSON file."""
    W, S, E, N = bake.BBOX["w"], bake.BBOX["s"], bake.BBOX["e"], bake.BBOX["n"]
    env = f"ST_MakeEnvelope({W},{S},{E},{N})"
    url = TRACK_URL.format(ym=ym)
    sql = f"""
      SELECT mmsi, vessel_type,
             ST_AsGeoJSON(ST_Simplify(ST_Intersection(geometry, {env}), {SIMPLIFY_TOL})) AS gj
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
    cmd = [
        "tippecanoe", "-o", out, "-l", "tracks", "-f", "-q",
        "-Z5", "-z11",
        "--simplification=10",
        "--drop-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        "--read-parallel",
        ndjson,
    ]
    subprocess.run(cmd, check=True)


def build_month(con, ym):
    """Extract → tile → drop the multi-GB NDJSON. Skips if monthly tile exists."""
    monthly = os.path.join(TILES_DIR, f"tracks-{ym}.pmtiles")
    if os.path.exists(monthly):
        print(f"  {ym}: skip (tile exists, {os.path.getsize(monthly)/1e6:.1f} MB)")
        return monthly
    ndjson = os.path.join(HERE, f".tracks-{ym}.ndjson")
    t0 = time.time()
    try:
        n = extract_month(con, ym, ndjson)
        tile_month(ndjson, monthly)
    except Exception as e:
        print(f"  {ym}: FAILED — {str(e)[:140]}")
        if os.path.exists(ndjson):
            os.remove(ndjson)
        return None
    os.remove(ndjson)  # reclaim the ~5 GB immediately
    print(f"  {ym}: {n:>7,} tracks → {os.path.getsize(monthly)/1e6:.1f} MB  ({time.time()-t0:.0f}s)")
    return monthly


# Year/All aggregates: one size-capped tileset covering every month of a year (or
# all of them), so the "2024"/"2025"/"All" views render true all-months traffic in
# a single light source instead of stacking N per-month layers. Capped at z10.
#
# The per-month NDJSON is deleted after each month bakes, so we rebuild an
# aggregate's input by DECODING the existing per-month pmtiles back to GeoJSON
# (tippecanoe-decode at the monthly maxzoom) and re-tiling the union with
# --drop-densest-as-needed. drop-densest thins the heavily-overlapping lanes
# (vessels repeat the same lanes every month) to keep each tile ~200-430 KB while
# the aggregate still reads as the full year. Needs `jq` (brew install jq).
AGG_MAXZOOM = 10


def decode_month_into(monthly, fh):
    """Append a month's tracks, decoded from its pmtiles, as NDJSON to fh."""
    dec = subprocess.Popen(["tippecanoe-decode", "-z11", "-Z11", monthly],
                           stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    jq = subprocess.Popen(["jq", "-c", ".features[].features[].features[]"],
                          stdin=dec.stdout, stdout=fh)
    dec.stdout.close()
    jq.communicate()
    if dec.wait() or jq.returncode:
        raise RuntimeError(f"decode failed for {monthly}")


def build_aggregate(name, months):
    """Merge `months` (a year's worth, or all) into one size-capped tileset."""
    monthlies = [os.path.join(TILES_DIR, f"tracks-{ym}.pmtiles") for ym in months]
    monthlies = [m for m in monthlies if os.path.exists(m)]
    if not monthlies:
        print(f"  agg {name}: no monthly tiles — skip")
        return None
    out = os.path.join(TILES_DIR, f"tracks-{name}.pmtiles")
    tmp = os.path.join(HERE, f".agg-{name}.ndjson")
    t0 = time.time()
    with open(tmp, "w") as fh:
        for m in monthlies:
            decode_month_into(m, fh)
    subprocess.run(["tippecanoe", "-o", out, "-l", "tracks", "-f", "-q",
                    "-Z5", f"-z{AGG_MAXZOOM}", "--simplification=10",
                    "--drop-densest-as-needed", "--read-parallel", tmp], check=True)
    os.remove(tmp)
    print(f"  agg {name}: {len(monthlies)} months → {os.path.getsize(out)/1e6:.1f} MB  ({time.time()-t0:.0f}s)")
    return out


def build_all_aggregates():
    print("→ year + all aggregates")
    for y in ("2024", "2025"):
        build_aggregate(y, [ym for ym in ALL_MONTHS if ym.startswith(y)])
    build_aggregate("all", ALL_MONTHS)


def main():
    os.makedirs(TILES_DIR, exist_ok=True)
    args = list(sys.argv[1:])
    if "--aggregates-only" in args:  # per-month tiles already exist; just (re)build aggregates
        build_all_aggregates()
        return
    months = [a for a in args if not a.startswith("--")] or ALL_MONTHS
    print(f"ShipTraffic track tiles — bbox {bake.BBOX}, {len(months)} month(s)")
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET enable_progress_bar=false;")
    built = [m for m in (build_month(con, ym) for ym in months) if m]
    print(f"\n✓ {len(built)} month(s) in {TILES_DIR}")
    if months == ALL_MONTHS:
        build_all_aggregates()
    print("upload with upload.mjs")


if __name__ == "__main__":
    main()
