#!/usr/bin/env python3
"""
/shoreline/reports counts: how much of each map layer /shoreline draws lies at each island
(docs/SHORELINE_REPORT_PLAN.md) → public/shoreline-data/report-counts.json.

Islands: every tax parcel's Assessor district names its island (the /risks land-value rule, scripts/bake-risks/economics.mjs);
parcels buffered 15 m and unioned give the land masses, each named by the district most of its parcel area is in. Everything is
counted at the nearest land mass: points directly, lines in ≤20 m pieces (by midpoint), kelp beds by their own point, herring
grounds by a 50 m grid inside, parcels and buildings by the land mass they sit on.

Usage:  python3 scripts/shoreline/report-counts.py
Needs:  shapely>=2, pyproj; data/shoreline/raw/{parcels,buildings}.geojson (fetch-county.mjs)
"""
import json
import os
import re
from collections import defaultdict
from datetime import date

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, 'data', 'shoreline', 'raw')
PUB = os.path.join(ROOT, 'public', 'shoreline-data')
OUT = os.path.join(PUB, 'report-counts.json')

M_PER_MI = 1609.344
M2_PER_ACRE = 4046.856
PIECE = 20.0   # m, line pieces
GRID = 50.0    # m, herring grid

# Same list and rule as scripts/bake-risks/economics.mjs islandOf()
ISLANDS = ['San Juan', 'Orcas', 'Lopez', 'Shaw', 'Stuart', 'Waldron', 'Decatur', 'Blakely', 'Henry', 'Center', 'Crane', 'Other islands']


def island_of(district):
    d = str(district or '')
    m = re.match(r'\s*(\d+)', d)
    n = int(m.group(1)) if m else -1
    if 10 <= n < 20: return 'San Juan'
    if 20 <= n < 30: return 'Orcas'
    if 30 <= n < 40: return 'Lopez'
    if 40 <= n < 50: return 'Shaw'
    return next((i for i in ISLANDS if i in d), 'Other islands')


# src/shoreline/shorelineLayers.js FISH_SPECIES / fishTier / SHOREFORM_GROUP_OF (keep in step)
FISH_SPECIES = [
    ('chinook', 'Ck', 0.084656, 0.214912), ('chum', 'Chum', 0.323232, 0.611842), ('pink', 'Pk', 0.300752, 0.477273),
    ('herring', 'Herr', 0.0888889, 0.208333), ('smelt', 'Smelt', 0.073333, 0.2), ('sand-lance', 'Lance', 0.113636, 0.27778),
    ('greenlings', 'Hex', 0.357955, 0.614035),
]


def fish_tier(moderate_max, high_max, v):
    eps = 5e-6
    return 3 if v > high_max + eps else 2 if v > moderate_max + eps else 1


SHOREFORM_GROUP_OF = {
    'FBE': 'feeder', 'FB': 'feeder', 'HFBE': 'feeder', 'HFB': 'feeder', 'PFB': 'feeder', 'TZ': 'transport', 'BAB': 'barrier',
    'Embayments - Estuary': 'embayment', 'Embayments - Lagoon': 'embayment', 'Pocket Beach': 'pocket', 'Rocky Shoreline': 'rocky', 'ART': 'artificial',
}

TO_UTM = Transformer.from_crs('EPSG:4326', 'EPSG:32610', always_xy=True)
TO_LL = Transformer.from_crs('EPSG:32610', 'EPSG:4326', always_xy=True)


def utm(g):
    return shapely.transform(g, lambda xy: np.column_stack(TO_UTM.transform(xy[:, 0], xy[:, 1])))


def load(path):
    with open(path) as f:
        return json.load(f)['features']


def geoms(feats):
    return [utm(shapely.force_2d(shape(f['geometry']))) if f.get('geometry') else None for f in feats]


def num(v):
    try:
        x = float(v)
        return x if np.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def build_islands(parcels):
    pg = geoms(parcels)
    labels = [island_of(p['properties'].get('District_N')) for p in parcels]
    keep = [i for i, g in enumerate(pg) if g is not None and not g.is_empty]
    pg = [shapely.make_valid(pg[i]) for i in keep]
    labels = [labels[i] for i in keep]
    # simplified (2 m) and coarse buffers: the land masses only need to be right to a few metres
    print('  union of', len(pg), 'parcels…', flush=True)
    merged = shapely.union_all(shapely.buffer(shapely.simplify(pg, 2), 15, quad_segs=2))
    print('  ', shapely.get_num_geometries(merged), 'land masses', flush=True)
    masses = list(shapely.get_parts(merged))
    tree = shapely.STRtree(masses)
    reps = shapely.point_on_surface(pg)
    area_by = [defaultdict(float) for _ in masses]
    parcel_mass = tree.query_nearest(reps, return_distance=False)[1]
    for i, mi in enumerate(parcel_mass):
        area_by[mi][labels[i]] += pg[i].area
    mass_label = [max(a.items(), key=lambda kv: kv[1])[0] if a else 'Other islands' for a in area_by]
    return masses, mass_label, tree, parcel_mass, pg, keep


def main():
    parcels = load(os.path.join(RAW, 'parcels.geojson'))
    masses, mass_label, tree, parcel_mass, parcel_geoms, keep = build_islands(parcels)

    # nearest land mass of each point (one per point, ties broken arbitrarily)
    def nearest1(pts):
        idx = tree.query_nearest(pts, return_distance=False, all_matches=False)
        out = [None] * len(pts)
        for i, j in zip(idx[0], idx[1]):
            out[i] = mass_label[j]
        return out

    acc = defaultdict(lambda: defaultdict(float))   # island → key → value
    multi = defaultdict(lambda: defaultdict(set))    # island → key → set (non-additive counts)

    def add(isl, key, v=1.0):
        acc[isl][key] += v

    def lines(feats, key_of):
        """Each line feature cut into ≤PIECE m pieces; key_of(props) → list of keys its miles go to. Returns per-feature majority island."""
        gs = geoms(feats)
        mids, owner, lens = [], [], []
        for fi, g in enumerate(gs):
            if g is None or g.is_empty: continue
            for part in shapely.get_parts(g):
                c = np.asarray(shapely.get_coordinates(shapely.segmentize(part, PIECE)))
                if len(c) < 2: continue
                a, b = c[:-1], c[1:]
                ln = np.hypot(*(b - a).T)
                mids.extend(((a + b) / 2).tolist()); owner.extend([fi] * len(ln)); lens.extend(ln.tolist())
        isl = nearest1(shapely.points(mids))
        per = defaultdict(lambda: defaultdict(float))
        for fi, il, ln in zip(owner, isl, lens):
            for k in key_of(feats[fi]['properties']):
                add(il, k, ln / M_PER_MI)
            per[fi][il] += ln
        return {fi: max(d.items(), key=lambda kv: kv[1])[0] for fi, d in per.items()}

    def points(feats, key_of):
        gs = geoms(feats)
        idx = [i for i, g in enumerate(gs) if g is not None and not g.is_empty]
        isl = nearest1(shapely.point_on_surface([gs[i] for i in idx]))
        for i, il in zip(idx, isl):
            for k in key_of(feats[i]['properties']):
                add(il, k)
        return dict(zip(idx, isl))

    # ── Habitat ──
    kelp = load(os.path.join(PUB, 'friends-bull-kelp-patches.geojson'))
    kg = geoms(kelp)
    for g, il in zip(kg, nearest1(shapely.point_on_surface(kg))):
        add(il, 'kelp_beds'); add(il, 'kelp_acres', g.area / M2_PER_ACRE)

    lines(load(os.path.join(PUB, 'friends-deepwater-eelgrass.geojson')), lambda p: ['eelgrass_mi'])
    fdoc = load(os.path.join(PUB, 'friends-documented-forage-spawning.json'))
    for il in lines(fdoc, lambda p: ['fdoc_mi']).values():
        add(il, 'fdoc_beaches')
    lines(load(os.path.join(PUB, 'friends-potential-forage-spawning.json')), lambda p: ['fpot_mi'])

    herring = load(os.path.join(PUB, 'friends-herring-spawning.json'))
    for fi, g in enumerate(geoms(herring)):
        x0, y0, x1, y1 = g.bounds
        xs, ys = np.meshgrid(np.arange(x0 + GRID / 2, x1, GRID), np.arange(y0 + GRID / 2, y1, GRID))
        pts = shapely.points(xs.ravel(), ys.ravel())
        pts = pts[shapely.contains_xy(g, xs.ravel(), ys.ravel())]
        if not len(pts): pts = np.array([shapely.point_on_surface(g)])
        share = defaultdict(int)
        for il in nearest1(pts): share[il] += 1
        n = sum(share.values())
        for il, k in share.items():
            add(il, 'herring_acres', g.area * k / n / M2_PER_ACRE)
            if k / n >= 0.01: multi[il]['herring_grounds'].add(fi)

    fish = load(os.path.join(PUB, 'fish-use.geojson'))

    def fish_keys(p):
        out, top = [], 1
        for mode, code, mm, hm in FISH_SPECIES:
            v = num(p.get(f'HRM_{code}'))
            if v is None: continue
            t = fish_tier(mm, hm, v); top = max(top, t)
            out.append(f'fish_{mode}_{t}')
        out.append(f'fish_all_{top}')
        out.append('fish_mi')
        return out
    lines(fish, fish_keys)

    # ── Shoreline ──
    lines(load(os.path.join(PUB, 'friends-shoreline-geology.json')),
          lambda p: ['shore_mi', f"shoreform_{SHOREFORM_GROUP_OF.get(p.get('PIAT_shoreforms'), 'other')}"])
    armor = load(os.path.join(PUB, 'friends-armor.json'))
    for il in lines(armor, lambda p: ['armor_mi']).values():
        add(il, 'armor_pieces')
    for key, file in [('docks', 'friends-docks.geojson'), ('ramps', 'friends-boat-ramps.json'), ('railways', 'friends-marine-railway.json'),
                      ('groins', 'friends-groins.json'), ('pilings', 'friends-pilings.json')]:
        points(load(os.path.join(PUB, file)), lambda p, key=key: [key])
    points(load(os.path.join(PUB, 'friends-mooring-buoys.json')),
           lambda p: ['buoys'])  # one map layer: Mooring Buoys & Floats

    # ── Property ──
    for n, i in enumerate(keep):
        il = mass_label[parcel_mass[n]]
        pr = parcels[i]['properties']
        add(il, 'parcels'); add(il, 'parcel_acres', parcel_geoms[n].area / M2_PER_ACRE)
        if (num(pr.get('WF_LGTH')) or 0) > 0: add(il, 'waterfront_parcels')
    buildings = load(os.path.join(RAW, 'buildings.geojson'))
    bg = geoms(buildings)
    bidx = [i for i, g in enumerate(bg) if g is not None and not g.is_empty]
    for i, il in zip(bidx, nearest1(shapely.point_on_surface([bg[i] for i in bidx]))):
        add(il, 'buildings'); add(il, 'building_sqft', bg[i].area * 10.7639)


    # ── Out ──
    for il, d in multi.items():
        for k, s in d.items(): acc[il][k] = len(s)
    acc_all = defaultdict(float)
    for il, d in acc.items():
        for k, v in d.items():
            if k != 'herring_grounds': acc_all[k] += v
    acc_all['herring_grounds'] = len(herring)

    def tidy(d):
        return {k: (round(v, 2) if isinstance(v, float) and not v.is_integer() else int(v)) for k, v in sorted(d.items())}

    # bbox per island, for "open on the map"
    bbox = {}
    for il in ISLANDS:
        ms = [m for m, l in zip(masses, mass_label) if l == il]
        if not ms: continue
        x0, y0, x1, y1 = shapely.union_all(ms).bounds
        (lo0, lo1), (la0, la1) = TO_LL.transform([x0, x1], [y0, y1])
        bbox[il] = [round(lo0, 4), round(la0, 4), round(lo1, 4), round(la1, 4)]

    out = {
        'built': date.today().isoformat(),
        'parcelsFetched': json.load(open(os.path.join(RAW, 'fetch.json'))).get('fetchedAt', '')[:10],
        'islands': [i for i in ISLANDS if i in acc],
        'bbox': bbox,
        'all': tidy(acc_all),
        'byIsland': {il: tidy(acc[il]) for il in ISLANDS if il in acc},
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(OUT, os.path.getsize(OUT), 'bytes')
    for il in out['islands']:
        d = out['byIsland'][il]
        print(f"  {il:14} parcels {d.get('parcels', 0):6}  shore {d.get('shore_mi', 0):7.1f} mi  kelp {d.get('kelp_acres', 0):7.1f} ac  docks {d.get('docks', 0):4}")


if __name__ == '__main__':
    main()
