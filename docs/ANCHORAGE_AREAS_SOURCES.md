# Anchorage areas: source catalogue (reference for /ships)

Studied 2026-09-27 (source study only: no code, no imports, no database writes). Everything below was read
from a primary page or a live response on 2026-09-27 unless marked otherwise.
**UNVERIFIED** marks anything not confirmed that way.

Question: was a ship's stop (the `position` of a GFW port-visit event) inside an officially designated
anchorage, and what is that anchorage called?

| Source | What it is | Rows | Access | Licence |
|---|---|---|---|---|
| 33 CFR Part 110 (eCFR) | The legal text. Boundaries are written as coordinates, bearings and radii. | Subpart A: 99 sections. Subpart B: 67 sections. | eCFR API (XML), no auth | US Government work |
| NOAA OCM / USCG "Anchorages" (MarineCadastre) | Part 110 digitised as polygons, one row per paragraph, with name, type and CFR citation | 679 | GeoPackage zip (1.97 MB) and an ArcGIS FeatureServer, no auth | US Government work (17 U.S.C. 403 notice) |
| NOAA ENC (S-57) `ACHARE` / `ACHBRT` | Charted anchorage areas and berths, with `OBJNAM` and `INFORM` ("33 CFR 110.230") | per cell | ENC Direct REST, no auth; ENC zips free (All_ENCs.zip is 837 MB, WA_ENCs.zip 49 MB) | Free download. No licence statement on the ENC page. Public domain status **UNVERIFIED**. |
| USCG VTS Puget Sound User's Manual (2024) | VTS list of all Puget Sound anchorages, **including "non-designated" ones** such as Vendovi | 27 names, no coordinates | PDF | US Government work |
| 82 FR 10313 (2017 NPRM, **withdrawn 2018**) | The only published coordinates for the Vendovi, Port Angeles, Budd Inlet and other VTS-only anchorages | 17 proposed areas | Federal Register API | US Government work. Not law. |
| DFO/CHS "Canadian Anchorages and Anchorage Areas" | `ACHARE`/`ACHBRT` pulled weekly from CHS ENCs | 154 areas, 1,610 area points, 290 berth points, 19 berth areas | SHP zip (1.8 MB) and ArcGIS MapServer | OGL-Canada 2.0 |
| DFO "Active Commercial Shipping Anchorages in Pacific Canada" | Named BC commercial anchorage points with swing radius, LOA and depth | 117 | FGDB zip and ArcGIS MapServer | OGL-Canada 2.0 |
| OpenStreetMap `seamark:type=anchorage` | Crowd-sourced | 3 features, all unnamed, in the north Puget Sound box | Overpass | ODbL |

---

## 1. United States

### 1.1 33 CFR Part 110: the legal source

- eCFR API: `GET https://www.ecfr.gov/api/versioner/v1/full/{date}/title-33.xml?part=110&section=110.230`
  - Without `Accept-Encoding` the API returns **406** with "This endpoint requires response compression". Use `curl --compressed`.
  - Title 33 was "up to date as of 2026-09-24", latest amendment 2026-09-17 (`/api/versioner/v1/titles.json`).
- Structure, from `/api/versioner/v1/structure/2026-09-24/title-33.json`:
  - General sections 110.1, 110.1a and 110.3.
  - **Subpart A, Special Anchorage Areas:** 99 sections.
  - **Subpart B, Anchorage Grounds:** 67 sections.
  - The regional sections in Subpart B include:
    - Gulf: 110.194a, 110.194b, 110.195 (Mississippi River below Baton Rouge) and 110.197 (Galveston).
    - Pacific Northwest: 110.228 (Columbia River) and **110.230 (Puget Sound)**.
    - Alaska: **only** 110.231 (Ketchikan, large passenger vessel anchorage) and 110.233 (Prince William Sound).
    - Hawaii: 110.235–110.237. Guam: 110.238.
- **§110.230, "Anchorages, Captain of the Port Puget Sound Zone, WA"** (read 2026-09-27; datum NAD83). The 21 anchorage paragraphs are:
  - (1) Freshwater Bay Emergency.
  - (2) Bellingham Bay: (i) General, a circle of r = 2,000 yd; (ii) Explosives, r = 1,000 yd.
  - (3) Port Townsend: fair-weather and foul-weather explosives areas, r = 300 yd each.
  - (4) Holmes Harbor General. (5) Port Gardner General. (6) Thorndike Bay Emergency Explosives.
  - (7) Elliott Bay: (i) Smith Cove West, (ii) Smith Cove East, (iii) Elliott Bay East, (iv) Elliott Bay West.
  - (8) Yukon Harbor General.
  - (9) **Cherry Point General Anchorage**: a circle of r = **1,600 yd**, centred at **48°48′29.39″ N, 122°46′04.66″ W**.
  - (10) Anacortes East, Center and West: circles of r = 600 yd.
  - (11) Cap Sante Tug and Barge. (12) Hat Island Tug and Barge. (13) Commencement Bay General.
  - (14) Port Angeles Harbor **non-anchorage** area.
  - There is **no Vendovi anchorage** and no anchorage called "Anchorage B" in Elliott Bay. The Elliott Bay areas are named Smith Cove West/East and Elliott Bay East/West.
- Amendment history of §110.230 in eCFR versions: 2016-12-27 (the start of eCFR tracking) and 2019-01-28. What changed in 2019 is **UNVERIFIED**; no Federal Register document matching Puget Sound anchorages appeared after 2018.
  - The boundaries now in force come from the rule of 2013-02-12 (FR doc 2013-03121, docket USCG-2012-0159). It shrank five general anchorages and redescribed four.
- Part 110 amendments **after 2022-11-17**, the CFR snapshot MarineCadastre compiled from:
  - 110.228 (Columbia River): 2024-12-04, 2024-12-16, 2025-01-03, 2025-01-15, 2026-06-17, 2026-07-17.
  - 110.155 (NY): 2026-05-18, 2026-07-01, 2026-07-09.
  - 110.214: 2025-09-09 and 2025-10-09.
  - 110.194b (2025-03-17), plus 110.168, 110.195 and 110.220 (2025-10-02).
  - Many Subpart A sections on 2023-03-16 and 2023-04-17.
  - So the MarineCadastre layer is **stale for some regions**, but **not for Puget Sound**.

### 1.2 NOAA OCM / USCG "Anchorages" (MarineCadastre): the ready-made polygons

- InPort item 48849, `https://www.fisheries.noaa.gov/inport/item/48849`, title "Anchorages", short name `AnchorageAreas`.
  - Publication date 2023-10-25. Maintenance frequency "None Planned".
  - Credit: "NOAA Office for Coastal Management, U.S. Coast Guard". Bounding box −161…146 E, 16…61 N.
- **Downloads (verified):**
  - `https://marinecadastre.gov/downloads/data/mc/Anchorage.zip`: 200, 1,971,766 bytes, Last-Modified 2023-10-26. It contains **`Anchorage.gpkg`** (a GeoPackage, not a shapefile).
    - Layer `Anchorage`, MultiPolygon, NAD83 (EPSG:4269), **679 features**.
  - FeatureServer: `https://coast.noaa.gov/arcgis/rest/services/Hosted/Anchorages/FeatureServer/0`.
    - `returnCountOnly` gives 679. maxRecordCount 2000. `lastEditDate` 2023-10-27.
    - Point queries work. Our control point at the Cherry Point centre returned `Cherry Point / general / 110.230(a)(9)`.
  - Hub item `f5bf15c0ca354ff69f52faf62dc92aab` (owner `marinecadastre_noaa`, accessInformation "U.S. Coast Guard"). The item was modified 2025-12-23; what changed is **UNVERIFIED**, since the data edit date is still 2023.
- **Fields (live):** `anchorageType`, `anchorageName`, `codeFederalRegulations`, `effectiveDate`, `location` (the InPort entity list names them `type, name, CFR, RNC, date, location`; the GeoPackage has **no RNC field**).
  - `anchorageType` counts: special 254, unrestricted 212, general 49, explosives 39, fairway 28, naval 24, commercial 20, temporary 19, restricted 13, small craft 6, quarantine 4, emergency 4, null 4, dead ship 1, safety zone 1, security zone 1.
  - `codeFederalRegulations` by Part: 110 → 645, 166 → 28 (fairway anchorages), 150 → 1, 165 → 1, null → 4.
    - The 4 null-CFR rows come from ENC (Duck Island NY, Hudson, Stuyvesant, "Course 4" Lake Nicolet MI).
    - Lineage: from ENC "only (4) features from the Harbour_Anchorage_Area retained".
  - Every row has a name. The names are short, e.g. `Cherry Point`, `Smith Cove West`, `Holmes Harbor ` (with a trailing space).
- **Coverage:**
  - **Puget Sound: 21 rows = all 21 paragraphs of §110.230(a)**, including the Port Angeles non-anchorage row, typed `restricted`.
  - Columbia River: 11 rows, labelled "…, OR", based on the 2012 CFR text, which has been amended since.
  - **Alaska: 2 rows**, Ketchikan Harbor and Prince William Sound. This matches the only two Alaska sections in Part 110.
  - **Gulf: present**, e.g. Mississippi River Baton Rouge 37, Galveston 4 + 2, Sabine Pass 4 + 1, and Mobile, Corpus Christi, LOOP.
  - Hawaii, Guam, PR/USVI and the Great Lakes are also present.
- **Caveats:**
  - `effectiveDate` is **1967-12-12 on every WA row**, including the Anacortes and tug-and-barge areas that are recent. Do not use it as the date of the boundary.
  - The Cherry Point polygon is an 86-vertex circle. Its centroid is within 0 m of the CFR centre and its mean radius is 1,461 m, against the CFR 1,463 m.
  - The metadata says "Compiled to meet 10 meters horizontal accuracy at 95% confidence level". Data quality accuracy is "Untested".
- **Licence:** the Hub `licenseInfo` quotes 17 U.S.C. 403 and says government web information is "in the public domain and not subject to copyright protection within the United States".
  - The InPort use constraint is "For coastal and ocean planning". Access constraints: "None". Disclaimer: https://www.marinecadastre.gov/about/disclaimer.html (not read).

### 1.3 NOAA ENC (S-57): `ACHARE` / `ACHBRT`

- **ENC Direct REST** (`https://encdirect.noaa.gov/arcgis/rest/services/encdirect/`) has one MapServer per usage band: overview, general, coastal, approach, harbour, berthing.
  - Layers found:
    - `Coastal.Anchorage_Area` (id 132), `Harbor.Anchorage_Area` (186), `Approach.Anchorage_Area` (191).
    - `*.Anchor_Berth_area` / `_point` (`ACHBRT`, which carries `RADIUS`).
    - `*.Anchorage_Area_point`.
  - Fields: `OBJL, CATACH, OBJNAM, INFORM, SCAMIN, SORDAT, SORIND, DSNM` (+ `RADIUS` on berths).
  - `CATACH` comes back as text. Note the typo **"unristricted anchorage"** in the service.
- **Salish box (47.0–49.1 N, 123.8–122.0 W), live:**
  - Coastal: 10 polygons, all named.
  - Harbour: 41 polygons. Most are named; 3 explosives areas have null `OBJNAM`. The same anchorage repeats once per cell (`DSNM`).
  - Approach: 0. Harbour points: 15 unnamed small-craft anchorage symbols (San Juan Islands).
  - `INFORM` = "33 CFR 110.230…". `SORIND` cites "L-345/13" (Local Notice to Mariners, 2013) or chart 18421/18427.
  - Names are the full CFR names, e.g. "Cherry Point General Anchorage", "Anacortes West (ANW) Anchorage".
  - One mismatch: **"Orchard Point General Anchorage, Puget Sound"** is charted where the CFR says **Yukon Harbor General Anchorage** (47.54–47.56 N, 122.52 W). The 2013 rule text does not mention "Orchard". Why the chart differs is **UNVERIFIED**.
  - **No ENC feature named Vendovi**, in any anchorage layer.
- **Bulk:** `https://charts.noaa.gov/ENCs/All_ENCs.zip` (837,088,917 bytes) and per-state zips such as `WA_ENCs.zip` (49,264,707 bytes), both Last-Modified 2026-09-26. Single cells are available too: `US5WA1KO.zip` is 60 KB.
  - GDAL reads the `.000` cells directly. `US5WA1KO` `ACHARE` gave `OBJNAM=Cherry Point General Anchorage`, `CATACH=(1:1)`, `INFORM=33 CFR 110.230`, `SORDAT=20130212`.
  - The NOAA ENC page says: "NOAA ENCs downloaded directly from these Coast Survey websites are free", and "New ENC update cells are uploaded every weekday evening".
  - That page carries **no explicit licence or redistribution statement**. Public domain as a US Government work is likely but **UNVERIFIED** for ENCs specifically.

### 1.4 Puget Sound anchorages VTS uses that are not in the CFR (Vendovi etc.)

- **USCG VTS Puget Sound User's Manual 2024** (`https://www.navcen.uscg.gov/sites/default/files/pdf/VTS%20User%20Guides/VTS_PS_UsersManual_(2024).pdf`, PDF created 2025-02-07), p. 3-6 "PUGET SOUND ANCHORAGES – Quick Reference Sheet":
  - It says: "All Puget Sound anchorage areas are managed on behalf of the Captain of the Port by the Puget Sound Vessel Traffic Service."
  - GENERAL: EBE, EBW, SCE, SCW, YH, COM, PG, HH, BB, **CP (Cherry Point, 1 vessel, 15 days)**, ANW, ANC, ANE.
  - SPECIAL: PTX1, PTX2, BBX, TBX, FBX.
  - **NON-DESIGNATED ANCHORAGES:** Port Angeles Harbor (PA), Port Townsend Harbor (PT), **Vendovi Island East (VIE, 4 vessels, 10 days)**, **Vendovi Island South (VIS, 1 vessel, 10 days)**, Quartermaster Harbor, Ruston, Budd Inlet, Budd Inlet North, William Point (ATBs only).
  - p. 3-5 names Vendovi as a "high usage area".
  - **The manual gives no coordinates.**
- **82 FR 10313, NPRM of 2017-02-10** (FR doc 2017-02683, docket USCG-2016-0916):
  - It proposed designating these anchorages, which "have been used for many years informally, however, they are not included on nautical charts, referenced in the Coast Pilot, or subject to anchorage regulations".
  - Proposed §110.230(a)(15) "Vendovi Anchorages":
    - (i) **Vendovi South General Anchorage**: "shoreward of a line" 48°36′40″ N 122°36′51″ W → 48°35′34″ N 122°36′51″ W → 48°35′34″ N 122°35′53.62″ W → 48°36′31.38″ N 122°35′53.62″ W. This is an open line closed by the shore, not a closed polygon.
    - (ii) **Vendovi East General Anchorage**: the box 48°35′43″–48°37′43″ N × 122°31′44″–122°34′45.5″ W.
    - (iii)/(iv) Jack Island North and South Tug and Barge Holding Areas: circles of r = 600 yd at 48°35′22″ N 122°37′20″ W and 48°34′24″ N 122°36′13.5″ W.
    - (v) William Point ATB Anchorage: a polygon.
  - The NPRM also proposed Port Townsend General, Ruston, Port Angeles General plus 3 tug/barge holding areas, Quartermaster Harbor, Budd Inlet and Budd Inlet North.
  - 2017-11-17: notice of intent to withdraw (FR doc 2017-24942).
  - **2018-04-27: "Notice of proposed rulemaking; withdrawal"** (FR doc 2018-08871), "in response to public comments and to better analyze potential impacts to tribal treaty rights, especially treaty fishing rights".
  - No later Federal Register document mentions Vendovi (FR API search on "Vendovi": 7 hits, the newest being the 2017 NPRM).
- Puget Sound Harbor Safety Plan, Section C, Anchoring (`https://pshsc.org/s/zHSP-Sec-C-Anchoring.pdf`): the fetch returned nothing (HTTP 000). **Not read.**

## 2. Canada (BC / Salish waters)

- **DFO/CHS "Canadian Anchorages and Anchorage Areas"**
  - open.canada.ca id `622a7f72-4a00-4f9e-b04f-af6551c77db3`. Licence **OGL-Canada 2.0**. Frequency P1W ("automatically updated on a weekly basis to reflect the latest available CHS ENC data"). Metadata modified 2026-08-11.
  - SHP: `https://egisp.dfo-mpo.gc.ca/open_data_donnees_ouvertes/Anchorages/S57_MaritimeChart_Anchorages.zip`. Size 1,831,882 bytes, Last-Modified 2026-09-26, WGS84.
  - REST: `…/arcgis/rest/services/open_data_donnees_ouvertes/canadian_anchorages_and_anchorage_areas/MapServer`, layers 0–3.
  - Data dictionary: an XLSX dated August 2026.
  - Files: `ACHARE_A` (154 polygons), `ACHARE_P` (1,610 points), `ACHBRT_P` (290 points), `ACHBRT_A` (19 polygons, all in Quebec/Maritimes).
  - Fields are **only** `NOBJNM, OBJNAM, INFORM, NINFOM, FIDN, ENC_NAME`. There is **no `CATACH` and no `RADIUS`**.
  - Pacific (lon < −120):
    - `ACHARE_A`: 7 polygons. 2 are in the Beaufort Sea, 1 unnamed "Reported anchorage" near Port Moody, and 4 are Port Alberni berths `1/2/3/E`.
    - `ACHARE_P`: 531 points, almost all unnamed "Reported anchorage".
    - `ACHBRT_P`: 156 points, **named only by berth letter or number** ("1", "B", "Z"; 115 in the Salish box). Examples: English Bay 1–18, Vancouver Harbour A–E, Plumper Sound A–D/X, Cowichan Bay A–D, Roberts Bank R.
  - This layer cannot name an anchorage on its own ("English Bay", "Plumper Sound" are not in the rows).
- **DFO "Active Commercial Shipping Anchorages in Pacific Canada"**
  - id `2ccbf2d7-0b1c-4ee5-8d8f-43acc16ef1e1`. **OGL-Canada 2.0**. Frequency "as needed". Published 2023-03-24; metadata modified 2026-03-24. Coverage period 2023-01-01 to 2023-03-31.
  - REST: `…/open_data_donnees_ouvertes/active_commercial_shipping_anchorages_in_pacific_canada/MapServer/0`. Also available as FGDB `Pacific_Canada_Anchorages.gdb.zip`.
  - **117 points.** Fields: `Anchorage_name, Alternate_Anchorage_Name, Source, Latitude, Longitude, Depth__m_, LOA__m_, Swing_Radius__m_, Port_Authority, Notes`.
    - Examples: "English Bay Anchorage U" (alt "English Bay Anchorage Uniform"), "Plumper Sound Anchorage A", "Sandheads S", "Constance Bank", "Royal Roads Anchorage A–F" (DND).
    - By port authority: Vancouver 68, Prince Rupert 30, Nanaimo 6, DND 6, none 6, Rio Tinto 1.
    - Swing radii run 185–750 m; some are "unknown". Many values are 463.3 m, which is 0.25 nmi.
  - The Southern Gulf Islands entries total **33**: Captain's Pass 2, Cowichan Bay 6, Houston Pass 3, Kulleet Bay 2, Ladysmith 6, Plumper Sound 5, Trincomali 9. That matches the "33 anchorage sites" reported for Transport Canada's Interim Protocol. The 33 figure comes from search-result text; the TC overview page we fetched did not state a count.
  - Method: compiled by hand from the port information guides of Vancouver and Prince Rupert, from Pacific Pilotage Authority (PPA) anchorage lists, Marine Traffic and the MEIT tool. Active use was confirmed with PPA usage data.
    - The metadata says "the new sites" of 2015/16 in Ladysmith, Plumper Sound and Cowichan Bay are included, and "Some marine charts and data sources have not been updated to reflect these changes".
    - "Not suitable for navigation." Contact: Fiona Francis (DFO Pacific).
- **Legal status in Canada:** the Transport Canada overview (`tc.canada.ca/…/overview-anchorages-southern-british-columbia`, modified 2026-09-23) says the port authority manages southern BC anchorages on a "temporary and voluntary basis" under the Interim Protocol of 2018-02-08.
  - We found no Canadian equivalent of 33 CFR 110 that publishes boundaries in regulation (**UNVERIFIED** that none exists).
  - Anchorages inside the port are set out in the Port of Vancouver Port Information Guide. Its terms of use are **UNVERIFIED** and not open-licensed as far as we saw.
- **Other Canadian open layers (not designated anchorages):**
  - BC "Coastal BC Anchorages" (`13e40dcd…`, OGL-BC): points "circa 2004 and legacy", with "no plans to update". These are small-craft safe anchorages.
  - NRCan "British Columbia Coastal Anchor Marks" (`176f846c…`, OGL-Canada): seabed anchor-scour polygons from multibeam surveys 1997–2021. Useful as evidence of where ships actually anchor.
- **CHS ENCs themselves are not open.** We did not verify how they are distributed or licensed in this study (**UNVERIFIED**). The DFO extract above is the open route to CHS `ACHARE`/`ACHBRT`.

## 3. Global

- **OpenStreetMap / OpenSeaMap** (`seamark:type=anchorage`).
  - Overpass (base 2026-09-27T06:12Z) returns: "The data is made available under ODbL."
  - The box 48.3–49.0 N, 123.3–122.4 W has **3 features, all unnamed, with no category**, near Sucia Island. There is nothing at Cherry Point, Vendovi, Anacortes or Bellingham Bay.
  - A larger Salish query timed out (504) twice.
  - ODbL: a database we build that mixes OSM rows would be a derivative database under share-alike. Public maps built from it would need OSM attribution.
  - Coverage elsewhere was not measured (**UNVERIFIED**).
- **IHO / other hydrographic offices:** S-57 ENCs are the global source of `ACHARE`/`ACHBRT`. Outside NOAA (free) and the DFO extract (OGL), open bulk access was not found (**UNVERIFIED** country by country; not surveyed).
- **NGA World Port Index:** has anchorage attributes per port, such as depth and holding ground (see `docs/PORTS_SOURCES.md`), but **no anchorage polygons**.
- **GFW anchorages** (see `docs/PORTS_SOURCES.md` §4): these are *inferred* S2 cells where ships stop (CC BY-NC). They are not designated anchorages.
- **EMODnet Human Activities:** a search did not surface an anchorage-areas layer. **UNVERIFIED** (catalogue not browsed).
- **What does not exist, as far as this study found:** an open, worldwide, official dataset of designated anchorage areas. Official polygons are national: US CFR/ENC and Canada's CHS extract. OSM is the only worldwide open layer, and it is sparse here and unofficial.

## 4. The two stops checked

**(a) 48.8024, −122.7216 (Cherry Point / Ferndale)**
- The stop is **not inside any designated anchorage**:
  - MarineCadastre GeoPackage (point-in-polygon) and FeatureServer point query: 0 hits.
  - ENC coastal and harbour `Anchorage_Area`: 0 containing features.
- The nearest anchorage is the **Cherry Point General Anchorage, 33 CFR 110.230(a)(9)**:
  - From the CFR circle, the stop is 3,455 m from the centre (haversine), with r = 1,463 m. That puts it **about 1.99 km outside the edge**.
  - The distance to the MarineCadastre polygon agrees (1,976–1,988 m via ENC).
- The stop *is* inside:
  - the ENC Regulated Navigation Area, "33 CFR 165.1301 & 165.1303", which is not an anchorage;
  - ENC named water areas "Salish Sea" and "Strait of Georgia" (harbour band).
- The nearest charted features are:
  - an unnamed pier (`CATSLC=pier`) about 1.1 km away;
  - Lummi Bay about 1.1 km away;
  - Sandy Point about 1.4 km away.
  - These distances are rough (degree-scaled).
  - Which terminal's pier this is is **UNVERIFIED**; ENC does not name it.
- GFW places a port-visit `position` at the intermediate anchorage, an S2 level-14 cell (about 0.5 km). So this is a cell point, not the vessel's anchor fix.

**(b) "Vendovi Anchorage" (near Vendovi Island, Samish/Bellingham Bay)**
- **No official designated polygon exists.**
  - It is not in current 33 CFR 110.230, not in MarineCadastre, not in NOAA ENC and not in OSM.
- USCG VTS lists it as a **"NON-DESIGNATED ANCHORAGE"**: Vendovi Island East (VIE) and Vendovi Island South (VIS).
- The only published boundaries are in the **withdrawn** 2017 proposal (82 FR 10313 §110.230(a)(15)).
  - These are US Government text, so we may use them.
  - They must be labelled as a withdrawn proposal and a VTS working area, never as "designated".

## 5. Recommendation (for Josh to decide)

**US first:** MarineCadastre "Anchorages" GeoPackage (`noaa-mc-anchorages`; US Government work).
- It is the only ready-made polygon layer that carries name, type and CFR citation together, and it is complete for Puget Sound.
- Check it against the eCFR:
  - For regions amended after 2022-11-17 (Columbia River 110.228, NY 110.155, 110.214, 110.194b, 110.168, 110.195, 110.220), rebuild from the eCFR text or take the current ENC `ACHARE`.
  - Or mark those rows "boundary as of 2022 CFR".
- The ENC `ACHARE` layer (ENC Direct or cells) is the fallback and cross-check, and gives charted full names.

**Puget Sound non-designated anchorages:** a second, clearly labelled source (`uscg-vts-ps-nondesignated`).
- Names come from the VTS manual; geometry from the withdrawn 82 FR 10313 text.
- Use `legal_status = 'non_designated'`.
- The card would read something like "Vendovi Island East (VTS non-designated anchorage)".

**Canada first:** DFO "Active Commercial Shipping Anchorages in Pacific Canada" (`dfo-pacific-commercial-anchorages`; OGL-Canada 2.0).
- Use it for names, as circles of `Swing_Radius__m_`.
- Keep DFO/CHS `ACHBRT_P` (`dfo-chs-anchorages`; OGL-Canada 2.0, weekly) as the charted-position cross-check.
- Attribution: "Contains information licensed under the Open Government Licence – Canada" (the licence's default wording), plus the dataset names.

**Storage (evidence first, same pattern as `008_ports.sql`):**
- Put one `sources` row per dataset, with the licence, `commercial_use` (true for all four above), attribution, and the download URL and date.
- Keep every raw row exactly as received in `source_records`:
  - the GeoPackage attributes plus geometry;
  - DFO JSON rows;
  - the text of the CFR/FR paragraph and its citation.
- Derived anchorage rows would hold:
  - `name`, `kind` (general/explosives/…), `legal_status` (designated / non_designated / reported), `cfr_citation`;
  - geometry, stored as the source polygon, or for CFR and DFO circles, a geodesic circle built from centre and radius and marked as built.

**Matching rule (proposal):**
- Point-in-polygon on the GFW `position`.
- **Inside = "at anchorage X"**, with the source and citation shown inline.
- No buffer for the "inside" claim.
  - Because the GFW position is an S2 level-14 cell point (about 0.5 km), a separate **"near X (≤ 500 m)"** state could be shown as an interpretation.
  - Or, better, test our own stationary AIS track points for that visit instead of the cell point.
- Never report "at anchorage" beyond the polygon.
- Precedence: designated first, then non-designated, then reported.

## 6. Open questions for Josh

1. Is it OK to show VTS non-designated anchorages (Vendovi, Port Angeles, Budd Inlet…), whose geometry comes from a **withdrawn** 2017 proposal, if they are clearly labelled?
2. Do we want the 500 m "near" state, or should we test our own AIS track points (the vessel's actual stop) before any anchorage claim?
3. For US regions amended since 2022 (Columbia River especially), should we rebuild from the eCFR, use NOAA ENC, or flag them as "2022 boundary"?
4. OSM: skip it (sparse here, ODbL share-alike), or allow it later for non-US/CA waters behind a clear "community data" label?
5. Should Canadian points come in as swing-radius circles (DFO) or as bare points?
