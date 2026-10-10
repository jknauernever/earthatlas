// Local government aerial photos laid over Mapbox satellite where they exist, shared by every map that shows them
// (/sanjuan-docks, /ships). They replace Mapbox's sun-glint "confetti" on the water between islands and keep docks and
// piers crisp (Josh 2026-10-10). Outside each one's area, and when zoomed out, the map's own imagery shows.
//
// Each layer is switched on only while the view overlaps its area, so its credit shows in the map credits exactly when
// its photos are in use (Mapbox credits every source whose layer is on, wherever the view is).

// San Juan County 2025 orthophotos (EagleView). The county's ArcGIS export endpoint renders each tile (~0.6 s, no cache).
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

// ArcGIS ImageServers in UTM render Web Mercator tiles on request; jpgpng sends PNG (transparent) where the photos end.
const imageServer = (url) => `${url}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image`

const VAN_2022 = 'https://tiles.arcgis.com/tiles/qrcTTRTwUoS8N47o/arcgis/rest/services/Orthophotos_2022/MapServer'
const NANAIMO_2026 = 'https://nanmap.nanaimo.ca/arcgis/rest/services/Orthos/Ortho_2026/ImageServer'

// Drawn in this order (later on top). Islands Trust 2021 (Gulf Islands) was tried and dropped (Josh 2026-10-10): its photo
// blocks stair-step across the water and carry their own sun glare.
export const LOCAL_AERIALS = [
  { id: 'sjc-aerials', source: sjcAerialsSource },
  { id: 'nanaimo-aerials', source: {
    type: 'raster', tiles: [imageServer(NANAIMO_2026)], tileSize: 256, bounds: [-124.0718, 49.0944, -123.7945, 49.2518], minzoom: 11, maxzoom: 21,
    attribution: '<a href="https://nanaimo.ca/your-government/maps-data/open-data-catalogue/open-data-catalogue-licence" target="_blank" rel="noopener">2026 aerials: City of Nanaimo (Open Government Licence – Nanaimo)</a>' } },
  { id: 'vancouver-aerials', source: {
    type: 'raster', tiles: [`${VAN_2022}/tile/{z}/{y}/{x}`], tileSize: 256, bounds: [-123.272, 49.1915, -123.0119, 49.3193], minzoom: 11, maxzoom: 21,
    attribution: '<a href="https://opendata.vancouver.ca/explore/dataset/orthophoto-imagery-2022/" target="_blank" rel="noopener">2022 aerials: City of Vancouver (Open Government Licence – Vancouver)</a>' } },
]

const overlaps = (map, [w, s, e, n]) => {
  const b = map.getBounds()
  return b && b.getWest() < e && b.getEast() > w && b.getSouth() < n && b.getNorth() > s
}

const inside = (map, [w, s, e, n]) => {
  const b = map.getBounds()
  return b && b.getWest() >= w && b.getEast() <= e && b.getSouth() >= s && b.getNorth() <= n
}

/**
 * Show each local layer only while the view overlaps its area and is zoomed in far enough, and not when the view lies
 * wholly inside a layer drawn above it (a loose coverage rectangle reaching over a city layer would otherwise be credited
 * where it has no photos).
 */
function syncLocalAerials(map) {
  const z = map.getZoom()
  LOCAL_AERIALS.forEach(({ id, source }, i) => {
    if (!map.getLayer(id)) return
    const covered = LOCAL_AERIALS.slice(i + 1).some((up) => z >= up.source.minzoom && inside(map, up.source.bounds))
    const on = z >= source.minzoom && overlaps(map, source.bounds) && !covered
    if ((map.getLayoutProperty(id, 'visibility') !== 'none') !== on) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  })
}

/**
 * Lay the local aerials over a satellite style's photo layer, under its roads and labels (call on every style.load).
 * Does nothing on styles without a raster photo layer (dark / light / streets basemaps).
 */
export function addLocalAerials(map) {
  const layers = map.getStyle()?.layers || []
  const photo = layers.findIndex((l) => l.type === 'raster')
  if (photo < 0) return false
  const before = layers[photo + 1]?.id
  for (const { id, source } of LOCAL_AERIALS) {
    if (!map.getSource(id)) map.addSource(id, source)
    if (!map.getLayer(id)) map.addLayer({ id, type: 'raster', source: id, minzoom: source.minzoom, layout: { visibility: 'none' } }, before)
  }
  if (!map.__localAerialsSync) { map.__localAerialsSync = () => syncLocalAerials(map); map.on('moveend', map.__localAerialsSync) }
  syncLocalAerials(map)
  return true
}
