"""Spill scenarios: bake the prebaked scenarios (approved points x weather windows) into compact per-scenario JSON.

Each scenario = a 10-member PyGNOME ensemble (run_spill.py) at one point under one real past 72 h of SSCOFS nowcast
currents and model wind. Member 0 is unperturbed; members 1-9 perturb wind speed x N(1, 0.2), wind direction +N(0, 15 deg)
and current speed x U(0.85, 1.15) (our choice, not a published scheme; fixed RNG 42 so a rebake is identical).

  data/spillrisk/env/bin/python -I scripts/spillrisk/bake_scenarios.py [--only point:window,...] [--workers 6]
        [--members 10]   (volume per point: points.json "volume" -> VOLUMES)

Outputs public/spillrisk-data/ (served by vite on localhost; published to Blob later):
  scenarios.json        index: points, windows, oil, volume, scenario list
  <point>--<window>.json  per hour: oil cells with share of runs, member-0 particles (floating / ashore), oil budget;
                          per impact group: the first hour each feature is reached
Raw member runs stay in data/spillrisk/scenarios/ (gitignored). Members already run are skipped (rerun-safe).
"""
import argparse, concurrent.futures as cf, datetime as dt, json, os, subprocess, sys, time
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PY = os.path.join(ROOT, 'data/spillrisk/env/bin/python')
RUNS = os.path.join(ROOT, 'data/spillrisk/scenarios')
OUT = os.path.join(ROOT, 'public/spillrisk-data')
LAND = os.path.join(ROOT, 'data/spillrisk/forcing/salish_v6_land_osm.bna')
OIL = os.path.join(ROOT, 'data/spillrisk/oils/AD00020.json')
DLAT, DLON = 0.005, 0.0075
IN_WATER, ON_LAND = 2, 3
HOURS = 72

# Weather windows: the 72 h picked from NOAA NDBC buoy 46088 (New Dungeness) 2025 hourly wind (see docs/SPILLRISK_SCENARIOS.md)
WINDOWS = {
    'winter-storm': dict(start='2025-12-17T08', label='Winter storm, Dec 17–20, 2025',
                         why='The windiest 72 hours of winter 2025 at NOAA buoy 46088 (New Dungeness): mean 8.7 m/s, mostly from the southwest.'),
    'summer': dict(start='2025-08-03T07', label='Typical summer, Aug 3–6, 2025',
                   why='A typical summer 72 hours at NOAA buoy 46088 (New Dungeness): mean 5.1 m/s, the summer median, mostly from the southwest.'),
}
BUOY = 'https://www.ndbc.noaa.gov/station_page.php?station=46088'

# Spill volumes, chosen per point in points.json ("volume"). Josh 2026-11-06: even-numbered points Exxon Valdez size,
# odd-numbered the federal planning size. Sources in docs/SPILLRISK_RESPONSE_TIMES.md.
VOLUMES = {
    'federal': dict(bbl=2500, short='2,500 barrels', label='2,500 barrels, the federal tanker planning size',
                    src='33 CFR 155.1020', url='https://www.law.cornell.edu/cfr/text/33/155.1020'),
    'valdez': dict(bbl=257000, short='257,000 barrels', label='257,000 barrels, as much as the Exxon Valdez',
                   src='EVOS Trustee Council', url='https://evostc.state.ak.us/oil-spill-facts/q-and-a/'),
}


def forcing(win):
    s = dt.datetime.strptime(WINDOWS[win]['start'], '%Y-%m-%dT%H')
    return os.path.join(ROOT, f'data/spillrisk/forcing/sscofs-nowcast-{s:%Y%m%dT%H}z-{HOURS}h-surface.nc')


def buoy_water_temp(win):
    """mean sea-surface temperature at buoy 46088 over the window (NDBC stdmet WTMP)"""
    s = dt.datetime.strptime(WINDOWS[win]['start'], '%Y-%m-%dT%H')
    vals = []
    for line in open(os.path.join(ROOT, 'data/spillrisk/wind/46088h2025.txt')):
        if line.startswith('#'):
            continue
        c = line.split()
        t = dt.datetime(int(c[0]), int(c[1]), int(c[2]), int(c[3]), int(c[4]))
        if s <= t <= s + dt.timedelta(hours=HOURS) and float(c[14]) < 90:
            vals.append(float(c[14]))
    return round(float(np.mean(vals)), 1)


def members(n):
    r = np.random.default_rng(42)
    out = []
    for i in range(n):
        ws, wr, cs = (1.0, 0.0, 1.0) if i == 0 else (max(0.4, r.normal(1, 0.2)), r.normal(0, 15), r.uniform(0.85, 1.15))
        out.append((i, round(ws, 3), round(wr, 1), round(cs, 3)))
    return out


def run_member(job):
    pt, win, (i, ws, wr, cs), amount, wtemp = job
    out = os.path.join(RUNS, f'{pt["id"]}--{win}', f'm{i:02d}.npz')
    meta = out.replace('.npz', '.json')
    if os.path.exists(meta) and json.load(open(meta)).get('amount_bbl') == amount:
        return out
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = [PY, '-I', os.path.join(ROOT, 'scripts/spillrisk/run_spill.py'), forcing(win), str(pt['lon']), str(pt['lat']),
           str(HOURS), OIL, out, '--seed', str(i), '--wind-scale', str(ws), '--wind-rot', str(wr), '--cur-scale', str(cs),
           '--land', LAND, '--amount-bbl', str(amount), '--water-temp-c', str(wtemp)]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT)
    if r.returncode:
        raise RuntimeError(f'{out}: {r.stderr[-2000:]}')
    return out


def cell_ids(pos):
    return np.floor(pos[:, 1] / DLAT).astype(np.int32), np.floor(pos[:, 0] / DLON).astype(np.int32)


def compact(pt, win, n, index, amount, amount_label, wtemp):
    d = os.path.join(RUNS, f'{pt["id"]}--{win}')
    mem = [np.load(os.path.join(d, f'm{i:02d}.npz')) for i in range(n)]
    meta0 = json.load(open(os.path.join(d, 'm00.json')))
    H = min(len({k[:4] for k in z.files}) for z in mem)
    feats, fcells = index['features'], index['cells']
    first_any, first_likely = {}, {}   # feature id -> first hour reached (any run / >= 2/3 of runs)
    hours, shore_first = [], [None] * n
    for h in range(H):
        cnt = {}
        for m, z in enumerate(mem):
            pos, st = z[f'h{h:03d}_best_pos'], z[f'h{h:03d}_best_status']
            keep = np.isin(st, (IN_WATER, ON_LAND))
            if shore_first[m] is None and (st == ON_LAND).any():
                shore_first[m] = h
            iy, ix = cell_ids(pos[keep])
            for c in set(zip(iy.tolist(), ix.tolist())):
                cnt[c] = cnt.get(c, 0) + 1
        cells = sorted([iy, ix, k] for (iy, ix), k in cnt.items())
        for iy, ix, k in cells:
            for fid in fcells.get(f'{iy},{ix}', ()):
                first_any.setdefault(fid, h)
                if k * 3 >= 2 * n:
                    first_likely.setdefault(fid, h)
        z0 = mem[0]
        pos, st = z0[f'h{h:03d}_best_pos'], z0[f'h{h:03d}_best_status']
        fl, ash = pos[st == IN_WATER], pos[st == ON_LAND]
        r5 = lambda a: np.round(a.astype('f8'), 4).tolist()
        hours.append(dict(h=h, cells=cells, float=r5(fl[:: max(1, len(fl) // 400)]), ashore=r5(ash[:: max(1, len(ash) // 400)])))
    # oil budget for member 0 (PyGNOME mass balance, kg) as shares of the amount released
    bud = meta0.get('budget_kg', [])
    released = max((b.get('amount_released', 0) for b in bud), default=0) or 1
    for h, b in enumerate(bud[:H]):
        hours[h]['budget'] = {k: round(b.get(src, 0) / released, 4) for k, src in
                              (('floating', 'floating'), ('evaporated', 'evaporated'), ('dispersed', 'natural_dispersion'),
                               ('ashore', 'beached'), ('off_map', 'off_maps'))}
    # impacts grouped by layer + group; per group, each reached feature's first hour (sorted) so the page can count by hour
    groups = {}
    for fid, h in first_any.items():
        f = feats[fid]
        g = groups.setdefault((f['layer'], f['group']), dict(layer=f['layer'], group=f['group'], src=f['src'], url=f['url'],
                                                             first=[], first_likely=[], names={}))
        g['first'].append(h)
        if fid in first_likely:
            g['first_likely'].append(first_likely[fid])
        if f['layer'] != 'friends':   # Friends patches are counted, not named one by one
            g['names'][f['name']] = min(h, g['names'].get(f['name'], 999))
    imp = []
    for g in groups.values():
        g['first'].sort(); g['first_likely'].sort()
        g['names'] = sorted(([k, v] for k, v in g['names'].items()), key=lambda kv: kv[1])[:60]
        imp.append(g)
    imp.sort(key=lambda g: (g['first'][0], g['layer']))
    hit = [s for s in shore_first if s is not None]
    return dict(id=f'{pt["id"]}--{win}', point=pt['id'], window=win, start=meta0['start'], hours_n=H, members=n,
                grid=dict(dlat=DLAT, dlon=DLON), amount_bbl=amount, amount_label=amount_label, water_temp_c=wtemp,
                shore=dict(members_reaching=len(hit), first_min=min(hit) if hit else None, first_max=max(hit) if hit else None),
                impacts=imp, hours=hours)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--members', type=int, default=10)
    a = ap.parse_args()
    pts = {p['id']: p for p in json.load(open(os.path.join(ROOT, 'scripts/spillrisk/points.json')))['points']}
    todo = [(p, w) for w in WINDOWS for p in pts]
    if a.only:
        want = {tuple(x.split(':')) for x in a.only.split(',')}
        todo = [(p, w) for p, w in todo if (p, w) in want]
    wt = {w: buoy_water_temp(w) for w in WINDOWS}
    jobs = [(pts[p], w, m, float(VOLUMES[pts[p]['volume']]['bbl']), wt[w]) for p, w in todo for m in members(a.members)]
    t0 = time.time()
    print(f'{len(todo)} scenarios, {len(jobs)} member runs, {a.workers} workers; water temp {wt}', flush=True)
    with cf.ThreadPoolExecutor(a.workers) as ex:
        for k, out in enumerate(ex.map(run_member, jobs), 1):
            if k % 10 == 0 or k == len(jobs):
                print(f'  {k}/{len(jobs)} members, {time.time() - t0:.0f}s', flush=True)
    index = json.load(open(os.path.join(ROOT, 'data/spillrisk/impact/index.json')))
    os.makedirs(OUT, exist_ok=True)
    for p, w in todo:
        v = VOLUMES[pts[p]['volume']]
        sc = compact(pts[p], w, a.members, index, float(v['bbl']), v['label'], wt[w])
        json.dump(sc, open(os.path.join(OUT, f'{sc["id"]}.json'), 'w'), separators=(',', ':'))
        print(f'  {sc["id"]}: shore {sc["shore"]}, {len(sc["impacts"])} impact groups', flush=True)
    # index of everything baked so far
    done = sorted(f[:-5] for f in os.listdir(OUT) if f.endswith('.json') and '--' in f)
    oil = json.load(open(OIL))['metadata']
    json.dump(dict(
        points=list(pts.values()),
        windows=[dict(id=k, **v, water_temp_c=wt[k], buoy_url=BUOY) for k, v in WINDOWS.items()],
        oil=dict(id='AD00020', name='Alaska North Slope crude', adios_name=oil['name'],
                 url='https://adios.orr.noaa.gov/oils/AD00020'),
        volumes=VOLUMES,
        scenarios=done, baked=time.strftime('%Y-%m-%d %H:%M'),
    ), open(os.path.join(OUT, 'scenarios.json'), 'w'), indent=1)
    print(f'done in {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
