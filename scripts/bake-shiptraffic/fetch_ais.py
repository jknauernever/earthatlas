#!/usr/bin/env python3
"""
Real-vessel bake for /shiptraffic — MarineCadastre monthly AIS tracks → grid.

Replaces the synthetic vessel layer with REAL data and reuses bake.py's whale
fetch + grid + writer, so the output grid.json is identical in shape (the tool
needs no changes; meta.vesselSource flips to "marinecadastre" and the
sample-data banner disappears).

Source: NOAA Marine Cadastre monthly vessel-track GeoParquet (GeoParquet 1.1,
LineString WKB, WGS84), one file per month, ~1.78 GB each national.
  https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/aistrack/ais-track-YYYY-MM.parquet

Method: DuckDB (httpfs + spatial) filters tracks intersecting the Salish Sea
bbox, explodes each track's vertices, bins them to the shared grid, and counts
DISTINCT vessels (MMSI) per cell+type — a transit count, not raw pings (which
would over-weight docked/anchored vessels). Heavy lifting stays server-side in
DuckDB; only the small per-cell aggregate comes back over the wire.

Two-stage so we download each big file only ONCE:
  1. cache  — per-month (i,j,vessel_type,n) at a low floor → cache/ais-YYYY-MM.json
  2. assemble — fold cache (at DISPLAY_THRESHOLD) + real whales → grid.json

Run:  pip install duckdb
      python3 scripts/bake-shiptraffic/fetch_ais.py            # cache + assemble
      python3 scripts/bake-shiptraffic/fetch_ais.py --assemble  # re-assemble from cache only
"""

import json
import os
import sys
import time

import bake  # reuse BBOX, grid steps, whale fetch, STATS, assemble_and_write

CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
TRACK_URL = ("https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/"
             "aistrack/ais-track-{ym}.parquet")

# Floor applied in SQL when caching (keeps cache files small but re-thresholdable).
CACHE_FLOOR = 2
# Display floor applied at assembly — distinct vessels per cell+type+month to keep
# a cell. Higher = cleaner lanes + smaller file. Tunable without re-downloading.
DISPLAY_THRESHOLD = int(os.environ.get("ST_VESSEL_THRESHOLD", "3"))


def vessel_class(code):
    """AIS numeric ship-type code → one of our 7 UI classes."""
    try:
        c = int(code)
    except (TypeError, ValueError):
        return "other"
    if 70 <= c <= 79:
        return "cargo"
    if 80 <= c <= 89:
        return "tanker"
    if c == 30:
        return "fishing"
    if 60 <= c <= 69:
        return "passenger"
    if c in (31, 32, 52):
        return "tug"
    if c in (36, 37):
        return "pleasure"
    return "other"


def query_month(con, ym):
    """Return [(i,j,vessel_type,n), …] for one month, distinct-MMSI per cell+type."""
    W, S, E, N = bake.BBOX["w"], bake.BBOX["s"], bake.BBOX["e"], bake.BBOX["n"]
    LNG, LAT = bake.LNG_STEP, bake.LAT_STEP
    url = TRACK_URL.format(ym=ym)
    sql = f"""
    WITH flt AS (
      SELECT mmsi, vessel_type, geometry AS g FROM read_parquet('{url}')
      WHERE ST_Intersects(geometry, ST_MakeEnvelope({W},{S},{E},{N}))
    ),
    pts AS (
      SELECT mmsi, vessel_type,
        CAST(floor((ST_X((d).geom)-({W}))/{LNG}) AS INT) AS i,
        CAST(floor((ST_Y((d).geom)-({S}))/{LAT}) AS INT) AS j,
        ST_X((d).geom) AS x, ST_Y((d).geom) AS y
      FROM flt, UNNEST(ST_Dump(ST_Points(g))) AS t(d)
    )
    SELECT i, j, vessel_type, count(DISTINCT mmsi) AS n
    FROM pts WHERE x BETWEEN {W} AND {E} AND y BETWEEN {S} AND {N}
    GROUP BY 1, 2, 3 HAVING count(DISTINCT mmsi) >= {CACHE_FLOOR}
    """
    return con.execute(sql).fetchall()


def cache_all_months():
    import duckdb
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial;")
    con.execute("SET enable_progress_bar=false;")
    os.makedirs(CACHE_DIR, exist_ok=True)
    for ym in bake.MONTHS:
        path = os.path.join(CACHE_DIR, f"ais-{ym}.json")
        if os.path.exists(path):
            print(f"  cache hit {ym}")
            continue
        t0 = time.time()
        try:
            rows = query_month(con, ym)
        except Exception as e:
            print(f"  [ais] {ym} FAILED: {str(e)[:120]}")
            continue
        with open(path, "w") as f:
            json.dump([[r[0], r[1], int(r[2]) if r[2] is not None else -1, r[3]] for r in rows], f)
        print(f"  cached {ym}: {len(rows)} rows  ({time.time()-t0:.0f}s)")


# The cache was binned at the fine AIS step; collapse those indices into the
# (coarser) concern-grid cells defined in bake.py.
FINE_LNG, FINE_LAT = 0.004, 0.0027
FI = max(1, round(bake.LNG_STEP / FINE_LNG))
FJ = max(1, round(bake.LAT_STEP / FINE_LAT))


def assemble_from_cache():
    print(f"→ Folding AIS cache into concern grid "
          f"(fine→coarse {FI}×{FJ}, threshold ≥ {DISPLAY_THRESHOLD} vessels/fine-cell/type/month)…")
    total = 0
    for ym in bake.MONTHS:
        path = os.path.join(CACHE_DIR, f"ais-{ym}.json")
        if not os.path.exists(path):
            print(f"  [ais] {ym} cache missing — skipping")
            continue
        with open(path) as f:
            rows = json.load(f)
        for i, j, vt, n in rows:
            if n < DISPLAY_THRESHOLD:
                continue
            ci, cj = i // FI, j // FJ
            cls = vessel_class(vt)
            c = bake.cells.setdefault((ci, cj), {"v": {}, "w": {}})
            bucket = c["v"].setdefault(ym, {})
            bucket[cls] = bucket.get(cls, 0) + n
            total += n
    bake.STATS["vessels"] = total
    print(f"  vessels folded: {total} transit-cells")


def main():
    assemble_only = "--assemble" in sys.argv
    if not assemble_only:
        try:
            import duckdb  # noqa: F401
        except ImportError:
            print("duckdb not installed. Run: pip install duckdb", file=sys.stderr)
            sys.exit(1)
        cache_all_months()

    print("→ Whales (real: iNaturalist + OBIS)…")
    bake.fetch_whales()
    bake.write_whales()           # raw points → whales.json (magenta point layer)
    assemble_from_cache()

    # The concern grid only needs cells where whales are present (concern =
    # vessels × whales is zero without whales). Drop vessel-only cells so the
    # file stays small — vessels are drawn from Esri tiles, not this grid.
    before = len(bake.cells)
    for k in list(bake.cells):
        if not bake.cells[k]["w"]:
            del bake.cells[k]
    print(f"  pruned concern grid to whale cells: {before} → {len(bake.cells)}")

    bake.assemble_and_write("marinecadastre")  # coarse grid → grid.json (concern heatmap)


if __name__ == "__main__":
    main()
