-- /ships: anchorage aliases + anchorage stays counted from EarthAtlas's own AIS positions (Josh 2026-09-30). Additive only:
-- three new tables, nothing existing is altered. Code: lib/ships/anchorageAliases.js (alias rule), lib/ships/anchorageStays.js
-- (stay rule + store + read), scripts/ships/bake-ais/anchorage_stays.py (stopped positions inside an anchorage polygon),
-- scripts/ships/anchorage-stays.mjs (polygons out, stays in, aliases). Rules: src/ships/CLAUDE.md.
--
-- An anchorage is identified by (source_id, source_key) — the anchorages row id changes when the source changes a feature
-- (009 keeps every version), so aliases and stays hang off the source's own key and are joined to the ACTIVE version at read.
--
--   anchorage_aliases   "also known as" names. Each alias carries the source that uses the name and the record it was read
--                       from, plus the EarthAtlas method that tied it to this anchorage (e.g. a Global Fishing Watch anchorage
--                       point named X lies inside the polygon). status accepted = shown as "also known as"; candidate = found
--                       by the rule but not clear enough (kept for review, never shown as a name); rejected / superseded kept.
--   anchorage_stays     derived: one row per stay = a ship reporting speed over ground < 0.5 kn inside the anchorage polygon
--                       for >= 60 min, a gap > 6 h starting a new stay (anchorageStays.js STAY_RULE). Evidence class
--                       'inferred'. ais_* columns = what the ship broadcast during the stay (AIS self-reported). Rows belong to
--                       one bake_version; a re-import of that version replaces its rows.
--   anchorage_stay_bakes one row per imported bake: months fully read, which anchorages the AIS box covers (the rest are
--                       "not covered", never 0), the rule.
--   bake record         source_records row (source 'earthatlas-anchorage-stays', entity kind 'anchorage_stay_bake'): rule,
--                       every anchorage used (key, name, whether covered), the days read. Each stay links to it.
--   interpretation      read time only: which EarthAtlas ship held the MMSI at t0 (vessels_for_mmsi_at) and its kind.

CREATE TABLE {{S}}.anchorage_aliases (
  id                    bigserial PRIMARY KEY,
  anchorage_source_id   text NOT NULL REFERENCES {{S}}.sources(id),
  anchorage_source_key  text NOT NULL,
  alias                 text NOT NULL,                 -- the name as that source writes it
  alias_norm            text NOT NULL,                 -- normalized (normalize.js style: A-Z0-9 only) for dedupe
  source_id             text NOT NULL REFERENCES {{S}}.sources(id),   -- who uses this name
  source_record_id      bigint REFERENCES {{S}}.source_records(id),   -- where it was read (clickable)
  status                text NOT NULL DEFAULT 'candidate' CHECK (status IN ('accepted', 'candidate', 'rejected', 'superseded')),
  method                text NOT NULL,                 -- e.g. gfw_anchorage_name_inside, gfw_port_label_name_near, earthatlas_place_hint
  distance_m            real,                          -- 0 = inside the polygon; else metres to its edge
  detail                jsonb NOT NULL DEFAULT '{}',   -- GFW label / cell, position, why accepted or not
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (anchorage_source_id, anchorage_source_key, alias_norm, source_id, method)
);
CREATE INDEX anchorage_aliases_anchorage_idx ON {{S}}.anchorage_aliases (anchorage_source_id, anchorage_source_key, status);

CREATE TABLE {{S}}.anchorage_stays (
  id                    bigserial PRIMARY KEY,
  bake_version          text NOT NULL,
  anchorage_id          bigint NOT NULL REFERENCES {{S}}.anchorages(id),   -- the version whose polygon the bake used
  anchorage_source_id   text NOT NULL,
  anchorage_source_key  text NOT NULL,
  mmsi                  text NOT NULL CHECK (mmsi ~ '^\d{1,9}$'),
  t0                    timestamptz NOT NULL,          -- first stopped position inside (UTC, as MarineCadastre publishes)
  t1                    timestamptz NOT NULL,          -- last stopped position inside
  n_points              integer NOT NULL,
  also_in               text[],                        -- other anchorages (source_id|source_key) that also contained some positions
  ambiguous_points      integer NOT NULL DEFAULT 0,
  ais_name              text,                          -- AIS reported (most frequent during the stay)
  ais_imo               text,                          -- AIS reported
  ais_vessel_type       integer,                       -- AIS reported ship-and-cargo type code
  ais_length            real,                          -- AIS reported, metres
  evidence_class        text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id             text NOT NULL DEFAULT 'earthatlas-anchorage-stays' REFERENCES {{S}}.sources(id),
  bake_record_id        bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 >= t0),
  UNIQUE (bake_version, anchorage_source_id, anchorage_source_key, mmsi, t0)
);
CREATE INDEX anchorage_stays_anchorage_idx ON {{S}}.anchorage_stays (anchorage_source_id, anchorage_source_key, bake_version, t0);
CREATE INDEX anchorage_stays_mmsi_idx ON {{S}}.anchorage_stays (mmsi, t0);

CREATE TABLE {{S}}.anchorage_stay_bakes (
  bake_version      text PRIMARY KEY,
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  months            text[] NOT NULL,                 -- 'YYYY-MM' months with every day's points read
  covered           text[] NOT NULL DEFAULT '{}',    -- anchorages (source_id|source_key) whose polygon lies inside the AIS box
  rule              jsonb NOT NULL,
  imported_at       timestamptz NOT NULL DEFAULT now()
);
