#!/usr/bin/env python3
"""
Anchorage stays, step 2 of 3 (lib/ships/anchorageStays.js has the rule; Josh 2026-09-30): the STOPPED AIS positions inside an
anchorage polygon, from the salish-v6 points cache (MarineCadastre daily points, CC0; fetch_points.py).

For each day file: positions with sog < 0.5 kn inside an anchorage polygon (anchorages.json, written by
`node scripts/ships/anchorage-stays.mjs polygons`: every active anchorage polygon the AIS box covers, with its edges).
Point-in-polygon is the even-odd rule over the polygon's own edges (every ring), in DuckDB SQL: a bounding-box prefilter, then
the edge crossings to the east of the point are counted. Where polygons overlap, the anchorage with the lowest `priority` wins
(designated, then DFO-listed, then non-designated, then the smaller area) and the others are recorded in `also`.
Splitting positions into stays (gap > 6 h = new stay, keep >= 60 min) happens in step 3 (anchorage-stays.mjs import).

Run (from this directory):
  python3 anchorage_stays.py --days 2025-07-01 2025-07-02      # prove on a day or two first
  python3 anchorage_stays.py                                   # every cached day (resumable: finished days are skipped)
  python3 anchorage_stays.py --export                          # hits.csv (sorted by anchorage, mmsi, time) + meta.json
Memory: every DuckDB connection is capped (2 GB, 4 threads); one day file at a time.
Output: cache/anchorage-stays/ (on the offload drive, like cache/terminal-calls).
"""
import os, sys, json, glob, hashlib, datetime as dt
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REGION = "salish-v6"
POINTS = os.path.join(HERE, "cache", "points", REGION)
BOX = dict(w=-126.2, s=47.0, e=-122.05, n=49.6)  # region.py salish-v6 (read-only copy)
OUT = os.path.join(HERE, "cache", "anchorage-stays")
COVER_FROM, COVER_TO = "2025-07", "2026-06"


def connect():
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'")
    con.execute("SET threads=4")
    con.execute("SET preserve_insertion_order=false")
    return con


def load_polygons():
    with open(os.path.join(OUT, "anchorages.json")) as f:
        aj = json.load(f)
    raw = json.dumps([aj["anchorages"], aj["edges"]], sort_keys=True).encode()
    return aj, hashlib.sha256(raw).hexdigest()[:8]


def hits_dir(aj, sha):
    return os.path.join(OUT, f"hits-{aj['bake_version']}-{sha}")


def setup(con, aj):
    covered = [a for a in aj["anchorages"] if a["coverage"] == "covered"]
    con.execute("CREATE TEMP TABLE anch (key VARCHAR, priority INTEGER, s DOUBLE, n DOUBLE, w DOUBLE, e DOUBLE)")
    con.executemany("INSERT INTO anch VALUES (?,?,?,?,?,?)",
                    [(a["key"], a["priority"], a["bbox"][0], a["bbox"][1], a["bbox"][2], a["bbox"][3]) for a in covered])
    keys = {a["key"] for a in covered}
    con.execute("CREATE TEMP TABLE edges (key VARCHAR, x1 DOUBLE, y1 DOUBLE, x2 DOUBLE, y2 DOUBLE, ylo DOUBLE, yhi DOUBLE)")
    con.executemany("INSERT INTO edges VALUES (?,?,?,?,?,?,?)",
                    [(e["key"], e["x1"], e["y1"], e["x2"], e["y2"], min(e["y1"], e["y2"]), max(e["y1"], e["y2"]))
                     for e in aj["edges"] if e["key"] in keys and e["y1"] != e["y2"]])
    return aj["rule"]


HITS_SQL = """
WITH p AS (
  SELECT mmsi, base_date_time AS t, any_value(latitude) AS lat, any_value(longitude) AS lon, any_value(vessel_name) AS vessel_name,
         any_value(imo) AS imo, any_value(vessel_type) AS vessel_type, any_value(length) AS length
    FROM read_parquet($file)
   WHERE sog < $sog AND mmsi IS NOT NULL AND base_date_time IS NOT NULL
     AND latitude BETWEEN (SELECT min(s) FROM anch) AND (SELECT max(n) FROM anch)
     AND longitude BETWEEN (SELECT min(w) FROM anch) AND (SELECT max(e) FROM anch)
   GROUP BY mmsi, base_date_time
), c AS (
  SELECT p.*, a.key, a.priority FROM p JOIN anch a ON p.lat BETWEEN a.s AND a.n AND p.lon BETWEEN a.w AND a.e
), x AS (
  SELECT c.mmsi, c.t, c.key, count(*) AS crossings
    FROM c JOIN edges e ON e.key = c.key AND c.lat >= e.ylo AND c.lat < e.yhi
   WHERE c.lon < (e.x2 - e.x1) * (c.lat - e.y1) / (e.y2 - e.y1) + e.x1
   GROUP BY 1, 2, 3
), inside AS (
  SELECT c.* FROM c JOIN x USING (mmsi, t, key) WHERE x.crossings % 2 = 1
), w AS (
  SELECT *, row_number() OVER (PARTITION BY mmsi, t ORDER BY priority, key) AS rn,
         list(key) OVER (PARTITION BY mmsi, t) AS keys
    FROM inside
)
SELECT key AS anchorage, mmsi, t,
       nullif(array_to_string(list_sort(list_filter(keys, k -> k <> key)), '#'), '') AS also,
       vessel_name AS name, imo, vessel_type AS type, length
  FROM w WHERE rn = 1
"""


def bake_day(con, day_file, out_file, rule):
    tmp = out_file + ".tmp"
    sql = HITS_SQL.replace("$file", "'" + day_file.replace("'", "''") + "'").replace("$sog", str(float(rule["sogKn"])))
    con.execute(f"COPY ({sql}) TO '{tmp}' (FORMAT parquet)")
    os.replace(tmp, out_file)
    return con.execute("SELECT count(*) FROM read_parquet(?)", [out_file]).fetchone()[0]


def month_range(a, b):
    y, m = map(int, a.split("-")); y2, m2 = map(int, b.split("-"))
    while (y, m) <= (y2, m2):
        yield f"{y:04d}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def days_in_month(ym):
    y, m = map(int, ym.split("-"))
    nxt = dt.date(y + (m == 12), 1 if m == 12 else m + 1, 1)
    return (nxt - dt.date(y, m, 1)).days


def export(con, aj, sha):
    hd = hits_dir(aj, sha)
    # Explicit file list (Python's glob skips dotfiles): macOS writes AppleDouble "._<day>.parquet" files on the external drive.
    files = sorted(glob.glob(os.path.join(hd, "*.parquet")))
    if not files:
        sys.exit(f"no hits in {hd}: run the bake first")
    days = [os.path.basename(f)[:10] for f in files]
    csv = os.path.join(OUT, "hits.csv")
    src = "[" + ",".join("'" + f.replace("'", "''") + "'" for f in files) + "]"
    con.execute(f"""COPY (SELECT anchorage, mmsi, strftime(t, '%Y-%m-%dT%H:%M:%SZ') AS t, also, name, imo, type, length
                            FROM read_parquet({src}) ORDER BY anchorage, mmsi, t) TO '{csv}' (HEADER, DELIMITER ',')""")
    n = con.execute(f"SELECT count(*) FROM read_parquet({src})").fetchone()[0]
    months = []
    for ym in month_range(COVER_FROM, COVER_TO):
        got = sum(1 for d in days if d.startswith(ym))
        months.append(dict(month=ym, days=got, of=days_in_month(ym), complete=got == days_in_month(ym)))
    meta = dict(bake_version=aj["bake_version"], polygons_sha=sha, baked_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                input=dict(source="marinecadastre-ais", region=REGION, box=BOX, cache="scripts/ships/bake-ais/cache/points/salish-v6",
                           timestamps="base_date_time, UTC as MarineCadastre publishes it (stored without a zone marker in the cache)"),
                days=days, months=months, hits=n)
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"export: {n:,} stopped positions from {len(days)} days → {csv}; complete months: {sum(m['complete'] for m in months)}")


def main():
    args = sys.argv[1:]
    aj, sha = load_polygons()
    con = connect()
    rule = setup(con, aj)
    if "--export" in args:
        return export(con, aj, sha)
    if "--days" in args:
        want = args[args.index("--days") + 1:]
        files = [os.path.join(POINTS, f"{d}.parquet") for d in want]
    else:
        files = sorted(glob.glob(os.path.join(POINTS, "*.parquet")))  # glob skips macOS "._" AppleDouble files
    hd = hits_dir(aj, sha)
    os.makedirs(hd, exist_ok=True)
    total = 0
    for i, f in enumerate(files, 1):
        day = os.path.basename(f)[:10]
        out = os.path.join(hd, f"{day}.parquet")
        if os.path.exists(out):
            continue
        if not os.path.exists(f):
            print(f"{day}: no points file, skipped", flush=True)
            continue
        n = bake_day(con, f, out, rule)
        total += n
        print(f"[{i}/{len(files)}] {day}: {n:,} stopped positions inside an anchorage", flush=True)
    print(f"done: {total:,} new stopped positions → {hd}")


if __name__ == "__main__":
    main()
