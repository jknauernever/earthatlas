#!/usr/bin/env python3
"""
Land outline for a /ships track region, cut to the region's box and written as
one GeoJSON MultiPolygon (region.py: R['land']). land_mask.py rasterises it.

Two recipes (region.py 'land_source'):

  gshhg  GSHHG full-resolution level-1 (land vs ocean) polygons. Same recipe as
         /shiptraffic's scripts/bake-shiptraffic/salish_land.geojson (L1 only;
         `--check` reproduces that file exactly for the old box).
         GSHHG 2.3.7 (2017-06-15), Wessel & Smith, University of Hawai'i / NOAA,
         https://www.soest.hawaii.edu/pwessel/gshhg/ , LGPL-3.0-or-later.
         LIMIT (found 2026-09-28): GSHHG's shoreline is closed across narrow
         passages and has no rivers, so eastern Burrard Inlet (Westridge,
         Port Moody), the Fraser River, Seattle's Duwamish and Tacoma's
         waterways are "land" in it, kilometres from its shore.

  osm    OpenStreetMap coastline land polygons (osmdata.openstreetmap.de
         land-polygons-split-4326) MINUS OSM inland water polygons
         (natural=water and waterway=riverbank, from the Overpass API), so
         tidal inlets, rivers and lakes that boats use are water.
         © OpenStreetMap contributors, ODbL 1.0 (attribution required).

Downloads (once, into cache/sources/, gitignored):
  gshhg: curl -o cache/sources/gshhg/gshhg-shp-2.3.7.zip https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip
         (cd cache/sources/gshhg && unzip gshhg-shp-2.3.7.zip 'GSHHS_shp/f/GSHHS_f_L1.*' LICENSE.TXT)
  osm:   curl -o cache/sources/osm/land-polygons-split-4326.zip https://osmdata.openstreetmap.de/download/land-polygons-split-4326.zip
         (cd cache/sources/osm && unzip land-polygons-split-4326.zip)
         water: POST cache/sources/osm/water.overpassql to https://overpass-api.de/api/interpreter
                → cache/sources/osm/water-<region>.json   (the query's [bbox:…] must match the box)

Run:  SHIPS_REGION=salish-v6 python3 make_land.py          # writes region.R['land']
      SHIPS_REGION=salish-v6 python3 make_land.py gshhg    # force one recipe (writes …-gshhg.geojson)
      python3 make_land.py --check                           # old box vs salish_land.geojson
Deps: pip install pyshp shapely ; brew install gdal (ogr2ogr, osm recipe)
"""
import json, os, subprocess, sys
import shapefile
import shapely
from shapely.geometry import shape, box, mapping, Polygon, LineString
from shapely.ops import polygonize, unary_union
import region

SRC = os.path.join(region.HERE, "cache", "sources")
GSHHG_L1 = os.path.join(SRC, "gshhg", "GSHHS_shp", "f", "GSHHS_f_L1.shp")
OSM_LAND = os.path.join(SRC, "osm", "land-polygons-split-4326", "land_polygons.shp")


def polys(g):
    return [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and not p.is_empty]


def gshhg(b):
    clip = box(b["w"], b["s"], b["e"], b["n"])
    parts = []
    for sr in shapefile.Reader(GSHHG_L1).iterShapes():
        x0, y0, x1, y1 = sr.bbox
        if x1 < b["w"] or x0 > b["e"] or y1 < b["s"] or y0 > b["n"]:
            continue
        g = shapely.make_valid(shape(sr.__geo_interface__)).intersection(clip)
        if not g.is_empty:
            parts.append(g)
    return shapely.MultiPolygon(polys(unary_union(parts)))


def osm_water(path):
    """natural=water / waterway=riverbank ways + multipolygon relations → shapely polygons."""
    d = json.load(open(path))
    if d.get("remark"):
        raise SystemExit(f"Overpass result incomplete: {d['remark']}")
    out = []
    for e in d["elements"]:
        try:
            if e["type"] == "way":
                c = [(p["lon"], p["lat"]) for p in e.get("geometry", [])]
                if len(c) >= 4 and c[0] == c[-1]:
                    out.append(shapely.make_valid(Polygon(c)))
            elif e["type"] == "relation":
                lines = {"outer": [], "inner": []}
                for m in e.get("members", []):
                    if m["type"] == "way" and m.get("geometry") and m.get("role", "outer") in ("outer", "inner", ""):
                        lines["inner" if m["role"] == "inner" else "outer"].append(
                            LineString([(p["lon"], p["lat"]) for p in m["geometry"]]))
                outer = unary_union(list(polygonize(unary_union(lines["outer"])))) if lines["outer"] else None
                if outer is None or outer.is_empty:
                    continue
                if lines["inner"]:
                    inner = unary_union(list(polygonize(unary_union(lines["inner"]))))
                    outer = outer.difference(inner)
                out.append(shapely.make_valid(outer))
        except Exception as ex:  # one broken OSM object must not sink the outline
            print(f"  skipped {e['type']}/{e['id']}: {ex}")
    return out


def osm(b):
    tmp = os.path.join(SRC, "osm", f"land-{region.NAME}.geojson")
    subprocess.run(["ogr2ogr", "-f", "GeoJSON", "-spat", str(b["w"]), str(b["s"]), str(b["e"]), str(b["n"]),
                    "-clipsrc", str(b["w"]), str(b["s"]), str(b["e"]), str(b["n"]), tmp, OSM_LAND], check=True)
    land = unary_union([shapely.make_valid(shape(f["geometry"])) for f in json.load(open(tmp))["features"]])
    water = unary_union(osm_water(os.path.join(SRC, "osm", f"water-{region.NAME}.json")))
    clip = box(b["w"], b["s"], b["e"], b["n"])
    return shapely.MultiPolygon(polys(land.difference(water).intersection(clip)))


def write(mp, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    coords = [[[[round(x, 6), round(y, 6)] for x, y in ring] for ring in poly] for poly in mapping(mp)["coordinates"]]
    with open(out, "w") as fh:
        json.dump({"type": "MultiPolygon", "coordinates": coords}, fh)
    print(f"{len(mp.geoms)} polygons, bounds {mp.bounds} → {out} ({os.path.getsize(out):,} bytes)")


def main():
    if "--check" in sys.argv:
        old = region.REGIONS["salish-v5"]
        mine = gshhg(old["bbox"])
        ref = shape(json.load(open(old["land"])))
        diff = mine.symmetric_difference(ref).area
        print(f"old box: mine {len(mine.geoms)} polys area {mine.area:.5f}; ref {len(ref.geoms)} polys area {ref.area:.5f}; "
              f"sym-diff {diff:.7f} deg² ({100 * diff / ref.area:.4f}%)")
        return
    src = sys.argv[1] if len(sys.argv) > 1 else region.R["land_source"]
    out = region.R["land"] if src == region.R["land_source"] else os.path.join(region.HERE, "land", f"{region.NAME}-land-{src}.geojson")
    write({"gshhg": gshhg, "osm": osm}[src](region.BBOX), out)


if __name__ == "__main__":
    main()
