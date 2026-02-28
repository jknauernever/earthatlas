import { useState, useCallback } from 'react'
import { useGeolocation } from './hooks/useGeolocation'
import { fetchObservations, reverseGeocode } from './services/iNaturalist'
import { getDateRangeStart } from './utils/taxon'

import Header           from './components/Header'
import Controls         from './components/Controls'
import TaxonFilter      from './components/TaxonFilter'
import SpeciesGrid      from './components/SpeciesGrid'
import SpeciesList      from './components/SpeciesList'
import MapView          from './components/MapView'
import ObservationModal from './components/ObservationModal'
import LoadingState     from './components/LoadingState'
import EmptyState       from './components/EmptyState'
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

export default function App() {
  // ─── Geo ───────────────────────────────────────────────────────
  const { coords: geoCoords, status: geoStatus, locate } = useGeolocation()
  const [manualCoords, setManualCoords] = useState(null)
  const [locationName, setLocationName] = useState(null)
  const coords = manualCoords || geoCoords

  // ─── Search params ─────────────────────────────────────────────
  const [radius,          setRadius]          = useState(5)
  const [timeWindow,      setTimeWindow]      = useState('day')
  const [perPage,         setPerPage]         = useState(50)
  const [selectedSpecies, setSelectedSpecies] = useState(null)

  // ─── Results ───────────────────────────────────────────────────
  const [observations, setObservations] = useState([])
  const [totalResults, setTotalResults] = useState(null)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState(null)

  // ─── Filter ────────────────────────────────────────────────────
  const [activeTaxon, setActiveTaxon] = useState('all')

  // ─── View ──────────────────────────────────────────────────────
  const [view, setView] = useState('map') // 'grid' | 'list' | 'map'

  // ─── Modal ─────────────────────────────────────────────────────
  const [selectedObs, setSelectedObs] = useState(null)

  // ─── Handle locate ─────────────────────────────────────────────
  const handleLocate = useCallback(async () => {
    setManualCoords(null) // clear manual override so GPS takes over
    setLocationName(null)
    locate()
  }, [locate])

  // ─── Handle manual location select ────────────────────────────
  const handleLocationSelect = useCallback(({ lat, lng, name }) => {
    setManualCoords({ lat, lng })
    setLocationName(name)
  }, [])

  // Reverse geocode when coords arrive
  const prevCoords = useState(null)
  const handleCoordsReady = useCallback(async (lat, lng) => {
    try {
      const name = await reverseGeocode(lat, lng)
      setLocationName(name)
    } catch {
      setLocationName(`${lat.toFixed(4)}, ${lng.toFixed(4)}`)
    }
  }, [])

  // Effect to fire geocoding once geo resolves
  useState(() => {}) // noop; handled below via render-time comparison
  if (coords && geoStatus === 'success' && !locationName) {
    handleCoordsReady(coords.lat, coords.lng)
  }

  // ─── Search ────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    if (!coords) return
    setLoading(true)
    setError(null)
    setActiveTaxon('all')

    try {
      const d1   = getDateRangeStart(timeWindow)
      const d2   = new Date().toISOString().split('T')[0]
      const data = await fetchObservations({
        lat: coords.lat,
        lng: coords.lng,
        radiusKm: radius,
        d1,
        d2: d1 ? d2 : undefined,
        perPage,
        taxonId: selectedSpecies?.id,
      })
      setObservations(data.results || [])
      setTotalResults(data.total_results || 0)
    } catch (err) {
      setError(err.message)
      setObservations([])
      setTotalResults(null)
    } finally {
      setLoading(false)
    }
  }, [coords, radius, timeWindow, perPage, selectedSpecies])

  // ─── Filter observations client-side ───────────────────────────
  const filtered = activeTaxon === 'all'
    ? observations
    : observations.filter(obs => obs.taxon?.iconic_taxon_name === activeTaxon)

  // ─── Status text ───────────────────────────────────────────────
  const TIME_LABELS = { hour: 'past hour', day: 'past day', week: 'past week', month: 'past month', year: 'past year', all: 'all time' }
  const statusText = loading
    ? 'Fetching observations from iNaturalist…'
    : totalResults !== null
    ? `${totalResults.toLocaleString()} total observations within ${radius} km of ${locationName || 'your location'} — ${TIME_LABELS[timeWindow]}.`
    : error
    ? `Error: ${error}`
    : coords
    ? `Location set — ${locationName || 'ready to search'}.`
    : 'Set your location to begin exploring.'

  const canSearch = !!coords && (geoStatus === 'success' || !!manualCoords) && !loading

  // ─── Render ────────────────────────────────────────────────────
  return (
    <>
      <Header />

      {/* Source row */}
      <div className="source-row">
        <span className="source-label">Source ›</span>
        <button className="source-chip active">
          <span className="source-dot active-dot" />iNaturalist
        </button>
        <button className="source-chip coming-soon" disabled title="Coming soon">
          <span className="source-dot ebird-dot" />eBird <span className="soon-tag">SOON</span>
        </button>
        <button className="source-chip coming-soon" disabled title="Coming soon">
          <span className="source-dot gbif-dot" />GBIF <span className="soon-tag">SOON</span>
        </button>
      </div>

      <Controls
        locationName={locationName}
        geoStatus={geoStatus}
        onLocate={handleLocate}
        onLocationSelect={handleLocationSelect}
        selectedSpecies={selectedSpecies}
        onSpeciesSelect={setSelectedSpecies}
        radius={radius}           onRadiusChange={setRadius}
        timeWindow={timeWindow}   onTimeChange={setTimeWindow}
        perPage={perPage}         onPerPageChange={setPerPage}
        canSearch={canSearch}
        onSearch={handleSearch}
      />

      <TaxonFilter activeTaxon={activeTaxon} onChange={setActiveTaxon} />

      <main className="main">
        {/* Status bar */}
        <div className="status-bar">
          <span className="status-text">{statusText}</span>
          <div className="status-right">
            {totalResults !== null && (
              <span className="result-count">
                {filtered.length} observation{filtered.length !== 1 ? 's' : ''}
              </span>
            )}
            <div className="view-toggle">
              <button
                className={`view-btn ${view === 'grid' ? 'active' : ''}`}
                onClick={() => setView('grid')}
                title="Grid view"
              ><GridIcon /></button>
              <button
                className={`view-btn ${view === 'list' ? 'active' : ''}`}
                onClick={() => setView('list')}
                title="List view"
              ><ListIcon /></button>
              <button
                className={`view-btn ${view === 'map' ? 'active' : ''}`}
                onClick={() => setView('map')}
                title="Map view"
              ><MapIcon /></button>
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
        ) : observations.length === 0 && !error ? (
          <EmptyState variant={totalResults === null ? 'initial' : 'noResults'} />
        ) : error ? (
          <EmptyState variant="error" message={error} />
        ) : view === 'grid' ? (
          <SpeciesGrid observations={filtered} onSelect={setSelectedObs} />
        ) : view === 'list' ? (
          <SpeciesList observations={filtered} onSelect={setSelectedObs} />
        ) : (
          <MapView observations={filtered} onSelect={setSelectedObs} coords={coords} radiusKm={radius} />
        )}
      </main>

      <footer className="footer">
        Data sourced from{' '}
        <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer">iNaturalist</a>
        {' '}— a joint initiative of the California Academy of Sciences and National Geographic Society.
        &nbsp;|&nbsp;
        <a href="https://www.inaturalist.org/pages/api+reference" target="_blank" rel="noopener noreferrer">API Reference</a>
      </footer>

      <ObservationModal obs={selectedObs} onClose={() => setSelectedObs(null)} />
      <Analytics />
    </>
  )
}
