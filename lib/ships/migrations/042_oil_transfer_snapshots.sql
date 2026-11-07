-- /ships: the "Planned vs. observed over-water oil transfers in Washington" report (Josh + Lovel Pratt, 2026-11-06), computed once
-- per Ecology release + AIS bake and kept (the computation reads ~18k notices and the terminal calls: ~10 s). Additive only: one
-- new table, nothing existing is altered.
-- Code: lib/ships/oilTransfers.js (buildOilTransferSnapshot, readOilTransfers), scripts/ships/oil-transfer-snapshot.mjs.
--
-- Derived, never evidence: the payload is what computeOilTransfers derives from ecology_ant_rows (Ecology), terminal_calls (AIS)
-- and the stored bunkering report (bunker_snapshots), packed by lib/ships/oilTransfersPack.js. Rebuilt whenever an input changes;
-- the newest row for the current versions is read.

CREATE TABLE {{S}}.oil_transfer_snapshots (
  id                 bigserial PRIMARY KEY,
  version            text NOT NULL,                 -- oilTransfers.js OT_VERSION
  ant_release        text,                          -- ecology_ant_rows release_id it was built from
  call_bake_version  text NOT NULL,                 -- terminal_calls bake version (terminalCalls.js BAKE_VERSION)
  rule               jsonb NOT NULL,                -- oilTransfers.js OT_RULE at build time
  payload            jsonb NOT NULL,
  built_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oil_transfer_snapshots_version_idx ON {{S}}.oil_transfer_snapshots (version, call_bake_version, built_at DESC);
