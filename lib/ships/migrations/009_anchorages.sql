-- /ships Phase 3 step 3: OFFICIAL ANCHORAGE AREAS ("At anchor · <anchorage>" on port-visit stops).
-- Additive only: one new table, nothing existing is altered. No PostGIS: geometry is GeoJSON (jsonb) and
-- point-in-polygon runs in JS (lib/ships/anchorages.js) after a bounding-box prefilter in SQL.
-- Source facts: docs/ANCHORAGE_AREAS_SOURCES.md (studied 2026-09-27). Josh's decisions 2026-09-27:
--   non-designated Puget Sound anchorages from the withdrawn 2017 proposal, clearly labelled; a "near (≤ 500 m)"
--   state; regions amended since the MarineCadastre layer flagged "older boundary" (not rebuilt); no OSM;
--   Canadian DFO points stored as circles of their swing radius, marked as built by us.
--
--   evidence        source_records: each MarineCadastre feature, DFO feature, proposed-rule paragraph and the
--                   eCFR Part 110 version list, exactly as received. Sources + licences: lib/ships/anchorages.js.
--   claim           anchorages: one row per version of one source feature (name, type, citation as the source
--                   gives them; geometry as given, or built by us from the source's own centre + radius / text)
--   interpretation  NOT stored: which anchorage a port-visit stop lies in / near is decided at read time, so
--                   the GFW evidence (port_visits) is never touched and a better boundary changes the answer.

CREATE TABLE {{S}}.anchorages (
  id                bigserial PRIMARY KEY,
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  source_key        text NOT NULL,                 -- MarineCadastre objectid / DFO OBJECTID / proposed-rule paragraph
  content_sha256    text NOT NULL,                 -- hash of the mapped fields below (a changed feature = a new version)
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'withdrawn')),
                    -- superseded = the source changed this feature; withdrawn = a later complete import no longer
                    -- had it. Never deleted.
  name              text NOT NULL,                 -- as the source gives it (whitespace tidied; raw stays in the record)
  kind              text,                          -- the source's type as given (MarineCadastre anchorageType), else NULL
  legal_status      text NOT NULL CHECK (legal_status IN ('designated', 'non_designated', 'active_listed')),
                    -- designated     = 33 CFR (MarineCadastre layer)
                    -- non_designated = USCG VTS working anchorage, boundary only in a WITHDRAWN proposed rule
                    -- active_listed  = DFO's list of active commercial anchorages (Canada: no regulation found)
  no_anchoring      boolean NOT NULL DEFAULT false, -- a CFR "non-anchorage area" / safety or security zone: never "at anchor"
  citation          text,                          -- e.g. '33 CFR 110.230(a)(9)'; '… as proposed in 82 FR 10313 (withdrawn)'
  location          text,                          -- the source's location text, e.g. 'Puget Sound, WA'
  iso3              text,
  geometry          jsonb,                         -- GeoJSON Polygon / MultiPolygon, lon/lat; NULL = named reference only
  built_from        text NOT NULL CHECK (built_from IN ('polygon', 'circle_from_centre_radius', 'proposed_rule_text', 'not_built')),
  min_lat           double precision,              -- bounding box of geometry (prefilter)
  max_lat           double precision,
  min_lon           double precision,
  max_lon           double precision,
  boundary_note     text,                          -- e.g. 'older boundary: layer dated 2023-10; 33 CFR 110.228 amended since …'
  detail            jsonb NOT NULL DEFAULT '{}',   -- radius, paragraph, alternate name, amendment evidence record, …
  source_record_id  bigint NOT NULL REFERENCES {{S}}.source_records(id),
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, source_key, content_sha256)
);
CREATE UNIQUE INDEX anchorages_one_active ON {{S}}.anchorages (source_id, source_key) WHERE status = 'active';
CREATE INDEX anchorages_bbox_idx ON {{S}}.anchorages (min_lat, max_lat, min_lon, max_lon) WHERE status = 'active' AND geometry IS NOT NULL;
