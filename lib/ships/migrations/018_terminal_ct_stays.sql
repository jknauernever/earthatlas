-- /ships: Climate TRACE port stays placed at our terminals (Josh 2026-09-29, task 4). Additive only: one new table.
-- Code: lib/ships/ctStays.js (rule + store), scripts/ships/bake-ct-voyages/bake.mjs (stays out of the voyage pull),
-- scripts/ships/import-ct-stays.mjs (stays → here), lib/ships/terminalCard.js terminalCtStays (the card reads them).
-- Rules: src/ships/CLAUDE.md.
--
--   evidence        Climate TRACE shipping_voyages rows as pulled from BigQuery (gitignored CSV), release in the bake record
--   derived         terminal_ct_stays: one row per Climate TRACE port stay (its own stay flag, other8 = false) whose every
--                   position lies within 0.75 km of ONE listed terminal's berth, with no other terminal within 1.5 × that
--                   distance (ctStays.js CT_STAY_RULE). Evidence class 'inferred'. The figures are Climate TRACE's own,
--                   copied unchanged (tonnes). Rows belong to one bake_version; a re-import of that version replaces them.
--   bake record     source_records row (source 'climate-trace-voyages', entity kind 'ct_stay_bake'): rule, release, pull
--                   window, the area the pull covers, and the counts of matched / ambiguous / disagreeing / unmatched stays
--                   (every ambiguous position listed for review). Each row links to it.
--   interpretation  read time only: whether Climate TRACE's ship type fits the terminal (terminalCard.js shipFit).

CREATE TABLE {{S}}.terminal_ct_stays (
  id                bigserial PRIMARY KEY,
  bake_version      text NOT NULL,
  terminal_id       bigint NOT NULL REFERENCES {{S}}.terminals(id),
  terminal_key      text NOT NULL,
  berth_key         text NOT NULL,                   -- the matched terminal's nearest berth
  km                real NOT NULL,                   -- farthest of the stay's positions from that berth
  asset_identifier  text NOT NULL,                   -- Climate TRACE ship id: om-imo-N (OceanMind), gfw-imo-N / gfw-mmsi-N (GFW)
  ship_name         text,                            -- Climate TRACE asset_name
  ct_type           text,                            -- Climate TRACE type (e.g. oil_tanker, tanker.oil, passenger)
  t0                timestamptz NOT NULL,            -- Climate TRACE start_date (UTC)
  t1                timestamptz NOT NULL,            -- Climate TRACE end_date (UTC)
  ct_port_name      text,                            -- other2
  ct_port_id        text,                            -- other6
  sector            text CHECK (sector IN ('d', 'i')),
  lon               double precision NOT NULL,       -- the stay's (first) position
  lat               double precision NOT NULL,
  co2e_100yr        double precision,                -- tonnes, Climate TRACE's own (total_CO2e_100yrGWP)
  co2e_20yr         double precision,
  co2               double precision,
  ch4               double precision,
  n2o               double precision,
  sox               double precision,
  nox               double precision,
  pm2_5             double precision,
  co                double precision,
  evidence_class    text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id         text NOT NULL DEFAULT 'climate-trace-voyages' REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 >= t0),
  UNIQUE (bake_version, asset_identifier, t0)
);
CREATE INDEX terminal_ct_stays_terminal_idx ON {{S}}.terminal_ct_stays (terminal_key, bake_version, t0);
