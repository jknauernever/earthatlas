# Ship track LINES (and fine-grained density): sources

Research for /ships, 2026-09-25. Facts only. Anything not checked against a primary
source or a live endpoint is marked **UNVERIFIED**.

This picks up where `docs/SHIP_DENSITY_SOURCES.md` (World Bank/IMF raster, GFW),
`docs/GFW_ACTIVITY_API.md` and `docs/MARINECADASTRE_AIS.md` stop. Those findings are not
repeated here.

**Why:** we draw ships as thin, semi-transparent track lines that pile up into
density. Gridded density (GFW 0.1°, World Bank 0.005°) looked much worse. So this doc
looks for sources of **lines**, or of **points we can turn into lines**.

---

## 1. The Esri layer Josh means: "U.S. Vessel Traffic" (Esri Living Atlas)

Almost certainly this one. It is **per-vessel track lines**, drawn thin and colour-coded
by vessel group. There is one service per month, **Jan 2015 through Jun 2025**.
There is no 2025-07 or later service yet (searched 2026-09-25: exactly 12 items titled
`US_Vessel_Traffic_2025_*`, months 01–06, each a feature service plus a vector tile service).

| Field | Value | Source (checked live 2026-09-25) |
|---|---|---|
| App | "U.S. Vessel Traffic App", snippet "AIS shipping tracks since Jan 2017" | [item f873e5cb…](https://www.arcgis.com/home/item.html?id=f873e5cba24043b4ad804db36ea3b8aa), app at [livingatlas.arcgis.com/vessel-traffic](https://livingatlas.arcgis.com/vessel-traffic) |
| Web map | "U.S. Vessel Traffic". Its typeKeywords include **"Requires Subscription"** | [item 7765c67c…](https://www.arcgis.com/home/item.html?id=7765c67c91344f018988910212e855b0) |
| Owner | `esri_oceans` (Esri's ocean team). Contact named in the item: Keith VanGraafeiland | item JSON |
| Underlying data | **NOAA/BOEM/USCG MarineCadastre AIS**: "sourced from the AIS provided by USCG, NOAA, and BOEM through Marine Cadastre and aggregated for visualization … in ArcGIS Pro". Credit line: "NOAA, BOEM, USCG, Marine Cadastre, Esri" | item description, `copyrightText` |
| Coverage | **US only**, same as MarineCadastre. Item extent is 176°W–180°E, 10°N–51°N (CONUS, Hawaii, PR/USVI, Guam area). Alaska is absent because NOAA removes it upstream (see MARINECADASTRE_AIS.md) | item `extent` |
| Vector tiles (per month) | e.g. `https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/US_Vessel_Traffic_2025_06_optimized/VectorTileServer` ([item 6163b046…](https://www.arcgis.com/home/item.html?id=6163b0464c2444bc83be043a6b1d1ea6)); the pattern is the same for `…_YYYY_MM_optimized` | `?f=pjson` |
| VT facts | `type: indexedVector`, 512 px tiles, Web Mercator, LODs 0–19, **`maxLOD` 16** (so overzoom after z16), `exportTilesAllowed: false`, gzip. Anonymous `GET tile/{z}/{y}/{x}.pbf` works (HTTP 200, no token) | `?f=pjson`, test fetches |
| VT content (decoded) | Two source layers: `US_Vessel_Traffic_gen` (below z≈12.5) and `US_Vessel_Traffic` (above). **The only attribute is `_symbol`**, which is the vessel group. Each tile holds **~6–8 features, one merged multilinestring per vessel group**. There is no per-vessel identity in the tiles. | own decode of z4/z8/z12/z13 tiles |
| VT styling | Esri's root style: `line-width` 0.333 px, one colour per group (Cargo #4CE600, Fishing #0070FF, Military #FF0000, Passenger #C500FF, Pleasure #FF73DF, Tanker #FFFF00, Tow #FFAA00, Other #686868, Not Available #E41A1C). **This is the look he likes: raw ~⅓-px lines, no density ramp.** | `resources/styles/root.json` |
| VT weight | 2025-06: tile z4/5/2 (the US West Coast) is **823 KB gzip / 1.98 MB raw**; z8 Salish Sea is 426 KB gzip. These are heavy tiles. | test fetches |
| Feature service (per-vessel tracks) | e.g. `https://utility.arcgis.com/usrsvcs/servers/975fc8340d374ccf9e626a8f19e5431c/rest/services/AIS/2025_US_Vessel_Traffic/FeatureServer/5` (the "_creds" items are a proxy that carries Esri's credentials; the origin `oceans6.arcgis.com/…/AIS/2025_US_Vessel_Traffic/FeatureServer` answers "499 Token Required") | `?f=json` |
| FS geometry and fields | `esriGeometryPolyline`, **one row per vessel per UTC day** (sample rows: `track_duration` ≈ 86 300 000 ms, with `month` and `day` fields). Fields: `mmsi, vessel_name, imo, vessel_type, length, width, draft, vertices, mean_sog, mean_cog, mean_heading, track_duration, start_date, end_date, month, day, vessel_group, vessel_class, transceiver_class`. **2,025,546 tracks for June 2025.** maxRecordCount 2000. Capabilities "Query,Extract"; export formats sqlite, filegdb, shapefile, csv, geojson | `?f=json`, `query?returnCountOnly=true` |
| License | Web map and app: **"licensed under the Esri Master License Agreement"**. The VT and FS items have an **empty licenseInfo**. The data itself comes from MarineCadastre, which is **CC0** (see MARINECADASTRE_AIS.md). | item JSON |

### Can we use Esri's tiles directly?

- **Technically, yes.** The tiles are public and need no token, and Mapbox GL can read an
  Esri VectorTileServer as `tile/{z}/{y}/{x}.pbf`. Note that the order is **z/y/x**.
- **Legally, unclear.** The web map is tagged "Requires Subscription" and the items fall
  under the Esri Master License Agreement. Esri's general statement is that Esri-owned
  Living Atlas content falls under that agreement
  ([Living Atlas Q&A](https://www.esri.com/arcgis-blog/products/arcgis-living-atlas/sharing-collaboration/your-living-atlas-questions-answered)).
  **UNVERIFIED:** whether the agreement allows showing these tiles, fetched anonymously,
  in a non-Esri client (Mapbox GL) on a public site, and whether we may cache them. Ask
  Esri (Keith VanGraafeiland) before relying on it.
- **We don't need Esri.** Esri's tracks are MarineCadastre data, which is CC0. The
  MarineCadastre monthly track GeoParquet (`ais-track-YYYY-MM.parquet`, **2024-01 →
  2025-12** on the blob store, checked 2026-09-25) is already our /ships source.
  Esri's product is those tracks with the same kind of daily splitting, baked as
  ~⅓-px lines. We can reproduce the look from our own PMTiles, with no licence
  question and six more months of data.
- **What Esri shows us about the look:** keep every track (no density cap) at low zoom,
  use a very thin line (≈0.33 px) with no opacity ramp, colour by vessel group, and merge
  all tracks of a group into one feature per tile. The cost is ~1–2 MB (raw) per low-zoom
  tile. This is a styling lesson we can reuse. Esri still has no data outside the US.

### Other Esri / ArcGIS Online items found (not what he means)

| Item | Owner | What | Why not |
|---|---|---|---|
| [AIS Vessel Transit Counts 2024](https://www.arcgis.com/home/item.html?id=af6d042a5169460b8a7b2d97415948f1) / [2025](https://www.arcgis.com/home/item.html?id=bdce69fd99814676b8a72e3d23894275) (`coast.noaa.gov/arcgis/rest/services/MarineCadastre/AISVesselTransitCounts{YEAR}/MapServer`) | marinecadastre_noaa | Cached raster tiles, **100 m grid** of annual transit counts, US. US-government public domain notice | A raster density grid, not lines. 2025 exists (16 LODs; 2024 has 24) |
| [Global Ship Density – All/Commercial/Fishing/…](https://www.arcgis.com/home/item.html?id=2f72eb72cc0b403bb19a7cd1853f3d94) | esri_oceans | World Bank/IMF 2015–21 raster, already covered | Already ruled out |
| [Global Shipping Routes](https://www.arcgis.com/home/item.html?id=12c0789207e64714b9545ad30fca1633), [(2008)](https://www.arcgis.com/home/item.html?id=f5557ba2eb3f493dafe6b8b5bff373e3) | StoryMaps | Raster maps of 2008-era shipping (**UNVERIFIED** underlying source; probably Halpern et al. 2008) | Old, raster |
| [USA Shipping Zones](https://www.arcgis.com/home/item.html?id=89c6e89a7dae42ee923fc65725f26b4b) | esri_oceans | US fairways, lanes and zones (polygons/lines) | Regulatory geometry, not traffic |
| [Vessel Routing Measures](https://www.arcgis.com/home/item.html?id=c609b171d3204e2eb9dbac60feb0f9f6) | marinecadastre_noaa | US TSS, fairways and precautionary areas, from NOAA ENCs | Regulatory geometry |
| [AIS 2020 Vessel Tracks](https://www.arcgis.com/home/item.html?id=6e1d737c45e44876a65116cfca7f6e02) | geoscienceaustralia | **Track lines, Australia, 2020 only**, built from AMSA CTS points with MarineCadastre TrackBuilder. **CC BY-NC 3.0 AU** | Proves the AMSA → lines route works; but 2020 only |
| Vessel density 2013 (dsfgis), AIS2017 (ABPmer) | third parties | Old regional rasters | Old |

---

## 2. Other sources of track lines or fine (<1 km) density

"Lines?" means one of: the source ships line geometry, or it ships per-vessel
points dense enough for us to build lines (as we do with MarineCadastre).

### A. Per-vessel points or tracks (we can draw real lines)

| Source | Coverage | Years (checked) | Cadence | Geometry and access | Licence | Size | Lines? |
|---|---|---|---|---|---|---|---|
| **NOAA MarineCadastre** (already used) | US EEZ, terrestrial only, no Alaska, no Canada | tracks 2024-01 → 2025-12; points → 2026-06-30 | about quarterly | GeoParquet tracks, CSV points (see MARINECADASTRE_AIS.md) | **CC0** | ~1.8 GB per month of tracks | **Yes, ready** |
| **Danish Maritime Authority** ([bucket](http://aisdata.ais.dk/), S3 `aisdata.ais.dk.s3.eu-central-1.amazonaws.com`) | Danish waters: Kattegat, Skagerrak, western Baltic, North Sea approaches. **UNVERIFIED** exact extent | Monthly zips 2006-03 → 2023 (a few 2016–17 months missing). **Daily zips 2024 (308 files), 2025 (365), 2026 (265, latest 2026-04-23)** as listed 2026-09-25 | Daily, ~3-day lag | Raw position CSV, 26 columns (timestamp, MMSI, lat/lon, SOG, COG, ship type, name, IMO, dims…); per-message, not downsampled. **UNVERIFIED** | Free download ([dma.dk AIS page](https://www.dma.dk/safety-at-sea/navigational-information/ais-data)). Published under the Danish PSI act, with its own terms (**UNVERIFIED** text: the terms page 404'd). No attribution string found | **~630–830 MB zipped per day** (2026-04 samples); 2006 months were 0.9–8.6 GB | **Yes**: must build tracks ourselves |
| **Norway, Kystverket historical AIS** ([hais.kystverket.no](https://hais.kystverket.no/about)) | Norwegian EEZ + Svalbard/Jan Mayen zones; terrestrial + satellite | Up to 1 year per request; full archive range **UNVERIFIED** | On request | Parquet or CSV (EPSG:4326 geometry column), delivered by email; you must pick an area polygon (≤5) or specific vessels | **NLOD** (Norwegian Licence for Open Government Data), credit Kystverket. **Excludes fishing vessels <15 m and leisure craft <45 m** | **UNVERIFIED** | **Yes**, by area request |
| **Australia, AMSA Craft Tracking System** ([Digital Data](https://www.operations.amsa.gov.au/spatial/DataServices/DigitalData)) | Australia's search-and-rescue region (~75°E–163°E, 70°S–6°N: a big chunk of the Indian and Southern Oceans); terrestrial + satellite | Monthly, **Jan 2020 → Aug 2026** listed; series since 2012 | Monthly | Points **thinned to one per vessel per hour**, **anonymised** (MMSI/IMO/name removed; per-craft `CRAFT_ID` kept per the AIMS repackaging). Shapefile / FGDB (2014 metadata PDF); GeoPackage via AIMS | **CC BY-NC 3.0 AU** (confirmed in the [GA item licence text](https://www.arcgis.com/home/item.html?id=6e1d737c45e44876a65116cfca7f6e02) and [AIMS record](https://researchdata.edu.au/location-ships-boats-2023-amsa/2974120)); credit "© Commonwealth of Australia (Australian Maritime Safety Authority)". Non-commercial only | Jan–Apr 2023 was a 457 MB GeoPackage zip (AIMS) | **Yes**, but hourly points give coarse, straight-segment lines |
| **UK MMO anonymised AIS-derived track lines** ([2015](https://www.data.gov.uk/dataset/963c1a7b-5b72-4cce-93f5-3f1e223fd575/anonymised-ais-derived-track-lines-2015), [series](https://environment.data.gov.uk/dataset/ffb7d2d8-2e13-487c-a17f-7abc0f116d50)) | UK waters (10°W–10°E, 47°–64°N) | 2012, 2013, 2015 only; 2 weeks per month (24 weeks/yr) | Discontinued | **Line geometry**, 11 ship-type groups; zip | **OGL** | **UNVERIFIED** | Lines, but **stale** |
| **Finland Digitraffic** ([marine API](https://www.digitraffic.fi/en/marine-traffic/)) | Finnish waters / Baltic | Live. `/api/ais/v1/locations` takes `from`/`to` (default 24 h back) per the [OpenAPI spec](https://meri.digitraffic.fi/swagger/) | Real-time | JSON/MQTT; class A only; small fishing vessels filtered | **CC BY 4.0** | n/a | Only if we record it ourselves. **UNVERIFIED** how far back `from` reaches; no bulk archive found |
| **aisstream.io** ([site](https://aisstream.io/)) | Global, from volunteer terrestrial receivers (**UNVERIFIED** density) | Live only | Real-time websocket | Free API key | **No published terms or licence** (users asking in GitHub issues [#181](https://github.com/aisstream/issues/issues/181), [#299](https://github.com/aisstream/issues/issues/299)) | n/a | Only by recording; licence risk |
| **AISHub** ([join](https://www.aishub.net/join-us)) | Global, volunteer receivers | Live only | Real-time | Free **only if you contribute a receiver feed** | No clear display terms | n/a | Only by recording |
| **UN Global Platform AIS** ([UNGP](https://unstats.un.org/bigdata/un-global-platform.cshtml)) | Global satellite + terrestrial (commercial feed) | 2018 → | — | Inside UNGP notebooks only, for official-statistics users | Restricted; **UNVERIFIED** whether any export or public display is allowed | huge | Not for a public site |

### B. Fine-gridded density (raster, ≤1 km). Better than 0.1°, still not lines

| Source | Coverage | Years (checked) | Resolution / unit | Access | Licence |
|---|---|---|---|---|---|
| **EMODnet Human Activities, Vessel Density** ([record](https://ows.emodnet-humanactivities.eu/geonetwork/srv/api/records/0f2f3ff1-30ef-49e1-96e7-8ca78d58a07c), [method](https://emodnet.ec.europa.eu/en/eu-vessel-density-map-detailed-method)) | EU waters + neighbours | 2017–2024, monthly + annual; updated 2025-12-06. **2024 is thinner**: satellite data loss from June 2024 | 1 km, **hours / km² / month**, 13 ship types + all | GeoTIFF zips, WMS, WCS | **CC BY 4.0**, credit EMODnet. AIS bought from CLS, ORBCOMM, vesseltracker |
| **EMODnet / EMSA Route Density** ([record](https://ows.emodnet-humanactivities.eu/geonetwork/srv/api/records/74eef9c6-13fe-4630-b935-f26871c8b661)) | ~15°S–87°N, 88°W–98°E (Europe, N. Atlantic, Med, part of Indian Ocean) | **2019-01 → 2026-07**, monthly, seasonal, annual; updated 2026-08-11 | 1 km, **routes crossing each cell** (EMSA rebuilds each ship's track, then counts crossings). Cargo, fishing, passenger, tanker, other, all | GeoTIFF zips, WMS, WCS | **CC BY 4.0**, credit EMSA + EMODnet |
| **HELCOM AIS shipping density** ([record](https://metadata.helcom.fi/geonetwork/srv/api/records/2558244b-0cea-46e9-8053-af6ef5d01853)) | Baltic Sea | Annual 2006–2024 (the record says zips for 2017–18 are missing) | 1 km EEA grid, ships crossing each cell | `https://maps.helcom.fi/website/download/Shipping_traffic_intensity/{YEAR}.zip`, [MapServer](https://maps.helcom.fi/arcgis/rest/services/MADS/Shipping/MapServer) | "Free for public use", **HELCOM must be cited** (not a CC licence) |
| **Canada DFO Northwest Atlantic vessel density** ([2024](https://open.canada.ca/data/en/dataset/27b450d8-3a9a-460a-8f71-587737b2cdf4); a 2025 edition also listed) | NW Atlantic (Canadian east coast) | 2013–2025, annual + monthly | Resolution **UNVERIFIED** (see the report PDF); by vessel class | GeoTIFF (Albers), FGDB, Esri REST | **Open Government Licence – Canada**. Note: the 2024 record's coverage fields wrongly say 2023 |
| **NOAA Transit Counts** (above) | US | 2020–2025 | 100 m, annual transits | cached MapServer; bulk downloads via MarineCadastre | US public domain |
| **GMTDS** ([data page](https://globalmaritimetraffic.org/gmtds-data.html)) | Global | "over ten years" | 1 km², monthly track-time density (built from tracks) | Map viewer; raster download **by request form** | Own terms (**UNVERIFIED** content; run by MapLarge, source feeds unnamed) |

**No open 2024–25 track or density product was found for:** Canada's Pacific coast
(DFO has only a BC recreational-traffic *model*, 2022), New Zealand, Japan, China,
Southeast Asia, India, Africa, South America, the Middle East or the open oceans outside
the Australian SAR region. Searched; **UNVERIFIED** that nothing exists (non-English
portals were not searched deeply).

### C. Static lane and route vectors (schematic lines, not traffic)

| Source | What | Licence |
|---|---|---|
| [newzealandpaul/Shipping-Lanes](https://github.com/newzealandpaul/Shipping-Lanes) ([Zenodo 6361763](https://zenodo.org/records/6361763)) | Global polylines georeferenced from the CIA "Map of the World's Oceans" (Oct 2012), `Type` = Major/Middle/Minor. GeoJSON + SHP | **CC BY-SA 4.0**, with a custom clause excluding Statista |
| NOAA/MarineCadastre [Vessel Routing Measures](https://www.arcgis.com/home/item.html?id=c609b171d3204e2eb9dbac60feb0f9f6), Esri [USA Shipping Zones](https://www.arcgis.com/home/item.html?id=89c6e89a7dae42ee923fc65725f26b4b) | US traffic separation schemes and fairways, from ENCs | US public domain / Esri |
| OpenStreetMap / OpenSeaMap `seamark:type=separation_*` | Global TSS lines where mapped | ODbL. **UNVERIFIED** completeness |

These are hand-drawn schematics. They will never look like stacked real tracks.

---

## 3. Summary: best line-based worldwide view with 2024–25 data

**Where we can draw real 2024–25 track lines from open data:**
1. **US** (minus Alaska): MarineCadastre monthly tracks, CC0. Already in our pipeline,
   and the same data as Esri's layer. Copy Esri's styling (≈0.33 px lines, every track,
   colour by group).
2. **Denmark and approaches**: DMA daily raw CSVs, 2024 → Apr 2026. Needs our own
   track-building and down-sampling (~250 GB/yr zipped). Terms need confirming.
3. **Norway**: Kystverket Parquet by area request, NLOD. Small fishing and leisure
   vessels are excluded.
4. **Australian SAR region** (very large, including open Indian and Southern Ocean):
   AMSA hourly anonymised points, 2020 → Aug 2026. **Non-commercial only**
   (CC BY-NC 3.0 AU). The lines will look coarser (hourly vertices).

**Where the best we can get is a 1 km density grid (CC BY 4.0, current to mid-2026):**
- **EMSA Route Density** is the best fit. Its unit is "routes crossing each cell",
  computed from rebuilt tracks, so a thin-line look can be faked by drawing its bright
  cells sharply at 1 km. It covers Europe, the North Atlantic, the Mediterranean and part
  of the Indian Ocean, through Jul 2026.
- EMODnet vessel density (EU, 2017–2024), HELCOM (Baltic) and DFO (NW Atlantic,
  through 2025) are extra regional options.

**Still uncovered by any open 2024–25 line or ≤1 km source:** Canada's Pacific coast
(including the northern Salish Sea), Alaska, Latin America, West and East Africa, the
Middle East and Gulf, South and East Asia (Singapore/Malacca, the South China Sea,
China, Japan, Korea), New Zealand and the Pacific islands, and the open ocean outside the
AMSA region. For these, the only open all-vessel option remains **GFW 4Wings at 0.1°**
(non-commercial). A global look made of real lines everywhere would need a commercial
satellite-AIS feed (Spire, ORBCOMM, exactEarth, MarineTraffic). None are open.

## Local samples

In the gitignored `scripts/ships/bake-ais/cache/sources/esri/`: Esri
`US_Vessel_Traffic_2025_06_optimized` tiles `vt_4_5_2.pbf`, `vt_8_89_40.pbf`,
`vt_11_708_322.pbf`, `vt_12_1416_645.pbf`, `vt_13_2832_1291.pbf` (≈1.4 MB total; all gzip MVT). These were
used for the decode above.

---

## BC coast + Southeast Alaska (2026-09-29)

Goal: Salish-style detailed track lines from Seattle north to Yakutat (the whole BC coast
plus Southeast Alaska). Facts only. All pages were opened on 2026-09-29. **UNVERIFIED**
marks anything not confirmed on a primary page or a live endpoint.

Already established before this pass: MarineCadastre stops at 51.5° N and drops all Alaska
records. DFO "Vessel Density Mapping" is Northwest Atlantic only. open.canada.ca has only
the BC recreational traffic *model* (2022) and whale-watching layers.

### Leads Josh sent (checked first)

| Lead | Finding |
|---|---|
| ONC DOI [10.34943/1a27517e-…](https://data.oceannetworks.ca/DatasetLandingPage?doidataset=10.34943/1a27517e-9cea-4e09-9fcc-b578bffb9055) | Metadata (from ONC's own `DOIDatasetService?doidataset=…`): "**Kugluktuk** Automatic Identification Systems Receiver Deployed 2019-08-07". One Shine Micro receiver at **67.8248° N, −115.0901°**, Coronation Gulf, **Nunavut**. Co-owners: Angoniatit Niovikvia Ltd., Marine Institute (Memorial University), Nunavut Tunngavik Inc., ONC. Format "txt". Rights: "Please refer to our data policy page". **Arctic, not BC.** Its size, and whether it has per-vessel positions, were not checked. Neither the ONC API (`/api/locations`, `/api/devices`: "Either token or appToken must be specified") nor ONC's ERDDAP (a search for "AIS Receiver" found nothing) can list ONC's other AIS receivers without an account. |
| DFO [5b86e2d2…](https://open.canada.ca/data/en/dataset/5b86e2d2-cec1-4956-a9d5-12d487aca11b) | "Vessel Density Mapping of **2023** AIS Data in the **Northwest Atlantic**". DFO Maritimes (BIO). GeoTIFF + Esri REST, OGL-Canada. **Not Pacific.** |
| CCG e-Navigation [100ca303…](https://e-navigation.canada.ca/gn/description/eng/100ca303-b91a-431d-80de-bd358c648577) | "Physical AIS Aids to Navigation". A directory of AIS-equipped buoys and beacons (WFS, KML, CSV, GeoJSON). Regions listed: Great Lakes, St. Lawrence, Maritimes, NL. **Not ship positions.** The whole e-Navigation catalogue has **41 records**, and its "Vessel Traffic Services" category holds **0**. The rest are lights lists, marine weather, water levels, ice, notices and charts. No vessel-traffic or AIS-position dataset. |

### Findings table

"Tracks?" means: per-vessel positions or lines (**Yes**), or aggregate only (**No**).

| Source | Area | Years | Cadence | Access / format | Tracks? | Licence / terms | Cost | URL |
|---|---|---|---|---|---|---|---|---|
| **GFW 4Wings report, presence, HOURLY + HIGH + group-by VESSEL_ID** | Global, so the **whole Seattle–Yakutat coast** | 2012 → ~96 h ago | **1 position per vessel per hour**, snapped to **0.01° cells** (≈1.1 km N–S, ≈0.65 km E–W at 54° N) | `POST /v3/4wings/report?datasets[0]=public-global-presence:latest&temporal-resolution=HOURLY&spatial-resolution=HIGH&spatial-aggregation=false&group-by=VESSEL_ID&format=JSON` + a GeoJSON polygon. **Tested live**: Prince Rupert box (130.6–130.1° W, 54.1–54.4° N), 2026-08-01 (1 day) returned **2,018 rows, 138 vessels**, at most one row per vessel-hour. Each row has `vesselId, mmsi, imo, shipName, callsign, flag, vesselType, date "YYYY-MM-DD HH:00", lat, lon, hours`. 969 KB JSON | **Yes** (hourly vertices; coarse) | API is "only available for non-commercial purposes" (GFW docs). Already our GFW terms | Free with our existing token | [docs](https://globalfishingwatch.org/our-apis/documentation); sample in `scripts/ships/bake-ais/cache/sources/gfw/` |
| GFW vessel tracks endpoint | Global | — | — | `/v3/vessels/{id}/tracks` is reported to return 422 "dataset should be a tracks:* type" for public tokens. The source is a user post on GFW's feedback board, not GFW staff (**UNVERIFIED**; not tested) | — | — | — | [feedback post](https://feedback.globalfishingwatch.org/data-requests/p/vessels-api) |
| **Marine Exchange of Alaska (MXAK) Historical Data** | Alaska regions: Arctic, Western AK, Aleutians, AK Peninsula, Cook Inlet, PWS, **Southeast Alaska**; plus satellite Zones 1–3 | "more than 10 years" of retention | Raw AIS position reports. Rate **UNVERIFIED** (the 2009 TNC use of MXAK data cites 6-second intervals, **UNVERIFIED**) | **Request form** (not submitted). "Multiple Tracklines" = "position reports for multiple or all vessels within a specified time or geographic area … CSV format with accompanying graphic or shapefile" | **Yes**, raw positions | **No licence or redistribution terms on the page.** Must be asked in the request. **UNVERIFIED** whether public web display is allowed | Multiple Tracklines, terrestrial+satellite, **per region per year: $600 non-member / $300 member** (Chief Mate or Captain). 2 regions × 1–2 yr = $2,400 / $1,200. Membership $700–$2,900/yr; no non-profit tier listed | [mxak.org/?p=6761](https://mxak.org/?p=6761), [membership](https://www.mxak.org/membership/) |
| MXAK / Axiom / AOOS heatmaps ([ais.axds.co](https://ais.axds.co/)) | US EEZ Alaska (MXAK terrestrial); USCG terrestrial and satellite for Alaska, Pacific, Continental; MarineCadastre 2009–14 | MXAK **2013–2018**; USCG **2015–2016** | Monthly grids by ship type (All, Passenger, Tanker, Cargo, Other) | Public S3 GeoTIFF zips, e.g. `axds-aisdata/datasets/marine_exchange_terrestrial/Marine_Exchange_Terrestrial_USEEZAlaska_AllShips_2018_Heatmaps.geotiff.zip` (11.3 MB). **500 m**, Alaska Albers. Receiver sites: `axds-aisdata/static/MXAK_Sites.geojson` | No (density) | ISO metadata has **no constraints element** (no licence stated) | Free | [ais.axds.co](https://ais.axds.co/) |
| Kapsar et al. 2022, North Pacific & Arctic marine traffic (exactEarth) | Bounding box **160° E–145° W**, 50–74° N. **Excludes Southeast Alaska and BC** (Yakutat is ~139.7° W) | 2015–2020 | Monthly | Arctic Data Center: hex, 10 km, 25 km, and a 1 km coastal raster (within 10 km of shore) | No | Article CC BY 4.0; the data are anonymised "to comply with AIS data licensing agreements" | Free | [Data in Brief 108531](https://doi.org/10.1016/j.dib.2022.108531) |
| **ONC (Oceans 3.0), CCG terrestrial AIS** | CCG Pacific network. The WAVE project got a bounding box "including Vancouver Island and Puget Sound" | WAVE received 2019–2021; the full archive range is **UNVERIFIED** | CCG terrestrial (rate **UNVERIFIED**) | ONC "harvests … from the Canadian Coast Guard for vessel tracking applications based on … AIS data" via web services ([Frontiers 2022](https://www.frontiersin.org/articles/10.3389/fmars.2022.806452/pdf)). No public listing; needs an ONC account/token, and access is **UNVERIFIED** | **Yes** (raw AIS) | "provided by the Canadian Coast Guard (CCG) via a licensing agreement between the CCG and ONC for the **non-commercial use** of CCG AIS Data" ([WAVE record](https://open.canada.ca/data/en/dataset/8a80c6f7-86a7-49e8-97c2-5229068e64cd)). ONC's Data Restrictions wiki page is behind a bot check and was not read. Public redistribution **UNVERIFIED** | Unknown | [ONC data policy](https://www.oceannetworks.ca/data/data-policy/) |
| DFO "Commercial Whale Watching in BC" (WAVE) | S. Vancouver Island + Puget Sound | 2019–2021 | — | FGDB + Esri REST; grid-cell summaries of whale-watch trips | No | OGL-Canada (the product only) | Free | [8a80c6f7…](https://open.canada.ca/data/en/dataset/8a80c6f7-86a7-49e8-97c2-5229068e64cd) |
| Transport Canada **EMSA** platform | Canada, incl. BC partner communities | Live | Near-real-time | Closed partner platform (13 Indigenous partner communities). "fused presentation of: Canadian Coast Guard (CCG) terrestrial AIS data [and] ExactEarth satellite AIS data". The deck quotes the IMO MSC 79 position discouraging web publication of AIS | Yes (inside the platform) | Not public | — | [TC webinar PDF 2022](https://clearseas.org/wp-content/uploads/2022-CMSRF-AIS-Webinar-EMSA-Transport-Canada.pdf) |
| TC **Marine and Port Dashboard**, "AIS trackline monthly data 2013-2025" | Canada, by AOI (Atlantic, St. Lawrence, Pacific …) | 2013–2025 | Monthly | `L1M_AIS-trackline-monthly_byMMSI_2013-2025_v3.zip` (18.4 MB, 149 MB CSV, 954,535 rows). Downloaded to the cache. Columns: `MMSI, YEAR, MONTH, AOI_1, KM_SAILED, AvgSOG, MaxSOG, VESS_NAME, types, dims, flag, ACTIVE_DAYS…` | **No geometry**: per-vessel monthly km/speed statistics only | Page lists sources (exactEarth, Spire, CCG, MarineTraffic/FleetMon); no licence text seen | Free | [dashboard](https://tdih-cdit.tc.canada.ca/en/dashboard/marine-and-port-dashboard) |
| TC Cumulative Effects of Marine Shipping | 6 pilot areas incl. North and South Coast BC | — | — | Esri REST polygons | No (area outlines only) | OGL-Canada | Free | [e218c8cb…](https://open.canada.ca/data/en/dataset/e218c8cb-5039-4706-b58f-d54c6c11a6fc) |
| Clear Seas / Nuka "Vessel Traffic in Canada's Pacific Region" | BC coast + offshore | **2014–2016** | — | 118-page report PDF only. "Clear Seas obtained the AIS data from exactEarth" (91 M points) | No data release | Report only | Free | [project page](https://clearseas.org/research_project/vessel-traffic-in-canadas-pacific-region) |
| BCMCA shipping density | BC Pacific waters (137.4–122.2° W, 46.1–55.7° N) | 2007 (seasonal); 2010 per search snippet | — | 5 km grid from CCG MCTS | No | "Not to be reproduced or distributed without permission from the data custodian" | — | [metadata](https://bcmca.ca/datafiles/individualfiles/bcmca_hu_shippingtrans_tugvesseldensity_summer2007_metadata.htm) |
| TNC "Southeast Alaska Vessel Traffic Index" | SE Alaska | 2009 | — | Point density (1 km radius) from MXAK data | No | **UNVERIFIED** (the catalogue page refused connection) | — | [EPSCoR catalogue](https://catalog.epscor.alaska.edu/dataset/southeast-alaska-vessel-traffic-index-tnc-2009) |
| USCG NAIS historical (Level C) | US incl. Alaska | Up to 3 years back | Raw | Historical Data Requests only for government ("Government Point of Contact (May not be a Contractor)"). **Public route is FOIA only** | Yes | "shall not retransmit or redistribute AIS information … in any form other than those intended for the disclosure" | — | [NAVCEN policy](https://navcen.uscg.gov/node/465), [HDR form](https://www.navcen.uscg.gov/contact/ais-historical-request) |
| Kpler (now also Spire Maritime) | Global, terrestrial + satellite | From 2015 | Raw | Josh's account has an API key, but AIS is **not entitled** (see memory note). Historical queries are limited to ≤55,000 km² per 1 day, or ≤10 vessels. Billed per row. `historical.ais.spire.com` now 301-redirects to `kpler.com/spireMT/product` | Yes | Commercial; terms **UNVERIFIED** for public display | Per-row billing; price **UNVERIFIED** | — |
| AISHub / aisstream.io | Volunteer receivers | Live only | — | See §2A | Only by recording | See §2A | — | BC/SE Alaska receiver coverage **UNVERIFIED** (coverage map is JS-only) |
| CSA RCM AIS | Global | — | — | Government-first; the public data policy found covers RCM **SAR** imagery, not AIS. No public AIS archive found (**UNVERIFIED**) | — | — | — | [RCM SAR data policy](https://www.csa-asc.gc.ca/pdf/eng/publications/rcm-sar-data-policy.pdf) |
| MERIDIAN (Dalhousie), ECHO (VFPA), Port of Prince Rupert, BC Data Catalogue, CIOOS Pacific, Statistics Canada | — | — | — | No public AIS position or ≤1 km density product found on any of them. ECHO publishes reports and noise data. MERIDIAN's site lists no downloadable AIS dataset. The only TC/StatCan AIS product found is the dashboard row above | — | — | — | — |

### Best options (ranked)

1. **GFW 4Wings hourly per-vessel presence** is the only source that is **open to us today**, covers the **whole Seattle–Yakutat coast**, and is current (2012 → ~4 days ago). It has identity and vessel type. **Limit: one vertex per hour at 0.01°.** A 15 kn ship moves ~28 km between vertices, so lines through Inside Passage bends will cut corners. They will not look like the Salish MarineCadastre lines. Non-commercial terms, which EarthAtlas meets. Next step: one 1-day test of the full Seattle–Yakutat polygon, to measure row count and any report size limit (**UNVERIFIED**).
2. **MXAK Multiple Tracklines, Southeast Alaska region**: raw positions (CSV/shapefile), terrestrial + satellite, **$600 per region per year** for non-members. This is the only route to Salish-quality detail for SE Alaska. **Blocker: licence/redistribution terms are not published**, so we must ask MXAK (info@mxak.org) whether public web display of derived track lines is allowed. MXAK asked NOAA to strip Alaska from MarineCadastre, which suggests they may say no (inference, not verified).
3. **ONC / CCG terrestrial AIS** is the only route to raw BC-coast positions at fine cadence. It needs an ONC account plus access to the CCG-licensed stream, **non-commercial only**, and public redistribution of derived lines is **UNVERIFIED**. Ask ONC (and/or CCG) directly.
4. **Kpler/Spire (commercial)** covers everything, but the account lacks AIS entitlement. The query limits (55,000 km² × 1 day) and per-row billing make a coast-long, multi-month bake expensive, and display terms are unknown.

**No clear open winner.** Nothing open gives Salish-quality (minute-level) tracks north of
51.5° N. For open data, GFW hourly is the best available. For SE Alaska detail, MXAK
paid tracklines are the best, subject to their terms. For BC detail, ONC/CCG is the
route, subject to their terms.

### GFW hourly lines prototype, BC + Alaska (localhost only, 2026-09-29)

Built to let Josh judge GFW hourly positions as track lines by eye. **Nothing in production.**
Code: `scripts/ships/bake-ais/gfw/{fetch_hourly.py, gfw_land.py, build_gfw_tracks.py}`; dev layer
`/ships?gh=raw|routed` (dev builds only), tiles via `api/ship-tracks?r=gfwproto` (404 unless the
local file exists and never in `VERCEL_ENV=production`). Raw reports, land caches and PMTiles are
gitignored on "Josh WD 4TB" (`cache/sources/gfw/hourly-2026-0{6,8}/`, `cache/land/gfwproto/`,
`cache/sources/gfw/tracks-proto/`).

- **Request** (same as the Prince Rupert test): `POST /v3/4wings/report?datasets[0]=public-global-presence:latest&temporal-resolution=HOURLY&spatial-resolution=HIGH&spatial-aggregation=false&group-by=VESSEL_ID&format=JSON&date-range=…` + a bbox polygon.
  Verified live: **no pagination** (`nextOffset:null`, every report complete), a 7-day report
  costs about the same time as a 1-day one (20–100 s; one report at a time), a 2-day Salish
  report was 135k rows / 64 MB with no error. 14 bbox tiles cover BC + Alaska (Aleutians split
  at 180°); a gap was left at 126.3–134° W × 46.9–49.6° N (open ocean off Vancouver Island).
- **Run**: August 2026 for BC + Alaska (7-day requests), June 2026 for the Salish Sea (2-day
  requests; June is our latest month of real NOAA tracks, so they can be compared).
  **93 report requests, 3.45 M rows, 13,359 GFW vessels, 1.62 GB JSON (378 MB gzip'd), ~50 min.**
- **Positions are 0.01° cell centres; hours are UTC** — verified against our NOAA points: for
  12,317 vessel-hours on 2026-06-01, the NOAA mean position in [H, H+1) minus the GFW lat has
  median 0.0001° and is uniform within ±0.005°.
- **Water model for routing** (`gfw_land.py`): a spot is water if ANY source says water:
  - OSM land polygons (osmdata.openstreetmap.de `land-polygons-split-4326`), © OpenStreetMap contributors, ODbL.
  - **Alaska DNR "Alaska 1:63,360"** coastline (digitised from USGS quads), `https://arcgis.dnr.alaska.gov/arcgis/rest/services/OpenData/Physical_AlaskaCoast/MapServer/4`, accessed 2026-09-29, all 37,362 polygons (38 pages, 2.28 M vertices; 3 `lagoon` features treated as water). State of Alaska no-warranty disclaimer, no use restrictions; credit "Alaska Department of Natural Resources". Applied in Alaska only (outside the NHN work-unit index = Canada, and outside a crude Russia rule).
  - **NRCan National Hydro Network (NHN, GeoBase), 1:50,000 or better**, `https://open.canada.ca/data/en/dataset/a4b190fe-e090-4e6d-881e-b87956c07977`, shapefiles per work unit from `ftp.maps.canada.ca/pub/nrcan_rncan/vector/geobase_nhn_rhn/shp_en/08/`, accessed 2026-09-29, **Open Government Licence – Canada**; credit "Natural Resources Canada, National Hydro Network". 48 BC coastal work units downloaded (~1 GB zip), all with littoral lines. NHN has **no ocean polygon** (Water Definition codes are canal, conduit, ditch, lake, reservoir, watercourse, tidal river, liquid waste; catalogue v1.2 p. 53-54): the sea is bounded by `HN_LITTORAL_1` lines, with "the waterbody located to the right of the littoral" (catalogue p. 16). So NHN sea = faces of polygonize(work-unit limit + littoral) that the littoral puts on its right, minus `HD_ISLAND_2` (some island rings do not close and merge into the sea face); tidal river / watercourse / canal waterbodies also count as water.
  - Guard: another source may only open water that OSM calls land where that extra water is **narrower than 400 m** (morphological opening). In units where the littoral does not close (e.g. 08FG005 Pitt Island, 08GF001) whole mainlands otherwise came out as "sea".
- **Line rules** (`build_gfw_tracks.py`): per GFW vessel id, break at gaps > 3 h or straight-line speed > 40 kn; drop lines with < 2 distinct cells or extent < 1.5 km. *raw* = straight segments. *routed* = positions on land moved to the nearest water within 2 km (else dropped, line breaks); segments with ≥ 150 m of land along them replaced by the shortest 8-connected water path on a ~50 m raster window (padding max(4 km, 0.35 × length), ≤ 1,400 cells a side), then "string-pulled" into the fewest straight water-only legs (the raw grid path is a 0/45/90° staircase; the first bake without this drew grid patterns in open water), Douglas–Peucker simplified; rejected (line breaks) if no water path exists in the window or path length / time > 40 kn. Routed stretches are separate features with `est=1` (dashed on the map: "path between hourly positions estimated along the water (EarthAtlas)").

### GFW hourly lines: production pipeline (built 2026-09-29, not live)

Code: `scripts/ships/bake-gfw/` (`areas.py` area config + NOAA preference boxes, `fetch.py`, `land.py`,
`prepare_water.py`, `lines.py`, `bake.py route|tile|index`, `publish.mjs`, `test_lines.py`) and
`.github/workflows/ships-gfw-tracks-bake.yml`. Tileset `gfw-v1`: one PMTiles + per-MMSI pack + manifest per
month on Blob (`ships/tracks/gfw-v1/YYYY-MM/`), listed in `ships/tracks/gfw-v1/index.json`
(`trackSource.json` → `gfw.index`). The site reads the index at runtime (`/api/ship-tracks?op=gfwindex`;
in dev a local bake in `scripts/ships/bake-gfw/cache/out/gfw-v1/` wins), so new months need no code push.

- **Preference rule**: where NOAA per-minute AIS exists for a month and area, NOAA wins. `areas.NOAA_AREAS`
  lists NOAA's boxes (the Salish detail box, whose months come from `trackSource.json`, and approximate
  US-EEZ boxes, whose months come from the US-wide index). GFW positions inside a box in a month NOAA has
  published are dropped before lines are built, so there are never double lines; when NOAA publishes a
  month, re-running that month drops GFW there.
- **Line rules** as in the prototype (lines.py), plus: lines break at month boundaries; longitudes are
  unwrapped per line and split at ±180° on output (the 2026-09-29 "horizontal bands" across Alaska were
  segments crossing the antimeridian drawn the long way round); water paths are string-pulled.
- **GFW constraint that shapes the pipeline**: one running 4Wings report per user, so all fetching is
  serial (the workflow's fetch matrix has max-parallel 1). Measured for this area: a report costs
  20–40 s whether it spans 1 or 7 days (no pagination; 2-day Salish reports were 135k rows / 64 MB).
  Pacific Canada + Alaska + Salish ≈ **100 requests, 3.5 M rows, 1.7 GB JSON, ~55 min per month**.
- **Coastline data on runners**: `prepare_water.py` downloads OSM land polygons (~0.9 GB zip), the Alaska
  DNR layer and 48 NHN units once and builds `extras-v1.pkl` (195 MB); the workflow keeps it in the Actions
  cache (key `gfw-water-v1`). Only OSM polygons inside a job's boxes are loaded.
- **Upload**: one-file tokens from `api/cron/ships-upload-token.js` (CRON_SECRET). Its allowlist currently
  only admits `ships/tracks/us-v<N>/`; going live needs `(us|gfw)-v\d+` in both regexes (one-line change).
- **Routing v2 (Josh 2026-09-30)**, applied before launch:
  - *Tidal flats and marsh are land.* High-water coastlines plus the "water if any source says water"
    rule left tidal flats open; cruise ships' estimated paths crossed the Mendenhall Wetlands beside Juneau
    airport. `fetch_flats.py` pulls OSM `natural=wetland` (any `wetland=*`), `natural=mud`, `natural=shoal`
    and `tidal=yes` flats (natural = wetland/mud/sand/shoal/shingle; a tidal river stays water) from the
    Overpass API per 5° box (split on timeouts, mirror fallback), cached; they are drawn as land in every
    routing window, for every vessel (GFW rows carry no length, so small craft get no exception).
    Flats alone did NOT fix Juneau: OSM leaves a narrow water channel across the flats (the
    Mendenhall Bar channel).
  - *Traffic-informed cost.* `traffic.py`: distinct vessels per GFW 0.01° cell, widened ±600 m; cost 1
    (≥ 3 vessels), 1.6 (1–2), 8 (none). A path with no water route, or with > 10% of it where no ship has
    been, is searched again in a bigger window and the cheaper (traffic-weighted) path wins. At Juneau the
    wetland corridor has 0 vessels and Gastineau Channel at the docks 39–82, so the estimate now goes
    around Douglas Island (59 km instead of 30 km across the flats). String-pulling may not cut into
    costlier water. Not weighted by vessel size (no length in the hourly rows).
  - *Where the traffic raster comes from*: `bake.py traffic` writes one raster per month
    (`cache/land/traffic-v1/YYYY-MM.npz`); a route job sums every month present (plus the month being
    baked). In the workflow each fetch job writes its month's raster, route jobs read the cumulative set
    from the Actions cache plus this run's months, and a final job saves the merged set (key
    `gfw-traffic-v1-<run id>`), so the lanes sharpen as months accumulate.

