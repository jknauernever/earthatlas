-- /ships: OFFICIAL PORT NAMES AND STATUS (Josh approved docs/OFFICIAL_PORT_LISTS.md "PROPOSED plan" on 2026-09-27).
-- Additive only: two CHECK constraints are widened; nothing existing changes and every current row still satisfies them.
-- Code: lib/ships/officialPorts.js. Rules: src/ships/CLAUDE.md.
--
--   evidence        source_records, exactly as received:
--                     'dfo-sch'            kind dfo_sch_harbour  (one DFO Small Craft Harbours feature, ESRI REST, OGL-Canada)
--                     'usace-port-areas'   kind usace_port_area  (one USACE/BTS "Port Areas" polygon feature)
--                     'ca-official-ports'  kind hand_row         (one row of lib/ships/data/ca-official-ports.json)
--                                          kind web_page         (the Transport Canada / Justice Laws page that row cites)
--   claim           the official name / status / authority is the source's own value (kept in the raw record; the
--                   alias restates it in detail.official for reading)
--   interpretation  port_aliases of the four new key kinds: which of OUR ports that official entry is
--                   ('accepted' is shown on the port card; 'candidate' is stored, never shown), with method + distance.
--                   ports of origin 'dfo_sch': a DFO small craft harbour with no map port within 4 km.

ALTER TABLE {{S}}.ports DROP CONSTRAINT ports_origin_check;
ALTER TABLE {{S}}.ports ADD CONSTRAINT ports_origin_check CHECK (origin IN ('wpi', 'gfw_port_label', 'climate_trace', 'dfo_sch'));

ALTER TABLE {{S}}.port_aliases DROP CONSTRAINT port_aliases_key_kind_check;
ALTER TABLE {{S}}.port_aliases ADD CONSTRAINT port_aliases_key_kind_check CHECK (key_kind IN (
  'wpi_number', 'unlocode', 'gfw_port_label', 'gfw_anchorage_s2',
  'dfo_sch_harbour',     -- key = DFO Harbour_number
  'ca_port_authority',   -- key = the hand table row id (a Canada Port Authority, Canada Marine Act Schedule)
  'tc_public_port',      -- key = the hand table row id (a Transport Canada public port, Public Ports Regulations Sch. 1)
  'usace_port_area'      -- key = USACE port code (PORTIDPK)
));
CREATE INDEX IF NOT EXISTS port_aliases_port_kind_idx ON {{S}}.port_aliases (port_id, key_kind) WHERE status = 'accepted';
