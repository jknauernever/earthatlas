/**
 * Shared explore service factory
 *
 * Creates a parameterized service for any taxon group (whales, sharks,
 * butterflies, etc.) that wraps GBIF and iNaturalist API calls.
 */

const GBIF_API = 'https://api.gbif.org/v1'
const INAT_API = 'https://api.inaturalist.org/v1'
const GBIF_INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'

function getBoundingBox(lat, lng, radiusKm) {
  const latDelta = radiusKm / 111
  const lngDelta = radiusKm / (111 * Math.cos(lat * (Math.PI / 180)))
  return {
    minLat: (lat - latDelta).toFixed(5),
    maxLat: (lat + latDelta).toFixed(5),
    minLng: (lng - lngDelta).toFixed(5),
    maxLng: (lng + lngDelta).toFixed(5),
  }
}

/**
 * @param {Object} config
 * @param {number} config.gbifTaxonKey   — GBIF backbone taxon key (e.g. 733 for Cetacea)
 * @param {number} config.inatTaxonId    — iNaturalist taxon ID (e.g. 152871 for Cetacea)
 * @param {Object} config.speciesMeta    — { [gbifSpeciesKey]: { common, scientific, color, emoji, ... } }
 * @param {Object} [config.fallback]     — { commonName, color, emoji } defaults for unknown species
 * @param {Function} [config.postFilter] — optional filter applied to raw GBIF occurrences (e.g. isShark)
 */
export function createExploreService({ gbifTaxonKey, inatTaxonId, speciesMeta, fallback = {}, postFilter }) {
  const defaultCommon = fallback.commonName || 'Unknown species'
  const defaultColor = fallback.color || '#888888'
  const defaultEmoji = fallback.emoji || '🔵'

  // ─── Internal helpers ──────────────────────────────────────────────────────

  function getSpeciesMeta(speciesKey) {
    return speciesMeta[speciesKey] || null
  }

  // Reverse lookup: scientific name → GBIF species key (for iNat matching)
  const _sciNameToKey = {}
  for (const [key, meta] of Object.entries(speciesMeta)) {
    _sciNameToKey[meta.scientific.toLowerCase()] = Number(key)
  }

  function gbifKeyFromScientific(sciName) {
    if (!sciName) return null
    return _sciNameToKey[sciName.toLowerCase()] || null
  }

  function normalizeOccurrence(occ) {
    const speciesKey = occ.speciesKey || occ.taxonKey
    const meta = getSpeciesMeta(speciesKey)
    return {
      id: String(occ.key),
      speciesKey,
      common: meta?.common || occ.vernacularName || occ.species || occ.genus || defaultCommon,
      scientific: occ.species || occ.genus || '',
      color: meta?.color || defaultColor,
      emoji: meta?.emoji || defaultEmoji,
      fact: meta?.fact || null,
      speciesPhoto: meta?.photoUrl || null,
      iucn: meta?.iucn || null,
      lat: occ.decimalLatitude,
      lng: occ.decimalLongitude,
      date: occ.eventDate ? occ.eventDate.split('T')[0] : null,
      place: [occ.locality, occ.stateProvince, occ.country].filter(Boolean).join(', ') || null,
      observer: occ.recordedBy || occ.institutionCode || occ.datasetName || 'GBIF contributor',
      photos: (occ.media || []).filter(m => m.type === 'StillImage' && m.identifier).slice(0, 2).map(m => m.identifier),
      source: 'GBIF',
    }
  }

  function normalizeINatObservation(obs) {
    const coords = obs.geojson?.coordinates // [lng, lat]
    if (!coords) return null
    const sciName = obs.taxon?.name || ''
    const speciesKey = gbifKeyFromScientific(sciName)
    const meta = speciesKey ? getSpeciesMeta(speciesKey) : null
    const photo = obs.photos?.[0]?.url?.replace('square', 'medium') || null
    return {
      id: `inat-${obs.id}`,
      speciesKey: speciesKey || sciName || null,
      common: obs.taxon?.preferred_common_name || meta?.common || sciName || defaultCommon,
      scientific: sciName,
      color: meta?.color || defaultColor,
      emoji: meta?.emoji || defaultEmoji,
      fact: meta?.fact || null,
      speciesPhoto: meta?.photoUrl || null,
      iucn: meta?.iucn || null,
      lat: coords[1],
      lng: coords[0],
      date: obs.observed_on || null,
      place: obs.place_guess || null,
      observer: obs.user?.login || 'iNaturalist observer',
      photos: photo ? [photo] : [],
      source: 'iNaturalist',
    }
  }

  // ─── Resolve bounding box from bounds or radiusKm ──────────────────────────

  function resolveBB({ lat, lng, radiusKm, bounds }) {
    if (bounds) {
      return {
        minLat: Number(bounds.minLat).toFixed(5),
        maxLat: Number(bounds.maxLat).toFixed(5),
        minLng: Number(bounds.minLng).toFixed(5),
        maxLng: Number(bounds.maxLng).toFixed(5),
      }
    }
    return getBoundingBox(lat, lng, radiusKm)
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async function fetchRecentSightings({ lat, lng, radiusKm = 300, bounds, days = 90, limit = 200, signal }) {
    const bb = resolveBB({ lat, lng, radiusKm, bounds })
    const d2 = new Date()
    const d1 = new Date(d2 - days * 86400000)
    const fmt = d => d.toISOString().split('T')[0]

    const params = new URLSearchParams({
      taxonKey: gbifTaxonKey,
      hasCoordinate: 'true',
      occurrenceStatus: 'PRESENT',
      decimalLatitude: `${bb.minLat},${bb.maxLat}`,
      decimalLongitude: `${bb.minLng},${bb.maxLng}`,
      eventDate: `${fmt(d1)},${fmt(d2)}`,
      limit: Math.min(limit, 300),
    })

    const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
    if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
    const data = await res.json()

    let results = (data.results || [])
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .filter(o => o.datasetKey !== GBIF_INAT_DATASET)
      .filter(o => o.basisOfRecord !== 'LIVING_SPECIMEN')

    if (postFilter) results = results.filter(postFilter)

    const sightings = results.map(normalizeOccurrence)

    return {
      total: postFilter ? sightings.length : (data.count || 0),
      sightings,
    }
  }

  async function fetchMonthSightings({ lat, lng, radiusKm = 400, bounds, month, speciesKey = null, limit = 200, signal }) {
    const bb = resolveBB({ lat, lng, radiusKm, bounds })

    // Fetch GBIF and iNaturalist in parallel
    const [gbifResult, inatResult] = await Promise.allSettled([
      (async () => {
        const params = new URLSearchParams({
          taxonKey: speciesKey || gbifTaxonKey,
          hasCoordinate: 'true',
          occurrenceStatus: 'PRESENT',
          decimalLatitude: `${bb.minLat},${bb.maxLat}`,
          decimalLongitude: `${bb.minLng},${bb.maxLng}`,
          month,
          limit: Math.min(limit, 300),
        })
        const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
        if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
        return res.json()
      })(),
      (async () => {
        // Look up iNat taxon ID: use species scientific name if filtering by species, else group ID
        let taxonId = inatTaxonId
        if (speciesKey) {
          const meta = getSpeciesMeta(speciesKey)
          if (meta?.scientific) {
            // Query iNat for the taxon ID by scientific name
            const tRes = await fetch(`${INAT_API}/taxa?q=${encodeURIComponent(meta.scientific)}&per_page=1`, {
              headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
              signal,
            })
            if (tRes.ok) {
              const tData = await tRes.json()
              if (tData.results?.[0]?.id) taxonId = tData.results[0].id
            }
          }
        }
        const geoParams = bounds
          ? { nelat: bounds.maxLat, nelng: bounds.maxLng, swlat: bounds.minLat, swlng: bounds.minLng }
          : { lat, lng, radius: radiusKm }
        const params = new URLSearchParams({
          taxon_id: taxonId,
          ...geoParams,
          month,
          order_by: 'observed_on',
          per_page: Math.min(limit, 200),
          geo: 'true',
          captive: 'false',
        })
        const res = await fetch(`${INAT_API}/observations?${params}`, {
          headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
          signal,
        })
        if (!res.ok) return { results: [], total_results: 0 }
        return res.json()
      })(),
    ])

    const gbifData = gbifResult.status === 'fulfilled' ? gbifResult.value : { results: [], count: 0 }
    const inatData = inatResult.status === 'fulfilled' ? inatResult.value : { results: [], total_results: 0 }

    let gbifResults = (gbifData.results || [])
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .filter(o => o.datasetKey !== GBIF_INAT_DATASET) // avoid duplicates with iNat
      .filter(o => o.basisOfRecord !== 'LIVING_SPECIMEN')
    if (postFilter) gbifResults = gbifResults.filter(postFilter)

    const gbifSightings = gbifResults.map(normalizeOccurrence)
    let inatSightings = (inatData.results || []).map(normalizeINatObservation).filter(Boolean)
    // Apply postFilter to iNat results too (e.g. condors: filter out non-condor vultures)
    if (postFilter) inatSightings = inatSightings.filter(s => postFilter(s))

    const allSightings = [...gbifSightings, ...inatSightings]

    return {
      total: allSightings.length,
      sightings: allSightings,
    }
  }

  async function fetchSeasonalPattern({ lat, lng, radiusKm = 500, bounds, speciesKey = null, signal }) {
    const bb = resolveBB({ lat, lng, radiusKm, bounds })

    const params = new URLSearchParams({
      taxonKey: speciesKey || gbifTaxonKey,
      hasCoordinate: 'true',
      occurrenceStatus: 'PRESENT',
      decimalLatitude: `${bb.minLat},${bb.maxLat}`,
      decimalLongitude: `${bb.minLng},${bb.maxLng}`,
      limit: '0',
      facet: 'month',
      'month.facetLimit': '12',
    })

    const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
    if (!res.ok) throw new Error(`GBIF facets error: ${res.status}`)
    const data = await res.json()

    const monthFacet = (data.facets || []).find(f => f.field === 'MONTH')
    const counts = monthFacet?.counts || []

    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const found = counts.find(c => Number(c.name) === m)
      return { month: m, count: found ? found.count : 0 }
    })
  }

  async function fetchINatSightings({ lat, lng, radiusKm = 300, bounds, days = 90, limit = 200, signal }) {
    try {
      const d2 = new Date()
      const d1 = new Date(d2 - days * 86400000)
      const fmt = d => d.toISOString().split('T')[0]

      // iNat uses nelat/nelng/swlat/swlng when bounds are provided, otherwise lat/lng/radius
      const geoParams = bounds
        ? { nelat: bounds.maxLat, nelng: bounds.maxLng, swlat: bounds.minLat, swlng: bounds.minLng }
        : { lat, lng, radius: radiusKm }

      const params = new URLSearchParams({
        taxon_id: inatTaxonId,
        ...geoParams,
        d1: fmt(d1),
        d2: fmt(d2),
        order_by: 'observed_on',
        per_page: Math.min(limit, 200),
        geo: 'true',
        captive: 'false',
      })

      const res = await fetch(`${INAT_API}/observations?${params}`, {
        headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
        signal,
      })
      if (!res.ok) return []
      const data = await res.json()
      return (data.results || []).map(normalizeINatObservation).filter(Boolean)
    } catch {
      return []
    }
  }

  function aggregateSpecies(sightings) {
    const map = {}
    for (const s of sightings) {
      const key = s.speciesKey || s.scientific || s.common
      if (!map[key]) {
        map[key] = {
          speciesKey: s.speciesKey || key,
          common: s.common,
          scientific: s.scientific,
          color: s.color,
          iucn: s.iucn,
          meta: getSpeciesMeta(s.speciesKey),
          count: 0,
          lastSeen: null,
          photos: [],
        }
      }
      map[key].count++
      if (!map[key].lastSeen || s.date > map[key].lastSeen) map[key].lastSeen = s.date
      if (s.photos.length > 0 && map[key].photos.length === 0) map[key].photos = s.photos
    }
    return Object.values(map).sort((a, b) => b.count - a.count)
  }

  return {
    fetchRecentSightings,
    fetchMonthSightings,
    fetchSeasonalPattern,
    fetchINatSightings,
    aggregateSpecies,
    getSpeciesMeta,
  }
}
