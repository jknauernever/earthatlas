/**
 * eBird API 2.0 service
 * Docs: https://documenter.getpostman.com/view/664302/S1ENwy59
 */

import { cached } from '../utils/cache'
import { fetchWithTimeout } from '../utils/fetchWithTimeout'

const EBIRD_API = 'https://api.ebird.org/v2'
const INAT_API = 'https://api.inaturalist.org/v1'
const API_KEY = import.meta.env.VITE_EBIRD_API_KEY
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// ─── Photo cache (sciName → photoUrl) ─────────────────────────
const photoCache = new Map()

async function fetchBirdPhoto(sciName) {
  if (photoCache.has(sciName)) return photoCache.get(sciName)
  try {
    const res = await fetchWithTimeout(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(sciName)}&per_page=1`)
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

export function fetchEBirdTaxonomy() {
  if (taxonomyCache) return Promise.resolve(taxonomyCache)
  return cached('ebird:taxonomy', async () => {
    const res = await fetch(`${EBIRD_API}/ref/taxonomy/ebird?fmt=json&locale=en`, {
      headers: { 'x-ebirdapitoken': API_KEY },
    })
    if (!res.ok) throw new Error(`eBird taxonomy error: ${res.status}`)
    const data = await res.json()
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
  })
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

// Build the list of (y, m, d) tuples for each calendar day in the time window,
// rolling back from today.
function daysInRange(timeWindow) {
  const n = timeWindowToDays(timeWindow)
  const out = []
  const today = new Date()
  for (let i = 0; i < n; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    out.push({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  }
  return out
}

// Haversine distance in km between two lat/lng pairs (for client-side filter
// after region-level fetches).
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371
  const toRad = deg => deg * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

async function runLimited(tasks, limit = 4) {
  const results = new Array(tasks.length)
  let i = 0
  async function worker() {
    while (i < tasks.length) {
      const idx = i++
      results[idx] = await tasks[idx]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

// Reverse-geocode lat/lng to an eBird-compatible region code (e.g. "US-NM").
// eBird's /historic endpoint takes a region code, not lat/lng, so we need this
// to translate the user's search center into something it understands.
// Cached by ~11km cell since region boundaries don't move.
const regionCodeCache = new Map()  // "lat:lng_rounded" → code | null

async function getRegionCode(lat, lng) {
  if (!MAPBOX_TOKEN) return null
  const key = `${lat.toFixed(1)}:${lng.toFixed(1)}`
  if (regionCodeCache.has(key)) return regionCodeCache.get(key)
  try {
    const res = await fetchWithTimeout(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=region,country&access_token=${MAPBOX_TOKEN}`
    )
    if (!res.ok) { regionCodeCache.set(key, null); return null }
    const data = await res.json()
    const region = data.features?.find(f => f.place_type?.includes('region'))
    const country = data.features?.find(f => f.place_type?.includes('country'))
    // Mapbox `short_code`: "US-NM" for regions, "us" for countries. eBird wants
    // uppercase: "US-NM" or "US".
    const code = (region?.properties?.short_code || country?.properties?.short_code || '').toUpperCase() || null
    regionCodeCache.set(key, code)
    return code
  } catch {
    regionCodeCache.set(key, null)
    return null
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
      familyComName: obs.familyComName || '',
      order: obs.order || '',
    },
    photos: photoUrl ? [{ url: photoUrl }] : [],
    observed_on: obs.obsDt ? obs.obsDt.split(' ')[0] : null,
    _obsDt: obs.obsDt || null,
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

export function fetchEBirdDashboardStats(date) {
  const key = `ebird:dashStats:${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  return cached(key, async () => {
    const results = await Promise.all(
      REGIONS.map(async (region) => {
        const stats = await fetchRegionStats(region.code, date)
        return stats ? { ...region, ...stats } : null
      })
    )
    const valid = results.filter(Boolean)

    valid.sort((a, b) => b.numChecklists - a.numChecklists)

    const totalChecklists = valid.reduce((s, r) => s + r.numChecklists, 0)
    const totalContributors = valid.reduce((s, r) => s + r.numContributors, 0)
    const totalSpecies = valid.reduce((s, r) => s + r.numSpecies, 0)

    return { regions: valid, totalChecklists, totalContributors, totalSpecies }
  })
}

// ─── Fetch observations ───────────────────────────────────────
//
// Two strategies, dispatched on whether we're filtering to a single species:
//
//  1. /data/obs/geo/recent (or .../{speciesCode}): one observation per species
//     within a lat/lng+dist circle, in the last N days. Used for single-species
//     queries (where one-per-species is what we want) and as fallback when we
//     can't determine an eBird region.
//
//  2. /data/obs/{regionCode}/historic/{y}/{m}/{d}: one observation per species
//     per day in a region. We fetch each day in the time window in parallel,
//     then filter by distance from the search center client-side. This
//     surfaces ~7× more checklists for "week" than approach (1), because a
//     user's checklist isn't displaced by another birder's later sighting on
//     a different day. Used for general (no speciesCode) queries when we
//     have a region.
//
// Why this matters: eBird's geographic endpoints all dedupe to one record per
// species. If you submit a checklist after someone else has logged the same
// species in the area today, the /geo/recent endpoint shows their record, not
// yours. Per-day historic fetching at least surfaces your record on its day.

async function fetchEBirdGeoRecent({ lat, lng, radiusKm, timeWindow, perPage, speciesCode }) {
  const back = timeWindowToDays(timeWindow)
  const dist = Math.min(radiusKm, 50)
  const url = speciesCode
    ? `${EBIRD_API}/data/obs/geo/recent/${speciesCode}`
    : `${EBIRD_API}/data/obs/geo/recent`
  const params = new URLSearchParams({
    lat: lat.toFixed(4),
    lng: lng.toFixed(4),
    dist,
    back,
    maxResults: Math.min(perPage, 10000),
    includeProvisional: true,
  })
  const res = await fetchWithTimeout(`${url}?${params}`, {
    headers: { 'x-ebirdapitoken': API_KEY },
  })
  if (!res.ok) throw new Error(`eBird API error: ${res.status} ${res.statusText}`)
  return res.json()
}

// Shared raw eBird fetcher used by both the main App (radius-based) and the
// /explore subsites (bbox-based). Returns un-normalized eBird records.
//
// Strategy:
//   1. Resolve a center point from either bounds or lat/lng.
//   2. Reverse-geocode that point to an eBird region code (e.g. "US-NM").
//   3. Fetch /data/obs/{regionCode}/historic for each day in the window in
//      parallel (concurrency-limited). Daily historic returns one record per
//      species per day, vs /geo/recent which returns one per species across
//      the whole window — so a user's checklist that was logged today won't
//      be displaced by yesterday's birders.
//   4. Filter records to either the user's bounding box (preferred) or
//      radius circle.
//   5. Fall back to /geo/recent if we can't resolve a region (oceans,
//      geocode failure).
//
// Returns: array of raw eBird observation records.
export async function fetchEBirdRecentRaw({ lat, lng, bounds, radiusKm, timeWindow }) {
  const centerLat = bounds ? (bounds.minLat + bounds.maxLat) / 2 : lat
  const centerLng = bounds ? (bounds.minLng + bounds.maxLng) / 2 : lng
  if (centerLat == null || centerLng == null) return []

  const regionCode = await getRegionCode(centerLat, centerLng)
  if (!regionCode) {
    // No region (ocean / geocode failure) — best effort with /geo/recent.
    const dist = bounds
      ? Math.min(50, Math.max(5, Math.round(((bounds.maxLat - bounds.minLat) * 111) / 2)))
      : Math.min(radiusKm || 50, 50)
    try {
      return await fetchEBirdGeoRecent({ lat: centerLat, lng: centerLng, radiusKm: dist, timeWindow, perPage: 10000 })
    } catch {
      return []
    }
  }

  const days = daysInRange(timeWindow)
  const tasks = days.map(({ y, m, d }) => async () => {
    const params = new URLSearchParams({
      maxResults: 10000,
      includeProvisional: true,
    })
    const res = await fetchWithTimeout(
      `${EBIRD_API}/data/obs/${regionCode}/historic/${y}/${m}/${d}?${params}`,
      { headers: { 'x-ebirdapitoken': API_KEY } }
    )
    if (!res.ok) return []
    return res.json()
  })
  const dayResults = await runLimited(tasks, 4)
  const flat = dayResults.flat()

  if (bounds) {
    return flat.filter(r =>
      r.lat != null && r.lng != null &&
      r.lat >= bounds.minLat && r.lat <= bounds.maxLat &&
      r.lng >= bounds.minLng && r.lng <= bounds.maxLng
    )
  }
  const dist = Math.min(radiusKm || 50, 50)
  return flat.filter(r =>
    r.lat != null && r.lng != null && haversineKm(lat, lng, r.lat, r.lng) <= dist
  )
}

export async function fetchEBirdObservations({ lat, lng, radiusKm, bounds, timeWindow, perPage = 200, speciesCode }) {
  let rawResults
  if (speciesCode) {
    // Single-species queries: /geo/recent is the right tool — one-per-species
    // dedup is desired. Use bbox center if provided.
    const useLat = bounds ? (bounds.minLat + bounds.maxLat) / 2 : lat
    const useLng = bounds ? (bounds.minLng + bounds.maxLng) / 2 : lng
    const useDist = bounds
      ? Math.min(50, Math.max(5, Math.round(((bounds.maxLat - bounds.minLat) * 111) / 2)))
      : Math.min(radiusKm || 50, 50)
    rawResults = await fetchEBirdGeoRecent({ lat: useLat, lng: useLng, radiusKm: useDist, timeWindow, perPage, speciesCode })
  } else {
    rawResults = await fetchEBirdRecentRaw({ lat, lng, bounds, radiusKm, timeWindow })
  }

  const uniqueSpecies = [...new Set(rawResults.map(r => r.sciName))]
  await Promise.all(uniqueSpecies.map(sci => fetchBirdPhoto(sci)))
  const results = rawResults.map(obs => normalizeObs(obs, photoCache.get(obs.sciName)))
  return { total_results: results.length, results }
}
