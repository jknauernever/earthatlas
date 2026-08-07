// ─── Building footprints (Microsoft Building Footprints via Esri) ───────────
// 125M ML-generated US building footprints, served as native Mapbox vector tiles
// (no proxy/bridge). Two jobs:
//   1. VISUAL — footprint outlines, shown whenever the Property parcels layer is
//      on (they travel together: parcels + what's built on them).
//   2. ANALYSIS — queried on EVERY click (like parcels) so the popup can say
//      whether a parcel is developed or vacant, and stop describing empty land
//      as "a home". Because the analysis needs the features even when the layer
//      is visually off, the fill stays queryable (opacity 0) at all times.
//
// US only. Footprints are tiny, so they only render/query at high zoom.

import styles from './FireApp.module.css'

const SRC = 'fire-buildings-src'
const FILL = 'fire-buildings-fill'
const LINE = 'fire-buildings-line'

// Esri Living Atlas hosted Microsoft Building Footprints vector tile service.
const TILE_URL = 'https://tiles.arcgis.com/tiles/P3ePLMYs2RVChkJx/arcgis/rest/services/Microsoft_Building_Footprints/VectorTileServer/tile/{z}/{y}/{x}.pbf'
const SOURCE_LAYER = 'MSBFLow'
const SERVICE_MAXZOOM = 16

// Footprints are only meaningful (and only rendered/queried) from here up. Below
// this, absence of buildings means "not loaded", NOT "vacant" — so the narrative
// must not assert "undeveloped" when zoomed out past this.
export const BUILDINGS_MIN_ZOOM = 14

const FILL_COLOR = '#f2efe9' // warm off-white — reads as building on satellite
const LINE_COLOR = '#6b7280'

export const BUILDINGS_SOURCE_CITATION = {
  short: 'Microsoft Building Footprints (via Esri Living Atlas)',
  tag: 'MS Building Footprints',
  url: 'https://www.arcgis.com/home/item.html?id=f40326b0dea54330ae39584012807126',
}

// ─── Map: add source + layers (idempotent; called on every style.load) ──────
// `parcelsOn` = is the parcels layer currently visible (drives the visual).
export function addBuildingsLayers(map, parcelsOn) {
  if (!map.getSource(SRC)) {
    map.addSource(SRC, {
      type: 'vector',
      tiles: [TILE_URL],
      minzoom: BUILDINGS_MIN_ZOOM,
      maxzoom: SERVICE_MAXZOOM,
      attribution: 'Microsoft Building Footprints · Esri',
    })
  }
  if (!map.getLayer(FILL)) {
    // Always visibility:'visible' so queryRenderedFeatures works on every click
    // for the analysis; opacity carries the on/off (0 when parcels are off).
    map.addLayer({
      id: FILL, type: 'fill', source: SRC, 'source-layer': SOURCE_LAYER, minzoom: BUILDINGS_MIN_ZOOM,
      layout: { visibility: 'visible' },
      paint: { 'fill-color': FILL_COLOR, 'fill-opacity': parcelsOn ? 0.6 : 0 },
    })
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE, type: 'line', source: SRC, 'source-layer': SOURCE_LAYER, minzoom: BUILDINGS_MIN_ZOOM,
      layout: { visibility: parcelsOn ? 'visible' : 'none' },
      paint: { 'line-color': LINE_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.4, 17, 1.2], 'line-opacity': 0.9 },
    })
  }
}

// Visual on/off follows the parcels layer.
export function applyBuildingsVisibility(map, parcelsOn) {
  if (map.getLayer(FILL)) map.setPaintProperty(FILL, 'fill-opacity', parcelsOn ? 0.6 : 0)
  if (map.getLayer(LINE)) map.setLayoutProperty(LINE, 'visibility', parcelsOn ? 'visible' : 'none')
}

export function restackBuildings(map) {
  for (const id of [FILL, LINE]) {
    try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ }
  }
}

// ─── Geometry helpers (all in lng/lat) ──────────────────────────────────────
function eachRing(geometry, fn) {
  if (!geometry) return
  if (geometry.type === 'Polygon') geometry.coordinates.forEach((r) => fn(r))
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((poly) => poly.forEach((r) => fn(r)))
}

function bboxOf(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  eachRing(geometry, (ring) => ring.forEach(([x, y]) => {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y
  }))
  return Number.isFinite(w) ? [w, s, e, n] : null
}

function centroidOf(geometry) {
  let sx = 0, sy = 0, count = 0
  eachRing(geometry, (ring) => ring.forEach(([x, y]) => { sx += x; sy += y; count++ }))
  return count ? [sx / count, sy / count] : null
}

// Ray-casting point-in-polygon against a single ring.
function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j]
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside
  }
  return inside
}
// Point in a Polygon/MultiPolygon (outer rings; parcels rarely have holes).
function pointInGeometry(pt, geometry) {
  if (!pt || !geometry) return false
  if (geometry.type === 'Polygon') return pointInRing(pt, geometry.coordinates[0])
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => pointInRing(pt, poly[0]))
  return false
}

// ─── Count building footprints whose centroid falls inside a parcel ─────────
// Queries the rendered building fill over the parcel's extent, then keeps the
// ones actually inside the parcel polygon. Only meaningful at z ≥ BUILDINGS_MIN_
// ZOOM — the caller gates on that. Returns { count } or null (can't tell).
export function queryBuildingsForParcel(map, parcelGeometry) {
  if (!map.getLayer(FILL) || !parcelGeometry) return null
  if (map.getZoom() < BUILDINGS_MIN_ZOOM) return null
  const bb = bboxOf(parcelGeometry)
  if (!bb) return null
  const p1 = map.project([bb[0], bb[3]])
  const p2 = map.project([bb[2], bb[1]])
  const box = [[Math.min(p1.x, p2.x), Math.min(p1.y, p2.y)], [Math.max(p1.x, p2.x), Math.max(p1.y, p2.y)]]
  let feats = []
  try { feats = map.queryRenderedFeatures(box, { layers: [FILL] }) } catch { return null }
  const seen = new Set()
  let count = 0
  for (const f of feats) {
    const c = centroidOf(f.geometry)
    if (!c) continue
    // Dedup footprints split across tile boundaries by rounded centroid (~1 m).
    const key = `${c[0].toFixed(5)},${c[1].toFixed(5)}`
    if (seen.has(key)) continue
    seen.add(key)
    if (pointInGeometry(c, parcelGeometry)) count++
  }
  return { count }
}

// Fallback when the click isn't on a parcel: is the click point on a building?
export function buildingAtPoint(map, point) {
  if (!map.getLayer(FILL) || map.getZoom() < BUILDINGS_MIN_ZOOM) return null
  let feats = []
  try { feats = map.queryRenderedFeatures(point, { layers: [FILL] }) } catch { return null }
  return { onBuilding: feats.length > 0 }
}

// ─── Plain-language structure phrase for the popup narrative ────────────────
// { count } → a natural noun phrase; null → null (unknown, e.g. zoomed out).
export function structuresPhrase(buildings) {
  if (!buildings || typeof buildings.count !== 'number') return null
  const n = buildings.count
  if (n === 0) return { count: 0, developed: false, word: 'no structures' }
  if (n === 1) return { count: 1, developed: true, word: 'one structure' }
  if (n <= 4) return { count: n, developed: true, word: `${n} structures` }
  return { count: n, developed: true, word: `about ${n} structures` }
}

// Inline source line for the popup building row (provenance).
export function buildingsSourceHtml() {
  return `<a href="${BUILDINGS_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${BUILDINGS_SOURCE_CITATION.short}">Microsoft Building Footprints ↗</a>`
}
