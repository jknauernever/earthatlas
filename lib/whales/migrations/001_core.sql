-- Shared worldwide whale-sightings store (docs/WHALES_DB.md).
--
-- records   : one row per upstream record per feed we read it from (the evidence).
-- sightings : one row per real-world report (canonical key), merged from its records;
--             this is what every earthatlas.org site reads.
-- taxa      : iNaturalist taxonomy (one shared tree for every feed).
-- name_map  : how each feed's own species names resolved to a taxon.

CREATE TABLE {{S}}.taxa (
  inat_id         integer PRIMARY KEY,
  scientific_name text NOT NULL,
  common_name     text,
  rank            text,
  ancestor_ids    integer[] NOT NULL DEFAULT '{}',
  animal_group    text NOT NULL,      -- cetacean | pinniped | sirenian | otter | shark | ray | sea_turtle | other
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE {{S}}.name_map (
  feed        text NOT NULL,
  raw_name    text NOT NULL,          -- feed's name|scientific, lower-cased
  inat_id     integer REFERENCES {{S}}.taxa (inat_id),   -- NULL = not identified
  method      text NOT NULL,          -- feed_taxon | curated | inat_name | unresolved | not_animal
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (feed, raw_name)
);

CREATE TABLE {{S}}.records (
  feed        text NOT NULL,          -- salishsea | maplify | happywhale | inaturalist | obis
  feed_id     text NOT NULL,
  key         text NOT NULL,          -- canonical sighting key, e.g. maplify:262342
  feed_day    date NOT NULL,          -- the day the feed itself files this record under
  norm        jsonb NOT NULL,         -- normalized fields from this feed
  raw         jsonb,                  -- upstream payload (trimmed for iNaturalist)
  hash        text NOT NULL,          -- md5 of norm; unchanged rows skip the rebuild
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  changed_at  timestamptz NOT NULL DEFAULT now(),
  removed_at  timestamptz,            -- the feed stopped returning it
  PRIMARY KEY (feed, feed_id)
);
CREATE INDEX records_key ON {{S}}.records (key);
CREATE INDEX records_feed_day ON {{S}}.records (feed, feed_day);

CREATE TABLE {{S}}.sightings (
  key               text PRIMARY KEY,
  origin            text NOT NULL,    -- maplify | inaturalist | happywhale | obis | salishsea | orcasound
  via               text[] NOT NULL,  -- feeds that carry it
  kind              text NOT NULL,    -- sighting | acoustic
  inat_id           integer REFERENCES {{S}}.taxa (inat_id),
  raw_name          text,             -- the name the origin used
  animal_group      text NOT NULL,    -- from taxa; 'unknown' when not identified
  observed_at       timestamptz,      -- NULL when the source gives only a date
  observed_date     date NOT NULL,
  time_precision    text NOT NULL,    -- exact | day
  lat               double precision NOT NULL,
  lon               double precision NOT NULL,
  geom              geography(Point, 4326) NOT NULL,
  accuracy_m        integer,
  location_obscured boolean NOT NULL DEFAULT false,
  count_min         integer,
  count_max         integer,
  channel           text,             -- the venue it came through, e.g. Orca Network
  organization      text,
  organization_url  text,
  observer          text,
  attribution       text,
  url               text,             -- the original record, when it has a page
  license           text,
  photo_url         text,
  photo_thumb_url   text,
  photo_license     text,
  photo_attribution text,
  individual_id     text,
  individual_label  text,
  remarks           text,
  trusted           boolean,
  quality           text NOT NULL DEFAULT 'ok',   -- ok | null_island | inland | test
  removed_at        timestamptz,      -- every record behind it was removed upstream
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sightings_geom ON {{S}}.sightings USING gist (geom);
CREATE INDEX sightings_date ON {{S}}.sightings (observed_date);
CREATE INDEX sightings_live ON {{S}}.sightings (observed_date, animal_group)
  WHERE removed_at IS NULL AND quality = 'ok';

CREATE TABLE {{S}}.ingest_runs (
  id           bigserial PRIMARY KEY,
  feed         text NOT NULL,
  mode         text NOT NULL,         -- hourly | sweep | backfill | manual
  window_from  date NOT NULL,
  window_to    date NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  fetched      integer,
  inserted     integer,
  changed      integer,
  removed      integer,
  rebuilt      integer,
  ok           boolean,
  note         text
);
CREATE INDEX ingest_runs_feed ON {{S}}.ingest_runs (feed, started_at DESC);
