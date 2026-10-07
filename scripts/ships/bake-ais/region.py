"""
The detailed-track region the /ships AIS bake works on: ONE place for the box and
every path that depends on it (fetch_points.py, land_mask.py, build_tracks.py).

Pick a region with the SHIPS_REGION environment variable (default: salish-v5,
the box production was baked with). Each region keeps its own points cache, land
masks, build dir and tile output, so bakes of different boxes never clobber
each other.

  salish-v5  W -124.85 S 47.0 E -122.05 N 49.0   same box as /shiptraffic.
  salish-v6  W -126.2  S 47.0 E -122.05 N 49.6   (Josh 2026-09-28) US-receiver
             MarineCadastre AIS has strong coverage up to ~49.5 N (Vancouver,
             Burrard Inlet, Nanaimo, Roberts Bank), and a west edge at -126.2
             puts the detailed/US-wide seam in open ocean, off Cape Flattery.
  wa-columbia-v1  W -124.3 S 45.55 E -122.55 N 47.0  (2026-10-07, scrubber-ship calls
             report) Grays Harbor and the lower Columbia River up to Vancouver WA.
             Terminal calls only: no land mask, tracks or tiles are built for it.
             fetch_points.py --also wa-columbia-v1 fills it from the same daily read
             as salish-v6. Its north edge is salish-v6's south edge.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

REGIONS = {
    "salish-v5": dict(
        bbox=dict(w=-124.85, s=47.0, e=-122.05, n=49.0),
        land_source="gshhg",
        land=os.path.join(HERE, "..", "..", "bake-shiptraffic", "salish_land.geojson"),
        land_note="GSHHG 2.3.7 full-res L1 via scripts/bake-shiptraffic/salish_land.geojson",
        points=os.path.join(HERE, "cache", "points", "salish"),
        land_cache=os.path.join(HERE, "cache", "land"),
        land_prefix="salish",
        build=os.path.join(HERE, "build"),
        tiles=os.path.join(HERE, "track_tiles"),
    ),
    "salish-v6": dict(
        bbox=dict(w=-126.2, s=47.0, e=-122.05, n=49.6),
        # GSHHG closes eastern Burrard Inlet and has no Fraser River (make_land.py), so v6 uses OSM.
        land_source="osm",
        land=os.path.join(HERE, "cache", "land", "salish-v6-land-osm.geojson"),
        land_note="OpenStreetMap coastline land polygons minus OSM inland water (natural=water, waterway=riverbank), "
                  "© OpenStreetMap contributors, ODbL; cut to the box by make_land.py",
        points=os.path.join(HERE, "cache", "points", "salish-v6"),
        land_cache=os.path.join(HERE, "cache", "land"),
        land_prefix="salish-v6-osm",
        build=os.path.join(HERE, "build", "v6"),
        tiles=os.path.join(HERE, "build", "v6", "track_tiles"),
    ),
    "wa-columbia-v1": dict(
        bbox=dict(w=-124.3, s=45.55, e=-122.55, n=47.0),
        land_source=None, land=None, land_note="none: terminal calls only",
        points=os.path.join(HERE, "cache", "points", "wa-columbia-v1"),
        land_cache=None, land_prefix=None,
        build=os.path.join(HERE, "build", "wa-columbia-v1"),
        tiles=None,
    ),
}

NAME = os.environ.get("SHIPS_REGION", "salish-v5")
if NAME not in REGIONS:
    raise SystemExit(f"SHIPS_REGION={NAME!r}: unknown region (have {', '.join(REGIONS)})")
R = REGIONS[NAME]
BBOX = R["bbox"]
