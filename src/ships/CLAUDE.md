# /ships — vessel identity, AIS and ship-pollution subsite

These rules apply to all /ships work: `src/ships/`, `lib/ships/`, `api/ships.js`,
`scripts/ships/` and the `SHIPS_*` Neon databases. They were adapted from a
ChatGPT-drafted plan that Josh approved on 2026-09-24. They do NOT apply to the
rest of EarthAtlas.

## The central invariant

```
The source observation is evidence.
The source assertion is a claim.
The EarthAtlas vessel is an interpretation.
Never destroy the evidence because the interpretation changes.
```

When two reasonable designs compete, choose the one that keeps the original
evidence and lets EarthAtlas change its mind later.

## Phases — each one stops for Josh's explicit go-ahead

Finishing a phase, having a design for the next one, or already having code for
it does NOT authorize it. At each boundary, report: what was built, files,
database changes, tests (PASS / FAIL / NOT RUN / BLOCKED, never blur them),
deviations, assumptions, open issues, and the proposed next phase. Then stop.

| Phase | Scope | Status |
|---|---|---|
| 0 | Repo assessment + open-source catalog | done 2026-09-24 |
| 1 | Identity/provenance schema + GFW Vessels import + tests + basic /ships search page (identity history with inline sources) | authorized 2026-09-24 |
| 2 | First AIS source (MarineCadastre, CC0), resolved by MMSI + timestamp; tracks on the map | authorized 2026-09-24; built; prod rollout 2026-09-25 |
| 3 | Global context: GFW presence / dark-vessel (SAR) detections, ports (World Port Index), port visits | authorized 2026-09-25 (study first) |
| 4 | Pollution: EU MRV CO₂, Climate TRACE voyages, SkyTruth Cerulean slicks | not authorized |
| 5 | Live AIS (Digitraffic / Kystverket; needs an always-on worker, which is a new infrastructure decision) | not authorized |

Each phase ends with something Josh can look at on localhost:5173. That is
EarthAtlas's workflow: QA on localhost, then merge to main.

## Identity model (Phase 1)

- **Vessel** = EarthAtlas's own `uuid`. IMO and MMSI are never primary keys.
  IMO is a strong external identifier, but not every vessel has one and sources
  contain errors. MMSI is explicitly temporal: it gets reassigned, mistyped and
  spoofed.
- **source_records** = raw payloads exactly as received, versioned by SHA-256.
  They are never edited or deleted.
- **source_entities** = the thing a source describes (for example one GFW vessel
  entry). Every assertion hangs off one.
- **assertions** = one claim: attribute, raw value, normalized value, time
  period, evidence class, status. Idempotent through a unique key. Assertions
  are only ever set to `superseded` / `disputed` / `rejected`, never deleted.
- **entity_links** = EarthAtlas's interpretation: which source entity belongs to
  which vessel (`accepted`), plus `candidate` matches that were not strong
  enough. Changing a link never touches an assertion or a raw record.

### Time
- Stored as `tstzrange` plus a `period_kind`:
  - `validity`: the source claims the value held for that period. Bounds `[)`.
  - `observed`: the value was seen from … to …. Bounds `[]`, since the last
    sighting is inclusive. GFW transmission windows and registry snapshot dates
    are `observed`.
  - `unknown`: no dates given, stored as `(,)`.
- An unbounded side means "unknown", not "forever". Never invent dates.
- Timestamps are UTC. A source timestamp with no zone marker is rejected, not
  assumed to be UTC.
- A historical observation resolves against the identity valid at its own
  timestamp, never against the vessel's current identity.

### Evidence classes (never collapse them)
`registry` (authoritative registry record, here as processed by GFW),
`derived_identity` (a trusted third party's identity match, e.g. GFW's
grouping), `ais_self_reported`, `inferred` (models), `unverified`.
"AIS reported this" and "a registry says this" must stay distinguishable
everywhere, including the UI.

### Resolution rules (resolver v1): conservative
A wrong merge is worse than an unresolved record.
1. Once a source entity has an accepted link, a re-import never silently moves
   it. New conflicting evidence produces candidates for review.
2. `IMO_EXACT`: link to an existing vessel only when the entity has exactly one
   distinct registry-class IMO, that IMO passes its checksum, and exactly one
   existing vessel carries it.
3. More than one vessel matches, or the entity carries conflicting IMOs →
   record `candidate` links and leave the entity unresolved (or a new vessel
   flagged for review). Never force a merge.
4. MMSI alone never merges entities (MMSIs get reused). An MMSI whose observed
   window overlaps another vessel's produces an `MMSI_TEMPORAL` candidate only.
5. No match → new vessel via `NEW_FROM_SOURCE_ENTITY`, accepting the source's
   own grouping as `derived_identity` evidence.
6. There is no universal confidence score. Methods are recorded, and scoring can
   come later from the preserved evidence.

### Relationships
Roles are distinct and are never inferred from one another:
`registered_owner`, `beneficial_owner`, `operator`, `ship_manager`,
`technical_manager`, `commercial_manager`, `bareboat_charterer`, `ism_manager`,
plus `registry_owner` (a registry-listed owner whose registered-vs-beneficial
status the source does not state; GFW's `registryOwners` map here).

### Normalization
Deterministic and unit-tested. The raw value is always stored next to the
normalized one and never overwritten. Names normalize to uppercase A–Z0–9 with
no spaces (so PACIFIC STAR, Pacific Star and PACIFIC-STAR compare equal).

## Storage
- Identity lives in Neon Postgres: `SHIPS_DATABASE_URL`, with
  `earthatlas-ships-dev` for localhost via `.env.local` and `earthatlas-ships`
  in production via Vercel. It is a separate database from the news DB
  (`DATABASE_URL`), which is never touched.
- Schema SQL is in `lib/ships/migrations/NNN_*.sql`, applied in order by
  `scripts/ships/migrate.mjs`, which records them in `schema_migrations`.
  Migrations are additive. Destructive migrations need Josh's approval.
- AIS positions (Phase 2+) do NOT go in Postgres. They follow the house pattern:
  Parquet → tippecanoe → PMTiles on Blob → edge proxy.

## Sources and licensing
Licensing is a functional requirement. Before any source reaches production,
record in `ships.sources`: license, whether commercial use is allowed,
attribution text, and redistribution limits. If a license is unclear, stop and
flag it. Publicly accessible does not mean free to reuse.

GFW specifics (full reference: `docs/GFW_VESSELS_API.md`):
- CC BY-NC 4.0, non-commercial only.
- "Powered by Global Fishing Watch" linked on every page that shows the data.
- The token is server-side only: import scripts, never the browser.
- Rate limit: 50k requests/day.

Every value shown in the UI carries its own inline, clickable source (EarthAtlas
prime directive). No synthetic data is ever shown as real.

## Tests
`npm run test:ships` (`node --test`, no extra dependency).
- Pure logic (normalization, GFW mapping, resolver decisions) runs offline.
- DB tests run against the DEV database inside a throwaway schema
  (`ships_t_<random>`) that is dropped afterwards. They never touch the `ships`
  schema and never run against production.
- Unit tests never call live third-party APIs. GFW fixtures are recorded real
  responses (or the documented examples), labelled as such.
- A failing test is reported, not weakened. If a test looks wrong, stop and
  explain why.

## Out of scope unless authorized
Refactoring unrelated EarthAtlas code, dependency upgrades, a manual-review UI,
confidence scoring, AIS ingestion before Phase 2, new infrastructure.
Report unrelated problems instead of fixing them. Never `git add -A` (parallel
sessions share this tree). Never push without Josh's go-ahead for that batch.
