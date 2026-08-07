// ─── Named incidents (InciWeb) ──────────────────────────────────────────────
// InciWeb is where agencies post NAMED wildfire updates — so this layer's job is
// the one thing satellite heat can't give you: a fire's NAME (and a link to the
// official incident page), often before a mapped WFIGS perimeter exists. It only
// carries significant incidents (not every tiny start), ~50 nationally, so it's
// a fetch-once labelled-marker layer. One catalog entry, `kind:'inciweb'`.

import styles from './FireApp.module.css'

const SRC = 'fire-inciweb-src'
const DOT = 'fire-inciweb-dot'
const LABEL = 'fire-inciweb-label'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

const COLOR = '#e11d48' // rose — distinct from the satellite-detection layers

const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()
let cachedFC = null

export const INCIWEB_LAYER = {
  id: 'inciweb',
  kind: 'inciweb',
  label: 'Named incidents (InciWeb)',
  group: 'Active fire',
  defaultOpacity: 0.95,
  minZoom: 0,
  coverage: 'US · InciWeb significant named incidents',
  legend: {
    kind: 'swatches',
    items: [{ c: COLOR, l: 'Named incident' }],
  },
  blurb:
    'Named US wildfire incidents from InciWeb, the interagency public incident-information system. This is the layer that gives a fire its NAME — and a link to the official incident page with the latest size, status and evacuation info — which the satellite heat layers can’t. It lists only significant incidents (the ones agencies open a public page for), not every small start, so treat it as “the notable named fires,” updated as agencies post. US.',
  source: 'InciWeb · Interagency incident information (NWCG)',
}

export const INCIWEB_SOURCE_CITATION = {
  short: 'InciWeb · Interagency incident information',
  tag: 'InciWeb',
  url: 'https://inciweb.wildfire.gov/',
}

export function addInciwebLayers(map, isOn, op) {
  if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: cachedFC || EMPTY_FC, attribution: INCIWEB_LAYER.source })
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? INCIWEB_LAYER.defaultOpacity
  if (!map.getLayer(DOT)) {
    // Fill stays visible so a click registers even when the layer is toggled off
    // (ambient, like parcels); opacity 0 when off.
    map.addLayer({
      id: DOT, type: 'circle', source: SRC,
      layout: { visibility: 'visible' },
      paint: {
        'circle-color': COLOR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4, 10, 7],
        'circle-opacity': isOn ? o : 0,
        'circle-stroke-width': isOn ? 1.4 : 0,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': isOn ? o : 0,
      },
    })
  }
  if (!map.getLayer(LABEL)) {
    map.addLayer({
      id: LABEL, type: 'symbol', source: SRC,
      layout: {
        visibility: vis,
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-allow-overlap': false, // Mapbox drops colliding labels automatically
      },
      paint: { 'text-color': '#ffe4e9', 'text-halo-color': '#7f1020', 'text-halo-width': 1.4, 'text-opacity': o },
    })
  }
}

export function applyInciwebVisibility(map, isOn, op) {
  const o = op ?? INCIWEB_LAYER.defaultOpacity
  if (map.getLayer(LABEL)) map.setLayoutProperty(LABEL, 'visibility', isOn ? 'visible' : 'none')
  if (map.getLayer(DOT)) {
    map.setPaintProperty(DOT, 'circle-opacity', isOn ? o : 0)
    map.setPaintProperty(DOT, 'circle-stroke-width', isOn ? 1.4 : 0)
    map.setPaintProperty(DOT, 'circle-stroke-opacity', isOn ? o : 0)
  }
}

export function applyInciwebOpacity(map, op, isOn) {
  if (!isOn) return
  if (map.getLayer(DOT)) { map.setPaintProperty(DOT, 'circle-opacity', op); map.setPaintProperty(DOT, 'circle-stroke-opacity', op) }
  if (map.getLayer(LABEL)) map.setPaintProperty(LABEL, 'text-opacity', op)
}

export function restackInciweb(map) {
  for (const id of [DOT, LABEL]) { try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ } }
}

export async function loadInciweb(map, { signal } = {}) {
  const r = await fetch(`${API_BASE}/api/inciweb`, { signal })
  const fc = await r.json()
  if (fc && fc.type === 'FeatureCollection') {
    cachedFC = fc
    const src = map.getSource(SRC)
    if (src) src.setData(fc)
    return { count: fc._count ?? fc.features.length }
  }
  return null
}

export function queryInciwebAt(map, point) {
  if (!map.getLayer(DOT)) return null
  const box = [[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]]
  let feats = []
  try { feats = map.queryRenderedFeatures(box, { layers: [DOT] }) } catch { return null }
  if (!feats.length) return null
  return feats[0].properties || null
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function row(label, value) {
  if (value == null || value === '') return ''
  return `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">${esc(label)}</span>` +
    `<span class="${styles.popupRowValue}">${esc(value)}</span></div>`
}

export function renderInciwebCard(d) {
  if (!d) return ''
  const rows =
    row('Type', d.type) +
    (d.acres ? row('Size', `${Number(d.acres).toLocaleString()} acres (per InciWeb)`) : '') +
    row('Updated', d.updated)
  const link = d.url
    ? `<div class="${styles.popupParcelSrc}"><a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">Full incident page — InciWeb ↗</a></div>`
    : `<div class="${styles.popupParcelSrc}">Source: InciWeb</div>`
  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">${esc(d.name || 'Named incident')}` +
    `<span class="${styles.popupParcelApn}">InciWeb</span></div>` +
    rows + link + '</div>'
}
