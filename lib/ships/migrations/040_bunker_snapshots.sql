-- /ships: the bunkering report, computed once per AIS bake + Ecology release and kept (Josh 2026-10-20: the report took ~12 s to
-- build on every request). Additive only: one new table, nothing existing is altered.
-- Code: lib/ships/bunkerMatch.js (buildBunkerSnapshot, readBunkerReport), scripts/ships/bunker-snapshot.mjs.
--
-- Derived, never evidence: the payload is what readBunkerReport computes from bunker_events (AIS) and ecology_ant_rows (Ecology);
-- it holds the report (every covered month), the learned bunker tugs, the per-anchorage counts for the map badge and the anchorage
-- cards' list of counted fuelings. Rebuilt whenever either input changes; the newest row for the current versions is read.

CREATE TABLE {{S}}.bunker_snapshots (
  id                bigserial PRIMARY KEY,
  bake_version      text NOT NULL,                 -- bunker_events version (bunkerEvents.js BUNKER_BAKE_VERSION)
  bake_record_id    bigint NOT NULL,               -- the AIS bake record it was built from
  ant_release       text,                          -- ecology_ant_rows release_id it was built from (null: none loaded)
  rule              jsonb NOT NULL,                -- bunkerMatch.js MATCH_RULE at build time
  payload           jsonb NOT NULL,
  built_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bunker_snapshots_version_idx ON {{S}}.bunker_snapshots (bake_version, built_at DESC);
