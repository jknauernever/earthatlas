-- /ships: Wikidata as a vessel identity + classification source.
-- Widening only; no existing row can violate the new checks.
-- Design + justification: docs/WIKIDATA_SHIPS.md, docs/SHIP_CLASSIFICATION.md.
--
-- New evidence class 'community_curated': a claim from an openly edited,
-- community-curated knowledge base (Wikidata). Anyone can edit it; values
-- are usually copied from registries, operators' sites or the press, but
-- nothing on the item says which, and nobody vouches for it. It is NOT a
-- registry record, NOT AIS and NOT a model, so it gets its own class.
--
-- New attributes (all from Wikidata; each keeps its property id in detail):
--   owner             P127 "owned by": the source does not say registered vs
--                     beneficial owner, and it is not a registry listing, so it
--                     is neither 'registered_owner' nor 'registry_owner'.
--   vessel_class      P289 "vessel class" (e.g. Signature-class cruise ship).
--   builder           P176 "manufacturer" (shipyard / builder).
--   draft_m           P2262 "draft".
--   max_capacity      P1083 "maximum capacity" (passengers, unless a qualifier says otherwise).
--   service_entry     P729 "service entry".
--   service_retirement P730 "service retirement".
--   port_of_registry  P532 "port of registry".
--   event             P793 "significant event" (launch, naming, sinking, scrapping…).
--   instance_of       P31 values that are NOT kinds of watercraft (e.g. "business",
--                     "shipwreck"-adjacent categories); kinds of watercraft go to vessel_type.

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_evidence_class_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_evidence_class_check CHECK (evidence_class IN (
  'registry', 'derived_identity', 'ais_self_reported', 'ais_published', 'community_curated',
  'inferred', 'unverified'));

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_attribute_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_attribute_check CHECK (attribute IN (
  'imo', 'mmsi', 'callsign', 'name', 'flag',
  'vessel_type', 'gear_type', 'length_m', 'width_m', 'tonnage_gt', 'transceiver',
  'registry_owner', 'registered_owner', 'beneficial_owner', 'owner',
  'operator', 'ship_manager', 'technical_manager',
  'commercial_manager', 'bareboat_charterer', 'ism_manager',
  'authorization',
  'vessel_class', 'builder', 'draft_m', 'max_capacity', 'service_entry', 'service_retirement',
  'port_of_registry', 'event', 'instance_of'));

-- Community-curated MMSIs never resolve an AIS observation: only transmitted
-- or registry MMSIs place a position on a vessel. (No existing row has this
-- class, so the function's results for existing data are unchanged.)
CREATE OR REPLACE FUNCTION {{S}}.vessels_for_mmsi_at(p_mmsi text, p_at timestamptz)
RETURNS TABLE (vessel_id uuid, assertion_id bigint, evidence_class text, period tstzrange)
LANGUAGE sql STABLE AS $$
  SELECT va.vessel_id, va.id, va.evidence_class, va.period
  FROM {{S}}.vessel_assertions va
  WHERE va.attribute = 'mmsi' AND va.value_norm = p_mmsi
    AND va.period_kind <> 'unknown' AND va.period @> p_at
    AND va.evidence_class <> 'community_curated'
$$;
