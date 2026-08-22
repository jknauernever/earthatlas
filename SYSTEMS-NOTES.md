# /inmotion ("In Motion") — architecture notes & layer playbook

Renamed from /systems on 2026-08-21 (Josh). Public URL and name are **In
Motion / /inmotion**; code paths (src/systems/, api/systems-*, api/cron/
systems-bake) keep the old name. /systems 301-style redirects (client-side,
query preserved; Vercel rewrite for the static entry).

EarthAtlas Systems (`/systems`) shows global earth-systems data in motion —
live wind today; ocean currents, sea-surface temperature, waves, and aerosols
next. Inspired by earth.nullschool.net, built clean-room (**no nullschool
code — their site is a reference for datasets and visual ideas only**), with
the EarthAtlas differentiators: plain-language explanation of what you're
seeing, and inline provenance on every value.

This file records how the wind stack works, the hard-won gotchas, and the
**playbook every new layer must follow**. Companion docs:
`docs/MAP_TOOL_CONVENTIONS.md` (suite-wide map-tool rules, incl. the globe
carve-out that /systems uses).

---

## 1. Architecture: one model run, one source of truth

The prime rule of /systems: **everything on screen about a dataset — the
animation, the click-to-inspect readout, the run stamp — samples the same
baked file from the same model run.** Never mix a live number with a stale
visual (or vice versa); two sources disagreeing on one screen is exactly the
confusion this tool exists to eliminate.

```
NOAA GFS (via Unidata THREDDS NCSS, NetCDF3)
        │  every 6 h
api/cron/gfs-wind.js  ──►  Vercel Blob  systems/gfs-wind-meta.json   (provenance + geometry)
  (api/_gfs-wind-core.js)               systems/gfs-wind-grid.bin    (Int16, ~1 MB)
        │                                        │
        │ local dev: scripts/bake-gfs-wind.mjs   │  fetched directly by the browser
        │ → public/dev-data/systems/ (gitignored)▼  (Blob first, dev-data fallback)
        │                          src/systems/windField.js   (bilinear sampler)
        │                                        │
        │                 ┌──────────────────────┴──────────────────┐
        │                 ▼                                         ▼
        │   src/systems/windParticles.js               click popup + panel stamp
        │   (canvas particle renderer)                 (same field, same run)
```

**Why self-baked instead of Mapbox MTS raster-array:** Josh's explicit
decision (2026-08-20). MTS + the native `raster-particle` layer renders on
the GPU but costs a billed processing job per refresh (~4/day forever), needs
a secret token, and puts Mapbox between NOAA and our users. The canvas
renderer is $0, provenance-clean, and comfortably smooth at our densities.
MTS remains a graduation option if we ever need tens of thousands of
particles; the bake pipeline would be reused as-is.

### Data source gotcha (learned the hard way)

**NOMADS retired OpenDAP/GrADS-DODS in 2025** (NWS Service Change Notice
25-81) — do not try `nomads.ncep.noaa.gov/dods/...` again. We fetch from
**Unidata THREDDS NCSS** instead (`thredds.ucar.edu/thredds/ncss/grid/grib/
NCEP/GFS/Global_0p25deg/Best`), which returns NetCDF3 parsed by the tiny
pure-JS `netcdfjs` — no GRIB2 decoding, no native deps. `time=present`
always selects the step nearest now, so cron timing never needs to track
GFS publication lag. Unidata/UCAR is the canonical public redistributor
(4 requests/day is nothing).

### Baked grid format (v1)

- `*-meta.json`: `{ version, kind, run_ms, valid_ms, fetched_ms, nLat, nLon,
  lat0, dLat, lon0, dLon, scale, missing, source }`
- `*-grid.bin`: Int16 little-endian, planes concatenated (u then v for
  vectors; a single plane for scalars), row-major from `lat0` (north first),
  physical value = raw / `scale`, missing = `-32768`.
- Global 0.5° (720×361) ≈ 520 KB per plane. Fine to ship whole — the model
  grid is the resolution floor, tiling buys nothing at planet scale.

### Cron conventions (mirrors api/cron/nifc-snapshot.js)

- Node runtime (NOT edge — `@vercel/blob` needs `node:stream`).
- `CRON_SECRET` bearer guard.
- **A failed pull is skipped, never published** — sanity checks (expected
  dims, origin, missing-value fraction, plausible range) throw before any
  write, so a transient upstream error can't blank or corrupt the layer.
- **Write grid before meta** — meta is the client's pointer; a crash between
  writes leaves a consistent old pair, never a mixed one.
- Blob paths are deterministic (`systems/<dataset>-{meta.json,grid.bin}`),
  `allowOverwrite`, `cacheControlMaxAge: 300`. Blob serves
  `access-control-allow-origin: *` (verified), so the client fetches it
  directly — no API proxy, no vite dev plugin needed.
- Local dev: `node scripts/bake-gfs-wind.mjs` (no token → writes
  `public/dev-data/systems/`, gitignored; client falls back to that path).

**Deploy note:** after the first deploy of a new layer, seed its Blob pair
once (Vercel dashboard → Crons → Run, or curl with the CRON_SECRET bearer) —
until then the layer shows its honest "unavailable" state.

---

## 2. The particle renderer (src/systems/windParticles.js)

Clean-room implementation of the standard animated-flow-map technique:

1. **Screen-space vector field, rebuilt once per camera move** — unproject a
   16 px grid to lng/lat, sample the data grid there, store each node's
   screen-pixel velocity. The per-frame loop is then pure array math + canvas
   strokes; no projection calls per particle per frame. Because the field is
   built through `map.project/unproject`, it works identically on globe and
   mercator.
2. **Globe horizon detection**: a screen point is on the visible face iff
   `project(unproject(p))` round-trips to within 2 px. Off-face nodes are
   invalid; particles entering them respawn.
3. **Trails by compositing**: each frame the canvas is faded
   (`destination-in`) before new segment heads draw, batched into one
   `Path2D` per color bucket.

### Perceptual speed shaping (the part that makes it feel right)

Three multiplicative pieces, all in the stored node vectors / frame step —
**any future vector-animated layer (ocean currents!) must apply all three**:

- **Frame-rate independence**: advance and fade scale by real elapsed time
  (`k = dt/16.7 ms`, clamped 4–50 ms). Without this the animation ran 2×
  fast on 120 Hz laptops — this was most of "the wind looks too fast".
- **Zoom normalization**: projected displacement doubles per zoom level for
  the same physical speed, so calm air races when zoomed in. Scale by
  `2^(BASE_ZOOM − zoom)` (floored at 0.05) to keep the default-view feel at
  every zoom.
- **Speed gamma**: linear m/s→px reads poorly — calm and breeze blur
  together. Advance ∝ `speed^1.3`, pivoting at 10 m/s (unchanged there), so
  calm visibly crawls and gales visibly race. Color still encodes absolute
  speed; motion now reinforces it.

Tuning knobs, all constants at the top of the file: `SPEED_FACTOR` (global
tempo, 0.42), `SPEED_GAMMA` (1.3), `GAMMA_PIVOT_MS` (10), `FADE` (0.94),
`GRID_STEP` (16 px), density presets in SystemsApp (1800/3500/6000).

### Renderer gotchas (all hit for real during the build)

- `map.unproject` can return **non-finite lng/lat at/beyond the globe's
  horizon**, and feeding that back to `map.project` throws deep inside
  Mapbox ("reading 'NaN'"). Guard every projection call.
- The overlay canvas can measure **0×0 at construction** (pre-layout).
  `_rebuild` bails; the frame loop self-heals by rebuilding whenever the CSS
  size disagrees with the built field.
- The loop **pauses on `document.hidden`** — correct for battery, but it
  means headless/hidden QA browsers screenshot an empty canvas *by design*.
  Don't chase that as a bug (again).
- The canvas is plain DOM above the map (`pointer-events: none`), so basemap
  style swaps never touch it, and map clicks fall through for the readout
  popup.

---

## 2b. The scalar overlay (src/systems/scalarOverlay.js)

Scalar fields (SST, wave height) paint as translucent colored cells on a
canvas, using the same screen-space walk as the particle field build — but
only on camera settle; nothing runs per frame. A cell paints only if its
center and all four corners survive the globe-horizon round-trip, giving a
clean edge inside the rim. Known cosmetic limit: extreme foreshortening at
the horizon makes edge cells span many degrees, so the last row of cells
looks coarse — acceptable at normal viewing, revisit if it bothers anyone.
Scalar layers are **mutually exclusive** (one "surface color" slot — the
panel auto-switches); vector layers stack freely on their own canvases.

## 2b-bis. Coastal stair-steps: the three-part fix (2026-08-21)

Ocean rasters used to stop in dark 0.5° blocks short of every shoreline.
Compound cause, all three now fixed — regressions here are visually loud:
1. **Never stride-sample a land-masked grid.** The SST bake strided CRW's
   5 km grid ×10; a coastal cell became "land" if the one sampled native
   pixel was land, even with the cell 90% ocean. SST/anomaly now bake at
   0.25° (stride 5, ~2 MB grids).
2. **`fillCoastalGaps` at bake**: missing cells with ≥3 valid neighbors take
   the neighbor mean, ONE iteration only — display-grade boundary
   interpolation (as GHRSST-style products do), applied to sst, sstanom,
   waves, and currents (which also lets particles reach the shore).
3. **Tolerant client sampling**: `GridField._bilinear` renormalizes over
   valid corners (null only when all four missing). The old all-4-valid rule
   discarded every sample within one cell of a coast.
4. **The actual fix — mask to water polygons.** Steps 1–3 get data TO the
   coast, but a grid boundary is still a lattice (0.25° stair-steps,
   overshoot onto Sicily). **Gotcha that cost a false "fixed": Satellite
   Streets (our default) has NO water fill layer in its style** — querying
   the style's water fills silently returns nothing. So SystemsApp adds its
   own invisible fill layer `systems-water-mask` on every `style.load`
   (source `composite` = Mapbox Streets v8, source-layer `water`,
   fill-opacity 0 — the tiles are already loaded for labels, zero extra
   traffic). `paintWaterMask` in scalarOverlay.js queries THAT layer via
   `queryRenderedFeatures`, fills the polygons (evenodd — islands are holes)
   into a mask canvas, and `destination-in`s the wash. The popup land/water
   flag queries the same layer (it too was dead on satellite before). Pixel-perfect shorelines at any data
   resolution; the generous paint from 1–3 becomes the feature (fills UP TO
   the coast, mask trims AT it). Ocean layers opt in via
   `scalar.mask: 'water'` (sst, sstanom, waves; airtemp is global — no
   mask). Applied only when the globe horizon is off-screen (horizon-
   straddling polygons project garbage; coasts are ~1 px at world zoom
   anyway). Repaints on map `idle` (≥400 ms apart) because at moveend the
   new area's water tiles may not be loaded yet and the mask would clip
   against an incomplete coastline — verified: a half-loaded view showed
   perfect coasts only inside the loaded tile, then filled in on idle.
Net: exact coastlines; popup values within ~1 cell of shore are
boundary-interpolated.

## 2b-ter. Globe-mode rasters are Mapbox-draped (2026-08-22)

Screen-space repaint + camera-follow freeze could never stay locked to a
rotating globe (rotation isn't affine → rasters swam off coastlines, then
snapped). Fix: in globe mode (horizon on screen) `ScalarOverlayLayer` bakes
the field ONCE into a 2048² web-mercator image (land-masked with the 0.1°
Natural Earth raster, `bakeMercatorImage`) and adds it as a Mapbox **canvas
source + raster layer** (inserted below the first symbol layer so labels
stay on top; re-added on `style.load`). The GPU projects it in lockstep
with the basemap — zero per-frame work, zero drift. Zoomed in (horizon
off-screen) the screen-space painter + vector water mask take over for
full-resolution crisp coasts. Also in this era: `globeGeom.js` exact
inverse (Mapbox unproject saturates ~72° from center), `landMask.js` +
`scripts/bake-land-mask.mjs` (Natural Earth 10 m → 0.1° bits, static
asset in public/systems/), and the vector-mask rim handling (great-circle
densification + horizon clamping + real tile coverage via
`style.getSourceCache('composite').getRenderableIds()`), which remains in
use only when zoomed in. Particles (wind/currents) still rely on the affine
freeze during gestures.

## 2c. Live layer roster (2026-08-20) and the source hunt

| Layer | Source actually used | Cadence / lag | Dead ends hit first |
|---|---|---|---|
| Wind | NOAA GFS via **Unidata THREDDS NCSS** | 6 h cron; `time=present` | NOMADS OpenDAP retired (SCN 25-81) |
| Ocean currents | **HYCOM/Navy ESPC-D-V02** via ncss.hycom.org (surface `water_u/v`, stride 6, `accept=netcdf` — this older TDS rejects `accept=netcdf3`) | 6 h cron; analysis+forecast to now | OSCAR: every public ERDDAP copy frozen (2014/2018); OSCAR v2 needs Earthdata auth |
| Sea temperature | **NOAA Coral Reef Watch CoralTemp** via CoastWatch ERDDAP (`NOAA_DHW`, `CRW_SST`, index-strided ×10 → 0.5°) | 12 h cron; daily product, ~1-day lag | OISST *final* lags ~2 weeks — too stale to label "live" |
| Waves | **WaveWatch III global** via PacIOOS ERDDAP (`ww3_global`, `Thgt`, value-based time constraint → nearest-to-now step) | 6 h cron; forecast series | — |

All four verified with real fetches before any bake code was written. New
datasets register in `api/_systems-datasets.js` (shared netcdf/encode/meta
helpers; axis geometry always read from the response's own coordinate
arrays — HYCOM is south-first ascending, GFS north-first descending,
CoralTemp lon starts at -180) and are served by the single generic cron
`api/cron/systems-bake.js?ds=<id>` (`maxDuration = 300` — HYCOM's NCSS can
take minutes). Client-side, layers are declared in `src/systems/layerDefs.js`
(ramps, legend ticks, plain-language scale words, per-dataset speed tuning,
popup formatters, explainers) — adding a layer touches only those two files
plus a vercel.json cron line.

**Post-deploy seeding**: run each of the four cron URLs once (Vercel
dashboard → Crons → Run) or the layers sit in their honest "unavailable"
state until first fire.

## 2d. "Explain this view" (AI narration)

Split architecture so the AI can never invent a number: `src/systems/
viewFacts.js` (facts engine — deterministic screen-sampled stats over the
active layers' in-memory data, coarsely rounded so nearby views produce
identical payloads) → GET `/api/systems-explain?f=<base64url facts>` →
`api/_systems-explain-core.js` narrates via `claude-haiku-4-5` (explicit
cost decision by Josh; @anthropic-ai/sdk), max_tokens 400, prose-only rules.
Cost levers: on-demand button only, CDN `s-maxage=3600` on the GET (rounded
facts = shared cache entries), spend cap in the Anthropic console. Requires
`ANTHROPIC_API_KEY` (Vercel env + optionally .env.local for dev); without it
the endpoint 503s and the card shows the facts with an honest
"narration not configured" note — the facts chips carry the feature alone.
Dev middleware: `systemsExplainPlugin` in vite.config.js (the 6th-place
pattern). Gotcha: the facts engine measures `map.getCanvas()`, not the
container — they can disagree pre-resize and unproject lives in canvas space.

## 2d-bis. Fire impact estimates (FRP → CO₂)

Per Josh (2026-08-21): the Explain card must never normalize scale away —
"seasonal" and "alarming" are both true of savanna burning season. The bakes
now keep summed fire radiative power (per bin 5th element, per event
`frp_sum`, global `meta.frp_sum_mw`), and the facts engine converts it
GFAS-style: sustained MW ≈ frpSum/2 (≈2 VIIRS overpasses/day) → biomass
0.368 kg/MJ (Wooster 2005) → CO₂ ×1.65 (savanna EF) → `est_co2_tonnes_per_
day`, labeled rough ±50%. Sanity: implies ~49 Mt CO₂/day globally in peak
August — high side of GFAS range, inside the label. The narration prompt now
mandates impact framing (emission estimate is the headline; seasonal ≠
insignificant; well-known reference magnitudes allowed as clearly-approximate
context — view-specific numbers still only from facts). Verified over Angola:
"~one-third of global fire radiative power … est. 17 Mt CO₂/day."
Future: CAMS/GFAS proper (needs free ADS account), aerosol/smoke layer.

**Popup AI context (2026-08-21):** every click popup auto-appends a 1–3
sentence narration under a dashed divider — same endpoint with
`mode:"popup"` facts (the popup's own head/value/detail strings, click
point rounded to ~10 km for CDN cache sharing, max_tokens 260). Pending
state "Adding context…"; any failure silently removes the line (the
computed facts stand alone). Fire-event popups also carry a DETERMINISTIC
per-fire CO₂/day line (same FRP conversion), so impact shows without AI.
Cost note: popups fire more often than the Explain button — watch the
Anthropic console after launch; the spend cap is the backstop.

**Location grounding (hard-won, 2026-08-21):** the model misreads raw
coordinates (placed a 4.7°E North Sea platform flare "near Ullapool", 5°W —
and when given only a water flag it rationalized it away as "inland fires
seen from offshore"). Prompting alone was insufficient; the fix is
deterministic ground truth: (1) hemisphere-lettered coordinate labels,
(2) client land/water flag from the basemap's water polygons
(queryRenderedFeatures), (3) the endpoint reverse-geocodes the point
server-side (Mapbox; no result over open ocean IS the offshore signal) and
injects point.reverse_geocode as authoritative, with blunt prompt rules
(offshore fires = platform flares/ships; never name land as their location).
Needs MAPBOX_TOKEN server-side (Vercel env has it; vite plugin passes it in
dev). Round 2 of the same lesson: with no land place returned (open water)
the model AGAIN misread E/W and put the Balearic Sea "in the Atlantic" — so
the core now carries a ~30-entry marine-region bbox table (specific seas
before ocean basins, first match wins) and every water point gets a NAMED
sea injected ("the western Mediterranean Sea, near Palma"). Also added: a
knowledge-cutoff rule (no "has persisted through <current year>" claims —
the model fabricated current-season events) and a ban on derived physical
quantities (it converted M6.4 to "500 kilotons of TNT", off ~8×; unit
conversions only). Every one of these rules exists because the failure
actually happened — keep them.

## 2e. Fire events (derived, GWIS-style)

Investigated GWIS/GlobFire (2026-08-21) for global fire names/shapes:
**no one names fires globally** (names are national: NIFC/InciWeb US, CWFIS
CA — both already in /fire); GlobFire perimeters are bulk archives at
weeks-to-months latency; JRC's live OGC services expose only rasters/indices
and were mid-outage (Oracle errors) when probed. So we derive events
ourselves from the FIRMS detections the hotspots bake already pulls —
GWIS derives from the same upstream, at monthly latency; ours refreshes with
the cron.

Pipeline (inside `fetchHotspots`, guarded so an events failure never blocks
the hotspot files): detections → 0.05° cells → **DBSCAN-style** connected
components (only cells with ≥2 detections bridge — plain 8-adjacency fused
a single 391,000 km² "Zambia fire" out of savanna season) → convex-hull
footprints (≤24 pts, antimeridian-safe local frame) → filter (≥10 det, ≥3
cells, top 600) → **run-to-run linking** (nearest prev event ≤0.4°, carries
`first_seen_ms`/label/growth; prev state read from the public Blob) →
**reverse-geocode new events** (Mapbox, ≤40/run, labels accumulate across
runs; coordinate fallback) → `systems/fire-events.json` (~165 KB). Events
with area >20,000 km² or >400 cells are typed `regional` (savanna/ag
season burning), everything else `fire`.

**US events get their OFFICIAL name AND perimeter** via `nameEventsFromNifc`:
nearest named incident within ~15 km from our own `fire/nifc-incidents.json`
snapshot (same Blob the /fire cron writes) → "Sinlahekin Fire" plus
discovery date (true fire age), acres, containment, and the mapped NIFC
perimeter geometry embedded in the event (`perimeter_src: 'nifc'` — drawn
solid in place of the derived hull; detection glows stay inside it because
perimeter = cumulative burn, glows = active front, complementary not
redundant). Perimeters read `fire/nifc-perimeters-low.json`, falling back to
simplifying the full file (the -low bake has been observed failing silently
— chip filed). Matched events skip the geocode budget; runs after linking
so official data overrides stale carried labels.

Client: `src/systems/fireEventsOverlay.js` draws hull outlines past zoom
3.2 (regional = dashed) with **labels that earn their place** — geocoded/
official names only (never the "N detections" fallback; counts live in
popups), only for events reading as significant at that zoom (≥28 px hull
or ≥500 detections), max 8 labels below z4.5, deduped by proximity.
`hitTest` upgrades fire clicks to rich popups ("Large fire near Purpe, Russia · 681 detections ·
~327 km² footprint · active N+ days · peak MW"). Everything user-facing says
**"footprint derived from VIIRS detections, not an official perimeter."**
Local dev: `first_seen` is always "today" until the Blob has state.
**/fire integration is still TODO** — the baked file is app-agnostic.

GWIS leftovers worth revisiting: GlobFire seasonal burn-scar archive as a
monthly-baked /fire layer (CC-BY, credit JRC/GWIS); ECMWF fire-danger (FWI)
as a /systems risk layer.

## 2f. CAMS (Copernicus) layers — the ADS pipeline (2026-08-21)

Josh's ADS account → `ADS_API_KEY` (personal access token; Vercel prod +
.env.local). `fetchCamsField(cfg)` in api/_systems-datasets.js is generic:
submit → poll (≤230 s, inside the cron's 300 s) → download zipped NetCDF4
→ **h5wasm** (HDF5; netcdfjs can't read NetCDF4) → standard grid pair.
Each ADS dataset's licence must be accepted ONCE in the web UI (403
"required licences not accepted" otherwise — the error links the page).
Fields arrive float32, 0.4° (451×900), north-first, lon from 0; ~35 s per
job. Runs 00z/12z; observed publication latency >8 h (12z not served at
20 UTC), so candidates are tried newest-first with ≥10 h age and the lead
hour that lands nearest now — the stamp reports whichever run served.
First layer: **Smoke & haze** (`aerosol`, total AOD 550 nm, Air group,
param `s`); ramps now support alpha so clear air is transparent.
**Animation for scalar layers — `def.flow`.** A scalar has no motion of
its own, but haze is carried by the wind, so a layer def may declare
`flow: { dataset, expectKind, stops, vector, countScale }`: SystemsApp loads
that grid under the key `<id>:flow`, runs a second ParticleLayer on its own
canvas (neutral white, 60 % density) whenever the layer is on, and the popup
cites the wind sample + its GFS run whenever the Wind layer isn't already
doing so. Reuse for any future "what carries this" pairing (CO/PM2.5 → wind;
a plastics/larvae layer → currents). The next step up is true time-lapse:
ADS returns several `leadtime_hour`s in one job, so baking e.g. 0–24 h at
3 h (Uint8 planes, ~400 KB each) would let the haze itself advance —
budgeted at a few MB per layer; not built yet.
**Speciated aerosol (2026-08-21):** `smoke` = organic matter + black carbon
AOD (the biomass-burning aerosols; `readCamsFieldSum` / `readCamsFramesSum`
sum several CAMS variables from one job — `cfg.variables` / `cfg.varNames`),
`dust` = mineral dust AOD. Blob bases `systems/cams-smoke`, `systems/cams-dust`;
live crons 52/54 past each 6 h, tapes 01:35/13:35 & 01:45/13:45. Caveat in
the explainer: organic aerosol includes some urban/biogenic haze.
Next CAMS candidates (config entries + licence clicks): CO (smoke tracer —
pairs with fires), PM2.5, NO₂ (composition forecasts), then CO₂/CH₄ columns
from `cams-global-greenhouse-gas-forecasts` (separate licence).
**Deploy check:** h5wasm loads a .wasm from node_modules at runtime — verify
the first prod cron run; if the wasm isn't traced into the function bundle,
add it via `functions[...].includeFiles` in vercel.json.

## 2g. Replay — history tapes + the transport bar (2026-08-21)

**Earth's systems are in motion: a replay-capable layer starts PLAYING the
moment it's switched on** (Josh's rule), loops over the last 14 days (7/14/31 on
the bar's toggle; Josh's call 2026-08-21 — ~11 MB per view, ≈$0.55 per 1,000 replay views in Blob egress), holds 2.5 s on NOW, and restarts. The bar at the bottom
is a video transport (⏮ −1 d ◀︎ ⏯ ▶︎ +1 d Now⏭, scrubber, space/←/→ keys) with a
large date/time readout — UTC + the viewer's local zone — and the frame's
provenance (analysis vs forecast, run, lead). Nothing on screen is ever
ambiguous about *when* it is.

Pipeline:
- **Bake** — generic `bakeTapeDay(tape, {day, existing, blobBase})` driven by
  the registry `SYSTEMS_TAPES = { aerosol, airtemp, sst, sstanom, waves }`
  (api/_systems-datasets.js; `bakeTape(name, opts)` is the entry point). A
  tape config is `{ kind, source, qscale, offset, nodata0, stepH, latencyH,
  frameKind, maxAbs, maxMissingFrac, expectedTimes(day, now), fetchDay(day,
  wanted) }` built by a per-source factory (`camsTape`, `gfsTape`, `crwTape`,
  `ww3Tape`). One UTC day per call; frames are 8-bit grayscale PNGs at
  `systems/<blobBase>-tape/<YYYY-MM-DD-HH>.png`, index `<blobBase>-tape.json`
  `{ version, kind, source, grid…, qscale, offset, nodata0, step_ms, days,
  frame_kind, frames:[{valid_ms, run_ms, lead_h, path}] }`. Merge rule: one
  frame per valid time, shorter lead wins; 31-day rolling cutoff. Idempotent:
  a day whose frames are all on tape returns `unchanged`.
- **Byte encoding**: `byte = clamp(round((value − offset) × qscale), nodata0 ? 1 : 0, 255)`,
  `value = byte / qscale + offset`. When `nodata0` (ocean-only layers) byte 0
  means NO DATA (land/ice) and real values start at 1. Per tape:

  | tape | source, cadence, latency | grid | qscale / offset / nodata0 | range & step | PNG |
  |---|---|---|---|---|---|
  | aerosol (cams-aod) | CAMS ADS, 3 h (leads 0/3/6/9 of 00z/12z), ≥10 h | 451×900 0.4° | 50 / 0 / no | 0…5.1 AOD, 0.02 | ~100 KB |
  | airtemp (gfs-airtemp) | GFS via THREDDS Best, 3 h (analysis + 3 h leads), ~5 h; **archive ≈ 7 days only** | 361×720 0.5° | 2 / −70 / no | −70…+57.5 °C, 0.5 | ~100 KB |
  | sst (crw-sst) | Coral Reef Watch CoralTemp via ERDDAP, **daily** 12:00Z, ~30 h (the day after) ; back to 1985 | 720×1440 0.25° | 5 / −3 / yes | −2.8…+47.8 °C, 0.2 | ~235 KB |
  | sstanom (crw-sst-anomaly) | same product, daily 12:00Z, ~30 h; ≈45 % missing (ice masked) so `maxMissingFrac` 0.6 | 720×1440 0.25° | 20 / −6.3 / yes | −6.25…+6.45 °C, 0.05 (extremes clip) | ~380 KB |
  | waves (ww3-waves) | WaveWatch III via PacIOOS ERDDAP (hourly, we keep 3 h), ~6 h; back to 2017 | 311×720 0.5° | 12.7 / −1/12.7 / yes | 0…20 m, 0.08 | ~55 KB |

  Local tapes (dev-data): 7 days airtemp 5.3 MB, 14 days sst 3.3 MB, 14 days
  sstanom 5.2 MB, 7 days waves 3.0 MB, 8 days aerosol 5.8 MB — a full month
  ≈ 23 MB (airtemp) / 7 MB (sst) / 11 MB (sstanom) / 13 MB (waves) / 25 MB
  (aerosol), all streamed lazily.
  Sources gotchas: the THREDDS Best series is NOT 3-hourly-indexed — request a
  `time_start/time_end` range without `timeStride` and filter to the wanted
  valid times (`reftime` per step gives the run); a multi-run CAMS file is
  `[lead, run, lat, lon]` (lead-major) — `readCamsFrames` indexes planes by
  the variable's own shape; CRW's anomaly masks far more than SST (sea ice).
- **Crons** (vercel.json), each `systems-bake?ds=<name>&tape=1` with no
  `day` (newest published day, via `latencyH`):
  aerosol `25 1,13 * * *` · airtemp `40 2,8,14,20 * * *` · waves
  `45 2,8,14,20 * * *` · sst `30 19 * * *` · sstanom `35 19 * * *`. The cron
  reads the existing index from the tape's OWN blobBase (sstanom's tape base
  `systems/crw-sst-anomaly` differs from its grid base `systems/crw-sstanom`).
- **Seed prod once after deploy** (BLOB_READ_WRITE_TOKEN set; idempotent):
  ```
  node scripts/bake-systems-tape.mjs aerosol 31   # ~30 ADS jobs, 40–90 s each
  node scripts/bake-systems-tape.mjs airtemp 31   # only ~7 days come back (THREDDS Best)
  node scripts/bake-systems-tape.mjs sst 31
  node scripts/bake-systems-tape.mjs sstanom 31
  node scripts/bake-systems-tape.mjs waves 31
  ```
  Backfill depth is capped by the upstream archive: GFS ≈ 7 days, HYCOM
  (when a currents tape exists) ≈ 10, CRW and WW3 go back years.
- **Client** `tape.js` TapeField reads `qscale/offset/nodata0/step_ms/frame_kind`
  (old indices default to offset 0, nodata0 false, 3 h); `value = byte/qscale
  + offset`; bilinear skips byte-0 corners with renormalised weights when
  nodata0 (null if nothing valid — popups show nothing over land); lazy PNG
  decode → byte grids; the regular "latest" grid is appended as the LIVE
  frame (same encoding; skipped when it isn't newer than the tape's last
  frame, as happens in dev with stale dev-data) so the loop lands on now;
  `sampleScalar` (popups, facts, screen-mode paint) and `metaAt` (stamp of
  the frame on screen: run/valid/lead/frame_kind/step_ms/live) — `tapeStamp()`
  in layerDefs turns that into the popup's "archive frame …"/"daily frame …"
  line; the "Explain" facts carry `frame_time_utc` + a REPLAY note so the
  narrator writes in the past tense.
- **ReplayController** paces itself from the tape: 2 frames/s (3-hourly →
  6 h/s, daily → 2 days/s), default window 7 days for 3-hourly tapes and 31
  for daily (`def.tape.windowDays` overrides); `windowOptions` offers the
  7 d / 31 d toggle only when the tape spans > 8 days AND has ≥ 2× the
  frames of the 7-day window (daily tapes never show 7 d); day steps on a
  daily tape snap to the adjacent frame stamp instead of jumping 24 h. The
  TransportBar says "daily frames"/"3-hourly frames" from `step_ms`, uses
  `frame_kind` for the provenance wording, hides the ◀︎/▶︎ frame buttons on
  daily tapes (−1 d/+1 d ARE the frame steps) and only says "model run …"
  when a run is meaningful (leads, live, CAMS/GFS analyses — not hindcast or
  daily satellite fields stamped run = valid).
- **Motion, not dissolve** (`tapeFlow.js` + `tapeWarpGL.js`): a plain
  cross-fade between 3-hourly frames reads as ghosting/"back-and-forth"
  (Josh spotted it). We solve dense optical flow between consecutive frames
  (Lucas–Kanade, 4× downsampled, 3 iterations, ≈30 ms warm, scheduled on
  idle during prefetch) and a WebGL shader warps frame A forward and frame B
  backward along it before blending — plumes travel. The shader canvas IS
  the Mapbox canvas source (`preserveDrawingBuffer`, `animate: true`),
  1024² mercator, LUT + optional 0.1° land-mask textures. CPU cross-fade
  fallback if WebGL is unavailable (additive 'lighter' blend — B *over* A at
  alpha=mix throbbed once per frame on a translucent ramp).
  **Two WebGL1 gotchas that had silently disabled the GPU path until
  2026-08-21** (the CPU fallback was what everyone saw): GLSL ES 1.0 has no
  `sinh()` (the shader failed to compile → fallback), and NPOT textures (every
  grid: 1440×720, 900×451…) may only use `CLAMP_TO_EDGE` — `REPEAT` samples
  return black. The shader now does its own bilinear (`sampleGrid`): wraps
  longitude by hand, and when `nodata0` skips byte-0 texels and renormalises
  the weights, so ocean tapes have no dark/cold rim along coasts; a pixel with
  no valid neighbour is discarded (transparent). The land mask still
  discards land first. Uniforms `uOffset`, `uNodata0` carry the encoding.
  Verified GPU == CPU fallback pixel-for-pixel (premultiplied).
- `def.flow` companion particles are only honest at NOW, so they hide
  while the tape is in the past, and the popup's wind citation follows suit.
- Switching scalars: the scalar canvas is shared and scalars are mutually
  exclusive, so SystemsApp destroys the old ScalarOverlayLayer AND its
  ReplayController (`replayRef`) before creating the next — verified sst →
  sstanom → airtemp leaves exactly one controller ticking.
- Gotchas: the cron must read the existing index from the real Blob base
  (an empty base URL silently rewrote the tape with one day); the Browser
  pane used for QA is `document.hidden` → the controller and particle loops
  pause there by design (seek with `window.__systemsReplay`, switch layers
  with `window.__systemsToggle(id)`, map at `window.__systemsMap` — all
  dev-only).

Next: vector tapes (wind, currents) — two planes per frame (u/v PNG pair or
a two-channel PNG), a ParticleLayer that swaps its GridField per tick, and
HYCOM's ~10-day archive as the currents backfill. Not built; the scalar
registry above is the template. Also: more CAMS fields (CO, PM2.5, NO₂) are
config + a licence click + a cron line.

### 2g-ter. Why air temperature is 3-hourly, not hourly
Asked for (2026-08-21): hourly frames so the diurnal wave sweeps. Not
available: Unidata's GFS 0.25° Best series carries only 3-hourly steps (even
for today's run), and NOAA's hourly files are GRIB2, which we don't decode.
The motion-warp interpolates between the 3-h frames, so the terminator
already moves continuously. `gfsTape({ stepH })` supports hourly if a source
appears. Gotcha fixed alongside: THREDDS names the time axis `time`/`time1`…
per request — the reader now takes it from the data variable's dimension.

### 2g-bis. Year-long weekly tapes (slow layers)

Daily ocean fields barely change in 31 days (SST drifts ~0.4 °C in two
weeks — invisible on a −2…35 °C ramp), so the slow layers carry a second
tape: `weeklyOf(dailyTape)` in api/_systems-datasets.js takes the Thursday
12:00Z field every 7 days, 371-day rolling (53 frames ≈ 12 MB). Registry
names `sst-year`, `sstanom-year` (blob bases `…-year`); cron Fridays 19:50/
19:55 UTC; backfill `node scripts/bake-systems-tape.mjs sst-year 371` (the
script skips non-Thursdays quietly). Layer defs declare
`tape.year = { dataset }`; the bar shows a **31 d / 1 y** toggle
(`replayRange` state in SystemsApp → loads `<id>:tape:year` lazily and swaps
the overlay/controller like any tape swap); weekly tapes step −1 w / +1 w,
play the whole year at 2 frames/s (~26 s), and the cadence line says
"weekly frames, last year".

Motion-warp is only applied at sub-daily cadence (`TapeField.useFlow`:
step ≤ 6 h). Daily/weekly fields are plain-blended — SST doesn't advect
day-to-day, and the warp was punching mix-dependent notches along coasts
wherever a displaced sample landed on no-data (also guarded now: a warped
sample on no-data falls back to the unwarped one, in the shader and the CPU
sampler).

### 2h. Long-running globes stay current (2026-08-21)
SystemsApp polls every 10 min (tab visible): for each visible layer it fetches
the tiny `-meta.json` / `-tape.json` from Blob and compares `fetched_ms`;
only a newer bake triggers a reload and an in-place rebuild of that layer
(replay position + play state are carried over via `resumeRef`; camera and
other layers untouched). Event feeds (quakes, hotspots) re-pull each cycle.
Dev note: the check reads the prod Blob base, so on localhost (dev-data)
nothing ever looks newer — expected.

**Prod backfills (2026-08-21 lesson):** drive the cron endpoint with a day
LIST — `/api/cron/systems-bake?ds=<tape>&tape=1&days=d1,d2,…` (Bearer
CRON_SECRET; ≤ ~240 s of work per call: ~2 CAMS days, 7 GFS/WW3 days, 31
CRW days, 27 weekly). Rapid single-day calls read a CDN-stale index and
dropped frames; the handler now holds the index in memory across the list
and the index TTL is 60 s. Local bakes with BLOB_READ_WRITE_TOKEN are fine
too (sequential, in-process).

### 2i. Event timelines (earthquakes) — replay without a bake
`EventTape` (src/systems/eventTape.js) turns the USGS feed's own timestamps
into a tape the ReplayController can drive. Playing: 3-h ticks, ~3 s per
day, each quake bursts at its tick and fades over ~9 h; bar shows the date
only. Paused/stepped: the whole UTC day, steady. NOW: the past 24 h. If a
scalar replay is active it owns the bar and the pings follow its cursor.
Def flag: `timeline: { stepH, windowDays, rateHoursPerSec, dayLabel }`.

## 3. Playbook: adding a layer to /systems

Every new dataset (ocean currents, SST, waves, aerosols…) follows the same
shape. Checklist:

**Pipeline**
1. Find the authoritative open source (prefer the agency of record; check
   whether THREDDS/NCSS serves it — OSCAR/CMEMS currents and OISST have
   their own distribution channels). Verify the fetch works *before* writing
   the bake (the NOMADS retirement was found by testing, not docs).
2. `api/_<dataset>-core.js`: fetch → sanity-check → encode the meta+bin pair
   (format §1; scalars are one plane, vectors two). Throw on anything odd.
3. `api/cron/<dataset>.js` + `vercel.json` cron entry, matched to the
   dataset's real cadence (GFS 6 h; OSCAR daily; OISST daily). Don't poll
   faster than the source updates.
4. Extend `scripts/bake-gfs-wind.mjs`'s pattern for local dev data.

**Client**
5. Load via the `windField.js` pattern (Blob → dev-data fallback, bilinear
   sampler, version/kind check).
6. Vector data → animate with the particle renderer **including all three
   speed-shaping pieces** (currents are ~100× slower than wind — retune
   `SPEED_FACTOR`/pivot per dataset, the physics differ). Scalar data (SST,
   aerosol optical depth) → color overlay instead, but same click-to-inspect.
7. Layer row in the panel: switch + name + **inline source link**; per-layer
   legend with **plain-language scale words** next to the numbers; entry in
   the "What am I seeing?" explainer.
8. **Provenance states, all three**: live stamp ("● Live — model run X,
   fetched N ago"), loading, and the honest failure state ("unavailable
   right now… we don't show stale or made-up data") — a layer with no data
   shows nothing, never yesterday's field unlabeled.
9. Click-to-inspect popup reads the same grid as the visual, plain-language
   first ("Strong — 12.3 m/s (28 mph) from the west"), with source + run
   stamp in the popup itself.
10. URL state params for the layer's toggle/options (short stable keys,
    omitted at defaults), per `docs/MAP_TOOL_CONVENTIONS.md`.
11. Methodology modal section: what it is, where it's from, why it matters,
    caveats.

**Ship**
12. `npm run build` locally, Josh QAs on localhost:5173, batch into one push
    to main, seed the new Blob pair once post-deploy.

---

_Update this file in the same change when the pipeline, renderer, or playbook
changes — same rule as MAP_TOOL_CONVENTIONS.md._
