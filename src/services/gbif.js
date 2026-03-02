/**
 * GBIF Occurrence API v1 service
 * Docs: https://www.gbif.org/developer/occurrence
 *
 * No API key required for read/search operations.
 * GBIF ingests iNaturalist data — records may overlap with iNaturalist source.
 * To filter out iNaturalist-originated records in the future, use:
 *   datasetKey=50c9509d-22c7-4a22-a47d-8c48425ef4a7 (iNaturalist's GBIF dataset key)
 * and exclude those results.
 *
 * Attribution: Data from GBIF.org — CC BY 4.0
 */

import { cached } from '../utils/cache'

const GBIF_API = 'https://api.gbif.org/v1'

// ─── Iconic taxon mapping (GBIF class/kingdom → iNaturalist iconic name) ──────
const CLASS_TO_ICONIC = {
  aves:          'Aves',
  mammalia:      'Mammalia',
  reptilia:      'Reptilia',
  amphibia:      'Amphibia',
  insecta:       'Insecta',
  arachnida:     'Arachnida',
  actinopterygii:'Actinopterygii',
  actinopteri:   'Actinopterygii', // alternate GBIF class name
  mollusca:      'Mollusca',
}

const KINGDOM_TO_ICONIC = {
  plantae:  'Plantae',
  fungi:    'Fungi',
  chromista:'Chromista',
  animalia: null, // need class to be more specific
}

function deriveIconicTaxon(gbifClass, gbifKingdom) {
  if (gbifClass) {
    const match = CLASS_TO_ICONIC[gbifClass.toLowerCase()]
    if (match) return match
  }
  if (gbifKingdom) {
    const match = KINGDOM_TO_ICONIC[gbifKingdom.toLowerCase()]
    if (match !== undefined) return match
  }
  return null
}

// ─── Map iconic taxon filter → GBIF backbone taxonKey(s) ─────────────────────
// GBIF uses numeric backbone taxonomy keys, not text names.
// Reptilia is paraphyletic in GBIF — use Squamata + Testudines + Crocodylia.
const ICONIC_TO_TAXON_KEYS = {
  Aves:           [212],
  Mammalia:       [359],
  Reptilia:       [11592253, 11418114, 11493978], // Squamata, Testudines, Crocodylia
  Amphibia:       [131],
  Insecta:        [216],
  Arachnida:      [367],
  Actinopterygii: [204],
  Mollusca:       [52],
  Plantae:        [6],
  Fungi:          [5],
  Chromista:      [4],
}

// ─── Bounding box helper ─────────────────────────────────────────────────────
function getBoundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)))
  return {
    minLat: (lat - latDelta).toFixed(6),
    maxLat: (lat + latDelta).toFixed(6),
    minLng: (lng - lngDelta).toFixed(6),
    maxLng: (lng + lngDelta).toFixed(6),
  }
}

// ─── Normalize a GBIF occurrence to iNaturalist observation shape ─────────────
function normalizeOccurrence(occ) {
  const lng = occ.decimalLongitude
  const lat = occ.decimalLatitude

  const photos = (occ.media || [])
    .filter(m => m.type === 'StillImage' && m.identifier)
    .slice(0, 3)
    .map(m => ({ url: m.identifier }))

  const placeParts = [occ.locality, occ.stateProvince, occ.country].filter(Boolean)
  const place = placeParts.length > 0 ? placeParts.join(', ') : null

  const iconicTaxon = deriveIconicTaxon(occ.class, occ.kingdom)

  const isResearchGrade =
    occ.hasGeospatialIssues === false &&
    occ.taxonRank === 'SPECIES'

  return {
    id: String(occ.key),
    source: 'GBIF',
    taxon: {
      name: occ.species || occ.genus || occ.family || 'Unknown',
      preferred_common_name: occ.vernacularName || null,
      iconic_taxon_name: iconicTaxon,
      rank: occ.taxonRank?.toLowerCase() || null,
      wikipedia_url: null,
      id: occ.taxonKey || null,
    },
    photos,
    observed_on: occ.eventDate ? occ.eventDate.split('T')[0] : null,
    quality_grade: isResearchGrade ? 'research' : 'casual',
    place_guess: place,
    geojson: (lng != null && lat != null)
      ? { type: 'Point', coordinates: [lng, lat] }
      : null,
    user: {
      login: occ.recordedBy || occ.institutionCode || occ.datasetName || 'GBIF Contributor',
      icon_url: null,
    },
    num_identification_agreements: null,
    num_identification_disagreements: null,
    datasetName: occ.datasetName || null,
    basisOfRecord: occ.basisOfRecord || null,
    institutionCode: occ.institutionCode || null,
  }
}

// ─── Occurrences (geo search) ─────────────────────────────────────────────────
export async function fetchGBIFOccurrences({
  lat, lng, radiusKm,
  d1, d2,
  perPage = 50,
  taxonKey,
  iconicTaxa,
}) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    limit: Math.min(perPage, 300),
    offset: 0,
  })

  if (d1) {
    params.set('eventDate', `${d1},${d2 || new Date().toISOString().split('T')[0]}`)
  }

  if (taxonKey) {
    params.set('taxonKey', taxonKey)
  }

  // Iconic taxon filter — append taxonKey(s) from backbone taxonomy
  if (iconicTaxa && !taxonKey) {
    const keys = ICONIC_TO_TAXON_KEYS[iconicTaxa]
    if (keys) keys.forEach(k => params.append('taxonKey', k))
  }

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF API error: ${res.status} ${res.statusText}`)

  const data = await res.json()

  return {
    total_results: data.count || 0,
    results: (data.results || []).map(normalizeOccurrence),
  }
}

// ─── Species autocomplete ─────────────────────────────────────────────────────
export async function searchGBIFTaxa(query) {
  if (!query.trim()) return []
  try {
    const params = new URLSearchParams({ q: query, limit: 8 })
    const res = await fetch(`${GBIF_API}/species/suggest?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    return (data || []).map(t => ({
      id: t.key,
      name: t.vernacularName || t.canonicalName || t.scientificName,
      scientificName: t.canonicalName || t.scientificName,
      rank: t.rank?.toLowerCase() || null,
      iconicTaxon: deriveIconicTaxon(t.class, t.kingdom),
      photoUrl: null,
      gbifKey: t.key,
    }))
  } catch {
    return []
  }
}

// ─── Dashboard stats ─────────────────────────────────────────────────────────

export function fetchGBIFGlobalStats() {
  return cached('gbif:globalStats', async () => {
    const [countRes, speciesRes, datasetRes] = await Promise.all([
      fetch(`${GBIF_API}/occurrence/count`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${GBIF_API}/species/search?limit=0&rank=SPECIES&status=ACCEPTED`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${GBIF_API}/dataset/search?limit=0`).then(r => r.ok ? r.json() : null).catch(() => null),
    ])
    return {
      totalOccurrences: countRes || 0,
      totalSpecies: speciesRes?.count || 0,
      totalDatasets: datasetRes?.count || 0,
    }
  })
}

const COUNTRY_NAMES = {
  UNITED_STATES:'United States',AUSTRALIA:'Australia',CANADA:'Canada',FRANCE:'France',
  UNITED_KINGDOM:'United Kingdom',SWEDEN:'Sweden',NETHERLANDS:'Netherlands',SPAIN:'Spain',
  NORWAY:'Norway',GERMANY:'Germany',DENMARK:'Denmark',INDIA:'India',FINLAND:'Finland',
  SOUTH_AFRICA:'South Africa',BELGIUM:'Belgium',BRAZIL:'Brazil',COLOMBIA:'Colombia',
  MEXICO:'Mexico',COSTA_RICA:'Costa Rica',SWITZERLAND:'Switzerland',TAIWAN:'Taiwan',
  PORTUGAL:'Portugal',CHILE:'Chile',RUSSIAN_FEDERATION:'Russia',NEW_ZEALAND:'New Zealand',
  ARGENTINA:'Argentina',POLAND:'Poland',AUSTRIA:'Austria',JAPAN:'Japan',ITALY:'Italy',
}
const COUNTRY_FLAGS = {
  UNITED_STATES:'🇺🇸',AUSTRALIA:'🇦🇺',CANADA:'🇨🇦',FRANCE:'🇫🇷',UNITED_KINGDOM:'🇬🇧',
  SWEDEN:'🇸🇪',NETHERLANDS:'🇳🇱',SPAIN:'🇪🇸',NORWAY:'🇳🇴',GERMANY:'🇩🇪',DENMARK:'🇩🇰',
  INDIA:'🇮🇳',FINLAND:'🇫🇮',SOUTH_AFRICA:'🇿🇦',BELGIUM:'🇧🇪',BRAZIL:'🇧🇷',COLOMBIA:'🇨🇴',
  MEXICO:'🇲🇽',COSTA_RICA:'🇨🇷',SWITZERLAND:'🇨🇭',TAIWAN:'🇹🇼',PORTUGAL:'🇵🇹',CHILE:'🇨🇱',
  RUSSIAN_FEDERATION:'🇷🇺',NEW_ZEALAND:'🇳🇿',ARGENTINA:'🇦🇷',POLAND:'🇵🇱',AUSTRIA:'🇦🇹',
  JAPAN:'🇯🇵',ITALY:'🇮🇹',
}

export function fetchGBIFTopCountries(limit = 12) {
  return cached(`gbif:topCountries:${limit}`, async () => {
    const res = await fetch(`${GBIF_API}/occurrence/counts/countries`)
    if (!res.ok) return []
    const data = await res.json()
    return Object.entries(data)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([code, count]) => ({
        code,
        name: COUNTRY_NAMES[code] || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).toLowerCase().replace(/\b\w/g, c => c.toUpperCase()),
        flag: COUNTRY_FLAGS[code] || '🌍',
        count,
      }))
  })
}

const KINGDOM_KEYS = [
  { key: 1, name: 'Animalia',  emoji: '🐾' },
  { key: 6, name: 'Plantae',   emoji: '🌿' },
  { key: 3, name: 'Bacteria',  emoji: '🦠' },
  { key: 5, name: 'Fungi',     emoji: '🍄' },
  { key: 4, name: 'Chromista', emoji: '🔬' },
]

export function fetchGBIFKingdomCounts() {
  return cached('gbif:kingdomCounts', async () => {
    const results = await Promise.all(
      KINGDOM_KEYS.map(async (k) => {
        const res = await fetch(`${GBIF_API}/occurrence/search?limit=0&taxonKey=${k.key}`)
        if (!res.ok) return { ...k, count: 0 }
        const data = await res.json()
        return { ...k, count: data.count || 0 }
      })
    )
    return results.sort((a, b) => b.count - a.count)
  })
}

// ─── Faceted aggregation queries (for Insights dashboard) ────────────────────

export async function fetchGBIFFacets({ lat, lng, radiusKm, d1, d2, taxonKey, iconicTaxa }) {
  const bb = getBoundingBox(lat, lng, radiusKm)

  const params = new URLSearchParams({
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${bb.minLat},${bb.maxLat}`,
    decimalLongitude: `${bb.minLng},${bb.maxLng}`,
    limit: '0',
    facetLimit: '50',
  })

  // Add all facets in one request
  for (const f of ['speciesKey', 'year', 'month', 'classKey', 'iucnRedListCategory', 'basisOfRecord', 'datasetKey']) {
    params.append('facet', f)
  }
  // High limit to count total unique species; we'll slice top 20 for display
  params.set('speciesKey.facetLimit', '100000')

  if (d1) params.set('eventDate', `${d1},${d2 || new Date().toISOString().split('T')[0]}`)
  if (taxonKey) params.set('taxonKey', taxonKey)
  if (iconicTaxa && !taxonKey) {
    const keys = ICONIC_TO_TAXON_KEYS[iconicTaxa]
    if (keys) keys.forEach(k => params.append('taxonKey', k))
  }

  const res = await fetch(`${GBIF_API}/occurrence/search?${params}`)
  if (!res.ok) throw new Error(`GBIF facets error: ${res.status}`)
  const data = await res.json()

  const facetMap = {}
  for (const f of (data.facets || [])) {
    facetMap[f.field] = f.counts.map(c => ({ name: c.name, count: c.count }))
  }

  const allSpeciesKeys = facetMap.SPECIES_KEY || []

  return {
    totalCount: data.count || 0,
    totalSpecies: allSpeciesKeys.length,
    speciesKeys: allSpeciesKeys.slice(0, 20), // top 20 for display
    years: facetMap.YEAR || [],
    months: facetMap.MONTH || [],
    classKeys: facetMap.CLASS_KEY || [],
    iucnCategories: facetMap.IUCN_RED_LIST_CATEGORY || [],
    basisOfRecord: facetMap.BASIS_OF_RECORD || [],
    datasets: facetMap.DATASET_KEY || [],
  }
}

// ─── Resolve species names from GBIF backbone keys ──────────────────────────

const INAT_API = 'https://api.inaturalist.org/v1'

export async function resolveSpeciesNames(speciesKeys) {
  return Promise.all(
    speciesKeys.map(async ({ name: key, count }) => {
      try {
        const res = await fetch(`${GBIF_API}/species/${key}`)
        if (!res.ok) return { key, count, scientificName: 'Unknown', commonName: null, iconicTaxon: null }
        const d = await res.json()
        return {
          key: d.key,
          count,
          scientificName: d.canonicalName || d.scientificName || 'Unknown',
          commonName: d.vernacularName || null,
          iconicTaxon: deriveIconicTaxon(d.class, d.kingdom),
        }
      } catch {
        return { key, count, scientificName: 'Unknown', commonName: null, iconicTaxon: null }
      }
    })
  )
}

export async function resolveClassNames(classKeys) {
  return Promise.all(
    classKeys.map(async ({ name: key, count }) => {
      try {
        const res = await fetch(`${GBIF_API}/species/${key}`)
        if (!res.ok) return { key, count, name: `Class ${key}`, iconicTaxon: null }
        const d = await res.json()
        return {
          key: d.key,
          count,
          name: d.canonicalName || d.scientificName || `Class ${key}`,
          iconicTaxon: deriveIconicTaxon(d.canonicalName, d.kingdom),
        }
      } catch {
        return { key, count, name: `Class ${key}`, iconicTaxon: null }
      }
    })
  )
}

export async function resolveDatasetNames(datasetKeys) {
  return Promise.all(
    datasetKeys.slice(0, 15).map(async ({ name: key, count }) => {
      try {
        const res = await fetch(`${GBIF_API}/dataset/${key}`)
        if (!res.ok) return { key, count, title: key, publishingOrganization: null }
        const d = await res.json()
        return {
          key: d.key,
          count,
          title: d.title || key,
          publishingOrganization: d.publishingOrganization?.title || null,
        }
      } catch {
        return { key, count, title: key, publishingOrganization: null }
      }
    })
  )
}

export async function fetchSpeciesPhotos(speciesList) {
  return Promise.all(
    speciesList.map(async (s) => {
      try {
        const res = await fetch(`${INAT_API}/taxa/autocomplete?q=${encodeURIComponent(s.scientificName)}&per_page=1`)
        if (!res.ok) return { ...s, photoUrl: null }
        const data = await res.json()
        return { ...s, photoUrl: data.results?.[0]?.default_photo?.square_url || null }
      } catch {
        return { ...s, photoUrl: null }
      }
    })
  )
}
