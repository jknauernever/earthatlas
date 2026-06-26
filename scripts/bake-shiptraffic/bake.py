#!/usr/bin/env python3
"""
EarthAtlas /shiptraffic data bake.

Produces a single static grid asset (public/shiptraffic/grid.json) that the
ShipTraffic tool loads once and sums client-side over any month/year range.

Both datasets share ONE spatial grid so the derived "interaction" surface
(vessel density x whale presence) is a trivial, defensible per-cell product.

Layers
  - whales  : REAL cetacean sightings for the Salish Sea bbox, fetched from
              iNaturalist (order Cetacea) + OBIS (api.obis.org). Happywhale is
              wired but its public API is not live yet (returns 500), so it
              contributes 0 for now and flips on when the upstream ships.
  - vessels : REAL Salish Sea AIS traffic from MarineCadastre monthly track
              GeoParquet, binned to this grid by fetch_ais.py (which imports
              this module for the region/grid, whale fetch, and grid writer).

This module is a SHARED LIBRARY — it has NO standalone bake path. There is only
one vessel source (real AIS); to (re)bake, run the real pipeline:

Run:  python3 scripts/bake-shiptraffic/fetch_ais.py
Deps: stdlib + requests.
"""

import json
import math
import os
import sys
import time
import datetime as dt

import requests

# ─── Region & grid ──────────────────────────────────────────────────────────
# Salish Sea core around the San Juan Islands: eastern Strait of Juan de Fuca,
# Haro & Rosario Straits, southern Strait of Georgia, Admiralty Inlet entrance.
BBOX = {"w": -124.85, "s": 47.0, "e": -122.05, "n": 49.0}  # Salish Sea: Puget Sound→Olympia, Strait of Juan de Fuca→Cape Flattery, north to the border (US AIS thins past it)

# Concern-grid resolution. Vessels are now drawn from Esri's vector tiles and
# whales as raw points, so this grid ONLY feeds the ship×whale concern heatmap —
# which a smooth heatmap renders fine at ~0.9 km (and the file stays small).
# NOTE: the AIS DuckDB cache was binned at the fine 0.004°/0.0027° step; the
# folder in fetch_ais.py collapses those fine indices into these coarse cells.
LNG_STEP = 0.012      # ~0.90 km (3× the 0.004° AIS cache step)
LAT_STEP = 0.0081     # ~0.90 km (3× the 0.0027° AIS cache step)

# Window end is bounded by the LATEST published vessel data. MarineCadastre's
# monthly AIS GeoParquet (binned into the grid by fetch_ais.py, and tiled by
# build_tracks_tiles.py) now publishes through 2025-12, so the tool covers both
# full years. Bump this when newer months publish.
MONTHS = [f"2024-{m:02d}" for m in range(1, 13)] + [f"2025-{m:02d}" for m in range(1, 13)]
START_DATE = "2024-01-01"
END_DATE = "2025-12-31"

VESSEL_TYPES = ["cargo", "tanker", "fishing", "passenger", "tug", "pleasure", "other"]
WHALE_SOURCES = ["inat", "obis", "happywhale"]

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "public", "shiptraffic")
OUT_FILE = os.path.join(OUT_DIR, "grid.json")
OUT_WHALES = os.path.join(OUT_DIR, "whales.json")

# Raw whale sightings (for the magenta point layer): [lng, lat, monthIdx, srcIdx, species]
WHALE_POINTS = []

# ─── Grid helpers ───────────────────────────────────────────────────────────
def cell_index(lng, lat):
    i = int(math.floor((lng - BBOX["w"]) / LNG_STEP))
    j = int(math.floor((lat - BBOX["s"]) / LAT_STEP))
    return i, j

def cell_center(i, j):
    return (BBOX["w"] + (i + 0.5) * LNG_STEP, BBOX["s"] + (j + 0.5) * LAT_STEP)

def in_bbox(lng, lat):
    return BBOX["w"] <= lng <= BBOX["e"] and BBOX["s"] <= lat <= BBOX["n"]


# ─── Drop whale sightings that fall >1 km INLAND ────────────────────────────
# iNaturalist deliberately OBSCURES threatened/endangered taxa (most orcas +
# humpbacks here) — it returns a coordinate randomized within a ~0.2° box, which
# frequently lands on an island/land. Plus shore-observers pin their own (on-land)
# spot. We can't recover the true location, but we CAN drop the impossible ones:
# a point >1 km inside a landmass is never a real sighting. We keep everything in
# water or within 1 km of shore (genuine near-shore / bluff sightings survive).
# Land = GSHHG full-res, clipped to the bbox (salish_land.geojson); the 1 km test
# erodes the land by 1 km in a longitude-scaled space so it's ~isotropic.
_LAND_GEOJSON = os.path.join(os.path.dirname(__file__), "salish_land.geojson")
_LON_SCALE = math.cos(math.radians(48))  # squash lon so 1° ≈ 1° lat ≈ 111 km
_DEEP_LAND = None  # lazily-built eroded land polygon (scaled space)


def _deep_land():
    global _DEEP_LAND
    if _DEEP_LAND is None:
        from shapely.geometry import shape
        from shapely.affinity import scale
        land = shape(json.load(open(_LAND_GEOJSON)))
        _DEEP_LAND = scale(land, xfact=_LON_SCALE, yfact=1, origin=(0, 0)).buffer(-1.0 / 111.32)
    return _DEEP_LAND


def is_inland(lng, lat):
    """True if (lng,lat) is >1 km inside land — an impossible whale sighting."""
    from shapely.geometry import Point
    return _deep_land().contains(Point(lng * _LON_SCALE, lat))

def month_key(date_str):
    """'2024-07-13' (or ISO datetime) -> '2024-07', or None if unparseable/out of range."""
    if not date_str:
        return None
    s = str(date_str)[:7]
    return s if s in set(MONTHS) else None

# Accumulators: cells[(i,j)] = {"v": {month: {type: n}}, "w": {month: {src: n}}}
cells = {}
# Running counts, filled by the fetch/generate steps; read at assembly time.
STATS = {"inat": 0, "obis": 0, "happywhale": 0, "vessels": 0}

def bump(i, j, layer, month, key):
    c = cells.setdefault((i, j), {"v": {}, "w": {}})
    bucket = c[layer].setdefault(month, {})
    bucket[key] = bucket.get(key, 0) + 1

# ─── Whales: iNaturalist (order Cetacea) ────────────────────────────────────
INAT_BASE = "https://api.inaturalist.org/v1"

def inat_cetacea_taxon_id():
    try:
        r = requests.get(f"{INAT_BASE}/taxa", params={"q": "Cetacea", "rank": "order"}, timeout=30)
        r.raise_for_status()
        for t in r.json().get("results", []):
            if t.get("name") == "Cetacea":
                return t["id"]
    except Exception as e:
        print(f"  [inat] taxon lookup failed: {e}")
    return 152871  # known fallback id for order Cetacea

def fetch_inat():
    print("→ iNaturalist (order Cetacea)…")
    taxon = inat_cetacea_taxon_id()
    print(f"  taxon_id={taxon}")
    kept = 0
    id_above = 0
    page_guard = 0
    while page_guard < 120:  # hard cap: 120 * 200 = 24k obs
        page_guard += 1
        params = {
            "taxon_id": taxon,
            "swlat": BBOX["s"], "swlng": BBOX["w"],
            "nelat": BBOX["n"], "nelng": BBOX["e"],
            "d1": START_DATE, "d2": END_DATE,
            "per_page": 200,
            "order_by": "id", "order": "asc",
            "id_above": id_above,
            "geo": "true",
        }
        # iNat throttles aggressively; retry each page with exponential backoff
        # instead of bailing on the first 429 (which capped us at one page).
        results = None
        for attempt in range(6):
            try:
                r = requests.get(f"{INAT_BASE}/observations", params=params, timeout=45)
                if r.status_code == 429:
                    raise RuntimeError("429 rate limited")
                r.raise_for_status()
                results = r.json().get("results", [])
                break
            except Exception as e:
                wait = 2 ** attempt
                print(f"  [inat] page retry {attempt + 1}/6 in {wait}s ({str(e)[:60]})")
                time.sleep(wait)
        if results is None:
            print(f"  [inat] giving up after retries; {kept} kept so far")
            break
        if not results:
            break
        for o in results:
            id_above = max(id_above, o.get("id", id_above))
            geo = o.get("geojson")
            if not geo or geo.get("type") != "Point":
                continue
            lng, lat = geo["coordinates"]
            if not in_bbox(lng, lat) or is_inland(lng, lat):
                continue
            mk = month_key(o.get("observed_on"))
            if not mk:
                continue
            i, j = cell_index(lng, lat)
            bump(i, j, "w", mk, "inat")
            otaxon = o.get("taxon") or {}  # NB: don't shadow `taxon` (the taxon_id used for paging)
            species = otaxon.get("preferred_common_name") or otaxon.get("name") or "Cetacean"
            WHALE_POINTS.append([round(lng, 5), round(lat, 5), MONTHS.index(mk), 0, species])
            kept += 1
        if len(results) < 200:
            break
        time.sleep(1.0)  # be polite: iNat asks ~1 req/sec
    print(f"  iNaturalist: {kept} sightings binned")
    return kept

# ─── Whales: OBIS (includes OBIS-SEAMAP node) ───────────────────────────────
OBIS_BASE = "https://api.obis.org/v3"

def fetch_obis():
    print("→ OBIS (scientificname=Cetacea)…")
    wkt = (f"POLYGON(({BBOX['w']} {BBOX['s']},{BBOX['e']} {BBOX['s']},"
           f"{BBOX['e']} {BBOX['n']},{BBOX['w']} {BBOX['n']},{BBOX['w']} {BBOX['s']}))")
    kept = 0
    after = None
    page_guard = 0
    while page_guard < 60:  # 60 * 5000 = 300k cap
        page_guard += 1
        params = {
            "scientificname": "Cetacea",
            "geometry": wkt,
            "startdate": START_DATE, "enddate": END_DATE,
            "size": 5000,
        }
        if after is not None:
            params["after"] = after
        try:
            r = requests.get(f"{OBIS_BASE}/occurrence", params=params, timeout=60)
            r.raise_for_status()
            payload = r.json()
            results = payload.get("results", [])
        except Exception as e:
            print(f"  [obis] page fetch failed ({e}); stopping with {kept} kept")
            break
        if not results:
            break
        for o in results:
            lng = o.get("decimalLongitude")
            lat = o.get("decimalLatitude")
            if lng is None or lat is None or not in_bbox(lng, lat) or is_inland(lng, lat):
                continue
            mk = month_key(o.get("eventDate") or o.get("date_mid"))
            if not mk:
                continue
            i, j = cell_index(lng, lat)
            bump(i, j, "w", mk, "obis")
            species = o.get("scientificName") or o.get("species") or "Cetacean"
            WHALE_POINTS.append([round(lng, 5), round(lat, 5), MONTHS.index(mk), 1, species])
            kept += 1
        after = results[-1].get("id")
        if after is None or len(results) < 5000:
            break
        time.sleep(0.5)
    print(f"  OBIS: {kept} sightings binned")
    return kept

# ─── Whales: Happywhale (API not live yet — wired for the env-flip) ─────────
def fetch_happywhale():
    print("→ Happywhale… (public API not live yet — contributes 0, wired for flip)")
    return 0

# ─── Vessels ────────────────────────────────────────────────────────────────
# There is NO synthetic vessel generator. Vessel bins are filled ONLY from real
# MarineCadastre AIS by fetch_ais.py, which imports this module. (The former v0
# synthetic-lane stand-in was removed deliberately so fabricated traffic can
# never bake into a live grid.json.)

# ─── Assemble & write ───────────────────────────────────────────────────────
def assemble_and_write(vessel_source):
    """Serialize the shared `cells` accumulator + STATS to grid.json.

    `vessel_source` is recorded in meta so the tool can label the vessel layer
    ('synthetic' shows the sample-data banner; 'marinecadastre' hides it). The
    real-AIS path (fetch_ais.py) reuses the whale fetch + grid here and just
    swaps how the vessel bins were filled."""
    out_cells = []
    for (i, j), c in sorted(cells.items()):
        lng, lat = cell_center(i, j)
        out_cells.append({
            "i": i, "j": j,
            "lng": round(lng, 5), "lat": round(lat, 5),
            "v": c["v"],
            "w": c["w"],
        })

    payload = {
        "meta": {
            "bbox": [BBOX["w"], BBOX["s"], BBOX["e"], BBOX["n"]],
            "cell": {"lngStep": LNG_STEP, "latStep": LAT_STEP},
            "months": MONTHS,
            "vesselTypes": VESSEL_TYPES,
            "whaleSources": WHALE_SOURCES,
            "vesselSource": vessel_source,
            "whaleCounts": {"inat": STATS["inat"], "obis": STATS["obis"], "happywhale": STATS["happywhale"]},
            "vesselCount": STATS["vessels"],
            "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
        },
        "cells": out_cells,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_FILE) / 1024
    print(f"✓ Wrote {OUT_FILE}  ({len(out_cells)} cells, {size_kb:.0f} KB, vesselSource={vessel_source})")
    print(f"  whales: iNat={STATS['inat']} OBIS={STATS['obis']} HW={STATS['happywhale']}  vessels={STATS['vessels']}")


def write_whales():
    """Emit raw whale sightings for the magenta point layer."""
    payload = {
        "meta": {
            "bbox": [BBOX["w"], BBOX["s"], BBOX["e"], BBOX["n"]],
            "months": MONTHS,
            "sources": WHALE_SOURCES,
            "count": len(WHALE_POINTS),
            "generatedAt": dt.datetime.utcnow().isoformat() + "Z",
        },
        # [lng, lat, monthIdx, srcIdx, species]
        "points": WHALE_POINTS,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_WHALES, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_kb = os.path.getsize(OUT_WHALES) / 1024
    print(f"✓ Wrote {OUT_WHALES}  ({len(WHALE_POINTS)} points, {size_kb:.0f} KB)")


def fetch_whales():
    STATS["inat"] = fetch_inat()
    STATS["obis"] = fetch_obis()
    STATS["happywhale"] = fetch_happywhale()


# ─── Entry point ────────────────────────────────────────────────────────────
# Intentionally NO standalone bake. This module is a library for fetch_ais.py
# (the real-AIS bake). Running it directly must not fabricate a grid.json.
if __name__ == "__main__":
    sys.exit(
        "bake.py is a shared library, not a runnable bake.\n"
        "Vessel data is REAL MarineCadastre AIS — run the real pipeline:\n"
        "    python3 scripts/bake-shiptraffic/fetch_ais.py\n"
    )
