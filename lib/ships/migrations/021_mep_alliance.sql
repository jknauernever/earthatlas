-- /ships: MEP Alliance scrubber lists (mepalliance.org). Permission via Friends of the San Juans (MEP Alliance founding
-- member), 2026-09-30 (Josh). Code: lib/ships/mepAlliance.js, lib/ships/mepMatch.js, resolve.js v1.9 (decideMep).
-- Rules: src/ships/CLAUDE.md. Additive only: one CHECK constraint is widened; every existing row still satisfies it.
--
--   evidence        source_records, the list rows exactly as published (column → text + the row's HTML), grouped per ship:
--                     'mep-alliance-voyages'       kind mep_voyage_ship   key 'NAME <normalized name>' (no IMO in this list)
--                     'mep-alliance-fitted-ships'  kind mep_fitted_imo    key 'IMO 1234567'
--                                                  kind mep_fitted_name   key 'NAME <norm> · <list>' (a row without a usable IMO)
--                   Contact details stay in the record only; the API strips them before showing a record.
--   claim           'scrubber' assertions (existing attribute), evidence class 'unverified': an advocacy group's list of
--                   reported facts, never a registry fact or a flag Administration's notification. Period 'unknown'.
--   interpretation  entity_links, with the method that tied the list row to the vessel:
--
-- New link methods:
--   MEP_NAME_CORROBORATED  the list's ship name matches exactly one of our vessels AND a second fact agrees (the list's
--                          owner / charterer / controller shares a distinctive word with the vessel's owner, operator or
--                          manager claims, or the list's build year equals the vessel's).
--   MEP_NAME_SALISH_SIZE   Josh, 2026-09-30: the name matches exactly one of our BIG ships (>= 100 m, or a big-ship type when
--                          no length is known) that is KNOWN IN THE SALISH SEA (our Salish AIS tracks or terminal /
--                          anchorage stays). Accepted, but marked INFERRED everywhere it is shown.
--   MEP_NAME_ONLY          candidate only: the name matches, but not uniquely or not strongly enough to accept.

ALTER TABLE {{S}}.entity_links DROP CONSTRAINT entity_links_method_check;
ALTER TABLE {{S}}.entity_links ADD CONSTRAINT entity_links_method_check CHECK (method IN (
  'NEW_FROM_SOURCE_ENTITY', 'IMO_EXACT', 'MMSI_TEMPORAL',
  'REGISTRY_LINK', 'CALLSIGN_MATCH', 'NAME_FLAG_MATCH',
  'NAME_DIMENSION_MATCH', 'TRAJECTORY_CONTINUITY', 'MANUAL_REVIEW',
  'IMO_AIS_MMSI', 'IMO_AIS_CALLSIGN', 'IMO_AIS_NAME',
  'REG_MMSI_CALLSIGN_NAME', 'REG_MMSI_REGNO_NAME', 'REG_CALLSIGN_NAME', 'OFFICIAL_NUMBER_NAME',
  'MEP_NAME_CORROBORATED', 'MEP_NAME_SALISH_SIZE', 'MEP_NAME_ONLY'));
