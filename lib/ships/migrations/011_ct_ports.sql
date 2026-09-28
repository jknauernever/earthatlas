-- /ships: Climate TRACE-only ports on the map (Josh 2026-09-27: "add the Climate TRACE-only locations to the map").
-- Widens the allowed port origins with 'climate_trace': a place Climate TRACE estimates ship emissions for (a port
-- source, lib/ships/climateTrace.js) where none of our map ports lies within 10 km. Nothing existing changes; every
-- current row still satisfies the check. The port's evidence is the Climate TRACE raw record (source 'climate-trace',
-- kind 'ct_port'), linked through name_source_id / name_source_record_id as for World Port Index ports.
ALTER TABLE {{S}}.ports DROP CONSTRAINT ports_origin_check;
ALTER TABLE {{S}}.ports ADD CONSTRAINT ports_origin_check CHECK (origin IN ('wpi', 'gfw_port_label', 'climate_trace'));
