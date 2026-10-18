#!/usr/bin/env python3
"""
Step 1 of the ais-v1 bake: the aisstream recorder's daily Parquet files for one month → cache/points/ais-v1/YYYY-MM-DD.parquet.

The recorder (scripts/ships/aisstream, Fly.io) writes each finished UTC day in the NOAA MarineCadastre daily-points
schema and uploads it to Blob (ships/bake-inputs/salish-v6/aisstream/points/YYYY-MM-DD.parquet, listed with its
coverage in .../aisstream/index.json). This copies the month's days as they are, so build_tracks.py (SHIPS_REGION=ais-v1)
reads them exactly like NOAA's cached days. Days already cached with the same size are skipped.

Run:  SHIPS_REGION=ais-v1 python3 fetch_aisstream_points.py 2026-10      (prints the days fetched; exit 3 = no days)
"""
import json, os, sys, urllib.request
import region

BASE = os.environ.get("AIS_POINTS_BASE", "https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/bake-inputs/salish-v6/aisstream")
ym = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
if region.NAME != "ais-v1":
    sys.exit(f"SHIPS_REGION must be ais-v1 (is {region.NAME})")
out = region.R["points"]
os.makedirs(out, exist_ok=True)
idx = json.load(urllib.request.urlopen(f"{BASE}/index.json?t={os.getpid()}", timeout=60))
days = sorted(d for d in idx.get("days", {}) if d.startswith(ym + "-"))
if not days:
    print(f"no recorded days in {ym}", file=sys.stderr); sys.exit(3)
for d in days:
    dst = os.path.join(out, f"{d}.parquet")
    want = idx["days"][d].get("bytes")
    if os.path.exists(dst) and want and os.path.getsize(dst) == want:
        continue
    with urllib.request.urlopen(f"{BASE}/points/{d}.parquet?b={idx['days'][d].get('built', '')}", timeout=300) as r, open(dst + ".tmp", "wb") as fh:
        fh.write(r.read())
    if want and os.path.getsize(dst + ".tmp") != want:
        sys.exit(f"{d}: got {os.path.getsize(dst + '.tmp')} bytes, index says {want}")
    os.replace(dst + ".tmp", dst)
    print(f"{d}: {idx['days'][d].get('rows')} rows, {idx['days'][d].get('minutesRecorded')} of 1440 minutes recorded")
print(json.dumps({"month": ym, "days": days}))
