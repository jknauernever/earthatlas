-- /ships: BC (Canada) permits and enforcement for terminal facilities. Two-terminal DEV pilot (Westridge, Westshore), 2026-10-07;
-- sources docs/PERMITS_SOURCES_BC.md, code lib/ships/bcPermits.js. Additive only: one CHECK constraint is widened; every existing
-- row still satisfies it. Numbered 027 because 025 is reserved by the GFW activity-estimates work and 026 exists.
--
--   evidence        source_records:
--                     'bc-ema-authorizations'  kind ema_authorization  (one row of the BC Data Catalogue all_ams_authorizations.xlsx)
--                     'bc-nrced'               kind nrced_record       (one NRCED record as the NRPTI public search API returns it)
--                     'bc-eao-epic'            kind eao_project        (one BC EAO EPIC project, staff contact fields dropped)
--   claim           permits (epa_system 'BC-EMA', statute 'BC EMA'; values as the register lists them); documents (NRCED files)
--   interpretation  facility_links (below: which authorizations / NRCED records / EAO projects belong to the facility, and why)
--
--   facility_links.role  + 'bc_ema_authorization'   a BC EMA authorization of the facility (hand-checked: place + company; why in detail)
--                        + 'nrced_record'           an NRCED compliance / enforcement record (rule: company + authorization or place)
--                        + 'eao_project'            a BC Environmental Assessment Office project (hand-checked; why in detail)

ALTER TABLE {{S}}.facility_links DROP CONSTRAINT facility_links_role_check;
ALTER TABLE {{S}}.facility_links ADD CONSTRAINT facility_links_role_check CHECK (role IN (
  'epa_frs_primary', 'epa_frs_related', 'ct_refinery', 'sepa_review', 'paris_facility',
  'bc_ema_authorization', 'nrced_record', 'eao_project'));
