# /ships test fixtures

| File | What it is |
|---|---|
| `gfw-doc-miss-freya.json` | **Real** GFW response entry, copied verbatim from GFW's documentation ("Basic search" example, `/docs/examples/vessels/vessels-example1`). |
| `gfw-doc-claudina.json` | **Real** GFW entry, verbatim from `/docs/quick-start` (has a registry owner and combinedSourcesInfo). |
| `gfw-live-gabu-reefer-2026-09-24.json` | **Real, recorded live** 2026-09-24: `GET /v3/vessels?ids[0]=0b7047cb5-…&registries-info-data=ALL` (dataset v4.0). |
| `gfw-live-cresty-2026-09-24.json`, `gfw-live-goldeneye-2026-09-24.json` | **Real, recorded live** 2026-09-24 (one detail call returned both). Sister ships that share an AIS identity inside GFW's data: the regression case for never matching GFW entries by AIS id. |
| `gfw-live-linnea-rose-2026-09-24.json` | **Real, recorded live** GFW detail entry for LINNEA ROSE (MMSI 368330140), Josh's QA boat. |
| `mc-live-linnea-rose-2026-06-21.ndjson` | **Real** MarineCadastre identity rows for LINNEA ROSE, derived from the 146 positions in `ais-2026-06-21.csv.zst` (the shape build_tracks.py writes). |
| `gfw-doc-don-tito.json` | **Real** GFW entry, verbatim from `/docs/v3/vessels/get-one-vessel` (AIS only, no registry). |

`scenarios.js` builds two kinds of entries:
- `gabuReefer()`: the documented GABU REEFER case (`/docs/v3/general-api-doc/data-caveats`, "Why am I seeing multiple ids"). The ids, MMSIs, callsigns and dates come from that table; we assembled them into GFW's JSON shape. The docs give dates only, so times are set to 00:00Z (the ongoing identity ends at the documented 2023-10-19).
- **Synthetic test scenarios**, named `TEST …` and clearly fake, for cases the documentation does not show: conflicting registries, shared MMSIs, ownership changes. They exist only inside throwaway test schemas and are never shown to users.

Record more live responses with `npm run ships:import-gfw -- --save <dir> …`.

## Wikidata (and the EURODAM cross-source case)

| File | What it is |
|---|---|
| `wd-live-eurodam-2026-09-25.json` | **Real, recorded live** 2026-09-25 by `scripts/ships/wikidataClient.js`: `request` (the `wbgetentities` URL), `response` exactly as received for Q548546 (MS Eurodam), and `lookup` / `lookup_raw` (the SPARQL label / ISO / watercraft lookups for the items it references). |
| `wd-live-misc-2026-09-25.json` | **Real, recorded live** the same way: Q52331308 (Horizon Kodiak, three official names with dates), Q135414827 (Point Nemo, ex New Jersey Responder, type change over time; its IMO sits on two of our NOAA vessels), Q5338367 (Edison Chouest Offshore: a company carrying an IMO *company* number in P458). |
| `gfw-live-eurodam-2026-09-25.json` | **Real, recorded live** GFW detail entry (`registries-info-data=ALL`) for IMO 9378448. |
| `mc-live-eurodam-2026-06.ndjson` | **Real** MarineCadastre identity rows for MMSI 245206000 from `scripts/ships/bake-ais/build/identity-2026-06.ndjson`. |

`wikidata-db.test.js` also builds a few **SYNTHETIC** cases from these (Q-ids ≥ Q900000000, MMSIs 36700090x / 367000999), each marked in the test name.
| `commons-live-eurodam-2026-09-25.json` | **Real, recorded live** Wikimedia Commons `imageinfo` response (licence extmetadata, 640 px thumbnail) for EURODAM's two P18 files. |

`typeLookup.test.js` and the licence-filter test use small **SYNTHETIC** rows / metadata, marked as such in the test names.

## Wikimedia Commons IMO categories (docs/COMMONS_PHOTOS.md)

| File | What it is |
|---|---|
| `commons-live-imo-2026-09-27.json` | **Real, recorded live** 2026-09-27 by `scripts/ships/commonsClient.js`: one `categoryinfo` request for `Category:IMO 9500001` (missing), `9509401` and `9515395`, then for the two that exist the `categorymembers` response and the `generator=categorymembers` + `imageinfo` response for their ship subcategory (JUPITER SPIRIT, 2 files; PARSIFAL, 15 files, one also filed under a tugboat's category). Every `request` URL and `response` exactly as received. |

`commons.test.js` edits a few real pages (NC licence, PDF, interior title) and `commons-db.test.js` swaps the IMO of the real GFW / NOAA EURODAM fixtures to 9509401; both are **SYNTHETIC** and marked in the test names.

## Official registries (docs/VESSEL_REGISTRIES.md)

| File | What it is |
|---|---|
| `fcc-live-uls-2026-09-20.json` | **Real** FCC ULS rows from the weekly `l_ship.zip` (File Creation Date 2026-09-20), grouped per licence exactly as `buildLicenseRecord` stores them: personal fields `[withheld]` with the original line's SHA-256 (privacy rule). Licences: BLACKFISH VI (4921984), LINNEA ROSE (4805138, licensee a private individual: name withheld), SEARCHER (1545921) and YANKEE (3202504), the two earlier holders of MMSI 368616000. |
| `psix-live-2026-09-25.json` | **Real, recorded live** USCG CGMIX PSIXData responses (every XML result string as received) for BLACKFISH VI (1763413) and EURODAM (865188). |
| `tc-live-2026-09-25.json` | **Real** Transport Canada data: the open.canada.ca export row (parsed by `lib/ships/xlsx.js`) + the Vessel Registration Query System API response as received, for SPIRIT OF VANCOUVER ISLAND, SEASPAN RAPTOR, SALISH SEA ECLIPSE. |
| `mc-live-368616000-…`, `mc-live-316001269-…`, `mc-live-316042022-…` (2025-07_2026-06) | **Real** MarineCadastre identity rows (from `scripts/ships/bake-ais/build/identity-*.ndjson`) for BLACKFISH VI, SPIRIT OF VANCOUVER ISLAND ("SPIRIT OF V I" on AIS) and SEASPAN RAPTOR. |

`registries.test.js` / `registries-db.test.js` also build a few **SYNTHETIC** variants (a licence with BLACKFISH's MMSI but another name, a PSIX record with the call sign removed, a made-up recreational LLC licence), each marked in the test name.

## Incidents (docs/SHIP_INCIDENT_SOURCES.md §13)

| File | What it is |
|---|---|
| `cgmix-live-2026-09-26.json` | **Real, recorded live** 2026-09-26 by `scripts/ships/cgmixClient.js`: every stored IIR result string (title, summary, involved vessels, water segments, personal-casualty summary, vessel status, brief) for WALLA WALLA 7669720, ALEUTIAN ISLE 7543400, KODIAK ENTERPRISE 7665123 and EURODAM 8016476 / 6250030 / 6520747 / 6580151 / 4748475; plus PSIX `getOperationControls` 8202052 and `getVesselDeficiencies` 8237466 (EURODAM), each with a `context` copied from our stored PSIX vessel record (vessel id, name, case start, port). The IIR briefs are narratives; tests only check that they are withheld. |
| `ecology-live-2026-09-26.json` | **Real** rows of the WA Ecology "Reported spills to water" layer query (`Source_Type='Vessel'`), rows exactly as returned: ALEUTIAN ISLE (ERTS 716940, two product rows), KODIAK ENTERPRISE (722001), F/V Blackfish 2015 (661444, not BLACKFISH VI), a recreational sinking (657839), and a Puget Sound row with an inland longitude (747793). |
| `names-live-2026-09-26.json` | **Real** rows: 4 Washington NRC reports from `CY26.xlsx` (BLACKFISH pleasure craft 1472632, COASTAL PROGRESS, FORTRESS, MATSON KODIAK) as `import-incidents-names.mjs` stores them (CALLS responsible-party columns dropped, original row hash kept), and 4 NOAA IncidentNews CSV rows (MOLLUSK 11081, NEW ST. JOSEPH 11195, recreational CAIRDEAS 11065, NORTH AMERICAN 10785). |

`incidents-db.test.js` also builds **SYNTHETIC** events (source `test-incidents`, keys `T-…`, names `TEST …`) for identifier cases the real fixtures do not cover (IMO / official number / MMSI inside and outside our observed window, conflicting identifiers), plus one Ecology row with a changed case name. Each is marked in the test name.

## Port visits (docs/GFW_ACTIVITY_API.md, "Port visits for one vessel")

All four are **real, recorded live** 2026-09-26 from `GET /v3/events?datasets[0]=public-global-port-visits-events:latest&vessels[i]=…`. Each file keeps the request, status, response headers and `metadata / total / limit / offset / nextOffset` as received; `entries` is a **verbatim subset** of the response (the file's `_label` says which).

| File | What it is |
|---|---|
| `gfw-live-portvisits-american-endurance-2026-09-26.json` | AMERICAN ENDURANCE (`19004d162-…`, MMSI 369040000), 2 years: the newest 12 of 160 visits (SELBY, PORT ANGELES, a `name: null` anchorage). |
| `gfw-live-portvisits-eurodam-2026-09-26.json` | EURODAM, one request with all 15 GFW identity ids: the newest 8 of the ship's own 467 visits (identity `6d8a6e1eb-…`, MMSI 245206000; the newest has confidence `"3"` and null names) plus **all 17** visits of its 14 tender/lifeboat identities (MMSIs 245206011–016, 545–77,326 h). The regression case for `ownIdentities`. |
| `gfw-live-portvisits-linnea-rose-2026-09-26.json` | LINNEA ROSE (`323723207-…`), the newest 10 of 58 visits. |
| `gfw-live-portvisits-spirit-of-vancouver-island-2026-09-26.json` | SPIRIT OF VANCOUVER ISLAND (BC Ferries), the newest 9 of 4,550 (Swartz Bay = unnamed `CAN-279`, TSAWWASSEN). |

`portVisits.test.js` / `portVisits-db.test.js` also edit copies of these events (zone-less timestamp, end before start, changed confidence) and use a few `TEST-…` identities; each such case is marked **SYNTHETIC** in the test name. The DB test replays the recorded entries through a fake client (filter by id + date overlap, oldest first, limit/offset), never GFW itself.

## Ports reference (docs/PORTS_SOURCES.md, "Step 2")

| File | What it is |
|---|---|
| `ports-live-2026-09-26.json` | **Real** verbatim extracts of the four downloads made 2026-09-26 (2026-09-27 UTC) by `scripts/ships/import-ports.mjs --fetch`: 15 WPI JSON port objects (Salish Sea, Alaska, SF Bay, Port Everglades), 7 GeoNames `countryInfo.txt` lines + header, 8 UN/LOCODE 2025-1 CSV lines, 11 `anchorage_overrides.csv` rows + header (incl. repeated cells and one mangled s2id), each with its download `.meta.json`; plus one GFW port-visit event (usa-homer) exactly as stored by the step-1 fetch. |

`ports.test.js` marks its few edited cases SYNTHETIC in the test name.

## Anchorage areas (docs/ANCHORAGE_AREAS_SOURCES.md)

| File | What it is |
|---|---|
| `anchorages-live-2026-09-27.json` | **Real** verbatim extracts of the downloads made 2026-09-27 by `scripts/ships/import-anchorages.mjs --fetch`: 9 of the 679 MarineCadastre "Anchorages" FeatureServer GeoJSON features (Cherry Point, Smith Cove West, Elliott Bay East, the Port Angeles non-anchorage area, SF Anchorage 20, LA Anchorage F, a MultiPolygon, a null-CFR row, a 110.228 row); 3 of the 117 DFO Pacific commercial anchorage features (English Bay U, English Bay 1, Royal Roads A with radius "unknown"); the proposed §110.230 text of 82 FR 10313 as GPO's plain text gives it; the eCFR Part 110 version entries for 110.214/224/228/230 plus the non-substantive ones after 2022-11-17; and 7 real GFW port-visit positions (event id + position as stored in the dev DB). |

`anchorages.test.js` / `anchorages-db.test.js` mark the cases they build or edit (hole/circle shapes, an overlapping designated copy, a renamed feature) SYNTHETIC in the test name.

## Port card (Phase 3 step 3)

| File | What it is |
|---|---|
| `portcard-live-2026-09-27.json` | **Real, recorded live** 2026-09-27: GFW `GET /v3/events?port-ids[0]=usa-anacortes&time-filter-mode=START-DATE` for June 2026 (the first 25 of 180 entries kept; `total`/`nextOffset` as received), `POST /v3/events/stats` for usa-anacortes Jul 2025 – Jun 2026 (verbatim), a `POST /v3/events` geometry response around WPI Anacortes for Aug 2026 (20 of 200 entries kept), 8 IMF PortWatch port features (Salish + the two `TR BOT` ports) and PortWatch `Daily_Ports_Data` for port47 in June 2026 (verbatim). |

## Terminals (lib/ships/terminals.js)

| File | What it is |
|---|---|
| `terminals-live-2026-09-27.json` | **Real, recorded live** 2026-09-27/28 by `scripts/ships/import-terminals.mjs --save`, cut down to the 9 terminals listed in its `terminals` field: USACE Docks features (02JT, 0USS, 0U5V, 0U5U), WA Ecology layer-132 features (OBJECTID 1, 2, 11, 13), BC Ports and Terminals WFS features (SOURCE_DATA_ID 215, 258, 260, 261), the 16 Overpass elements behind the Tacoma LNG berth (plus 9 more recorded live 2026-09-28 for the Westshore, Westridge and BP Cherry Point berths added then; `osm.added`), the GEM coal-terminal map-file row for T1087, and 5 Climate TRACE refinery features from the v5.10.0 bake. Request URLs kept; nothing edited. |
| `gfw-live-portvisits-salish-terminals-2026.json` | **Real** GFW port-visit events (20), exactly as received and stored in the dev DB (`source_records`, source `gfw-port-visits`), chosen because a stop lies near a listed terminal in 2026-01..06 (Cherry Point tankers, the March Point anchorage between the two Anacortes refineries, Westridge, a Burnaby → Roberts Bank visit, Tacoma LNG). |

| `gem-ggit-lng-salish-2024-12-20.json` | **Real** features copied verbatim from Global Energy Monitor's GGIT map file (`ggit_2024-12-20.geojson`, downloaded once 2026-09-28): Tilbury Island LNG units T104401 and T104402, Woodfibre LNG T037401, and a cancelled Discovery LNG unit. |

`terminalCard.test.js` uses those GEM features, a REAL IMO GISIS facility row (Univar, `gisis-isps-facilities-live-2026-09-28.json`) and the REAL GFW visits above; classifications it builds by hand are marked SYNTHETIC.

`terminals.test.js` / `terminals-db.test.js` also use a few **SYNTHETIC** edits (a renamed Ecology row, a moved OSM element, hand-placed berths for the 1.0 km / 1.5× boundaries, a visit stitched from two real anchorages, a terminal dropped from the list), each marked in the test name.

## Official port names / status (docs/OFFICIAL_PORT_LISTS.md, "Built")

| File | What it is |
|---|---|
| `official-ports-live-2026-09-27.json` | **Real, recorded live** 2026-09-27 (UTC 2026-09-28) with the importer's own queries (Salish box -125.5,47,-122,50.5): the three DFO Small Craft Harbours ESRI layer responses **verbatim** (35 + 18 + 4 features); the USACE/BTS Port Areas response with **3 of its 9 features** kept verbatim (Clallam 4707, Everett 4727, Bellingham 4736); the two Transport Canada pages (CPA list, TC-owned ports) as fetched; **verbatim substrings** of the two Justice Laws XML files (the Canada Marine Act `<Schedule>` element; the Public Ports Regulations Schedule 1 heading + limits for Victoria); and 14 World Port Index JSON port objects exactly as downloaded 2026-09-26. |

`officialPorts.test.js` / `officialPorts-db.test.js` mark the cases they build or edit (a same-named port across the border, two same-named ports, a hole / overlapping polygon, an unconfirmed hand row, a port placed at Sooke, an overlapping copy of the Everett area) SYNTHETIC in the test name.

## IMO GISIS (lib/ships/gisis.js; docs/IMO_GISIS.md "Built (dev)")

Used on Josh's instruction assuming IMO permission; written permission not yet obtained; the IMO Web Accounts policy otherwise forbids republishing. The full exports stay in the gitignored `scripts/ships/gisis/raw/`; only these few rows are kept here.

| File | What it is |
|---|---|
| `gisis-reg42-live-2026-09-28.json` | **Real** CSV lines copied verbatim (header + 17 of 7,414 rows, `line_numbers` given) from the MARPOL Annex VI Reg. 4.2 "Download all data" export `IMO-20260928-05101938.csv` (sha256 in the file), downloaded once with the page's button by Josh's GISIS account 2026-09-28 05:10 UTC. Cruise ships (NORWEGIAN BLISS, OVATION OF THE SEAS, MAJESTIC PRINCESS), two rows for one IMO, open / hybrid / "OPEN/CLOSED" loop wording, non-EGCS rows, an exact duplicate pair, IMOs failing the check digit and IMO fields that are not 7 digits. Nothing edited. |
| `gisis-isps-facilities-live-2026-09-28.json` | **Real** CSV lines copied verbatim (header + 18 of 12,343 rows) from the Maritime Security "Declared port facilities" export `MaritimeSecurity-CheckOnlineForLatest-20260928-05155984.csv`, downloaded once 2026-09-28 05:15 UTC. Burrard Inlet / Fraser / Howe Sound facilities (incl. rows whose GISIS position is wrong), duplicate G3 and Fraser Grain entries, the US Puget Sound Port Area, one non-North-American row, a DDMM-only coordinate row and a row without coordinates. The export has no personal contact columns. Nothing edited. |

`gisis.test.js` / `gisis-db.test.js` mark what they build SYNTHETIC in the test name (a changed header, officer / email columns, wrong-hemisphere and 61-minute coordinates, crosswalk mismatches, an export without one IMO). The vessel in `gisis-db.test.js` is SYNTHETIC: the real GFW EURODAM entry with its IMO swapped to 9751509.

## AIS-inferred berths (lib/ships/aisBerths.js)

| File | What it is |
|---|---|
| `ais-berths-burrard-2026-09-28.json` | **Real** data, copied 2026-09-28. `stops`: 38 rows of `berth-stops-burrard.csv` (written by `scripts/ships/bake-ais/berth_stops.py` from the MarineCadastre AIS salish-v6 points cache, CC0, 2025-07-01 … 2026-06-30), nothing edited: the first 14 / 12 / 10 long stops (by start time) within 40 m of the Richardson, Cargill-pier and Pacific Terminal / Vanterm tanker clusters, plus the first 2 stops that spread > 150 m (ships swinging at anchor) near Vancouver anchorages B/C. `osm`: the outer-way geometries of 5 OpenStreetMap elements (Richardson and Cargill site relations, Cargill pier, Pacific Terminal site, GCT Vanterm) exactly as the Overpass response returned them (base in the file). © OpenStreetMap contributors, ODbL 1.0. |
| `bc-ports-terminals-272-live-2026-09-28.json` | **Real, recorded live** 2026-09-28 by `npm run ships:import-terminals -- --save`: the one BC Ports and Terminals WFS feature SOURCE_DATA_ID 272 (Vancouver Wharves) exactly as received, with the request URL. |

`aisBerths.test.js` marks what it builds SYNTHETIC in the test name (probe points, an empty footprint, a rival outline, a bad data-file entry).

## Terminal calls (lib/ships/terminalCalls.js)

| File | What it is |
|---|---|
| `mc-ais-terminal-calls-alliance-grain-2025-07-15.json` | **Real** MarineCadastre AIS rows (CC0), copied 2026-09-28 from the bake-ais points cache (`salish-v6/2025-07-15.parquet`, `2025-07-16.parquet`): every row of MMSI 316040971 (MERCURY XVIII) within 170 m of the Alliance Grain berth, 77 rows, nothing edited (float32 values rounded to 4 decimals), MarineCadastre's own duplicate rows kept. Plus the two berth points + radii (bcpt-251, bcpt-252) as the dev DB export wrote them. |
| `mc-ais-terminal-calls-shellburn-2026-01-07.json` | **Real** MarineCadastre AIS rows (CC0), copied 2026-09-28 from `salish-v6/2026-01-07.parquet`, `2026-01-08.parquet`: every row of MMSIs 316046128 (SEASPAN HARRIER) and 316052572 (TWC ENDURANCE) within 160 m of the Shellburn berth bcpt-258, 107 rows, nothing edited. Plus that berth point + radius. |

`terminalCalls.test.js` / `terminalCard-db.test.js` mark what they build SYNTHETIC in the test name or comment (hand-made points for the 6 h / 15 min edges; a bake record declaring January 2026 fully read and Westshore outside the box).

## Climate TRACE voyages and port stays (ctVoyages.test.js, ctStays-db.test.js)

| File | What it is |
|---|---|
| `ct-voyages-salish-v5_11_0.json` | **Real.** `voyage_rows`: 4 rows exactly as in the 2026-09-29 Salish Sea pull of Climate TRACE's BigQuery `shipping_voyages` (table label release v5_11_0; columns trimmed, values untouched): COASTAL RENAISSANCE (om-imo-9332755) ×2, a VLCC (om-imo-9789283), a GFW-tracked boat (gfw-mmsi-316038244). `stays`: 8 port-stay lines from the voyage bake's `ct-stays-v2.ndjson` (Cherry Point tankers, a Roberts Bank container ship, an ambiguous Tacoma stop, a two-terminal Anacortes stay, an Olympia small craft, and WEST VIRGINIA's overlapping pair). `berths`: the 81 active berths of the dev database's listed terminals on 2026-09-29. |

## EU MRV (lib/ships/euMrv.js; docs/SHIP_POLLUTION_SOURCES.md §1)

| File | What it is |
|---|---|
| `eu-mrv-live-2026-09-29.json` | **Real** rows copied verbatim from two EMSA THETIS-MRV "EU MRV Publication of information" files downloaded 2026-09-29 (UTC 2026-09-30 01:29–01:31): 2021 v219 (62-column layout; EURODAM 9378448) and 2024 v245 (113-column layout; both sheets: EURODAM, AEGEAN DREAM 9645425, MORNING CALM 9285615 with its Full and Partial rows). Each sheet's three header rows are kept whole; cells are exactly as `lib/ships/xlsx.js` `sheetRows` reads them; file names, generation dates and sha256 are recorded. Plus the portal's own `details/267085` response (EURODAM 2024), verbatim, used to cross-check the file's numbers. Nothing edited. The full files stay in the gitignored `scripts/ships/mrv/raw/`. |

`euMrv.test.js` / `euMrv-db.test.js` mark what they build SYNTHETIC in the test name (a renamed header, holder lists for the resolver, a revised file version, a file without one ship).

## Anchorage aliases and stays (lib/ships/anchorageAliases.js, lib/ships/anchorageStays.js)

| File | What it is |
|---|---|
| `anchorage-aliases-dev-2026-09-30.json` | **Real** rows read 2026-09-30 from the dev ships DB: nine Salish anchorages (Vendovi South / East, Cap Sante, Jack Island South, Vancouver Harbour A / B, Trincomali 2, Commencement Bay, Ruston) as `lib/ships/anchorages.js` imported them, and the 132 Global Fishing Watch named points near them (`gfwAnchoragePoints`: pipe-anchorages overrides rows + port-visit anchorage cells with our port for each label). Nothing edited. |
| `mc-ais-anchorage-vendovi-south.json` | **Real** MarineCadastre AIS rows (CC0), copied 2026-09-30 from the bake-ais points cache (`salish-v6/2026-04-26..28.parquet`): every row of MMSIs 366341000 (PRIDE) and 366973730 (SIOUX ARROW) within 0.002° of Vendovi South's bounding box, 686 rows, nothing edited (lat/lon rounded to 6 decimals, SOG to 2). `expected` = the four stays the as1 bake stored for them in the dev DB. |

`anchorageStays.test.js` / `anchorageCard-db.test.js` mark what they build SYNTHETIC in the test name or comment (hand-made points for the 6 h / 60 min edges; a bake record declaring only April 2026 read).

## MEP Alliance scrubber lists (lib/ships/mepAlliance.js)

| File | What it is |
|---|---|
| `mep-live-2026-09-30.json` | **Real**, copied verbatim from www.mepalliance.org pages retrieved 2026-09-30 (the full pages stay in the gitignored `scripts/ships/mep/raw/`): the "Polluting Scrubber Voyages" table header, five of its rows (GOLDEN FELLOW, OCEANA, SHANDONG XIN DE, KONKAR ASTERI, UM JIANGSU (66K/2025)) and five "Polluters" dropdown options; the Cruise Ships list header and three rows (Adventure of the Seas, AIDAbella, Eurodam). Rows were chosen whose contact cells hold only company addresses (no person's email). Nothing is edited; the tests join the fragments in order. |

`mepAlliance-db.test.js` renames the real GOLDEN FELLOW row to EURODAM to exercise name matching; that case is **SYNTHETIC** and marked in the test names.

## Facilities, permits, SEPA (2026-10-06)

| File | What it is |
|---|---|
| `facilities-live-2026-10-06.json` | **Real, recorded live** 2026-10-06 by `scripts/ships/import-facilities.mjs`: EPA ECHO `dfr_rest_services.get_dfr` JSON for BP Cherry Point (FRS 110070752633) and its AMP5 project record (110071668371); the WA Ecology SEPA Register search page "Applicant: bp Cherry Point" (page 1) and record pages 202303911 (bp Advance Mitigation Project 5), 201801445 (BP West Coast Products fill at a Jackson Road church site: a candidate) and 201204345 (Tesoro Station 68404, Skagit: a candidate). DFR demographic sections and MapOutput removed for size; all else verbatim. |
| `permit-documents-live-2026-10-06.json` | **Real, recorded live** 2026-10-06, trimmed to verbatim slices: PARIS document list for WA0000761 (page 1 of 2, from the results grid on), WA Ecology Industrial Section `tesoro-refinery` page (from `<main>`), and the two NWCAA Air Operating Permits rows (BP Cherry Point, Tesoro (Marathon) Anacortes). |

## BC permits pilot (docs/PERMITS_SOURCES_BC.md, lib/ships/bcPermits.js)

| File | What it is |
|---|---|
| `bc-permits-live-2026-10-07.json` | **Real, recorded live** 2026-10-07 (cached by `scripts/ships/import-bc-permits.mjs`): `ema` = the header and 11 of the 9,083 rows of the BC Data Catalogue register `all_ams_authorizations.xlsx` as `lib/ships/xlsx.js` reads them (authorizations 3678, 14058, 109085, 6945, 6833 near / of Westridge; 6819, 16534, 14865, 106986 near / named like Westshore; the two rows of Chemtrade's authorization 18, Air and Effluent, added 2026-10-07 for the one-authorization-several-rows case); `nrced` = the NRPTI public search responses for `Westridge` and `"Westshore Terminals"` (populate=true; each record's populated `flavours` copies removed for size); `eao` = the EPIC Project searches `Trans Mountain`, `Westridge`, `Westshore`, `Roberts Bank` (EAO staff contact fields replaced by `[withheld]`). Request URLs and retrieval times kept; nothing else edited. |

`bcPermits.test.js` builds two **SYNTHETIC** variants (an entry without its why; a Westridge record moved to another site and authorization) and one made-up object for the contact-dropping test, each marked in the test.
| `mv-permits-live-2026-10-07.json` | **Real, recorded live** 2026-10-07 by `scripts/ships/mv-fetch.mjs` (Metro Vancouver), trimmed to verbatim slices: Neptune permit GVA0081 OCR text (pdftotext -layout) through emission source 14; Fraser Grain permit GVA1167 page 1; the GVA1284 application page HTML (its own block, from the no-JavaScript notice to "Public Notification"); the GVA1284 Environmental Protection Notice text, first 1,500 characters. `bytes` / `sha256` describe the whole files. |

`metroVancouver.test.js` / `metroVancouver-db.test.js` also use a few **SYNTHETIC** variants (a wrong permit number, a wrong quote, an empty application template, entries missing fields), each marked in the test.


## WA DNR aquatic leases + Whatcom shoreline pilot (docs/DNR_LEASES.md)

| File | What it is |
|---|---|
| `wa-leases-live-2026-10-07.json` | **Real, recorded live** 2026-10-07 by `scripts/ships/import-wa-leases.mjs`: 26 DNR AQ_ENC_Public_Prod features (layers 1, 2, 3, 25) for the leases the tests name, verbatim except the staff-name fields EDIT_NM / PERSON_RESPONSIBLE (dropped, as the importer drops them); the Whatcom County notice of application for SHR2020-00002 (pdftotext text, bytes, sha256) and the two SEPA Register record pages that name it. |

`waLeases.test.js` / `waLeases-db.test.js` add a few **SYNTHETIC** cases (wrong lessee words, a lease on the wrong terminal, stand-in terminal rows), each marked.

## WA local clean air agencies (docs/PERMITS_SOURCES.md "WA local clean air agencies", lib/ships/waAirAgencies.js)

| File | What it is |
|---|---|
| `wa-air-live-2026-10-07.json` | **Real, recorded live** 2026-10-07 by `scripts/ships/air-fetch.mjs`, trimmed to verbatim slices: ORCAA's BWC Terminals notice page (24NOC1693) HTML from its intro section to the comments section; SWCAA's Air Discharge Permit search result for EGT LLC (posted form `SelType=PLT&PlantID=2672~EGT LLC`) from the printable block through its first two permits; PSCAA Order of Approval 11386A text (first 1,500 characters), draft Order 12449 (first 2,500) and the 11386 worksheet (first 600 characters + the passage on LNG bunkering at the TOTE terminal, joined by a form feed). `bytes` / `sha256` describe the whole files. |

`waAirAgencies.test.js` / `waAirAgencies-db.test.js` also use **SYNTHETIC** variants (broken data entries, a wrong quote, a wrong holder, an entry cut to one order without its listing page, a bare facility row), each marked in the test.
