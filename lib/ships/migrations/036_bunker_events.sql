-- Applied to production 2026-10-19 (with 037): do not edit; change the schema in a new migration.
-- /ships: likely bunkering at anchorages, counted from EarthAtlas's own AIS positions (Josh 2026-10-18; Lovel's question about
-- Port Angeles, Vendovi and other anchorages). Additive only: two new tables, nothing existing is altered.
-- Code: scripts/ships/bake-ais/bunker_events.py (the rule, over the salish-v6 points cache), scripts/ships/bunker-events.mjs
-- (import), lib/ships/bunkerEvents.js (join across midnight, store, read). Rules: src/ships/CLAUDE.md.
--
--   bunker_events        derived: one row per likely bunkering = a tug / towing vessel or small tanker (the supplier; a bunker
--                        barge carries no AIS, so its tug is what is seen) stopped within 200 m of a large ship anchored at an
--                        anchorage (the receiver) for >= 60 minutes. Evidence class 'inferred'. outside = the receiver lay
--                        outside every anchorage polygon while reporting AIS status "at anchor" (filed under the nearest
--                        anchorage). r_* / s_* columns = what each ship broadcast (AIS self-reported). Rows belong to one
--                        bake_version; a re-import of the same months replaces them.
--   bunker_event_bakes   one row per bake version: months fully read, the rule.
--   bake record          source_records row (source 'earthatlas-bunker-events', entity kind 'bunker_event_bake'): rule, the
--                        anchorages used, the days read. Each event links to it.
--   interpretation       read time only: which EarthAtlas ships held the two MMSIs at t0 (vessels_for_mmsi_at) and their kinds.

CREATE TABLE {{S}}.bunker_events (
  id                    bigserial PRIMARY KEY,
  bake_version          text NOT NULL,
  anchorage_source_id   text NOT NULL,
  anchorage_source_key  text NOT NULL,
  outside               boolean NOT NULL DEFAULT false,
  receiver_mmsi         text NOT NULL CHECK (receiver_mmsi ~ '^\d{1,9}$'),
  supplier_mmsi         text NOT NULL CHECK (supplier_mmsi ~ '^\d{1,9}$'),
  t0                    timestamptz NOT NULL,          -- first paired minute (UTC, as MarineCadastre publishes)
  t1                    timestamptz NOT NULL,          -- last paired minute
  paired_minutes        integer NOT NULL,
  min_m                 real,                          -- closest distance between the two AIS antennas
  median_m              real,
  r_name text, r_imo text, r_type integer, r_length real,      -- receiver, AIS reported
  s_name text, s_imo text, s_type integer, s_length real,      -- supplier, AIS reported
  evidence_class        text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id             text NOT NULL DEFAULT 'earthatlas-bunker-events' REFERENCES {{S}}.sources(id),
  bake_record_id        bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 >= t0),
  UNIQUE (bake_version, anchorage_source_id, anchorage_source_key, receiver_mmsi, supplier_mmsi, t0)
);
CREATE INDEX bunker_events_anchorage_idx ON {{S}}.bunker_events (anchorage_source_id, anchorage_source_key, bake_version, t0);
CREATE INDEX bunker_events_receiver_idx ON {{S}}.bunker_events (receiver_mmsi, t0);
CREATE INDEX bunker_events_supplier_idx ON {{S}}.bunker_events (supplier_mmsi, t0);

CREATE TABLE {{S}}.bunker_event_bakes (
  bake_version      text PRIMARY KEY,
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  months            text[] NOT NULL,                 -- 'YYYY-MM' months with every day's points read
  rule              jsonb NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
