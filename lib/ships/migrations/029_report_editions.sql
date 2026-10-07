-- /ships: frozen editions of a report (docs/SHIPS_SCRUBBER_REPORT.md, Josh 2026-10-07: "live page + frozen editions", so numbers cited
-- to the legislature never change). Additive only: one new table. An edition is the report's full JSON exactly as the live report
-- returned it at creation, plus the parameters used; rows are never updated or deleted (a correction is a new edition).

CREATE TABLE {{S}}.report_editions (
  report        text NOT NULL CHECK (report IN ('scrubbers')),
  id            text NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),   -- e.g. '2026-10'
  title         text,
  params        jsonb NOT NULL,                  -- { from, to }
  payload       jsonb NOT NULL,                  -- the report JSON as returned at creation
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report, id)
);
