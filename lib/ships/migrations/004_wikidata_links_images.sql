-- /ships: Josh's decisions of 2026-09-25 on Wikidata (docs/WIKIDATA_SHIPS.md).
-- Widening only; no existing row can violate the new checks.
--
-- 1. Wikidata items attached through an AIS-class IMO record WHICH second
--    identifier corroborated it, as distinct link methods, so the UI can say
--    how strong the match is:
--      IMO_AIS_MMSI      AIS IMO + the same MMSI            (strongest of the three)
--      IMO_AIS_CALLSIGN  AIS IMO + the same call sign (no MMSI agreement)
--      IMO_AIS_NAME      AIS IMO + the same name only       (weakest; kept, flagged)
--    A registry IMO stays IMO_EXACT.
-- 2. New attribute 'image': a Wikidata P18 image (Wikimedia Commons file),
--    stored only when the file's own licence allows reuse with attribution.

ALTER TABLE {{S}}.entity_links DROP CONSTRAINT entity_links_method_check;
ALTER TABLE {{S}}.entity_links ADD CONSTRAINT entity_links_method_check CHECK (method IN (
  'NEW_FROM_SOURCE_ENTITY', 'IMO_EXACT', 'MMSI_TEMPORAL',
  'REGISTRY_LINK', 'CALLSIGN_MATCH', 'NAME_FLAG_MATCH',
  'NAME_DIMENSION_MATCH', 'TRAJECTORY_CONTINUITY', 'MANUAL_REVIEW',
  'IMO_AIS_MMSI', 'IMO_AIS_CALLSIGN', 'IMO_AIS_NAME'));

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_attribute_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_attribute_check CHECK (attribute IN (
  'imo', 'mmsi', 'callsign', 'name', 'flag',
  'vessel_type', 'gear_type', 'length_m', 'width_m', 'tonnage_gt', 'transceiver',
  'registry_owner', 'registered_owner', 'beneficial_owner', 'owner',
  'operator', 'ship_manager', 'technical_manager',
  'commercial_manager', 'bareboat_charterer', 'ism_manager',
  'authorization',
  'vessel_class', 'builder', 'draft_m', 'max_capacity', 'service_entry', 'service_retirement',
  'port_of_registry', 'event', 'instance_of', 'image'));
