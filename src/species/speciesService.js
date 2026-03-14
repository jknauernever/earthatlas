/**
 * Species detail page data service.
 *
 * Checks for preloaded build-time data first (src/data/species/{taxonId}.json),
 * then falls back to live API calls for species not yet preloaded.
 */
import { cached } from '../utils/cache.js'

const INAT_API = 'https://api.inaturalist.org/v1'
const GBIF_API = 'https://api.gbif.org/v1'

// ─── Preloaded data ────────────────────────────────────────────────────────
// Vite's import.meta.glob creates lazy loaders for prebuilt species JSON files.
// Each species is loaded on demand — not bundled into the main JS.
const preloadedLoaders = import.meta.glob('../data/species/[0-9]*.json')

async function getPreloaded(taxonId) {
  for (const [key, loader] of Object.entries(preloadedLoaders)) {
    if (key.includes(`/${taxonId}.json`)) {
      const mod = await loader()
      return mod.default || mod
    }
  }
  return null
}

// Name→ID index is small enough to load eagerly
let speciesIndex = null
try {
  const indexModules = import.meta.glob('../data/species/_index.json', { eager: true })
  for (const mod of Object.values(indexModules)) speciesIndex = mod.default || mod
} catch {}

/**
 * Resolve a scientific name to an iNaturalist taxon ID.
 * Uses the preloaded index first, then falls back to API.
 */
export function resolveInatId(scientificName) {
  if (!scientificName) return Promise.resolve(null)
  if (speciesIndex?.[scientificName]) return Promise.resolve(speciesIndex[scientificName])

  return cached(`inat-resolve:${scientificName}`, async () => {
    const res = await fetch(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&per_page=1`)
    const data = await res.json()
    return data.results?.[0]?.id || null
  })
}

// ─── Preloaded bundle: returns all data at once if available ───────────────

/**
 * Try to load species data from the preloaded bundle.
 * Returns { taxon, seasonality, recentObs, wiki, gbifPoints } or null.
 */
export async function getPreloadedBundle(taxonId) {
  const data = await getPreloaded(taxonId)
  if (!data) return null
  return {
    taxon: data,
    seasonality: data.seasonality || null,
    recentObs: data.recentObs || null,
    wiki: data.wiki || null,
    gbifPoints: data.gbifPoints || null,
  }
}

// ─── GBIF → iNat resolution ─────────────────────────────────────────────────

/**
 * Given a GBIF species key, resolve the scientific name via GBIF,
 * then find the matching iNaturalist taxon ID.
 * Returns the iNat taxon ID (number) or null.
 */
export function resolveGBIFToINat(gbifKey) {
  return cached(`gbif-to-inat:${gbifKey}`, async () => {
    const gbifRes = await fetch(`${GBIF_API}/species/${gbifKey}`)
    if (!gbifRes.ok) return null
    const gbifData = await gbifRes.json()
    const sciName = gbifData.species || gbifData.canonicalName || gbifData.scientificName
    if (!sciName) return null

    const inatRes = await fetch(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(sciName)}&per_page=5&rank=species`)
    if (!inatRes.ok) return null
    const inatData = await inatRes.json()
    // Match on exact scientific name
    const match = inatData.results?.find(t => t.name?.toLowerCase() === sciName.toLowerCase())
    return match?.id || inatData.results?.[0]?.id || null
  })
}

// ─── Live API fetches (fallback) ───────────────────────────────────────────

export function fetchTaxonDetail(taxonId) {
  return cached(`taxon:${taxonId}`, async () => {
    const res = await fetch(`${INAT_API}/taxa/${taxonId}`)
    if (!res.ok) throw new Error(`iNaturalist taxa ${taxonId}: ${res.status}`)
    const data = await res.json()
    return data.results?.[0] || null
  })
}

export function fetchSeasonality(taxonId) {
  return cached(`season:${taxonId}`, async () => {
    const res = await fetch(
      `${INAT_API}/observations/histogram?taxon_id=${taxonId}&date_field=observed&interval=month_of_year`
    )
    if (!res.ok) throw new Error(`iNaturalist histogram: ${res.status}`)
    const data = await res.json()
    const m = data.results?.month_of_year || {}
    return Array.from({ length: 12 }, (_, i) => m[i + 1] || 0)
  })
}

export function fetchINatMapPoints(taxonId, perPage = 200) {
  if (!taxonId) return Promise.resolve([])

  return cached(`inat-map-pts:${taxonId}:${perPage}`, async () => {
    const res = await fetch(
      `${INAT_API}/observations?taxon_id=${taxonId}&per_page=${perPage}&order=desc&order_by=observed_on&quality_grade=research&geo=true`
    )
    if (!res.ok) return []
    const data = await res.json()
    return (data.results || [])
      .filter(o => o.geojson?.coordinates)
      .map(o => ({
        lat: o.geojson.coordinates[1],
        lng: o.geojson.coordinates[0],
        date: o.observed_on || null,
        place: o.place_guess || null,
        observer: o.user?.login || null,
        source: 'iNaturalist',
        sourceId: String(o.id),
        photo: o.photos?.[0]?.url?.replace('square', 'medium') || null,
      }))
  })
}

export function fetchRecentObservations(taxonId, perPage = 8) {
  return cached(`recent:${taxonId}`, async () => {
    const res = await fetch(
      `${INAT_API}/observations?taxon_id=${taxonId}&per_page=${perPage}&order=desc&order_by=observed_on&photos=true&quality_grade=research`
    )
    if (!res.ok) throw new Error(`iNaturalist observations: ${res.status}`)
    const data = await res.json()
    return data.results || []
  }, 15 * 60 * 1000)
}

export function fetchWikipediaExtract(wikipediaUrl) {
  if (!wikipediaUrl) return Promise.resolve(null)
  const match = wikipediaUrl.match(/\/wiki\/(.+)$/)
  if (!match) return Promise.resolve(null)
  const title = match[1]

  return cached(`wiki:${title}`, async () => {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    )
    if (!res.ok) return null
    return res.json()
  })
}

/**
 * Resolve a scientific name to a GBIF taxon key.
 */
export function resolveGBIFTaxonKey(scientificName) {
  if (!scientificName) return Promise.resolve(null)

  return cached(`gbif-key:${scientificName}`, async () => {
    const res = await fetch(
      `${GBIF_API}/species/match?name=${encodeURIComponent(scientificName)}&strict=true`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.usageKey || null
  })
}

export function fetchGBIFPoints(scientificName, limit = 800) {
  if (!scientificName) return Promise.resolve([])

  return cached(`gbif-pts:${scientificName}:${limit}`, async () => {
    const taxonKey = await resolveGBIFTaxonKey(scientificName)
    if (!taxonKey) return []

    const occRes = await fetch(
      `${GBIF_API}/occurrence/search?taxonKey=${taxonKey}&hasCoordinate=true&limit=${limit}&hasGeospatialIssue=false`
    )
    if (!occRes.ok) return []
    const occData = await occRes.json()

    return (occData.results || [])
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .map(o => ({
        lat: o.decimalLatitude,
        lng: o.decimalLongitude,
        date: o.eventDate?.split('T')[0] || null,
        place: [o.locality, o.stateProvince, o.country].filter(Boolean).join(', ') || null,
        observer: o.recordedBy || o.institutionCode || null,
        source: 'GBIF',
        sourceId: String(o.key),
      }))
  })
}
