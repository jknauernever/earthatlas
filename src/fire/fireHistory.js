// ─── Past fires (US history): NIFC IFPH perimeter history ───────────────────
// "Where were fires historically." The conglomerated interagency perimeter
// history (~98k polygons, all years through the last full season). Far too big
// to ship whole, so — like FIRMS — it's a VIEWPORT-driven layer gated to higher
// zoom: pan/zoom refetches the current bbox from /api/fire-history (which edge-
// caches IFPH and cleans its FIRE_YEAR_INT 9999 sentinels). Polygons colored by
// fire year: older burns fade brown, recent burns glow orange.
//
// One catalog entry, `kind:'firehistory'`, into the shared panel machinery.
// (A future optimization is a Welty-Jeffries PMTiles bake on Blob for global-
// smooth pan; live IFPH ships the historical layer now.)

import styles from './FireApp.module.css'

const SRC = 'fire-history-src'
const FILL = 'fire-history-fill'
const LINE = 'fire-history-line'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Below this the viewport spans many degrees and IFPH returns thousands of
// dense polygons; we gate the fetch and show a "zoom in" hint instead.
export const HISTORY_MIN_ZOOM = 8

const COL_UNKNOWN = '#8a8a8a'
const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()

export const HISTORY_LAYER = {
  id: 'firehistory',
  kind: 'firehistory',
  label: 'Past fires (US history)',
  group: 'Fire history',
  defaultOpacity: 0.6,
  minZoom: HISTORY_MIN_ZOOM,
  coverage: 'US · NIFC perimeter history · zoom in to load',
  legend: {
    kind: 'gradient',
    // Matches the year ramp below: old (faded brown) → recent (hot orange).
    css: 'linear-gradient(to right, #5b4636, #8a5a2b, #c9772a, #ff7a00)',
    left: 'older',
    right: 'recent',
  },
  blurb:
    'Historical wildfire footprints — the interagency fire-perimeter history (NIFC IFPH): where fires have burned across the US, reaching back decades. Polygons are shaded by fire year, older burns faded, recent ones bright. Click any footprint for the fire name, year, size and reporting agency. Zoom in to load; US only. Combines USFS, BLM, NPS, BIA, FWS, CAL FIRE and WFIGS perimeter records.',
  source: 'NIFC · InterAgency Fire Perimeter History (IFPH)',
}

export const HISTORY_SOURCE_CITATION = {
  short: 'NIFC · InterAgency Fire Perimeter History',
  tag: 'NIFC fire history',
  url: 'https://data-nifc.opendata.arcgis.com/datasets/nifc::interagencyfireperimeterhistory-all-years-view/about',
}

// Color a perimeter by its fire year; unknown years render neutral grey.
const yearColorExpr = () => [
  'case',
  ['==', ['coalesce', ['get', 'year'], 0], 0], COL_UNKNOWN,
  ['interpolate', ['linear'], ['get', 'year'],
    1970, '#5b4636',
    1995, '#8a5a2b',
    2010, '#c9772a',
    2024, '#ff7a00'],
]

export function addHistoryLayers(map, isOn, op) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: EMPTY_FC, attribution: HISTORY_LAYER.source })
  }
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? HISTORY_LAYER.defaultOpacity
  if (!map.getLayer(FILL)) {
    map.addLayer({
      id: FILL, type: 'fill', source: SRC, minzoom: HISTORY_MIN_ZOOM,
      layout: { visibility: 'visible' }, // stays visible so clicks register when off
      paint: { 'fill-color': yearColorExpr(), 'fill-opacity': isOn ? 0.22 * o : 0 },
    })
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE, type: 'line', source: SRC, minzoom: HISTORY_MIN_ZOOM,
      layout: { visibility: vis, 'line-join': 'round' },
      paint: { 'line-color': yearColorExpr(), 'line-opacity': 0.85 * o, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1.6] },
    })
  }
}

export function applyHistoryVisibility(map, isOn, op) {
  if (map.getLayer(LINE)) map.setLayoutProperty(LINE, 'visibility', isOn ? 'visible' : 'none')
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.22 * (op ?? HISTORY_LAYER.defaultOpacity) : 0)
}

export function applyHistoryOpacity(map, op, isOn) {
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-opacity', 0.85 * op)
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.22 * op : 0)
}

export function restackHistory(map) {
  for (const id of [FILL, LINE]) {
    try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ }
  }
}

export function clearHistory(map) {
  const src = map.getSource(SRC)
  if (src) src.setData(EMPTY_FC)
}

// ─── Fetch current viewport perimeters → setData ────────────────────────────
export async function refreshHistory(map, { signal } = {}) {
  const b = map.getBounds()
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(3)).join(',')
  const r = await fetch(`${API_BASE}/api/fire-history?bbox=${bbox}`, { signal })
  const fc = await r.json()
  const src = map.getSource(SRC)
  if (src && fc && fc.type === 'FeatureCollection') {
    src.setData(fc)
    return { count: fc._count ?? fc.features.length, truncated: !!fc._truncated }
  }
  return null
}

// ─── Click → perimeter under the point (for the shared popup) ───────────────
export function queryHistoryAt(map, point) {
  if (!map.getLayer(FILL)) return null
  let feats = []
  try { feats = map.queryRenderedFeatures(point, { layers: [FILL] }) } catch { return null }
  if (!feats.length) return null
  // Most recent fire wins when footprints overlap.
  feats.sort((a, b) => (b.properties.year ?? 0) - (a.properties.year ?? 0))
  return feats[0].properties || null
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function row(label, value) {
  if (value == null || value === '') return ''
  return `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">${esc(label)}</span>` +
    `<span class="${styles.popupRowValue}">${esc(value)}</span></div>`
}

export function renderHistoryCard(d) {
  if (!d) return ''
  const name = d.name ? `${d.name} Fire` : 'Past fire'
  const acres = d.acres != null ? `${d.acres.toLocaleString()} acres` : null

  const rows =
    row('Burned', d.year || 'year unknown') +
    row('Size', acres) +
    row('Agency', d.agency) +
    (d.category && !/final fire perimeter/i.test(d.category) ? row('Record', d.category) : '')

  const src = `<div class="${styles.popupParcelSrc}">History: ` +
    `<a href="${HISTORY_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${esc(HISTORY_SOURCE_CITATION.short)}">NIFC IFPH ↗</a></div>`

  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">${esc(name)}` +
    `<span class="${styles.popupParcelApn}">past perimeter</span></div>` +
    rows + src + '</div>'
}
