const MAPBOX_API = 'https://api.mapbox.com/geocoding/v5/mapbox.places'

export async function searchPlaces(query) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token || !query.trim()) return []

  const params = new URLSearchParams({
    access_token: token,
    autocomplete: 'true',
    limit: '5',
    types: 'place,locality,neighborhood,address,poi',
  })

  const res = await fetch(`${MAPBOX_API}/${encodeURIComponent(query)}.json?${params}`)
  if (!res.ok) return []

  const data = await res.json()
  return (data.features || []).map(f => ({
    name: f.place_name,
    lat: f.center[1],
    lng: f.center[0],
  }))
}
