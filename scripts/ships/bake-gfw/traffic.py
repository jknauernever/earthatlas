"""
Traffic raster for traffic-informed water routing (Josh 2026-09-30).

Cells are GFW's own 0.01° cells (the hourly positions are snapped to their centres, so a finer
grid would add nothing). The value is the number of DISTINCT vessels seen in the cell (a moored
ship's thousand hours count once). Routing cost (lines.Router) is lower where ships go:
    traffic ≥ BUSY vessels → cost 1;  1..BUSY-1 → cost 1.6;  none → cost NONE_COST (8)
after widening each cell by ~LANE_M (a lane is wider than one 0.01° cell). Unvisited water
stays possible, just disfavoured.

Sources (bake.py route): every per-month raster in cache/land/traffic-v1/YYYY-MM.npz (written by
`bake.py traffic`, one file per month, so a re-fetched month replaces its own file), plus the month
being baked when its file isn't there yet. So the cost surface improves as months accumulate.
In the workflow each fetch job writes its month's raster (artifact); every route job reads the
cumulative set restored from the Actions cache plus this run's new months; a final job saves the
merged set back to the cache (key gfw-traffic-v1-<run id>). Locally the set holds every raw month.
Not weighted by vessel size (GFW hourly rows carry no length); every distinct vessel counts once.
"""
import os
import numpy as np

BUSY = 3
NONE_COST = 8.0
SOME_COST = 1.6
LANE_M = 600
_K = 100000   # key = iy * _K + (ix + 18000)


def key(lat, lon):
    iy = np.floor(np.asarray(lat) * 100 + 0.5).astype(np.int64)
    lon = (np.asarray(lon) + 180) % 360 - 180
    ix = np.floor(lon * 100 + 0.5).astype(np.int64)
    return iy * _K + (ix + 18000)


class Traffic:
    def __init__(self, keys=None, counts=None):
        self.keys = np.asarray(keys if keys is not None else [], np.int64)
        self.counts = np.asarray(counts if counts is not None else [], np.int32)

    @classmethod
    def from_tracks(cls, tracks):
        """tracks {vid: [(t, (lat, lon))…]} → distinct vessels per cell."""
        ks = [np.unique(key([p[0] for _, p in seq], [p[1] for _, p in seq])) for seq in tracks.values() if seq]
        if not ks:
            return cls()
        u, c = np.unique(np.concatenate(ks), return_counts=True)
        return cls(u, c)

    def merged(self, other):
        if not len(other.keys):
            return self
        if not len(self.keys):
            return other
        k = np.concatenate([self.keys, other.keys]); c = np.concatenate([self.counts, other.counts])
        u, inv = np.unique(k, return_inverse=True)
        return Traffic(u, np.bincount(inv, weights=c).astype(np.int32))

    def save(self, f):
        np.savez_compressed(f + '.tmp.npz', keys=self.keys, counts=self.counts); os.replace(f + '.tmp.npz', f)

    @classmethod
    def load(cls, f):
        z = np.load(f)
        return cls(z['keys'], z['counts'])

    def lookup(self, lat, lon):
        k = key(lat, lon).ravel()
        if not len(self.keys):
            return np.zeros(k.shape, np.int32).reshape(np.shape(lat))
        i = np.clip(np.searchsorted(self.keys, k), 0, len(self.keys) - 1)
        return np.where(self.keys[i] == k, self.counts[i], 0).reshape(np.shape(lat))

    def cost_window(self, w, s, e, n, nx, ny, cell_m):
        """Cost multiplier grid (row 0 = north) for a routing window."""
        from scipy import ndimage
        xs = w + (np.arange(nx) + 0.5) * (e - w) / nx
        ys = n - (np.arange(ny) + 0.5) * (n - s) / ny
        X, Y = np.meshgrid(xs, ys)
        t = self.lookup(Y, X)
        r = max(1, int(round(LANE_M / cell_m)))
        t = ndimage.maximum_filter(t, size=2 * r + 1)
        return np.where(t >= BUSY, 1.0, np.where(t > 0, SOME_COST, NONE_COST))
