# /permits (EarthAtlas PermitTracker): handoff, 2026-10-13

Written at the end of a Claude Desktop session so a Claude Code session in this repo can continue. Read this first, then
`src/ships/CLAUDE.md` (the /ships rules: source-record pages, plain-words status, localhost QA before merge, never
`git add -A`), `docs/MAP_TOOL_CONVENTIONS.md` and `docs/PERMITS_SOURCES.md`.

## What it is

Josh's request: a new earthatlas.org subsite showing Clean Water Act permits and related actions in San Juan County, WA,
2026 data first, San Juan Islands only for now. Name: **EarthAtlas PermitTracker**. URL: **/permits**. It must follow the
same source-linking and attribution conventions as /ships and /sanjuan-docks, and look and feel like them.

Scope of "Clean Water Act" here: §404/§10 fill and in-water structures (Army Corps), §401 water quality certification and
CZM consistency (Ecology), §402 NPDES discharges (EPA ECHO / Ecology), plus the related local actions (county, Town of
Friday Harbor, NOAA marine mammal rules, WDFW HPA as listed in Ecology orders), impaired waters (303(d)) and shellfish
growing areas.

## State: nothing is committed

The working tree also holds Josh's unrelated uncommitted changes (SystemsApp, fire, ships ScrubberReport, api/*). Stage
only the /permits files by name. Never push without Josh's go-ahead.

Built and working on localhost:5173/permits:

| File | What |
|---|---|
| `data/permits/curated.json` | Hand-compiled records (16 projects, 12 unmapped actions, NPDES notes). Every value has `src`, a key into `docs`. |
| `scripts/permits/bake-permits.mjs` | `npm run permits:bake`. Merges curated.json with live EPA ECHO NPDES (outfalls + facility compliance), Ecology 303(d) polygons, DOH shellfish polygons → `public/permits/{permits.json, wq303d.geojson, shellfish.geojson}`. |
| `src/permits/PermitsApp.jsx` + `.module.css` | Map tool on the /sanjuan-docks chrome (QuakesApp.module.css): wordmark + "PermitTracker" badge, GeoSearch, basemaps (county aerials default), share, zoom badge, URL state (`bm, lat, lng, z, r` record, `off` layers, `win` window filter). Left panel: layer toggles with counts, "in-water window open today", records list, "Not yet on the map", sources line, `SourcesFooter`. |
| `src/permits/permitsSources.js` | "How this is sourced" rollup in the `shipsSources.js` shape. |
| Route wiring | `src/main.jsx`, `vercel.json`, `scripts/generate-route-html.js`, `scripts/generate-sitemap.js`, `middleware.js` (TOOLS + matcher), `package.json` (`permits:bake`). `vite build` passes. |
| `scripts/permits/upgrade-curated-docs.py` | One-off, already run (see below). Delete after the rework. |

Bake counts at last run: structures 14, local 2, NPDES 36, unmapped 12, 303(d) 16, shellfish 12.

## Rework done (Claude Code, 2026-10-13, uncommitted)

- Bake: docs are objects; Record docs' payloads stored as received in `public/permits-data/records/<key>.json` (94 files).
  Data moved from `public/permits/` to `public/permits-data/` (vite dev served the folder instead of the /permits route).
  ECHO permits link to ECHO's facility report (else Ecology PARIS) plus a PARIS documents ref; 303(d) to
  `ViewApprovedListing.aspx?ListingId=` + Ecology map; shellfish to DOH's per-area report PDF + a classification record.
  The Reed Bros `echo-WAG030038` break is fixed (src check runs after the NPDES pass). No service URL reaches the client.
- `/permits/source/:key` = `src/permits/PermitsSourcePage.jsx` (ships' SourceRecordPage CSS). Route in main.jsx + vercel.json.
- Popups grouped by document, /sanjuan-docks style; NPDES status in plain words (`STATUS_WORDS`, EPA term on hover).
- Not done: item 4 (permit page per record), ask Josh first.

## Mid-change when the earlier session ended (now resolved)

`upgrade-curated-docs.py` was just run. It turned `curated.json` `docs` from bare URLs into objects:
`{ title, agency, kind ('PDF'|'Page'|'Record'), url, about?, record?, api?, look_up? }`, added `agency_tags`, pointed the
"Aquatics ######" refs at each project's Ecology order PDF, and dropped `ecy-decisions` and `echo-facilities`.
Backup of the previous file: `data/permits/curated.before-docs-upgrade.json` (delete once the rework is done).

**Known break:** Reed Bros (`npdes_curated.WAG030038`) now references `echo-WAG030038`, which is not in `docs`. The bake
creates `echo-<permit>` keys itself, but its curated `src` check runs first and will throw. Fix: let the check accept
`echo-<permit>` keys for permits the bake will add, or add the doc. The bake and the app still read `docs[key]` as a URL
string; both must be updated for the object shape.

## Josh's feedback driving the rework (2026-10-13)

1. "The source ↗ links are linking to non-human readable documents." No source link may open raw JSON or an ArcGIS query.
2. "This needs to LOOK AND FEEL like the user interactions on the /ships and docks subsites."
3. East Sound 303(d) popup "links to a wa ecology website but not to the actual record that is the source."

## The rework to do

1. **Readable sources.** Agency page where one exists; otherwise an EarthAtlas source-record page
   `/permits/source/:key` modelled on `src/ships/SourceRecordPage.jsx` (reuse its CSS module for the identical look):
   kicker "Source record", title, publisher, "See it at the source ↗" button, licence, retrieved date, what it says
   (label/value table), "Show the data exactly as … sent it" raw toggle. The bake fetches and stores the raw payloads
   (`api` URLs) for Record docs. Links verified working in a browser 2026-10-13:
   - Army Corps permit: `https://permits.ops.usace.army.mil/orm-public?q=NWS-2025-00725` (the app reads `?q=`; shows
     that one action). Raw JSON for the record page: `.../orm-public-api/permits/search?sa=true&q=identifier:"NWS-…"`.
   - EPA ECHO facility: `https://echo.epa.gov/detailed-facility-report?fid=<FRS id>` (FRS id from the facility layer's
     `REGISTRY_ID`).
   - Ecology NPDES documents: `https://apps.ecology.wa.gov/paris/PermitDocumentSearch.aspx?PermitNumber=<permit>`
     (GET returns the permit's document rows).
   - 303(d) listing: `https://apps.ecology.wa.gov/ApprovedWQA/ApprovedPages/ViewApprovedListing.aspx?ListingId=<n>`
     (full listing page). Map: `https://apps.ecology.wa.gov/waterqualityatlas/wqa/map?lstid=<n>`.
     `ApprovedSearch.aspx?ListingID=` does NOT work (ignores the parameter).
   - DOH shellfish: annual report PDF per growing area, from `https://doh.wa.gov/bs/node/5891`, e.g.
     `https://doh.wa.gov/sites/default/files/2025-08/eastsound.pdf` (also buck, hunter, lopezislandse, mackaye, mudbay,
     shoal, upright, westcott). Classification itself comes from the DOH layer (updated 2026-09-04): record page.
   - Census geocoder and WSDOT terminal list have no readable per-record page: source-record page only, with
     "To find it there, look up: <address>".
2. **Popups like /sanjuan-docks** (`src/hpa/HpaDocksApp.jsx` `popupHtml`, `HpaDocksApp.module.css`): title, place line,
   count line ("N records from M agencies, by date"), then one `<details>` per document (date in amber mono, agency tag
   chip with full name on hover, document title), sections start closed; inside, what that document states (facts and
   trail events whose `src` is that doc) and "Open ↗" plus "as read" for Record docs; position/match note block at the end.
   Grouping by document makes "as listed in Ecology's order" visible structurally.
3. **Plain-words status** from `src/ships/permitStatus.js` (`STATUS_WORDS`, source's own term on hover), e.g.
   "Expired, still in force" for ECHO "Admin Continued".
4. Later, ask Josh first: a permit page per record like `/ships/permit/:id` (header, facts column, tabs).

## Data notes worth keeping

- ECHO reports compliance per facility (FRS), and one facility can hold several permits; the popup must name them.
- ECHO writes the literal string "None" for missing receiving water (the bake drops it).
- Ecology's Aquatics decisions page is a rolling window (23 Feb to 21 Aug 2026 when read). Records before that are missing.
- Corps public notices for 2026 San Juan projects were not found; the ORM feed gives a notice date only.
- WDFW's public HPA layer was last edited 2024-12-02, so 2026 HPA dates come only from Ecology orders.
- The built-in browser pane in Claude Desktop does not render the Mapbox basemaps reliably (live /sanjuan-docks shows
  the same), and plain `vite` does not serve `/api/aerial-tiles`. Check basemaps in a normal browser.
- Open question from Josh, not started: a programmatic way to embed EarthAtlas content on other sites (Friends of the
  San Juans).
