# Acartia & related Salish Sea whale-sighting feeds

Explored 2026-10-17. Facts only; every endpoint below was hit once to confirm.

## The chain

```
Orca Network FB group, Whale Alert app, WRAS, Orcasound, WSSJI, Cascadia RC, …
        │
        ▼
Maplify / Conserve.io   (maplify.com/waseak — the "Spotter" / Whale Alert backend)
        │                         │
        ▼                         ▼
Acartia.io (data co-op)     SalishSea.io (Orcasound/Beam Reach; also pulls iNaturalist + Orcasound)
```

Acartia is a re-publisher of Maplify (plus a few partner feeds). SalishSea.io is
the actively developed successor in the same GitHub org (`salish-sea`).

## 1. Acartia.io — `https://acartia.io/api/v1`

Source: github.com/salish-sea/acartia (MIT; last commit 2026-06-17). Express + OrbitDB.

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /sightings/current` | **none**, CORS `*` | Last 7 days by `created` date. JSON array. |
| `GET /sightings` | token | All sightings (full history). |
| `GET /sightings/export` | token | Full history as CSV. |
| `GET /sightings/trusted` | token | `trusted === 1` only. |
| `GET /sightings/:id` | token | One record. |
| `POST /sightings`, `/sightings/import` (CSV) | token | Contribute. |

Token: register on acartia.io → approval (`/v1/users/requests`) → create a token in the dashboard; sent as `Authorization: Bearer`.

Record fields: `ssemmi_id, entry_id, data_source_name, data_source_entity, data_source_id, data_source_witness, data_source_comments, created (UTC, "YYYY-MM-DD HH:mm:ss"), latitude, longitude, type (e.g. "Orca", "Gray Whale"), no_sighted, photo_url, trusted, profile, ssemmi_date_added, submitter_did, signature`.

Ingest sources in code: `Spotter-API` (Conserve.io/Maplify), `Orca Map`, `Citizen-Science` (Resolve Conservation).

Observed 2026-10-17: `/current` returned **9 rows, all from 2026-10-11**, all Spotter-API/Orca Network. Maplify itself had sightings on 10-12…10-14 that Acartia did not → Acartia's ingest appears stale.

License (site text): **CC BY 4.0**. Attribution = link to acartia.io + credit each data provider + keep each point's provenance; use must promote conservation and follow Be Whale Wise.

## 2. Maplify / Conserve.io (the upstream)

`GET https://maplify.com/waseak/php/search-all-sightings.php?BBOX=minLon,minLat,maxLon,maxLat&start=YYYY-MM-DD&end=YYYY-MM-DD`

- No auth, CORS `*`, no-cache. Returns `{count, results:[…]}`. Global.
- Fields: `id, project_id, trip_id, name, scientific_name, latitude, longitude, number_sighted, created, photo_url, comments, in_ocean, count_check, moderated, trusted, is_test, source, usernm, icon`.
- `source` values seen (2026-10-10…12, 51 rows): `whale_alert`, `unified`, `CINMS`, `wras`, `rwsas`, `mmag_HSL`.
- No published docs or terms found; Acartia/SalishSea.io both treat it as CC BY 4.0 via the Acartia co-op.

## 3. SalishSea.io (best-curated option)

Source: github.com/salish-sea/salishsea-io (MIT code). Rebuilds every 5 min; static files, `Cache-Control: no-cache`.

| URL | What |
|---|---|
| `https://salishsea.io/read-path/manifest.json` | `{version, snapshot_taken_at, covered_through}` |
| `https://salishsea.io/read-path/days/YYYY-MM-DD.json` | One Pacific day of occurrences (Maplify + iNaturalist + native + Orcasound), newest first. 2026-10-11: 45 rows. |
| `https://salishsea.io/dwca/salishsea-occurrences-v1.zip` | Darwin Core Archive, nightly (~1 MB) |
| `https://salishsea.io/dwca/salishsea-occurrences-v1.parquet` | Same as GeoParquet (~1.6 MB) |
| `https://salishsea.io/status/ingest-runs.json` | Ingest run log (health) |

Day-file fields: `id ("inaturalist:…", "maplify:…"), url, body, count, taxon{scientific_name, vernacular_name, species_id, entity_id}, photos, accuracy, location{lat,lon}, observer, provider, collection, organization, organization_url, attribution, certainty, direction, observed_at/from/until, source_url, identifiers`.

DwC archive (2026-10-17): **21,282 occurrences, 2014-04 → 2026-10-14** (bulk 2022–2026). Trusted Maplify rows (20,636, CC BY 4.0) + native SalishSea.io sightings (646, CC BY-NC 4.0); iNaturalist is *not* in the archive (only in day files).
`datasetName` breakdown: Orca Network 16,835 · WSSJI 1,209 · Whale Alert 1,035 · SalishSea.io Direct 646 · Whale Alert (Alaska) 633 · Cascadia Research Collective 258 · PSWS 232 · Orcasound 182 · CWW 86 · …

Scope: killer whales across the full SRKW range; other species only Salish Sea + Strait of Juan de Fuca.

Licensing per record (`license` column is authoritative): Maplify-derived = CC BY 4.0; native = CC BY-NC 4.0 (OK for EarthAtlas, non-commercial). Credit observer (`recordedBy`) and channel (`datasetName`); publisher is SalishSea.io.

## Overlap with GBIF / iNaturalist (checked 2026-10-17)

- **No record-level duplication by design.** SalishSea.io's archive excludes iNaturalist and HappyWhale (both publish to GBIF themselves). Its archive is not on GBIF yet; Orca Network, Whale Alert, Acartia and Orcasound have no GBIF datasets.
- **GBIF cetaceans in the /shiptraffic bbox, 2024–25: 5,671** = HappyWhale (via OBIS-SEAMAP) 4,011 + iNaturalist 1,634 + 26 other. OBIS in that box is the same HappyWhale + iNat marine subset.
- **Same-animal overlap (one sample month, 2025-07, first 300 of 500 GBIF rows):** strict match (same genus, ≤5 km, ≤3 h): 1 of 63 iNat, 0 of 236 HappyWhale. Loose match (same genus, same day, ≤10 km): 15 of 63 iNat (~24%), 37 of 236 HappyWhale (~16%). Loose = upper bound; busy orca days put many unrelated reports near each other.

## Maplify global feed contents (12 months to 2026-10-17, BBOX whole world)

17,356 sightings, all moderated, none flagged test. Not right-whale-only.
- **Species:** humpback 6,020 · killer whale 3,458 · unidentified/other 2,583 · North Atlantic right whale 1,938 · gray 1,759 · fin 599 · dolphins/porpoises 543 · minke 238 · blue 93 · seals/sea lions 53 · ocean sunfish 29 · sperm 27 · sharks 15 (CINMS, Channel Islands) · manatee 1.
- **Regions:** Salish Sea & south BC 5,553 · US West Coast 4,084 · BC outer/north 2,690 · US East Coast 2,377 · Alaska 1,717 · Atlantic Canada 243 · Mexico Pacific 96 · Hawaii 94 · Gulf/Florida 13 · elsewhere 489.
- **`source` → where:** `whale_alert` 13,667 (BC, Salish, US West Coast, Alaska) · `rwsas` 1,838 (right whales, US East Coast + St Lawrence) · `CINMS` 1,070 (Channel Islands; incl. the sharks) · `FARPB` 465 (US West Coast) · `wras` 187 (BC) · `unified` 90 · `mmag_HSL` 38 · `API` 1.
- Right whales are only ~11% of the feed; 95% of them come from `rwsas`.
- Sharks/manatees are effectively absent → Conserve.io's shark and manatee data must live in other projects/endpoints (not yet found).

## Is Maplify copying iNaturalist / HappyWhale? (checked 2026-10-17)

- **Record level: no sign of copying.** Maplify `usernm`s are its own apps/partners (whalealertoa, whaleWebAK, cascadiaWebMap, whaleAndroid, SpotterUser, farallon, wras, oceanalertDefault, whalespotterapi, mmag). Photos are on Conserve's own S3 (664) or seereportsave.org (15) — none on iNat/HappyWhale hosts. In 12 months of comments: 1 links an iNat observation, 1 mentions "Happy Whale" in passing.
- **Same encounter reported twice: yes, some** (one week, 2026-07-01…07):
  - iNaturalist (942 obs worldwide): 15 (2%) same genus ≤2 km ≤1 h; 70 (7%) any whale ≤10 km same day. Example: 4 iNat photos by one person at Devil's Slide, CA, matching one Whale Alert report — separate reports of the same humpbacks.
  - HappyWhale (1,349 encounters worldwide; date only, no time): 55 (4%) same genus ≤2 km ±1 day; 182 (13%) ≤10 km — mostly Alaska and California whale-watching areas.
- **SalishSea.io ⊃ Maplify (certain):** its `maplify:<id>` occurrenceIDs are Maplify `id`s → dedupe exactly by id.
- **Data-quality filters needed:** Maplify has points at 0,0 and inland (e.g. Kansas), plus a test-like `source=API` row ("Final verification of duplicate entry fix").
