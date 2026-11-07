# Oil spill scenarios subsite: Phase 0 notes (2026-11-05)

Phase 0 of the planning brief (rev 2, click-to-spill). Read-only review: nothing built, nothing installed, no data
downloaded (metadata, catalog pages and license files only). Working path is still `/spillrisk`.

## 1. Repo stack (what the brief should assume)

| Brief assumed | Repo actually has |
|---|---|
| MapLibre GL | **Mapbox GL JS 3.24** (`mapbox-gl`), plus `pmtiles`. Every map tool follows `docs/MAP_TOOL_CONVENTIONS.md` and the shared panel/popup frame (`src/components/panel`, `lib/popupFit.js`). |
| A small API service | Vercel serverless functions in `api/` (Node only). The Vite-preset project **can't build Python functions**, so PyGNOME can't run on Vercel. |
| Job queue / worker | No general queue. Existing long-running compute uses two patterns: (a) **GitHub Actions** cron bakes running Python, which POST results to a CRON_SECRET ingest endpoint that writes Blob (e.g. `liveocean-bake.yml`); (b) a **Fly.io** app (`earthatlas-aisstream`, shared-cpu-1x, 256 MB, region sjc, code in `scripts/ships/aisstream/`). |
| Database | Neon Postgres, one project per domain (`earthatlas-news`, `earthatlas-ships`(+`-dev`), `earthatlas-whales`, `earthatlas-users`). PostGIS is available. Raw migrations run by `prod.sh migrate`, no ORM. |
| Storage | Vercel Blob (PMTiles, JSON, manifests); edge proxies serve tiles (`api/national-tiles.js`, `api/ship-tracks.js`). |
| Ships path | **`/ships`** is the canonical vessel system (`/shiptraffic` is the older whale-vs-traffic tool rebuilt on /ships tiles). |

What this means for the run service: the API (validation, cache lookup, status polling, results) fits in a Vercel
function plus Neon/Blob. **PyGNOME needs its own worker.** Fly.io is the obvious host because we already run one app
there. A Fly Machine can start per job and stop afterwards, which suits bursty public clicks. GitHub Actions can't work
for interactive runs because of its start-up delay.

## 2. Ships data the spill subsite can read (read-only)

Schema `ships` in `earthatlas-ships` (migrations `lib/ships/migrations/001–041`):

- **`terminals`**: name, `kind` (crude_terminal, product_terminal, refinery_dock, bunkering_terminal, fuel_dock,
  military_fuel_pier, lng_terminal, chemical_terminal, …), country, commodities (+ source), operator (+ source URL),
  status, lat/lon. Served publicly and cached through `GET /api/ships?op=terminalsLayer` (GeoJSON: key, name, kind,
  status). **This is the source for "start a spill here" presets.** No new query is needed.
- **`facilities`** (refineries and other fossil-fuel facilities, `kind` list in migration 026/032) plus `terminal_facilities`.
- **`bunker_events`** / `bunker_snapshots`: inferred ship-to-ship bunkering events (receiver/supplier MMSI, time, anchorage).
  These can give bunkering-anchorage presets.
- **`anchorages`**: named anchorages with GFW visit estimates.
- **Traffic context**: Salish AIS track tiles (`api/ship-tracks.js`, NOAA MarineCadastre CC0 + aisstream-recorded months)
  and the live snapshot `ships/live/salish-v6.json` (Phase 4 "spill from this vessel").
- **Not in the data**: cargo volumes per vessel or per transfer. The volume presets ("laden tanker", etc.) need their own
  cited sources (open item).

## 3. "What's in the way" layers already in the repo

| Layer | Status in repo | Gap |
|---|---|---|
| Critical habitat incl. Southern Resident killer whale | National dataset `data/national/crithab` (FWS ECOS + NOAA Fisheries MapServer), built for /spills | none for US waters; BC SRKW critical habitat (DFO) not ingested |
| Protected areas | National PAD-US 4.1 tiles (`api/national-tiles.js`); /ships has NOAA MPA Inventory | BC/Canada protected areas not ingested |
| Species of concern | `/species-of-concern` lookup (WA state lists; iNat/GBIF/eBird/whales) | federal ESA + BC (SARA) lists not yet in it |
| Whale presence | `earthatlas-whales` DB (hourly multi-source) | — |
| ESI shoreline sensitivity | Only **Lake Michigan** ESI is ingested (/spills). | **Puget Sound / Strait of Juan de Fuca ESI not ingested.** BC side has no ESI (open decision 6). |
| Eelgrass, bull kelp, forage-fish beaches, fish-use shorelines | `/shoreline` (Friends of the San Juans + WA DNR + county); **San Juan County only**, and every view needs the Friends logo | region-wide sources not identified |
| Shellfish areas, beaches/parks, ferry terminals, marinas, seawater intakes | not in the repo (ferry terminals can come from WSF/ships ports) | sources to identify |

## 4. Licenses (read from the files on 2026-11-05)

| Item | License | Notes |
|---|---|---|
| PyGNOME (github.com/NOAA-ORR-ERD/PyGnome, main @3c8e5b3) | Public domain (US Gov work; Unlicense/CC0 wording) | No attribution required. README: output is not NOAA-endorsed, so the methods page and each result panel must say so. conda-forge `pygnome` 1.1.23 (2026-04-04) has linux-64 + osx-arm64 builds for Python 3.10–3.13. GitHub is at v1.1.26. |
| WebGnomeAPI (@ba5d398) | CC0-1.0 (declared in pyproject; no LICENSE file) | Pyramid + Redis, REST `/full_run` and socket.io stepping. Last commit 2026-06-16. Docker files build from NOAA's internal registry, and public pull access is unverified. |
| ADIOS oil database code | CC0 1.0 | — |
| ADIOS oil records (noaa-oil-data repo) | **No license stated** | Many records cite Environment and Climate Change Canada (likely OGL-Canada, unverified). Open item: confirm before we display oil properties. |
| OpenDrift / OpenOil (Phase 4) | GPL-2.0 (code only; output not covered) | OpenOil uses ADIOS data. |
| MIDOSS code | not reviewed (brief: we use papers only, cited) | — |

Oil records that exist for the four presets (IDs from adios.orr.noaa.gov): dilbit **AD02070 Cold Lake Blend**
(+ EC Cold Lake Winter/Summer, EC02234 Access West Blend, EC02709 WCS); crude **AD00020 Alaska North Slope**
(ANS is the main crude into the WA refineries, but that claim needs a source before display); heavy fuel
**AD00208 Bunker C**, **EC01803 IFO 380**; diesel **AD01215 Marine Diesel F-76**, AD02541 ULSD. Final picks are
Josh's call.

## 5. Forcing data (metadata checks only)

| Source | Access | Cycle / horizon | Grid | US + BC | License | 72 h? |
|---|---|---|---|---|---|---|
| **NOAA SSCOFS** (FVCOM, operational since ~2024-09) | AWS `noaa-nos-ofs-pds/sscofs/netcdf/YYYY/MM/DD/sscofs.tHHz.YYYYMMDD.fields.f000–f072.nc` (~210 MB/h); OPeNDAP at opendap.co-ops.nos.noaa.gov | 03/09/15/21z, hourly to **f072**, ready ~3.5 h after cycle | unstructured, 239,734 nodes, ~100 m at shore | yes (44.4–51.75°N, whole Strait of Georgia) | NOAA open data (no license page read) | **yes** |
| SalishSeaCast (NEMO, UBC) | ERDDAP `salishsea.eos.ubc.ca/erddap`, `ubcSSfDepthAvgdCurrents1h` | rolling hourly, ~53 h ahead | curvilinear | yes | Apache 2.0 | no |
| UW LiveOcean (ROMS) | kopah S3 `surface.nc` (72 h hourly) | daily | curvilinear | yes | "research use only" vs CC0 on data.gov | **no public u/v found** |
| NOAA GOODS | **shut down**, folded into WebGNOME, which uses SSCOFS for this region | — | — | — | — | — |
| Winds: SSCOFS's own `uwind/vwind` | in the same files | 72 h | same grid | yes | NOAA | yes |
| Winds: NOAA HRRR | AWS `noaa-hrrr-bdp-pds`, `.idx` range reads (already parsed by `api/_grib2.js` for /systems) | 00/06/12/18z to 48 h | 3 km | BC extent unverified | NOAA open data | no (48 h) |
| Winds: ECCC HRDPS | dd.weather.gc.ca/today/model_hrdps | 4×/day to 48 h | 2.5 km | yes | ECCC end-use licence v2.1 (attribution) | no (48 h) |

**Recommendation:** use SSCOFS for currents and SSCOFS's own wind for v1. It is the only source with operational 72 h
hourly currents covering both countries, its wind matches the currents in time and grid, PyGNOME's own tests load an
SSCOFS file, and NOAA's WebGNOME uses it here. HRRR for 0–48 h is a possible later upgrade if the benchmark shows the
model's wind is too coarse. A 72 h default run fits SSCOFS's horizon.

## 6. Open items / data gaps

1. ADIOS record license (likely OGL-Canada for EC records). Confirm it before displaying oil properties.
2. Volume presets: need cited volumes (e.g. typical bunker capacity, a laden Aframax). Nothing in our data supplies them.
3. Puget Sound / SJF ESI: ingest (NOAA ESI, US only). BC shoreline equivalent is unidentified (decision 6).
4. BC layers: DFO SRKW critical habitat, Canadian protected areas, SARA species. None are ingested.
5. Shellfish, beaches/parks, marinas, intakes: sources to identify.
6. SSCOFS load in PyGNOME: confirm directly from an AWS/OPeNDAP file (Phase 1, one file).
7. SSCOFS wind source (NAM vs HRRR) and the NOAA data-use statement: confirm.
8. Docker image for PyGNOME on Fly: build our own from conda-forge (NOAA registry access unverified).
