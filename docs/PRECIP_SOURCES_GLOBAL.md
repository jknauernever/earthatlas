# Measured precipitation outside the US: a sourced catalogue (2026-09-23)

**The question behind this doc.** Josh was looking at Hurricane Polo off
Acapulco at z5.3 and asked how to get sharper rain data for storms like it,
because other sites look "beautifully high resolution". The map currently
draws blocky 11 km GSMaP pixels there.

**The short answer.** No measured, continuously updated rain product sharper
than 0.1° (about 11 km) covers the open ocean anywhere in the world in near
real time. Sharper measured rain comes from three places only:

1. **Ground radar** (1 km or better). It reaches only about 150–450 km from
   each radar, so it covers land and coasts, never a hurricane 300+ km out at
   sea.
2. **Microwave swaths from low-orbit satellites** (about 5 km: GPM GMI/DPR,
   and coarser MiRS). Each one is a snapshot, taken a few times a day.
3. **IR-only geostationary estimates** (0.04°: PDIR-Now, PERSIANN-CCS). These
   have the same weakness that got GOES RRQPE removed.

The "beautiful" sites mostly show 0.5–2 km geostationary **cloud imagery**, or
**model** rain, or radar near coasts (§4).

**How this was measured.** All measurements were taken 2026-09-23 between
21:44 and 22:00 UTC. "Latency" means the newest frame's data time compared
with the UTC clock at the moment of the request. Anything not confirmed by a
request or an official doc is marked **UNVERIFIED**. Work already recorded in
`docs/CLOUDS_API.md` and `docs/HANDOFF-PRECIPITATION.md` §5a is not repeated
here.

**Storm position used throughout.** Hurricane Polo (ep172026) was at
**15.7N 102.4W, 125 kt**, per NHC `https://www.nhc.noaa.gov/CurrentStorms.json`
(lastUpdate 21:00Z).

---

## 1. Comparison table

"Measured?" says what kind of measurement the product is:
- **radar**: ground weather radar.
- **MW**: passive microwave, which senses rain drops and ice directly.
- **IR**: infrared cloud-top temperature, which infers rain from cloud tops.
- **model**: forecast output, not a measurement.

| source | measured? | resolution | cadence | measured latency | coverage | open archive | license for our use | access |
|---|---|---|---|---|---|---|---|---|
| **GIBS `GMI_Precipitation_Rate_Asc/Dsc`** | MW swath (GPM GMI) | tiles to z6 (~2.4 km px); GMI 89 GHz footprint 5×8 km | daily composite of swaths | today's date is already served at 21:50Z, after a 16:42Z pass | global, swath gaps | **2014-03-04 → today** (with gaps) | NASA open data, credit NASA | WMTS, no key, CORS open |
| GPM 2A-DPR / 2A-GPROF / 2B-CMB NRT (PPS) | radar in orbit / MW | 5×5 km (DPR, CMB); 5×8 km (GPROF) | per orbit, ~16 per day, narrow swath | doc: 20–120 min (DPR), 2 h (GPROF), 3 h (CMB). Not measured | global ±65°, swath only | 2 weeks on NRT server | NASA CC0, credit NASA | free PPS registration |
| NOAA MiRS rain rate (NOAA-20/21, S-NPP) | MW swath | footprints (size UNVERIFIED) | per granule, 32 s | 12–37 min | global, swath | on S3 (depth not checked) | NOAA open data | S3 anonymous |
| CMORPH2 NRT (CPC) | MW + IR blend | **0.25°** public (made at 0.05°, not posted) | 30 min | ~49 min | global | 2023 → | not stated (NOAA) | HTTPS, no CORS |
| PDIR-Now / PERSIANN-CCS (CHRS) | **IR only** (PDIR-Now confirmed; CCS UNVERIFIED) | 0.04° | 1 h | 7–10 min after hour ends | 60N–60S | 2000 → | **UNVERIFIED** ("All rights reserved" footer) | HTTPS, no CORS |
| IMERG Early (native) | MW + IR | 0.1° | 30 min | 4 h 20 min | global | long | NASA CC0 | Earthdata login |
| **EUMETNET OPERA** | radar | DBZH 1 km; RATE 2 km | 5 min (DBZH), 15 min (RATE) | ~5 min / ~20 min | 24 European countries, 165 radars | **2012 →** | **CC BY 4.0** | S3 anonymous, no CORS |
| DWD RV / HX / RY | radar | 1 km | 5 min | 5–8 min | Germany (+ margin) | ~48 h on server | CC BY 4.0 | HTTPS, no CORS |
| KNMI composites | radar | 1 km | 5 min | ~6 min | Netherlands (+ margin) | 2019 → | CC BY 4.0 (rtcor UNVERIFIED) | anonymous shared key, CORS `*` |
| FMI Finland | radar | **250 m** | 5 min | ~6 min | Finland | 2022 → | CC BY 4.0 | S3, CORS `*` |
| SMHI Sweden | radar | 2 km | 5 min | ~6 min | Sweden | 2008 → | CC BY 4.0 | HTTPS, CORS `*` |
| DMI Denmark | radar | not checked | 5 min | ~13 min | Denmark | not checked | CC BY 4.0 | STAC, no CORS |
| MET Norway | radar (PNG only) | 659×761 image | 10 min | ~8 min | Nordic | ~3 h | NLOD 2.0 / CC BY 4.0 | CORS `*`, User-Agent required |
| UK Met Office | radar | 1 km | 15 min | ~23 min | UK + Ireland | 2024-11 → | **CC BY-SA 4.0 (share-alike)** | S3, CORS `*` |
| Météo-France | radar | 1 km (500 m rain depth) | 5 min | UNVERIFIED (401 without account) | France + overseas | 20 h | Licence Ouverte 2.0 | free account |
| **ECCC GeoMet `RADAR_1KM_RRAI`** | radar | 1 km | 6 min | ~6 min | Canada + US mosaic | 3 h | ECCC licence, commercial OK; **bulk WMS tile harvesting prohibited** | WMS, CORS `*` |
| **JMA nowcast `hrpns`** | radar | **250 m** land/coast, 1 km sea | 5 min | ~4 min | Japan | ≥24 h (undocumented) | PDL1.0 (≈ CC BY 4.0), commercial OK, must state it was processed | PNG tiles, CORS `*` |
| **CWA Taiwan O-A0059-001** | radar (dBZ grid) | 0.0125° (~1.25 km) | 10 min | ~12 min | Taiwan | 10 days | Taiwan OGDL v1 (≈ CC BY 4.0) | S3 JSON, CORS `*` |
| MRMS ALASKA / CARIB / HAWAII / GUAM | radar | 1 km (AK, CARIB); 0.5 km (HI, GU) | 2 min | ~4 min | US states and territories | 365+ d (same bucket as CONUS) | NOAA open data | S3 anonymous |
| RainViewer | radar composite | tiles **max z7** | 10 min | ~4 min | ~1200 radars worldwide | 2 h | **personal/educational only** | CORS `*` |
| BoM Australia | radar (PNG) | 512×512 images | 5–10 min | 3–4 min | Australia | short | **no commercial use** | FTP |
| KMA Korea | radar | UNVERIFIED | UNVERIFIED | UNVERIFIED | Korea | — | KOGL type UNVERIFIED | key + phone verification |
| Mexico SMN | radar (GIF/PNG) | pre-rendered images | ~5–15 min | 4–15 min | 7 SMN/SENEAM radars | ~25 frames | **none found** | no CORS |
| IMD India | radar (GIF) | per-radar images | — | ~4 min | India | — | none found (© MoES) | CORS restricted |
| Brazil REDEMET | radar (PNG) | — | — | — | 27 radars | — | none found | key |
| SAWS South Africa | — | — | — | — | — | — | no open feed found | — |
| EUMETSAT H SAF H60/H63/H40B | MW + IR blend | ~3 km sampling (H60); ~2 km (H40B, MTG) | 15 min (H60); 10 min (H40B) | UNVERIFIED | MSG/MTG discs. **Not Mexico** | 60 days on FTP | CC BY 4.0 ("Core") | FTP registration |
| ECMWF / GFS / ICON precipitation | **model, not measurement** | 9–25 km | 1–6 h | none (forecast) | global | — | varies | — |

---

## 2. Satellite sources

### 2.1 NASA GIBS: GMI precipitation rate (swath composite). New finding.

- **Found by:** my own request, `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/1.0.0/WMTSCapabilities.xml`
  (5,798,919 bytes). Layers `GMI_Precipitation_Rate_Asc` and
  `GMI_Precipitation_Rate_Dsc`, titled "Precipitation Rate
  (Ascending/Descending, GMI, GPM)".
- **Tile matrix set:** `GoogleMapsCompatible_Level6`, PNG. The z6 pixel is
  ~2.4 km, against GMI's 5×8 km 89 GHz footprint (per the
  https://gpm.nasa.gov/data/directory figure for GPROF).
- **Time dimension:** `P1D`, ranges `2014-03-04/2026-02-10`,
  `2026-02-12/2026-03-06`, `2026-03-08/2026-05-25` and `2026-05-28/2026-09-23`,
  with default `2026-09-23`. So **today is already served**; the gaps are
  real outages. Each day is a composite of that day's ascending or descending
  passes, not a continuous field.
- **Colour map:** `https://gibs.earthdata.nasa.gov/colormaps/v1.3/GPM_Precipitation_Rate.xml`.
  This is the **same file as IMERG**, and it has three maps: "Classifications",
  "Rain Rate" (mm/hr) and "Snow Rate" (mm/hr).
- **Requests (all 200):**
  - `…/GMI_Precipitation_Rate_Dsc/default/2026-09-23/GoogleMapsCompatible_Level6/6/{28,29}/{13,14}.png`
    returned 4.4–12.6 KB per tile.
  - The IMERG_30min tiles for the same area at `2026-09-23T15:30:00Z` returned
    2.5–4.3 KB.
- **Covers Polo:** yes. Viewed side by side, the GMI Dsc tile shows Polo with
  a resolved **eye and spiral bands**; IMERG at the same tiles shows
  11 km blocks. That day's GMI pass over Polo is at **16:42:07Z**, per NRL
  (§2.4). The tile carries no pass time, so matching this tile to that pass
  is **UNVERIFIED**.
- **Caveat, found while decoding:** of the non-transparent pixels in tile
  6/29/13, **26,166 match the "Snow Rate" ramp and 1,318 the "Rain Rate"
  ramp** (exact RGB lookup, 0 unmatched). IMERG's tile was 32,700 Rain Rate
  and 0 Snow. Why GIBS renders most of a tropical cyclone in the snow ramp is
  **UNVERIFIED**. It may be GPROF's frozen-precipitation field. **Do not
  decode this layer to mm/h until the rendering rule is confirmed with GIBS
  or GPROF docs.**
- **License:** NASA open data (CC0 unless marked), credit NASA
  (https://www.earthdata.nasa.gov/engage/open-data-services-software-policies/data-use-guidance).
  The GIBS capabilities document says `Fees none`, `AccessConstraints none`.
- **Verdict:** a measured microwave close-up of a storm, available today, with
  12 years of archive and zero infrastructure. But it is a **once-or-twice-a-day
  snapshot**, so it cannot be the "Now" rung. That would present a 5-hour-old
  pass as now, breaking the rule "never two moments presented as one". It
  fits an explicitly time-stamped "latest satellite pass" overlay.
- Other GIBS rain layers (AMSR2, SSM/I, TRMM, AIRS) are daily and/or retired;
  `AMSRU2_Surface_Precipitation_*` ends 2025-09-01.

### 2.2 GPM swath products at native resolution (PPS near-real-time)

- **Specs** (https://gpm.nasa.gov/data/directory), not measured:

  | product | NRT latency | resolution |
  |---|---|---|
  | 2A-DPR | 20–120 min | 5×5 km, 125 m vertical |
  | 2A-GPROF (GMI) | 2 h | 5×8 km |
  | 2B-CMB | 3 h | 5×5 km |

- **Access:** the NRT server `https://jsimpsonhttps.pps.eosdis.nasa.gov/`
  returned **401**. It needs free PPS registration with "Near-Realtime
  Products" ticked, and keeps 2 weeks.
- **GES DISC production copies** (Earthdata login) were ~20 h behind:
  `GPM_2AGPROFGPMGMI.08`, newest orbit ended 22:34Z on 09-22 and was posted
  18:24Z on 09-23, 240 MB. 2A-DPR is 364 MB per orbit.
- **License:** NASA CC0.
- **Verdict:** the sharpest *measured quantitative* rain over open ocean that
  exists. It needs a registration and a swath bake, and it is still a
  snapshot. The DPR swath is narrow (~245 km per the GPM mission docs; the
  number is UNVERIFIED in this session), so it often misses a given storm.

### 2.3 NOAA MiRS rain rate (JPSS microwave)

- **Location:** `https://noaa-nesdis-n20-pds.s3.amazonaws.com/?list-type=2&prefix=NPR_MIRS_IMG/2026/09/23/`
  (also `n21`, `snpp`).
- **Latency:** newest files posted 21:57Z for scans at 21:20Z (NOAA-20) and
  21:45Z (NOAA-21), so **12–37 min**.
- **Format:** NetCDF, 389 KB per 32 s granule, 12×96 footprints, variable
  `RR` in mm/hr.
- **Polo:** NOAA-20 crossed 19:48–19:50Z, max 12.9 mm/h, 257 footprints
  within ±2.5°.
- **License:** "can be used as desired", credit requested
  (https://registry.opendata.aws/noaa-jpss/).
- **Verdict:** measured and fresh, but footprints are coarse (size
  UNVERIFIED). Not sharper than GSMaP.

### 2.4 NRL tropical-cyclone pages (GeoIPS tcweb4)

- **API:** `https://science.nrlmry.navy.mil/geoips/prod_api/tcweb4`, found in
  the page's JS (`main-L22CXP3X.js`). CORS `*`. The JS carries
  `distroStatement: "Distribution Statement A. Approved for public release:
  distribution is unlimited."` Endpoints:
  - `/active-storms`
  - `/storms/{id}/platform-sensor-products`
  - `/products/summary/{id}`
  - `/products/{year}?storm_id=&product=&platform=`
  - `/track/{id}`
- **`/products/summary/ep172026` at ~21:47Z listed:**
  - GPM GMI 89H / color89 / color37, latest **16:42:07Z**
  - WSF-M MWI 89 GHz, 13:36Z
  - AWS MWR, 16:41Z
  - F16/F17/F18 SSMIS, latest 11:07Z
  - IMERG "Rain", latest 15:30Z
  - MetOp AMSU/MHS RainRate, last on 09-21
- **The GMI image:** color89 at 16:42Z is
  `…/products/ep172026/8759287`, a 1557×1591 WebP of 171,802 bytes, posted
  19:19Z. It is a flat, annotated image of **89 GHz brightness, not rain
  rate**.
- **Verdict:** great reference imagery, and the source of the crisp "eye in
  microwave" pictures seen on Tropical Tidbits. It is not a data layer.

### 2.5 CMORPH2 (NOAA CPC)

- **Directory:** `https://ftp.cpc.ncep.noaa.gov/precip/CMORPH2/CMORPH2NRT/DATA/2026/202609/20260923/`
  returned 200.
- **Only 0.25° is public:** the readme `readme_CMORPH2x_NRT.txt` says only the
  0.25° NetCDF files are uploaded "as of February 2023", for disk-space
  reasons. The 0.05° product is not public.
- **Newest file:** `CMORPH2_0.25deg-30min_202609232030.RT.nc`, 553,387 bytes,
  posted 21:15:19Z, **~49 min** after its window ended.
- **Polo:** covered, max 27.3 mm/h.
- **Access and license:** no CORS header. License not stated.
- **Verdict:** fresher than IMERG but **coarser than GSMaP**. No gain.

### 2.6 PDIR-Now and PERSIANN-CCS (UC Irvine CHRS)

- **Files:**
  - `https://persiann.eng.uci.edu/CHRSdata/PDIRNow/PDIRNow1hourly/2026/pdirnow1h26092320.bin.gz`
  - `…/PERSIANN-CCS/hrly/2026/rgccs1h2626620.bin.gz`
- **Grid:** 0.04°, 3000×9000, 60N–60S, int16 mm/h ×100. Files are
  3.9 MB / 1.8 MB gzipped. Posted **7–10 min after the hour**. Archive from
  2000.
- **Polo:** covered, max 70.2 / 37.2 mm/h.
- **IR only:** PDIR-Now uses only 11 µm IR at run time, with microwave used
  for calibration (https://pmc.ncbi.nlm.nih.gov/articles/PMC8216223/). The
  authors note weaker low-rate skill. CCS is also IR cloud classification
  (not confirmed from a CHRS doc; UNVERIFIED).
- **License:** no CORS. No terms of use found; the portal footer says
  "All rights reserved" (**license UNVERIFIED, treat as blocked**).
- **Verdict:** sharp, but it is **the RRQPE problem again**, plus an unknown
  license. Not recommended.

### 2.7 JAXA variants

- **Nothing finer than 0.1°** (https://sharaku.eorc.jaxa.jp/GSMaP/guide.html).
- **GSMaP_RNC** is a **5-hour forecast**
  (https://sharaku.eorc.jaxa.jp/GSMaP_RNC/index.htm), so it is model, not
  measurement.
- **P-Tree / Himawari** has no rain product
  (https://www.eorc.jaxa.jp/ptree/userguide.html). Its terms limit Himawari
  data to non-profit use with no redistribution
  (https://www.eorc.jaxa.jp/ptree/terms.html), and its area does not reach
  102W.

### 2.8 IMERG Early at native resolution

- **Spec:** 0.1°, the same grid as GIBS.
- **Latency:** newest `3B-HHR-E…20260923-S163000-E165959…V07C.HDF5` (7.6 MB)
  was posted 21:20Z, **4 h 20 min** after its window, at
  `gpm1.gesdisc.eosdis.nasa.gov/data/GPM_L3/GPM_3IMERGHHE.07/2026/266/`
  (Earthdata login).
- **Verdict:** no resolution gain over what we show.

### 2.9 EUMETSAT H SAF

- **Resolution and cadence:**
  - H60/H60B (MSG 0°) and H63 (IODC): ~3 km sampling, 4.8–8 km footprint,
    15 min
    (https://hsaf.meteoam.it/service/pdf/SAF_HSAF_ATBD_H60-63_V2_2.pdf).
  - H40B (MTG-FCI successor): ~2 km, 10 min
    (https://hsaf.meteoam.it/service/pdf/SAF_HSAF_PUM_H40B_1_3f.pdf).
  - H90: UNVERIFIED.
- **Access:** FTP `ftp://ftphsaf.meteoam.it` refused anonymous login with
  **530**, so registration is required. It holds 60 days.
- **License:** CC BY 4.0 as EUMETSAT "Core" data, credit "copyright (year)
  EUMETSAT" (EUMETSAT Data Policy,
  https://www-cdn.eumetsat.int/files/2026-01/45173%20-%20Data_Policy.pdf).
- **Mexico: not covered.** 100.8W is ~100.5° of arc from the 0° sub-satellite
  point, beyond the ~81° geostationary horizon. This is our own geometry, not
  a documented figure.
- **Verdict:** a candidate sharper tier for **Europe and Africa**. It is
  MW-calibrated IR, so check its light-rain behaviour before trusting it (the
  RRQPE lesson).

---

## 3. Ground radar

### 3.1 RainViewer

- **Index:** `https://api.rainviewer.com/public/weather-maps.json` returned
  200 (818 B, `access-control-allow-origin: *`, `cache-control: no-cache`).
  - 13 past frames at 10 min spacing, 19:40Z → **21:40Z**, requested at
    21:44:31Z.
  - `nowcast: []` and `satellite.infrared: []`.
- **Tile format:** `{host}{path}/{256|512}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png`.
- **Measured zoom limit:**
  - z5 and z7 return real tiles.
  - **z8 and z10 return a 1,370-byte image reading "Zoom Level Not
    Supported"** (identical MD5 `2cc6649e…`) with HTTP 200. That is a trap
    for any absence detection.
- **Polo:** the z5 tile 7/14 shows Mexican land radar echoes near 95W, 17N.
  Nothing at the storm. The z7 tile 28/58 is fully transparent.
- **Terms** (https://www.rainviewer.com/api.html): "free for personal or
  educational use only".
- **Transition FAQ** (https://www.rainviewer.com/api/transition-faq.html):
  - Composite imagery halted for the free tier on 2025-09-01.
  - On 2026-01-01: nowcast and satellite IR discontinued, **max zoom 7**,
    only the "Universal Blue" scheme, **100 requests/IP/minute**.
- **Verdict: rejected.** The license excludes us, it stops at z7 (~1.2 km/px
  at the equator, and blurred), and its colours are pre-rendered.

### 3.2 NOAA MRMS non-CONUS domains (extends the existing bake)

- **Domains:** `https://noaa-mrms-pds.s3.amazonaws.com/?list-type=2&delimiter=/`
  lists `ALASKA/ ANC/ CARIB/ CONUS/ CONUS_5KM/ ConvectProb/ GUAM/ HAWAII/
  ProbSevere/`.
- **Products:** each domain has `PrecipRate_00.00`, `RadarOnly_QPE_01H`,
  `MultiSensor_QPE_01H_Pass1` and `SyntheticPrecipRateID`.
- **Newest files:** every domain's newest was
  `MRMS_PrecipRate_00.00_20260923-214200.grib2.gz` at 21:46Z, so ~4 min.
  652 files for the day, consistent with a 2-minute cadence.
- **Grids** (read from GRIB2 section 3 of the 21:42Z files):

  | domain | grid | lat | lon | size (gz) | area with radar coverage | raining >0.1 mm/h |
  |---|---|---|---|---|---|---|
  | CARIB | 3000×1500 @0.01° | 10.005–24.995N | 90W–60W | 72.6 KB | 20.4% | 1.2% |
  | HAWAII | 2600×2200 @**0.005°** | 15.0–26.0N | 164W–151W | 198.6 KB | 65.1% | 3.5% |
  | GUAM | 2000×1800 @**0.005°** | 9.0–18.0N | 140–150E | 127.2 KB | 60.9% | 2.9% |
  | ALASKA | 5000×2200 @0.01° | 50.0–72.0N | 176W–126W | 81.8 KB | 43.2% | 0.5% |

- **CARIB coverage** (1° map of cells ≥0): two blobs.
  - ~86–78W × 20–24N: S Florida Straits and western Cuba.
  - ~71–62W × 14–22N: Hispaniola, Puerto Rico, Virgin Islands.
  - **It does not reach Mexico's Pacific coast.**
- **Format and license:** same packing as CONUS (template 5.41, PNG; R=−30,
  D=1; negatives are coverage flags). License: "NOAA data disseminated through
  NODD are open to the public and can be used as desired"
  (https://registry.opendata.aws/noaa-mrms-pds/).
- **Verdict:** near-zero-effort sharp tiers for US territories. Irrelevant to
  Polo.

### 3.3 Mexico (SMN / CONAGUA). The storm question.

- **Radar list:** the viewer `https://smn.conagua.gob.mx/tools/GUI/visor_radares_v3/`
  loads `utils/radarsDB.json`. Frames are listed by
  `…/tools/PHP/RDA/static/php/RDA_repository.php?dir=ecos&type=json` (976
  files) and served as pre-coloured 2000×2000 GIFs, e.g.
  `…/ecos/CATE_PPIX_REFL_220_N005_20260923_214336.gif`.
- **Format and timing:** no CORS. Filename times are UTC, cross-checked
  against NEXRAD KYUX.
- **Latencies at 21:58Z:**
  - Catedral: 14.9 min
  - Los Cabos: 4.3 min
  - Guasave: 8.5 min
  - Sabancuy: 13.2 min
  - Cancún: 8.2 min
  - IAM-UDG: stale since 09-21
- **Acapulco radar** (16.763, −99.749, ~300 km range):
  - It exists only in the old v1 viewer. No files are in the repository, so
    it is **not publishing**.
  - It is **307 km** from Polo's 21Z center, so it would be just out of range
    even if it were.
  - No SMN radar covers Polo.
- **License:** no terms found (**UNVERIFIED, treat as blocked**).
- **Note:** Zoom Earth credits Mexico's weather service in its radar mosaic
  (§4).

### 3.4 Europe

- **EUMETNET OPERA, open data** (docs
  https://eumetnet.github.io/openradardata-documentation/2-ORD-API-discovering-and-accessing-data/):
  - **Access:** live bucket `https://s3.waw3-1.cloudferro.com/openradar-24h`,
    archive `…/openradar-archive` (from 2012). Keys look like
    `YYYY/MM/DD/OPERA/COMP/OPERA@YYYYMMDDTHHMM@0@{DBZH|RATE|ACRR}.{h5|tiff}`.
  - **DBZH:** max reflectivity, 1 km, 3800×4400, 5 min. Newest 21:45 was
    posted 21:49:02. 2.16 MB h5.
  - **RATE:** "NIMBUS instantaneous rain rate", 2 km, 1900×2200, 15 min, LAEA
    projection. Newest 21:30 was posted 21:40.
  - **Coverage:** 165 radars, 24 countries, ~31.7–67.6N.
  - **CORS:** none (preflight **403**), so a server-side bake is required.
  - **Rate limits:** the Meteogate API returned **429** on first call
    (`X-RateLimit-Limit: 200`, shared). Use S3.
  - **License:** file metadata says CC BY 4.0, institution EUMETNET.
- **National sources:**
  - **DWD:** `https://opendata.dwd.de/weather/radar/composite/rv/composite_rv_LATEST.tar`,
    3.84 MB, 25 ODIM files including a 2 h nowcast. Credit "Quelle: Deutscher
    Wetterdienst" (for rendered data, "…Rasterdaten bildlich wiedergegeben").
  - **KNMI:** the anonymous shared key hit 429 repeatedly.
  - **FMI:** 250 m GeoTIFF, `fmi-opendata-radar-geotiff` S3.
  - **SMHI, DMI and MET Norway:** see the table.
  - **UK Met Office:** `met-office-radar-obs-data` S3 is **CC BY-SA**, so
    derived tiles would have to be CC BY-SA too.
  - **Météo-France:** 401 without an account (Licence Ouverte 2.0, 850
    requests per 5 min).
  - **AEMET:** a key appears to be required.

### 3.5 Canada: ECCC GeoMet

- **Request:** `https://geo.weather.gc.ca/geomet?service=WMS&version=1.3.0&request=GetCapabilities&layer=RADAR_1KM_RRAI`
  returned 200.
- **Time dimension:** `2026-09-23T18:42:00Z/2026-09-23T21:42:00Z/PT6M`, so
  **6 min cadence, ~6 min latency, 3 h window**.
- **Coverage:** North American 1 km mosaic from up to 180 Canadian and US
  radars.
- **Access:** GetMap PNG 200, CORS `*`, no key.
- **License:** ECCC Data Servers End-use Licence
  (https://eccc-msc.github.io/open-data/licence/readme_en/). Commercial use is
  allowed. Credit "Data Source: Environment and Climate Change Canada". The
  NEXRAD third-party portion is not granted by the licence.
- **Usage policy** (https://eccc-msc.github.io/open-data/usage-policy/readme_en/):
  **"Bulk and batch retrieval of WMS tiles is prohibited"**. It may be used
  as a live WMS source, not harvested into our own pyramid. Datamart has
  per-radar GIFs only.

### 3.6 Asia-Pacific

- **JMA:**
  - `https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json`
    lists 37 observed frames at 5 min. Newest basetime 21:45Z at 21:48:57Z,
    so ~4 min.
  - Tiles are at `…/nowc/{basetime}/none/{validtime}/surf/hrpns/{z}/{x}/{y}.png`,
    native z4/6/8/10, CORS `*`. Empty tiles are a 334-byte PNG with status 200.
  - Resolution is 250 m over land and coast, 1 km at sea
    (https://www.jma.go.jp/jma/kishou/know/kurashi/highres_nowcast.html).
  - License PDL1.0 (https://www.jma.go.jp/jma/kishou/info/coment.html):
    commercial use OK. Derived images must be labelled as processed. The
    forecast frames (N2) may touch Meteorological Service Act Art. 17
    (UNVERIFIED). Use observed N1 frames only.
- **CWA Taiwan:**
  - `O-A0059-001` redirects to
    `https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0059-001.json`
    (8.93 MB, no key, CORS `*`).
  - Grid is 921×881 at 0.0125°, dBZ, 10 min, ~12 min latency, 10-day history
    API.
  - License: Open Government Data License v1 (https://data.gov.tw/license).
- **BoM:**
  - `ftp://ftp.bom.gov.au/anon/gen/radar/` holds pre-coloured PNGs, 3–4 min
    latency.
  - License (https://www.bom.gov.au/copyright): "You must not supply it to
    any other person or use it for any commercial purpose". Radar data is a
    paid registered service. **Blocked.**
- **KMA:** `apihub.kma.go.kr` returned 401. Needs an account and phone
  verification; KOGL type for radar UNVERIFIED.
- **IMD:** per-radar GIFs only, no licence. **Blocked.**
- **Brazil REDEMET:** needs a key (401), no licence found.
- **SAWS:** no open feed.
- **Singapore NEA:** 5-min PNG, licence UNVERIFIED.
- **Hong Kong HKO:** the open API returns gauges, not radar.

---

## 4. What the "beautiful" sites actually show

Summarised from each site's own docs:

| site | rain over open ocean | radar | the sharp storm look |
|---|---|---|---|
| Zoom Earth | **model**: ICON 13 km / GFS 22 km (zoom.earth/sources/) | measured mosaic incl. Mexico's weather service, MRMS, OPERA (zoom.earth/legal/radar/) | GOES / Meteosat / Himawari imagery |
| Windy | "Rain, thunder" = **model**. "Radar+" outside radar = IR cloud-top colouring (community.windy.com/topic/3361, /topic/8820) | measured | IR 10.8 µm |
| RainViewer | nothing since 2026-01-01 (IR removed) | measured | — |
| Tropical Tidbits | no rain field | — | GOES/Himawari/Meteosat IR/visible 0.5–3 km (tropicaltidbits.com/sat/), plus NRL microwave images |
| NHC | no rain field | — | GOES GeoColor/IR/WV (nhc.noaa.gov/satellite.php) |
| The Weather Company | satellite + lightning + **model** blend over oceans (weathercompany.com blog) | NOWRad 5 km where land radar exists (developer.weather.com/docs/weather-imagery) | 4 km / 30 min |
| MyRadar | proprietary, undisclosed satellite estimate | measured | — |
| Ventusky | **model** (GFS/ICON/ECMWF) | WORAD | CIRA GeoColor |
| Google | Global MetNet **ML model** ~5 km / 15 min (arxiv.org/abs/2510.13050) | — | — |

So when a hurricane looks razor-sharp on those sites, the viewer is almost
always seeing one of three things:

1. **Geostationary cloud imagery** (GOES ABI GeoColor/IR at 0.5–2 km, every
   10 min, or 1 min in mesoscale sectors on CIRA SLIDER, e.g.
   `https://slider.cira.colostate.edu/data/json/goes-18/full_disk/geocolor/latest_times.json`
   gave 20260923213021). The 0.5–2 km band figures are UNVERIFIED in this
   session.
2. A **smooth model precipitation field**.
3. A **microwave snapshot** (NRL 89 GHz).

**None** of them shows a measured, continuously updated rain field sharper
than ~10 km over open ocean. That field does not exist publicly.

---

## 5. Implications (for discussion, not decided)

- **For a storm at sea**, the honest sharp view is two things:
  - Cloud imagery at 2 km, which is already baked (GMGSI) or available
    (GIBS GeoColor).
  - A **clearly time-stamped microwave pass** (GIBS GMI daily swath now;
    PPS 2A-DPR/GPROF with registration later) over the 11 km live rung.
    Showing the pass as "now" would violate "never two moments presented as
    one".
- **Sharper rain on land** outside the US is a set of radar tiers:
  - OPERA (Europe, CC BY 4.0, S3 bake).
  - JMA (Japan, 250 m, PNG tiles).
  - CWA (Taiwan grid).
  - ECCC (Canada, live WMS only).
  - MRMS CARIB/HAWAII/ALASKA/GUAM (existing bake).
- **Rejected on license:** RainViewer, BoM, Mexico SMN (no terms), IMD,
  PERSIANN/PDIR (no terms), JAXA P-Tree Himawari. UK Met Office is usable
  only under share-alike.
- **Rejected on physics:** PDIR-Now/PERSIANN-CCS and Hydro-Estimator (IR
  only, the RRQPE lesson). CMORPH2 public 0.25° is coarser than GSMaP.
