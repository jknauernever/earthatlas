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

// ─── Map iconic taxon filter → GBIF query param ───────────────────────────────
function iconicTaxonToGBIFParam(iconicTaxa) {
  const classMap = {
    Aves:            { key: 'class',   val: 'Aves'       },
    Mammalia:        { key: 'class',   val: 'Mammalia'   },
    Reptilia:        { key: 'class',   val: 'Reptilia'   },
    Amphibia:        { key: 'class',   val: 'Amphibia'   },
    Insecta:         { key: 'class',   val: 'Insecta'    },
    Arachnida:       { key: 'class',   val: 'Arachnida'  },
    Actinopterygii:  { key: 'class',   val: 'Actinopterygii' },
    Mollusca:        { key: 'phylum',  val: 'Mollusca'   },
    Plantae:         { key: 'kingdom', val: 'Plantae'    },
    Fungi:           { key: 'kingdom', val: 'Fungi'      },
    Chromista:       { key: 'kingdom', val: 'Chromista'  },
  }
  return classMap[iconicTaxa] || null
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
  // Convert radius to a bounding box
  // 1° lat ≈ 111 km; 1° lng ≈ 111 km × cos(lat)
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)))

  const minLat = lat - latDelta
  const maxLat = lat + latDelta
  const minLng = lng - lngDelta
  const maxLng = lng + lngDelta

  const params = new URLSearchParams({
    hasCoordinate: 'true',
    occurrenceStatus: 'PRESENT',
    decimalLatitude: `${minLat.toFixed(6)},${maxLat.toFixed(6)}`,
    decimalLongitude: `${minLng.toFixed(6)},${maxLng.toFixed(6)}`,
    limit: Math.min(perPage, 300),
    offset: 0,
  })

  if (d1) {
    params.set('eventDate', `${d1},${d2 || new Date().toISOString().split('T')[0]}`)
  }

  if (taxonKey) {
    params.set('taxonKey', taxonKey)
  }

  if (iconicTaxa) {
    const mapped = iconicTaxonToGBIFParam(iconicTaxa)
    if (mapped) params.set(mapped.key, mapped.val)
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

export async function fetchGBIFGlobalStats() {
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

export async function fetchGBIFTopCountries(limit = 12) {
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
}

const KINGDOM_KEYS = [
  { key: 1, name: 'Animalia',  emoji: '🐾' },
  { key: 6, name: 'Plantae',   emoji: '🌿' },
  { key: 3, name: 'Bacteria',  emoji: '🦠' },
  { key: 5, name: 'Fungi',     emoji: '🍄' },
  { key: 4, name: 'Chromista', emoji: '🔬' },
]

export async function fetchGBIFKingdomCounts() {
  const results = await Promise.all(
    KINGDOM_KEYS.map(async (k) => {
      const res = await fetch(`${GBIF_API}/occurrence/search?limit=0&taxonKey=${k.key}`)
      if (!res.ok) return { ...k, count: 0 }
      const data = await res.json()
      return { ...k, count: data.count || 0 }
    })
  )
  return results.sort((a, b) => b.count - a.count)
}
