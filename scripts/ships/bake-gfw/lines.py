"""
GFW hourly positions → track lines, with water routing (scripts/ships/bake-gfw/).

Rules (docs/SHIP_TRACK_SOURCES.md, "GFW hourly lines"):
  - One row per GFW vessel id and hour; "YYYY-MM-DD HH:00" is UTC (verified against NOAA points).
  - Break a line at a gap > GAP_H hours (real time difference between consecutive rows), at a
    straight-line speed > MAX_KN (great-circle distance, so across the antimeridian too), and at
    month boundaries (each month is its own tileset).
  - Drop lines with < 2 distinct cells or an extent < PARKED_M (a moored ship flipping cells).
  - Positions on land move to the nearest water within NUDGE_MAX_M, else are dropped (line breaks).
  - A segment with >= LAND_MIN_M of land along it is replaced by the shortest 8-connected water
    path on a ~CELL_M raster window, string-pulled into straight water-only legs; no path in the
    window, or path length / time > MAX_KN → the line breaks there. Routed stretches are separate
    features with est=1 (drawn dashed: "path between hourly positions estimated along the water").
  - Tidal flats, marsh, mud and shoals are land (fetch_flats.py). The path cost is traffic-weighted
    (traffic.py): cost 1 where >= 3 distinct vessels were seen in the 0.01° cell (±600 m), 1.6 where
    1–2, 8 where none. If the path has no water route in its window, or more than 10% of it runs
    where no ship has been, it is searched again in a much bigger window (pad max(15 km, 1 x length))
    and the lower traffic-weighted cost wins (Juneau: around Douglas Island, not across the
    Mendenhall Wetlands). String-pulling may not straighten a leg into costlier water.
Longitudes are native -180..180. Along a line each vertex is unwrapped to within 180° of the
previous one (so a segment across the antimeridian is short), and output lines are split at ±180.
"""
import math
from collections import Counter
import numpy as np

GAP_H = 3
MAX_KN = 40
PARKED_M = 1500
NUDGE_MAX_M = 2000
LAND_MIN_M = 150
CELL_M = 50
PAD_MIN_M = 4000
RETRY_PAD_M = 15000   # second, bigger window: no water path, or the path is mostly where no ship has been
NONE_FRAC_RETRY = 0.10
NONE_COST_LEVEL = 8.0  # = traffic.NONE_COST
WIN_MAX_CELLS = 1400
SAMPLE_M = 40
KN = 1852 / 3600
RULES = dict(version='gfw-v1', gap_h=GAP_H, max_kn=MAX_KN, parked_m=PARKED_M, nudge_max_m=NUDGE_MAX_M, land_min_m=LAND_MIN_M,
             cell_m=CELL_M, pad_min_m=PAD_MIN_M, retry_pad_m=RETRY_PAD_M, win_max_cells=WIN_MAX_CELLS, sample_m=SAMPLE_M, string_pull=True,
             flats_not_navigable=True, traffic_cost=dict(busy_vessels=3, busy=1.0, some=1.6, none=8.0, lane_m=600, retry_if_none_frac=0.10))

# GFW vesselType → our kind groups (the Ship tracks "Kind of ship" chips). GFW's CARGO includes
# tankers; exact sub-kinds (oil tanker, …) come from the MMSI-based "Narrow to" chips.
KIND = {'FISHING': 'fishing', 'PASSENGER': 'passenger', 'CARGO': 'cargo', 'CARRIER': 'cargo', 'TANKER': 'tanker',
        'BUNKER': 'tanker', 'SUPPORT': 'other', 'SEISMIC_VESSEL': 'other', 'OTHER_NON_FISHING': 'other',
        'OTHER': 'other', 'GEAR': 'other', 'DISCREPANCY': 'unknown', 'INSUFFICIENT_DATA': 'unknown', 'INACTIVE': 'unknown', '': 'unknown'}  # INACTIVE: GFW v5


def hav_m(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * np.arcsin(np.sqrt(np.minimum(1, a)))


def unwrap(prev_lon, lon):
    while lon - prev_lon > 180:
        lon -= 360
    while lon - prev_lon < -180:
        lon += 360
    return lon


def kmbin(km):
    for b in (1, 5, 10, 25, 50, 75, 100, 150):
        if km < b:
            return f'<{b}'
    return '>=150'


def split_raw(seq):
    """seq [(t, (lat, lon))] sorted by t → pieces [[(t, lat, lon_unwrapped)…]]."""
    pieces, cur = [], []
    for t, (la, lo) in seq:
        if cur:
            t0, la0, lo0 = cur[-1]
            lo = unwrap(lo0, lo)
            dt = t - t0
            if dt > GAP_H * 3600 or float(hav_m(la0, lo0, la, lo)) / dt > MAX_KN * KN:
                pieces.append(cur); cur = []
        cur.append((t, la, lo))
    if cur:
        pieces.append(cur)
    return pieces


def drawable(p):
    if len({(x[1], x[2]) for x in p}) < 2:
        return False
    la = [x[1] for x in p]; lo = [x[2] for x in p]
    return float(hav_m(min(la), min(lo), max(la), max(lo))) >= PARKED_M


class Router:
    """Water routing against a land.Land; caches per worker process."""
    TILE = 0.1
    TCELLS = 240

    def __init__(self, land, traffic=None):
        self.land = land
        self.traffic = traffic   # traffic.Traffic: cheaper where ships have been (None = uniform cost)
        self.tiles, self.nudges, self.routes = {}, {}, {}

    def tile(self, ix, iy):
        k = (ix, iy)
        g = self.tiles.get(k)
        if g is None:
            w, s = ix * self.TILE, iy * self.TILE
            nx = max(40, int(round(self.TCELLS * math.cos(math.radians(s + self.TILE / 2)))))
            g = self.land.window(w, s, w + self.TILE, s + self.TILE, nx, self.TCELLS)
            if len(self.tiles) > 6000:
                self.tiles.clear()
            self.tiles[k] = g
        return g

    def is_land(self, lat, lon):
        lon = (lon + 180) % 360 - 180
        ix, iy = int(math.floor(lon / self.TILE)), int(math.floor(lat / self.TILE))
        g = self.tile(ix, iy)
        ny, nx = g.shape
        j = min(ny - 1, max(0, int((iy * self.TILE + self.TILE - lat) / self.TILE * ny)))
        i = min(nx - 1, max(0, int((lon - ix * self.TILE) / self.TILE * nx)))
        return bool(g[j, i])

    def nudge(self, lat, lon):
        k = (lat, lon)
        if k not in self.nudges:
            if len(self.nudges) > 200000:
                self.nudges.clear()
            self.nudges[k] = self._nudge(lat, lon)
        return self.nudges[k]

    def _nudge(self, lat, lon):
        from scipy import ndimage
        dlat = NUDGE_MAX_M / 111320
        dlon = dlat / max(0.05, math.cos(math.radians(lat)))
        ny = nx = int(2 * NUDGE_MAX_M / CELL_M)
        g = self.land.window(lon - dlon, lat - dlat, lon + dlon, lat + dlat, nx, ny)
        if g.all():
            return None
        dist, (jj, ii) = ndimage.distance_transform_edt(g, return_indices=True)
        c = ny // 2
        if dist[c, c] * CELL_M > NUDGE_MAX_M:
            return None
        j, i = jj[c, c], ii[c, c]
        return (lat + dlat - (j + 0.5) * 2 * dlat / ny, lon - dlon + (i + 0.5) * 2 * dlon / nx)

    def land_len_m(self, a, b):
        d = float(hav_m(a[0], a[1], b[0], b[1]))
        n = max(2, int(d / SAMPLE_M))
        k = sum(1 for s_ in range(1, n) if self.is_land(a[0] + (b[0] - a[0]) * s_ / n, a[1] + (b[1] - a[1]) * s_ / n))
        return k * d / n

    @staticmethod
    def visible(g, a, b, cost=None, pmax=None):
        """The straight line a→b stays on water, and (with traffic) never enters costlier water than
        the path it replaces (so string-pulling can't cut a corner away from a lane)."""
        n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * 2) + 1
        jj = np.rint(np.linspace(a[0], b[0], n + 1)).astype(int)
        ii = np.rint(np.linspace(a[1], b[1], n + 1)).astype(int)
        if g[jj, ii].any():
            return False
        return cost is None or cost[jj, ii].max() <= pmax

    def pull_string(self, g, path, cost=None):
        """Grid paths are 0/45/90° staircases: keep the fewest straight water-only legs."""
        if len(path) < 3:
            return path
        pc = None if cost is None else np.array([cost[j, i] for j, i in path])
        vis = lambda k, m: self.visible(g, path[k], path[m], cost, None if pc is None else pc[k:m + 1].max())
        out, k, n = [path[0]], 0, len(path)
        while k < n - 1:
            step, hi = 1, k + 1
            while k + step < n and vis(k, k + step):
                hi = k + step; step *= 2
            lo, top = hi, min(n - 1, k + step)
            while lo < top - 1:
                mid = (lo + top) // 2
                if vis(k, mid):
                    lo = mid
                else:
                    top = mid
            k = max(lo, k + 1)
            out.append(path[k])
        return out

    def route(self, a, b, dt):
        k = (round(a[0], 4), round(a[1], 4), round(b[0], 4), round(b[1], 4))
        if k not in self.routes:
            if len(self.routes) > 100000:
                self.routes.clear()
            self.routes[k] = self._route(a, b)
        ll, L = self.routes[k]
        if ll is None:
            return None, L
        if L / dt > MAX_KN * KN:
            return None, 'too_long_for_time'
        return ll, L

    def _route(self, a, b):
        d = float(hav_m(a[0], a[1], b[0], b[1]))
        r1 = self._route_in(a, b, max(PAD_MIN_M, 0.35 * d))
        # Once more in a much bigger window when there is no water path (e.g. around a whole island), or when
        # the path mostly runs where no ship has been (Josh 2026-09-30: cruise ships across the Mendenhall
        # Wetlands instead of around Douglas Island). The lower traffic-weighted cost wins.
        if r1[0] is None and r1[1] == 'no_water_path' or r1[0] is not None and r1[3] > NONE_FRAC_RETRY:
            r2 = self._route_in(a, b, max(RETRY_PAD_M, 1.0 * d))
            if r2[0] is not None and (r1[0] is None or r2[2] < r1[2]):
                self.retried = getattr(self, 'retried', 0) + 1
                r1 = r2
        return r1[0], r1[1]

    def _route_in(self, a, b, pad):
        from skimage.graph import MCP_Geometric
        from scipy import ndimage
        kx = 111320 * max(0.05, math.cos(math.radians((a[0] + b[0]) / 2)))
        s_, n_ = min(a[0], b[0]) - pad / 111320, max(a[0], b[0]) + pad / 111320
        w_, e_ = min(a[1], b[1]) - pad / kx, max(a[1], b[1]) + pad / kx
        hm, wm = (n_ - s_) * 111320, (e_ - w_) * kx
        cell = max(CELL_M, max(hm, wm) / WIN_MAX_CELLS)
        ny, nx = max(3, int(hm / cell)), max(3, int(wm / cell))
        g = self.land.window(w_, s_, e_, n_, nx, ny)
        toij = lambda p: (min(ny - 1, max(0, int((n_ - p[0]) / (n_ - s_) * ny))), min(nx - 1, max(0, int((p[1] - w_) / (e_ - w_) * nx))))
        ij = [toij(a), toij(b)]
        if g[ij[0]] or g[ij[1]]:
            dist, (jj, ii) = ndimage.distance_transform_edt(g, return_indices=True)
            for q in (0, 1):
                if g[ij[q]]:
                    if dist[ij[q]] * cell > 1500:
                        return None, 'endpoint_on_land', None, None
                    ij[q] = (int(jj[ij[q]]), int(ii[ij[q]]))
        cost = self.traffic.cost_window(w_, s_, e_, n_, nx, ny, cell) if self.traffic is not None else None
        m = MCP_Geometric(np.where(g, np.inf, 1.0 if cost is None else cost), fully_connected=True)
        cum, _ = m.find_costs([ij[0]], [ij[1]])
        if not np.isfinite(cum[ij[1]]):
            return None, 'no_water_path', None, None
        grid = [tuple(ij[0])] + list(m.traceback(ij[1]))[1:]
        wcost = float(cum[ij[1]]) * cell                          # traffic-weighted metres
        none_frac = 0.0 if cost is None else float(np.mean([cost[j, i] >= NONE_COST_LEVEL for j, i in grid]))
        path = self.pull_string(g, grid, cost)
        ll = [(n_ - (j + 0.5) / ny * (n_ - s_), w_ + (i + 0.5) / nx * (e_ - w_)) for j, i in path]
        ll = [a] + ll[1:-1] + [b]
        L = float(sum(hav_m(p[0], p[1], q[0], q[1]) for p, q in zip(ll, ll[1:])))
        return ll, L, wcost, none_frac

    def piece(self, piece):
        """One raw piece → ([(est, [(lat, lon)…], t0, t1, n)], Counter)."""
        c = Counter()
        pts = []
        for t, la, lo in piece:
            if self.is_land(la, lo):
                nz = self.nudge(la, lo)
                if nz is None:
                    c['points_inland_dropped'] += 1
                    pts.append((t, None)); continue
                c['points_nudged'] += 1
                pts.append((t, nz))
            else:
                pts.append((t, (la, lo)))
        runs, obs = [], None   # obs = [coords, t0, t_last, n]

        def flush():
            nonlocal obs
            if obs and len(obs[0]) >= 2:
                runs.append((0, obs[0], obs[1], obs[2], obs[3]))
            obs = None
        prev = None
        for t, p in pts:
            if p is None:
                flush(); prev = None; c['breaks_inland'] += 1; continue
            if prev is None:
                obs = [[p], t, t, 1]; prev = (t, p); continue
            pt, pp = prev
            c['segments'] += 1
            c['seg_km_' + kmbin(float(hav_m(pp[0], pp[1], p[0], p[1])) / 1000)] += 1
            if pp == p:
                obs[2] = t; obs[3] += 1; prev = (t, p); continue
            if self.land_len_m(pp, p) >= LAND_MIN_M:
                c['segments_crossing_land'] += 1
                r0 = getattr(self, 'retried', 0)
                r, info = self.route(pp, p, t - pt)
                if getattr(self, 'retried', 0) > r0:
                    c['route_found_on_retry_window'] += 1
                if r is None:
                    c['route_failed_' + info] += 1
                    flush(); obs = [[p], t, t, 1]; prev = (t, p); continue
                c['segments_routed'] += 1
                c['routed_path_km_' + kmbin(info / 1000)] += 1
                ratio = info / max(1.0, float(hav_m(pp[0], pp[1], p[0], p[1])))
                c['routed_detour_x' + ('<1.2' if ratio < 1.2 else '<1.5' if ratio < 1.5 else '<2' if ratio < 2 else '<3' if ratio < 3 else '>=3')] += 1
                flush()
                runs.append((1, r, pt, t, 2))
                obs = [[p], t, t, 1]
            else:
                obs[0].append(p); obs[2] = t; obs[3] += 1
            prev = (t, p)
        flush()
        return runs, c


def to180_parts(coords):
    """[(lat, lon unwrapped)] → [[lon, lat]…] parts in -180..180, split at the antimeridian."""
    parts, cur, prev = [], [], None
    for la, lo in coords:
        if prev is not None:
            pla, plo = prev
            k0, k1 = math.floor((plo + 180) / 360), math.floor((lo + 180) / 360)   # which 360° band
            if k0 != k1:
                edge = 360 * max(k0, k1) - 180                                     # the ±180 line crossed (unwrapped)
                f = (edge - plo) / (lo - plo)
                ym = round(pla + (la - pla) * f, 5)
                cur.append([180.0 if k1 > k0 else -180.0, ym])
                parts.append(cur)
                cur = [[-180.0 if k1 > k0 else 180.0, ym]]
        x = (lo + 180) % 360 - 180
        cur.append([round(x, 5), round(la, 5)])
        prev = (la, lo)
    parts.append(cur)
    out = []
    for p in parts:
        q = [c for i, c in enumerate(p) if i == 0 or c != p[i - 1]]
        if len(q) >= 2:
            assert all(abs(q[i][0] - q[i + 1][0]) <= 180 for i in range(len(q) - 1)), 'antimeridian jump'
            out.append(q)
    return out
