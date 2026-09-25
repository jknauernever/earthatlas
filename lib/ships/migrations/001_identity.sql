-- /ships Phase 1: vessel identity + provenance.
-- {{S}} is replaced with the target schema by scripts/ships/migrate.mjs
-- ("ships" in real databases, a throwaway "ships_t_*" schema in tests).
-- Rules behind this design: src/ships/CLAUDE.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Every external source, with its licence terms as data (licensing is functional).
CREATE TABLE {{S}}.sources (
  id                  text PRIMARY KEY,              -- e.g. 'gfw-vessel-identity'
  name                text NOT NULL,
  publisher           text NOT NULL,
  homepage_url        text,
  license             text NOT NULL,                 -- e.g. 'CC BY-NC 4.0'
  license_url         text,
  commercial_use      boolean NOT NULL,              -- false = non-commercial only
  attribution_text    text NOT NULL,
  attribution_url     text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- One row per import invocation: parameters and diagnostics.
CREATE TABLE {{S}}.import_runs (
  id                  bigserial PRIMARY KEY,
  source_id           text NOT NULL REFERENCES {{S}}.sources(id),
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  status              text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'succeeded', 'failed')),
  params              jsonb NOT NULL DEFAULT '{}',
  dataset_version     text,
  stats               jsonb NOT NULL DEFAULT '{}',
  error               text
);

-- The thing a source describes (for GFW: one vessel entry, keyed by its anchor id).
CREATE TABLE {{S}}.source_entities (
  id                  bigserial PRIMARY KEY,
  source_id           text NOT NULL REFERENCES {{S}}.sources(id),
  entity_kind         text NOT NULL,                 -- e.g. 'gfw_vessel_entry'
  entity_key          text NOT NULL,                 -- the source's own stable id
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, entity_kind, entity_key)
);

-- Raw evidence exactly as received. Never updated in content, never deleted.
-- A changed payload for the same entity is a new row (new hash).
CREATE TABLE {{S}}.source_records (
  id                  bigserial PRIMARY KEY,
  source_id           text NOT NULL REFERENCES {{S}}.sources(id),
  source_entity_id    bigint NOT NULL REFERENCES {{S}}.source_entities(id),
  payload             jsonb NOT NULL,
  payload_sha256      text NOT NULL,
  dataset_version     text,
  retrieval_url       text,                          -- without credentials
  first_import_run_id bigint REFERENCES {{S}}.import_runs(id),
  last_import_run_id  bigint REFERENCES {{S}}.import_runs(id),
  first_retrieved_at  timestamptz NOT NULL DEFAULT now(),
  last_retrieved_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_entity_id, payload_sha256)
);

-- One claim a source makes about one of its entities.
CREATE TABLE {{S}}.assertions (
  id                  bigserial PRIMARY KEY,
  source_entity_id    bigint NOT NULL REFERENCES {{S}}.source_entities(id),
  attribute           text NOT NULL CHECK (attribute IN (
                        'imo', 'mmsi', 'callsign', 'name', 'flag',
                        'vessel_type', 'gear_type', 'length_m', 'tonnage_gt',
                        'registry_owner', 'registered_owner', 'beneficial_owner',
                        'operator', 'ship_manager', 'technical_manager',
                        'commercial_manager', 'bareboat_charterer', 'ism_manager',
                        'authorization')),
  value_raw           text NOT NULL,                 -- as the source wrote it
  value_norm          text NOT NULL,                 -- deterministic normalization, for matching
  period              tstzrange NOT NULL DEFAULT '(,)',
  period_kind         text NOT NULL CHECK (period_kind IN ('validity', 'observed', 'unknown')),
  evidence_class      text NOT NULL CHECK (evidence_class IN (
                        'registry', 'derived_identity', 'ais_self_reported',
                        'inferred', 'unverified')),
  sub_record_ref      text NOT NULL DEFAULT '',      -- e.g. GFW selfReportedInfo.id / registry vesselInfoReference
  detail              jsonb NOT NULL DEFAULT '{}',   -- source codes, validity checks, owner flag…
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'superseded', 'disputed', 'rejected')),
  first_source_record_id bigint NOT NULL REFERENCES {{S}}.source_records(id),
  last_source_record_id  bigint NOT NULL REFERENCES {{S}}.source_records(id),
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  -- Idempotency: the same claim re-imported updates last_* instead of duplicating.
  CONSTRAINT assertions_claim_uniq UNIQUE
    (source_entity_id, attribute, value_raw, period, period_kind, evidence_class, sub_record_ref)
);
CREATE INDEX assertions_lookup_idx ON {{S}}.assertions (attribute, value_norm);
CREATE INDEX assertions_entity_idx ON {{S}}.assertions (source_entity_id);
CREATE INDEX assertions_name_trgm_idx ON {{S}}.assertions
  USING gin (value_norm gin_trgm_ops) WHERE attribute = 'name';

-- EarthAtlas's vessel entities. The id is ours; nothing external is a key.
CREATE TABLE {{S}}.vessels (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'merged', 'retired')),
  merged_into         uuid REFERENCES {{S}}.vessels(id),
  needs_review        boolean NOT NULL DEFAULT false,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'merged') = (merged_into IS NOT NULL))
);

-- The interpretation layer: which source entity belongs to which vessel.
-- 'accepted' = EarthAtlas's current answer (at most one per entity);
-- 'candidate' = a possible match that was not strong enough to accept.
CREATE TABLE {{S}}.entity_links (
  id                  bigserial PRIMARY KEY,
  source_entity_id    bigint NOT NULL REFERENCES {{S}}.source_entities(id),
  vessel_id           uuid NOT NULL REFERENCES {{S}}.vessels(id),
  status              text NOT NULL CHECK (status IN ('accepted', 'candidate', 'rejected', 'superseded')),
  method              text NOT NULL CHECK (method IN (
                        'NEW_FROM_SOURCE_ENTITY', 'IMO_EXACT', 'MMSI_TEMPORAL',
                        'REGISTRY_LINK', 'CALLSIGN_MATCH', 'NAME_FLAG_MATCH',
                        'NAME_DIMENSION_MATCH', 'TRAJECTORY_CONTINUITY', 'MANUAL_REVIEW')),
  evidence            jsonb NOT NULL DEFAULT '{}',   -- assertion ids + reasoning
  confidence          text CHECK (confidence IN ('high', 'medium', 'low')),  -- manual review only; resolver v1 leaves it null
  decided_by          text NOT NULL,                 -- e.g. 'resolver:v1', 'manual:josh'
  decided_at          timestamptz NOT NULL DEFAULT now(),
  superseded_at       timestamptz
);
CREATE UNIQUE INDEX entity_links_one_accepted ON {{S}}.entity_links (source_entity_id)
  WHERE status = 'accepted';
CREATE UNIQUE INDEX entity_links_candidate_uniq ON {{S}}.entity_links (source_entity_id, vessel_id, method)
  WHERE status = 'candidate';
CREATE INDEX entity_links_vessel_idx ON {{S}}.entity_links (vessel_id) WHERE status = 'accepted';

-- Every active assertion, attributed to the vessel it currently resolves to.
-- Derived purely from evidence + interpretation; nothing is copied.
CREATE VIEW {{S}}.vessel_assertions AS
SELECT l.vessel_id, a.*, se.source_id, se.entity_kind, se.entity_key
FROM {{S}}.assertions a
JOIN {{S}}.source_entities se ON se.id = a.source_entity_id
JOIN {{S}}.entity_links l ON l.source_entity_id = a.source_entity_id AND l.status = 'accepted'
WHERE a.status = 'active';

-- Temporal MMSI resolution: which vessels carried this MMSI at this instant?
-- 0 rows = unresolved, 1 = resolved, >1 = ambiguous (the caller must not pick one).
CREATE FUNCTION {{S}}.vessels_for_mmsi_at(p_mmsi text, p_at timestamptz)
RETURNS TABLE (vessel_id uuid, assertion_id bigint, evidence_class text, period tstzrange)
LANGUAGE sql STABLE AS $$
  SELECT va.vessel_id, va.id, va.evidence_class, va.period
  FROM {{S}}.vessel_assertions va
  WHERE va.attribute = 'mmsi' AND va.value_norm = p_mmsi
    AND va.period_kind <> 'unknown' AND va.period @> p_at
$$;
