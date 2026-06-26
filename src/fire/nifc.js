// ─── Active wildfires (US): NIFC WFIGS current perimeters ───────────────────
// The authoritative US incident layer: official, named fire perimeters from the
// interagency WFIGS feed (IRWIN-backed). Where FIRMS shows raw satellite heat,
// this shows which NAMED incident a fire is and its mapped perimeter, with size,
// containment and cause.
//
// Unlike FIRMS (viewport-driven point refetch), this is a fetch-ONCE polygon
// layer: the whole current service is small (tens-to-low-hundreds of perimeters
// nationwide), so we pull it once via /api/nifc (which edge-caches it and obeys
// NIFC's no-relative-date-query rule) and keep it. One catalog entry,
// `kind:'nifc'`, into the shared panel/legend/URL-state machinery.

import styles from './FireApp.module.css'

const SRC = 'fire-nifc-src'
const FILL = 'fire-nifc-fill'
const LINE = 'fire-nifc-line'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Color by containment so the map reads as a triage: uncontained = hot red,
// partly held = amber, fully contained (lingering in the current feed) = grey.
// These double as the legend swatches.
const COL_UNCONTAINED = '#ff3b30'
const COL_PARTIAL = '#ff9500'
const COL_CONTAINED = '#9aa0a6'

const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()

// Cache the fetched FeatureCollection so basemap swaps (which wipe sources) can
// re-apply it instantly without refetching.
let cachedFC = null

export const NIFC_LAYER = {
  id: 'nifc',
  kind: 'nifc',
  label: 'Active wildfires (US)',
  group: 'Active fire',
  defaultOpacity: 0.85,
  minZoom: 0,
  coverage: 'US · NIFC official current perimeters',
  legend: {
    kind: 'swatches',
    items: [
      { c: COL_UNCONTAINED, l: 'Uncontained' },
      { c: COL_PARTIAL, l: 'Partly contained' },
      { c: COL_CONTAINED, l: 'Contained (recent)' },
    ],
  },
  blurb:
    'Official, named wildfire perimeters for active US incidents from the interagency WFIGS feed (NIFC, IRWIN-backed) — the authoritative answer to “which fire is this and how big.” Outlines are colored by containment. Click a perimeter for incident name, size, containment, cause and discovery date. Complements the satellite Active fires layer: FIRMS shows raw heat, this shows the official mapped footprint. US only; the feed retires incidents a while after they are out.',
  source: 'NIFC · WFIGS Current Interagency Fire Perimeters',
}

export const NIFC_SOURCE_CITATION = {
  short: 'NIFC · WFIGS Current Interagency Fire Perimeters',
  tag: 'NIFC WFIGS',
  url: 'https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about',
}

const containmentColorExpr = () => [
  'case',
  ['>=', ['coalesce', ['get', 'contained'], -1], 100], COL_CONTAINED,
  ['>', ['coalesce', ['get', 'contained'], 0], 0], COL_PARTIAL,
  COL_UNCONTAINED,
]

// ─── Map: add source + layers (idempotent; called on every style.load) ──────
export function addNifcLayers(map, isOn, op) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: cachedFC || EMPTY_FC, attribution: NIFC_LAYER.source })
  }
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? NIFC_LAYER.defaultOpacity
  if (!map.getLayer(FILL)) {
    map.addLayer({
      id: FILL, type: 'fill', source: SRC,
      // Fill stays visible:'visible' so a click registers the perimeter even when
      // the layer's outline is toggled off (ambient context, like parcels); its
      // opacity drops to 0 when off.
      layout: { visibility: 'visible' },
      paint: { 'fill-color': containmentColorExpr(), 'fill-opacity': isOn ? 0.18 * o : 0 },
    })
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE, type: 'line', source: SRC,
      layout: { visibility: vis, 'line-join': 'round' },
      paint: {
        'line-color': containmentColorExpr(),
        'line-opacity': o,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 2, 12, 3],
      },
    })
  }
}

export function applyNifcVisibility(map, isOn, op) {
  if (map.getLayer(LINE)) map.setLayoutProperty(LINE, 'visibility', isOn ? 'visible' : 'none')
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.18 * (op ?? NIFC_LAYER.defaultOpacity) : 0)
}

export function applyNifcOpacity(map, op, isOn) {
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-opacity', op)
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.18 * op : 0)
}

export function restackNifc(map) {
  for (const id of [FILL, LINE]) {
    try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ }
  }
}

// ─── Fetch the whole current service once → setData ─────────────────────────
// Returns { count } or null. Caches the FC module-side so basemap swaps re-apply
// it without a refetch. Safe to call repeatedly (it refreshes the data).
export async function loadNifc(map, { signal } = {}) {
  const r = await fetch(`${API_BASE}/api/nifc?layer=perimeters`, { signal })
  const fc = await r.json()
  if (fc && fc.type === 'FeatureCollection') {
    cachedFC = fc
    const src = map.getSource(SRC)
    if (src) src.setData(fc)
    return { count: fc._count ?? fc.features.length }
  }
  return null
}

// ─── Click → perimeter under the point (for the shared popup) ───────────────
export function queryNifcAt(map, point) {
  if (!map.getLayer(FILL)) return null
  let feats = []
  try { feats = map.queryRenderedFeatures(point, { layers: [FILL] }) } catch { return null }
  if (!feats.length) return null
  // Smallest fire wins when perimeters overlap — the most specific incident.
  feats.sort((a, b) => (a.properties.acres ?? 1e12) - (b.properties.acres ?? 1e12))
  return feats[0].properties || null
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const TYPE_LABEL = { WF: 'Wildfire', RX: 'Prescribed fire', CX: 'Incident complex' }

function discoveredText(ms) {
  if (!ms) return null
  const days = (Date.now() - ms) / 8.64e7
  if (days < 0) return null
  if (days < 1) return 'started today'
  if (days < 2) return 'started yesterday'
  if (days < 60) return `burning ~${Math.round(days)} days`
  return `since ${new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`
}

function row(label, value) {
  if (value == null || value === '') return ''
  return `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">${esc(label)}</span>` +
    `<span class="${styles.popupRowValue}">${esc(value)}</span></div>`
}

// Render the "Active wildfire" card for the shared popup. `d` = properties from
// queryNifcAt, or null → ''. Sits near the top of the popup (named incident is
// high-value context for a clicked point).
export function renderNifcCard(d) {
  if (!d) return ''
  const name = d.name ? `${d.name} Fire` : 'Active wildfire'
  const acres = d.acres != null ? `${d.acres.toLocaleString()} acres` : null
  const contained = d.contained != null ? `${d.contained}% contained` : null
  const cause = d.cause && d.cause !== 'Undetermined' ? `${d.cause}-caused` : (d.cause === 'Undetermined' ? 'cause undetermined' : null)

  const rows =
    row('Type', TYPE_LABEL[d.type] || d.type) +
    row('Size', acres) +
    row('Containment', contained) +
    row('Duration', discoveredText(d.discovered_ms)) +
    row('Cause', cause) +
    (d.behavior ? row('Behavior', d.behavior) : '')

  const src = `<div class="${styles.popupParcelSrc}">Incident data: ` +
    `<a href="${NIFC_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${esc(NIFC_SOURCE_CITATION.short)}">NIFC WFIGS ↗</a></div>`

  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">${esc(name)}` +
    `<span class="${styles.popupParcelApn}">official perimeter</span></div>` +
    rows + src + '</div>'
}
