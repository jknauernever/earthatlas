#!/usr/bin/env python3
"""
AIS-inferred berths, step 1 of 2 (lib/ships/aisBerths.js has the clustering + footprint guard; Josh 2026-09-28): the LONG STOPS
of large ships inside a small box, from the salish-v6 points cache (MarineCadastre daily points, CC0; fetch_points.py).

A stop = one MMSI's consecutive positions with speed over ground < 0.5 kn and length >= --min-length m (as broadcast), where a
gap of more than 30 min or a jump of more than 100 m between two positions starts a new stop. A stop is kept when it lasts at
least --min-hours hours. Each stop's position is the MEDIAN of its positions; spread_m is the 90th-percentile distance of its
positions from that median (a moored ship barely moves; an anchored or drifting one does). Name / IMO / type / length are the
values the ship broadcast most often during the stop (AIS self-reported, never registry facts).

Run (from this directory):
  python3 berth_stops.py --days 2025-07-01 2025-07-02                     # prove on a day or two first
  python3 berth_stops.py                                                  # every cached day (the default box: Burrard Inlet)
  python3 berth_stops.py --box -123.13 49.282 -123.045 49.317 --out burrard
Memory: one DuckDB connection capped at 2 GB / 4 threads. Output: cache/terminal-calls/berth-stops-<out>.csv + .json (meta).
"""
import os, sys, json, glob, datetime as dt
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REGION = "salish-v6"
POINTS = os.path.join(HERE, "cache", "points", REGION)
OUT = os.path.join(HERE, "cache", "terminal-calls")
RULE = dict(sogKn=0.5, gapMinutes=30, jumpM=100, minHours=2.0, minLengthM=100.0)
BURRARD = dict(w=-123.13, s=49.282, e=-123.045, n=49.317)

SQL = """
WITH p AS (
  SELECT mmsi, base_date_time AS t, latitude AS lat, longitude AS lon, vessel_name AS name, imo, vessel_type AS type, length
    FROM read_parquet({src})
   WHERE sog < {sog} AND length >= {minlen} AND mmsi IS NOT NULL AND base_date_time IS NOT NULL
     AND latitude BETWEEN {s} AND {n} AND longitude BETWEEN {w} AND {e}
), q AS (
  SELECT DISTINCT ON (mmsi, t) * FROM p ORDER BY mmsi, t
), l AS (
  SELECT *, lag(t) OVER w AS pt, lag(lat) OVER w AS plat, lag(lon) OVER w AS plon FROM q WINDOW w AS (PARTITION BY mmsi ORDER BY t)
), g AS (
  SELECT *, sum(CASE WHEN pt IS NULL OR t - pt > INTERVAL {gap} MINUTE
                       OR 2 * 6371008.8 * asin(sqrt(pow(sin(radians(lat - plat) / 2), 2)
                          + cos(radians(lat)) * cos(radians(plat)) * pow(sin(radians(lon - plon) / 2), 2))) > {jump}
                     THEN 1 ELSE 0 END) OVER (PARTITION BY mmsi ORDER BY t) AS seg
    FROM l
), s AS (
  SELECT mmsi, seg, min(t) AS t0, max(t) AS t1, count(*) AS n, median(lat) AS mlat, median(lon) AS mlon,
         mode(name) AS name, mode(imo) AS imo, mode(type) AS type, mode(length) AS length
    FROM g GROUP BY mmsi, seg
   HAVING max(t) - min(t) >= INTERVAL {minmin} MINUTE
)
SELECT s.mmsi, strftime(s.t0, '%Y-%m-%dT%H:%M:%SZ') AS t0, strftime(s.t1, '%Y-%m-%dT%H:%M:%SZ') AS t1, s.n,
       round(s.mlat, 6) AS lat, round(s.mlon, 6) AS lon,
       round(quantile_cont(2 * 6371008.8 * asin(sqrt(pow(sin(radians(g.lat - s.mlat) / 2), 2)
             + cos(radians(g.lat)) * cos(radians(s.mlat)) * pow(sin(radians(g.lon - s.mlon) / 2), 2))), 0.9), 1) AS spread_m,
       s.name, s.imo, s.type, s.length
  FROM s JOIN g ON g.mmsi = s.mmsi AND g.seg = s.seg
 GROUP BY s.mmsi, s.seg, s.t0, s.t1, s.n, s.mlat, s.mlon, s.name, s.imo, s.type, s.length
 ORDER BY 2, 1
"""


def main():
    a = sys.argv[1:]
    box = dict(BURRARD)
    if "--box" in a:
        w, s, e, n = map(float, a[a.index("--box") + 1:a.index("--box") + 5])
        box = dict(w=w, s=s, e=e, n=n)
    name = a[a.index("--out") + 1] if "--out" in a else "burrard"
    rule = dict(RULE)
    if "--min-hours" in a: rule["minHours"] = float(a[a.index("--min-hours") + 1])
    if "--min-length" in a: rule["minLengthM"] = float(a[a.index("--min-length") + 1])
    if "--days" in a:
        want = []
        for x in a[a.index("--days") + 1:]:
            if x.startswith("--"): break
            want.append(x)
        files = [os.path.join(POINTS, f"{d}.parquet") for d in want]
        files = [f for f in files if os.path.exists(f)]
    else:
        # Python's glob skips dotfiles: macOS writes AppleDouble "._<day>.parquet" files on the external drive.
        files = sorted(f for f in glob.glob(os.path.join(POINTS, "*.parquet")) if not os.path.basename(f).startswith("._"))
    if not files:
        sys.exit(f"no day files under {POINTS} (is the external drive mounted?)")
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'"); con.execute("SET threads=4"); con.execute("SET preserve_insertion_order=false")
    src = "[" + ",".join("'" + f.replace("'", "''") + "'" for f in files) + "]"
    sql = SQL.format(src=src, sog=rule["sogKn"], minlen=rule["minLengthM"], gap=int(rule["gapMinutes"]), jump=rule["jumpM"],
                     minmin=int(rule["minHours"] * 60), **box)
    os.makedirs(OUT, exist_ok=True)
    csv = os.path.join(OUT, f"berth-stops-{name}.csv")
    con.execute(f"COPY ({sql}) TO '{csv}' (HEADER, DELIMITER ',')")
    n = con.execute(f"SELECT count(*), count(DISTINCT mmsi) FROM read_csv_auto('{csv}')").fetchone()
    days = [os.path.basename(f)[:10] for f in files]
    meta = dict(what="long stops of large ships (AIS-inferred berths, step 1)", rule=rule, box=box, region=REGION,
                input=dict(source="marinecadastre-ais", cache=f"scripts/ships/bake-ais/cache/points/{REGION}",
                           timestamps="base_date_time, UTC as MarineCadastre publishes it"),
                days=dict(n=len(days), first=days[0], last=days[-1]), stops=n[0], ships=n[1],
                made_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    with open(os.path.join(OUT, f"berth-stops-{name}.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"{n[0]:,} stops by {n[1]:,} ships from {len(days)} day files ({days[0]} … {days[-1]}) → {csv}")


if __name__ == "__main__":
    main()
