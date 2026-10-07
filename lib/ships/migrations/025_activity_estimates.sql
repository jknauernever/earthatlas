-- /ships: terminal calls and anchorage stays ESTIMATED from Global Fishing Watch hourly positions, for months and terminals
-- NOAA's per-minute AIS doesn't cover (Josh 2026-10-06; docs/SHIPS_ACTIVITY_FUSION.md Part 2, accuracy check
-- docs/SHIPS_ACTIVITY_CHECK_2026-06.md). Additive only: three new tables, kept apart from the NOAA-counted terminal_calls /
-- anchorage_stays so the two kinds of evidence never mix.
-- Code: scripts/ships/bake-gfw/activity.py (stops), lib/ships/activityEstimates.js (store + read), api/ships.js op=importActivity.
--
--   evidence        GFW 4Wings hourly presence rows (CC BY-NC 4.0), fetched by the GFW track bake; never stored in Postgres
--   derived         one row per stop = a ship's consecutive hourly positions within ~2 cells (≈1 h at under ~1.2 kn) near a
--                   berth (within 0.65 km) or inside an anchorage polygon. Evidence class 'inferred'.
--                   A terminal stop keeps its CANDIDATES: the nearest berth's terminal plus every terminal with a berth within
--                   1 km of it (hourly 0.01° positions can't tell neighbours apart). Which one it counts at is decided at read
--                   time by the ship's kind (the terminal cards' rule), never stored.
--   bake record     source_records row per (bake_version, month) holding the rule and inputs; each row links to it.

CREATE TABLE {{S}}.terminal_call_estimates (
  id                bigserial PRIMARY KEY,
  bake_version      text NOT NULL,
  month             text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  candidates        text[] NOT NULL,                 -- terminal keys the stop may belong to (nearest first)
  nearest_terminal  text NOT NULL,
  min_km            real NOT NULL,                   -- closest hourly cell centre to a berth point, km
  mmsi              text CHECK (mmsi ~ '^\d{1,9}$'),
  gfw_vessel_id     text NOT NULL,
  gfw_name          text,                            -- as broadcast (AIS, as GFW serves it)
  gfw_type          text,                            -- GFW's vessel type (no tanker type in presence rows)
  t0                timestamptz NOT NULL,            -- first hour
  t1                timestamptz NOT NULL,            -- last hour + 1 h
  n_hours           integer NOT NULL,
  evidence_class    text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id         text NOT NULL DEFAULT 'earthatlas-terminal-calls-gfw' REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 > t0),
  UNIQUE (bake_version, gfw_vessel_id, nearest_terminal, t0)
);
CREATE INDEX terminal_call_estimates_cand_idx ON {{S}}.terminal_call_estimates USING gin (candidates);
CREATE INDEX terminal_call_estimates_month_idx ON {{S}}.terminal_call_estimates (bake_version, month);

CREATE TABLE {{S}}.anchorage_stay_estimates (
  id                bigserial PRIMARY KEY,
  bake_version      text NOT NULL,
  month             text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  -- An anchorage is identified by (source_id, source_key), as in anchorage_stays (020): its row id changes when the source edits it.
  anchorage_source_id   text NOT NULL,
  anchorage_source_key  text NOT NULL,
  mmsi              text CHECK (mmsi ~ '^\d{1,9}$'),
  gfw_vessel_id     text NOT NULL,
  gfw_name          text,
  gfw_type          text,
  t0                timestamptz NOT NULL,
  t1                timestamptz NOT NULL,
  n_hours           integer NOT NULL,
  evidence_class    text NOT NULL DEFAULT 'inferred' CHECK (evidence_class = 'inferred'),
  source_id         text NOT NULL DEFAULT 'earthatlas-anchorage-stays-gfw' REFERENCES {{S}}.sources(id),
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (t1 > t0),
  UNIQUE (bake_version, gfw_vessel_id, anchorage_source_id, anchorage_source_key, t0)
);
CREATE INDEX anchorage_stay_estimates_idx ON {{S}}.anchorage_stay_estimates (anchorage_source_id, anchorage_source_key, bake_version, t0);

-- One row per imported (bake_version, kind, month): a month is replaced whole on re-import (the daily run re-fetches recent days).
CREATE TABLE {{S}}.activity_estimate_bakes (
  bake_version      text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('terminal', 'anchorage')),
  month             text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  through           date,                            -- last day of GFW data in the month (a current month is partial)
  rows              integer NOT NULL,
  rule              jsonb NOT NULL,
  bake_record_id    bigint NOT NULL REFERENCES {{S}}.source_records(id),
  imported_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bake_version, kind, month)
);
