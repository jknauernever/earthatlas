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

Output (per region.py; salish-v5 names shown): cache/land/salish-inland-500m.parquet, column `cell` (int64), where
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
import region

HERE = os.path.dirname(os.path.abspath(__file__))
LAND = region.R["land"]   # region.py (SHIPS_REGION) picks box + outline
BBOX = region.BBOX
CELL_DEG = 0.0005   # ~37 m lat × ~37 m lon at 48°N
INLAND_M = 500
OUT = os.path.join(region.R["land_cache"], f"{region.R['land_prefix']}-inland-{INLAND_M}m.parquet")
OUT_LAND = os.path.join(region.R["land_cache"], f"{region.R['land_prefix']}-land-0m.parquet")
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


def write_cells(grid, out):
    """grid: bool [NY, NX], row 0 = south. Same parquet layout as rasterize()."""
    cells = np.flatnonzero(grid).astype(np.int64)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    con = duckdb.connect()
    con.register("c", {"cell": cells})
    con.execute(f"COPY (SELECT cell FROM c ORDER BY cell) TO '{out}' (FORMAT parquet)")
    print(f"{len(cells):,} cells of {NX * NY:,} → {out}")


def grid_main():
    """Big outlines (OSM, 6k polygons): shapely's buffer(-500 m) on the whole outline ran 8 h without finishing.
    Burn the outline into the cell grid with GDAL (a cell is land when its centre is, as contains_xy), then
    shrink by INLAND_M on the grid: a cell is inland when every cell within INLAND_M of it is land. Same result
    as the vector buffer to within one cell (~40–55 m). Outside the box counts as land (no invented shoreline)."""
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        raw = os.path.join(tmp, "land.bin")
        subprocess.run(["gdal_rasterize", "-q", "-burn", "1", "-ot", "Byte", "-of", "ENVI",
                        "-te", str(BBOX["w"]), str(BBOX["s"]), str(BBOX["e"]), str(BBOX["n"]),
                        "-ts", str(NX), str(NY), LAND, raw], check=True)
        land = np.fromfile(raw, dtype=np.uint8).reshape(NY, NX)[::-1].astype(bool)  # GDAL row 0 = north
    write_cells(land, OUT_LAND)
    mid = np.radians((BBOX["s"] + BBOX["n"]) / 2)
    my, mx = CELL_DEG * 111_320, CELL_DEG * 111_320 * np.cos(mid)  # cell size in metres
    ry, rx = int(INLAND_M // my), int(INLAND_M // mx)
    pad = np.pad(land, ((ry, ry), (rx, rx)), constant_values=True)
    inland = land.copy()
    for dy in range(-ry, ry + 1):
        for dx in range(-rx, rx + 1):
            if (dy * my) ** 2 + (dx * mx) ** 2 <= INLAND_M ** 2:
                inland &= pad[ry + dy:ry + dy + NY, rx + dx:rx + dx + NX]
    write_cells(inland, OUT)


def main():
    if region.R["land_source"] == "osm":
        return grid_main()
    land = shape(json.load(open(LAND)))
    to_utm = Transformer.from_crs(4326, 32610, always_xy=True).transform
    to_ll = Transformer.from_crs(32610, 4326, always_xy=True).transform
    rasterize(transform(to_ll, transform(to_utm, land).buffer(-INLAND_M)), OUT)
    rasterize(land, OUT_LAND)


if __name__ == "__main__":
    main()
