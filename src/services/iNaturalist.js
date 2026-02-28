/**
 * iNaturalist API v1 service
 * Docs: https://www.inaturalist.org/pages/api+reference
 *
 * Add additional sources (eBird, GBIF) as separate functions here
 * and merge results in App.jsx.
 */

const INAT_API = 'https://api.inaturalist.org/v1'
const NOMINATIM = 'https://nominatim.openstreetmap.org'

// ─── Observations ────────────────────────────────────────────────
export async function fetchObservations({ lat, lng, radiusKm, d1, d2, perPage = 50, taxonId }) {
  const params = new URLSearchParams({
    lat,
    lng,
    radius: radiusKm,
    per_page: Math.min(perPage, 200),
    order: 'desc',
    order_by: 'created_at',
    quality_grade: 'any',
  })
  if (taxonId) params.set('taxon_id', taxonId)

  if (d1) {
    params.set('d1', d1)
    params.set('d2', d2 || new Date().toISOString().split('T')[0])
  }

  const res = await fetch(`${INAT_API}/observations?${params}`)
  if (!res.ok) throw new Error(`iNaturalist API error: ${res.status} ${res.statusText}`)
  return res.json() // { total_results, results: [...] }
}

// ─── Species counts (for summary/stats view later) ───────────────
export async function fetchSpeciesCounts({ lat, lng, radiusKm, d1, d2 }) {
  const params = new URLSearchParams({
    lat, lng, radius: radiusKm, quality_grade: 'any',
  })
  if (d1) { params.set('d1', d1); params.set('d2', d2 || new Date().toISOString().split('T')[0]) }

  const res = await fetch(`${INAT_API}/observations/species_counts?${params}`)
  if (!res.ok) throw new Error(`iNaturalist API error: ${res.status}`)
  return res.json()
}

// ─── Taxon autocomplete ──────────────────────────────────────────
export async function searchTaxa(query) {
  if (!query.trim()) return []
  const params = new URLSearchParams({ q: query, per_page: 8 })
  const res = await fetch(`${INAT_API}/taxa/autocomplete?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results || []).map(t => ({
    id: t.id,
    name: t.preferred_common_name || t.name,
    scientificName: t.name,
    rank: t.rank,
    iconicTaxon: t.iconic_taxon_name,
    photoUrl: t.default_photo?.square_url || null,
  }))
}

// ─── Reverse geocode via Nominatim (no key needed) ───────────────
export async function reverseGeocode(lat, lng) {
  const res = await fetch(
    `${NOMINATIM}/reverse?lat=${lat}&lon=${lng}&format=json`,
    { headers: { 'Accept-Language': 'en' } }
  )
  if (!res.ok) throw new Error('Geocoding failed')
  const data = await res.json()
  const { city, town, village, county, state, country_code } = data.address || {}
  const place = city || town || village || county || ''
  const region = state || ''
  const country = country_code?.toUpperCase() || ''
  return [place, region, country].filter(Boolean).join(', ')
}
