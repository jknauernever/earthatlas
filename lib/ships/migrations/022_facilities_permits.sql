-- /ships: FACILITIES (the plant / site a terminal serves) + their PERMITS and SEPA REVIEWS. Two-refinery pilot approved by
-- Josh 2026-10-06 (BP Cherry Point, Marathon Anacortes); study + rules in docs/PERMITS_SOURCES.md. Additive only.
-- Rules: src/ships/CLAUDE.md (evidence / claim / interpretation; never destroy evidence).
--
--   evidence        source_records:
--                     'epa-echo'                    kind echo_dfr        (one ECHO Detailed Facility Report, whole JSON, per FRS id)
--                     'wa-ecology-sepa-register'    kind sepa_record     (one SEPA Register record page, parsed to fields)
--                     'earthatlas-facilities'       kind facility_entry  (the hand-reviewed entry from lib/ships/data/salish-facilities.json)
--   claim           facilities (EarthAtlas's curated list); permits (one row per program id as ECHO lists it under an FRS id)
--   interpretation  facility_links (which EPA FRS records / Climate TRACE sources / SEPA records belong to a facility, and why);
--                   terminal_facilities (which terminal serves which facility). Candidate links are kept but never shown.

CREATE TABLE {{S}}.facilities (
  id                        bigserial PRIMARY KEY,
  key                       text NOT NULL UNIQUE,              -- stable id from the data file, e.g. 'wa-bp-cherry-point-refinery'
  name                      text NOT NULL,
  kind                      text NOT NULL CHECK (kind IN ('refinery')),
  country                   text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  admin_area                text,                              -- county / regional district as the entry states it
  lat                       double precision,
  lon                       double precision,
  list_status               text NOT NULL DEFAULT 'listed' CHECK (list_status IN ('listed', 'withdrawn')),
  entry_source_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  detail                    jsonb NOT NULL DEFAULT '{}',       -- notes, names the facility has been known by (with sources)
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE {{S}}.terminal_facilities (
  id                        bigserial PRIMARY KEY,
  terminal_id               bigint NOT NULL REFERENCES {{S}}.terminals(id),
  facility_id               bigint NOT NULL REFERENCES {{S}}.facilities(id),
  relation                  text NOT NULL CHECK (relation IN ('serves')),   -- the terminal is the facility's marine dock
  entry_source_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  status                    text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (terminal_id, facility_id, relation)
);

-- Which source records belong to a facility, in what role, and on what basis.
CREATE TABLE {{S}}.facility_links (
  id                        bigserial PRIMARY KEY,
  facility_id               bigint NOT NULL REFERENCES {{S}}.facilities(id),
  role                      text NOT NULL CHECK (role IN (
                              'epa_frs_primary',       -- the EPA FRS id that is the facility itself
                              'epa_frs_related',       -- another FRS id for the same site (a project, an old name, a program fragment)
                              'ct_refinery',           -- Climate TRACE oil-and-gas-refining source
                              'sepa_review')),         -- a WA Ecology SEPA Register record about this facility
  source_id                 text NOT NULL REFERENCES {{S}}.sources(id),
  entity_key                text NOT NULL,                     -- FRS id / Climate TRACE id / SEPA number
  source_record_id          bigint REFERENCES {{S}}.source_records(id),
  status                    text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'candidate', 'retired')),
  method                    text NOT NULL,                     -- 'curated' (named in the data file) | 'sepa_applicant_place' | ...
  detail                    jsonb NOT NULL DEFAULT '{}',       -- why: the matched words, the search that found it
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, role, source_id, entity_key)
);
CREATE INDEX facility_links_key_idx ON {{S}}.facility_links (source_id, entity_key);

-- One permit / program record as ECHO lists it (DFR "Permits" section). Keyed by (EPA system, source id), because the same
-- program id can sit under several FRS ids; frs_ids lists every DFR it was seen in. Values are ECHO's, unchanged.
CREATE TABLE {{S}}.permits (
  id                        bigserial PRIMARY KEY,
  epa_system                text NOT NULL,                     -- 'ICIS-NPDES', 'ICIS-Air', 'RCRAInfo', 'GHGRP', 'RMP', 'TRI', ...
  permit_key                text NOT NULL,                     -- ECHO SourceID, e.g. 'WA0022900'
  statute                   text,                              -- 'CWA', 'CAA', 'RCRA', 'EP313', ... ('' for FRS / ICIS rows)
  name                      text,                              -- facility / permit name as the program lists it
  universe                  text,                              -- e.g. 'Major: NPDES Individual Permit'
  areas                     text,                              -- e.g. 'Construction Stormwater' or 'CAAMACT, CAAPSD, CAATVP'
  expires                   date,                              -- CWA only (ECHO ExpDate)
  program_status            text,                              -- ECHO FacilityStatus, e.g. 'Effective', 'Terminated; Compliance Tracking Off'
  frs_ids                   text[] NOT NULL DEFAULT '{}',
  source_record_id          bigint NOT NULL REFERENCES {{S}}.source_records(id),   -- newest DFR it was read from
  first_seen_at             timestamptz NOT NULL DEFAULT now(),
  last_seen_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (epa_system, permit_key)
);
