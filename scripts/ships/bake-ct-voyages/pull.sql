-- Climate TRACE shipping_voyages, Salish Sea, every start date from Jan 2024 on (.github/workflows/ct-voyages-bake.yml).
-- Same slice as the hand pulls (bake.mjs header) without the 2025 end, so each release's newest months come in.
-- The table is partitioned by YEAR of start_date: each run scans every year since 2024 (~35 GB in Oct 2026); the workflow caps it.
SELECT start_date, end_date, asset_identifier, asset_name, type, iso3_country, ST_ASTEXT(location) AS wkt, capacity, capacity_factor,
  activity, CO2_emissions, CH4_emissions, N2O_emissions, SOX_emissions, NOX_emissions, VOCS_emissions, PM2_5_emissions,
  PM10_emissions, CO_emissions, total_CO2e_100yrGWP, total_CO2e_20yrGWP, other1, other2, other3, other4, other5, other6, other7,
  other8, other9, other10, other11, other12, original_inventory_sector, model_number
FROM `trace-data-383422.climate_trace.shipping_voyages`
WHERE start_date >= '2024-01-01'
  AND ST_INTERSECTS(location, ST_GEOGFROMTEXT('POLYGON((-124.85 47.0, -122.05 47.0, -122.05 49.75, -124.85 49.75, -124.85 47.0))'))
