# Offshore oil & gas installations and wind farms: European sources

Researched 2026-10-14 by live requests against the services (small `count` / `resultType=hits` calls plus one attribute-only pull per layer, with no geometry, to tally status and country values). Anything not checked against a live response is marked **UNVERIFIED**.

---

## 1. EMODnet Human Activities: OWS (GeoServer)

| Item | Value |
|---|---|
| WFS endpoint | `https://ows.emodnet-humanactivities.eu/wfs` (GetCapabilities advertises `https://ows.emodnet-humanactivities.eu/geoserver/emodnet/wfs`. Both work.) |
| WMS endpoint | `https://ows.emodnet-humanactivities.eu/wms` (layers `platforms`, `windfarms`, `windfarmspoly` are present in WMS 1.3.0 GetCapabilities) |
| WFS versions | 1.0.0, 1.1.0, 2.0.0 |
| Output formats | `application/json` (GeoJSON), `csv`, `SHAPE-ZIP`, GML2/3/3.2 |
| CRS | EPSG:4326. GeoJSON coordinates come back as **[lon, lat]**, verified. |
| CORS | `access-control-allow-origin: *`, verified on a GetFeature JSON response |
| Auth / keys | None. `ows:Fees NONE`, `ows:AccessConstraints NONE`. |
| Rate limits | None documented on the terms page. The service sits behind Cloudflare. **UNVERIFIED** whether any throttling applies. |
| CountDefault | 1,000,000. An unbounded GetFeature returns the whole layer. |
| updateSequence | 10784 (same in the WFS and WMS capabilities) |

GetCapabilities:
`https://ows.emodnet-humanactivities.eu/wfs?service=WFS&request=GetCapabilities&version=2.0.0`

The service has 161 feature types in total. The relevant ones:

| typeName | Title | Geometry | Records (`resultType=hits`, 2026-10-14) |
|---|---|---|---|
| `emodnet:platforms` | Offshore Installations | Point | **1,617** |
| `emodnet:windfarms` | Wind Farms (Points) | Point | **631** |
| `emodnet:windfarmspoly` | Wind Farms (Polygons) | MultiPolygon | **600** |
| (related) `emodnet:oenergy`, `emodnet:oenergytests` | Ocean energy projects / test sites | Point / Polygon | not counted |
| (related) `emodnet:pipelines`, `emodnet:hydrocarbons` | Pipelines, hydrocarbon licences | – | not examined |

**There is no wind-turbine layer.** None of the 161 typeNames is a turbine layer. Turbines appear only as the count `n_turbines` on each farm.

### Example requests (small)
```
# hits only
https://ows.emodnet-humanactivities.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=emodnet:platforms&resultType=hits
# 3 features as GeoJSON
https://ows.emodnet-humanactivities.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=emodnet:platforms&count=3&outputFormat=application/json
# filter (GeoServer CQL works)
...&typeNames=emodnet:platforms&count=2&outputFormat=application/json&CQL_FILTER=country='Norway'
# attribute-only (no geometry)
...&typeNames=emodnet:windfarms&propertyName=status,country,year&outputFormat=application/json
```
The GeoJSON response includes `totalFeatures`, `numberMatched`, `numberReturned` and `timeStamp`.

---

### 1a. `emodnet:platforms`: offshore oil & gas installations

**Metadata:** CSW id `ddbe3597-4e3f-4e74-8d31-947c4efef2e9`, resource code `EMODnet_HA_OG_OffshoreInstallations_20240216`.
- Publication date 2024-02-16 (created 2015-08). Metadata dateStamp 2025-09-02. The abstract says the dataset is "updated every year". The data version is still Feb 2024.
- Originator: **Cogea Srl**.
- Upstream sources, from the abstract:
  - OSPAR: Germany, Ireland, Spain (Atlantic)
  - Italian Ministry of Economic Development: Italy
  - Danish Energy Agency: Denmark
  - TNO: Netherlands
  - Croatian Hydrocarbon Agency: Croatia
  - Norwegian Petroleum Directorate (now Sodir): Norway
  - UK Oil and Gas Authority (surface infrastructure): UK
  - Marine Traffic + HELCOM: Polish and Russian installations in the Baltic
  - Marine Traffic: Bulgaria, Russia and Ukraine in the Black Sea, and Spain in the Mediterranean
- Bounding box: lon −11.2…20.7, lat 36.4…72.7.

**Fields** (DescribeFeatureType): `country`, `platformid`, `current_status`, `name`, `category`, `function`, `operator`, `location_blocks`, `primary_production`, `weight_sub` (t), `weight_top` (t), `production_start`, `valid_from` (string YYYYMMDD), `valid_to`, `water_depth` (m), `coast_dist` (m), `remarks`, `the_geom`.

**`current_status` values and counts** (all 1,617 records):

| Value | Count |
|---|---|
| Operational | 1,319 |
| Decommissioned | 128 |
| Closed down | 91 |
| Under construction | 77 |
| Removed | 2 |

`valid_to` is null on **every** record, so status is the only lifecycle signal. Removal dates sometimes appear only as free text in `remarks` (e.g. "Removed June 15. 2010").

**Records by country:**

| Country | Records |
|---|---|
| Norway | 722 |
| United Kingdom | 391 |
| Netherlands | 252 |
| Italy | 140 |
| Denmark | 67 |
| Croatia | 19 |
| Ireland | 7 |
| Spain | 5 |
| Russia | 5 |
| Germany | 3 |
| Ukraine | 3 |
| Bulgaria | 1 |
| Poland | 1 |
| "Lybia" (spelled this way in the data) | 1 |

**Seas covered:** North Sea, Norwegian Sea / Barents Sea (Norway), Irish and Celtic seas, Adriatic Sea, a few Baltic and Black Sea installations. **Norway is included** (722 records).

**Sample features:**
```json
{"country":"Denmark","platformid":"DK35","current_status":"Operational","name":"Tyra WC","category":"Fixed steel","function":"Above water production","operator":"Mærsk","location_blocks":"5504/11","primary_production":"Natural Gas","weight_sub":1499.0,"weight_top":815.0,"production_start":null,"valid_from":"19840101","valid_to":null,"water_depth":41.0,"coast_dist":210002.4,"remarks":"Wellhead"}  // [4.7488, 55.7155]
{"country":"Norway","platformid":"271665","current_status":"Operational","name":"ULA QP","category":"Fixed steel","function":"Above water production","operator":"Aker BP ASA","location_blocks":"NO_7/12","primary_production":"Crude Oil","weight_sub":4207.0,"weight_top":7942.0,"valid_from":"19861001","water_depth":71.0,"remarks":"JACKET 4 LEGS; QUARTER"}
{"country":"United Kingdom","platformid":"c224555b-b624-4287-8d8f-d2a97b96","current_status":"Removed","name":"BOOSTER PLATFORM 37/4A NORPIPE A.S","category":"PLATFORM","operator":"CONOCOPHILLIPS","water_depth":0.0,"remarks":"Removed June 15. 2010"}
```

**Data quirks:**
- Field conventions differ by source.
  - Norway's `platformid` is the Sodir NPDID (e.g. 271665).
  - UK uses GUIDs, `category` "PLATFORM", and `water_depth` 0.
  - Denmark uses ids like `DK35`.
- `production_start` was null in every sample.

---

### 1b. `emodnet:windfarms` (points) and `emodnet:windfarmspoly` (polygons)

**Metadata:** CSW id `8201070b-4b0b-4d54-8910-abcea5dce57f`, resource code `EMODnet_HA_Energy_WindFarms_20260710`.
- Publication date **2026-07-10** (created 2014-06). Metadata dateStamp 2026-07-13.
- Originator: **CETMAR**. The abstract says the dataset is updated every year. Upstream sources are described only as "several sources" (**UNVERIFIED** which ones).
- Abstract country list: Belgium, Denmark, Estonia, Finland, France, Germany, Greece, Ireland, Italy, Latvia, Lithuania, Netherlands, Norway, Poland, Portugal, Spain, Sweden, UK.
  - The data also has Romania (3 records) and Malta (1).
- Bounding boxes include the Canary Islands (lat down to about 27.6).

**Fields:**
- Points: `country`, `name`, `n_turbines`, `power_mw`, `status`, `type_inst`, `updateyear`, `year` (start year, string), `dist_coast` (m), `notes`.
- Polygons: the same fields plus `area_sqkm`, `shape_leng`, `shape_area`.

**`status` values and counts:**

| Status | Points (631) | Polygons (600) |
|---|---|---|
| Planned | 557 | 344 |
| Production | 39 | **160** |
| Approved | 12 | 59 |
| Construction | 4 | 22 |
| Dismantled | 19 | 12 |
| Test site | 0 | 3 |

"Production" is EMODnet's word for operating.

**The two layers are largely different farms.** Only 7 names appear in both (e.g. East Anglia Two, Windfloat Atlantic, Cenos). Most operating North Sea farms are **polygon-only**.

| Layer | Production records by country |
|---|---|
| Polygons | UK 76, DE 31, DK 16, BE 14, NL 12, FR 4, SE 3, ES 2, IE 1, PT 1 |
| Points | NL 15, FI 5, ES 4, FR 3, SE 3, DE 2, UK 2, DK 2, BE 1, IT 1, PT 1 |

To get complete coverage, use both layers.

Polygon `updateyear` values: 2026 (259), 2025 (88), 2024 (30), older years, null (198).

**Sample features:**
```json
// windfarms (points)
{"country":"Belgium","name":"Belwind Alstom Haliade Demonstration Bligh Bank","n_turbines":1,"power_mw":6.0,"status":"Production","type_inst":null,"updateyear":"2024","year":"2013","dist_coast":43900.8} // [2.84, 51.69]
{"country":"Denmark","name":"Vindeby-Lolland","n_turbines":11,"power_mw":4.95,"status":"Dismantled","updateyear":"2024","year":"1991"}
{"country":"Finland","name":"Ajos 1","n_turbines":1,"power_mw":3.0,"status":"Dismantled","updateyear":"2025","year":"2005","notes":"Decommission: 2016"}
// windfarmspoly
{"country":"France","name":"Saint-Nazaire","n_turbines":80,"power_mw":480.0,"status":"Production","type_inst":"Grounded","updateyear":"2026","year":"2022","area_sqkm":78.11} // MultiPolygon
{"country":"Denmark","name":"Samsa","n_turbines":10,"power_mw":23.0,"status":"Production","updateyear":"2025","year":"2003","area_sqkm":0.88}
```
`type_inst` was seen as "Grounded" or null. **UNVERIFIED** whether "Floating" is also used, though it is likely.

---

### 1c. Licence and attribution (EMODnet)

Sources:
- Both CSW records list `otherConstraints`: "No limitations on public access" and "Creative Commons CC-BY 4.0".
- Terms page: https://emodnet.ec.europa.eu/en/terms-use-emodnet-online-services-data-and-data-products. Data products are EU-owned and CC BY 4.0 unless the metadata says otherwise.

Attribution text from the metadata, to use per dataset:
- Platforms: "This data was downloaded from the EMODnet Portal (https://emodnet.ec.europa.eu/en/). The data originator is Cogea Srl."
- Wind farms: "This data was downloaded from the EMODnet Portal (https://emodnet.ec.europa.eu/en/). The data originator is CETMAR."

The terms page also asks that layers be cited by the dataset name used in the metadata:
- "EMODnet Human Activities, Oil and Gas, Offshore Installations"
- "EMODnet Human Activities, Energy, Wind Farms"

Portal page: https://emodnet.ec.europa.eu/en/human-activities

---

## 2. OSPAR Inventory of Offshore Installations (ODIMS)

| Item | Value |
|---|---|
| WFS | `https://odims.ospar.org/geoserver/ows?service=WFS&request=GetCapabilities` (CORS `*`, verified) |
| Editions (typeNames) | `odims:ospar_offshore_installations_YYYY_..` for 2001 through 2019, plus `2021_02_001` and **`2023_01_001` (latest)** |
| Shapefile download | e.g. `https://odims.ospar.org/public/submissions/offshore_installations/offshore_installations/2019-01/002/ospar_offshore_installations_2019_01_002-gis.zip` (2019 v002 page: https://odims.ospar.org/en/submissions/ospar_offshore_installations_2019_01/) |
| 2023 records | **1,948** (hits) |
| Licence | The ODIMS site footer says: "To the extent possible under law, OSPAR Secretariat has waived all copyright and related or neighboring rights to data presented under the OSPAR Data and Information Management System". This is CC0-style wording. The separate "Data Policy & Conditions of Use" page was not read (the URL tried returned 404), so **UNVERIFIED** whether any extra conditions apply. |

**2023 fields:** `ID`, `Country`, `Year`, `Name`, `Location` (block), `Latitude`, `Longitude`, `Water_dept`, `Operator`, `Oper_st`, `Current_st`, `Primary_hy`, `Category`, `Function`, `Weight_sub`, `Weight_top` (string), `Annual_dis`, `Remarks`.

**2023 `Current_st` values** (inconsistent capitalization):

| Value | Count |
|---|---|
| Operational | 1,385 |
| Decommissioned | 171 |
| Closed down - permanently | 102 |
| Closed down - Permanently | 24 |
| Being dismantled | 90 |
| Under construction | 89 |
| Closed down | 59 |
| Unknown | 10 |
| Derogation | 10 |
| "0" | 6 |
| Closed down - Temporarily | 2 |

**2023 records by country:**

| Country | Records |
|---|---|
| United Kingdom | 887 |
| Norway | 813 |
| Netherlands | 148 |
| Denmark | 69 |
| Ireland | 24 |
| Spain | 5 |
| Germany | 2 |

Coverage is the North-East Atlantic only: no Mediterranean, Baltic or Black Sea.

Sample:
```json
{"ID":"IE2","Country":"Ireland","Year":2023,"Name":"Kinsale Head Alpha","Location":"49/16","Water_dept":92,"Operator":"PSE Kinsale Energy Ltd","Current_st":"Decommissioned","Primary_hy":"Gas","Category":"Fixed steel","Function":"Production","Weight_sub":8100,"Weight_top":"4700","Remarks":"Kinsale Area gas fields production operations ceased 5 July 2020.  Decommissioned and platform fully removed 2022"}
```

**OSPAR vs EMODnet in the North-East Atlantic:** OSPAR 2023 has more UK records (887 vs 391) and more Norway records (813 vs 722). It also has more status detail ("Being dismantled", "Derogation").

---

## 3. Norway: Sodir FactPages, facilities (fixed)

| Item | Value |
|---|---|
| CSV (full) | `https://factpages.sodir.no/public?/Factpages/external/tableview/facility_fixed&rs:Command=Render&rc:Toolbar=false&rc:Parameters=f&IpAddress=not_used&CultureCode=en&rs:Format=CSV&Top100=false` |
| Other formats | Same URL with `rs:Format=EXCELOPENXML` or `rs:Format=XML` |
| Table page | https://factpages.sodir.no/en/facility/tableview/fixed |
| Test pull | `Top100=true` returned 300 rows. The full row count was not fetched (**UNVERIFIED**). |
| Sync | The `datesyncNPD` column showed 15.10.2026, so the data is synced daily |
| Licence | NLOD (Norwegian Licence for Open Government Data). This comes from FactPages wording found via search. The sodir.no copyright page is behind a Cloudflare JS challenge and was **not read directly** (UNVERIFIED wording). NLOD requires acknowledging the source. |

**Columns:** `fclName`, `fclPhase`, `fclSurface` (Y/N), `fclCurrentOperatorName`, `fclKind`, `fclBelongsToName`, `fclBelongsToKind`, `fclBelongsToS`, `fclStartupDate`, `fclDateShutdown`, `fclDateRemoved` (dates as DD.MM.YYYY), `fclGeodeticDatum` (**ED50**), `fclNsDeg/Min/Sec/Code`, `fclEwDeg/Min/Sec/Code` (DMS, needs conversion), `fclWaterDepth`, `fclFunctions`, `fclDesignLifetime`, `fclNationName`, `fclFactPageUrl`, `fclFactMapUrl`, `fclNpdidFacility`, `fclDateUpdated`, `datesyncNPD`.

**`fclPhase` values seen in the 300-row sample:**

| Phase | Rows |
|---|---|
| IN SERVICE | 222 |
| SHUT DOWN | 26 |
| REMOVED | 25 |
| INSTALLATION | 15 |
| FUTURE | 8 |
| DECOMMISSIONED | 3 |
| PARTLY REMOVED | 1 |

Of the 300 sample rows, `fclSurface` = N (subsea templates and similar) for 263 and Y for 37.

**Is Norway already in EMODnet?** Yes: 722 Norwegian records, with `platformid` = Sodir NPDID. Sodir has two advantages: explicit shutdown and removal dates (`fclDateShutdown`, `fclDateRemoved`), and daily freshness. EMODnet's platforms data is from Feb 2024.

---

## Recommended integration route

1. **Wind farms: EMODnet, both layers.**
   - `emodnet:windfarmspoly` (600 polygons; holds most operating farms) plus `emodnet:windfarms` (631 points; mostly planned sites and small or older farms). Only 7 names overlap, so dedupe by `name`+`country` and prefer the polygon.
   - Fetch with `outputFormat=application/json`. CORS is open, but a baked file is preferable to live calls.
   - Use fields `name`, `country`, `status`, `n_turbines`, `power_mw`, `year` (start), `type_inst`, `dist_coast`, `area_sqkm`, `updateyear`, `notes`.
   - Status mapping:
     - Operating = `Production`
     - Building = `Construction`
     - Pipeline = `Approved` / `Planned` / `Test site`
     - Removed = `Dismantled`
   - No turbine-level positions exist in EMODnet. Show the turbine count only.
2. **Oil & gas platforms, Europe-wide: EMODnet `emodnet:platforms`** (1,617 points; the only source here covering the Mediterranean, Adriatic, Baltic and Black Sea).
   - Use fields `name`, `operator`, `country`, `category`, `function`, `primary_production`, `current_status`, `valid_from`, `water_depth`, `remarks`, `platformid`.
   - Status mapping:
     - Operating = `Operational`
     - Building = `Under construction`
     - Inactive = `Closed down` / `Decommissioned`
     - Gone = `Removed`
   - `valid_to` is always null, so do not rely on it.
3. **North-East Atlantic upgrade (optional):** swap the UK, NL, DK, IE, DE and ES records for **OSPAR 2023** (`odims:ospar_offshore_installations_2023_01_001`, 1,948 records, CC0-style waiver). It has more UK coverage and finer statuses.
   - Normalize `Current_st` by lowercasing, then map:
     - operating = `operational`
     - building = `under construction`
     - inactive = `closed down*`, `decommissioned`, `derogation`
     - being removed = `being dismantled`
     - unknown = `unknown` / `0`
4. **Norway (optional, freshest):** use the Sodir FactPages `facility_fixed` CSV (NLOD).
   - Convert the ED50 DMS coordinates to WGS84 (the shift is about 100 m).
   - Status mapping:
     - Operating = `IN SERVICE`
     - Building = `INSTALLATION` / `FUTURE`
     - Inactive = `SHUT DOWN` / `DECOMMISSIONED`
     - Gone = `REMOVED` / `PARTLY REMOVED`
   - Use `fclDateRemoved` / `fclDateShutdown` for dates. Optionally filter on `fclSurface='Y'` to show only surface structures rather than subsea templates.
   - Join to EMODnet on NPDID (`platformid` = `fclNpdidFacility`) to avoid duplicates.
5. **Attribution:** show each value's source inline.
   - "EMODnet Human Activities: Cogea Srl (oil & gas) / CETMAR (wind farms), CC BY 4.0"
   - "OSPAR Commission ODIMS"
   - "Norwegian Offshore Directorate (Sodir) FactPages, NLOD"
6. **Fetch hygiene:** keep requests small during development (`count=` and `resultType=hits`). Take a full pull of each layer only once, in the bake that will use it. Every layer is under 2k features, so one request per layer is enough.
