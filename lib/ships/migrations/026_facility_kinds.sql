-- /ships: facilities beyond refineries (WA rollout, Josh 2026-10-06: Kinder Morgan Harbor Island, Port Angeles). Additive only:
-- the kind CHECK is widened to the terminal kinds; every existing row still satisfies it. Numbered 026 because 025 is
-- reserved by the GFW activity-estimates work (not yet shipped); the two touch different tables.

ALTER TABLE {{S}}.facilities DROP CONSTRAINT facilities_kind_check;
ALTER TABLE {{S}}.facilities ADD CONSTRAINT facilities_kind_check CHECK (kind IN (
  'refinery', 'logistics_terminal', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock', 'military_fuel_pier',
  'lng_terminal', 'lpg_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal', 'dry_bulk_terminal', 'cement_terminal',
  'scrap_metal_terminal', 'forest_products_terminal', 'other_bulk_terminal'));
