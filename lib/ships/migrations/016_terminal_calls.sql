-- /ships: terminal calls counted from EarthAtlas's own AIS positions (Josh 2026-09-28). Additive only: two new tables.
-- Code: lib/ships/terminalCalls.js (rule + splitting), scripts/ships/bake-ais/terminal_calls.py (stopped positions near a
-- berth), scripts/ships/terminal-calls.mjs (calls → here), lib/ships/terminalCard.js (the card reads them). Rules: src/ships/CLAUDE.md.
--
--   evidence        MarineCadastre AIS daily points (CC0), kept in the bake-ais Parquet cache (positions never go in Postgres)
--   derived         terminal_calls: one row per call = a ship stopped (SOG < 0.5 kn) within a berth's radius for >= 15 min,
--                   a gap > 6 h starting a new call. Evidence class 'inferred' (an EarthAtlas rule applied to AIS reports).
--                   The ais_* columns are what the ship BROADCAST during the call (AIS self-reported), never registry facts.
--                   Rows belong to one bake_version; a re-import of the same version replaces that version's rows.
--   bake record     source_records row (source 'earthatlas-terminal-calls', entity kind 'terminal_call_bake') holding the
--                   rule, every berth + radius, the days read and the terminals not covered: each call links to it.
--   interpretation  read time only: which EarthAtlas ship held the MMSI at t0 (vessels_for_mmsi_at) and whether its kind fits.

CREATE TABLE {{S}}.terminal_calls (
  id                bigserial PRIMARY KEY,
  bake_version      text NOT NULL,
  terminal_id       bigint NOT NULL REFERENCES {{S}}.terminals(id),
  terminal_key      text NOT NULL,
  berth_key         text NOT NULL,                   -- the berth of the call's closest stopped position
  mmsi              text NOT NULL CHECK (mmsi ~ '^\d{1,9}$'),
  t0                timestamptz NOT NULL,            -- first stopped position (UTC, as MarineCadastre publishes)
  t1                timestamptz NOT NULL,            -- last stopped position
  n_points          integer NOT NULL,
  min_m             real NOT NULL,                   -- closest stopped position to the berth point, metres
  radius_m          integer,                         -- the berth radius the rule used
  also_near         text[],                          -- other terminals whose berth radius also held some of these positions
  ambiguous_points  integer NOT NULL DEFAULT 0,      -- how many positions were within another terminal's radius too
  ais_name          text,                            -- AIS reported (most frequent during the call)
  ais_imo           text,                            -- AIS reported
  ais_vessel_type   integer,                         -- AIS reported ship-and-cargo type code
  ais_length        real,                            -- AIS reported, metres
  evidence_class    text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id         text NOT NULL DEFAULT 'earthatlas-terminal-calls' REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 >= t0),
  UNIQUE (bake_version, terminal_key, mmsi, t0)
);
CREATE INDEX terminal_calls_terminal_idx ON {{S}}.terminal_calls (terminal_key, bake_version, t0);
CREATE INDEX terminal_calls_mmsi_idx ON {{S}}.terminal_calls (mmsi, t0);

-- One row per imported bake version: which months it fully covers and which terminals lie outside the AIS box.
CREATE TABLE {{S}}.terminal_call_bakes (
  bake_version      text PRIMARY KEY,
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  months            text[] NOT NULL,                 -- 'YYYY-MM' months with every day's points read
  not_covered       text[] NOT NULL DEFAULT '{}',    -- terminal keys with no berth inside the AIS box ("not covered", never 0)
  rule              jsonb NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
