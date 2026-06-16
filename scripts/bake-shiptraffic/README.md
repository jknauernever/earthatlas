# /shiptraffic data bake

Builds the single static grid the **Ship Traffic × Whales** tool loads
(`public/shiptraffic/grid.json`). Both vessel traffic and whale sightings live
on **one shared ~1.5 km grid** with a per-month time series in each cell, so the
tool can sum any month/year range client-side and compute the
`vessels × whales` interaction surface with no runtime API calls.

## Region

Salish Sea around the San Juan Islands — eastern Strait of Juan de Fuca, Haro &
Rosario Straits, southern Strait of Georgia, Admiralty Inlet entrance.
bbox `[-123.8, 47.85, -122.2, 49.0]`, window 2024-01 … 2025-12.

## Run

```bash
python3 scripts/bake-shiptraffic/bake.py      # whales REAL + vessels SYNTHETIC
```

Deps: stdlib + `requests` + `numpy` (already present). No GIS stack needed.

## What's real vs. synthetic

| Layer | Source | Status |
|-------|--------|--------|
| Whale sightings | iNaturalist (order Cetacea) + OBIS | **Real**, fetched live at bake time |
| Whale sightings | Happywhale | Wired; contributes 0 until their public API ships (currently 500) |
| Vessel traffic | MarineCadastre AIS | **Synthetic stand-in** along the real lanes — see below |

The synthetic vessel layer lays Poisson-sampled traffic along the real shipping
lanes (Haro & Rosario Straits, Admiralty Inlet, WSF ferry corridors, San Juan
whale-watch grounds) with summer seasonality, so the map and the interaction
surface are realistic for demos. The UI shows a "synthetic sample data" banner
whenever `meta.vesselSource === "synthetic"`.

## Swapping in real AIS (one command)

`fetch_ais.py` is a drop-in that reuses the same whale fetch + grid + writer and
only changes how vessel bins are filled. When it runs, `meta.vesselSource` flips
to `"marinecadastre"` and the sample-data banner disappears automatically.

```bash
pip install duckdb
python3 scripts/bake-shiptraffic/fetch_ais.py
```

⚠ **Validate two things first** against
<https://github.com/ocm-marinecadastre/ais-vessel-traffic>:

1. `AIS_PARQUET_TEMPLATE` — the exact GeoParquet URL pattern and cadence
   (daily national broadcast-point files vs. monthly). The 2024/2025
   "analysis-ready" GeoParquet lives on Azure blob storage.
2. The column names (`MMSI` / `BaseDateTime` / `LAT` / `LON` / `VesselType`).

Notes:
- The daily national files are large. Pull only the months you need; the bbox
  `WHERE` lets DuckDB skip non-matching parquet row groups.
- Current binning counts **broadcast points** per cell. For true **transit
  counts**, switch to a distinct-`MMSI`-per-day count per cell (one vessel
  passing = one transit, regardless of how many pings it emitted).
- `vessel_class()` maps AIS numeric ship-type codes → the 7 UI classes
  (cargo 70–79, tanker 80–89, fishing 30, passenger 60–69, tug 31/32/52,
  pleasure 36/37, else other).

## grid.json format

```jsonc
{
  "meta": {
    "bbox": [w, s, e, n],
    "cell": { "lngStep": 0.02, "latStep": 0.0135 },
    "months": ["2024-01", …, "2025-12"],
    "vesselTypes": ["cargo","tanker","fishing","passenger","tug","pleasure","other"],
    "whaleSources": ["inat","obis","happywhale"],
    "vesselSource": "synthetic" | "marinecadastre",
    "whaleCounts": { "inat": N, "obis": N, "happywhale": N },
    "vesselCount": N
  },
  "cells": [
    {
      "i": 12, "j": 30, "lng": -123.55, "lat": 48.26,
      "v": { "2024-07": { "cargo": 3, "tanker": 1 } },   // vessels: month → type → count
      "w": { "2024-07": { "inat": 2, "obis": 1 } }        // whales:  month → source → count
    }
  ]
}
```

Aggregation, normalization, and the interaction index all live client-side in
`src/shiptraffic/shiptrafficData.js`. Hosting: `grid.json` is served statically
from `public/`; if it grows past a few MB, move it to Vercel Blob like the
parcels PMTiles and point `GRID_URL` at the blob.

## Scaling up

- **More region** → widen `BBOX` in `bake.py` (and `fetch_ais.py` inherits it).
- **More history** → extend `MONTHS` / `START_DATE` / `END_DATE`. Whales backfill
  for free from iNat/OBIS; real AIS goes back to 2009 (older years are zonal
  CSV/GDB, not GeoParquet — more work than 2024–2025).
- **Smaller file** → coarsen the grid (raise `LNG_STEP`/`LAT_STEP`).
