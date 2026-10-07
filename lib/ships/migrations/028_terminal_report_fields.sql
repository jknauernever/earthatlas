-- /ships: fields the scrubber-ship calls report needs (docs/SHIPS_SCRUBBER_REPORT.md, Josh 2026-10-07). Additive only: one CHECK
-- constraint is widened and nullable columns are added; every existing row still satisfies them. Numbered 028 because 027 is the
-- BC permits pilot (not yet shipped); the two touch different tables.
--
--   terminals.kind        + 'cruise_terminal', 'container_terminal', 'roro_terminal', 'general_cargo_terminal'
--                           (WA cruise, container, ro-ro and general-cargo berths; Lovel's example is cruise ships at Seattle)
--   terminals.ownership   who owns the dock: 'port_authority' (a public port district / port authority, even when a private company
--                           runs it under lease), 'private', 'government' (state, federal, military) or NULL = not established.
--                           Josh 2026-10-07: the report totals port-authority terminals and private docks separately.
--   terminals.ownership_basis  where the class was read: { source, ref, says } (USACE owner text, or a hand-checked page)
--   terminals.county_* / place_*   the county and the city / town / census-designated place the terminal's display point lies in,
--                           from the US Census Bureau geocoder (TIGER boundaries); place_kind 'incorporated' | 'cdp' | NULL
--                           (unincorporated: no place). admin_source_record_id = the raw geocoder response kept as evidence.

ALTER TABLE {{S}}.terminals DROP CONSTRAINT terminals_kind_check;
ALTER TABLE {{S}}.terminals ADD CONSTRAINT terminals_kind_check CHECK (kind IN (
  'refinery_dock', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock',
  'military_fuel_pier', 'lng_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal',
  'dry_bulk_terminal', 'cement_terminal', 'scrap_metal_terminal', 'forest_products_terminal',
  'other_bulk_terminal', 'lpg_terminal',
  'cruise_terminal', 'container_terminal', 'roro_terminal', 'general_cargo_terminal'));

ALTER TABLE {{S}}.terminals ADD COLUMN ownership text CHECK (ownership IN ('port_authority', 'private', 'government'));
ALTER TABLE {{S}}.terminals ADD COLUMN ownership_basis jsonb;
ALTER TABLE {{S}}.terminals ADD COLUMN state_code text;                 -- 'WA', 'OR', 'BC' (two-letter state / province)
ALTER TABLE {{S}}.terminals ADD COLUMN county_name text;               -- 'King County'
ALTER TABLE {{S}}.terminals ADD COLUMN county_fips text;               -- '53033'
ALTER TABLE {{S}}.terminals ADD COLUMN place_name text;                -- 'Seattle city' as the Census names it
ALTER TABLE {{S}}.terminals ADD COLUMN place_geoid text;               -- '5363000'
ALTER TABLE {{S}}.terminals ADD COLUMN place_kind text CHECK (place_kind IN ('incorporated', 'cdp'));
ALTER TABLE {{S}}.terminals ADD COLUMN admin_source_record_id bigint REFERENCES {{S}}.source_records(id);
