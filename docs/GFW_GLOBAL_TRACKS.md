# GFW hourly track lines: Pacific Northwest → whole world (research, 2026-10-01)

Research only. Nothing built, no code changed, no bulk job run. It builds on
`docs/GFW_ACTIVITY_API.md`, `docs/GFW_VESSELS_API.md`, `docs/SHIP_DENSITY_SOURCES.md` and
`docs/SHIP_TRACK_SOURCES.md` ("GFW hourly lines"). It does not repeat what is in them.

**Labels:** **MEASURED** = a live call or local data in this repo. **DOCS** = GFW's own
documentation (URL given). **ESTIMATE** = my arithmetic from measured inputs; the inputs are
named. **UNCONFIRMED** = not established by docs or a live response.

Main sources:
- [GFW API docs, full text](https://globalfishingwatch.org/our-apis/documentation/llms-full.txt) (fetched 2026-10-01). Below it is cited by page path, e.g. `docs/v3/4wings/report`.
- [GFW "APIs, gfwr, Python package and Data Download Portal Products – Differences" PDF](https://api-doc.globalfishingwatch.org/our-apis/documentation/assets/APIs_gfwr_and_Data_Downloads_Products_Differences.pdf) (last updated 04 Aug 2026). Cited as **Products PDF**.
- [GFW Data Availability page](https://globalfishingwatch.org/global-fishing-watch-data-availability/).

---

## TL;DR

1. **GFW has no bulk feed of global per-vessel positions for all vessel types.** The only
   source is the 4Wings **report** endpoint. It takes one polygon per request and allows one
   running report per user. The portal, BigQuery and Zenodo downloads are gridded and/or
   fishing-only. No public tracks endpoint is documented. (§2)
2. **The world is about 4.3 M rows per day** (MEASURED: 4,273,346 vessel-hours and 314,317
   vessels on 2026-09-20, from `/4wings/stats`). One row = one vessel-hour, so rows =
   vessel-hours exactly (MEASURED in our raw files). The 12-month mean is 4.87 M/day.
3. **Request count drives fetch time, not rows.** From our 100 logged PNW requests: about
   **27 s fixed per report + 0.14 s per 1,000 rows** (MEASURED). An empty box still costs about 27 s.
4. **70 % of all vessel-hours are at < 2 kn** (MEASURED, global, 1 day): moored or anchored
   ships. They add no line geometry. The documented filter `speed` drops them on the
   server: 4.27 M → **1.29 M rows/day**.
5. **The near-shore idea, measured on GFW's own 12-month global grid:** 65 % of vessel-hours
   are within 12 nm of land, 74 % within 25 nm, 83 % within 50 nm and 90 % within 100 nm.
   **But** 31 % of all vessel-hours sit in land-flagged 0.1° cells (ports). The offshore 17 %
   (> 50 nm) is mostly *moving* ships, so the share of *line* data lost is larger than 17 %.
   Because the cost is per request, cutting offshore rows saves little time. Skipping whole
   offshore *requests* is what saves time, and adaptive boxes (option B) do that better.
6. **Recommendation:** fetch global daily with **adaptive boxes sized by expected rows**
   (about 30–70 requests/day), plus `speed` ≠ `<2`. ESTIMATE: **~20–40 min of fetching per
   day**, about 0.1 % of the daily quota, and no near-shore cut needed. Offshore stays in, so
   high-seas fishing and transshipment routes are kept. Details and alternatives in §6.

---

## 1. Catalog: everything GFW offers that relates to per-vessel positions

| Product | What it returns | Per-vessel? | Space / time resolution | Coverage & latency | Access / limits | Source |
|---|---|---|---|---|---|---|
| **4Wings report**, `public-global-presence:latest` (= v4.0) | Rows `{vesselId, mmsi, imo, shipName, callsign, flag, vesselType, geartype, date, lat, lon, hours, entry/exitTimestamp, first/lastTransmissionDate}` | **Yes** with `group-by=VESSEL_ID` (or `MMSI`) | `spatial-resolution` LOW 0.1° / HIGH 0.01° (cell centres). `temporal-resolution` HOURLY / DAILY / MONTHLY / YEARLY / ENTIRE. "One AIS position per hour per vessel" | 2012 → ~96 h ago | POST takes a custom GeoJSON polygon; GET takes a region id (+ buffer) and is gateway-cached. **One running report per user** (429 otherwise). Reports taking > 100 s give 524; collect them with `/last-report` (kept 30 min). "Custom polygon that is too large" → HTML 413. Filters: `flag`, `vessel_type`, `speed`, `vessel_id` | [docs/v3/4wings/report](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report), [key-concepts](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts), [errors](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/errors) |
| 4Wings **tiles** (`tile/heatmap/{z}/{x}/{y}`) | MVT/PNG grid cells with summed hours per time bin | No (gridded) | z0–12; 113 columns per tile (~0.1° at z5). `interval` HOUR (≤ 20 days of range) / DAY / MONTH / YEAR | same | Token required on every tile; can't be called from the browser (Terms §2.G) | [docs/v3/4wings/tiles](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/tiles); `docs/GFW_ACTIVITY_API.md` |
| 4Wings **interaction** | `{id, hours}` per vessel for chosen tile cells | Yes, but no position or time | cell | same | 1 request per cell set | [docs/v3/4wings/interaction](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/interaction) |
| 4Wings **stats** | `{activityHours, vesselIds, flags}` for a date range + filters | No (totals) | global | same | Not a report: no concurrency lock (MEASURED: it answered while a production report was running) | [docs/v3/4wings/stats](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/stats) |
| 4Wings `public-global-sar-presence` | Sentinel-1 detections, matched/unmatched to AIS | Yes for matched | point → 0.01° in reports | 2017 → ~5 days; satellite passes only, mostly coastal | as report | key-concepts; Products PDF p.6 |
| **Vessels API** | Identity and registry only (`/vessels/search`, `/vessels`, `/vessels/{id}`) | Yes | — no positions — | AIS identity to ~72 h; registry to ~2 months | 50 k req/day | [docs/v3/vessels](https://globalfishingwatch.org/our-apis/documentation/docs/v3/vessels); Products PDF p.2–3 |
| `/v3/vessels/{id}/tracks` | **Not in the public docs.** The presence dataset page says "This dataset does not provide individual vessel tracks; for vessel-specific data, refer to the Vessels API", and the Vessels API has no positions. MEASURED probe: `dataset=public-global-vessel-identity:latest` → **400** (Google HTML); `dataset=public-global-all-tracks:latest` → **502**. Treat as unavailable. | — | — | — | — | [key-concepts](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts) |
| **Events API** | Port visits, encounters, loitering, fishing, AIS-off gaps. Each event has a start/end, a single mean `position` and `distances.*FromShoreKm` | Yes (one point per event, no path) | event | 2012 → ~72 h. Gaps are prototype, ≥ 50 nm offshore and ≥ 12 h only | paginated GET/POST, 50 k/day | [docs/v3/events](https://globalfishingwatch.org/our-apis/documentation/docs/v3/events), [data-caveats](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats) |
| **Insights API** | Coverage %, fishing in no-take MPAs, gaps, IUU-list membership per vessel | Yes, no positions | — | 2020 → ~72 h | | [docs/v3/insights](https://globalfishingwatch.org/our-apis/documentation/docs/v3/insights) |
| **Bulk Download API** (`/v3/bulk-reports`) | Asynchronous large exports. **Only dataset: `public-fixed-infrastructure-data`** (offshore structures) | — | — | 2017 → ~3 months | "We will be releasing several datasets for this new API" (release notes). No AIS dataset yet | [docs/v3/bulk-download](https://globalfishingwatch.org/our-apis/documentation/docs/v3/bulk-download), [release-notes](https://globalfishingwatch.org/our-apis/documentation/docs/release-notes) |
| **Data Download Portal**: AIS Vessel Presence | Gridded presence, "**only for fishing vessels**", static file 2012–2024 | No | 0.01°/0.1° grid, daily | static | login | Products PDF p.4; [availability page](https://globalfishingwatch.org/global-fishing-watch-data-availability/) |
| Portal: Fishing effort v3 | Gridded fishing hours, fishing vessels only, 2012–2024 | No (has per-MMSI daily variants for fishing vessels; see Zenodo) | 0.01°/0.1°, daily/monthly | static | CC BY-NC 4.0, 26.3 GB | [Zenodo 14982712](https://zenodo.org/records/14982712); Products PDF p.2 |
| Portal: **All Vessels Voyages, Confidence 4** | Port-to-port voyages (from/to port and times) for **all vessel types** | Yes, but no path | voyage | Jan 2017 → current month, **monthly** update | portal login; not in the API ("not available yet") | Products PDF p.5. Field list **UNCONFIRMED** (portal needs login) |
| Portal: Distance from shore | Raster, metres | — | (resolution **UNCONFIRMED**) | static, Mar 2020 | portal | Products PDF p.5 |
| Portal: Anchorages | Anchorage points | — | S2 cells | ~annual, last 2022 | portal | Products PDF p.5 |
| Portal: SAR vessel detections | Per-detection points with length and scores | Yes | points | 2017 → ~5 days, daily | portal | Products PDF p.6 |
| **BigQuery** public tables | `global_footprint_of_fisheries.fishing_effort`: fishing effort at 0.01° per day, 2012–2016/17, "does not detail individual vessels" | No | 0.01°, daily | static | Google BigQuery free tier | [GFW: Our data in BigQuery](https://globalfishingwatch.org/data/our-data-in-bigquery/) |
| Earth Engine catalog | GFW daily fishing hours / daily vessel hours (fishing vessels) | No | gridded | static (2012–2016) | GEE | [EE catalog, tag "fishing"](https://developers.google.com/earth-engine/datasets/tags/fishing) |
| R `gfwr` / Python `gfw-api-python-client` | Wrappers over the same v3 API. **Same limits** | — | — | — | — | [docs/sdks](https://globalfishingwatch.org/our-apis/documentation/docs/sdks); Products PDF p.1 |

**Terms and limits that apply to all of the above (DOCS, [license-rate-limits](https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits)):**
- Non-commercial use only, CC BY-NC 4.0 (§1.C). Attribution "Powered by Global Fishing Watch." (§3.A.1).
- The token must never be visible in a public web interface (§2.G).
- **50,000 requests/day and 1,500,000/month per user.** These are shared across up to 5 tokens. Going over blocks the user for 24 h (daily) or 30 days (monthly).
- Their advice includes "Store frequently accessed data locally".
- On presence: "this overall dataset is huge … it's highly recommended to request short periods of time" ([data-caveats](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats#ais-vessel-presence-caveats)).
- Latency: presence is ~96 h behind ([key-concepts](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/key-concepts)); the Products PDF says ~72 h for other AIS products.

**Concurrency.** The documented 429 body says: *"Your application token is not currently
enabled to perform more than one concurrent report. If you need to generate more than one
report concurrently, contact us at apis@globalfishingwatch.org"*
([docs/v3/4wings/report](https://globalfishingwatch.org/our-apis/documentation/docs/v3/4wings/report)).
So the one-report limit is a **per-account setting GFW can raise.** It is not a terms
question. Asking them is optional, and nothing below depends on it.

## 2. Is there any bulk route to global per-vessel hourly positions?

**No, for all vessel types.** Sources:
- The presence dataset is offered in the Data Download Portal "**only for fishing vessels**" (Products PDF p.4; [availability page](https://globalfishingwatch.org/global-fishing-watch-data-availability/)).
- The Bulk Download API carries only fixed infrastructure ([docs/v3/bulk-download](https://globalfishingwatch.org/our-apis/documentation/docs/v3/bulk-download)).
- BigQuery and Earth Engine hold old, gridded fishing-effort data only.
- No tracks endpoint is documented. Our two probes failed (§1).
- "Anonymized AIS training data" (static, Mar 2020) is a model-training sample, not a feed (Products PDF p.5).

The only route is 4Wings `report`, one polygon and one running report at a time. GFW's
release notes say more Bulk Download datasets are planned. **UNCONFIRMED** whether presence
will be one of them.

## 3. Throughput: forward-only global daily updates with today's method

### Measured inputs
| Input | Value | Source |
|---|---|---|
| Global vessel-hours, 2026-09-20 (1 day) | **4,273,346** h, 314,317 vessel ids, 229 flags | MEASURED `GET /4wings/stats` |
| Same day, `filters[0]=speed IN ('<2')` | **2,982,120** h (69.8 %), 255,960 vessels | MEASURED |
| Same day, `speed NOT IN ('<2') AND vessel_type IN ('cargo','carrier','bunker','passenger','fishing')` | 749,815 h, 93,048 vessels | MEASURED (the combined filter was accepted; the result fits within the moving total) |
| Global vessel-hours Jul 2025 – Jun 2026 | 1,775,885,500 h → **4.87 M/day** mean | MEASURED, our 0.1° grid from GFW z5 tiles (`scripts/ships/bake-ais/build/compare/gfw_01.bin`, `docs/SHIP_DENSITY_SOURCES.md`) |
| August 2026 world | 131,953,320 h, 896,024 vessel ids | MEASURED earlier (`docs/GFW_ACTIVITY_API.md` #22) |
| Rows vs vessel-hours, HOURLY+HIGH+VESSEL_ID | **rows = vessel-hours** (every row `hours: 1`) | MEASURED, our raw files (salish 65,184 rows = 65,184 h) |
| Time per report | **≈ 27 s + 0.14 s per 1,000 rows** (linear fit over 100 requests; median 27 s for < 1 k rows, 39 s for > 80 k rows; max 106 s) | MEASURED, `scripts/ships/bake-gfw/cache/raw/fetch-log-prototype.ndjson` |
| JSON size | **478 bytes/row**; gzip ≈ 23 % (1.62 GB → 378 MB) | MEASURED (same log; `docs/SHIP_TRACK_SOURCES.md`) |
| Daily quota | 50,000 requests | DOCS |

The small one-day test reports I planned (busy Singapore Strait box, empty open-Pacific
box, a many-vertex polygon) **could not run**. Five tries over ~4 min all got 429 "not
currently enabled to perform more than one concurrent report". The running report was the
production `ships-gfw-tracks-bake` fetch (`date-range=2026-07-29,2026-08-01`, HOURLY/HIGH).
I stopped there as instructed. The timing model therefore comes from the 100 PNW
requests, all ≤ 22° wide.

### ESTIMATE: today's method (fixed 10° world grid, `areas.world_grid()`), 1-day requests
- Boxes: 612. 586 have any traffic in 12 months; 516 average ≥ 1 row/day. Only 2 exceed
  400 k rows/day, so they need splitting (from the 12-month grid).
- **Requests/day ≈ 590–600.** That is 1.2 % of the daily quota and ~18 k/month (1.2 % of the monthly quota).
- **Wall clock ≈ 600 × 27 s + 4.3–4.9 M rows × 0.14 ms ≈ 4.5 h + 10–11 min ≈ 4.7 h/day.**
  This is serial. It fits in a day, but it holds our single report slot ~20 h a week.
- Raw JSON ≈ 2.0–2.3 GB/day (≈ 0.5 GB gzipped).
- Routing (ESTIMATE, scaled linearly from PNW's 35–40 min per month of 1.6–3.5 M rows on 4
  cores): 130–150 M rows/month → roughly 25–60 h of 4-core time per month, about 1–2 h/day.
  This is the bigger cost, and it is **UNCONFIRMED** how the global water model (OSM land
  polygons, ~1.3 GB) behaves at that scale.
- Output (ESTIMATE, linear from PNW Aug 2026: 1.6 M rows → 64.6 MB PMTiles + 11.6 MB pack):
  ~5–6 GB PMTiles per global month for all speeds.

## 4. The near-shore idea

### How much traffic is near land (MEASURED on GFW data, 12 months, all vessel types)
Method: GFW's own z5 presence tiles for Jul 2025 – Jun 2026, regridded to 0.1°, crossed
with our 0.1° Natural Earth 10 m land mask (`public/systems/land-mask-0p1.bin`). Each
distance band = land cells grown by a geodesic disk. Accuracy is ±0.1° (~6 nm). Islands
smaller than a 0.1° cell are missing from the mask, so the near-shore shares are slightly
**under**-stated. No published global figure was found (one web search, nothing citable).

| Within … of land | Share of global vessel-hours | Share of ocean area in that band |
|---|---|---|
| 0 (land-flagged 0.1° cells: ports, rivers, coastal cells) | 31.1 % | — |
| 6 nm | 55.8 % | 2.0 % |
| 12 nm | **65.0 %** | 3.9 % |
| 25 nm | **73.8 %** | 7.6 % |
| 50 nm | **83.1 %** | 13.2 % |
| 100 nm | 89.9 % | 22.8 % |
| 200 nm | 94.7 % | 38.4 % |

Reading this correctly:
- These are **all** vessel-hours. 70 % of them are at < 2 kn, mostly in or near port (§3).
  Moving ships make up a larger share of the offshore hours. So "17 % of hours beyond 50 nm"
  understates the share of *track lines* that lie beyond 50 nm. **The split of moving hours
  by distance is UNCONFIRMED.** It would take one zoom-5 tile pass with
  `filters[0]=speed NOT IN ('<2')` (~800 tile requests, ~6 min, no report slot needed) to measure it.
- **It saves less time than it seems.** Time is ~27 s per request. Dropping the offshore rows
  of a box that is fetched anyway saves only 0.14 s per 1,000 rows. Only skipping whole
  offshore *requests* saves time. With 10° boxes, a 50 nm band still touches ~350 of 516
  boxes, so the saving is ~30 % of requests (≈ 4.7 h → ≈ 2.8 h/day).

### Expressing "within X nm of land" to 4Wings
- POST `report` takes **one** GeoJSON `Polygon` (MultiPolygon in a report: **UNCONFIRMED**;
  MultiPolygon is documented only for bulk-reports, [example 7](https://globalfishingwatch.org/our-apis/documentation/docs/examples/bulk-download/create-report-example7)).
- There is no documented vertex or byte limit. The only documented failure is HTML 413 for a
  "custom polygon that is too large", with the advice to use a region id instead
  ([errors](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/errors)).
  The page does not say whether "too large" means area or bytes (**UNCONFIRMED**). Our PNW
  runs never hit 413 (no `.split` markers in the cache).
- GET `report` accepts `region-id` + `region-dataset` with `buffer-value` / `buffer-unit`
  (`NAUTICALMILES`) and `buffer-operation` (`DISSOLVE` | `DIFFERENCE`) (`docs/GFW_ACTIVITY_API.md`).
  The region datasets are EEZ, MPA and RFMO, so there is **no "land" or "coast" region**. An
  EEZ is out to 200 nm, not a coastal band. EEZ regions also leave out the high seas, which is
  where the conservation-relevant offshore activity is.
- So a coastal band means tiling a buffered coastline into many simplified polygons, each
  clipped to a box. Each polygon is one request. That costs at least as many requests as
  bboxes, and adds vertex/413 risk. **Simpler and no worse:** request the *bbox* of every box
  that touches the band and drop offshore rows locally (or keep them, since they are free).

### What would be lost offshore (conservation-relevant)
- Trans-ocean shipping lanes. These are whale-strike and noise corridors, e.g. the great-circle routes across the N Pacific.
- High-seas fishing fleets (squid jiggers off Argentina and Peru, tuna longliners and purse seiners), which lie mostly beyond 200 nm.
- Transshipment and bunkering at sea. GFW loitering is defined as ≥ 20 nm from shore; AIS-off gaps start ≥ 50 nm offshore ([data-caveats](https://globalfishingwatch.org/our-apis/documentation/docs/v3/general-api-doc/data-caveats)).

### Cheaper offshore stand-ins (if a cut were made anyway)
| Stand-in | Cost | Shows | Limits |
|---|---|---|---|
| Hourly presence, but **few, very large offshore boxes** (option B below) | 1 request per large box | the real lines | wall-clock for very large boxes UNCONFIRMED |
| Events API: encounters, loitering, gaps (all have `distances.*FromShoreKm`) | paginated, roughly 10s of requests/day globally (UNCONFIRMED count) | points with start/end time, both vessels for encounters | no path; "apparent" events |
| Gridded presence tiles (DAY, z≤5, ~0.1°) | ~800 tiles for the world per pull (MEASURED earlier: 1,024 z5 tiles in ~6 min, 801 with data) | density lanes | no identity, no lines |
| Portal "All Vessels Voyages C4" | 1 monthly download | port-to-port pairs and times → could draw dashed "voyage" arcs | monthly, login, no path; fields UNCONFIRMED |
| DAILY instead of HOURLY | same requests | — | **does not help.** A moving ship crosses ~25–60 cells a day at 0.01–0.1°, so rows barely drop, and the hour order within a day is lost (no line can be drawn) |

## 5. Other optimizations

| Lever | Effect | Status |
|---|---|---|
| **Adaptive request boxes sized by expected rows** (quadtree over the 12-month grid; split until expected rows ≤ cap) | Requests/day fall from ~600 to **51 (cap 300 k), 66 (200 k), 152 (100 k)** for all speeds. Moving-only: **30 / 36 / 48**. Time ≈ 34–80 min/day for all speeds, **17–25 min/day moving-only** | ESTIMATE (12-month mean day; boxes up to 40°×40° in empty ocean). **UNCONFIRMED:** that a huge empty box still takes ~27 s and no 413. Must be proved with 1–2 test reports before relying on it. `fetch.py` already splits on 413/524/row-cap, so a wrong guess costs retries, not data. |
| `filters[0]=speed NOT IN ('<2')` | rows −70 % (4.27 M → 1.29 M/day); JSON 2.0 → 0.6 GB/day; routing work −70 % | Filter MEASURED working on `stats`; on `report` **UNCONFIRMED** (same `filters[0]` parameter, DOCS). Cost: lines lose their stationary ends (berth/anchorage dwell), and slow fishing (trawl hauls < 2 kn) is cut. Using `speed NOT IN ('<2','2-4')` would cut more but remove more fishing |
| `vessel_type` filter (e.g. drop `other`, `gear`, `discrepancy`) | moving cargo + carrier + bunker + passenger + fishing = 750 k of 1.29 M moving h/day (58 %) | MEASURED on stats. GFW rows have no length, so "small craft" can't be filtered directly; `other` / `NA` hold many pleasure craft (UNCONFIRMED share) |
| `spatial-resolution=LOW` (0.1°) | Fewer distinct cells, but **still one row per vessel-hour**, so ~no row saving; vertices snap to ~11 km | DOCS + reasoning; not worth it |
| `group-by=MMSI` vs `VESSEL_ID` | same row count; VESSEL_ID links to the Vessels API | DOCS (`group-by` enum) |
| **Multi-day spans for sparse boxes** (e.g. weekly 7-day requests offshore, daily near shore) | Offshore requests ÷ 7. Offshore lines lag up to 7 more days | fetch.py already supports `--span` |
| **Parallel regions** | Not allowed: one running report per user. Extra tokens don't help (the limits are per user). GFW can enable concurrency per account (429 text) | DOCS |
| GET `report` with a region id | gateway-cached (helps repeats, not first fetch); no custom polygon | DOCS |
| Re-fetch window | GFW may revise recent days. Today's weekly job re-fetches ~5 days. Global daily: fetch day D-4 (latency ~96 h), re-fetch D-8..D-5 weekly | existing practice (`fetch.py --refetch-after`) |
| Caching | Keep raw gz per box/day (≈ 0.14 GB/day moving-only) so routing can be re-run without new calls; GFW encourages local storage | DOCS |
| Bulk-access programme | **None for AIS presence.** The Bulk Download API covers fixed infrastructure only. The only official lever is the concurrent-report enablement above | DOCS |

## 6. Options (forward-only global, daily)

Shared assumptions: about 4.3 M rows/day all speeds or 1.3 M moving (MEASURED, one day); fetch
time from the PNW timing model (MEASURED); everything else ESTIMATE.

| | **A. Today's 10° grid, all speeds** | **B. Adaptive boxes + moving-only (recommended)** | **C. Coastal 50 nm band (Josh's idea) + offshore events** |
|---|---|---|---|
| Requests/day | ~590–600 | **~30–50** (+ splits on peak days) | ~350 hourly + events paging |
| Fetch wall-clock/day (serial) | **~4.7 h** | **~20–40 min** | ~2.8 h |
| Quota use | 1.2 % daily | ≈ 0.1 % | ~0.8 % |
| Rows/day | 4.3–4.9 M | ~1.3–1.5 M | ~4.0 M all speeds (83 %), or ~1.1 M moving (UNCONFIRMED split) |
| Raw gz/day | ~0.5 GB | ~0.15 GB | ~0.45 GB |
| Routing compute | highest (≈ 1–2 h/day, 4 cores) | ~70 % less | ≈ A × 0.83 |
| Published tiles/month | ~5–6 GB | ~1.5–2 GB | ~4–5 GB |
| Shows | everything incl. moored ships | every moving vessel, coast and high seas, incl. offshore fishing and transshipment approaches | coastal lines; offshore only as event points |
| Omits | — | stationary positions (< 2 kn): berth/anchorage dwell, some slow fishing | trans-ocean lanes, high-seas fishing paths, offshore transshipment paths |
| Main risk | holds the report slot ~5 h/day, which competes with the PNW/US backfills | large-box timing and 413 behaviour UNCONFIRMED (prove with 2 test reports when the slot is free) | most requests remain; polygon/413 risk if not bbox-based |

**Recommendation: B.** It is cheaper than C and keeps the offshore data. C's saving comes
from skipping requests, and B skips far more of them by merging empty ocean into large boxes
instead of dropping it. If B's large boxes turn out slow (> 100 s → 524 → `last-report`
polling) or return 413, fall back to a 10° or 20° offshore grid fetched on **weekly 7-day
spans** (≈ 600/7 ≈ 85 offshore requests/day equivalent) with daily near-shore boxes. Either
way it stays well inside a day.

**Smallest next proofs (when the report slot is free; ≤ 5 calls, per the test-small rule):**
1. One day, one 40°×40° empty-ocean box, moving-only → time, rows, any 413.
2. One day, Singapore Strait box (103.4–104.4 E, 1.0–1.5 N), all speeds vs moving-only → confirms `speed` on `report` and the row cut.
3. Optional: a z5 tile pass with the moving-only filter → the moving-hours-by-distance split for §4 (tiles are not reports; ~800 calls).

## Observations made in passing
- Production was fetching (one `ships-gfw-tracks-bake` run plus six `ships-gfw-month` 2025-01…06 routing runs) at 2026-10-02 ~02:00 UTC. Any global fetch job will share the single report slot with these backfills. It has to be scheduled around them, or GFW asked to enable concurrent reports.

## Option B proofs (run 2026-10-02 ~04:45 UTC, 3 report calls, day 2026-09-20, HOURLY / HIGH / group-by VESSEL_ID)
| Test | Result | Time |
|---|---|---|
| 1. One 40°×40° empty-ocean box (140–100 W, 40 S–0), moving only (`filters[0]=speed NOT IN ('<2')`) | HTTP 200 direct (no 413, no 524); 5,664 rows, 618 vessels, 2.7 MB | 22.7 s |
| 2a. Singapore Strait (103.4–104.4 E, 1.0–1.5 N), all speeds | 53,675 rows, 3,071 vessels, 25.4 MB | 18.7 s |
| 2b. Same box, moving only | 10,515 rows (−80 %), 2,070 vessels, 5.0 MB | 21.4 s |

MEASURED: the `speed` filter works on `report`; a huge empty-ocean box is accepted and costs the same ~20 s as a small one;
a very busy box with 54 k rows still returns in < 20 s. Option B's two UNCONFIRMED assumptions are confirmed.
Moving-only keeps 67 % of the Singapore vessels but 20 % of the rows (anchored/berthed ships drop out entirely).
