# BirdCast live-migration data — source catalog

Cataloged 2026-09-20 (UTC 2026-09-21 ~02:00) by direct inspection. Facts only; nothing here is assumed.
Integration: `api/_birdcast-core.js` + SYSTEMS-NOTES §2h. **No published API, spec, or data-use terms exist for this data — see "Permission".**

## What the public page actually is

`https://birdcast.org/migration-tools/live-migration-maps/` is a WordPress page that iframes
`https://dashboard.birdcast.org/live-maps?embed=true` (Nuxt 2 app). That app does **not** render data:
it reads `mosaic/filenames.txt` and flips through **pre-rendered 1200×675 JPGs** (basemap, colour ramp,
arrows, sunset/sunrise lines, radar dots all burned in, ~125 KB each, one per 10 min).
JPGs are unusable for /inmotion (not georeferenced, basemap baked in, Eastern-time labels).

The JPGs live in a public S3 bucket, and that bucket also holds the underlying gridded data.

## Bucket: `is-birdcast-observed-prod` (us-east-1)

Base: `https://is-birdcast-observed-prod.s3.us-east-1.amazonaws.com`

- Anonymous GET: 200. Anonymous ListObjectsV2 (`?list-type=2&prefix=…&delimiter=/`): 200.
- **No CORS headers** (tested with `Origin:`) → browser cannot fetch directly; needs our edge proxy or a bake.
- Sibling bucket `is-birdcast-predicted-prod` (forecast maps): list = AccessDenied. Not cataloged.
- The Nuxt page state also exposes an internal `bcApiBase` (cluster-local hostname, unreachable) and a
  `bcApiKey`. Not ours; not used; do not use.

All keys are `<family>/YYYY/MM/DD/…`, timestamps **UTC**, `YYYYMMDDHHmm`, 10-minute cadence, **144 frames/day,
24 h/day, year-round** (verified 2026-01-15 and 2026-09-19 both have full days).
Latency observed: frame `0150Z` written at `02:05:58Z` → **~15 min behind real time**.

| Prefix | Content | Earliest key seen | Size/frame |
|---|---|---|---|
| `mosaic/` | rendered JPGs + `filenames.txt` (per-day and root "current night" list, night ≈ 22:00Z→) | 2017/05 | ~125 KB |
| `grid/` | `grid_<ts>.tar.gz` (one CSV) + `vp_<ts>.RData` — **every day present 2021-02-25 → today** (day folders counted; per-day frame completeness spot-checked only; some days carry 145 frames) | 2021/02/25 | ~400 KB gz / 1.0 MB CSV |
| `rasters/` | `raster_<ts>.tif` 4-band float32 GeoTIFF — **patchy archive**: days present 2021:1, 2022:66 (Apr 12–mid Jun), 2023:122 (Mar–Jun), 2024:15, 2025:32, 2026: continuous from Mar 1 | 2021/06/17 | ~12 MB |
| `zarr/` | `raster_<ts>.zarr/` web-mercator multiscale pyramid of the same 4 bands | 2021/06/17 | many small chunks |
| `dashboard/` | `livemig_gen-YYYYMMDD-HHmm.csv.gz.processed` per-county stats | 2021/06/17 | ~95 KB |
| `profile/` | `<RADAR>/<RADAR>YYYYMMDD_HHMMSS_V06.csv` per-scan vertical profile | 2021 | small |
| `vpts/daily/` | `<RADAR>/<RADAR>_YYYYMMDD.csv` daily vertical-profile time series (2021, 2022, 2024–2026; no 2023 dir) | 2021 | — |
| `nexrad/daily/` | `<RADAR>/<YYYY>/<RADAR>_vpts_YYYYMMDD.csv` | — | — |
| `temp/` | empty | — | — |

### `grid/…/grid_<ts>.csv` — the animation-ready product

Header: `OID,mtr,vid,u,v` — 20,132 rows in the sampled frame (2026-09-20 01:10Z).

| Field | Observed range (one frame) | Meaning |
|---|---|---|
| `OID` | 940157 – 979885 | cell id. **No lat/lon in the file** — cell→coordinate mapping is not in the CSV (must be derived from the GeoTIFF/zarr grid; unverified how OID maps) |
| `mtr` | 0 – 7735 | migration traffic rate, birds/km/hour (unit per birdcast.org page text) |
| `vid` | 0 – 285 | vertically integrated density (unit not stated in any file) |
| `u`, `v` | −9.8…11.1, −12.2…0.3 | flight velocity components (magnitudes consistent with m/s; unit not stated) |

### `rasters/…/raster_<ts>.tif`

800×800, 4 samples float32, LZW, nodata −3.4e38. Pixel scale 8032.11 × 4379.35, tiepoint UL
(−13882651.22, 6305375.24) — extents match EPSG:3857 CONUS, but the GeoKey CRS string is `unknown`.
Band stats in the sample: b0 0–8617, b1 0–329, b2 −9.78–11.45, b3 −12.31–0.28 ⇒ **band order = mtr, vid, u, v**
(inferred from matching the CSV ranges; bands carry no names).

### `zarr/…/raster_<ts>.zarr`

Zarr v2, consolidated `.zmetadata`. carbonplan/ndpyramid `pyramid_reproject` output: levels 0–5,
EPSG:3857 **global** extent, 128 px/tile (level N = 128·2^N square; level 5 = 4096²), array `values`
dims `[band(4), y, x]` float32, chunks `[4,128,128]`, zlib-1, fill 9.97e36, `resampling: average`.
Empty chunks are 1,301 B; only CONUS chunks carry data. Same 4 bands as the GeoTIFF.

### `dashboard/…csv.gz.processed` (per county, ~3,156 rows)

`location` (eBird county code, e.g. `US-IA-143`), `datetime` (UTC), `datetime_local`, `noy` (night-of-year MMDD),
`part_of_day`, `enabled`, `mtr`, `vid`, `ff` (speed), `dd` (direction °), `height_mean`, `height_max`,
`birds_aloft`, `birds_passed`.

### `profile/` and `vpts/` (per radar, per 100 m height bin)

vol2bird/bioRad VPTS columns: `radar,datetime,height,[height_reference],u,v,w,ff,dd,sd_vvp,gap,eta,dens,dbz,dbz_all,n,n_dbz,n_all,n_dbz_all,rcs,sd_vvp_threshold,vcp,radar_latitude,radar_longitude,radar_height,radar_wavelength,source_file`.

### Which product to use (findings 2026-09-20)

- The GeoTIFF is **not** a rasterisation of the grid CSV: same timestamp, TIFF max mtr 8617 vs CSV max 7735, and all
  640,000 TIFF pixels are valid. The CSV cells (20,132) behave like aggregates over a coarser polygon grid whose geometry
  is **not published in the bucket**. OID adjacency shows a 114-cell stride, but an affine fit of (OID//114, OID%114)
  to the TIFF only reached r≈0.80 — **the OID→coordinate mapping is unresolved; do not guess it.** Ask Cornell for the
  fishnet if the CSVs are ever needed.
- The **zarr pyramid is fully georeferenced** and is what we ingest. Level 3 (1024² global, 39.1 km/px at the equator):
  CONUS is entirely inside chunks `0.2.1 0.2.2 0.3.1 0.3.2` (~222 KB/frame total); valid window cols 157–320,
  rows 350–439 (164×90 px) = lon −124.80…−67.15, lat 24.53…49.38. It is a bbox rectangle — ocean pixels inside the
  bbox carry values (not land-masked). Nodata appears both as fill 9.97e36 and −3.4e38. Level 4 = 8 chunks, ~856 KB/frame.
- Diurnal content, 2026-09-19 (sum of mtr over cells): 00Z 8.9M · 03Z 45.5M · 06Z 36.0M · 09Z 23.4M · 12Z 4.4M ·
  15–21Z 1.3–1.8M. BirdCast's own map shows sunset→sunrise only; no file states why.

### Local copies (gitignored, `scripts/bake-birdcast/raw/`)

- `raw/YYYY/MM/DD/grid_<ts>.tar.gz` — all 10-min grid CSVs 2026-08-22 → 2026-09-21 (4,338 frames, 1.76 GB). `fetch-raw.mjs`
- `raw/zarr-l3/YYYY/MM/DD/<ts>/<chunk>` — hourly zarr L3 chunks, same 30 days (721 frames, 156 MB). `fetch-zarr.mjs`

### Radar sites and the coverage mask (2026-09-21)

`profile/YYYY/MM/DD/<RADAR>/*.csv` rows carry `radar_latitude, radar_longitude, radar_height`; the day folder lists
which radars reported. 150 sites on 2026-09-20 (142 inside the bake box; the rest Alaska/Puerto Rico/etc.), saved to
`scripts/bake-birdcast/radars.json`. A radar with no profile files in a period = BirdCast's "inactive radar" (red dot).
Upstream's raster fills its whole bounding box: over the Pacific it flattens to a constant (313 birds/km/h at
2026-09-20 04Z) — interpolation, not observation. We keep the contiguous U.S. expanded by 100 miles (Josh's call;
a ≤150 km-from-radar rule was tried first and dropped); see `scripts/bake-birdcast/make-conus-mask.mjs`.

## Coverage and caveats (from birdcast.org page text)

Contiguous U.S. only. Nocturnal migration, local sunset→sunrise (files exist 24 h; daytime content not examined).
Mountain radars under-report. Radar outages = no data.

## Required credit (Josh, 2026-09-20: follow https://birdcast.org/how-to-cite/)

Live Maps syntax, verbatim from that page: "BirdCast, Live Migration Map; date and time (most easily accessible from
image file name/s). Cornell Lab of Ornithology. https://birdcast.org/migration-tools/live-migration-maps. Date/s of
access or download."

In /inmotion every displayed frame/value carries it inline, filled in per frame:
`BirdCast, Live Migration Map; <frame time UTC>. Cornell Lab of Ornithology.
https://birdcast.org/migration-tools/live-migration-maps. Accessed <bake date>.` — linked to that URL.
(The page also gives separate syntaxes for Forecast Maps — Van Doren & Horton 2018, Science 361:1115 — and the
Migration Dashboard; use those if we ever ingest those products.)

## Permission — Josh is handling with Cornell directly

- The only stated terms cover citing the **graphics**: "BirdCast, live migration map; date and time … Cornell Lab of
  Ornithology. https://birdcast.org/migration-tools/live-migration-maps. Date/s of access."
- Josh (2026-09-20) supplied this BirdCast statement: "The project allows users to save or cite map graphics and
  imagery for personal, educational, or non-commercial presentation purposes." Source URL not yet located (not on
  the live-maps, FAQ, about, forecast-maps or dashboard pages). Scope as worded: **graphics/imagery**, for
  **presentation** — it does not mention the gridded data or re-rendering it in another product.
- Nothing found that licenses the gridded data for redistribution. The bucket being listable is not a licence.
- Producer per the page: "Cornell Lab of Ornithology currently produces these maps"; funders listed include NASA and
  Amazon Web Services; partner logos on the page include Purdue and UIUC.

## Not yet examined

`vp_<ts>.RData` contents; OID→coordinate mapping (attempted, unresolved); units for `vid`/`u`/`v` from an
authoritative source; forecast bucket; whether BirdCast offers a sanctioned data feed on request.
