-- /ships: state aquatic land use authorizations (WA DNR) and county shoreline permits at a terminal's dock. DEV 2026-10-07;
-- sources docs/DNR_LEASES.md and docs/PERMITS_SOURCES.md (Counties); code lib/ships/dnrLeases.js, lib/ships/countyShoreline.js;
-- hand-checked data lib/ships/data/wa-leases-sites.json. Additive only: one new table.
--
--   evidence        source_records:
--                     'wa-dnr-aquatic-uses'    kind dnr_use_authorization  (one DNR use-authorization point, as the public map service returns it)
--                                              kind dnr_port_management    (one DNR port management agreement area polygon)
--                     'wa-ecology-sepa-register' (existing) the SEPA Register record that names a county shoreline permit
--                     'whatcom-county-pds'     kind county_notice      (a county notice of application read from the SEPA Register)
--   claim           the source's own fields, unchanged, inside those payloads
--   interpretation  terminal_land_records (below): which records are about this terminal's dock, and why (hand-checked)

CREATE TABLE {{S}}.terminal_land_records (
  id                        bigserial PRIMARY KEY,
  terminal_id               bigint NOT NULL REFERENCES {{S}}.terminals(id),
  kind                      text NOT NULL CHECK (kind IN ('dnr_use_authorization', 'dnr_port_management', 'county_shoreline_permit')),
  record_key                text NOT NULL,                     -- DNR lease jacket number (e.g. '20-A09122') or county file number ('SHR2020-00002')
  source_record_id          bigint NOT NULL REFERENCES {{S}}.source_records(id),   -- the main evidence record
  detail                    jsonb NOT NULL DEFAULT '{}',       -- the normalized fields shown + why (the hand-checked reason) + evidence record ids
  status                    text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'withdrawn')),
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terminal_id, kind, record_key)
);
CREATE INDEX terminal_land_records_terminal ON {{S}}.terminal_land_records (terminal_id) WHERE status = 'accepted';
