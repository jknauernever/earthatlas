# AlphaEarth Foundations in /forestmonitor

Adds five derived signals from Google DeepMind's [AlphaEarth Foundations
Satellite Embedding dataset](https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL)
(`GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL`, 64-D unit-length annual embeddings
at 10 m, 2017–2025) to each click popup, in a new "AlphaEarth context"
section between the existing land-cover/fire block and the methodology
link.

Branch: `feat/forestmonitor-alphaearth` (not pushed, not deployed).

## The five popup additions

| # | Popup field | What the user sees | Source helper |
|---|---|---|---|
| 1 | **Most resembles** | Top-3 cosine-similar Dynamic World classes within 200 km, AEF-weighted. Class label + cosine score + support count. | `_aef_nearest_class` |
| 2 | **Land-use shift** | Pre-vs-post cosine distance between AEF embeddings (year ± 1 of the OPERA detection), bucketed into *unchanged / subtle / substantial / major* with a colored badge. Sentinel state `awaiting_post` when post-year hasn't been published yet. | `_aef_change_magnitude` |
| 3 | **Multi-year trajectory** | Inline SVG sparkline of cosine distance from the 2017 baseline, year by year. Vertical dashed line marks the OPERA-detection year. | `_aef_trajectory` |
| 4 | **Similar disturbances within 30 km** | Top-5 OPERA-flagged pixels nearby whose pre-disturbance AEF embedding is most like the click's. Each is a clickable button that flies the map to that lat/lng. | `_aef_similar_disturbances` |
| 5 | **Pre-disturbance state** | Median pairwise cosine similarity across the 3 years before the OPERA date, bucketed into *stable / mostly_stable / mixed / volatile*. | `_aef_stability` |

Every subsection degrades to a silent skip if its data is missing — one
failing call doesn't poison the others.

## Files changed

- **`cloud-functions/opera-dist-alert-global/main.py`** (+~400 lines)
  - New "AlphaEarth Foundations" helper block: 7 functions + 7 constants.
  - Added `from __future__ import annotations` at top so the module is
    importable under Python 3.9 locally (no-op under deployed 3.12).
  - `_handle_point_extras` accepts new `include_aef` arg and adds `'aef'`
    to its JSON response.
  - `get_tiles` plumbs `?aef=1` through to extras.

- **`src/forestmonitor/ForestMonitor.jsx`** (+~200 lines)
  - Extras fetch URL now appends `&aef=1`.
  - New `renderAef(aef)` + `renderAefSparkline(series, operaYear)` helpers
    before `renderPopupHTML`.
  - `renderPopupHTML` calls `renderAef(data.aef)` between `statusLine`
    and `renderMethodologyLink()`.
  - New `useEffect` adds document-level click delegation for
    `data-action="aef-fly"` buttons (similar-disturbance fly-to).

- **`src/forestmonitor/ForestMonitor.module.css`** (+~175 lines)
  - New popup classes: `.popupAef*` (wrapper, title, rows, tiers).
  - Stability + magnitude colored tier badges.
  - Sparkline container + similar-disturbance button hover styles.

- **`cloud-functions/opera-dist-alert-global/_smoketest_aef.py`** (new)
  - Local smoke test that stubs `ee`/`google.auth`/`functions_framework`/
    `flask` and exercises pure-Python paths in the AEF helpers. Verifies:
    - `_aef_dot` numeric correctness
    - `_aef_change_magnitude` tier thresholds + `awaiting_post` fallback
    - graceful None-on-failure for stability / trajectory / nearest-class
      / similar-disturbances
    - `_aef_context` orchestrator returns expected key structure
    - Bad-date input handled
  - **Does NOT verify GEE-side query correctness** — see "What's not verified".

## How to deploy

Standard cloud-function redeploy per [DEPLOY.md](cloud-functions/opera-dist-alert-global/DEPLOY.md):

```bash
cd cloud-functions/opera-dist-alert-global

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

(Keep `--set-env-vars=NASS_API_KEY=...` if your live function has it; you
can also use `--update-env-vars` to avoid clearing it.)

After deploy, smoke-test in the terminal:

```bash
# Replace with a lat/lng you know has a recent disturbance:
curl "https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global?lat=-9.5&lng=-63.5&extras=1&aef=1" | jq '.aef'
```

You should see a `nearestClass`, `changeMagnitude`, `trajectory`,
`stability`, and `similarDisturbances` block. Any/all may be `null` if a
helper failed; check Cloud Function logs for the specific error.

Frontend has no separate deploy step — Vercel will pick up the new
`ForestMonitor.jsx` + CSS on the next push to main.

## Performance budget

Each AEF helper adds one or two `reduceRegion(...).getInfo()` calls:

- `_aef_change_magnitude`: 2 sample calls (pre + post year)
- `_aef_trajectory`: 1 batched call (all years stacked, dot products
  computed server-side)
- `_aef_stability`: 1 batched call (3 years stacked)
- `_aef_nearest_class`: 1 stratifiedSample within 200 km (~225 points)
- `_aef_similar_disturbances`: 1 sample within 30 km (~120 points)

Expected total extras latency increases from ~2–3 s to ~3–5 s. If this
proves too slow on real clicks, dial back `AEF_REF_NUM_POINTS_PER_CLASS`
and `AEF_SIMILAR_NUM_PIXELS` (both module-level constants in `main.py`).

## What's not verified

Local environment doesn't have `gcloud`, `functions-framework`, Python
3.12, or Earth Engine credentials, so the smoke test only covered Python
structure/logic. Things that need post-deploy verification:

1. **AEF asset accessibility.** The dataset is public, but EE asset
   ACLs sometimes restrict service-account access. If you see
   `Image.load: Image asset 'GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL' not
   found` in logs, the service account needs to be granted read access
   in the GEE catalog. (Unlikely — it's listed as a public dataset.)
2. **Sample shapes.** `stratifiedSample` and `sample` on the AEF image
   should return features with properties keyed by `A00`..`A63`.
   Verified server-side in production with one real click.
3. **`AEF_LATEST_YEAR = 2025`** is a manual constant. Bump it when
   Google publishes the next annual mosaic (typically Q4 each year).
4. **Threshold tuning.** The 0.05 / 0.15 / 0.30 cosine-distance
   thresholds in `_aef_change_magnitude` are educated guesses from the
   docs. Validate against a few known clicks (e.g., a clear-cut, a hay
   field, a pristine forest pixel) and tune.

## Known limitations to call out in the popup methodology (follow-up)

The `<h3>AlphaEarth Foundations</h3>` section in the methodology modal
(roughly around `ForestMonitor.jsx:1080`) isn't updated yet. When you're
ready to publish, add a paragraph there covering:

- Annual cadence (so latest year is always behind real-time).
- The kNN-against-Dynamic-World limitation: same vocabulary as the
  popup's land-cover line, so item #1's headline value is *confidence
  + ranking + AEF-stability*, not richer class labels.
- Pre-staged richer-class references (oil palm, rubber, coffee, mining)
  are a planned enhancement — see "Future enhancements" below.

## Future enhancements (not in this PR)

- **Pre-staged regional class libraries.** Sample AEF under
  MapBiomas/CDL/AAFC labels once, store as a `FeatureCollection` asset
  in Earth Engine, and use that as the kNN reference. Lets gap-region
  clicks resolve to specific land uses ("oil palm plantation",
  "smallholder rubber", "mining pit edge") instead of Dynamic World's
  9 generic classes. Per Google's published palm-oil mill demo, ~50
  labels per class is sufficient.

- **Global similarity search via BigQuery.** Item 4 is bbox-scoped
  (30 km) for latency. For a "similar disturbances *anywhere on
  Earth*" panel, pre-compute embeddings for OPERA-flagged pixels into
  BigQuery and use `VECTOR_SEARCH`. Walk-through:
  [Embedding Vector Search with BigQuery + EE + AEF](https://medium.com/google-earth/embedding-vector-search-and-beyond-with-big-query-earth-engine-and-alphaearth-foundations-147135d1eeab)

- **Trajectory inflection detection.** The trajectory sparkline shows
  the curve but not the "when did this place start changing" callout.
  A small server-side helper that flags the first year where distance
  exceeds a slope threshold would be useful.

- **Update methodology modal copy** (see "Known limitations" above).
