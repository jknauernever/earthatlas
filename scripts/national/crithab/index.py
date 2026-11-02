"""
Critical habitat near a point, for any consumer (the /spills state bake, later others): load the caches crithab/build.py
leaves in data/national/crithab/work once, then `near(lon, lat, meters)` → [[species index, meters], …], nearest first,
and `species` (the list those indexes point into).
"""
import json, os, pickle, sys
import shapely
from shapely.geometry import Point
from shapely.strtree import STRtree

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from lib import ds, zone_of, FWD  # noqa: E402

species = json.load(open(ds('crithab', 'work', 'crithab_species.json')))
_zones = {}
for zid, (wkbs, idx) in pickle.load(open(ds('crithab', 'work', 'crithab_zones.pkl'), 'rb')).items():
    geoms = list(shapely.from_wkb(wkbs))
    _zones[zid] = (STRtree(geoms), geoms, idx)


def near(lon, lat, R):
    z = zone_of(lon, lat)
    if not z or z not in _zones:
        return []
    tree, geoms, idx = _zones[z]
    x, y = FWD[z](lon, lat)
    pt = Point(x, y)
    best = {}
    for k in tree.query(pt, predicate='dwithin', distance=R):
        d = round(geoms[k].distance(pt) / 100) * 100
        best[idx[k]] = min(d, best.get(idx[k], d))
    return sorted([[s, d] for s, d in best.items()], key=lambda x: x[1])
