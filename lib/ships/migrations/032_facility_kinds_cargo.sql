-- /ships (after 031, SEPA per permit): facility kinds for port-run cargo and passenger terminals (WA rollout to the 33 container / cruise / ro-ro / breakbulk /
-- Columbia River terminals added 2026-10-07; data lib/ships/data/salish-facilities.json). Additive only: one CHECK constraint is
-- widened; every existing row still satisfies it.

ALTER TABLE {{S}}.facilities DROP CONSTRAINT facilities_kind_check;
ALTER TABLE {{S}}.facilities ADD CONSTRAINT facilities_kind_check CHECK (kind IN (
  'refinery', 'logistics_terminal', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock', 'military_fuel_pier',
  'lng_terminal', 'lpg_terminal', 'coal_terminal', 'chemical_terminal', 'grain_terminal', 'dry_bulk_terminal', 'cement_terminal',
  'scrap_metal_terminal', 'forest_products_terminal', 'other_bulk_terminal',
  'container_terminal', 'cruise_terminal', 'roro_terminal', 'general_cargo_terminal'));
