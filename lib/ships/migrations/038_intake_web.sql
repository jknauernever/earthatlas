-- /ships web intake (earthatlas.org/ships/intake; Josh 2026-10-19, option A). Additive only: two new tables.
-- Code: lib/ships/intakeWeb.js (read page, Claude extraction, jobs), lib/ships/intakeMatch.js (candidates),
-- lib/ships/intakeApply.js (write), scripts/ships/import-fcc-lookup.mjs (fills fcc_ship_lookup).
--
--   fcc_ship_lookup  a SEARCH INDEX over the FCC ULS weekly ship-licence file, so the site can find a boat's licences by
--                    name the way scripts/ships/intake.mjs does from the local file. Only licences that carry an MMSI
--                    (the reason to look one up). Not evidence: nothing here is shown or linked as a claim; a licence
--                    picked during review is imported through the normal FCC path. Licensee names only for
--                    organisations (lib/ships/registry.js partyPrivacy storeName); a person's name is never stored.
--                    Replaced whole by each load (dataset_version = the file's own creation stamp).
--   intake_jobs      one row per page read on the intake page: the URL, the extracted boats (the same document as
--                    lib/ships/data/intake/*.json), the review, the decisions, and what was applied. Never deleted.

CREATE TABLE IF NOT EXISTS {{S}}.fcc_ship_lookup (
  usi             text PRIMARY KEY,
  callsign        text,
  ship_name       text NOT NULL,
  name_norm       text NOT NULL,
  mmsi            text NOT NULL CHECK (mmsi ~ '^\d{9}$'),
  length_m        numeric,
  status          text,
  service         text,
  licensee_org    text,
  licensee_place  text,
  dataset_version text NOT NULL,
  loaded_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fcc_ship_lookup_name ON {{S}}.fcc_ship_lookup (name_norm);
CREATE INDEX IF NOT EXISTS fcc_ship_lookup_mmsi ON {{S}}.fcc_ship_lookup (mmsi);

CREATE TABLE IF NOT EXISTS {{S}}.intake_jobs (
  id          bigserial PRIMARY KEY,
  url         text NOT NULL CHECK (url ~ '^https?://'),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied', 'discarded')),
  intake      jsonb NOT NULL,              -- page + operator + boats (+ each boat's match decision once made)
  review      jsonb,                       -- candidates and signals per boat (lib/ships/intakeMatch.js)
  notes       jsonb NOT NULL DEFAULT '{}', -- per boat: "dig deeper" answers, extraction warnings
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  applied_at  timestamptz,
  applied_by  text,
  result      jsonb                        -- what the apply wrote (records, links)
);
CREATE INDEX IF NOT EXISTS intake_jobs_recent ON {{S}}.intake_jobs (created_at DESC);
