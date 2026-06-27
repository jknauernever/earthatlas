// ─── Parcels: vector property boundaries (PMTiles) ──────────────────────────
// Unlike the 8 raster fire layers (ArcGIS ImageServers bridged to Mapbox), the
// parcels layer is a NATIVE Mapbox vector source read straight from a .pmtiles
// file on Vercel Blob (Mapbox GL JS ≥3.21 handles the HTTP range requests). No
// tile server, no per-click lookup — owner/APN/acreage are baked into the tile
// and read with queryRenderedFeatures.
//
// One logical "Parcels" catalog entry can fan out to many regions; each region
// is its own PMTiles source. Field names are normalized at BAKE time (see
// scripts/bake-parcels), so every region shares one canonical property schema
// and this file needs no per-region fieldMap.
//
// Canonical tile properties:
//   apn, owner, owner2, addr, city, zip, land_use, acres, county,
//   structures, tax_year, region_id   (+ assessed_value where a region has it)

import sources from './parcelSources.json'
import styles from './FireApp.module.css'

// Static per-region metadata. The dynamic bits (pmtilesUrl, sourceLayer,
// version) come from parcelSources.json, written by scripts/bake-parcels/upload.mjs.
const PARCEL_REGISTRY = {
  nm: {
    id: 'nm',
    label: 'New Mexico',
    minZoom: 13,
    maxZoom: 16, // matches the tippecanoe bake; Mapbox over-zooms past this
    bbox: [-109.05, 31.33, -103.0, 37.0], // source bounds → no tile requests outside the state
    attribution: 'Parcel data: NM TRD PTD / County Assessors, via NM OSE',
    citation: { short: 'NM TRD PTD / County Assessors via NM OSE', tag: 'NM OSE parcels', url: 'https://gis.ose.nm.gov' },
  },
  'sanjuan-wa': {
    id: 'sanjuan-wa',
    label: 'San Juan County, WA',
    minZoom: 13,
    maxZoom: 16,
    bbox: [-123.25, 48.35, -122.7, 48.8],
    attribution: 'Parcel data: San Juan County Assessor (WA)',
    citation: { short: 'San Juan County Assessor (WA)', tag: 'San Juan County parcels', url: 'https://www.sanjuanco.com/167/Assessor' },
  },
}

// Regions that are actually deployable right now = registered AND have a baked
// PMTiles URL in the manifest. Empty manifest ⇒ no parcels layer at all (the
// FireApp behaves exactly as before).
export const ACTIVE_PARCEL_REGIONS = Object.values(PARCEL_REGISTRY)
  .map((r) => ({ ...r, ...(sources[r.id] || {}) }))
  .filter((r) => r.pmtilesUrl && r.sourceLayer)

// ─── Colors / map ids ───────────────────────────────────────────────────────
// Cool cyan stands apart from the warm red/orange fire-risk rasters.
const PARCEL_COLOR = '#38bdf8'
const SEL_COLOR = '#ffd400'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

const SRC = (region) => `fire-parcels-${region}-src`
const FILL = (region) => `fire-parcels-${region}-fill`
const LINE = (region) => `fire-parcels-${region}-line`
const SEL_SRC = 'fire-parcel-sel-src'
const SEL_LINE = 'fire-parcel-sel-line'

const fillOpacity = (op, isOn) => (isOn ? Math.min(0.18, (op ?? 0.9) * 0.12) : 0)

// Tile endpoint base. Can be pointed at a standalone tile server for local QA on
// the plain-vite preview (which lacks /api) via VITE_PARCEL_TILES_BASE. .trim()
// guards stray newlines.
//
// MUST be an ABSOLUTE URL: Mapbox GL fetches vector tiles inside a Web Worker,
// which has no document base, so a relative template ('/api/parcel-tiles?…')
// throws "Failed to construct 'Request': Failed to parse URL" on every tile and
// no parcels render (raster layers escape this — they load on the main thread).
// So when no override is set, default to the page origin rather than '' — same
// endpoint, but absolute.
const ENV_TILES_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_PARCEL_TILES_BASE) || '').trim()
const TILES_BASE = ENV_TILES_BASE || (typeof window !== 'undefined' ? window.location.origin : '')
const tileTemplate = (r) => `${TILES_BASE}/api/parcel-tiles?r=${r.id}&v=${r.version}&z={z}&x={x}&y={y}`

// ─── Catalog entry ──────────────────────────────────────────────────────────
// Returns the FIRE_LAYERS entry for parcels, or null when no region is live.
// Shaped exactly like a raster layer so the panel row / legend / URL-state /
// drag-reorder machinery renders it for free; `kind:'parcels'` tells the map
// effects to take the vector branch instead of the raster one.
export function buildParcelsLayer() {
  if (!ACTIVE_PARCEL_REGIONS.length) return null
  const names = ACTIVE_PARCEL_REGIONS.map((r) => r.label).join(', ')
  return {
    id: 'parcels',
    kind: 'parcels',
    label: 'Property parcels',
    group: 'Property & ownership',
    defaultOpacity: 0.9,
    minZoom: Math.min(...ACTIVE_PARCEL_REGIONS.map((r) => r.minZoom)),
    coverage: `${names} · zoom in to view boundaries`,
    legend: {
      kind: 'swatches',
      items: [{ c: PARCEL_COLOR, l: 'Parcel boundary' }],
    },
    blurb:
      'Property parcel boundaries with owner, parcel ID, acreage and land use from county assessor records. ' +
      'Click any parcel — even with this layer switched off — to read its details and the wildfire risk to that specific property. Public assessor data.',
    source: ACTIVE_PARCEL_REGIONS.map((r) => r.citation.short).join(' · '),
  }
}

// ─── Map: add sources + layers (idempotent; called on every style.load) ─────
export function addParcelLayers(map, isOn, op) {
  for (const r of ACTIVE_PARCEL_REGIONS) {
    const srcId = SRC(r.id)
    if (!map.getSource(srcId)) {
      // Vector tiles come from our /api/parcel-tiles endpoint, which range-reads
      // the region's PMTiles server-side (see api/parcel-tiles.js). `&v=` busts
      // the CDN cache when the data is re-baked.
      map.addSource(srcId, {
        type: 'vector',
        tiles: [tileTemplate(r)],
        minzoom: r.minZoom,
        maxzoom: r.maxZoom || 16,
        ...(r.bbox ? { bounds: r.bbox } : {}), // don't request tiles outside the region
        attribution: r.attribution,
      })
    }
    const fillId = FILL(r.id)
    if (!map.getLayer(fillId)) {
      // Fill stays visibility:'visible' ALWAYS so queryRenderedFeatures returns
      // the parcel under the cursor even when the layer is toggled off (ambient
      // click context). Its opacity is 0 when off, faint when on.
      map.addLayer({
        id: fillId, type: 'fill', source: srcId, 'source-layer': r.sourceLayer, minzoom: r.minZoom,
        layout: { visibility: 'visible' },
        paint: { 'fill-color': PARCEL_COLOR, 'fill-opacity': fillOpacity(op, isOn) },
      })
    }
    const lineId = LINE(r.id)
    if (!map.getLayer(lineId)) {
      map.addLayer({
        id: lineId, type: 'line', source: srcId, 'source-layer': r.sourceLayer, minzoom: r.minZoom,
        layout: { visibility: isOn ? 'visible' : 'none', 'line-join': 'round' },
        paint: {
          'line-color': PARCEL_COLOR,
          'line-opacity': op ?? 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 16, 1.4],
        },
      })
    }
  }
  // Shared selection overlay (clicked parcel), drawn above everything.
  if (!map.getSource(SEL_SRC)) map.addSource(SEL_SRC, { type: 'geojson', data: EMPTY_FC })
  if (!map.getLayer(SEL_LINE)) {
    map.addLayer({
      id: SEL_LINE, type: 'line', source: SEL_SRC,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': SEL_COLOR, 'line-width': 2.5, 'line-opacity': 1 },
    })
  }
}

export function applyParcelVisibility(map, isOn, op) {
  for (const r of ACTIVE_PARCEL_REGIONS) {
    if (map.getLayer(LINE(r.id))) map.setLayoutProperty(LINE(r.id), 'visibility', isOn ? 'visible' : 'none')
    if (map.getLayer(FILL(r.id))) map.setPaintProperty(FILL(r.id), 'fill-opacity', fillOpacity(op, isOn))
  }
}

export function applyParcelOpacity(map, op, isOn) {
  for (const r of ACTIVE_PARCEL_REGIONS) {
    if (map.getLayer(LINE(r.id))) map.setPaintProperty(LINE(r.id), 'line-opacity', op)
    if (map.getLayer(FILL(r.id))) map.setPaintProperty(FILL(r.id), 'fill-opacity', fillOpacity(op, isOn))
  }
}

// Move parcel fill/line into z-order (called from restack for the 'parcels' id).
export function restackParcels(map) {
  for (const r of ACTIVE_PARCEL_REGIONS) {
    for (const id of [FILL(r.id), LINE(r.id)]) {
      try { if (map.getLayer(id)) map.moveLayer(id) } catch { /* mid style swap */ }
    }
  }
}

// Keep the selection highlight above all parcel/raster layers (called at the
// end of restack, after every other layer has been positioned).
export function raiseParcelSelection(map) {
  try { if (map.getLayer(SEL_LINE)) map.moveLayer(SEL_LINE) } catch { /* mid style swap */ }
}

// ─── Click → parcel under the point (sync; reads baked tile properties) ─────
export function queryParcelAt(map, point) {
  const fillIds = ACTIVE_PARCEL_REGIONS.map((r) => FILL(r.id)).filter((id) => map.getLayer(id))
  if (!fillIds.length) return null
  let feats = []
  try { feats = map.queryRenderedFeatures(point, { layers: fillIds }) } catch { return null }
  if (!feats.length) return null
  const f = feats[0]
  return { props: f.properties || {}, geometry: f.geometry, regionId: (f.properties || {}).region_id }
}

export function setParcelSelection(map, geometry) {
  const src = map.getSource(SEL_SRC)
  if (src) src.setData({ type: 'Feature', geometry, properties: {} })
}
export function clearParcelSelection(map) {
  const src = map.getSource(SEL_SRC)
  if (src) src.setData(EMPTY_FC)
}

// ─── Popup card ─────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function citationFor(regionId) {
  const r = ACTIVE_PARCEL_REGIONS.find((x) => x.id === regionId) || ACTIVE_PARCEL_REGIONS[0]
  return r ? r.citation : null
}

function row(label, value) {
  if (value == null || value === '') return ''
  return `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">${esc(label)}</span>` +
    `<span class="${styles.popupRowValue}">${esc(value)}</span></div>`
}

// Render the Property card for the popup. `parcel` = { props, regionId } from
// queryParcelAt; `fireText` = the cross-layer wildfire verdict (the synergy
// line — risk to THIS property), or null. Returns '' when there's no parcel.
export function renderParcelCard(parcel, fireText) {
  if (!parcel) return ''
  const p = parcel.props || {}
  const owner = [p.owner, p.owner2].filter(Boolean).join(' & ')
  const acres = p.acres != null ? `${Number(p.acres).toLocaleString()} ac` : null
  const cite = citationFor(parcel.regionId)

  const title = `<div class="${styles.popupParcelTitle}">Property` +
    (p.apn ? `<span class="${styles.popupParcelApn}">APN ${esc(p.apn)}</span>` : '') +
    `</div>`

  const rows =
    row('Owner', owner) +
    row('Acreage', acres) +
    row('Land use', p.land_use) +
    row('Address', p.addr || [p.city, p.zip].filter(Boolean).join(' ')) +
    (Number(p.assessed_value) > 0 ? row('Assessed value', `$${Number(p.assessed_value).toLocaleString()}`) : '') +
    (p.structures ? row('Structures', p.structures) : '') +
    (p.county ? row('County', p.county) : '')

  const fireLine = fireText
    ? `<div class="${styles.popupParcelFire}">Wildfire risk to this parcel: <strong>${esc(fireText)}</strong></div>`
    : ''

  const src = cite
    ? `<div class="${styles.popupParcelSrc}">Parcel data: ` +
      `<a href="${cite.url}" target="_blank" rel="noopener noreferrer" title="${esc(cite.short)}">${esc(cite.short)} ↗</a></div>`
    : ''

  return `<div class="${styles.popupParcel}">${title}${rows}${fireLine}${src}</div>`
}

// Inline citation for the sourcing modal ("The layers" list).
export const PARCEL_SOURCE_CITATION = ACTIVE_PARCEL_REGIONS.length
  ? { short: ACTIVE_PARCEL_REGIONS.map((r) => r.citation.short).join(' · '), tag: 'County assessor parcels', url: ACTIVE_PARCEL_REGIONS[0].citation.url }
  : null
