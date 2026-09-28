-- /ships: the terminal card + terminal pins on the map (Josh's decisions of 2026-09-27/28; docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md
-- "Terminal card (dev)"). Additive only: CHECK constraints are widened and one NOT NULL is relaxed; every existing row still
-- satisfies them. Code: lib/ships/terminals.js, lib/ships/terminalCard.js. Rules: src/ships/CLAUDE.md.
--
--   terminals.kind           + 'lpg_terminal'        (the Intalco wharf now exports LPG: Josh decision 6)
--   terminal_berths.basis    + 'gisis_facility'      (a berth point read from an IMO GISIS ISPS declared port facility row,
--                                                     source 'imo-gisis-port-facilities'; used where no USACE / Ecology /
--                                                     BC Ports and Terminals / OSM row exists: Univar North Vancouver,
--                                                     Shell Bare Point Chemainus)
--   terminal_links.role      + 'gem_lng_terminal'    (a Global Energy Monitor Global Gas Infrastructure Tracker LNG terminal
--                                                     unit row, source 'gem-ggit': Josh decision 4)
--   port_card_fetches        + terminal_id           (a terminal card's GFW fetches go in the SAME log as port cards, so the
--                                                     same daily GFW budget and the same "settled months are kept" rule apply:
--                                                     Josh decision 2). port_id may now be NULL when the fetch was made for a
--                                                     terminal whose GFW label is not one of our ports; one of the two is always set.

ALTER TABLE {{S}}.terminals DROP CONSTRAINT terminals_kind_check;
ALTER TABLE {{S}}.terminals ADD CONSTRAINT terminals_kind_check CHECK (kind IN (
  'refinery_dock', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock',
  'military_fuel_pier', 'lng_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal',
  'dry_bulk_terminal', 'cement_terminal', 'scrap_metal_terminal', 'forest_products_terminal',
  'other_bulk_terminal', 'lpg_terminal'));

ALTER TABLE {{S}}.terminal_berths DROP CONSTRAINT terminal_berths_basis_check;
ALTER TABLE {{S}}.terminal_berths ADD CONSTRAINT terminal_berths_basis_check CHECK (basis IN (
  'usace_dock', 'ecology_dock', 'bc_ports_terminals', 'osm_seamark_berth', 'osm_pier_centers', 'osm_site_center',
  'gisis_facility'));

ALTER TABLE {{S}}.terminal_links DROP CONSTRAINT terminal_links_role_check;
ALTER TABLE {{S}}.terminal_links ADD CONSTRAINT terminal_links_role_check CHECK (role IN (
  'dock_record', 'reference', 'osm_site', 'osm_berth_element', 'gem_coal_terminal', 'ct_refinery', 'ct_ship_port',
  'imo_port_facility',
  'gem_lng_terminal'    -- a GEM GGIT LNG terminal unit row (entity_key = GEM unit id, e.g. T104401)
));

ALTER TABLE {{S}}.port_card_fetches ADD COLUMN terminal_id bigint REFERENCES {{S}}.terminals(id);
ALTER TABLE {{S}}.port_card_fetches ALTER COLUMN port_id DROP NOT NULL;
ALTER TABLE {{S}}.port_card_fetches ADD CONSTRAINT port_card_fetches_subject_check CHECK (port_id IS NOT NULL OR terminal_id IS NOT NULL);
CREATE INDEX port_card_fetches_terminal_idx ON {{S}}.port_card_fetches (terminal_id, kind, finished_at DESC) WHERE terminal_id IS NOT NULL;
CREATE INDEX port_card_fetches_labels_idx ON {{S}}.port_card_fetches USING gin (port_labels) WHERE kind = 'events' AND status = 'succeeded';
