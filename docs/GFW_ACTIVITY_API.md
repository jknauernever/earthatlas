# Global Fishing Watch: activity APIs (reference for /ships Phase 3)

Studied 2026-09-25. Covers 4Wings (map visualization), Events, Insights,
Context Layers and Bulk Download. Vessel identity is in `docs/GFW_VESSELS_API.md`;
this doc does not repeat it.

Sources:
- GFW's full docs text (`https://globalfishingwatch.org/our-apis/documentation/llms-full.txt`).
- The rendered OpenAPI parameter tables on every endpoint page under
  `https://globalfishingwatch.org/our-apis/documentation/docs/v3/...` (the llms
  text shows `<OpenAPIPage/>` placeholders in their place).
- 51 live requests on 2026-09-25 with our token (see "Verified live 2026-09-25").

Everything below comes from those sources. **UNVERIFIED** marks anything neither
the docs nor a live response confirmed. **DOCS WRONG** marks places where a live
response contradicted the docs.

## Access, license, limits (same token and terms as the Vessels API)

| Item | Fact |
|---|---|
| Base URL | `https://gateway.api.globalfishingwatch.org/v3`. The spec pages print paths as `/api/v3/...`, but the documented and tested paths are `/v3/...`. `generate-png` returned tile URLs on a second host, `gateway.api.prod.globalfishingwatch.org`. |
| Auth | `Authorization: Bearer <token>` on **every** call, including tiles. A tile request without a token returns `401 {"error":"invalid token"}` (verified). There is no query-string token and no public or anonymous tile endpoint. |
| Token secrecy | Terms §2.G: "You may not include Your token in a publicly available web interface such that it can be discovered by other parties using Your website and/or application." **So browser Mapbox sources cannot call GFW directly. Tiles, reports and events have to go through our server (proxy or bake).** |
| CORS | The gateway itself would allow browser calls: `access-control-allow-origin: *`, and it allows the `Authorization` header (verified on preflight). The blocker is the terms, not CORS. |
| License | CC BY-NC 4.0, **non-commercial only** (Terms §1.C). GFW "reserves the right to revoke Your usage rights at any time for any reason". |
| Attribution (web and visuals) | Terms §3.A.1 allows either: **"Powered by Global Fishing Watch."** linked to https://globalfishingwatch.org on every page or visual that uses the APIs, **or** "Global Fishing Watch. [year], updated daily. [API dataset name and version], [DATE RANGE]. Data set accessed YYYY-MM-DD at https://globalfishingwatch.org/our-apis/." §3.B: downstream users must keep the attribution. GFW logos or marks need written consent. |
| Dataset licenses | §4.B–C: "each dataset carries its own license and restrictions". |
| Rate limits | Per **user**, across up to 5 tokens: 50,000 requests/day and 1,500,000/month. Going over returns `429`, and the user is blocked for 24 h (daily limit) or 30 days (monthly limit). |
| Rate-limit headers | `x-ratelimit-{daily,monthly}-limit-requests`, `-remaining-requests`, `-current-usage`, `x-ratelimit-daily-reset-hours`, `x-ratelimit-monthly-reset-days`. The values are recomputed only every 30 min. During our probes they stayed at `daily-current-usage=2408` / `remaining=47592` the whole time (verified). |
| Report concurrency | 4Wings `report`: **one running report per user**. A second concurrent report gets `429`. A report that takes more than 100 s can return `524`; get the result with `GET /v3/4wings/last-report`, which is kept for 30 min. |
| Caching headers | Tiles, bins and events come back with `cache-control: private, max-age=86400`. Reports come back with `private, max-age=604800` (verified). The docs say GET requests are also cached at GFW's gateway. |
| Versions | Use `:latest`. Since 2026-02-25 `latest` resolves to v4.0 (pipeline v4), and the resolved id comes back in the `x-datasets` header (verified for every dataset below). Older versions stay available for up to 3 months and then return `422`. |
| Error shape | `{statusCode, error, messages:[{title, detail}]}`. `204` = empty tile or empty style. `422` for zoom > 12. `413` HTML for a report polygon that is too large (send a region id instead). |

## Dataset ids (all resolved to these on 2026-09-25)

| API | `:latest` → | What it is | Coverage / latency (docs) | Unit |
|---|---|---|---|---|
| 4Wings | `public-global-presence:v4.0` | AIS vessel presence, all vessel types. **One position per vessel per hour**. Not tracks. | 2012 → ~96 h ago | hours |
| 4Wings | `public-global-sar-presence:v4.0` | Sentinel-1 SAR vessel detections, classified by deep learning (Paolo et al. 2024, Nature), matched to AIS with pipeline v4 | 2017 → ~5 days ago. Depends on satellite passes. | detections |
| 4Wings | `public-global-fishing-effort:v4.0` | AIS apparent fishing effort (GFW model) | 2012 → ~96 h ago | hours |
| Events | `public-global-port-visits-events:v4.0` | Port visits, all vessel types (v3.1 location method: intermediate anchorage) | — | — |
| Events | `public-global-encounters-events:v4.0` | Encounters: fishing-carrier, fishing-support, fishing-bunker, fishing-fishing, tanker-fishing, carrier-bunker, support-bunker | — | — |
| Events | `public-global-loitering-events:v4.0` | Loitering, all vessel types | — | — |
| Events | `public-global-fishing-events:v4.0` | Apparent fishing events | — | — |
| Events | `public-global-gaps-events:v4.0` | AIS-off ("gap") events, **prototype stage** | — | — |
| Context | `public-fixed-infrastructure-filtered:v1.1` | Offshore oil/wind/unknown structures, MVT, noise-filtered | 2017 → ~3 months ago | — |
| Context | `public-eez-areas`, `public-mpa-all`, `public-rfmo` | Region lists (and undocumented MVT, see below) | — | — |
| Bulk | `public-fixed-infrastructure-data:latest` (v1.1 per docs example) | Unfiltered fixed infrastructure detections | 2017 → ~3 months ago. Updated monthly (the docs also say "daily") | — |

Latency measured on 2026-09-25 (~15:10 UTC):
- **Presence**: the newest daily bin was **2026-09-21**.
- **SAR**: the newest bin was **2026-09-19**. SAR days are sparse (in Sept: 04, 07, 11, 12, 14, 16, 19 for tile 5/5/11), which matches satellite revisits.

## 4Wings API

### Filters (`filters[N]`, SQL-like, applied to `datasets[N]`)
- **Presence**: `flag` (`flag in ('USA','CAN')`), `vessel_type` (`vessel_type in ("cargo","carrier")`), `speed` (categories `<2`, `2-4`, `4-6`, `6-10`, `10-15`, `15-25`, `>25` knots), `vessel_id`.
- **SAR**: `matched` (`matched='false'` = **dark / not matched to AIS**), and, only when matched, `flag`, `vessel_id`, `geartype`, `shiptype`. Also `neural_vessel_type` (a model that uses only the SAR thumbnail, for unmatched detections): `"Likely non-fishing"` (≤0.1), `"Likely Fishing"` (≥0.9), `"Unknown"`.
- **Fishing effort**: `flag`, `geartype`, `vessel_id`, `distance_from_port_km` (enum 0–5 km, fishing only; the GFW Map uses 3). `distance_from_port_km=3` was accepted on the tile endpoint (verified).
- Vessel types: carrier, seismic_vessel, passenger, other, support, bunker, gear, cargo, fishing, discrepancy.
- Gear types: TUNA_PURSE_SEINES, DRIFTNETS, TROLLERS, SET_LONGLINES, PURSE_SEINES, POTS_AND_TRAPS, OTHER_FISHING, DREDGE_FISHING, SET_GILLNETS, FIXED_GEAR, TRAWLERS, FISHING, SEINERS, OTHER_PURSE_SEINES, OTHER_SEINES, SQUID_JIGGER, POLE_AND_LINE, DRIFTING_LONGLINES.

### `GET /v3/4wings/tile/heatmap/{z}/{x}/{y}`
| Param | Notes |
|---|---|
| `z` * | 0–12. Zoom 13 or above → `422 "The tiler does not support zoom levels greater than 12"`. |
| `x`, `y` * | The spec calls x "(lat)" and y "(lon)". **DOCS WRONG**: live tiles use standard XYZ/slippy order (x = column/lon, y = row/lat). 7/20/44 rendered Puget Sound. |
| `datasets[0]` * | Dataset id. Add `datasets[1]`… to compare datasets. |
| `filters[0]` | See above |
| `date-range` | `YYYY-MM-DD,YYYY-MM-DD` |
| `interval` | `HOUR`, `DAY`, `MONTH`, `YEAR`. Docs limits: hourly ≤ 20 days of range, daily ≤ 1 year. |
| `temporal-aggregation` | `true` = one value per cell for the whole range |
| `format` | `MVT`, `PNG`, `INTARRAY`, `4WINGS` |
| `style` | Base64 style id from `generate-png` (PNG only) |
| `vessel-groups[0]` | Vessel group ids (not for us) |

Formats, all verified:
- **MVT**: `application/vnd.mapbox-vector-tile`, gzip. One layer **`main`**, version 2, extent 4096. Each cell is a square **Polygon** with properties:
  - aggregated (`temporal-aggregation=true`): `cell` (int), `count` (number), `id` (`"{z}/{x}/{y}/{cell}"`, unique since 2024-04).
  - **not aggregated**: `cell`, `id`, plus **one property per time bin, keyed by days since 1970-01-01** (for `interval=DAY`, e.g. `"20666"` = 2026-08-01). Bins with no value are omitted.
- `count` units: presence and fishing = **hours** (fishing is fractional, e.g. `0.48`). SAR = **detections** (integer). Cross-check: the z0 world presence tile for Aug 2026 sums to 131,953,320, exactly the `activityHours` from `/4wings/stats` for the same range.
- Grid: response headers `x-columns: 113`, and `x-rows` (75 at z7/y44, 53 at z0). Cell index is row-major from the **bottom-left (south-west)** of the tile (cell 33 = bottom row, column 33). So a cell is about 1/113 of the tile width: ~3.19° at z0, ~0.025° at z7, and roughly 0.0008° at z12 (the z12 figure is derived, UNVERIFIED).
- Headers also carry `x-bins-0` (a suggested 10-step ramp for this tile), `x-offset`, `x-scale`, `x-empty-value`.
- `tippecanoe-decode` **aborts** on these tiles with "Polygon begins with an inner ring": the rings use the opposite winding to what tippecanoe expects. A small pbf decoder read them fine. Whether Mapbox GL renders them correctly has not been tested (**UNVERIFIED**). Mapbox GL takes its winding convention from the first ring, so it is likely fine.
- **PNG**: `image/png`, 256×256 RGBA, gzip. Needs `style` from `generate-png`.
- **INTARRAY / 4WINGS**: `application/x-protobuf`. GFW's own packed-array encoding for its frontend. Headers `x-scale: 0.01` (INTARRAY) / `0.010000` (4WINGS), and `x-empty-value` (`0` or `18446744073709551615`). Not documented. **UNVERIFIED** encoding; do not build on it.

### `POST /v3/4wings/generate-png`
Query: `color` (hex), `interval`, `datasets[0]` *, `filters[0]`, `date-range`, `vessel-groups[0]`.
Returns `{colorRamp:{stepsByZoom:{"0".."12":[{color:"rgba(r,g,b,a)", value}]}}, url}`.
`url` is a ready tile template with `style=<base64>`. The base64 decodes to
`{"color":[r,g,b],"ramp":[9 values]}` (the zoom-0 steps). Returns `204` if no
data matches. The alpha values in the colors run 0–255.

### `GET /v3/4wings/bins/{z}`
Query: `datasets[0]` *, `filters[0]`, `date-range`, `interval`, `temporal-aggregation`,
`num-bins`, `vessel-groups[0]`. Returns `{entries:[[b0,b1,…]]}` (bin breakpoints).
At z7 for Aug 2026 presence it returned breakpoints of 0…241.7. That is far below the
per-cell `count` in the same month's z7 MVT (max 67,240), so bins are **not** on the
same scale as the aggregated MVT counts. The basis (per-interval value? normalized?)
is **UNVERIFIED**.

### `GET /v3/4wings/interaction/{z}/{x}/{y}/{cells}`
`cells` = comma-separated cell indexes from the MVT. Query: `datasets[0]` *, `filters[0]`,
`date-range`, `limit`, `vessel-groups[0]`.
- Presence: `entries[0] = [{hours, id}]`, where `id` is the GFW vessel id. The docs example also shows `vessel_type`, `flag` and `speed` with placeholder ids. **Our live response had only `hours` and `id`.**
- SAR matched: `[{detections, timestamps, vessel_id}]`. `timestamps` is a comma-joined string.
- SAR **unmatched**: **one** entry for all the requested cells: `{detections: 3, timestamps: "2026-07-06T14:21:03Z,2026-08-23T14:21:19Z,2026-08-02T02:01:26Z", vessel_id: ""}`. There are no per-detection coordinates. Coordinates come from the report endpoint.

### `POST|GET /v3/4wings/report`
Query: `datasets[0]` *, `format` * (`JSON`, `CSV`, `TIF`), `group-by`, `temporal-resolution` * (`HOURLY`, `DAILY`, `MONTHLY`, `YEARLY`, `ENTIRE`), `spatial-resolution` (`LOW` = 0.1°, `HIGH` = 0.01°; used when not spatially aggregated), `spatial-aggregation` (`true`/`false`, default false), `filters[0]`, `date-range`, `vessel-groups[0]`, header `Content-Language` (`en-EN` | `es-ES`).
- **POST** body: `{"geojson": <Polygon>}` **or** `{"region": {"dataset": "public-eez-areas", "id": 8456}}` (not both).
- **GET** instead takes `region-id` + `region-dataset` and `buffer-value`, `buffer-unit` (`MILES`, `NAUTICALMILES`, `KILOMETERS`, `RADIANS`, `DEGREES`), `buffer-operation` (`DIFFERENCE`, `DISSOLVE`). GET cannot take a custom polygon but is cached at the gateway.
- **`group-by` accepts `VESSEL_ID`, `FLAG`, `GEARTYPE`, `FLAGANDGEARTYPE`, `MMSI`.** There is **no `VESSEL_TYPE`**. Live: `group-by=VESSEL_TYPE` → `422 "group-by could be VESSEL_ID,FLAG,GEARTYPE,FLAGANDGEARTYPE,MMSI"`. `GEARTYPE` on presence → `422 "gearType option not valid for dataset public-global-presence:v4.0"`. The docs' "Example 10" (presence by type) does not work as written. **To get presence by vessel type, group by `VESSEL_ID` and sum the returned `vesselType` ourselves.**
- Response: `{entries:[{"<dataset:version>":[rows]}]}`. Row fields (live, **camelCase**, while the docs table uses snake_case): `callsign, dataset, date, detections|hours, entryTimestamp, exitTimestamp, firstTransmissionDate, lastTransmissionDate, flag, geartype, imo, lat, lon, mmsi, shipName, vesselId, vesselType`. Also `vesselIDs` (count) when grouped. `date` follows the resolution (`2026-08`, `2026-08-11`, `2022-01-05 23:00`).
- `format=JSON` returned plain JSON (the spec text says "zip file"; that may apply to CSV/TIF. **UNVERIFIED**).
- Values are summed over the region.

`GET /v3/4wings/last-report`: returns the last report (running → `{uri, status:"running", lastUpdate}`; done → the same body as the report; error → `{message:{…}, status}`; 404 after 30 min). Verified: it returned our SAR report.

### `GET /v3/4wings/stats`
Query: `datasets[0]` *, `fields`, `filters[0]`, `date-range`, `vessel-groups[0]`.
**DOCS WRONG**: the enum is `FLAGS, VESSEL-IDS, ACTIVITY-HOURS` (the docs list
`ACTIVITYHOURS`, which gives `422`). The docs say stats are fishing-only. **Live, it
also works for presence.** Response: `[{activityHours, flags, vesselIds, minLat, maxLat, minLon, maxLon}]`. The bbox fields are only filled for vessel-group filters.

## How dark vessels (unmatched SAR) are represented
- Dataset `public-global-sar-presence`, filter `matched='false'`. Each unit is one Sentinel-1 detection of an object judged to be a vessel that could not be matched to any AIS position.
- **Tiles**: `count` per grid cell = number of unmatched detections. There is no identity.
- **Interaction**: aggregated `{detections, timestamps, vessel_id:""}`.
- **Report**: rows with `vesselId:""`, empty identity fields, `lat`/`lon` at the chosen resolution (HIGH = 0.01° cell centres), and a per-row `date`. Salish Jun–Aug 2026: 333 rows. Note that `entryTimestamp`/`exitTimestamp` on these rows held the same group-wide span (`2026-06-05T14:21:44Z` → `2026-08-31T02:10:06Z`) on every row. They are not per-detection times.
- Matched detections have `vessel_id`. Docs example 9: a match can point at a "noisy vessel" that has a vessel id but no identity details.
- **SAR caveats** (docs, condensed):
  - False positives from noise remain ("version 1 of the dataset").
  - Sentinel-1 "does not sample most of the open ocean".
  - **No detections within 1 km of shore** (ambiguous coastlines and rocks), and none over much of the Arctic/Antarctic (sea ice).
  - Resolution ~20 m, so **"we miss most vessels under 15 m"**. Detection of boats under 25 m also depends on wind, sea state, incidence angle and orientation.
  - Length estimates are limited by AIS ground truth.
  - In busy pleasure-craft areas near wealthy cities, small craft may be misclassified as fishing. Recall falls off for 10–20 m vessels, so total fishing vessels are undercounted.

  For the Salish Sea this means dark-vessel detections miss most recreational boats and anything tied up near shore.

## Events API

Datasets: see table. Event `type` values seen: `port_visit`, `encounter`, `loitering`, `fishing`, `gap`.

### `GET /v3/events` and `POST /v3/events`
`limit` * (≥1) and `offset` * (≥0) are required. The response is paginated: `{metadata, limit, offset, nextOffset, total, entries}`. POST returned status **201** (verified).

| Filter | GET name | POST body name | Notes |
|---|---|---|---|
| datasets * | `datasets[0]` | `datasets` | |
| vessels | `vessels[0]` | `vessels` | GFW vessel ids |
| dates | `start-date` / `end-date` | `startDate` / `endDate` | YYYY-MM-DD. Start inclusive, end exclusive. `timeFilterMode` default `OVERLAP` = **events overlapping the range**. Other values UNVERIFIED. |
| types | `types` | `types` | ENCOUNTER, FISHING, LOITERING, GAP_START, GAP, PORT_VISIT (+`typesOperator` INCLUDE/EXCLUDE) |
| vessel types | `vesselTypes` | `vesselTypes` | BUNKER, CARGO, DISCREPANCY, CARRIER, FISHING, GEAR, OTHER, PASSENGER, SEISMIC_VESSEL, SUPPORT, NON_FISHING, RESEARCH (+Operator) |
| flags | `flags` | `flags` | ISO3 (+Operator) |
| port-visit confidence | `confidences` | `confidences` | `"2"`, `"3"`, `"4"` (+Operator). Verified: returned only `"4"`. |
| encounter types | `encounter-types` | `encounterTypes` | e.g. CARRIER-FISHING, FISHING-TANKER, … (+Operator) |
| duration | `minDuration` / `maxDuration` (hours) | same, plus `duration` (min minutes) | POST requires a **string** (`"240"`); a number gives `422 "maxDuration must be a number string"`. **Live, `maxDuration:"240"` did not remove 16,748–91,999 h port visits.** Treat as not working (UNVERIFIED why). |
| ports | `portIds`, `nextPortIds` | same | (+Operators) |
| region | `regionDatasets`, `regionIds`, `buffer-*` | `region`, `regions`, `regionIds`, `geometry` (GeoJSON) | |
| gaps | `is-closed` | same | `gap-intentional-disabling` was **removed** 2025-08-21 (all AIS-off events are now intentional). |
| other | `ids`, `includes`, `include-regions` (default true), `summary`, `vesselGroups` | | |

### `GET /v3/events/{eventId}?dataset=…`
Also takes `raw` (boolean, undocumented meaning). Returns a single event object. Verified.

### `POST /v3/events/stats`
Body: the same filters, plus `timeseriesInterval` * (`HOUR`, `DAY`, `MONTH`, `YEAR`), `groupBy` (FLAG, GEARTYPE, REGION_EEZ, REGION_EEZ12NM, REGION_FAO, REGION_HIGH_SEAS, REGION_MAJOR_FAO, REGION_MPA, REGION_MPA_NO_TAKE, REGION_MPA_NO_TAKE_PARTIAL, REGION_RFMO, NEXT_PORT_ID) and `includes` (`TOTAL_COUNT`, `TIME_SERIES`, `EVENTS_GROUPED`).
Response: `{numEvents, numFlags, numVessels, flags[], timeseries[{date, value}], groups[{flag,label,name,value}]}`.

### Event object (live, v4.0)
```
id, type, start, end (ISO UTC), position{lat,lon}, boundingBox[4]
regions{mpa[], eez[], eez12Nm[], rfmo[], fao[], majorFao[], highSeas[], mpaNoTake[], mpaNoTakePartial[]}
distances{startDistanceFromShoreKm, endDistanceFromShoreKm, startDistanceFromPortKm, endDistanceFromPortKm}
vessel{id, name, ssvid, flag, type, nextPort{id,flag,name,portVisitEventId}|null, publicAuthorizations[]?}
port_visit{visitId, confidence, durationHrs,
           startAnchorage|intermediateAnchorage|endAnchorage{anchorageId, atDock, distanceFromShoreKm,
                                                             flag, id, lat, lon, name, topDestination}}
encounter{vessel{id,flag,name,type,ssvid,publicAuthorizations}, medianDistanceKilometers, medianSpeedKnots,
          type ("fishing-fishing"…), potentialRisk, mainVesselPublicAuthorizationStatus,
          encounteredVesselPublicAuthorizationStatus}
loitering{totalTimeHours, totalDistanceKm, averageSpeedKnots, averageDistanceFromShoreKm}
fishing{totalDistanceKm, averageSpeedKnots, averageDurationHours, potentialRisk, vesselPublicAuthorizationStatus}
gap{intentionalDisabling, distanceKm, durationHours, impliedSpeedKnots, positions12HoursBeforeSat,
    positionsPerDaySatReception, offPosition{lat,lon}, onPosition{lat,lon}}
```
Type quirks (live):
- `port_visit.confidence` is a **string** (`"4"`); the docs example shows a number.
- `anchorage.distanceFromShoreKm` is a string.
- `gap.distanceKm`, `impliedSpeedKnots`, `positions12HoursBeforeSat` and `onPosition.lat/lon` are strings, while `offPosition` holds numbers.
- `vessel.name` and `anchorage.name` can be `null`.
- The encounter `id` can carry a suffix (`….2`).

### Port-visit semantics (docs)
- **Port events**:
  - ENTRY: a vessel not in port comes within 3 km of an anchorage point.
  - STOP: begins at speed < 0.2 kn, ends at > 0.5 kn.
  - GAP: no AIS for more than 4 h while in port; start is recorded 4 h after the last message.
  - EXIT: the vessel moves more than 4 km from the anchorage.
- **A port visit needs at least two of these events.**
- **Confidence**:
  - **2 (low)** = only a stop or gap was seen.
  - **3 (medium)** = an entry or exit plus a stop or gap.
  - **4 (high)** = entry, stop or gap, and exit.
  - Lower confidence "may sometimes be a false port visit caused by noisy AIS transmission".
- Location (v3.1+): `position` = the **intermediate anchorage** (first port stop, or the first gap if there is no stop). Earlier versions used the mean of the port events.
- Ports come from the GFW anchorages dataset (see `docs/PORTS_SOURCES.md`). `anchorage.id` is a port label (`usa-fridayharbor`); `anchorageId` is the S2 cell id (s2 level 14, ~0.5 km).

### Other event caveats (docs, condensed)
- All events are "apparent", GFW's best effort from AIS, "must be relied upon solely at your own risk". Some events are missed and some are wrong.
- **Encounter**: two vessels within 500 m for at least 2 h, computed on positions interpolated to a 10-minute grid. So the proximity is modelled, not measured.
- **Loitering**: average speed < 2 kn while on average at least 20 nm from shore. It can overlap encounters.
- **Fishing events** group consecutive fishing positions. They are split when points are more than 10 km or 2 h apart and merged when within 1 h and 2 km. Events are dropped if under 20 min, 5 or fewer positions, under 0.5 km (squid: under 50 m), or averaging 10 kn or more.
- **AIS-off (gap)**: prototype stage.
  - GFW records every gap over 6 h, then keeps only those that are at least 12 h, start at least 50 nm from shore, start where satellite reception is over 10 positions/day, and have at least 14 satellite positions in the 12 h before.
  - Gaps under 50 nm from shore or under 12 h are unreliable.
  - Reception quality comes from 2017–2019 data (Welch et al. 2022).
  - **So AIS gaps are essentially never produced inside the Salish Sea.**
- Region membership: for encounters, loitering, port visits and gaps, the event's mean point is tested with point-in-polygon. For fishing, the track is tested. Events near a boundary can be mislabelled.
- Authorization flags (`publicly_authorized`, etc.) are computed only on the high seas in the 5 tuna RFMOs plus SPRFMO and NPFC. They are not computed inside EEZs.

## Insights API: `POST /v3/insights/vessels`
Body:
- `vessels` * `[{datasetId:"public-global-vessel-identity:latest", vesselId}]`
- `startDate`, `endDate`
- `includes` (`FISHING`, `GAP`, `COVERAGE`, `VESSEL-IDENTITY-IUU-VESSEL-LIST`, `VESSEL-IDENTITY-FLAG-CHANGES`, `VESSEL-IDENTITY-MOU-LIST`)
- `confidences`

**Our token is 403 for `VESSEL-IDENTITY-FLAG-CHANGES` and `VESSEL-IDENTITY-MOU-LIST`** ("You do not have permissions to request the [...] insights"). The other four work (201).

Response blocks:
- `period`
- `apparentFishing{datasets, periodSelectedCounters{events, eventsInNoTakeMPAs, eventsInRFMOWithoutKnownAuthorization}, eventsInNoTakeMpas[], eventsInRfmoWithoutKnownAuthorization[]}`
- `gap{datasets, periodSelectedCounters{events, eventsGapOff}, historicalCounters?, aisOff[eventIds]}`
- `coverage{blocks, blocksWithPositions, percentage}` (blocks came back as strings)
- `vesselIdentity{datasets, iuuVesselList{totalTimesListed, totalTimesListedInThePeriod, valuesInThePeriod[]}}`
- `vesselIdsWithoutIdentity`

Caveats:
- **Coverage** = the share of 1-hour blocks *during voyages* (port time excluded) that have at least one AIS position. It is computed from 2017.
- IUU list = official RFMO lists via TMT, with gaps in GFW's collection history.
- These indicators target IUU fishing due diligence. They are not general-shipping indicators.

## Context Layers API
- `GET /v3/datasets/public-eez-areas/context-layers`: JSON list of 286 EEZs, each `{label, id, iso3, isoSov1, isoSov2, isoSov3, territory1}`. Joint and overlapping claims have `iso3: null`. Source: Marine Regions EEZ v11 per the caveats. US EEZ = 8456, Canadian EEZ = 8493.
- `GET /v3/datasets/public-mpa-all/context-layers`: 17,163 MPAs, `{label, id}` (source WDPA). The response is 1.45 MB.
- `GET /v3/datasets/public-rfmo/context-layers`: 42 entries `{label, id, ID}`.
- `GET /v3/datasets/public-fixed-infrastructure-filtered:latest/context-layers/{z}/{x}/{y}` → MVT layer `main`, **Point** features with:
  - `structure_id` (string)
  - `lat`, `lon`
  - `label` (`oil` | `wind` | `unknown`)
  - `label_confidence` (`high` | `medium` | `low`)
  - `structure_start_date` / `structure_end_date` as **epoch-ms strings**, where `""` means still present.

  The filtered version drops noise, relabels `lake_maracaibo` as oil, keeps only structures detected for at least 3 months with noise probability < 0.3, and removes boxes in Chile, Canada and Norway (the Canada box is lat 50.6–74.02, lon −115.8 to −60.53, so it does not cover the Salish Sea).
- **Undocumented but working**: `GET /v3/datasets/public-eez-areas/context-layers/{z}/{x}/{y}` returns an MVT layer `main` of EEZ **polygons** with `MRGID_EEZ`, `GEONAME` (verified at 5/5/11: Canadian and US EEZ). Undocumented, so it could change. Treat as UNVERIFIED-stable.

## Bulk Download API (fixed infrastructure only, as of 2026-09)
- `POST /v3/bulk-reports` body `{name*, dataset*, filters*[], format (CSV|JSON), geojson | region{dataset,id}}`.
  - Filters: `label`, `structure_start_date`, `structure_end_date`, `label_confidence`, `structure_id`.
  - Response: `{id, dataset, name, filepath, format, filters, geom{id,type,dataset}, status (pending|processing|done|failed), ownerId, ownerType, createdAt, updatedAt, fileSize}`.
  - Can take "several minutes to several hours".
- `GET /v3/bulk-reports/{id}`: status.
- `GET /v3/bulk-reports?limit*&offset*&sort&status&dataset`: list. Verified: `total:0`. The GET returned HTTP **201**.
- `GET /v3/bulk-reports/{id}/download-file-url?file=DATA|README|GEOM` → `{url}` (a signed URL).
- `GET /v3/bulk-reports/{id}/query?limit*&offset*&sort&includes[]` → paginated rows `{detection_id, detection_date, structure_id, lon, lat, structure_start_date, structure_end_date, label, label_confidence}`.
- Not exercised live: creating a report leaves a persistent object in the account.

## Verified live 2026-09-25

51 GFW requests plus 1 unauthenticated preflight. `[TOKEN]` replaces the bearer
token. All requests go to `https://gateway.api.globalfishingwatch.org` with the
header `Authorization: Bearer [TOKEN]`. Sizes are **decompressed** byte counts
(every response was gzip or br on the wire).

Salish tile used: **z7/20/44** (lon −123.75 to −120.94, lat ~47.04 to 48.92, which covers Puget Sound, Admiralty Inlet and the southern San Juans).

| # | Request | Result |
|---|---|---|
| 1 | `GET /v3/4wings/tile/heatmap/7/20/44?datasets[0]=public-global-presence:latest&format=MVT&interval=DAY&temporal-aggregation=true&date-range=2026-08-01,2026-09-01` | 200, 2.9 s, `application/vnd.mapbox-vector-tile`, 108,569 B. Layer `main`, 2,029 cells, keys `cell,count,id`. Count 1…67,240 h, sum 1,435,689 h. `x-columns 113`, `x-rows 75`, `x-bins-0 [1,696,2584,5350,9759,15893,24191,33688,47526,54326]`. |
| 2 | same tile, no `temporal-aggregation`, `date-range=2026-08-01,2026-08-08` | 200, 107,272 B, 1,750 cells. Keys `20666…20672` (one per day) + `cell,id`. Cell 33: `{"20666":208,"20667":199,…}`. |
| 3 | `…/7/20/44?datasets[0]=public-global-sar-presence:latest&format=MVT&interval=DAY&temporal-aggregation=true&date-range=2026-06-01,2026-09-01` | 200, 21,005 B, 419 cells, 827 detections (max 17/cell). |
| 4 | same + `filters[0]=matched='false'` | 200, 8,451 B, **170 cells, 215 unmatched detections** (max 5/cell). |
| 5 | `GET /v3/4wings/interaction/7/20/44/33?datasets[0]=public-global-presence:latest&date-range=2026-08-01,2026-09-01&limit=5` | `[{"hours":1,"id":"ffc433fed-…"},…,{"hours":432,"id":"f5aaa1c39-…"}]` |
| 6 | `GET /v3/4wings/interaction/7/20/44/491,1294?datasets[0]=public-global-sar-presence:latest&filters[0]=matched='false'&date-range=2026-06-01,2026-09-01` | `[[{"detections":3,"timestamps":"2026-07-06T14:21:03Z,2026-08-23T14:21:19Z,2026-08-02T02:01:26Z","vessel_id":""}]]` |
| 7 | interaction SAR, all detections, cell 608 | `[{"detections":1,"timestamps":"2026-06-05T14:21:44Z","vessel_id":"abd99bc3e-…"},{…"a41321154-…"}]` |
| 8 | `POST /v3/4wings/generate-png?interval=DAY&datasets[0]=public-global-presence:latest&color=%2300c2ff&date-range=2026-08-01,2026-09-01` | 200, 5.7 s. Style `eyJjb2xvciI6WzAsMTk0LDI1NV0sInJhbXAiOlswLDM2MjMyLDE0NTQ3MywzMzQzMzUsNjMyMjA2LDExOTQyNDQsMTU3NDAyNywzMzUxNjI1LDM5NjA0ODldfQ==`. URL host `gateway.api.prod.globalfishingwatch.org`. |
| 9 | `GET /v3/4wings/tile/heatmap/7/20/44?format=PNG&interval=DAY&datasets[0]=public-global-presence:latest&date-range=2026-08-01,2026-09-01&style=<above>` | 200, `image/png` 256×256 RGBA, 5,087 B. Shows Puget Sound shipping lanes. |
| 10 | world: `…/tile/heatmap/0/0/0?datasets[0]=public-global-presence:latest&format=MVT&interval=DAY&temporal-aggregation=true&date-range=2026-08-01,2026-09-01` | 200, **13.2 s**, 221,125 B, 3,880 cells, grid 113×53, sum **131,953,320 h**. |
| 11 | world unmatched SAR z0, Aug 2026 | 200, 5.6 s, 49,614 B, 942 cells, 171,661 detections. |
| 12 | `POST /v3/4wings/report?…&group-by=VESSEL_TYPE…` | **422**: allowed group-by are VESSEL_ID, FLAG, GEARTYPE, FLAGANDGEARTYPE, MMSI. |
| 13 | same with `group-by=GEARTYPE` | **422**: "gearType option not valid for dataset public-global-presence:v4.0". |
| 14 | `POST /v3/4wings/report?spatial-resolution=LOW&temporal-resolution=MONTHLY&spatial-aggregation=true&group-by=VESSEL_ID&datasets[0]=public-global-presence:latest&date-range=2026-08-01,2026-09-01&format=JSON` body `{"geojson":{"type":"Polygon","coordinates":[[[-124.85,47],[-122.05,47],[-122.05,49],[-124.85,49],[-124.85,47]]]}}` | 200, **19.3 s**, 3.26 MB, **7,615 vessel rows**. See the table below. |
| 15 | `POST /v3/4wings/report?spatial-resolution=HIGH&temporal-resolution=DAILY&datasets[0]=public-global-sar-presence:latest&filters[0]=matched='false'&date-range=2026-06-01,2026-09-01&format=JSON` (same body) | 200, 21 s, **333 unmatched detection rows** 2026-06-05…2026-08-31. Row: `{"date":"2026-08-11","detections":1,"lat":47.89,"lon":-122.35,"vesselId":"",…}` |
| 16–17 | daily MVT at 5/5/11 for presence (09-15→26) and SAR (09-01→26) | Newest presence day 2026-09-21. SAR days 09-04, 07, 11, 12, 14, 16, 19. |
| 18 | `GET /v3/4wings/bins/7?datasets[0]=public-global-presence:latest&interval=DAY&temporal-aggregation=true&num-bins=9&date-range=2026-08-01,2026-09-01` | `[0,2.21,8.88,20.41,38.59,72.89,96.07,204.57,241.73]` |
| 19–20 | `stats` with `fields=…,ACTIVITYHOURS` | **422** "Allowed values: FLAGS, VESSEL-IDS, ACTIVITY-HOURS" |
| 21 | `GET /v3/4wings/stats?datasets[0]=public-global-fishing-effort:latest&fields=FLAGS,VESSEL-IDS,ACTIVITY-HOURS&date-range=2026-08-01,2026-09-01` | `[{"activityHours":7479016.99,"flags":191,"vesselIds":61943,…}]` |
| 22 | same for `public-global-presence:latest` | `[{"activityHours":131953320,"flags":229,"vesselIds":896024,…}]` |
| 23 | fishing effort MVT 7/20/44 Aug 2026 with `filters[0]=distance_from_port_km=3` | 200, 25 cells, 32.18 h total (doubles like 0.48). |
| 24–25 | `format=INTARRAY` / `format=4WINGS` | 200, `application/x-protobuf`, ~8.5 KB, `x-scale 0.01`. |
| 26 | `POST /v3/events?offset=0&limit=50` body `{"datasets":["public-global-port-visits-events:latest"],"startDate":"2026-08-01","endDate":"2026-09-01","geometry":<Salish polygon>}` | 201, 21 s, **total 43,423**. See the port-visit notes below. |
| 27 | same + `"maxDuration":240` (number) | **422** "maxDuration must be a number string" |
| 28 | same + `"confidences":["4"],"maxDuration":"240","vesselTypes":["CARGO","PASSENGER","FISHING","CARRIER","BUNKER"]` | 201, **53.8 s**, total 32,382. All confidence `"4"`, **but durations 16,748–91,999 h**, so maxDuration was not applied. |
| 29 | `GET /v3/vessels/search?query=368330140&datasets[0]=public-global-vessel-identity:latest` | 1 hit: **LINNEA ROSE**, USA, GFW id `323723207-7453-0bf2-0c0f-07e028cf1042`, AIS 2025-05-02 → 2026-09-23. |
| 30 | `GET /v3/events?datasets[0]=public-global-port-visits-events:latest&vessels[0]=323723207-7453-0bf2-0c0f-07e028cf1042&start-date=2025-01-01&end-date=2026-09-26&limit=5&offset=0` | **total 56 port visits.** Not empty, even though it is a pleasure boat. `vessel.type:"other"`. First five: usa-usa-397 (95.5 h), USA-626 (43.8 h), usa-stuartisland (3.2 h), CAN-382 (18.4 h), **ROCHE HARBOR** 2025-05-09→05-22 (297.2 h). All confidence `"4"` and `atDock:true`. |
| 31–34 | same vessel: gaps / encounters / loitering / fishing | all `total: 0` |
| 35 | `GET /v3/events/1f991d2b7fe0adad74f0434e2c10f5e5?dataset=public-global-port-visits-events:latest` | The Roche Harbor visit. `regions.mpa:["555672185","312353"]` (San Juan Islands National Monument; San Juan County/Cypress Island Marine Biological Preserve), `eez:["8456"]`, endAnchorage `usa-barlowbay`. |
| 36 | insights with all six `includes` | **403** for FLAG-CHANGES and MOU-LIST |
| 37 | `POST /v3/insights/vessels` `{"includes":["FISHING","GAP","COVERAGE","VESSEL-IDENTITY-IUU-VESSEL-LIST"],"startDate":"2025-01-01","endDate":"2026-09-20","vessels":[{"datasetId":"public-global-vessel-identity:latest","vesselId":"323723207-…"}]}` | 201: `coverage{"blocks":"5010","blocksWithPositions":"83","percentage":1.66}`, gap 0, fishing 0, IUU 0. The `vesselIdentity.datasets` field said `public-global-vessel-identity:v3.0`. |
| 38 | `POST /v3/events/stats` Salish port visits Aug 2026, `timeseriesInterval:"DAY"`, `confidences:["3","4"]` | 200, 29 s: `numEvents 43171, numFlags 42, numVessels 8029`, daily 1,125–1,380 |
| 39 | `POST /v3/events?limit=1` gaps, NE Pacific box [−160,30,−120,55], Aug 2026 | total 94. Sample: `gap{intentionalDisabling:true, durationHours:9526.9, distanceKm:"1900.6", offPosition{58.60,-148.25}, onPosition{"47.93726","-125.609645"}}`, vessel type `gear`, flag MAR |
| 40 | encounters, same box | total 46. Sample fishing-fishing, SALISH ECHO / GOOD HOPE GUIDE 8, 0.292 km, 0.714 kn |
| 41 | loitering, same box | total 3,452 |
| 42 | fishing, same box | total 13,450. Sample: REGULUS, **24-day "fishing" event at 0.26 kn in Elliott Bay, 0.75 km from port**. This is a plausible false positive of the kind the caveats describe. |
| 43–45 | EEZ / MPA / RFMO lists | 286 / 17,163 / 42 entries |
| 46 | `GET /v3/datasets/public-fixed-infrastructure-filtered:latest/context-layers/5/5/11` | 13 points, e.g. `{"structure_id":"842042","lat":48.5095,"lon":-122.5801,"label":"oil","label_confidence":"medium","structure_start_date":"1483228800000","structure_end_date":""}` (Anacortes / March Point) |
| 47 | same at 3/1/3 (US West Coast / Mexico) | 3,060 points, 193 KB |
| 48 | `GET /v3/datasets/public-eez-areas/context-layers/5/5/11` (undocumented) | MVT: Canadian EEZ + US EEZ polygons, `MRGID_EEZ`, `GEONAME` |
| 49 | `GET /v3/bulk-reports?limit=5&offset=0&sort=-createdAt` | HTTP 201, `total:0` |
| 50 | `GET /v3/4wings/last-report` | returned request 15's body |
| 51 | tile without `Authorization` | **401** `{"error":"invalid token"}` |
| — | `OPTIONS` preflight with `Origin` + `Access-Control-Request-Headers: authorization` | 200, `access-control-allow-origin: *`, `Authorization` allowed |

Salish presence, Aug 2026, from request 14 (grouped by `VESSEL_ID`, summed by `vesselType`):

| vesselType | vessels | hours |
|---|---|---|
| PASSENGER | 4,818 | 1,030,971 |
| OTHER | 1,772 | 333,836 |
| FISHING | 536 | 118,900 |
| CARGO | 253 | 18,446 |
| NA | 185 | 13,394 |
| CARRIER | 23 | 4,347 |
| "" | 13 | 1,219 |
| GEAR | 8 | 1,065 |
| SEISMIC_VESSEL | 7 | 336 |
| **total** | 7,615 | 1,522,514 |

These are GFW's own classes. Most Salish pleasure craft apparently fall under PASSENGER, OTHER or NA (UNVERIFIED). Sample row:
`{"callsign":"D5CZ4","date":"2026-08","entryTimestamp":"2026-08-08T04:00:00Z","exitTimestamp":"2026-08-08T13:00:00Z","flag":"LBR","geartype":"CARGO","hours":10,"imo":"9582518","mmsi":"636015816","shipName":"SUDETY","vesselId":"5281fe95e-e6a6-a988-dde7-d3911bed29c5","vesselType":"CARGO"}`.

Port visits in the Salish box, Aug 2026 (request 26):
- **Sorted by `start` ascending, so multi-year "visits" come first.** Every one of the first 50 had begun before August (durations 61,638–120,734 h, e.g. a visit starting 2012-11-07). These are vessels whose visit never closed: stationary transmitters, liveaboards, possibly MMSI reuse (UNVERIFIED which).
- Confidence mix in those 50: `"2"`×14, `"3"`×31, `"4"`×5.
- Intermediate-anchorage names include SEATTLE, EVERETT, TACOMA, FRIDAY HARBOR, ROCHE HARBOR, PORT ANGELES, VICTORIA, plus unnamed ids such as `usa-usa-399` with `name:null`.
- Friday Harbor sample: `{"start":"2017-08-02T05:49:16Z","end":"2026-08-27T20:12:43Z","position":{"lat":48.5338,"lon":-122.9745},"vessel":{"ssvid":"366993822","flag":"USA","type":"NA"},"port_visit":{"confidence":"4","durationHrs":79502.39,"intermediateAnchorage":{"anchorageId":"548f7e39","atDock":true,"id":"usa-fridayharbor","lat":48.533768,"lon":-122.974520,"name":"FRIDAY HARBOR","topDestination":"BK"}}}`
- Tacoma sample: `usa-tacoma`, anchorageId `5490560f`, 47.26662/−122.36873, PHL-flag cargo vessel, visit since 2014-05-29, confidence `"3"`.
