/**
 * Taxon Crosswalk Service
 *
 * Resolves species identifiers across iNaturalist, eBird, and GBIF,
 * and fetches sightings from all three sources using the correct IDs.
 */

import { fetchObservations } from './iNaturalist'
import { fetchEBirdObservations, searchEBirdTaxa, fetchEBirdTaxonomy } from './eBird'
import { fetchGBIFOccurrences } from './gbif'

// ─── Static crosswalk table ────────────────────────────────────
// Keyed by lowercase common name for fast case-insensitive lookup.
// Add entries here for frequently searched species to avoid API calls.
const STATIC_CROSSWALK = {
  'california condor': {
    commonName: 'California Condor',
    scientificName: 'Gymnogyps californianus',
    inatTaxonId: 4778,
    eBirdSpeciesCode: 'calcon',
    gbifTaxonKey: 2481920,
  },
}

// ─── API resolution helpers ────────────────────────────────────

async function resolveINat(query) {
  try {
    const res = await fetch(
      `https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(query)}&per_page=1`
    )
    if (!res.ok) return null
    const data = await res.json()
    const t = data.results?.[0]
    if (!t) return null
    return {
      id: t.id,
      scientificName: t.name,
      commonName: t.preferred_common_name || null,
    }
  } catch {
    return null
  }
}

async function resolveGBIF(query) {
  try {
    // Try suggest first (works well for scientific names)
    const res = await fetch(
      `https://api.gbif.org/v1/species/suggest?q=${encodeURIComponent(query)}&limit=1`
    )
    if (res.ok) {
      const data = await res.json()
      if (data[0]) return { key: data[0].key, canonicalName: data[0].canonicalName || null }
    }
    // Fall back to match endpoint (better for common names)
    const matchRes = await fetch(
      `https://api.gbif.org/v1/species/match?name=${encodeURIComponent(query)}&verbose=false`
    )
    if (matchRes.ok) {
      const match = await matchRes.json()
      if (match.usageKey && match.matchType !== 'NONE') {
        return { key: match.usageKey, canonicalName: match.canonicalName || null }
      }
    }
    return null
  } catch {
    return null
  }
}

async function resolveEBird(query) {
  try {
    // Ensure taxonomy is loaded, then search it
    await fetchEBirdTaxonomy()
    const results = searchEBirdTaxa(query)
    if (results.length > 0) {
      return { speciesCode: results[0].id, comName: results[0].name }
    }
    return null
  } catch {
    return null
  }
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Resolve a species query to IDs for all three data sources.
 * Checks the static crosswalk first, then falls back to parallel API calls.
 *
 * @param {string} query — common name, scientific name, or partial match
 * @returns {Promise<{commonName, scientificName, inatTaxonId, eBirdSpeciesCode, gbifTaxonKey}>}
 */
export async function resolveSpecies(query) {
  const key = query.toLowerCase().trim()

  // Static crosswalk lookup
  if (STATIC_CROSSWALK[key]) {
    return { ...STATIC_CROSSWALK[key] }
  }

  // Dynamic resolution — query all three in parallel
  const [inat, gbif, ebird] = await Promise.all([
    resolveINat(query),
    resolveGBIF(query),
    resolveEBird(query),
  ])

  // If GBIF didn't resolve but iNat gave us a scientific name, retry GBIF
  let gbifResult = gbif
  if (!gbifResult && inat?.scientificName) {
    gbifResult = await resolveGBIF(inat.scientificName)
  }

  return {
    commonName: inat?.commonName || ebird?.comName || query,
    scientificName: inat?.scientificName || gbifResult?.canonicalName || null,
    inatTaxonId: inat?.id || null,
    eBirdSpeciesCode: ebird?.speciesCode || null,
    gbifTaxonKey: gbifResult?.key || null,
  }
}

/**
 * Fetch sightings from all three sources using pre-resolved species IDs.
 *
 * @param {object} species — output of resolveSpecies()
 * @param {object} opts — { lat, lng, radiusKm, d1?, d2?, timeWindow?, perPage? }
 * @returns {Promise<{inat: [], ebird: [], gbif: [], total: number}>}
 */
export async function fetchAllSourceSightings(species, { lat, lng, radiusKm, d1, d2, timeWindow = 'month', perPage = 200 }) {
  const [inatData, ebirdData, gbifData] = await Promise.all([
    species.inatTaxonId
      ? fetchObservations({
          lat, lng, radiusKm,
          d1, d2,
          perPage,
          taxonId: species.inatTaxonId,
        }).catch(() => ({ results: [], total_results: 0 }))
      : Promise.resolve({ results: [], total_results: 0 }),

    species.eBirdSpeciesCode
      ? fetchEBirdObservations({
          lat, lng,
          radiusKm: Math.min(radiusKm, 50), // eBird max 50km
          timeWindow,
          perPage,
          speciesCode: species.eBirdSpeciesCode,
        }).catch(() => ({ results: [], total_results: 0 }))
      : Promise.resolve({ results: [], total_results: 0 }),

    species.gbifTaxonKey
      ? fetchGBIFOccurrences({
          lat, lng, radiusKm,
          d1, d2,
          perPage,
          taxonKey: species.gbifTaxonKey,
        }).catch(() => ({ results: [], total_results: 0 }))
      : Promise.resolve({ results: [], total_results: 0 }),
  ])

  const inat = inatData.results || []
  const ebird = ebirdData.results || []
  const gbif = gbifData.results || []

  return {
    inat,
    ebird,
    gbif,
    total: inat.length + ebird.length + gbif.length,
  }
}
