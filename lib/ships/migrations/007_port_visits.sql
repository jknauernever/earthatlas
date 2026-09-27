-- /ships Phase 3 step 1: PORT VISITS ("Ports of call" on the ship card).
-- Additive only: two new tables, nothing existing is altered.
-- Source facts: docs/GFW_ACTIVITY_API.md ("Port visits for one vessel", verified live 2026-09-26).
-- Rules: src/ships/CLAUDE.md (evidence / claim / interpretation; never destroy evidence).
--
-- Layers, same as identity and incidents:
--   evidence        source_records (source 'gfw-port-visits'): each GFW event exactly as received,
--                   one source entity per GFW event id, SHA-256 versioned
--   claim           port_visits: what GFW says (which GFW identity, which anchorages, when, confidence),
--                   one row per version of one event
--   interpretation  NOT stored: which EarthAtlas vessel a visit belongs to is read through the GFW
--                   identity id -> vessel_assertions (sub_record_ref) -> entity_links, so a changed
--                   identity link moves the visits with it and never touches this evidence.
-- The source row itself (licence, attribution) is registered by lib/ships/portVisits.js
-- (ensurePortVisitSource), like every other source.

CREATE TABLE {{S}}.port_visits (
  id                    bigserial PRIMARY KEY,
  source_id             text NOT NULL REFERENCES {{S}}.sources(id),
  source_entity_id      bigint NOT NULL REFERENCES {{S}}.source_entities(id),
  event_id              text NOT NULL,                 -- GFW event id (32 hex)
  visit_id              text,                          -- GFW port_visit.visitId (a different 32-hex id)
  content_sha256        text NOT NULL,                 -- hash of the mapped fields below
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'superseded', 'withdrawn', 'disputed', 'rejected')),
                          -- superseded = GFW changed this event; withdrawn = a later fetch of a window that
                          -- wholly contains it no longer returned it. Never deleted.
  gfw_vessel_id         text NOT NULL,                 -- the GFW identity id the event is about (vessel.id)
  ssvid                 text,                          -- the MMSI GFW attributes the visit to (vessel.ssvid), as received
  vessel_name_raw       text,                          -- vessel.name as received (AIS name of that identity)
  start_at              timestamptz NOT NULL,          -- UTC (GFW sends ISO Z)
  end_at                timestamptz,
  duration_hrs          double precision,              -- port_visit.durationHrs (= end - start)
  confidence            smallint CHECK (confidence IN (2, 3, 4)),
  confidence_raw        text,                          -- GFW sends a string ("4")
  lat                   double precision,              -- event position = the intermediate anchorage (GFW v3.1+)
  lon                   double precision,
  -- The three anchorages GFW names. anchorage_id = S2 level-14 cell token; port_label = GFW's port id
  -- (e.g. 'usa-seattle', 'CAN-279'); name is often null (docs/PORTS_SOURCES.md §4); iso3 = port country.
  start_anchorage_id    text, start_port_label text, start_name text, start_iso3 text,
  start_lat             double precision, start_lon double precision, start_at_dock boolean,
  int_anchorage_id      text, int_port_label text, int_name text, int_iso3 text,
  int_lat               double precision, int_lon double precision, int_at_dock boolean,
  end_anchorage_id      text, end_port_label text, end_name text, end_iso3 text,
  end_lat               double precision, end_lon double precision, end_at_dock boolean,
  -- Step 2 (not built yet): EarthAtlas's own port, World Port Index first, then the GFW label
  -- (Josh, 2026-09-26). A later migration adds ships.ports and the foreign key.
  port_id               bigint,
  detail                jsonb NOT NULL DEFAULT '{}',   -- topDestination, distanceFromShoreKm (strings as sent), regions
  dataset_version       text,                          -- x-datasets, e.g. public-global-port-visits-events:v4.0
  first_source_record_id bigint NOT NULL REFERENCES {{S}}.source_records(id),
  last_source_record_id  bigint NOT NULL REFERENCES {{S}}.source_records(id),
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, event_id, content_sha256)
);
CREATE UNIQUE INDEX port_visits_one_active ON {{S}}.port_visits (source_id, event_id) WHERE status = 'active';
CREATE INDEX port_visits_vessel_time_idx ON {{S}}.port_visits (gfw_vessel_id, start_at DESC) WHERE status = 'active';
CREATE INDEX port_visits_label_idx ON {{S}}.port_visits (int_port_label);

-- Per-vessel fetch log, so repeat card opens don't re-hit GFW. One row per fetch attempt
-- (kept as history). gfw_vessel_ids = the identities queried; skipped = the vessel's other GFW
-- identities and why they were left out (e.g. a tender's MMSI), so the choice stays reviewable.
CREATE TABLE {{S}}.port_visit_fetches (
  id                    bigserial PRIMARY KEY,
  vessel_id             uuid NOT NULL REFERENCES {{S}}.vessels(id),
  gfw_vessel_ids        text[] NOT NULL,
  skipped               jsonb NOT NULL DEFAULT '[]',
  range_from            date NOT NULL,                 -- GFW start-date (inclusive)
  range_to              date NOT NULL,                 -- GFW end-date (exclusive)
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  status                text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  import_run_id         bigint REFERENCES {{S}}.import_runs(id),
  gfw_calls             integer NOT NULL DEFAULT 0,
  events_returned       integer,
  stats                 jsonb NOT NULL DEFAULT '{}',
  error                 text
);
CREATE INDEX port_visit_fetches_vessel_idx ON {{S}}.port_visit_fetches (vessel_id, finished_at DESC);
