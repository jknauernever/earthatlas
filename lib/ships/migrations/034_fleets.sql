-- /ships fleets (Josh 2026-10-17): named groups of EarthAtlas vessels that a subsite shows, starting with /whalewatch
-- (the Pacific Whale Watch Association members' boats, docs/WHALE_WATCH_FLEET.md). Additive only: two new tables.
--
--   fleets          one row per fleet (key 'whalewatch')
--   fleet_members   EarthAtlas's interpretation "this vessel belongs to this fleet", with the evidence it rests on:
--                   basis      how the boat was tied to the company
--                                fcc_licensee         the company holds the boat's FCC ship radio licence
--                                tc_registered_owner  Transport Canada lists the company as registered owner
--                                operator_website     the company (or its association) names the boat on its own site
--                                manual               added by hand; the note says why
--                   source_*   the record that shows it (every membership carries its own clickable source)
--                   mmsi       the MMSI the membership was made from (a lookup aid only: tracks follow the vessel's own
--                              MMSI periods, so a reassigned MMSI never pulls in another boat)
--                   Never deleted: a boat leaving the fleet gets removed_at + removed_reason, so the history stays.

CREATE TABLE IF NOT EXISTS {{S}}.fleets (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_-]{1,40}$'),
  name        text NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS {{S}}.fleet_members (
  id             bigserial PRIMARY KEY,
  fleet_key      text NOT NULL REFERENCES {{S}}.fleets(key),
  vessel_id      uuid NOT NULL REFERENCES {{S}}.vessels(id),
  mmsi           text CHECK (mmsi IS NULL OR mmsi ~ '^\d{9}$'),
  company        text NOT NULL,
  company_place  text,
  country        text CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  basis          text NOT NULL CHECK (basis IN ('fcc_licensee', 'tc_registered_owner', 'operator_website', 'manual')),
  source_label   text NOT NULL,
  source_url     text NOT NULL CHECK (source_url ~ '^https?://'),
  note           text,
  added_at       timestamptz NOT NULL DEFAULT now(),
  added_by       text NOT NULL,
  removed_at     timestamptz,
  removed_reason text,
  CHECK ((removed_at IS NULL) = (removed_reason IS NULL))
);

-- One current membership per vessel and fleet; removed rows stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS fleet_members_current ON {{S}}.fleet_members (fleet_key, vessel_id) WHERE removed_at IS NULL;
