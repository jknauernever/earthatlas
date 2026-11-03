# /shoreline — porting Salish Sea Explorer to EarthAtlas

Draft plan, 2026-11-02. Source site: salishsea.knauernever.com (repo `~/Projects/salish-sea-propmapper`).
Target: `sanjuans.earthatlas.org/shoreline` (Friends brand in `src/lib/brand.js`), titled **Shoreline Explorer**.

## Decisions (Josh, 2026-11-02)

1. Chip: brand title stays "Salish Sea Explorer"; "Shoreline Explorer" is the tool name beneath it.
2. `sanjuans.earthatlas.org/` → `/shoreline` (instead of earthatlas.org).
3. Parcel popup: Vegetation tab keeps greenery only (forest loss + disturbance drop). Inland "Friends' work on <Island>"
   card stays, fed by the Friends projects file (data only, not on the map). Mini-map = small Mapbox satellite map.
4. Friends habitat popups move to the EarthAtlas frame on /permits too; retire `ssx.css` / `popupFrame.js`.
5. Search = EarthAtlas GeoSearch; an address inside a parcel also opens that parcel's popup. No ¼-mile circle.
6. Panel = EarthAtlas standard ("Color by" in a fold, "Shoreform classes (7)" in a closed LegendTurndown).
7. Welcome box + "About this map" ported, retitled "Welcome to the Shoreline Explorer", text kept in the repo.
8. Parcels + buildings: **fresh San Juan County GIS download**, then bake. Habitat distances recomputed (port of
   `compute-nearshore-stats.py`); greenery re-run in the EarthAtlas GEE account (2023 NAIP), 2-parcel test first.
9. Refresh: yearly Action for parcels/buildings/distances/greenery; quarterly Friends article harvest with
   **rule-based tagging, no AI** (keywords + WP categories). Friends map layers stay hand-run.
10. Old salishsea.knauernever.com URLs redirect to the default `/shoreline` view.
11. Data fixes: hide the empty dock "Type" row; title herring grounds with the bay/stock name if WDFW's source has one.
    Everything else ports as-is.
12. New Friends Mapbox token for sanjuans.earthatlas.org (`scripts/brand/new-partner.mjs`).

## Scope

**In:** the 16 layers on SSE's default "On the map" list, grouped into 8 rows exactly as SSE groups them:

| Row | SSE layer ids | SSE min zoom (Google) → Mapbox |
|---|---|---|
| Bull Kelp | friends-bull-kelp | none (squiggles from 12.5 → 11.5) |
| Deepwater/Edge Eelgrass | friends-deepwater-eelgrass | none |
| Properties | tax-parcels | 13.5 → 12.5 |
| Building Footprints | building-footprints | 15 → 14 (close-up style from 17 → 16) |
| Priority Shorelines for Fish (Color by: 7 species + highest) | fish-use | 12 → 11 |
| Forage Fish Spawning (3 chips) | friends-herring-spawning, friends-documented-forage-spawning, friends-potential-forage-spawning | 12 → 11 |
| Shoreline Geology: Shoreforms | friends-shoreline-geology | 13 → 12 |
| Shoreline Modifications (7) | friends-armor, -docks, -mooring-buoys, -boat-ramps, -marine-railway, -groins, -pilings | 16 → 15 |

Every color, line width, zoom ramp, pin icon, pin thinning rule and animation (kelp squiggles, herring school, beach fish)
is SSE's. SSE zooms are Google zooms; Mapbox = Google − 1 (`GZ` in `src/friends/habitatOverlay.js`).

**Out:** Resources menu, "Explore more data" / layer picker, every other SSE layer (NDVI, Sentinel, forest loss, OPERA,
murrelets, eBird hotspots, observations, Friends projects, stormwater, armor change 2019), presets (`/view/:preset`),
Admin UI, SSE's own share/og function, the dead PropertyReport side panel and Ask AI.

**Inherited from EarthAtlas, not ported:** address search (`GeoSearch`), share link + URL state + share cards, basemap
+ Photos menu (San Juan County 2025 aerials already in `lib/localAerials.js`), zoom indicator, left panel standard,
popup frame (`src/index.css`, `keepPopupOnMap`, `installPopupSheet`), sources rollup + credits, brand chip.

## Reuse already in EarthAtlas

- `src/friends/habitatOverlay.js` — kelp, eelgrass, herring, documented + potential forage beaches, already drawn exactly
  as SSE (Mapbox custom layer). Extend it with fish-use, shoreforms, armor and the 6 structure pin layers.
- `src/friends/habitatPopups.js` + `friendsContent.js` — SSE popup content for the 5 habitat layers. Today it renders in
  SSE's own frame (`ssx.css`, used by /permits); /shoreline renders the same content inside the EarthAtlas frame.
- `public/friends/friends-content.json` + `shoreline-images/` — already copied.
- `src/fire/parcelSources.json` `sanjuan-wa` PMTiles + `api/parcel-tiles.js` — parcel tile serving.
- `api/ebird.js` — eBird proxy (replaces SSE's client-side key).

## Phases

1. **Data move** (`scripts/shoreline/`, outputs to Blob / `public/shoreline-data/`)
   - Copy the 14 static Friends + fish-use files from SSE `public/data` (≈13 MB total) as-is.
   - Parcels + buildings: one bake from SSE's local `Tax_Parcels.geojson` + `Building_Footprints.geojson` into PMTiles on
     Blob, with `address_lookup`, `parcel_index`, `nearshore_parcel_stats` and `ndvi_parcel_stats` folded into the parcel
     properties — no 5 MB JSON downloads, no 19,020 per-parcel files, no GCS bucket. Prove on 1–2 parcels locally; the full
     bake (≈19k parcels, ≈31k buildings, local CPU only, minutes, no API calls) runs once when approved.
   - Copy SSE `/reports/*.html` + images (Living with the Shoreline, kelp report) under `public/friends/reports/`, and
     repoint `habitatPopups.js` (it links to salishsea.knauernever.com today).
   **Phase 1 status (2026-11-02):** built and proven on 2 Friday Harbor waterfront parcels (351354001000, 351354002000);
   every output matches SSE's exactly (assessor fields, buildings, addresses, nearshore record, greenery).
   **Full run done 2026-11-02, uploaded as version `2026-11`** (`parcelSources.json` region `shoreline-sjc`, with
   `detailBase`): 19,020 parcels, 30,968 buildings, 22,680 addresses (150 county requests); greenery 19,018 parcels
   (77 GEE batches, ~4 min). Tiles 8.4 MB, detail 28.8 MB in 256 shards (≤154 KB, ~20 KB gzipped).
   Against SSE, by PIN (16,536 parcels with a unique PIN in both): greenery identical for 16,468, the rest within
   0.002 NDVI or redrawn by the county; nearshore identical for 13,698. The other 2,838 differ by 0–2 ft
   (a few redrawn parcels by more) because SSE computed its stats at 13:24 on 2026-09-14, hours *before* it simplified
   the shoreline/kelp geometry (commit 2a308d9); ours use the simplified shapes both sites draw. <10 parcels gained or
   lost a feature at a search-distance edge. County FIDs are ordered differently from SSE's Feb file, so FIDs don't
   carry across bakes.
   - `scripts/shoreline/import-sse-static.mjs` — done: 15 files → `public/shoreline-data/` (14 MB), handouts + 36 photos →
     `public/friends/reports/` (12 MB; SSE header/Resources menu replaced by Friends logo + link to /shoreline).
     `habitatPopups.js` now links there, not to salishsea.knauernever.com.
   - `fetch-county.mjs` — live county services (same fields as SSE's Feb 2026 file):
     parcels `OpenData/Parcels/MapServer/1` (19,020), buildings `Polaris/Buildings/MapServer/3` (30,969),
     address points `Polaris/Buildings/MapServer/0` (22,680; source of SSE's address_lookup.json). ≈150 requests for all.
   - `nearshore-stats.py` / `greenery-stats.py` — SSE's scripts, paths only changed.
   - `bake-parcels.py` — PMTiles (`parcels` = shape + fid + PIN; `buildings` from z13) written where
     `api/parcel-tiles` reads local files; popup detail in 256 JSON shards (fid % 256, ≈110 KB each) instead of 19,020 per-parcel files.
   - Earth Engine moved to GCP project `earthatlas` (2026-11-02; greenery-stats.py default), so nothing depends on SSE's
     `salish-sea-property-mapper`. /fire's `sanjuan-wa` parcel config also reads SSE's local Tax_Parcels file.
   - Upstream for fish-use found: county `Habitat/SRSC_ShorelineFishPresence/MapServer` (7 species layers).
2. **Map + panel** — `/shoreline` route (5-place wiring), 8 rows, legends, Color by control, zoom gates.
   **Built 2026-11-02 on localhost** (`src/shoreline/`): all 16 layers in SSE's 8 rows, SSE styles/zooms/pins
   (`shorelineLayers.js`; habitat via `src/friends/habitatOverlay.js`, which now also exports its pin helpers and lets
   other pins yield to its own, as SSE does). Checked side by side with SSE at Google z14 and z17 (Friday Harbor):
   same colors, widths, pins and thinning. Habitat draws from `public/permits-data/friends-habitat.geojson` (same
   features as the 5 habitat files in `public/shoreline-data`, which `nearshore-stats.py` still reads). Friends logo
   in the panel on every host. No popups or hover cards yet (phases 3–4).
3. **Feature popups** — all 16 layers, SSE content, EarthAtlas frame, "What's here" chooser on overlaps.
   **Built 2026-11-02 on localhost**: `src/friends/popupCard.js` + `.css` (EarthAtlas card with SSE's slots; replaces
   the retired `popupFrame.js` / `ssx.css`), `habitatPopups.js` now holds SSE's specs for all 16 layers + buildings
   (docks' empty TYPE row hidden). /shoreline: pins open directly, lines/areas with others within 12 px get "What's
   here" (legend order), hover cards on everything, parcel + building hover highlight (`bid` added to the bake;
   tiles re-uploaded as 2026-11). /permits uses the same card. Checked in Josh's Chrome tab (buoy, dock, building,
   armor/fish/shoreform chooser, fish species list, shoreform all-fields) and all five /permits habitat cards.
   Kelp's accent is the kelp pin's gold (#B89A3A): SSE's cream accent vanishes on a white card.
4. **Parcel popup** — SSE's tabbed popup (Summary, Shoreline, Fish, Wildlife, Modifications, Vegetation, Property) from the
   baked parcel properties; nearby-feature distances from the precomputed stats.
   **Built 2026-11-02 on localhost**: `src/shoreline/propertyPopup.js` + `.css`. One detail shard per click (Blob
   `shoreline/2026-11/detail/<fid % 256>.json`); SSE's cards and wording for all 7 tabs; inland parcels drop
   Shoreline/Fish/Modifications and get distance-to-shore, greenery, "Friends' work on <Island>" (friends-projects.geojson,
   data only) and upland stewardship. Selected parcel outlined on the map (SSE orange); mini-map = Mapbox
   satellite-streets drawn from the same parcel tiles. Birds via `/api/ebird` (obsRecent; radii 1/5/10/20 mi sent as
   2/8/16/32 km, eBird takes whole km). Parcels with no county address point (5,795 of 19,020) are titled "Parcel <PIN>"
   (SSE used Google's nearest street address). Dropped: SSE's NDVI "More about this data" page (it describes NDVI map
   layers /shoreline doesn't have). Search: an address result inside a parcel opens its report. Checked headless
   (desktop + phone) and in Josh's Chrome: waterfront (Center Is.) and inland (Orcas) parcels, every tab, search.
5. **Brand + share** — title change, `/` on the brand host, link previews, sitemap.
   **Built 2026-11-02 on localhost**: brand chip already "Salish Sea Explorer" / "Shoreline Explorer" (brand.js);
   `brand.home = '/shoreline'` + a host-conditioned redirect in vercel.json send sanjuans.earthatlas.org/ there
   (main.jsx falls back to it client-side). Welcome box + "About this map" pill (`src/shoreline/WelcomeBox.jsx`),
   text from SSE's `config/site-content.json` (copy in `docs/shoreline/sse-site-content.json`), retitled; "public
   lands" dropped and the layers-panel hint points at this map's "On the map" panel. Link preview (shoreline.html,
   brand-host rewrite in middleware.js) and sitemap were wired in phase 2. Open: decision 12's Friends Mapbox token
   needs `MAPBOX_TOKENS_WRITE` (an sk. token with tokens:write) in .env.local before `scripts/brand/new-partner.mjs` can run.
   **Refresh jobs (decision 9), built 2026-11-02 on localhost** — both publish to Blob and need no commit or deploy:
   - `.github/workflows/shoreline-bake.yml`, yearly (Feb 15) + by hand: fetch-county → nearshore-stats → greenery-stats
     (Earth Engine project `earthatlas`, service account `shoreline-bake@earthatlas`, secret `SHORELINE_GEE_KEY`) →
     bake-parcels (`<YYYY-MM-DD>` version) → `upload.mjs --pointer`, which gates (full download, 256 shards, counts
     ≥90% of the live bake) then flips `shoreline/latest.json`. `src/shoreline/bake.js` reads the pointer and falls back
     to `parcelSources.json`; `api/parcel-tiles` serves a dated version beside the recorded one. "pins" input = a check
     that uploads nothing. Proven on 2 Friday Harbor parcels: assessor/buildings/addresses/nearshore identical, NAIP
     values identical under the new project; the sample was refused by the gate; the gates pass the full 2026-11 bake.
   - `.github/workflows/friends-content.yml`, quarterly: `scripts/shoreline/friends-content.py` re-reads sanjuans.org's
     WordPress API (~6 requests), keeps the 209 hand-checked entries' tags/summaries, tags new articles by keyword
     rules (no AI; summary = the article's excerpt; no-topic articles left out), drops removed ones, rebuilds byLayer
     with SSE's table; `upload-friends-content.mjs` gates then writes `shoreline/friends-content.json`, which
     `friendsContent.js` reads (fallback: the repo copy). Proven on a 6-article sample (2 requests).
   - Both upload through one-file passes from `api/cron/permits-upload-token.js` (CRON_SECRET), which now allows these paths.
   - Neither has had a full run; the first ones happen in GitHub after the push.
6. **QA** — side-by-side screenshots against SSE at z10/12/14/16/18 for each row, every popup type once.
7. **Retirement checklist** — what to switch off after cutover (below).

## Cutover order (phase 7, written 2026-11-02)

Done on localhost: /fire's `sanjuan-wa` bake config reads the county download (`data/shoreline/raw/parcels.geojson`,
same fields as SSE's file: 19,020 parcels, owner 37% vs 39%, acres/value/land use 100%) and /risks follows the
recorded `sanjuan-wa` version instead of a hard-coded `2025`. SSE's replacement `vercel.json` is drafted in
`docs/shoreline/sse-retire-vercel.json` (handouts → their new `/friends/reports/` paths, everything else → `/shoreline`).
EarthAtlas sends no anti-framing headers, so an embed of `/shoreline` on sanjuans.org works (SSE allowed sanjuans.org
to frame it).

1. Josh QAs on localhost:5173 (county view, a close-up away from Friday Harbor, one popup of each kind, a property
   report, phone width).
2. Push EarthAtlas (this port's files only; clean-build boot check first). sanjuans.earthatlas.org shows nothing new until then.
3. On prod: `sanjuans.earthatlas.org/` → `/shoreline`; map loads under the Friends Mapbox token; re-check that token's
   URL lock refuses other sites; one popup + one property report.
4. First Action runs by hand: `friends-content` (dry run, then real); `shoreline-bake` with `pins` (proves the CI
   environment + Earth Engine key, uploads nothing). The 2026-11 bake is current, so no full yearly run yet.
5. /fire San Juan rebake: `extract.mjs sanjuan-wa` → `tile.mjs` → `upload.mjs` (local CPU, no API calls; one Blob
   upload, so with Josh's go-ahead). Records version `2026-11`; /fire and /risks pick it up on the next deploy.
6. SSE: replace its `vercel.json` with the drafted one and push SSE (Josh's go-ahead). Old links, shares and handouts
   then land on EarthAtlas. Friends' own links/embeds of the old URL: Josh tells Friends.
7. After the redirect has run a while: archive then switch off SSE's Google Cloud pieces (below), Josh's call.



- GCS bucket `gs://salish-ndvi-tiles`: parcel/building tiles, 19,020 per-parcel files, raw 414 MB kelp file,
  category tree, **welcome text (`site-content.json`, exists only there)**.
- Cloud functions (GCP `salish-sea-property-mapper`): admin-config, og-image, ee-ndvi-tiles, hansen-forest-change,
  opera-dist-alert. Earth Engine project used for the NDVI parcel stats.
- Vercel-hosted `/data/*`, `/reports/*.html`, `/reports/shoreline-images/*`.
- Inbound links/bookmarks to the old URL: handled by step 6's redirect.

## Data provenance + freshness

- **No refresh jobs exist.** Every dataset is a hand-run snapshot: parcels from the county gdb of 2026-02-12, buildings
  from 2026-02-17, Friends layers from 2026-02-24, nearshore stats 2026-09-14, NAIP stats Oct 2023 imagery,
  friends-content harvest 2026-09-03.
- No script for gdb → Tax_Parcels.geojson; no upstream recorded for the Friends shapefiles; fish-use build inputs are gone
  (output file still fine). Archive the raw inputs with the bake scripts.

## Data issues found

1. Hard-coded survey years in popups (kelp 2007, eelgrass 2004, herring 2004), not read from the data.
2. Armor row is named "2019 survey" but credited "inventory (2009) and armor change survey (2019)".
3. Docks "Type" field is empty for all 474 docks (shows a blank row).
4. 2 mooring buoys have Type `L`, which SSE doesn't map (generic title).
5. Herring "Name" values are regions ("Interior San Juan Islands"), not bays.
6. Fish-use popups never get "Related content": friends-content `byLayer` still keys the retired per-species layers.
7. Herring/eelgrass area + length stats come from pre-simplification fields (slightly off the drawn shape).
8. Friends photos in popups are hot-linked from sanjuans.org / i0.wp.com.
