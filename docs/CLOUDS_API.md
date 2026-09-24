# Clouds & precipitation imagery — catalog (verified 2026-09-23)

Everything below was checked with live requests. Sizes are real responses.

**What shipped:** clouds come from **NOAA GMGSI** (§4) — one global mosaic
NOAA has already blended from every geostationary satellite. Precipitation
comes from **GIBS IMERG** (§1). Sections 1–3 record the GIBS+EUMETSAT
stitch that was built first and thrown away, because the measurements that
killed it are the reason GMGSI is worth its extra pipeline.

## 1. NASA GIBS (WMTS) — no key, no account

`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/{layer}/default/{time}/{tileMatrixSet}/{z}/{y}/{x}.png`

**The single most useful discovery: `TIME=default` works.** Putting the literal
string `default` in the time segment makes GIBS serve its own newest frame.
That removes the need for a timestamp resolver, a capabilities fetch (the
capabilities document is **5.8 MB**) and any bake at all. The KVP form with
`TIME` omitted behaves the same.

Note the path order is `{z}/{y}/{x}` — **row before column**, not the usual
`{z}/{x}/{y}`. Mapbox does plain string substitution so this is harmless, but
it will look wrong to anyone skimming.

| Layer | Matrix set | Cadence | Measured lag |
|---|---|---|---|
| `GOES-East_ABI_GeoColor` | `GoogleMapsCompatible_Level7` | 10 min | 1.0 h |
| `GOES-West_ABI_GeoColor` | Level7 | 10 min | ~1 h |
| `Himawari_AHI_Band13_Clean_Infrared` | Level6 | 10 min | 0.7 h |
| `GOES-East/West_ABI_Band13_Clean_Infrared` | Level6 | 10 min | ~1 h |
| `IMERG_Precipitation_Rate_30min` | Level6 | 30 min | **6.2 h** |
| `IMERG_Precipitation_Rate` (daily) | Level6 | daily | **50.7 h** — unusable |

**No Meteosat in GIBS.** GOES-East, GOES-West and Himawari leave Europe,
Africa, the Middle East and most of the Indian Ocean uncovered. Measured at
z4: GOES-East returns 85 KB over the Americas, 10 KB at Europe (disc limb
only) and **155 bytes over India** (empty).

## 2. EUMETSAT (WMS) — no key, no account

`https://view.eumetsat.int/geoserver/{workspace}/wms?service=WMS&version=1.3.0&request=GetMap&layers={layer}&styles=&format=image/png&transparent=true&crs=EPSG:3857&bbox={bbox-epsg-3857}&width=256&height=256`

255 layers. Omitting `TIME` serves the latest frame. Works directly as a
Mapbox XYZ source because Mapbox substitutes `{bbox-epsg-3857}` as
`minx,miny,maxx,maxy`, which is the axis order EPSG:3857 wants.

| Workspace:layer | Covers | Test |
|---|---|---|
| `mtg_fd:rgb_geocolour` | 0° — Europe, Africa, Atlantic | 137 KB / tile |
| `mtg_fd:rgb_truecolour`, `mtg_fd:ir105_hrfi` | same disc, other products | 26 KB |
| `msg_iodc:rgb_naturalenhncd` | 45.5°E — Indian Ocean, India | 261 KB |
| `msg_fes:ir108` | 0° infrared | 79 KB |

Time dimension on `mtg_fd:rgb_geocolour` was `…/2026-09-23T02:20:00Z/PT10M` —
**20 minutes behind, fresher than GOES.**

## 3. Stitching: the two failures worth not repeating

**Tiles are 100 % opaque inside a disc and 100 % transparent outside it.**
Measured. So discs compose correctly by geometry — but within its own disc a
full-disc image covers the basemap completely. That is inherent; it is a
photograph of the Earth, not an overlay.

**Failure 1 — mixing providers' infrared.** Over the *same* patch of tropical
Atlantic, GIBS "Clean Infrared" renders clear sky at luminance **125**
(mid-grey) while EUMETSAT `ir108` renders it at **22** (near-black). Same
phenomenon, irreconcilable pictures, and the join was a grey band down Africa.
Mapbox raster paint (`raster-contrast`, `raster-brightness-min/max`) cannot
remap levels hard enough to fix it. GeoColor is dark over clear sky on both
providers and stitches far better.

**Failure 2 — letting full discs overlap.** Imagery at the edge of a
geostationary disc is viewed at a grazing angle and washes out white (limb
brightening). Drawn over a neighbour's good data it produced a brilliant white
stripe down the Atlantic. **Fix: clip every source to a non-overlapping
longitude band** around its sub-satellite point via the Mapbox source's
`bounds`. This discards only what was unusable, removes every overlap, and
cuts tile requests. The price is a hard join instead of a blended one.

Bands in use (`bounds: [west, south, east, north]`, lat ±72):
GOES-West −180…−105 · GOES-East −105…−35 · MTG 0° −35…33 ·
Meteosat IODC 33…95 · Himawari 95…180.

**Remaining compromise:** NASA publishes no GeoColor for Himawari, so east
Asia and Australia are infrared and read grey rather than white. Documented in
the layer's own note rather than hidden.

## 4. NOAA GMGSI — what shipped

`s3://noaa-gmgsi-pds` — public, anonymous, plain HTTPS REST (no boto3, no
credentials). NOAA blends GOES, Meteosat and Himawari into a **global** field:
`GMGSI_LW` (longwave IR), `GMGSI_VIS`, `GMGSI_SW`, `GMGSI_WV`, `GMGSI_SSR`.
Hourly, published ~35 min past the hour, **7 MB** a frame.

Nothing to stitch, because there is one source. That is the whole argument.

### Frame contents (opened with h5py)

```
data  (1, 3000, 4999) float32   lat (3000, 4999)   lon (3000, 4999)
xc    (4999,)  yc (3000,)       time (1,)          dqf (1, 3000, 4999)
title = GLOBCOMPLIR   summary = longwave infrared
time_coverage_start = 2026-09-23T14:00:00Z
source = ...MSG2_IODC...IR_108...   <- Meteosat already merged in
```

* **`data` is display brightness 0–255, not kelvin.** Effectively a finished
  image.
* **Extent is ±72.7° latitude.** Geostationary satellites see the poles at too
  shallow an angle; beyond that the mosaic is blank, not cloudless.
* **The grid is regular in longitude (0.072°) but NOT in latitude** — spacing
  runs 0.021 to 0.072, i.e. it is projected. Because latitude varies only down
  rows and longitude only across columns, resampling separates into two 1-D
  lookups. No scattered interpolation needed.
* 0 % missing.

### Polarity, measured on a real frame

HIGH means COLD means high cloud:

| point | value |
|---|---|
| Hurricane Polo, eyewall | **210** |
| Southern Ocean storm | 198 |
| North Atlantic front | 180 |
| median pixel | 122 |
| S Pacific off Chile | 112 |
| mid-Pacific subtropics (clear) | 73 |
| Sahara, daylit and very hot | **37** |

Hence the opacity ramp: transparent below **130**, full by **210**.

**The limit no threshold can fix:** low cloud over warm ocean is nearly the
same temperature as the sea, so longwave IR cannot separate them. This layer
shows mid and high cloud well and misses shallow marine cloud. `GMGSI_VIS`
would fill that in on the daylit half — at the cost of going black at night.

### Why h5py, and why Actions

The file is NetCDF4/HDF5, which `netcdfjs` (the JS bake path) cannot read.
But `h5py` is already a dependency of the LiveOcean bake, so python in GitHub
Actions opens it directly. Actions rather than a Vercel function because
**this project's Vercel preset is Vite**, which won't build python in `api/` —
a project constraint, not a Vercel one. Vercel does support python natively.

### Output format

4096×2048 equirectangular, grey + alpha, **lossless WebP**. Measured on one
frame: RGBA PNG 9.5 MB, grey+alpha PNG 6.4 MB, **lossless WebP 1.19–1.58 MB**
— and lossy WebP was *bigger* than lossless, because most of the image is
uniform transparency. Full resolution therefore survives and still fits the
4.5 MB Vercel function-body limit after base64.

Drawn client-side as a Mapbox `image` source pinned to four corners — verified
rendering correctly on the globe projection. One image, no tile pyramid.

## 5. Rejected

* **`IMERG_Precipitation_Rate` (daily)** — 50.7 h behind.
* **MODIS/VIIRS true colour** — global but one pass a day and nothing at
  night; not comparable to 10-minute geostationary.
* **GFS `Total_cloud_cover_entire_atmosphere` / `Precipitation_rate_surface`**
  — global, gap-free, already on the THREDDS pipe wind uses, and NetCDF3 so it
  would drop straight in. Rejected only because it is *modelled* rather than
  observed; it remains the cheapest fallback if the imagery stitch ever
  becomes a maintenance burden, and `Precipitation_rate_surface` is the
  obvious companion to IMERG since a forecast has no latency.


---

## 9. Precipitation: the resolution ladder (added 2026-09-23)

One layer, two measured products, one shared colour ramp.

| tier | product | resolution | cadence | latency | coverage |
|---|---|---|---|---|---|
| base | NASA GPM **IMERG** via GIBS | 11 km | 30 min | **6.2 h** | global (±60°) |
| detail | NOAA GOES **ABI-L2-RRQPEF** | 2 km native, shipped at ~5 km | 10 min | **~5 s after scan end** | GOES-East + GOES-West |

The detail tier appears at **zoom ≥ 3.5** (Mapbox layer `minzoom`) and draws
over the base tier. Below that it would only be a slightly different-looking
patch of ocean.

### Why this is NOT the clouds mistake repeated

The clouds stitch failed because it combined **pre-rendered images** from
providers who render the same quantity differently. RRQPE is a **quantitative
field in mm/h**, so we colour it ourselves — with GIBS's own published ramp
(`GPM_Precipitation_Rate.xml`, 110 log stops, 0.1 → 53 mm/h, transparent
below 0.1). Identical colours, so the zoom swap doesn't change palette.

### What matching the palette does NOT fix

The two tiers share colours but **not statistics**. Measured on one frame:
of RRQPE's raining pixels, 57 % land in the orange 2–5 mm/h band and only
13 % are green. IMERG will read greener and smoother. This is physically
correct — at 2 km GOES resolves a convective core, while IMERG's 11 km
averages that core against its surroundings and lands lower on the ramp —
so the transition shows an intensity step as well as a sharpness step. It
cannot be removed without throwing away the detail that justifies the tier.

### RRQPE specifics (from a live file)

```
RRQPE (5424, 5424) uint16   units mm h-1   scale_factor 0.00152602
spatial_resolution  2.0km at nadir        scene_id  Full Disk
time_coverage_start 15:40:19Z   date_created 15:49:55Z   (5 s after scan end)
goes_imager_projection: geostationary, lon_origin -75, H 35786023 m, sweep x
```

* **No lat/lon arrays.** `x`/`y` are scan angles on the ABI fixed grid, so the
  bake forward-projects target lat/lon to scan angles (GOES-R PUG formulation)
  including the far-side visibility test — otherwise points behind the Earth
  fold back onto the disc.
* **Two satellites merged** by nearness to nadir, so the overlap between
  GOES-East and GOES-West resolves to whichever sees it more squarely.
* 1.5 MB per satellite per scan in; ~0.25 MB WebP out.

### Output width is pinned to 4096

WebGL `MAX_TEXTURE_SIZE` is 4096 on many phones, and an `image` source wider
than that fails or is silently downscaled there. Both weather images
(clouds 4096×2730, rain 4096×3725) are sized to stay under it. This is why
the rain tier ships at ~5 km rather than its native 2 km — the alternative is
a tile pyramid.

---

## The transport bar: what each weather layer can replay

Measured 2026-09-23. Both layers are marked `raster: { followsTime: true }`
and are driven by whichever replay owns the bar.

### Precipitation — full archive, no storage

GIBS serves `IMERG_Precipitation_Rate_30min` as a WMTS layer with a TIME
dimension, so replaying rain is a different segment in the tile URL. No bake,
no Blob, no cost.

```
.../IMERG_Precipitation_Rate_30min/default/{TIME}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png
```

* `default` in the TIME segment = GIBS's own newest frame (what the live layer
  uses). Newest published slot was `2026-09-23T11:30:00Z` against a wall clock
  of 17:56Z, i.e. **about 6.5 hours behind** — IMERG's latency, not ours.
* Out-of-range times return **404**, not a blank tile, so a bad timestamp
  leaves a hole rather than lying. Worth knowing before trusting a guess.
* Seconds in the timestamp are accepted (`…T06:00:00Z`).

**Which half-hours exist** comes from DescribeDomains, which accepts a bounded
range and answers in a few hundred bytes:

```
/wmts/epsg3857/best/1.0.0/{layer}/default/{TileMatrixSet}/all/2026-09-16--2026-09-24.xml   → 370 B
/wmts/epsg3857/best/1.0.0/{layer}/default/{TileMatrixSet}/all/all.xml                      → 45 KB
```

`--` is the range separator; `/` returns `LAYER does not exist`, which is a
misleading error for a malformed range. CORS is open (`*`), cached 30 min.
The record is pocked with short outages, so only the **final contiguous run**
is used — promising a frame that 404s would put a hole mid-replay. That run
was `2026-02-11T09:00:00Z → now`, 30-minute steps.

### Clouds — no archive yet, so they stand aside

There is no global IR mosaic in GIBS. Re-checked the full capabilities
document: the only geostationary IR layers are per-satellite discs —
`GOES-East_ABI_Band13_Clean_Infrared`, `GOES-West_…`, `Himawari_AHI_…`
(plus GeoColor and Air Mass), all `PT10M` with roughly a **21-hour** archive,
and **no Meteosat at all**. That is the same stitching problem that was
already rejected on appearance grounds, now also too shallow to replay.

So a cloud history has to be baked. NOAA's GMGSI bucket supports it:
`GMGSI_LW/YYYY/MM/DD/HH/` is complete at 24 frames a day and reaches back
**180+ days** (checked at −1, −3, −7, −30, −180). The newest frame runs about
two hours behind.

Frame cost, measured on one real frame (lossless WebP; lossy was *larger*,
because most of the image is uniform transparency):

| grid | size | resolution |
|---|---|---|
| 4096×2730 | 1.72 MB | ~0.088° (~10 km) — what ships today at Now |
| 2048×1365 | 0.73 MB | ~0.176° (~19 km) |
| 1536×1024 | 0.46 MB | ~0.23° (~26 km) |
| 1024×683 | 0.22 MB | ~0.35° (~39 km) |

A rolling window costs both storage *and* per-replay bandwidth, since every
frame a reader scrubs through is a whole-globe download. 3-hourly for 7 days
at 2048 is 56 frames ≈ 41 MB of each. That is the decision to make before
building it; until it is made, clouds hide the moment the bar leaves Now.


---

## GOES RRQPE: the exact shape of the data

Measured 2026-09-23 against `noaa-goes19` / `noaa-goes18` on S3.

| | |
|---|---|
| Cadence | **every 10 minutes** — 144 files per day per satellite, confirmed complete |
| Archive | **365+ days** (checked at −1, −3, −7, −30, −90, −365 days: 144/144 every day) |
| File size | 1.4–1.5 MB per scan per satellite |
| Native resolution | 2 km at nadir |
| Latency | minutes |
| Footprint | two full discs, nadir at 137°W and 75°W; usable to ~65° of arc from each |

Real usable coverage, from the 65° working edge: at the equator the pair
reaches **180°W to about 10°W**; by 60°N that has narrowed to roughly
**169°W to 43°W**. The bake box (−180 to −5, ±62°) is wider than
either, which is why the box alone cannot decide where the tier is valid —
see `ladderSees`.

So a 10-minute precipitation replay over the Americas is *available*; it is
purely a baking-and-bandwidth question, exactly like clouds.

### Why a single `image` source has exactly one honest zoom

The baked detail frame is 4096×3725 over 175° of longitude = **23.4 texels
per degree**. Mapbox draws an `image` source as one texture with linear
filtering and **no mipmaps**, so minifying it samples a 2×2 texel
neighbourhood and skips everything else.

That is harmless for a dense field and destructive for a sparse one. Measured
over the Cascades in a real frame: a 6°×4° box is 140×138 texels and
**0.46% of them are raining** — 89 isolated cells.

| zoom | screen px/deg | minification | what happens |
|---|---|---|---|
| 3.5 | 8.0 | 2.91× | most rain cells never sampled |
| 3.9 | 10.6 | 2.20× | most rain cells never sampled |
| 4.3 | 14.0 | 1.67× | many still dropped |
| **5.04** | **23.4** | **1.00×** | every texel reachable |
| 6.0 | 45.5 | 0.51× | magnified, no loss |

The visible symptom was that MORE rain appeared the further you zoomed in —
the map under-reporting rainfall at exactly the zoom where a reader is judging
how big a storm is.

### Fixed by a real pyramid (`scripts/bake-rrqpe.py`)

The bake now writes **PMTiles with WebP raster tiles**, z3–z6, served by
`api/rain-tiles.js` (same range-read-from-Blob shape as `api/vessel-tiles.js`).
z6 is native — a z6 pixel is ~2.4 km against RRQPE's 2 km — so above it
Mapbox overzooms, which is magnification and lossless.

Measured on a real frame: **768 tiles, 592 empty ones skipped, 1.31 MB total,
13 s to bake.** Empty tiles are never stored; the endpoint answers 204.

**The downsample is a MAX, not a mean.** At 20 km per pixel a 2 km convective
cell cannot be represented faithfully either way: a mean multiplies it by its
area fraction until it renders as nothing, which is what the old image did.
Max overstates the AREA of a cell and tells the truth about its presence and
intensity.

Audited across the stored pyramid, normalising each level to native z6 area:

| z | tiles | raining px | rain area vs native |
|---|---|---|---|
| 3 | 16 | 62,446 | **2.13×** |
| 4 | 59 | 183,510 | 1.56× |
| 5 | 185 | 571,355 | 1.21× |
| 6 | 508 | 1,859,176 | 1.00× |

So coarse levels inflate rain area by about 2× rather than erasing it. That
is the honest cost of the choice and the layer says so in plain words.

### The two tiers genuinely disagree over ocean

Not an age artefact and not a bug. RRQPE derives rainfall from ABI infrared:
strong on convective cores, weak on light stratiform ocean rain. IMERG blends
passive microwave and sees that drizzle. Measured over the NE Pacific at the
same moment, the GOES tier had ~1% of tile area raining where the (older)
IMERG field showed a large system. Expect less light ocean rain on the GOES
tier — which is an argument for a microwave-based global tier (GSMaP)
rather than for distrusting either one.
