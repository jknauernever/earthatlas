# Worldwide ship-density background layer: sources

Research for /ships, 2026-09-25. Facts only. Anything not checked against a primary
source is marked **UNVERIFIED**.

## 1. World Bank / IMF "Global Shipping Traffic Density"

### Catalog facts

| Field | Value | Source |
|---|---|---|
| Title | **Global Shipping Traffic Density** | [WB Data Catalog 0037580](https://datacatalog.worldbank.org/search/dataset/0037580/global-shipping-traffic-density) |
| Publisher | The World Bank (dataset owner), in partnership with the IMF | catalog page; [Ifremer Sextant mirror record](https://sextant.ifremer.fr/geonetwork/srv/api/records/18267ef1-14c2-4fa2-865c-2c21e71b2c67?language=eng) (author: IMF World Seaborne Trade Monitoring System; publisher: World Bank) |
| Authors / method | IMF World Seaborne Trade Monitoring System, citing Cerdeiro, Komaromi, Liu and Saeed (2020), IMF WP/20/57, [paper](https://www.imf.org/en/Publications/WP/Issues/2020/05/14/World-Seaborne-Trade-in-Real-Time-A-Proof-of-Concept-for-Building-AIS-based-Nowcasts-from-49393), DOI 10.5089/9781513544106.001. Funded by World Bank ESMAP and PROBLUE. | official [readme.txt](https://datacatalogfiles.worldbank.org/ddh-published/0037580/DR0084213/readme.txt) |
| Purpose | Built for the World Bank Group Offshore Wind Development Program (vessel types grouped for that program) | readme.txt |
| License | **Creative Commons Attribution 4.0** (catalog "License" field). Esri's Living Atlas copy says CC BY 4.0, "World Bank Group, IMF" as credit. | catalog page; [Esri item](https://www.arcgis.com/home/item.html?id=2f72eb72cc0b403bb19a7cd1853f3d94) |
| Attribution | CC BY 4.0 requires credit. The catalog shows no specific "cite as" string (**UNVERIFIED**: the catalog API that holds the full metadata was rate-limited all session, 429). A safe credit: "Global Shipping Traffic Density, World Bank / IMF (Cerdeiro et al. 2020), CC BY 4.0", linked to the catalog page. | |
| Time span | **Jan 2015 – Feb 2021** | readme.txt |
| Temporal granularity | **One single aggregate over the whole span.** No per-year or per-month files. | readme.txt, file list |
| Spatial resolution | 0.005° × 0.005° (≈500 m at the equator) | readme.txt; confirmed by gdalinfo below |
| CRS | EPSG:4326 (WGS 84) | Sextant record; confirmed by gdalinfo |
| Units (as documented) | "total number of AIS positions" reported by ships per cell, from hourly AIS positions; includes moving **and** stationary ships, so "analogous to the general intensity of shipping activity" | readme.txt |
| Format | GeoTIFF (with .ovr overviews, .aux.xml, .tfw) inside a ZIP | downloaded file |
| Data files last updated | 2021-05-03 (catalog); metadata updated 2023-01-18. The blob files were re-uploaded 2025-02-27 (HTTP Last-Modified); zip contents are dated 2021-03-26. | catalog page; HTTP headers |
| Contact | data@worldbank.org | catalog page |

### The six layers and their direct download URLs

All on the official World Bank host `datacatalogfiles.worldbank.org`. URLs were read from
the catalog's CKAN mirror ([data.opendata.am](https://data.opendata.am/dataset/dcwb0037580))
and confirmed live with HTTP HEAD (sizes are exact byte counts from HEAD).

| Layer | Vessel types (official readme_ddh.txt) | URL | Size |
|---|---|---|---|
| **Global (all ships)** | all ship types combined | https://datacatalogfiles.worldbank.org/ddh-published/0037580/DR0045406/shipdensity_global.zip | 534,907,276 B (510 MiB) |
| Commercial | bulk, general cargo, tugs, container, all tanker types, ro-ro, supply, dredgers, patrol, research, etc. | …/DR0045405/shipdensity_commercial_.zip | 480,353,369 B |
| Fishing | fishing vessel, trawler | …/DR0045403/ShipDensity_Fishing.zip | 101,738,134 B |
| Leisure ("Pleasure") | yacht, sailing vessel | …/DR0045401/ShipDensity_Leisure.zip | 29,425,517 B |
| Passenger | passenger ship, ro-ro/passenger ship | …/DR0045404/ShipDensity_Passenger.zip | 22,849,854 B |
| Oil & Gas | platforms, FSO/FPSO, jack-ups, drilling rigs, well stimulation vessels (not ships in transit) | …/DR0045402/ShipDensity_OilGas.zip | 21,450,048 B |
| Readme (types) | | …/DR0045407/readme_ddh.txt | |
| Readme | | …/DR0084213/readme.txt | |

Copies of both readmes are in the cache folder next to the zip.

### AIS source and coverage caveats

- The IMF paper (WP/20/57, section II) says its AIS data were **provided by MarineTraffic**,
  **down-sampled to hourly**, covering 2015-01-01 to 2020-04-18, "over one billion messages
  from over 50,000 distinct ships". It notes lower satellite coverage in deep oceans and
  message collisions, so real coverage is below one per hour.
- **UNVERIFIED**: that the density raster uses the same MarineTraffic feed. The raster runs
  to Feb 2021, past the paper's April 2020 end, so it is at least an extended pull. The
  readme only says "IMF's analysis of hourly AIS positions".
- **UNVERIFIED**: satellite vs terrestrial mix. The paper says AIS is picked up by both;
  it does not give a split.
- AIS carriage is mandatory only for ≥300 GT international ships, ≥500 GT domestic cargo,
  and all passenger ships (paper quoting SOLAS). Small craft are under-represented.

### Local copy and raster metadata (measured)

- Downloaded: `/Users/jknauer/Projects/earthatlas/scripts/ships/bake-ais/cache/worldbank/shipdensity_global.zip`
  (534,907,276 B; the folder is gitignored via `scripts/ships/bake-ais/.gitignore` `cache/`).
- **Not unzipped**: inside is a 9.8 GB **uncompressed** GeoTIFF plus a 3.3 GB `.ovr`
  (13.1 GB total). GDAL reads it in place: `gdalinfo /vsizip/<path>/shipdensity_global.zip/shipdensity_global.tif`.

gdalinfo:

| Property | Value |
|---|---|
| Size | 72,006 × 33,998 px, 1 band |
| Pixel size | 0.005° × −0.005° |
| Origin | (−180.0153113, 85.0026479) |
| Extent | lon −180.015 … 180.015, lat −84.987 … 85.003 (no data above 85° N / below 85° S) |
| CRS | EPSG:4326 |
| Data type | **Int32** |
| NoData | 2147483647 (none present in the sampled overview; land and empty sea are **0**) |
| Blocks | 128×128, uncompressed |
| Overviews | 36003×16999, 18002×8500, 9001×4250, 4501×2125, 2251×1063, 1126×532, 563×266, 282×133 |
| Stats (full res, from the shipped .aux.xml) | min 0, max **65,468,393**, mean 267,984, std 2,458,329 |

Downsampled read (overview 9001×4250, ≈0.04°):
- 90.1% of cells are 0.
- Non-zero cells (3.80 M): p1–p50 = **1**, p75 = 8, p90 = 10.2 M, p95 = 23.2 M, p99 = 33.3 M,
  p99.9 = 41.5 M, p99.99 = 49.4 M, max 61.5 M.

Full-resolution windows:
- Salish Sea (−125…−122, 47.5…49.5): 76% zero; non-zero p10 = 2, p25 = 3.5 M, p50 = 5.6 M,
  p90 = 42.6 M, max 47.9 M. The picture shows clear shipping lanes (Juan de Fuca, Haro,
  Rosario, Puget Sound).
- Singapore Strait (103…105, 0.5…2): 57% zero; non-zero p50 = 3.1 M, p90 = 17.2 M, max 18.4 M.

**Findings about the values (measured; cause UNVERIFIED):**
1. **The distribution is bimodal.** One cluster runs from 1 to about 1,000. The other runs
   from about 10^5.3 to 10^7.8. Almost nothing falls between them.
2. **The magnitudes do not fit a literal "count of hourly positions".** Summed over the
   whole grid (mean × cells) the total is about 6.6 × 10^14. The source paper had about
   10^9 hourly messages in total. A single 500 m cell at Haro Strait holds 38.5 M, which is
   more than 700 positions per hour for 6 years. Treat the values as **relative intensity**
   only. Do not show them to users as "positions" without an explanation.
3. Haro Strait (≈38 M) is higher than the Singapore Strait (≈9–18 M), which is the opposite
   of real traffic. This points to a scaling or aggregation artefact. **UNVERIFIED** cause.
4. For display, use a log or quantile ramp. A linear ramp would saturate.

### Newer version or IMF PortWatch derivative

- **No newer version found.** The catalog still lists the 2015–2021 files, and a search
  found no update. The Esri Living Atlas image service
  ([item](https://www.arcgis.com/home/item.html?id=2f72eb72cc0b403bb19a7cd1853f3d94),
  owner esri_oceans, created 2023-08-08, modified 2026-02-19) republishes the same
  Jan 2015–Feb 2021 data.
- **IMF PortWatch** ([portwatch.imf.org](https://portwatch.imf.org/)): its ArcGIS Hub
  dataset list (queried 2026-09-25) has 14 items, all feature services: ports, chokepoints,
  daily port and chokepoint data, trade, disruptions, spillover, climate risk. **There is no
  gridded density raster.** PortWatch uses satellite AIS from the UN Global Platform.

## 2. Global Fishing Watch options

### A. AIS vessel presence (all vessel types)

- Dataset `public-global-presence:v4.0` (API name "AIS"): start 2012-01-01, end
  2026-09-21 at the time of checking (≈96 h lag). One position per vessel per hour; unit =
  **hours**. All vessel types. Already documented in `docs/GFW_ACTIVITY_API.md`.
- **Not downloadable in bulk for all vessels.** GFW's
  [data availability page](https://globalfishingwatch.org/global-fishing-watch-data-availability/)
  marks AIS Vessel Presence on the Data Download Portal as "fishing vessels only".
  All-vessel presence is only available through the 4Wings API (tiles, reports: CSV, JSON,
  TIFF), the map, and the R/Python clients
  ([2025-06-25 announcement](https://globalfishingwatch.org/platform-update/global-ais-vessel-presence-dataset/)).
  4Wings report resolutions are LOW = 0.1° and HIGH = 0.01° (**UNVERIFIED** for presence;
  those values are from the fishing-effort docs).
- The downloadable fishing-effort grid
  ([Zenodo v3.0.0](https://zenodo.org/records/14982712)) covers **fishing vessels only**:
  CC BY-NC 4.0, 0.01° or 0.1°, daily and monthly, 2012–2024 (2024 provisional), CSV,
  26.3 GB.
- The Data Download Portal needs a user login. Our API token gets `[]` from
  `/v3/download/datasets` and 403 on a dataset id, so the portal catalog could not be
  listed programmatically.

### B. SAR vessel detections (Paolo et al. 2024, Nature)

- Paper: [Satellite mapping reveals extensive industrial activity at sea](https://www.nature.com/articles/s41586-023-06825-8).
- **Per-detection points: yes.**
  - Frozen paper data on [figshare 24309475](https://doi.org/10.6084/m9.figshare.24309475),
    **CC BY 4.0** (figshare license field), published 2024-03-22.
    `industrial_vessels_v20240102.csv.zip` (1.73 GB zipped, ≈1.5 GB CSV) holds detections
    from 2017–2021. Fields: scene_id, timestamp, lat, lon, length_m, mmsi (when matched),
    matching_score, and more. Also on figshare: `all_detections_matched_rand.feather`
    (2.49 GB) and `raster_5th_degree.feather` (0.2° grid).
  - Coverage: only the imaged area, over 15% of the ocean, mostly coastal (paper).
  - The companion code repo ([GitHub](https://github.com/GlobalFishingWatch/paper-industrial-activity))
    is dual-licensed Apache 2.0 and CC BY-NC 4.0. **UNVERIFIED** which of these governs the
    data versus the code. figshare says CC BY 4.0 for the data files.
- **Live, up-to-date version**: portal dataset `public-sar-vessel-detections:v20231026`
  ([portal page](https://globalfishingwatch.org/data-download/datasets/public-sar-vessel-detections:v20231026)).
  Covers 2017 to about 5 days ago; per-detection records with length, presence, matching
  and fishing scores, and AIS match
  ([2024-05-31 announcement](https://globalfishingwatch.org/platform-update/2024-may-data-download-portal-new-dataset-released-featuring-vessel-detections-from-sentinel-1-sar/)).
  The data availability page says it is updated daily. **UNVERIFIED**: file format and
  license on the portal (needs a login).
  - Also available as a 4Wings dataset, `public-global-sar-presence:v4.0` (2017 →).
- Resolution: Sentinel-1 detections are points. The detector finds vessels about ≥15 m
  long (**UNVERIFIED**, from the paper, not re-checked this session).

### C. GFW API terms: storing and republishing

Source: [License and Rate Limits / Terms of Use](https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits),
read 2026-09-25.

- **Storing**: the rate-limit section encourages it: "Store frequently accessed data
  locally to avoid repeated requests". There is **no clause** that forbids caching or
  retaining data.
- **Derived maps and tiles**: nothing explicitly allows or forbids republishing baked
  tiles. The relevant clauses:
  - §1.C: noncommercial use only, under CC BY-NC 4.0 (CC BY-NC itself allows adapted and
    shared material with attribution, for non-commercial use).
  - §2.E: you may not "create any derivative products from the API". The sentence is
    about reverse-engineering and modifying the API's source code. **UNVERIFIED** whether
    GFW reads it as also covering derived data products; ask GFW before publishing baked
    tiles.
  - §3.A.1: websites and visuals must show "Powered by Global Fishing Watch." linked to
    globalfishingwatch.org, or the full dataset citation.
  - §3.B: attribution must be "communicated and maintained by any partners or downstream
    users".
  - §4.B: "each dataset carries its own license and restrictions".
  - §2.G: the token must never appear in a public web interface.
- GFW may revoke access at any time (§1.C, §2.H).

## 3. Comparison for a worldwide /ships background layer

| | World Bank / IMF density | GFW AIS presence (4Wings) | GFW SAR detections |
|---|---|---|---|
| Vessels | all AIS ships (plus 5 type layers) | all AIS ships (filter by type, flag, speed) | any radar-visible vessel, including "dark" ones; ≈≥15 m (UNVERIFIED) |
| Time | one aggregate, 2015-01 → 2021-02 | 2012 → ~4 days ago, day/month bins | 2017 → ~5 days ago, sparse (satellite passes) |
| Resolution | 0.005° (~500 m) | 4Wings grid, up to ~0.01° (UNVERIFIED for presence) | points |
| Units | "AIS positions" per the readme, but the values look scaled (see above) | vessel-hours | detections |
| License | **CC BY 4.0** (commercial use OK, credit) | CC BY-NC 4.0 + GFW API terms (non-commercial, token server-side) | figshare 2017–21: CC BY 4.0; portal/API: GFW terms (UNVERIFIED) |
| Bulk file | yes, 535 MB zip / 9.8 GB GeoTIFF | no (API only for all vessels) | yes (figshare 1.7 GB; portal, login needed) |
| Coverage gaps | open ocean thin (satellite AIS), small craft missing | same AIS limits | only imaged, mostly coastal areas |
| Freshness | stale (ends Feb 2021, no update) | current | current |

## Side-by-side test (2026-09-25)

Local page: `localhost:5173/_ships_compare/` (untracked; tiles in the gitignored
`scripts/ships/bake-ais/build/compare/`). Scripts: `scripts/ships/bake-ais/gfw/`.

- **GFW:** all 1,024 zoom-5 presence tiles for Jul 2025 – Jun 2026 (801 with data,
  about 6 minutes). Regridded to 0.1° by area overlap, conserving the total of
  1.776 billion vessel-hours.
  - Python's default user agent gets a Cloudflare 403 (error 1010) from the
    GFW gateway, so the scripts send a named `User-Agent`.
- **World Bank:** the full 0.005° raster averaged to 0.02° with gdalwarp.
  Values under 1,000 (the low mode of the two-mode distribution) are treated as
  empty; this is our choice, because they render as speckle.
- **Colour:** both use the same ramp, log-scaled between each source's own 60th
  and 99.9th percentiles.
- **Result:**
  - GFW shows consistent shipping lanes worldwide, and its open ocean is clear.
    Its limits are 11 km blocks near coasts when zoomed in, and inland
    waterways (the Rhine, the Columbia) showing up.
  - The World Bank raster is much sharper in Europe and the US.
  - But the World Bank raster is **nearly empty across Southeast and East
    Asia**: the Singapore and Malacca Straits and the South China Sea barely
    show. This matches the value anomaly noted above (Haro Strait higher than
    Singapore). Its values are not comparable between regions, so it can't
    serve as a global layer.
