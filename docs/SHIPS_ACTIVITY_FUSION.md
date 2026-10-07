# /ships: terminal and anchorage activity for every month (design note, 2026-10-06)

Status (2026-10-07): **both parts built and tested on localhost / dev; not in production.** Josh approved all four decisions
(2026-10-06), the tuned GFW rule (docs/SHIPS_ACTIVITY_CHECK_2026-06.md), and Part 1's two production write paths (2026-10-07).

### What was built

- Part 2 (GFW estimates): scripts/ships/bake-gfw/activity.py (+ post_activity.py, activity_inputs.json via scripts/ships/activity-inputs.mjs),
  migration 025 (terminal_call_estimates, anchorage_stay_estimates, activity_estimate_bakes), lib/ships/activityEstimates.js, api op=importActivity,
  the `activity` job in ships-gfw-month.yml, terminal card (src/ships/EstimatedVisits.jsx) and anchorage popup (src/ships/anchoragePopup.js).
  Tugs are never counted from estimates; 31 of 112 anchorages are "too small to estimate" (no grid centre inside).
- Part 1 (NOAA months): .github/workflows/ships-noaa-month.yml; the Salish month index on Blob (scripts/ships/bake-ais/publish.mjs; read by
  api/ship-tracks.js salishNow / op=salishindex, ShipsApp, bake-gfw noaa_boxes, all falling back to trackSource.json); month-scoped
  storeTerminalCalls / storeAnchorageStays ({ months }) via api op=importAisMonth; NOAA identities via api op=importMcIdentity
  (lib/ships/mcMonths.js); committed inputs scripts/ships/bake-ais/inputs/ (production berths + anchorages); fetch_points.py one-day mode.
  One-day test (2026-06-15, branch ships-noaa-test, run 37637068175): points, terminal hits and anchorage hits identical row for row to the
  hand-run bake. npm run test:ships: 438 pass.

### Rollout order

1. `zsh scripts/ships/prod.sh migrate` (025; backs up first). Safe before the push: additive tables the live code doesn't read.
2. Push the code (Josh's go-ahead; changelog entry in the same push). The new terminal card reads 025's tables, hence step 1 first.
3. `zsh scripts/ships/prod.sh salish-index-seed` (coastline masks → Blob; Salish index + the 12 months' identity files). Needs the
   upload-token allowlist from step 2. Until then every reader falls back to trackSource.json.
4. GFW estimates for Jul 2026 → now (≈13 GFW requests a month in Actions); the daily GFW run keeps them current after that.
5. ships-noaa-month runs weekly (Mondays); July 2026 loads itself when NOAA posts it.

## The problem

Terminal and anchorage cards count visits, ships and stays from one source only: NOAA MarineCadastre per-minute AIS
for the Salish box, Jul 2025 – Jun 2026 (`terminal_calls` 11–13k calls a month, `anchorage_stays`). For every month
after that the cards show "—" (screenshot: HF Sinclair Puget Sound, Oct 2026).

- The ships themselves are already linked: GFW hourly-line ships get identity records daily (ships-gfw-identities).
- What is missing is the **activity layer**: nothing turns GFW positions into calls/stays, and nothing loads new NOAA
  months automatically (the Jul 2025 – Jun 2026 bake was run by hand).

## Facts the design rests on (checked 2026-10-06)

| | NOAA MarineCadastre | GFW hourly (4Wings presence) |
|---|---|---|
| Position | every ~1 min, exact lat/lon, speed over ground | one row per vessel per hour, cell centre on a 0.01° grid (≈1.1 × 0.74 km here), **no speed** |
| Lag | ~3 months, released in batches (Apr–Jun 2026 all posted 2026-09-18; older files re-posted, e.g. Mar on 2026-08-26) | ~4 days, daily |
| Already fetched by us | no (by hand, laptop) | yes, daily in GitHub Actions, raw kept per month in the Actions cache |

Terminal spacing (prod, 59 terminals / 81 berths): nearest other terminal **< 0.5 km for 11, 0.5–1 km for 17**,
1–2 km for 11, > 2 km for 20. HF Sinclair ↔ Marathon Anacortes = 0.59 km, both refinery docks (ship kind can't split them).
So GFW can say "a tanker stopped at the Anacortes refinery docks" but often not which dock.

## Part 1: NOAA months load themselves (the precise record)

A GitHub Action (weekly check, cheap HEAD requests) notices when MarineCadastre posts days we don't have, then for each
new month, entirely in Actions:

1. Stream the daily national CSVs, keep the Salish box (existing `fetch_points.py`; same streaming the US-wide bake
   already does in Actions). ~320 MB/day download, ~10 GB/month, nothing kept beyond the month's run.
2. Build the month's Salish tracks + per-ship packs (`build_tracks.py`, `land_mask.py`) → Blob, add the month to
   the Salish index so the site picks it up without a code push (today `trackSource.json` months are in code: this
   moves them to a Blob index like the GFW and US-wide layers).
3. Terminal calls (`terminal_calls.py`, rule tc4 unchanged) and anchorage stays (`anchorage_stays.py`, unchanged).
4. Ship identities from the month (`import-mc`).
5. Steps 3–4 reach the prod database through CRON_SECRET-locked API batch endpoints, the way the GFW identity import
   already does (no database password in GitHub).
6. That month's GFW estimates (Part 2) are withdrawn for the Salish box: NOAA wins, the same rule as the tracks.

Size per month: ~1–2 h of Actions, $0 (public repo), ~25 MB Blob, ~12k calls + ~1.3k stays written.
First real run: Jul 2026 whenever NOAA posts it.

## Part 2: estimated activity from GFW hourly positions (months NOAA hasn't published)

Runs inside the existing daily GFW month job (no new GFW requests; it reads the raw it already has).

**Stop rule (GFW has no speed):** a vessel is "stopped" when 2+ consecutive hourly rows sit in the same or a
touching 0.01° cell. A stop's position = the cell centre; its time = first to last hour (+1 h).

**Terminals:**
- Terminals are grouped into **clusters**: berths within 1.5 km of another terminal's berth chain together
  (HF Sinclair + Marathon Anacortes; Westshore's neighbours; Seattle's Harbor Island docks …). 20 terminals stand alone.
- A stop counts toward a cluster when its cell centre is within 1 km of one of the cluster's berths.
- Inside a cluster, if exactly one terminal fits the ship's kind (decision 1: tanker → oil dock, bulk carrier → grain /
  coal, gas carrier → LNG …), it is credited to that terminal. Otherwise it stays a **shared** call: "at HF Sinclair or
  Marathon Anacortes", never split, never guessed.

**Anchorages:** a stop counts when its cell centre is inside the anchorage polygon (anchorages are hundreds of metres
to kilometres across). Polygons smaller than one cell are flagged as low-confidence on the card.

**Storage (evidence stays separate):** same tables, new bake versions (`gfw1`) and new sources
(`earthatlas-terminal-calls-gfw`, `earthatlas-anchorage-stays-gfw`), evidence class `inferred`; one additive migration
adds `attribution` ('berth' | 'kind' | 'shared') and the cluster's terminal list. NOAA calls are never mixed in.

**Card:** per month the coverage line says which source counted it: "Counted from NOAA AIS" (as today), "Estimated
from hourly positions (Global Fishing Watch)", or "Not counted yet". Estimated numbers show with ≈. Shared calls appear
in their own row ("+ 14 shared with Marathon Anacortes"), not added to either terminal. Every number links to its source.

**Accuracy check before it ships:** run the GFW rule on one month we also have from NOAA (Jun 2026, Salish area only;
~10 GFW requests in Actions) and compare, per terminal and anchorage, with NOAA's counts. Josh sees that table and decides
whether the estimates are good enough to show.

## Order and effort

1. Part 2 first (fills Jul–Oct 2026 now): accuracy check → rule + migration + card → backfill Jul–Sep from cached raw.
2. Part 1 next: weekly NOAA watcher + month pipeline + Salish index on Blob.

## Decisions for Josh

1. Cluster distance 1.5 km and stop rule "2+ hours in the same/touching cell": OK as starting values, to be tuned by the
   Jun 2026 accuracy check?
2. Shared calls shown as a separate row (never counted at either terminal): OK?
3. Part 1 moves Salish track months from code (`trackSource.json`) to a Blob index: OK?
4. The 7 terminals NOAA never counted (outside its box or its US receivers' reach): give them GFW estimates for every
   month, including Jul 2025 – Jun 2026, since GFW would be their only source?
