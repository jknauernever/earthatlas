#!/usr/bin/env python3
"""
Step 1 of the /ships AIS bake: MarineCadastre daily points → regional Parquet cache.

Streams NOAA's daily national CSV (ais-YYYY-MM-DD.csv.zst, ~320 MB, CC0; see
docs/MARINECADASTRE_AIS.md), keeps only rows inside the region's bbox, and
writes <region points dir>/YYYY-MM-DD.parquet (region.py) with every column kept as
published. Raw positions are evidence, so nothing is transformed here except
the bbox cut.

Resumable: days already cached are skipped. Transient network errors retry with
backoff (a laptop sleep pauses a day instead of failing it).

Run:  python3 fetch_points.py 2026-06                 # one month
      python3 fetch_points.py 2025-07 2026-06         # inclusive month range
      python3 fetch_points.py 2026-06 --jobs 3
      SHIPS_REGION=salish-v6 python3 fetch_points.py 2026-06   # the bigger box
      python3 fetch_points.py 2026-06-15                  # one day (the ships-noaa-month workflow's test)
      SHIPS_REGION=salish-v6 python3 fetch_points.py 2026-06 --also wa-columbia-v1
                                                          # also fill other regions' caches from the SAME daily read
Exits non-zero when a day failed (a missing day, not yet published, is reported, not an error).
Deps: pip install duckdb
"""
import os, sys, time, datetime as dt
from concurrent.futures import ThreadPoolExecutor, as_completed
import duckdb
import region

HERE = os.path.dirname(os.path.abspath(__file__))
# Box + cache dir come from region.py (SHIPS_REGION, default salish-v5 = /shiptraffic's box).
BBOX = region.BBOX
URL = "https://noaaocm.blob.core.windows.net/ais/csv2/csv{y}/ais-{d}.csv.zst"
OUT = region.R["points"]

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


# Extra regions filled from the same daily read (--also). Each keeps its own cache dir (region.py).
ALSO = []


def box_sql(b):
    return f"(longitude BETWEEN {b['w']} AND {b['e']} AND latitude BETWEEN {b['s']} AND {b['n']})"


def fetch_day(d):
    targets = [(BBOX, OUT)] + [(region.REGIONS[r]["bbox"], region.REGIONS[r]["points"]) for r in ALSO]
    outs = [(b, os.path.join(o, f"{d.isoformat()}.parquet")) for b, o in targets]
    todo = [(b, out) for b, out in outs if not os.path.exists(out)]
    if not todo:
        return d, "cached", None
    url = URL.format(y=d.year, d=d.isoformat())
    cols = "{" + ", ".join(f"'{k}': '{v}'" for k, v in COLUMNS.items()) + "}"
    for attempt in range(5):
        try:
            con = duckdb.connect()
            con.execute("INSTALL httpfs; LOAD httpfs; SET memory_limit='2GB';")
            if len(todo) == 1:
                b, out = todo[0]
                n = con.execute(f"""
                    COPY (
                      SELECT * FROM read_csv('{url}', compression='zstd', header=true, columns={cols})
                      WHERE {box_sql(b)}
                      ORDER BY mmsi, base_date_time
                    ) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)""").fetchone()
                os.replace(out + ".tmp", out)
            else:   # one read of the national file, cut into every box still missing
                con.execute(f"""CREATE TEMP TABLE day AS SELECT * FROM read_csv('{url}', compression='zstd', header=true, columns={cols})
                                WHERE {' OR '.join(box_sql(b) for b, _ in todo)}""")
                n = None
                for b, out in todo:
                    r = con.execute(f"""COPY (SELECT * FROM day WHERE {box_sql(b)} ORDER BY mmsi, base_date_time)
                                        TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)""").fetchone()
                    os.replace(out + ".tmp", out)
                    n = n if n is not None else r
            con.close()
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
    while "--also" in argv:
        i = argv.index("--also"); r = argv[i + 1]; del argv[i:i + 2]
        if r not in region.REGIONS or r == region.NAME:
            sys.exit(f"--also {r}: unknown region or the main one")
        ALSO.append(r)
        os.makedirs(region.REGIONS[r]["points"], exist_ok=True)
    args = argv
    if not args:
        sys.exit(__doc__)
    os.makedirs(OUT, exist_ok=True)
    if len(args[0]) == 10:   # YYYY-MM-DD: one day
        days = [dt.date.fromisoformat(args[0])]
    else:
        a, b = args[0], args[1] if len(args) > 1 else args[0]
        days = [d for y, m in months(a, b) for d in days_in(y, m)]
    t0 = time.time()
    bad = []
    with ThreadPoolExecutor(jobs) as ex:
        futs = [ex.submit(fetch_day, d) for d in days]
        for i, f in enumerate(as_completed(futs), 1):
            d, status, n = f.result()
            print(f"[{i}/{len(days)}] {d} {status}{'' if n is None else f' {n:,} rows'}  ({time.time()-t0:.0f}s)", flush=True)
            if status == "failed":
                bad.append(str(d))
    if bad:
        sys.exit(f"failed days: {' '.join(sorted(bad))}")


if __name__ == "__main__":
    main()
