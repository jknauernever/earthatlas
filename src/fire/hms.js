// ─── GOES + satellite fire detections (NOAA HMS) ────────────────────────────
// NOAA/NESDIS's analyst-QC'd multi-sensor fire product. Unlike the raw FIRMS
// hotspots (polar VIIRS only), HMS folds in GEOSTATIONARY GOES-East/West, which
// scan every few minutes — so it catches new starts far faster — and a human
// analyst has already stripped obvious false positives. Viewport-driven point
// layer (like FIRMS): pan/zoom refetches the bbox from /api/hms. Detections are
// colored by sensor family: GOES (geostationary, the fast ones) vs polar.

import styles from './FireApp.module.css'

const SRC = 'fire-hms-src'
const GLOW = 'fire-hms-glow'
const DOT = 'fire-hms-dot'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

const COL_GEO = '#ff5e00'   // GOES — geostationary
const COL_POLAR = '#ffc400' // VIIRS / MODIS via HMS

export const HMS_MIN_ZOOM = 3
const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()

export const HMS_LAYER = {
  id: 'hms',
  kind: 'hms',
  label: 'Fire detections (GOES + satellite)',
  group: 'Active fire',
  defaultOpacity: 0.9,
  minZoom: HMS_MIN_ZOOM,
  coverage: 'US + Americas · NOAA HMS · zoom in to load',
  legend: {
    kind: 'swatches',
    items: [
      { c: COL_GEO, l: 'GOES (geostationary — fast)' },
      { c: COL_POLAR, l: 'VIIRS / MODIS (polar)' },
    ],
  },
  blurb:
    'Analyst-quality-controlled satellite fire detections from NOAA’s Hazard Mapping System (HMS). Its edge over the raw Active Hotspots layer: it folds in the geostationary GOES-East/West satellites, which image the hemisphere every few minutes — so a new fire is often caught hours before the twice-daily polar VIIRS/MODIS passes — and a NOAA analyst has already removed obvious false positives. GOES detections are coarser (~2 km) than VIIRS; use this for the earliest heads-up and the Active Hotspots layer for finer detail. Covers the Americas (GOES field of view).',
  source: 'NOAA / NESDIS · Hazard Mapping System (HMS) fire detections',
}

export const HMS_SOURCE_CITATION = {
  short: 'NOAA/NESDIS · Hazard Mapping System (HMS)',
  tag: 'NOAA HMS',
  url: 'https://www.ospo.noaa.gov/products/land/hms.html',
}

const colorExpr = () => ['case', ['get', 'geo'], COL_GEO, COL_POLAR]
const radiusExpr = () => [
  'interpolate', ['linear'], ['zoom'],
  3, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 3, 50, 5],
  7, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 5.5, 100, 10],
  11, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 9, 200, 18],
]

export function addHmsLayer(map, isOn, op) {
  if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: EMPTY_FC, attribution: HMS_LAYER.source })
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? HMS_LAYER.defaultOpacity
  if (!map.getLayer(GLOW)) {
    map.addLayer({
      id: GLOW, type: 'circle', source: SRC, minzoom: HMS_MIN_ZOOM,
      layout: { visibility: vis },
      paint: {
        'circle-color': colorExpr(),
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 7, 7, 13, 11, 22],
        'circle-blur': 1, 'circle-opacity': 0.3 * o,
      },
    })
  }
  if (!map.getLayer(DOT)) {
    map.addLayer({
      id: DOT, type: 'circle', source: SRC, minzoom: HMS_MIN_ZOOM,
      layout: { visibility: vis },
      paint: {
        'circle-color': colorExpr(),
        'circle-radius': radiusExpr(),
        'circle-opacity': o,
        // White ring distinguishes HMS from the dark-ringed FIRMS hotspots.
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 1.2],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.7 * o,
      },
    })
  }
}

export function applyHmsVisibility(map, isOn) {
  const vis = isOn ? 'visible' : 'none'
  for (const id of [GLOW, DOT]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
}

export function applyHmsOpacity(map, op) {
  if (map.getLayer(GLOW)) map.setPaintProperty(GLOW, 'circle-opacity', 0.3 * op)
  if (map.getLayer(DOT)) {
    map.setPaintProperty(DOT, 'circle-opacity', op)
    map.setPaintProperty(DOT, 'circle-stroke-opacity', 0.7 * op)
  }
}

export function restackHms(map) {
  for (const id of [GLOW, DOT]) { try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ } }
}

export function clearHms(map) {
  const src = map.getSource(SRC)
  if (src) src.setData(EMPTY_FC)
}

export async function refreshHms(map, { signal } = {}) {
  const b = map.getBounds()
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(3)).join(',')
  const r = await fetch(`${API_BASE}/api/hms?bbox=${bbox}`, { signal })
  const fc = await r.json()
  const src = map.getSource(SRC)
  if (src && fc && fc.type === 'FeatureCollection') {
    src.setData(fc)
    const geo = fc.features.filter((f) => f.properties.geo).length
    return { count: fc._count ?? fc.features.length, geo }
  }
  return null
}

export function queryHmsAt(map, point) {
  if (!map.getLayer(DOT)) return null
  const box = [[point.x - 7, point.y - 7], [point.x + 7, point.y + 7]]
  let feats = []
  try { feats = map.queryRenderedFeatures(box, { layers: [DOT] }) } catch { return null }
  if (!feats.length) return null
  feats.sort((a, b) => (a.properties.hours_ago ?? 1e9) - (b.properties.hours_ago ?? 1e9))
  return feats[0].properties || null
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function ageText(h) {
  if (h == null) return 'recent'
  if (h < 1) return 'within the last hour'
  if (h < 24) return `${Math.round(h)} h ago`
  return `${Math.round(h / 24)} d ago`
}

export function renderHmsCard(d) {
  if (!d) return ''
  const frp = d.frp != null ? `${Number(d.frp).toFixed(1)} MW` : null
  const kind = d.geo ? 'geostationary — fast refresh' : 'polar orbiter'
  const rows =
    `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Detected</span>` +
      `<span class="${styles.popupRowValue}">${esc(ageText(d.hours_ago))}</span></div>` +
    `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Satellite</span>` +
      `<span class="${styles.popupRowValue}">${esc(d.sat || 'HMS')} · ${esc(kind)}</span></div>` +
    (frp ? `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Fire power</span>` +
      `<span class="${styles.popupRowValue}">${esc(frp)}</span></div>` : '')
  const src = `<div class="${styles.popupParcelSrc}">Detection: ` +
    `<a href="${HMS_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${esc(HMS_SOURCE_CITATION.short)}">NOAA HMS ↗</a></div>`
  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">Fire detection` +
    `<span class="${styles.popupParcelApn}">${d.geo ? 'GOES' : 'satellite'}</span></div>` +
    rows + src + '</div>'
}
