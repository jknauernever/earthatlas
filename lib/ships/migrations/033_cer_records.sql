-- /ships: Canada Energy Regulator records for the Westridge Marine Terminal (DEV 2026-10-07; lib/ships/cer.js, study
-- docs/PERMITS_SOURCES_BC.md "Canada Energy Regulator (CER): Westridge"). Additive only: one CHECK constraint is widened; every
-- existing row still satisfies it.
--
--   facility_links.role  + 'cer_record'   a CER compliance activity, incident, condition, O&M activity, contamination notice or
--                                         inspection officer order of the facility (entity_key '<kind>:<id>'; the matching rule's
--                                         reason in detail; candidates kept, not shown)

ALTER TABLE {{S}}.facility_links DROP CONSTRAINT facility_links_role_check;
ALTER TABLE {{S}}.facility_links ADD CONSTRAINT facility_links_role_check CHECK (role IN (
  'epa_frs_primary', 'epa_frs_related', 'ct_refinery', 'sepa_review', 'paris_facility',
  'bc_ema_authorization', 'nrced_record', 'eao_project', 'cer_record'));
