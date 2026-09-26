-- /ships: vessel INCIDENTS (casualties, pollution, operational controls, PSC deficiencies).
-- Additive only: three new tables, nothing existing is altered.
-- Design + sources: docs/SHIP_INCIDENT_SOURCES.md (study §0–12, import §13).
-- Rules: src/ships/CLAUDE.md (evidence / claim / interpretation; never destroy evidence).
--
-- Layers, same as identity:
--   evidence        source_records (raw payload exactly as received, SHA-256 versioned)
--   claim           incident_events (what the source says happened) +
--                   incident_vessel_refs (how the source names each vessel involved)
--   interpretation  incident_links (which EarthAtlas vessel a vessel ref is: accepted | candidate)
-- Incident data is never written onto a vessel as an attribute.

-- One row per version of one source event. A re-import with the same content only touches
-- last_*; changed content inserts a new row and marks the previous one 'superseded'.
CREATE TABLE {{S}}.incident_events (
  id                  bigserial PRIMARY KEY,
  source_id           text NOT NULL REFERENCES {{S}}.sources(id),
  source_entity_id    bigint NOT NULL REFERENCES {{S}}.source_entities(id),
  source_event_key    text NOT NULL,                 -- IIR/PSIX ActivityId, TSB OccNo, ERTS number, …
  content_sha256      text NOT NULL,                 -- hash of the mapped fields below
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'superseded', 'disputed', 'rejected')),
  event_kinds         text[] NOT NULL,               -- casualty | pollution | operational_control | psc_deficiency | injury | …
  event_types         text[] NOT NULL DEFAULT '{}',  -- normalized: grounding | fire | sinking | flooding | spill | …
  event_type_raw      text,                          -- the source's own wording (e.g. 'Aground', 'Pollution - Oil')
  title               text,                          -- the source's own title, only where display-safe (detail.title_display)
  occurred            tstzrange NOT NULL DEFAULT '(,)',
  period_kind         text NOT NULL CHECK (period_kind IN ('validity', 'observed', 'unknown')),
  time_raw            text,                          -- the timestamp exactly as the source wrote it
  time_quality        text,                          -- e.g. 'utc_mislabelled_offset', 'local_zone_stated', 'date_only'
  lat                 double precision,
  lon                 double precision,
  location_text       text,
  position_quality    text,                          -- e.g. 'source_point', 'approximate', 'rejected_out_of_region'
  severity_raw        text,                          -- e.g. 'Significant Marine Casualty', 'CLASS 3'
  severity_rank       smallint,                      -- 0 none … 3 major (per-source mapping in lib/ships/incidents.js)
  deaths              integer,                       -- COUNTS only; never names
  injuries            integer,
  missing             integer,
  material            text,
  quantity            numeric,
  quantity_unit       text,
  quantity_to_water   numeric,
  narrative           text,                          -- raw narrative: NOT for display (may name people)
  report_url          text,                          -- the official page to link to
  report_ref          text,                          -- how to find it there (e.g. 'IIR activity 7669720')
  evidence_class      text NOT NULL CHECK (evidence_class IN (
                        'official_investigation', 'official_record', 'initial_report', 'state_record', 'news_summary')),
  detail              jsonb NOT NULL DEFAULT '{}',   -- display flags, source codes, caveats
  first_source_record_id bigint NOT NULL REFERENCES {{S}}.source_records(id),
  last_source_record_id  bigint NOT NULL REFERENCES {{S}}.source_records(id),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_event_key, content_sha256)
);
CREATE UNIQUE INDEX incident_events_one_active ON {{S}}.incident_events (source_id, source_event_key)
  WHERE status = 'active';
CREATE INDEX incident_events_occurred_idx ON {{S}}.incident_events USING gist (occurred);

-- How the source names each vessel in an event (evidence; the source's identifiers, verbatim).
CREATE TABLE {{S}}.incident_vessel_refs (
  id                  bigserial PRIMARY KEY,
  incident_event_id   bigint NOT NULL REFERENCES {{S}}.incident_events(id),
  ref_key             text NOT NULL,                 -- the source's key for this vessel within the event
  role_raw            text,                          -- e.g. 'Subject of Search and Rescue', 'Involved in a Marine Casualty'
  role                text NOT NULL DEFAULT 'involved'
                        CHECK (role IN ('involved', 'subject', 'responsible', 'reported', 'assisting', 'other')),
  name_raw            text,
  imo_raw             text,
  mmsi_raw            text,
  callsign_raw        text,
  official_number_raw text,
  official_number_scheme text,                       -- us_official_number | ca_official_number | …
  uscg_vessel_id      text,                          -- MISLE / PSIX VesselId
  flag_raw            text,
  vessel_type_raw     text,
  detail              jsonb NOT NULL DEFAULT '{}',
  UNIQUE (incident_event_id, ref_key)
);
CREATE INDEX incident_vessel_refs_event_idx ON {{S}}.incident_vessel_refs (incident_event_id);

-- Interpretation: which EarthAtlas vessel a vessel ref is. Like entity_links:
-- at most one 'accepted' per ref; 'candidate' = possible, not strong enough (never shown on the card).
CREATE TABLE {{S}}.incident_links (
  id                  bigserial PRIMARY KEY,
  vessel_ref_id       bigint NOT NULL REFERENCES {{S}}.incident_vessel_refs(id),
  vessel_id           uuid NOT NULL REFERENCES {{S}}.vessels(id),
  status              text NOT NULL CHECK (status IN ('accepted', 'candidate', 'rejected', 'superseded')),
  method              text NOT NULL CHECK (method IN (
                        'USCG_VESSEL_ID', 'IMO_EXACT', 'IMO_AIS_NAME', 'OFFICIAL_NUMBER_NAME', 'MMSI_NAME',
                        'IMO_AMBIGUOUS', 'OFFICIAL_NUMBER', 'MMSI_TEMPORAL', 'CALLSIGN_NAME', 'NAME_DATE_PLACE',
                        'MANUAL_REVIEW')),
  evidence            jsonb NOT NULL DEFAULT '{}',
  decided_by          text NOT NULL,                 -- e.g. 'incidents:v1', 'manual:josh'
  decided_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz
);
CREATE UNIQUE INDEX incident_links_one_accepted ON {{S}}.incident_links (vessel_ref_id) WHERE status = 'accepted';
CREATE UNIQUE INDEX incident_links_candidate_uniq ON {{S}}.incident_links (vessel_ref_id, vessel_id, method)
  WHERE status = 'candidate';
CREATE INDEX incident_links_vessel_idx ON {{S}}.incident_links (vessel_id, status);
