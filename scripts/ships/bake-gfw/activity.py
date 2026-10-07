#!/usr/bin/env python3
"""
Estimated terminal calls and anchorage stays from GFW hourly positions (docs/SHIPS_ACTIVITY_FUSION.md, Part 2;
Josh 2026-10-06). GFW rows carry no speed and sit on 0.01° cell centres, so the rule is coarser than NOAA's:

  stopped row   "1 hour at slow or no speed" (Josh 2026-10-06): a row whose previous or next row of the same vessel is 1–2 h away
                and at most STOP_CELLS cells off in each direction (1 = same or touching cell, under ~0.8 kn averaged
                over the hour; GFW gives one position per hour and no speed, so speed is read from consecutive positions)
  terminal      a stopped row whose cell centre is within MATCH_KM of a berth counts at the nearest berth's terminal AND
                its NEIGHBOURS (terminals with a berth within NEIGHBOUR_KM of one of its berths; no chaining, Josh 2026-10-06:
                1.5 km chains made an 8-terminal North Vancouver group); the set is the stop's target and its candidates
  anchorage     a stopped row whose cell centre is inside an anchorage polygon; the smallest containing polygon wins. An
                anchorage that contains no grid cell centre (31 of 112 in the Salish area, circles about a cell wide) gets no
                estimates: the card says it is too small to estimate (2026-10-06). Tried and dropped: an edge buffer on every
                polygon (tripled stays at busy edges) and cell-overlap for the small ones (2–17% of their stays confirmed).
  call / stay   stopped rows of one vessel at one cluster / anchorage, sorted by time; a gap of more than GAP_H starts a
                new one; it counts with at least MIN_ROWS rows. t0 = first hour, t1 = last hour + 1 h.

  python3 activity.py --month 2026-06 --areas salish --out DIR [--match-km 0.65] [--anch-buffer-km 0.5]
      # reads RAW (fetch.py output), writes DIR/stops.csv + summary.json
Output columns: kind (terminal|anchorage), target (cluster id | anchorage id), terminal_nearest, mmsi, vid, name, gfw_type,
t0, t1, rows, min_km.
"""
import argparse, calendar, csv, gzip, json, math, os, time
from collections import defaultdict
import areas  # noqa: F401  (raw layout lives with the fetch config)

HERE = os.path.dirname(os.path.abspath(__file__))
RULE = dict(match_km=0.65, anch_buffer_km=0.0, neighbour_km=1.0, gap_h=6, min_rows=2, require_stopped=True, stop_cells=2, cell_deg=0.01)   # Josh 2026-10-06, from the Jun 2026 check (docs/SHIPS_ACTIVITY_CHECK_2026-06.md)


def km(la1, lo1, la2, lo2):
    r = math.pi / 180
    h = math.sin((la2 - la1) * r / 2) ** 2 + math.cos(la1 * r) * math.cos(la2 * r) * math.sin((lo2 - lo1) * r / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))


def inside(lo, la, ring):
    c = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
        if (y1 > la) != (y2 > la) and lo < (x2 - x1) * (la - y1) / (y2 - y1) + x1:
            c = not c
    return c


def seg_km(la, lo, a, b):
    """Distance in km from (la, lo) to segment a–b (lon, lat pairs), equirectangular around the point."""
    k = math.cos(la * math.pi / 180) * 111.32
    px, py = 0.0, 0.0
    ax, ay = (a[0] - lo) * k, (a[1] - la) * 110.57
    bx, by = (b[0] - lo) * k, (b[1] - la) * 110.57
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(ax + t * dx - px, ay + t * dy - py)


def poly_rings(g):
    polys = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    return [[[tuple(p[:2]) for p in poly[0]], [[tuple(p[:2]) for p in h] for h in poly[1:]]] for poly in polys]


def area_deg2(rings):
    s = 0
    for outer, _ in rings:
        s += abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(outer, outer[1:] + outer[:1]))) / 2
    return s


def load_rows(raw, area_names, ym):
    a = calendar.timegm(time.strptime(ym + '-01', '%Y-%m-%d'))
    y, m = map(int, ym.split('-'))
    b = calendar.timegm((y + (m == 12), m % 12 + 1, 1, 0, 0, 0))
    rows, ident = defaultdict(dict), {}
    for area in area_names:
        d = os.path.join(raw, area)
        for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if not f.endswith('.json.gz') or f.startswith('._'):   # ._ = macOS sidecar files on external drives
                continue
            for e in json.load(gzip.open(os.path.join(d, f))).get('entries') or []:
                for rs in (e or {}).values():
                    for r in rs or []:
                        t = calendar.timegm(time.strptime(r['date'], '%Y-%m-%d %H:%M'))
                        vid = r.get('vesselId')
                        if not vid or not a <= t < b:
                            continue
                        rows[vid].setdefault(t, (r['lat'], r['lon']))
                        ident.setdefault(vid, dict(mmsi=r.get('mmsi') or '', name=r.get('shipName') or '', gfw_type=r.get('vesselType') or ''))
    return {v: sorted(p.items()) for v, p in rows.items()}, ident


def stopped(pts):
    """Indexes of rows with a neighbour 1–2 h away in the same or a touching cell."""
    tol = RULE['cell_deg'] * (RULE['stop_cells'] + 0.01)
    out = []
    for i, (t, (la, lo)) in enumerate(pts):
        for j in (i - 1, i + 1):
            if 0 <= j < len(pts):
                t2, (la2, lo2) = pts[j]
                if 3600 <= abs(t2 - t) <= 7200 and abs(la2 - la) <= tol and abs(lo2 - lo) <= tol:
                    out.append(i); break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--month', required=True)
    ap.add_argument('--areas', default='salish')
    ap.add_argument('--raw', default=os.environ.get('GFW_RAW', os.path.join(HERE, 'cache', 'raw')))
    ap.add_argument('--inputs', default=os.path.join(HERE, 'activity_inputs.json'))
    ap.add_argument('--out', required=True)
    ap.add_argument('--match-km', type=float, default=RULE['match_km'])
    ap.add_argument('--anch-buffer-km', type=float, default=RULE['anch_buffer_km'])
    ap.add_argument('--neighbour-km', type=float, default=RULE['neighbour_km'], help='0 = the chained clusters in the inputs file')
    ap.add_argument('--min-rows', type=int, default=RULE['min_rows'])
    ap.add_argument('--stop-cells', type=int, default=RULE['stop_cells'])
    ap.add_argument('--any-row', action='store_true', help='count rows near a berth even without a stopped neighbour row (test)')
    a = ap.parse_args()
    RULE.update(match_km=a.match_km, anch_buffer_km=a.anch_buffer_km, neighbour_km=a.neighbour_km, min_rows=a.min_rows, stop_cells=a.stop_cells, require_stopped=not a.any_row)
    inp = json.load(open(a.inputs))
    berths = inp['berths']
    group = {}
    for b in berths:
        if RULE['neighbour_km'] <= 0:
            group[b['terminal']] = b['cluster']
            continue
        near = {c['terminal'] for c in berths for d in berths if d['terminal'] == b['terminal'] and km(c['lat'], c['lon'], d['lat'], d['lon']) <= RULE['neighbour_km']}
        group[b['terminal']] = '+'.join(sorted(near)) if len(near) > 1 else b['terminal']
    anch = []
    for x in inp['anchorages']:
        rings = poly_rings(x['geometry'])
        xs = [p[0] for o, _ in rings for p in o]; ys = [p[1] for o, _ in rings for p in o]
        anch.append(dict(id=x['key'], rings=rings, bb=(min(xs), min(ys), max(xs), max(ys)), area=area_deg2(rings)))
    anch.sort(key=lambda z: z['area'])   # smallest containing polygon wins
    # The boxes estimated (areas.py), kept in the rule: a card outside them says "not estimated here", never ≈0 (2026-10-07: Texada,
    # Squamish and Woodfibre lie north of the salish area and read ≈0).
    names = a.areas.split(',')
    RULE['area_boxes'] = [list(t[1:]) for t in areas.stage('pacnw') if t[0] in names]
    pts, ident = load_rows(a.raw, names, a.month)
    hits = defaultdict(list)   # (kind, target, vid) -> [(t, km, nearest terminal)]
    pad = RULE['match_km'] / 111.0
    for vid, p in pts.items():
        for i in (stopped(p) if RULE['require_stopped'] else range(len(p))):
            t, (la, lo) = p[i]
            best = None
            for b in berths:
                if abs(b['lat'] - la) > pad or abs(b['lon'] - lo) > pad * 2:
                    continue
                d = km(la, lo, b['lat'], b['lon'])
                if d <= RULE['match_km'] and (best is None or d < best[0]):
                    best = (d, b)
            if best:
                hits[('terminal', group[best[1]['terminal']], vid)].append((t, best[0], best[1]['terminal']))
            buf = RULE['anch_buffer_km']
            bdeg = buf / 111.0
            for z in anch:
                w, s, e, n = z['bb']
                if not (w - bdeg * 2 <= lo <= e + bdeg * 2 and s - bdeg <= la <= n + bdeg):
                    continue
                if any(inside(lo, la, o) and not any(inside(lo, la, h) for h in hs) for o, hs in z['rings']):
                    hits[('anchorage', z['id'], vid)].append((t, 0.0, '')); break
                if buf > 0:
                    d = min(seg_km(la, lo, p1, p2) for o, _ in z['rings'] for p1, p2 in zip(o, o[1:] + o[:1]))
                    if d <= buf:
                        hits[('anchorage', z['id'], vid)].append((t, round(d, 3), '')); break
    os.makedirs(a.out, exist_ok=True)
    n = defaultdict(int)
    with open(os.path.join(a.out, 'stops.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['kind', 'target', 'terminal_nearest', 'mmsi', 'vid', 'name', 'gfw_type', 't0', 't1', 'rows', 'min_km'])
        for (kind, target, vid), hs in sorted(hits.items(), key=lambda kv: (kv[0][0], str(kv[0][1]), kv[0][2])):
            hs.sort()
            run = [hs[0]]
            for h in hs[1:] + [None]:
                if h is not None and h[0] - run[-1][0] <= RULE['gap_h'] * 3600:
                    run.append(h); continue
                if len(run) >= RULE['min_rows']:
                    near = min(run, key=lambda r: r[1])
                    idn = ident[vid]
                    w.writerow([kind, target, near[2], idn['mmsi'], vid, idn['name'], idn['gfw_type'], run[0][0], run[-1][0] + 3600, len(run), round(near[1], 3)])
                    n[kind] += 1
                if h is not None:
                    run = [h]
    json.dump(dict(rule=RULE, month=a.month, areas=a.areas, vessels=len(pts), counts=n), open(os.path.join(a.out, 'summary.json'), 'w'), indent=1)
    print(json.dumps(dict(vessels=len(pts), **n)))


if __name__ == '__main__':
    main()
