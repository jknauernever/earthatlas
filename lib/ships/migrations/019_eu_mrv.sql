-- /ships Phase 4: EU MRV verified annual emissions per ship (EMSA THETIS-MRV). Authorized by Josh 2026-09-29.
-- Facts: docs/SHIP_POLLUTION_SOURCES.md §1. Code: lib/ships/euMrv.js, scripts/ships/import-eu-mrv.mjs. Rules: src/ships/CLAUDE.md.
-- Additive only: two CHECK constraints are widened; every existing row still satisfies them.
--
--   evidence        source_records, exactly as published (cells of the XLSX by column letter, empty cells omitted as in the file):
--                     kind eu_mrv_file        one per published file version (key '2024 v245'): the file's three header rows,
--                                             sha256, generation date. Gives every column letter its published meaning.
--                     kind eu_mrv_ship_year   one per ship and reporting year (key 'IMO 9378448 · 2024'): that ship's row in the
--                                             year's "Full ERs" sheet and each of its "Partial ERs" rows. A new file version
--                                             with changed cells = a new record (hash-versioned); old records are kept.
--   claim           one 'emissions_report' assertion per published row (full year or one partial period), evidence class
--                   'verified_report', period 'validity' = the reporting period the row states. value = total CO₂ in metric
--                   tonnes as published; detail = every mapped figure with its unit, the verifier, the company, the file version.
--   interpretation  entity_links: a ship-year entity attaches only to the ONE vessel holding its IMO as a registry-class,
--                   checksum-valid IMO (resolver v1.8, IMO_EXACT; the IMO GISIS rule). Otherwise it stays unresolved.
--
-- New evidence class:
--   verified_report   a figure the ship's company reported to a public authority under a legal duty, checked by an
--                     accredited third-party verifier, and published by that authority (EU MRV: Reg. (EU) 2015/757). Not a
--                     registry fact and not a model: kept apart from 'registry' and from Climate TRACE's modelled figures.
-- New attribute:
--   emissions_report  one published annual (or partial-period) emissions report for the ship.

ALTER TABLE {{S}}.assertions DROP CONSTRAINT assertions_evidence_class_check;
ALTER TABLE {{S}}.assertions ADD CONSTRAINT assertions_evidence_class_check CHECK (evidence_class IN (
  'registry', 'derived_identity', 'ais_self_reported', 'ais_published', 'community_curated',
  'inferred', 'unverified',
  'verified_report'));

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
  'emissions_report'));
