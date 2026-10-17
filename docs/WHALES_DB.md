# Whale-sightings database (`earthatlas-whales`)

One worldwide store of whale (and other marine-animal) sightings, combined from
every source we use. Every earthatlas.org site reads it — never the sources —
through `/api/whales` (client: `src/lib/whales.js` → `fetchWhales()`). Plan: docs/WHALES_AND_SHIPTRAFFIC_PLAN.md.
Source facts: docs/ACARTIA.md.

## Database
- Neon resource `earthatlas-whales` (iad1), env `WHALES_DATABASE_URL` (+ `_UNPOOLED`), connected to all Vercel envs.
- **Prod only** — no dev database (Josh 2026-10-17). `.env.local` points at the same database.
  Anything run on localhost writes to a throwaway `whales_t_<random>` schema; only the cron writes `whales`.
- Code: `lib/whales/` (db, migrate, migrations/, feeds/, taxa, land, merge, ingest). Tests: `npm run test:whales`.

## Tables (schema `whales`, migration 001_core.sql)
| Table | One row per | Notes |
|---|---|---|
| `records` | upstream record per feed | `norm` = normalized fields, `raw` = payload (iNat trimmed; Maplify's request-header blob with a client IP stripped), `removed_at` when the feed stops returning it |
| `sightings` | real-world report (canonical key) | merged from its records; PostGIS `geom`; `quality` ok / null_island / inland / test; `removed_at` when every record is gone |
| `taxa` | iNaturalist taxon | ancestors → `animal_group` (cetacean, pinniped, sirenian, otter, shark, ray, sea_turtle, other) |
| `name_map` | feed's own species name | how it resolved (feed_taxon, curated, unresolved, not_animal) |
| `ingest_runs` | feed run | fetched / inserted / changed / removed / rebuilt, ok, note |

**Canonical keys:** `maplify:<id>`, `inat:<id>`, `hw:<id>`, `obis:<uuid>`, `salishsea:<uuid>`, `orcasound:<bout…>`.
A key's base is the feed that owns it; SalishSea.io's copy of a Maplify record adds its curated species,
channel, organization and observer. SalishSea.io's iNaturalist rows are skipped (iNaturalist is canonical).

## Feeds
| Feed | Reads | Time | License stored |
|---|---|---|---|
| salishsea | `salishsea.io/read-path/days/<day>.json` (own reports, Orcasound detections as `kind=acoustic`, its Maplify copies) | exact | CC-BY-4.0 (Maplify-derived) / CC-BY-NC-4.0 (native) |
| maplify | `maplify.com/waseak/php/search-all-sightings.php`, worldwide, ≤31-day requests | exact (UTC) | CC-BY-4.0 |
| happywhale | production hwx `POST /encounters` (api/_happywhale-core.js); ranges over 10k split | date only | — (HappyWhale) |
| inaturalist | `/v1/observations` Cetacea, research+needs_id, **licensed only**; photos only if licensed | exact / date | observation's own |
| obis | `/v3/occurrence` Cetacea, **HumanObservation only**, minus HappyWhale + iNaturalist datasets | exact / date | record's own |

Species: every record resolves to an iNat taxon. Maplify's free-text names (several languages, some
mis-encoded) go through `curatedScientific()` in lib/whales/taxa.js, then an iNat name lookup; results are
cached in `name_map`. Non-animal reports (wood, buoys, hazards) are dropped; "Unspecified" stays, unidentified.

## Refresh
- `api/cron/whales-ingest` hourly at :40 (vercel.json): re-reads the **last 7 days** from salishsea, maplify,
  happywhale, inaturalist (+ iNat uploads from the last 2 days, any date). `?feeds=` / `?days=` (≤31) to override.
- A record missing from a re-read window is marked removed (iNat deletions / re-licensing, Maplify edits);
  an empty or >50 % drop is treated as an upstream outage and removes nothing.
- OBIS and older history: backfill only (not yet run — needs Josh's go-ahead with a time/request estimate).

## Reading: `GET /api/whales` (api/whales.js → lib/whales/query.js)
| Param | Meaning |
|---|---|
| `bbox=w,s,e,n` or `lat,lng,radius_km` (≤500) | area; w > e crosses the antimeridian; neither + a taxon = worldwide |
| `from`, `to` | YYYY-MM-DD, default last 30 days, ≤ 10 years |
| `taxon` | iNaturalist taxon id, includes descendants (152871 = all cetaceans, 41521 = orca incl. ecotypes) |
| `group` | `cetacean` (default without a taxon) / `pinniped` / … / `all` |
| `sources`, `exclude` | maplify, inaturalist, happywhale, obis, salishsea, orcasound |
| `kind` | sighting / acoustic |
| `limit` | ≤ 2000, default 500 |

Answer: `{ count, total, truncated, sources:[{id,label,url,count,license}], updated:{feed:time}, sightings:[…] }`,
newest first; only live (`removed_at IS NULL`), quality `ok` rows. Each sighting: id, source, via, kind,
taxon {id, scientific, common, rank, group}, observed_at / observed_date / time_precision, lat, lng, accuracy_m,
location_obscured, count {min,max}, channel, organization {name,url}, observer, attribution, url, license,
photo {url, thumb, license, attribution}, individual {id,label}, remarks, trusted.
Edge cache 5 min. Before the first ingest it answers an empty list with `note: "no whale data loaded yet"`.
Localhost: vite plugin `whalesApiPlugin` runs the same handler; `WHALES_SCHEMA=whales_t_…` points it at a test schema.
Common names are iNaturalist's US names (`preferred_place_id=1`): "Gray Whale", "Harbor Porpoise".

## Shown on the sites (2026-10-17)
Rule (Josh): **every whale report we know about, each one once.**
- **Main search** (src/App.jsx): fetches `/api/whales` whenever the search can include whales (a whale or any
  taxon above whales picked, or a place with no species). **/whales** (ExploreApp, `config.whaleDb`): always.
- Duplicates: the whale database's copy wins; the page drops its own iNaturalist row (same observation id),
  live HappyWhale row (same encounter id) and GBIF row (same `occurrenceID` as an OBIS or HappyWhale record).
  `src/lib/whales.js` → `whaleIndex()` / `isWhaleDuplicate()`.
- Display: dots + species list as usual; popup credit line "Orca Network via Whale Alert · CC BY 4.0" and a
  "View on …" link (or "Source: Whale Alert" when the report has no page); per-source counts; the shared
  **Whale reports** list (src/components/WhaleReports.jsx) — newest first, local date + time, channel, observer,
  link, "heard on hydrophone" for Orcasound; click → map zooms to it.

## Run by hand
```bash
node --env-file=.env.local scripts/whales/ingest.mjs --feed maplify --from 2026-10-11 --limit 2 --drop
```
Defaults to a fresh `whales_t_<random>` schema. `--schema whales` is the real store.

## Proven 2026-10-17 (localhost, throwaway schema)
2 records each from maplify, happywhale, inaturalist, obis (2015-07-01); full day 2026-10-11 of maplify (19)
+ salishsea (8) → 11 Maplify sightings merged with SalishSea.io's copies; re-runs changed nothing.
Storage ≈ 1.5 KB per record (norm + raw) before indexes.
/api/whales proven on one full day (2026-10-11, all 4 live feeds: 156 records) in a test schema: Salish bbox,
orca worldwide (iNat 9, Whale Alert 7, HappyWhale 2), all cetaceans, 50 km radius, exclude, antimeridian, bad input.
