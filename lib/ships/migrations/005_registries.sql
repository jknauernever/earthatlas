-- /ships: official government vessel registries as identity + characteristics sources
-- (USCG PSIX, FCC ULS ship licences, Transport Canada Vessel Registry).
-- Widening only; no existing row can violate the new checks.
-- Design + justification: docs/VESSEL_REGISTRIES.md.
--
-- New attributes (every one keeps the source's own field name / code in detail):
--   official_number     a registry's own vessel number (USCG official number, Transport
--                       Canada official number, or what an FCC licence files as "official
--                       number of ship"); detail.scheme says which numbering it is.
--   hull_id             hull identification number (HIN) / builder's hull number.
--   year_built          construction completed / year of build (value_norm = YYYY).
--   net_tonnage         net tonnage (unit in detail).
--   depth_m             moulded depth, metres.
--   hull_material       construction material (+ construction type in detail).
--   propulsion          engine / propulsion type / method / power, as the registry states it.
--   registration_status the registry's status for the vessel or licence (Active, REGISTERED,
--                       Expired…), as of the record.
--   certificate         a certificate the registry lists (Certificate of Documentation, of
--                       Inspection, of Registry…), with its issue → expiry as the validity.
--   radio_licensee      the FCC ship-station licensee. NOT an owner role: never inferred as
--                       registered/beneficial owner (src/ships/CLAUDE.md, Relationships).
--                       Private individuals' names are never stored (detail.display = false).
--   uscg_activity       one USCG MISLE activity listed by PSIX (inspection, exam, control),
--                       observed at its start time.
--
-- New link methods (registry entities attach to existing vessels only; they never create one):
--   REG_MMSI_CALLSIGN_NAME  licence MMSI (overlapping time) + call sign + name all agree.
--   REG_MMSI_REGNO_NAME     licence MMSI (overlapping time) + name agree, and the vessel's AIS
--                           call-sign field carries the licence's registration number cut to
--                           AIS's 7 characters (owners of state-registered boats do this).
--   REG_CALLSIGN_NAME       registry call sign + name agree (source has no MMSI).
--   OFFICIAL_NUMBER_NAME    the same US official number is already on exactly one vessel
--                           through another registry, and the names agree.

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
  'propulsion', 'registration_status', 'certificate', 'radio_licensee', 'uscg_activity'));

ALTER TABLE {{S}}.entity_links DROP CONSTRAINT entity_links_method_check;
ALTER TABLE {{S}}.entity_links ADD CONSTRAINT entity_links_method_check CHECK (method IN (
  'NEW_FROM_SOURCE_ENTITY', 'IMO_EXACT', 'MMSI_TEMPORAL',
  'REGISTRY_LINK', 'CALLSIGN_MATCH', 'NAME_FLAG_MATCH',
  'NAME_DIMENSION_MATCH', 'TRAJECTORY_CONTINUITY', 'MANUAL_REVIEW',
  'IMO_AIS_MMSI', 'IMO_AIS_CALLSIGN', 'IMO_AIS_NAME',
  'REG_MMSI_CALLSIGN_NAME', 'REG_MMSI_REGNO_NAME', 'REG_CALLSIGN_NAME', 'OFFICIAL_NUMBER_NAME'));
-- (Call-sign / official-number lookups use the existing assertions_lookup_idx (attribute, value_norm).)
