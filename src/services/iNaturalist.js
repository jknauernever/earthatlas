/**
 * iNaturalist API v1 service
 * Docs: https://www.inaturalist.org/pages/api+reference
 *
 * Add additional sources (eBird, GBIF) as separate functions here
 * and merge results in App.jsx.
 */

import { cached } from '../utils/cache'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'
import { INAT_COUNTRIES } from '../data/inatCountries'

const INAT_API = 'https://api.inaturalist.org/v1'
// Route /observations through our same-origin proxy. iNat throttles client IPs
// and 429s us without CORS headers — browsers surface those as "CORS errors"
// even though the upstream is just rate-limiting. Server-side proxying makes
// those failures clean HTTP responses (and lets the edge cache absorb load).
const INAT_OBS_PROXY = '/api/inat-proxy'
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
    const res = await fetchWithTimeout(`${INAT_OBS_PROXY}?${params}`)
    if (!res.ok) throw new Error(`iNaturalist API error: ${res.status} ${res.statusText}`)
    const data = await res.json()
    if (data._upstream_status) return { results: [], total_results: 0 }
    return data
  }

  const fetches = []
  for (let page = 1; page <= pages; page++) {
    const p = new URLSearchParams(params)
    p.set('page', page)
    fetches.push(fetchWithTimeout(`${INAT_OBS_PROXY}?${p}`).then(r => r.ok ? r.json() : { results: [], total_results: 0 }).catch(() => ({ results: [], total_results: 0 })))
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
export function fetchTopCountries({ d1, d2 } = {}) {
  const cacheKey = `inat:topCountries:${d1 || 'all'}:${d2 || ''}`
  return cached(cacheKey, async () => {
    // One aggregate request, fanned out server-side by the proxy. Counting
    // from the browser meant one request per country — fifteen parallel calls
    // per view, which Sentry files as an N+1 API call and which burns through
    // iNat's per-IP rate limit fifteen times faster than it needs to.
    const params = new URLSearchParams({
      agg: 'place_counts',
      place_ids: INAT_COUNTRIES.map((c) => c.placeId).join(','),
    })
    if (d1) { params.set('d1', d1); if (d2) params.set('d2', d2) }
    const res = await fetchWithTimeout(`${INAT_OBS_PROXY}?${params}`)
    if (!res.ok) throw new Error(`iNaturalist API error: ${res.status} ${res.statusText}`)
    const data = await res.json()

    const counts = new Map((data.results || []).map((r) => [r.place_id, r.total_results]))
    // A place the upstream failed for comes back null. Everything failing means
    // we have no leaderboard at all — throw so callers keep what they had
    // rather than rendering a table of zeros.
    if (![...counts.values()].some((n) => n != null)) {
      throw new Error('iNaturalist API error: no place counts returned')
    }
    return INAT_COUNTRIES
      .map((c) => ({ ...c, count: counts.get(c.placeId) || 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
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
