# Official port lists: source catalogue (reference for /ships ports)

Studied 2026-09-27. Josh's question: do we use the **official** national port lists? The goal is authoritative names and status (for example "Vancouver Fraser Port Authority", Canada Port Authority, public port owned by Transport Canada, DFO small craft harbour, US port district with a USACE port code), and finding ports we are missing.

Today /ships gets its ports from NGA WPI, GFW labels and Climate TRACE (`lib/ships/ports.js`, `lib/ships/climateTrace.js`, `docs/PORTS_SOURCES.md`).

Rules for this document:
- Facts only. Every fact has its URL and the date it was read (2026-09-27 unless another date is given).
- **UNVERIFIED** marks anything not confirmed on a primary page or in a live response.
- Testing was small: one query or one small file per source. User-Agent `EarthAtlas-ports-research/0.1`.
- Nothing was imported and no database was touched.

"Salish box" below means lat 47.0–49.4, lon −124.9 to −122.0. That box also takes in Port Alberni and the lower Fraser River.

---

## Summary

- **Canada has official lists, and one of them is proper open data with coordinates.**
  - DFO Small Craft Harbours: 939 harbours, each with its official name, type and managing harbour authority, under OGL-Canada.
  - Transport Canada's lists (17 Canada Port Authorities; the ports it owns; the public ports) are **HTML only**, with no coordinates. Only 5 of them are in BC.
  - BC's "Ports and Terminals" layer (184 points) is the only official BC set that has terminals. Its authority names are stale ("Port Metro Vancouver").
- **The US has official port codes and names, but as polygons or code tables, not port points.**
  - The USACE / BTS "Port Areas" layer gives official names and USACE port codes for every Puget Sound port district, including Everett, Bellingham, Olympia and Port Angeles (Clallam County Port District).
  - "Principal Ports" is the top 150 by tonnage. Only Seattle, Tacoma and Anacortes are in the Salish box.
  - Census Schedule D (CBP port codes) and MARAD's lists are names and codes only, with no coordinates.
- **Nothing official replaces WPI as the point for a port.** The official lists add names, status and some small harbours WPI does not have (Sooke, Ladysmith, French Creek, Ladner, Whaler Bay …).
- **Two of the Canadian sources Josh sent are not port lists:**
  - NRCan GEOSCAN 294442 is a 1974 atlas map.
  - The CHS anchorages dataset is anchorages taken from nautical charts. It is useful for the anchorage and terminal work, not for naming ports.

---

## CANADA

### C1. Transport Canada: "Ports, harbours and anchorages" hub
- **Page:** https://tc.canada.ca/en/marine-transportation/ports-harbours-anchorages (page date 2026-09-23).
- **What it is:** a hub page. It links to the CPA list, the TC-owned ports list, Canada Marine Act enforcement, public-port charges, DFO Small Craft Harbours (external), anchorages, and the **Port of Victoria** page.
- **Data:** HTML pages only. No downloadable list was found on the hub. The open.canada.ca searches "port authorities", "public ports" and "ports transport canada" found **no TC port dataset** (2026-09-27; UNVERIFIED that none exists).

#### C1a. List of Canada Port Authorities
- **Page:** https://tc.canada.ca/en/marine-transportation/ports-harbours-anchorages/list-canada-port-authorities (page date 2020-09-04).
- **Content:** a table of province and port authority name, each linked to the authority's own website. **No coordinates, no codes.** There are 17 CPAs.
  - **BC:** Nanaimo Port Authority, Port Alberni Port Authority, Prince Rupert Port Authority (outside our area), Vancouver Fraser Port Authority.
  - **Elsewhere:** Hamilton-Oshawa, Toronto, Thunder Bay, Windsor, Montreal, Quebec, Saguenay, Sept-Îles, Trois-Rivières, Belledune, Saint John, Halifax, St. John's.
- **Legal source:** the **Canada Marine Act, Schedule**, at https://laws-lois.justice.gc.ca/eng/XML/C-6.7.xml (current to 2024-12-08, last amended 2024-11-27).
  - Part 1, "Initial Port Authorities": 14 active entries, including Nanaimo and Port Alberni.
  - Part 2: Belledune, Hamilton-Oshawa and **Vancouver Fraser Port Authority**.
  - The total, 17, matches TC's list.
- **The page says CPAs** "operate at arm's length from the federal government", set their own fees, and "act as landlords, leasing their port operations to private operators".

#### C1b. List of ports owned by Transport Canada
- **Page:** https://tc.canada.ca/en/marine-transportation/ports-harbours-anchorages/list-ports-owned-transport-canada (page date 2026-09-23).
- **Three types, by province, as names only (no coordinates, no codes):**
  - **Remote port facilities.** In BC: Bamfield West, Bella Bella, False Bay, Kingcome Inlet, Klemtu, Kyuquot, Quatsino, Rivers Inlet (Owikeno), Sandspit. False Bay (Lasqueti Island) is the only one inside the Salish Sea.
  - **Local/regional port facilities.** None in BC.
  - **Public ports.** In BC: **Victoria** only.
    - The page says TC "may or may not own or operate the port facilities within the port limits".
    - The legal basis it cites is Canada Marine Act s.65 and Schedule 1 of the Public Ports and Public Port Facilities Regulations.
- **Public Ports Regulations, Schedule 1** (SOR/2001-154, https://laws-lois.justice.gc.ca/eng/XML/SOR-2001-154.xml; XML current to 2021-10-20, last amended 2006-09-21):
  - Its BC part names **Bamfield, Campbell River and Victoria**, each with a text description of the port limits. Example: Victoria is "All the navigable waters … from a line running from the Ogden Point breakwater in a westerly direction to the southern end of Macauley Point northward to the Trestle Bridge."
  - The limits are words, not geometry.
  - Esquimalt and Nanoose Bay were **de-designated** (s.3.1, s.3.2).
  - TC's web page lists only Victoria for BC. Whether Bamfield and Campbell River are still public ports is **UNVERIFIED** (the XML may lag; the regulation text is the legal source).
- **Licence (TC pages and Justice Laws):** Canada.ca pages fall under the Government of Canada terms. The Justice Laws "reproduction of federal law" notice was not read (the fetch returned nothing), so reuse terms are **UNVERIFIED**. The facts involved are short: 17 authority names and a few public-port names.
- **Salish examples:**
  - Vancouver Fraser (CPA), Nanaimo (CPA), Port Alberni (CPA, on Vancouver Island's west-coast Alberni Inlet, just outside the Salish Sea proper), Victoria (TC public port).
  - Prince Rupert is a CPA but outside our area.
- **Update cadence:** the pages change when the law changes. There is no schedule.

### C2. DFO Small Craft Harbours (SCH)
DFO publishes this three ways:

**(a) Open data (the one to use).**
- **Record:** "Small Craft Harbours Locations and Information", https://open.canada.ca/data/en/dataset/262451e7-6416-47b5-8453-f31d212ea657
- **Metadata:** modified 2026-03-24, frequency `as_needed`, published 2017-08-21.
- **Resources:**
  - ESRI REST: https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/small_craft_harbours_en/MapServer (a French service also exists).
  - File geodatabase: `https://api-proxy.edh-cde.dfo-mpo.gc.ca/catalogue/records/262451e7-…/attachments/SmallCraftHarbours.gdb.zip`
  - Data dictionary CSV (English and French).
- **Layers (points, WGS84 lon/lat fields plus geometry, `maxRecordCount` 2000):**
  - 0 Core Fishing: **658**
  - 1 Non-Core Fishing: **185**
  - 2 Recreational: **96**
  - Total **939**
- **Fields:** `Harbour_number` (numeric id), `Harbour_Name`, `Province`, `Longitude`, `Latitude` (6–8 decimals), `Harbour_Type`, `Managed_by` (harbour authority name, or "No harbour authority"), `Managed_by_URL` (DFO page, `?filter=HA0540`).
- **Copyright text on the service:** "Government of Canada; Fisheries and Oceans Canada; Integrated Oceans Management".
- **Licence:** Open Government Licence – Canada (https://open.canada.ca/en/open-government-licence-canada). Quoted:
  - "You are free to: Copy, modify, publish, translate, adapt, distribute or otherwise use the Information in any medium, mode or format for any lawful purpose."
  - Attribution: "Acknowledge the source of the Information by including any attribution statement specified by the Information Provider(s) and, where possible, provide a link to this licence." If there are several providers: "Contains information licensed under the Open Government Licence – Canada."

**(b) Web lists** at https://www.dfo-mpo.gc.ca/sch-ppb/list-liste-eng.html. They are backed by two JSON files:
- `https://www.dfo-mpo.gc.ca/sch-ppb/list-liste/harb-json.json`: **933 harbours**.
  - Fields: `code` (`harb0636`), `name`/`province`/`region`/`type` in English and French, `isManagedByHA`, `HACode`.
  - **No coordinates.**
- `https://www.dfo-mpo.gc.ca/sch-ppb/list-liste/ha-json.json`: **559 harbour authorities**, 55 of them in BC.
  - Fields: `name` (official name), `code` (`HA0540`), `province`, `region`, `managedHarbours` (HTML links), `mailAddress`, `contact`.
- The `harbNNNN` codes differ from the open data's `Harbour_number` (Sooke = `harb0636` on the web, `6173` in the open data). The shared keys are the name and `HACode`/`Managed_by_URL`.
- The list page is dated 2021-11-26; the HA list page is dated 2026-07-30.

**(c) Interactive map:** https://www.dfo-mpo.gc.ca/sch-ppb/maps-cartes-eng.html (not read).

**Salish box (open data, 28 harbours):**
- **Core Fishing:**
  - Albion; Cowichan Bay ("Cowichan Bay Fisherman's Wharf Association")
  - Crofton ("The Corporation of the District of North Cowichan"); French Creek
  - Ganges (Inner Harbour) ("Harbour Authority of Salt Spring Island")
  - Kanaka (Haney) Landing; Ladner (Delta) ("City of Delta"); Ladysmith; McIvor's Landing; McMillan Island; Mission; Musgrave
  - Port Alberni-Fishing Harbour ("Port Alberni Port Authority"); **Sooke** ("Sooke Harbour Authority")
  - Steveston (Gulf of Georgia) and Steveston (Paramount) ("Steveston Harbour Authority")
  - Tsehum Harbour; Vancouver (False Creek) ("False Creek Harbour Authority"); Whaler Bay
- **Non-Core:** Burgoyne Bay, Degnen Bay, Fulford Harbour, Ganges (Outer Harbour), Schooner Cove, Vesuvius Bay, Whonnock.
- **Recreational:** Northwest Bay, Oak Bay (Turkey Head).
- **Not in SCH:** Nanaimo, Victoria, Vancouver's main harbour and Sidney town. These are CPA, TC or municipal harbours, not DFO harbours.
- **Data errors seen:**
  - "Musgrave " (trailing space) has `Province: "MB"`, but it is on Salt Spring Island, BC.
  - "Mcivor's Landing" has an empty `Managed_by`.

**Against WPI (nearest WPI port):**
- Within 1–3 km, so already on our map as a WPI port: Cowichan Bay, Crofton, Ganges, Port Alberni, Steveston, False Creek (→ Vancouver), Tsehum (→ Sidney), Schooner Cove (→ Nanoose Harbor).
- **More than 4 km from any WPI port, so missing from the map today:**
  - Sooke (22.7 km)
  - French Creek (17.5)
  - Ladysmith (10.2)
  - Degnen Bay (10.0)
  - Whaler Bay (9.8)
  - Fulford (9.3)
  - Ladner (8.1)
  - Burgoyne Bay (6.9)
  - Oak Bay (6.2)
  - Northwest Bay (5.5)
  - Musgrave (4.9)
  - Vesuvius (4.7)
  - The Fraser River harbours (Albion, Kanaka, McMillan, McIvor's, Whonnock, 14–19 km)

### C3. BC "Ports and Terminals" (Government of BC)
Josh's third link, https://osdp-psdo.canada.ca/dp/en/search/metadata/NRCAN-FGP-1-5f3c273a-7a0d-4b5f-8059-b34cc3f116c7, is this dataset. OSDP ids `NRCAN-FGP-1-<uuid>` carry the open.canada.ca UUID.
- **Records:**
  - https://catalogue.data.gov.bc.ca/dataset/bc-ports-and-terminals
  - Mirror: https://open.canada.ca/data/en/dataset/5f3c273a-7a0d-4b5f-8059-b34cc3f116c7
- **Publisher and dates:** custodian GeoBC (Ministry of Forests, Lands, Natural Resource Operations and Rural Development). Published 2016-05-12; record last modified 2025-03-07; status `onGoing`; resources update `asNeeded`.
- **What it is:** "the geographic locations of marine ports, terminals, shipyards, and harbours on the west coast of British Columbia … cross referenced with government and industry data sources".
- **Access (tested):**
  - WFS GeoJSON: `https://openmaps.gov.bc.ca/geo/pub/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=pub:WHSE_IMAGERY_AND_BASE_MAPS.GSR_PORTS_TERMINALS_SVW&outputFormat=application/json&srsName=EPSG:4326` → 200, **184 points**, 289 KB.
  - Also WMS, a KML loader, a BC Geographic Warehouse custom download, and a .docx documentation file (not read).
- **Fields (32):**
  - Facility: `FACILITY_NAME`, `DESCRIPTION` (Port 94 / Terminal 67 / Harbour 15 / Shipyard 8), `FACILITY_TYPE_USE` (Fishing, Bulk, Breakbulk and Bulk, Container, Cruiseship, Ferry, Forest Products, Shipyards…)
  - Who runs it: **`AUTHORITY`**, **`BUSINESS_OPERATOR`**
  - Cargo: `COMMODITIES_HANDLED`, `COMMODITY_STORAGE_CAPACITY`, `TERMINAL_BERTHS_DESC`
  - Contact: addresses, phone/email/fax, `WEBSITE_URL`, `IMAGE_URL`
  - Location: `LATITUDE`, `LONGITUDE` (to 7 decimals)
  - Provenance: `KEYWORDS`, `DATE_UPDATED` (**every row 2025-03-06**, which looks like a bulk re-stamp), `DATA_SOURCE` (e.g. "BC Ports Handbook 2014; …", "Department of Fisheries and Oceans Small Craft Harbours"), `SOURCE_DATA_ID`, `SEQUENCE_ID`
- **Licence:** Open Government Licence – British Columbia (https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61). The fallback attribution is quoted: "Contains information licensed under the Open Government Licence – British Columbia."
- **Salish examples:**
  - **Victoria:** Ogden Point Terminal and Ship Point (AUTHORITY "Greater Victoria Port Authority", operator "Greater Victoria Harbour Authority").
  - **Nanaimo:** Duke Point Deep Sea Terminal, Nanaimo Assembly Wharves (spelled "Assemply" in the data), Nanaimo Cruise Terminal, Harmac (AUTHORITY "Nanaimo Port Authority").
  - **Vancouver:** 36 "Port Metro Vancouver" terminals (Centerm, Vanterm, Deltaport, Westshore, Neptune, Cargill, Fraser Surrey Docks, **Kinder Morgan (Westridge Terminal)**, **Ioco Terminal**, **Shellburn**, **Stanovan (Chevron)**, **PetroCanada Terminal**).
  - **Other:** Port Alberni Terminals; Crofton (Stuart Channel Wharfs, Catalyst Paper); Chemainus Sawmill Wharf; Esquimalt Graving Docks; Seaspan ferry terminals.
- **Caveats:**
  - **Stale names.** "Port Metro Vancouver" has been Vancouver Fraser Port Authority since 2016 (per the CMA Schedule, Part 2). Operators are shown as "Kinder Morgan Canada" (Westridge now belongs to Trans Mountain; see docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md) and "Catalyst Paper".
  - `AUTHORITY` has trailing spaces and variants ("Greater Victoria Port Authority" vs "…Harbour Authority").
  - Treat `AUTHORITY` as a hint, not a legal status.
- **Also matters for the terminals dataset (flag):** these are **terminal points with operator and commodity** for BC, the Canadian counterpart to the USACE Docks layer. Our oil/gas study (docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md) did not list it. It covers Westridge, Ioco, Shellburn, Stanovan, Suncor/PetroCanada and Chevron.

### C4. CHS "Canadian Anchorages and Anchorage Areas" (Josh's first link)
- **Link:** https://osdp-psdo.canada.ca/dp/en/search/metadata/NRCAN-FGP-1-622a7f72-4a00-4f9e-b04f-af6551c77db3, the same as https://open.canada.ca/data/en/dataset/622a7f72-4a00-4f9e-b04f-af6551c77db3
- **Publisher:** Fisheries and Oceans Canada / **Canadian Hydrographic Service** (contact chsinfo@dfo-mpo.gc.ca). The "NRCAN-FGP" id prefix is just the Federal Geospatial Platform catalogue.
- **What it is:** anchorages taken from **CHS Electronic Navigational Charts (S-57)**. "The dataset is automatically updated on a weekly basis" (frequency P1W). Record modified 2026-08-11; coverage start 2019-12-05.
- **It is not a port list.**
- **Access:**
  - MapServer: https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/canadian_anchorages_and_anchorage_areas/MapServer (a French service also exists).
  - Shapefile zip: https://egisp.dfo-mpo.gc.ca/open_data_donnees_ouvertes/Anchorages/S57_MaritimeChart_Anchorages.zip (1.83 MB, Last-Modified 2026-09-26, so the weekly refresh is live).
  - Data dictionary XLSX (August 2026).
- **Layers (WGS84):**

  | Layer | Contents | Count |
  |---|---|---|
  | 0 | ACHARE anchorage-area points | 1,610 |
  | 1 | ACHBRT single-ship anchorage points | 290 |
  | 2 | ACHARE polygons | 154 |
  | 3 | ACHBRT polygons | 19 |

- **Fields:**
  - `OBJNAM` / `NOBJNM`: the chart name, usually a berth letter or number such as "A" or "12"
  - `INFORM` / `NINFOM`: notes such as "Reported anchorage" or "max vessel length 225 metres; swing radius 2.5 cables". The French notes have mojibake: "signalÃ©".
  - `FIDN`
  - `ENC_NAME`: the source chart cell, e.g. `CA571555`
- **Licence:** OGL-Canada (quoted in C2). The service copyright text is "Government of Canada; Fisheries and Oceans Canada; Canadian Hydrographic Service".
- **Salish (lat 48.2–49.4, lon −124.9 to −122.7):**
  - 45 anchorage-area points (all "Reported anchorage", no names)
  - **115 single-ship anchorage berths**, including 25 in the English Bay / Burrard Inlet area numbered 1–18 plus letters
  - Cowichan Bay / Satellite Channel berths A–D and 1–3
  - 5 polygons
  - The fields hold no port names or port authority.
- **How it relates:**
  - The TC anchorages pages (Interim Protocol for Southern BC anchorages) are the policy. This layer is the charted geometry.
  - It answers "which official anchorage berth is this ship at". It does not answer "which port".
  - It could check or refine the GFW anchorage points (docs/PORTS_SOURCES.md §4) and give a Canadian anchorage layer. **It is also relevant to terminals and bunkering work** (ships waiting at anchor), not to port names.

### C5. NRCan GEOSCAN 294442 "Ports and Harbours" (Josh's second link)
- **Links:**
  - https://osdp-psdo.canada.ca/dp/en/search/metadata/NRCAN-GEOSCAN-1-294442 (rendered in the browser pane; plain fetch returns an empty app shell)
  - The same map on open.canada.ca: https://open.canada.ca/data/en/dataset/5b99672b-69ff-5d08-b26b-10da06f8e30c
- **What it is:** a **publication, not data**.
  - National Atlas of Canada, 4th edition (1973/1974), MCR 1214, pages 209–210, DOI https://doi.org/10.4095/294442.
  - Four maps of ports and harbours **as of 1968**, with the greatest depth at a wharf and ice conditions.
  - Formats: scanned JPG and PDF (`ftp.geogratis.gc.ca/pub/nrcan_rncan/raster/atlas_4_ed/eng/economic/transportationandcommunications/209_210.pdf`).
  - OSDP "Update Frequency: Not Planned". Author: Canada Surveys and Mapping Branch.
- **Licence:** "Licensed under: Open Government Licence - Canada", "Open Access".
- **Coordinates:** none. It is a raster map, and OSDP says "POSITION NOT AVAILABLE".
- **Similar NRCan items:** Atlas 6th edition "Marine Transportation Infrastructure – Ports (2006)" (~590 ports) and "– Harbours (2006)" (~700 small craft harbours). These are also JP2/PDF maps only, not data (open.canada.ca d6c5280f…, d6e61d8f…).
- **Verdict:**
  - Historical context only. Not usable as a port list.
  - It has no terminal or energy content beyond wharf depths, so it does not bear on the terminals dataset.

### C6. Other Canadian items checked
- **Harbour authorities:** covered by the DFO HA list (C2b). Non-DFO harbour bodies, such as the Greater Victoria Harbour Authority (a non-profit), appear only as text in BC P&T.
- **CHS Sailing Directions / port names:** not checked as data. Sailing Directions are publications (UNVERIFIED whether any open dataset exists). The ENC names come through C4.
- **Statistics Canada port codes:** not found in this pass (UNVERIFIED). Canadian shipping statistics use their own port list (not checked).
- **Vancouver Fraser Port Authority jurisdiction map:** the port's own map. Not read. See the oil/gas study for its terminal PDF map.

---

## UNITED STATES

### U1. USACE / BTS "Port Areas" (Port and Port Statistical Areas): official names and port codes
- **Service:** https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Port_Statistical_Area/FeatureServer
  - Layer 0 "Ports": **370 polygons**
  - Layer 1 "PortStatisticalAreas": 7 polygons (inland river groups only)
- **Catalogue entries:**
  - USACE hub item `b7fd6cec8d8c43e4a141d24170e6d82f`
  - BTS/NTAD re-lists: "Port Areas" `0fa7c191e69946f2901727494eb2e062` and "Port Statistical Areas" `6755534edf0f441894e021912486db31` on https://geodata.bts.gov (owner `USDOT_BTS`)
- **What it is (service description):** "A Port Area is defined by the limits set by overarching legislative enactments of state, county, or city governments, or the corporate limits of a municipality."
- **Fields:**
  - `FEATURENAME`: the official port name
  - `FEATUREDESCRIPTION`: the legal basis of the boundary
  - `PORTIDPK`: the **USACE port code**
  - `DATA_YEAR`, `INSTALLATIONID`, `MEDIAID`, `METADATAID`, `SDSID`
- **Coordinates:** polygons only. They are often whole counties, so they are **not a map point for the port**.
- **Licence (item `licenseInfo`, quoted):** "Port boundaries are for statistical data collection and tabulation purposes only. Their depiction and designation for statistical purposes does not constitute a determination of jurisdictional authority or rights of ownership or entitlement and they are not legal land descriptions." No other use restriction is stated. It is USACE work, so a US Government work (UNVERIFIED beyond that statement).
- **Salish box (9 port areas):**

  | PORTIDPK | FEATURENAME | Boundary |
  |---|---|---|
  | 4722 | Port of Seattle, WA | "Corporate limits of King County" |
  | 4719 | Tacoma, WA | Pierce County |
  | 4727 | Port of Everett, WA | per ordinance, Ebey Slough area |
  | 4730 | Port of Anacortes, WA | Skagit County boundaries per 6.32.020 |
  | 4736 | Bellingham, WA | municipal limit ("Port of Bellingham elected to not use Whatcom County") |
  | 4713 | Port of Olympia, WA | Thurston County |
  | 4707 | Clallam County Port District, WA | Port Angeles |
  | 4711 | Jefferson County Port District, WA | Port Townsend |
  | 4709 | Grays Harbor Port District, WA | outer coast |

  - **No Friday Harbor, Bremerton or Edmonds areas** in this layer.

### U2. USACE / BTS "Principal Ports"
- **Service:** https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Principal_Ports/FeatureServer/0 (last edit 2026-07-14).
- **Catalogue entries:** USACE item `16d570a7aa054943aabf52b0032a3b57`; BTS/NTAD item `e3b6065cce144be8a13a59e03c4195fe` (https://geodata.bts.gov/datasets/usdot::principal-ports/about).
- **What it is:** "USACE port codes, geographic location, names, and commodity tonnage summaries … for principal USACE ports for **CY 2023**". The **top 150 ports by tonnage**, so membership changes year to year (MARAD's wording).
- **Geometry: polygons (150)**, the port areas. The old NTAD points are gone from this service.
- **Fields:** `RANK`, `PORT` (USACE code), `TYPE` (Coastal/Internal…), `PORTNAME`, `TOTAL`, `DOMESTIC`, `FOREIGN_`, `IMPORTS`, `EXPORTS` (short tons, UNVERIFIED unit).
- **Licence:**
  - BTS item, quoted: "This NTAD dataset is a work of the United States government as defined in 17 U.S.C. § 101 and as such are not protected by any U.S. copyrights. This work is available for unrestricted public use."
  - Requested acknowledgement: "U.S. Army Corps of Engineers (USACE)/Navigation and Civil Works Decision Support/Waterborne Commerce Statistics Center, and the Bureau of Transportation Statistics (BTS) [distributor]."
  - USACE item: "publicly available without any use restrictions".
- **Salish:**
  - Tacoma (rank 30, 18.9 M tons)
  - Seattle (34, 17.2 M)
  - Anacortes (45, 10.6 M)
  - Grays Harbor (92) is just outside
  - **Everett, Bellingham, Port Angeles and Olympia are not in the top 150.**
- **HIFLD:** HIFLD Open was discontinued on 2025-08-26. This was seen only via secondary sources: https://atcoordinates.info/2025/08/08/hifld-open-gis-portal-shuts-down-aug-26-2025/ and search results citing DHS; the DHS notice itself was not read, so the date is UNVERIFIED on a primary page. Principal Ports is **still live** from USACE and BTS, as above.

### U3. USACE Navigation Facilities (Docks): already covered
- See docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md §1: 20,548 dock points, 46 fields, "without any use restrictions".
- **Relation to this study:** each dock carries `PORT` / `PORT_NAME` (the same USACE port code as U1 and U2) and `UNLOCODE`.
- So Docks is the **point layer that sits inside the official port areas**. A port code from U1 can be given map positions through its docks, e.g. every dock with `PORT = 4727` is Port of Everett.

### U4. US Census Schedule D (CBP districts and ports of entry)
- **Page:** https://www.census.gov/foreign-trade/schedules/d/distcode.html. HTML table: name, 4-digit code, District or Port.
- **Coordinates:** none.
- **Scope:** CBP ports of entry. These include land crossings and airports (Blaine, Sumas, Sea-Tac airport, UPS …), not only seaports.
- **Salish seaport entries:**
  - District **30 Seattle**
  - 3001 Seattle, 3002 Tacoma, 3005 Bellingham, 3006 Everett, 3007 Port Angeles, 3008 Port Townsend, 3010 Anacortes, **3014 Friday Harbor**, 3017 Point Roberts, 3026 Olympia, 3027 Neah Bay (from MARAD's copy)
- **Licence:** Census.gov is a US Government work (no page-level licence read, UNVERIFIED).
- **Schedule K** (foreign port codes) is now maintained by USACE WCSC (via https://ndclibrary.sec.usace.army.mil/searchResults?series=Schedule+K+Foreign+Port+Codes, a JS app that did not render; content UNVERIFIED). It gives US agencies' 5-digit codes for **foreign** ports, which would include Canadian ones. Not tested.

### U5. MARAD "Ports Listing and Resources" (Josh's link)
- **Page:** https://www.maritime.dot.gov/data-reports/ports/list ("Last updated: Monday, June 30, 2025").
- **Access:** scripted fetch returned **403 (Akamai)**. It was read in the browser pane.
- **What it is:** a compilation page, which says "Congress uses different definitions of 'port' and 'port terminal' across statutes and programs". It has seven sections:
  1. **MARAD Port Authorities, Districts & Commissions**
     - About 250 names, maintained by the MARAD Gateway Offices. **Names only**: no state, codes or coordinates.
     - The text says "An Excel version of this list can be downloaded {here}", but the placeholder **is not a link**, so no Excel is available.
     - WA / Salish names present: Northwest Seaport Alliance, Port of Seattle, Port of Tacoma, Port of Everett (and a separate "Port Everett"), Port of Anacortes, Port of Bellingham, Port Angeles, Port of Port Townsend, Port of Olympia, Port of Bremerton, Port of Edmonds, Neah Bay.
     - **Not present:** Port of Friday Harbor, Port of Skagit, Port of Kingston.
  2. **USACE Principal Ports:** links to BTS Principal Ports (U2) and repeats the CY2023 list of 150 codes and names.
  3. **Deepwater Ports:** offshore oil and LNG ports licensed under the Deepwater Port Act. **None on the West Coast** (UNVERIFIED; links to MARAD's approved-applications list, not read).
  4. **CBP Ports of Entry:** a copy of Schedule D (U4).
  5. **World Port Index:** points to NGA WPI (our current base). MARAD's text says WPI covers "almost 4,000 locations"; the live API has 2,951 (docs/PORTS_SOURCES.md).
  6. **Port websites.**
  7. **Additional resources:** BTS Port Performance (https://www.bts.gov/ports), PIDP applicants, AAPA.
- **Coordinates:** none on this page.
- **Licence:** MARAD content is a US Government work by default (17 U.S.C. §105). No page-level terms were found. The DOT "Web Policies" page (https://www.transportation.gov/web-policies) had no copyright text when read in the pane.
- **Relation to the rest:** MARAD adds no new geometry. Its value is the **list of legal port-authority names** (e.g. "Northwest Seaport Alliance", the joint Seattle–Tacoma cargo authority, which no other source here names).

### U6. MARAD "Data and Statistics" hub (Josh's link)
- **Page:** https://www.maritime.dot.gov/data-reports/data-statistics/data-statistics ("Last updated: Tuesday, September 22, 2026").
- **Access:** scripted access returns 403 (Akamai), so files were fetched in the browser pane. Each file was downloaded once and parsed in the page.
- **Licence:** no dataset licence is stated. These are US Government works, but several tables are **derived from commercial sources**, and the notes name them: Lloyd's MIU, IHS, Clarksons, ABS. MARAD's redistribution rights for those derived numbers are **UNVERIFIED**. Contact: data.marad@dot.gov.
- **Coordinates:** none in any file below. Ports are names only.

| Dataset | File (size, server date) | Years | Grain | Salish content | Use for /ships |
|---|---|---|---|---|---|
| **Vessel Calls in U.S. Ports, Selected Terminals and Lightering Areas (2015)** | `files/oictures/dsvesselcalls2015 (1).xlsx` (31 KB, 2020-06-10) | 2015 only (the notes say the series covered 2013–2015) | **Per port/terminal**, 113 rows. Calls, GT and DWT by Container / Dry Bulk / Gas / General Cargo / Ro-Ro / **Tanker** | **Anacortes 205 calls (189 tanker)**, **Cherry Point 259 (225 tanker, 19 gas)**, **Port Angeles 244 (160 tanker)**, Seattle 643 (32 tanker), Tacoma 1,062 (8 tanker), Everett 118 | A one-year official cross-check of tanker calls at Cherry Point, Anacortes and Port Angeles against our GFW-based counts. Method: IHS cargo ships over 1,000 GT (IMO-registered, passenger ships removed), matched to AIS. "Calls … may include berth shifts, movement to and from an anchorage". Anchorage arrivals are excluded. |
| **Tanker Calls at U.S. Ports** (OPA-90 group) | `docs/outreach/data-statistics/7161/tankercallsatusports.xls` (40 KB; page updated 2018-10-24) | 2003–2011 | **National totals only.** Rows by flag (U.S., Jones Act, foreign, all) × product/crude × double hull | **None: no ports** | Background only. Source: Lloyd's MIU vessel movements. Tankers of 10,000 DWT or more. |
| **U.S.-Flag OPA-90 Phase-Out** | `…/7166/opa-90phase-outsyear-end.xls` (54 KB) | Snapshot 2011-12-31 | **Per ship by name** (no IMO). Fields: name, GT, DWT, year built, year rebuilt, OPA-90 phase-out year, hull (SH/DB/DH). Groups: product tankers, crude carriers, coastal tank barges | No port field | Historical ship facts. Identity is by name only; joining to IMO needs a name + year-built match (UNVERIFIED quality). Sources: ABS, Clarksons, Lloyd's, USACE Vessel Master File. |
| **U.S.-Flag Tank Vessels Removed** (hub link `/us-flag-tank-vessels-removed`; the `/us-tank-vessels-removed` link is a 404) | `…/7171/tankvesselsremovedfromuspetroleumtrades.xls` (58 KB) | Removals 1994–2013 | **Per ship by name** (no IMO): DWT, built, phase-out year, removal year, notes ("Sold for scrap (1997)", "Flagged-out (1995)") | No port field | Historical fate of old US tankers. Little use for today's traffic. |
| **U.S. Tank Vessel Trades** | `…/7176/tankvesseltrades.xls` (36 KB) | 1994–2010 | **National/route totals**: million tons, ton-miles and average miles by vessel type. Routes: Gulf & Atlantic, Gulf & Atlantic/West Coast, **Intra-West Coast**, **Alaska/West Coast** (crude) | Route level only | Context: the Alaska→West Coast crude trade that feeds Cherry Point and Anacortes. No ports. |
| **Coastal Tank Vessel Market Snapshot (2011)** | `…/6816/coastaltankvesselmarketsnapshot.pdf` (248 KB, 15 pages, June 2012) | 2001–2011 | Narrative report with national tables. The text search found **no Puget Sound / Washington / IMO mentions** | None | Background only. Example: three companies (BP, ConocoPhillips, ExxonMobil) own the Alaska crude and eleven crude carriers. |
| 2017 US Coastal Tank Vessel Trade Volumes | `…/6746/us-coastal-tank-vessel-trade-volumes-20170202.xlsx` (61 KB) | 1994–2014 | National totals by crude / product / barge | None | Background only. |
| U.S. Waterborne Foreign Container Trade by U.S. Customs Ports 2000–2017 | `…/7081/container-ports-2000-2017.xlsx` (110 KB) | 2000–2017 | **Per customs port**: TEU and metric tons, imports and exports | Seattle, Tacoma, Everett, Anacortes, Port Angeles, Aberdeen, Vancouver WA, Longview | Old. Port-card context at most. |
| **U.S.-Flag Privately-Owned Fleet** (monthly, CY2025) | e.g. `files/2026-02/DS_USFlag-Fleet_2025_DEC_Ships.xlsx` (39 KB, Last-Modified 2026-02-17). Monthly Jan–Dec 2025 plus PDF and in/out lists; history since 1990 on the "Vessel Inventory Reports" page | As of 2026-01-05 | **Per ship with IMO NUMBER.** Fields: name, ship type, GT, DWT, build location, year built, operator, Document of Compliance holder, MSP, TSP, VISA, VTA, MSC charter, Jones Act eligible, militarily useful. 190 ships (93 Jones Act eligible) | Ships, not ports. Examples: 9642083 WASHINGTON (tanker, Crowley Alaska Tankers), 9353591 OVERSEAS ANACORTES, 8419154 MATSON TACOMA, 9244661 ALASKAN EXPLORER | **Matters for ship identity.** An official US operator and DOC holder, keyed by IMO, for the US-flag oceangoing fleet (Alaska crude tankers that call at Cherry Point and Anacortes). Tugs, ATBs and barges under 1,000 GT are out of scope. |
| Others on the hub | ITB/ATB list (2017), Merchant Fleets of the World 2016, Top 25 flags, fleet summary 2000–2019, U.S.-flag carriers list, foreign trade by districts and trading partners, container ship capacities 2016 | — | Fleet or national | — | Not needed now. The ITB/ATB list (2017) is the only per-unit list of **articulated tug-barges**, which dominate Puget Sound product moves (not opened, UNVERIFIED fields). |

**MARAD OPA-90 files: plain summary:**
- *Tanker Calls* is **national totals only**, so it cannot check per-port counts.
- *Phase-Out* and *Removed* are **per ship by name, with no IMO**, and historical (up to 2013).
- *Tank Vessel Trades* and the *Snapshot* are national or route totals.
- The only per-port official tanker count found is **Vessel Calls 2015**, for one year.
- The only IMO-keyed MARAD list is the **monthly U.S.-flag fleet**.

### U7. NOAA
- **ENC Direct** (https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer) carries S-57 harbour objects: `Harbour_Facility` (`CATHAF`, `OBJNAM`), `Small_Craft_Facility`, `Harbour_Area_Administrative_area`, `Berth`, `Anchorage_Area` …
- Salish box, harbour-scale band:
  - 53 harbour-facility points (31 ferry terminals, 22 container terminals: "Terminal 18", "Terminal 5" …)
  - 20 small-craft facilities with no names
  - **0** administrative harbour areas
- The service copyright text is empty. NOAA's ENC terms were not read (**UNVERIFIED**).
- **Verdict:** berth and terminal names for Seattle and Tacoma exist, but there is no port list. It is the US twin of C4 and relevant to terminals and anchorages.
- **US Coast Pilot 7** (port descriptions) is a publication. Not checked as data.

### U8. UN/LOCODE
Mention only. The licence conflict is recorded in docs/PORTS_SOURCES.md: the footer says CC BY 4.0, the UN terms say personal non-commercial. It has no coordinates for most Salish rows, so it is not an official name source.

---

## Comparison

| Source | Official for | Salish ports / examples | Points? | Names / status | Licence | Fresh |
|---|---|---|---|---|---|---|
| TC CPA list + CMA Schedule | Canada Port Authorities (17) | Vancouver Fraser, Nanaimo, Port Alberni | no | legal CPA names | Canada.ca / Justice Laws (reuse terms UNVERIFIED) | page 2020; Act 2024 |
| TC owned ports + Public Ports Regs | TC public ports and facilities | Victoria (public port); False Bay | no (text limits) | status | same | page 2026-09-23 |
| **DFO SCH open data** | small craft harbours + managing HA | 28 in the box: Sooke, Ladysmith, Steveston, Ganges, French Creek … | **yes, ~1 m** | official name, type, HA | **OGL-Canada** | 2026-03-24 |
| DFO HA list (JSON) | harbour authorities (559) | Sooke HA, Steveston HA … | no | legal HA names, addresses | Canada.ca terms (UNVERIFIED) | 2026-07-30 |
| BC Ports and Terminals | BC ports, terminals, shipyards (184) | Ogden Point, Duke Point, Westridge, Deltaport … | **yes** | authority + operator (stale) | **OGL-BC** | 2025-03 |
| CHS anchorages | charted anchorages | 115 berths in the box | yes (+ polygons) | berth labels only | OGL-Canada | weekly |
| NRCan 1974 atlas | none (history) | — | no | — | OGL-Canada | 1968 data |
| USACE/BTS Port Areas | US port districts + USACE codes | Seattle 4722, Tacoma 4719, Everett 4727, Anacortes 4730, Bellingham 4736, Olympia 4713, Clallam 4707, Jefferson 4711 | polygons | official name + legal basis | US Gov; "statistical purposes only" | 2019–2021 |
| USACE/BTS Principal Ports | top 150 by tonnage | Tacoma, Seattle, Anacortes | polygons | rank + tonnage | US Gov, "unrestricted public use" | CY2023 |
| USACE Docks | dock points with port code | Cherry Point, Anacortes, Tacoma docks | **yes** | stale owner text | no use restrictions | 2026-08 |
| Census Schedule D | CBP port-of-entry codes | 3001 Seattle … 3014 Friday Harbor | no | codes | US Gov (UNVERIFIED) | live |
| MARAD port authority list | legal authority names | NW Seaport Alliance, Port of Seattle … | no | names only | US Gov (default) | 2025-06-30 |
| MARAD Vessel Calls 2015 | calls per port by ship type | Cherry Point, Anacortes, Port Angeles tanker calls | no | — | US Gov; derived from IHS (UNVERIFIED) | 2015 |
| MARAD US-flag fleet | US-flag ships by IMO | Alaska tankers | n/a | operator, DOC holder | US Gov (default) | 2026-01 |
| NGA WPI (current base) | global port reference | 60 in the box | yes (~1.8 km rounding) | WPI name, size | public domain | undated |

---

## PROPOSED plan (APPROVED by Josh 2026-09-27; see "Built" below for his decisions and what was built)

The principle: **WPI stays the map point. Official lists add a verified name and status line, plus a few new points where WPI has nothing.** The left panel keeps **one "Ports" row**. There are no new rows or toggles; official ports are just more ports in the same layer.

1. **Sources to adopt (all open licences):**
   - Canada: DFO SCH open data (points), the TC CPA list and TC public ports (a hand-kept table of about 20 rows, each citing its TC page and Canada Marine Act schedule line).
   - US: USACE Port Areas (code and name, matched by polygon).
   - Optional: BC Ports and Terminals, **for terminals** (see the terminals note below), not for port names.
2. **Match rule (read time, stored as `port_aliases`, same pattern as WPI↔PortWatch):**
   - **DFO SCH harbour → port:** same country, the nearest WPI or official port within **4 km** (our GFW rule), and a name check: the normalised names share a main word, e.g. "Ganges (Inner Harbour)" ↔ "Ganges".
     - Distance only, with no name match: record it as a candidate, not accepted.
     - Two SCH harbours on one WPI port (Ganges Inner and Outer, Steveston ×2): both attach, and the card lists both.
   - **CPA / TC public port → port:** a hand-kept crosswalk (Vancouver Fraser → WPI 18150 Vancouver plus New Westminster, Port Moody, Fraser Mills, Steveston; Nanaimo → 18520 plus Harmac; Port Alberni → 18730; Victoria → 18670). There are only a few rows, and each row cites its TC or Act source.
   - **US port → USACE port code:** a WPI point that falls inside a Port Area polygon gets that `PORTIDPK` and `FEATURENAME`. A point inside two polygons stays ambiguous and is never guessed.
3. **What the port card shows:**
   - A new first line under the title: **"Official: Vancouver Fraser Port Authority (Canada Port Authority)"** with an inline source link to TC's CPA page. Other examples:
     - "Official: Sooke, DFO core fishing harbour, managed by Sooke Harbour Authority" (DFO)
     - "Official: Port of Everett, WA (USACE port 4727)"
     - "Official: Victoria, Transport Canada public port"
   - The WPI name stays the title unless Josh prefers the official name as the title (**open question**).
   - Only accepted matches are shown. Candidates never are.
4. **Adding missing official ports:**
   - DFO SCH harbours with no port within 4 km become new port points in the same Ports layer, with `origin = 'dfo-sch'`.
   - In the Salish box that is about 17 points: Sooke, French Creek, Ladysmith, Ladner, Whaler Bay, Degnen Bay, Fulford, Burgoyne, Vesuvius, Musgrave, Oak Bay, Northwest Bay, and the Fraser River harbours.
   - Same marker style. The card says "Official: DFO small craft harbour …" and shows the GFW visits if any exist.
   - US port areas add no points. Friday Harbor is already in WPI.
5. **Terminals (separate from ports):** BC Ports and Terminals, with the USACE Docks and the CHS/NOAA anchorage layers, belong with the terminals work in docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md, not on the port card.
6. **Ship identity:** the MARAD monthly US-flag fleet list (IMO, operator, DOC holder) could become one more registry source on ship cards for US-flag ships. That belongs in a separate step.

## Open questions for Josh
1. Should the card title be the **official** name (e.g. "Vancouver Fraser Port Authority") or keep WPI's ("Vancouver") with the official name on the first line?
2. Should we add the ~17 missing DFO harbours as new points, or only label existing ports?
3. For Vancouver: should one card cover all WPI points inside the port authority (Vancouver, New Westminster, Port Moody, Fraser Mills, Steveston), or should each keep its own card with the same "Official" line?
4. Should the USACE port-area county polygons be drawn? (Proposal: no; use them only for matching.)
5. Should BC Ports and Terminals be added to the terminals study now (it has Westridge, Ioco, Shellburn, Stanovan), accepting stale operator names that we would correct by hand?
6. Should MARAD's 2015 per-port tanker calls go in as an official one-year check against our GFW counts at Cherry Point, Anacortes and Port Angeles, noting the method difference (berth shifts are counted)?

---

## Built (2026-09-27, dev database only)

Josh's decisions on the open questions (2026-09-27):
1. The WPI name stays the card title. The official name goes on a line under it ("Official: …") with an inline source link.
2. Missing DFO small craft harbours (no map port within 4 km) are added as points in the **same Ports layer** (no new row or toggle).
3. Several WPI points under one official port (e.g. Vancouver Fraser) each keep their own card, with the same "Official" line.
4. USACE Port Area polygons are used **only for matching**, not drawn.
5. BC Ports and Terminals belongs to the separate terminals work (not part of this build).
6. MARAD 2015 tanker calls: a one-time check against our GFW-based counts, written here only (not on the site). Result below.

**Code:** `lib/ships/officialPorts.js` (sources, pure matching, import, read), `lib/ships/migrations/013_official_ports.sql`
(widens `ports_origin_check` with `dfo_sch` and `port_aliases_key_kind_check` with `dfo_sch_harbour`, `ca_port_authority`,
`tc_public_port`, `usace_port_area`; additive), `lib/ships/data/ca-official-ports.json` (the hand table, each row citing its
pages), `scripts/ships/import-official-ports.mjs` (`npm run ships:import-official-ports -- [dfo|usace|tc|all] [--bbox W,S,E,N | --everywhere]`;
default area = the Salish box -125.5,47,-122,50.5). The port card reads `official` from `op=port`; `op=portsLayer` includes
the DFO-only ports (hollow ring, like other non-WPI ports).

**Sources registered** (`ships.sources`): `dfo-sch` (OGL-Canada, quoted), `usace-port-areas` (US Government work + the
item's "statistical purposes only" note, quoted), `ca-official-ports` (Reproduction of Federal Law Order SI/97-5, quoted
from https://laws-lois.justice.gc.ca/eng/regulations/SI-97-5/FullText.html; the Canada.ca terms page could not be fetched
on 2026-09-27, so reuse terms for TC's page text itself stay **UNVERIFIED**).

**Match rules as built:**
- DFO harbour → our map port (WPI, named GFW port, Climate TRACE-only port) within 4 km, same country, whose name shares a
  main word (generic words like Harbour, Bay, Cove, Landing, River are ignored) → accepted; with several such ports the
  nearest must be under half the next distance. Distance only → `candidate` (stored, not shown). No map port within 4 km
  of any country → a new port of origin `dfo_sch`.
- Hand table → the WPI port numbers listed in each row. The importer fetches every page a row cites, stores it
  (`ca-official-ports` / `web_page`), and accepts the row only if its check text is on every page and every WPI port exists.
- USACE → a US WPI point inside exactly one Port Area polygon gets that area's name and code; inside two → candidates only.

**Result on the dev database (Salish box -125.5,47,-122,50.5; run 2026-09-27):**
- DFO: **57 harbours** in the box (35 core fishing, 18 non-core, 4 recreational). **21 accepted** onto existing map ports,
  **9 candidates** (distance only: Fanny Bay, Madeira Park, Okeover Inlet, Tsehum Harbour, Cortes Bay, Hospital Bay,
  Mansons Landing, Schooner Cove, Oak Bay), **27 added as new ports** (Sooke, French Creek, Ladner, Whaler Bay, Degnen Bay,
  Fulford Harbour, Burgoyne Bay, Vesuvius Bay, Musgrave, Northwest Bay, the Fraser River harbours Albion, Kanaka Landing,
  McIvor's Landing, McMillan Island, Whonnock, and northern-Strait harbours such as Campbell River, Cape Mudge, Quathiaski
  Cove, Squirrel Cove, Egmont, Bamfield West …). Ladysmith, Lund, Deep Bay, Saltery Bay and Porpoise Bay matched the
  Climate TRACE-only ports already there.
- Hand table: 4 rows (Vancouver Fraser, Nanaimo, Port Alberni Port Authorities; Victoria public port) all confirmed on
  their pages → 9 WPI ports carry an official line.
- USACE: 9 Port Areas; of 37 US WPI ports in the box, **15** lie in exactly one area, **0** in two, **22** in none
  (San Juan, Kitsap, Island and Mason counties have no Port Area in this layer; Cherry Point and Blaine are outside
  Bellingham's municipal-limit area).

Sample "Official" lines (API `op=port`, localhost 2026-09-27):
- Vancouver (WPI): Vancouver Fraser Port Authority · Canada Port Authority [TC] · also Vancouver (False Creek) [DFO]
- Steveston (WPI): Vancouver Fraser Port Authority · Canada Port Authority [TC] · also Steveston (Gulf of Georgia) [DFO] · also Steveston (Paramount) [DFO]
- Nanaimo (WPI): Nanaimo Port Authority · Canada Port Authority [TC]
- Victoria Harbor (WPI): Victoria · Transport Canada public port [TC] (no "managed by": TC's page says it "may or may not own or operate the port facilities")
- Seattle (WPI): Port of Seattle, WA · USACE port area 4722 [USACE]
- Port Angeles (WPI): Clallam County Port District, WA · USACE port area 4707 [USACE]
- Sooke (new DFO port): Sooke · DFO core fishing harbour, managed by Sooke Harbour Authority [DFO]

### MARAD Vessel Calls 2015: check against our GFW-based counts

MARAD's 2015 tanker calls (U6 above): **Cherry Point 225, Anacortes 189, Port Angeles 160, Seattle 32.**

**Our data does not cover 2015, so no comparison could be made.** Checked 2026-09-27 on the dev database:
- `ships.port_visits` (GFW port-visit events) runs from **2024-07-22 to 2026-09-23** (102,629 visits); nothing before 2024.
- The port-card fetch log covers 2025-01 onward. Our MarineCadastre AIS tracks cover 2025-07 – 2026-06.
- Even with 2015 GFW visits, GFW's port-visit vessel types have no "tanker" class (cargo, passenger, fishing, carrier,
  bunker, support, other …; docs/GFW_ACTIVITY_API.md), so a tanker count would need each visiting ship's type from our
  identity sources (a join we have not built).

A like-for-like check would need: GFW port visits for 2015 at the Cherry Point, Anacortes, Port Angeles and Seattle labels
(about 4 stats calls plus the monthly event pages), ship types joined from identity records, and MARAD's method difference
kept in mind (its calls "may include berth shifts, movement to and from an anchorage"; anchorage arrivals excluded).
Not done: it needs Josh's go-ahead for the GFW calls and the type join.
