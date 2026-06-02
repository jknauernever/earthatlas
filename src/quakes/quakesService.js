/**
 * quakesService — earthquake data for the EarthAtlas /quakes tool.
 *
 * Source: the USGS Earthquake Hazards Program public GeoJSON feeds. No API
 * key, no backend, no Supabase — the browser fetches the feed directly. The
 * "all_month" feed is every recorded earthquake worldwide for the past ~30
 * days; we pull it once and derive both the global view and any location/
 * radius view by filtering in memory (no refetch when the radius changes).
 *
 * Feed catalog: https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/
 */

const FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary'

// Magnitude-band feeds for the past month. "all" is everything (can be large,
// a few MB / ~10k+ events); the higher bands are smaller and load faster.
export const FEEDS = [
  { id: 'all', label: 'All', file: 'all_month.geojson' },
  { id: '1.0', label: 'M1.0+', file: '1.0_month.geojson' },
  { id: '2.5', label: 'M2.5+', file: '2.5_month.geojson' },
  { id: '4.5', label: 'M4.5+', file: '4.5_month.geojson' },
]

const EARTH_RADIUS_MILES = 3959

export function haversineMiles(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Normalize one USGS GeoJSON feature into a flat event record. */
function processFeature(f) {
  const [lng, lat, depth] = f.geometry?.coordinates || [0, 0, 0]
  const p = f.properties || {}
  return {
    id: f.id,
    mag: typeof p.mag === 'number' ? p.mag : 0,
    depth: Math.abs(depth || 0),
    place: p.place || 'Unknown location',
    time: p.time || 0,
    lat,
    lng,
    url: p.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`,
    sig: p.sig || 0,
    tsunami: p.tsunami || 0,
    felt: p.felt || null,
  }
}

/**
 * Fetch a full month of earthquakes for the given magnitude band. Returns
 * events sorted most-recent-first. Pass an AbortSignal to cancel in-flight.
 */
export async function fetchQuakes(feedId = 'all', signal) {
  const feed = FEEDS.find((f) => f.id === feedId) || FEEDS[0]
  // Cache-bust so a hard refresh always shows the latest activity.
  const res = await fetch(`${FEED_BASE}/${feed.file}?t=${Date.now()}`, { signal })
  if (!res.ok) throw new Error(`USGS feed returned ${res.status}`)
  const data = await res.json()
  if (!data || !Array.isArray(data.features)) return []
  return data.features.map(processFeature).sort((a, b) => b.time - a.time)
}

/** Keep only events within `radiusMiles` of a center point. */
export function filterByRadius(events, lat, lng, radiusMiles) {
  return events.filter((e) => haversineMiles(lat, lng, e.lat, e.lng) <= radiusMiles)
}

/**
 * Age-based opacity so the freshest quakes read brightest on the map
 * (mirrors the original seismic-data app's 6h / 24h / 72h banding).
 */
export function ageOpacity(time, now = Date.now()) {
  const hours = (now - time) / 3.6e6
  if (hours < 6) return 1.0
  if (hours < 24) return 0.85
  if (hours < 72) return 0.6
  return 0.4
}

// Magnitude → color ramp (small/yellow → great/indigo). Same stops the
// original app fed to Mapbox; exported so the legend and charts match the map.
export const MAG_RAMP = [
  [-1, '#FFD700'],
  [0, '#FF8C00'],
  [1, '#FF6347'],
  [2, '#FF4500'],
  [3, '#FF0000'],
  [4, '#DC143C'],
  [5, '#B22222'],
  [6, '#8B0000'],
  [7, '#800080'],
  [8, '#4B0082'],
]

function lerpHex(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)]
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Interpolated color for a magnitude, matching the map's circle ramp. */
export function magColor(mag) {
  const m = typeof mag === 'number' ? mag : 0
  if (m <= MAG_RAMP[0][0]) return MAG_RAMP[0][1]
  if (m >= MAG_RAMP[MAG_RAMP.length - 1][0]) return MAG_RAMP[MAG_RAMP.length - 1][1]
  for (let i = 0; i < MAG_RAMP.length - 1; i++) {
    const [m0, c0] = MAG_RAMP[i]
    const [m1, c1] = MAG_RAMP[i + 1]
    if (m >= m0 && m <= m1) return lerpHex(c0, c1, (m - m0) / (m1 - m0))
  }
  return MAG_RAMP[MAG_RAMP.length - 1][1]
}

/** Group events into per-day buckets (local time), oldest day first. */
export function aggregateDaily(events) {
  const days = {}
  for (const e of events) {
    const d = new Date(e.time)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (!days[key]) days[key] = { key, count: 0, maxMag: -Infinity, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
    days[key].count++
    if (e.mag > days[key].maxMag) days[key].maxMag = e.mag
  }
  return Object.values(days).sort((a, b) => a.date - b.date)
}

/** Summary statistics for a set of events (drives the stats strip + report). */
export function computeStats(events) {
  if (!events.length) return { count: 0, maxMag: 0, avgMag: 0, minMag: 0 }
  let max = -Infinity
  let min = Infinity
  let sum = 0
  for (const e of events) {
    if (e.mag > max) max = e.mag
    if (e.mag < min) min = e.mag
    sum += e.mag
  }
  return { count: events.length, maxMag: max, minMag: min, avgMag: sum / events.length }
}
