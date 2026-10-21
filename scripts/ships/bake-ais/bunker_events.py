#!/usr/bin/env python3
"""
Likely bunkering at anchorages (Josh 2026-10-18; Lovel's question about Port Angeles, Vendovi and other anchorages).

A bunker barge carries no AIS of its own, so a fueling shows as its tug (or a small bunker tanker) lying right beside an
anchored large ship for an hour or more. From the salish-v6 points cache (MarineCadastre daily points, CC0; fetch_points.py),
per day file:
  receiver  a large ship (AIS type 60–89: passenger, cargo, tanker; length >= receiverMinLen m) stopped (sog < sogKn) and
            either inside an anchorage polygon (anchorages.json from `node scripts/ships/anchorage-stays.mjs polygons`, the
            same polygons and point-in-polygon rule as anchorage_stays.py) or reporting AIS status "at anchor" more than
            berthClearM from any terminal berth; those outside every polygon are filed under the nearest anchorage within
            nearestAnchorageKm, marked outside (2026-10-18: Port Angeles tankers anchor ~1.5 km west of the polygon)
  supplier  a tug or towing vessel (AIS type 31, 32, 52) or a small tanker (type 80–89, length < receiverMinLen m),
            at least supplierMinLen m long and not a US Navy harbor tug (YT…), also stopped, within nearM metres of the
            receiver at the same minute (positions paired within pairS seconds)
  event     paired minutes of one (anchorage, receiver, supplier), split where they stop for more than GAP_MIN minutes;
            kept when it lasts at least MIN_MINUTES
Each event row keeps its evidence: first/last paired time, number of paired minutes, closest and median distance.
Events that run past midnight are cut at the day file's edge; the import joins them back (same pair, gap <= GAP_MIN).

Run (from this directory):
  python3 bunker_events.py --days 2025-07-01 2025-07-02      # prove on a day or two first
  python3 bunker_events.py                                   # every cached day (resumable: finished days are skipped)
  python3 bunker_events.py --export                          # events.csv + meta.json
Output: cache/bunker-events/ (beside cache/anchorage-stays).
"""
import os, sys, json, glob, datetime as dt
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REGION = "salish-v6"
POINTS = os.path.join(HERE, "cache", "points", REGION)
POLYGONS = os.path.join(HERE, "cache", "anchorage-stays", "anchorages.json")
OUT = os.path.join(HERE, "cache", "bunker-events")
RULE = dict(version="be4", sogKn=1.0, receiverMinLen=100, nearM=200, pairS=90, gapMin=15, minMinutes=60,
            receiverTypes=[60, 89], supplierTypes=[31, 32, 52], smallTankerTypes=[80, 89],
            supplierMinLen=15,          # launches and water taxis (e.g. 12 m) bring crew and stores, not fuel
            supplierNameExclude="^YT ?[0-9]",  # US Navy harbor tugs ("YT812 BAKER", "YT 803 RELIANT")
            atAnchorStatus=1, nearestAnchorageKm=6, berthClearM=400,
            # be4 (2026-10-20, from the Ecology ANT comparison): ATB / tug receivers (ANT lists fuelings of "ATB TUG DUBLIN SEA",
            # "LAUREN FOSS"); kept only when a known bunker tug is alongside, decided at read (lib/ships/bunkerMatch.js).
            tugReceiverMinLen=25, receiverNameExclude="^WSF ")


def connect():
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'")
    con.execute("SET threads=4")
    con.execute("SET preserve_insertion_order=false")
    return con


def setup(con):
    with open(POLYGONS) as f:
        aj = json.load(f)
    covered = [a for a in aj["anchorages"] if a["coverage"] == "covered"]
    con.execute("CREATE TEMP TABLE anch (key VARCHAR, priority INTEGER, s DOUBLE, n DOUBLE, w DOUBLE, e DOUBLE)")
    con.executemany("INSERT INTO anch VALUES (?,?,?,?,?,?)",
                    [(a["key"], a["priority"], a["bbox"][0], a["bbox"][1], a["bbox"][2], a["bbox"][3]) for a in covered])
    keys = {a["key"] for a in covered}
    con.execute("CREATE TEMP TABLE edges (key VARCHAR, x1 DOUBLE, y1 DOUBLE, x2 DOUBLE, y2 DOUBLE, ylo DOUBLE, yhi DOUBLE)")
    con.executemany("INSERT INTO edges VALUES (?,?,?,?,?,?,?)",
                    [(e["key"], e["x1"], e["y1"], e["x2"], e["y2"], min(e["y1"], e["y2"]), max(e["y1"], e["y2"]))
                     for e in aj["edges"] if e["key"] in keys and e["y1"] != e["y2"]])
    # Where an anchored ship lies outside every polygon, it is filed under the nearest anchorage that is not a tug-and-barge
    # holding area (Port Angeles: the General Anchorage, not the holding area beside it).
    con.execute("CREATE TEMP TABLE holding (key VARCHAR)")
    con.executemany("INSERT INTO holding VALUES (?)", [(a["key"],) for a in covered if "tug and barge" in (a.get("name") or "").lower()])
    con.execute("CREATE TEMP TABLE cen AS SELECT key, (s + n) / 2 AS clat, (w + e) / 2 AS clon FROM anch WHERE key NOT IN (SELECT key FROM holding)")
    with open(os.path.join(HERE, "..", "..", "..", "lib", "ships", "data", "salish-terminals.json")) as f:
        tj = json.load(f)
    terms = tj if isinstance(tj, list) else tj.get("terminals", [])
    con.execute("CREATE TEMP TABLE berths (lat DOUBLE, lon DOUBLE)")
    con.executemany("INSERT INTO berths VALUES (?,?)", [(b["lat"], b["lon"]) for t in terms for b in t.get("berths", []) if b.get("lat") is not None])
    return aj["bake_version"]


EVENTS_SQL = """
WITH p AS (   -- one position per vessel per timestamp, stopped, inside the anchorages' overall box
  SELECT mmsi, base_date_time AS t, any_value(latitude) AS lat, any_value(longitude) AS lon, any_value(vessel_name) AS name,
         any_value(imo) AS imo, any_value(vessel_type) AS type, any_value(length) AS length, any_value(status) AS status
    FROM read_parquet($file)
   WHERE sog < $sog AND mmsi IS NOT NULL AND base_date_time IS NOT NULL
     AND latitude BETWEEN (SELECT min(s) FROM anch) AND (SELECT max(n) FROM anch)
     AND longitude BETWEEN (SELECT min(w) FROM anch) AND (SELECT max(e) FROM anch)
   GROUP BY mmsi, base_date_time
), r0 AS (    -- receivers: large passenger / cargo / tanker ships, and (be4) ATB / tug units; not Washington State Ferries
  SELECT *, CASE WHEN type IN $stypes THEN 'tug' ELSE 'ship' END AS rclass FROM p
   WHERE ((type BETWEEN $rlo AND $rhi AND length >= $rlen) OR (type IN $stypes AND coalesce(length, 0) >= $tlen))
     AND NOT regexp_matches(coalesce(name, ''), '$rexcl') AND NOT regexp_matches(coalesce(name, ''), '$sexcl')
), c AS (
  SELECT r0.*, a.key, a.priority FROM r0 JOIN anch a ON r0.lat BETWEEN a.s AND a.n AND r0.lon BETWEEN a.w AND a.e
), x AS (
  SELECT c.mmsi, c.t, c.key, count(*) AS crossings
    FROM c JOIN edges e ON e.key = c.key AND c.lat >= e.ylo AND c.lat < e.yhi
   WHERE c.lon < (e.x2 - e.x1) * (c.lat - e.y1) / (e.y2 - e.y1) + e.x1
   GROUP BY 1, 2, 3
), r_in AS (  -- receiver positions inside an anchorage (lowest priority wins where polygons overlap, as anchorage_stays.py)
  SELECT * EXCLUDE (rn) FROM (
    SELECT c.*, row_number() OVER (PARTITION BY c.mmsi, c.t ORDER BY c.priority, c.key) AS rn
      FROM c JOIN x USING (mmsi, t, key) WHERE x.crossings % 2 = 1) WHERE rn = 1
), r_anc AS ( -- or "at anchor" outside every polygon, away from terminal berths: filed under the nearest anchorage
  SELECT * EXCLUDE (rn, dk) FROM (
    SELECT r0.*, cen.key, 0 AS priority,
           row_number() OVER (PARTITION BY r0.mmsi, r0.t ORDER BY (cen.clat - r0.lat) ^ 2 + ((cen.clon - r0.lon) * 0.66) ^ 2) AS rn,
           sqrt((cen.clat - r0.lat) ^ 2 + ((cen.clon - r0.lon) * 0.66) ^ 2) * 111.2 AS dk
      FROM r0 JOIN cen ON abs(cen.clat - r0.lat) < 0.06 AND abs(cen.clon - r0.lon) < 0.09
     WHERE r0.status = $anchorstatus
       AND NOT EXISTS (SELECT 1 FROM r_in WHERE r_in.mmsi = r0.mmsi AND r_in.t = r0.t)
       AND NOT EXISTS (SELECT 1 FROM berths b WHERE abs(b.lat - r0.lat) < $bclat AND abs(b.lon - r0.lon) < $bclon))
   WHERE rn = 1 AND dk <= $nearkm
), r AS (       -- tug receivers never inside a tug-and-barge holding area (tugs wait there rafted together)
  SELECT * FROM (SELECT *, true AS inside FROM r_in UNION ALL SELECT *, false AS inside FROM r_anc)
   WHERE rclass = 'ship' OR key NOT IN (SELECT key FROM holding)
), s AS (     -- suppliers: tugs / towing vessels, small tankers; not launches, not Navy harbor tugs
  SELECT * FROM p WHERE (type IN $stypes OR (type BETWEEN $tlo AND $thi AND coalesce(length, 0) < $rlen))
     AND coalesce(length, 0) >= $slen AND NOT regexp_matches(coalesce(name, ''), '$sexcl')
), pair AS (  -- same minute (within pairS seconds), within nearM metres
  SELECT r.key AS anchorage, r.inside, r.rclass, r.mmsi AS receiver, s.mmsi AS supplier, r.t,
         2 * 6371000 * asin(sqrt(pow(sin(radians(s.lat - r.lat) / 2), 2)
           + cos(radians(r.lat)) * cos(radians(s.lat)) * pow(sin(radians(s.lon - r.lon) / 2), 2))) AS d,
         r.name AS r_name, r.imo AS r_imo, r.type AS r_type, r.length AS r_len,
         s.name AS s_name, s.imo AS s_imo, s.type AS s_type, s.length AS s_len
    FROM r JOIN s ON s.mmsi <> r.mmsi
     AND s.t BETWEEN r.t - INTERVAL ($pairs || ' seconds') AND r.t + INTERVAL ($pairs || ' seconds')
     AND abs(s.lat - r.lat) < 0.003 AND abs(s.lon - r.lon) < 0.005
), near AS (  -- one row per receiver minute per supplier (closest)
  SELECT anchorage, receiver, supplier, date_trunc('minute', t) AS m, min(d) AS d, bool_or(inside) AS inside, any_value(rclass) AS rclass,
         any_value(r_name) AS r_name, any_value(r_imo) AS r_imo, any_value(r_type) AS r_type, any_value(r_len) AS r_len,
         any_value(s_name) AS s_name, any_value(s_imo) AS s_imo, any_value(s_type) AS s_type, any_value(s_len) AS s_len
    FROM pair WHERE d <= $near GROUP BY 1, 2, 3, 4
), runs AS (
  SELECT *, sum(CASE WHEN prev IS NULL OR m - prev > INTERVAL ($gap || ' minutes') THEN 1 ELSE 0 END)
              OVER (PARTITION BY anchorage, receiver, supplier ORDER BY m) AS run
    FROM (SELECT *, lag(m) OVER (PARTITION BY anchorage, receiver, supplier ORDER BY m) AS prev FROM near)
)
SELECT anchorage, receiver, supplier, min(m) AS t0, max(m) AS t1, count(*) AS minutes,
       round(min(d)) AS min_m, round(median(d)) AS median_m, bool_or(inside) AS inside, any_value(rclass) AS rclass,
       any_value(r_name) AS r_name, any_value(r_imo) AS r_imo, any_value(r_type) AS r_type, any_value(r_len) AS r_len,
       any_value(s_name) AS s_name, any_value(s_imo) AS s_imo, any_value(s_type) AS s_type, any_value(s_len) AS s_len
  FROM runs GROUP BY anchorage, receiver, supplier, run
HAVING max(m) - min(m) >= INTERVAL ($minmin || ' minutes')
"""


def sql_for(day_file):
    rp = RULE
    rep = {"$file": "'" + day_file.replace("'", "''") + "'", "$sog": str(float(rp["sogKn"])),
           "$rlo": str(rp["receiverTypes"][0]), "$rhi": str(rp["receiverTypes"][1]), "$rlen": str(rp["receiverMinLen"]),
           "$stypes": "(" + ",".join(map(str, rp["supplierTypes"])) + ")",
           "$tlo": str(rp["smallTankerTypes"][0]), "$thi": str(rp["smallTankerTypes"][1]),
           "$tlen": str(rp["tugReceiverMinLen"]), "$rexcl": rp["receiverNameExclude"],
           "$slen": str(rp["supplierMinLen"]), "$sexcl": rp["supplierNameExclude"], "$anchorstatus": str(rp["atAnchorStatus"]),
           "$nearkm": str(rp["nearestAnchorageKm"]), "$bclat": str(rp["berthClearM"] / 111200), "$bclon": str(rp["berthClearM"] / 74000),
           "$pairs": f"'{rp['pairS']}'", "$near": str(rp["nearM"]), "$gap": f"'{rp['gapMin']}'", "$minmin": f"'{rp['minMinutes']}'"}
    out = EVENTS_SQL
    for k in sorted(rep, key=len, reverse=True):
        out = out.replace(k, rep[k])
    return out


def bake_day(con, day_file, out_file):
    tmp = out_file + ".tmp"
    con.execute(f"COPY ({sql_for(day_file)}) TO '{tmp}' (FORMAT parquet)")
    os.replace(tmp, out_file)
    return con.execute("SELECT count(*) FROM read_parquet(?)", [out_file]).fetchone()[0]


def export(con, bake_version):
    files = sorted(glob.glob(os.path.join(OUT, f"events-{RULE['version']}-{bake_version}", "*.parquet")))
    if not files:
        sys.exit("no events baked yet")
    src = "[" + ",".join("'" + f.replace("'", "''") + "'" for f in files) + "]"
    csv = os.path.join(OUT, "events.csv")
    con.execute(f"""COPY (SELECT anchorage, receiver, supplier, strftime(t0, '%Y-%m-%dT%H:%M:00Z') AS t0,
                                 strftime(t1, '%Y-%m-%dT%H:%M:00Z') AS t1, minutes, min_m, median_m, inside,
                                 r_name, r_imo, r_type, r_len, s_name, s_imo, s_type, s_len
                            FROM read_parquet({src}) ORDER BY anchorage, t0) TO '{csv}' (HEADER, DELIMITER ',')""")
    days = [os.path.basename(f)[:10] for f in files]
    n = con.execute(f"SELECT count(*) FROM read_parquet({src})").fetchone()[0]
    con.execute(f"""COPY (SELECT anchorage, inside, rclass, CAST(receiver AS VARCHAR) AS receiver, CAST(supplier AS VARCHAR) AS supplier,
                                 strftime(t0, '%Y-%m-%dT%H:%M:00Z') AS t0, strftime(t1, '%Y-%m-%dT%H:%M:00Z') AS t1, minutes, min_m, median_m,
                                 r_name, r_imo, r_type, r_len, s_name, s_imo, s_type, s_len
                            FROM read_parquet({src}) ORDER BY anchorage, t0) TO '{os.path.join(OUT, "events.json")}' (FORMAT json, ARRAY true)""")
    meta = dict(rule=RULE, anchorages_bake=bake_version, days=days, events=n,
                baked_at=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                input=dict(source="marinecadastre-ais", region=REGION, cache="scripts/ships/bake-ais/cache/points/salish-v6",
                           timestamps="base_date_time, UTC as MarineCadastre publishes it"))
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print(f"export: {n:,} events from {len(days)} days → {csv}")


def main():
    args = sys.argv[1:]
    con = connect()
    bv = setup(con)
    if "--export" in args:
        return export(con, bv)
    want = args[args.index("--days") + 1:] if "--days" in args else None
    files = [os.path.join(POINTS, f"{d}.parquet") for d in want] if want else sorted(glob.glob(os.path.join(POINTS, "*.parquet")))
    od = os.path.join(OUT, f"events-{RULE['version']}-{bv}")
    os.makedirs(od, exist_ok=True)
    total = 0
    for i, f in enumerate(files, 1):
        day = os.path.basename(f)[:10]
        out = os.path.join(od, f"{day}.parquet")
        if os.path.exists(out) or not os.path.exists(f):
            continue
        n = bake_day(con, f, out)
        total += n
        print(f"[{i}/{len(files)}] {day}: {n} likely bunkering events", flush=True)
    print(f"done: {total} events → {od}")


if __name__ == "__main__":
    main()
