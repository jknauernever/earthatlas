-- /ships: TERMINALS AND FACILITIES SHIPS SERVICE (Salish Sea). Josh approved the plan in
-- docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md §10 on 2026-09-27. Additive only: three new tables, nothing existing changes.
-- Rules: src/ships/CLAUDE.md (evidence / claim / interpretation; never destroy evidence).
--
--   evidence        source_records, one per raw source row exactly as received:
--                     'usace-docks'            kind usace_dock        (USACE Navigation Facilities, one dock)
--                     'wa-ecology-facilities'  kind ecology_facility  (WA Ecology Class 1/3/4 facility, dock point)
--                     'bc-ports-terminals'     kind bc_port_terminal  (BC Ports and Terminals, one WFS point; OGL-BC)
--                     'osm'                    kind osm_element       (one OpenStreetMap node/way/relation, tags + centre; ODbL)
--                     'gem-gctt'               kind gem_coal_terminal (one Global Coal Terminals Tracker map-file row)
--                     'climate-trace'          kind ct_refinery       (one Climate TRACE refinery source; ports stay kind ct_port)
--                     'earthatlas-terminals'   kind terminal_entry    (the hand-reviewed entry from lib/ships/data/salish-terminals.json)
--   claim           terminals + terminal_berths: EarthAtlas's curated list, each value pointing at its evidence
--   interpretation  which GFW port visits belong to which terminal is NOT stored: lib/ships/terminals.js decides it at
--                   read time from port_visits (007) and the berths below, so the rule can change without touching evidence.
--
-- OpenStreetMap (ODbL 1.0, share-alike): berth positions derived from OSM are marked odbl = true and come only from
-- source 'osm' records, so the share-alike slice stays separable from GFW (CC BY-NC) and Climate TRACE (CC BY) data.

CREATE TABLE {{S}}.terminals (
  id                        bigserial PRIMARY KEY,
  key                       text NOT NULL UNIQUE,              -- stable id from the data file, e.g. 'bc-westridge'
  name                      text NOT NULL,
  kind                      text NOT NULL CHECK (kind IN (
                              'refinery_dock', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock',
                              'military_fuel_pier', 'lng_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal',
                              'dry_bulk_terminal', 'cement_terminal', 'scrap_metal_terminal', 'forest_products_terminal',
                              'other_bulk_terminal')),
  country                   text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  commodities               text[] NOT NULL DEFAULT '{}',
  commodities_source_id     text REFERENCES {{S}}.sources(id),
  commodities_ref           text,                              -- which record / field the list was read from
  operator                  text,                              -- hand-maintained, current (never a shareholder)
  operator_source_url       text,                              -- the page that states it
  operator_checked          date,
  status                    text CHECK (status IN ('operating', 'idle', 'closed', 'construction', 'unknown')),
  status_source_url         text,
  lat                       double precision,                  -- mean of the active berths (display point)
  lon                       double precision,
  list_status               text NOT NULL DEFAULT 'listed' CHECK (list_status IN ('listed', 'withdrawn')),
                            -- withdrawn = no longer in the data file; kept, never deleted
  entry_source_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  detail                    jsonb NOT NULL DEFAULT '{}',       -- notes, Climate TRACE ids as listed
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- One or more berth points per terminal, each with the record(s) its position was read from.
CREATE TABLE {{S}}.terminal_berths (
  id                        bigserial PRIMARY KEY,
  terminal_id               bigint NOT NULL REFERENCES {{S}}.terminals(id),
  berth_key                 text NOT NULL,                     -- e.g. 'usace-02JT', 'ecology-19', 'osm-way1309998671'
  name                      text,
  lat                       double precision NOT NULL,
  lon                       double precision NOT NULL,
  basis                     text NOT NULL CHECK (basis IN (
                              'usace_dock', 'ecology_dock', 'bc_ports_terminals', 'osm_seamark_berth', 'osm_pier_centers', 'osm_site_center')),
  source_id                 text NOT NULL REFERENCES {{S}}.sources(id),
  source_record_ids         bigint[] NOT NULL,                 -- the raw record(s) the position is computed from
  odbl                      boolean NOT NULL DEFAULT false,    -- derived from OpenStreetMap (share-alike slice)
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  detail                    jsonb NOT NULL DEFAULT '{}',       -- OSM element ids, cross-check distances, precision notes
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terminal_id, berth_key),
  CHECK (odbl = (source_id = 'osm'))
);
CREATE INDEX terminal_berths_latlon_idx ON {{S}}.terminal_berths (lat, lon) WHERE status = 'active';

-- Every raw source row a terminal refers to, and in what role. Climate TRACE refinery (facility emissions) and ship-port
-- (voyage emissions assigned to a port) ids are separate roles and must never be shown as one another.
CREATE TABLE {{S}}.terminal_links (
  id                        bigserial PRIMARY KEY,
  terminal_id               bigint NOT NULL REFERENCES {{S}}.terminals(id),
  role                      text NOT NULL CHECK (role IN (
                              'dock_record',           -- USACE / Ecology / BC Ports and Terminals point this terminal is (berth or cross-check)
                              'reference',             -- related record, not used for position (e.g. a duplicate USACE row)
                              'osm_site',              -- the OSM site polygon
                              'osm_berth_element',     -- an OSM element a berth position is computed from
                              'gem_coal_terminal',     -- GEM GCTT unit row
                              'ct_refinery',           -- Climate TRACE oil-and-gas-refining source (plant emissions)
                              'ct_ship_port')),        -- Climate TRACE domestic/international-shipping port source
  source_id                 text NOT NULL REFERENCES {{S}}.sources(id),
  entity_key                text NOT NULL,                     -- the source's own key (NAV_UNIT_ID, OBJECTID, way/123, T1087/T01087, CT id)
  source_record_id          bigint REFERENCES {{S}}.source_records(id),
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  detail                    jsonb NOT NULL DEFAULT '{}',
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terminal_id, role, source_id, entity_key)
);
CREATE INDEX terminal_links_key_idx ON {{S}}.terminal_links (source_id, entity_key);
