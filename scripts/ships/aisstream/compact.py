#!/usr/bin/env python3
"""
One recorded UTC day of aisstream rows → DATA_DIR/points/YYYY-MM-DD.parquet, in exactly the column order and types of
NOAA MarineCadastre's daily points as cached by scripts/ships/bake-ais/fetch_points.py, plus a last `source` column,
(scripts/ships/bake-ais/cache/points/salish-v6/YYYY-MM-DD.parquet), so build_tracks.py reads either unchanged.

Reads raw/DAY/*.ndjson.gz plus the NEXT day's first file (rows are filed by receive time, so a row stamped 23:59:59
can land there), keeps rows whose base_date_time falls on DAY, drops duplicate (mmsi, base_date_time), sorts by
(mmsi, base_date_time) like fetch_points.py, and writes zstd Parquet. Then records the day's coverage
(minutes in which messages arrived, from the HH.coverage.json files) in points/index.json.

Run:  python3 compact.py DATA_DIR YYYY-MM-DD
Deps: pip install duckdb
"""
import datetime as dt, glob, json, os, sys
import duckdb

data, day = sys.argv[1], sys.argv[2]
d = dt.date.fromisoformat(day)
nxt = (d + dt.timedelta(days=1)).isoformat()
raw = os.path.join(data, "raw")
files = sorted(glob.glob(os.path.join(raw, day, "*.ndjson.gz")))
nfiles = sorted(glob.glob(os.path.join(raw, nxt, "*.ndjson.gz")))[:1]
out = os.path.join(data, "points", f"{day}.parquet")
os.makedirs(os.path.dirname(out), exist_ok=True)

COLS = {  # NOAA order and types (DESCRIBE of a salish-v6 cache file)
    "mmsi": "INTEGER", "base_date_time": "TIMESTAMP", "longitude": "DOUBLE", "latitude": "DOUBLE",
    "sog": "FLOAT", "cog": "FLOAT", "heading": "INTEGER", "vessel_name": "VARCHAR", "imo": "VARCHAR",
    "call_sign": "VARCHAR", "vessel_type": "INTEGER", "status": "INTEGER", "length": "FLOAT", "width": "FLOAT",
    "draft": "FLOAT", "cargo": "INTEGER", "transceiver": "VARCHAR",
    "source": "VARCHAR",   # EarthAtlas addition after NOAA's columns: which live source recorded the row (aisstream | wsf)
}
con = duckdb.connect()
tmp = os.path.join(data, "tmp"); os.makedirs(tmp, exist_ok=True)
# temp_directory: the sort / dedupe spill to disk instead of failing as a full day grows (2026-10-18).
con.execute(f"SET memory_limit='96MB'; SET threads=1; SET preserve_insertion_order=false; SET temp_directory='{tmp}'")
if files + nfiles:
    src = "[" + ",".join(f"'{f}'" for f in files + nfiles) + "]"
    cols = "{" + ",".join(f"'{k}':'{v}'" for k, v in COLS.items()) + "}"
    # Rows recorded before the multi-source recorder (2026-10-18) carry no source: they are all aisstream.
    sel = ", ".join("coalesce(source, 'aisstream')::VARCHAR AS source" if k == "source" else f"{k}::{v} AS {k}" for k, v in COLS.items())
    con.execute(f"""
      COPY (
        SELECT {sel} FROM (
          SELECT *, row_number() OVER (PARTITION BY mmsi, base_date_time ORDER BY base_date_time) AS rn
          FROM read_ndjson({src}, columns={cols}, compression='gzip')
          WHERE base_date_time >= '{day} 00:00:00' AND base_date_time < '{nxt} 00:00:00'
        ) WHERE rn = 1
        ORDER BY mmsi, base_date_time
      ) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)""")
else:
    con.execute(f"COPY (SELECT " + ", ".join(f"NULL::{v} AS {k}" for k, v in COLS.items()) + f" WHERE false) TO '{out}.tmp' (FORMAT parquet, COMPRESSION zstd)")
os.replace(out + ".tmp", out)
rows, vessels = con.execute(f"SELECT count(*), count(DISTINCT mmsi) FROM '{out}'").fetchone()

# Coverage: a minute counts as recorded when at least one message arrived in it.
minutes = reconnects = msgs = 0
for f in glob.glob(os.path.join(raw, day, "*.coverage.json")):
    c = json.load(open(f))
    minutes += sum(1 for n in c.get("minutesMsgs", []) if n)
    reconnects += c.get("reconnects", 0)
    msgs += c.get("msgs", 0)
idx_path = os.path.join(data, "points", "index.json")
try:
    idx = json.load(open(idx_path))
except Exception:
    idx = {}
idx.setdefault("version", "aisstream-points-v1")
idx["source"] = "aisstream.io live AIS, recorded by EarthAtlas (scripts/ships/aisstream/recorder.mjs)"
idx["schema"] = "NOAA MarineCadastre daily points (scripts/ships/bake-ais/fetch_points.py) plus a last source column (aisstream | wsf); identity fields as broadcast, not USCG-corrected; cargo always null"
idx["box"] = {"w": -126.2, "s": 47.0, "e": -122.05, "n": 49.6}
idx.setdefault("days", {})[day] = {
    "rows": rows, "vessels": vessels, "minutesRecorded": min(minutes, 1440), "minutesInDay": 1440,
    "messages": msgs, "reconnects": reconnects, "bytes": os.path.getsize(out),
    "built": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
}
idx["days"] = dict(sorted(idx["days"].items()))
json.dump(idx, open(idx_path + ".tmp", "w"), indent=1)
os.replace(idx_path + ".tmp", idx_path)
print(json.dumps({"day": day, **idx["days"][day]}))
