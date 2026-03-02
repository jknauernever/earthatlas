/**
 * Unified insights adapter layer
 * Returns a normalized shape regardless of data source.
 *
 * Shape:
 * {
 *   totalCount:      number,
 *   totalSpecies:    number,
 *   years:           [{ name, count }] | null,       — GBIF only
 *   months:          [{ name, count }] | null,       — GBIF + eBird
 *   iucnCategories:  [{ name, count }] | null,       — GBIF only
 *   basisOfRecord:   [{ name, count }] | null,       — GBIF only
 *   datasets:        [{ name, count }] | null,       — GBIF only
 *
 *   // Species: ready to render (commonName, scientificName, count, iconicTaxon, photoUrl)
 *   species:         [...] | null,
 *   _speciesKeys:    [...] | null,  — GBIF: raw keys for progressive resolution
 *
 *   // Taxonomy: ready to render (name, count, iconicTaxon)
 *   classes:         [...] | null,
 *   _classKeys:      [...] | null,  — GBIF: raw keys for progressive resolution
 * }
 */

import { fetchGBIFFacets, resolveSpeciesNames, resolveClassNames, resolveDatasetNames, fetchSpeciesPhotos } from './gbif'
import { fetchObservations, fetchSpeciesCounts } from './iNaturalist'
import { fetchEBirdObservations } from './eBird'
import { getDateRangeStart } from '../utils/taxon'
import { getTaxonMeta } from '../utils/taxon'

const INAT_API = 'https://api.inaturalist.org/v1'

// ─── GBIF adapter ─────────────────────────────────────────────────
async function fetchGBIFInsights(params) {
  const { lat, lng, radiusKm, d1, d2, taxonKey, iconicTaxa } = params

  const facets = await fetchGBIFFacets({ lat, lng, radiusKm, d1, d2, taxonKey, iconicTaxa })

  return {
    totalCount: facets.totalCount,
    totalSpecies: facets.totalSpecies,
    years: facets.years,
    months: facets.months,
    iucnCategories: facets.iucnCategories,
    basisOfRecord: facets.basisOfRecord,
    datasets: facets.datasets,
    species: null,          // resolved progressively
    _speciesKeys: facets.speciesKeys,
    classes: null,          // resolved progressively
    _classKeys: facets.classKeys,
    _datasetKeys: facets.datasets,
  }
}

// ─── iNaturalist adapter ──────────────────────────────────────────
async function fetchINatInsights(params) {
  const { lat, lng, radiusKm, d1, d2, taxonId, iconicTaxa } = params

  // Parallel: total count + species counts
  const [obsData, speciesData] = await Promise.all([
    fetchObservations({ lat, lng, radiusKm, d1, d2, perPage: 0, taxonId, iconicTaxa }),
    fetchSpeciesCounts({ lat, lng, radiusKm, d1, d2, taxonId, iconicTaxa }),
  ])

  const totalCount = obsData.total_results || 0
  const speciesResults = speciesData.results || []

  // Map species to normalized shape (photos are included natively from iNat)
  const species = speciesResults.slice(0, 20).map(s => ({
    key: s.taxon?.id || s.taxon?.name,
    count: s.count,
    scientificName: s.taxon?.name || 'Unknown',
    commonName: s.taxon?.preferred_common_name || null,
    iconicTaxon: s.taxon?.iconic_taxon_name || null,
    photoUrl: s.taxon?.default_photo?.square_url || null,
  }))

  // Taxonomy: group by iconic_taxon_name from species counts
  const taxonGroups = {}
  for (const s of speciesResults) {
    const group = s.taxon?.iconic_taxon_name || 'Other'
    if (!taxonGroups[group]) taxonGroups[group] = 0
    taxonGroups[group] += s.count
  }
  const classes = Object.entries(taxonGroups)
    .map(([name, count]) => {
      const { emoji } = getTaxonMeta(name)
      return { key: name, name, count, iconicTaxon: name }
    })
    .sort((a, b) => b.count - a.count)

  return {
    totalCount,
    totalSpecies: speciesData.total_results || 0,
    years: null,
    months: null,
    iucnCategories: null,
    basisOfRecord: null,
    species,
    _speciesKeys: null,
    classes,
    _classKeys: null,
  }
}

// ─── eBird adapter ────────────────────────────────────────────────
async function fetchEBirdInsights(params) {
  const { lat, lng, radiusKm, timeWindow, speciesCode } = params

  const data = await fetchEBirdObservations({ lat, lng, radiusKm, timeWindow, perPage: 200, speciesCode })
  const results = data.results || []

  // Determine trend granularity: hour for 1-day windows, day for longer
  const useHourly = timeWindow === 'hour' || timeWindow === 'day'

  // Unique species by sciName, count observations
  const speciesMap = {}
  const familyMap = {}
  const trendMap = {}

  for (const obs of results) {
    const sci = obs.taxon?.name || 'Unknown'
    const common = obs.taxon?.preferred_common_name || null
    const family = obs.taxon?.familyComName || 'Unknown'
    const photoUrl = obs.photos?.[0]?.url || null

    // Species aggregation — use howMany (individual count) for eBird
    const individuals = obs.howMany || 1
    if (!speciesMap[sci]) {
      speciesMap[sci] = { sciName: sci, commonName: common, count: 0, sightings: 0, photoUrl }
    }
    speciesMap[sci].count += individuals
    speciesMap[sci].sightings++

    // Recent trend: group by hour or day from _obsDt ("YYYY-MM-DD HH:MM" or "YYYY-MM-DD")
    if (obs._obsDt) {
      if (useHourly) {
        const timePart = obs._obsDt.split(' ')[1]
        if (timePart) {
          const hour = parseInt(timePart.split(':')[0], 10)
          trendMap[hour] = (trendMap[hour] || 0) + 1
        }
      } else {
        const day = obs._obsDt.split(' ')[0] // "YYYY-MM-DD"
        trendMap[day] = (trendMap[day] || 0) + 1
      }
    }

    // Family aggregation — use individual count
    if (family) {
      if (!familyMap[family]) familyMap[family] = 0
      familyMap[family] += individuals
    }
  }

  // Sort species by count desc, take top 20
  const sortedSpecies = Object.values(speciesMap)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  // Species need iNat photos — store sciNames for progressive loading
  const species = sortedSpecies.map(s => ({
    key: s.sciName,
    count: s.count,
    sightings: s.sightings,
    scientificName: s.sciName,
    commonName: s.commonName,
    iconicTaxon: 'Aves',
    photoUrl: s.photoUrl,
  }))

  // Taxonomy by family
  const classes = Object.entries(familyMap)
    .map(([name, count]) => ({ key: name, name, count, iconicTaxon: 'Aves' }))
    .sort((a, b) => b.count - a.count)

  const uniqueSpeciesCount = Object.keys(speciesMap).length

  // Build recent trend array
  let recentTrend = null
  const trendEntries = Object.entries(trendMap)
  if (trendEntries.length > 0) {
    if (useHourly) {
      // Fill all 24 hours, sorted 0–23
      recentTrend = Array.from({ length: 24 }, (_, h) => ({
        key: h,
        label: `${h.toString().padStart(2, '0')}:00`,
        count: trendMap[h] || 0,
      }))
    } else {
      // Sort days chronologically
      recentTrend = trendEntries
        .map(([day, count]) => ({ key: day, label: day, count }))
        .sort((a, b) => a.key.localeCompare(b.key))
    }
  }

  const totalIndividuals = Object.values(speciesMap).reduce((sum, s) => sum + s.count, 0)

  return {
    totalCount: totalIndividuals,
    totalSpecies: uniqueSpeciesCount,
    years: null,
    months: null,
    recentTrend,
    iucnCategories: null,
    basisOfRecord: null,
    species,
    _speciesKeys: null,
    classes,
    _classKeys: null,
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Fetch insights data for any source.
 * @param {'GBIF'|'iNaturalist'|'eBird'} source
 * @param {object} params — search parameters (lat, lng, radiusKm, etc.)
 * @returns Normalized insights data
 */
export async function fetchInsightsData(source, params) {
  switch (source) {
    case 'GBIF':
      return fetchGBIFInsights(params)
    case 'iNaturalist':
      return fetchINatInsights(params)
    case 'eBird':
      return fetchEBirdInsights(params)
    default:
      throw new Error(`Unknown data source: ${source}`)
  }
}

/**
 * Progressive resolution for GBIF species keys.
 * Returns resolved species array with photos.
 */
export async function resolveGBIFSpecies(speciesKeys) {
  const resolved = await resolveSpeciesNames(speciesKeys)
  return resolved
}

export async function resolveGBIFSpeciesPhotos(speciesList) {
  return fetchSpeciesPhotos(speciesList)
}

/**
 * Progressive resolution for GBIF class keys.
 */
export async function resolveGBIFClasses(classKeys) {
  return resolveClassNames(classKeys)
}

/**
 * Progressive resolution for GBIF dataset keys.
 */
export async function resolveGBIFDatasets(datasetKeys) {
  return resolveDatasetNames(datasetKeys)
}

/**
 * Fetch species detail for the species modal.
 * Uses iNaturalist to resolve taxonomy info + month-of-year histogram.
 * For GBIF species, also fetches local year trend via GBIF facets.
 */
export async function fetchSpeciesDetail({ scientificName, gbifKey, source, coords, radiusKm }) {
  // Step 1: Resolve taxon via iNat for info + photo + Wikipedia
  let taxonInfo = null
  let iNatTaxonId = null
  try {
    const res = await fetch(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(scientificName)}&per_page=1`)
    if (res.ok) {
      const data = await res.json()
      const t = data.results?.[0]
      if (t) {
        iNatTaxonId = t.id
        taxonInfo = {
          id: t.id,
          commonName: t.preferred_common_name || null,
          scientificName: t.name,
          rank: t.rank,
          iconicTaxon: t.iconic_taxon_name,
          photoUrl: t.default_photo?.medium_url || t.default_photo?.square_url || null,
          wikipediaSummary: t.wikipedia_summary || null,
          wikipediaUrl: t.wikipedia_url || null,
          conservationStatus: t.conservation_status?.status_name || null,
          conservationAuthority: t.conservation_status?.authority || null,
          ancestors: (t.ancestors || []).map(a => a.preferred_common_name || a.name).filter(Boolean),
        }
      }
    }
  } catch { /* ignore */ }

  // Step 2: Fetch month-of-year histogram from iNat (global seasonality)
  let seasonality = null
  if (iNatTaxonId) {
    try {
      const res = await fetch(
        `${INAT_API}/observations/histogram?taxon_id=${iNatTaxonId}&date_field=observed&interval=month_of_year`
      )
      if (res.ok) {
        const data = await res.json()
        const monthData = data.results?.month_of_year
        if (monthData) {
          seasonality = Object.entries(monthData).map(([m, count]) => ({
            name: String(m),
            count,
          }))
        }
      }
    } catch { /* ignore */ }
  }

  // Step 3: For GBIF, fetch local year trend for this species
  let yearTrend = null
  if (source === 'GBIF' && gbifKey && coords) {
    try {
      const facets = await fetchGBIFFacets({
        lat: coords.lat,
        lng: coords.lng,
        radiusKm: radiusKm || 50,
        taxonKey: gbifKey,
      })
      if (facets.years?.length > 0) {
        yearTrend = facets.years
      }
    } catch { /* ignore */ }
  }

  return {
    taxonInfo,
    seasonality,
    yearTrend,
  }
}
