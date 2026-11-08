# Oil spill scenarios: prebaked version (2026-11-05)

Replaces the click-anywhere run service (`docs/SPILLRISK_PHASE2_PLAN.md`, parked). Josh asked for 10 fixed points along
the tanker routes, prebaked, with an hour-by-hour player and the habitats, species and protected areas each spill reaches.

## What is baked

- **Points** (`scripts/spillrisk/points.json`, approved by Josh 2026-11-05, v3). Each point sits on the busiest cell
  (0.02°) of its stretch of route in 2025 large-tanker AIS traffic. The traffic is MarineCadastre.gov data from the
  /ships archive (salish-v6 points), counting tankers 150 m and longer moving faster than 4 knots.
  - Four San Juan Islands points: Haro Strait, Boundary Pass, south of Lopez Island, Rosario Strait.
  - Three town points: Port Angeles, Guemes Channel (Anacortes), and off Lummi Island (the nearest tanker lane to Bellingham).
  - Three spread out: Strait of Juan de Fuca west entrance, Burrard Inlet entrance, Admiralty Inlet.
  - Map: `docs/spillrisk-points-proposal.png`.
- **Weather windows.** These are real past 72-hour periods, chosen from NOAA NDBC buoy 46088 (New Dungeness) 2025 hourly wind
  (`data/spillrisk/wind/46088h2025.txt`):
  - `winter-storm`, 2025-12-17 08z: the windiest 72 h of the 2025 winter months, mean 8.7 m/s, vector-mean from 230°.
  - `summer`, 2025-08-03 07z: the 72 h whose mean equals the summer (Jun–Aug) median, 5.1 m/s, from 224°.
  - Water temperature for each run is the buoy's mean WTMP over the window: 9.6 °C (winter) and 11.6 °C (summer).
- **Forcing.** SSCOFS nowcasts from the NOAA OFS archive on AWS (`noaa-nos-ofs-pds`, Nov 2024 onward). Each cycle tCCz
  holds n000–n005, which are valid times CC−6 h to CC−1 h. The window is stitched hour by hour and read by HTTP byte range,
  so only the surface layer is fetched: about 15 MB per hour, 73 hours, about 6 minutes per window
  (`fetch_sscofs.py archive`). The source time values are float32, so they are snapped to the whole hour.
- **Runs** (`bake_scenarios.py`). 10 PyGNOME 1.1.23 members per scenario, 1,000 particles each, 15-minute steps, a 1-hour
  release, 72 h. The oil is ADIOS AD00020 Alaska North Slope. Weathering covers evaporation, natural dispersion and
  emulsification. The land is the OSM v6 coastline.
  - Member 0 is unperturbed. Members 1–9 use wind ×N(1, 0.2), +N(0°, 15°) and current ×U(0.85, 1.15), with fixed
    RNG 42. These perturbations are our choice, not a published scheme.
- **Volume** (per point, `points.json` "volume" → `VOLUMES` in `bake_scenarios.py`; Josh 2026-11-06):
  - Odd-numbered points (1, 3, 5, 7, 9): **2,500 bbl**, the federal "maximum most probable discharge" for a tanker
    carrying 25,000 bbl or more (33 CFR 155.1020).
  - Even-numbered points (2, 4, 6, 8, 10): **257,000 bbl**, the Exxon Valdez spill (Exxon Valdez Oil Spill Trustee
    Council), which was also Alaska North Slope crude.
  - PyGNOME's particle movement does not depend on volume: a test at Rosario (winter, run 1) gave identical positions at
    2,500 and 258,000 bbl at every hour. Volume changes the mass balance (e.g. hour 6: 22% evaporated at 258,000 bbl vs
    35% at 2,500) and the barrels involved. The page shows barrels for that reason.
  - Earlier runs are kept: `data/spillrisk/scenarios-2500bbl-even/` (even points at 2,500 bbl) and
    `data/spillrisk/scenarios-test1000bbl/` (first test bake). A rerun re-runs only members whose stored volume differs.
- **Impacts** (`prep_impacts.py` → `data/spillrisk/impact/index.json`). Each feature is mapped to the cells it touches on the
  ~550 m scenario grid: cell centers inside the feature, plus the outline sampled every ~150 m. A feature counts as reached
  at the first hour any member has oil, floating or ashore, in one of its cells. It counts as "likely" when 7 or more of the
  10 members do. The layers:
  - Friends habitat (`public/permits-data/friends-habitat.geojson`): kelp, eelgrass edge, herring, documented and potential
    forage-fish beaches. San Juan County only. The Friends logo is shown with this group.
  - ESA critical habitat: FWS from `crithab.gpkg` (clipped with ogr2ogr) and NOAA Fisheries from `raw/nmfs/*.geojson`. U.S. only.
  - PAD-US 4.1 (`padus-nowrap.fgb`), without BOEM outer-continental-shelf blocks (Des_Tp OCS). U.S. only.
  - Not yet covered: British Columbia habitats and protected areas, the Friends "Priority Shorelines for Fish" layer
    (its tiers live in JS), and species-of-concern occurrences.

## Outputs

`public/spillrisk-data/` (gitignored, served by Vite locally; Blob when published):
- `scenarios.json`: points, windows, oil, volume, list of scenarios.
- `<point>--<window>.json`, about 2 MB each. It holds the start time (UTC) and, per hour:
  - oil cells `[iy, ix, runs]`
  - member 0 particles: floating, and ashore (≤ 400 each)
  - member 0 oil budget as shares (floating, evaporated, dispersed, ashore, off map)

  It also holds the shore-contact range and the impact groups, each with every reached feature's first hour (sorted, so
  the page counts by hour).

## Page

`src/spillrisk/SpillriskApp.jsx`, route `/spillrisk`, LIVE on earthatlas.org since 2026-11-07 (7003c5c). Production reads
Blob `spillrisk/<DATA_STAMP>/` (uploaded with `scripts/spillrisk/upload.mjs`); `vercel.json` rewrite, route HTML and
sitemap are wired. Response-time milestones on the time bar come from `src/spillrisk/responseTimes.js`, which uses only the primary-sourced
rows of `docs/SPILLRISK_RESPONSE_TIMES.md`. Results by scenario: `docs/spillrisk-scenarios-summary.md`.
