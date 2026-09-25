-- /ships Phase 2: MarineCadastre AIS identity claims.
-- Widening only; no existing row can violate the new checks.
--
-- New evidence class 'ais_published': AIS static data as published by an
-- authority that may have corrected it. NOAA overwrites null or "clearly
-- incorrect" name/IMO/call sign/type/dimensions with the USCG AIS Vessel
-- Identification Database and doesn't mark which values it changed
-- (docs/MARINECADASTRE_AIS.md). That is neither pure 'ais_self_reported' nor
-- a registry record.
--
-- New attributes: width_m, transceiver (AIS Class A / B).

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_evidence_class_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_evidence_class_check CHECK (evidence_class IN (
  'registry', 'derived_identity', 'ais_self_reported', 'ais_published', 'inferred', 'unverified'));

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_attribute_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_attribute_check CHECK (attribute IN (
  'imo', 'mmsi', 'callsign', 'name', 'flag',
  'vessel_type', 'gear_type', 'length_m', 'width_m', 'tonnage_gt', 'transceiver',
  'registry_owner', 'registered_owner', 'beneficial_owner',
  'operator', 'ship_manager', 'technical_manager',
  'commercial_manager', 'bareboat_charterer', 'ism_manager',
  'authorization'));

-- Resolver v1.1 looks up other vessels' call signs and names by MMSI.
CREATE INDEX IF NOT EXISTS assertions_sub_record_idx ON {{S}}.assertions (sub_record_ref);
