/**
 * iNaturalist API v1 service
 * Docs: https://www.inaturalist.org/pages/api+reference
 *
 * Add additional sources (eBird, GBIF) as separate functions here
 * and merge results in App.jsx.
 */

import { cached } from '../utils/cache'

const INAT_API = 'https://api.inaturalist.org/v1'
const NOMINATIM = 'https://nominatim.openstreetmap.org'

// ─── Observations ────────────────────────────────────────────────
export async function fetchObservations({ lat, lng, radiusKm, d1, d2, perPage = 50, taxonId, iconicTaxa, bounds }) {
  const params = new URLSearchParams({
    per_page: Math.min(perPage, 200),
    order: 'desc',
    order_by: 'created_at',
    quality_grade: 'any',
    captive: 'false',
  })
  if (bounds) {
    // Clamp to valid ranges (map can pan past ±180 longitude)
    params.set('nelat', Math.min(90, bounds.maxLat))
    params.set('nelng', Math.min(180, bounds.maxLng))
    params.set('swlat', Math.max(-90, bounds.minLat))
    params.set('swlng', Math.max(-180, bounds.minLng))
  } else if (lat != null && lng != null && radiusKm) {
    params.set('lat', lat)
    params.set('lng', lng)
    params.set('radius', radiusKm)
  }
  if (taxonId) params.set('taxon_id', taxonId)
  if (iconicTaxa) params.set('iconic_taxa', iconicTaxa)

  if (d1) {
    params.set('d1', d1)
    params.set('d2', d2 || new Date().toISOString().split('T')[0])
  }

  // iNat caps at 200 per request — fetch multiple pages in parallel if needed.
  // perPage=0 is a valid "count only" request (used by the Insights dashboard)
  // — iNat returns total_results with an empty results[] array, so we must
  // take the single-fetch path rather than compute pages from 0.
  const pageSize = Math.min(perPage, 200)
  const pages = pageSize <= 0 ? 1 : Math.ceil(Math.min(perPage, 400) / pageSize)

  if (pages <= 1) {
    const res = await fetch(`${INAT_API}/observations?${params}`)
    if (!res.ok) throw new Error(`iNaturalist API error: ${res.status} ${res.statusText}`)
    return res.json()
  }

  const fetches = []
  for (let page = 1; page <= pages; page++) {
    const p = new URLSearchParams(params)
    p.set('page', page)
    fetches.push(fetch(`${INAT_API}/observations?${p}`).then(r => r.ok ? r.json() : { results: [], total_results: 0 }))
  }
  const results = await Promise.all(fetches)
  return {
    total_results: results[0].total_results,
    results: results.flatMap(r => r.results || []),
  }
}

// ─── Species counts (for summary/stats view later) ───────────────
export async function fetchSpeciesCounts({ lat, lng, radiusKm, d1, d2, taxonId, iconicTaxa }) {
  const params = new URLSearchParams({
    quality_grade: 'any', captive: 'false',
  })
  if (lat != null && lng != null && radiusKm) {
    params.set('lat', lat)
    params.set('lng', lng)
    params.set('radius', radiusKm)
  }
  if (taxonId) params.set('taxon_id', taxonId)
  if (iconicTaxa) params.set('iconic_taxa', iconicTaxa)
  if (d1) { params.set('d1', d1); params.set('d2', d2 || new Date().toISOString().split('T')[0]) }

  const res = await fetch(`${INAT_API}/observations/species_counts?${params}`)
  if (!res.ok) throw new Error(`iNaturalist API error: ${res.status}`)
  return res.json()
}

// ─── Taxon autocomplete ──────────────────────────────────────────
export async function searchTaxa(query) {
  if (!query.trim()) return []
  // iNat autocomplete ranks by its own relevance score (not observations) and
  // caps per_page at 30. For queries like "fox", the mixed-rank endpoint
  // never returns Vulpes — substring-matched genera (Setaria/foxtail,
  // Digitalis/foxglove) and species (Sciurus niger/Fox Squirrel) crowd it
  // out. A rank=genus-scoped query *does* return Vulpes (at ~#12), which our
  // obs-count re-rank then promotes to the top. Fire both in parallel and
  // dedupe so users see the taxon they almost certainly meant.
  const qp = encodeURIComponent(query)
  const [mixedRes, genusRes] = await Promise.all([
    fetch(`${INAT_API}/taxa/autocomplete?q=${qp}&per_page=30`).catch(() => null),
    fetch(`${INAT_API}/taxa/autocomplete?q=${qp}&per_page=30&rank=genus`).catch(() => null),
  ])
  const [mixedData, genusData] = await Promise.all([
    mixedRes?.ok ? mixedRes.json() : { results: [] },
    genusRes?.ok ? genusRes.json() : { results: [] },
  ])

  const seen = new Set()
  const merged = []
  for (const t of [...(mixedData.results || []), ...(genusData.results || [])]) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    merged.push(t)
  }

  return merged.map(t => ({
    id: t.id,
    name: t.preferred_common_name || t.name,
    scientificName: t.name,
    rank: t.rank,
    rankLevel: t.rank_level,
    parentId: t.parent_id,
    iconicTaxon: t.iconic_taxon_name,
    photoUrl: t.default_photo?.square_url || null,
    observationsCount: t.observations_count || 0,
  }))
}

// ─── Global stats (homepage) ──────────────────────────────────────
export function fetchGlobalCounts() {
  return cached('inat:globalCounts', async () => {
    const d90 = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    const [obsRes, speciesRes, observersRes] = await Promise.all([
      fetch(`${INAT_API}/observations?per_page=0`),
      fetch(`${INAT_API}/observations/species_counts?per_page=0`),
      fetch(`${INAT_API}/observations/observers?d1=${d90}&per_page=0`),
    ])
    const [obs, species, observers] = await Promise.all([
      obsRes.json(), speciesRes.json(), observersRes.json(),
    ])
    return {
      totalObs: obs.total_results || 0,
      totalSpecies: species.total_results || 0,
      activeObservers: observers.total_results || 0,
    }
  })
}

export function fetchTopSpecies(count = 8, { d1, d2 } = {}) {
  const cacheKey = `inat:topSpecies:${count}:${d1 || 'all'}:${d2 || ''}`
  return cached(cacheKey, async () => {
    const params = new URLSearchParams({ per_page: count })
    if (d1) { params.set('d1', d1); if (d2) params.set('d2', d2) }
    const res = await fetch(`${INAT_API}/observations/species_counts?${params}`)
    if (!res.ok) throw new Error(`iNaturalist API error: ${res.status}`)
    const data = await res.json()
    return data.results || []
  })
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
  { placeId: 6774, name: 'Spain',          flag: '🇪🇸' },
  { placeId: 6973, name: 'Italy',          flag: '🇮🇹' },
  { placeId: 7142, name: 'Japan',          flag: '🇯🇵' },
]

export function fetchTopCountries({ d1, d2 } = {}) {
  const cacheKey = `inat:topCountries:${d1 || 'all'}:${d2 || ''}`
  return cached(cacheKey, async () => {
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
  })
}

// ─── Species observations (for species map modal) ────────────────
export async function fetchSpeciesObservations({ taxonId, d1, d2, perPage = 200 }) {
  const params = new URLSearchParams({
    taxon_id: taxonId,
    per_page: Math.min(perPage, 200),
    order: 'desc',
    order_by: 'created_at',
    quality_grade: 'any',
    captive: 'false',
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
