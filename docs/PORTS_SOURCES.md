# Ports: source catalogue (reference for /ships Phase 3)

Studied 2026-09-25. This covers four ways to name and place ports, and how each
relates to GFW port-visit events (see `docs/GFW_ACTIVITY_API.md`). Facts only.
**UNVERIFIED** marks anything not confirmed from a primary page or a live response.

| Source | What it is | Count | Access | License |
|---|---|---|---|---|
| NGA World Port Index (Pub 150) | Curated port reference with 112 attributes | 2,951 ports | Public JSON / CSV / XML, no auth | US Government work: "NO COPYRIGHT CLAIMED UNDER TITLE 17 U.S.C." |
| UN/LOCODE (UNECE) | Trade and transport location codes (ports, rail, airports, …) | 116,213 rows in the mirror's 2025-1 code list | Official download page; GitHub mirror | Official site footer: "free to use under CC By 4.0". The mirror claims ODC-PDDL. See below. |
| IMF PortWatch | AIS-derived daily port calls and trade estimates for large commercial ports | 2,065 ports; 5,819,170 daily rows (2019-01-01 → 2026-09-18) | Public ArcGIS FeatureServer, no auth | IMF terms (https://www.imf.org/external/terms.htm). Could not be fetched (403). |
| GFW anchorages | ~160,000 anchorage points grouped into ~32,000 ports, used by GFW port-visit events | see left | Only inside GFW events. Full download via the GFW Data Download Portal (login; UNVERIFIED). Name overrides on GitHub. | Events: CC BY-NC 4.0. pipe-anchorages code: Apache-2.0. |

---

## 1. NGA World Port Index (Pub 150)

**Access (verified 2026-09-25, no auth, no key):**
- `GET https://msi.nga.mil/api/publications/world-port-index?output=json`
  - 200, `application/json`, 6.3 MB
  - `{"ports":[…]}` with **2,951** ports in **170** country codes. Every port has coordinates.
- `?output=csv`: 200, `application/octet-stream`, 1.3 MB, same columns (UTF-8 with BOM).
- `?output=xml`: 200, `text/xml`, 10.5 MB (`<ports><wpiEntity>…`).
- `?output=kml`: returned the **same XML**, not KML.
- The archived 2019 (27th) edition is also available as MS Access (`PUB150.ZIP`) and a shapefile (`WPI_Shapefile.zip`), via `https://msi.nga.mil/api/publications/stored-pubs?includeFiles=true`.
- Field guide: "World Port Index – Explanation of Data Fields" PDF, `https://msi.nga.mil/api/publications/download?key=16920959%2FSFH00000%2FWPI_Explanation_of_Data_Fields.pdf&type=view`.

**License (primary):**
- The Pub 150 27th edition (2019) title page reads "© COPYRIGHT 2019 BY THE UNITED STATES GOVERNMENT / NO COPYRIGHT CLAIMED UNDER TITLE 17 U.S.C."
- The WPI is a US Government work (17 U.S.C. §105). It can be redistributed and no attribution is legally required.
- Crediting "NGA World Port Index (Pub 150)" is still our inline-provenance rule.
- No separate terms-of-use statement was found for the JSON API itself (UNVERIFIED that none exists).

**Update cadence:**
- The field guide says "The online web app version of the World Port Index, Pub 150, cancels the previous edition".
- The printed 2019 edition was current to Notice to Mariners No. 35 of 2019.
- The online database has no edition or date field. How often it is refreshed is **UNVERIFIED**.
- WPI numbers "remain consistent between updates", so they are a stable key.

**All 112 JSON fields:**
- Identity: `portNumber, portName, alternateName, regionNumber, regionName, countryCode, countryName, globalId, unloCode`
- Position: `latitude, longitude` (DMS strings), `ycoord, xcoord` (decimal degrees)
- References: `publicationNumber, chartNumber, navArea, dnc, s121WaterBody, s57Enc, s101Enc, dodWaterBody`
- Harbour: `harborSize, harborType, harborUse, shelter, erTide, erSwell, erIce, erOther, overheadLimits, entranceWidth`
- Depths in metres: `chDepth, anDepth, cpDepth, otDepth, lngTerminalDepth`, plus `tide`
- Vessel limits: `maxVesselLength, maxVesselBeam, maxVesselDraft, offMaxVesselLength, offMaxVesselBeam, offMaxVesselDraft`
- Anchorage and entry: `goodHoldingGround, turningArea, firstPortOfEntry, usRep`
- Pilotage: `ptCompulsory, ptAvailable, ptLocalAssist, ptAdvisable`
- Tugs: `tugsSalvage, tugsAssist`
- Quarantine: `qtPratique, qtSanitation, qtOther`
- Communications: `cmTelephone, cmTelegraph, cmRadio, cmRadioTel, cmAir, cmRail`
- Load/offload: `loWharves, loAnchor, loMedMoor, loBeachMoor, loIceMoor, loRoro, loSolidBulk, loContainer, loBreakBulk, loOilTerm, loLongTerm, loOther, loDangCargo, loLiquidBulk`
- Facilities: `medFacilities, garbageDisposal, degauss, dirtyBallast`
- Cranes and lifts: `crFixed, crMobile, crFloating, cranesContainer, lifts100, lifts50, lifts25, lifts0`
- Services: `srLongshore, srElectrical, srSteam, srNavigEquip, srElectRepair, srIceBreaking, srDiving`
- Supplies: `suProvisions, suWater, suFuel, suDiesel, suDeck, suEngine, suAviationFuel`
- Repair: `repairCode, drydock, railway`
- Traffic and security: `ukcMgmtSystem, portSecurity, etaMessage, searchAndRescue, tss, vts, cht`

Codes:
- Yes/No/Unknown fields use `Y` / `N` / `U`.
- `harborSize`: `L`, `M`, `S`, `V` (large, medium, small, very small). The guide says this is based on area, facilities and wharf space, "not … on any other single factor".
- `harborType`: coastal (natural / breakwater / tide gates), river (natural / basin / tide gates), canal or lake, open roadstead. Seen as `CN`, `CB`, `RN`.
- `unloCode` holds a space, e.g. `"US FRD"`. 2,565 of 2,951 ports have one.

**Salish Sea entries (verified):**

| portNumber | portName | cc | lat | lon | unloCode | size | type |
|---|---|---|---|---|---|---|---|
| 17920 | Friday Harbor | US | 48.533333 | −123.016667 | US FRD | V | CN |
| 17940 | Roche  Harbor (sic, two spaces) | US | 48.616667 | −123.166667 | US RCE | V | CN |
| 17730 | Seattle | US | 47.600000 | −122.333333 | US SEA | L | CN |
| 17700 | Tacoma | US | 47.283333 | −122.416667 | US TIW | M | CN |
| 18040 | Anacortes | US | 48.516667 | −122.616667 | US OTS | S | CN |
| 18050 | Bellingham | US | 48.750000 | −122.500000 | US BLI | S | CN |
| 17790 | Everett | US | 48.000000 | −122.216667 | US PAE | S | CN |
| 17160 | Port Townsend | US | 48.116667 | −122.750000 | US TWD | S | CN |
| 17120 | Port Angeles | US | 48.116667 | −123.433333 | US CLM | S | CN |
| 17660 | Olympia | US | 47.050000 | −122.900000 | US OLM | S | CN |
| 17430 | Bremerton | US | 47.566667 | −122.650000 | US PWT | M | CN |
| 18670 | Victoria Harbor | CA | 48.433333 | −123.383333 | CA VIC | M | CB |
| 18660 | Sidney | CA | 48.650000 | −123.383333 | CA SDY | V | CN |
| 18520 | Nanaimo | CA | 49.166667 | −123.933333 | CA NNO | S | CN |
| 18150 | Vancouver | CA | 49.283333 | −123.116667 | CA VAN | L | CN |

Friday Harbor (trimmed):
`{"portNumber":17920,"portName":"Friday Harbor","regionName":"UNITED STATES W COAST","latitude":"48°32'00\"N","longitude":"123°01'00\"W","harborSize":"V","harborType":"CN","shelter":"E","anDepth":"11","cpDepth":"5","otDepth":"5","firstPortOfEntry":"Y","ptCompulsory":"Y","loWharves":"Y","loAnchor":"Y","suFuel":"Y","suDiesel":"Y","repairCode":"C","unloCode":"US FRD","publicationNumber":"U.S. Coast Pilot 10 - Oregon Washington Hawaii and Pacific Islands","chartNumber":"18434","globalId":"{6D69EBB5-EADE-4E18-8A78-6D0C7D64B7B3}","ycoord":48.533333,"xcoord":-123.016667}`

Seattle: `harborSize L, shelter E, chDepth 9, anDepth 23, cpDepth 23, otDepth 13, repairCode A, drydock S, chart 18450, US SEA`.
Tacoma: `harborSize M, chDepth 23, anDepth 23, cpDepth 14, otDepth 11, repairCode A, drydock M, chart 18453, US TIW`.

Coordinates are rounded to whole arc-minutes (about 1.8 km of latitude). They mark the port, not individual berths.

---

## 2. UN/LOCODE (UNECE)

**Primary site:** https://unlocode.unece.org (UNECE's dedicated UN/LOCODE site). `unece.org/trade/cefact/UNLOCODE-Download` and `service.unece.org/trade/locode/*.htm` returned **403** to scripted requests (bot protection), so they were not read.

- **Releases** (from `/publications`, read 2026-09-25):
  - "Latest Release: Production, January 2025, UNLOCODE Publication – 2025-1". The page describes it as "Official biannual UN/LOCODE publication".
  - A **Pre-Release** is "updated continuously — Last updated: September 23, 2026". It holds codes approved between releases.
  - There is also a SKOS/Turtle linked-data version (alpha, 2025-1).
- **Access:** browsing and downloads need no account ("Reading is always open"). An account (UNICC GitLab) is only needed to submit or vote on Data Maintenance Requests.
- **License:**
  - The footer of every page on unlocode.unece.org reads "All UN/CEFACT standards are free to use under CC By 4.0 license". So **attribution to UNECE is required**.
  - The site's Terms and Conditions are the standard UN "as is" disclaimer, with no additional data restriction.
  - The GitHub mirror `datasets/un-locode` (datahub.io) declares **ODC-PDDL-1.0** for its repackaging. The mirror has no repo license.
  - These two statements differ. **Attributing UNECE (CC BY 4.0) satisfies both.**
- **Mirror state (verified):**
  - `https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv`, 116,213 data rows.
  - Last data commit 2026-05-12: "regenerate 2025-1 data and replace broken automation with manual update process".
  - `datapackage.json` still says `"version": "2024.2.0"`. The mirror is updated by hand, so it can lag.
- **Fields (12 per row in files):**

  | Field | Meaning |
  |---|---|
  | `Change` | change indicator, blank if unchanged |
  | `Country` + `Location` | 2 + 3 characters; together they form the LOCODE |
  | `Name`, `NameWoDiacritics` | location name, with and without diacritics |
  | `Subdivision` | 1–3 characters |
  | `Status` | 2 letters, e.g. `AI` |
  | `Function` | 8-character positional string. **Position 1 = "1" means port**. The other positions cover rail, road, airport, postal and more (the full table is in Recommendation 16). |
  | `Date` | YYMM |
  | `IATA` | only filled when it differs from the location code |
  | `Coordinates` | `ddmmN dddmmE` |
  | `Remarks` | free text |

  Mirror side tables: country-codes, function-classifiers, status-indicators, subdivision-codes, alias.
- **Salish Sea rows (mirror, verified):**
  ```
  ,US,SEA,Seattle,Seattle,WA,AI,1--45---,9601,,,
  ,US,TIW,Tacoma,Tacoma,WA,AI,1--4----,9601,,,
  ,US,FRD,Friday Harbor,Friday Harbor,WA,AI,---4----,0001,,,
  ,US,RCE,Roche Harbor,Roche Harbor,WA,AI,---4----,0001,,,
  ,US,OTS,Anacortes,Anacortes,WA,AI,--34----,9601,,,
  ,US,BLI,Bellingham,Bellingham,WA,AI,1-34----,1701,,,
  ```
  - **None of these have coordinates**, so UN/LOCODE cannot place them on a map by itself.
  - Friday Harbor and Roche Harbor have function `---4----` (airport only). They are **not flagged as ports** in UN/LOCODE, although WPI lists both.
  - Treat UN/LOCODE as a join key (WPI `unloCode` and PortWatch `LOCODE` both carry it), not as a port geometry source.

---

## 3. IMF PortWatch

**Use terms, read 2026-09-26 from https://portwatch.imf.org/pages/faqs (the FAQ page; the general IMF terms page still returned 403):**
- "DATA USAGE: For questions about commercial redistribution of the datasets, please contact copyright@imf.org for guidance." No other restriction is stated. EarthAtlas is non-commercial conservation use (see memory / Josh 2026-09-25), so non-commercial display with the citation below is treated as allowed.
- Required citation (port/chokepoint activity and trade estimates): **"Sources: Kpler; UN Global Platform; IMF PortWatch (portwatch.imf.org)."** Disruptions: "Sources: Global Disaster Alert and Coordination System (GDACS); IMF PortWatch (portwatch.imf.org)."
- A **port call = "the arrival of a vessel at berth"**, excluding (as far as possible) bunkering-only stops. Dates in **UTC**. Updated **weekly, Tuesdays 9 AM ET**; series can be revised.
- AIS source: Kpler satellite AIS via the UN Global Platform, plus Spire/FleetMon terrestrial. Known anomalies: blackout days 2022-05-12, 2023-02-14, 2024-01-09; Hormuz spoofing (e.g. 2026-04-27/28); Mumbai May 2025 – Apr 2026.
- API (FAQ): ArcGIS REST, `.../Daily_Trade_Data/FeatureServer/0/query?where=portid='PORT0'&outFields=*&maxRecordCountFactor=5&outSR=4326&f=json` (≤5,000 rows per call); chokepoints in `Daily_Chokepoints_Data`.
- Aggregates only (per port per day, by vessel type): no per-vessel calls, so it feeds port cards, not a ship's ports of call.

- **What it is:** IMF Research Department + Oxford (OxMarTrans), using AIS from the UN Global Platform.
  - Daily port calls and estimated import/export tonnage for **2,065 ports** (large commercial ports only).
  - The hub page says it is updated weekly (Tuesdays, 9 AM ET per search-result text; **UNVERIFIED** on a primary page).
  - Observed: `Daily_Ports_Data` last edit 2026-09-22T11:36Z, max `date` 2026-09-18. Ports layer last edit 2026-09-18.
- **Access (public ArcGIS REST, no auth):**
  - Ports: `https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/PortWatch_ports_database/FeatureServer/0`. Point layer, `maxRecordCount` 1000, count 2,065.
  - Daily: `https://services9.arcgis.com/weJ1QsnbMYJlCHdG/arcgis/rest/services/Daily_Ports_Data/FeatureServer/0`. Table, 5,819,170 rows, dates 2019-01-01 → 2026-09-18, `maxRecordCount` 1000 (page with `resultOffset`).
  - Also on the hub: `Daily_Chokepoints_Data`, `PortWatch_chokepoints_database`, `portwatch_disruptions_database`, spillover and climate layers.
  - The hub search API is `https://portwatch.imf.org/api/search/v1/collections/dataset/items`.
- **Ports fields:** `portid` (e.g. `port1175`), `portname, country, ISO3, continent, fullname, lat, lon, vessel_count_total, vessel_count_{container,dry_bulk,general_cargo,RoRo,tanker}` (yearly average ships, 2019–2025), `industry_top1..3`, `share_country_maritime_import/export` (%), `LOCODE`, `pageid, countrynoaccents, ObjectId`.
- **Daily fields:** `date` (UTC), `year, month, day, portid, portname, country, ISO3`, `portcalls_{container,dry_bulk,general_cargo,roro,tanker,cargo}`, `portcalls`, `import_*` / `export_*` (the same six categories plus total, in metric tons).
  - Item description: "a port call is defined when a ship enters the port boundary. Port calls with a turnaround time of less than 5 hours and no draft change … are excluded".
  - Trade is estimated from the change in draft × deadweight. Method: Arslanalp, Koepke & Verschuur, IMF WP/21/225.
- **License:**
  - Every item's `licenseInfo` points to `https://www.imf.org/external/terms.htm`. The hub states "All data and content in the IMF PortWatch are provided by the IMF unless mentioned otherwise."
  - The IMF terms page returned **403** to both our fetch tools, so its wording was not read.
  - Search-result summaries of IMF's Copyright and Usage page (UNVERIFIED, secondary) say:
    - IMF content is "All Rights Reserved".
    - Personal non-commercial downloading is allowed "without any right to resell, redistribute, compile, or create derivative works".
    - "special terms apply to published statistical data".
    - Commercial reuse needs permission from copyright@imf.org.
  - **Redistributing PortWatch data (e.g. baking it into our tiles) is therefore UNVERIFIED and may need IMF permission.** Linking to and citing PortWatch is safe.
- **Salish Sea ports (verified, query `lat 47–49.3, lon −124.9 to −122`):**

  | portid | portname | LOCODE | lat | lon | vessels/yr total | largest class |
  |---|---|---|---|---|---|---|
  | port1175 | Seattle | US SEA | 47.5719 | −122.3458 | 574 | container 428 |
  | port1248 | Tacoma | US TIW | 47.2536 | −122.3912 | 868 | container 468, RoRo 272 |
  | port47 | Anacortes | US OTS | 48.4868 | −122.5688 | 200 | tanker 200 |
  | port236 | Cherry Point | US CP4 | 48.8525 | −122.7139 | 243 | tanker 241 |
  | port143 | Bellingham | US BLI | 48.7564 | −122.5003 | 4 | general cargo 3 |
  | port333 | Everett (US-WA) | US PAE | 47.9771 | −122.2237 | 97 | container 41 |
  | port931 | Port Angeles | null | 48.1288 | −123.4543 | 223 | tanker 151 |
  | port2255 | Manchester | null | 47.5623 | −122.5431 | 3 | tanker 3 |
  | port1350 | Vancouver (CA) | CA VAN | 49.2900 | −123.0289 | 2,054 | dry bulk 1,369 |
  | port814 | New Westminster | CA NWE | 49.1751 | −122.9776 | 493 | RoRo 204 |
  | port455 | Harmac | CA HMC | 49.1410 | −123.8657 | 225 | RoRo 104 |
  | port2062 | Nanaimo | CA NNO | 49.1617 | −123.9262 | 32 | dry bulk 15 |
  | port2438 | Crofton | CA CRO | 48.8746 | −123.6357 | 50 | dry bulk 26 |
  | port2436 | Chemainus | CA CHM | 48.9183 | −123.6976 | 0 | — |

  - **Data error seen:** Port Angeles (port931) has `country: "Canada", ISO3: "CAN"`. It is in Washington, USA.
  - **No Friday Harbor, Roche Harbor or Victoria**: PortWatch covers commercial cargo and tanker ports only.
  - Seattle's latest daily rows: `{"date":"2026-09-18","portcalls":1,"portcalls_container":1,"import":4892,"export":0}`, `2026-09-17 portcalls 2 import 7959`, `2026-09-16 portcalls 1 import 42160`.

---

## 4. GFW anchorages (what port visits resolve to)

Source page: https://globalfishingwatch.org/datasets-and-code-anchorages/ (read 2026-09-25).
- **Method:**
  - The globe is divided into **S2 cells at level 14 (~0.5 km)**.
  - A cell becomes an anchorage point if **at least 20 unique vessels** have been stationary in it since 2012. Stationary means moving less than 0.5 km over at least 12 h.
  - User-contributed and regional anchorages take precedence.
  - Anchorages within **4 km** of each other are grouped into ports.
  - Totals: "more than 160,000 anchorage locations associated with nearly 32,000 ports", from tracking over 400,000 vessels.
- **Naming order:**
  1. Manually reviewed and user-contributed override list
  2. Nearest **World Port Index** port within 4 km
  3. Curated regional lists
  4. **GeoNames 1000** city within 4 km
  5. Top AIS-reported destination

  That explains event labels like `CAN-382`, `USA-626` and `usa-usa-397` with `name: null`.
- **In GFW events:**
  - `anchorageId` = the S2 cell token. For example, Friday Harbor `548f7e39` and Tacoma `5490560f` match rows in the override list, such as `5490542f,47.2888,-122.4224,TACOMA,,USA`.
  - `id` = the port label (`usa-fridayharbor`, `usa-rocheharbor`, `can-cowichanbay`).
  - Also: `name`, `flag` (ISO3 of the port country), `lat`/`lon` of the anchorage point, `atDock`, `distanceFromShoreKm`, `topDestination` (the most common AIS destination string, often noisy: "BK", "NING BO", "LOCAL SHIFTING").
  - GFW caveat: a port visit is "within 3 km of an anchorage (entry) … transits more than 4 km outside (exit)".
- **Access:**
  - The page states: "Anchorages and Voyages are not yet available in the APIs & packages". You only see anchorages through event payloads.
  - "Download complete anchorage and port visit datasets, voyage-level data" is offered via the GFW Data Download Portal (https://globalfishingwatch.org/data-download/). "This data differs from the data available in the Map and APIs."
  - The portal is a JS app. Its dataset ids, file format, login requirement and license for the anchorages download are **UNVERIFIED**; it presumably falls under the same GFW non-commercial terms.
- **Open inputs (GitHub `GlobalFishingWatch/pipe-anchorages`, Apache-2.0, last push 2026-08-11):**
  - `src/pipe_anchorages/assets/data/port_lists/anchorage_overrides.csv` (60,410 rows; `s2id,latitude,longitude,label,sublabel,iso3`)
  - `WPI_ports.csv`, `geonames_1000.csv`, `indonesia.csv`, `peru.csv`

  The links on GFW's page point to the old `anchorages_pipeline/.../pipe_anchorages/data/port_lists/` path, which now returns 404.
  - Salish override rows seen: 5 × TACOMA (s2ids `5490542f`, `54905677`, …), and `548580c7,48.5615,-122.9318,SHAW ISLAND,FRIDAY HARBOR WA,USA`.
  - The Apache-2.0 license covers the code repository. Whether it also covers the CSV port lists is **UNVERIFIED** (no separate data license was found in the listing).

## Cross-walk observations (Salish)
- The same place has different coordinates in each source. For Seattle:

  | Source | lat | lon | Notes |
  |---|---|---|---|
  | WPI | 47.6000 | −122.3333 | rounded to whole minutes |
  | PortWatch | 47.5719 | −122.3458 | |
  | GFW anchorages | per S2 cell | | many cells per port |
  | UN/LOCODE | — | — | no coordinates |

- `unloCode` (WPI, with a space) = `LOCODE` (PortWatch, with a space) = Country + Location (UN/LOCODE mirror, separate columns). This is the only shared key. GFW anchorages carry no LOCODE.
- Small recreational harbours (Friday Harbor, Roche Harbor) exist in WPI (size `V`) and in GFW anchorages, but not in PortWatch, and UN/LOCODE does not flag them as ports.

---

## Step 2 (ports reference): re-verified live 2026-09-26 (local; 2026-09-27 UTC)

Downloads by `scripts/ships/import-ports.mjs --fetch` (one request per file, UA `EarthAtlas-ships/0.1`), saved to
`scripts/ships/bake-ais/build/ports/` (gitignored) with a `.meta.json`. Code: `lib/ships/ports.js`, migration
`lib/ships/migrations/008_ports.sql`.

### NGA World Port Index
- `GET https://msi.nga.mil/api/publications/world-port-index?output=json`: 200, `application/json;charset=UTF-8`, 6,316,131 bytes,
  **no Last-Modified header**. `{"ports":[…]}`, **2,951 ports**, 170 country codes, all with `ycoord`/`xcoord`.
- Fields used: `portNumber` (key), `portName`, `alternateName`, `countryCode` (ISO alpha-2), `countryName`, `regionName`,
  `ycoord`/`xcoord` (decimal degrees; floats like `47.60000000000008`), `unloCode`, `harborSize`, `harborType`, `globalId`.
  The whole object is stored as the source record.
- `unloCode`: 2,564 non-empty (the study said 2,565). Two are malformed and are not used as keys:
  35600 Portsmouth Harbour `"GB ME\""`, 42070 Spetses `" "`. 13 codes appear on two WPI ports (e.g. `US VDZ`, `US GLC`).
- Country codes not in ISO 3166 (so no ISO3/name): `XU` Johnston Atoll, `QM` Midway Island, `QW` Wake Island.
- Licence: unchanged (US Government work, "NO COPYRIGHT CLAIMED UNDER TITLE 17 U.S.C.").
- Names: `portName` is kept raw in the record; the port's name only collapses repeated spaces ("Roche  Harbor" → "Roche Harbor").

### UN/LOCODE (official UNECE download)
- `https://unlocode.unece.org/publications` (read 2026-09-26) links two zips:
  - **Production 2025-1** ("Latest Release"): `https://opensource.unicc.org/un/unece/uncefact/vocab-locode/-/jobs/artifacts/2025-1/download?job=package-release`
    → 302 to `…/-/jobs/12335/artifacts/download`, 200, 13,507,338 bytes, Last-Modified 2026-05-08. **This is what we import.**
  - Pre-Release: `https://unlocode.unece.org/downloads/unlocode-latest.zip`, 13,185,797 bytes, Last-Modified 2026-09-23 (`--pre-release`).
- Zip contents (both): `release/csv/UNLOCODE CodeListPart1..3.csv`, `SubdivisionCodes.csv`, `.txt`, `.xml`, `.mdb`, `UNLOCODE.ttl`.
  The CSVs are **UTF-8, no header**, 12 columns: Change, Country, Location, Name, NameWoDiacritics, Subdivision, Function, Status,
  Date, IATA, Coordinates, Remarks. 116,533 rows in 2025-1, incl. 301 country header rows (`,AD,,.ANDORRA,…`). Quoted fields occur.
- Import scope (default): rows whose Function starts with `1` (port) **plus** every code WPI references: 18,017 rows
  (76 codes appear twice with different content; both rows are kept). `--all` imports every row.
- WPI `unloCode` checked against 2025-1: 2,557 of 2,563 found, 2,139 of them port-flagged. Not in UN/LOCODE: `NC BUG`, `GC COG`,
  `AO KOT`, `JB HBI`, `ES ALD`, `PF UTU` (`GC`, `JB` are not ISO country codes).
- `US CP4` (Cherry Point, a PortWatch port) is function `--3-----`: **not** port-flagged, but it has coordinates (`4852N 12230W`).
- **Licence: the two primary statements conflict** (read 2026-09-26):
  - Footer of every unlocode.unece.org page: "All UN/CEFACT standards are free to use under CC By 4.0 license".
  - `https://unlocode.unece.org/terms` is the general UN text: "The United Nations grants permission to Users to visit the Site
    and to download and copy the information, documents and materials … for the User's personal, non-commercial use, without
    any right to resell or redistribute them or to compile or create derivative works therefrom, subject to the terms and
    conditions outlined below, and also subject to more specific restrictions that may apply to specific Material within this Site."
    (The study above said the terms add no data restriction; that was wrong.)
  - The GitLab repository `un/unece/uncefact/vocab-locode` carries a GPL-3.0 `LICENSE` (its code).
  - What we do: UN/LOCODE rows are stored as evidence and used only to **check** WPI's `unloCode` (the crosswalk key itself
    comes from WPI, public domain). Nothing from UN/LOCODE is shown on the card. Recorded in `ships.sources` with attribution
    "UN/LOCODE, United Nations Economic Commission for Europe (UNECE), CC BY 4.0." **Open question for Josh.**
- Crosswalk for IMF PortWatch (step 3): `ships.port_aliases` rows `key_kind='unlocode'` (key as `US SEA`, source `nga-wpi`,
  `detail.locode` = the UN/LOCODE check). PortWatch `LOCODE` joins on it. No PortWatch data is imported.
- No "Swartz Bay" row exists in UN/LOCODE 2025-1.

### GFW pipe-anchorages overrides
- `https://raw.githubusercontent.com/GlobalFishingWatch/pipe-anchorages/main/src/pipe_anchorages/assets/data/port_lists/anchorage_overrides.csv`
  (the default branch is `main`; `master` served the same bytes). Header `s2id,latitude,longitude,label,sublabel,iso3`,
  **60,410 data rows**. Last commit touching the file: `b5f367a`, 2025-12-03. Repo licence (GitHub API): Apache-2.0; pushed 2026-08-11.
- 431 rows have a spreadsheet-mangled `s2id` (e.g. `1.46E+83`); they are stored under `unkeyed:<hash>` and never matched.
- 4,394 rows repeat an `s2id` with different content, e.g. `12994ef7` = `IBIZA` and `ESP-113 / sublabel IBIZA`;
  `8fab0e03` = `COLON` and `MANZANILLO`. All rows are kept; a cell with two different real labels is not used for naming.
- How GFW uses the list (code read 2026-09-26, `src/pipe_anchorages/port_info_finder.py` + `assets/config/name_anchorages_cfg.yaml`):
  by **nearest point**, not by s2id: override list first, then `peru.csv`, `indonesia.csv`, `WPI_ports.csv`, `geonames_1000.csv`;
  `label_distance_km: 4.0`, `sublabel_distance_km: 1.0`. We match overrides by exact S2 cell only (more conservative).

### Country names: GeoNames countryInfo.txt
- `https://download.geonames.org/export/dump/countryInfo.txt`: 200, Last-Modified 2026-09-27 02:53 GMT (regenerated daily),
  252 countries; columns `ISO, ISO3, ISO-Numeric, fips, Country, …`.
- Licence (`https://download.geonames.org/export/dump/readme.txt`): "This work is licensed under a Creative Commons Attribution 4.0 License".
- Names are short English names ("United States", "South Korea", "Ivory Coast"). `XK/XKX` Kosovo is a user-assigned code.
- Not used: UN M49 (`unstats.un.org/unsd/methodology/m49/overview/`, HTML table only) falls under the general UN terms quoted above;
  the ISO list in the UN/LOCODE repo (`iso-3166/CountryCodes.csv`) has alpha-2 only.

### Matching rule as built (Josh 2026-09-26: WPI name first, then GFW)
Per GFW port label, over every anchorage point our stored visits carry for it (start, intermediate and end slots):
1. a WPI port within **4 km** of any point, **same country** (WPI alpha-2 → ISO3 via GeoNames vs GFW `flag`): one → it
   (`wpi_within_4km`); several → the nearest only if < 0.5 × the next (`wpi_nearest_clear`), else candidates recorded, no WPI name;
2. the overrides label for the label's exact S2 cells (codes like `ESP-113` are not names);
3. GFW's own anchorage `name` (codes like `USA-1843` are not names);
4. otherwise unnamed: the raw label is shown.
Result on the dev DB 2026-09-26 (81 labels from EURODAM + AMERICAN ENDURANCE): WPI 24 (22 within 4 km, 2 clearly nearest),
overrides 14, GFW name 21, unnamed 22. The decision for a label depends on which anchorages our stored visits contain, so a
label can change name when more ships' visits arrive (the old decision is kept as `superseded`).

---

## Step 3 (ports on the map + port card): verified live 2026-09-27

Code: `lib/ships/portCard.js`, `scripts/ships/import-portwatch.mjs`, migration `010_port_cards.sql`. GFW facts: docs/GFW_ACTIVITY_API.md "Port visits by port".

### IMF PortWatch API
- The FAQ's example service **`Daily_Trade_Data` does not exist**: `…/Daily_Trade_Data/FeatureServer/0?f=json` → 400 "Item does not exist or is inaccessible." The daily table is **`Daily_Ports_Data`** (§3 above).
- `Daily_Ports_Data` layer JSON: `maxRecordCount` 1000, `dataLastEditDate` 1790076979705 (2026-09-22). Fields: `date` (**esriFieldTypeDateOnly**, returned as `"2026-09-18"`), `year, month, day, portid, portname, country, ISO3`, `portcalls_{container,dry_bulk,general_cargo,roro,tanker,cargo}`, `portcalls`, `import_*`, `export_*` (same categories), `import`, `export`, `ObjectId`.
  In the rows seen, `portcalls_cargo` = all non-tanker calls and `portcalls` = cargo + tanker (UNVERIFIED as a definition); the card shows the five named types and the total.
- Query used: `where=portid='port47' AND date >= DATE '2026-06-01' AND date < DATE '2026-07-01'&outFields=<10 fields>&orderByFields=date&resultOffset=0&resultRecordCount=1000&f=json` → 200, ~1.7 s, one row per day (zeros included).
- Ports layer: 2,065 ports in 3 requests (1,000 / 1,000 / 65), each with `pageid` (e.g. Seattle `738a0d27532846da92aa3f03b1417ea1`). The card links `https://portwatch.imf.org/pages/<pageid>` (an SPA: the server answers 200 for any path, so the deep link is UNVERIFIED).

### WPI ↔ PortWatch join (the only shared key is UN/LOCODE; `import-portwatch.mjs --check`)
Rule (read time, never stored): WPI `unloCode` = exactly one PortWatch `LOCODE`, positions ≤ 25 km apart, and if other WPI ports carry the same code, this one must be the nearest to the PortWatch port.
- 2,563 WPI ports with a code: **868 joined**, 1,669 not in PortWatch, 14 too far (26–480 km: Abu Zaby 26.4, Ningbo 32.3, Wakkanai 222, North Pulau Laut 480 …), 6 ambiguous (two PortWatch ports share the LOCODE: TR BOT, MY PKG, CN ZOS, MX ESE, AE JED), 6 lost to a nearer WPI port with the same code.
- PortWatch: 1,478 of 2,065 ports carry a LOCODE; 868 of them join. Port Angeles (port931) has no LOCODE, so it doesn't join.
- Salish: Seattle → port1175 (3.3 km), Tacoma → port1248 (3.8), Anacortes → port47 (4.8), Vancouver → port1350 (6.4), Bellingham → port143 (0.7), Everett → port333 (2.6), Nanaimo → port2062 (0.8), New Westminster → port814 (5.2). Not covered: Port Angeles, Victoria, Friday Harbor.

### Storage and licence handling
- PortWatch ports and each daily-series response are stored as evidence (`ships.sources` id `imf-portwatch`, commercial_use false, attribution = the FAQ's required citation). The card shows only 7-day averages with the citation and "relative trends, not official statistics", and links to PortWatch rather than to our raw copy.
- **Open question**: the IMF terms page (imf.org/external/terms.htm) still returns 403 to scripted fetches; the FAQ is the only terms text read.
