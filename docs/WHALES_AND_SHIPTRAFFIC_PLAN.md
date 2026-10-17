# Plan: shared whale service + /shiptraffic rebuild

Agreed direction as of 2026-10-17. Source facts: docs/ACARTIA.md.

## Goals
1. One worldwide whale-sightings service any earthatlas.org site can use.
2. /shiptraffic shows ship × whale overlap near-real-time (days) and historically (months/years).

## Phase 1 — Shared whale service (worldwide)

**Sources**
| Source | Role | Coverage | Freshness | License |
|---|---|---|---|---|
| SalishSea.io day files + DwC archive | live + history | Salish Sea, SRKW range | 5 min | CC BY 4.0 (Maplify-derived), CC BY-NC 4.0 (native) |
| Maplify / Conserve.io | live + history | worldwide (mostly N. America) | live | Josh approved global use 2026-10-17 |
| HappyWhale (production API) | live + history | worldwide | live | per-photo licenseLevel |
| iNaturalist | live + history | worldwide | live | per-observation license |
| OBIS (minus HappyWhale + iNat datasets) | history only | worldwide | lagged | per-dataset |
| Acartia | not used (stale; Maplify copy) | | | |

**Endpoint `/api/whales`** (edge, cached like /api/ebird)
- Params: `bbox` or `lat,lng,r`; `from`, `to`; optional `species`, `sources`.
- Each sighting: id, species (common + scientific, one standard name), time, lat/lng, count, source, channel (e.g. Orca Network), observer if known, link to original, license, photo, HappyWhale individual ID.
- Response also lists which sources cover the requested area.
- Recent days → live sources; older → history files on Blob. Callers can't tell the difference.

**Clean-up rules**
- Exact duplicates removed by ID: SalishSea.io `maplify:<id>` = Maplify `id`; iNat records arriving via SalishSea.io or OBIS; HappyWhale records arriving via OBIS (dropped by dataset ID).
- Same encounter from different sources: kept, each with its own credit; optional "group nearby reports" flag for maps.
- Maplify filters: drop 0,0 and inland points (land mask), `source=API` test rows, `is_test=1`.
- Species: map Maplify's free-text names to one standard taxon each; keep "Unidentified whale"; non-cetaceans (sharks, sunfish, seals, manatee) kept in storage, hidden by default.

**History bake** (GitHub Actions, nightly; never on Josh's laptop)
- Monthly files on Blob, split into large map squares.
- Inputs: SalishSea.io DwC (1 request), Maplify by month, HappyWhale by month (chunked under its 10k cap), iNat by month, OBIS minus duplicate datasets.
- Initial backfill window: TBD (decision 2).

**Shared code**
- `lib/whales/` — one module per source + merge/dedupe; same code on prod and localhost:5173 (vite middleware, house pattern). HappyWhale reuses `api/_happywhale-core.js`; iNat reuses `api/inat-proxy.js` logic.
- `src/lib/whales.js` — client helper (fetch for current view + time).
- Shared whale popup/card in the shared popup frame (`lib/popupFit.js`, index.css), inline source credit per sighting.
- Sources/credits list for every site's panel footer.
- `docs/WHALES_API.md` — params, fields, coverage, credit rules.

**Likely users:** /shiptraffic (first), /ships, /inmotion Flora & Fauna, /live-local; /happywhale optional later.

## Phase 1 update — our own whale database (Josh 2026-10-17)
- All sites read only our DB via `/api/whales`; an hourly job refreshes from the sources (re-checks last 7 days hourly, older months weekly; honors iNat deletions/license changes). Josh: storing HappyWhale is fine.
- **Size check (2026-10-17):**
  | Source | All-time | Per year now |
  |---|---|---|
  | iNaturalist (Cetacea) | 185,202 | ~30,000 (2025: 30,225) |
  | HappyWhale | ~390k in OBIS copy (lagged) → est. 0.4–0.6 M | ~90,000 (Jan 2025: 6,181; Jul 2025: 8,791) |
  | Maplify | ~100,000 (2019–2026) | ~19,000 |
  | SalishSea.io native | ~650 | small |
  | OBIS minus HappyWhale/iNat | 1,491,815 (incl. acoustic detections, tag tracks, whaling logs) | ~70–90k |
  - Maplify can't return all history in one request (server out of memory) → backfill year by year.
  - Est. ~1 KB/row with indexes (to be measured): without OBIS ≈ 0.7–0.9 GB, +~0.15 GB/yr; with all of OBIS ≈ 2.3 GB.
- **Neon (pricing 2026-10-17):** Free = 1 GB/project (writes blocked over), 100 CU-h/project, scale-to-zero after 5 min. Launch = no base fee, $0.35/GB-month, $0.106/CU-hour.

- **Billing check (2026-10-17):** the Neon install is already on **Launch** installation-wide (news 8.8 MB, ships-dev 1.34 GB, ships prod 1.96 GB). A new whales DB adds only its own usage; other DBs' billing is unchanged. Est. whales DB ≈ $2–5/month (storage ~1.5–2.5 GB incl. OBIS human sightings ≈ $0.50–0.90; hourly refresh ≈ 15 CU-h ≈ $1.60; edge-cached reads small). Josh chose Option B: Launch + OBIS human sightings only (no acoustic detections, tag tracks or whaling logs).

- **Created 2026-10-17:** Neon `earthatlas-whales` (iad1), env prefix `WHALES_`, connected to all Vercel envs. Prod only (Josh): localhost uses the same DB; local tests write only to throwaway `whales_t_*` schemas. PostGIS 3.6.4 available.

- **Built 2026-10-17 (localhost, uncommitted):** tables + hourly refresh — see docs/WHALES_DB.md. `/api/whales` + `src/lib/whales.js` built 2026-10-17. Not yet: main-site + /whales search listing (Josh 2026-10-17), backfill, first prod run (needs a deploy).

## Phase 2 — /shiptraffic ships from /ships
- Retire /shiptraffic's own NOAA bake and per-month PMTiles.
- Reuse /ships track tiles: NOAA (`r=us`) for US waters, GFW (`r=gfw`) elsewhere incl. Canada (fixes the northern Salish gap).
- Use /ships ship categories so types match across sites.
- Freshness: GFW ≈ 4 days behind (daily refresh); NOAA months behind.

## Phase 3 — Overlap from real counts
- Add one output to the existing /ships daily (GFW) and monthly (NOAA) jobs: ships per grid cell per day by ship type.
- Overlap map = ship activity × whale sightings for any range (last days → years).
- Replaces the June grid.json / whales.json.

## Phase 4 — Close passes
- For each whale sighting, ships within a set distance (e.g. 1 km) within a few hours, from GFW hourly positions.
- Near-real-time "which ships came close to these whales" + a history of close passes.

## Phase 5 — Interface
- Shared left panel (panel standard): time picker on top (24 h / 7 d / 30 d / month / year), then Ships, Whales, Overlap rows with filters + legends, then sources + credits + BuiltByCredit.
- Freshness line per layer ("Ships through Oct 13 · Whales 10 min ago").
- Whale click → shared card with source credit + nearby ships.
- Map conventions: shareable URL state, satellite default, zoom indicator.

## Testing & rollout
- Localhost: prove each source on 1–2 items / one day; history bake proven on one month before any backfill.
- Full backfill runs once, in Actions, only when Josh asks (with time/request estimate first).
- No push without Josh's go-ahead for that batch; push the exact approved SHA.

## Decisions (Josh 2026-10-17)
- Ships ~4 days old (GFW) are acceptable for now; look for any public source that's fresher.
- /shiptraffic moves to the shared panel layout (Phase 5).

## Open decisions (superseded where decided above)
1. Ships: ~4-day-old ships acceptable for now, or live AIS (needs an always-on worker; aisstream.io has no terms, Kpler blocked, Canadian Coast Guard AIS unexplored)?
2. History start date (whales solid from 2022; ship tracks in /ships from 2024).
3. Keep /shiptraffic's current layout or move to the shared panel (Phase 5)?

## Later
- Conserve.io shark and manatee data: separate projects/feeds, not yet found.
