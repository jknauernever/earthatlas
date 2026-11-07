"""Phase 1 benchmark analysis: turn run outputs into per-hour cell grids and compare probability methods.

Grid: 0.005 deg lat x 0.0075 deg lon (~550 m), the benchmark's working cell size.
  built-in : PyGNOME best-estimate + uncertainty particles. "Share of particles" per cell (best+uncertain pooled) —
             an envelope, not a probability of oiling.
  ensemble : fraction of members with any surface oil in the cell at that hour (and by that hour, cumulative).

usage: env/bin/python scripts/spillrisk/analyze.py builtin <run.npz> ...
       env/bin/python scripts/spillrisk/analyze.py ensemble <member1.npz> <member2.npz> ...
       env/bin/python scripts/spillrisk/analyze.py compare <builtin.npz> <member*.npz ...>
"""
import json, os, sys
import numpy as np

DLAT, DLON = 0.005, 0.0075
IN_WATER, ON_LAND = 2, 3


def frames(path, tag):
    z = np.load(path)
    hs = sorted({int(k[1:4]) for k in z.files})
    return [(z[f'h{h:03d}_{tag}_pos'], z[f'h{h:03d}_{tag}_status']) for h in hs if f'h{h:03d}_{tag}_pos' in z.files]


def cells(pos, status, want=(IN_WATER,)):
    m = np.isin(status, want)
    if not m.any():
        return set()
    p = pos[m]
    return set(zip(np.floor(p[:, 1] / DLAT).astype(int).tolist(), np.floor(p[:, 0] / DLON).astype(int).tolist()))


def shore(path, tag='best'):
    """first hour any oil is on land, share of elements on land at the end"""
    fr = frames(path, tag)
    first = next((h for h, (_, s) in enumerate(fr) if (s == ON_LAND).any()), None)
    s = fr[-1][1]
    return first, float((s == ON_LAND).mean()) if s.size else 0.0


def ensemble_grid(paths):
    mem = [frames(p, 'best') for p in paths]
    H = min(len(m) for m in mem)
    out = []
    for h in range(H):
        cnt, cum = {}, {}
        for m in mem:
            for c in cells(*m[h], want=(IN_WATER, ON_LAND)):
                cnt[c] = cnt.get(c, 0) + 1
        out.append({c: n / len(mem) for c, n in cnt.items()})
    reached = []
    for m in mem:
        r = set()
        for h in range(H):
            r |= cells(*m[h], want=(IN_WATER, ON_LAND))
        reached.append(r)
    allc = set().union(*reached)
    by_end = {c: sum(c in r for r in reached) / len(mem) for c in allc}
    return out, by_end


def bands(p):
    # benchmark thresholds (to be decided with Josh): likely >= 2/3 of runs, possible >= 1/3, less likely > 0
    v = np.array(list(p.values())) if p else np.array([])
    return dict(likely=int((v >= 2 / 3).sum()), possible=int(((v >= 1 / 3) & (v < 2 / 3)).sum()),
                less_likely=int(((v > 0) & (v < 1 / 3)).sum()))


def cell_km2(lat):
    return (DLAT * 111.0) * (DLON * 111.0 * np.cos(np.deg2rad(lat)))


mode = sys.argv[1]
if mode == 'builtin':
    for p in sys.argv[2:]:
        best, unc = frames(p, 'best'), frames(p, 'unc')
        lat = float(json.load(open(p.replace('.npz', '.json')))['lat'])
        rows = []
        for h in (6, 24, 48, 72):
            if h >= len(best):
                continue
            b, u = cells(*best[h], want=(IN_WATER, ON_LAND)), cells(*unc[h], want=(IN_WATER, ON_LAND))
            rows.append(f'h{h}: best {len(b) * cell_km2(lat):.0f} km2, envelope {len(b | u) * cell_km2(lat):.0f} km2')
        fs, ls = shore(p)
        fu, lu = shore(p, 'unc')
        print(os.path.basename(p), '|', '; '.join(rows), f'| first shore h{fs} (unc h{fu}), on land at end {ls:.0%} (unc {lu:.0%})')
elif mode in ('ensemble', 'compare'):
    paths = sys.argv[3:] if mode == 'compare' else sys.argv[2:]
    grid, by_end = ensemble_grid(paths)
    lat = float(json.load(open(paths[0].replace('.npz', '.json')))['lat'])
    for h in (6, 24, 48, 72):
        if h < len(grid):
            print(f'ensemble h{h}: cells {len(grid[h])} ({len(grid[h]) * cell_km2(lat):.0f} km2) bands {bands(grid[h])}')
    print('ensemble reached by end:', bands(by_end), f'{len(by_end) * cell_km2(lat):.0f} km2')
    sh = [shore(p) for p in paths]
    hits = [f for f, _ in sh if f is not None]
    print(f'members reaching shore: {len(hits)}/{len(paths)}; first-contact hour range {min(hits) if hits else None}-{max(hits) if hits else None}')
    if mode == 'compare':
        bi = sys.argv[2]
        best, unc = frames(bi, 'best'), frames(bi, 'unc')
        envelope = set()
        for h in range(len(best)):
            envelope |= cells(*best[h], want=(IN_WATER, ON_LAND)) | cells(*unc[h], want=(IN_WATER, ON_LAND))
        ens = set(by_end)
        likely = {c for c, v in by_end.items() if v >= 2 / 3}
        print(f'built-in envelope (any hour) {len(envelope)} cells; ensemble reach {len(ens)} cells; overlap {len(envelope & ens)}; '
              f'ensemble cells outside envelope {len(ens - envelope)}; ensemble "likely" cells inside envelope {len(likely & envelope)}/{len(likely)}')
