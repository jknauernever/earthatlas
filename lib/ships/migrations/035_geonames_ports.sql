-- /ships: marinas and harbors from GeoNames as their own ports (Josh 2026-10-18), for places none of our port lists has
-- (WPI, GFW port clusters, Climate TRACE, DFO small craft harbours): e.g. Lopez Islander Marina in Fisherman Bay.
-- Additive only: one CHECK constraint is widened; every existing row still satisfies it. Code: lib/ships/placeNames.js.
--
--   evidence        source_records of source 'geonames-places', kind geonames_feature (one GeoNames dump row, as published)
--   interpretation  ports of origin 'geonames' (origin_key = geonameid): a GeoNames marina / harbor / landing / ferry terminal /
--                   anchorage / port with no port of ours within 0.5 km and no same-named port within 2 km.

ALTER TABLE {{S}}.ports DROP CONSTRAINT ports_origin_check;
ALTER TABLE {{S}}.ports ADD CONSTRAINT ports_origin_check CHECK (origin IN ('wpi', 'gfw_port_label', 'climate_trace', 'dfo_sch', 'geonames'));
