/**
 * Shared explore service factory
 *
 * Creates a parameterized service for any taxon group (whales, sharks,
 * butterflies, etc.) that wraps GBIF and iNaturalist API calls.
 */

import { fetchEBirdRecentRaw, fetchEBirdSpeciesRecentRaw } from '../services/eBird'

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
 * @param {number|number[]} config.gbifTaxonKey — GBIF backbone taxon key(s) (e.g. 733 for Cetacea, or an array of species keys)
 * @param {number|string}   config.inatTaxonId  — iNaturalist taxon ID(s) (single ID or comma-separated string)
 * @param {Object} config.speciesMeta    — { [gbifSpeciesKey]: { common, scientific, color, emoji, ... } }
 * @param {Object} [config.fallback]     — { commonName, color, emoji } defaults for unknown species
 * @param {Function} [config.postFilter] — optional filter applied to raw GBIF occurrences (e.g. isShark)
 * @param {boolean}  [config.useEBird]   — if true, fetch from eBird API as primary source (for birds)
 * @param {string[]} [config.eBirdSpeciesCodes] — eBird species codes for a fixed species set
 *   (e.g. condors: ['calcon', 'andcon1']). Fetches one targeted /geo/recent call per code —
 *   much lighter than useEBird's all-species sweep, and doesn't change GBIF/iNat behavior.
 */
export function createExploreService({ gbifTaxonKey, inatTaxonId, speciesMeta, fallback = {}, postFilter, useEBird = false, eBirdSpeciesCodes = [], keepInatRecords = false }) {
  const defaultCommon = fallback.commonName || 'Unknown species'
  const defaultColor = fallback.color || '#888888'
  const defaultEmoji = fallback.emoji || '🔵'

  // GBIF ORs repeated taxonKey params (comma-separated is NOT supported);
  // iNat takes comma-separated taxon_id values in a single param.
  const gbifTaxonKeys = Array.isArray(gbifTaxonKey) ? gbifTaxonKey : [gbifTaxonKey]
  const inatTaxonIds = Array.isArray(inatTaxonId) ? inatTaxonId.join(',') : inatTaxonId

  // Observation records only, everywhere GBIF is queried (search, facets —
  // the map tiles apply the same list). MACHINE_OBSERVATION is excluded on
  // purpose: e.g. gray-whale acoustic detections report grid-estimated
  // positions that paint literal stripes on density views, and a sensor
  // detection isn't a "sighting". Specimens/fossils aren't sightings either.
  const GBIF_BASES = ['HUMAN_OBSERVATION', 'OBSERVATION', 'OCCURRENCE']

  function gbifSearchParams(base, taxonKeys = gbifTaxonKeys) {
    const p = new URLSearchParams(base)
    for (const k of taxonKeys) p.append('taxonKey', k)
    for (const b of GBIF_BASES) p.append('basisOfRecord', b)
    return p
  }

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
    // Roll subspecies/varieties up to the parent species: group by the
    // binomial so "Megaptera novaeangliae kuzira" counts with the Humpbacks
    // instead of fragmenting the species list.
    const binomial = sciName.split(/\s+/).slice(0, 2).join(' ')
    const speciesKey = gbifKeyFromScientific(sciName) || gbifKeyFromScientific(binomial)
    const meta = speciesKey ? getSpeciesMeta(speciesKey) : null
    const photo = obs.photos?.[0]?.url?.replace('square', 'medium') || null
    return {
      id: `inat-${obs.id}`,
      speciesKey: speciesKey || binomial || null,
      common: meta?.common || obs.taxon?.preferred_common_name || sciName || defaultCommon,
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
      // Clamp to valid ranges: world views report wrapped longitudes
      // (west of -180) and over-poles latitudes, which GBIF 400s.
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)))
      return {
        minLat: clamp(bounds.minLat, -90, 90).toFixed(5),
        maxLat: clamp(bounds.maxLat, -90, 90).toFixed(5),
        minLng: clamp(bounds.minLng, -180, 180).toFixed(5),
        maxLng: clamp(bounds.maxLng, -180, 180).toFixed(5),
      }
    }
    return getBoundingBox(lat, lng, radiusKm)
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  // `eventDate` (optional) is an explicit GBIF date range ("YYYY-MM-DD,YYYY-MM-DD")
  // that overrides the rolling `days` window — lets callers query a fixed
  // historical span (e.g. a selected month/year) instead of "last N days".
  async function fetchRecentSightings({ lat, lng, radiusKm = 300, bounds, days = 90, eventDate, limit = 200, signal }) {
    const bb = resolveBB({ lat, lng, radiusKm, bounds })
    const d2 = new Date()
    const d1 = new Date(d2 - days * 86400000)
    const fmt = d => d.toISOString().split('T')[0]

    const PAGE_SIZE = 300
    const maxPages = Math.ceil(Math.min(limit, 1500) / PAGE_SIZE)  // up to 5 pages
    const pageBudget = maxPages * PAGE_SIZE

    const baseParams = {
      hasCoordinate: 'true',
      occurrenceStatus: 'PRESENT',
      decimalLatitude: `${bb.minLat},${bb.maxLat}`,
      decimalLongitude: `${bb.minLng},${bb.maxLng}`,
      eventDate: eventDate || `${fmt(d1)},${fmt(d2)}`,
      limit: PAGE_SIZE,
    }

    // Fetch first page to get the total count
    const params = gbifSearchParams(baseParams)
    const url = `${GBIF_API}/occurrence/search?${params}`
    const res = await fetch(url, { signal })
    if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
    const data = await res.json()
    const totalAvailable = data.count || 0
    let allResults = data.results || []

    // GBIF's search has NO server-side sort (verified — sort params are
    // ignored), so when an area holds more records than we can page through,
    // whichever ones arrive are an arbitrary sample and "recent" is luck.
    // Guarantee recency instead: shrink the rolling window (halving `days`,
    // floor 7) until everything in it fits the page budget, then fetch THAT
    // window completely and keep the newest. Skipped for explicit eventDate
    // ranges (historical views want the whole span). Each probe is a
    // limit=1 count request; the full-window count above still reports the
    // true total.
    let windowAvailable = totalAvailable
    if (!eventDate && totalAvailable > pageBudget) {
      let winDays = days
      let winCount = totalAvailable
      while (winCount > pageBudget && winDays > 7) {
        winDays = Math.max(7, Math.floor(winDays / 2))
        const probeRange = `${fmt(new Date(d2 - winDays * 86400000))},${fmt(d2)}`
        try {
          const pr = await fetch(
            `${GBIF_API}/occurrence/search?${gbifSearchParams({ ...baseParams, eventDate: probeRange, limit: 1 })}`,
            { signal },
          )
          if (!pr.ok) break
          winCount = (await pr.json()).count || 0
        } catch { break }
      }
      if (winDays < days) {
        // Keep the full-window page as backfill: GBIF indexes many sources
        // weeks late, so a recent window can be sparse — the newest records
        // stay guaranteed (sorted first), older ones fill the map to `limit`.
        const backfill = allResults
        baseParams.eventDate = `${fmt(new Date(d2 - winDays * 86400000))},${fmt(d2)}`
        const r0 = await fetch(`${GBIF_API}/occurrence/search?${gbifSearchParams(baseParams)}`, { signal })
        if (r0.ok) {
          const d0 = await r0.json()
          const fresh = d0.results || []
          const seen = new Set(fresh.map(o => o.key))
          allResults = fresh.concat(backfill.filter(o => !seen.has(o.key)))
          windowAvailable = d0.count || winCount
        }
      }
    }

    // Fetch additional pages in parallel if more results are available
    if (windowAvailable > PAGE_SIZE && maxPages > 1 && !signal?.aborted) {
      const pageCount = Math.min(maxPages, Math.ceil(windowAvailable / PAGE_SIZE))
      const pagePromises = []
      for (let page = 1; page < pageCount; page++) {
        const p = gbifSearchParams({ ...baseParams, offset: page * PAGE_SIZE })
        pagePromises.push(
          fetch(`${GBIF_API}/occurrence/search?${p}`, { signal })
            .then(r => r.ok ? r.json() : { results: [] })
            .catch(() => ({ results: [] }))
        )
      }
      const pages = await Promise.all(pagePromises)
      for (const pg of pages) {
        allResults = allResults.concat(pg.results || [])
      }
    }

    // Newest first, so the cap below keeps the most recent sightings.
    allResults.sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))
    let results = allResults
      .filter(o => o.decimalLatitude && o.decimalLongitude)
      .filter(o => o.basisOfRecord !== 'LIVING_SPECIMEN')
    // Exclude iNat-sourced records from GBIF only when a caller fetches iNat
    // SEPARATELY (the /explore apps do, to avoid double-counting). Callers that
    // rely on GBIF alone — or use eBird as the primary bird source — keep them,
    // since ~99% of GBIF cetacean/bird records are iNat and dropping them leaves
    // almost nothing.
    if (!useEBird && !keepInatRecords) {
      results = results.filter(o => o.datasetKey !== GBIF_INAT_DATASET)
    }

    if (postFilter) results = results.filter(postFilter)

    const sightings = results.slice(0, limit).map(normalizeOccurrence)

    // Estimate true total by applying the same filter ratio to GBIF's count
    // (GBIF's count includes iNat records we filter out, so raw count is inflated)
    const filterRatio = allResults.length > 0 ? results.length / allResults.length : 1
    const estimatedTotal = Math.round(totalAvailable * filterRatio)

    return {
      total: postFilter ? sightings.length : estimatedTotal,
      sightings,
    }
  }

  // `month` accepts a single month (1-12), a GBIF range string "5,9"
  // (May through September), or null/'all' for no month constraint.
  function inatMonthList(month) {
    if (month == null || month === 'all') return null
    const m = /^(\d+),(\d+)$/.exec(String(month))
    if (!m) return String(month)
    const from = Number(m[1]); const to = Number(m[2])
    const list = []
    for (let x = from; x <= to; x++) list.push(x)
    return list.join(',')
  }

  async function fetchMonthSightings({ lat, lng, radiusKm = 400, bounds, month, speciesKey = null, limit = 200, signal }) {
    const bb = resolveBB({ lat, lng, radiusKm, bounds })
    const gbifMonth = month == null || month === 'all' ? null : String(month)
    const inatMonth = inatMonthList(month)

    // Fetch GBIF and iNaturalist in parallel
    const [gbifResult, inatResult] = await Promise.allSettled([
      (async () => {
        const params = gbifSearchParams({
          hasCoordinate: 'true',
          occurrenceStatus: 'PRESENT',
          decimalLatitude: `${bb.minLat},${bb.maxLat}`,
          decimalLongitude: `${bb.minLng},${bb.maxLng}`,
          ...(gbifMonth ? { month: gbifMonth } : {}),
          limit: Math.min(limit, 300),
        }, speciesKey ? [speciesKey] : gbifTaxonKeys)
        const res = await fetch(`${GBIF_API}/occurrence/search?${params}`, { signal })
        if (!res.ok) throw new Error(`GBIF error: ${res.status}`)
        return res.json()
      })(),
      (async () => {
        // Look up iNat taxon ID: use species scientific name if filtering by species, else group ID(s)
        let taxonId = inatTaxonIds
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
          ? { nelat: bb.maxLat, nelng: bb.maxLng, swlat: bb.minLat, swlng: bb.minLng }
          : { lat, lng, radius: radiusKm }
        const params = new URLSearchParams({
          taxon_id: taxonId,
          ...geoParams,
          ...(inatMonth ? { month: inatMonth } : {}),
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

    // True total, not the fetched page: GBIF's count scaled by the ratio the
    // dedup/basis filters kept, plus iNat's own reported total.
    const gbifRaw = (gbifData.results || []).length
    const gbifKeptRatio = gbifRaw > 0 ? gbifResults.length / gbifRaw : 1
    const gbifTotal = Math.round((gbifData.count || 0) * gbifKeptRatio)
    const inatTotal = inatData.total_results || inatSightings.length
    return {
      total: Math.max(gbifTotal + inatTotal, allSightings.length),
      sightings: allSightings,
    }
  }

  async function fetchSeasonalPattern({ lat, lng, radiusKm = 500, bounds, speciesKey = null, signal }) {
    const bb = resolveBB({ lat, lng, radiusKm, bounds })

    const params = gbifSearchParams({
      hasCoordinate: 'true',
      occurrenceStatus: 'PRESENT',
      decimalLatitude: `${bb.minLat},${bb.maxLat}`,
      decimalLongitude: `${bb.minLng},${bb.maxLng}`,
      limit: '0',
      facet: 'month',
      'month.facetLimit': '12',
    }, speciesKey ? [speciesKey] : gbifTaxonKeys)

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
    // When useEBird is true, GBIF already includes most iNat records but with a sync lag.
    // Fetch only the last 30 days from iNat to fill the recency gap.
    if (useEBird) days = 30
    try {
      const d2 = new Date()
      const d1 = new Date(d2 - days * 86400000)
      const fmt = d => d.toISOString().split('T')[0]

      // iNat uses nelat/nelng/swlat/swlng when bounds are provided, otherwise
      // lat/lng/radius. Clamp: world views report wrapped longitudes.
      const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v)))
      const geoParams = bounds
        ? { nelat: cl(bounds.maxLat, -90, 90), nelng: cl(bounds.maxLng, -180, 180), swlat: cl(bounds.minLat, -90, 90), swlng: cl(bounds.minLng, -180, 180) }
        : { lat, lng, radius: radiusKm }

      // iNat caps per_page at 200 — page through (newest first, so
      // concatenated pages stay in order) until `limit` or the results
      // run out. Sequential fetches: iNat rate-limits aggressive parallelism.
      const baseParams = {
        taxon_id: inatTaxonIds,
        ...geoParams,
        d1: fmt(d1),
        d2: fmt(d2),
        order_by: 'observed_on',
        per_page: 200,
        geo: 'true',
        captive: 'false',
      }
      const maxPages = Math.ceil(Math.min(limit, 600) / 200)
      let results = []
      let total = 0
      for (let page = 1; page <= maxPages; page++) {
        const params = new URLSearchParams({ ...baseParams, page })
        const res = await fetch(`${INAT_API}/observations?${params}`, {
          headers: { 'User-Agent': 'EarthAtlas/1.0 (https://earthatlas.org)' },
          signal,
        })
        if (!res.ok) break
        const data = await res.json()
        total = data.total_results || total
        const batch = data.results || []
        results = results.concat(batch)
        if (batch.length < 200 || results.length >= limit) break
      }
      return { sightings: results.slice(0, limit).map(normalizeINatObservation).filter(Boolean), total }
    } catch {
      return { sightings: [], total: 0 }
    }
  }

  // ─── eBird fetch ─────────────────────────────────────────────────────────────
  // eBird is fetched via fetchEBirdRecentRaw, which now routes through the
  // /api/ebird edge proxy (token server-side, shared edge cache). No client key
  // to gate on anymore — `useEBird` alone decides.

  function normalizeEBirdObs(obs) {
    const sciName = obs.sciName || ''
    // Same subspecies rollup as iNat: group by binomial
    const binomial = sciName.split(/\s+/).slice(0, 2).join(' ')
    const speciesKey = gbifKeyFromScientific(sciName) || gbifKeyFromScientific(binomial)
    const meta = speciesKey ? getSpeciesMeta(speciesKey) : null
    return {
      id: `ebird-${obs.subId}-${obs.speciesCode}`,
      speciesKey: speciesKey || binomial || null,
      common: meta?.common || obs.comName || sciName || defaultCommon,
      scientific: sciName,
      color: meta?.color || defaultColor,
      emoji: meta?.emoji || defaultEmoji,
      fact: meta?.fact || null,
      speciesPhoto: meta?.photoUrl || null,
      iucn: meta?.iucn || null,
      lat: obs.lat,
      lng: obs.lng,
      date: obs.obsDt ? obs.obsDt.split(' ')[0] : null,
      place: obs.locName || null,
      observer: 'eBird Observer',
      photos: [],
      source: 'eBird',
    }
  }

  async function fetchEBirdSightings({ lat, lng, bounds, radiusKm, days = 90, signal }) {
    if (!useEBird && eBirdSpeciesCodes.length === 0) return []
    try {
      // Bridge the explore subsite's `days` → the eBird service's
      // `timeWindow` vocabulary. The eBird fetchers expect 'day' / 'week' /
      // 'month' and translate them into a fetch range (eBird caps at 30 days).
      const timeWindow = days <= 1 ? 'day' : days <= 7 ? 'week' : 'month'
      let rawResults
      if (eBirdSpeciesCodes.length > 0) {
        // Fixed species set: one targeted /geo/recent call per species code.
        const perSpecies = await Promise.all(
          eBirdSpeciesCodes.map(speciesCode =>
            fetchEBirdSpeciesRecentRaw({ lat, lng, bounds, radiusKm, timeWindow, speciesCode }))
        )
        rawResults = perSpecies.flat()
      } else {
        rawResults = await fetchEBirdRecentRaw({
          lat, lng, bounds, timeWindow,
        })
      }
      if (signal?.aborted) return []
      return rawResults.map(normalizeEBirdObs).filter(Boolean)
    } catch {
      return []
    }
  }

  function aggregateSpecies(sightings) {
    const map = {}
    for (const s of sightings) {
      const key = s.speciesKey || s.scientific || s.common
      if (!map[key]) {
        const meta = getSpeciesMeta(s.speciesKey)
        map[key] = {
          speciesKey: s.speciesKey || key,
          common: s.common,
          // Prefer the curated species binomial — a rolled-up subspecies
          // record would otherwise label the whole group with its trinomial
          scientific: meta?.scientific || s.scientific,
          color: s.color,
          iucn: s.iucn,
          meta,
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
    fetchEBirdSightings,
    aggregateSpecies,
    getSpeciesMeta,
  }
}
