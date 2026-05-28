# AlphaEarth Foundations in /forestmonitor

End-to-end integration of Google DeepMind's [AlphaEarth Foundations
Satellite Embedding dataset](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
(`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL` — 64-D unit-length annual embeddings
at 10 m, 2017–2025) into the /forestmonitor click popup.

**Branch:** `feat/forestmonitor-alphaearth`
**Status:** code complete, smoke-tested locally end-to-end against real
Earth Engine. NOT deployed, NOT pushed.

## What the user sees

A new purple **"AlphaEarth context"** block at the bottom of the popup,
between the existing land-cover/fire context and the "How this is sourced"
link. The block renders on both disturbance clicks (red OPERA pixels) and
stable clicks (clean areas — useful for fingerprinting a parcel you know).

| # | Popup row | What it shows | Source helper |
|---|---|---|---|
| 1 | **Most resembles** | Top-3 cosine-similar Dynamic World classes within 80 km, AEF-weighted. Class label + cosine score + support count. *Drops "Snow & ice" candidates below ±60° latitude to suppress tropical cloud-edge mislabels.* | `_aef_nearest_class` |
| 2 | **Land-use shift** | Pre-vs-post cosine distance bucketed into *unchanged / subtle / substantial / major*. Hidden on stable clicks (no event to compare against) and when the post-year hasn't published yet. | `_aef_change_magnitude` |
| 3 | **Multi-year trajectory** | Inline SVG sparkline of annual cosine distance from the 2017 baseline. Vertical red dashed line marks the OPERA-detection year (disturbance clicks only). | `_aef_trajectory` |
| 4 | **Similar disturbances within 12 km** | Top-5 OPERA-flagged pixels nearby whose pre-disturbance AEF embedding is most like the click's. Each is a clickable button that flies the map there. | `_aef_similar_disturbances` |
| 5 | **Land-use stability** | Median pairwise cosine similarity across the 3 years before the click. Bucketed *stable / mostly stable / mixed / volatile*. | `_aef_stability` |

## Architecture

### Backend (`cloud-functions/opera-dist-alert-global/main.py`)

```
GET /?lat=…&lng=…&extras=1&aef=1
                          ────  new query param (opt-in)
```

The `_handle_point_extras` handler runs in two phases:

1. **OPERA status + date sample** (1 round-trip) determines whether the
   click is on a current disturbance.
2. **AEF future** is submitted to a `ThreadPoolExecutor` immediately,
   *before* the named-fires query, with the OPERA date as anchor (or
   `AEF_LATEST_YEAR-12-31` for stable clicks). It runs in parallel with
   everything else.
3. The existing extras helpers (named-fires, patch geometry, MODIS burn,
   FIRMS, dNBR, shape, land-cover, crop profile, NASS, cause inference)
   run as before.
4. The AEF future is collected just before the response is built.

**Inside `_aef_context`**, the 5 derived helpers fan out via their own
inner `ThreadPoolExecutor(max_workers=5)`. Python's GIL releases during
`getInfo()`'s blocking HTTP call, so threading actually parallelizes
the EE round-trips. Each helper isolates its exceptions; one failing
helper doesn't poison the others, and the whole AEF block returns
`null` if all five fail.

This parallelization brought the local-dev click time down from
~31 s (serial) → ~10 s (AEF parallel) → ~3-5 s (AEF parallel with extras).

### Frontend (`src/forestmonitor/ForestMonitor.jsx`)

- Extras fetch URL appends `&aef=1`.
- `renderAef(aef)` builds the purple section; `renderAefSparkline()`
  emits the trajectory SVG inline (no new dependency).
- `renderPopupHTML` calls `renderAef(data.aef)` between the status line
  and the methodology link (disturbance path).
- `renderEmptyPopupHTML` also calls `renderAef(extras.aef)` for stable
  clicks. The "Land-use shift" row hides itself in this case since
  `magnitude === 'awaiting_post'` is treated as "no event to compare,"
  and the trajectory's OPERA-year marker is suppressed.
- New document-level click delegation handles `data-action="aef-fly"`
  buttons (similar-disturbance rows fly the map to the lookalike's
  lat/lng).
- The methodology modal (`<button data-action="show-methodology">` →
  modal) gets a new "AlphaEarth context" section explaining each of
  the 5 signals, a new AEF entry in the Datasets list, and 3 new
  limitations bullets (annual cadence, Dynamic World vocabulary,
  regional similar-disturbance scope).

### Styling (`src/forestmonitor/ForestMonitor.module.css`)

- Purple palette (`#7c3aed`, `#faf5ff`, `#e9d5ff`) for the AEF block to
  visually distinguish from the fire (red) and land-cover (amber)
  blocks already in the popup.
- Magnitude tiers (`.popupAefMagUnchanged` → `…Major`) and stability
  tiers (`.popupAefStableStable` → `…Volatile`) use a calm-to-alarming
  color ramp.
- Similar-disturbance rows are buttons with hover state.

## Files changed

```
A  ALPHAEARTH-INTEGRATION.md
A  cloud-functions/opera-dist-alert-global/_smoketest_aef.py
M  cloud-functions/opera-dist-alert-global/main.py        (+~450 lines)
M  src/forestmonitor/ForestMonitor.jsx                    (+~250 lines)
M  src/forestmonitor/ForestMonitor.module.css             (+~175 lines)
```

Plus a one-line `from __future__ import annotations` at the top of
`main.py` so the module imports cleanly under Python 3.9 too (no-op
under the deployed Python 3.12 runtime — it just enabled local smoke
testing).

## Performance — local vs production

We profiled the cloud function running under
`functions-framework --debug` on a laptop with residential internet,
hitting Earth Engine's public endpoint:

| Click region | Click type | Cold | Warm |
|---|---|---|---|
| Kalimantan (sparse) | OPERA-disturbed | 5 s | 2.7 s |
| Kalimantan (sparse) | stable | 14 s | — |
| Bahia / Mata Atlântica (dense) | OPERA-disturbed | 25–65 s | 25 s |
| Bahia / Mata Atlântica (dense) | stable | 3.4 s | 1.0 s |

The "dense" regions (Bahia, eastern Amazon, parts of SE Asia) hit slower
EE workloads on the existing extras helpers — `_sample_globfire_fires`
in particular scans more historical fire records, and the MapBiomas
regional cascade has more bands to mosaic. AEF itself contributes
roughly the time of its slowest single helper (~3-5 s) once
parallelized.

**In production** (Cloud Run in `us-west1`, where the deployed cloud
function lives), each EE round-trip drops from ~1-2 s to ~50-100 ms.
Same code should run 5-10× faster. Expected production click latency:
~3-8 s depending on region. The local-dev tax is unavoidable; deploy
when you want to validate UX.

## Tuning knobs (module-level constants in `main.py`)

If post-deploy clicks feel slow, these are the levers:

```python
AEF_REF_BUFFER_M           = 80_000   # nearest-class regional buffer
AEF_REF_NUM_POINTS_PER_CLASS = 8      # stratifiedSample budget
AEF_REF_SCALE_M            = 150      # downsample (AEF is composable)
AEF_REF_MIN_SUPPORT        = 3        # min samples for a class to count
AEF_REF_TOP_K              = 3

AEF_SIMILAR_RADIUS_M       = 12_000   # similar-disturbance radius
AEF_SIMILAR_NUM_PIXELS     = 20       # candidate pool
AEF_SIMILAR_TOP_K          = 5
AEF_SIMILAR_SCALE_M        = 180      # downsample for speed
```

Original values (pre-tuning) had `RADIUS_M=30_000, NUM_PIXELS=120,
NUM_POINTS_PER_CLASS=25, BUFFER_M=200_000` — those were dialed back
during local iteration when we saw dense-region clicks timing out.

## How to deploy

Standard cloud-function redeploy per
[DEPLOY.md](cloud-functions/opera-dist-alert-global/DEPLOY.md):

```bash
cd cloud-functions/opera-dist-alert-global
export CLOUDSDK_PYTHON=/opt/homebrew/bin/python3.13
GCLOUD=/opt/homebrew/share/google-cloud-sdk/bin/gcloud

$GCLOUD functions deploy opera-dist-alert-global \
  --project=earthatlas \
  --runtime=python312 \
  --region=us-west1 \
  --source=. \
  --entry-point=get_tiles \
  --trigger-http \
  --allow-unauthenticated \
  --memory=512MB \
  --timeout=60s
```

If your live function has `NASS_API_KEY` set, pass `--update-env-vars`
instead of `--set-env-vars` so it isn't cleared.

After deploy, smoke-test:

```bash
# Substitute a lat/lng you know has a recent disturbance:
curl "https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global?lat=0.1&lng=113.5&extras=1&aef=1" | jq '.aef | {operaYear, nearestClass: .nearestClass.matches[0].label, change: .changeMagnitude.magnitude, stability: .stability.label, trajPoints: (.trajectory | length), similar: (.similarDisturbances.matches | length)}'
```

Frontend deploys automatically with the next Vercel push to main once
the branch is merged.

## Local-dev setup (already in place)

We left this working as you can return to it:

```
cloud-functions/opera-dist-alert-global/
└── .venv/                          ← python 3.13 venv with deps
    └── bin/functions-framework

Two processes running on the loop:
  :8080   functions-framework --target=get_tiles --source=main.py --debug
  :3000   vercel dev (with MAPBOX_TOKEN injected via shell env)
```

`.env.local` was edited:
- `VITE_FOREST_TILES_API_BASE` flipped from
  `https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global`
  to `http://localhost:8080` (so the local UI hits the local function)
- `MAPBOX_TOKEN=<same as VITE_MAPBOX_TOKEN>` added — Vercel dev's edge
  sandbox doesn't propagate `VITE_*` env vars to serverless functions,
  and `/api/geo/suggest` reads `process.env.MAPBOX_TOKEN` first.

**Before deploying to production, flip `VITE_FOREST_TILES_API_BASE`
back to the cloud-function URL** so the prod frontend hits prod backend.
`MAPBOX_TOKEN` in `.env.local` is harmless (`.env.local` is gitignored)
but you may want to add it to your Vercel project's Development env
so `vercel env pull` keeps it in sync.

ADC credentials: you ran
```bash
gcloud auth application-default login \
  --scopes=https://www.googleapis.com/auth/earthengine,https://www.googleapis.com/auth/cloud-platform
```
once. Stored in `~/.config/gcloud/application_default_credentials.json`.

## What's verified vs unverified

**Verified end-to-end against real EE** (against `lat=0.1, lng=113.5`
Kalimantan disturbance and `lat=-14.722, lng=-39.255` CEPLAC stable):

- All 5 AEF signals populate from real EE data.
- Snow & ice filter activates correctly: the original Kalimantan click
  surfaced Snow & ice as #2 match; after the fix, Trees → Built area →
  Crops, with no Snow & ice entry.
- `awaiting_post` sentinel triggers correctly for 2026 OPERA clicks
  (since AEF latest is 2025).
- Stable-click AEF path returns nearestClass/stability/trajectory.
- Frontend renders the purple block, sparkline draws, click delegation
  flies the map on similar-disturbance buttons.

**Not yet verified:**

- Deployed cloud-function performance (need a `gcloud functions deploy`
  to measure real production latency).
- That the methodology modal renders all the new copy cleanly on a
  cold session (we ran `vite build` so JSX/CSS is valid, but a visual
  pass post-deploy is worth doing).

## Smoke test

`cloud-functions/opera-dist-alert-global/_smoketest_aef.py` stubs out
EE/google.auth/flask and exercises the pure-Python paths in the AEF
helpers. Verifies:

- `_aef_dot` numeric correctness
- `_aef_change_magnitude` threshold tiers + `awaiting_post` fallback
- Graceful `None`-on-failure for stability / trajectory / nearest-class
  / similar-disturbances when EE returns unexpected shapes
- `_aef_context` orchestrator returns the expected key structure and
  is JSON-serializable
- Bad-date input handled

Run it any time with:
```bash
cd cloud-functions/opera-dist-alert-global
python3 _smoketest_aef.py
```

## Known issues to clean up later

- **Dense-region latency on deployed function might still feel slow.**
  Sequential extras helpers (`burn → fires → nbr → shape → land_cover
  → crop_profile → nass`) could be parallelized the same way AEF was.
  Estimated savings: ~3-5 s per click in dense regions. Not done in
  this PR because the existing helpers have been working in production
  and we didn't want to combine refactor + feature in one change.

- **`AEF_LATEST_YEAR = 2025`** is a manual constant. Bump it when
  Google publishes the next annual mosaic (typically Q4 each year).
  The `_aef_change_magnitude` helper falls back gracefully when the
  post-year isn't available yet.

- **Snow & ice filter is below ±60° latitude.** Real glaciated
  mid-latitude regions (Alaska Range, Patagonia, Himalaya) might want
  to keep the class. Refinement: condition on elevation instead of
  pure latitude.

- **Trajectory sparkline only draws the OPERA-year marker if it falls
  inside the AEF coverage window.** 2026 OPERA disturbances render
  without the marker (AEF latest = 2025). Extending the X axis to
  include the disturbance year would visually make the "post" gap
  more obvious.

## Follow-up roadmap

In priority order, from biggest leverage downward:

1. **Pre-staged regional class libraries.** Sample AEF embeddings under
   user-supplied labels per region (cabruca / oil palm / smallholder
   rubber / cattle pasture / abandoned coffee / mining edge, etc.),
   store as a `FeatureCollection` per biome, and use that as the kNN
   reference instead of Dynamic World's 9 generic classes. This is
   what closes the "Most resembles" gap in non-MapBiomas regions —
   per Google's published palm-oil-mill demo, ~50 labels per class is
   sufficient. Even one biome (Mata Atlântica cacao) would prove value.

2. **Global similar-disturbances via BigQuery.** Pre-compute AEF
   embeddings for OPERA-flagged pixels worldwide, store in BigQuery,
   use `VECTOR_SEARCH` for kNN. Lets the popup answer "is this a
   one-off, or part of a global wave?" not just "any lookalikes within
   12 km?" Pattern walked through in
   [Embedding Vector Search with BigQuery + EE + AEF](https://medium.com/google-earth/embedding-vector-search-and-beyond-with-big-query-earth-engine-and-alphaearth-foundations-147135d1eeab).

3. **Parallelize existing extras helpers.** ~3-5 s savings per click,
   minimal risk if done carefully (each helper is independent EE
   work). Apply the same `ThreadPoolExecutor` pattern AEF uses.

4. **MapBiomas Transitions layer.** Adds a true forest-gain / forest-loss
   signal independent of OPERA's near-real-time detection. Useful for
   answering "is this an isolated 2026 event, or part of a multi-year
   conversion pattern visible in MapBiomas?"

5. **Trajectory inflection detection.** The sparkline shows the curve
   but doesn't call out *when* the place started changing. A small
   helper that flags the first year cosine distance exceeded a slope
   threshold (e.g., "Change began ~2022") would be a one-line popup
   addition.

6. **Snow & ice filter refinement.** Switch from pure latitude gate to
   elevation-aware gate so high-altitude glaciated regions in the
   tropics (Andes, equatorial East Africa) get correct snow detection.

## Sources

- [AlphaEarth Foundations Satellite Embedding V1 — EE catalog](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
- [AlphaEarth Foundations — Google DeepMind blog](https://deepmind.google/blog/alphaearth-foundations-helps-map-our-planet-in-unprecedented-detail/)
- [Introduction to the Satellite Embedding Dataset — EE tutorial](https://developers.google.com/earth-engine/tutorials/community/satellite-embedding-01-introduction)
- [AI-powered pixels: Introducing Google's Satellite Embedding dataset](https://medium.com/google-earth/ai-powered-pixels-introducing-googles-satellite-embedding-dataset-31744c1f4650)
- [Embedding Vector Search with BigQuery + EE + AEF](https://medium.com/google-earth/embedding-vector-search-and-beyond-with-big-query-earth-engine-and-alphaearth-foundations-147135d1eeab)
- [Seeding the search: AEF for detecting agricultural facilities](https://medium.com/google-earth/seeding-the-search-alphaearth-foundations-satellite-embeddings-for-detecting-agricultural-43cf78e1cc5f)
