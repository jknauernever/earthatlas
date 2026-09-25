# Wikidata — ship items (reference for /ships)

Studied 2026-09-25 against the live Wikidata Query Service (WDQS) and the
Wikibase Action API. Counts are from queries run that day; anything not
checked against a live response or an official page is marked **UNVERIFIED**.
Code: `lib/ships/wikidata.js` (mapping), `lib/ships/ingestWikidata.js`,
`scripts/ships/wikidataClient.js`, `scripts/ships/import-wikidata.mjs`.
Classification: `docs/SHIP_CLASSIFICATION.md`.

## What Wikidata is, for our purposes

A community-edited knowledge base. Anyone can edit an item; values are often
copied from registries, operators' websites, press or Wikipedia, but a
statement only sometimes carries a reference (`references[]`, e.g. "stated in"
/ "reference URL"), and nothing guarantees it is current. It is therefore
**not a registry**. We store it under its own evidence class,
**`community_curated`** (migration `003_wikidata.sql`; see "Evidence class" below).

## Access, license, limits

| Item | Fact | Source |
|---|---|---|
| Structured-data license | **CC0 1.0**: "All structured data from the main, Property, Lexeme, and EntitySchema namespaces is available under the … CC0 License" (other namespaces, e.g. talk pages: CC BY-SA 3.0). Commercial use allowed, no attribution legally required (we still credit "Wikidata"). | <https://www.wikidata.org/wiki/Wikidata:Copyright> (fetched 2026-09-25) |
| Images (P18) | Values are **file names on Wikimedia Commons**; each file has its OWN license and author (often CC BY-SA, which requires attribution + share-alike). The CC0 of Wikidata does not cover them. | Commons file pages; `extmetadata` via the Commons API (`prop=imageinfo&iiprop=extmetadata`). |
| **Decision (Josh, 2026-09-25)** | **Images ARE imported, licence-checked per file** (see "Photos" below). | |
| User-Agent | Required on every request. Must be descriptive with contact info; generic agents (`curl`, `python-requests`, …) may be blocked without notice; automated clients should include "bot". Format `<client>/<version> (<contact>) <library>/<version>`. We send `EarthAtlasShipsBot/1.0 (https://earthatlas.org/ships; vessel identity import)`. | Wikimedia Foundation User-Agent Policy (fetched 2026-09-25) |
| SPARQL endpoint | `https://query.wikidata.org/sparql` (GET or POST `query=`; `Accept: application/sparql-results+json` or `text/csv`). | |
| SPARQL limits | Hard query deadline **60 s**. Per client (User-Agent + IP): **60 s of processing time per 60 s**, and **30 error queries per minute**. Over the limit → HTTP 429 with `Retry-After`. | mediawiki.org *Wikidata Query Service/User Manual* § Query limits (fetched 2026-09-25) |
| Action API | `https://www.wikidata.org/w/api.php?action=wbgetentities` — up to **50 ids per request** (500 for accounts with the high-limit right; `action=paraminfo`, fetched 2026-09-25). We send `maxlag=5` and back off on `error.code = maxlag` (API etiquette). Requests are serial, ≥ 500 ms apart. | API:Etiquette, API:Maxlag (UNVERIFIED: not re-fetched) |
| Dumps | Full JSON dump is > 100 GB compressed (UNVERIFIED size); not needed: SPARQL for the id lists + `wbgetentities` for full statements. | |

## Counts (live, 2026-09-25)

| Query | Result |
|---|---|
| Items with an IMO ship number (P458, truthy) | **96,532** items (96,538 truthy statements) |
| Items with P458 at any rank | 96,544 |
| P458 statements, all ranks | 96,549: 96,538 normal, 10 **deprecated**, 1 preferred |
| P458 values failing the IMO checksum | **436** (0.45 %) |
| Non-numeric P458 values | 5 (`none`, `IMO 9187796`, two "unknown value" blank nodes, one Commons category name) |
| IMO values on more than one item | **612** (duplicates, a hull and its wreck, or sister items) |
| Items with an MMSI (P587) | **38,176** (38,317 statements; 57 with start/end qualifiers) |
| Distinct P31 ("instance of") classes on IMO items | **433** |
| IMO items whose only P31 is generic ("ship", "watercraft", "motor ship", "steamship", "catamaran", "shipwreck"…) | **57,510 (≈ 60 %)** — Wikidata says *what kind* of ship for only ~40 % |
| IMO items whose P31 is not a watercraft at all | 551 across 81 classes: oil platforms (243), and **companies** ("business" 50, "shipping line" 30, "company" 8…), humans (4), categories (8). Companies here carry the IMO **company** number, which is not a ship number (and fails the ship checksum). |
| Our dev DB (2026-09-25): distinct checksum-valid IMOs we hold / of those in Wikidata | 3,437 / **2,204** (registry-class 337, NOAA-published 2,150, GFW AIS 453; overlapping) |
| Our MMSIs also found in Wikidata | 994 of 15,084 |

### Property coverage on the 96.5k IMO items

"stmts w/ time" = statements carrying a start (P580) or end (P582) qualifier.

| Property | Meaning | Items | Statements | stmts w/ time | Mapped to |
|---|---|---:|---:|---:|---|
| P31 | instance of | 96,518 | 98,492 | 327 | `vessel_type` (kinds of watercraft / offshore units) or `instance_of` (anything else) |
| P458 | IMO ship number | 96,544 | 96,549 | — | `imo` (+ `checksum_ok`) |
| P729 | service entry | 92,834 | 92,877 | 0 | `service_entry` |
| P2043 | length | 85,922 | 86,766 | 55 | `length_m` |
| P1093 | gross tonnage | 84,340 | 84,536 | 23 | `tonnage_gt` |
| P8047 | country of registry (flag) | 81,503 | 82,857 | 1,311 | `flag` |
| P2049 | width | 61,317 | 61,344 | 2 | `width_m` |
| P176 | manufacturer (shipyard) | 40,109 | 40,317 | 11 | `builder` |
| P587 | MMSI | 36,733 | 36,851 | 57 | `mmsi` |
| P2317 | call sign | 33,213 | 33,443 | 133 | `callsign` |
| P532 | port of registry | 27,059 | 27,483 | 596 | `port_of_registry` |
| P18 | image | 17,072 | 17,712 | 0 | `image` (only with a reusable Commons licence; see Photos) |
| P2262 | draft | 13,377 | 13,542 | 0 | `draft_m` |
| P1448 | official name | 10,695 | 17,110 | **8,937** | `name` (name history) |
| P793 | significant event | 9,448 | 13,681 | 74 | `event` (+ P585 point in time in detail) |
| P2261 | beam | 5,460 | 5,543 | 2 | `width_m` (property id kept in detail) |
| P137 | operator | 5,195 | 5,568 | 540 | `operator` |
| P127 | owned by | 2,213 | 2,460 | 418 | `owner` (new; not registered/beneficial) |
| P1083 | maximum capacity | 2,120 | 2,339 | 10 | `max_capacity` |
| P289 | vessel class | 1,689 | 1,700 | 14 | `vessel_class` |
| P1071 | location of creation | 1,237 | 1,251 | 2 | not mapped |
| P138 | named after | 1,110 | 1,171 | 71 | not mapped |
| P17 | country | 1,056 | 1,077 | 22 | not mapped (P8047 is the flag) |
| P571 | inception | 514 | 523 | 0 | not mapped (P729 used) |
| P730 | service retirement | 381 | 382 | 0 | `service_retirement` |
| P516 | powered by | 379 | 440 | 6 | not mapped |
| P1619 | date of official opening | 141 | 141 | 0 | not mapped |
| P1366 / P1365 | replaced by / replaces | 26 / 31 | | | not mapped |

Other properties seen on EURODAM but not mapped: P504 home port, P2052 speed,
P4519 payload mass, P373 Commons category, P7782 category for ship name, P617
yard number, P856 official website, P646 Freebase id.

## Data model facts we rely on (Wikibase JSON, seen in live responses)

- `entity.id` (Q-id), `lastrevid`, `modified`; `labels.en.value`; `claims[P][]` = statements.
- Statement: `id` (GUID, e.g. `Q548546$ADD1B93E-…`, stable across edits), `rank`
  (`preferred` / `normal` / `deprecated`), `mainsnak` (`snaktype` `value` /
  `novalue` / `somevalue`; `datavalue.value`), `qualifiers`, `references`.
- Item values: `{ "entity-type": "item", id: "Q…" }` — labels are NOT inline; we
  look them up (SPARQL `rdfs:label`, English).
- Quantities: `{ amount: "+285.43", unit: "http://www.wikidata.org/entity/Q11573" }`
  (unit "1" = unitless). Seen units: Q11573 metre, Q3710 foot, Q128822 knot, Q191118 tonne.
- Times: `{ time: "+2008-00-00T00:00:00Z", precision: 9, timezone: 0, calendarmodel }`.
  Precision 9 = year, 10 = month, 11 = day; the zero month/day are placeholders.
  Times are UTC; `timezone` is a display offset (UNVERIFIED against the spec page).
- `P1448` official name is monolingual text `{ text, language }` (EURODAM: `mul`).
- Deprecated rank = the community marks the statement as wrong (e.g. Netherlands
  Q55's ISO code NLD is deprecated because NLD belongs to the Kingdom, Q29999).

## How we map it (lib/ships/wikidata.js)

- **One item = one source entity** (`wikidata_item`, key = Q-id). The raw record
  is the entity object **exactly as `wbgetentities` returned it**
  (`props=info|labels|descriptions|claims|sitelinks/urls`, `languages=en`,
  `sitefilter=enwiki`), versioned by SHA-256; `dataset_version = rev:<lastrevid>`.
  An edit on Wikidata → a new raw record; statements the item dropped are
  `superseded`, never deleted.
- **Every claim is `community_curated`**, with `sub_record_ref` = statement id and
  `detail.property` = P-id, so any shown value leads to its exact statement.
- **Time:** P580 start / P582 end qualifiers → `validity` `[from, to)`, widened to
  the stated precision (a start "2003" = from 2003-01-01; an end "2000" = until
  2001-01-01) and the precision text kept in detail. No qualifiers → `unknown`
  `(,)`. Precision coarser than a year, or start after end → unknown + warning.
  Never invented.
- **Referenced items** stored by Q-id: `value_raw` = "`label (Q-id)`",
  `value_norm` = normalized label (companies, ports, builders) or `WD_Q…`
  (classes, events) or ISO alpha-3 (flag, only when Wikidata's non-deprecated
  P298 has one; otherwise `WD_Q…`). A label change on Wikidata produces a new
  claim and supersedes the old one.
- **P31**: classes that are `P279*` subclasses of watercraft (Q1229765) or of oil
  platform / drilling rig → `vessel_type` `WD_Q…`; anything else → `instance_of`.
  An item with no vessel-like P31 is `isVessel = false` and never resolves.
- Skipped (kept only in the raw record): deprecated statements, `novalue` /
  `somevalue`, lengths in units other than metre/foot, P18 images whose
  Commons licence doesn't allow reuse.

## Evidence class: `community_curated` (proposed; Josh to confirm)

Why not an existing class:
- `registry` — no: nobody vouches for it, and CLAUDE.md reserves "registry" for
  authoritative registry records; mislabelling would let the UI say "a registry
  confirms this" about a crowd-edited value.
- `ais_self_reported` / `ais_published` — no: not transmitted by the ship.
- `inferred` — no: not a model's output; a human typed it.
- `unverified` — close, but too generic: it would hide *which* kind of unverified
  source this is, and "community-curated knowledge base" has its own
  strengths (specific types, operators, name history) and failure modes
  (vandalism, stale values, duplicates). Keeping it separate lets EarthAtlas
  weigh it differently later without re-importing.

**Decided (Josh, 2026-09-25): keep `community_curated`.**

## Resolution (resolver v1.3, `resolveCuratedEntity` / `decideCurated`)

Stricter than for GFW / NOAA, because anyone can edit the input:
1. **Attach-only.** A Wikidata item **never creates a vessel** and never merges
   two vessels. (Otherwise ~95k items, many scrapped decades ago, would each
   become an EarthAtlas vessel.) Unmatched items stay stored and unresolved;
   `npm run ships:reresolve` retries them after new GFW/NOAA imports.
2. **IMO_EXACT**: the item has exactly one checksum-valid IMO, the item is a
   kind of vessel, and exactly one existing vessel carries that IMO in a
   non-curated class. If that vessel's IMO is **registry**-class → attach. If
   it is only **AIS**-class (NOAA-published or GFW self-reported), a **second
   identifier must agree**: MMSI, call sign, or name (P1448, or the English
   label with/without a ship prefix like "MS").
   **Link method (Josh, 2026-09-25; migration 004):** registry IMO → `IMO_EXACT`;
   AIS IMO → named after its strongest corroboration: `IMO_AIS_MMSI` >
   `IMO_AIS_CALLSIGN` > `IMO_AIS_NAME`. Name-only matches are kept but marked
   weaker so the card can say so. `getVessel` exposes `link_method` on every
   claim (and `links[].method` / `evidence.corroborated_by`).
   Re-deciding existing links: `npm run ships:reresolve -- --source wikidata`
   (supersedes only Wikidata's resolver links; no vessel ids change).
3. Two vessels carry the IMO, or the item has two IMOs → unresolved, `candidate`
   links for review.
4. **MMSI alone never attaches** (rule 4 of CLAUDE.md).
5. Community-curated MMSIs, call signs and names are **excluded** from every
   other merge rule (`decide` / rule 4b) and from `vessels_for_mmsi_at`: a
   Wikidata MMSI can never place an AIS position on a vessel.

## Known pitfalls

- 60 % of IMO items are typed only as "ship" → no classification from Wikidata.
- IMO **company** numbers on company items (P458 misuse) — filtered by the
  watercraft check and the ship checksum.
- 612 IMOs on several items (wreck vs ship, duplicates). Two such items attach
  to the same vessel (same hull), both kept as separate entities.
- Operator/owner are sparse (5.2k / 2.2k items) and often stale without end dates.
- `P1093` gross tonnage cannot be told apart from pre-1982 gross register tons.
- Label-derived names are only used to corroborate, never stored as `name`.
- Some beam/draft statements carry no unit (21 warnings in the first import);
  they are kept only in the raw record, never guessed as metres.

## First import (dev DB, 2026-09-25)

`npm run ships:import-wikidata` → 2,302 items matched our IMOs/MMSIs (2,225 by IMO,
77 by MMSI only), 2,302 raw records (6.4 MB of JSON), 20.4k claims.
1,782 items attached (318 via a registry IMO, 1,464 via an AIS IMO plus a second
identifier; 406 of those by name alone), 441 unresolved with candidates
(390 AIS IMO not corroborated, 40+ IMO on several of our vessels), 55 IMO not on
any vessel, 24 without a valid IMO. 1,776 of our 16,990 vessels now carry a
Wikidata type; 619 of them a specific one.

## Photos (P18 → `image`; decided by Josh 2026-09-25)

- For every P18 file, `imageinfo` on `commons.wikimedia.org/w/api.php`
  (`iiprop=url|extmetadata|size|mime|sha1|timestamp`, `iiurlwidth=640`,
  `iiextmetadatafilter=LicenseShortName|LicenseUrl|License|Artist|Credit|AttributionRequired|UsageTerms|Copyrighted|Restrictions`),
  50 titles per request, same User-Agent, `maxlag=5`.
- **Evidence:** each file's page object, exactly as received, is a raw record of
  source `wikimedia-commons` (one source entity per file, `commons_file`,
  `dataset_version = sha1:<file sha1>`). The `image` claim hangs off the Wikidata
  item (the *choice* of photo is Wikidata's, `community_curated`) and its detail
  carries `commons_record_id`, `file_page_url`, `thumb_url` (+ size), `file_url`,
  `license_short_name`, `license_kind`, `license_url`, `usage_terms`,
  `attribution_required`, `artist` (+ raw HTML), `credit` (+ raw HTML),
  `credit_line` ("Author / Licence / via Wikimedia Commons"), `share_alike`, and
  the statement `rank` (a `preferred` P18 is the item's main photo).
- **Licence gate (`commonsLicense`)**: kept only for CC0, public domain, CC BY
  and CC BY-SA (any version/port). Skipped and counted: NC, ND, GFDL-only,
  "fair use"/non-free, anything unrecognised. CC BY-SA needs share-alike only for
  adaptations: show photos unmodified (scaling is fine) with author, licence and
  a link to the file page. Public-domain tags can be jurisdiction-specific (e.g.
  PD-USGov) — treated as reusable (UNVERIFIED per tag).
- No Commons metadata → no image claim ("no licence = no image"). Re-ingesting
  an item without Commons data (e.g. an offline `--replay`) supersedes its image
  claims; the import script always fetches Commons.
- Thumbnails: the API returns a standard-size thumbnail (960 px file for a
  640 px request) and appends `utm_*` tracking parameters; stored URLs have the
  tracking removed (the raw record keeps them as received).
