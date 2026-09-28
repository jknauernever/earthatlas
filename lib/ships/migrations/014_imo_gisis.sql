-- /ships: IMO GISIS scrubber notifications and ISPS port facilities (docs/IMO_GISIS.md, "Built (dev)").
-- Josh, 2026-09-27: "For our purposes now, assume IMO has given us permission. I don't care about casualty data.
-- Scrubber and facility info is a go." Used on Josh's instruction assuming IMO permission; written permission not yet
-- obtained; the IMO Web Accounts policy otherwise forbids republishing.
-- Additive only: two CHECK constraints are widened; every existing row still satisfies them.
-- Code: lib/ships/gisis.js. Rules: src/ships/CLAUDE.md.
--
--   evidence        source_records, exactly as received (CSV rows as column → value objects):
--                     'imo-gisis-scrubbers'        kind marpol6_reg42_imo    all MARPOL Annex VI Reg. 4.2 notification rows
--                                                                            that carry one IMO number (key 'IMO 1234567'),
--                                                  kind marpol6_reg42_row    a row with no usable IMO number (key 'row <sha>')
--                     'imo-gisis-port-facilities'  kind isps_port_facility   one ISPS declared port facility (key = IMO Port
--                                                                            Facility Number, e.g. CAVAN-0022). Personal
--                                                                            contact fields are dropped BEFORE storing.
--   claim           assertions on the Reg. 4.2 entities (new attributes below), evidence class 'registry' (a flag
--                   Administration's notification to IMO), period 'unknown' (the export gives only the submitted date,
--                   kept in detail; no install date is invented).
--   interpretation  entity_links: a Reg. 4.2 entity attaches only to the ONE vessel holding its IMO as a registry-class,
--                   checksum-valid IMO (resolver v1.6, IMO_EXACT); otherwise it stays unresolved.
--                   terminal_links role 'imo_port_facility': which of our Salish terminals an ISPS facility is
--                   (hand crosswalk lib/ships/data/gisis-terminal-crosswalk.json, checked by name + position on import).
--
-- New attributes:
--   scrubber                 a Reg. 4.2 row whose own text says it is an exhaust gas cleaning system (EGCS / scrubber);
--                            value = manufacturer + model as notified; detail.loop = loop types the row's text states.
--   equivalent_compliance    any other Reg. 4.2 row (alternative fuel, thermal waste device, or an "Apparatus" row that
--                            names only a maker and model code): value = manufacturer + model; detail.type_raw.

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_attribute_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_attribute_check CHECK (attribute IN (
  'imo', 'mmsi', 'callsign', 'name', 'flag',
  'vessel_type', 'gear_type', 'length_m', 'width_m', 'tonnage_gt', 'transceiver',
  'registry_owner', 'registered_owner', 'beneficial_owner', 'owner',
  'operator', 'ship_manager', 'technical_manager',
  'commercial_manager', 'bareboat_charterer', 'ism_manager',
  'authorization',
  'vessel_class', 'builder', 'draft_m', 'max_capacity', 'service_entry', 'service_retirement',
  'port_of_registry', 'event', 'instance_of', 'image',
  'official_number', 'hull_id', 'year_built', 'net_tonnage', 'depth_m', 'hull_material',
  'propulsion', 'registration_status', 'certificate', 'radio_licensee', 'uscg_activity',
  'scrubber', 'equivalent_compliance'));

ALTER TABLE {{S}}.terminal_links DROP CONSTRAINT terminal_links_role_check;
ALTER TABLE {{S}}.terminal_links ADD CONSTRAINT terminal_links_role_check CHECK (role IN (
  'dock_record', 'reference', 'osm_site', 'osm_berth_element', 'gem_coal_terminal', 'ct_refinery', 'ct_ship_port',
  'imo_port_facility'   -- an IMO GISIS ISPS port facility (entity_key = IMO Port Facility Number)
));
