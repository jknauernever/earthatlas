# MarineCadastre AIS (NOAA/BOEM): reference for /ships

Studied 2026-09-24. Sources:
- the official repo <https://github.com/ocm-marinecadastre/ais-vessel-traffic> (README, data readmes, `docs/` code tables);
- NOAA InPort metadata item 73064 ("Nationwide Automatic Identification System 2024");
- the Azure blob listings;
- the Parquet footers, read remotely with DuckDB 1.4.4;
- real rows pulled for LINNEA ROSE (MMSI 368330140).

Items marked **UNVERIFIED** were not confirmed.

## What it is
The US Coast Guard's Nationwide AIS (NAIS) **terrestrial** receiver network,
filtered by NOAA's Office for Coastal Management to **one position per vessel
per minute** within the US EEZ, and published for ocean planning. Credit line:
"U.S. Coast Guard Navigation Center, Bureau of Ocean Energy Management, NOAA
Office for Coastal Management."

| Item | Fact |
|---|---|
| License | **CC0 1.0** ("All content is licensed under the CC0 1.0 Universal public domain dedication", repo README and LICENSE). InPort's "Use Constraints: For coastal and ocean planning" is a statement of purpose, not a license term. Access constraints: none. |
| Coverage | Bounding box 141°W to 60°W, 11°S to 51.5°N. Land receivers only, so coverage fades offshore (range is line of sight). **All Alaska records are removed** at the request of the Alaska Marine Data Exchange. **Canadian waters are not covered** (e.g. the northern Salish Sea / Strait of Georgia). |
| Accuracy | "10 meters horizontal accuracy at 95% confidence". Whether a vessel appears at all depends on antenna geometry, transmit power and radio interference, so a missing record never means "no vessel". |
| Time | UTC throughout. Positions are downsampled to about one per minute. |
| Latency | Daily CSVs run to **2026-06-30** (last upload 2026-09-18), so roughly a quarter behind. |
| Identity fields are corrected | Since 2024, NOAA **validates and sometimes overwrites** vessel_name, IMO, call sign, length, width and vessel_type with the USCG-compiled **AIS Vessel Identification Database (AVID)**, where AIS values are "null or clearly incorrect" (over 10% of records improved). Earlier years used the 2018 AVIS database. **Records do not say which values were overwritten.** |

**Consequence for /ships:** MarineCadastre static fields get their own
evidence label, *"AIS as published by NOAA (USCG-corrected)"*, distinct from
pure `ais_self_reported`. The MMSI itself is not in the overwrite list: it is
the transmitted identifier.

## Products

| Product | Years | Format | Size | Location |
|---|---|---|---|---|
| **Daily broadcast points (CSV)** | **2015-01-01 → 2026-06-30** (2009–2014 are not in this store) | `ais-YYYY-MM-DD.csv.zst` (zstd) | ~320 MB compressed per day | `https://noaaocm.blob.core.windows.net/ais/csv2/csvYYYY/` (+ `index.html`) |
| Daily broadcast points (GeoParquet 1.0, Snappy) | 2024 only | `ais-2024-MM-DD.parquet` | ~310 MB, ~9.8 M rows/day | `https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/ais2024/` |
| **Monthly vessel tracks (GeoParquet 1.1, ZSTD)** | 2024-01 → 2025-12 | `ais-track-YYYY-MM.parquet` | ~1.78 GB, ~2.2 M tracks/month (2025-07), 3 row groups | `https://ocmgeodatastor1.blob.core.windows.net/marinecadastre/aistrack/` (+ `index-aistrack.html`) |
| Annual transit-count map services | 2020–2024 | ArcGIS MapServer (cached tiles) | — | `coast.noaa.gov/arcgis/rest/services/MarineCadastre/AISVesselTransitCounts{YEAR}/MapServer` |
| AccessAIS custom orders | 2009+ | zipped CSV, ~2 GB limit | — | marinecadastre.gov/accessais (interactive) |

The repo calls the GeoParquet files "experimental … complete and
analysis-ready", cleaned of the sentinel values found in AccessAIS.

### Daily points: columns (2025 dictionary; the CSV header is identical 2015→2026)
`mmsi, base_date_time, longitude, latitude, sog, cog, heading, vessel_name, imo, call_sign, vessel_type, status, length, width, draft, cargo, transceiver`

| Field | Type / unit | Domain | Notes |
|---|---|---|---|
| mmsi | int32 | 9 digits | as transmitted; never null |
| base_date_time | timestamp, UTC | — | "practical resolution is whole second" |
| longitude, latitude | double, decimal ° | ±179.99999 / ±89.99999 | WGS84 |
| sog | float, knots | 0–99.9 | nullable |
| cog | float, ° | 0–359.9 | nullable |
| heading | int, ° | 0–359 | nullable (often empty for Class B) |
| vessel_name | string ≤20 | ASCII | quotes and commas stripped (commas become `;` in CSV) |
| imo | string | `IMO` + 7 digits | prefix added on export; often empty |
| call_sign | string | — | |
| vessel_type | int | 1–1024 | AIS ship & cargo code, or a USCG extended code (below) |
| status | int | 0–15 | navigation status (below) |
| length, width | int, m | 1–509 / 1–61 | |
| draft | float, m | 1–24 | |
| cargo | int | 1–1024 | |
| transceiver | char | A \| B | **B = low-power units, typical of recreational boats** |

Early years are sparse: in 2015 many rows carry only MMSI and position, and
type is a USCG extended code (e.g. `1019` = Recreational).

### Monthly tracks: columns (from the Parquet footer)
`mmsi, vessel_name, imo, call_sign, vessel_type, vessel_type_name, status, length, width, draft, cargo, transceiver, duration_minutes, start_time, end_time, geometry`
- `geometry` is WKB **MultiLineString, 2-D. There is no time per vertex**, only
  the track's `start_time` and `end_time`. Tracks can show where a ship went
  but cannot animate it over time.
- `vessel_type_name` is NOAA's group name (e.g. "Pleasure Craft").
- **How tracks are cut (observed, UNVERIFIED as a rule):** a new row starts at
  every UTC midnight and after short broadcast gaps. LINNEA ROSE's July 2025
  splits happened at gaps of 2, 7 and 9 minutes. There is no published
  segmentation spec.

### Vessel type codes (repo `docs/vessel-type-codes-2020.pdf`, `-2018.pdf`)
AIS codes and NOAA's groups:

| Code | Group |
|---|---|
| 30 | Fishing |
| 31, 32, 52 | Tug Tow |
| 33–35, 50, 51, 53–59, 90 | Other |
| 36, 37 | Pleasure Craft/Sailing |
| 40 | Passenger (HSC/ferries) |
| 60 | Passenger |
| 70 | Cargo |
| 80 | Tanker |
| 0 / null | Not Available |

Second digits "9" (x9) mean "no additional information".

USCG extended codes (pre-AVID years):

| Code | Group |
|---|---|
| 1001, 1002 | Fishing |
| 1003, 1004, 1016 | Cargo |
| 1005–1008, 1010, 1011, 1018, 1020, 1022 | Other |
| 1012–1015 | Passenger |
| 1017, 1024 | Tanker |
| 1019 | Recreational (Pleasure) |
| 1021 | SAR aircraft |
| 1023, 1025 | Tug Tow |

Code 1009 is not legible in the PDF text (UNVERIFIED).
`scripts/bake-shiptraffic/fetch_ais.py vessel_class()` already maps the main
codes.

### Navigation status (repo `docs/navigation-status-lut.png`)
| Code | Meaning |
|---|---|
| 0 | under way using engine |
| 1 | at anchor |
| 2 | not under command |
| 3 | restricted maneuverability |
| 4 | constrained by draught |
| 5 | moored |
| 6 | aground |
| 7 | engaged in fishing |
| 8 | under way sailing |
| 9, 10 | reserved (hazardous cargo / HSC / WIG) |
| 11 | towing astern |
| 12 | pushing ahead or towing alongside |
| 13 | reserved |
| 14 | AIS-SART / MOB / EPIRB active |
| 15 | undefined (default) |

## Verified samples (LINNEA ROSE, MMSI 368330140)
- **Tracks, 2025-07:** 33 rows, all `vessel_type 37 "Pleasure Craft"`,
  transceiver B, call sign WN0431D, no IMO or dimensions. Trips run from
  near Friday Harbor, San Juan Island (−123.017, 48.538). The longest was
  62 nm on 07-10.
  - Reading one MMSI out of a monthly file remotely took 81 s. DuckDB has to
    scan the mmsi column across 1.78 GB, because the file has only 3 row
    groups and isn't sorted by MMSI.
- **Points, 2026-06-21:** 146 positions, 15:16 → later UTC, SOG up to 23.9 kn,
  heading empty (typical for Class B). Scanning one full day's CSV for one
  MMSI takes about 20 s.
- **For comparison:** GFW classifies the same boat as "OTHER" (model), while
  NOAA/USCG say "Pleasure Craft". Showing both labels side by side is exactly
  the evidence-class distinction /ships is built on.

## Scale reality (for planning)
- ~9.8 M positions/day nationwide × 365 ≈ **3.6 B positions/year**.
- ~2.2 M track rows/month.

Nothing national can be served raw. Any product must be **regional and/or
aggregated**, baked offline into tiles, following the /shiptraffic pattern:
DuckDB → tippecanoe → PMTiles → Blob → `api/vessel-tiles.js`. Positions stay
out of Postgres (src/ships/CLAUDE.md).
