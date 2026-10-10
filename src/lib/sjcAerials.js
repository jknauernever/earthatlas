// San Juan County's own 2025 orthophotos (EagleView), shared by every map that shows them (/hpa docks, /ships).
// Rendered on demand by the county's ArcGIS export endpoint (no tile cache; ~0.6 s/tile, tested 2026-10-06). From z10
// they replace Mapbox satellite inside the county: no sun-glint "confetti" on the water, and docks and piers stay crisp.
// Outside the county and below z10 the map's own imagery shows.
export const SJC_AERIALS_2025 = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer'
export const SJC_AERIALS_MINZOOM = 10

export const sjcAerialsSource = {
  type: 'raster',
  tiles: [`${SJC_AERIALS_2025}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&transparent=false&f=image`],
  tileSize: 256,
  bounds: [-123.25, 48.4, -122.7, 48.81],
  minzoom: SJC_AERIALS_MINZOOM,
  maxzoom: 21,
  attribution: '<a href="' + SJC_AERIALS_2025 + '" target="_blank" rel="noopener">2025 aerials: San Juan County / EagleView</a>',
}

/**
 * Lay the county aerials over a satellite style's photo layer, under its roads and labels (call on every style.load).
 * Does nothing on styles without a raster photo layer (dark / light / streets basemaps).
 */
export function addSjcAerials(map) {
  const layers = map.getStyle()?.layers || []
  const photo = layers.findIndex((l) => l.type === 'raster')
  if (photo < 0) return false
  if (!map.getSource('sjc-aerials')) map.addSource('sjc-aerials', sjcAerialsSource)
  if (!map.getLayer('sjc-aerials')) map.addLayer({ id: 'sjc-aerials', type: 'raster', source: 'sjc-aerials', minzoom: SJC_AERIALS_MINZOOM }, layers[photo + 1]?.id)
  return true
}
