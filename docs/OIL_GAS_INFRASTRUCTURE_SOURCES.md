# Oil & gas facilities: source catalogue (reference for a /ships layer)

Studied 2026-09-27. Goal: a /ships layer of the Salish Sea's refineries, marine oil terminals,
tank farms, bunkering berths, LNG and coal terminals. Clicking one shows the ships that stopped
there (GFW port visits we already store) and emissions where known (Climate TRACE).

Facts only. Every fact has a live URL read on 2026-09-27 unless marked otherwise.
**UNVERIFIED** = not confirmed from a primary page or a live response.
Tests were small: one bbox or one filtered query per source. No bulk downloads.

## Short answer

- **No single open source covers both sides of the border at berth level.**
- **Washington:** two good berth-level sources.
  - **USACE Navigation Facilities (Docks):** operator, owner, purpose, commodities, construction, depth and pipelines for each dock. No use restrictions. Owner text is often decades old.
  - **WA Ecology "Facilities – Class 1, 3, and 4":** the regulator's own list, with a **dock** lat/lon and the oil products handled. Its terms of use forbid "political use". Josh needs to decide on that.
- **British Columbia:** no open government facility dataset was found.
  - **OpenStreetMap** maps the sites well (Westridge, Shellburn, Burnaby Refinery, "ManPier"). It is ODbL (share-alike).
  - The Port of Vancouver's terminal map names all the liquid-bulk terminals, but it is a picture, not data.
- **Refineries with emissions:** Climate TRACE (already baked) has all 6 Salish refineries. Its points are the **plant**, 1.6–4.6 km from the **dock**, so they must be linked to dock points.
- **Coal / LNG:** Global Energy Monitor (CC BY 4.0) has Westshore, Neptune and Tilbury LNG.
- **EIA Energy Atlas:** its oil layers are no longer public. The ArcGIS services now return "Token Required", and HIFLD Open shut down on 2025-08-26. Only the 2021/2022 shapefile zips on eia.gov still download.
- **GFW positions are anchorage cells (~0.5 km).**
  - The two Anacortes refinery docks are **0.57 km apart**, so matching needs an ambiguity rule.
  - A visit's main position is the **first stop**, which for a tanker is often the anchorage, not the berth.

---

## 1. USACE Navigation Facilities (Dock) — "Master Docks Plus"

- **Publisher:** US Army Corps of Engineers, Navigation & Civil Works Decision Support Center (WCSC data).
- **URLs:**
  - Hub item: https://geospatial-usace.opendata.arcgis.com/datasets/23d91bd988ac4fc9943128965bddfa37_0
  - FeatureServer: https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Docks/FeatureServer/0
  - CSV: https://geospatial-usace.opendata.arcgis.com/api/download/v1/items/23d91bd988ac4fc9943128965bddfa37/csv?layers=0
- **Access:** public ArcGIS REST with no key. `maxRecordCount` is 2000. Points in WGS84.
- **Counts (live):**
  - 20,548 records in total, 1,085 in WA.
  - 210 WA records match petroleum/crude/fuel/LNG in `COMMODITIES` or `PURPOSE`.
  - The item snippet still says "nearly 12,000". The live count is higher.
- **Updated:** layer last edit 2026-08-06.
- **Fields (all 46):**
  - Identity: `NAV_UNIT_ID` (stable id, e.g. `02JT`), `NAV_UNIT_GUID`, `LOC_DOCK`, `UNLOCODE`, `NAV_UNIT_NAME`, `FAC_TYPE` (Dock / Anchorage / Open Water / …), `DATA_RECORD_STATUS`.
  - Location: `LATITUDE`, `LONGITUDE`, `LOCATION_DESCRIPTION`, `STREET_ADDRESS`, `CITY_OR_TOWN`, `STATE`, `ZIPCODE`, `COUNTY_NAME`, `COUNTY_FIPS_CODE`, `CONGRESS`, `CONGRESS_FIPS`.
  - Waterway: `TOWS_LINK_NUM`, `TOWS_MILE`, `WTWY`, `WTWY_NAME`, `PORT`, `PORT_NAME`, `PSA`, `PSA_NAME`, `MILE`, `BANK`.
  - Operations: `OPERATORS`, `OWNERS`, `PURPOSE`, `COMMODITIES` (WCSC commodity groups, `|`-separated), `MECHANICAL_HANDLING`, `REMARKS` (pipelines and tank capacities), `HIGHWAY_NOTE`, `RAILWAY_NOTE`.
  - Construction: `CONSTRUCTION`, `VERTICAL_DATUM`, `DEPTH_MIN`, `DEPTH_MAX`, `BERTHING_LARGEST`, `BERTHING_TOTAL`, `DECK_HEIGHT_MIN`, `DECK_HEIGHT_MAX`, `PARENT_OR_CHILD`, `SERVICE_INITIATION_DATE`.
- **Salish examples (live):**
  - `02JT` "BP PRODUCTS NORTH AMERICA INC., CHERRY POINT TERMINAL" (48.8606, −122.7583).
    - Purpose: "Receipt and shipment of petroleum products; receipt of crude oil; and bunkering vessels."
    - Remarks list its pipelines and tank farm (crude tanks 2,420,000 bbl).
    - **Owner text is stale:** "ARCO Products Co., a division of Atlantic Richfield Co."
  - `0USS` "CONOCO PHILLIPS, FERNDALE REFINERY WHARF" (48.8261, −122.7194). Owner text: "Tosco Refining Co."
  - `0U5U` "HOLLYFRONTIER PUGET SOUND REFINERY" (48.5094, −122.5790). Owner text: "Texaco Refining and Ma…"
  - `0U5V` "SHELL OIL CO ANACORTES REFINERY WHARF" (48.5083, −122.5692).
    - ⚠ This is the same spot as Ecology's "Anacortes Refinery" dock (48.5084, −122.5694; §6).
    - The name and the position may belong to different operators. **Verify before use.**
  - `0T5L` / `0T5M` / `0R9W`: U.S. Oil & Refining Tacoma docks.
  - `0UF1` Seaport Sound Terminal Tacoma. `0UGH` ConocoPhillips Tacoma.
  - `0UXH` Tesoro Port Angeles ("Mooring and supplying bunkering barges").
  - `0UNC` Chevron Point Wells. `0UMS` BP Seattle Pier 11. `0UN7` Pier 15.
  - Generic points also match the commodity filter: "SHIP SIDE FUELING", "ANACORTES ANCHORAGE", "OPEN WATER", ferry docks. The filter needs curation.
- **Coverage:** US ports only (plus territories). **No Canada.**
- **Licence (item `licenseInfo`, quoted):** "This data set is publicly available without any use restrictions; however, this data set was developed for use at a national scale and may not be appropriate for use in local scale mapping." Attribution: "U.S. Army Corps of Engineers" (`accessInformation`).
- **Caveats:**
  - `OPERATORS`/`OWNERS` are free text and often decades old.
  - `COMMODITIES` lists every WCSC commodity group reported at the dock, so it is not a facility type.
  - Several near-duplicate records exist for one site (e.g. U.S. Oil has three).
- Also on the same Hub: **Principal Ports**, **Port Statistical Areas**, and the **IENC Master Service** (inland ENC features, mostly inland rivers; Salish coverage UNVERIFIED).

## 2. US EIA (Energy Atlas / U.S. Energy Mapping System)

- **What changed:**
  - The Atlas catalogue (`https://atlas.eia.gov/api/feed/dcat-us/1.1.json`, 101 datasets) **no longer lists** refineries, product terminals, crude rail terminals or LNG terminals.
  - `https://services7.arcgis.com/FGr1D95XCGALKXqM/arcgis/rest/services/PetroleumProduct_Terminals_US_EIA/FeatureServer` and `.../Petroleum_Refineries_US_EIA/FeatureServer` return **499 "Token Required"**.
  - EIA's own 2019 announcement says the Atlas "uses Homeland Infrastructure Foundation-Level Data" (https://www.eia.gov/todayinenergy/detail.php?id=45697). HIFLD Open was discontinued on 2025-08-26 (https://community.openstreetmap.org/t/hifld-open-discontinued/131903). Both were seen via search snippets only. The link between the two is **UNVERIFIED**.
- **Still downloadable (static zips, no auth):**
  - `https://www.eia.gov/maps/map_data/Petroleum_Refineries_US_EIA.zip` (37,784 B, Last-Modified 2022-02-03). Layer `Petroleum_Refineries_US_2021`.
    - Fields: `site_id, Company, Corp, Site, State, PADD`, per-unit capacities `AD_Mbpd … Asph_Mbpd`, `Source` ("EIA-820 Refinery Capacity Report"), `Period_` ("As of Jan. 1 2021"), `Latitude, Longitude`.
    - WA: BP Ferndale 251 Mbpd, Tesoro/Marathon Anacortes 120, Shell Anacortes 149, US Oil Tacoma 42, Phillips 66 Ferndale 110.5.
  - `https://www.eia.gov/maps/map_data/PetroleumProduct_Terminals_US_EIA.zip` (129,104 B, 2022-02-03). Layer `PetroleumProduct_Terminals_US_202109`, 1,474 points.
    - Fields: `Company, Site, State_Name, PADD, LONGITUDE, LATITUDE, Source` ("EIA-815").
    - 10 in the Puget Sound box: TLP Seattle, Seaport Sound, Phillips 66 Tacoma and Renton, Kinder Morgan Harbor Island, Tesoro Port Angeles, NuStar Tacoma, Petrogas West Ferndale, REG Grays Harbor, Shell Seattle.
  - `CrudeOil_RailTerminals_US_EIA.zip` exists (31,797 B; not opened). LNG zip names tried returned 404.
- **Licence (shapefile metadata `useLimit`, quoted):** "None (public use)." Credit: "U.S. Energy Information Administration".
- **Caveats:** the data is 4–5 years old (2021/2022), plant-level points not docks, and US only.

## 3. Canada: NRCan / CER (NACEI)

- **NACEI "Energy Infrastructure of North America"**, the US–Canada–Mexico cooperation (NRCan):
  - MapServer: https://geoappext.nrcan.gc.ca/arcgis/rest/services/NACEI/energy_infrastructure_of_north_america_en/MapServer
  - Catalogue: https://open.canada.ca/data/en/dataset/57e7bc4c-680b-4640-9fa1-ded7ce186fab (refineries) and https://open.canada.ca/data/en/dataset/e08eec16-7c7a-4253-9bee-ea640d400a54 (LNG terminals).
  - SHP/XLSX: `https://ftp.maps.canada.ca/pub/nacei_cnaie/energy_infrastructure/Refineries_NorthAmerica_201708_SHP.zip` (and LNG equivalents).
  - 38 layers, including: 3 Liquids Pipeline, 4 Natural Gas Processing Plants, 5 LNG Terminals, 10 Refineries, 37 Natural Gas Underground Storage.
  - Refinery fields: `Country, Facility, Owner, Latitude, Longitude, City, StateProv, Address, Type`, capacities in Mbpd and km³/d, `Source, Period`.
- **Salish bbox query (live):**
  - Refineries: 6 hits.
    - "Parkland Fuel", owner Parkland Fuel Corp, 49.2889, −123.006, 54.7 Mbpd, Source CAPP, Period 2016.
    - BP Ferndale, Tesoro Anacortes, Shell Anacortes, US Oil Tacoma, Phillips 66 Ferndale: all EIA 2017.
  - LNG terminals: **0 hits.** Tilbury is absent.
- **Licence:** Open Government Licence – Canada (https://open.canada.ca/en/open-government-licence-canada). Required attribution when none is given: "Contains information licensed under the Open Government Licence – Canada."
- **Updated:** metadata last modified 2021-05-19. Data vintage 2016–2017. Stale.
- **CER:** the open.canada.ca search found no CER dataset of facility or marine-terminal locations. CER publishes throughput, tolls and "Incidents At CER-Regulated Pipelines And Facilities" (incident points, not facilities). A Westridge polygon or point from CER is **not available** (as far as found).
- **Transport Canada:** Westridge is a "Designated Class 4 Oil Handling Facility" under CSA 2001 s.168(1) (https://www.transmountain.com/westridge-marine-terminal, via search snippet, **UNVERIFIED** on the page itself). No public list or dataset of designated oil handling facilities was found (UNVERIFIED that none exists).

## 4. Global Energy Monitor trackers

- **Trackers that matter:**
  - **Global Coal Terminals Tracker (GCTT):** 522 terminals. Page says latest release January 2024, but its citation says "December 2024 release".
  - **Global Gas Infrastructure Tracker (GGIT):** pipelines, plus 1,207 LNG terminal projects (LNG terminals released September 2025).
  - **Global Oil Infrastructure Tracker (GOIT):** **pipelines only** (1,634 oil pipelines, March 2025). No oil terminals or refineries.
  - The Oil and Gas **Plant** Tracker is power plants, so it is not relevant.
  - GEM has **no refinery or oil-terminal tracker**.
  - Pages: https://globalenergymonitor.org/projects/global-coal-terminals-tracker/ , https://globalenergymonitor.org/projects/global-gas-infrastructure-tracker/ , https://globalenergymonitor.org/projects/global-oil-infrastructure-tracker/
- **GGIT scope (FAQ, quoted):** "GGIT does not track terminals used solely for storage or bunkering."
- **Access:**
  - Official route: a download **form** on each tracker page (fields not checked).
  - GGIT FAQ: data "provided as Excel files and in GeoJSON, GeoPackage, and shapefile formats via the download form".
  - GEM's public map repo also serves map files with no form:
    - `https://raw.githubusercontent.com/GlobalEnergyMonitor/maps/main/trackers/coal-terminals/compilation_output/Coal%20Terminals-map-file-2025-01-15.csv` (104 KB)
    - `trackers/ggit/data/ggit_2024-12-20.geojson` (7.8 MB, not downloaded)
    - The repo has no licence file.
- **GCTT fields (map file):** `gem-terminal-id, gem-unit/phase-id, parent-port-name, country/area, coal-terminal-name, coal-terminal-name-(detail-or-other), capacity-(mt), status, start-year, retired-year, location-accuracy, owner, lat, lng, state/province, region, url`.
- **Salish hits (map file):**
  - T1087 Westshore Coal Terminals, Roberts Bank, 36 Mt, operating, "Exact", 49.0172, −123.1638.
  - T1050 Neptune Bulk Terminal (Teck), operating, 49.3042, −123.0521.
  - T1407 Pacific Coast Terminals, retired.
  - Cancelled: Fraser Surrey Docks, Gateway Pacific (Cherry Point), Grays Harbor.
- **LNG:** GGIT includes "Tilbury Island LNG Terminal" (FortisBC; https://www.gem.wiki/Tilbury_Island_LNG_Terminal, via search). Tacoma LNG and Woodfibre are **UNVERIFIED**.
- **Licence:**
  - The GEM site hosts the full CC BY 4.0 text at https://globalenergymonitor.org/creative-commons-license.
  - The statement "All Global Energy Monitor tracker data are freely available under a Creative Commons Attribution 4.0 International Public License unless otherwise noted" was seen only in a search snippet (**UNVERIFIED verbatim** on a page).
  - Citation format (tracker pages): "Global Coal Terminals Tracker, Global Energy Monitor, December 2024 release." / "Global Gas Infrastructure Tracker, Global Energy Monitor, [release date]."
  - ⚠ **GEM.wiki text is different**: its footer says "Creative Commons Attribution-NonCommercial-ShareAlike 4.0". NC is fine for us, but SA applies if we copy wiki text.
- **Cadence:** coal terminals twice a year, per the page ("around January and July"). GGIT's is not stated.

## 5. OpenStreetMap

- **Tags that capture these sites:**
  - Site polygons: `landuse=industrial` + `industrial=oil|refinery|port|natural_gas|depot`, with `name`, `operator`, sometimes `wikidata`, `product`.
  - Tanks: `man_made=storage_tank` + `content=oil`.
  - Piers: `man_made=pier` (+`name`).
  - Pipelines: `man_made=pipeline` + `substance=oil|fuel|gas`.
  - Nautical: `seamark:type=berth|mooring|anchor_berth|harbour`.
- **One Overpass query**, Burrard Inlet east bbox (49.27, −123.03, 49.31, −122.93), OSM base 2026-09-28T04:15Z, 78 elements:
  - Way 42245601 **"Westridge Marine Terminal"**, `industrial=oil;port`, `operator=Trans Mountain`, centroid 49.2888, −122.9520.
    - 4 unnamed `seamark:type=berth` ways nearby (1309998671/2/3, 1309998657).
    - 4 `seamark:type=mooring` nodes.
  - Way 40665919 **"Shellburn Distribution Terminal"**, `industrial=port;oil`, `operator=Shell Canada`, 49.2853, −122.9691.
  - Relation 1622441 **"Burnaby Refinery"**, `industrial=oil`, `operator=Parkland Fuel Corporation`, `wikidata=Q4999598`, 49.2911, −122.9963.
  - Way 155069590 **"ManPier"**, `man_made=pier`, 49.2914, −123.0041. It is 0.57 km from the refinery centroid. Which operator uses it is not tagged.
  - Way 41737145 "Trans Mountain Burnaby Terminal" (tank farm, `industrial=oil`). Pipelines "Trans Mountain Pipeline System" and "Westridge Lateral" (operator Pembina, `substance=fuel`). 9 unnamed oil tanks.
  - Suncor Burrard, IOCO, Cherry Point and March Point are outside this bbox and were **not checked**.
- **Licence (https://www.openstreetmap.org/copyright, quoted):** "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same license." Credit: "© OpenStreetMap contributors".
- **ODbL implications for us:**
  - Showing OSM-derived points on a map is a Produced Work. It needs attribution only.
  - A **stored facility table built from OSM** (names, positions) is a Derivative Database. If we make it public (e.g. an API or download), that table must be offered under ODbL.
  - Keep OSM-derived rows in their own table or column set so the share-alike obligation does not spread to GFW (CC BY-NC) or Climate TRACE data. Joining for display is fine.
  - Exact legal lines are for Josh to decide (see §10).
- **Caveats:** quality depends on the volunteer mappers. Berths are often unnamed. There is no commodity or throughput data.

## 6. Washington State Department of Ecology

- **Service:** https://gis.ecology.wa.gov/serverext/rest/services/SPPR/Spills_map_series/MapServer (public, no key).
- **Layer 132 "Facilities - Class 1, 3, and 4"** (points, 111 statewide):
  - Fields: `FacilityName, ClassType, EcologyProgram, FacilityType` (REFINERY / MARINE TERMINAL / TANK FARM / BULK OIL FACILITY / MARINA / …), `OilProducts` (comma list), **`DockLatNumber`, `DockLongNumber`** (the point is the **dock**).
  - 30 Class 1 facilities. The Salish ones:
    - BP Cherry Point Refinery (48.8611, −122.7575).
    - Phillips 66 Ferndale Refinery (48.8260, −122.7202).
    - Puget Sound Refinery (48.5094, −122.5769).
    - Anacortes Refinery (48.5084, −122.5694).
    - U.S. Oil & Refining (47.2666, −122.3975).
    - SeaPort Sound Terminal. Nustar Energy Tacoma. Phillips 66 Tacoma Terminal.
    - Tesoro Port Angeles Terminal (48.1362, −123.4616).
    - Shell Seattle Distribution Terminal. Maxum Pier 15. Kinder Morgan Harbor Island. SeaPort Seattle (TLP).
    - Alon Asphalt (Point Wells). Naval Base Kitsap Manchester. NAS Whidbey.
    - Olympic Pipeline Bayview. Trans Mountain Laurel Station.
  - Example `OilProducts` (Cherry Point): "CRUDE OIL,DIESEL/MARINE GAS OIL,AVIATION GASOLINE,GASOLINE,JET FUEL/KEROSENE,CAT FEED/VGO,…".
  - Class 3/4 rows include small fuel docks and marinas (e.g. Harbor Marine Fuels Squalicum, Maxum Fairhaven).
  - Operator/owner is **not** a field. Names like "Anacortes Refinery" and "Puget Sound Refinery" carry no company.
- **Layer 41 "Oil transfers - All"** (plus 42 crude, 43 refined):
  - County polygons, 21 counties, period 2012-01-01 → 2026-06-30.
  - Fields: `Crude_quantity, Refined_quantity, Total_quantity` (strings such as "38,408.31 M"; unit **UNVERIFIED**, probably million gallons).
  - Whatcom crude 38,408.31 M, refined 35,166.36 M.
  - County level only, so it gives nothing per facility or per ship.
- Also: `Bakken oil trains`, `Pipelines`, `Vessel Transit Area Standards`, spills layers.
- **Advance notice of oil transfer** (Ecology's bunkering notices): a reporting requirement page exists (https://ecology.wa.gov/Regulations-Permits/Reporting-requirements/Advance-notice-of-oil-transfer). No public per-transfer dataset was found (**UNVERIFIED** that none exists).
- **Licence** (https://ecology.wa.gov/About-us/Accountability-transparency/Our-website/Copyright-information, quoted):
  - Data use is allowed "provided the Washington State Department of Ecology is credited as the data provider and a link is provided to the Ecology data source web page."
  - Also: "Commercial and political use of any Ecology Material are specifically prohibited. This restriction includes any commercial publication of material and any use in a political campaign or lobbying effort for any person, party or ballot measure."
  - ⚠ NC is fine for us. The **political/lobbying clause** needs Josh's call for an advocacy-adjacent site.

## 7. Climate TRACE (already baked locally)

Read from `scripts/bake-climatetrace/build/features.geojsonl`, the 2026-09-22 build of release v5.10.0. `y` = 2025 total, tonnes CO₂e (100-yr, the bake's `PRIMARY`). Facts and caveats: `docs/CLIMATETRACE_FACTS.md`. Licence CC BY 4.0 (`docs/CLIMATETRACE_API.md`).

**`oil-and-gas-refining`**, all 6 in the Salish box. `q` is "very low" for every one.

| id | Name (`n`) | Owner (`o`) | Capacity (`k`) | 2025 t CO₂e | Plant point |
|---|---|---|---|---|---|
| 1753291 | BP Ferndale Refinery (= Cherry Point) | The Vanguard Group Inc | 238,500 BBL/day | 2,982,135 | 48.8846, −122.7348 |
| 1753312 | HollyFrontier Anacortes Refinery | HollyFrontier Corp | 145,000 | 1,845,798 | 48.4707, −122.5562 |
| 1753321 | Tesoro Anacortes Refinery | Blackrock Advisors LLC | 119,000 | 1,273,644 | 48.4944, −122.5625 |
| 1753325 | Phillips 66 Ferndale Refinery | Blackrock Advisors LLC | 105,000 | 1,123,803 | 48.8305, −122.6966 |
| 3143778 | Parkland Burnaby Refinery | Parkland Refining | 55,000 | 363,459 | 49.2936, −122.9870 |
| 1753359 | Par Pacific Tacoma Refinery | Par Pacific Holdings Inc | 40,700 | 274,782 | 47.2558, −122.3971 |

- **`oil-and-gas-transport`:** 843 worldwide, **none** in the Salish box. No marine oil terminals as fossil-fuel facilities.
- **Shipping "ports" that are oil or coal terminals** (voyage emissions, half to the departure port and half to the arrival port; not terminal operations):
  - "Westridge Vancouver" (1929322 domestic / 2787988 international). 0.29 km from OSM Westridge.
  - "Westshore Terminals" (1929323 / 2787989).
  - "Tesoro Refining, Anacortes" (1934807 / 2802583).
  - "Ioco", "Port Moody Bulk Terminal", "Point Wells,WA".
- ⚠ **"Owner" is a top shareholder** (Vanguard, BlackRock), not the operator. Don't show it as "operator".
- ⚠ **Plant ≠ dock.** Distances from the Ecology dock point to the Climate TRACE plant point:

  | Refinery | Distance |
  |---|---|
  | Cherry Point | 3.09 km |
  | Phillips 66 Ferndale | 1.80 km |
  | Marathon Anacortes | 1.63 km |
  | HF Sinclair Anacortes | 4.57 km |

## 8. Other sources checked

- **Vancouver Fraser Port Authority terminal map** (PDF, 2024-09-23): https://www.portvancouver.com/sites/default/files/2024-10/2024-09-23-Port-of-Vancouver-map-web.pdf
  - 29 numbered terminals, each with operator, cargo type and cargo.
  - Liquid bulk (petroleum):
    - 9 Parkland Terminal (Parkland Refining (BC))
    - 10 Shellburn Terminal (Shell Canada)
    - 11 Westridge Marine Terminal (Trans Mountain)
    - 12 Suncor Energy – Burrard Products Terminal (Port Moody)
    - 14 IOCO Terminal (Imperial Oil)
  - Other liquid bulk: 13 Pacific Coast Terminals, 15 Chemtrade, 16 Univar, 23 Vancouver Wharves (PKM).
  - Coal: 19 Neptune, 28 Westshore.
  - The map is an image with no coordinates. The web page returns 403 to scripts, and its licence is **UNVERIFIED**. Use it only as a **checklist of names**, not as data.
- **NOAA ENC Direct** (https://encdirect.noaa.gov/arcgis/rest/services/encdirect/enc_harbour/MapServer):
  - Has `Berth_point/line/area`, `Mooring_Warping_Facility_*`, `Harbour_Facility_*`, `Silo_Tank_*`, and in the berthing band `Shoreline_Construction_*`.
  - At Cherry Point: dolphins (`CATMOR=dolphin`) and tanks, with **no names** (`OBJNAM` empty or "N"/"S").
  - Useful for exact pier and dolphin geometry. Useless for identity.
  - Licence: see `docs/ANCHORAGE_AREAS_SOURCES.md` (public-domain status UNVERIFIED). Canadian CHS ENCs are not open data (UNVERIFIED here).
- **HIFLD Open** (petroleum terminals, refineries, POL terminals): discontinued 2025-08-26. Community archives exist (e.g. https://source.coop/seerai/hifld). Archive provenance and currency are **UNVERIFIED**, so not recommended.
- **GFW anchorage overrides** (`docs/PORTS_SOURCES.md` §4): named S2 cells. They could label a facility's anchorage cells. Salish oil-terminal rows were not checked.

---

## 9. Comparison

| Source | Side | Level | Names | Operator | Commodity | Fresh | Access | Licence |
|---|---|---|---|---|---|---|---|---|
| USACE Docks | WA | **dock** points | yes | free text, often stale | WCSC groups + purpose text | 2026-08 | REST, no key | "without any use restrictions" |
| WA Ecology Class 1/3/4 | WA | **dock** points | yes (no company) | no | oil products list | live service | REST, no key | credit + link; no commercial/**political** use |
| EIA refineries / terminals | US | plant / terminal points | yes | yes | capacity (refineries) | 2021/2022 | static zip only | "None (public use)" |
| NACEI (NRCan) | both | plant points | yes | yes | refinery capacity | 2016–17 | REST + SHP | OGL-Canada |
| GEM GCTT / GGIT | both | terminal points | yes | owner | coal / LNG capacity | 2024–25 | form (+ public map files) | CC BY 4.0 (wiki text CC BY-NC-SA) |
| OpenStreetMap | both | **site polygons, piers, berths** | yes | often | rarely | live | Overpass | **ODbL (share-alike)** |
| Climate TRACE | both | plant points + port points | yes | shareholder, not operator | emissions, capacity | v5.10.0 | baked locally | CC BY 4.0 |
| VFPA terminal map | BC | none (picture) | yes | yes | cargo | 2024-09 | PDF | UNVERIFIED |
| NOAA ENC | US | exact pier and dolphin geometry | no | no | no | weekday updates | REST | UNVERIFIED |

## 10. RECOMMENDED plan — **PROPOSED, awaiting Josh**

**A. A curated Salish facility list.** About 30–40 sites, hand-checked, one row per **site** with one or more **berth points**.

- **WA berth points:** USACE Docks as the stored base (no use restrictions). Ecology Class 1 dock points and `OilProducts` as a cross-check, or as the base if Josh accepts the political-use clause. Current operator names are checked by hand against both, since USACE owner text is stale.
- **BC berth points:** OSM site polygons and berths (Westridge, Shellburn, Burnaby Refinery, ManPier, Suncor Burrard, IOCO), kept as a separate ODbL slice. The VFPA terminal list is the checklist.
- **Coal / LNG:** GEM GCTT (Westshore, Neptune) and GGIT (Tilbury), CC BY 4.0.
- **Emissions:** a hand-made crosswalk from each site to Climate TRACE ids. The 6 refinery plants give facility emissions. CT shipping ports ("Westridge Vancouver", "Westshore Terminals", "Tesoro Refining, Anacortes", "Ioco") give ship-voyage emissions. Always label which one is which.
- **Skip EIA** except as the source for refinery capacity (EIA-820). It is stale, and its REST services are gone.
- Every value keeps its own source and date, per the inline-provenance rule.

**B. Joining GFW port visits to facilities.**

- **What a GFW position really is:**
  - Each visit carries three anchorage points (start, intermediate, end), each with `lat/lon` and `atDock`.
  - An anchorage is an **S2 level-14 cell (~0.5 km)** where at least 20 vessels have stopped.
  - The event `position` is the **intermediate anchorage = the first stop**. For a tanker that waits at anchor, that is the anchorage, not the berth.
  - Anchorages within 4 km share one port label (`docs/GFW_ACTIVITY_API.md`, `docs/PORTS_SOURCES.md`).
- **Proposed rule:**
  1. Use all three anchorage slots of each visit.
  2. A slot **matches** a facility if it is within **1.0 km** of one of the facility's berth points.
  3. **Berthed** = the matching slot has `atDock=true`. Otherwise show it as **"nearby / at anchor"**.
  4. **Ambiguous** if the second-nearest facility is less than 1.5× the nearest distance. Example: Anacortes, where the HF Sinclair and Marathon docks are 0.57 km apart. Then show "one of: A / B" and never guess.
  5. Other close pairs to watch: Westridge ↔ Shellburn 1.30 km, Shellburn ↔ ManPier 2.63 km, U.S. Oil ↔ SeaPort Sound 1.31 km.
- **Precision limit:** GFW visits alone cannot reliably tell adjacent berths apart. Where that matters, refine later with track positions (MarineCadastre AIS in US waters; GFW tracks).

**C. Facility card**

- Header: name, type (refinery / crude terminal / product terminal / tank farm / LNG / coal), current operator, each with its source and date.
- **Ships that stopped:** count of berthed and nearby visits, a vessel list (name, type, flag, last visit, number of visits), and a time filter. Source: GFW, CC BY-NC.
- **Commodities:** Ecology `OilProducts` / USACE purpose. **Capacity:** EIA-820 (refineries), GEM (coal/LNG).
- **Emissions:**
  - Refinery: Climate TRACE 2025 t CO₂e, with its "very low" confidence shown.
  - Shipping: the CT port point, labelled "ship voyage emissions attributed to this port".
- Sources rollup at the bottom (panel standard).

**D. Open questions for Josh**

1. **Scope:** oil and gas only, or also coal, chemicals (Chemtrade, Univar) and Class 3/4 fuel docks and marinas?
2. **Ecology licence:** accept the "no political / lobbying use" clause, or use USACE only for WA?
3. **ODbL:** OK to store a separate OSM-derived BC facility slice (share-alike if we ever publish it as data)?
4. **Distance rule:** 1.0 km match and 1.5× ambiguity, and "berthed" only when `atDock=true`. OK?
5. **Refinement:** worth refining ambiguous berths with AIS tracks later, or is "one of A/B" enough?
6. **GEM:** use the public GitHub map files, or fill in GEM's download form for the official release?
7. **Operator names:** OK to hand-maintain current operators (e.g. which company runs each Anacortes refinery), with a source link per name?

---

## Built (dev), 2026-09-27

Josh approved §10 on 2026-09-27. His decisions:
- **Scope:** everything ships service in the Salish Sea (oil and gas, refineries, fuel/bunkering, coal, chemicals, LNG, other significant industrial bulk).
- **Licences:** Ecology's licence is accepted, including its "no political use" clause. A separate, marked OSM (ODbL) slice is OK.
- **Operators:** hand-maintained, each with a source link.
- **BC source:** after the official-port-list study (docs/OFFICIAL_PORT_LISTS.md C3), BC Ports and Terminals (OGL-BC) became the primary BC source, with OSM only filling gaps.

Everything below is in the **dev** DB only. Nothing is in production. The API and UI are not built.

**Files:**
- `lib/ships/data/salish-terminals.json`: the reviewed list.
- `lib/ships/data/salish-terminals-osm.json`: the ODbL slice (OSM-derived berth positions only).
- `lib/ships/migrations/012_terminals.sql`
- `lib/ships/terminals.js`
- `scripts/ships/import-terminals.mjs` (`npm run ships:import-terminals`)
- Tests: `lib/ships/test/terminals*.test.js`

**What's in the list:**

| | Count |
|---|---|
| Terminals | 57 (26 WA, 31 BC) |
| Berth points | 64 |
| — from USACE Docks | 23 |
| — from WA Ecology (docks with no USACE point within 0.15 km) | 7 |
| — from BC Ports and Terminals | 25 |
| — from OSM (ODbL; only where no official row exists) | 9 |

- **Terminals by kind:**
  - refinery docks: BP Cherry Point, Phillips 66 Ferndale, Marathon Anacortes, HF Sinclair Puget Sound, U.S. Oil Tacoma, Parkland Burnaby
  - crude: Westridge
  - product terminals: SeaPort Sound, NuStar Tacoma, Phillips 66 Tacoma, Kinder Morgan Harbor Island, Shell Seattle, SeaPort Seattle, Point Wells, Shellburn, Suncor Burrard, IOCO, VAFFC Fraser River
  - bunkering / fuel: Port Angeles, Pier 15, Maxum Fairhaven, Covich-Williams
  - military fuel piers: Manchester, NAS Whidbey
  - LNG: Puget LNG Tacoma, Tilbury, Woodfibre (under construction)
  - coal: Westshore, Neptune
  - chemical: Chemtrade North Vancouver
  - grain: T86, TEMCO, G3, Cargill, Richardson, Pacific, Alliance, Cascadia, Fraser Grain
  - cement: Seattle (Amrize), Ash Grove, Delta, Richmond
  - other bulk: Intalco / Petrogas LPG wharf, Port of Anacortes petcoke, Radius Tacoma scrap, Pacific Coast Terminals, Vancouver Wharves, Lantic, Squamish Terminals, Texada, Sechelt
  - forest products: Fibreco, Harmac, Crofton (closed Dec 2025), Port Mellon (idled Aug 2026), Duke Point
- **Every row has:**
  - a stable id
  - the current operator, with a source URL and the date checked
  - status (operating / idle / closed / construction / unknown)
  - commodities, with the record they came from
  - berth points with their source record
  - links to the raw USACE / Ecology / BC / OSM / GEM rows
  - Climate TRACE ids, kept apart as `refinery_facility_ids` (6 plants) and `ship_port_ids` (20 port sources)
- **Evidence:** 174 raw source records (USACE 27, Ecology 18, BC 25, OSM 37, GEM 4, Climate TRACE refineries 6, curated entries 57), plus 138 links.
  - Re-import is idempotent: a live re-run stored 0 new records.

**Matching (read time, never stored):**
- Every GFW stop (start, intermediate and end anchorage) is compared with every terminal's berths.
- The stop matches when the nearest terminal is within **1.0 km**.
- It is **berthed** only when GFW marks that anchorage `atDock`. Otherwise it is **nearby / at anchor**.
- It is **"one of A/B"** when the next terminal lies within **1.5×** the nearest distance.
- Read functions in `lib/ships/terminals.js`:
  - `terminalVisits(q, S, key, { from: 'YYYY-MM', to: 'YYYY-MM' })` returns the visits (vessel, dates, relation, berthed/nearby, per-stop evidence).
  - `listTerminals(q, S)` returns the list with berths and links.
  - `terminalGfwLabels(q, S, key)` returns the GFW port labels seen near a terminal, for a future fetcher.

**Dev results for 2026-01..06 (stored visits only; no GFW calls were made):**

| Terminal | Visits | Ships | Berthed | Nearby | Ambiguous | GFW vessel types |
|---|---|---|---|---|---|---|
| BP Cherry Point | 62 | 29 | 62 | 0 | 0 | all "other" (tankers such as TORM DAVAO, DUBLIN SEA, DION) |
| Westridge | 17 | 16 | 12 | 5 | 0 | other 8, NA 3, fishing 2, passenger 2, gear 2 |
| Westshore | 17 | 10 | 17 | 0 | 0 | passenger 13, other 2, cargo 1, NA 1; every one matches only on its **end** anchorage, 0.95 km away |

**Known gaps and caveats (facts from the dev run):**
1. **Big shared GFW ports hide the berth.** A GFW visit has only three anchorages: entry, first stop and exit.
   - At Westridge the dev DB holds all `can-vancouver` events for Jan–Jun 2026, yet only 17 visits have a stop within 1 km. Only one of them is a tanker-type ship.
   - A tanker that anchors in English Bay first and then moves to the berth may never show the berth in any slot.
   - Refining that needs track positions (MarineCadastre AIS for US waters; GFW tracks). This is open question 5 in §10.
2. **Coverage = what is stored.** Visits reach the dev DB only through ship cards and port cards. `can-robertsbank`, for example, was never fetched: Westshore's coal ships are missing, and what does match there is ferries and small craft. A terminal card needs its own GFW fetch. `terminalGfwLabels` lists the labels a fetcher would use.
3. **Proximity is not service.** Some terminals sit next to a ferry terminal, marina or town harbour, and those stops match too. Examples: Point Wells 887 visits (mostly passenger/other small craft), Crofton 2,806 (the Vesuvius ferry), Squamish 2,666, Maxum Fairhaven 1,786 (Bellingham Cruise Terminal), Port Angeles 329. Two ways to handle it; both change the approved rule, so they are for Josh:
   - add ferry terminals and marinas as competing points;
   - filter by GFW vessel type.
4. **"Berthed" depends on GFW's `atDock`.** It is an anchorage-level flag, not a per-ship observation.
5. **Close pairs** (nearest berths): Shell Seattle ↔ Pier 15 0.13 km, Alliance ↔ Lantic 0.16, NuStar ↔ Phillips 66 Tacoma 0.28, Neptune ↔ Cargill 0.36, Tilbury LNG ↔ Delta cement 0.47, the two Anacortes refineries 0.59, Neptune ↔ G3 0.60. Stops there are often "one of".
6. **Not listed yet:**
   - Ballard Oil, Tacoma Fuel Dock, Class 4 marinas
   - pulp/paper docks in WA (Port Townsend, Port Angeles)
   - Victoria/Esquimalt fuel (no terminal row found)
   - Univar North Vancouver (VFPA #16; no BC or OSM row found)
   - container and cruise terminals (out of scope)
7. **Source caveats:**
   - The GEM LNG tracker (GGIT) was not pulled: its only public file is a 7.8 MB global GeoJSON. Tilbury and Woodfibre come from OSM, with no GEM id.
   - USACE, Ecology and BC names/owners are often stale. They appear as source names only; operators come from the hand-checked list.
   - Weak operator sources: Shell Seattle (newest source is Aug 2021, so status "unknown"), NAS Whidbey (no source names who runs the pier), G3 (Wikipedia), Westshore (GEM.wiki).
   - Lower-precision positions: Richmond cement is an OSM site-bbox centre. Woodfibre's OSM piers may be the old pulp-mill wharves.
8. **CHS single-ship anchorage berths** (docs/OFFICIAL_PORT_LISTS.md C4) are not used. GFW's `atDock` already separates berth from anchor for this rule. They could name the anchorage a waiting ship is at, in a later step.

---

## Terminal card (dev), 2026-09-28

Josh approved UI "A + C" and decisions 1–6 on 2026-09-28. Everything below is on localhost and the **dev** DB only.

**What's on the map:** terminal pins inside the existing "Ports & terminals" row (no new row). Each pin is a round badge with a drawn glyph for its kind family (`src/ships/terminalIcons.js`). Closed, idle and under-construction sites are drawn faded. Clicking a pin opens a small popup in the shared frame, placed with `keepPopupOnMap`. It shows the name, kind, operator (linked), and the visit count for the picked months, plus an "Open card" button. The card is `src/ships/TerminalCard.jsx`:
- header: kind, name, operator with source, status with date and source, IMO port facility, commodities (out-of-date ones struck through)
- headline strip: visits, ships, and refinery CO₂e (or ship CO₂e when there is no refinery plant)
- tabs: Ships / Emissions / About

URL params: `tl` = terminal key, `tf=1` = folded, `tb` = tab (`emissions` | `about`).

**Rules (lib/ships/terminalCard.js):**
- **Decision 1:** a visit counts only if the ship's kind fits the terminal (`SHIP_FIT`). The kind is EarthAtlas's classification; if there is none, GFW's AIS type is used.
  - Tugs count at oil and fuel docks (Josh: a barge has no AIS). They are labelled "(likely moving a barge)".
  - Tugs also count at aggregate, cement and forest-product docks.
  - Fuel docks also count the small working craft that refuel there.
  - Pure chemical tankers count at refinery docks and crude / fuel-product terminals (Josh 2026-09-29, B3; product tankers are often filed as chemical tankers). This is the same rule for AIS visits and Climate TRACE port stays: one `SHIP_FIT`, read at card time, so no rebake. Dev tc3, Jul 2025 – Jun 2026: +7 visits in all (BP Cherry Point 1,120 → 1,122; HF Sinclair Puget Sound 1,034 → 1,039); other oil docks unchanged.
  - Cargo ships whose exact kind isn't stated are shown as "could be" at coal, grain and bulk docks. They are listed but not counted, because at Roberts Bank they can be Deltaport container ships.
  - Anything else is listed, folded, under "Other vessels nearby" or "Kind not known".
- **Decision 2:** a card open fetches the GFW port labels around the terminal (one discovery call about every 30 days, then events per label and month). It uses the port-card fetch steps and the same `port_card_fetches` log (migration 015 adds `terminal_id`), so the daily budget and the "settled months are kept" rule are shared.
- **Decisions 4–6:** GEM GGIT credits Tilbury and Woodfibre (Puget LNG is not in GGIT). Crofton, Port Mellon and Point Wells keep their status with a date and source. Intalco is now `lpg_terminal`, with "alumina" kept as out-of-date history.
- **New terminals from IMO GISIS** (berth = the GISIS point): Univar North Vancouver (CAVAC-0001) and Shell Bare Point, Chemainus (CACHM-0002).
- **Crosswalk links, with evidence recorded in gisis-terminal-crosswalk.json:** CAVAN-0083 → VAFFC, CAVAC-0010 → Vancouver Wharves, CANNO-0001 → Duke Point. CADEL-0003 Seaspan Tilbury stays unlinked: it is a separate berth.

**Dev numbers (Jul 2025 – Jun 2026, before tugs were counted):**

| Terminal | Counted visits (ships) | Could be | Other | Kind unknown |
|---|---|---|---|---|
| BP Cherry Point | 31 (16) | 0 | 103 | 2 |
| Westshore | 60 (53) | 196 | 4,766 | 231 |
| Westridge | 1 (1) | 0 | 10 | 18 |
| Point Wells | 8 (1) | 0 | 1,606 | 26 |

With tugs counted, Cherry Point is 124 visits by 43 ships, 93 of them by tugs.

### Visits from our own AIS (dev), 2026-09-28

Josh approved it on 2026-09-28: the card counts **calls computed from our own MarineCadastre AIS positions**, not GFW port visits. GFW logs a visit against a whole port area, so GFW-based terminal counts came out near zero. GFW visits are still shown in the card's About text as a comparison, but they are no longer counted. The card no longer triggers GFW fetches; `op=terminal&fetch=1` still can.

- **Rule** (`lib/ships/terminalCalls.js`, `CALL_RULE`, bake `tc1`): a call is a ship with SOG < 0.5 kn within the berth radius. The radius is 150 m by default. If an official record gives the berth length (BC Ports & Terminals description, or USACE `BERTHING_LARGEST`), the radius is length/2 + 50 m, capped at 300 m. If two terminals' radii overlap, the nearest berth wins and the other terminal is recorded in `also_near`. A gap of more than 6 h starts a new call, and calls shorter than 15 min are dropped.
- **Pipeline:**
  1. `node --env-file=.env.local scripts/ships/terminal-calls.mjs berths` exports the berths and radii.
  2. `scripts/ships/bake-ais/terminal_calls.py` finds the stopped positions near a berth, reading the salish-v6 cache one day at a time with DuckDB capped at 2 GB and 4 threads. Run it with `--export` to write the hits.
  3. `terminal-calls.mjs import` splits the hits into calls and loads them into `terminal_calls` / `terminal_call_bakes` (migration 016). It also writes a single bake `source_records` row (source `earthatlas-terminal-calls`, CC0 input, evidence class `inferred`).
- **Not covered** (north of 49.6° N, reported as "not covered", never 0): Squamish Terminals, Texada Quarry, Woodfibre LNG.
- **Full pass:** 365 days, 7.82 M stopped positions, 31,477 calls from 2,011 MMSIs at 51 terminals. It took about 30 min on the laptop and made no network calls.

Jul 2025 – Jun 2026 (calls / ships; "fits" includes tugs at oil docks, labelled "likely moving a barge"):

| Terminal | Fits | of which non-tug | Could be | Other | Kind unknown | GFW visits (comparison, all kinds) |
|---|---|---|---|---|---|---|
| Shellburn | 548 / 56 | 7 / 6 tankers | 0 | 8 / 5 | 5 / 1 | 75 / 49 |
| Westridge | 706 / 101 | 77 / 46 tankers | 0 | 7 / 6 | 3 / 1 | 29 / 20 |
| BP Cherry Point | 462 / 49 | 82 / 25 tankers | 0 | 5 / 2 | 1 / 1 | 136 / 54 |
| Westshore | 46 / 42 bulk carriers | — | 118 / 102 | 575 / 27 (mostly tugs) | 0 | 5,253 / 433 |
| Point Wells | 14 / 1 (tug MIKE QUIGG) | 0 | 0 | 4 / 2 | 0 | 1,640 / 428 |
| Intalco wharf | 59 / 22 (LPG carriers) | — | 0 | 194 / 13 (tugs) | 0 | 0 |
