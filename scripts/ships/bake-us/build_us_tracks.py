#!/usr/bin/env python3
"""
US-wide /ships tracks for one month, from NOAA MarineCadastre's MONTHLY track
file (CC0; docs/MARINECADASTRE_AIS.md). Runs in GitHub Actions
(.github/workflows/ships-us-tracks-bake.yml); publish.mjs uploads the result
to Vercel Blob. The input is streamed through and never kept.

Tracks are DERIVED data (src/ships/CLAUDE.md): reproducible from NOAA's file,
and every rule is written into manifest.json.

Rules (us-v1). NOAA's file already cuts a vessel's movement into tracks (at
every UTC midnight and after broadcast gaps), with NO time per vertex, so the
Salish bake's time-based rules (30-min gap, 60 kn jump) can't apply. Instead:
  1. Each MultiLineString part is a line. A line is split wherever two
     consecutive vertices are more than JUMP_KM apart: no real track moves
     that far between two broadcasts, so it's a bad fix, an MMSI shared by two
     transmitters, or an antimeridian wrap. Never drawn as a straight line.
  2. Lines under 2 vertices, and "parked" lines whose extent is under PARKED_M
     metres (a moored boat's GPS jitter), are counted, not drawn.
  3. Simplified to SIMPLIFY_DEG (~18 m) for tiles, PACK_SIMPLIFY_DEG (~5 m)
     for the per-ship pack.
  4. `kind` = NOAA/USCG vessel group of vessel_type (same mapping as the Salish
     bake); `vtype` keeps the raw code.
  NOT applied yet (unlike the Salish bake): the inland / over-land rules. They
  need a US-wide land grid; recorded in the manifest as not applied.

Outputs in OUT_DIR:
  tracks.pmtiles  tippecanoe -Z3 -z10, layer "tracks", props mmsi kind vtype t0 t1
  tracks.pack     every drawn line grouped by MMSI (same 'SHTP' layout as
                  scripts/ships/bake-ais/build_tracks.py), for the picked ship
  manifest.json   source, rules, stats, sizes

Run:  python3 build_us_tracks.py 2025-06 [OUT_DIR]
Deps: pip install pyarrow shapely numpy ; tippecanoe on PATH
"""
import gzip, json, os, struct, subprocess, sys, time, urllib.request
import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import shapely

SRC = "https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/aistrack/ais-track-{ym}.parquet"
RULES_VERSION = "us-v1"
JUMP_KM = 10
PARKED_M = 100
SIMPLIFY_DEG = 0.0002
PACK_SIMPLIFY_DEG = 0.00005
PACK_SHARDS = 1024
TIPPECANOE = ["-Z3", "-z10", "--simplification=10", "--drop-densest-as-needed"]
LIMIT = int(os.environ.get("SHIPS_US_LIMIT", "0"))  # rows, for a quick local test only


def kind_of(v):
    if v is None or v == 0: return "unknown"
    if v in (30, 1001, 1002): return "fishing"
    if v in (31, 32, 52, 1023, 1025): return "tug"
    if v in (36, 37, 1019): return "pleasure"
    if v in (40, 60, 1012, 1013, 1014, 1015) or 60 <= v <= 69: return "passenger"
    if 70 <= v <= 79 or v in (1003, 1004, 1016): return "cargo"
    if 80 <= v <= 89 or v in (1017, 1024): return "tanker"
    return "other"


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(np.minimum(a, 1)))


def download(ym, dest):
    url = SRC.format(ym=ym)
    req = urllib.request.Request(url, headers={"User-Agent": "earthatlas-bake/1.0 (+https://earthatlas.org)"})
    with urllib.request.urlopen(req, timeout=600) as r, open(dest + ".tmp", "wb") as fh:
        while True:
            b = r.read(8 << 20)
            if not b: break
            fh.write(b)
    os.replace(dest + ".tmp", dest)
    return url


def lines_from_batch(tbl, stats):
    """Yield (mmsi, vtype, t0, t1, coords ndarray) for every drawable line."""
    mmsi = tbl.column("mmsi").to_numpy(zero_copy_only=False)
    vt = tbl.column("vessel_type").to_pylist()
    t0 = tbl.column("start_time").cast("int64").to_numpy(zero_copy_only=False) // 10**9
    t1 = tbl.column("end_time").cast("int64").to_numpy(zero_copy_only=False) // 10**9
    geoms = shapely.from_wkb(tbl.column("geometry").to_numpy(zero_copy_only=False))
    parts, prow = shapely.get_parts(geoms, return_index=True)   # MultiLineString → LineStrings
    coords, cidx = shapely.get_coordinates(parts, return_index=True)
    stats["rows"] += len(geoms); stats["parts"] += len(parts)
    if not len(coords): return
    # break where the line changes or two vertices are > JUMP_KM apart
    same = cidx[1:] == cidx[:-1]
    far = haversine_km(coords[:-1, 0], coords[:-1, 1], coords[1:, 0], coords[1:, 1]) > JUMP_KM
    stats["jump_splits"] += int((same & far).sum())
    starts = np.concatenate([[0], np.nonzero(~same | far)[0] + 1])
    ends = np.concatenate([starts[1:], [len(coords)]])
    for s, e in zip(starts, ends):
        if e - s < 2:
            stats["single_vertex"] += 1; continue
        c = coords[s:e]
        lat = c[:, 1]
        span = np.hypot((lat.max() - lat.min()) * 111320,
                        (c[:, 0].max() - c[:, 0].min()) * 111320 * np.cos(np.radians(lat.mean())))
        if span < PARKED_M:
            stats["parked_not_drawn"] += 1; continue
        r = prow[cidx[s]]
        yield int(mmsi[r]), vt[r], int(t0[r]), int(t1[r]), c


def build(ym, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    t_start = time.time()
    src = os.path.join(out_dir, f"ais-track-{ym}.parquet")
    url = SRC.format(ym=ym)
    if not os.path.exists(src):
        download(ym, src)
    src_bytes = os.path.getsize(src)
    ndjson = os.path.join(out_dir, "tracks.ndjson")
    shard_dir = os.path.join(out_dir, "shards"); os.makedirs(shard_dir, exist_ok=True)
    shard_fh = {}
    stats = dict(rows=0, parts=0, jump_splits=0, single_vertex=0, parked_not_drawn=0, lines=0, vessels=0)
    vessels = set()
    pf = pq.ParquetFile(src)
    with open(ndjson, "w") as out:
        done = 0
        for batch in pf.iter_batches(batch_size=50_000, columns=["mmsi", "vessel_type", "start_time", "end_time", "geometry"]):
            if LIMIT and done >= LIMIT: break
            done += batch.num_rows
            tbl = pa.Table.from_batches([batch])
            recs = list(lines_from_batch(tbl, stats))
            if not recs: continue
            lines = [shapely.LineString(r[4]) for r in recs]
            simp = shapely.simplify(lines, SIMPLIFY_DEG)
            psimp = shapely.simplify(lines, PACK_SIMPLIFY_DEG)
            for (m, v, a, b, _), g, pg in zip(recs, simp, psimp):
                k = kind_of(v)
                gc = np.round(shapely.get_coordinates(g), 5).tolist()
                if len(gc) < 2: continue
                out.write(json.dumps({"type": "Feature", "geometry": {"type": "LineString", "coordinates": gc},
                                      "properties": {"mmsi": m, "kind": k, "vtype": v, "month": ym, "t0": a, "t1": b}},
                                     separators=(",", ":")) + "\n")
                pc = np.round(shapely.get_coordinates(pg), 5).tolist()
                sh = m % PACK_SHARDS
                fh = shard_fh.get(sh)
                if fh is None:
                    fh = shard_fh[sh] = open(os.path.join(shard_dir, f"{sh}.ndjson"), "a")
                fh.write(json.dumps({"mmsi": m, "kind": k, "vtype": v, "t0": a, "t1": b, "c": pc}, separators=(",", ":")) + "\n")
                stats["lines"] += 1; vessels.add(m)
            print(f"  {done:,} rows, {stats['lines']:,} lines, {time.time() - t_start:.0f}s", flush=True)
    for fh in shard_fh.values(): fh.close()
    stats["vessels"] = len(vessels)
    os.remove(src)  # streamed through, not kept

    # Pack: shards sorted by (mmsi, t0), gzip'd, 'SHTP' header + offsets.
    pack = os.path.join(out_dir, "tracks.pack")
    offsets, pos = [], 0
    with open(pack + ".tmp", "wb") as fh:
        fh.write(b"SHTP"); fh.write(struct.pack("<I", PACK_SHARDS))
        fh.write(b"\0" * 4 * (PACK_SHARDS + 1))  # offsets, filled in below
        for sh in range(PACK_SHARDS):
            offsets.append(pos)
            f = os.path.join(shard_dir, f"{sh}.ndjson")
            if not os.path.exists(f): continue
            rows = open(f).read().splitlines()
            rows.sort(key=lambda r: (lambda o: (o["mmsi"], o["t0"]))(json.loads(r)))
            blob = gzip.compress(("\n".join(rows) + "\n").encode(), 9)
            fh.write(blob); pos += len(blob); os.remove(f)
        offsets.append(pos)
        fh.seek(8); fh.write(struct.pack(f"<{PACK_SHARDS + 1}I", *offsets))
    os.replace(pack + ".tmp", pack)
    os.rmdir(shard_dir)

    pm = os.path.join(out_dir, "tracks.pmtiles")
    t_tip = time.time()
    subprocess.run(["tippecanoe", "-o", pm, "-l", "tracks", "-f", "-q", *TIPPECANOE, "--read-parallel", ndjson], check=True)
    os.remove(ndjson)

    manifest = dict(region="us", month=ym, built=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    source=dict(name="MarineCadastre monthly vessel tracks (NOAA / BOEM / USCG)", license="CC0",
                                url=url, bytes=src_bytes),
                    rules=dict(version=RULES_VERSION, jump_km=JUMP_KM, parked_m=PARKED_M, simplify_deg=SIMPLIFY_DEG,
                               inland_rules="not applied (no US-wide land grid yet)",
                               tippecanoe=" ".join(TIPPECANOE)),
                    pack=dict(shards=PACK_SHARDS, simplify_deg=PACK_SIMPLIFY_DEG, bytes=os.path.getsize(pack)),
                    pmtiles_bytes=os.path.getsize(pm), stats=stats,
                    secs=dict(total=round(time.time() - t_start), tippecanoe=round(time.time() - t_tip)),
                    test_limit_rows=LIMIT or None)
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1)
    print(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    ym = sys.argv[1]
    if len(ym) != 7 or ym[4] != "-":
        sys.exit("month must be YYYY-MM")
    build(ym, sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "build", ym))
