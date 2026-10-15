# Offshore wind sources: USWTDB + GEM Global Wind Power Tracker

Facts-only catalog, checked live 2026-10-14. Anything not confirmed from a fetched page or API response is marked **UNVERIFIED**.

Requests made: a few small USWTDB API calls (largest = all 129 offshore rows), HEAD requests on the bulk zips, the GEM tracker page, the GEM download-form script (read only, nothing submitted), the GEM public map config, a HEAD + first 1.5 KB of the GEM map GeoJSON, and two small GEM summary sheets as CSV. No file over 20 MB was downloaded.

---

## 1. US Wind Turbine Database (USWTDB)

Made by USGS Energy Resources Program, Lawrence Berkeley National Laboratory (LBNL) and the American Clean Power Association (ACP).

### Release
- **Current release: `USWTDB_V9_1_20260928`** (V9.1, September 28, 2026), shown on https://energy.usgs.gov/uswtdb/
- **77,839 turbines** in 45 states plus Guam and PR. The API's `Prefer: count=exact` count agrees (`content-range: 0-77838/77839`).
- Newest turbines in the release: operating by Q1 2026, a few from Q2 2026.
- Cadence (their words, paraphrased): updated "as frequently as quarterly", and releases lag installations by about one quarter.
- DOI: https://doi.org/10.5066/F7TX3DN0 ; ScienceBase: https://www.sciencebase.gov/catalog/item/5e99a01082ce172707f6fd2a
- Mirror warning: `eerscmap.usgs.gov/uswtdb/data/` still cites the June 26, 2026 release. Use **energy.usgs.gov**, which cites September 28, 2026.

### API
- Endpoint: **`https://energy.usgs.gov/api/uswtdb/v1/turbines`**. It is PostgREST 12.2.3. The OpenAPI document is at `https://energy.usgs.gov/api/uswtdb/v1/`, which has only one table, `/turbines`.
- Docs: https://energy.usgs.gov/uswtdb/api-doc/
- Filters: PostgREST syntax such as `?t_offshore=eq.1`, `?t_state=eq.KS`, `&select=a,b,c`, `&limit=`/`&offset=` or the `Range: 0-249` header. Send `Prefer: count=exact` to get the total in `Content-Range`.
- CSV: send `Accept: text/csv`.
- **CORS: `access-control-allow-origin: *`** (verified), so a browser can call it directly.
- The service runs behind Cloudflare and sets a `__cf_bm` cookie. Edge cache is `max-age=0`.
- Rate limits: the API docs say nothing about rate limits, throttling, or API keys. No key was needed. Any limit Cloudflare applies is **UNVERIFIED**.
- The docs say write access is for authorized collaborators only. Public access is read-only.

### Bulk downloads (https://energy.usgs.gov/uswtdb/data/)
Sizes and dates come from HEAD requests. All three files were last modified 2026-09-28 19:20 GMT.

| File | URL | Size |
|---|---|---|
| CSV zip | https://energy.usgs.gov/uswtdb/assets/data/uswtdbCSV.zip | 1.68 MB |
| GeoJSON zip | https://energy.usgs.gov/uswtdb/assets/data/uswtdbGeoJSON.zip | 1.45 MB |
| Shapefile zip | https://energy.usgs.gov/uswtdb/assets/data/uswtdbSHP.zip | 3.90 MB |

The zips were not opened. Whether they also contain `t_offshore` is **UNVERIFIED** but likely, since the API carries it.

### Fields (from the API's key/value codes)
| Field | Meaning |
|---|---|
| `case_id` | Unique stable ID (int) |
| `faa_ors`, `faa_asn` | FAA Digital Obstacle File / OE-AAA cross-reference |
| `usgs_pr_id` | 2014 USGS dataset ID |
| `eia_id` | EIA plant ID |
| `t_state`, `t_county`, `t_fips` | State, county, FIPS. **Offshore turbines in federal waters have `t_state = "NA"`.** |
| `p_name` | Project name |
| `p_year` | Year the turbine began operating |
| `p_tnum`, `p_cap` | Number of turbines in the project; project capacity in **MW** |
| `t_manu`, `t_model` | Manufacturer, model |
| `t_cap` | Turbine rated capacity in **kW** |
| `t_hh`, `t_rd`, `t_rsa`, `t_ttlh` | Hub height (m), rotor diameter (m), swept area (m²), tip height (m) |
| `t_conf_atr`, `t_conf_loc` | Confidence in attributes and in location |
| `t_img_date`, `t_img_src` | Date and source of the verifying imagery (for example "Vantor" or "NAIP") |
| `xlong`, `ylat` | WGS84 longitude and latitude |
| **`t_offshore`** | **0 = not offshore, 1 = offshore** |
| `t_retrofit`, `t_retro_yr` | Partial retrofit flag (0/1) and year |

### Selecting offshore turbines
`GET https://energy.usgs.gov/api/uswtdb/v1/turbines?t_offshore=eq.1` returns **129 turbines** (verified 2026-10-14):

| Project (`p_name`) | Turbines | `p_year` | Turbine | Notes |
|---|---|---|---|---|
| Vineyard Wind | 61 | 2025 (34), 2026 (27) | GE Haliade-X 13 MW | The 27 turbines from 2026 have null cap/manu/model |
| Revolution Wind | 28 | 2025 | SG-11.0-200-DD 11 MW | 2 rows have null cap/manu |
| South Fork Wind Farm | 12 | 2024 | SG 11 MW | |
| Sunrise Wind | 10 | 2026 | SG-11.0-200-DD 11 MW | 4 rows have null attributes |
| Coastal Virginia Offshore Wind | 7 | 2020 (2 pilot, 6 MW), 2026 (5, SG-14-222-DD 14 MW) | | |
| Block Island | 5 | 2016 | GE Haliade 150-6, 6 MW | `t_state` = RI |
| Empire Wind I | 5 | 2026 | null | Attributes not yet filled in |
| "unknown NA" | 1 | 2026 | null | Placeholder name for a turbine whose project is not yet identified |

Sample rows, trimmed to the fields that matter:
```json
{"case_id":3041852,"p_name":"Block Island","t_state":"RI","p_year":2016,"t_cap":6000,"t_manu":"GE Wind","t_model":"Haliade 150-6","t_hh":106.0,"t_rd":150.0,"xlong":-71.51395,"ylat":41.11993,"t_img_date":"3/4/2017","t_img_src":"Vantor"}
{"case_id":3041853,"p_name":"Block Island","t_state":"RI","p_year":2016,"t_cap":6000,"t_manu":"GE Wind","t_model":"Haliade 150-6","t_hh":106.0,"t_rd":150.0,"xlong":-71.52116,"ylat":41.11473}
{"case_id":3123493,"p_name":"25 Mile Creek","t_state":"OK","p_year":2022,"t_cap":4200,"t_manu":"Vestas","t_model":"V150-4.2","xlong":-99.75696,"ylat":36.49125,"t_offshore":0}
```
The third row is an onshore example.

Coverage: these are **built turbines only**. USWTDB only adds turbines it has verified on imagery, so it has no planned or lease-area records. US offshore coverage is the Atlantic only. There are no Pacific turbines.

### License and attribution
- Public domain: the data are "free and in the public domain. There are no restrictions."
- Requested acknowledgment, quoted exactly from the site:
  > "Map services and data are available from U.S. Wind Turbine Database, provided by the U.S. Geological Survey, American Clean Power Association, and Lawrence Berkeley National Laboratory via https://energy.usgs.gov/uswtdb"
- Suggested citation: Hoen, B.D., Diffendorfer, J.E., Rand, J.T., Kramer, L.A., Garrity, C.P., and Hunt, H.E., 2018, United States Wind Turbine Database V9.1 (September 28, 2026): U.S. Geological Survey, American Clean Power Association, and Lawrence Berkeley National Laboratory data release, https://doi.org/10.5066/F7TX3DN0
- The data come with a standard no-warranty disclaimer.

---

## 2. Global Energy Monitor: Global Wind Power Tracker (GWPT)

- **There is no separate "Global Offshore Wind Tracker" page.** `globalenergymonitor.org/projects/global-offshore-wind-tracker/` returns 404. Offshore wind is part of the **Global Wind Power Tracker**, filtered by installation type.
- Page: https://globalenergymonitor.org/projects/global-wind-power-tracker/ . The download form is at `#download`.
- **Latest release: February 2026.** The page says the database and wiki are updated **annually**.
- Scope: utility-scale wind farm **phases of 10 MW and up**, onshore and offshore, in 166 countries/areas. It tracks 32,227 phases, with 1,129 GW operating and 2,656 GW prospective.
- Statuses: announced, pre-construction, construction, operating, shelved (incl. "shelved – inferred 2 y"), cancelled (incl. "cancelled – inferred 4 y"), mothballed, retired.
- Installation types: `Onshore`, `Offshore hard mount`, `Offshore floating`, `Offshore mount unknown`, `Unknown`.
- Location accuracy: each phase is marked `exact` or `approximate`.

### Download access
- **Official dataset (XLSX):** behind a web form (`<gem-download-form slugs="wind-power-tracker">`). The form script is `https://api.globalenergymonitor.org/static/gem-download-form.bundle.js`. Required fields:
  - full name
  - email
  - organization
  - country
  - "How do you plan to use the data?" (**at least 100 characters**)
  - a checkbox: "I have reviewed and understand Global Energy Monitor's Creative Commons Public License"

  The form submits to a Supabase backend and returns a presigned download. **Not submitted.** The file format (XLSX) is **UNVERIFIED**. It is GEM's usual format but was not seen directly.
- **Public map file, no form:** the tracker map at https://globalenergymonitor.github.io/interim-maps/trackers/gwpt/ loads
  `https://publicgemdata.nyc3.cdn.digitaloceanspaces.com/interim_maps/gwpt_map_2026-02.geojson`
  - Size: 55.1 MB. It was **not downloaded** because it is over the 20 MB limit. Only the first 1.5 KB was read.
  - Last modified 2026-03-24. Content-type `binary/octet-stream`. CORS `access-control-allow-origin: *` (GET).
  - Format: a GeoJSON FeatureCollection in CRS84 with one Point per phase, covering the whole world and both onshore and offshore.
  - The repo already uses this public-map-file route for GEM GCTT/GGIT (see `docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md`).

### Fields in the map GeoJSON
From the first feature and `config.js`:
- **Names:** `name`, `unit-name` (phase), `name-noneng`, `name-other`
- **Capacity:** `capacity` (MW), `capacity-display`, `capacity-table`, `capacity-scaled`, `units-of-m` = "MW"
- **Type and status:** `tech-type` (installation type), `status`, `status-display`, `start-year`
- **Companies:** `owner`, `operator`, `owner-noneng`, `operator-noneng`
- **Location:** `Latitude`, `Longitude`, `location-accuracy`, `subnational`, `country-area1`
- **IDs and links:** `project-id` (e.g. `L100000906074`), `unit-id` (e.g. `G100001050800`), `url` (GEM.wiki page)
- **Bookkeeping:** `tracker-acro` = GWPT, plus `*-search` helper fields

Whether the official XLSX has extra columns (for example retired year, hub height, turbine model, or the GEM entity IDs for owners) is **UNVERIFIED**.

### Offshore record counts
From GEM's own summary sheet "Offshore Wind Farm Capacity by Country/Area (Phase Count)", GWPT February 2026. Sheet: https://docs.google.com/spreadsheets/d/1AKyHk66pCdRsKJOxEqPiV8EJdAmmOUvkylPl3PRG2FE/edit?gid=809624199 . I summed the 58 country rows.

| Status | Offshore phases |
|---|---|
| Operating | 734 |
| Construction | 186 |
| Pre-construction | 1,220 |
| Announced | 838 |
| Cancelled | 750 |
| Shelved | 420 |
| Retired | 6 |
| Mothballed | 0 |
| **All statuses** | **4,154** |

Prospective (construction + pre-construction + announced) is 2,244. Rows for selected countries:

| Country | Operating | Construction | Pre-construction | Announced | Cancelled | Shelved |
|---|---|---|---|---|---|---|
| United States | 3 | 5 | 31 | 8 | 13 | 3 |
| Canada | 0 | 0 | 2 | 0 | 9 | 0 |
| China | 156 | 58 | 76 | 11 | 0 | 5 |
| United Kingdom | 49 | 7 | 54 | 4 | 30 | 13 |

Operating offshore capacity per GEM: US 172 MW (2016: 30, 2020: 12, 2024: 130), UK 15,963 MW, China 45,807 MW. Source: sheet gid=342844628.

These counts are **phases, not turbines.** GWPT has one point per phase and no individual turbine positions.

### License and attribution
- **CC BY 4.0.** The download form states "Creative Commons Attribution 4.0 International (CC BY 4.0)", and the full license text is at https://globalenergymonitor.org/creative-commons-license
- GEM.wiki text uses a different license: CC BY-NC-SA 4.0, per `docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md`. Link to wiki pages rather than copying their text.
- Attribution wording: no official sentence was found on the tracker page. GEM's summary sheets credit "Global Energy Monitor" and "Global Wind Power Tracker, February 2026". A credit line like "Global Energy Monitor, Global Wind Power Tracker, February 2026 release (CC BY 4.0)" is my inference from those sheets, so the exact wording is **UNVERIFIED**.

---

## Recommended integration route

1. **US turbines (exact points): USWTDB API, filtered at bake time.**
   - Query: `GET https://energy.usgs.gov/api/uswtdb/v1/turbines?t_offshore=eq.1&select=case_id,p_name,t_state,p_year,p_cap,t_cap,t_manu,t_model,t_hh,t_rd,t_ttlh,t_img_date,t_img_src,xlong,ylat`
   - This is one request for 129 rows, a few tens of KB. Save it as a small static GeoJSON in Blob. No tiles are needed at this size.
   - CORS is open, so the browser could also call the API directly. Even so, a quarterly re-bake (or an edge proxy with a long cache) avoids depending on a `max-age=0` Cloudflare origin.
   - Popup content: turbine model, capacity in MW (`t_cap`/1000), hub height, rotor diameter, project, year. Each value links back to energy.usgs.gov/uswtdb.
   - Handle nulls: Vineyard Wind 2026, Empire Wind I, and some Sunrise and Revolution turbines have no model or capacity yet. Show only the fields that exist.
   - Credit the source with USGS's requested acknowledgment line.
2. **Worldwide wind farms (one point per phase, all statuses): GEM GWPT.**
   - Option A, no form: bake from the public map GeoJSON (55 MB, CORS open). Stream-filter it to `tech-type` starting with `Offshore`, about 4,154 features, and publish a small GeoJSON or PMTiles.
     - Per the owner's rules, the full 55 MB fetch is a one-time bake download, so get Josh's OK first.
     - Run it in the bake environment, not on localhost.
   - Option B: Josh fills in the GEM form (name, email, org, country, 100+ character use case, license checkbox) to get the official file.
   - Either way:
     - Show `status` as color (operating vs. prospective vs. cancelled/shelved).
     - Show `location-accuracy` (mark `approximate` points as approximate).
     - Link each farm to its `url` (GEM.wiki).
     - Credit GEM under CC BY 4.0.
   - The next annual GWPT release should get a new map filename (pattern `gwpt_map_YYYY-MM.geojson`, **UNVERIFIED**). Re-bake when it appears.
3. **Layering:** use GEM phases as the global "wind farm" layer at low zoom, and USWTDB turbines as exact points from about z9 in US waters. Do not merge the two. GEM is per-phase, has approximate locations, and includes planned farms. USWTDB is per-turbine, built turbines only, and verified on imagery. If GEM-to-USWTDB matching is ever needed, match on project name (for example GEM "Vineyard Wind" to USWTDB `p_name`). No shared ID was found.
4. **Gap:** neither source covers individual turbines outside the US.
