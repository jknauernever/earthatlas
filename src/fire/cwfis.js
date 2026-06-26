// ─── Active wildfires (Canada): CWFIS M3 perimeters ────────────────────────
// Canada's satellite-mapped active-fire perimeters (NRCan CWFIS, M3 product —
// perimeters auto-generated from clustered MODIS/VIIRS hotspots). The Canadian
// companion to the US NIFC layer; given cross-border smoke, a big gap-filler.
//
// Fetch-once GeoJSON polygons (the current service is small, low-hundreds
// nationwide) via /api/cwfis (edge-cached). One catalog entry, `kind:'cwfis'`.
// Mirrors src/fire/nifc.js.

import styles from './FireApp.module.css'

const SRC = 'fire-cwfis-src'
const FILL = 'fire-cwfis-fill'
const LINE = 'fire-cwfis-line'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Warm orange, distinct from the NIFC containment ramp (red/amber/grey).
const COLOR = '#ff6b35'

const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()
let cachedFC = null

export const CWFIS_LAYER = {
  id: 'cwfis',
  kind: 'cwfis',
  label: 'Active wildfires (Canada)',
  group: 'Active fire',
  defaultOpacity: 0.85,
  minZoom: 0,
  coverage: 'Canada · CWFIS satellite-mapped perimeters',
  legend: {
    kind: 'swatches',
    items: [{ c: COLOR, l: 'Active fire perimeter' }],
  },
  blurb:
    'Active wildfire perimeters across Canada, satellite-mapped by the Canadian Wildland Fire Information System (CWFIS M3 product — perimeters auto-generated from clustered MODIS/VIIRS hotspots). The Canadian companion to the US active-wildfires layer; especially useful for tracking the cross-border smoke seasons. Click a perimeter for its size, detection dates and hotspot count. These are satellite-derived footprints, not named agency incidents. Canada only.',
  source: 'NRCan · Canadian Wildland Fire Information System (CWFIS M3)',
}

export const CWFIS_SOURCE_CITATION = {
  short: 'NRCan · Canadian Wildland Fire Information System (CWFIS)',
  tag: 'CWFIS (Canada)',
  url: 'https://cwfis.cfs.nrcan.gc.ca/',
}

export function addCwfisLayers(map, isOn, op) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: cachedFC || EMPTY_FC, attribution: CWFIS_LAYER.source })
  }
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? CWFIS_LAYER.defaultOpacity
  if (!map.getLayer(FILL)) {
    map.addLayer({
      id: FILL, type: 'fill', source: SRC,
      layout: { visibility: 'visible' }, // visible so clicks register when off
      paint: { 'fill-color': COLOR, 'fill-opacity': isOn ? 0.2 * o : 0 },
    })
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE, type: 'line', source: SRC,
      layout: { visibility: vis, 'line-join': 'round' },
      paint: { 'line-color': COLOR, 'line-opacity': o, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 2, 12, 3] },
    })
  }
}

export function applyCwfisVisibility(map, isOn, op) {
  if (map.getLayer(LINE)) map.setLayoutProperty(LINE, 'visibility', isOn ? 'visible' : 'none')
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.2 * (op ?? CWFIS_LAYER.defaultOpacity) : 0)
}

export function applyCwfisOpacity(map, op, isOn) {
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-opacity', op)
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.2 * op : 0)
}

export function restackCwfis(map) {
  for (const id of [FILL, LINE]) {
    try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ }
  }
}

export async function loadCwfis(map, { signal } = {}) {
  const r = await fetch(`${API_BASE}/api/cwfis`, { signal })
  const fc = await r.json()
  if (fc && fc.type === 'FeatureCollection') {
    cachedFC = fc
    const src = map.getSource(SRC)
    if (src) src.setData(fc)
    return { count: fc._count ?? fc.features.length }
  }
  return null
}

export function queryCwfisAt(map, point) {
  if (!map.getLayer(FILL)) return null
  let feats = []
  try { feats = map.queryRenderedFeatures(point, { layers: [FILL] }) } catch { return null }
  if (!feats.length) return null
  feats.sort((a, b) => (a.properties.area_ha ?? 1e12) - (b.properties.area_ha ?? 1e12))
  return feats[0].properties || null
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function dateText(ms) {
  if (!ms) return null
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function row(label, value) {
  if (value == null || value === '') return ''
  return `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">${esc(label)}</span>` +
    `<span class="${styles.popupRowValue}">${esc(value)}</span></div>`
}

export function renderCwfisCard(d) {
  if (!d) return ''
  const size = d.area_ha != null ? `${d.area_ha.toLocaleString()} ha` : null
  const span = (d.first_ms && d.last_ms)
    ? `${dateText(d.first_ms)} – ${dateText(d.last_ms)}`
    : (d.first_ms ? `since ${dateText(d.first_ms)}` : null)

  const rows =
    row('Size', size) +
    row('Detected', span) +
    (d.hcount ? row('Hotspots', `${d.hcount.toLocaleString()} contributing`) : '')

  const src = `<div class="${styles.popupParcelSrc}">Perimeter: ` +
    `<a href="${CWFIS_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${esc(CWFIS_SOURCE_CITATION.short)}">CWFIS (Canada) ↗</a></div>`

  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">Active fire (Canada)` +
    `<span class="${styles.popupParcelApn}">satellite-mapped</span></div>` +
    rows + src + '</div>'
}
