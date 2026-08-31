# Carbon Mapper Data Platform API — complete reference

Studied exhaustively 2026-08-31 from `https://api.carbonmapper.org/api/v1/openapi.json`
(112 paths, 249 schemas; spec title "CarbonMapper Data Platform API" v1.0.0).
Publicness below is **tested** (status probes without credentials), response
fields come from the spec's schemas plus captured samples. Rule of the house:
plan integrations from this document, not from assumptions.

Base: `https://api.carbonmapper.org/api/v1/`
License: data free for non-commercial use (attribution: Carbon Mapper).
Auth model: JWT (`/token/pair`) exists, but the entire read catalog we need is
**anonymous**. Rate limits undocumented; be gentle (their plume PNG asset URLs
are signed+expiring — never hot-link those; the tile endpoints below are the
supported public rendering path).

## The entity model (the key insight)

- **Plume** — one detection in one overflight. ~43.5k CH₄ all-time, ~11.5k in
  the last 13 months. What our dots currently show.
- **Source** — DBSCAN cluster of plumes at one location (`source_name` is a
  coded id like `CH4_6A_1000m_-122.99214_49.10219`, NOT a facility name).
  Carries persistence (fraction of overflights with a detection),
  aggregate emission rate ± uncertainty, plume list, observation vs detection
  date counts. The better marker entity: "seen leaking on 4 of 12 visits,
  averaging 1 t/h" beats a lone snapshot.
- **Scene** — one camera footprint (one overflight image). Scene coverage =
  WHERE THEY HAVE LOOKED, which upgrades our "empty ≠ clean" caveat into a
  real answer: surveyed-and-clean vs never-surveyed.

## Public read endpoints (tested 200 anonymous)

### Plumes
| Endpoint | Notes |
|---|---|
| `GET catalog/plumes/annotated` | Our current feed. Filters: `plume_gas`, `datetime` (ISO range `start/..`), `sectors`, `emission_min/max`, `bbox` (4× repeated param), `intersects`, `qualities`, `instruments`, `search`, `limit/offset` (≤1000/page). |
| `GET catalog/plume/{plume_id}` | One plume by UUID or colloquial id (`<scene>-A`). |
| `GET catalog/plume-csv` | Bulk CSV, same filters. |
| `GET catalog/plumes/related` | Plume + emission/IME/vis sub-objects (quality flags, wind used for quantification). |

`PlumeAnnotatedOut` (35 fields): id, plume_id, gas, geometry_json (Point),
scene_id, scene_timestamp, instrument, mission_phase, platform,
emission_auto, emission_uncertainty_auto, emission_cmf_type, gsd,
sensitivity_mode, off_nadir, plume_png, plume_rgb_png, plume_tif, con_tif,
rgb_png (all signed/expiring), plume_bounds, plume_quality,
wind_speed_avg_auto, wind_direction_avg_auto, emission_version,
processing_software, publication_sources, is_offshore, collection, cmf_type,
**sector** (IPCC: 1B2 oil&gas, 6A landfill, 1B1a coal, 4B livestock, 1A1
power, 1A2 industry, 6B wastewater, other), status, hide_emission,
published_at, modified.

### Sources (the persistent-leak entities)
| Endpoint | Notes |
|---|---|
| `GET catalog/sources.geojson` | All sources as GeoJSON points, same filters as plumes. Props: gas, sector, plume_count, plume_ids, observation_scenes_names, emission_auto ± uncertainty (source-level), timestamp_min/max, published_at_min/max, detection_date_count, observation_date_count, **persistence**, source_name, date_count. |
| `GET catalog/sources-csv` | Same as CSV. |
| `GET catalog/sources/aggregate` | Sector-level rollups. |
| `GET catalog/source/plume/name/{colloquial_plume_id}` | Source for a plume: plumes[], scenes[], point, source_name, source{persistence, emission_auto…}, observation_dates[], detection_dates[]. (UUID variant: `catalog/source/plume/{uuid}`.) |
| `GET catalog/source/{source_name}` / `catalog/search/source/{source_name}` | Source detail by coded name (exact / localized search). |
| `GET catalog/source-plumes-csv/{source_name}` | Full plume history CSV for one source. |

### Scenes (coverage)
| Endpoint | Notes |
|---|---|
| `GET catalog/scenes/annotated` | Paged scene metadata, filters incl. `bbox`, `datetime`, `not_cloudy`, `published_plume_count_min`. Fields: id, name, bounds (polygon), timestamp, platform, instrument, cloud_cover_pct, area_sqkm, gsd, published_plume_count, sun/view geometry… |
| `POST catalog/scenes/coverage` | Bulk "which scenes cover these geometries" → per-feature scene_count + scenes[{name, timestamp, cloud_cover_pct, plume_count}]. THE "was this spot ever surveyed?" endpoint. |
| `GET layers/scenes/public/{z}/{x}/{y}.mvt` | Scene-footprint vector tiles (cached). |

Authed-only (401, skip): `catalog/download/scenes.geojson|gpkg|gml`,
`catalog/scenes/dates`, everything under `picker/`, `tasking/`, `layers/`
upload/AOI management, `account/`, plume mutation (PUT/PATCH/POST).

### Rendering (tiles — the supported public imagery path)
| Endpoint | Notes |
|---|---|
| `GET layers/plumes/{z}/{x}/{y}.mvt` | Ready-made plume-point vector tiles (cached). |
| `GET layers/scene/{scene_id}/{product}/{z}/{x}/{y}.png` | **Actual gas-concentration imagery as XYZ raster tiles.** `product` ∈ `co2 | ch4 | rgb`. Tested public. `@{scale}x` variant exists. This is how to show the real imaged plume shape over our basemap at facility zoom. |

### STAC (granule/asset science data)
`GET stac/`, `stac/collections`, `stac/collections/{id}/items`, `stac/search`
(filters: bbox, datetime, gas, sector, instruments, collections). Collections
observed: l2b-cmf, l2b-rgb, l2c-plumes, l3a-cmf, l3a-ime, l3a-vis,
l4a-combined, l4a-emission. For bulk science downloads (GeoTIFFs) — STAC
asset links may require the STAC token (`account/tokens/create-stac`) for
some assets; the catalog itself is public.

### Misc public
`GET catalog/quicklook/{id}/response` (signed quicklook redirect),
`GET common/administrative-areas?search=` + `/administrative-area/{gadm}/geojson`
(GADM boundaries), `GET common/tags`.

## What we use today (systems/methane layer)
- `plumes/annotated` → daily bake → `systems/methane-plumes.json`
  rows `[lat, lng, kgh, unc, t_ms, platform, plume_id, sector]`.

## Capabilities this API offers that we have NOT built (fact list)
1. Source-level markers (persistence + averaged rate + visit history) via
   `sources.geojson` instead of raw plumes.
2. "Surveyed and clean" vs "never surveyed" via `scenes/coverage` /
   scene-footprint tiles — turns our coverage caveat into a real answer.
3. Real plume imagery overlays at high zoom via scene `ch4` PNG tiles.
4. Per-source plume history in popups ("3 observations since 2024, detected
   once") via `source/plume/name/…`.
5. CO₂ plumes too (`plume_gas=CO2`, product `co2` tiles) — same machinery.
6. Wind at detection time (speed/direction used for quantification) via
   `plumes/related` — could orient a plume-direction glyph.
7. GADM admin-area lookups (their own geocoder for regions).

Facility NAMES are NOT in this API anywhere (source_name is coded) — naming
requires an external join (see Climate TRACE / OSM notes in the layer plan).
