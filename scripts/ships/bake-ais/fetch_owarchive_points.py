#!/usr/bin/env python3
"""
The Open Waters archive days (owarchive.py + scripts/ships/aisstream/owarchive-upload.mjs, Blob
ships/bake-inputs/salish-v6/owarchive/) for one month → cache/points/ais-v1/YYYY-MM-DD.parquet, next to the recorder's days, for
the recorded stop bakes ONLY (run after build_tracks.py: the map's recorded tracks stay the recorder's own). A day the recorder
already has is never overwritten. Exit 3 = no archive days in that month.
Run:  python3 fetch_owarchive_points.py 2026-09
"""
import json, os, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("OW_POINTS_BASE", "https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/bake-inputs/salish-v6/owarchive")
OUT = os.path.join(HERE, "cache", "points", "ais-v1")
ym = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
os.makedirs(OUT, exist_ok=True)
try:
    idx = json.load(urllib.request.urlopen(f"{BASE}/index.json?t={os.getpid()}", timeout=60))
except urllib.error.HTTPError as e:
    if e.code == 404:
        print("no archive index", file=sys.stderr); sys.exit(3)
    raise
days = sorted(d for d in idx.get("days", {}) if d.startswith(ym + "-"))
if not days:
    print(f"no archive days in {ym}", file=sys.stderr); sys.exit(3)
got = []
for d in days:
    dst = os.path.join(OUT, f"{d}.parquet")
    if os.path.exists(dst):
        continue   # the recorder's own day (or already fetched)
    want = idx["days"][d].get("bytes")
    with urllib.request.urlopen(f"{BASE}/points/{d}.parquet?b={idx['days'][d].get('built', '')}", timeout=300) as r, open(dst + ".tmp", "wb") as fh:
        fh.write(r.read())
    if want and os.path.getsize(dst + ".tmp") != want:
        sys.exit(f"{d}: got {os.path.getsize(dst + '.tmp')} bytes, index says {want}")
    os.replace(dst + ".tmp", dst)
    got.append(d)
print(json.dumps({"month": ym, "archive_days": got}))
