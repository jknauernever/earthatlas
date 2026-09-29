-- /ships: AIS-inferred berths (Josh 2026-09-28). Additive only: one CHECK constraint is widened; every existing row still
-- satisfies it. Code: lib/ships/aisBerths.js (clustering + footprint guard), scripts/ships/bake-ais/berth_stops.py,
-- scripts/ships/ais-berths.mjs, lib/ships/terminals.js (import). Data: lib/ships/data/salish-terminals-ais-berths.json.
-- Rules: src/ships/CLAUDE.md.
--
--   terminal_berths.basis    + 'ais_inferred'   a berth point ESTIMATED from EarthAtlas's own AIS positions: the centre of a
--                                                cluster of long stops by large ships (MarineCadastre AIS, CC0) that lies
--                                                alongside the terminal's own mapped footprint. Never an official position.
--                                                source_id 'earthatlas-ais-berths'; source_record_ids = the stored berth
--                                                record (method, rule, day range, number of stops and ships, footprint used).

ALTER TABLE {{S}}.terminal_berths DROP CONSTRAINT terminal_berths_basis_check;
ALTER TABLE {{S}}.terminal_berths ADD CONSTRAINT terminal_berths_basis_check CHECK (basis IN (
  'usace_dock', 'ecology_dock', 'bc_ports_terminals', 'osm_seamark_berth', 'osm_pier_centers', 'osm_site_center',
  'gisis_facility', 'ais_inferred'));
