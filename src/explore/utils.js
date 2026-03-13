const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

export function formatCoords(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(1)}\u00b0${ns}, ${Math.abs(lng).toFixed(1)}\u00b0${ew}`
}

export async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?limit=1&access_token=${MAPBOX_TOKEN}`
    )
    if (!res.ok) return formatCoords(lat, lng)
    const data = await res.json()
    const f = data.features?.[0]
    if (!f) return formatCoords(lat, lng)

    // Build "City, State, Country" from the feature + context hierarchy
    const ctx = f.context || []
    const find = (prefix) => ctx.find(c => c.id?.startsWith(prefix))

    // The top-level feature may already be a place; otherwise look in context
    const placeText = f.id?.startsWith('place') ? f.text : find('place')?.text || find('locality')?.text
    const region = find('region')
    const regionCode = region?.short_code?.replace(/^[A-Z]{2}-/, '') || region?.text
    const country = find('country')
    const countryCode = country?.short_code?.toUpperCase() || country?.text

    const parts = [placeText, regionCode, countryCode].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : f.text || f.place_name || formatCoords(lat, lng)
  } catch { return formatCoords(lat, lng) }
}

export function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return d }
}
