#!/usr/bin/env python3
"""
Terminal calls, step 2 of 3 (lib/ships/terminalCalls.js has the rule; Josh 2026-09-28): the STOPPED AIS positions near a
terminal berth, from the salish-v6 points cache (MarineCadastre daily points, CC0; fetch_points.py).

For each day file: positions with sog < 0.5 kn within a berth's radius (berths.json, written by
`node scripts/ships/terminal-calls.mjs berths`: 150 m, or half the official berth length + 50 m, max 300 m). When a position
lies within the radius of berths of more than one terminal, the NEAREST berth wins and the other terminals are recorded in
`also` (never counted twice). Terminals with no berth inside the box are listed as not covered.
Splitting positions into calls (gap > 6 h = new call, keep >= 15 min) happens in step 3 (terminal-calls.mjs import), with
the same tested function the card's rule is described by.

Run (from this directory):
  python3 terminal_calls.py --days 2025-07-01 2025-07-02      # prove on a day or two first
  python3 terminal_calls.py                                   # every cached day (resumable: finished days are skipped)
  python3 terminal_calls.py --export                          # hits.csv (sorted by terminal, mmsi, time) + meta.json
Memory: every DuckDB connection is capped (2 GB, 4 threads); one day file at a time.
Output: cache/terminal-calls/ (gitignored with the rest of cache/).
"""
import os, sys, json, glob, hashlib, datetime as dt
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REGION = "salish-v6"
POINTS = os.path.join(HERE, "cache", "points", REGION)
BOX = dict(w=-126.2, s=47.0, e=-122.05, n=49.6)  # region.py salish-v6 (read-only copy; region.py is not imported to keep its env default untouched)
OUT = os.path.join(HERE, "cache", "terminal-calls")
COVER_FROM, COVER_TO = "2025-07", "2026-06"


def connect():
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'")
    con.execute("SET threads=4")
    con.execute("SET preserve_insertion_order=false")
    return con


def load_berths():
    with open(os.path.join(OUT, "berths.json")) as f:
        bj = json.load(f)
    raw = json.dumps(bj["berths"], sort_keys=True).encode()
    return bj, hashlib.sha256(raw).hexdigest()[:8]


def hits_dir(bj, sha):
    return os.path.join(OUT, f"hits-{bj['bake_version']}-{sha}")


def setup(con, bj):
    rule = bj["rule"]
    inside = [b for b in bj["berths"] if b["in_box"]]
    con.execute("CREATE TEMP TABLE berths (terminal VARCHAR, berth VARCHAR, lat DOUBLE, lon DOUBLE, radius_m DOUBLE, s DOUBLE, n DOUBLE, w DOUBLE, e DOUBLE)")
    import math
    rows = []
    for b in inside:
        pad = (b["radius_m"] + 20) / 111_195.0
        padlon = pad / math.cos(math.radians(b["lat"]))
        rows.append((b["terminal"], b["berth"], b["lat"], b["lon"], float(b["radius_m"]), b["lat"] - pad, b["lat"] + pad, b["lon"] - padlon, b["lon"] + padlon))
    con.executemany("INSERT INTO berths VALUES (?,?,?,?,?,?,?,?,?)", rows)
    return rule


HITS_SQL = """
WITH p AS (
  SELECT mmsi, base_date_time AS t, latitude AS lat, longitude AS lon, vessel_name, imo, vessel_type, length
    FROM read_parquet($file)
   WHERE sog < $sog AND mmsi IS NOT NULL AND base_date_time IS NOT NULL
     AND latitude BETWEEN (SELECT min(s) FROM berths) AND (SELECT max(n) FROM berths)
     AND longitude BETWEEN (SELECT min(w) FROM berths) AND (SELECT max(e) FROM berths)
), d AS (
  SELECT p.*, b.terminal, b.berth, b.radius_m,
         2 * 6371008.8 * asin(sqrt(pow(sin(radians(p.lat - b.lat) / 2), 2)
             + cos(radians(b.lat)) * cos(radians(p.lat)) * pow(sin(radians(p.lon - b.lon) / 2), 2))) AS m
    FROM p JOIN berths b ON p.lat BETWEEN b.s AND b.n AND p.lon BETWEEN b.w AND b.e
), w AS (
  SELECT *, row_number() OVER (PARTITION BY mmsi, t ORDER BY m, terminal, berth) AS rn,
         list(DISTINCT terminal) OVER (PARTITION BY mmsi, t) AS terms
    FROM d WHERE m <= radius_m
)
SELECT terminal, berth, mmsi, t, round(m, 1) AS m,
       nullif(array_to_string(list_sort(list_filter(terms, x -> x <> terminal)), '|'), '') AS also,
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


def export(con, bj, sha):
    hd = hits_dir(bj, sha)
    files = sorted(glob.glob(os.path.join(hd, "*.parquet")))
    if not files:
        sys.exit(f"no hits in {hd}: run the bake first")
    days = [os.path.basename(f)[:10] for f in files]
    csv = os.path.join(OUT, "hits.csv")
    # Explicit file list (Python's glob skips dotfiles): macOS writes AppleDouble "._<day>.parquet" files on the external drive,
    # which DuckDB's own glob would read as parquet.
    src = "[" + ",".join("'" + f.replace("'", "''") + "'" for f in files) + "]"
    con.execute(f"""COPY (SELECT terminal, berth, mmsi, strftime(t, '%Y-%m-%dT%H:%M:%SZ') AS t, m, also, name, imo, type, length
                            FROM read_parquet({src}) ORDER BY terminal, mmsi, t) TO '{csv}' (HEADER, DELIMITER ',')""")
    n = con.execute(f"SELECT count(*) FROM read_parquet({src})").fetchone()[0]
    months = []
    for ym in month_range(COVER_FROM, COVER_TO):
        got = sum(1 for d in days if d.startswith(ym))
        months.append(dict(month=ym, days=got, of=days_in_month(ym), complete=got == days_in_month(ym)))
    inside = {b["terminal"] for b in bj["berths"] if b["in_box"]}
    not_covered = sorted({b["terminal"] for b in bj["berths"]} - inside)
    meta = dict(bake_version=bj["bake_version"], berths_sha=sha, baked_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                input=dict(source="marinecadastre-ais", region=REGION, box=BOX, cache="scripts/ships/bake-ais/cache/points/salish-v6",
                           timestamps="base_date_time, UTC as MarineCadastre publishes it (stored without a zone marker in the cache)"),
                days=days, months=months, not_covered=not_covered, hits=n)
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"export: {n:,} stopped positions from {len(days)} days → {csv}; complete months: {sum(m['complete'] for m in months)}; not covered: {', '.join(not_covered) or 'none'}")


def main():
    args = sys.argv[1:]
    bj, sha = load_berths()
    con = connect()
    rule = setup(con, bj)
    if "--export" in args:
        return export(con, bj, sha)
    if "--days" in args:
        want = args[args.index("--days") + 1:]
        files = [os.path.join(POINTS, f"{d}.parquet") for d in want]
    else:
        files = sorted(glob.glob(os.path.join(POINTS, "*.parquet")))
    hd = hits_dir(bj, sha)
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
        print(f"[{i}/{len(files)}] {day}: {n:,} stopped positions near a berth", flush=True)
    print(f"done: {total:,} new stopped positions → {hd}")


if __name__ == "__main__":
    main()
