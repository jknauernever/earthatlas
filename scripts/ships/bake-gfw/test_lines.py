#!/usr/bin/env python3
"""Offline checks for lines.py (no network, no land data):  python3 scripts/ships/bake-gfw/test_lines.py"""
import lines as L

H = 3600


def test_antimeridian_split():
    # east → west across 180 (the Bering Sea bands of 2026-09-29 were exactly this)
    parts = L.to180_parts([(62.0, 179.9), (62.1, 180.2), (62.2, 180.4)])
    assert len(parts) == 2 and parts[0][-1][0] == 180.0 and parts[1][0][0] == -180.0, parts
    # west → east, from unwrapped negative longitudes
    parts = L.to180_parts([(52.0, -179.8), (52.1, -180.3)])
    assert len(parts) == 2 and parts[0][-1][0] == -180.0 and parts[1][0][0] == 180.0, parts
    # a vertex exactly on 180
    parts = L.to180_parts([(50.0, 179.9), (50.0, 180.0), (50.1, 180.3)])
    assert all(abs(a[0] - b[0]) <= 180 for p in parts for a, b in zip(p, p[1:])), parts


def test_split_raw_rules():
    seq = [(0, (54.0, -130.0)), (H, (54.1, -130.0)),             # 11 km in 1 h: kept
           (5 * H, (54.2, -130.0)),                               # 4 h gap: break
           (6 * H, (55.2, -130.0))]                               # 111 km in 1 h = 60 kn: break
    pieces = L.split_raw(seq)
    assert [len(p) for p in pieces] == [2, 1, 1], pieces
    # the dateline: 179.95 → -179.95 is ~7 km, not 360°
    pieces = L.split_raw([(0, (52.0, 179.95)), (H, (52.0, -179.95))])
    assert len(pieces) == 1 and abs(pieces[0][1][2] - 180.05) < 1e-9, pieces


def test_parked():
    moored = [(k * H, 54.0 + (k % 2) * 0.01, -130.0) for k in range(10)]   # flips between two cells, ~1.1 km
    assert not L.drawable(moored)
    moving = [(k * H, 54.0 + k * 0.1, -130.0) for k in range(5)]
    assert L.drawable(moving)


def test_traffic_lookup():
    import traffic as TR
    tr = TR.Traffic.from_tracks({'a': [(0, (58.30, -134.40)), (3600, (58.31, -134.41))], 'b': [(0, (58.30, -134.40))]})
    assert list(tr.lookup([58.30, 58.31, 58.32], [-134.40, -134.41, -134.40])) == [2, 1, 0]
    m = tr.merged(tr)
    assert list(m.lookup([58.30], [-134.40])) == [4]
    # the antimeridian: 180.00 and -180.00 are the same cell
    t2 = TR.Traffic.from_tracks({'c': [(0, (52.0, 180.0))]})
    assert list(t2.lookup([52.0], [-180.0])) == [1]


if __name__ == "__main__":
    for name, f in list(globals().items()):
        if name.startswith('test_'):
            f(); print('ok', name)
