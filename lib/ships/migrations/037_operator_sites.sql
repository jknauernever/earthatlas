-- /ships: boats as their operators describe them on their own websites (Josh 2026-10-19, /ship-intake).
-- Widening only; no existing row can violate the new checks.
-- Code: lib/ships/operatorSite.js (mapping), scripts/ships/intake.mjs (review + apply), .claude/skills/ship-intake/.
--
-- 1. New evidence class 'operator_published': what the boat's own operator says about it on its website (specs, history,
--    photos). Not a registry, not AIS, not independently checked. Kept apart from every other class in the UI.
-- 2. New attributes: 'description' (the operator's own description of the boat, as published) and 'speed_kn' (cruising
--    speed as the operator states it, text, e.g. "18-21").
-- 3. One source per operator website (id 'operator-site-<host>'), entity kind 'operator_site_boat' keyed
--    '<page url>#<boat name>'. These entities are linked to a vessel only by a reviewed decision (MANUAL_REVIEW,
--    decided_by 'manual:ship-intake'); the resolver never links or creates from them.

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_evidence_class_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_evidence_class_check CHECK (evidence_class IN (
  'registry', 'derived_identity', 'ais_self_reported', 'ais_published', 'community_curated',
  'inferred', 'unverified',
  'verified_report',
  'operator_published'));

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
  'scrubber', 'equivalent_compliance',
  'emissions_report',
  'description', 'speed_kn'));
