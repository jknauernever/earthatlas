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
