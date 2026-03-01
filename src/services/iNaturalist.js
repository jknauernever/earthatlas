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
export async function fetchObservations({ lat, lng, radiusKm, d1, d2, perPage = 50, taxonId, iconicTaxa }) {
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
  if (iconicTaxa) params.set('iconic_taxa', iconicTaxa)

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

// ─── Global stats (homepage) ──────────────────────────────────────
export async function fetchGlobalCounts() {
  const [obsRes, speciesRes, researchRes] = await Promise.all([
    fetch(`${INAT_API}/observations?per_page=0`),
    fetch(`${INAT_API}/observations/species_counts?per_page=0`),
    fetch(`${INAT_API}/observations?quality_grade=research&per_page=0`),
  ])
  const [obs, species, research] = await Promise.all([
    obsRes.json(), speciesRes.json(), researchRes.json(),
  ])
  return {
    totalObs: obs.total_results || 0,
    totalSpecies: species.total_results || 0,
    researchGrade: research.total_results || 0,
  }
}

export async function fetchTopSpecies(count = 8, { d1, d2 } = {}) {
  const params = new URLSearchParams({ per_page: count })
  if (d1) { params.set('d1', d1); if (d2) params.set('d2', d2) }
  const res = await fetch(`${INAT_API}/observations/species_counts?${params}`)
  if (!res.ok) throw new Error(`iNaturalist API error: ${res.status}`)
  const data = await res.json()
  return data.results || []
}

// ─── Top countries by observation count ───────────────────────────
const COUNTRIES = [
  { placeId: 1,    name: 'United States', flag: '🇺🇸' },
  { placeId: 6712, name: 'Canada',        flag: '🇨🇦' },
  { placeId: 6744, name: 'Australia',      flag: '🇦🇺' },
  { placeId: 7161, name: 'Russia',         flag: '🇷🇺' },
  { placeId: 6793, name: 'Mexico',         flag: '🇲🇽' },
  { placeId: 6857, name: 'United Kingdom', flag: '🇬🇧' },
  { placeId: 6986, name: 'South Africa',   flag: '🇿🇦' },
  { placeId: 7207, name: 'Germany',        flag: '🇩🇪' },
  { placeId: 6681, name: 'India',          flag: '🇮🇳' },
  { placeId: 6878, name: 'Brazil',         flag: '🇧🇷' },
  { placeId: 6803, name: 'New Zealand',    flag: '🇳🇿' },
  { placeId: 6737, name: 'France',         flag: '🇫🇷' },
  { placeId: 7015, name: 'Spain',          flag: '🇪🇸' },
  { placeId: 6756, name: 'Italy',          flag: '🇮🇹' },
  { placeId: 7142, name: 'Japan',          flag: '🇯🇵' },
]

export async function fetchTopCountries({ d1, d2 } = {}) {
  const results = await Promise.all(
    COUNTRIES.map(async (c) => {
      const params = new URLSearchParams({ place_id: c.placeId, per_page: 0 })
      if (d1) { params.set('d1', d1); if (d2) params.set('d2', d2) }
      const res = await fetch(`${INAT_API}/observations?${params}`)
      const data = await res.json()
      return { ...c, count: data.total_results || 0 }
    })
  )
  return results.sort((a, b) => b.count - a.count).slice(0, 10)
}

// ─── Species observations (for species map modal) ────────────────
export async function fetchSpeciesObservations({ taxonId, d1, d2, perPage = 200 }) {
  const params = new URLSearchParams({
    taxon_id: taxonId,
    per_page: Math.min(perPage, 200),
    order: 'desc',
    order_by: 'created_at',
    quality_grade: 'any',
  })
  if (d1) { params.set('d1', d1); if (d2) params.set('d2', d2) }
  const res = await fetch(`${INAT_API}/observations?${params}`)
  if (!res.ok) throw new Error(`iNaturalist API error: ${res.status}`)
  return res.json()
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
