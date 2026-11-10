-- Site content an admin edits on the map pages (lib/content/siteContent.js, docs/SITE_CONTENT_ADMIN.md).
-- Lives in the users database next to the admin gate and the audit log; every write is audited there.
CREATE SCHEMA IF NOT EXISTS content;

-- One row per left-panel node an admin has changed: a category, a dataset inside one, or a legend class.
-- Anything not here (or a null column) falls back to the site's code defaults.
CREATE TABLE IF NOT EXISTS content.nav_node (
  site        text NOT NULL,          -- 'shoreline'
  node_id     text NOT NULL,          -- 'kelp', 'mods/docks', 'fish/tier-3'
  position    integer,                -- order among its siblings (null = code order)
  name        text,
  info        text,
  style       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- { color, line, fill, pinColor, glyph, autoPhotos }
  min_zoom    real,                   -- Mapbox zoom the layer shows from
  removed_at  timestamptz,
  removed_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (site, node_id)
);

-- Popup images. record_id null = the default for the whole dataset; set = one record (per-record editing, later).
CREATE TABLE IF NOT EXISTS content.media (
  id          bigserial PRIMARY KEY,
  site        text NOT NULL,
  node_id     text NOT NULL,
  record_id   text,
  url         text NOT NULL,
  width       integer,
  height      integer,
  caption     text NOT NULL,
  credit      text NOT NULL,
  credit_href text,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  removed_at  timestamptz,
  removed_by  text
);
CREATE INDEX IF NOT EXISTS media_site_idx ON content.media (site, node_id, record_id, position);
