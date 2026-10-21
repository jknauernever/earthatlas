-- /ships: Washington Ecology Advance Notice of Transfer (ANT) records, from a public records release (Josh 2026-10-20; the
-- "Planned vs. observed bunkering" report). Additive only: one new table, nothing existing is altered.
-- Code: lib/ships/ecologyAnt.js (parse, store, group into operations), scripts/ships/import-ecology-ant.mjs.
--
-- Evidence: each notice (AntID: one operation, one row per product) is one source_records row (source 'wa-ecology-ant',
-- entity kind 'ant_notice', key = AntID) holding the release's rows for it exactly as received, so every value shown links to
-- its own notice. ecology_ant_rows = those rows, typed for queries. Times: StartDateTime is Pacific local time as Ecology
-- records it (an Excel serial in the release); start_at = that local time converted to UTC, start_local keeps it as written.
-- Contacts (ContactName, ContactPhone) are part of the public records release and are kept (Josh 2026-10-20).

CREATE TABLE {{S}}.ecology_ant_rows (
  id                   bigserial PRIMARY KEY,
  release_id           text NOT NULL,                 -- e.g. 'ant-2026-08-24' (the release file)
  row_no               integer NOT NULL,              -- 1-based data row in the release sheet
  ant_id               text NOT NULL,
  company              text,
  start_local          text NOT NULL,                 -- 'YYYY-MM-DDTHH:MM' Pacific local, as recorded
  start_at             timestamptz NOT NULL,          -- the same instant in UTC
  duration_h           real,                          -- planned hours, as notified
  deliverer            text,                          -- usually the tank barge
  receiver             text,
  location             text,                          -- Ecology's location name, e.g. 'Anchor - PORT ANGELES'
  street_address       text,
  lat                  double precision,
  lon                  double precision,
  city                 text,
  region               text,
  product              text,
  gallons              double precision,
  transfer_type        text,                          -- Fueling | Cargo | Lightering | Vacuum | Other (incl Lube/Hyd Oil)
  is_preboomed         boolean,
  rate_gt500           boolean,                       -- IsTransferRateGT500
  contact_name         text,
  contact_phone        text,
  deliverer_type       text,
  receiver_type        text,
  remarks              text,
  source_id            text NOT NULL DEFAULT 'wa-ecology-ant' REFERENCES {{S}}.sources(id),
  source_record_id     bigint NOT NULL REFERENCES {{S}}.source_records(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, row_no)
);
CREATE INDEX ecology_ant_rows_ant_idx ON {{S}}.ecology_ant_rows (ant_id);
CREATE INDEX ecology_ant_rows_loc_idx ON {{S}}.ecology_ant_rows (location, start_at);
CREATE INDEX ecology_ant_rows_receiver_idx ON {{S}}.ecology_ant_rows (receiver, start_at);
