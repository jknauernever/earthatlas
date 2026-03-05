/**
 * ButterfliesApp — main page component for earthatlas.org/butterflies
 *
 * Phases:
 *   'hero'    — full-bleed entry screen, user has not yet chosen a location
 *   'loading' — location granted/entered, fetching initial data
 *   'explore' — main explore view with map, species cards, season chart
 *
 * Mode (within 'explore'):
 *   'now'      — recent sightings (past 30 days)
 *   'patterns' — historical monthly view, scrubbed by month
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueryParams } from '../hooks/useQueryParams'
import styles from './ButterfliesApp.module.css'

import ButterflyMap from './components/ButterflyMap'
import SpeciesCard from './components/SpeciesCard'
import SeasonChart from './components/SeasonChart'
import LocationSearch from './components/LocationSearch'
import TimeSlider from './components/TimeSlider'

import {
  fetchRecentSightings,
  fetchMonthSightings,
  fetchSeasonalPattern,
  fetchINatSightings,
  aggregateSpecies,
} from './services/butterflies'

// ─── Helper: reverse-geocode lat/lng to a human-readable place name ───────────
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
function formatCoords(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(1)}°${ns}, ${Math.abs(lng).toFixed(1)}°${ew}`
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?limit=1&access_token=${MAPBOX_TOKEN}`
    )
    if (!res.ok) return formatCoords(lat, lng)
    const data = await res.json()
    const f = data.features?.[0]
    if (!f) return formatCoords(lat, lng)

    const ctx = f.context || []
    const find = (prefix) => ctx.find(c => c.id?.startsWith(prefix))

    const placeText = f.id?.startsWith('place') ? f.text : find('place')?.text || find('locality')?.text
    const region = find('region')
    const regionCode = region?.short_code?.replace(/^[A-Z]{2}-/, '') || region?.text
    const country = find('country')
    const countryCode = country?.short_code?.toUpperCase() || country?.text

    const parts = [placeText, regionCode, countryCode].filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : f.text || f.place_name || formatCoords(lat, lng)
  } catch { return formatCoords(lat, lng) }
}

// ─── Helper: format date ──────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return d }
}

// ─── Query param schema (stable reference) ────────────────────────
const QP_SCHEMA = {
  lat:     { type: 'number' },
  lng:     { type: 'number' },
  name:    { type: 'string' },
  mode:    { type: 'string', default: 'now' },
  month:   { type: 'number' },
  species: { type: 'number' },
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ButterfliesApp() {
  const [qp, setQP] = useQueryParams(QP_SCHEMA)

  // Derive initial phase from URL: if lat+lng present, skip hero
  const hasUrlCoords = qp.lat != null && qp.lng != null
  const [phase, setPhase] = useState(hasUrlCoords ? 'loading' : 'hero')

  const mode = qp.mode
  const activeMonth = qp.month != null ? qp.month - 1 : null  // URL is 1-based, display is 0-based
  const activeSpecies = qp.species

  // Derive location from URL params or local state
  const [localLocation, setLocalLocation] = useState(null)
  const location = useMemo(() => {
    if (hasUrlCoords) return { lat: qp.lat, lng: qp.lng, name: qp.name || null }
    return localLocation
  }, [hasUrlCoords, qp.lat, qp.lng, qp.name, localLocation])

  const [locError, setLocError] = useState(null)

  // Data
  const [sightings, setSightings]       = useState([])
  const [species, setSpecies]           = useState([])
  const [seasonPattern, setSeasonPattern] = useState([])
  const [baselinePattern, setBaselinePattern] = useState([]) // all-species pattern
  const [loadingData, setLoadingData]   = useState(false)
  const [dataError, setDataError]       = useState(null)
  const [totalCount, setTotalCount]     = useState(0)

  // Interaction
  const [activeSighting, setActiveSighting] = useState(null)
  const [timeRange, setTimeRange]       = useState({ start: null, end: null }) // ISO date bounds, null = full extent
  const [tooManyResults, setTooManyResults] = useState(false)
  const MAX_SIGHTINGS = 500

  // ─── Zoom → search radius mapping ─────────────────────────────────────────
  function zoomToRadius(z) {
    if (z == null) return 100
    // At zoom 6 ≈ 100km, zoom 4 ≈ 400km, zoom 3 ≈ 800km, zoom 8 ≈ 25km
    return Math.round(100 * Math.pow(2, 6 - z))
  }
  const mapZoomRef = useRef(null)

  // ─── Load data for a location ─────────────────────────────────────────────
  const loadData = useCallback(async (loc, radiusKm) => {
    setLoadingData(true)
    setDataError(null)
    setSightings([])
    setSpecies([])
    setTimeRange({ start: null, end: null })

    try {
      const r = radiusKm || 100
      const [recentResult, patternResult, inatResult] = await Promise.allSettled([
        fetchRecentSightings({ lat: loc.lat, lng: loc.lng, radiusKm: r }),
        fetchSeasonalPattern({ lat: loc.lat, lng: loc.lng, radiusKm: r }),
        fetchINatSightings({ lat: loc.lat, lng: loc.lng, radiusKm: r }),
      ])

      const recentSightings = recentResult.status === 'fulfilled' ? recentResult.value.sightings : []
      const inatSightings = inatResult.status === 'fulfilled' ? inatResult.value : []
      const pattern = patternResult.status === 'fulfilled' ? patternResult.value : []

      // Merge sources (GBIF already filters out iNat-sourced records to avoid duplicates)
      const allSightings = [...recentSightings, ...inatSightings]

      if (allSightings.length > MAX_SIGHTINGS) {
        setTooManyResults(true)
        setSightings(allSightings.slice(0, MAX_SIGHTINGS))
        setSpecies(aggregateSpecies(allSightings.slice(0, MAX_SIGHTINGS)))
      } else {
        setTooManyResults(false)
        setSightings(allSightings)
        setSpecies(aggregateSpecies(allSightings))
      }
      setSeasonPattern(pattern)
      setBaselinePattern(pattern)
      setTotalCount(allSightings.length)
      setPhase('explore')
    } catch (err) {
      setDataError('Could not load sightings data. Please try again.')
      setPhase('explore')
    } finally {
      setLoadingData(false)
    }
  }, [])

  // ─── Cold load: if URL has coords on mount, load data immediately ─────────
  const coldLoaded = useRef(false)
  useEffect(() => {
    if (coldLoaded.current) return
    if (hasUrlCoords) {
      coldLoaded.current = true
      const loc = { lat: qp.lat, lng: qp.lng, name: qp.name || null }
      if (!qp.name) {
        reverseGeocode(qp.lat, qp.lng).then(name => {
          if (name) setQP({ name })
        })
      }
      loadData(loc)
    }
  }, [hasUrlCoords, qp.lat, qp.lng, qp.name, loadData, setQP])

  // ─── Handle month selection in patterns mode ──────────────────────────────
  const handleMonthChange = useCallback(async (monthIdx) => {
    setQP({ month: monthIdx + 1 }) // store 1-based in URL
    if (mode !== 'patterns' || !location) return

    try {
      const result = await fetchMonthSightings({
        lat: location.lat,
        lng: location.lng,
        month: monthIdx + 1, // 1-based for API
        radiusKm: zoomToRadius(mapZoomRef.current),
      })
      setSightings(result.sightings)
      setSpecies(aggregateSpecies(result.sightings))
      setTotalCount(result.sightings.length)
    } catch { /* fail silently, keep existing sightings */ }
  }, [mode, location, setQP])

  // When mode switches to 'now', reload recent sightings
  useEffect(() => {
    if (mode === 'now' && location) loadData(location, zoomToRadius(mapZoomRef.current))
  }, [mode])

  // Fetch per-species seasonal pattern when a species card is clicked
  useEffect(() => {
    if (!location) return
    if (!activeSpecies) {
      setSeasonPattern(baselinePattern)
      return
    }
    let cancelled = false
    fetchSeasonalPattern({ lat: location.lat, lng: location.lng, speciesKey: activeSpecies })
      .then(pattern => { if (!cancelled) setSeasonPattern(pattern) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeSpecies, location, baselinePattern])

  // ─── Geolocation ──────────────────────────────────────────────────────────
  async function handleLocate() {
    setLocError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        const name = await reverseGeocode(lat, lng) || 'Your location'
        const loc = { lat, lng, name }
        setLocalLocation(loc)
        setQP({ lat, lng, name })
        setPhase('loading')
        await loadData(loc)
      },
      (err) => {
        setLocError('Location access denied. Try searching for a place below.')
      },
      { timeout: 8000 }
    )
  }

  // ─── Manual location search ───────────────────────────────────────────────
  async function handleLocationSelect({ name, lat, lng }) {
    const loc = { lat, lng, name }
    setLocalLocation(loc)
    setQP({ lat, lng, name })
    setPhase('loading')
    await loadData(loc)
  }

  // ─── Map moved — re-search at new center ────────────────────────────────
  const handleMapCenterChange = useCallback(async ({ lat, lng, zoom }) => {
    mapZoomRef.current = zoom
    const name = await reverseGeocode(lat, lng) || 'this area'
    const loc = { lat, lng, name }
    setLocalLocation(loc)
    setQP({ lat, lng, name })
    loadData(loc, zoomToRadius(zoom))
  }, [loadData, setQP])

  // ─── "Change location" — clear URL and go back to hero ──────────────────
  const handleChangeLocation = useCallback(() => {
    setQP({ lat: null, lng: null, name: null, mode: 'now', month: null, species: null })
    setLocalLocation(null)
    setPhase('hero')
  }, [setQP])

  // ─── Filtered sightings (time slider) ────────────────────────────────────
  const filteredSightings = useMemo(() => {
    const { start, end } = timeRange
    if (!start && !end) return sightings
    return sightings.filter(s => {
      if (!s.date) return false
      if (start && s.date < start) return false
      if (end && s.date > end) return false
      return true
    })
  }, [sightings, timeRange])

  const filteredSpecies = useMemo(() => aggregateSpecies(filteredSightings), [filteredSightings])
  const filteredCount = filteredSightings.length

  // ─── Render: Hero ─────────────────────────────────────────────────────────
  if (phase === 'hero') {
    return (
      <div className={styles.heroPage}>
        <div className={styles.heroBgPhoto} />
        <div className={styles.heroOverlay} />

        <nav className={styles.heroNav}>
          <a href="/butterflies" className={styles.navWordmark}>
            <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent}>/ Butterflies</span></span>
          </a>
          <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
        </nav>

        <div className={styles.heroContent}>
          <div className={styles.heroEyebrow}>EarthAtlas · Lepidoptera Sightings</div>
          <h1 className={styles.heroTitle}>
            Find <em>butterflies.</em><br />
            Near you. Any time of year.
          </h1>
          <p className={styles.heroSub}>
            Discover which butterflies and moths have been seen near any location — and when you're most likely to see them.
          </p>
          <div className={styles.heroActions}>
            <button className={styles.locateBtn} onClick={handleLocate}>
              <span>◎</span> Use my location
            </button>
            {locError && (
              <div style={{ fontSize: 12, color: 'rgba(240,100,100,0.85)', maxWidth: 320, textAlign: 'center' }}>
                {locError}
              </div>
            )}
            <div className={styles.locateDivider}>or search a destination</div>
            <LocationSearch onSelect={handleLocationSelect} placeholder="Enter a region, park, or trail…" styles={styles} />
          </div>
        </div>

        <div className={styles.heroFooter}>
          <div className={styles.footerText}>
            Sighting data from{' '}
            <a className={styles.footerLink} href="https://www.gbif.org" target="_blank" rel="noopener">GBIF</a>
            {' · '}
            <a className={styles.footerLink} href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>
          </div>
          <div className={styles.footerText}>
            <a className={styles.footerLink} href="/">EarthAtlas.org</a>
          </div>
          <div className={styles.footerBuiltBy}>
            Built by <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer">KnauerNever.com</a>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Loading ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.butterfliesApp}>
        <header className={styles.butterfliesNavWrapper}>
          <nav className={styles.butterfliesNav}>
            <a href="/butterflies" className={styles.navWordmark}>
              <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent}>/ Butterflies</span></span>
            </a>
            <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
          </nav>
        </header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', flexDirection: 'column', gap: 20 }}>
          <div className={styles.loadingEmoji}>🦋</div>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 300, color: 'var(--text)' }}>
            Searching for butterflies near {location?.name || 'you'}…
          </div>
          <div style={{ fontSize: 13, color: '#5a6b7a', maxWidth: 320, textAlign: 'center' }}>
            Querying global biodiversity records and citizen science observations
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Explore ─────────────────────────────────────────────────────
  const displayedMonth = activeMonth !== null ? activeMonth : new Date().getMonth()

  return (
    <div className={styles.butterfliesApp}>
      <header className={styles.butterfliesNavWrapper}>
        <nav className={styles.butterfliesNav}>
          <a href="/butterflies" className={styles.navWordmark}>
            <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent}>/ Butterflies</span></span>
          </a>
          <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
        </nav>
      </header>

      <div className={styles.mainLayout}>
        {/* Topbar */}
        <div className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.backBtn} onClick={handleChangeLocation}>← Change location</button>
            <div className={styles.locationLabel}>
              Near <span>{location?.name || 'your location'}</span>
            </div>
          </div>

          <div className={styles.topbarRight}>
            <div className={styles.modeBar}>
              <button
                className={`${styles.modeBtn} ${mode === 'now' ? styles.modeBtnActive : ''}`}
                onClick={() => setQP({ mode: 'now', month: null })}
              >
                Recent sightings
              </button>
              <button
                className={`${styles.modeBtn} ${mode === 'patterns' ? styles.modeBtnActive : ''}`}
                onClick={() => setQP({ mode: 'patterns' })}
              >
                Seasonal patterns
              </button>
            </div>
          </div>
        </div>

        {/* Status */}
        {!loadingData && (
          <div className={styles.statusStrip}>
            <div className={`${styles.statusDot} ${mode === 'patterns' ? styles.statusDotAmber : ''}`} />
            {mode === 'now'
              ? `${filteredCount} lepidoptera sightings${timeRange.start || timeRange.end ? ` · ${fmtDate(timeRange.start || sightings.reduce((m, s) => s.date && (!m || s.date < m) ? s.date : m, null))} – ${fmtDate(timeRange.end || sightings.reduce((m, s) => s.date && (!m || s.date > m) ? s.date : m, null))}` : ' in the past 30 days'} · ${filteredSpecies.length} species`
              : `Showing historical sightings for ${['January','February','March','April','May','June','July','August','September','October','November','December'][displayedMonth]} across all years`
            }
          </div>
        )}

        {tooManyResults && !loadingData && (
          <div style={{ padding: '12px 20px', background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.25)', borderRadius: 10, fontSize: 13, color: '#b8842a', marginBottom: 8 }}>
            Showing {MAX_SIGHTINGS} of {totalCount.toLocaleString()} sightings — zoom in for a more detailed view.
          </div>
        )}

        {dataError && (
          <div style={{ padding: '12px 20px', background: 'rgba(220,80,80,0.1)', border: '1px solid rgba(220,80,80,0.25)', borderRadius: 10, fontSize: 13, color: '#e08080', marginBottom: 20 }}>
            {dataError}
          </div>
        )}

        {/* Content grid */}
        <div className={styles.contentGrid}>
          {/* Map + time slider */}
          <div className={styles.mapBlock}>
            <div className={styles.mapWrap}>
              <div className={styles.mapOverlay}>
                <div className={styles.mapBadge}>
                  <div className={styles.mapBadgeDot} />
                  {mode === 'now' ? 'Past 30 days' : 'Historical'}
                </div>
                {!loadingData && (
                  <div className={styles.mapSightingCount}>
                    {filteredCount.toLocaleString()} sightings shown
                  </div>
                )}
              </div>
              <ButterflyMap
                sightings={filteredSightings}
                center={location}
                activeSpecies={activeSpecies}
                onCenterChange={handleMapCenterChange}
              />
            </div>
            {mode === 'now' && !loadingData && sightings.length > 0 && (
              <TimeSlider
                sightings={sightings}
                value={timeRange}
                onChange={setTimeRange}
              />
            )}
          </div>

          {/* Season chart */}
          <div className={styles.seasonSection}>
            <div className={styles.sectionLabel}>Seasonal patterns</div>
            <div className={styles.sectionTitle}>When are they here?</div>
            <div className={styles.sectionSub}>
              Historical sighting density by month, all years combined
            </div>
            <SeasonChart
              pattern={seasonPattern}
              activeMonth={activeMonth}
              onMonthChange={handleMonthChange}
              loading={loadingData}
              styles={styles}
            />
          </div>

          {/* Species panel */}
          <div className={styles.speciesPanel}>
            <div className={styles.speciesPanelHead}>
              <div className={styles.speciesPanelTitle}>
                {mode === 'now' ? 'Species seen nearby' : 'Species in this month'}
              </div>
              {filteredSpecies.length > 0 && (
                <div className={styles.speciesCount}>{filteredSpecies.length} species</div>
              )}
            </div>

            {loadingData ? (
              [0, 1, 2, 3].map(i => (
                <div key={i} className={styles.shimmerCard} style={{ animationDelay: `${i * 0.12}s` }} />
              ))
            ) : filteredSpecies.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyStateEmoji}>🦋</div>
                <div className={styles.emptyStateText}>No sightings found nearby</div>
                <div className={styles.emptyStateSub}>
                  Try switching to Seasonal patterns to see historical data,<br />
                  or search a different area.
                </div>
              </div>
            ) : (
              filteredSpecies.map((sp, i) => (
                <SpeciesCard
                  key={sp.speciesKey || sp.common}
                  species={sp}
                  totalCount={filteredCount}
                  active={activeSpecies === sp.speciesKey}
                  onClick={() => setQP({ species: sp.speciesKey === activeSpecies ? null : sp.speciesKey })}
                  style={{ animationDelay: `${i * 0.07}s` }}
                  styles={styles}
                />
              ))
            )}
          </div>
        </div>

      </div>{/* end mainLayout */}

      <div className={styles.footerWave}>
        <svg viewBox="0 0 1440 32" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0 18 C200 32,400 4,600 18 C800 32,1000 4,1200 18 C1300 25,1380 12,1440 18 L1440 0 L0 0 Z" fill="#f2f4f7"/>
        </svg>
      </div>

      <footer className={styles.butterfliesFooter}>
        <div className={styles.footerText}>
          Sighting data from{' '}
          <a className={styles.footerLink} href="https://www.gbif.org" target="_blank" rel="noopener">GBIF</a>
          {' · '}
          <a className={styles.footerLink} href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>
        </div>
        <div className={styles.footerText}>
          <a className={styles.footerLink} href="/">EarthAtlas.org</a>
        </div>
        <div className={styles.footerBuiltBy}>
          Built by <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer">KnauerNever.com</a>
        </div>
      </footer>
    </div>
  )
}
