# Commodity tree-crop maps in /forestmonitor

End-to-end integration of the [Forest Data Partnership pan-tropical commodity
probability maps](https://developers.google.com/earth-engine/datasets/publisher/forestdatapartnership)
(coffee, cocoa, oil palm, rubber) into the /forestmonitor click popup. The
maps are built on the same AlphaEarth Foundations embeddings the existing
[AlphaEarth block](ALPHAEARTH-INTEGRATION.md) uses, so this layers a Google
product on a foundation the tool already showcases.

**Branch:** `feat/forestmonitor-commodity-maps`
**Status:** code complete, verified locally end-to-end against real Earth
Engine (backend) and in-browser (frontend render + CSS). The cloud function
must be redeployed for production to return `commodityCrop` — see *Deployment*.

## Why

The forest monitor already answers *where/when did forest get disturbed?*
(OPERA DIST-ALERT) and *what is this land now?* (the 7-tier land-cover
cascade). It couldn't cleanly answer **"is this disturbance driven by a
deforestation commodity?"** — the single most important question for a
supply-chain-deforestation audience. These maps fill that gap: when cleared
forest is now (very) likely oil palm / rubber / cocoa / coffee, the
disturbance has a likely commodity driver.

## What the user sees

A green **commodity** block in the popup, between "Likely cause" and the burn
line on disturbance clicks, and just under land cover on no-disturbance
clicks. It renders the strongest crop at the clicked pixel as a plain-English
confidence band, e.g.:

> 🌴 **Very likely oil palm (82% confidence)**
> A possible commodity driver of this clearing. This is a probability, not a
> certainty — it can over-read regrowth and shade-grown farms.
> *Produced by Google for the Forest Data Partnership · 2024 map*

The block is **absent** outside the pan-tropical coverage (oceans, temperate
forest — the majority of global clicks) and when no crop clears the display
floor.

## The data

| Property | Value |
|---|---|
| Asset pattern | `projects/forestdatapartnership/assets/{palm\|rubber\|cocoa\|coffee}/model_2025b` |
| Type | `ee.ImageCollection`, one image per year, band `probability` (0–1) |
| Resolution | 10 m |
| Years (confirmed in catalog) | palm: 2020–2025; cocoa/coffee/rubber: 2020 & 2024 |
| Coverage | **Pan-tropical only** — no temperate coverage |
| Version | **2025b** (AlphaEarth-based; expands 2025a's per-country maps) |
| License | CC BY 4.0 — attribution **"Produced by Google for the Forest Data Partnership"** required |
| Cost | Free to compute in EE; GCS download is requester-pays (we stay in EE) |

`0.82` means *the model is 82% confident this ~10 m pixel contains the crop* —
**not** "82% of the area." The UI never shows the bare decimal.

## Design decisions

- **Plain-English confidence bands, percent in parens.** ≥80% *very likely*,
  65–80% *likely*, 50–65% *possibly*. Hidden below 50% (`COMMODITY_MIN_PROB`,
  Google's catalog display floor). A bare `0.82` reads ambiguously (confidence
  vs. % of area), so the band leads and the percent supports.
- **Anchor on the latest map year, not the disturbance year.** A clearing's
  replacement crop only appears in maps published *after* the event, so "what
  is growing here now" is the driver signal. Anchoring on the disturbance year
  would miss the very conversion we want to flag (caught when a 2020-anchored
  Côte d'Ivoire point came back empty while the 2024 map read 88%).
- **Surface positive hits only (Phase 1).** Inside coverage but below the
  floor returns nothing, to avoid clutter. *(Phase 2 candidate: "covered, and
  it's NOT a commodity" actively rules out a commodity driver — has value.)*
- **Probability, not classification.** Google notes overestimation in
  regrowth / agroforestry and publishes no accuracy figures, so the popup
  hedges ("a probability, not a certainty") rather than asserting.

## Architecture

### Backend (`cloud-functions/opera-dist-alert-global/main.py`)

- `COMMODITY_ASSETS`, `COMMODITY_VERSION`, `COMMODITY_ATTRIBUTION`,
  `COMMODITY_MIN_PROB` — constants next to the AEF block.
- `_commodity_confidence(prob)` — maps a 0–1 probability to a band string.
- `_sample_commodity_crops(lat, lng, anchor_year)` — samples all four maps in
  **one** server-side round trip (`ee.Dictionary` of per-crop records), picks
  each map's year nearest the anchor, returns the strongest crop above the
  floor or `None`. Outside coverage `coll.first()` is null, which would make
  `.select`/`.reduceRegion` throw; an `ee.Algorithms.If` sentinel guard makes
  the batch resolve cleanly (collection size `n == 0` marks the gap). ~0.3 s.
- Wired into `_handle_point_extras` as `f_commodity` (fans out alongside AEF),
  anchored on `AEF_LATEST_YEAR`, collected into the response as
  `commodityCrop` on **both** the disturbance and no-disturbance return paths.

### Frontend (`src/forestmonitor/ForestMonitor.jsx`)

- `renderCommodity(commodity)` + `COMMODITY_EMOJI` — renders the backend's
  pre-built `summary` string (so the frontend never formats the number).
  Returns `''` on null, so it degrades to nothing pre-deploy.
- Wired into `renderPopupHTML` (after `renderLikelyCause`) and
  `renderEmptyPopupHTML` (new `commodity` arg, threaded from
  `state.extras.data.commodityCrop`).

### Styling (`src/forestmonitor/ForestMonitor.module.css`)

`.popupCommodity` + label/note/source classes — green block (`#ecfdf5`,
emerald `#10b981` left border), distinct from amber cropland and red fire.

## Verification

- **Backend, live EE:** all four `model_2025b` assets confirmed present with a
  `probability` band. Côte d'Ivoire → "Very likely cocoa (88% confidence)";
  Pacific NW / ocean → `None` (no error, via the null guard). One round trip,
  ~0.2–0.4 s.
- **Frontend, browser:** shimmed the API and fired real map clicks — both
  popup paths render the block; computed styles matched spec exactly.
- **Verified click targets** (≥74% pixels found by grid search):
  | Crop | Place | lat, lng |
  |---|---|---|
  | Cocoa | Soubré, Côte d'Ivoire (100%) | 5.900, -6.510 |
  | Oil palm | Pelalawan, Riau (100%) | 0.250, 101.960 |
  | Rubber | Kampong Cham, Cambodia (100%) | 11.880, 105.540 |
  | Coffee | Buon Ma Thuot, Vietnam (100%) | 12.770, 108.080 |

  Town-center pixels often miss — 10 m resolution is precise; click the
  surrounding plantation.

## Local dev

The /forestmonitor frontend reads tiles + commodity from
`VITE_FOREST_TILES_API_BASE` (dev: `http://localhost:8080`) and geo-search
autocomplete from the `/api/geo/*` serverless functions. To run everything:

```sh
# 1. Cloud function (tiles + commodity) on :8080 — needs ADC creds.
cd cloud-functions/opera-dist-alert-global
.venv/bin/functions-framework --target get_tiles --port 8080

# 2. App + serverless /api on :3000. Plain `vite` (5173) does NOT serve
#    /api/geo, so autocomplete fails there. Use vercel dev.
#    Gotcha: when the project is linked, vercel dev injects function env from
#    its own resolution, NOT root .env.local — so MAPBOX_TOKEN (only in
#    .env.local) is missing and /api/geo/suggest 500s. Inject it at launch:
export MAPBOX_TOKEN="$(grep '^MAPBOX_TOKEN=' .env.local | cut -d= -f2-)"
vercel dev --listen 3000 --yes
```

Then open **http://localhost:3000/forestmonitor**. (Do **not** `vercel env
pull` — it overwrites `.env.local` and wipes `VITE_MAPBOX_TOKEN`.)

## Deployment

The frontend degrades cleanly (`renderCommodity` returns `''` on null), so
nothing breaks live — but the popup line won't appear until the cloud function
is redeployed. See `cloud-functions/opera-dist-alert-global/DEPLOY.md`.

## Future (Phase 2 candidates)

- Toggle-able commodity-probability tile overlay (a visualization mode like
  the OPERA modes), masked at the display floor.
- Surface "covered, no commodity detected" to actively rule out a commodity
  driver.
- Multi-crop disclosure (the full ranked `all[]` is already in the payload).
