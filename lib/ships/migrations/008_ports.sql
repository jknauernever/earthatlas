-- /ships Phase 3 step 2: PORTS REFERENCE (names for GFW port visits).
-- Additive only: three new tables + the foreign key that 007 reserved for port_visits.port_id.
-- Source facts: docs/PORTS_SOURCES.md (verified live 2026-09-26). Rules: src/ships/CLAUDE.md.
-- Naming rule (Josh, 2026-09-26): World Port Index name first, then GFW's label.
--
--   evidence        source_records: one per WPI port ('nga-wpi'), UN/LOCODE row ('unece-unlocode'),
--                   GFW anchorage override row ('gfw-anchorage-overrides'), GeoNames country ('geonames-countries'),
--                   exactly as received. Sources + licences are registered by lib/ships/ports.js.
--   claim           ports of origin 'wpi', countries, and aliases that restate a source's own keys
--   interpretation  aliases of kind gfw_port_label / gfw_anchorage_s2 (method + distance + candidates),
--                   ports of origin 'gfw_port_label' (a GFW port with no WPI match), port_visits.port_id

-- ISO 3166 codes and one English name per country (GeoNames countryInfo.txt).
CREATE TABLE {{S}}.countries (
  iso2              text PRIMARY KEY CHECK (iso2 ~ '^[A-Z]{2}$'),
  iso3              text NOT NULL UNIQUE CHECK (iso3 ~ '^[A-Z]{3}$'),
  iso_numeric       text,
  name              text NOT NULL,
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  source_record_id  bigint REFERENCES {{S}}.source_records(id),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- EarthAtlas's own ports. origin 'wpi' = one WPI port (origin_key = WPI port number);
-- origin 'gfw_port_label' = a GFW port label that matched no WPI port (origin_key = the label).
CREATE TABLE {{S}}.ports (
  id                    bigserial PRIMARY KEY,
  origin                text NOT NULL CHECK (origin IN ('wpi', 'gfw_port_label')),
  origin_key            text NOT NULL,
  name                  text,                          -- preferred name; NULL = unnamed (the card shows the raw GFW label)
  name_source_id        text REFERENCES {{S}}.sources(id),
  name_field            text,                          -- which field it came from: WPI portName / overrides label / GFW anchorage name
  name_method           text,                          -- wpi_portName | gfw_override_label[_majority] | gfw_event_name | unnamed
  name_source_record_id bigint REFERENCES {{S}}.source_records(id),
  iso2                  text,
  iso3                  text,                          -- country names: join countries (one place to fix a name)
  lat                   double precision,
  lon                   double precision,
  harbor_size           text,                          -- WPI only: L / M / S / V
  harbor_type           text,                          -- WPI only
  unlocode              text,                          -- as WPI gives it, e.g. 'US SEA' (the PortWatch / UN/LOCODE join key)
  wpi_number            integer,
  detail                jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin, origin_key)
);
CREATE INDEX ports_latlon_idx ON {{S}}.ports (lat, lon);
CREATE INDEX ports_unlocode_idx ON {{S}}.ports (unlocode) WHERE unlocode IS NOT NULL;

-- Every key by which a source refers to one of our ports.
CREATE TABLE {{S}}.port_aliases (
  id                bigserial PRIMARY KEY,
  port_id           bigint NOT NULL REFERENCES {{S}}.ports(id),
  source_id         text NOT NULL REFERENCES {{S}}.sources(id),
  key_kind          text NOT NULL CHECK (key_kind IN ('wpi_number', 'unlocode', 'gfw_port_label', 'gfw_anchorage_s2')),
  key               text NOT NULL,
  name_raw          text,                              -- the name as that source gives it
  lat               double precision,
  lon               double precision,
  source_record_id  bigint REFERENCES {{S}}.source_records(id),
  status            text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'candidate', 'superseded')),
  method            text,                              -- source_key | wpi_unloCode | wpi_within_4km | wpi_nearest_clear | gfw_override_label | …
  distance_km       double precision,                  -- for WPI matches: nearest anchorage point ↔ WPI position
  detail            jsonb NOT NULL DEFAULT '{}',       -- candidates, notes, UN/LOCODE check
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (port_id, key_kind, key, source_id)
);
CREATE INDEX port_aliases_key_idx ON {{S}}.port_aliases (key_kind, key);
-- A GFW label / anchorage cell is accepted for one port at a time (older decisions stay as 'superseded').
CREATE UNIQUE INDEX port_aliases_one_gfw ON {{S}}.port_aliases (key_kind, key)
  WHERE status = 'accepted' AND key_kind IN ('gfw_port_label', 'gfw_anchorage_s2');

-- The column 007 reserved.
ALTER TABLE {{S}}.port_visits ADD CONSTRAINT port_visits_port_fk FOREIGN KEY (port_id) REFERENCES {{S}}.ports(id);
CREATE INDEX port_visits_port_idx ON {{S}}.port_visits (port_id);
