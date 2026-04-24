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
import { track } from './utils/analytics'

import Header           from './components/Header'
import Controls         from './components/Controls'
import TaxonFilter      from './components/TaxonFilter'
import SpeciesGrid      from './components/SpeciesGrid'
import SpeciesList      from './components/SpeciesList'
import ExploreMap       from './explore/components/ExploreMap'
import SpeciesListItem  from './explore/components/SpeciesListItem'
import exploreStyles    from './explore/ExploreApp.module.css'
import ObservationModal from './components/ObservationModal'
import LoadingState     from './components/LoadingState'
import EmptyState       from './components/EmptyState'
import GlobalStats      from './components/GlobalStats'
import EBirdStats       from './components/EBirdStats'
import GBIFStats        from './components/GBIFStats'
import InsightsDashboard from './components/insights/InsightsDashboard'
import { Analytics } from '@vercel/analytics/react'
import './App.css'

// ─── View toggle icons ───────────────────────────────────────────
const GridIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <rect x="3"  y="3"  width="7" height="7" rx="1"/>
    <rect x="14" y="3"  width="7" height="7" rx="1"/>
    <rect x="3"  y="14" width="7" height="7" rx="1"/>
    <rect x="14" y="14" width="7" height="7" rx="1"/>
  </svg>
)
const ListIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="8" y1="6"  x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/>
    <circle cx="3" cy="6"  r="1" fill="currentColor"/>
    <circle cx="3" cy="12" r="1" fill="currentColor"/>
    <circle cx="3" cy="18" r="1" fill="currentColor"/>
  </svg>
)
const MapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z"/>
    <line x1="8" y1="2" x2="8" y2="18"/>
    <line x1="16" y1="6" x2="16" y2="22"/>
  </svg>
)
const InsightsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>
  </svg>
)

// ─── Query param schema (stable reference) ────────────────────────
const QP_SCHEMA = {
  lat:     { type: 'number' },
  lng:     { type: 'number' },
  loc:     { type: 'string' },  // reverse-geocoded place name; shared links skip the re-geocode flicker
  source:  { type: 'string', default: 'All' },
  radius:  { type: 'number', default: 5 },
  time:    { type: 'string', default: 'week' },
  taxon:   { type: 'string', default: 'all' },
  species: { type: 'string' },
  view:    { type: 'string', default: 'map' },
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

  const dataSource = qp.source
  const radius     = qp.radius
  const timeWindow = qp.time
  const activeTaxon = qp.taxon
  const view       = qp.view
  const isAnywhere = radius === 0

  // ─── Geo ───────────────────────────────────────────────────────
  const { coords: geoCoords, status: geoStatus, locate } = useGeolocation()
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

  // ─── Handle source switch ────────────────────────────────────
  const handleSourceChange = useCallback((source) => {
    if (source === dataSource) return
    setSelectedSpecies(null)
    setObservations([])
    setTotalResults(null)
    setError(null)

    const updates = { source, species: null, taxon: 'all' }
    // Set GBIF defaults
    if (source === 'GBIF') {
      updates.radius = 5
      updates.time = 'all'
    }
    // Clamp params for eBird limits
    if (source === 'eBird') {
      if (radius > 50) updates.radius = 50
      if (timeWindow === 'year' || timeWindow === 'all') updates.time = 'month'
    }
    // "All" uses iNaturalist-friendly defaults
    if (source === 'All') {
      updates.time = 'week'
    }
    setQP(updates)
    track(posthog, 'source_changed', { source })
  }, [dataSource, posthog, radius, timeWindow, setQP])

  // ─── Handle locate ─────────────────────────────────────────────
  const handleLocate = useCallback(async () => {
    setManualCoords(null)
    setLocationName(null)
    locate()
  }, [locate])

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
          if (!t) return
          handleSpeciesSelect({
            id: t.id,
            name: t.preferred_common_name || t.name,
            scientificName: t.name,
            rank: t.rank,
            iconicTaxon: t.iconic_taxon_name,
            photoUrl: t.default_photo?.square_url || null,
          })
        })
        .catch(() => {})
    }
  }, [qp.species, selectedSpecies, handleSpeciesSelect])

  // ─── Search ────────────────────────────────────────────────────
  // GBIF dataset keys for deduplication (iNat and eBird both export to GBIF)
  const GBIF_INAT_DATASET = '50c9509d-22c7-4a22-a47d-8c48425ef4a7'
  const GBIF_EBIRD_DATASET = '4fa7b334-ce0d-4e88-aaae-2e0c138d049e'

  const handleSearch = useCallback(async (searchBounds) => {
    // No location and no species — nothing to search
    if (!coords && !selectedSpecies) return
    // Treat as worldwide when no location is set and no bounds provided
    const effectiveAnywhere = (isAnywhere || !coords) && !searchBounds
    // Only show full loading state for initial searches, not map-move re-queries
    if (!searchBounds) {
      setLoading(true)
      setSearchId(id => id + 1)
    }
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
        : effectiveAnywhere ? {} : { lat: coords.lat, lng: coords.lng, radiusKm: radius }

      if (dataSource === 'All') {
        const hasSpeciesFilter = !!selectedSpecies
        const canFilterEBird = !effectiveAnywhere && !!coords && !searchBounds
          && (!hasSpeciesFilter || !!selectedSpecies?.speciesCode)
          && (!iconicFilter || iconicFilter === 'Aves')
        const canFilterGBIF = !hasSpeciesFilter || !!selectedSpecies?.gbifKey

        const [inatData, ebirdData, gbifData] = await Promise.all([
          fetchObservations({
            ...locParams,
            d1, d2: d1 ? d2 : undefined, perPage,
            taxonId: selectedSpecies?.id,
            iconicTaxa: iconicFilter,
          }).catch(() => ({ results: [], total_results: 0 })),

          canFilterEBird
            ? fetchEBirdObservations({
                lat: coords.lat, lng: coords.lng,
                radiusKm: Math.min(radius, 50),
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

      } else if (dataSource === 'eBird') {
        if (effectiveAnywhere) {
          // eBird requires lat/lng — can't do worldwide searches
          allResults = []
          totalCount = 0
        } else {
          const data = await fetchEBirdObservations({
            lat: coords.lat, lng: coords.lng, radiusKm: radius,
            timeWindow, perPage,
            speciesCode: selectedSpecies?.speciesCode || selectedSpecies?.id,
          })
          allResults = data.results || []
          totalCount = data.total_results || 0
        }

      } else if (dataSource === 'GBIF') {
        const data = await fetchGBIFOccurrences({
          ...locParams,
          d1, d2: d1 ? d2 : undefined, perPage,
          taxonKey: selectedSpecies?.gbifKey || selectedSpecies?.id,
          iconicTaxa: iconicFilter,
        })
        allResults = data.results || []
        totalCount = data.total_results || 0

      } else {
        const data = await fetchObservations({
          ...locParams,
          d1, d2: d1 ? d2 : undefined, perPage,
          taxonId: selectedSpecies?.id,
          iconicTaxa: iconicFilter,
        })
        allResults = data.results || []
        totalCount = data.total_results || 0
      }

      setObservations(allResults)
      setTotalResults(totalCount)
      // Push the full search state into the URL every time a search completes,
      // so shared links always reproduce the exact view. Passing null clears
      // the param when the filter isn't active.
      const urlParams = {
        radius,
        time: timeWindow,
        source: dataSource,
        species: selectedSpecies?.id || null,
        taxon: activeTaxon !== 'all' ? activeTaxon : null,
      }
      if (coords) { urlParams.lat = coords.lat; urlParams.lng = coords.lng }
      setQP(urlParams)
      track(posthog, 'search_performed', {
        source: dataSource,
        location: locationName,
        radius_km: radius,
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
    }
  }, [coords, radius, timeWindow, perPage, selectedSpecies, activeTaxon, dataSource, isAnywhere])

  // ─── Auto-search when any parameter changes ──────────────────
  const hasSearched = useRef(false)
  useEffect(() => {
    if (!coords && !selectedSpecies) return
    // Allow immediate search if URL had coords (cold load) or manual/geo set or species selected
    if (!hasSearched.current && !manualCoords && !urlCoords && geoStatus !== 'success' && !isAnywhere && !selectedSpecies) return
    hasSearched.current = true
    handleSearch()
  }, [handleSearch])

  // ─── Re-fetch when map view changes ─────────────────────────
  const mapMoveTimer = useRef(null)
  const handleSearchRef = useRef(handleSearch)
  handleSearchRef.current = handleSearch
  const handleMapMove = useCallback((viewState) => {
    if (!hasSearched.current) return
    clearTimeout(mapMoveTimer.current)
    mapMoveTimer.current = setTimeout(() => {
      if (viewState.bounds) {
        handleSearchRef.current(viewState.bounds)
      }
    }, 400)
  }, [])

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

  const filtered = observations

  // ─── Status text ───────────────────────────────────────────────
  const TIME_LABELS = { hour: 'past hour', day: 'past day', week: 'past week', month: 'past month', year: 'past year', all: 'all time' }
  const sourceName = dataSource === 'All' ? 'iNaturalist, eBird & GBIF' : dataSource === 'eBird' ? 'eBird' : dataSource === 'GBIF' ? 'GBIF' : 'iNaturalist'
  const statusText = loading
    ? `Fetching observations from ${sourceName}…`
    : totalResults !== null
    ? (isAnywhere || !coords)
      ? `${totalResults.toLocaleString()} total observations worldwide — ${TIME_LABELS[timeWindow]}. Displaying the most recent. Zoom in to see individual observations.`
      : `${totalResults.toLocaleString()} total observations within ${radius} km of ${locationName || 'your location'} — ${TIME_LABELS[timeWindow]}. Displaying the most recent.`
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

      {/* Source row */}
      <div className="source-row">
        <span className="source-label">Source ›</span>
        <button
          className={`source-chip ${dataSource === 'All' ? 'active' : ''}`}
          onClick={() => handleSourceChange('All')}
        >
          <span className={`source-dot ${dataSource === 'All' ? 'dot-active' : ''}`} />All
        </button>
        <button
          className={`source-chip ${dataSource === 'iNaturalist' ? 'active' : ''}`}
          onClick={() => handleSourceChange('iNaturalist')}
        >
          <span className={`source-dot ${dataSource === 'All' || dataSource === 'iNaturalist' ? 'dot-active' : ''}`} />iNaturalist
        </button>
        <button
          className={`source-chip ${dataSource === 'eBird' ? 'active' : ''}`}
          onClick={() => handleSourceChange('eBird')}
        >
          <span className={`source-dot ${dataSource === 'All' || dataSource === 'eBird' ? 'dot-active' : ''}`} />eBird
        </button>
        <button
          className={`source-chip ${dataSource === 'GBIF' ? 'active' : ''}`}
          onClick={() => handleSourceChange('GBIF')}
        >
          <span className={`source-dot ${dataSource === 'All' || dataSource === 'GBIF' ? 'dot-active' : ''}`} />GBIF
        </button>
      </div>

      <Controls
        locationName={locationName}
        geoStatus={geoStatus}
        onLocate={handleLocate}
        onLocationSelect={handleLocationSelect}
        selectedSpecies={selectedSpecies}
        onSpeciesSelect={handleSpeciesSelect}
        radius={radius}           onRadiusChange={(r) => setQP({ radius: r })}
        timeWindow={timeWindow}   onTimeChange={(t) => setQP({ time: t })}
        canSearch={canSearch}
        onSearch={handleSearch}
        dataSource={dataSource}
      />

      {(dataSource === 'iNaturalist' || dataSource === 'GBIF' || dataSource === 'All') && totalResults !== null && !selectedSpecies && (
        <TaxonFilter activeTaxon={activeTaxon} onChange={(t) => setQP({ taxon: t })} />
      )}

      <main className="main">
        {/* Status bar */}
        <div className="status-bar">
          <span className="status-text">{statusText}</span>
          <div className="status-right">
            {totalResults !== null && (
              <span className="result-count">
                {totalResults.toLocaleString()} observation{totalResults !== 1 ? 's' : ''}
              </span>
            )}
            <div className="view-toggle">
              <button
                className={`view-btn ${view === 'grid' ? 'active' : ''}`}
                onClick={() => { setQP({ view: 'grid' }); track(posthog, 'view_changed', { view: 'grid' }) }}
                title="Grid view"
              ><GridIcon /></button>
              <button
                className={`view-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => { setQP({ view: 'list' }); track(posthog, 'view_changed', { view: 'list' }) }}
                title="List view"
              ><ListIcon /></button>
              <button
                className={`view-btn ${view === 'map' ? 'active' : ''}`}
                onClick={() => { setQP({ view: 'map' }); track(posthog, 'view_changed', { view: 'map' }) }}
                title="Map view"
              ><MapIcon /></button>
              {totalResults !== null && (
                <button
                  className={`view-btn ${view === 'insights' ? 'active' : ''}`}
                  onClick={() => { setQP({ view: 'insights' }); track(posthog, 'view_changed', { view: 'insights' }) }}
                  title="Insights"
                ><InsightsIcon /></button>
              )}
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && !loading && (
          <div className="error-bar">{error}</div>
        )}

        {/* Content */}
        {loading ? (
          <LoadingState />
        ) : totalResults === null && !error ? (
          dataSource === 'eBird' ? <EBirdStats /> : dataSource === 'GBIF' ? <GBIFStats /> : <GlobalStats dataSource={dataSource} />
        ) : observations.length === 0 && !error ? (
          <EmptyState variant="noResults" />
        ) : error ? (
          <EmptyState variant="error" message={error} />
        ) : view === 'insights' ? (
          <InsightsDashboard
            coords={coords}
            radiusKm={radius}
            timeWindow={timeWindow}
            activeTaxon={activeTaxon}
            selectedSpecies={selectedSpecies}
            dataSource={dataSource}
          />
        ) : view === 'grid' ? (
          <SpeciesGrid observations={filtered} onSelect={setSelectedObs} />
        ) : view === 'list' ? (
          <SpeciesList observations={filtered} onSelect={setSelectedObs} />
        ) : (
          <div className="map-layout">
            <div className="map-container">
              <ExploreMap
                sightings={mapSightings}
                center={coords}
                activeSpecies={activeMapSpecies}
                onCenterChange={handleMapMove}
                radiusKm={isAnywhere ? undefined : radius}
                searchId={searchId}
                config={{ fallbackColor: '#e67e22', fallbackEmoji: '' }}
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
