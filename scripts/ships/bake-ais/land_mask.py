#!/usr/bin/env python3
"""
Inland grid for the /ships track bake: cells more than INLAND_M metres inside land.

A position in one of these cells can't be a ship at sea. Real case: LINNEA
ROSE's transponder crossed San Juan Island at up to 38 kn (road speed) and sat
1.5–3.8 km inland (2026-06-21/23), most likely on a trailer. build_tracks.py
doesn't draw such positions and splits a track where it leaves the water. The
raw positions stay in the cache as evidence.

Land = /shiptraffic's GSHHG full-resolution outline clipped to the region
(scripts/bake-shiptraffic/salish_land.geojson), shrunk by INLAND_M in UTM
10N metres. Shoreline, marinas and bluffs within INLAND_M of the water are
never touched.

Also writes cache/land/salish-land-0m.parquet: every land cell with no
shrinking, used to test the straight LINE between two water positions (a
narrow isthmus has no deep-inland cells, but a line straight across it is still
over land).

Output: cache/land/salish-inland-500m.parquet, column `cell` (int64), where
cell = row * NX + col on a CELL_DEG grid anchored at the bbox south-west
corner. Built once; re-run only if the outline, bbox or parameters change.
"""
import json, os
import numpy as np
import shapely
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer
import duckdb

HERE = os.path.dirname(os.path.abspath(__file__))
LAND = os.path.join(HERE, "..", "..", "bake-shiptraffic", "salish_land.geojson")
BBOX = dict(w=-124.85, s=47.0, e=-122.05, n=49.0)  # same as fetch_points.py
CELL_DEG = 0.0005   # ~37 m lat × ~37 m lon at 48°N
INLAND_M = 500
OUT = os.path.join(HERE, "cache", "land", f"salish-inland-{INLAND_M}m.parquet")
OUT_LAND = os.path.join(HERE, "cache", "land", "salish-land-0m.parquet")
NX = int(round((BBOX["e"] - BBOX["w"]) / CELL_DEG))
NY = int(round((BBOX["n"] - BBOX["s"]) / CELL_DEG))


def rasterize(geom, out):
    shapely.prepare(geom)
    cells = []
    xs = BBOX["w"] + (np.arange(NX) + 0.5) * CELL_DEG
    for j in range(NY):  # row by row keeps memory flat
        y = BBOX["s"] + (j + 0.5) * CELL_DEG
        hit = shapely.contains_xy(geom, xs, np.full(NX, y))
        cells.append(np.nonzero(hit)[0].astype(np.int64) + j * NX)
    cells = np.concatenate(cells)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    con = duckdb.connect()
    con.register("c", {"cell": cells})
    con.execute(f"COPY (SELECT cell FROM c ORDER BY cell) TO '{out}' (FORMAT parquet)")
    print(f"{len(cells):,} cells of {NX * NY:,} → {out}")


def main():
    land = shape(json.load(open(LAND)))
    to_utm = Transformer.from_crs(4326, 32610, always_xy=True).transform
    to_ll = Transformer.from_crs(32610, 4326, always_xy=True).transform
    rasterize(transform(to_ll, transform(to_utm, land).buffer(-INLAND_M)), OUT)
    rasterize(land, OUT_LAND)


if __name__ == "__main__":
    main()
