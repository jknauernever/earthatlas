/**
 * Reverse-geocode core: "where is this point?" with a water-aware fallback.
 *
 * Shared by the production Edge function (api/geo/reverse.js) and the vite
 * dev middleware (geoProxyPlugin in vite.config.js), mirroring the
 * _firms-core / _nifc-core split.
 *
 * On land it returns "City, ST, CC". Over water (or deep wilderness) Mapbox
 * reverse geocoding returns only region/country or nothing for types=place,
 * so we probe 8 compass bearings at escalating radii and name the nearest
 * land place with the measured distance: "42 km from Goleta, CA, US".
 */

const EARTH_R = 6371

export function formatCoords(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lng).toFixed(1)}°${ew}`
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Destination point given start, bearing (deg), distance (km) — spherical earth
function destPoint(lat, lng, bearingDeg, distKm) {
  const br = bearingDeg * Math.PI / 180
  const d = distKm / EARTH_R
  const la1 = lat * Math.PI / 180
  const lo1 = lng * Math.PI / 180
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(br))
  const lo2 = lo1 + Math.atan2(
    Math.sin(br) * Math.sin(d) * Math.cos(la1),
    Math.cos(d) - Math.sin(la1) * Math.sin(la2)
  )
  return { lat: la2 * 180 / Math.PI, lng: ((lo2 * 180 / Math.PI) + 540) % 360 - 180 }
}

// "City, State, Country" from a Mapbox feature + its context hierarchy
function formatPlaceFeature(f) {
  const ctx = f.context || []
  const find = (prefix) => ctx.find(c => c.id?.startsWith(prefix))
  const placeText = f.id?.startsWith('place') || f.id?.startsWith('locality')
    ? f.text
    : find('place')?.text || find('locality')?.text
  const region = find('region')
  const regionCode = region?.short_code?.replace(/^[A-Z]{2}-/, '') || region?.text
  const country = find('country')
  const countryCode = country?.short_code?.toUpperCase() || country?.text
  const parts = [placeText, regionCode, countryCode].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : f.text || f.place_name || null
}

async function placeAt(lat, lng, token) {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,locality&limit=1&access_token=${token}`
    )
    if (!res.ok) return null
    return (await res.json()).features?.[0] || null
  } catch { return null }
}

async function nearestPlace(lat, lng, token) {
  const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315]
  for (const radius of [50, 100, 200, 400, 800]) {
    const feats = await Promise.all(
      BEARINGS.map(b => {
        const p = destPoint(lat, lng, b, radius)
        return placeAt(p.lat, p.lng, token)
      })
    )
    const candidates = feats
      .filter(Boolean)
      .map(f => ({ f, km: haversineKm(lat, lng, f.center[1], f.center[0]) }))
      .sort((a, b) => a.km - b.km)
    if (candidates.length > 0) return candidates[0]
  }
  return null
}

/**
 * → { name, kind: 'place' | 'near' | 'region' | 'coords', km?, place? }
 * `name` is always a ready-to-display string.
 */
export async function resolveReverse({ lat, lng, token }) {
  let topFeature = null
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?limit=1&access_token=${token}`
    )
    if (res.ok) topFeature = (await res.json()).features?.[0] || null
  } catch { /* fall through to probe/coords */ }

  if (topFeature) {
    const ctx = topFeature.context || []
    const hasPlace = topFeature.id?.startsWith('place') || topFeature.id?.startsWith('locality') ||
      ctx.some(c => c.id?.startsWith('place') || c.id?.startsWith('locality'))
    if (hasPlace) {
      const name = formatPlaceFeature(topFeature)
      if (name) return { name, kind: 'place' }
    }
  }

  const near = await nearestPlace(lat, lng, token)
  if (near) {
    const place = formatPlaceFeature(near.f)
    if (place) {
      const km = Math.round(near.km)
      return { name: `${km} km from ${place}`, kind: 'near', km, place }
    }
  }

  const regionName = topFeature ? formatPlaceFeature(topFeature) : null
  if (regionName) return { name: regionName, kind: 'region' }
  return { name: formatCoords(lat, lng), kind: 'coords' }
}
