# Species of concern near a point: handoff, 2026-10-20

Written at the end of a Claude session so a Claude Code session in this repo can build it. Read this first, then
`docs/MAP_TOOL_CONVENTIONS.md`, `docs/PERMITS_HANDOFF.md` and `src/ships/CLAUDE.md` (source-record pages, plain-words
status, localhost QA before merge, never `git add -A`, never push without Josh's go-ahead).

## What Josh wants

A user clicks any point on a map and gets a list of species of concern (endangered, threatened, sensitive, candidate)
that have been recorded within a chosen distance of that point. Washington State first, worldwide later. It will feed
the /permits work (a permit's location should show nearby listed species), so build the lookup as a reusable API plus a
small UI, not as code buried inside one page.

## Scope for the first version

- Jurisdiction: Washington State status lists only (below). Federal ESA, IUCN and other states come later; design the
  data so they can be added as more status lists without changing the lookup.
- Sources: iNaturalist, GBIF, eBird and the existing `/api/whales` feed (Orca Network/Whale Alert via Maplify,
  Happywhale, Salish Sea). These are the sources EarthAtlas already uses (`src/services/*`, `api/*-proxy.js`,
  `api/_ebird-core.js`, `src/lib/whales.js`).
- Inputs: lat, lng, radius (default 5 km, user-adjustable, km or miles), time window (30 days, 1 year, 10 years, all).
- Output: one list per point, grouped by status, one row per listed species.

## Status data

`data/species-of-concern/wa-state-listed.json` (seeded in this session) has 112 entries:

- Endangered (37): WAC 220-610-010, amended WSR 26-01-206, effective 2026-01-24. Scientific names copied from the rule.
- Threatened (4) and Sensitive (7): WAC 220-200-100, effective 2023-12-28. Scientific names copied from the rule.
- Candidate (64 entries; the 5 steelhead DPSs are one entry): WDFW's state candidate list PDF (uploaded 2024-03). The PDF
  gives common names only. Scientific names were assigned by hand and are flagged `needs_verification`.

First task: resolve every entry to an iNaturalist taxon ID, a GBIF taxonKey and (birds) an eBird species code, using the
APIs' name-matching endpoints, and fill those fields. Log any entry that does not resolve cleanly and ask Josh rather than
guess. Known issues are listed in the file's `notes`, including the "Black-headed Woodpecker" entry (probably
Black-backed), goshawk taxonomy, and old names in the WAC text.

Population and subspecies entries (`match_level: subspecies_or_population`) must not be reported as confirmed from a
species-level record. Show them as "species recorded; listed population not confirmed", with the entry's `note`.
Important cases near the Salish Sea:

- Killer whale: the state lists all orcas. The federal listing covers only Southern Residents. Orca Network remarks
  often name the ecotype (e.g. "Biggs T46Bs"); surface that text when present.
- Gray whale: only the Western North Pacific stock is state Sensitive. Gray whales normally seen in Washington are
  Eastern North Pacific and not listed.
- Steelhead: only five DPSs are candidates.

## How to query each source (point and radius)

Lessons from the Decatur Island test run are in brackets.

- iNaturalist: `/v1/observations?lat=&lng=&radius=<km>&taxon_id=<comma list>&d1=&d2=` in one call, paged with
  `id_above`. Exclude `captive=true`. Keep `obscured`, `geoprivacy` and `taxon_geoprivacy`. [Listed species are exactly the
  ones iNaturalist tends to obscure. An obscured record's public coordinates are a random point in a cell about 0.2° on a
  side, so it can sit far from the true spot. On Decatur, 54 of 89 records in the past year were obscured. Plan: query
  with the radius plus about 25 km for listed taxa, show obscured records separately as "location blurred, could be
  within ~20 km".] Also check whether the API's conservation-status filters (`cs`, `csa`, `csi`, `place_id`) could
  replace the taxon list; verify behaviour before relying on them.
- GBIF: `/v1/occurrence/search?geo_distance=<lat>,<lng>,<radius>km&taxonKey=<k>&taxonKey=<k>...&eventDate=` with
  `occurrenceStatus=PRESENT`. Drop the iNaturalist research-grade dataset (`50c9509d-22c7-4a22-a47d-8c48425ef4a7`) and
  Happywhale datasets, since those are queried directly. Keep eBird's dataset (`4fa7b334-ce0d-4e88-aaae-2e0c138d049e`)
  for older years. [For the Decatur area, GBIF's copy of eBird ran only through 2024.]
- eBird: do not page county checklists by day. [That approach took over 40 minutes for 21 months and drew HTTP 429s on
  the shared key, which also serves earthatlas.org.] For each listed bird, call
  `/v2/data/obs/geo/recent/{speciesCode}?lat=&lng=&dist=<km, max 50>&back=<days, max 30>`. Add it as a new locked-down op
  in `api/_ebird-core.js`, with CDN caching, and respect the 1 request/second and 10,000/day limits. Older eBird years
  come from GBIF. Note that eBird coordinates are the checklist location, not the bird's location (seabirds seen from
  shore plot on land).
- Whales: `/api/whales?bbox=&from=&to=&group=all`, then filter by distance. Drop `source=inaturalist` (already
  counted) and avoid double-counting Happywhale records that also appear in GBIF.

Cache results per (rounded point, radius, window) at the edge. Fan out source calls in parallel and render each source
as it arrives.

## Output

One row per listed species: common and scientific name, state status (and later federal and IUCN), number of records,
most recent date, nearest distance, sources with counts, land or water, location quality (exact vs. blurred), and the
population caveat when relevant. Each row expands to its records, each linking to the source record page per the
/permits and /ships conventions. Say plainly that absence of records is not evidence of absence.

## UI

Follow `MAP_TOOL_CONVENTIONS.md` (URL state, satellite default, GeoSearch, share). Click to set the point, draw the radius
circle, list in the left panel grouped by status. Put the lookup in a shared module and endpoint (for example
`api/species-of-concern.js` plus `src/lib/speciesOfConcern.js`) so /permits can call it for each permit location. Whether
this is its own route or a panel in /permits is Josh's call; ask before wiring a new route.

## Test case: Decatur Island

Prototype scripts and outputs from this session are in `~/Projects/decatur-county-records/obs/` (`area.py`,
`counts.py`, `ebird.py`, `match.py`, `wdfw_species.json`, `all_records.json`, `wdfw_matches.json`). Area: Decatur
Island (OSM) plus 300 m of water, excluding neighbouring islands. Window ending 2026-10-20. eBird for 2025-2026 is
missing from these numbers (the run was stopped).

| | 30 days | 1 year | 10 years |
|---|---|---|---|
| All records (iNaturalist, GBIF incl. eBird through 2024, whales) | 8 | 96 | ~2,480 |

State-listed matches in 10 years: common loon (18, eBird), marbled murrelet (15, eBird), killer whale (13: 8 Orca
Network/Maplify, 5 iNaturalist; Orca Network notes include Bigg's T46Bs), gray whale (1, population caveat applies), humpback
whale (1, Happywhale), western grebe (1, eBird), sea otter (1, iNaturalist, location obscured) and western toad (1,
iNaturalist, location obscured). The new tool should reproduce these for a point on Decatur with a matching radius. It
should also find Townsend's big-eared bat only if a record exists. The resident acoustic survey cited in the Decatur deck
is unpublished and will not appear.

## Status, 2026-10-20 (end of build session)

Built on localhost, not committed, no UI yet.

- Status lists in `data/species-of-concern/`, all with iNaturalist/GBIF/eBird IDs:
  `wa-state-listed.json` (112), `wa-federal-esa.json` (122: ESA + USFWS Species of Concern; built by
  `scripts/species-of-concern/build-wa-federal.mjs` from ECOS), `wa-dnr-rare-plants.json` (386),
  `wa-sgcn.json` (381), `wa-phs.json` (131) (the last three built by `build-wa-state-lists.py`).
  IDs: `scripts/species-of-concern/resolve-ids.mjs <file>` (reuses IDs across lists; `locked` entries are hand-set).
- Lookup: `lib/speciesOfConcern/lookup.js` (`lookupSpeciesOfConcern`), endpoint `api/species-of-concern.js`
  (`lat, lng, radius_km, window=30d|1y|10y|all`), client `src/lib/speciesOfConcern.js`.
  Tests: `npm run test:species-of-concern`. One-point check: `node scripts/species-of-concern/try-lookup.mjs <lat> <lng> [km] [window]`.
- Matching: each list entry's `match_level` decides whether a species-level record confirms it. Rows where no list is
  confirmed are grouped last as "Related species recorded (listed taxon not confirmed)".
- iNaturalist blurred records: kept when the 0.2° cell they hide in touches the circle (no blanket +25 km).
- eBird: one `geo/recent` call (last 30 days, latest sighting per species). Older eBird comes only via GBIF, which lags
  months, so a 1-year window has an eBird gap. Land/water per row is not done yet.
- Decatur Island (48.510, -122.809, 5 km, past year): 28 rows in ~18 s, including killer whale (Bigg's T19s in Orca
  Network remarks), humpback, gray whale (population caveat), marbled murrelet, common loon, sea otter and western toad
  (blurred), matching the handoff's list except western grebe (1 eBird record in 10 years).
- Page: `/species-of-concern` (`src/speciesOfConcern/`), own route per Josh 2026-10-20, wired in the 5 places plus the
  share-card middleware and a Vite dev middleware for the API. Species whose only records have blurred iNaturalist
  locations are NOT in the main list or headline count: they sit in a collapsed "Possibly nearby (location blurred)"
  group (Josh: a 1 km view listed species whose records were all outside the circle).
- Regulatory record (2026-10-20, Josh: blurred sightings carry no weight in a permit comment): the lookup also returns
  `regulatory` from `lib/speciesOfConcern/regulatory.js`: NOAA + USFWS critical habitat (exact designated polygons, Federal
  Register + 50 CFR links, whether the spot is inside) and WDFW PHS public layers (sensitive species at section /
  quarter-township / township). Shown first on the page ("What agencies have mapped here").
- Killer whale ecotypes: `lib/speciesOfConcern/orcaEcotype.js` reads remarks/notes/Happywhale labels; a non-hedged Southern
  Resident identification confirms the federal listing for that record (Lime Kiln, 3 km, past year: 50 SRKW, 18 Bigg's).
  Decatur's past-year orcas are all Bigg's, so the federal listing stays unconfirmed there.
- Next idea (not built): humpback DPS from Happywhale photo-ID matches to breeding grounds, if Happywhale's API exposes them.
- Critical habitat is stored, not queried live (2026-10-21; ArcGIS Online caps shape requests at 60/min and lookups hit
  it): `scripts/species-of-concern/bake-critical-habitat.mjs` downloads Washington's NOAA + USFWS designations at full
  precision into 0.25° tiles on Blob (`species-of-concern/critical-habitat/wa-<stamp>/`, pointer `wa-latest.json`; first
  bake 34,800 features, 42 designations, 454 tiles, 18.9 MB). `regulatory.js` reads only the tiles a circle touches
  (exact inside/distance answers) and falls back to the live services if the store can't be read.
  Monthly refresh: `.github/workflows/soc-critical-habitat-bake.yml` (uploads via `api/cron/permits-upload-token.js`,
  whose allowlist now includes the bake's paths). Localhost can test a local bake with `SOC_CRITHAB_DIR=<dir>`.
- Humpbacks: `lib/speciesOfConcern/humpbackDps.js` reads each Happywhale individual's breeding-ground sightings
  (Dec–Apr, Pacific): Mexico (threatened) and Central America (endangered) confirm the federal listing; Hawaii does not.
