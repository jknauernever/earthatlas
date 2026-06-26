// ─── Active fires: NASA FIRMS satellite hotspots (GeoJSON points) ───────────
// Unlike the raster risk layers (ArcGIS ImageServers) and the parcels vector
// layer (PMTiles), FIRMS is a viewport-driven GeoJSON point layer: on each pan/
// zoom we fetch the current map bbox from /api/firms (which proxies NASA FIRMS,
// keeps the MAP_KEY server-side, and returns detections as GeoJSON with an
// `hours_ago` computed server-side — see api/_firms-core.js). The map just
// styles points by detection age, newest = hottest.
//
// One catalog entry, `kind:'firms'`, slots into the same panel/legend/URL-state/
// drag-reorder machinery as every other layer; the map effects branch on the
// kind to take the GeoJSON path (fetch-on-move) instead of the raster path.

import styles from './FireApp.module.css'

const SRC = 'fire-firms-src'
const GLOW = 'fire-firms-glow'   // soft halo under each point (the "heat" look)
const DOT = 'fire-firms-dot'     // the crisp detection dot on top
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Detection-age color ramp (hours since the satellite saw it). Freshest burns
// hottest; older detections within the window cool toward amber. These double as
// the legend swatches below.
const AGE_COLORS = {
  fresh: '#ff2d00', // ≤ 12 h
  recent: '#ff7a00', // 12–24 h
  day: '#ffb300', // 24–48 h
  older: '#ffd98a', // > 48 h
}

// Below this zoom the viewport bbox approaches the whole globe and a one-day
// VIIRS pull gets large; we gate the fetch (and show a "zoom in" hint) instead.
export const FIRMS_MIN_ZOOM = 3

// Default look-back window (days). FIRMS DAY_RANGE counts UTC *calendar* days, so
// days=1 only returns the current UTC day — near-empty for the first hours after
// 00:00 UTC. days=2 always spans a full recent day's worth of overpasses
// regardless of clock time, which is the honest "active fires" footprint; the
// age coloring then distinguishes the freshest detections within it.
export const FIRMS_DEFAULT_DAYS = 2

// Same-origin serverless endpoint; can be repointed for plain-vite QA that lacks
// /api (parity with the parcels VITE_PARCEL_TILES_BASE escape hatch).
const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()

// ─── Catalog entry ──────────────────────────────────────────────────────────
// Always present (global coverage), unlike parcels which appears only when a
// region is baked. Shaped like the raster layers so the panel renders it free.
export const FIRMS_LAYER = {
  id: 'firms',
  kind: 'firms',
  label: 'Active Hotspots',
  group: 'Active fire',
  defaultOpacity: 0.9,
  minZoom: FIRMS_MIN_ZOOM,
  coverage: 'Global · NASA FIRMS, last 48 h · zoom in to load',
  legend: {
    kind: 'swatches',
    items: [
      { c: AGE_COLORS.fresh, l: 'Last 12 hours' },
      { c: AGE_COLORS.recent, l: '12–24 hours' },
      { c: AGE_COLORS.day, l: '1–2 days' },
      { c: AGE_COLORS.older, l: 'Over 2 days' },
    ],
  },
  blurb:
    'Satellite-detected active fire and thermal hotspots from NASA FIRMS (VIIRS, 375 m), refreshed through the most recent overpass. Each dot is a heat detection, colored by how recently the satellite saw it — this is where fire is burning now, not a risk model. Over North America it uses the faster US/Canada feed (~30 min); elsewhere it is near-real-time (~3 h). Points, not perimeters; for official incident perimeters use the Active wildfires layer.',
  source: 'NASA FIRMS · VIIRS (S-NPP / NOAA-20 / NOAA-21) near-real-time',
}

// Inline citation for the sourcing modal + per-attribute provenance.
export const FIRMS_SOURCE_CITATION = {
  short: 'NASA FIRMS · VIIRS active fire (NRT)',
  tag: 'NASA FIRMS',
  url: 'https://firms.modaps.eosdis.nasa.gov',
}

const ageColorExpr = () => [
  'step', ['coalesce', ['get', 'hours_ago'], 999],
  AGE_COLORS.fresh,
  12, AGE_COLORS.recent,
  24, AGE_COLORS.day,
  48, AGE_COLORS.older,
]

// Dot radius grows with zoom and nudges up with fire radiative power (FRP, MW)
// so the big, intense detections read as bigger.
const radiusExpr = () => [
  'interpolate', ['linear'], ['zoom'],
  3, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 1.6, 50, 3],
  7, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 3, 100, 6],
  11, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 5, 200, 11],
]

// ─── Map: add source + layers (idempotent; called on every style.load) ──────
export function addFirmsLayer(map, isOn, op) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, { type: 'geojson', data: EMPTY_FC, attribution: FIRMS_LAYER.source })
  }
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? FIRMS_LAYER.defaultOpacity
  if (!map.getLayer(GLOW)) {
    map.addLayer({
      id: GLOW, type: 'circle', source: SRC, minzoom: FIRMS_MIN_ZOOM,
      layout: { visibility: vis },
      paint: {
        'circle-color': ageColorExpr(),
        // Soft halo ≈ 2.5× the dot, giving each detection a "heat" bloom.
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          3, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 4, 50, 8],
          7, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 8, 100, 16],
          11, ['interpolate', ['linear'], ['coalesce', ['get', 'frp'], 0], 0, 13, 200, 28],
        ],
        'circle-blur': 1,
        'circle-opacity': 0.35 * o,
      },
    })
  }
  if (!map.getLayer(DOT)) {
    map.addLayer({
      id: DOT, type: 'circle', source: SRC, minzoom: FIRMS_MIN_ZOOM,
      layout: { visibility: vis },
      paint: {
        'circle-color': ageColorExpr(),
        'circle-radius': radiusExpr(),
        'circle-opacity': o,
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0, 8, 0.6],
        'circle-stroke-color': '#3a0a00',
        'circle-stroke-opacity': 0.5 * o,
      },
    })
  }
}

export function applyFirmsVisibility(map, isOn) {
  const vis = isOn ? 'visible' : 'none'
  for (const id of [GLOW, DOT]) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
}

export function applyFirmsOpacity(map, op) {
  if (map.getLayer(GLOW)) map.setPaintProperty(GLOW, 'circle-opacity', 0.35 * op)
  if (map.getLayer(DOT)) {
    map.setPaintProperty(DOT, 'circle-opacity', op)
    map.setPaintProperty(DOT, 'circle-stroke-opacity', 0.5 * op)
  }
}

export function restackFirms(map) {
  for (const id of [GLOW, DOT]) {
    try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ }
  }
}

// ─── Fetch current viewport detections → setData ────────────────────────────
// Called (debounced) on moveend while the layer is on and zoom ≥ FIRMS_MIN_ZOOM.
// Returns { count, truncated } or null on failure/abort. `signal` lets the
// caller cancel a stale in-flight fetch when the user keeps panning.
export async function refreshFirms(map, { days = FIRMS_DEFAULT_DAYS, signal } = {}) {
  const b = map.getBounds()
  const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
    .map((n) => n.toFixed(3)).join(',')
  const url = `${API_BASE}/api/firms?bbox=${bbox}&days=${days}`
  const r = await fetch(url, { signal })
  const fc = await r.json()
  const src = map.getSource(SRC)
  if (src && fc && fc.type === 'FeatureCollection') {
    src.setData(fc)
    return { count: fc._count ?? fc.features.length, truncated: !!fc._truncated }
  }
  return null
}

export function clearFirms(map) {
  const src = map.getSource(SRC)
  if (src) src.setData(EMPTY_FC)
}

// ─── Click → detection near the point (for the shared popup) ────────────────
// Queries a small pixel box around the click, not the exact pixel, so clicking
// near a small dot still registers. When several detections fall in the box, the
// freshest (smallest hours_ago) wins — that's the one a reader cares about.
const HIT_PAD = 7
export function queryFirmsAt(map, point) {
  if (!map.getLayer(DOT)) return null
  const box = [
    [point.x - HIT_PAD, point.y - HIT_PAD],
    [point.x + HIT_PAD, point.y + HIT_PAD],
  ]
  let feats = []
  try { feats = map.queryRenderedFeatures(box, { layers: [DOT] }) } catch { return null }
  if (!feats.length) return null
  feats.sort((a, b) => (a.properties.hours_ago ?? 1e9) - (b.properties.hours_ago ?? 1e9))
  return feats[0].properties || null
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function ageText(h) {
  if (h == null) return 'recent overpass'
  if (h < 1) return 'within the last hour'
  if (h < 24) return `${Math.round(h)} h ago`
  const d = h / 24
  return d < 2 ? 'about a day ago' : `${Math.round(d)} days ago`
}

const SAT_NAME = { N20: 'NOAA-20', N21: 'NOAA-21', N: 'Suomi NPP', '1': 'NOAA-20', Aqua: 'Aqua', Terra: 'Terra' }

// Render the "Active fire detection" card for the shared popup. `d` = properties
// from queryFirmsAt, or null → ''. Sits at the top of the popup like the parcel
// card: this is ground-truth heat, the most urgent thing at a clicked point.
export function renderFirmsCard(d) {
  if (!d) return ''
  const sat = SAT_NAME[d.sat] || d.sat || 'VIIRS'
  const conf = d.conf ? `${d.conf} confidence` : ''
  const frp = d.frp != null ? `${Number(d.frp).toFixed(1)} MW` : null

  const rows =
    `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Detected</span>` +
      `<span class="${styles.popupRowValue}">${esc(ageText(d.hours_ago))}${d.dn ? ` (${esc(d.dn)})` : ''}</span></div>` +
    `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Satellite</span>` +
      `<span class="${styles.popupRowValue}">${esc(sat)} · VIIRS${conf ? ` · ${esc(conf)}` : ''}</span></div>` +
    (frp ? `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Fire power</span>` +
      `<span class="${styles.popupRowValue}">${esc(frp)} (radiative)</span></div>` : '')

  const src = `<div class="${styles.popupParcelSrc}">Detection: ` +
    `<a href="${FIRMS_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${esc(FIRMS_SOURCE_CITATION.short)}">NASA FIRMS ↗</a></div>`

  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">Active fire detection` +
    `<span class="${styles.popupParcelApn}">satellite hotspot</span></div>` +
    rows + src + '</div>'
}
