export function formatCoords(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lng).toFixed(1)}°${ew}`
}

// Water-aware reverse geocode via /api/geo/reverse (token server-side, probe
// fan-out cached at the edge). Coords round to 2 decimals (~1 km) so cache
// keys collapse; a small client cache saves the round trip while panning.
const _geoCache = new Map()

export async function reverseGeocode(lat, lng) {
  const rLat = Math.round(lat * 100) / 100
  const rLng = Math.round(lng * 100) / 100
  const cacheKey = `${rLat},${rLng}`
  if (_geoCache.has(cacheKey)) return _geoCache.get(cacheKey)

  let name
  try {
    const res = await fetch(`/api/geo/reverse?lat=${rLat}&lng=${rLng}`)
    if (!res.ok) throw new Error(`reverse geocode ${res.status}`)
    const data = await res.json()
    name = data.name || formatCoords(lat, lng)
  } catch {
    name = formatCoords(lat, lng)
  }

  if (_geoCache.size > 200) _geoCache.clear()
  _geoCache.set(cacheKey, name)
  return name
}

export function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return d }
}
