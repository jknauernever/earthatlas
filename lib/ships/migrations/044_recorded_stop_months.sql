-- /ships: stop counts from recorded live AIS (Josh 2026-11-11). Terminal calls and anchorage stays for the months NOAA
-- MarineCadastre hasn't published yet, counted with the SAME rules from the live recorder's days (aisstream.io, Open Waters AIS,
-- WSF; scripts/ships/aisstream) and from Open Waters' track archive (scripts/ships/aisstream/owarchive.mjs). Additive only.
-- Code: lib/ships/recordedStops.js. A month NOAA later publishes replaces the recorded rows (the month import deletes and
-- re-inserts that month) and leaves recorded_months.
--
--   recorded_months         months (also listed in `months`) whose rows were counted from recorded live AIS, not NOAA
--   recorded_not_covered    terminal keys the recorder's box doesn't cover (Grays Harbor, lower Columbia): in recorded months
--                           those terminals are "not covered", never 0
--   recorded_record_id      the latest recorded bake record (source earthatlas-*-recorded); bake_record_id stays NOAA's
-- Each recorded row carries source_id earthatlas-terminal-calls-recorded / earthatlas-anchorage-stays-recorded and its own
-- bake_record_id, so every count can name where it came from.

ALTER TABLE {{S}}.terminal_call_bakes
  ADD COLUMN recorded_months      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN recorded_not_covered text[] NOT NULL DEFAULT '{}',
  ADD COLUMN recorded_record_id   bigint REFERENCES {{S}}.source_records(id);

ALTER TABLE {{S}}.anchorage_stay_bakes
  ADD COLUMN recorded_months      text[] NOT NULL DEFAULT '{}',
  ADD COLUMN recorded_record_id   bigint REFERENCES {{S}}.source_records(id);
