/**
 * ShipTraffic data layer.
 *
 * Three independent layers:
 *   - Vessels  : Esri Living Atlas "U.S. Vessel Traffic" per-month VECTOR tile
 *                services (real MarineCadastre AIS tracks), styled as a yellow
 *                glow and filtered by vessel type via the `_symbol` attribute.
 *                No local data — tiles stream from ArcGIS Online.
 *   - Whales   : REAL cetacean sightings (iNaturalist + OBIS) as raw POINTS
 *                (whales.json), drawn magenta.
 *   - Concern  : the only computed layer — a smooth heatmap of ship×whale
 *                overlap, from a coarse grid (grid.json) carrying per-cell
 *                vessel density + whale counts, aggregated client-side over the
 *                selected month range + filters.
 */

export const GRID_URL = '/shiptraffic/grid.json'
export const WHALES_URL = '/shiptraffic/whales.json'

// ─── Esri Living Atlas vessel-traffic vector tiles ──────────────────────────
// One VectorTileServer per month, public on ArcGIS Online. Track geometry is in
// source-layer "US_Vessel_Traffic" (+ a generalized "US_Vessel_Traffic_gen" for
// low zoom); vessel type is the `_symbol` attribute.
const ESRI_VT_BASE = 'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services'
// Use only the generalized track layer — the detailed one makes the tiles very
// heavy (~0.5 MB) and can hang Mapbox's worker pool. Generalized is plenty for
// a regional density view.
export const ESRI_SOURCE_LAYERS = ['US_Vessel_Traffic_gen']
export const ESRI_ATTRIBUTION = 'Vessel tracks: Esri Living Atlas / MarineCadastre AIS (NOAA, BOEM, USCG)'

export function esriMonthTilesUrl(monthKey) {
  // monthKey '2024-06' → US_Vessel_Traffic_2024_06_optimized
  const [y, m] = monthKey.split('-')
  return `${ESRI_VT_BASE}/US_Vessel_Traffic_${y}_${m}_optimized/VectorTileServer/tile/{z}/{y}/{x}.pbf`
}

// Our vessel classes → Esri `_symbol` codes. (0 Cargo,1 Fishing,2 Military,
// 3 Passenger,4 Pleasure,5 Tanker,6 Tow,7 Other,8 Not Available.)
export const ESRI_SYMBOL_BY_TYPE = {
  cargo: [0], fishing: [1], passenger: [3], pleasure: [4],
  tanker: [5], tug: [6], other: [2, 7, 8],
}
export function esriSymbolsFor(typeSet) {
  const out = []
  for (const t of Object.keys(ESRI_SYMBOL_BY_TYPE)) {
    if (typeSet.has(t)) out.push(...ESRI_SYMBOL_BY_TYPE[t])
  }
  return out
}

// Display colors (not ramps — vessels are tile lines, whales are points).
export const VESSEL_LINE_COLOR = '#fde047'   // yellow tracks
export const WHALE_POINT_COLOR = '#ec4899'   // magenta points
// Concern heatmap density ramp (transparent → red → orange → white-hot alarm).
export const CONCERN_HEATMAP_RAMP = [
  0, 'rgba(0,0,0,0)',
  0.2, 'rgba(153,27,27,0.6)',
  0.45, '#dc2626',
  0.7, '#f97316',
  0.9, '#fbbf24',
  1, '#fffbe6',
]

export async function loadWhales(signal) {
  const r = await fetch(WHALES_URL, { signal })
  if (!r.ok) throw new Error(`whales load failed: ${r.status}`)
  return r.json()
}

/** Whale points → GeoJSON, filtered to the month range + selected sources. */
export function buildWhaleGeoJSON(whales, startIdx, endIdx, sourceSet, sourceList) {
  const features = []
  for (const [lng, lat, mIdx, sIdx, species] of whales.points) {
    if (mIdx < startIdx || mIdx > endIdx) continue
    const src = sourceList[sIdx]
    if (!sourceSet.has(src)) continue
    features.push({
      type: 'Feature',
      properties: { src, species: species || 'Cetacean', m: whales.meta.months[mIdx] },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Concern cells → weighted POINTS for a Mapbox heatmap, normalized to what's
 * VISIBLE in the current viewport (not the global max). The weight of each
 * in-view cell is its raw overlap index divided by the largest in-view value,
 * so panning/zooming into a quieter area re-stretches the color ramp to reveal
 * that area's relative hotspots. `bounds` is {w,s,e,n}; padded so heatmap
 * kernels near the edges still contribute.
 */
export function buildConcernPointsViewport(aggCells, bounds, pad = 0.25) {
  const dw = (bounds.e - bounds.w) * pad
  const dh = (bounds.n - bounds.s) * pad
  const w = bounds.w - dw, e = bounds.e + dw, s = bounds.s - dh, n = bounds.n + dh
  const inView = []
  let maxRaw = 0
  for (const c of aggCells) {
    if (!c.iRaw || c.iRaw <= 0) continue
    if (c.lng < w || c.lng > e || c.lat < s || c.lat > n) continue
    inView.push(c)
    if (c.iRaw > maxRaw) maxRaw = c.iRaw
  }
  const features = inView.map((c) => ({
    type: 'Feature',
    properties: { w: maxRaw ? c.iRaw / maxRaw : 0, vSum: c.vSum, wSum: c.wSum },
    geometry: { type: 'Point', coordinates: [c.lng, c.lat] },
  }))
  return { type: 'FeatureCollection', features }
}

export const VESSEL_TYPE_LABELS = {
  cargo: 'Cargo',
  tanker: 'Tanker',
  fishing: 'Fishing',
  passenger: 'Passenger / ferry',
  tug: 'Tug / tow',
  pleasure: 'Pleasure craft',
  other: 'Other',
}

export const WHALE_SOURCE_LABELS = {
  inat: 'iNaturalist',
  obis: 'OBIS',
  happywhale: 'Happywhale',
}

export const WHALE_SOURCE_URLS = {
  inat: 'https://www.inaturalist.org/observations?taxon_id=152871',
  obis: 'https://obis.org/',
  happywhale: 'https://happywhale.com/',
}

// Color ramps (Mapbox interpolate stops on a 0..1 normalized value).
//
// Cartographic basis (see research): each VARIABLE keeps one identifiable hue,
// magnitude carried by lightness/saturation + opacity, with the high end staying
// SATURATED (never washing to white). Hue choices are semantic + legible on
// satellite imagery:
//   Vessels = YELLOW — man-made/industrial, and yellow reads against dark water;
//             density is carried largely by opacity (faint → bright opaque).
//   Whales  = MAGENTA — nothing in satellite imagery (green land, blue water,
//             brown terrain) is magenta, so sightings pop instead of blending.
//   Interaction = RED — yellow + magenta literally mix to red (subtractive
//             primaries), so the overlap color is also the universal alarm; it
//             gets a white-hot glow so conflict hotspots are unmistakable.
export const VESSEL_RAMP = [0, '#a16207', 0.35, '#ca8a04', 0.6, '#eab308', 0.8, '#facc15', 1, '#fde047']
export const WHALE_RAMP = [0, '#701a45', 0.3, '#be185d', 0.6, '#db2777', 0.8, '#ec4899', 1, '#f472b6']
export const INTERACTION_RAMP = [0, '#450a0a', 0.25, '#991b1b', 0.55, '#dc2626', 0.8, '#ef4444', 1, '#ff3b3b']

export async function loadGrid(signal) {
  const r = await fetch(GRID_URL, { signal })
  if (!r.ok) throw new Error(`grid load failed: ${r.status}`)
  return r.json()
}

/** Inclusive index range over meta.months for a [startKey, endKey] window. */
export function monthRangeIndices(months, startKey, endKey) {
  let a = months.indexOf(startKey)
  let b = months.indexOf(endKey)
  if (a < 0) a = 0
  if (b < 0) b = months.length - 1
  if (a > b) [a, b] = [b, a]
  return [a, b]
}

/**
 * Aggregate every cell over the selected month window + filters.
 * Returns { cells, maxV, maxW, maxI, totals } where each cell carries the
 * summed vessel/whale counts, the per-type / per-source breakdowns, and the
 * normalized densities used for coloring (nV, nW, nI).
 */
export function aggregate(grid, { months, startIdx, endIdx, vesselTypes, whaleSources }) {
  const monthSet = new Set(months.slice(startIdx, endIdx + 1))
  const out = []
  let maxV = 0
  let maxW = 0
  let totalV = 0
  let totalW = 0

  for (const cell of grid.cells) {
    let vSum = 0
    let wSum = 0
    const vByType = {}
    const wBySrc = {}

    for (const [mk, byType] of Object.entries(cell.v)) {
      if (!monthSet.has(mk)) continue
      for (const [t, n] of Object.entries(byType)) {
        if (!vesselTypes.has(t)) continue
        vSum += n
        vByType[t] = (vByType[t] || 0) + n
      }
    }
    for (const [mk, bySrc] of Object.entries(cell.w)) {
      if (!monthSet.has(mk)) continue
      for (const [s, n] of Object.entries(bySrc)) {
        if (!whaleSources.has(s)) continue
        wSum += n
        wBySrc[s] = (wBySrc[s] || 0) + n
      }
    }

    if (vSum === 0 && wSum === 0) continue
    if (vSum > maxV) maxV = vSum
    if (wSum > maxW) maxW = wSum
    totalV += vSum
    totalW += wSum
    out.push({ i: cell.i, j: cell.j, lng: cell.lng, lat: cell.lat, vSum, wSum, vByType, wBySrc })
  }

  // Normalize + compute the interaction index (product of normalized densities).
  let maxI = 0
  for (const c of out) {
    c.nV = maxV ? c.vSum / maxV : 0
    c.nW = maxW ? c.wSum / maxW : 0
    c.iRaw = c.nV * c.nW
    if (c.iRaw > maxI) maxI = c.iRaw
  }
  for (const c of out) {
    c.nI = maxI ? c.iRaw / maxI : 0
  }

  return { cells: out, maxV, maxW, maxI, totals: { v: totalV, w: totalW } }
}

/** Square polygon for a grid cell, sized from the bake's cell steps. */
function cellPolygon(lng, lat, lngStep, latStep) {
  const hx = lngStep / 2
  const hy = latStep / 2
  return [[
    [lng - hx, lat - hy],
    [lng + hx, lat - hy],
    [lng + hx, lat + hy],
    [lng - hx, lat + hy],
    [lng - hx, lat - hy],
  ]]
}

/**
 * Build a GeoJSON FeatureCollection for one layer. `valueKey` selects which
 * normalized field colors the cell ('nV' | 'nW' | 'nI'); cells whose value is
 * 0 for that layer are dropped so each heatmap only paints where it has data.
 */
export function buildLayerGeoJSON(agg, cellMeta, layer) {
  const { lngStep, latStep } = cellMeta
  const valueKey = layer === 'vessels' ? 'nV' : layer === 'whales' ? 'nW' : 'nI'
  const features = []
  for (const c of agg.cells) {
    const n = c[valueKey]
    if (!n || n <= 0) continue
    features.push({
      type: 'Feature',
      properties: {
        n,
        i: c.i,
        j: c.j,
        vSum: c.vSum,
        wSum: c.wSum,
        iRaw: Number(c.iRaw.toFixed(4)),
      },
      geometry: { type: 'Polygon', coordinates: cellPolygon(c.lng, c.lat, lngStep, latStep) },
    })
  }
  return { type: 'FeatureCollection', features }
}

/** Map a 0..1 co-occurrence index to a plain-language band. */
export function interactionBand(iRaw) {
  if (iRaw >= 0.5) return { label: 'Very high potential overlap', tone: 'crit' }
  if (iRaw >= 0.25) return { label: 'High potential overlap', tone: 'high' }
  if (iRaw >= 0.08) return { label: 'Moderate potential overlap', tone: 'mod' }
  if (iRaw > 0) return { label: 'Low potential overlap', tone: 'low' }
  return { label: 'No overlap', tone: 'none' }
}

export function fmtMonth(mk) {
  if (!mk) return ''
  const [y, m] = mk.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}
