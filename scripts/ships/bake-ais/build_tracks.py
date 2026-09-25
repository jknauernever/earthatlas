#!/usr/bin/env python3
"""
Step 2 of the /ships AIS bake: cached daily points → one month of tracks → PMTiles.

Tracks are DERIVED data (src/ships/CLAUDE.md): reproducible from the cached
points, and every rule and parameter is written into the output manifest.

Derivation rules (v1)
  1. Keep valid positions only: lat in [-90, 90], lon in [-180, 180], not (0, 0).
     Duplicate (mmsi, timestamp) rows keep one.
  1b. Positions more than 500 m inland (land_mask.py grid over /shiptraffic's
     GSHHG outline) are not drawn, and a track is split where it leaves the
     water, so trailer drives and road-borne transponders never become "ship
     tracks". The positions stay in the cache as evidence.
  1c. A straight line between two water positions must not cross land either
     (a reception gap, or a trailer drive to a launch ramp). The line is sampled
     every LINE_STEP_M against the plain shoreline (salish-land-0m grid); if
     LINE_LAND_MIN_M or more of it is over land, the track is split there
     instead of drawn across the island. Narrow isthmuses have no deep-inland
     cells, so lines need this test, not the 500 m one; 300 m is longer than
     any shoreline wobble at a dock.
  2. Per MMSI, ordered by time, start a NEW track when either
       - the gap since the previous position exceeds GAP_MIN minutes, or
       - the implied speed from the previous position exceeds MAX_KNOTS (an
         impossible jump: bad fix, or two transmitters sharing an MMSI).
     So no line is ever drawn across a long silence or a teleport.
  3. Drop tracks with fewer than 2 positions, and "parked" tracks whose whole
     extent is under PARKED_M metres (a moored boat's GPS jitter is not a
     movement). Parked tracks are counted in the stats, not drawn.
  4. Simplify each line to SIMPLIFY_DEG (~18 m), invisible at map zoom.
  5. `kind` = NOAA/USCG vessel group of the most common vessel_type code in the
     track (docs/MARINECADASTRE_AIS.md). `vtype` keeps that raw code.
Tile properties per track: mmsi, kind, vtype, month, t0, t1 (epoch s, UTC), n.

Tiles are styled exactly like /shiptraffic's (the app does that; see ShipsApp),
and the tippecanoe settings match scripts/bake-shiptraffic/build_tracks_tiles.py
(-Z5 -z10, --simplification=10, --drop-densest-as-needed).

Also writes track_tiles/tracks-YYYY-MM.pack: EVERY drawn track, grouped by
MMSI. The tiles are a density picture; tippecanoe's --drop-densest-as-needed
drops lines in crowded tiles at every zoom (LINNEA ROSE's three June 2026 trips
out of Friday Harbor were in no tile at all). A picked ship's tracks must be
complete, so the app reads them from this pack via /api/ship-tracks?mmsi=…
Layout (same as /inmotion's trace-detail.pack): 'SHTP', uint32 LE shard count
N, (N+1) uint32 LE offsets relative to the data start, then N gzip'd NDJSON
shards. Each line is {mmsi, kind, vtype, t0, t1, n, c: [[lon, lat], …]}.

Also writes build/identity-YYYY-MM.ndjson: per MMSI, each distinct static value
(name, call sign, IMO, vessel_type, length, width, transceiver) with the first
and last time it was seen. That is the MarineCadastre identity evidence that
/ships imports as claims.

Run:  python3 build_tracks.py 2026-06
Deps: pip install duckdb ; brew install tippecanoe
"""
import gzip, json, os, struct, subprocess, sys, time
import land_mask
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
REGION = "salish"
POINTS = os.path.join(HERE, "cache", "points", REGION)
BUILD = os.path.join(HERE, "build")
TILES = os.path.join(HERE, "track_tiles")

GAP_MIN = 30          # minutes of silence that end a track
MAX_KNOTS = 60        # implied speed above this = impossible jump → break
MIN_DT_S = 30         # floor for the speed check (1-minute sampling + clock jitter)
PARKED_M = 100        # tracks spanning less than this are moorings, not movement
LINE_STEP_M = 100     # sample spacing along each straight segment
LINE_LAND_MIN_M = 300 # this much of a segment over land → split
SIMPLIFY_DEG = 0.0002 # ~18 m at 48°N, same as /shiptraffic
PACK_SIMPLIFY_DEG = 0.00005  # ~5 m: per-ship tracks are drawn up close
PACK_SHARDS = 1024           # tracks-YYYY-MM.pack groups every drawn track by mmsi % PACK_SHARDS

# NOAA/USCG vessel groups (docs/MARINECADASTRE_AIS.md, repo docs/vessel-type-codes-20{18,20}.pdf).
KIND_SQL = """CASE
  WHEN v IS NULL OR v = 0 THEN 'unknown'
  WHEN v IN (30, 1001, 1002) THEN 'fishing'
  WHEN v IN (31, 32, 52, 1023, 1025) THEN 'tug'
  WHEN v IN (36, 37, 1019) THEN 'pleasure'
  WHEN v IN (40, 60, 1012, 1013, 1014, 1015) OR v BETWEEN 60 AND 69 THEN 'passenger'
  WHEN v BETWEEN 70 AND 79 OR v IN (1003, 1004, 1016) THEN 'cargo'
  WHEN v BETWEEN 80 AND 89 OR v IN (1017, 1024) THEN 'tanker'
  ELSE 'other' END"""


def build(ym):
    if not (os.path.exists(land_mask.OUT) and os.path.exists(land_mask.OUT_LAND)):
        land_mask.main()
    files = os.path.join(POINTS, f"{ym}-*.parquet")
    os.makedirs(BUILD, exist_ok=True); os.makedirs(TILES, exist_ok=True)
    ndjson = os.path.join(BUILD, f"tracks-{ym}.ndjson")
    out = os.path.join(TILES, f"tracks-{ym}.pmtiles")
    ident = os.path.join(BUILD, f"identity-{ym}.ndjson")
    con = duckdb.connect()
    os.makedirs(os.path.join(BUILD, "duckdb-tmp"), exist_ok=True)
    con.execute(f"INSTALL spatial; LOAD spatial; SET memory_limit='6GB'; SET preserve_insertion_order=false; SET temp_directory='{os.path.join(BUILD, 'duckdb-tmp')}';")
    con.execute(f"CREATE TEMP TABLE inland AS SELECT cell FROM read_parquet('{land_mask.OUT}')")
    con.execute(f"CREATE TEMP TABLE landcell AS SELECT cell FROM read_parquet('{land_mask.OUT_LAND}')")
    t0 = time.time()

    # Staged into temp tables (one big statement computed `d` twice and ran out of memory).
    con.execute(f"""
      CREATE TEMP TABLE d AS
      WITH p0 AS (
        SELECT mmsi, base_date_time AS t, longitude AS lon, latitude AS lat, vessel_type,
               CAST(floor((latitude - {land_mask.BBOX['s']}) / {land_mask.CELL_DEG}) AS BIGINT) * {land_mask.NX}
                 + CAST(floor((longitude - {land_mask.BBOX['w']}) / {land_mask.CELL_DEG}) AS BIGINT) AS cell
          FROM read_parquet('{files}')
         WHERE latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
           AND NOT (latitude = 0 AND longitude = 0)
        QUALIFY row_number() OVER (PARTITION BY mmsi, base_date_time ORDER BY longitude, latitude) = 1
      ), p AS (
        SELECT p0.* EXCLUDE (cell), (lm.cell IS NOT NULL) AS inland
          FROM p0 LEFT JOIN inland lm ON lm.cell = p0.cell
      ), l AS (
        SELECT *, lag(t) OVER w AS pt, lag(lon) OVER w AS plon, lag(lat) OVER w AS plat, lag(inland) OVER w AS pinland
          FROM p WINDOW w AS (PARTITION BY mmsi ORDER BY t)
      )
      SELECT *,
        -- haversine distance to the previous fix, nautical miles
        CASE WHEN pt IS NULL THEN NULL ELSE 3440.065 * 2 * asin(sqrt(
          power(sin(radians(lat - plat) / 2), 2) +
          cos(radians(plat)) * cos(radians(lat)) * power(sin(radians(lon - plon) / 2), 2))) END AS nm,
        epoch(t - pt) AS dt
        FROM l
    """)
    # Segments whose straight line runs over land for LINE_LAND_MIN_M or more:
    # sample every LINE_STEP_M, compute each sample's grid cell FIRST, then
    # equi-join the land grid (computing the cell inside the join condition
    # becomes a nested loop over millions of cells).
    con.execute(f"""
      CREATE TEMP TABLE landcross AS
      SELECT s.mmsi, s.t FROM (
        SELECT q.mmsi, q.t,
               CAST(floor(((q.plat + (q.lat - q.plat) * k / q.steps) - {land_mask.BBOX['s']}) / {land_mask.CELL_DEG}) AS BIGINT) * {land_mask.NX}
             + CAST(floor(((q.plon + (q.lon - q.plon) * k / q.steps) - {land_mask.BBOX['w']}) / {land_mask.CELL_DEG}) AS BIGINT) AS cell
          FROM (SELECT mmsi, t, lat, lon, plat, plon, CAST(ceil(nm * 1852 / {LINE_STEP_M}) AS INTEGER) AS steps
                  FROM d WHERE pt IS NOT NULL AND NOT inland AND NOT pinland
                   AND nm * 1852 >= {LINE_LAND_MIN_M}) q,
               unnest(range(1, q.steps)) u(k)
      ) s JOIN landcell USING (cell)
      GROUP BY s.mmsi, s.t HAVING count(*) * {LINE_STEP_M} >= {LINE_LAND_MIN_M}
    """)
    con.execute(f"""
      CREATE TEMP TABLE seg AS
      WITH b AS (
        SELECT d.*, CASE WHEN pt IS NULL THEN 1
                       WHEN inland OR pinland THEN 1
                       WHEN c.t IS NOT NULL THEN 1
                       WHEN dt > {GAP_MIN * 60} THEN 1
                       WHEN nm / (greatest(dt, {MIN_DT_S}) / 3600.0) > {MAX_KNOTS} THEN 1
                       ELSE 0 END AS brk
          FROM d LEFT JOIN landcross c ON c.mmsi = d.mmsi AND c.t = d.t
      )
      SELECT *, sum(brk) OVER (PARTITION BY mmsi ORDER BY t ROWS UNBOUNDED PRECEDING) AS sid FROM b
    """)
    con.execute("DROP TABLE d")
    land_cross = con.execute("SELECT count(*) FROM landcross").fetchone()[0]
    stats = dict(points=con.execute("SELECT count(*) FROM seg").fetchone()[0],
                 vessels=con.execute("SELECT count(DISTINCT mmsi) FROM seg").fetchone()[0],
                 inland_points_not_drawn=con.execute("SELECT count(*) FROM seg WHERE inland").fetchone()[0],
                 segments_split_over_land=land_cross)
    con.execute("DELETE FROM seg WHERE inland")

    con.execute(f"""
      CREATE TEMP TABLE trk AS
      SELECT mmsi, sid, min(t) AS t0, max(t) AS t1, count(*) AS n, mode(vessel_type) AS v,
             ST_MakeLine(list(ST_Point(lon, lat) ORDER BY t)) AS g,
             -- extent diagonal in metres (small-area approximation)
             sqrt(power((max(lat) - min(lat)) * 111320, 2) +
                  power((max(lon) - min(lon)) * 111320 * cos(radians(avg(lat))), 2)) AS span_m
        FROM seg GROUP BY mmsi, sid HAVING count(*) >= 2
    """)
    tracks, parked = con.execute(f"SELECT count(*), count(*) FILTER (WHERE span_m < {PARKED_M}) FROM trk").fetchone()
    stats.update(tracks=tracks, parked_not_drawn=parked)

    with open(ndjson, "w") as fh:
        rows = con.execute(f"""
          SELECT mmsi, {KIND_SQL} AS kind, v, epoch(t0)::BIGINT, epoch(t1)::BIGINT, n,
                 ST_AsGeoJSON(ST_Simplify(g, {SIMPLIFY_DEG}))
            FROM trk WHERE span_m >= {PARKED_M}""")
        while True:
            batch = rows.fetchmany(20000)
            if not batch:
                break
            for mmsi, kind, v, a, b, n, geom in batch:
                fh.write(json.dumps({"type": "Feature", "geometry": json.loads(geom), "properties": {
                    "mmsi": mmsi, "kind": kind, "vtype": v, "month": ym, "t0": a, "t1": b, "n": n}}) + "\n")

    # Per-MMSI pack: complete tracks for the picked-ship highlight.
    shards = [[] for _ in range(PACK_SHARDS)]
    rows = con.execute(f"""
      SELECT mmsi, {KIND_SQL} AS kind, v, epoch(t0)::BIGINT, epoch(t1)::BIGINT, n,
             ST_AsGeoJSON(ST_Simplify(g, {PACK_SIMPLIFY_DEG}))
        FROM trk WHERE span_m >= {PARKED_M} ORDER BY mmsi, t0""")
    while True:
        batch = rows.fetchmany(20000)
        if not batch:
            break
        for mmsi, kind, v, a, b, n, geom in batch:
            c = [[round(x, 5), round(y, 5)] for x, y in json.loads(geom)["coordinates"]]
            shards[mmsi % PACK_SHARDS].append(json.dumps({"mmsi": mmsi, "kind": kind, "vtype": v, "t0": a, "t1": b, "n": n, "c": c}, separators=(",", ":")))
    blobs = [gzip.compress(("\n".join(sh) + "\n").encode(), 9) if sh else b"" for sh in shards]
    offsets, pos = [], 0
    for b_ in blobs:
        offsets.append(pos); pos += len(b_)
    offsets.append(pos)
    pack = os.path.join(TILES, f"tracks-{ym}.pack")
    with open(pack + ".tmp", "wb") as fh:
        fh.write(b"SHTP"); fh.write(struct.pack("<I", PACK_SHARDS)); fh.write(struct.pack(f"<{PACK_SHARDS + 1}I", *offsets))
        for b_ in blobs:
            fh.write(b_)
    os.replace(pack + ".tmp", pack)

    # Static identity evidence per MMSI: each distinct value with first/last seen.
    con.execute(f"""
      COPY (
        WITH p AS (SELECT * FROM read_parquet('{files}'))
        SELECT mmsi, attr, value, min(base_date_time) AS first_seen, max(base_date_time) AS last_seen, count(*) AS n
          FROM (
            SELECT mmsi, base_date_time, 'name' AS attr, vessel_name AS value FROM p WHERE vessel_name <> ''
            UNION ALL SELECT mmsi, base_date_time, 'callsign', call_sign FROM p WHERE call_sign <> ''
            UNION ALL SELECT mmsi, base_date_time, 'imo', imo FROM p WHERE imo <> ''
            UNION ALL SELECT mmsi, base_date_time, 'vessel_type', vessel_type::VARCHAR FROM p WHERE vessel_type IS NOT NULL AND vessel_type <> 0
            UNION ALL SELECT mmsi, base_date_time, 'length_m', length::VARCHAR FROM p WHERE length > 0
            UNION ALL SELECT mmsi, base_date_time, 'width_m', width::VARCHAR FROM p WHERE width > 0
            UNION ALL SELECT mmsi, base_date_time, 'transceiver', transceiver FROM p WHERE transceiver <> ''
          ) GROUP BY ALL ORDER BY mmsi, attr, first_seen
      ) TO '{ident}' (FORMAT json)""")

    subprocess.run(["tippecanoe", "-o", out, "-l", "tracks", "-f", "-q", "-Z5", "-z10",
                    "--simplification=10", "--drop-densest-as-needed", "--read-parallel", ndjson], check=True)
    os.remove(ndjson)

    manifest = dict(region=REGION, month=ym, built=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    source="MarineCadastre daily AIS points (NOAA/BOEM/USCG), CC0",
                    rules=dict(version="v4", inland_m=land_mask.INLAND_M, line_step_m=LINE_STEP_M, line_land_min_m=LINE_LAND_MIN_M, land="GSHHG full-res via scripts/bake-shiptraffic/salish_land.geojson", gap_min=GAP_MIN, max_knots=MAX_KNOTS, min_dt_s=MIN_DT_S,
                               parked_m=PARKED_M, simplify_deg=SIMPLIFY_DEG,
                               tippecanoe="-Z5 -z10 --simplification=10 --drop-densest-as-needed"),
                    pack=dict(shards=PACK_SHARDS, simplify_deg=PACK_SIMPLIFY_DEG, bytes=os.path.getsize(pack)),
                    stats=stats, pmtiles_bytes=os.path.getsize(out), secs=round(time.time() - t0))
    with open(os.path.join(TILES, f"tracks-{ym}.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for ym in sys.argv[1:]:
        build(ym)
