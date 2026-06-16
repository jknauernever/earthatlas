# Ship Traffic × Whales (/shiptraffic) — overnight build notes

Morning, Josh. The testing subsite is built and verified on localhost. Here's
where it stands.

## What it is

A map at **`/shiptraffic`** for your client's question: vessel traffic by boat
type vs. known whale presence across the **Salish Sea / San Juan Islands**, over
**any month/year range**, with a derived **interaction** surface showing where
heavy traffic overlaps whales.

Three toggleable heatmap layers on one shared ~1.5 km grid:

- **Vessel traffic** (orange) — filterable by class (cargo, tanker, fishing,
  passenger/ferry, tug/tow, pleasure, other)
- **Whale sightings** (teal) — filterable by source
- **Interaction risk** (magenta) — `normalized vessels × normalized whales`

A dual month/year slider (+ All / 2024 / 2025 presets) drives all three at once;
everything re-sums in the browser, so any timeframe is instant. Click any cell
for its vessel + whale counts with inline, clickable sources.

## What's real vs. sample (important)

| Layer | Status |
|-------|--------|
| **Whale sightings** | **REAL** — 1,609 iNaturalist + 3,013 OBIS cetacean records, fetched live, 2024–2025 |
| Happywhale | Wired but 0 (their public API still returns 500 — flips on when it ships) |
| **Vessel traffic** | **SYNTHETIC sample** laid along the *real* shipping lanes (Haro/Rosario Straits, Admiralty Inlet, WSF ferries, San Juan whale-watch grounds) with summer seasonality |

The UI shows a clear "synthetic sample data" banner so nobody mistakes the
vessel layer for real AIS yet. **Whales are real.**

## Making the vessel layer real (the one follow-up)

It's a one-command swap — `scripts/bake-shiptraffic/fetch_ais.py` reuses the
same whale fetch + grid + writer and only changes how vessel bins are filled,
flipping the banner off automatically:

```bash
pip install duckdb
python3 scripts/bake-shiptraffic/fetch_ais.py
```

Two things to validate first (I couldn't unattended): the exact MarineCadastre
GeoParquet URL pattern and column names, against
<https://github.com/ocm-marinecadastre/ais-vessel-traffic>. Details + the data
format are in `scripts/bake-shiptraffic/README.md`.

## How to look at it

`/shiptraffic` on your dev server. Re-bake the data anytime with:

```bash
python3 scripts/bake-shiptraffic/bake.py     # → public/shiptraffic/grid.json
```

## Verified on localhost

- Renders at `/shiptraffic`; all three layers paint; the lanes + whale hotspots
  + overlap are clearly visible.
- Timeframe filter recomputes (All 9,706/4,622 → 2024-only 4,890/2,029).
- Cell-click popup shows sourced vessel + whale counts and the interaction index.
- Mobile layout, basemap picker, methodology modal, full shareable URL state all work.
- Follows every EarthAtlas map-tool convention (satellite default, ZoomIndicator,
  GeoSearch, style.load mapReady).

## Not done / open questions for you

- **Real AIS bake** — pending the validation above (and bandwidth for the pulls).
- **Region/timeframe** — currently San Juans core + 2024–2025. Easy to widen the
  bbox or extend years (whales backfill free; real AIS pre-2024 is harder zonal data).
- **"Interaction" framing** — it's an honest co-occurrence heuristic, deliberately
  *not* labeled a validated ship-strike risk model. Worth aligning with the client
  on exactly how they want it worded.
- I did **not** commit — left everything in the working tree for your QA per your
  usual localhost-then-merge flow. New/changed files: `src/shiptraffic/*`,
  `scripts/bake-shiptraffic/*`, `public/shiptraffic/grid.json`, and the 5-place
  route wiring (`src/main.jsx`, `vercel.json`, `scripts/generate-route-html.js`,
  `scripts/generate-sitemap.js`).
