# RADD · Hansen GFC · JRC TMF layers in /forestmonitor

Three complementary forest datasets added to /forestmonitor — each as a
toggleable map overlay (its own left-panel row with on/off + opacity + legend)
**and** as a click-popup row, gated on that layer being visible so the popup
mirrors the map.

**Status:** shipped — cloud function deployed, frontend on `main`, verified
end-to-end against live Earth Engine and in-browser.

## Why these three

OPERA DIST-ALERT (the existing disturbance layer) is optical and near-real-time.
These fill specific gaps:

| Layer | Asset | Fills the gap of… |
|---|---|---|
| **RADD radar alerts** | `projects/radar-wur/raddalert/v1` | OPERA's optical blind spot — Sentinel-1 **radar** sees through cloud, so it catches tropical clearings during the rainy season. Near-real-time. |
| **Forest loss (Hansen)** | `UMD/hansen/global_forest_change_2025_v1_13` | The validated **long-term** loss record (2001–2025, global) — OPERA only goes back to 2023. |
| **Moist-forest change (TMF)** | `projects/JRC/TMF/v1_2023` | **Degradation vs. deforestation vs. regrowth** — a distinction nothing else in the stack makes. |

## Data encodings (the non-obvious bits)

- **RADD** — filter `layer == 'alerts'`; weekly images are **cumulative**, so the
  latest `version_date` per geography (africa/asia/ca/sa) holds everything.
  `Alert`: 2 = unconfirmed, 3 = confirmed. `Date`: **YYDDD** (e.g. `26125` =
  2026, day-of-year 125 → 2026-05-05). Tropics only. Sparse (alerted pixels only).
- **Hansen** — `lossyear` 1–25 → 2001–2025; `treecover2000` %; `gain` (2000–2012).
  Global. (Latest release is `2025_v1_13`, not the older `2023_v1_11`.)
- **JRC TMF** — `AnnualChanges` latest band (`Dec2023`) class 1–6: 1 undisturbed,
  2 degraded, 3 deforested, 4 regrowth, 5 water, 6 other. `DeforestationYear` /
  `DegradationYear` (band `constant`, 0 = none). Pan-tropical.

## Architecture

### Backend (`cloud-functions/opera-dist-alert-global/main.py`)
- Tile overlays via `?layer=<radd|hansen|tmf>` → `_LAYER_TILE_HANDLERS`:
  - RADD: `_radd_alert_mosaic()` (sort version_date asc → latest cumulative on
    top), mask `Alert ≥ 2`, recency ramp on `Date` (magenta/pink, distinct from
    OPERA's red).
  - Hansen: mask `lossyear > 0`, year ramp (`HANSEN_VIS`).
  - TMF: latest `AnnualChanges` band, categorical palette (`TMF_VIS`).
- Point context via `_sample_forest_context(lat, lng)` — Hansen + TMF stacked
  into **one** `reduceRegion` (both global-domain, safe to cat); RADD sampled
  separately with an `Algorithms.If` guard for its tropics-only extent. Decoders
  `_decode_radd/_decode_hansen/_decode_tmf` return None on missing data. Wired
  into both `_handle_point_extras` return paths as `radd`/`hansen`/`tmf`.

### Frontend (`src/forestmonitor/ForestMonitor.jsx`)
- `EXTRA_LAYERS` registry (id, label, legend) drives the three panel rows and a
  generic reconcile (`reconcileExtra`) + opacity effect — same cached-tile-URL,
  slot-beneath-OPERA (`beforeId`) pattern as the commodity group. State is keyed
  by layer id (`extraVisible` / `extraOpacity` / `extraExpanded`).
- Popup rows `renderRadd` / `renderHansen` / `renderTmf` (via `renderForestLayers`)
  appear in all popup variants, **gated on each layer's visibility** (read live
  from `extraVisibleRef`) so the popup keeps matching the map. `reconcileExtra`
  is declared above the basemap effect that depends on it (TDZ).

## Verification highlights
- Hansen + TMF cross-validate: both report **2019** deforestation at a Rondônia
  pixel now classed as Pasture (MapBiomas).
- RADD date decodes correctly: `Alert=3, Date=24280` → "confirmed, 2024-10-06".
- All three overlays render in-browser; TMF shows the categorical
  undisturbed/degraded/deforested/regrowth palette.

## Future candidates
See [DATASETS](#) discussion — canopy height, aboveground biomass, GLAD primary
forest, Global Mangrove Watch, and exposing Dynamic World / WorldCover as
visible land-cover backdrops are the next-most-additive layers.
