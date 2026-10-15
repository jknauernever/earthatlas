# BOEM / BSEE offshore platforms and structures: source catalog

Researched 2026-10-14. Every URL, count and sample row below was fetched that day unless marked **UNVERIFIED**. Only small files were downloaded (all under 300 KB zipped). No paging loops were run.

Scope: oil and gas platforms and structures on the US Outer Continental Shelf (OCS) in federal waters. That covers the Gulf of America (GOA, formerly Gulf of Mexico), the Pacific (Southern California) and Alaska. Platforms in state waters are not included in any of these datasets.

---

## 1. Sources at a glance

| # | Source | Region | Format | Coverage | Lat/lon datum |
|---|---|---|---|---|---|
| A | data.boem.gov ASCII: Platform Structures / Locations / Masters | GOA | Fixed-width `.DAT` in ZIP | All structures ever, installed and removed | NAD27 (see §6) |
| B | data.boem.gov ASCII: Pacific Platform files | Pacific | Fixed-width and quoted CSV in ZIP | 24 structures, 1 of them removed | UNVERIFIED (likely NAD83, see §6) |
| C | data.boem.gov Mapping: `platform.zip` shapefile / `Platforms.gdb.zip` | GOA | Shapefile / file geodatabase | All structures ever (7,317 points) | NAD27 (`.prj`) |
| D | gis.boem.gov ArcGIS REST, layer "OCS Drilling Platforms" | GOA, Pacific, Alaska (separate services) | REST JSON / GeoJSON / PBF | Currently installed only | NAD83 (wkid 4269) |
| E | data.boem.gov "Platform Structure Removals" ASCII | GOA | Fixed-width / CSV | Removal applications since 1986 | No coordinates |
| F | data.boem.gov "GoA Permanent Deepwater Structures" table | GOA | HTML grid with CSV/XLS export | 59 permanent platforms in water deeper than 1,000 ft | No coordinates |
| G | data.boem.gov Company (All) ASCII | All | CSV in ZIP | Company number to company name | n/a |

data.bsee.gov serves the same files at the same paths. For example, `https://www.data.bsee.gov/Platform/Files/platstrufixed.zip` returns the same byte length and Last-Modified time as the data.boem.gov copy.

---

## 2. GOA ASCII downloads (source A), the master record

Index page: https://www.data.boem.gov/Main/Platform.aspx (section "ASCII Downloads")

| File | URL | ZIP size | Unzipped | Records | Last updated (page) |
|---|---|---|---|---|---|
| Platform Structures | https://www.data.boem.gov/Platform/Files/platstrufixed.zip | 209,330 B | `platstru.DAT` 1,063,800 B (148-char lines) | 7,092 | 10/1/2026 10:03 AM |
| Platform Locations | https://www.data.boem.gov/Platform/Files/platlocfixed.zip | 238,817 B | `platloc.DAT` 832,884 B (112-char lines) | 7,306 | 10/1/2026 9:43 AM |
| Platform Masters (complex level) | https://www.data.boem.gov/Platform/Files/platmastfixed.zip | 142,256 B | `platmast.DAT` 680,120 B (96-char lines) | 6,940 | 10/1/2026 9:53 AM |
| Structures Removed + method | https://www.data.boem.gov/Platform/Files/platstruremdelimit.zip (also `platstruremfixed.zip`) | 236,188 B | `platstruremdelimit.txt` 1,485,360 B | 6,490 | 10/1/2026 6:47 AM |
| Platform Applications and Approvals | `/Platform/Files/platformapprovalsfixed.zip`, `platformapprovalsdelimit.zip` | not fetched | | | 10/1/2026 |
| Rig ID List | `/Platform/Files/rigidlistfixed.zip`, `rigidlistdelimit.zip` | not fetched | | | 10/11/2026 |

Only fixed-width versions exist for Structures, Locations and Masters. Removals, Approvals and Rig ID also have delimited versions.

Record layouts (start position and length for fixed width):
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=platformStructures
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=platformLocations
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=platformMasters
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=platformStrucRem

**Update frequency.** All files on the page show Last updated = 1 October 2026. The shapefile metadata says `Maintenance_and_Update_Frequency: Monthly`. A monthly cycle for the ASCII files is therefore likely but **UNVERIFIED**.

**Keys.** A structure is identified by `COMPLEX_ID_NUM + STRUCTURE_NUMBER`. Both keys are unique in Structures (7,092) and in Locations (7,306). A complex is one structure or a group of structures joined by walkways. Masters has one row per complex.

### 2a. Platform Structures (`platstru.DAT`): one row per structure

| Field | Start | Len | Notes |
|---|---|---|---|
| Area Code | 1 | 2 | e.g. `MI`, `AC` |
| Block Number | 3 | 6 | |
| Complex Id Num | 9 | 8 | |
| Deck Count | 17 | 2 | |
| E/W Departure Code | 19 | 1 | |
| **Install Date** | 20 | 11 | `DD-MON-YYYY` |
| Last Revision Date | 31 | 11 | |
| Major Structure Flag | 42 | 1 | Y/N |
| N/S Departure Code | 43 | 1 | |
| **Removal Date** | 44 | 11 | blank = not removed |
| Slant Slot Count | 55 | 3 | |
| Slot Count | 58 | 3 | |
| Slot Drill Count | 61 | 3 | |
| Satellite Completion Count | 64 | 3 | |
| **Structure Name** | 67 | 15 | |
| **Structure Number** | 82 | 3 | |
| **Structure Type Code** | 85 | 5 | see the counts below |
| Surface E/W Distance | 90 | 6 | feet from block line |
| Surface N/S Distance | 96 | 6 | |
| Underwater Completion Count | 102 | 3 | |
| Authority Type | 105 | 16 | `OCS LEASE`, `ROW`, `RUE`, `TIME EXTENSION`, `STATE LEASE` |
| Authority Number | 121 | 8 | lease number, e.g. `G10380` |
| Authority Status | 129 | 20 | `TERMIN`, `RELINQ`, `UNIT`, `PROD`, ... (this is the lease status, not the structure status) |

Real rows as fetched:
```
AC   25      183 4E25-APR-200028-SEP-2023YS                8  6  0A (Hoover)       1SPAR   2590  5694 10OCS LEASE       G10380  TERMIN
BS   55    20453 1W01-JAN-196628-SEP-2009NS                2  2  0FA               1CAIS   1875  2302  0OCS LEASE       G01372  UNIT
MI  565    10321 3W01-JAN-198821-JUL-1994NN02-AUG-1991     1  1  011               1CAIS   7290  6072  0OCS LEASE       G04138  TERMIN
```
The first two rows are installed (Removal Date is blank). The third was removed on 02-AUG-1991.

Structure type counts (all / installed with no removal date): FIXED 3796/991, CAIS (caisson) 2584/261, WP (well protector) 642/6, SEMI 21/17, SPAR 19/15, TLP 14/13, MOPU 5/2, MTLP 5/3, CT 3/2, FPSO 2/2, SSTMP 1/0. The full list of code meanings comes from the hyperlinked domain on the layout page and was **not fetched**. The expansions given here are standard industry terms: CAIS = caisson, WP = well protector, SEMI = semisubmersible, TLP = tension leg platform, MTLP = mini-TLP, MOPU = mobile offshore production unit, FPSO = floating production, storage and offloading, CT = compliant tower, SSTMP = **UNVERIFIED**.

Install dates run from 1942 to 2025. Removal dates run up to 2026 (27 so far in 2026, 76 in 2025, 39 in 2024, 155 in 2023).

### 2b. Platform Locations (`platloc.DAT`): one row per structure, with coordinates

| Field | Start | Len |
|---|---|---|
| District Code | 1 | 3 |
| Complex Id Num | 4 | 8 |
| Structure Number | 12 | 3 |
| Area Code | 15 | 2 |
| Block Number | 17 | 6 |
| Structure Name | 23 | 15 |
| Surface N/S Distance + code | 38 / 44 | 6 / 1 |
| Surface E/W Distance + code | 45 / 51 | 6 / 1 |
| X Location | 52 | 17 |
| Y Location | 69 | 17 |
| **Longitude** | 86 | 14 |
| **Latitude** | 100 | 13 |

Real rows:
```
  4     183  1AC    25     A (Hoover)  5694S  2590E          1090370          9778974  -94.68872137  26.93905139
  1   20453  1BS    55             FA  2302S  1875W          2725725           280382    -89.053794    29.417841
  4   90100  1AC    24       SSMANIFO                                                  -94.76940277  26.95505833
```
- 7,306 rows, with one row missing its lat/lon. The lon range is -97.11 to -87.66 and the lat range is 26.04 to 30.19 (Gulf only).
- Removed structures are included. Locations has no install or removal fields, so join it to Structures on complex + structure number. Of the 7,092 Structures rows, 7,084 match a Locations row, including all 1,312 installed structures.
- X/Y are in a projected system (feet). The system is not stated on the layout page (**UNVERIFIED**).

### 2c. Platform Masters (`platmast.DAT`): one row per complex

Fields useful for a map (the layout page lists the full set of about 40 flags):

| Field | Start | Len | Notes |
|---|---|---|---|
| Complex Id Num | 1 | 8 | |
| **Abandon Flag** | 9 | 1 | Layout text: "whether or not a platform is scheduled for removal" Y/N |
| Distance To Shore | 13 | 4 | nautical miles |
| Gas Flaring Flag | 20 | 1 | |
| **MMS Company Num** (operator) | 21 | 5 | join to the Company file (§7) |
| Manned 24 Hr Flag | 26 | 1 | |
| Lease Number | 28 | 7 | |
| Last Rev Date | 35 | 11 | |
| Heliport Flag | 48 | 1 | |
| **Water Depth** | 51 | 5 | feet, mean sea level to mud line |
| Qtr Type | 63 | 1 | Y/N/P/T |
| Production Flag | 65 | 1 | |
| Oil Prod / Gas Prod Flags | 68 / 19 | 1 | |
| Field Name Code | 70 | 8 | |
| District Code | 78 | 3 | |
| Bed Count | 85 | 3 | |
| Area Code / Block | 88 / 90 | 2 / 6 | |

Real rows:
```
     183NYYY 137NYYY00276YY G1038029-MAY-2013Y YNY 4825NN  Y 0PYYGYYY   AC025  4 2Y  60AC    25Y
   20453NNNN   7NNYN03481NN G0137217-OCT-2014NGNNY   28NN  N 0NYY NYN   BM041  1 0N    BS    55
```
Complex 183 (Hoover) is operator 00276 (Exxon Mobil Corporation), water depth 4,825 ft and 137 nm from shore. Complex 20453 is operator 03481 (Cantium, LLC) in 28 ft of water.

Water depth for all complexes ranges from 1 to 10,000 ft. Among installed complexes the maximum is 9,560 ft, and 59 are 1,000 ft or deeper. That matches the 59 rows in the Deepwater table (§5).

### 2d. Removals file (`platstruremdelimit.txt`)

This file is quoted CSV with no header. There are 6,490 rows of removal applications since 1986: 5,623 INITIAL and 867 MODIFICATION. Fields: operator name, company number, application number, received date, final action date, **removal date**, site clearance date, submittal type, lease, area, block, structure name, proposed removal date, proposed method (`EXPLOSIVES GENERIC`, `NON-EXPLOSIVES`, `D1`, `SW-4`, ...), district, complex ID, structure number and water depth. It has no coordinates.

```
"OXY USA Inc.","00777","1986-001","09/02/1986        ","11/26/1986        ","11/30/1986        ","11/30/1986        ","INITIAL     ","G03374","GA","  144","B","NOV-1986","EXPLOSIVES","4","    10130","  1","    48"
```

---

## 3. Pacific ASCII (source B)

Index page: https://www.data.boem.gov/Main/PacificPlatform.aspx. This is a separate dataset from the GOA files. All three files were updated 10/1/2026.

| File | URL | Size |
|---|---|---|
| Pacific Platform Locations (fixed) | https://www.data.boem.gov/Platform/Files/platlocpacfixed.zip | 1,291 B, 24 rows |
| Pacific Platform Structures | https://www.data.boem.gov/Platform/Files/platstrupacdelimit.zip (also `platstrupacfixed.zip`) | 1,165 B, 24 rows |
| Pacific Platform Masters | https://www.data.boem.gov/Platform/Files/platmastpacdelimit.zip (also `platmastpacfixed.zip`) | 1,414 B, 34 rows |
| **QUIRK:** `platlocpacdelimit.zip` | https://www.data.boem.gov/Platform/Files/platlocpacdelimit.zip | 242,759 B. It contains `PBLOCDMP.DAT`, which is byte-identical to the **Gulf** `platloc.DAT`. It is not Pacific data, so do not use it. Use `platlocpacfixed.zip` instead. |

Layouts:
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=pacplatformLocations
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=pacplatformStructures
- https://www.data.boem.gov/Main/HtmlPage.aspx?page=pacplatformMasters

The Pacific layouts differ from the GOA ones:
- Dates are `YYYYMMDD`.
- Structures has a 2,000-character Comments field.
- Locations X/Y are UTM metres, with longitude at position 92 (length 16) and latitude at 108 (length 15).
- Masters Water Depth is at position 50 (length 6).

Real rows (Locations fixed):
```
   8    51002  1LA 6658 A                 449S   433E       259567.47184     3802049.422113      -119.61343      34.331884
   8    52002  1SM 6576 HERMOSA           874N   115W      716114.880944       3815126.1939     -120.647392       34.45507
   8    51012  1SM 6586 O S & T                                   755654            1645097               0              0
```
Structures (delimited), in field order: area, block, comments, complex, deck count, E/W code, install date, last revision date, major flag, N/S code, removal date, slant slot count, slot count, slot drill count, name, structure number, E/W distance, N/S distance, underwater completion count:
```
"LA"," 6660","Slot Drill Count is the # of conductors - Ashfaq - updated 8/31/2016","    51000"," 2","W","19670901","20160831","Y","S","","","  66","  39","HOGAN","  1","  1316","   926","  0"
"SM"," 6586","","    51012"," 6","","19810303","20120821","Y","","19941231","","   0","   0","O S & T","  1","","","  0"
```
The 24 Pacific structures comprise 23 with no removal date and 1 removed. The removed one is "O S & T" (complex 51012, removed 1994-12-31), and its location row has lat/lon = 0. The 23 platforms are: A, B, C, Hillhouse, Henry, Hogan, Houchin, Habitat, Grace, Gilda, Gail, Gina, Edith, Ellen, Elly, Eureka, Irene, Hidalgo, Harvest, Hermosa, Harmony, Hondo and Heritage. Example operator: company 02531 is DCOR, L.L.C. (complexes 51000 to 51002).

---

## 4. ArcGIS REST (source D), currently installed structures only

Server: `https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE` (ArcGIS Server 11.3). Layer 0 is "OCS Drilling Platforms" in each of these services:

| Region | Layer URL | Count (2026-10-14) |
|---|---|---|
| Gulf of America | https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/GOA_Layers/FeatureServer/0 | **1,299** points (1,057 distinct complexes) |
| Pacific | https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/POC_Layers/FeatureServer/0 | **23** |
| Alaska | https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/AK_Layers/FeatureServer/0 | **1** (complex 1, installed 2000-06-01, at -148.6977, 70.4904; that position matches Northstar, but the name is **UNVERIFIED** because the layer has no name field) |
| National (GOA + Pacific) | https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/MMC_Layers/MapServer/0 | 1,322 (= 1,299 + 23) |

Each layer is also exposed as a `MapServer` at the same path.

- **Fields: only 4.** They are `OBJECTID`, `COMPLEX_ID_NUM` (int), `INSTALL_DATE` (epoch ms) and `REMOVAL_DATE` (always null). The layer has **no structure name, structure number, type, operator, area/block or water depth**, so join it to the ASCII files on complex ID for those.
- **Removed structures are not included.** `REMOVAL_DATE IS NOT NULL` returns count 0.
- Spatial reference is wkid 4269 (NAD83). Output in 4326 is available via `outSR=4326`.
- `maxRecordCount` is 10000. Pagination is supported (`resultOffset` / `resultRecordCount`, tested), so all 1,299 GOA rows fit in one request.
- Query formats are JSON, geoJSON and PBF. Capabilities are `Query` only. Statistics and orderBy are supported.
- No authentication. CORS echoes the request Origin: `Access-Control-Allow-Origin: http://localhost:5173` with `Allow-Credentials: true`. Responses carry `Cache-Control: max-age=0,must-revalidate`.
- **Reliability quirk:** 2 of roughly 20 requests returned an empty body (curl code 000 / no output), and an immediate retry succeeded. Fetch with retry.
- Layer description: "Only platforms in federal Outer Continental Shelf (OCS) waters are included. A database of platforms and rigs is maintained by BSEE." Copyright text: `BOEM / BSEE`.
- Service description: these layers are for web viewing and "should not be used for official or legal purposes".
- No `editingInfo` and no last-edit timestamp are exposed. The refresh cadence is **UNVERIFIED**. The newest `INSTALL_DATE` is 2025-07-17.

Real GeoJSON rows:
```
{"type":"Feature","id":17200854,"geometry":{"type":"Point","coordinates":[-89.053777285233409,29.418035113479192]},"properties":{"OBJECTID":17200854,"COMPLEX_ID_NUM":20453,"INSTALL_DATE":-126230400000,"REMOVAL_DATE":null}}
{"type":"Feature","id":352767,"geometry":{"type":"Point","coordinates":[-120.64741251309239,34.455204954805197]},"properties":{"OBJECTID":352767,"COMPLEX_ID_NUM":52002,"INSTALL_DATE":497318400000,"REMOVAL_DATE":null}}
```
Example query:
`https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/GOA_Layers/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson`

**How the 1,299 GOA points are selected.** This is inferred, not documented. The count matches the ASCII files exactly on both measures:

- Structures with no Removal Date whose complex has Masters `Abandon Flag = N` gives **1,299 structures in 1,057 complexes**.
- The ASCII files have 1,312 structures with no removal date. The 13 extra structures belong to complexes with Abandon Flag `Y` (8) or blank (5).

Each ArcGIS point therefore appears to be one structure.

---

## 5. Other related sources

- **Shapefile / geodatabase (source C):**
  - https://www.data.boem.gov/Mapping/Files/platform.zip is 254,511 B. It contains 7,317 points with fields `STRUCTURE_` (number), `COMPLEX_ID`, `STRUCTURE1` (name), `INSTALL_DA` and `REMOVAL_DA`. 5,773 of the points have a removal date. The `.prj` is GCS_North_American_1927. Index: https://www.data.boem.gov/Main/Mapping.aspx (updated 10/1/2026). Metadata: https://www.data.boem.gov/Mapping/Files/platform_meta.html.
  - https://www.data.boem.gov/Mapping/Files/Platforms.gdb.zip is 213,898 B and was not opened.
  - The page states: "Platforms are being added or modified continuously... these GIS files are considered to be approximate and are NOT an OFFICIAL record."
  - Sample row: `{'STRUCTURE_': '1', 'COMPLEX_ID': '10321', 'STRUCTURE1': '11', 'INSTALL_DA': '19880101', 'REMOVAL_DA': '19910802'}`
- **Deepwater table (source F):** https://www.data.boem.gov/Other/DataTables/PermDeepStruc.aspx. It lists 59 permanent platforms in water deeper than 1,000 ft, with company name, area, block, name, manned 24 hrs, water depth (ft) and install date. It was "last updated 10-11-2026", so it refreshes more often than the ASCII files. Its export buttons are form postbacks (DevExpress grid), not static URLs. Example row: `Exxon Mobil Corporation | AC | 25 | A (Hoover) | YES | 4825 | 4/25/2000`.
- **Online query:** https://www.data.boem.gov/Platform/PlatformStructures/Default.aspx is an interactive "Platform Structure" query and was not exercised.
- **Alaska:** data.boem.gov lists no Alaska platform ASCII files. Its "Alaska" section covers only Leasing and Well. The only Alaska platform source found is the AK_Layers REST layer (1 feature).

---

## 6. Datum

- **GOA ASCII and shapefile coordinates are NAD27.** The Mapping page says: "The Gulf of America OCS Region stores all its mapping data in longitude and latitude format. All coordinates are in NAD 27." The `platform.prj` is NAD27 as well. A cross-check fits this: complex 20453 is at ASCII (-89.053794, 29.417841) and REST NAD83 (-89.053777, 29.418035), a difference of about 21 m, which is the typical NAD27 to NAD83 shift in the Gulf. **Convert GOA ASCII lat/lon from NAD27 to WGS84/NAD83 before plotting**, or use the REST geometry.
- **Pacific ASCII lat/lon datum is not stated (UNVERIFIED).** Hermosa (52002) is at ASCII (-120.647392, 34.45507) and REST (-120.647412, 34.455205), about 15 m apart. A NAD27 to NAD83 shift off California is typically around 90 m in longitude, so the Pacific ASCII values are probably already NAD83, but this is not confirmed.
- REST layers are NAD83 (wkid 4269), which is within about 1 m of WGS84 at map scales.

---

## 7. Operator names (source G)

The Masters files carry only `MMS Company Num`. Names come from https://www.data.boem.gov/Company/Files/compalldelimit.zip (211,281 B, 5,550 rows, quoted CSV). Its layout is at https://www.data.boem.gov/Main/HtmlPage.aspx?page=companyAll.

The file has several rows per company number, one per name change and per address. To get the current name, pick the row whose `MMS Term Date` (3rd value after the name group) is blank. In that row, field 1 is the company number, field 2 the start date and field 3 the business name. Examples: `"03481","20170213","Cantium, LLC",...`, `"02531","20080731","DCOR, L.L.C.",...`, `"00276","20000309","Exxon Mobil Corporation",...`

Note that the Masters operator is the platform's designated operator as of its last revision. It may lag behind recent changes in operator.

---

## 8. License and terms

- Shapefile metadata Access_Constraints: "The data was developed within the U.S. Government; no proprietary rights may be attached to them nor may they be sold to the U.S. Government..."
- Use_Constraints: BSEE accepts no liability for errors, and the data "is not intended to be used as legal documentation".
- The Data Center disclaimer (https://www.data.boem.gov/Main/HtmlPage.aspx?page=Disclaimer) says the data comes from a working database built from operator submittals, that "Some errors may exist", and that it is **"not for navigational use."** Errors can be reported to GulfPublicInfo@bsee.gov.
- Neither page states the phrase "public domain" explicitly. US federal government works are public domain under 17 U.S.C. §105, but that conclusion is inferred and is not text on these pages.
- No credit line is required. The metadata `Credit` field is "Bureau of Safety and Environmental Enforcement, Office of Technical Data Management, Data Administration Unit". The REST copyright text is "BOEM / BSEE". Suggested credit: "BOEM / BSEE Data Center".

---

## 9. Access quirks summary

- data.boem.gov static ZIPs need no auth and return plain 200s with `Last-Modified` and `Content-Length`, so a conditional or HEAD check for changes is possible. CORS headers on the ZIPs were not checked, so plan to fetch them server-side or in a bake script.
- Gulf `platlocpacdelimit.zip` is mislabeled (§3).
- Fixed-width files use `latin-1`-safe ASCII. GOA dates are `DD-MON-YYYY` and Pacific dates are `YYYYMMDD`.
- REST: occasional empty responses (retry), 10,000 max records, and only four fields.

---

## Recommended integration route

1. **Geometry and installed set.** Use the REST layers, which are already NAD83, contain only installed structures and need just one request each:
   - `https://gis.boem.gov/arcgis/rest/services/BOEM_BSEE/GOA_Layers/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=geojson` (1,299)
   - `.../POC_Layers/FeatureServer/0/query?...` (23)
   - `.../AK_Layers/FeatureServer/0/query?...` (1)
2. **Attributes.** Enrich by joining on `COMPLEX_ID_NUM`, and on structure where possible, to the monthly ASCII files:
   - `platstrufixed.zip`: structure name, structure number, type, install and removal dates, area/block.
   - `platmastfixed.zip`: water depth, operator company number, manned, production and heliport flags.
   - `compalldelimit.zip`: operator name.
   - Pacific equivalents: `platstrupacdelimit.zip` and `platmastpacdelimit.zip`.

   REST points do not carry the structure number. To join on structure, match each REST point to the nearest ASCII location within its complex (convert NAD27 first for GOA), or show attributes at complex level.
3. **Including removed or decommissioned structures (history layer).** Use the ASCII Structures + Locations files joined on complex + structure number: 7,092 GOA structures, 5,780 of them with a removal date. Convert GOA lat/lon from NAD27 to WGS84.
   - Installed = `Removal Date` blank.
   - Removed = `Removal Date` set; the removal method is in `platstruremdelimit.zip`.
   - To reproduce the REST "installed" set exactly, also require Masters `Abandon Flag = N`.
4. **Counts as of 2026-10-14:**
   - GOA: 7,092 structures in the ASCII files. Of these, 1,312 have no removal date and 1,299 are installed per REST (1,057 complexes).
   - Pacific: 24 structures, 23 installed.
   - Alaska: 1 installed.
   - Total currently installed per REST: **1,323**.
5. **Refresh** monthly. The ASCII files were last updated on the 1st of the month, and the metadata says Monthly. A bake script can HEAD the ZIPs and re-bake when `Last-Modified` changes.
6. **Credit:** "BOEM / BSEE Data Center", with a link to https://www.data.boem.gov/Main/Platform.aspx. Show "not for navigational use" only if a disclaimer is shown at all.
