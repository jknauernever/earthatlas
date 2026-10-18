// Local government aerial photos laid over Mapbox satellite where they exist, shared by every map that shows them
// (/sanjuan-docks, /ships). They replace Mapbox's sun-glint "confetti" on the water between islands and keep docks and
// piers crisp (Josh 2026-10-10). Outside each one's area, and when zoomed out, the map's own imagery shows.
//
// Each layer is switched on only while the view overlaps its area, so its credit shows in the map credits exactly when
// its photos are in use (Mapbox credits every source whose layer is on, wherever the view is).

// San Juan County 2025 orthophotos (EagleView). The county's ArcGIS export endpoint renders each tile (~0.6 s, no cache).
export const SJC_AERIALS_2025 = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer'
export const SJC_AERIALS_MINZOOM = 9 // tiles exist from here (/sanjuan-docks shows them from z10)
// /ships shows every local aerial from z11 up (Josh 2026-10-10).
export const LOCAL_AERIALS_SHOW_FROM = 11

// Served through /api/aerial-tiles, which turns the county's flat blue-grey fill (#3f6073, painted wherever its photos end;
// the server ignores transparent=true) transparent, so only the photos show over the map below. Shared by both sites.
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
export const sjcAerialsSource = {
  type: 'raster',
  tiles: [`${ORIGIN}/api/aerial-tiles?src=sjc&v=2&z={z}&x={x}&y={y}`],   // v=2: solid-fill rule (2026-10-17); a new address, so no speckled tile is served from cache
  tileSize: 256,
  bounds: [-123.25, 48.4, -122.7, 48.81],
  minzoom: SJC_AERIALS_MINZOOM,
  maxzoom: 21,
  attribution: '<a href="' + SJC_AERIALS_2025 + '" target="_blank" rel="noopener">2025 aerials: San Juan County / EagleView</a>',
}

// ArcGIS ImageServers in UTM render Web Mercator tiles on request; jpgpng sends PNG (transparent) where the photos end.
const imageServer = (url) => `${url}/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image`

const METRO_VAN_2018 = 'https://gis.metrovancouver.org/arcgis/rest/services/Imagery/ORTHO_2018/ImageServer'
const METRO_VAN_IMAGERY = 'https://gis.metrovancouver.org/arcgis/rest/services/Imagery'
// year → [ImageServer, bounds]. The 2009 service is 2009 aerial photos, with 2011 satellite imagery north of the region.
const METRO_VAN_YEARS = {
  2009: [`${METRO_VAN_IMAGERY}/Satellite2011_Ortho2009/ImageServer`, [-123.4611, 48.9867, -121.2606, 50.4251]],
  2016: [`${METRO_VAN_IMAGERY}/ORTHO_2016/ImageServer`, [-123.4407, 48.9943, -122.3848, 49.5513]],
  2018: [METRO_VAN_2018, [-123.4425, 48.9943, -122.3847, 49.5618]],
}

// Each local source with every year its government publisher serves (Josh 2026-10-16: /ships lets you pick the year while
// zoomed into its area; 2026-10-18: include every government-published year, whether or not it is also on an open data
// portal). `year` = the default, drawn on every map that uses this list.
const SJC_SERVICE = (y) => `https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_${y}/MapServer`
// Who made each year's mosaic, from the service's copyright line (Pictometry and EagleView are one company, renamed), except
// 1932, 1990 and 1998: the county repeats that line on every service, but Pictometry dates from 2000 (EagleView 2008), so
// those years are credited to the county alone. 1932 is scanned film, placed only approximately (its layer note).
const SJC_MAKER = { 1932: null, 1990: null, 1998: null, 2004: 'Pictometry', 2006: 'Pictometry', 2008: 'Pictometry',
  2013: 'Pictometry', 2016: 'Pictometry', 2019: 'Pictometry', 2022: 'EagleView', 2023: 'EagleView', 2025: 'EagleView' }
// A short note shown with a year in the picker.
export const YEAR_NOTES = { 'sjc-1932': 'approximate placement' }
const VAN_TILES = 'https://tiles.arcgis.com/tiles/qrcTTRTwUoS8N47o/arcgis/rest/services'
// year → [service name, bounds, open data dataset (Open Government Licence – Vancouver) or null, first zoom].
const VAN_YEARS = {
  1994: ['Orthophotos_1994', [-123.2724, 49.172, -122.9945, 49.3449], null],
  1999: ['Orthophotos_1999', [-123.2323, 49.1996, -123.0233, 49.317], null],
  2002: ['Orthophotos_2002', [-123.275, 49.1729, -123.0123, 49.317], null],
  2004: ['Orthophotos_2004', [-123.2653, 49.1977, -123.0123, 49.317], null],
  2006: ['Orthophotos_2006', [-123.2655, 49.1773, -123.0123, 49.317], true],
  2008: ['Orthophotos_2008', [-123.2655, 49.1773, -123.0123, 49.317], true],
  2009: ['Orthophotos_2009_midApril', [-123.2654, 49.1955, -123.0123, 49.317], true],
  2011: ['Orthophotos_2011', [-123.2653, 49.1955, -123.0123, 49.3168], true],
  2013: ['Orthophotos_2013', [-123.2668, 49.1955, -123.011, 49.317], true],
  2015: ['Orthophotos_2015', [-123.2648, 49.1958, -123.0127, 49.3164], true],
  2016: ['Orthophotos_2016', [-123.2752, 49.1845, -123.0069, 49.3197], null],
  2018: ['Orthophotos_2018', [-123.2655, 49.1953, -123.0123, 49.317], null],
  2020: ['Orthophotos_2020', [-123.2653, 49.1955, -123.0123, 49.317], null],
  2022: ['Orthophotos_2022', [-123.272, 49.1915, -123.0119, 49.3193], true],
  2025: ['Orthophotos_2025', [-123.2757, 49.1978, -123.0068, 49.3201], null, 12],   // its tile cache starts at z12
}
const NANAIMO_ORTHOS = 'https://nanmap.nanaimo.ca/arcgis/rest/services/Orthos'
// year → [service name, bounds, open download (Remote Sensing Downloads list, Open Government Licence – Nanaimo)].
const NANAIMO_YEARS = {
  1996: ['Ortho_1996', [-124.0776, 49.0857, -123.8004, 49.2521], false],
  1999: ['Ortho_1999', [-124.1014, 49.0946, -123.7932, 49.2536], false],
  2003: ['Ortho_2003', [-124.1132, 49.067, -123.8009, 49.2585], false],
  2006: ['Ortho_2006', [-124.1132, 49.067, -123.8001, 49.2585], false],
  2009: ['Ortho_2009', [-124.0857, 49.0943, -123.8082, 49.2584], true],
  2012: ['Ortho_2012', [-124.0857, 49.0673, -123.8078, 49.2584], true],
  2016: ['Ortho_2016', [-124.0718, 49.0944, -123.7945, 49.2518], true],
  2018: ['Ortho_2018', [-124.0718, 49.0944, -123.7945, 49.2518], true],
  2020: ['Ortho_2020', [-124.0718, 49.0944, -123.7945, 49.2518], true],
  2022: ['Ortho_2022', [-124.0718, 49.0944, -123.7945, 49.2518], true],
  2024: ['Ortho_2024_Nan', [-124.0718, 49.0944, -123.7945, 49.2518], true],
  2026: ['Ortho_2026', [-124.0718, 49.0944, -123.7945, 49.2518], true],
}
const NANAIMO_LICENCE = 'https://nanaimo.ca/your-government/maps-data/open-data-catalogue/open-data-catalogue-licence'

// Drawn in this order (later on top). Islands Trust 2021 (Gulf Islands) was tried and dropped (Josh 2026-10-10): its photo
// blocks stair-step across the water and carry their own sun glare.
export const LOCAL_AERIALS = [
  { key: 'sjc', id: 'sjc-aerials', name: 'San Juan County', year: 2025, years: Object.keys(SJC_MAKER).map(Number),
    // Every year goes through /api/aerial-tiles, which clears the county's fill (2025 keeps its original, cached URL).
    sourceFor: (y) => (y === 2025 ? sjcAerialsSource : { ...sjcAerialsSource,
      tiles: [`${ORIGIN}/api/aerial-tiles?src=sjc&yr=${y}&v=2&z={z}&x={x}&y={y}`],
      attribution: `<a href="${SJC_SERVICE(y)}${y === 1932 ? '/0' : ''}" target="_blank" rel="noopener">${y} aerials: San Juan County${SJC_MAKER[y] ? ` / ${SJC_MAKER[y]}` : ''}</a>` }) },
  // Metro Vancouver (GVRD) 2018, 7.5 cm, the whole region incl. the Fraser delta. Its licence allows use "in publications,
  // reports, and the like provided that the GVRD is acknowledged as the source" (item info, linked in the credit); added on
  // Josh's decision 2026-10-10. Below the City of Vancouver's photos.
  { key: 'metrovan', id: 'metrovan-aerials', name: 'Metro Vancouver', year: 2018, years: [2009, 2016, 2018],
    sourceFor: (y) => {
      const [url, bounds] = METRO_VAN_YEARS[y]
      return { type: 'raster', tiles: [imageServer(url)], tileSize: 256, bounds, minzoom: 11, maxzoom: 21,
        attribution: `<a href="${url}${y === 2018 ? '/info/iteminfo' : ''}" target="_blank" rel="noopener">${y} aerials: Metro Vancouver (GVRD)</a>` }
    } },
  { key: 'nanaimo', id: 'nanaimo-aerials', name: 'City of Nanaimo', year: 2026, years: Object.keys(NANAIMO_YEARS).map(Number),
    sourceFor: (y) => ({
      type: 'raster', tiles: [imageServer(`${NANAIMO_ORTHOS}/${NANAIMO_YEARS[y][0]}/ImageServer`)], tileSize: 256, bounds: NANAIMO_YEARS[y][1], minzoom: 11, maxzoom: 21,
      attribution: NANAIMO_YEARS[y][2]
        ? `<a href="${NANAIMO_LICENCE}" target="_blank" rel="noopener">${y} aerials: City of Nanaimo (Open Government Licence – Nanaimo)</a>`
        : `<a href="${NANAIMO_ORTHOS}/${NANAIMO_YEARS[y][0]}/ImageServer" target="_blank" rel="noopener">${y} aerials: City of Nanaimo</a>` }) },
  { key: 'vancouver', id: 'vancouver-aerials', name: 'City of Vancouver', year: 2025, years: Object.keys(VAN_YEARS).map(Number),
    sourceFor: (y) => ({
      type: 'raster', tiles: [`${VAN_TILES}/${VAN_YEARS[y][0]}/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, bounds: VAN_YEARS[y][1],
      minzoom: VAN_YEARS[y][3] || 11, maxzoom: 21, // its own tile cache is used from z11 (2025: z12)
      attribution: VAN_YEARS[y][2]
        ? `<a href="https://opendata.vancouver.ca/explore/dataset/orthophoto-imagery-${y}/" target="_blank" rel="noopener">${y} aerials: City of Vancouver (Open Government Licence – Vancouver)</a>`
        : `<a href="${VAN_TILES}/${VAN_YEARS[y][0]}/MapServer" target="_blank" rel="noopener">${y} aerials: City of Vancouver</a>` }) },
]

// Imagery under the local aerials (Josh 2026-10-16), above the satellite style's own Mapbox photos. 'mapbox' = none.
const EOX_YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]
export const BASE_IMAGERY = [
  { id: 'mapbox', label: 'Mapbox satellite', year: null, href: 'https://www.mapbox.com/about/maps/' },
  { id: 'usgs', label: 'USGS aerial photos (US only)', year: null, source: {
    type: 'raster', tiles: ['https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'], tileSize: 256,
    maxzoom: 16, attribution: '<a href="https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer" target="_blank" rel="noopener">Aerial photos: USGS The National Map (USDA NAIP)</a>' } },
  ...EOX_YEARS.map((y) => ({ id: `s2-${y}`, label: `Sentinel-2 cloudless ${y}`, year: y, source: {
    type: 'raster', tiles: [`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${y}_3857/default/g/{z}/{y}/{x}.jpg`],
    tileSize: 256, maxzoom: 14,
    attribution: `<a href="https://cloudless.eox.at" target="_blank" rel="noopener">EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${y})</a>` } })),
]
const BASE_LAYER = 'base-imagery'
// What 'best' draws when zoomed out (setBaseImagery).
export const BEST_BASE = 's2-2025'

const overlaps = (map, [w, s, e, n]) => {
  const b = map.getBounds()
  return b && b.getWest() < e && b.getEast() > w && b.getSouth() < n && b.getNorth() > s
}

const inside = (map, [w, s, e, n]) => {
  const b = map.getBounds()
  return b && b.getWest() >= w && b.getEast() <= e && b.getSouth() >= s && b.getNorth() <= n
}

const ours = (id) => id === 'base-imagery' || LOCAL_AERIALS.some((a) => id === a.id || id.startsWith(`${a.id}-`))
/** The satellite style's photo layer and the style's own layer just above it (ours skipped), or null on other styles. */
function photoSlot(map) {
  const layers = map.getStyle()?.layers || []
  const photo = layers.findIndex((l) => l.type === 'raster' && !ours(l.id))
  if (photo < 0) return null
  return { before: layers.slice(photo + 1).find((l) => !ours(l.id))?.id }
}

/** The layer drawn for a source in the chosen year ('off' = none). The default year keeps the source's own id. */
const layerIdFor = (a, year) => (year === a.year ? a.id : `${a.id}-${year}`)
const yearFor = (a, choice) => {
  const y = choice?.[a.key]
  return y === 'off' ? 'off' : a.years.includes(y) ? y : a.year
}

/**
 * Show each local layer only while the view overlaps its area and is zoomed in far enough, and not when the view lies
 * wholly inside a layer drawn above it (a loose coverage rectangle reaching over a city layer would otherwise be credited
 * where it has no photos).
 */
function syncLocalAerials(map) {
  const z = map.getZoom()
  const drawn = LOCAL_AERIALS.map((a) => {
    const y = yearFor(a, map.__localAerialChoice)
    return y === 'off' ? null : { id: layerIdFor(a, y), source: a.sourceFor(y) }
  })
  const from = (src) => Math.max(LOCAL_AERIALS_SHOW_FROM, src.minzoom)
  drawn.forEach((d, i) => {
    if (!d || !map.getLayer(d.id)) return
    const covered = drawn.slice(i + 1).some((up) => up && z >= from(up.source) && inside(map, up.source.bounds))
    const on = z >= from(d.source) && overlaps(map, d.source.bounds) && !covered
    if ((map.getLayoutProperty(d.id, 'visibility') !== 'none') !== on) map.setLayoutProperty(d.id, 'visibility', on ? 'visible' : 'none')
  })
}

/**
 * Lay the local aerials over a satellite style's photo layer, under its roads and labels (call on every style.load).
 * Does nothing on styles without a raster photo layer (dark / light / streets basemaps).
 * choice (optional, /ships): { [key]: year | 'off' }; a source left out shows its default year.
 */
export function addLocalAerials(map, choice = null) {
  const slot = photoSlot(map)
  if (!slot) return false
  map.__localAerialChoice = choice
  for (const a of LOCAL_AERIALS) {
    const y = yearFor(a, choice)
    // Other years of this source come off the map (their tiles stop loading); then the chosen one goes on, in list order.
    for (const yy of a.years) {
      const id = layerIdFor(a, yy)
      if (yy !== y && map.getLayer(id)) map.removeLayer(id)
      if (yy !== y && map.getSource(id)) map.removeSource(id)
    }
  }
  for (const a of LOCAL_AERIALS) {
    const y = yearFor(a, choice)
    if (y === 'off') continue
    const id = layerIdFor(a, y), source = a.sourceFor(y)
    if (!map.getSource(id)) map.addSource(id, source)
    if (map.getLayer(id)) map.moveLayer(id, slot.before)
    else map.addLayer({ id, type: 'raster', source: id, minzoom: Math.max(LOCAL_AERIALS_SHOW_FROM, source.minzoom), layout: { visibility: 'none' } }, slot.before)
  }
  if (!map.__localAerialsSync) { map.__localAerialsSync = () => syncLocalAerials(map); map.on('moveend', map.__localAerialsSync) }
  syncLocalAerials(map)
  return true
}

/**
 * The imagery under the local aerials (BASE_IMAGERY id; 'mapbox' = the style's own photos). Satellite styles only, after
 * addLocalAerials on each style.load.
 */
export function setBaseImagery(map, id) {
  const slot = photoSlot(map)
  if (!slot) return false
  // 'best' = Sentinel-2 cloudless 2025 below LOCAL_AERIALS_SHOW_FROM, where it renders water far better than Mapbox (Josh
  // 2026-10-18); from z11 the layer stops drawing and Mapbox satellite / the local aerials show.
  const best = id === 'best'
  const pick = BASE_IMAGERY.find((b) => b.id === (best ? BEST_BASE : id) && b.source)
  // A new style has none of ours; on the same style, swap only when the pick changed.
  if (map.getLayer(BASE_LAYER) && map.__baseImagery === (best ? id : pick?.id)) return true
  if (map.getLayer(BASE_LAYER)) map.removeLayer(BASE_LAYER)
  if (map.getSource(BASE_LAYER)) map.removeSource(BASE_LAYER)
  map.__baseImagery = null
  if (!pick) return true
  map.addSource(BASE_LAYER, pick.source)
  // Under every local aerial: before the lowest one on the map, else before the style's layer above its photos.
  const firstLocal = (map.getStyle().layers || []).find((l) => l.id !== BASE_LAYER && ours(l.id))
  map.addLayer({ id: BASE_LAYER, type: 'raster', source: BASE_LAYER, ...(best && { maxzoom: LOCAL_AERIALS_SHOW_FROM }) }, firstLocal?.id || slot.before)
  map.__baseImagery = best ? id : pick.id
  return true
}

/** The local sources whose area is in view at this zoom (the picker offers them), with the year drawn and the choices. */
export function localAerialsInView(map, choice = null) {
  if (!map) return []
  const z = map.getZoom()
  return LOCAL_AERIALS.filter((a) => {
    const src = a.sourceFor(a.year)
    return z >= Math.max(LOCAL_AERIALS_SHOW_FROM, src.minzoom) && overlaps(map, src.bounds)
  }).map((a) => ({ key: a.key, name: a.name, years: a.years, defaultYear: a.year, year: yearFor(a, choice),
    // The credit's link for the year drawn (the page the photos come from), for the imagery line on the map.
    href: (() => { const y = yearFor(a, choice); return y === 'off' ? null : (a.sourceFor(y).attribution.match(/href="([^"]+)"/) || [])[1] || null })(),
    shown: (() => { const y = yearFor(a, choice); return y !== 'off' && map.getLayer(layerIdFor(a, y)) && map.getLayoutProperty(layerIdFor(a, y), 'visibility') !== 'none' })() }))
}

/**
 * /ships' one Photos choice (Josh 2026-10-18: pick one thing and see it, no hidden layering) → what to draw.
 *   'best'              Sentinel-2 2025 below z11; from z11 every local source's newest year where it has photos, Mapbox
 *                       satellite elsewhere (the default)
 *   'mapbox'            Mapbox satellite only
 *   'usgs', 's2-<year>' that imagery only
 *   '<key>-<year>'      one local source in one year, Mapbox satellite around it
 */
export function photoLayers(photo) {
  const allOff = Object.fromEntries(LOCAL_AERIALS.map((a) => [a.key, 'off']))
  if (BASE_IMAGERY.some((b) => b.id === photo)) return { choice: allOff, base: photo }
  const [key, y] = String(photo || '').split('-')
  const a = LOCAL_AERIALS.find((x) => x.key === key)
  if (a && a.years.includes(Number(y))) return { choice: { ...allOff, [key]: Number(y) }, base: 'mapbox' }
  return { choice: {}, base: 'best' }
}
export const isPhotoChoice = (photo) => photo === 'best' || BASE_IMAGERY.some((b) => b.id === photo)
  || LOCAL_AERIALS.some((a) => a.years.some((y) => photo === `${a.key}-${y}`))
