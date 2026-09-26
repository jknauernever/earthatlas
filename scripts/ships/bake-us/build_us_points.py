#!/usr/bin/env python3
"""
US-wide /ships tracks for one month, built from NOAA MarineCadastre's DAILY
position files (CC0; ais-YYYY-MM-DD.csv.zst, ~320 MB/day, ~10 M positions/day;
docs/MARINECADASTRE_AIS.md). Used for months NOAA hasn't published as monthly
track files (2026 onward). Runs in GitHub Actions; publish.mjs uploads.
Output is identical in shape to build_us_tracks.py (same tileset, pack, manifest),
so the map can't tell the two apart.

Rules (us-v2-points), the Salish bake's time-based rules (scripts/ships/bake-ais/
build_tracks.py) without its Salish-only land grid:
  1. Valid positions only (lat/lon in range, not 0,0); duplicate (mmsi, time) keep one.
  2. Per MMSI in time order, a NEW track starts after a gap > GAP_MIN minutes or an
     implied speed > MAX_KNOTS (bad fix / two transmitters sharing an MMSI).
  3. Tracks under 2 positions, and "parked" tracks spanning < PARKED_M metres, are
     counted, not drawn.
  4. Simplified like the monthly-file bake; `kind` from the track's most common
     vessel_type.
  NOT applied: inland / over-land rules (need a US-wide land grid).

Memory: positions are staged per day into MMSI buckets (mmsi % BUCKETS), then each
bucket is turned into tracks on its own, so no step holds a whole month.

Run:  python3 build_us_points.py 2026-06 [OUT_DIR]
Deps: pip install duckdb pyarrow shapely numpy ; tippecanoe + tile-join on PATH
"""
import datetime as dt, json, os, shutil, sys, time
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import duckdb
import build_us_tracks as common

URL = "https://noaaocm.blob.core.windows.net/ais/csv2/csv{y}/ais-{d}.csv.zst"
RULES = "us-v2-points"
GAP_MIN = 30
MAX_KNOTS = 60
MIN_DT_S = 30
PARKED_M = common.PARKED_M
BUCKETS = 16
JOBS = int(os.environ.get("SHIPS_US_JOBS", "3"))
MEM = os.environ.get("SHIPS_US_DUCKDB_MEM", "10GB")
DAYS_LIMIT = int(os.environ.get("SHIPS_US_DAYS", "0"))  # quick local test only

COLUMNS = {
    "mmsi": "INTEGER", "base_date_time": "TIMESTAMP", "longitude": "DOUBLE", "latitude": "DOUBLE",
    "sog": "FLOAT", "cog": "FLOAT", "heading": "INTEGER", "vessel_name": "VARCHAR", "imo": "VARCHAR",
    "call_sign": "VARCHAR", "vessel_type": "INTEGER", "status": "INTEGER", "length": "FLOAT",
    "width": "FLOAT", "draft": "FLOAT", "cargo": "INTEGER", "transceiver": "VARCHAR",
}


def days_in(ym):
    y, m = map(int, ym.split("-"))
    d = dt.date(y, m, 1)
    while d.month == m:
        yield d
        d += dt.timedelta(days=1)


def stage_day(d, stage):
    """One day's CSV → Parquet per MMSI bucket (only the columns tracks need)."""
    done = os.path.join(stage, f".done-{d}")
    if os.path.exists(done):
        return d, "cached", 0
    url = URL.format(y=d.year, d=d.isoformat())
    cols = "{" + ", ".join(f"'{k}': '{v}'" for k, v in COLUMNS.items()) + "}"
    for attempt in range(5):
        try:
            con = duckdb.connect()
            con.execute("INSTALL httpfs; LOAD httpfs; SET memory_limit='2GB'; SET preserve_insertion_order=false;")
            n = con.execute(f"""
              COPY (
                SELECT mmsi, base_date_time AS t, longitude AS lon, latitude AS lat, vessel_type,
                       mmsi % {BUCKETS} AS bucket
                  FROM read_csv('{url}', compression='zstd', header=true, columns={cols})
                 WHERE mmsi IS NOT NULL AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
                   AND NOT (latitude = 0 AND longitude = 0)
              ) TO '{stage}' (FORMAT parquet, COMPRESSION zstd, PARTITION_BY (bucket),
                              OVERWRITE_OR_IGNORE true, FILENAME_PATTERN 'd{d.isoformat()}_{{i}}')""").fetchone()
            con.close()
            open(done, "w").close()
            return d, "ok", n[0] if n else 0
        except Exception as e:
            if "404" in str(e):
                return d, "missing", 0
            wait = 15 * 2 ** attempt
            print(f"  {d}: {str(e)[:160]} — retry in {wait}s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"{d}: failed after retries")


def tracks_for_bucket(stage, b, tmp, stats):
    """Yield (mmsi, vtype, t0, t1, coords, None) for every drawable track in one bucket."""
    files = os.path.join(stage, f"bucket={b}", "*.parquet")
    con = duckdb.connect()
    con.execute(f"SET memory_limit='{MEM}'; SET preserve_insertion_order=false; SET temp_directory='{tmp}';")
    con.execute(f"""
      CREATE TEMP TABLE seg AS
      WITH p AS (
        SELECT mmsi, t, lon, lat, vessel_type FROM read_parquet('{files}')
        QUALIFY row_number() OVER (PARTITION BY mmsi, t ORDER BY lon, lat) = 1
      ), l AS (
        SELECT *, lag(t) OVER w AS pt, lag(lon) OVER w AS plon, lag(lat) OVER w AS plat
          FROM p WINDOW w AS (PARTITION BY mmsi ORDER BY t)
      ), d AS (
        SELECT *, CASE WHEN pt IS NULL THEN NULL ELSE 3440.065 * 2 * asin(sqrt(
                    power(sin(radians(lat - plat) / 2), 2) +
                    cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lon - plon) / 2), 2))) END AS nm,
               epoch(t - pt) AS dt FROM l
      ), b AS (
        SELECT *, CASE WHEN pt IS NULL THEN 1
                       WHEN dt > {GAP_MIN * 60} THEN 1
                       WHEN nm / (greatest(dt, {MIN_DT_S}) / 3600.0) > {MAX_KNOTS} THEN 1
                       ELSE 0 END AS brk FROM d
      )
      SELECT mmsi, t, lon, lat, vessel_type,
             sum(brk) OVER (PARTITION BY mmsi ORDER BY t ROWS UNBOUNDED PRECEDING) AS sid FROM b""")
    stats["points"] += con.execute("SELECT count(*) FROM seg").fetchone()[0]
    rows = con.execute(f"""
      SELECT mmsi, mode(vessel_type) AS v, epoch(min(t))::BIGINT, epoch(max(t))::BIGINT, count(*) AS n,
             list(lon ORDER BY t), list(lat ORDER BY t),
             sqrt(power((max(lat) - min(lat)) * 111320, 2) +
                  power((max(lon) - min(lon)) * 111320 * cos(radians(avg(lat))), 2)) AS span_m
        FROM seg GROUP BY mmsi, sid""")
    while True:
        batch = rows.fetchmany(20000)
        if not batch:
            break
        for mmsi, v, a, z, n, lons, lats, span in batch:
            stats["tracks"] += 1
            if n < 2:
                stats["single_point"] += 1; continue
            if span < PARKED_M:
                stats["parked_not_drawn"] += 1; continue
            yield int(mmsi), v, int(a), int(z), np.column_stack([lons, lats]), None
    con.close()


def build(ym, out_dir):
    t_start = time.time()
    os.makedirs(out_dir, exist_ok=True)
    stage = os.path.join(out_dir, "stage"); tmp = os.path.join(out_dir, "duckdb-tmp")
    os.makedirs(stage, exist_ok=True); os.makedirs(tmp, exist_ok=True)
    days = list(days_in(ym))[: DAYS_LIMIT or None]
    staged = {}
    with ThreadPoolExecutor(JOBS) as ex:
        for d, status, n in ex.map(lambda d: stage_day(d, stage), days):
            staged[str(d)] = status
            print(f"  staged {d}: {status} {n or ''} ({time.time() - t_start:.0f}s)", flush=True)
    missing = [d for d, s in staged.items() if s == "missing"]
    t_stage = round(time.time() - t_start)

    stats = dict(points=0, tracks=0, single_point=0, parked_not_drawn=0, lines=0, vessels=0)
    w = common.LineWriter(out_dir, ym)
    batch = []
    for b in range(BUCKETS):
        for rec in tracks_for_bucket(stage, b, tmp, stats):
            batch.append(rec)
            if len(batch) >= 20000:
                w.write(batch); batch = []
        w.write(batch); batch = []
        shutil.rmtree(os.path.join(stage, f"bucket={b}"), ignore_errors=True)  # streamed through, not kept
        print(f"  bucket {b + 1}/{BUCKETS}: {w.lines:,} lines ({time.time() - t_start:.0f}s)", flush=True)
    w.close()
    shutil.rmtree(stage, ignore_errors=True); shutil.rmtree(tmp, ignore_errors=True)
    stats["lines"], stats["vessels"] = w.lines, len(w.vessels)
    pack, pm, tip_secs = common.finish(out_dir, w)

    manifest = dict(region="us", tileset=common.TILESET, month=ym, built=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    source=dict(name="MarineCadastre daily AIS points (NOAA / BOEM / USCG)", license="CC0",
                                url=URL.format(y=ym[:4], d=f"{ym}-DD"), days=len(days), days_missing=missing),
                    rules=dict(version=RULES, gap_min=GAP_MIN, max_knots=MAX_KNOTS, min_dt_s=MIN_DT_S, parked_m=PARKED_M,
                               simplify_deg=common.SIMPLIFY_DEG, inland_rules="not applied (no US-wide land grid yet)",
                               tippecanoe=" ".join(common.TIPPECANOE)),
                    pack=dict(shards=common.PACK_SHARDS, simplify_deg=common.PACK_SIMPLIFY_DEG, bytes=os.path.getsize(pack)),
                    pmtiles_bytes=os.path.getsize(pm), stats=stats,
                    secs=dict(total=round(time.time() - t_start), staging=t_stage, tippecanoe=tip_secs),
                    test_limit_rows=(f"{DAYS_LIMIT} days" if DAYS_LIMIT else None))
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ym = sys.argv[1]
    if len(ym) != 7 or ym[4] != "-":
        sys.exit("month must be YYYY-MM")
    build(ym, sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", ym))
