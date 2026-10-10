#!/usr/bin/env python3
"""
US-wide tracks: give the zoomed-out tiles (z3-8) each line's EarthAtlas ship class (Josh 2026-10-08).

Why: z3-8 merge every line per `kind` (build_us_tracks.py TIPPECANOE_LOW), so they carry no MMSI and the map's
"Narrow to" pick (Cruise ship, Ferry, Oil tanker...) could only fall back to the whole kind there (all passenger
ships north of the Salish box at z8). Merging per kind + class keeps the tiles small and lets the filter read `cls`,
as the GFW hourly lines already do (bake-gfw/bake.py ShipTypes, same MMSI → type-over-time lookup, same rule:
a class only when exactly one is known for that MMSI during the line's own time span).

No NOAA re-download: the month's pack already holds every line (mmsi, kind, vtype, t0, t1, coords), so z3-8 are
rebuilt from it and z9-10 are copied unchanged from the published tiles. Every rebuilt line also gets `cv: 1`, which
tells the map this month's zoomed-out lines can be filtered by class (older tiles fall back to the kind).

  python3 add_classes.py --month 2025-12 --types https://earthatlas.org/api/ships?op=typeLookup --out build/us-classes
  (CRON_SECRET in the environment for the type lookup; --index defaults to the published us-v2 index)

Output: <out>/<month>/tracks.pmtiles (+ manifest.json with the counts). Deps: shapely, numpy; tippecanoe + tile-join.
"""
import argparse, gzip, json, os, struct, subprocess, sys, time, urllib.request
from collections import Counter

import numpy as np
import shapely

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'bake-gfw'))
from bake import ShipTypes  # noqa: E402  the GFW bake's lookup, reused (never a second copy of the rule)


def _bake_constants(*names):
    """SIMPLIFY_DEG / TIPPECANOE_LOW as build_us_tracks.py defines them (read, not imported: it needs pyarrow)."""
    import ast
    tree = ast.parse(open(os.path.join(HERE, 'build_us_tracks.py')).read())
    vals = {t.id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
            for t in n.targets if isinstance(t, ast.Name) and t.id in names}
    return [vals[k] for k in names]


SIMPLIFY_DEG, TIPPECANOE_LOW, TIPPECANOE_HIGH = _bake_constants('SIMPLIFY_DEG', 'TIPPECANOE_LOW', 'TIPPECANOE_HIGH')

INDEX = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/us-v2/index.json'
CLASS_RULES = 'us-v2-cls1'
# cls2 = cls1 + every line cut at the Salish detail box (--cut-salish, months that have detailed Salish tracks; Josh
# 2026-10-09): inside the box only the Salish lines draw, so a US line crossing the box edge no longer doubles them
# (the map's `within` filter can't cut a line). z9-10 are then rebuilt from the pack too, with build_us_tracks.py's props.
CUT_RULES = 'us-v2-cls5'    # cls5 (cls2 + z3-4 uncut); cls2 = the first cut, which left z3-4 empty in the box
SALISH_BBOX = json.load(open(os.path.join(HERE, '..', '..', '..', 'src', 'ships', 'trackSource.json')))['bbox']
UA = {'User-Agent': 'earthatlas-bake/1.0 (+https://earthatlas.org)'}
# Same as TIPPECANOE_LOW, but features also coalesce per class (and keep the cv flag).
TIPPECANOE_LOW_CLS = [a for a in TIPPECANOE_LOW] + ['-y', 'cls', '-y', 'cv']


def get(url, dest):
    if os.path.exists(dest):
        return dest
    t = time.time()
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r, open(dest + '.part', 'wb') as fh:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            fh.write(b)
    os.replace(dest + '.part', dest)
    print(f'downloaded {os.path.basename(dest)} {os.path.getsize(dest) / 1e6:.0f} MB in {time.time() - t:.0f} s', flush=True)
    return dest


def pack_rows(path):
    """Every row of a ship-track pack ('SHTP', uint32 N, (N+1) uint32 offsets, N gzip'd NDJSON shards)."""
    with open(path, 'rb') as fh:
        assert fh.read(4) == b'SHTP', 'not a ship-track pack'
        n = struct.unpack('<I', fh.read(4))[0]
        offs = struct.unpack(f'<{n + 1}I', fh.read(4 * (n + 1)))
        base = 8 + 4 * (n + 1)
        for i in range(n):
            if offs[i + 1] == offs[i]:
                continue
            fh.seek(base + offs[i])
            for line in gzip.decompress(fh.read(offs[i + 1] - offs[i])).splitlines():
                if line:
                    yield json.loads(line)


def outside(coords, box):
    """The parts of a polyline outside an axis-aligned box, split where it crosses the edge (Liang-Barsky per segment).
    Not shapely.difference: overlay nodes a track at every self-crossing (5,000 lines → 2.8 M pieces, 2026-10-09)."""
    x0, y0, x1, y1 = box
    pieces, cur = [], []
    for (ax, ay), (bx, by) in zip(coords, coords[1:]):
        dx, dy, lo, hi = bx - ax, by - ay, 0.0, 1.0
        for p, q in ((-dx, ax - x0), (dx, x1 - ax), (-dy, ay - y0), (dy, y1 - ay)):
            if p == 0:
                if q < 0:
                    lo, hi = 1.0, 0.0  # parallel to this edge and outside it: the segment misses the box
            else:
                t = q / p
                if p < 0:
                    lo = max(lo, t)
                else:
                    hi = min(hi, t)
        at = lambda t: [round(ax + t * dx, 5), round(ay + t * dy, 5)]
        if lo >= hi:            # wholly outside
            if not cur:
                cur = [[ax, ay]]
            cur.append([bx, by])
            continue
        if lo > 0:              # outside, then enters at lo
            if not cur:
                cur = [[ax, ay]]
            cur.append(at(lo))
        if len(cur) >= 2:
            pieces.append(cur)
        cur = []
        if hi < 1:              # leaves at hi, outside to the end
            cur = [at(hi), [bx, by]]
    if len(cur) >= 2:
        pieces.append(cur)
    return pieces


def _simplify(job):
    """(coord lists, cut box or None) → per line, (its simplified coords, the pieces left outside the box)."""
    coord_lists, box = job
    simp = shapely.simplify([shapely.LineString(c) for c in coord_lists], SIMPLIFY_DEG)
    out = []
    for g in simp:
        gc = np.round(shapely.get_coordinates(g), 5).tolist()
        out.append((gc, outside(gc, box) if box is not None else [gc]))
    return out


def zoom_range(flags, lo, hi):
    """A tippecanoe flag list with its -Z/-z replaced."""
    return [f'-Z{lo}' if f.startswith('-Z') else f'-z{hi}' if f.startswith('-z') else f for f in flags]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--month', required=True)
    ap.add_argument('--types', required=True, help='type lookup: URL (op=typeLookup) or saved JSON file')
    ap.add_argument('--index', default=INDEX)
    ap.add_argument('--out', required=True)
    ap.add_argument('--cut-salish', action='store_true', help='cut lines at the Salish detail box (months with Salish tracks)')
    a = ap.parse_args()
    ym = a.month
    wd = os.path.join(a.out, ym)
    os.makedirs(wd, exist_ok=True)
    with urllib.request.urlopen(urllib.request.Request(a.index, headers=UA), timeout=60) as r:
        entry = json.load(r)['months'][ym]
    pack = get(entry['pack'], os.path.join(wd, 'src.pack'))
    tiles = get(entry['tiles'], os.path.join(wd, 'src.pmtiles'))
    types = ShipTypes.load(a.types)

    t0 = time.time()
    # Cut months write two inputs: uncut lines (z3-4: the Salish tiles start at z5, so a cut there left the Salish Sea
    # empty when zoomed out; fixed 2026-10-09) and cut lines (z5-10).
    nd, nd_full = (os.path.join(wd, f) for f in ('low.ndjson', 'full.ndjson'))
    stats = Counter()
    import multiprocessing as mp
    with open(nd, 'w') as out, open(nd_full, 'w') as full, mp.Pool(os.cpu_count()) as pool:
        batch = []

        def flush():
            # Simplifying is nearly all the time (lines from NOAA's daily files average ~780 points), so it runs on every
            # core; same function and tolerance as build_us_tracks.py, so the output is unchanged.
            box = SALISH_BBOX if a.cut_salish else None
            chunks = [([r['c'] for r in batch[i:i + 1000]], box) for i in range(0, len(batch), 1000)]
            simplified = [pieces for part in pool.map(_simplify, chunks) for pieces in part]
            for r, (whole, pieces) in zip(batch, simplified):
                pieces = [gc for gc in pieces if len(gc) >= 2]
                if len(whole) < 2:
                    stats['too_short'] += 1
                    continue
                if not pieces:
                    stats['inside_salish_box'] += 1
                probe = {'mmsi': r['mmsi'], 'kind': r['kind'], 't0': r['t0'], 't1': r['t1']}
                types.apply(probe)           # only its class is taken; the NOAA kind stays as baked
                # Cut months rebuild z9-10 from these features too, so they keep build_us_tracks.py's per-line props.
                props = ({k: v for k, v in r.items() if k != 'c'} | {'month': ym} if a.cut_salish else {'kind': r['kind']}) | {'cv': 1}
                if probe.get('cls'):
                    props['cls'] = probe['cls']
                    stats['with_class'] += 1
                else:
                    stats['no_class'] += 1
                if len(pieces) > 1:
                    stats['cut_at_salish_box'] += 1
                feat = lambda gc, pr: json.dumps({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': gc},
                                                  'properties': pr}, separators=(',', ':')) + '\n'
                if a.cut_salish:
                    full.write(feat(whole, props))
                for gc in pieces:
                    out.write(feat(gc, props))
            batch.clear()

        for r in pack_rows(pack):
            if len(r.get('c') or []) < 2:
                continue
            batch.append(r)
            if len(batch) >= 20000:
                flush()
        if batch:
            flush()
    print(f'lines: {dict(stats)} in {time.time() - t0:.0f} s', flush=True)

    t1 = time.time()
    low, high, pm = (os.path.join(wd, f) for f in ('low.pmtiles', 'high.pmtiles', 'tracks.pmtiles'))
    parts = [low, high]
    tip = lambda out, layer, flags, src: subprocess.run(['tippecanoe', '-o', out, '-l', layer, '-f', '-q', *flags, '--read-parallel', src], check=True)
    if a.cut_salish:
        # z3-4 uncut, z5-8 cut (both merged per kind + class), z9-10 cut per line (build_us_tracks.py's high pass)
        low34 = os.path.join(wd, 'low34.pmtiles')
        tip(low34, 'tracks', zoom_range(TIPPECANOE_LOW_CLS, 3, 4), nd_full)
        tip(low, 'tracks', zoom_range(TIPPECANOE_LOW_CLS, 5, 8), nd)
        tip(high, 'tracks', [*TIPPECANOE_HIGH, '-x', 'cls', '-x', 'cv'], nd)
        parts.append(low34)
    else:
        tip(low, 'tracks', TIPPECANOE_LOW_CLS, nd)
        subprocess.run(['tile-join', '-o', high, '-f', '--no-tile-size-limit', '--minimum-zoom=9', tiles], check=True)   # z9-10 as published
    subprocess.run(['tile-join', '-o', pm, '-f', '--no-tile-size-limit', *parts], check=True)
    for f in (*parts, nd, nd_full):
        os.remove(f)
    manifest = {'month': ym, 'rules': CUT_RULES if a.cut_salish else CLASS_RULES,
                'cut_box': SALISH_BBOX if a.cut_salish else None, 'from_tiles': entry['tiles'], 'from_pack': entry['pack'],
                'tippecanoe_low': ' '.join(TIPPECANOE_LOW_CLS), 'stats': dict(stats), 'types': dict(types.stats),
                'pmtiles_bytes': os.path.getsize(pm), 'secs': {'lines': round(t1 - t0), 'tiles': round(time.time() - t1)}}
    json.dump(manifest, open(os.path.join(wd, 'manifest.json'), 'w'), indent=1)
    print(json.dumps(manifest), flush=True)


if __name__ == '__main__':
    main()
