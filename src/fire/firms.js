// ─── Active fires: NASA FIRMS satellite hotspots (GeoJSON points) ───────────
// Unlike the raster risk layers (ArcGIS ImageServers) and the parcels vector
// layer (PMTiles), FIRMS is a viewport-driven GeoJSON point layer. VIIRS
// detections come primarily from the cron-baked 10° Blob shards (fast, CDN-
// shared, held in-module — see "Baked VIIRS shards" below); /api/firms (which
// proxies NASA FIRMS with the MAP_KEY server-side — see api/_firms-core.js)
// backfills the 24–48 h tail and covers views the shards can't. The map just
// styles points by detection age, newest = hottest.
//
// One catalog entry, `kind:'firms'`, slots into the same panel/legend/URL-state/
// drag-reorder machinery as every other layer; the map effects branch on the
// kind to take the GeoJSON path (fetch-on-move) instead of the raster path.

import styles from './FireApp.module.css'
import { wildfireLikelyKeeper } from '../../api/_firms-core.js'
import { getActiveFireContext, kmBetween } from './usFires.js'
import { loadSystemsJson } from '../systems/windField.js'

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

// "Wildfire-likely" FRP floor (MW). FIRMS detects all thermal anomalies; real
// wildfires radiate far more than persistent industrial sources (flares,
// refineries, ~< 5 MW), so this floor filters most non-fire heat out of live
// data. The panel exposes a toggle to drop it (show every detection).
export const FIRMS_WILDFIRE_MIN_FRP = 5
// How far (km) from a NIFC incident point a cool detection is still "that fire".
// Scaled up with the fire's reported acreage; 8 km floor covers spotting and
// the point-vs-front offset of a mid-size fire.
const NIFC_RESCUE_MIN_KM = 8
const PERIM_PAD_DEG = 0.03 // ~3 km buffer around a mapped perimeter's bbox

// Default look-back window (days). FIRMS DAY_RANGE counts UTC *calendar* days, so
// days=1 only returns the current UTC day — near-empty for the first hours after
// 00:00 UTC. days=2 always spans a full recent day's worth of overpasses
// regardless of clock time, which is the honest "active fires" footprint; the
// age coloring then distinguishes the freshest detections within it.
export const FIRMS_DEFAULT_DAYS = 2

// Same-origin serverless endpoint; can be repointed for plain-vite QA that lacks
// /api (parity with the parcels VITE_PARCEL_TILES_BASE escape hatch).
const API_BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_FIRE_API_BASE) || '').trim()

// ─── Baked VIIRS shards: the fast path ──────────────────────────────────────
// /inmotion's hotspots bake (api/cron/systems-bake, every 3 h) already writes
// exactly what this layer needs: firms-raw-<lat>_<lon>.json — 10°×10° shards
// of individual VIIRS detections from the last 24 h on the public Blob CDN,
// rows [lat, lng, frpMW, minutesBeforeFetch|null, satIdx]. One shard is ~20 KB
// over a typical fire region and is the SAME file for every user, so a
// regional view paints from one or two cached CDN fetches instead of waiting
// seconds on a per-viewport NASA round-trip (whose ~1 m-precision bbox meant
// no two pans ever shared an edge-cache key). Shards are held in-module, so
// panning inside already-fetched shards refetches nothing. The binned
// firms-hotspots.json carries a `raw_shards` list of the shards that exist
// this run, so we never probe for absent files.
//
// The /api/firms proxy path is NOT dead: it still serves views too wide to
// shard-fetch, any bake/CDN outage, and the 24–48 h tail of the 2-day window
// (the bake covers 24 h), which merges in the background after the shards
// have painted.
const SHARD_DEG = 10
const SHARD_HOLD_MS = 30 * 60 * 1000 // bake refreshes every 3 h; revalidate held files half-hourly
const SHARD_MAX_FETCH = 8            // more shards in view than this → proxy path

let shardIndexHeld = null            // { at, promise → Set<name> | null }
const shardsHeld = new Map()         // name → { at, promise → {feats, truncated} | null }

function heldShardIndex() {
  const now = Date.now()
  if (shardIndexHeld && now - shardIndexHeld.at < SHARD_HOLD_MS) return shardIndexHeld.promise
  const promise = loadSystemsJson('firms-hotspots', 'firms-hotspots')
    .then((j) => (Array.isArray(j.raw_shards) && j.raw_shards.length ? new Set(j.raw_shards) : null))
    .catch(() => null)
    .then((set) => {
      if (!set) shardIndexHeld = null // failures aren't held — retry next refresh
      return set
    })
  shardIndexHeld = { at: now, promise }
  return promise
}

function heldShard(name) {
  const now = Date.now()
  const h = shardsHeld.get(name)
  if (h && now - h.at < SHARD_HOLD_MS) return h.promise
  const promise = loadSystemsJson(name, 'firms-raw')
    .then((j) => {
      const sats = Array.isArray(j.satellites) ? j.satellites : []
      const feats = (j.detections || []).map(([lat, lng, frp, ageMin, si]) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        // Same property contract as the /api/firms features (paint + popup
        // read these; the bake doesn't carry conf/brightness/footprint, and
        // the popup already omits empty ones). hours_ago is stamped at
        // assembly time, not here, so a held shard keeps aging honestly.
        properties: {
          src: 'FIRMS', sat: sats[si] || '', geo: false, conf: '',
          frp: Number.isFinite(frp) ? frp : null, bright: null, dn: '', footprint_m: null,
          acq_ms: Number.isFinite(ageMin) ? j.fetched_ms - ageMin * 60000 : null,
          hours_ago: null,
        },
      }))
      return { feats, truncated: !!j.truncated }
    })
    .catch(() => { shardsHeld.delete(name); return null })
  shardsHeld.set(name, { at: now, promise })
  return promise
}

const normLon = (x) => (((x + 180) % 360) + 360) % 360 - 180

// The 10° shard keys a viewport touches. Longitude handles the map's
// antimeridian unwrapping (getWest() can be < -180) by normalizing each cell.
function shardNamesFor(west, south, east, north) {
  const names = new Set()
  const s0 = Math.max(-90, Math.floor(south / SHARD_DEG) * SHARD_DEG)
  const n0 = Math.min(80, Math.floor(Math.min(north, 89.99) / SHARD_DEG) * SHARD_DEG)
  const w0 = Math.floor(west / SHARD_DEG) * SHARD_DEG
  const e0 = Math.floor(east / SHARD_DEG) * SHARD_DEG
  for (let lat = s0; lat <= n0; lat += SHARD_DEG) {
    for (let lon = w0; lon <= e0 && names.size <= 720; lon += SHARD_DEG) {
      names.add(`firms-raw-${lat}_${normLon(lon)}`)
    }
  }
  return [...names]
}

// Longitude-wrap-aware viewport test, slightly padded so dots right at the
// edge survive a nudge-pan without waiting on the next refresh.
function viewClipper(west, south, east, north, pad = 0.1) {
  const world = east - west >= 360
  return ([lng, lat]) => {
    if (lat < south - pad || lat > north + pad) return false
    if (world) return true
    let x = lng
    while (x < west - pad) x += 360
    return x <= east + pad
  }
}

// Assemble the shard-path FIRMS features for a viewport, or null when shards
// can't serve it (index/shard fetch failed, or the view is too wide). Empty
// feats is a REAL answer: no VIIRS detections in view.
async function collectShardFeats({ west, south, east, north }) {
  const index = await heldShardIndex()
  if (!index) return null
  const wanted = shardNamesFor(west, south, east, north).filter((n) => index.has(n))
  if (wanted.length > SHARD_MAX_FETCH) return null
  const loaded = await Promise.all(wanted.map(heldShard))
  if (loaded.some((s) => !s)) return null
  const inView = viewClipper(west, south, east, north)
  const now = Date.now()
  const feats = []
  let truncated = false
  for (const sh of loaded) {
    if (sh.truncated) truncated = true
    for (const f of sh.feats) {
      if (!inView(f.geometry.coordinates)) continue
      const p = f.properties
      p.hours_ago = p.acq_ms == null ? null : Math.max(0, Math.round(((now - p.acq_ms) / 3.6e6) * 10) / 10)
      feats.push(f)
    }
  }
  return { feats, truncated }
}

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
  coverage: 'Global · NASA FIRMS + NOAA GOES · last 48 h · zoom in to load',
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
    'Satellite-detected active fire and thermal hotspots from NASA FIRMS (VIIRS, 375 m), refreshed through the most recent overpass. Each dot is a heat detection, colored by how recently the satellite saw it — this is where fire is burning now, not a risk model. Over North America it uses the faster US/Canada feed (~30 min); elsewhere it is near-real-time (~3 h). Points, not perimeters; for official incident perimeters use the Active wildfires layer. Note: FIRMS detects all thermal anomalies, so industrial heat (gas flares, refineries) and agricultural/prescribed burns appear too; the live product can’t label them. By default we show only higher-power, wildfire-likely detections (fire radiative power ≥ 5 MW) — use “show all heat sources” to see every detection.',
  source: 'NASA FIRMS (VIIRS) + NOAA HMS (GOES + polar) satellite fire detections',
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
// so the big, intense detections read as bigger. Sized up generously — a VIIRS
// pixel is only ~375–780 m on the ground, so at most zooms a footprint-accurate
// dot would be sub-pixel and invisible; these are deliberately larger so the
// detections stay legible against busy satellite imagery.
// FRP → radius, deliberately EXTREME: faint detections stay tiny, intense fire
// fronts balloon. Exponential curve (base 1.4) so high-FRP dots pull away hard;
// three FRP stops (0 / 100 / 400 MW) widen the dynamic range vs. the old 2× ramp.
const radiusExpr = () => [
  'interpolate', ['linear'], ['zoom'],
  3, ['interpolate', ['exponential', 1.4], ['coalesce', ['get', 'frp'], 0], 0, 2.5, 100, 6, 400, 13],
  7, ['interpolate', ['exponential', 1.4], ['coalesce', ['get', 'frp'], 0], 0, 4, 100, 12, 400, 28],
  11, ['interpolate', ['exponential', 1.4], ['coalesce', ['get', 'frp'], 0], 0, 6, 100, 20, 400, 54],
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
      // Newest detections draw on top (higher acq time = higher sort key).
      layout: { visibility: vis, 'circle-sort-key': ['coalesce', ['get', 'acq_ms'], 0] },
      paint: {
        'circle-color': ageColorExpr(),
        // Soft halo ≈ 2× the dot, giving each detection a "heat" bloom that grows
        // with FRP alongside the core (same exponential shape).
        'circle-radius': [
          'interpolate', ['linear'], ['zoom'],
          3, ['interpolate', ['exponential', 1.4], ['coalesce', ['get', 'frp'], 0], 0, 5, 100, 13, 400, 28],
          7, ['interpolate', ['exponential', 1.4], ['coalesce', ['get', 'frp'], 0], 0, 9, 100, 26, 400, 58],
          11, ['interpolate', ['exponential', 1.4], ['coalesce', ['get', 'frp'], 0], 0, 13, 100, 42, 400, 100],
        ],
        'circle-blur': 1,
        'circle-opacity': 0.35 * o,
      },
    })
  }
  if (!map.getLayer(DOT)) {
    map.addLayer({
      id: DOT, type: 'circle', source: SRC, minzoom: FIRMS_MIN_ZOOM,
      // Newest detections draw on top (higher acq time = higher sort key).
      layout: { visibility: vis, 'circle-sort-key': ['coalesce', ['get', 'acq_ms'], 0] },
      paint: {
        'circle-color': ageColorExpr(),
        'circle-radius': radiusExpr(),
        'circle-opacity': o,
        // No outline — a soft blur instead, so the core reads as a glowing ember
        // (the GLOW halo behind it carries contrast against busy imagery).
        'circle-blur': 0.5,
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
// "Wildfire-likely" = the proxy's power/peak heuristic (see api/_firms-core.js)
// OR proximity to a fire NIFC is actively tracking. The power rule alone hides
// a real fire whose every pixel is cool — e.g. a large fire smouldering after
// its run, or one seen only under smoke — and those are exactly the fires people
// come here to watch. An incident point or mapped perimeter is ground truth that
// the heat nearby is a wildfire, so it overrides the industrial-heat assumption.
function wildfireLikelyFilter(feats, minFrp, ctx) {
  const byPower = wildfireLikelyKeeper(feats, minFrp)
  const pts = (ctx && ctx.pts) || []
  const perimBoxes = ((ctx && ctx.perims) || []).map(bboxOf).filter(Boolean)
  const radiusKm = (p) => {
    const acres = Number(p && p.acres) || 0
    const areaKm2 = acres * 0.00404686
    return Math.max(NIFC_RESCUE_MIN_KM, 2.5 * Math.sqrt(areaKm2 / Math.PI))
  }
  return (f) => {
    if (byPower(f)) return true
    const c = f.geometry.coordinates
    for (const b of perimBoxes) {
      if (c[0] >= b[0] - PERIM_PAD_DEG && c[0] <= b[2] + PERIM_PAD_DEG && c[1] >= b[1] - PERIM_PAD_DEG && c[1] <= b[3] + PERIM_PAD_DEG) return true
    }
    for (const p of pts) {
      const g = p.geometry
      if (!g || g.type !== 'Point') continue
      if (Math.abs(g.coordinates[1] - c[1]) > 1) continue // cheap pre-cut (~110 km)
      if (kmBetween(g.coordinates, c) <= radiusKm(p.properties)) return true
    }
    return false
  }
}

function bboxOf(f) {
  const g = f && f.geometry
  if (!g) return null
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const walk = (x) => {
    if (typeof x[0] === 'number') { if (x[0] < w) w = x[0]; if (x[0] > e) e = x[0]; if (x[1] < s) s = x[1]; if (x[1] > n) n = x[1] }
    else for (const y of x) walk(y)
  }
  walk(g.coordinates)
  return Number.isFinite(w) ? [w, s, e, n] : null
}

// Merge FIRMS features with the HMS/GOES feed, then dedup near-coincident
// detections (~100 m) keeping the newest — so two satellites (or the baked
// shard and the proxy tail) don't double-plot the same pixel without thinning
// the fire.
function mergeWithHms(firmsFeats, hmsFC) {
  const feats = [...firmsFeats]
  if (hmsFC && hmsFC.type === 'FeatureCollection') {
    for (const f of hmsFC.features) {
      const p = f.properties
      feats.push({
        type: 'Feature', geometry: f.geometry,
        properties: { src: p.geo ? 'GOES' : 'HMS', sat: p.sat, geo: !!p.geo, conf: '', frp: p.frp, bright: null, dn: '', footprint_m: null, acq_ms: p.acq_ms, hours_ago: p.hours_ago },
      })
    }
  }
  feats.sort((a, b) => (b.properties.acq_ms || 0) - (a.properties.acq_ms || 0))
  const seen = new Set(); const kept = []
  for (const f of feats) {
    const [lng, lat] = f.geometry.coordinates
    const k = `${Math.round(lat * 1000)},${Math.round(lng * 1000)}`
    if (seen.has(k)) continue
    seen.add(k); kept.push(f)
  }
  return kept
}

function setFirmsData(map, kept, { truncated, error }) {
  const src = map.getSource(SRC)
  if (!src) return null
  src.setData({ type: 'FeatureCollection', features: kept })
  return { count: kept.length, geo: kept.filter((f) => f.properties.geo).length, truncated, error }
}

// Background completion of the 2-day window: the shards cover 24 h, so pull
// the proxy for the full window and merge in what they didn't have (mostly
// 24–48 h-old detections). Never blocks the shard paint. The bbox is snapped
// OUTWARD to a coarse grid so nearby pans — and nearby users — collide on one
// edge-cache key; the old ~1 m-precision keys made the proxy cache useless.
async function mergeProxyTail(map, { west, south, east, north, days, minFrp, signal, baseFeats, hmsFC, fireCtx, shardTruncated, onUpdate }) {
  const span = Math.max(east - west, north - south)
  const st = span < 2 ? 0.5 : span < 8 ? 1 : 2
  const qw = Math.floor(west / st) * st
  const qs = Math.max(-90, Math.floor(south / st) * st)
  const qe = Math.ceil(east / st) * st
  const qn = Math.min(90, Math.ceil(north / st) * st)
  const url = `${API_BASE}/api/firms?bbox=${[qw, qs, qe, qn].join(',')}&days=${days}`
  const fc = await fetch(url, { signal }).then((r) => r.json()).catch(() => null)
  if (!fc || fc.type !== 'FeatureCollection' || (signal && signal.aborted)) return
  const inView = viewClipper(west, south, east, north)
  let tail = fc.features.filter((f) => inView(f.geometry.coordinates))
  // Keeper context comes from the UNCLIPPED fetch — a hot peak just offscreen
  // still legitimizes its cool neighbours inside the view.
  if (minFrp > 0) tail = tail.filter(wildfireLikelyFilter(fc.features, minFrp, fireCtx))
  const meta = setFirmsData(map, mergeWithHms([...baseFeats, ...tail], hmsFC), {
    truncated: shardTruncated || !!fc._truncated, error: null,
  })
  if (meta && onUpdate) onUpdate(meta)
}

export async function refreshFirms(map, { days = FIRMS_DEFAULT_DAYS, minFrp = 0, signal, onUpdate } = {}) {
  const b = map.getBounds()
  // ~1m precision. At high zoom the viewport can be narrower than the rounding
  // step, collapsing west==east (or south==north) into a zero-area bbox that
  // FIRMS rejects with 400 — so pad to a tiny minimum span before formatting.
  const round = (v) => Number(v.toFixed(5))
  let west = round(b.getWest()), south = round(b.getSouth()), east = round(b.getEast()), north = round(b.getNorth())
  const MIN_SPAN = 0.0005 // ~50m; keeps the bbox non-degenerate at any zoom
  if (east - west < MIN_SPAN) { const c = (east + west) / 2; west = round(c - MIN_SPAN / 2); east = round(c + MIN_SPAN / 2) }
  if (north - south < MIN_SPAN) { const c = (north + south) / 2; south = round(c - MIN_SPAN / 2); north = round(c + MIN_SPAN / 2) }
  const bbox = [west, south, east, north].join(',')
  // "Active Hotspots" = ALL satellite heat, user-first: raw FIRMS VIIRS (fine,
  // near-real-time) + NOAA HMS (adds the fast geostationary GOES + analyst QC).
  // Users don't care which satellite saw it — they want where the heat is — so
  // both feeds are merged into this one layer. VIIRS comes from the baked
  // shards when they cover the view (fast path above), and the wildfire-likely
  // filter is applied here, where we also know what NIFC knows.
  const hmsUrl = `${API_BASE}/api/hms?bbox=${bbox}`
  const [shard, hmsFC, fireCtx] = await Promise.all([
    collectShardFeats({ west, south, east, north }).catch(() => null),
    fetch(hmsUrl, { signal }).then((r) => r.json()).catch(() => null),
    minFrp > 0 ? getActiveFireContext({ signal }).catch(() => ({ pts: [], perims: [] })) : null,
  ])
  if (signal && signal.aborted) return null

  if (shard) {
    let feats = shard.feats
    if (minFrp > 0) feats = feats.filter(wildfireLikelyFilter(feats, minFrp, fireCtx))
    const meta = setFirmsData(map, mergeWithHms(feats, hmsFC), { truncated: shard.truncated, error: null })
    if (meta && days > 1) {
      mergeProxyTail(map, { west, south, east, north, days, minFrp, signal, baseFeats: feats, hmsFC, fireCtx, shardTruncated: shard.truncated, onUpdate })
        .catch(() => { /* tail is best-effort; the 24 h shard paint stands */ })
    }
    return meta
  }

  // ─── Proxy path: wide views, bake/CDN outage, or shard fetch failure ──────
  const firmsUrl = `${API_BASE}/api/firms?bbox=${bbox}&days=${days}`
  const firmsFC = await fetch(firmsUrl, { signal }).then((r) => r.json()).catch(() => null)
  if (signal && signal.aborted) return null
  if (firmsFC && firmsFC.type === 'FeatureCollection' && minFrp > 0) {
    firmsFC.features = firmsFC.features.filter(wildfireLikelyFilter(firmsFC.features, minFrp, fireCtx))
  }
  // Upstream failure is NOT an empty sky. The proxy always answers 200 (so a
  // throttled NASA never looks like a CORS error) but flags `_error` when every
  // source failed; a network-level failure leaves firmsFC null. Either way we
  // report it so the panel can say "couldn't load" instead of "no detections".
  const firmsError = !firmsFC ? 'no response from /api/firms' : (firmsFC._error || null)
  const feats = (firmsFC && firmsFC.type === 'FeatureCollection') ? firmsFC.features : []
  const truncated = !!(firmsFC && firmsFC._truncated)
  return setFirmsData(map, mergeWithHms(feats, hmsFC), { truncated, error: firmsError })
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
      `<span class="${styles.popupRowValue}">${esc(frp)} (radiative)</span></div>` : '') +
    (d.footprint_m ? `<div class="${styles.popupRow}"><span class="${styles.popupRowLabel}">Footprint</span>` +
      `<span class="${styles.popupRowValue}">~${esc(d.footprint_m)} m pixel</span></div>` : '')

  const src = `<div class="${styles.popupParcelSrc}">Detection: ` +
    `<a href="${FIRMS_SOURCE_CITATION.url}" target="_blank" rel="noopener noreferrer" title="${esc(FIRMS_SOURCE_CITATION.short)}">NASA FIRMS ↗</a></div>`

  return `<div class="${styles.popupParcel}">` +
    `<div class="${styles.popupParcelTitle}">Active fire detection` +
    `<span class="${styles.popupParcelApn}">satellite hotspot</span></div>` +
    rows + src + '</div>'
}
