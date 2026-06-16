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
  - vessels : Salish Sea AIS traffic. v0 uses a clearly-labelled SYNTHETIC
              generator that lays traffic along the REAL shipping lanes
              (Haro Strait, Rosario Strait, Admiralty Inlet, ferry routes,
              San Juan whale-watch/pleasure grounds) with monthly seasonality.
              Swap in the MarineCadastre GeoParquet bake (see README) to make
              this real without touching the tool.

Run:  python3 scripts/bake-shiptraffic/bake.py
Deps: stdlib + requests + numpy (no pyarrow/geopandas/h3/duckdb needed).
"""

import json
import math
import os
import sys
import time
import datetime as dt

import numpy as np
import requests

# ─── Region & grid ──────────────────────────────────────────────────────────
# Salish Sea core around the San Juan Islands: eastern Strait of Juan de Fuca,
# Haro & Rosario Straits, southern Strait of Georgia, Admiralty Inlet entrance.
BBOX = {"w": -123.8, "s": 47.85, "e": -122.2, "n": 49.0}

# Concern-grid resolution. Vessels are now drawn from Esri's vector tiles and
# whales as raw points, so this grid ONLY feeds the ship×whale concern heatmap —
# which a smooth heatmap renders fine at ~0.9 km (and the file stays small).
# NOTE: the AIS DuckDB cache was binned at the fine 0.004°/0.0027° step; the
# folder in fetch_ais.py collapses those fine indices into these coarse cells.
LNG_STEP = 0.012      # ~0.90 km (3× the 0.004° AIS cache step)
LAT_STEP = 0.0081     # ~0.90 km (3× the 0.0027° AIS cache step)

# 24-month window so vessels (synthetic) and whales (real) line up on the
# timeframe slider and the interaction surface is meaningful in every month.
MONTHS = [f"{y}-{m:02d}" for y in (2024, 2025) for m in range(1, 13)]
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
            if not in_bbox(lng, lat):
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
            if lng is None or lat is None or not in_bbox(lng, lat):
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

# ─── Vessels: SYNTHETIC traffic along the real Salish Sea lanes ─────────────
# Each lane is a polyline (lng,lat waypoints) + a per-type mix + a monthly
# intensity profile. Points are sampled along the lane with lateral spread and
# binned. This is a stand-in for the MarineCadastre AIS bake; the grid format
# is identical, so swapping in real data needs no tool changes.
# With finer (~0.6 km) cells, each lane needs more sampled points to read as a
# continuous track instead of a dotted line; SPREAD_SCALE tightens the lateral
# spread so lanes stay crisp at the higher resolution.
VESSEL_DENSITY = 2.5
SPREAD_SCALE = 0.6

SUMMER_BOOST = {  # month(1-12) -> multiplier for seasonal traffic
    1: 0.7, 2: 0.7, 3: 0.85, 4: 1.0, 5: 1.2, 6: 1.5,
    7: 1.7, 8: 1.7, 9: 1.4, 10: 1.0, 11: 0.8, 12: 0.7,
}

# mix weights per type; "season" flags traffic that swells in summer
LANES = [
    {  # Haro Strait deep-draft lane: Juan de Fuca -> Boundary Pass -> Georgia
        "name": "Haro Strait shipping lane",
        "pts": [(-123.55, 48.20), (-123.30, 48.35), (-123.20, 48.55),
                (-123.10, 48.70), (-123.00, 48.78), (-122.85, 48.92)],
        "mix": {"cargo": 0.45, "tanker": 0.22, "tug": 0.12, "fishing": 0.05,
                "passenger": 0.04, "pleasure": 0.04, "other": 0.08},
        "base": 90, "season": False, "spread": 0.012,
    },
    {  # Rosario Strait lane: Juan de Fuca -> Rosario -> Cherry Point/Bellingham
        "name": "Rosario Strait shipping lane",
        "pts": [(-122.80, 48.15), (-122.75, 48.35), (-122.74, 48.52),
                (-122.70, 48.68), (-122.75, 48.84)],
        "mix": {"cargo": 0.38, "tanker": 0.30, "tug": 0.14, "fishing": 0.05,
                "passenger": 0.03, "pleasure": 0.03, "other": 0.07},
        "base": 70, "season": False, "spread": 0.011,
    },
    {  # Admiralty Inlet entrance toward Puget Sound (south edge of bbox)
        "name": "Admiralty Inlet approach",
        "pts": [(-122.95, 48.16), (-122.78, 48.05), (-122.70, 47.95), (-122.68, 47.88)],
        "mix": {"cargo": 0.40, "tanker": 0.18, "tug": 0.15, "fishing": 0.07,
                "passenger": 0.07, "pleasure": 0.05, "other": 0.08},
        "base": 60, "season": False, "spread": 0.012,
    },
    {  # Anacortes <-> San Juans <-> Sidney ferry corridor
        "name": "WSF San Juan ferry corridor",
        "pts": [(-122.61, 48.50), (-122.75, 48.52), (-122.95, 48.53),
                (-123.10, 48.55), (-123.30, 48.58)],
        "mix": {"passenger": 0.62, "pleasure": 0.12, "other": 0.10,
                "fishing": 0.06, "cargo": 0.04, "tug": 0.04, "tanker": 0.02},
        "base": 55, "season": True, "spread": 0.008,
    },
    {  # Coupeville <-> Port Townsend ferry
        "name": "Port Townsend ferry",
        "pts": [(-122.69, 48.16), (-122.76, 48.13), (-122.83, 48.11)],
        "mix": {"passenger": 0.66, "pleasure": 0.12, "other": 0.10,
                "fishing": 0.06, "cargo": 0.03, "tug": 0.02, "tanker": 0.01},
        "base": 35, "season": True, "spread": 0.006,
    },
    {  # San Juan west side: whale-watch + pleasure grounds (Haro, Lime Kiln)
        "name": "San Juan west-side pleasure/whale-watch grounds",
        "pts": [(-123.18, 48.42), (-123.16, 48.52), (-123.13, 48.58), (-123.10, 48.66)],
        "mix": {"pleasure": 0.52, "passenger": 0.26, "fishing": 0.10,
                "other": 0.06, "cargo": 0.02, "tug": 0.02, "tanker": 0.0},
        "base": 45, "season": True, "spread": 0.020,
    },
    {  # Scattered fishing across the eastern straits / Bellingham Bay
        "name": "Eastern straits fishing grounds",
        "pts": [(-122.85, 48.45), (-122.70, 48.60), (-122.55, 48.70), (-122.62, 48.78)],
        "mix": {"fishing": 0.70, "pleasure": 0.14, "other": 0.08,
                "passenger": 0.03, "tug": 0.03, "cargo": 0.01, "tanker": 0.01},
        "base": 30, "season": True, "spread": 0.025,
    },
]

def lane_samples(lane, n, rng):
    """Sample n points along a lane polyline with gaussian lateral spread."""
    pts = np.array(lane["pts"], dtype=float)
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    total = cum[-1]
    out = []
    for _ in range(n):
        d = rng.random() * total
        k = int(np.searchsorted(cum, d) - 1)
        k = max(0, min(k, len(seg) - 1))
        f = (d - cum[k]) / max(seg[k], 1e-9)
        p = pts[k] + f * (pts[k + 1] - pts[k])
        # lateral spread (degrees), tightened for the finer grid
        p = p + rng.normal(0, lane["spread"] * SPREAD_SCALE, size=2)
        out.append(p)
    return out

def generate_vessels():
    print("→ Vessels (SYNTHETIC — real Salish Sea lanes, monthly seasonality)…")
    rng = np.random.default_rng(20240615)  # deterministic
    total = 0
    for mk in MONTHS:
        month_num = int(mk[5:7])
        boost = SUMMER_BOOST[month_num]
        for lane in LANES:
            intensity = lane["base"] * VESSEL_DENSITY * (boost if lane["season"] else 1.0)
            # transit count for the month (Poisson around intensity)
            n = int(rng.poisson(intensity))
            if n <= 0:
                continue
            samples = lane_samples(lane, n, rng)
            types = list(lane["mix"].keys())
            probs = np.array([lane["mix"][t] for t in types], dtype=float)
            probs = probs / probs.sum()
            picks = rng.choice(len(types), size=n, p=probs)
            for (lng, lat), ti in zip(samples, picks):
                if not in_bbox(lng, lat):
                    continue
                i, j = cell_index(lng, lat)
                bump(i, j, "v", mk, types[ti])
                total += 1
    print(f"  Vessels: {total} synthetic transits binned")
    return total

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


def main():
    print(f"ShipTraffic bake — bbox {BBOX}, {len(MONTHS)} months")
    fetch_whales()
    STATS["vessels"] = generate_vessels()
    assemble_and_write("synthetic")


if __name__ == "__main__":
    main()
