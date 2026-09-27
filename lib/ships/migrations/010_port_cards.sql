-- /ships Phase 3 step 3: PORTS ON THE MAP + PORT CARD.
-- Additive only: one new table, nothing existing is altered.
-- Source facts: docs/GFW_ACTIVITY_API.md ("Port visits by port", verified live 2026-09-27) and
-- docs/PORTS_SOURCES.md ("Step 3", IMF PortWatch verified live 2026-09-27). Rules: src/ships/CLAUDE.md.
--
--   evidence        source_records:
--                     source 'gfw-port-visits': each GFW port-visit event exactly as received (the SAME entities and
--                       port_visits claims a ship card stores: one GFW event id is one entity, whoever asked for it),
--                       plus each /v3/events/stats response (entity kind gfw_port_visit_stats);
--                     source 'imf-portwatch': each PortWatch port feature (kind portwatch_port) and each daily-series
--                       response for one port and window (kind portwatch_daily), exactly as received.
--   claim           port_visits (unchanged, 007)
--   interpretation  which GFW port labels are one of our ports stays in port_aliases (008); which PortWatch port is one
--                   of our WPI ports is decided at read time (same UN/LOCODE + distance check), never stored.
--
-- This table is only the fetch log: what the port card asked of GFW / PortWatch, when, with what result, so a
-- repeat open reads the database instead of calling out again, and so calls can be counted (daily guardrail).

CREATE TABLE {{S}}.port_card_fetches (
  id                bigserial PRIMARY KEY,
  port_id           bigint NOT NULL REFERENCES {{S}}.ports(id),
  kind              text NOT NULL CHECK (kind IN ('discover', 'events', 'stats', 'portwatch')),
                    -- discover  = GFW events by geometry around the port (finds GFW port labels near a port we have none for)
                    -- events    = GFW port-visit events for the port's labels, one month, by visit start
                    -- stats     = GFW /v3/events/stats for the port's labels over the card's window, monthly
                    -- portwatch = IMF PortWatch daily series for the joined PortWatch port over the card's window
  port_labels       text[] NOT NULL DEFAULT '{}',      -- the GFW labels asked for (sorted); empty for discover / portwatch
  ext_key           text,                              -- portwatch: the PortWatch portid
  range_from        date NOT NULL,                     -- inclusive
  range_to          date NOT NULL,                     -- exclusive
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  status            text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  import_run_id     bigint REFERENCES {{S}}.import_runs(id),
  calls             integer NOT NULL DEFAULT 0,        -- outbound requests made (GFW or PortWatch)
  events_returned   integer,
  complete          boolean,                           -- events: every page fetched (false = stopped at the page cap)
  source_record_id  bigint REFERENCES {{S}}.source_records(id),  -- stats / portwatch: the stored response
  stats             jsonb NOT NULL DEFAULT '{}',
  error             text
);
CREATE INDEX port_card_fetches_port_idx ON {{S}}.port_card_fetches (port_id, kind, finished_at DESC);
CREATE INDEX port_card_fetches_time_idx ON {{S}}.port_card_fetches (started_at);
