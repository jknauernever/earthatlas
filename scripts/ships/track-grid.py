#!/usr/bin/env python3
"""
Where we have ship tracks: distinct ships per 1-degree square, for the map in
the /ships general report (src/ships/GeneralReport.jsx, "Where we have ship tracks").

DERIVED data (src/ships/CLAUDE.md): computed only from the published per-ship
track packs (ships/tracks/<tileset>/<YYYY-MM>/tracks.pack, the 'SHTP' layout of
scripts/ships/bake-ais/build_tracks.py), so it can always be rebuilt from them.

Per source (tileset):
  us-v2   NOAA / BOEM MarineCadastre AIS, minute by minute, US waters
  gfw-v1  Global Fishing Watch, hourly, 16 areas outside US waters
  ais-v1  recorded live (aisstream.io, Open Waters AIS, Washington State Ferries), Salish Sea
(salish-v6 is left out: the same NOAA data as us-v2, cut finer for the Salish Sea.)

Rules
  1. A track's line is walked vertex to vertex; a segment longer than STEP_DEG
     is sampled every STEP_DEG, so a ship crossing a square without a vertex in
     it still counts there. Square = floor(lon), floor(lat).
  2. A ship = an MMSI. A square's count = distinct MMSIs whose drawn tracks touch it.
  3. Per month:  ships/track-grid/<tileset>/<YYYY-MM>.parquet  (cell, mmsi) pairs.
     Per source: ships/track-grid/<tileset>/all.parquet = the union of its months.
     A rebuilt month is folded into the union (a union only grows, as months
     only gain tracks); `--rebuild` recomputes a union from its month files.
  4. ships/track-grid/grid.json: per square, distinct ships per source and in
     all sources together (an MMSI seen by two sources counts once), plus each
     source's months and the `built` time of every month counted, so the next
     run only reads months whose tracks were rebuilt.
  Cell id = (floor(lat) + 90) * 360 + (floor(lon) + 180); its south-west corner
  is lon = id % 360 - 180, lat = id // 360 - 90.

Run (GitHub Actions: .github/workflows/ships-track-grid.yml):
  python3 scripts/ships/track-grid.py OUT_DIR [--tilesets us-v2,gfw-v1,ais-v1] [--months 2026-10 ...]
        [--limit N] [--shards K] [--rebuild] [--workers 4] [--upload]
  --limit N   at most N months per source (newest first), for a small test
  --shards K  read only the first K of a pack's 1024 shards (a test of the code path; counts are partial)
  --upload    upload with one-file tokens (scripts/ships/track-grid-put.mjs, CRON_SECRET); without it
              nothing leaves OUT_DIR, and grid.json is also copied to public/dev-data/ships/track-grid.json
Deps: pip install duckdb numpy
"""
import argparse, gzip, json, math, os, shutil, struct, subprocess, sys, time, urllib.request
from concurrent.futures import ProcessPoolExecutor
import numpy as np
import duckdb

BLOB = "https://fxj3imydg9misw9w.public.blob.vercel-storage.com/"
GRID = "ships/track-grid"
SOURCES = {  # tileset → the report's series key
    "us-v2": "minute",
    "gfw-v1": "hourly",
    "ais-v1": "live",
}
STEP_DEG = 0.25
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))


def get_json(url):
    try:
        with urllib.request.urlopen(f"{url}?t={int(time.time())}", timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404: return None
        raise


def download(url, path):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=600) as r, open(path, "wb") as f:
                shutil.copyfileobj(r, f, 8 << 20)
            return
        except urllib.error.HTTPError as e:
            if e.code == 404: raise
            err = e
        except Exception as e:  # noqa: BLE001 — network: retry
            err = e
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"download {url}: {err}")


def cells_of(c):
    """Cell ids a line touches (rule 1)."""
    a = np.asarray(c, dtype=np.float64)
    if a.ndim != 2 or len(a) == 0: return np.empty(0, np.int64)
    pts = [a]
    if len(a) > 1:
        d = np.abs(np.diff(a, axis=0)).max(axis=1)
        for i in np.nonzero(d > STEP_DEG)[0]:
            k = int(math.ceil(d[i] / STEP_DEG))
            t = np.arange(1, k)[:, None] / k
            pts.append(a[i] + (a[i + 1] - a[i]) * t)
    p = np.concatenate(pts)
    lon = np.clip(np.floor(p[:, 0]), -180, 179).astype(np.int64)
    lat = np.clip(np.floor(p[:, 1]), -90, 89).astype(np.int64)
    return np.unique((lat + 90) * 360 + (lon + 180))


def month_pairs(job):
    """One month's pack → sorted unique (cell << 32 | mmsi) as a .npy, plus stats."""
    tileset, ym, pack_url, work, max_shards = job
    pack = os.path.join(work, f"{tileset}-{ym}.pack")
    t0 = time.time()
    if max_shards:  # a test: fetch only the header and the first shards (HTTP range), not the whole pack
        def rng(a, b):
            req = urllib.request.Request(pack_url, headers={"Range": f"bytes={a}-{b}"})
            with urllib.request.urlopen(req, timeout=300) as r: return r.read()
        n = struct.unpack("<I", rng(4, 7))[0]
        offs = struct.unpack(f"<{n + 1}I", rng(8, 8 + 4 * (n + 1) - 1))
        k = min(n, max_shards)
        with open(pack, "wb") as f:
            f.write(struct.pack("<4sI", b"SHTP", k) + struct.pack(f"<{k + 1}I", *offs[: k + 1]))
            if offs[k] > offs[0]: f.write(rng(8 + 4 * (n + 1) + offs[0], 8 + 4 * (n + 1) + offs[k] - 1))
    else:
        download(pack_url, pack)
    keys, tracks, skipped = [], 0, 0
    with open(pack, "rb") as f:
        head = f.read(8)
        assert head[:4] == b"SHTP", f"{pack_url}: not an SHTP pack"
        n = struct.unpack("<I", head[4:8])[0]
        offs = struct.unpack(f"<{n + 1}I", f.read(4 * (n + 1)))
        base = 8 + 4 * (n + 1)
        for i in range(min(n, max_shards or n)):
            if offs[i + 1] <= offs[i]: continue
            f.seek(base + offs[i])
            for line in gzip.decompress(f.read(offs[i + 1] - offs[i])).splitlines():
                if not line: continue
                t = json.loads(line)
                m = t.get("mmsi")
                if not isinstance(m, int) or not (0 < m < 2 ** 31) or not t.get("c"):
                    skipped += 1; continue
                tracks += 1
                keys.append((cells_of(t["c"]) << 32) | m)
    os.remove(pack)
    u = np.unique(np.concatenate(keys)) if keys else np.empty(0, np.int64)
    out = os.path.join(work, tileset, f"{ym}.npy")
    np.save(out, u)
    return dict(tileset=tileset, month=ym, npy=out, pairs=int(len(u)), tracks=tracks, skipped=skipped,
                secs=round(time.time() - t0, 1))


def put(pathname, file, content_type, upload):
    if not upload: return
    subprocess.run(["node", os.path.join(HERE, "track-grid-put.mjs"), pathname, file, content_type], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--tilesets", default=",".join(SOURCES))
    ap.add_argument("--months", nargs="*", default=None)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--shards", type=int, default=0)
    ap.add_argument("--rebuild", action="store_true")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--upload", action="store_true")
    a = ap.parse_args()
    if a.shards and a.upload: sys.exit("--shards counts are partial: never with --upload")
    out = os.path.abspath(a.out)
    tilesets = [t for t in a.tilesets.split(",") if t]
    for t in tilesets:
        if t not in SOURCES: sys.exit(f"unknown tileset {t}")
        os.makedirs(os.path.join(out, t), exist_ok=True)

    prev = (get_json(BLOB + GRID + "/grid.json") if a.upload else None) or {}
    if not a.upload and os.path.exists(os.path.join(out, "grid.json")):
        prev = json.load(open(os.path.join(out, "grid.json")))
    counted = {t: dict((prev.get("sources", {}).get(SOURCES[t]) or {}).get("built") or {}) for t in SOURCES}

    jobs, indexes = [], {}
    for t in tilesets:
        idx = get_json(f"{BLOB}ships/tracks/{t}/index.json") or {"months": {}}
        indexes[t] = idx["months"]
        months = sorted(idx["months"], reverse=True)
        if a.months: months = [m for m in months if m in a.months]
        else: months = [m for m in months if counted[t].get(m) != idx["months"][m].get("built")]
        if a.limit: months = months[: a.limit]
        for m in months:
            jobs.append((t, m, idx["months"][m]["pack"], out, a.shards))
    print(f"{len(jobs)} month(s) to count: " + ", ".join(f"{t} {m}" for t, m, *_ in jobs), flush=True)

    done = []
    if jobs:
        with ProcessPoolExecutor(max_workers=a.workers) as ex:
            for r in ex.map(month_pairs, jobs):
                print(f"  {r['tileset']} {r['month']}: {r['tracks']:,} tracks → {r['pairs']:,} square-ship pairs "
                      f"({r['skipped']} without an MMSI) in {r['secs']} s", flush=True)
                done.append(r)

    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")
    for r in done:
        p = os.path.join(out, r["tileset"], f"{r['month']}.parquet")
        arr = np.load(r["npy"])
        con.register("k", {"k": arr})
        con.execute(f"COPY (SELECT (k >> 32)::INTEGER AS cell, (k & 4294967295)::INTEGER AS mmsi FROM k ORDER BY 1, 2) "
                    f"TO '{p}' (FORMAT parquet, COMPRESSION zstd)")
        con.unregister("k"); os.remove(r["npy"])
        put(f"{GRID}/{r['tileset']}/{r['month']}.parquet", p, "application/vnd.apache.parquet", a.upload)
        counted[r["tileset"]][r["month"]] = indexes[r["tileset"]][r["month"]].get("built")

    # Rule 3: per-source unions.
    unions = {}
    for t in SOURCES:
        u = os.path.join(out, t, "all.parquet")
        mine = [os.path.join(out, t, f"{r['month']}.parquet") for r in done if r["tileset"] == t]
        if a.rebuild and t in tilesets:
            files = [os.path.join(out, t, f"{m}.parquet") for m in sorted(counted[t])]
            for m, f in zip(sorted(counted[t]), files):
                if not os.path.exists(f): download(f"{BLOB}{GRID}/{t}/{m}.parquet", f)
        else:
            files = list(mine)
            if not os.path.exists(u):
                try: download(f"{BLOB}{GRID}/{t}/all.parquet?t={int(time.time())}", u)
                except urllib.error.HTTPError: pass
            if os.path.exists(u): files.append(u)
        if not files: continue
        if mine or (a.rebuild and t in tilesets):
            tmp = u + ".new"
            lst = ", ".join(f"'{f}'" for f in files)
            con.execute(f"COPY (SELECT DISTINCT cell, mmsi FROM read_parquet([{lst}]) ORDER BY 1, 2) TO '{tmp}' (FORMAT parquet, COMPRESSION zstd)")
            os.replace(tmp, u)
            put(f"{GRID}/{t}/all.parquet", u, "application/vnd.apache.parquet", a.upload)
        unions[t] = u

    if not unions: print("nothing counted yet"); return
    # Rule 4: grid.json.
    sel = " UNION ALL ".join(f"SELECT cell, mmsi, '{SOURCES[t]}' AS s FROM read_parquet('{u}')" for t, u in unions.items())
    cols = ", ".join(f"count(DISTINCT mmsi) FILTER (WHERE s = '{s}')" for s in SOURCES.values())
    rows = con.execute(f"SELECT cell, count(DISTINCT mmsi), {cols} FROM ({sel}) GROUP BY cell ORDER BY cell").fetchall()
    totals = con.execute(f"SELECT s, count(DISTINCT mmsi) FROM ({sel}) GROUP BY s").fetchall()
    allships = con.execute(f"SELECT count(DISTINCT mmsi) FROM ({sel})").fetchone()[0]
    tot = dict(totals)
    grid = {
        "about": "Distinct ships (MMSIs) whose tracks touch each 1-degree square, all months; scripts/ships/track-grid.py",
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cell": 1,
        "partial": bool(a.shards) or None,
        "columns": ["cell", "all", *SOURCES.values()],
        "ships": allships,
        "sources": {
            SOURCES[t]: {
                "tileset": t,
                "months": len(counted[t]),
                "from": min(counted[t]) if counted[t] else None,
                "through": max(counted[t]) if counted[t] else None,
                "ships": tot.get(SOURCES[t], 0),
                "built": dict(sorted(counted[t].items())),
            } for t in SOURCES if counted[t]
        },
        "cells": [list(r) for r in rows],
    }
    if grid["partial"] is None: del grid["partial"]
    gp = os.path.join(out, "grid.json")
    json.dump(grid, open(gp, "w"), separators=(",", ":"))
    print(f"grid.json: {len(rows):,} squares, {allships:,} ships, {os.path.getsize(gp) / 1e3:.0f} kB", flush=True)
    if a.upload:
        put(f"{GRID}/grid.json", gp, "application/json", True)
    else:
        dev = os.path.join(ROOT, "public", "dev-data", "ships", "track-grid.json")
        os.makedirs(os.path.dirname(dev), exist_ok=True); shutil.copy(gp, dev)
        print(f"  copied to {dev}")


if __name__ == "__main__":
    main()
