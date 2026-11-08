-- /ships: dock calls (Josh 2026-11-07): AIS calls at the docks Washington Ecology's oil-transfer notices name that no EarthAtlas
-- terminal covers (ferry terminals, cruise berths, tug docks, shipyards, marinas, seafood docks; lib/ships/data/antDocks.js).
-- Additive only: two new tables. Same rule as terminal calls (migration 016), but these docks are report-only: they are not
-- terminals and never appear in ships.terminals. Code: lib/ships/dockCalls.js, scripts/ships/dock-calls.mjs,
-- scripts/ships/bake-ais/terminal_calls.py --set dock-calls. Rules: src/ships/CLAUDE.md.
--
--   evidence        MarineCadastre AIS daily points (CC0), the bake-ais Parquet cache (positions never go in Postgres)
--   derived         dock_calls: a ship stopped (SOG < 0.5 kn) within the dock's radius for >= 15 min, a gap > 6 h starting a
--                   new call. Evidence class 'inferred'. The ais_* columns are what the ship BROADCAST (AIS self-reported).
--                   A position counts for every dock whose radius holds it (neighbouring docks share piers).
--   bake record     source_records row (source 'earthatlas-dock-calls', entity kind 'dock_call_bake'): rule, docks list version,
--                   every dock point + radius, the days read. Each call links to it.
--   interpretation  read time only (lib/ships/oilTransfers.js): whether the notified ship made the call.

CREATE TABLE {{S}}.dock_calls (
  id                bigserial PRIMARY KEY,
  bake_version      text NOT NULL,
  dock_key          text NOT NULL,                   -- lib/ships/data/antDocks.js key
  mmsi              text NOT NULL CHECK (mmsi ~ '^\d{1,9}$'),
  t0                timestamptz NOT NULL,            -- first stopped position (UTC, as MarineCadastre publishes)
  t1                timestamptz NOT NULL,            -- last stopped position
  n_points          integer NOT NULL,
  min_m             real NOT NULL,                   -- closest stopped position to the dock point, metres
  radius_m          integer NOT NULL,                -- the dock radius the rule used
  ais_name          text,                            -- AIS reported (most frequent during the call)
  ais_imo           text,                            -- AIS reported
  ais_vessel_type   integer,                         -- AIS reported ship-and-cargo type code
  ais_length        real,                            -- AIS reported, metres
  evidence_class    text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id         text NOT NULL DEFAULT 'earthatlas-dock-calls' REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 >= t0),
  UNIQUE (bake_version, dock_key, mmsi, t0)
);
CREATE INDEX dock_calls_dock_idx ON {{S}}.dock_calls (dock_key, bake_version, t0);
CREATE INDEX dock_calls_mmsi_idx ON {{S}}.dock_calls (mmsi, t0);

-- One row per imported bake version: the months it fully covers and the docks list it was counted with.
CREATE TABLE {{S}}.dock_call_bakes (
  bake_version      text PRIMARY KEY,
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  docks_version     text NOT NULL,
  months            text[] NOT NULL,                 -- 'YYYY-MM' months with every day's points read
  rule              jsonb NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
