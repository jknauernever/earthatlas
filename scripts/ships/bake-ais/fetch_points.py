#!/usr/bin/env python3
"""
Step 1 of the /ships AIS bake: MarineCadastre daily points → regional Parquet cache.

Streams NOAA's daily national CSV (ais-YYYY-MM-DD.csv.zst, ~320 MB, CC0; see
docs/MARINECADASTRE_AIS.md), keeps only rows inside the region's bbox, and
writes cache/points/<region>/YYYY-MM-DD.parquet with every column kept as
published. Raw positions are evidence, so nothing is transformed here except
the bbox cut.

Resumable: days already cached are skipped. Transient network errors retry with
backoff (a laptop sleep pauses a day instead of failing it).

Run:  python3 fetch_points.py 2026-06                 # one month
      python3 fetch_points.py 2025-07 2026-06         # inclusive month range
      python3 fetch_points.py 2026-06 --jobs 3
Deps: pip install duckdb
"""
import os, sys, time, datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REGION = "salish"
# Same box as /shiptraffic (scripts/bake-shiptraffic/bake.py BBOX), so the two agree.
BBOX = dict(w=-124.85, s=47.0, e=-122.05, n=49.0)
URL = "https://noaaocm.blob.core.windows.net/ais/csv2/csv{y}/ais-{d}.csv.zst"
OUT = os.path.join(HERE, "cache", "points", REGION)

# Explicit column types (the 2015-era files are sparse, so auto-detect can guess wrong).
COLUMNS = {
    "mmsi": "INTEGER", "base_date_time": "TIMESTAMP", "longitude": "DOUBLE", "latitude": "DOUBLE",
    "sog": "FLOAT", "cog": "FLOAT", "heading": "INTEGER", "vessel_name": "VARCHAR", "imo": "VARCHAR",
    "call_sign": "VARCHAR", "vessel_type": "INTEGER", "status": "INTEGER", "length": "FLOAT",
    "width": "FLOAT", "draft": "FLOAT", "cargo": "INTEGER", "transceiver": "VARCHAR",
}


def months(a, b):
    y, m = map(int, a.split("-")); y2, m2 = map(int, b.split("-"))
    while (y, m) <= (y2, m2):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def days_in(y, m):
    d = dt.date(y, m, 1)
    while d.month == m:
        yield d
        d += dt.timedelta(days=1)


def fetch_day(d):
    out = os.path.join(OUT, f"{d.isoformat()}.parquet")
    if os.path.exists(out):
        return d, "cached", None
    url = URL.format(y=d.year, d=d.isoformat())
    cols = "{" + ", ".join(f"'{k}': '{v}'" for k, v in COLUMNS.items()) + "}"
    tmp = out + ".tmp"
    for attempt in range(5):
        try:
            con = duckdb.connect()
            con.execute("INSTALL httpfs; LOAD httpfs; SET memory_limit='2GB';")
            n = con.execute(f"""
                COPY (
                  SELECT * FROM read_csv('{url}', compression='zstd', header=true, columns={cols})
                  WHERE longitude BETWEEN {BBOX['w']} AND {BBOX['e']} AND latitude BETWEEN {BBOX['s']} AND {BBOX['n']}
                  ORDER BY mmsi, base_date_time
                ) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)""").fetchone()
            con.close()
            os.replace(tmp, out)
            return d, "ok", n[0] if n else None
        except Exception as e:  # network / partial read → back off and retry
            if "404" in str(e) or "HTTP 404" in str(e):
                return d, "missing", None
            wait = 10 * 2 ** attempt
            print(f"  {d}: {str(e)[:120]} — retry in {wait}s", flush=True)
            time.sleep(wait)
    return d, "failed", None


def main():
    argv = sys.argv[1:]
    jobs = 3
    if "--jobs" in argv:
        i = argv.index("--jobs"); jobs = int(argv[i + 1]); del argv[i:i + 2]
    args = argv
    if not args:
        sys.exit(__doc__)
    a, b = args[0], args[1] if len(args) > 1 else args[0]
    os.makedirs(OUT, exist_ok=True)
    days = [d for y, m in months(a, b) for d in days_in(y, m)]
    t0 = time.time()
    with ThreadPoolExecutor(jobs) as ex:
        futs = [ex.submit(fetch_day, d) for d in days]
        for i, f in enumerate(as_completed(futs), 1):
            d, status, n = f.result()
            print(f"[{i}/{len(days)}] {d} {status}{'' if n is None else f' {n:,} rows'}  ({time.time()-t0:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
