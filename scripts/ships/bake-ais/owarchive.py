#!/usr/bin/env python3
"""
Open Waters AIS archive backfill (Josh 2026-11-11; lib/ships/recordedStops.js; docs/OPENWATERS_AIS.md "Archive").
The live recorder starts 2026-10-18; Open Waters keeps a track archive from 2026-08-20 ~18:00 UTC. This fills the stop counts
for the days between, one ship at a time (the archive has no area query), into NOAA-layout day files that the recorded stop
bakes read like the recorder's own days (terminal_calls.py / anchorage_stays.py with STOPS_INPUT=recorded).

  fetch  [--mmsis a,b] [--limit N] [--shard i/n]   page each ship's track (/v1/vessels/{mmsi}/track, interval=60, 1,000 positions a request,
                                     paging back by `to`), keep positions inside the box → cache/owarchive/ships/<mmsi>.json.gz.
                                     Ships from cache/owarchive/mmsis.json (scripts/ships/aisstream/owarchive-mmsis.mjs) unless
                                     --mmsis. Resumable: finished ships are skipped. ~100 requests/min (their limit: 120).
  build                              every fetched ship → cache/owarchive/points/YYYY-MM-DD.parquet (NOAA schema + source
                                     'openwaters/archive') for the WHOLE days inside the archive window, + cache/owarchive/index.json.
Then scripts/ships/aisstream/owarchive-upload.mjs puts them on Blob, where fetch_owarchive_points.py reads them in CI.

Archive limits (tested 2026-11-11): at most one position a minute; a ship sitting still keeps one position every 30 minutes;
positions implying impossible speeds are dropped by Open Waters; no per-position source (credited as Open Waters AIS, ODbL).
Needs OPENWATERS_AIS_TOKEN (.env.local). Never prints the token.
"""
import gzip, json, os, sys, time, urllib.error, urllib.parse, urllib.request, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, "cache", "owarchive")
SHIPS = os.path.join(WORK, "ships")
POINTS = os.path.join(WORK, "points")
BOX = dict(w=-126.2, s=47.0, e=-122.05, n=49.6)          # salish-v6 / the recorder's box
FROM = os.environ.get("OW_FROM", "2026-08-20T00:00:00Z")   # archive start (2026-08-20 ~18:00 UTC)
TO = os.environ.get("OW_TO", "2026-10-18T00:00:00Z")       # the live recorder takes over
FIRST_DAY, LAST_DAY = "2026-08-21", "2026-10-17"           # whole days only: Aug 20 starts mid-day
URL = "https://ais.openwaters.io/v1/vessels/{}/track?{}"
PACE = float(os.environ.get("OW_PACE", "0.6"))   # seconds between request starts per worker (2 workers at 1.1 s ≈ 109/min < their 120)
_last = [0.0]
MAX_PAGES = 200


def env_token():
    tok = os.environ.get("OPENWATERS_AIS_TOKEN")
    if not tok:
        p = os.path.join(HERE, "..", "..", "..", ".env.local")
        for line in open(p):
            if line.startswith("OPENWATERS_AIS_TOKEN="):
                tok = line.split("=", 1)[1].strip().strip('"')
    if not tok:
        sys.exit("no OPENWATERS_AIS_TOKEN")
    return tok


def get(tok, mmsi, frm, to):
    q = urllib.parse.urlencode({"from": frm, "to": to, "interval": 60, "limit": 1000})
    for attempt in range(6):
        wait = _last[0] + PACE - time.time()
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            r = urllib.request.Request(URL.format(mmsi, q), headers={"Authorization": f"Bearer {tok}", "User-Agent": "EarthAtlas owarchive"})
            return json.load(urllib.request.urlopen(r, timeout=90))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(120, 5 * 2 ** attempt)); continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(min(120, 5 * 2 ** attempt))
    raise RuntimeError(f"{mmsi}: no answer after retries")


def fetch_one(tok, mmsi):
    pts, calls, to = [], 0, TO
    while calls < MAX_PAGES:
        d = get(tok, mmsi, FROM, to); calls += 1
        if d is None:
            break
        p = d.get("properties") or {}
        g = d.get("geometry") or {}
        cs = g.get("coordinates") or []
        if g.get("type") == "Point":
            cs = [cs]
        times = p.get("times") or []
        for i, t in enumerate(times):
            lon, lat = cs[i][0], cs[i][1]
            if BOX["s"] <= lat <= BOX["n"] and BOX["w"] <= lon <= BOX["e"]:
                pts.append([t, round(lon, 6), round(lat, 6), (p.get("sog") or [None] * len(times))[i], (p.get("cog") or [None] * len(times))[i],
                            (p.get("heading") or [None] * len(times))[i], (p.get("nav_status") or [None] * len(times))[i]])
        if not p.get("truncated") or not times:
            break
        to = times[0]
    return {"mmsi": int(mmsi), "name": (d or {}).get("properties", {}).get("name") if d else None, "from": FROM, "to": TO,
            "calls": calls, "fetched_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "points": pts}


def cmd_fetch(args):
    tok = env_token()
    os.makedirs(SHIPS, exist_ok=True)
    if "--mmsis" in args:
        mm = args[args.index("--mmsis") + 1].split(",")
    else:
        mm = [s["mmsi"] for s in json.load(open(os.path.join(WORK, "mmsis.json")))["ships"]]
    if "--limit" in args:
        mm = mm[: int(args[args.index("--limit") + 1])]
    shard = ""
    if "--shard" in args:   # --shard i/n: every n-th ship from i (parallel workers, each paced by OW_PACE)
        i, n = map(int, args[args.index("--shard") + 1].split("/"))
        mm = mm[i::n]; shard = f"-{i}of{n}"
    log = open(os.path.join(WORK, f"fetch{shard}.log"), "a")
    total = 0
    for i, m in enumerate(mm, 1):
        out = os.path.join(SHIPS, f"{m}.json.gz")
        if os.path.exists(out):
            continue
        r = fetch_one(tok, m)
        total += r["calls"]
        with gzip.open(out + ".tmp", "wt") as f:
            json.dump(r, f)
        os.replace(out + ".tmp", out)
        line = f"{dt.datetime.now(dt.timezone.utc):%H:%M:%S} [{i}/{len(mm)}] {m}: {len(r['points'])} positions in the box, {r['calls']} requests"
        print(line, flush=True); log.write(line + "\n"); log.flush()
    print(f"done: {total} requests this run")


def cmd_build(args):
    import duckdb
    ident = {}
    p = os.path.join(WORK, "mmsis.json")
    if os.path.exists(p):
        ident = {int(s["mmsi"]): s for s in json.load(open(p))["ships"]}
    rows = []
    files = sorted(f for f in os.listdir(SHIPS) if f.endswith(".json.gz") and not f.startswith("._"))
    for f in files:
        r = json.load(gzip.open(os.path.join(SHIPS, f), "rt"))
        m = r["mmsi"]; idn = ident.get(m, {})
        name = r.get("name") or idn.get("name")
        for t, lon, lat, sog, cog, hd, st in r["points"]:
            rows.append((m, t, lon, lat, sog, cog, hd if hd is not None and 0 <= hd <= 359 else None, name, idn.get("imo"),
                         idn.get("type"), st, idn.get("length")))
    con = duckdb.connect()
    con.execute("SET memory_limit='2GB'")
    con.execute("CREATE TABLE r (mmsi INTEGER, t VARCHAR, lon DOUBLE, lat DOUBLE, sog FLOAT, cog FLOAT, heading INTEGER, name VARCHAR, imo VARCHAR, vtype INTEGER, status INTEGER, len FLOAT)")
    for i in range(0, len(rows), 200_000):
        con.executemany("INSERT INTO r VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows[i:i + 200_000])
    # Same columns, order and types as the recorder's day files (scripts/ships/aisstream/compact.py COLS).
    con.execute("""CREATE TABLE pts AS SELECT DISTINCT ON (mmsi, base_date_time) mmsi, base_date_time, lon::DOUBLE AS longitude, lat::DOUBLE AS latitude,
                     sog::FLOAT AS sog, cog::FLOAT AS cog, heading::INTEGER AS heading, name::VARCHAR AS vessel_name, imo::VARCHAR AS imo,
                     NULL::VARCHAR AS call_sign, vtype::INTEGER AS vessel_type, status::INTEGER AS status, len::FLOAT AS length, NULL::FLOAT AS width,
                     NULL::FLOAT AS draft, NULL::INTEGER AS cargo, NULL::VARCHAR AS transceiver, 'openwaters/archive'::VARCHAR AS source
                   FROM (SELECT *, strptime(t, '%Y-%m-%dT%H:%M:%SZ') AS base_date_time FROM r)""")
    os.makedirs(POINTS, exist_ok=True)
    idx = {"schema": "NOAA MarineCadastre daily points layout (as scripts/ships/aisstream/compact.py), source 'openwaters/archive'; "
                     "identity fields as last broadcast in our own stop counts (AIS reported), not USCG-corrected",
           "source": "Open Waters AIS track archive (https://openwaters.io/ais/, ODbL 1.0)", "ships_asked": len(files),
           "built_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "days": {}}
    d = dt.date.fromisoformat(FIRST_DAY)
    while d <= dt.date.fromisoformat(LAST_DAY):
        out = os.path.join(POINTS, f"{d}.parquet")
        con.execute(f"COPY (SELECT * FROM pts WHERE base_date_time >= '{d}' AND base_date_time < '{d + dt.timedelta(days=1)}' ORDER BY mmsi, base_date_time) "
                    f"TO '{out}' (FORMAT parquet, COMPRESSION zstd)")
        n, v = con.execute(f"SELECT count(*), count(DISTINCT mmsi) FROM '{out}'").fetchone()
        idx["days"][str(d)] = {"rows": n, "vessels": v, "bytes": os.path.getsize(out), "built": idx["built_at"]}
        d += dt.timedelta(days=1)
    json.dump(idx, open(os.path.join(WORK, "index.json"), "w"), indent=1)   # same layout as Blob: index.json next to points/
    print(f"{len(files)} ships, {len(rows):,} positions → {len(idx['days'])} day files in {POINTS}")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] not in ("fetch", "build"):
        sys.exit(__doc__)
    (cmd_fetch if a[0] == "fetch" else cmd_build)(a[1:])
