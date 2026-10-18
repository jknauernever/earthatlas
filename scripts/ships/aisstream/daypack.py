#!/usr/bin/env python3
"""
One UTC day of recorded aisstream rows → a /ships track pack, readable by api/ship-tracks.js tracksForMmsi unchanged:
  DATA_DIR/tracks/YYYY-MM-DD/<PACK_NAME>   'SHTP', uint32 N (1024), N+1 uint32 LE offsets (relative to the data start),
                                           then N gzip'd NDJSON shards; a ship's lines sit in shard mmsi % N.
  DATA_DIR/tracks/index.json               days → { pack (published URL), pack_bytes, n, built, final, through, minutesRecorded }

Each line: {"mmsi","kind","vtype","t0","t1","n","c":[[lon,lat],…],"ts":[epoch s per vertex]}. Minute resolution, not
simplified. Track rules as scripts/ships/bake-ais/build_tracks.py (GAP_MIN, MAX_KNOTS, MIN_DT_S, PARKED_M, KIND_SQL),
without its land mask (noted in the index rules).

Reads raw/DAY/*.ndjson(.gz) — today's open hour included — plus the next day's first file (rows are filed by receive
time). FINAL=1 marks the day complete (run after the next day's first file is closed).

Run:  python3 daypack.py DATA_DIR YYYY-MM-DD final|partial PACK_NAME   (the recorder uploads PACK_NAME and fills in its URL)
"""
import datetime as dt, glob, gzip, json, os, struct, sys
import duckdb

data, day = sys.argv[1], sys.argv[2]
final = len(sys.argv) > 3 and sys.argv[3] == "final"
name = sys.argv[4] if len(sys.argv) > 4 else "tracks.pack"
VERSION, N = "aisstream-v1", 1024
GAP_MIN, MAX_KNOTS, MIN_DT_S, PARKED_M = 30, 60, 30, 100
KIND_SQL = """CASE
  WHEN v IS NULL OR v = 0 THEN 'unknown'
  WHEN v IN (30, 1001, 1002) THEN 'fishing'
  WHEN v IN (31, 32, 52, 1023, 1025) THEN 'tug'
  WHEN v IN (36, 37, 1019) THEN 'pleasure'
  WHEN v IN (40, 60, 1012, 1013, 1014, 1015) OR v BETWEEN 60 AND 69 THEN 'passenger'
  WHEN v BETWEEN 70 AND 79 OR v IN (1003, 1004, 1016) THEN 'cargo'
  WHEN v BETWEEN 80 AND 89 OR v IN (1017, 1024) THEN 'tanker'
  ELSE 'other' END"""

d = dt.date.fromisoformat(day)
nxt = (d + dt.timedelta(days=1)).isoformat()
raw = os.path.join(data, "raw")
files = sorted(glob.glob(os.path.join(raw, day, "*.ndjson.gz")) + glob.glob(os.path.join(raw, day, "*.ndjson")))
files += sorted(glob.glob(os.path.join(raw, nxt, "*.ndjson.gz")) + glob.glob(os.path.join(raw, nxt, "*.ndjson")))[:1]
out_dir = os.path.join(data, "tracks", day)
os.makedirs(out_dir, exist_ok=True)
tmp = os.path.join(data, "tmp")
os.makedirs(tmp, exist_ok=True)

con = duckdb.connect()
con.execute(f"SET memory_limit='128MB'; SET threads=1; SET temp_directory='{tmp}'; SET preserve_insertion_order=false")
shards = [[] for _ in range(N)]
through = None
if files:
    src = "[" + ",".join(f"'{f}'" for f in files) + "]"
    cols = "{'mmsi':'INTEGER','base_date_time':'TIMESTAMP','longitude':'DOUBLE','latitude':'DOUBLE','vessel_type':'INTEGER'}"
    con.execute(f"""
      CREATE TEMP TABLE p AS
      SELECT DISTINCT ON (mmsi, base_date_time) mmsi, base_date_time AS t, longitude AS lon, latitude AS lat, vessel_type
        FROM read_ndjson({src}, columns={cols}, compression='auto_detect', ignore_errors=true)
       WHERE base_date_time >= '{day} 00:00:00' AND base_date_time < '{nxt} 00:00:00' AND mmsi IS NOT NULL""")
    through = con.execute("SELECT max(t) FROM p").fetchone()[0]
    con.execute(f"""
      CREATE TEMP TABLE s AS
      WITH q AS (
        SELECT *, lag(t) OVER w AS pt, lag(lat) OVER w AS plat, lag(lon) OVER w AS plon
          FROM p WINDOW w AS (PARTITION BY mmsi ORDER BY t)
      ), b AS (
        SELECT *, epoch(t) - epoch(pt) AS dts,
               -- nautical miles between consecutive positions (equirectangular; fine at these distances)
               sqrt(power((lat - plat) * 60, 2) + power((lon - plon) * 60 * cos(radians((lat + plat) / 2)), 2)) AS nm
          FROM q
      )
      SELECT *, sum(CASE WHEN pt IS NULL THEN 1 WHEN dts > {GAP_MIN * 60} THEN 1
                         WHEN nm / (greatest(dts, {MIN_DT_S}) / 3600.0) > {MAX_KNOTS} THEN 1 ELSE 0 END)
                OVER (PARTITION BY mmsi ORDER BY t ROWS UNBOUNDED PRECEDING) AS sid
        FROM b""")
    rows = con.execute(f"""
      SELECT mmsi, {KIND_SQL} AS kind, v, t0, t1, n, c, ts FROM (
        SELECT mmsi, mode(vessel_type) AS v, epoch(min(t))::BIGINT AS t0, epoch(max(t))::BIGINT AS t1, count(*) AS n,
               list([round(lon, 5), round(lat, 5)] ORDER BY t) AS c, list(epoch(t)::BIGINT ORDER BY t) AS ts,
               sqrt(power((max(lat) - min(lat)) * 111320, 2) + power((max(lon) - min(lon)) * 111320 * cos(radians(avg(lat))), 2)) AS span_m
          FROM s GROUP BY mmsi, sid HAVING count(*) >= 2
      ) WHERE span_m >= {PARKED_M} ORDER BY mmsi, t0""")
    while True:
        batch = rows.fetchmany(5000)
        if not batch:
            break
        for mmsi, kind, v, t0, t1, n, c, ts in batch:
            shards[mmsi % N].append(json.dumps({"mmsi": mmsi, "kind": kind, "vtype": v, "t0": t0, "t1": t1, "n": n, "c": c, "ts": ts}, separators=(",", ":")))

blobs = [gzip.compress(("\n".join(sh) + "\n").encode() if sh else b"", 6) if sh else b"" for sh in shards]
offsets, o = [], 0
for b in blobs:
    offsets.append(o); o += len(b)
offsets.append(o)
pack = os.path.join(out_dir, name)
with open(pack + ".tmp", "wb") as fh:
    fh.write(b"SHTP" + struct.pack("<I", N) + struct.pack(f"<{N + 1}I", *offsets))
    for b in blobs:
        fh.write(b)
os.replace(pack + ".tmp", pack)
tracks = sum(len(sh) for sh in shards)

minutes = 0
for f in glob.glob(os.path.join(raw, day, "*.coverage.json")):
    minutes += sum(1 for x in json.load(open(f)).get("minutesMsgs", []) if x)
idx_path = os.path.join(data, "tracks", "index.json")
try:
    idx = json.load(open(idx_path))
except Exception:
    idx = {}
idx.update(version=VERSION, bbox=[-126.2, 47.0, -122.05, 49.6], source="aisstream.io live AIS, recorded by EarthAtlas (scripts/ships/aisstream)",
           rules=dict(gap_min=GAP_MIN, max_knots=MAX_KNOTS, min_dt_s=MIN_DT_S, parked_m=PARKED_M, land_mask=False, simplified=False, ts="epoch s per vertex"))
idx.setdefault("days", {})[day] = dict(
    pack=None, file=name, pack_bytes=os.path.getsize(pack), n=N,
    built=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), final=final, tracks=tracks,
    through=through.isoformat() + "Z" if through else None, minutesRecorded=min(minutes, 1440))
idx["days"] = dict(sorted(idx["days"].items()))
json.dump(idx, open(idx_path + ".tmp", "w"), indent=1)
os.replace(idx_path + ".tmp", idx_path)
print(json.dumps({"day": day, **idx["days"][day]}))
