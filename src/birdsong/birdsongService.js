/**
 * birdsongService — data layer for the EarthAtlas /birdsong tool.
 *
 * Source: BirdWeather's public GraphQL endpoint, fronted by our edge proxy at
 * /api/birdweather (api/birdweather.js → api/_birdweather-core.js). BirdWeather
 * is a *global network* of PUC + BirdNET-Pi acoustic stations — every public
 * station's detections are readable without a token. No Supabase, no API key
 * beyond Mapbox. The browser asks the proxy for the slice it needs (viewport
 * bbox + time window); the proxy builds the GraphQL query and caches the result.
 *
 * Docs: https://app.birdweather.com/api/index.html
 */

const API = '/api/birdweather'

// ─── Time-window presets (BirdWeather InputDuration: count + unit) ──────────
export const PERIOD_PRESETS = [
  { id: '1h', label: '1 hour', count: 1, unit: 'hour' },
  { id: '24h', label: '24 hours', count: 1, unit: 'day' },
  { id: '3d', label: '3 days', count: 3, unit: 'day' },
  { id: '7d', label: 'Week', count: 7, unit: 'day' },
  { id: '30d', label: 'Month', count: 30, unit: 'day' },
]
export const DEFAULT_PERIOD_ID = '24h'
export const periodById = (id) => PERIOD_PRESETS.find((p) => p.id === id) || PERIOD_PRESETS[1]

// ─── bbox helpers ────────────────────────────────────────────────────────────
/** Extract a {swlat,swlng,nelat,nelng} bbox from a Mapbox map's current view. */
export function bboxFromMap(map) {
  try {
    const b = map.getBounds()
    const sw = b.getSouthWest()
    const ne = b.getNorthEast()
    return { swlat: sw.lat, swlng: sw.lng, nelat: ne.lat, nelng: ne.lng }
  } catch {
    return null
  }
}

function bboxParams(bbox) {
  if (!bbox) return ''
  // Clamp longitudes into [-180,180] so a world-wrapped view doesn't send the
  // proxy out-of-range coords (which it rejects).
  const clampLng = (v) => Math.max(-180, Math.min(180, v))
  const clampLat = (v) => Math.max(-90, Math.min(90, v))
  return (
    `&swlat=${clampLat(bbox.swlat).toFixed(5)}&swlng=${clampLng(bbox.swlng).toFixed(5)}` +
    `&nelat=${clampLat(bbox.nelat).toFixed(5)}&nelng=${clampLng(bbox.nelng).toFixed(5)}`
  )
}

function periodParams(period) {
  if (!period) return ''
  return `&pc=${period.count}&pu=${period.unit}`
}

async function getJSON(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`birdweather proxy returned ${res.status}`)
  const body = await res.json()
  if (body._upstream_status || body._upstream_errors || body._upstream_error) {
    // Soft failure — proxy returned an empty shape. Surface it as an error so
    // callers can show a retry message rather than silently empty results.
    throw new Error('BirdWeather upstream unavailable')
  }
  return body.data || {}
}

// ─── Normalizers ─────────────────────────────────────────────────────────────
function normStation(n) {
  if (!n || !n.coords) return null
  return {
    id: n.id,
    name: n.name || `Station ${n.id}`,
    type: n.type || 'unknown',
    lat: n.coords.lat,
    lng: n.coords.lon,
    country: n.country || null,
    state: n.state || null,
    location: n.location || null,
    detections: n.counts?.detections ?? 0,
    species: n.counts?.species ?? 0,
    latestDetectionAt: n.latestDetectionAt || null,
    earliestDetectionAt: n.earliestDetectionAt || null,
  }
}

function normDetection(n) {
  if (!n) return null
  const sp = n.species || {}
  return {
    id: n.id,
    time: n.timestamp ? new Date(n.timestamp).getTime() : 0,
    timestamp: n.timestamp,
    confidence: typeof n.confidence === 'number' ? n.confidence : null,
    score: typeof n.score === 'number' ? n.score : null,
    certainty: n.certainty || null,
    lat: n.coords?.lat ?? null,
    lng: n.coords?.lon ?? null,
    species: {
      id: sp.id || null,
      commonName: sp.commonName || 'Unknown species',
      scientificName: sp.scientificName || '',
      imageUrl: sp.imageUrl || sp.thumbnailUrl || null,
      color: sp.color || '#38bdf8',
      url: sp.birdweatherUrl || null,
    },
    audioUrl: n.soundscape?.url || null,
    audioDuration: n.soundscape?.duration ?? null,
    stationId: n.station?.id || null,
    stationName: n.station?.name || null,
    stationType: n.station?.type || null,
  }
}

// ─── Fetchers ────────────────────────────────────────────────────────────────
/** Public stations within the viewport bbox (counts scoped to `period`). */
export async function fetchStations({ bbox, period, query, first = 200, signal } = {}) {
  const url = `${API}?op=stations&first=${first}${bboxParams(bbox)}${periodParams(period)}` +
    (query ? `&q=${encodeURIComponent(query)}` : '')
  const data = await getJSON(url, signal)
  const conn = data.stations || { nodes: [], totalCount: 0 }
  return {
    totalCount: conn.totalCount ?? 0,
    stations: (conn.nodes || []).map(normStation).filter(Boolean),
  }
}

/**
 * Load the full global station registry from the pre-built static snapshot
 * (public/birdsong-stations.json, ~22k stations, regenerated weekly at build).
 * This is the Quakes pattern: fetch once, filter/cluster client-side, so the
 * map plots the ENTIRE network with zero per-pan load on BirdWeather. Returns
 * { generatedAt, stations:[{id,name,type,lat,lng,country,state,last}] }.
 * Throws if the snapshot isn't available so the caller can fall back to live.
 */
export async function fetchStationSnapshot({ signal } = {}) {
  const res = await fetch('/birdsong-stations.json', { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`station snapshot returned ${res.status}`)
  const body = await res.json()
  const raw = Array.isArray(body) ? body : (body.stations || [])
  const stations = raw.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng))
  return { generatedAt: body.generatedAt || null, stations }
}

/** Most recent detections (newest first) within bbox + time window, with audio. */
export async function fetchDetections({ bbox, period, first = 50, speciesId, stationId, signal } = {}) {
  const url = `${API}?op=detections&first=${first}${bboxParams(bbox)}${periodParams(period)}` +
    (speciesId ? `&speciesId=${encodeURIComponent(speciesId)}` : '') +
    (stationId ? `&stationId=${encodeURIComponent(stationId)}` : '')
  const data = await getJSON(url, signal)
  const conn = data.detections || { nodes: [], totalCount: 0 }
  return {
    totalCount: conn.totalCount ?? 0,
    detections: (conn.nodes || []).map(normDetection).filter(Boolean),
  }
}

/** Most-detected species within bbox (or for one station) over the window. */
export async function fetchTopSpecies({ bbox, period, limit = 10, stationId, signal } = {}) {
  const url = `${API}?op=topSpecies&limit=${limit}${bboxParams(bbox)}${periodParams(period)}` +
    (stationId ? `&stationId=${encodeURIComponent(stationId)}` : '')
  const data = await getJSON(url, signal)
  return (data.topSpecies || [])
    .filter((r) => r && r.species)
    .map((r) => ({
      count: r.count ?? 0,
      commonName: r.species.commonName || 'Unknown',
      scientificName: r.species.scientificName || '',
      color: r.species.color || '#38bdf8',
      imageUrl: r.species.imageUrl || r.species.thumbnailUrl || null,
      url: r.species.birdweatherUrl || null,
    }))
}

/**
 * Real aggregate totals for a viewport (or one station) over the window:
 * { detections, species, stations }. This is the honest "N species heard /
 * M detections" — BirdWeather computes it server-side (it's what powers their
 * Data Explorer's header), so we don't have to derive it from a capped sample.
 * Note: `stations` here = stations ACTIVE in the window, which is ≤ the number
 * of registered stations shown on the map.
 */
export async function fetchCounts({ bbox, period, stationId, signal } = {}) {
  const url = `${API}?op=counts${bboxParams(bbox)}${periodParams(period)}` +
    (stationId ? `&stationId=${encodeURIComponent(stationId)}` : '')
  const data = await getJSON(url, signal)
  const c = data.counts || {}
  return { detections: c.detections ?? 0, species: c.species ?? 0, stations: c.stations ?? 0 }
}

/** A single station's metadata (counts scoped to `period`). */
export async function fetchStation({ id, period, signal } = {}) {
  const url = `${API}?op=station&id=${encodeURIComponent(id)}${periodParams(period)}`
  const data = await getJSON(url, signal)
  return normStation(data.station)
}

// ─── Display helpers ──────────────────────────────────────────────────────────
/** Compact large numbers for stat chips: 9055598 → "9.1M", 12400 → "12.4K". */
export function compactNumber(n) {
  if (n == null || !Number.isFinite(n)) return '0'
  if (Math.abs(n) < 1000) return String(n)
  try {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  } catch {
    return n.toLocaleString()
  }
}

/** Compact relative time ("3m", "2h", "4d") for a timestamp (ms or ISO). */
export function relativeTime(t) {
  const ms = typeof t === 'number' ? t : new Date(t).getTime()
  if (!Number.isFinite(ms)) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return `${Math.floor(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

/** Plain-English confidence label for a 0–1 confidence score. */
export function confidenceLabel(c) {
  if (c == null) return ''
  if (c >= 0.9) return 'Very confident'
  if (c >= 0.75) return 'Confident'
  if (c >= 0.5) return 'Likely'
  return 'Tentative'
}

// Friendly labels for BirdWeather station hardware types.
const STATION_TYPE_LABELS = {
  puc: 'PUC',
  birdnetpi: 'BirdNET-Pi',
  birdnet_pi: 'BirdNET-Pi',
  app: 'Mobile app',
  stream_youtube: 'YouTube stream',
}
export const stationTypeLabel = (t) => STATION_TYPE_LABELS[t] || (t ? t.replace(/_/g, ' ') : 'Station')
