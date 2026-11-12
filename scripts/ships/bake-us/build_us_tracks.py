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
  5. (us-v3) Over-land rules, like the Salish bake's: a vertex in a deep-inland
     cell (land more than 2 km from any river, lake or sea
     of ~1 km² or more, on a ~250 m grid) is not drawn, and the line is split
     there (national dataset `deep-inland`, scripts/national/deep-inland/);
     a segment between two drawn vertices is sampled every LAND_STEP_KM
     and split where a sample falls inland. So a boat on a trailer, a
     transponder in a truck or a drifting GPS fix never draws a "ship track"
     across land. NOAA's file keeps the positions as evidence.

Outputs in OUT_DIR:
  tracks.pmtiles  layer "tracks": z3-8 merged per kind (prop kind only);
                  z9-10 one line per track (props mmsi kind vtype t0 t1)
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

import land_rules  # over-land rules (rule 5), shared with build_us_points.py and add_classes.py --land

SRC = "https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/aistrack/ais-track-{ym}.parquet"
RULES_VERSION = "us-v3"  # v2: zoomed-out tiles merge lines per vessel type (nothing dropped); v3: over-land rules
TILESET = "us-v2"        # Blob folder + index; months from either derivation publish here
JUMP_KM = 10
PARKED_M = 100
LAND_STEP_KM = land_rules.LAND_STEP_KM
SIMPLIFY_DEG = 0.0002
PACK_SIMPLIFY_DEG = 0.00005
PACK_SHARDS = 1024
# Zoomed out (z3-8), Esri's approach: every line kept, merged per vessel type
# (only `kind` survives, so identical features coalesce into one per tile).
# Zoomed in (z9-10): one line per ship with its MMSI; crowded tiles may drop
# lines there, which is fine because a picked ship reads the complete pack.
# -D10 (1024-unit tiles): lines are thinner than a pixel at these zooms, so a coarser
# grid looks the same and collapses duplicate vertices. No feature/size limits: a
# merged shape can't be "dropped" to fit (the first us-v2 run looped for 95 min at z3).
TIPPECANOE_LOW = ["-Z3", "-z8", "-D10", "--simplification=10", "-y", "kind", "--coalesce", "--reorder",
                  "--no-feature-limit", "--no-tile-size-limit"]
TIPPECANOE_HIGH = ["-Z9", "-z10", "--simplification=10", "--drop-densest-as-needed"]
TIPPECANOE = TIPPECANOE_LOW + ["+"] + TIPPECANOE_HIGH  # for the manifest
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
    seg_km = haversine_km(coords[:-1, 0], coords[:-1, 1], coords[1:, 0], coords[1:, 1])
    far = seg_km > JUMP_KM
    stats["jump_splits"] += int((same & far).sum())
    starts = np.concatenate([[0], np.nonzero(~same | far)[0] + 1])
    ends = np.concatenate([starts[1:], [len(coords)]])
    for s, e in zip(starts, ends):
        if e - s < 2:
            stats["single_vertex"] += 1; continue
        r = prow[cidx[s]]
        for c in land_split(coords[s:e], stats):
            if span_m(c) < PARKED_M:
                stats["parked_not_drawn"] += 1; continue
            yield int(mmsi[r]), vt[r], int(t0[r]), int(t1[r]), c


def span_m(c):
    return land_rules.span_m(c)


def land_split(c, stats):
    return land_rules.land_split(c, stats)


class LineWriter:
    """Writes drawable lines to the tippecanoe NDJSON and the per-MMSI pack shards."""
    def __init__(self, out_dir, ym):
        self.ym = ym
        self.ndjson = os.path.join(out_dir, "tracks.ndjson")
        self.shard_dir = os.path.join(out_dir, "shards"); os.makedirs(self.shard_dir, exist_ok=True)
        self.out = open(self.ndjson, "w"); self.shard_fh = {}
        self.lines = 0; self.vessels = set()

    def write(self, recs):
        """recs: [(mmsi, vtype, t0, t1, coords ndarray, extra_props dict|None)]"""
        if not recs: return
        lines = [shapely.LineString(r[4]) for r in recs]
        simp = shapely.simplify(lines, SIMPLIFY_DEG)
        psimp = shapely.simplify(lines, PACK_SIMPLIFY_DEG)
        for (m, v, a, b, _, extra), g, pg in zip(recs, simp, psimp):
            k = kind_of(v)
            gc = np.round(shapely.get_coordinates(g), 5).tolist()
            if len(gc) < 2: continue
            props = {"mmsi": m, "kind": k, "vtype": v, "month": self.ym, "t0": a, "t1": b, **(extra or {})}
            self.out.write(json.dumps({"type": "Feature", "geometry": {"type": "LineString", "coordinates": gc},
                                       "properties": props}, separators=(",", ":")) + "\n")
            pc = np.round(shapely.get_coordinates(pg), 5).tolist()
            sh = m % PACK_SHARDS
            fh = self.shard_fh.get(sh)
            if fh is None:
                fh = self.shard_fh[sh] = open(os.path.join(self.shard_dir, f"{sh}.ndjson"), "a")
            fh.write(json.dumps({"mmsi": m, "kind": k, "vtype": v, "t0": a, "t1": b, **(extra or {}), "c": pc}, separators=(",", ":")) + "\n")
            self.lines += 1; self.vessels.add(m)

    def close(self):
        self.out.close()
        for fh in self.shard_fh.values(): fh.close()


def finish(out_dir, w):
    """Pack + two-pass tippecanoe + tile-join. Returns (pack_path, pmtiles_path, tippecanoe_secs)."""
    pack = os.path.join(out_dir, "tracks.pack")
    offsets, pos = [], 0
    with open(pack + ".tmp", "wb") as fh:
        fh.write(b"SHTP"); fh.write(struct.pack("<I", PACK_SHARDS))
        fh.write(b"\0" * 4 * (PACK_SHARDS + 1))  # offsets, filled in below
        for sh in range(PACK_SHARDS):
            offsets.append(pos)
            f = os.path.join(w.shard_dir, f"{sh}.ndjson")
            if not os.path.exists(f): continue
            rows = open(f).read().splitlines()
            rows.sort(key=lambda r: (lambda o: (o["mmsi"], o["t0"]))(json.loads(r)))
            blob = gzip.compress(("\n".join(rows) + "\n").encode(), 9)
            fh.write(blob); pos += len(blob); os.remove(f)
        offsets.append(pos)
        fh.seek(8); fh.write(struct.pack(f"<{PACK_SHARDS + 1}I", *offsets))
    os.replace(pack + ".tmp", pack)
    os.rmdir(w.shard_dir)
    pm = os.path.join(out_dir, "tracks.pmtiles")
    t_tip = time.time()
    low, high = pm + ".low.pmtiles", pm + ".high.pmtiles"
    subprocess.run(["tippecanoe", "-o", low, "-l", "tracks", "-f", "-q", *TIPPECANOE_LOW, "--read-parallel", w.ndjson], check=True)
    subprocess.run(["tippecanoe", "-o", high, "-l", "tracks", "-f", "-q", *TIPPECANOE_HIGH, "--read-parallel", w.ndjson], check=True)
    # Disjoint zoom ranges, so joining is a plain concatenation of tiles.
    subprocess.run(["tile-join", "-o", pm, "-f", "--no-tile-size-limit", low, high], check=True)
    os.remove(low); os.remove(high); os.remove(w.ndjson)
    return pack, pm, round(time.time() - t_tip)


def build(ym, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    t_start = time.time()
    src = os.path.join(out_dir, f"ais-track-{ym}.parquet")
    url = SRC.format(ym=ym)
    if not os.path.exists(src):
        download(ym, src)
    src_bytes = os.path.getsize(src)
    w = LineWriter(out_dir, ym)
    land_rules.grid()
    stats = dict(rows=0, parts=0, jump_splits=0, **land_rules.stats(), single_vertex=0, parked_not_drawn=0, lines=0, vessels=0)
    pf = pq.ParquetFile(src)
    done = 0
    for batch in pf.iter_batches(batch_size=50_000, columns=["mmsi", "vessel_type", "start_time", "end_time", "geometry"]):
        if LIMIT and done >= LIMIT: break
        done += batch.num_rows
        w.write([(*r, None) for r in lines_from_batch(pa.Table.from_batches([batch]), stats)])
        print(f"  {done:,} rows, {w.lines:,} lines, {time.time() - t_start:.0f}s", flush=True)
    w.close()
    stats["lines"], stats["vessels"] = w.lines, len(w.vessels)
    os.remove(src)  # streamed through, not kept
    pack, pm, tip_secs = finish(out_dir, w)

    manifest = dict(region="us", tileset=TILESET, month=ym, built=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    source=dict(name="MarineCadastre monthly vessel tracks (NOAA / BOEM / USCG)", license="CC0",
                                url=url, bytes=src_bytes),
                    rules=dict(version=RULES_VERSION, jump_km=JUMP_KM, parked_m=PARKED_M, simplify_deg=SIMPLIFY_DEG,
                               inland_rules=land_rules.describe(),
                               tippecanoe=" ".join(TIPPECANOE)),
                    pack=dict(shards=PACK_SHARDS, simplify_deg=PACK_SIMPLIFY_DEG, bytes=os.path.getsize(pack)),
                    pmtiles_bytes=os.path.getsize(pm), stats=stats,
                    secs=dict(total=round(time.time() - t_start), tippecanoe=tip_secs),
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
