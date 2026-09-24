# Handoff — /inmotion Precipitation rework (2026-09-23)

Read this before touching `src/systems/`. Written at the end of a long, and
for Josh a frustrating, session. **Nothing is pushed. The feature is NOT
working to Josh's satisfaction.**

---

## 1. Read these first

- `docs/CLOUDS_API.md` — every source catalogued with measured numbers
- `SYSTEMS-NOTES.md` — architecture of the ladder, the bakes, the follower
- Memory: `feedback_verify_on_screen`, `feedback_reuse_existing_patterns`

## 1a. Why this work exists — the intent

The session began with Josh wanting `/inmotion` to **reflect current events in
nature** — it started from a Cat 5 hurricane off Baja. Storms, clouds and
precipitation all came out of that. Precipitation is the piece left unfinished.

The goal for precipitation specifically: **one layer that always shows the
sharpest honest measurement of rain available for what is on screen**, and
that animates through time like the rest of `/inmotion` does.

Non-negotiable principles, all of them Josh's and all of them load-bearing —
several of the bugs below are violations of one of these, not mere glitches:

- **Never two moments presented as one.** Products swap, they never blend.
  Today's rain drawn over last Tuesday's storm track is the thing this project
  will not do. This is why every live tier hides the instant the bar leaves
  Now, and why clouds stand aside during a replay.
- **Never distort the data to make it look better.** Josh, earlier in the
  session on the storm wind fields: *"You are visually distorting the actual
  data. The width is the width."* The max-pooling choice is documented in the
  layer copy for exactly this reason, with its measured 2.13× area inflation.
- **Never synthetic or placeholder data**, and never mislabel a source.
- **Inline provenance**: every value carries its own visible, clickable
  source. The attribution strip renaming itself as the tiers swap is the
  honest tell that one product handed off to another.
- **It must feel fluid**, like the wind and current layers. Josh: *"I would
  expect to see the rain moving like in other layers."* Note the real limit
  here: those are particle fields that interpolate between frames;
  precipitation is measured imagery, so the target is a clean radar loop with
  no blink, not invented in-between motion.

### The specific problem that drove the redesign

Zooming changed *everything* at once and felt broken. Four causes, ranked by
how much each moves the picture — the first dominates:

1. **Age.** IMERG measured **6.4 hours** behind; GOES is ~10 minutes. A
   mid-latitude system moves ~50 km/h, so that is **~325 km of displacement —
   about a fifth of the screen at z5**. The rain is genuinely in a different
   place. No blending can fix this; only a fresher global product can. That is
   the entire reason GSMaP replaced IMERG at Now.
2. **Resolution**, 11 km vs 2 km vs 1 km.
3. **A hard flip at one threshold.**
4. **The instruments genuinely disagree** over ocean (see §5a).

## 2. The two rules I broke, which cost Josh most of the session

**Verify on the screen, not in the properties.** I repeatedly reported
"verified" from instrumentation — `visibility: visible`, `raster-opacity:
0.85`, distinct frame URLs, "0 frameless samples" — while the map was drawing
nothing at all. Every one of those readings was true and meaningless. Take
SCREENSHOT BURSTS (6–10 across several seconds) of the real page, in Josh's
visible Chrome tab, and compare them. The built-in browser pane is usually
hidden, and a hidden tab pauses the rAF replay loop (`document.hidden` in
`ReplayController._loop`), so it cannot show real playback.

**Reuse what exists.** I built bespoke double-buffering + tile-swap chasing
when `ReplayController` already solves this: it refuses to advance past a
frame its tape reports unready (`tape.prefetch(next, 5)` then
`if (!tape.ready(...)) { buffering = true; return }`). That is why wind and
currents are fluid. Josh: *"Haven't you solved this issue with the other
updating raster datasets??"*

**Also:** I drove all my verification with `map.jumpTo()`, never a real
scroll/pinch zoom. That is a plausible reason my checks passed and Josh's
hands-on testing failed — see §6.

## 3. Current state — DISPUTED

My last screenshots appeared to show the zoom ladder working at Now
(z2.5 GSMaP → z4.5 GOES → z8 MRMS) and 1 km radar in replay inside the
archive window. **Josh tested it and said "The fix DID NOT work at all."**
I could not reconcile that before the session ended. Treat the feature as
broken and re-diagnose from the screen. Do not trust my "verified" claims.

Possible reasons for the discrepancy, none confirmed:
- Josh had **two** `/inmotion` tabs open; I may have driven a different one.
- Stale HMR module (the shared tree was white-screened at one point by the
  parallel ClimateTRACE session — see §7).
- `jumpTo()` vs a real gesture: a real zoom passes continuously through z6,
  where MRMS becomes eligible but has no tiles yet.
- `moveend`/`zoomend` may not fire as I assumed during inertial zoom.

## 4. What the feature is meant to be

One layer, four measured products, **exactly one on screen at a time**,
swapping on zoom and on the time bar. Never blended, never two ages at once.

| rung | source | grid | cadence | age | where |
|---|---|---|---|---|---|
| sharpest | NOAA MRMS | 1 km | 2 min | ~2 min | CONUS, z6+ |
| sharp | NOAA GOES RRQPE | 2 km | 10 min | ~10 min | Americas, z3+ |
| base, live | JAXA GSMaP_NOW | 11 km | 30 min | ~30 min | global |
| base, replay | NASA IMERG (GIBS) | 11 km | 30 min | ~6.4 h | global, past only |

`activeTierKey()` (SystemsApp) walks tiers finest-first and takes the first
that qualifies. `tierSees()` (layerDefs) handles both footprint shapes — a
geostationary tier is an arc (65° from the sub-satellite point, NOT the
geometric horizon), a radar tier is a box, a `base` tier always qualifies.

## 5. Files

**Bakes** (python, run in GitHub Actions, POST to the ingest):
- `scripts/_rain_common.py` — SHARED ramp, Mercator tiling, max-pooling,
  PMTiles, publish/prune. Exists because the tiers must share a colour ramp
  and downsample rule exactly; copies drifted within a day.
- `scripts/bake-gsmap.py` — GSMaP_NOW → 1.00 MB, 535 tiles, 7 s
- `scripts/bake-rrqpe.py` — GOES → 1.33 MB, 763 tiles, 14 s
- `scripts/bake-mrms.py` — MRMS + rolling archive → 0.59 MB/frame, 3 s each
- `scripts/bake-gmgsi.py` — clouds (single image, unrelated to the ladder)
- `scripts/gmgsi-requirements.txt` — h5py, numpy, pillow, pmtiles, eccodes

**Serving:**
- `api/rain-tiles.js` — `?t=gsmap|goes|mrms&z=&x=&y=[&f=<ms>]`, range-reads
  PMTiles from Blob (or `public/dev-data` in dev)
- `api/cron/clouds-ingest.js` — allowlisted writes + `prune` deletes
- `vite.config.js` — `traceTilesPlugin` route list includes `rain-tiles`

**Client:** `src/systems/layerDefs.js` (the `rain` def),
`src/systems/SystemsApp.jsx` (raster effects), `src/systems/rasterTape.js`

**Workflows:** `gsmap-bake.yml` (*/20), `rrqpe-bake.yml` (*/15),
`mrms-bake.yml` (*/10), `gmgsi-bake.yml` (hourly)

## 5a. Data work already done — DO NOT REDO THIS

All measured live on 2026-09-23 against the real services. Full catalogue with
method in `docs/CLOUDS_API.md`. The repo rule is to exhaustively catalogue an
API before planning an integration; that work is done for all of these.

### Latency, cadence, archive depth (all verified by request)

| source | cadence | measured latency | archive | access |
|---|---|---|---|---|
| IMERG (GIBS) | 30 min | **6.4 h** | continuous 30-min since 2026-02-11 | WMTS tiles, free, CORS open |
| GSMaP_NOW | 30 min | **~2 min after its 1-hour window closes** | 365+ days | JAXA FTP, registration required |
| GOES RRQPE | 10 min | ~10 min | 365+ days, 144 files/day | S3 anonymous |
| MRMS PrecipRate | **2 min** | ~2 min | 365+ days, 720 files/day | S3 anonymous |
| GMGSI (clouds) | hourly | ~2 h | 180+ days, 24/day | S3 anonymous |

**Correct an error I made mid-session:** I first reported GSMaP_NOW as 60–90
minutes behind. That was wrong — I was measuring from the frame's *label*. A
frame named `17:00` is an average over 17:00–17:59 and lands on the FTP at
18:01, i.e. ~2 min after the window it covers closes. Mean data age ~30 min.

### Format facts worth not rediscovering

- **GSMaP binary**: `gsmap_now.YYYYMMDD.HHNN.dat.gz`, 3600×1200 float32
  LITTLE_ENDIAN, 0.1°. Longitudes are **0–360 EAST** (0.05…359.95), and
  `OPTIONS YREV` means **row 0 is the NORTH edge**. UNDEF −99; −4 sea ice,
  −8 low temperature. YREV was verified empirically against the GOES pyramid,
  not trusted: north-first agreed on 48.8% of GOES's raining points
  (corr +0.24), south-first 6.6% (corr −0.01, i.e. noise).
- **MRMS GRIB2**: 7000×3500 at 0.01°, lat 54.995 → 20.005 (**row 0 north**),
  lon 230.005 → 299.995 E. `missingValue` 9999 and **every negative value is a
  coverage flag** (−3 = outside radar range) — both must become NaN or
  max-pooling carries a flag up the pyramid as rainfall. `eccodes` installs
  from a **pip wheel, no apt needed** in CI.
- **GOES RRQPE**: forward scan-angle projection per the GOES-R PUG, two
  satellites merged by `cos(lon − lon_0)` nearness to nadir.
- **GIBS DescribeDomains** answers "which half-hours exist" in ~370 bytes if
  you bound the range (`…/all/2026-09-16--2026-09-24.xml`) versus 45 KB for
  `all/all.xml`. The separator is `--`; a `/` returns a misleading
  "LAYER does not exist". Out-of-range times **404**, which is honest.
- **JAXA's tile CGI 200s with a 70-byte transparent PNG for missing frames** —
  it does NOT 404. Detecting absence by status code would silently render
  "no rain on Earth". We do not use their tiles anyway (see licensing).

### Licensing — settled

JAXA FAQ **Q14**: commercial use permitted with the credit
`"(c)JAXA, provided by JAXA, Courtesy of JAXA"` (carried in the layer and in
the bake meta). **Q16**: publishing an image *you processed from* their data
needs no procedure; republishing *their* files does. So we bake our own raster
from the FTP binary and never proxy their tiles — which also sidesteps their
missing CORS header and a 3–4.7 s cold tile.

### Options evaluated and rejected — with the measurements that killed them

- **Stitching GOES + Meteosat + Himawari for clouds**: GIBS has no Meteosat at
  all; the providers render the same infrared incompatibly (measured over
  identical ocean: GIBS clear sky at luminance 125, EUMETSAT at 22).
- **A global IR mosaic from GIBS**: re-checked the full capabilities document.
  Only per-satellite discs exist (`GOES-East/West_ABI_Band13`,
  `Himawari_AHI_…`), all ~21-hour archives, no Meteosat. Too shallow to replay
  even if it looked right. Clouds must therefore be baked from GMGSI.
- **MODIS/VIIRS true colour**: builds its global mosaic swath by swath through
  the day; only *yesterday* is complete, so it cannot show a storm that exists
  now.
- **Raw GOES ABI**: 351 MB per multi-band scan, geostationary projection, and
  GeoColor is a CIRA composite rather than a band in the file.
- **ECMWF/GFS precipitation**: model output, not an answer to "where is it
  raining now". Fine for a future forecast mode.

### A finding that matters for interpretation

**GSMaP and GOES genuinely disagree over ocean**, and it is physics, not a
bug. GOES reads rainfall from infrared: strong on convective cores, weak on
light stratiform rain. GSMaP and IMERG blend passive microwave and see the
drizzle. Measured on one frame: **GSMaP found 12.84% of its cells raining;
GOES 2.77% of its box.** Never describe a tier change as rain starting or
stopping. This is also a second, independent argument for a microwave-based
global tier.

### Also established

- **GSMaP is NOT sharper than IMERG** — identical 0.1° (~11 km) grids. The
  win is age and microwave sensitivity, nothing else.
- MRMS also publishes **ALASKA, CARIB, GUAM and HAWAII** at the same cadence;
  each is a separate grid and would be another tier entry.
- GSMaP's FTP also carries `/standard/v8` (gauge-calibrated, 3-day latency,
  back to **January 1998**) — the obvious source if a deep, high-quality
  precipitation archive is ever wanted.

## 6. Bugs found and fixed — do not re-litigate these

Each was real and confirmed. If the symptom returns, these are ruled out as
*causes already addressed*, but verify rather than assume.

1. **Single `image` source lies at low zoom.** A Mapbox `image` source is one
   texture with no mipmaps; minification skips texels. Rain is sparse (0.46%
   of texels over the Cascades), so rain that existed was not drawn and MORE
   appeared as you zoomed IN. Fixed by baking real tile pyramids.
2. **Downsample must be MAX, not mean.** A mean multiplies a 2 km cell by its
   area fraction until it renders as nothing. Measured inflation of rain area
   at z3 is 2.13× — the honest cost, stated in the layer copy.
3. **`Buffer.allocUnsafe` in the tile endpoint.** A range read past EOF (which
   happens while a bake rewrites the archive under a running server) returned
   uninitialised heap; a WebP decoded from that renders as an **opaque black
   square**. Now `Buffer.alloc` + only the bytes actually read.
   **`api/vessel-tiles.js` STILL HAS THIS BUG.**
4. **Empty tiles must be a decodable image, not 204.** Mapbox hands a raster
   body straight to the image decoder; an empty one throws 65 console errors
   on one dry view. Now a 68-byte transparent PNG.
5. **Mapbox does not load tiles for `visibility: none`.** This is the big one.
   A hidden double-buffer never pre-loads, and `isSourceLoaded()` then answers
   "nothing pending, therefore loaded". Three different readiness signals
   (`isSourceLoaded`, `idle`, polling) all failed for this same reason. Slots
   are now selected by **opacity**; the incoming buffer is armed
   visible-at-zero so it genuinely fetches.
6. **The ladder must yield to the clock.** Scrubbed into the past at z≥3 over
   the Americas, BOTH precip tiers went blank — the detail tier had no archive
   and the global tier had stood down for it.
7. **A cancelled swap must clear `state.loading`.** The slot state lives in a
   ref that outlives the effect; the effect re-runs when the replay is
   created, and its cleanup left the in-flight mark set, wedging the layer on
   its LIVE tiles while the bar sat in the past.
8. **The follower owns visibility, so it must hear the camera.** Its deps had
   no `mapView`; parked at Now there are no replay ticks, so zooming changed
   nothing. Added `moveend`/`zoomend`. **This is the last fix I made and the
   one Josh says did not work — start here.**

## 7. Environment traps

- **The working tree is SHARED with a parallel ClimateTRACE session.** Its
  half-saved edit white-screened the app mid-session (`traceData.js` missing
  an export `layerDefs.js` already imported). If the page is blank, check the
  console before blaming precipitation. Never `git add -A`; stage only
  precipitation files.
- Josh QAs on **localhost:5173 only**. `vercel dev` is not what he runs.
- Builds take 45–105 s; run them with a generous timeout.

## 8. Not done / open

- **Nothing is pushed.** Josh wants ONE deploy (each push is a billed build).
- **Secrets needed before `gsmap-bake` can run:** `GSMAP_FTP_USER`,
  `GSMAP_FTP_PASS` (JAXA's shared `rainmap` account; registration completed
  2026-09-23, credentials in Josh's email). `CRON_SECRET` already exists.
- **Prod seeding after deploy:** `gh workflow run` for gsmap, rrqpe, mrms,
  gmgsi. Until then no pyramids exist in Blob.
- **MRMS archive is only 3 h.** Beyond it, a zoomed-in replay still falls to
  IMERG blocks. Pure storage dial: 0.62 MB/frame → 12 h ≈ 45 MB, 24 h ≈ 89 MB.
  Josh has not chosen a number.
- **GOES has no archive** — same treatment needed for mid zooms. Its S3
  archive is 365+ days at 10 min.
- **Clouds have no archive**, so they hide during any replay. GMGSI S3 is
  180+ days; measured frame costs are in `docs/CLOUDS_API.md`.
- **IMERG magnified to z8** produces hard-edged 11 km blocks that imply
  precision the data lacks. Unresolved: cap its magnification, or shorten the
  time bar when zoomed past what the sharp archive covers.
- The last ~6 h of the time bar draw nothing (genuinely beyond the IMERG
  archive; clamping would pass off a 6 h old frame as this minute's rain).

## 9. Suggested first move

Do not write code first. Open Josh's Chrome tab, load
`localhost:5173/inmotion?w=0&k3=1&lat=35.560&lng=-106.445&z=8.0`, and
**zoom with a real gesture** from global to Santa Fe, at Now and then in
replay, taking a screenshot burst throughout. Establish from pixels what
actually happens before changing anything. Then ask Josh what he saw, because
his account and my instrumentation diverged all session and his was right
every time.
