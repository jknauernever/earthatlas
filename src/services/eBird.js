/**
 * eBird API 2.0 service
 * Docs: https://documenter.getpostman.com/view/664302/S1ENwy59
 */

const EBIRD_API = 'https://api.ebird.org/v2'
const INAT_API = 'https://api.inaturalist.org/v1'
const API_KEY = import.meta.env.VITE_EBIRD_API_KEY

// ─── Photo cache (sciName → photoUrl) ─────────────────────────
const photoCache = new Map()

async function fetchBirdPhoto(sciName) {
  if (photoCache.has(sciName)) return photoCache.get(sciName)
  try {
    const res = await fetch(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(sciName)}&per_page=1`)
    if (!res.ok) { photoCache.set(sciName, null); return null }
    const data = await res.json()
    const url = data.results?.[0]?.default_photo?.square_url || null
    photoCache.set(sciName, url)
    return url
  } catch {
    photoCache.set(sciName, null)
    return null
  }
}

// ─── Taxonomy cache ───────────────────────────────────────────
let taxonomyCache = null

export async function fetchEBirdTaxonomy() {
  if (taxonomyCache) return taxonomyCache
  const res = await fetch(`${EBIRD_API}/ref/taxonomy/ebird?fmt=json&locale=en`, {
    headers: { 'x-ebirdapitoken': API_KEY },
  })
  if (!res.ok) throw new Error(`eBird taxonomy error: ${res.status}`)
  const data = await res.json()
  // Only keep species-level entries (category === 'species')
  taxonomyCache = data
    .filter(t => t.category === 'species')
    .map(t => ({
      speciesCode: t.speciesCode,
      comName: t.comName,
      sciName: t.sciName,
      familyComName: t.familyComName || '',
      order: t.order || '',
    }))
  return taxonomyCache
}

export function searchEBirdTaxa(query) {
  if (!taxonomyCache || !query.trim()) return []
  const q = query.toLowerCase()
  return taxonomyCache
    .filter(t =>
      t.comName.toLowerCase().includes(q) ||
      t.sciName.toLowerCase().includes(q) ||
      t.speciesCode.toLowerCase().includes(q)
    )
    .slice(0, 8)
    .map(t => ({
      id: t.speciesCode,
      name: t.comName,
      scientificName: t.sciName,
      rank: 'species',
      iconicTaxon: 'Aves',
      photoUrl: null, // loaded lazily
      speciesCode: t.speciesCode,
    }))
}

// ─── Time window → back (days) ────────────────────────────────
function timeWindowToDays(timeWindow) {
  switch (timeWindow) {
    case 'hour': return 1
    case 'day':  return 1
    case 'week': return 7
    case 'month': return 30
    default: return 14
  }
}

// ─── Normalize eBird observation to iNaturalist shape ─────────
function normalizeObs(obs, photoUrl) {
  return {
    id: obs.subId,
    source: 'eBird',
    taxon: {
      name: obs.sciName,
      preferred_common_name: obs.comName,
      iconic_taxon_name: 'Aves',
      speciesCode: obs.speciesCode,
    },
    photos: photoUrl ? [{ url: photoUrl }] : [],
    observed_on: obs.obsDt ? obs.obsDt.split(' ')[0] : null,
    quality_grade: obs.obsValid ? 'research' : 'needs_id',
    place_guess: obs.locName || 'Unknown location',
    geojson: {
      type: 'Point',
      coordinates: [obs.lng, obs.lat],
    },
    user: { login: 'eBird Observer' },
    howMany: obs.howMany || null,
  }
}

// ─── Region stats ────────────────────────────────────────────
const REGIONS = [
  { code: 'US', name: 'United States', flag: '🇺🇸' },
  { code: 'CA', name: 'Canada',        flag: '🇨🇦' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'AU', name: 'Australia',     flag: '🇦🇺' },
  { code: 'IN', name: 'India',         flag: '🇮🇳' },
  { code: 'BR', name: 'Brazil',        flag: '🇧🇷' },
  { code: 'MX', name: 'Mexico',        flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia',      flag: '🇨🇴' },
  { code: 'CR', name: 'Costa Rica',    flag: '🇨🇷' },
  { code: 'ZA', name: 'South Africa',  flag: '🇿🇦' },
  { code: 'ES', name: 'Spain',         flag: '🇪🇸' },
  { code: 'DE', name: 'Germany',       flag: '🇩🇪' },
]

async function fetchRegionStats(code, date) {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  const res = await fetch(`${EBIRD_API}/product/stats/${code}/${y}/${m}/${d}`, {
    headers: { 'x-ebirdapitoken': API_KEY },
  })
  if (!res.ok) return null
  return res.json()
}

export async function fetchEBirdDashboardStats(date) {
  // Fetch stats for all regions in parallel
  const results = await Promise.all(
    REGIONS.map(async (region) => {
      const stats = await fetchRegionStats(region.code, date)
      return stats ? { ...region, ...stats } : null
    })
  )
  const valid = results.filter(Boolean)

  // Sort by checklists descending
  valid.sort((a, b) => b.numChecklists - a.numChecklists)

  // Totals across tracked regions
  const totalChecklists = valid.reduce((s, r) => s + r.numChecklists, 0)
  const totalContributors = valid.reduce((s, r) => s + r.numContributors, 0)
  const totalSpecies = valid.reduce((s, r) => s + r.numSpecies, 0)

  return { regions: valid, totalChecklists, totalContributors, totalSpecies }
}

// ─── Fetch observations ───────────────────────────────────────
export async function fetchEBirdObservations({ lat, lng, radiusKm, timeWindow, perPage = 200, speciesCode }) {
  const back = timeWindowToDays(timeWindow)
  const dist = Math.min(radiusKm, 50) // eBird max 50km

  let url
  if (speciesCode) {
    url = `${EBIRD_API}/data/obs/geo/recent/${speciesCode}`
  } else {
    url = `${EBIRD_API}/data/obs/geo/recent`
  }

  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lng: lng.toFixed(4),
    dist,
    back,
    maxResults: Math.min(perPage, 10000),
    includeProvisional: true,
  })

  const res = await fetch(`${url}?${params}`, {
    headers: { 'x-ebirdapitoken': API_KEY },
  })
  if (!res.ok) throw new Error(`eBird API error: ${res.status} ${res.statusText}`)
  const rawResults = await res.json()

  // Fetch photos for unique species (in parallel, batched)
  const uniqueSpecies = [...new Set(rawResults.map(r => r.sciName))]
  await Promise.all(uniqueSpecies.map(sci => fetchBirdPhoto(sci)))

  // Normalize all observations
  const results = rawResults.map(obs => normalizeObs(obs, photoCache.get(obs.sciName)))

  return {
    total_results: rawResults.length,
    results,
  }
}
