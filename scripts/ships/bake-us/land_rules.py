"""
Over-land rules for the US /ships tracks, shared by the bakes (build_us_tracks.py, build_us_points.py) and the
re-filter of published months (add_classes.py --land). Needs only numpy.

A vertex in a deep-inland cell (national dataset `deep-inland`, scripts/national/deep-inland/: land more than 500 m from
any sea, river or lake of ~1 km² or more) is not drawn and the line is cut there; a segment between two kept vertices
is sampled every LAND_STEP_KM and cut where a sample is inland. So a boat on a trailer, a transponder in a truck or a
drifting GPS fix never draws a "ship track" across land. The source keeps the positions as evidence.
"""
import os
import sys

import numpy as np

LAND_STEP_KM = 0.25
_GRID = None


def haversine_km(lon1, lat1, lon2, lat2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(np.minimum(a, 1)))


def span_m(c):
    """Extent of a line [[lon, lat]…] in metres (diagonal of its box): under PARKED_M it is a moored boat's jitter."""
    lat = c[:, 1]
    return np.hypot((lat.max() - lat.min()) * 111320, (c[:, 0].max() - c[:, 0].min()) * 111320 * np.cos(np.radians(lat.mean())))


def grid():
    """The national deep-inland grid, loaded once per process ($DEEP_INLAND_SOURCE: a build folder or catalog URL;
    default: the newest local build, else the published version)."""
    global _GRID
    if _GRID is None:
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'national', 'deep-inland'))
        from inland import DeepInland
        _GRID = DeepInland.load(os.environ.get('DEEP_INLAND_SOURCE') or None)
    return _GRID


def stats():
    return dict(inland_vertices=0, inland_not_drawn=0, land_crossing_splits=0)


def describe():
    return dict(**grid().describe(), land_step_km=LAND_STEP_KM)


def land_split(c, st):
    """A line (ndarray [[lon, lat]…]) → the pieces to draw. Pieces under 2 vertices are not drawn."""
    c = np.asarray(c, dtype=np.float64)
    g = grid()
    inl = g.at(c[:, 0], c[:, 1])
    cut = inl[:-1] | inl[1:]
    km = haversine_km(c[:-1, 0], c[:-1, 1], c[1:, 0], c[1:, 1])
    cand = np.nonzero(~cut & (km > LAND_STEP_KM))[0]
    if len(cand):
        k = np.ceil(km[cand] / LAND_STEP_KM).astype(np.int64)          # k-1 interior samples per segment
        seg = np.repeat(cand, k - 1)
        f = (np.arange(len(seg)) - np.repeat(np.cumsum(k - 1) - (k - 1), k - 1) + 1) / np.repeat(k, k - 1)
        hit = g.at(c[seg, 0] + (c[seg + 1, 0] - c[seg, 0]) * f, c[seg, 1] + (c[seg + 1, 1] - c[seg, 1]) * f)
        crossed = np.unique(seg[hit])
        cut[crossed] = True
        st['land_crossing_splits'] += len(crossed)
    if not cut.any():
        return [c]
    st['inland_vertices'] += int(inl.sum())
    out = []
    starts = np.concatenate([[0], np.nonzero(cut)[0] + 1])
    ends = np.concatenate([starts[1:], [len(c)]])
    for a, b in zip(starts, ends):
        if inl[a]:
            st['inland_not_drawn'] += 1
        elif b - a >= 2:
            out.append(c[a:b])
    return out
