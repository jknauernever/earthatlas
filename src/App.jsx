import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useSEO } from './hooks/useSEO'
import { usePostHog } from 'posthog-js/react'
import { useGeolocation } from './hooks/useGeolocation'
import { useQueryParams } from './hooks/useQueryParams'
import { fetchObservations, reverseGeocode } from './services/iNaturalist'
import { fetchGBIFOccurrences } from './services/gbif'
import { fetchEBirdObservations } from './services/eBird'
import { resolveSpecies } from './services/taxonCrosswalk'
import { getDateRangeStart, getTaxonMeta } from './utils/taxon'
import { quantizeBounds } from './explore/wildQuery'
import { track } from './utils/analytics'

import Header           from './components/Header'
import Controls         from './components/Controls'
import TaxonFilter      from './components/TaxonFilter'
import ExploreMap       from './explore/components/ExploreMap'
import SpeciesListItem  from './explore/components/SpeciesListItem'
import exploreStyles    from './explore/ExploreApp.module.css'
import ObservationModal from './components/ObservationModal'
import LoadingState     from './components/LoadingState'
import EmptyState       from './components/EmptyState'
import GlobalStats      from './components/GlobalStats'
import { Analytics } from '@vercel/analytics/react'
import './App.css'

// ─── Query param schema (stable reference) ────────────────────────
const QP_SCHEMA = {
  lat:     { type: 'number' },
  lng:     { type: 'number' },
  loc:     { type: 'string' },  // reverse-geocoded place name; shared links skip the re-geocode flicker
  time:    { type: 'string', default: 'week' },
  taxon:   { type: 'string', default: 'all' },
  species: { type: 'string' },
  // Map view — where the map is currently looking. Diverges from lat/lng
  // (the search origin) when the user pans/zooms.
  z:       { type: 'number' },
  mlat:    { type: 'number' },
  mlng:    { type: 'number' },
}

export default function App() {
  useSEO({
    title: null,
    description: 'Discover species living around you — explore wildlife sightings, seasonal patterns, and biodiversity data powered by GBIF and iNaturalist.',
    path: '/',
  })

  const posthog = usePostHog()

  // ─── URL state ──────────────────────────────────────────────────
  const [qp, setQP] = useQueryParams(QP_SCHEMA)

  const timeWindow = qp.time
  const activeTaxon = qp.taxon
  // Pre-map cold starts (lat/lng but no viewport yet) fall back to a fixed
  // radius; every settled query uses the visible map area.
  const FALLBACK_RADIUS_KM = 50

  // Approximate viewport bbox from the URL's map center + zoom. Used when
  // area='map' so the query follows what the user is actually looking at,
  // not the radius circle around the original search origin.
  const urlMapBounds = useMemo(() => {
    if (qp.mlat == null || qp.mlng == null || qp.z == null) return null
    const latSpan = 180 / Math.pow(2, qp.z)
    const lngSpan = 360 / Math.pow(2, qp.z)
    return {
      minLat: qp.mlat - latSpan,
      maxLat: qp.mlat + latSpan,
      minLng: qp.mlng - lngSpan,
      maxLng: qp.mlng + lngSpan,
    }
  }, [qp.mlat, qp.mlng, qp.z])

  // ─── Geo ───────────────────────────────────────────────────────
  const { coords: geoCoords, status: geoStatus, error: geoError, locate } = useGeolocation()
  const [manualCoords, setManualCoords] = useState(null)
  // locationName lives in the URL (loc=…) so a shared link renders the
  // correct place label immediately without waiting on reverse-geocoding.
  const locationName = qp.loc
  const setLocationName = useCallback((name) => setQP({ loc: name }), [setQP])

  // URL coords take priority, then manual, then geo
  const urlCoords = useMemo(
    () => (qp.lat != null && qp.lng != null ? { lat: qp.lat, lng: qp.lng } : null),
    [qp.lat, qp.lng]
  )
  const coords = urlCoords || manualCoords || geoCoords

  // ─── Search params ─────────────────────────────────────────────
  const [perPage]         = useState(400)
  const [selectedSpecies, setSelectedSpecies] = useState(null)

  // ─── Results ───────────────────────────────────────────────────
  const [observations, setObservations] = useState([])
  const [totalResults, setTotalResults] = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [refreshing,   setRefreshing]   = useState(false)
  const [error,        setError]        = useState(null)
  const [mapBounds,    setMapBounds]    = useState(null)
  const [searchId,     setSearchId]     = useState(0)

  // ─── Modal ─────────────────────────────────────────────────────
  const [selectedObs, setSelectedObs] = useState(null)

  // ─── Reverse geocode for cold loads from URL ───────────────────
  const coldLoaded = useRef(false)
  useEffect(() => {
    if (coldLoaded.current) return
    if (urlCoords && !locationName) {
      coldLoaded.current = true
      reverseGeocode(urlCoords.lat, urlCoords.lng)
        .then(name => setLocationName(name))
        .catch(() => setLocationName(`${urlCoords.lat.toFixed(4)}, ${urlCoords.lng.toFixed(4)}`))
    }
  }, [urlCoords, locationName])

  // Reverse geocode when geolocation resolves
  useEffect(() => {
    if (geoCoords && geoStatus === 'success' && !locationName && !urlCoords) {
      setQP({ lat: geoCoords.lat, lng: geoCoords.lng })
      reverseGeocode(geoCoords.lat, geoCoords.lng)
        .then(name => setLocationName(name))
        .catch(() => setLocationName(`${geoCoords.lat.toFixed(4)}, ${geoCoords.lng.toFixed(4)}`))
    }
  }, [geoCoords, geoStatus, locationName, urlCoords, setQP])


  // ─── Handle locate ─────────────────────────────────────────────
  const handleLocate = useCallback(async () => {
    setManualCoords(null)
    setLocationName(null)
    // Clear EVERY URL location trace: coords resolve urlCoords-first, so a
    // stale lat/lng silently outranks the fresh geolocation (Locate Me
    // "did nothing"), and stale mlat/mlng/z would aim the next search at
    // the previous map view instead of the user's position.
    setQP({ lat: null, lng: null, loc: null, mlat: null, mlng: null, z: null })
    locate()
  }, [locate, setQP])

  // ─── Handle manual location select ────────────────────────────
  const handleLocationSelect = useCallback(({ lat, lng, name }) => {
    setManualCoords({ lat, lng })
    setLocationName(name)
    setQP({ lat, lng })
  }, [setQP])

  // ─── Handle species select ────────────────────────────────────
  const handleSpeciesSelect = useCallback(async (species) => {
    if (!species) {
      setSelectedSpecies(null)
      setQP({ species: null })
      return
    }
    // Enrich with cross-source IDs via the taxon crosswalk
    const resolved = await resolveSpecies(species.scientificName || species.name)
    const enriched = {
      ...species,
      gbifKey: species.gbifKey || resolved.gbifTaxonKey || null,
      speciesCode: species.speciesCode || resolved.eBirdSpeciesCode || null,
    }
    setSelectedSpecies(enriched)
    setQP({ species: enriched.id || null })
  }, [setQP])

  // ─── Cold-load: hydrate selectedSpecies from ?species=<iNat-id> ────
  // When a shared link has a species filter but the page reloads fresh,
  // selectedSpecies starts null and the search never fires. Fetch the
  // taxon from iNat, then route through handleSpeciesSelect so the
  // crosswalk (gbifKey, speciesCode) populates for multi-source search.
  const speciesColdLoaded = useRef(false)
  useEffect(() => {
    if (speciesColdLoaded.current) return
    if (qp.species && !selectedSpecies) {
      speciesColdLoaded.current = true
      fetch(`https://api.inaturalist.org/v1/taxa/${qp.species}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          const t = data?.results?.[0]
          // Unresolvable species id — drop it from the URL so the page falls
          // back to the normal landing state instead of waiting forever on a
          // search that will never fire.
          if (!t) { setQP({ species: null }); return }
          return handleSpeciesSelect({
            id: t.id,
            name: t.preferred_common_name || t.name,
            scientificName: t.name,
            rank: t.rank,
            iconicTaxon: t.iconic_taxon_name,
            photoUrl: t.default_photo?.square_url || null,
          })
        })
        .catch(() => setQP({ species: null }))
    }
  }, [qp.species, selectedSpecies, handleSpeciesSelect, setQP])

  // ─── Search ────────────────────────────────────────────────────
  // GBIF dataset keys for deduplication (iNat and eBird both export to GBIF)
  const GBIF_INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'
  const GBIF_EBIRD_DATASET = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e'

  // ─── Held cell inventory → derive contained views without refetching ─────
  // Searches fetch the enclosing quantized grid cell (shared edge-cache keys
  // — see wildQuery). The raw merged rows live here so pans/zooms that stay
  // inside the cell re-derive the visible set client-side, zero requests.
  const heldRef = useRef(null)

  const rowLat = (r) => r.geojson?.coordinates?.[1] ?? r.decimalLatitude
  const rowLng = (r) => r.geojson?.coordinates?.[0] ?? r.decimalLongitude

  const applyHomeView = useCallback((viewBB) => {
    const h = heldRef.current
    if (!h) return
    let rows = h.rows
    if (viewBB) {
      rows = h.rows.filter((r) => {
        const la = rowLat(r); const ln = rowLng(r)
        return la != null && la >= viewBB.minLat && la <= viewBB.maxLat && ln >= viewBB.minLng && ln <= viewBB.maxLng
      })
    }
    // Cell total scaled by the in-view fraction — honest "available here".
    const frac = h.rows.length ? rows.length / h.rows.length : 1
    setObservations(rows)
    setTotalResults(Math.max(Math.round(h.total * frac), rows.length))
  }, [])

  if (import.meta.env.DEV) window.__home = { heldRef, applyHomeView } // dev-only QA handle

  // Searches have no upstream abort; overlapping runs (cold-load race, rapid
  // param changes) must not let a stale response overwrite a newer one.
  const searchSeqRef = useRef(0)
  // The truest viewport we've seen (from the map's own moveend/load emits).
  // Cold loads scope their FETCH with an approximate formula bbox; when the
  // results land we display against these real bounds instead — no matter
  // which finishes first.
  const lastRealBoundsRef = useRef(null)

  const handleSearch = useCallback(async (searchBounds) => {
    const seq = ++searchSeqRef.current
    // Guard: some callers (notably the Search button's onClick) pass a click
    // event as the first arg. Coerce anything that's not a properly-shaped
    // bounds object to null so the radius path is used instead.
    if (searchBounds && (
      typeof searchBounds !== 'object'
      || typeof searchBounds.minLat !== 'number'
      || typeof searchBounds.maxLat !== 'number'
      || typeof searchBounds.minLng !== 'number'
      || typeof searchBounds.maxLng !== 'number'
    )) {
      searchBounds = null
    }
    // Fetch the enclosing grid cell; display filters back to the exact view.
    const exactBounds = searchBounds
    if (searchBounds) searchBounds = quantizeBounds(searchBounds)
    // No location and no species — nothing to search
    if (!coords && !selectedSpecies) return
    // Treat as worldwide when no location is set and no bounds provided
    const effectiveAnywhere = !coords && !searchBounds
    // Only show full loading state for initial searches, not map-move re-queries
    if (!searchBounds) {
      setLoading(true)
      setSearchId(id => id + 1)
    }
    setRefreshing(true)
    setError(null)

    try {
      const d1 = getDateRangeStart(timeWindow)
      const d2 = new Date().toISOString().split('T')[0]
      const iconicFilter = activeTaxon !== 'all' ? activeTaxon : undefined
      let allResults = []
      let totalCount = 0

      // Location params — use map bounds if available, radius if location set, or omit for worldwide
      const locParams = searchBounds
        ? { bounds: searchBounds }
        : effectiveAnywhere ? {} : { lat: coords.lat, lng: coords.lng, radiusKm: FALLBACK_RADIUS_KM }

      {
        const hasSpeciesFilter = !!selectedSpecies
        // eBird needs either a search center (lat/lng) or map bounds. The
        // service now accepts both — bbox is preferred when present.
        const canFilterEBird = (!effectiveAnywhere && (!!coords || !!searchBounds))
          && (!hasSpeciesFilter || !!selectedSpecies?.speciesCode)
          && (!iconicFilter || iconicFilter === 'Aves')
        const canFilterGBIF = !hasSpeciesFilter || !!selectedSpecies?.gbifKey

        const [inatData, ebirdData, gbifData] = await Promise.all([
          fetchObservations({
            ...locParams,
            d1, d2: d1 ? d2 : undefined, perPage, slim: 'card',
            taxonId: selectedSpecies?.id,
            iconicTaxa: iconicFilter,
          }).catch(() => ({ results: [], total_results: 0 })),

          canFilterEBird
            ? fetchEBirdObservations({
                lat: coords?.lat, lng: coords?.lng,
                bounds: searchBounds,
                radiusKm: FALLBACK_RADIUS_KM,
                timeWindow: (timeWindow === 'year' || timeWindow === 'all') ? 'month' : timeWindow,
                perPage,
                speciesCode: selectedSpecies?.speciesCode || undefined,
              }).catch(() => ({ results: [], total_results: 0 }))
            : Promise.resolve({ results: [], total_results: 0 }),

          canFilterGBIF
            ? fetchGBIFOccurrences({
                ...locParams,
                d1, d2: d1 ? d2 : undefined, perPage,
                taxonKey: selectedSpecies?.gbifKey || undefined,
                iconicTaxa: iconicFilter,
              }).catch(() => ({ results: [], total_results: 0 }))
            : Promise.resolve({ results: [], total_results: 0 }),
        ])

        const gbifFiltered = (gbifData.results || []).filter(
          r => r.datasetKey !== GBIF_INAT_DATASET && r.datasetKey !== GBIF_EBIRD_DATASET
            && r.basisOfRecord !== 'LIVING_SPECIMEN'
        )

        allResults = [
          ...(inatData.results || []),
          ...(ebirdData.results || []),
          ...gbifFiltered,
        ]
        // Use iNat total as primary count, add unique GBIF records (excluding
        // iNat/eBird datasets already counted) and eBird observations
        const inatTotal = inatData.total_results || 0
        const ebirdTotal = ebirdData.total_results || 0
        const gbifUniqueCount = gbifFiltered.length // already deduplicated against iNat/eBird datasets
        totalCount = inatTotal + ebirdTotal + gbifUniqueCount

      }

      // Newest sightings first, whatever the source mix: iNat pages arrive in
      // upload order, GBIF in arbitrary index order, and the merge above
      // interleaves sources — so without this the visible set under any cap
      // is not the most recent. Each source shape carries its date under a
      // different key.
      const obsDate = (r) => String(r.observed_on || r.eventDate || r.obsDt || '')
      allResults.sort((a, b) => obsDate(b).localeCompare(obsDate(a)))
      if (seq !== searchSeqRef.current) return // a newer search superseded this one
      heldRef.current = {
        cell: searchBounds || null,
        rows: allResults,
        total: totalCount,
        // capped = more matched than we hold; sub-views can't be derived.
        capped: totalCount > allResults.length,
      }
      applyHomeView(lastRealBoundsRef.current || exactBounds)
      // Push the full search state into the URL every time a search completes,
      // so shared links always reproduce the exact view. Passing null clears
      // the param when the filter isn't active.
      const urlParams = {
        time: timeWindow,
        species: selectedSpecies?.id || null,
        taxon: activeTaxon !== 'all' ? activeTaxon : null,
      }
      if (coords) { urlParams.lat = coords.lat; urlParams.lng = coords.lng }
      setQP(urlParams)
      track(posthog, 'search_performed', {
        location: locationName,
        time_window: timeWindow,
        species_filter: selectedSpecies?.name || null,
        taxon_filter: activeTaxon,
        total_results: totalCount,
      })
    } catch (err) {
      setError(err.message)
      setObservations([])
      setTotalResults(null)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [coords, timeWindow, perPage, selectedSpecies, activeTaxon, applyHomeView])

  // ─── Auto-search when any parameter changes ──────────────────
  const hasSearched = useRef(false)
  // Read the URL-derived viewport through a ref: pure map moves must NOT
  // re-run this effect (handleMapMove owns those, with the held-cell skip) —
  // it exists for cold start and for parameter changes (source/time/taxon/
  // species recreate handleSearch), which query at the CURRENT view.
  const urlMapBoundsRef = useRef(urlMapBounds)
  urlMapBoundsRef.current = urlMapBounds
  useEffect(() => {
    if (!coords && !selectedSpecies) return
    // Allow immediate search if URL had coords (cold load) or manual/geo set or species selected
    if (!hasSearched.current && !manualCoords && !urlCoords && geoStatus !== 'success' && !selectedSpecies) return
    hasSearched.current = true
    handleSearch(urlMapBoundsRef.current)
  }, [handleSearch])

  // ─── Re-fetch when map view changes ─────────────────────────
  const mapMoveTimer = useRef(null)
  const handleSearchRef = useRef(handleSearch)
  handleSearchRef.current = handleSearch
  const handleMapMove = useCallback((viewState) => {
    // Record the map's new center/zoom in the URL so shared links
    // reproduce the exact view. Fires on the debounced moveend from
    // ExploreMap (already 600ms idle), so no additional throttling needed.
    if (viewState.bounds) lastRealBoundsRef.current = viewState.bounds
    if (viewState.lat != null && viewState.lng != null && viewState.zoom != null) {
      setQP({
        mlat: viewState.lat,
        mlng: viewState.lng,
        z: viewState.zoom,
      })
    }
    if (!hasSearched.current) return
    clearTimeout(mapMoveTimer.current)
    mapMoveTimer.current = setTimeout(() => {
      if (!viewState.bounds) return
      // Contained move: derive the view from held rows, zero requests.
      // Unlike the subsites, a homepage inventory is nearly ALWAYS capped
      // (all-taxa totals dwarf the 400-row fetch), so capped reuse is
      // allowed as long as the sub-view stays well-populated — the newest-
      // first ordering remains correct and totals scale honestly. Thin
      // corners (deep zooms past our rows) and cell exits refetch.
      const h = heldRef.current
      // Nothing held yet = the initial search is still in flight; don't race
      // it with a second uncancellable fetch — it will display against the
      // real bounds recorded above when it lands.
      if (!h) return
      const b = viewState.bounds
      const contained = h && h.cell
        && b.minLat >= h.cell.minLat && b.maxLat <= h.cell.maxLat
        && b.minLng >= h.cell.minLng && b.maxLng <= h.cell.maxLng
      const inView = contained
        ? h.rows.reduce((n, r) => {
            const la = rowLat(r); const ln = rowLng(r)
            return n + (la != null && la >= b.minLat && la <= b.maxLat && ln >= b.minLng && ln <= b.maxLng ? 1 : 0)
          }, 0)
        : 0
      if (contained && (!h.capped || inView >= 60)) applyHomeView(b)
      else handleSearchRef.current(b)
    }, 400)
  }, [setQP, applyHomeView])

  // ─── Map species state ──────────────────────────────────────
  const [activeMapSpecies, setActiveMapSpecies] = useState(null)
  const [openInfoKey, setOpenInfoKey] = useState(null)

  // Normalize observations to the sighting format ExploreMap expects
  const mapSightings = useMemo(() => {
    return observations.map(obs => {
      const taxon = obs.taxon
      const lng = obs.geojson?.coordinates?.[0]
      const lat = obs.geojson?.coordinates?.[1]
      if (lng == null || lat == null) return null
      const iconicTaxon = taxon?.iconic_taxon_name || 'default'
      const { emoji } = getTaxonMeta(iconicTaxon)
      const isEBird = obs.source === 'eBird'
      const isGBIF = obs.source === 'GBIF'
      return {
        id: String(obs.id),
        speciesKey: taxon?.id || taxon?.name || null,
        common: taxon?.preferred_common_name || taxon?.name || 'Unknown species',
        scientific: taxon?.name || '',
        color: '#e67e22',
        emoji,
        lat,
        lng,
        date: obs.observed_on || null,
        time: isEBird ? (obs._obsDt || null) : isGBIF ? null : (obs.time_observed_at || null),
        place: obs.place_guess || null,
        observer: isEBird ? null : isGBIF ? (obs.recordedBy || null) : (obs.user?.login || null),
        photos: obs.photos?.map(p => p.url?.replace('square', 'medium')).filter(Boolean) || [],
        source: isEBird ? 'eBird' : isGBIF ? 'GBIF' : 'iNaturalist',
      }
    }).filter(Boolean)
  }, [observations])

  // Aggregate sightings into species for the sidebar — group by binomial name
  // so observations from different sources and subspecies merge into one entry
  const mapSpeciesList = useMemo(() => {
    const map = {}
    for (const s of mapSightings) {
      const sciName = s.scientific?.toLowerCase() || ''
      const parts = sciName.split(/\s+/)
      const binomial = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : sciName || s.common?.toLowerCase() || s.speciesKey
      const isSubspecies = parts.length > 2

      // Capitalize first letter for display
      const displayBinomial = binomial.charAt(0).toUpperCase() + binomial.slice(1)

      if (!map[binomial]) {
        map[binomial] = {
          speciesKey: s.speciesKey,
          common: s.common,
          scientific: displayBinomial,
          color: s.color,
          emoji: s.emoji,
          count: 0,
          photos: [],
          meta: { emoji: s.emoji },
          subspecies: {},
        }
      }
      map[binomial].count++
      if (s.photos.length > 0 && map[binomial].photos.length === 0) map[binomial].photos = s.photos
      // Prefer the species-level common name over a subspecies common name
      if (!isSubspecies && s.common) map[binomial].common = s.common

      // Track subspecies
      if (isSubspecies) {
        const subKey = sciName
        if (!map[binomial].subspecies[subKey]) {
          map[binomial].subspecies[subKey] = {
            speciesKey: s.speciesKey,
            common: s.common,
            scientific: s.scientific,
            count: 0,
            photos: [],
          }
        }
        map[binomial].subspecies[subKey].count++
        if (s.photos.length > 0 && map[binomial].subspecies[subKey].photos.length === 0) {
          map[binomial].subspecies[subKey].photos = s.photos
        }
      }
    }
    return Object.values(map).map(sp => ({
      ...sp,
      subspecies: Object.values(sp.subspecies).sort((a, b) => b.count - a.count),
    })).sort((a, b) => b.count - a.count)
  }, [mapSightings])


  // ─── Status text ───────────────────────────────────────────────
  const TIME_LABELS = { hour: 'past hour', day: 'past day', week: 'past week', month: 'past month', year: 'past year', all: 'all time' }
  const sourceName = 'iNaturalist, eBird & GBIF'
  const displayedCount = observations.length
  const isSampled = totalResults !== null && displayedCount > 0 && displayedCount < totalResults
  const countPhrase = totalResults !== null
    ? (isSampled
        ? `Showing the ${displayedCount.toLocaleString()} most recent of ${totalResults.toLocaleString()} total observations`
        : `${totalResults.toLocaleString()} total observation${totalResults !== 1 ? 's' : ''}`)
    : ''
  const statusText = loading
    ? `Fetching observations from ${sourceName}…`
    : totalResults !== null
    ? !coords
      ? `${countPhrase} worldwide — ${TIME_LABELS[timeWindow]}. Zoom in to see individual observations.`
      : urlMapBounds
      ? `${countPhrase} in the visible map area near ${locationName || 'your location'} — ${TIME_LABELS[timeWindow]}.`
      : `${countPhrase} near ${locationName || 'your location'} — ${TIME_LABELS[timeWindow]}.`
    : error
    ? `Error: ${error}`
    : coords
    ? `Location set — ${locationName || 'ready to search'}.`
    : 'Search for a species to explore worldwide, or set a location to search nearby.'

  const hasLocation = !!coords && (geoStatus === 'success' || !!manualCoords || !!urlCoords)
  const canSearch = (hasLocation || !!selectedSpecies) && !loading

  // ─── Render ────────────────────────────────────────────────────
  return (
    <>
      <Header />


      <Controls
        locationName={locationName}
        geoStatus={geoStatus}
        onLocate={handleLocate}
        onLocationSelect={handleLocationSelect}
        selectedSpecies={selectedSpecies}
        onSpeciesSelect={handleSpeciesSelect}
        timeWindow={timeWindow}   onTimeChange={(t) => setQP({ time: t })}
        canSearch={canSearch}
        onSearch={() => handleSearch(urlMapBounds)}
      />

      {totalResults !== null && !selectedSpecies && (
        <TaxonFilter activeTaxon={activeTaxon} onChange={(t) => setQP({ taxon: t })} />
      )}

      <main className="main">
        {/* Status bar */}
        <div className="status-bar">
          <span className="status-text">
            {statusText}
            {refreshing && totalResults !== null && (
              <span className="status-updating" aria-hidden="true"> · Updating…</span>
            )}
          </span>
        </div>

        {/* Indeterminate progress bar — visible whenever observations are being fetched */}
        <div
          className={`refresh-bar ${refreshing ? 'active' : ''}`}
          role="status"
          aria-live="polite"
          aria-label={refreshing ? 'Updating observations' : ''}
        />

        {/* Error banner */}
        {error && !loading && (
          <div className="error-bar">{error}</div>
        )}

        {/* Geolocation error — surfaced so a failed "Locate Me" (common on
            mobile when a GPS fix times out) isn't a silent dead end. */}
        {geoStatus === 'error' && geoError && !coords && (
          <div className="error-bar">{geoError}</div>
        )}

        {/* Content */}
        {loading ? (
          <LoadingState />
        ) : totalResults === null && !error ? (
          // A shared link with a species filter or coordinates will start a
          // search as soon as its species id hydrates — show the loading state
          // for that gap rather than mounting the stats panel it will replace.
          (qp.species != null || coords) ? <LoadingState /> :
          <GlobalStats dataSource="All" />
        ) : observations.length === 0 && !error ? (
          <EmptyState variant="noResults" />
        ) : error ? (
          <EmptyState variant="error" message={error} />
        ) : (
          <div className="map-layout">
            <div className="map-container">
              <ExploreMap
                sightings={mapSightings}
                center={coords}
                activeSpecies={activeMapSpecies}
                onCenterChange={handleMapMove}
                searchId={searchId}
                initialView={(qp.mlat != null && qp.mlng != null && qp.z != null)
                  ? { center: { lat: qp.mlat, lng: qp.mlng }, zoom: qp.z }
                  : null}
                config={{ fallbackColor: '#e67e22', fallbackEmoji: '', defaultZoom: 10 }}
              />
            </div>
            <div className="species-sidebar">
              <div className={exploreStyles.speciesPanelHead} style={{ padding: '8px 12px 4px' }}>
                <div className={exploreStyles.speciesPanelTitle}>Recent observations in view</div>
              </div>
              {mapSpeciesList.map(sp => {
                const isActive = activeMapSpecies?.toLowerCase() === sp.scientific?.toLowerCase()
                return (
                  <div key={sp.scientific || sp.common}>
                    <SpeciesListItem
                      species={sp}
                      active={isActive}
                      onClick={() => setActiveMapSpecies(isActive ? null : sp.scientific?.toLowerCase())}
                      styles={exploreStyles}
                      openInfoKey={openInfoKey}
                      setOpenInfoKey={setOpenInfoKey}
                    />
                    {/* Subspecies — always visible under parent */}
                    {sp.subspecies.length > 0 && sp.subspecies.map(sub => {
                      const subActive = activeMapSpecies?.toLowerCase() === sub.scientific?.toLowerCase()
                      return (
                        <SpeciesListItem
                          key={sub.scientific}
                          species={{ ...sub, color: sp.color, emoji: sp.emoji, meta: sp.meta }}
                          active={subActive}
                          onClick={(e) => {
                            e?.stopPropagation?.()
                            setActiveMapSpecies(subActive ? sp.scientific?.toLowerCase() : sub.scientific?.toLowerCase())
                          }}
                          styles={exploreStyles}
                          style={{ paddingLeft: 28, opacity: subActive ? 1 : 0.75, fontSize: '0.9em' }}
                          openInfoKey={openInfoKey}
                          setOpenInfoKey={setOpenInfoKey}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        Data sourced from{' '}
        <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer">iNaturalist</a>
        {', '}
        <a href="https://ebird.org" target="_blank" rel="noopener noreferrer">eBird</a>
        {' & '}
        <a href="https://www.gbif.org" target="_blank" rel="noopener noreferrer">GBIF</a>
        {' '}— <strong>powered by citizen science</strong>.
        <div className="built-by">
          Built by <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer">KnauerNever.com</a>
        </div>
      </footer>

      <ObservationModal obs={selectedObs} onClose={() => setSelectedObs(null)} />
      <Analytics />
    </>
  )
}
