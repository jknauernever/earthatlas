# Climate TRACE — data & API reference

Studied 2026-09-22 against release **v5.10.0** (published 2026-08-21, monthly data through **2026-06**).
Everything below was verified by real fetches unless marked *(docs only)*.

## Access paths

| Path | What | Auth | Notes |
|---|---|---|---|
| `https://api.climatetrace.org/v7` | REST API ("Beta"), OpenAPI 3.1 spec v7.2.0 | none | Spec at `/v7/docs/openapi.json` (served as **YAML** despite the name). v6 still answers. |
| `https://downloads.climatetrace.org/latest/sector_packages/{gas}/{sector}.zip` | Static bulk CSV packages, one per gas × sector | none | Also pinned: `/v5.10.0/…`, older `/v4.4.0/…`. The sanctioned bulk route. |
| `https://downloads.climatetrace.org/latest/country_packages/{gas}/{ISO3}.zip` | Same, cut by country | none | Verified `co2e_100yr/USA.zip` = 404 MB. |
| `https://downloads.climatetrace.org/latest/reference/geometries.gpkg.zip` | GeoPackage of every area-source polygon (GADM admin 0/1/2 + GHS-FUA urban areas) | none | 654 MB. Join key = `geometry_ref`. |
| `https://downloads.climatetrace.org/latest/ers/ers_plan_global.zip` | Emission Reduction Strategies — best reduction strategy per source | none | 44 MB. Not yet unpacked/profiled. |
| BigQuery `trace-data-383422.climate_trace` | Full dataset, updated each release | Google account; standard BQ billing (1 TiB/mo free) | *(docs only — not queried yet)* `bq` is installed locally. |
| On request (coalition@climatetrace.org) | Rasters: 1 km forestry/land-use, 1 km buildings & pasture, 9 km crop fires/fertilizer, 10 m–500 m rice; road segments; individual ships | email | Not in any public download. |
| climatetrace.org/data "custom download" | Website-internal job queue (`/api/custom-download/start` → poll `/status`) | — | **Not a public API — don't script it.** Everything it builds is a slice of the static packages / BigQuery. |

**Sector package names use underscores**: `power, agriculture, buildings, manufacturing, transportation, waste, mineral_extraction, fossil_fuel_operations, fluorinated_gases, forestry_and_land_use` (the hyphenated API names 404 there).

**Package gas folders verified**: `co2e_100yr, co2e_20yr, co2, ch4, n2o, pm2_5, nox, so2, co`. Zipped size per gas ≈ 2.5–2.9 GB for the 6 hyphen-safe sectors + ~0.6 GB for the other four (forestry_and_land_use alone 567 MB). All-gases total ≈ **30 GB zipped**. Compression ≈ 18× (power co2e_100yr: 27 MB zip → 497 MB CSV), so full unzipped is on the order of hundreds of GB — bake-only, never runtime.

## Package contents (per subsector)

```
DATA/{subsector}_emissions_sources_v5_10_0.csv            # one row per source × month
DATA/{subsector}_emissions_sources_ownership_v5_10_0.csv  # ownership chains
DATA/{subsector}_emissions_sources_confidence_v5_10_0.csv # per-field confidence per source-month
DATA/{subsector}_country_emissions_v5_10_0.csv            # country totals
ABOUT_THE_DATA/about_the_data_v5_10_0.pdf
ABOUT_THE_DATA/detailed_data_schema_v5_10_0.csv           # per-subsector column meanings, incl. other1..other10
```

### `emissions_sources` columns
`source_id, source_name, source_type, iso3_country, sector, subsector, start_time, end_time, lat, lon, geometry_ref, gas, emissions_quantity (t), temporal_granularity (month), activity, activity_units, emissions_factor, emissions_factor_units, capacity, capacity_units, capacity_factor, other1..other10 + otherN_def, created_date, modified_date`

- `source_type` here is the **asset type** (e.g. power: gas / coal / biomass / oil / "gas, other_fossil").
- `lat/lon` = real coordinates for facilities; **centroid** for aggregated area sources.
- `geometry_ref` populated for area sources → polygon in `geometries.gpkg`.
- `otherN` carry subsector extras (power: uncertainty method, biomass capacity/generation, grid marginal emissions intensity…), defined in `detailed_data_schema`.
- Sample, power / electricity-generation: **11,543 plants, 761,838 rows, 66 months (2021-01 → 2026-06)**.

### `ownership` columns
`parent_name, parent_entity_id, parent_entity_type, parent_lei, parent_permid, parent_registration_country, parent_headquarter_country, overall_share_percent, ownership_path` (human-readable chain with % at each hop)`, ownership_path_datasource_ids, immediate_source_owner(+_entity_id), source_operator(+_id), percentage_of_operation, source_id, source_name, source_sector, source_subsector, iso3_country`

### `confidence` columns
Per source-month, each of `source_type, capacity, capacity_factor, activity, emissions_factor, emissions_quantity` rated `very low | low | medium | high`.

## Source granularity by subsector (from detailed_data_schema)

**Point facilities (named)** — power plants; cement, iron & steel, aluminum, glass, lime, petrochemical, pulp, textile, food/bev plants; refineries; coal/copper/iron/bauxite mines; landfills; wastewater plants; confined cattle operations; domestic & international airports; domestic & international ports; water reservoirs.

**Basin-level "points" — caution:** `oil-and-gas-production` and `oil-and-gas-transport` sources are whole **basins/sub-basins** placed at a centroid (e.g. *"Russia_Central Sub-basin - West Siberia_Conventional onshore"*, 260 Mt CO2e in 2025, `sourceType: point-source`). Drawing these as facility dots would mislead.

**Area aggregates (GADM 0/1/2 or GHS-FUA urban areas)** — all of agriculture except confined cattle; buildings (residential / non-residential / other fuel use); road transport, railways, other transport; all forestry & land use (clearing, degradation, fires, net forest, net shrub/grass, wetlands, removals, soil organic carbon); rock/sand quarrying; heat plants; several manufacturing (chemicals, wood, other metals); f-gases.

**Not public:** gridded rasters, road segments, individual ships (on request).

## REST API v7 — every endpoint

| Endpoint | Params | Returns |
|---|---|---|
| `GET /v7/sources` | `year`(2025), `gas`(co2e_100yr), `sectors`, `subsectors`, `gadmId`, `cityId`, `countryGroup`, `continent`, `ownerIds`, `limit`(100), `offset` | `SourceSummary[]` ranked by emissions — id, name, sector, subsector, country, assetType, sourceType, centroid, gas, emissionsQuantity, activity/capacity/EF (+units), year |
| `GET /v7/sources/:id` | `start`/`end` (years, min 2021), `timeGranularity` month\|year, `gas` | `SourceDetails` — + `emissions[]` time series, `totals`, `confidence[]` (per year, per gas/field), `subsectorRanks[]` (global rank per year), `owners[]` |
| `GET /v7/sources/emissions` | same filters as `/sources` | Aggregates: `totals`, `sectors`, `subsectors` (summaries + timeseries), `owners`, `location`. **Excludes forestry-and-land-use unless requested.** |
| `GET /v7/rankings/countries` | `gas`, `start`, `end`, `sectors`, `subsectors`, `countryGroup`, `continent` | Country ranks, % share, **per-capita**, totals + timeseries |
| `GET /v7/admins` · `/admins/:id` · `/admins/:id/subdivisions` | name search / GADM id | GADM admin areas (level 0–2) |
| `GET /v7/cities` · `/cities/:id` | name search | GHS-FUA urban areas (+ alternate names) |
| `GET /v7/owners` | `name`, `limit`, `offset` | owner id + name |
| `GET /v7/definitions/{sectors,subsectors,gases,countries,continents,countrygroups}` (+ `/:id` detail) | — | Code lists. Subsector detail includes `dataLeads`. |

- **No bbox / radius query.** Spatial filtering is by GADM id, city id, country, continent only → viewport maps need our own baked index.
- **62 gas codes** in `/definitions/gases` (CO2, CH4, N2O, CO2e 20/100, PM2.5/PM10, BC, OC, NOx, SO2, CO, NH3, VOCs, many HFC/PFC species, Hg, Pb, PAHs…). Only 9 verified as package folders; which subsectors carry the rest is unverified.
- **`0` + `"license restricted"` in activity/capacity/EF means *withheld*, not zero.** Must render as unavailable.
- No rate-limit documentation found. Currently used in prod by `api/_systems-datasets.js` (v6 `/assets`, facility-name join for Carbon Mapper).

## License & citation
CC BY 4.0 ("unless otherwise noted"; sector-specific citations listed in `about_the_data` PDF). Citation:
*Climate TRACE (2026), Climate TRACE Emissions Inventory v5.10.0, https://climatetrace.org [Date Accessed]*.
Errors / validation contact: coalition@climatetrace.org. Changelog: github.com/climatetracecoalition/methodology-documents/tree/main/2026/CHANGELOG.

## Nature of the data
Modeled estimates (satellite + remote sensing + activity data + ML), **not direct measurements**. Released monthly, ~2-month lag. Each release can revise history (`modified_date`), so bakes must be full re-bakes per release, keyed by version.

## Our facility bake (scripts/bake-climatetrace/) — automated monthly

**Pipeline:** `bake.mjs download → extract-all → assemble` then `publish.mjs publish`, run by `.github/workflows/climatetrace-bake.yml` (daily 09:23 UTC check; full bake only when Climate TRACE's package etags change; manual "Run workflow" with *force*). Raw zips + build outputs are gitignored.

**Production layout (Vercel Blob, immutable per build):** `trace/<release>-<YYYYMMDD>/{trace-facilities.pmtiles, trace-detail.pack, trace-index.json}` plus the pointer `trace/latest.json` (60 s cache) → the site reads the pointer, so a new release goes live with **no deploy**. Served by `api/trace-tiles.js` and `api/trace-detail.js` (`?v=<build>`, CDN-cached per build; shared reader `api/_trace-store.js`; dev reads `build/`).

**Uploads without a Blob token in CI:** `api/cron/trace-upload-token.js` (CRON_SECRET bearer) mints a short-lived client token for ONE allowlisted pathname; CI uploads directly with `@vercel/blob/client put`. Publish verifies each file's public size, THEN flips the pointer. Safety gates refuse (production unchanged): malformed CSV rows, < 90% of live sources, fewer months than live, implausibly small files.

- **Facility = no `geometry_ref`.** Detected per subsector from the data (31 subsectors in v5.10.0) plus a row-level guard: `domestic-wastewater-treatment-and-discharge` is MIXED (55,945 plants + 631k area rows).
- **Free-text fields contain quoted newlines** (facility names, `otherN_def`). The CSV reader joins lines until quotes balance; each subsector summary reports `bad` (must be 0 — a publish gate).
- **Memory:** V8 sliced strings pin whole CSV lines; the cattle files (27 + 15 GB) OOM'd until kept strings were interned / flat-copied. CI runs 2 extract jobs at 6 GB heap each.
- **Cattle operations:** ~285k each in enteric + manure subsectors; an `otherN` "approach" field says `reported` vs Climate TRACE's own model (`ct_syn_ai`) — surfaced in popups.
- **Quirks seen:** many small plants repeat identical monthly values year to year (carried-forward estimates); `capacity_factor` is not a 0–1 ratio for power — not displayed.
- **Tiles:** layer `facilities`, z0–8, per-feature `tippecanoe.minzoom` from global rank of the latest full-year total. Monthly series 3 chars/month at 3 significant figures (`encodeMonth` / `decodeMonth`).
- **Detail (format 2):** 16,384 shards (id % 16384) packed into one file (layout in api/trace-detail.js); repeated strings in the index dictionary, run-length series, confidence codes; median shard ~32 KB raw / ~7 KB gzipped; decoder `decodeDetail` verified lossless.
