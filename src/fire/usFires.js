// ─── Active wildfires (US): WFIGS perimeters + InciWeb names, merged ─────────
// One layer, two sources, unified naming:
//   • NIFC WFIGS gives official mapped PERIMETERS (+ size/containment/cause).
//   • InciWeb gives NAMED incidents (name + public page), often where WFIGS has
//     no perimeter yet.
// We render the WFIGS perimeters, then a single deduplicated set of NAMED points
// — one marker + one label per fire — so a fire that appears in BOTH sources is
// printed once (the WFIGS record wins; it carries the perimeter). Every fire is
// labelled the same way, InciWeb-style.

import styles from './FireApp.module.css'
import { renderNifcCard } from './nifc.js'
import { renderInciwebCard } from './inciweb.js'

const PERIM_SRC = 'fire-usfires-perim-src'
const PTS_SRC = 'fire-usfires-pts-src'
const FILL = 'fire-usfires-fill'
const LINE = 'fire-usfires-line'
const DOT = 'fire-usfires-dot'
const LABEL = 'fire-usfires-label'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

// Perimeter/marker colors by containment (WFIGS); InciWeb-only fires in rose.
const COL_UNCONTAINED = '#ff3b30'
const COL_PARTIAL = '#ff9500'
const COL_CONTAINED = '#9aa0a6'
const COL_INCIWEB = '#e11d48'

const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()
let cachedPerim = null
let cachedPts = null

export const US_FIRES_LAYER = {
  id: 'usfires',
  kind: 'usfires',
  label: 'Active wildfires (US)',
  group: 'Active fire',
  defaultOpacity: 0.9,
  minZoom: 0,
  coverage: 'US · official perimeters (NIFC) + named incidents (InciWeb)',
  legend: {
    kind: 'swatches',
    items: [
      { c: COL_UNCONTAINED, l: 'Uncontained perimeter' },
      { c: COL_PARTIAL, l: 'Partly contained' },
      { c: COL_CONTAINED, l: 'Contained (recent)' },
      { c: COL_INCIWEB, l: 'Named incident (no perimeter yet)' },
    ],
  },
  blurb:
    'Active US wildfires, combining two official sources into one named layer: NIFC WFIGS supplies the mapped perimeters (with size, containment and cause), and InciWeb supplies named incidents — including fires that don’t have a mapped perimeter yet. Every fire is labelled by name on the map; where a fire appears in both sources it’s shown once (the WFIGS record, which carries the perimeter). Click any fire for its details, including the InciWeb page link where available. US only; both feeds lag real-time crowd-sourced apps and small/new fires may not appear.',
  source: 'NIFC WFIGS · InciWeb (NWCG)',
}

export const US_FIRES_SOURCE_CITATION = {
  short: 'NIFC WFIGS + InciWeb', tag: 'NIFC / InciWeb',
  url: 'https://data-nifc.opendata.arcgis.com/datasets/nifc::wfigs-current-interagency-fire-perimeters/about',
}

const containmentColorExpr = () => ['case',
  ['>=', ['coalesce', ['get', 'contained'], -1], 100], COL_CONTAINED,
  ['>', ['coalesce', ['get', 'contained'], 0], 0], COL_PARTIAL,
  COL_UNCONTAINED,
]

// ─── Flame markers (Watch Duty–style) ───────────────────────────────────────
// The named-fire dots are rendered as plump flame glyphs, tinted by containment
// (red uncontained → orange partly → gray contained; rose = named/no perimeter).
// One canvas image per state, baked with a white halo + inner highlight, added
// as a Mapbox symbol icon. `iconKey` on each point picks the image.
const FLAME_STATE = (source, contained) =>
  source === 'inciweb' ? 'named'
    : contained != null && contained >= 100 ? 'contained'
      : contained != null && contained > 0 ? 'partial'
        : 'uncontained'

// [fill, inner-highlight] per state — matches the approved mockup.
const FLAME_ICONS = {
  uncontained: [COL_UNCONTAINED, '#ffd98a'],
  partial: [COL_PARTIAL, '#ffe6b0'],
  contained: [COL_CONTAINED, '#e6e9ec'],
  named: [COL_INCIWEB, '#ffc2d1'],
}
const FLAME_PATH = 'M24 3 C 31 13 43 19 40.5 32 C 39 40.6 32.6 46 24 46 C 15.4 46 9 40.6 7.5 32 C 5 19 17 13 24 3 Z'
const FLAME_INNER = 'M24 20 C 28 25 34 28 32 35 C 31 39.6 27.6 43 24 43 C 20.4 43 17 39.6 16 35 C 14 28 20 25 24 20 Z'

// Draw one flame into an offscreen canvas → {width,height,data,pixelRatio}.
function makeFlameImage(fill, inner) {
  const S = 2, W = 52, H = 56 // logical box (flame ~48 tall + halo pad); S = supersample
  const cv = document.createElement('canvas')
  cv.width = W * S; cv.height = H * S
  const ctx = cv.getContext('2d')
  ctx.scale(S, S)
  ctx.translate((W - 48) / 2, (H - 50) / 2)
  const flame = new Path2D(FLAME_PATH)
  const glint = new Path2D(FLAME_INNER)
  ctx.lineJoin = 'round'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3
  ctx.stroke(flame); ctx.stroke(flame) // white halo (doubled = solid)
  ctx.fillStyle = fill; ctx.fill(flame)
  ctx.globalAlpha = 0.8; ctx.fillStyle = inner; ctx.fill(glint); ctx.globalAlpha = 1
  const img = ctx.getImageData(0, 0, cv.width, cv.height)
  return { width: cv.width, height: cv.height, data: img.data, pixelRatio: S }
}

// Idempotently register every flame icon (re-added after a style reload).
function ensureFlameIcons(map) {
  for (const [key, [fill, inner]] of Object.entries(FLAME_ICONS)) {
    const id = `usfire-${key}`
    if (map.hasImage(id)) continue
    const im = makeFlameImage(fill, inner)
    map.addImage(id, { width: im.width, height: im.height, data: im.data }, { pixelRatio: im.pixelRatio })
  }
}

// ─── geometry helpers ───────────────────────────────────────────────────────
function centroidOf(geometry) {
  let sx = 0, sy = 0, n = 0
  const ring = (r) => r.forEach(([x, y]) => { sx += x; sy += y; n++ })
  if (geometry.type === 'Polygon') geometry.coordinates.forEach(ring)
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((p) => p.forEach(ring))
  else return null
  return n ? [sx / n, sy / n] : null
}
// Normalize a fire name for matching: drop "fire"/"complex" and punctuation.
const normName = (s) => String(s || '').toLowerCase().replace(/\b(fire|complex)\b/g, '').replace(/[^a-z0-9]/g, '')
// Rough km between two lng/lat.
function kmBetween(a, b) {
  const dx = (a[0] - b[0]) * 111 * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180)
  const dy = (a[1] - b[1]) * 111
  return Math.hypot(dx, dy)
}

// ─── Map layers (idempotent) ────────────────────────────────────────────────
export function addUsFiresLayers(map, isOn, op) {
  ensureFlameIcons(map)
  if (!map.getSource(PERIM_SRC)) map.addSource(PERIM_SRC, { type: 'geojson', data: cachedPerim || EMPTY_FC, attribution: US_FIRES_LAYER.source })
  if (!map.getSource(PTS_SRC)) map.addSource(PTS_SRC, { type: 'geojson', data: cachedPts || EMPTY_FC })
  const vis = isOn ? 'visible' : 'none'
  const o = op ?? US_FIRES_LAYER.defaultOpacity
  if (!map.getLayer(FILL)) {
    map.addLayer({
      id: FILL, type: 'fill', source: PERIM_SRC,
      layout: { visibility: 'visible' }, // stays queryable for clicks when off
      paint: { 'fill-color': containmentColorExpr(), 'fill-opacity': isOn ? 0.18 * o : 0 },
    })
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE, type: 'line', source: PERIM_SRC,
      layout: { visibility: vis, 'line-join': 'round' },
      paint: { 'line-color': containmentColorExpr(), 'line-opacity': o, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 2, 12, 3] },
    })
  }
  if (!map.getLayer(DOT)) {
    // Flame glyph tinted by containment (Watch Duty style). Stays 'visible' so
    // clicks register even when the layer is toggled off; opacity carries on/off.
    map.addLayer({
      id: DOT, type: 'symbol', source: PTS_SRC,
      layout: {
        visibility: 'visible',
        'icon-image': ['concat', 'usfire-', ['coalesce', ['get', 'iconKey'], 'uncontained']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.42, 8, 0.58, 12, 0.72],
        'icon-anchor': 'center',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: { 'icon-opacity': isOn ? o : 0 },
    })
  }
  if (!map.getLayer(LABEL)) {
    // Uniform name labels for every fire (the InciWeb style). Offset below the
    // flame so the icon and text don't overlap.
    map.addLayer({
      id: LABEL, type: 'symbol', source: PTS_SRC,
      layout: {
        visibility: vis,
        'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.6],
        'text-anchor': 'top', 'text-max-width': 9, 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)', 'text-halo-width': 1.4, 'text-opacity': o },
    })
  }
}

export function applyUsFiresVisibility(map, isOn, op) {
  const o = op ?? US_FIRES_LAYER.defaultOpacity
  const vis = isOn ? 'visible' : 'none'
  if (map.getLayer(LINE)) map.setLayoutProperty(LINE, 'visibility', vis)
  if (map.getLayer(LABEL)) map.setLayoutProperty(LABEL, 'visibility', vis)
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.18 * o : 0)
  if (map.getLayer(DOT)) map.setPaintProperty(DOT, 'icon-opacity', isOn ? o : 0)
}

export function applyUsFiresOpacity(map, op, isOn) {
  if (map.getLayer(LINE)) map.setPaintProperty(LINE, 'line-opacity', op)
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', isOn ? 0.18 * op : 0)
  if (map.getLayer(LABEL)) map.setPaintProperty(LABEL, 'text-opacity', op)
  if (map.getLayer(DOT) && isOn) map.setPaintProperty(DOT, 'icon-opacity', op)
}

export function restackUsFires(map) {
  for (const id of [FILL, LINE, DOT, LABEL]) { try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ } }
}

// ─── Load + merge + dedup ───────────────────────────────────────────────────
// Three sources, one deduplicated set of named points:
//   • WFIGS incident LOCATIONS (points) — the comprehensive list of every active
//     fire, incl. small/new ones with no mapped perimeter yet. This is the bulk.
//   • WFIGS PERIMETERS (polygons) — the mapped-boundary subset; drawn as fill/line
//     and, for any perimeter with no matching incident point, a fallback marker.
//   • InciWeb — adds the official incident-page link (and any name the WFIGS feeds
//     somehow miss).
// Prescribed burns (RX) are excluded — this is the wildfire layer.
export async function loadUsFires(map, { signal } = {}) {
  const [perimFC, incFC, inciFC] = await Promise.all([
    fetch(`${API_BASE}/api/nifc?layer=perimeters`, { signal }).then((r) => r.json()).catch(() => null),
    fetch(`${API_BASE}/api/nifc?layer=incidents`, { signal }).then((r) => r.json()).catch(() => null),
    fetch(`${API_BASE}/api/inciweb`, { signal }).then((r) => r.json()).catch(() => null),
  ])
  const perims = (perimFC && perimFC.features) || []
  const incidents = (incFC && incFC.features) || []
  const pts = []
  const seen = [] // {norm, c:[lng,lat]} — dedup across all three sources

  // Every active wildfire from the incident-locations feed (WF + CX; drop RX).
  for (const f of incidents) {
    if (!f.geometry || f.geometry.type !== 'Point') continue
    const p = f.properties || {}
    if (!p.name) continue
    const t = String(p.type || '').toUpperCase()
    if (t && t !== 'WF' && t !== 'CX') continue // exclude prescribed burns etc.
    seen.push({ norm: normName(p.name), c: f.geometry.coordinates })
    pts.push({ type: 'Feature', geometry: f.geometry, properties: { ...p, source: 'wfigs', iconKey: FLAME_STATE('wfigs', p.contained) } })
  }
  // Perimeters with no matching incident point still get a centroid marker.
  for (const f of perims) {
    if (!f.geometry) continue
    const p = f.properties || {}
    if (!p.name) continue
    const c = centroidOf(f.geometry)
    if (!c) continue
    const n = normName(p.name)
    if (seen.some((s) => s.norm && s.norm === n && kmBetween(s.c, c) < 25)) continue
    seen.push({ norm: n, c })
    pts.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { ...p, source: 'wfigs', iconKey: FLAME_STATE('wfigs', p.contained) } })
  }
  // InciWeb points, minus any already covered (same name within ~25 km).
  for (const f of ((inciFC && inciFC.features) || [])) {
    if (!f.geometry) continue
    const [lng, lat] = f.geometry.coordinates
    const p = f.properties || {}
    const n = normName(p.name)
    if (seen.some((s) => s.norm && s.norm === n && kmBetween(s.c, [lng, lat]) < 25)) continue
    seen.push({ norm: n, c: [lng, lat] })
    pts.push({ type: 'Feature', geometry: f.geometry, properties: { ...p, source: 'inciweb', iconKey: 'named' } })
  }
  cachedPerim = perimFC && perimFC.type === 'FeatureCollection' ? perimFC : EMPTY_FC
  cachedPts = { type: 'FeatureCollection', features: pts }
  if (map.getSource(PERIM_SRC)) map.getSource(PERIM_SRC).setData(cachedPerim)
  if (map.getSource(PTS_SRC)) map.getSource(PTS_SRC).setData(cachedPts)
  const inciwebOnly = pts.filter((f) => f.properties.source === 'inciweb').length
  return { perimeters: perims.length, named: pts.length, inciweb: inciwebOnly }
}

// ─── Click → card (perimeter or named point) ────────────────────────────────
export function queryUsFiresAt(map, point) {
  // Prefer the named point marker (specific fire); fall back to the perimeter.
  if (map.getLayer(DOT)) {
    let f = []
    try { f = map.queryRenderedFeatures([[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]], { layers: [DOT] }) } catch { /* */ }
    if (f.length) return f[0].properties || null
  }
  if (map.getLayer(FILL)) {
    let f = []
    try { f = map.queryRenderedFeatures(point, { layers: [FILL] }) } catch { /* */ }
    if (f.length) {
      f.sort((a, b) => (a.properties.acres ?? 1e12) - (b.properties.acres ?? 1e12))
      return { ...f[0].properties, source: 'wfigs' }
    }
  }
  return null
}

export function renderUsFiresCard(d) {
  if (!d) return ''
  return d.source === 'inciweb' ? renderInciwebCard(d) : renderNifcCard(d)
}
