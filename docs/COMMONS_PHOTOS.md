# Wikimedia Commons ship photos (by IMO category)

Approved by Josh 2026-09-27: freely licensed Commons photos only, localhost + dev database
first. MarineTraffic, ShipSpotting, VesselFinder and MyShipTracking are out: their terms
forbid reuse. Rules: `src/ships/CLAUDE.md`. Wikidata's own P18 photo route is in
`docs/WIKIDATA_SHIPS.md` ("Photos"); both routes share the licence gate and the credit fields.

Code: `scripts/ships/commonsClient.js` (transport), `lib/ships/commons.js` (pure mapping,
photo choice), `lib/ships/ingestCommons.js` (store + click lookup), resolver v1.5
`decideCommons` in `lib/ships/resolve.js`, `scripts/ships/import-commons.mjs` (batch),
`api/ships.js` `op=photos` (click), `src/ships/VesselCard.jsx` `Photos`.

## 1. API facts

Endpoint: `https://commons.wikimedia.org/w/api.php` (MediaWiki Action API). No key.
"Verified" = observed in a live response on the date given.

| Fact | Status |
|---|---|
| Commons editors file ship photos under `Category:IMO <n>`, which usually holds ONE subcategory per ship name, e.g. `Category:IMO 9509401` → `Category:Jupiter Spirit (ship, 2011)`, and the files sit in that subcategory. Of 13 IMO categories probed 2026-09-27, all 13 had `files: 0, subcats: 1`. | verified 2026-09-26/27 |
| A renamed ship can have one subcategory per name under the same IMO category (same hull). | UNVERIFIED (Commons naming convention; not seen in our sample yet) |
| The ship subcategory can itself have subcategories (e.g. `Eurodam (ship, 2008) in Rotterdam`). We go ONE level below the IMO category and no deeper, so files only in those deeper categories are not seen. | verified 2026-09-27 (EURODAM's category lists such a category on a file) |
| `prop=categoryinfo&titles=…` tells, per title, whether the category exists (`missing: true` when not) and its `size / pages / files / subcats`. | verified 2026-09-27 |
| `titles` takes at most **50** values for a normal client (`toomanyvalues` error above that; 500 for bots/apihighlimits). | verified 2026-09-27 (live error + `paraminfo`) |
| `list=categorymembers`: `cmtype` `file|page|subcat`; `cmlimit` max 500 (5000 high); `cmprop` `ids|title|type|timestamp|sortkey|sortkeyprefix`; `cmsort` `sortkey|timestamp`. The `timestamp` is when the file was added to the category, not the photo date. | verified 2026-09-27 (`paraminfo` + responses) |
| `list=categorymembers` and `prop=categoryinfo&titles=<same category>` can share one request, so one call gives both the members and whether the category exists. | verified 2026-09-27 |
| `generator=categorymembers` + `prop=imageinfo` returns every file of a category with its imageinfo in one call (we use `gcmlimit=50`); more files → `continue.gcmcontinue`. With 50 files and `extmetadata`, all 50 pages came back with imageinfo (no `iicontinue`). | verified 2026-09-27 (EURODAM: 74 files → 50 + continue) |
| `iiprop=url|extmetadata|size|mime|sha1|timestamp`, `iiurlwidth=640`. `extmetadata` fields we read: `Artist` (HTML, often a link to the user page / Flickr), `Credit` (HTML), `LicenseShortName` (e.g. `CC BY-SA 4.0`, `CC0`, `Public domain`), `License` (code, e.g. `cc-by-sa-4.0`, `cc0`, `pd`), `LicenseUrl`, `UsageTerms`, `AttributionRequired` (`"true"`/`"false"`), `Copyrighted`, `Restrictions`, `DateTimeOriginal` (free text or HTML; e.g. `2025-07-22 13:10:05`, `2012-09-04`), `ImageDescription`, `Categories` (pipe-separated), `ObjectName`. Filtered with `iiextmetadatafilter`. | verified 2026-09-27 |
| `thumburl` for `iiurlwidth=640` is a 960 px-wide standard-size file on `thumb.wikimedia.org` (`thumbwidth` reports 640); for an original smaller than the request it is the original (`thumbnail_unscaled`). Both carry `utm_*` tracking parameters, which we strip from the stored URL (the raw record keeps them). The stripped URL loads (HTTP 200 image/jpeg). | verified 2026-09-27 |
| `maxlag=5` on every request. When the servers are lagged the API answers **HTTP 200** with `{"error":{"code":"maxlag",…}}`, a `Retry-After: 5` header and `mediawiki-api-error: maxlag`. (Forced with `maxlag=-1`.) | verified 2026-09-27 |
| User-Agent policy: a descriptive agent with a way to reach the operator; generic library agents may be blocked. We send `EarthAtlasShipsBot/1.0 (https://earthatlas.org/ships; vessel identity import)` (same as the Wikidata client; no personal e-mail). | policy text; UNVERIFIED that a URL alone always satisfies it |
| Rate: API:Etiquette asks for serial (not parallel) requests and `maxlag`; it states no fixed read limit. We run serially, ≥ 500 ms apart in the batch, and back off on maxlag / 429 / 5xx honouring `Retry-After`. | UNVERIFIED (documentation, not tested) |
| `formatversion=2`: `query.pages` is an array, booleans are real booleans (`missing: true`). | verified 2026-09-27 |

## 2. Evidence → claims → interpretation

- **Evidence.** One source entity per IMO category (`source wikimedia-commons`,
  `entity_kind commons_imo_category`, key `Category:IMO <n>`). Its raw record is
  `{ imo, category, truncated, responses: [...] }` where `responses` are the request URLs and
  response bodies exactly as received (categorymembers + categoryinfo, then each harvested
  category's generator/imageinfo pages). For the batch's 50-title `categoryinfo` pre-check the
  entry is `{ request, page }`: this title's page object as received. A checked IMO with no
  category still gets its entity + record (that is the "checked on" date; `last_seen_at`).
  Each file ALSO gets its own `commons_file` entity whose raw record is the file's page object
  (`dataset_version sha1:<file sha1>`), shared with the Wikidata P18 route.
- **Claims.** One `image` assertion per kept file on the category entity:
  `value = file name`, `sub_record_ref = File:<name>`, evidence class `community_curated`
  (Commons categories are openly edited), period `unknown`. Detail: everything the P18
  route stores (`commons_record_id`, `file_page_url`, `thumb_url` + size, `file_url`,
  `license_short_name/kind/url`, `usage_terms`, `attribution_required`, `artist` (+ HTML),
  `credit` (+ HTML), `credit_line`, `share_alike`) plus `via: commons_imo_category`, `imo`,
  `imo_category`, `category` (the subcategory), `width/height/mime`, `capture_date` +
  `date_basis`, `best`, `photo_order`, `not_best_reason`. Commons makes **no identity claim**:
  no `imo`, name or type assertion comes from it.
- **Interpretation (resolver v1.5, `decideCommons`).** The IMO is read from the category
  title and must pass the IMO checksum. The category attaches (`IMO_EXACT`) only when exactly
  ONE vessel holds that IMO as a **registry-class** claim. AIS-only holder → unresolved
  (`imo_only_ais_reported`); several holders → `imo_on_several_vessels`; none →
  `no_vessel_with_imo`. Never by name. No candidate links are written (a photo is not identity
  evidence, and a shared IMO is already recorded as a candidate between those vessels).
  `commons_file` entities are never linked directly (this also keeps `reresolveAll` from
  treating them as new vessels).

## 3. Licence gate (same function as Wikidata P18: `commonsLicense`)

Kept: CC0, public domain (incl. jurisdiction tags like PD-USGov, UNVERIFIED per tag),
CC BY and CC BY-SA (any version/port). Skipped and counted: NC, ND, fair use / non-free,
and anything else unrecognised (e.g. GFDL-only, Free Art License, "Attribution" template,
"Copyrighted free use"). Commons itself only hosts free licences, so the "other" bucket is
licences Commons accepts but our gate (decided 2026-09-25 for P18) does not yet: see open
questions. No licence metadata → no claim. Non-photos (PDF, SVG, video) are skipped as
`not_a_photo`.

Display (licence terms): unmodified image (scaled only), `Photo: <Artist>, <Licence>
(Wikimedia Commons)`, author and "Wikimedia Commons" link to the file page, licence links to
the licence URL. CC BY-SA share-alike applies to adaptations; we don't adapt.

## 4. Choosing the main photo (`best`)

All kept files remain claims; the order only decides what the card shows first:
1. whole-ship shots before others. `not_best_reason` is set for: a detail / interior (title
   or Commons categories mention interior, cabin, engine room/control, wheelhouse, lounge,
   restaurant, dining, atrium, theatre, casino, buffet, menu, logo, emblem, plaque,
   nameplate, ship model, bell, propeller, lifeboat, deck plan, detail(s), ship bridges);
   a photo also filed under ANOTHER ship's category (`… (tugboat, 2008)`: several ships in
   frame); portrait orientation; narrower than 800 px;
2. then the most recent capture date (`DateTimeOriginal`; else the upload date), so the
   ship's current look and name come first;
3. then the file name.
The card puts Wikidata's own P18 choice first when both exist.

## 5. Lookups

- **Batch** `npm run ships:import-commons -- [--all] [--imos …] [--resume] [--limit N] [--max-files N] [--save dir]`:
  default = Salish vessels (seen by the MarineCadastre Salish bake) with exactly one
  checksum-valid registry IMO and no photo yet. 50-title `categoryinfo` first, so a missing
  category costs 1/50 of a request. `--max-files` default 200 per ship (larger categories
  are stored as `truncated: true`). `--resume` skips IMOs checked in the last 30 days.
- **Click** `GET /api/ships?op=photos&id=<vessel uuid>`: the card calls it only when the
  ship has an IMO and no photo. Server guardrail: the vessel exists in our database with
  exactly one registry IMO, has no photo, and its IMO category was not checked in the last
  30 days; only then does it call Commons (≤ 50 files) and save. Returns
  `{ status, imo, images }`; `status` ∈ `fetched`, `fetched_no_category`,
  `fetched_not_linked:<reason>`, `has_photo`, `checked_recently`, `no_registry_imo`,
  `several_registry_imos`, `failed`.

## 6. Dev import results (2026-09-27, `earthatlas-ships-dev`)

Salish vessels with exactly one registry IMO and no photo: 2,291 distinct IMOs (runs 42, 44
[stopped to add concurrent DB writes, resumed], 49, plus two click lookups).

| | |
|---|---|
| IMOs checked | 2,291 |
| `Category:IMO <n>` exists | 501 (21.9 %; the 2026-09-26 sample said ~22 %) |
| Vessels that gained photos | 480 (all attached IMO_EXACT through a registry IMO) |
| Image claims (files kept) | 1,914 across 2,388 file records (Wikidata P18 files share them) |
| Files skipped by the licence gate (final run) | 5: FAL 3, "Attribution" 1, GODL-India 1 |
| Not a photo | 1 |
| Categories found but not attached | 1 |
| Truncated (> 200 files) | 0 |
| Main photo that still carries a `not_best_reason` (every file had one) | 45 |
| Commons requests | ~1,000 for the final run (≈ 1 per 2 IMOs) |
| Evidence stored | ~7 MB of raw records (source `wikimedia-commons`) |

Kept licences (all image claims): CC BY-SA 4.0 708, public domain 300, CC0 222,
CC BY-SA 3.0 148, CC BY-SA 2.0 147, CC BY 2.0 101, CC BY 3.0 95, CC BY-SA 3.0 de 93,
CC BY 4.0 77, CC BY-SA 2.5 12, CC BY 2.5 6, CC BY 2.5 au 3, CC BY 2.1 jp 1, CC BY-SA 2.1 jp 1.
