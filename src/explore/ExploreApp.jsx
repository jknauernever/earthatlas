/**
 * ExploreApp — unified explore component for all EarthAtlas subsites
 *
 * Receives a `config` prop that parameterizes every taxon-specific detail:
 * slug, name, theme colors, hero text, SEO, defaults, service, etc.
 *
 * Phases:
 *   'hero'    — full-bleed entry screen, user has not yet chosen a location
 *   'loading' — location granted/entered, fetching initial data
 *   'explore' — main explore view with map, species cards, season chart
 *
 * Mode (within 'explore'):
 *   'now'      — recent sightings (past N days)
 *   'patterns' — historical monthly view, scrubbed by month
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueryParams } from '../hooks/useQueryParams'
import { useSEO } from '../hooks/useSEO'
import styles from './ExploreApp.module.css'

import ExploreMap from './components/ExploreMap'
import SpeciesListItem from './components/SpeciesListItem'
import SeasonChart from './components/SeasonChart'
import LocationSearch from './components/LocationSearch'
import TimeSlider from './components/TimeSlider'

import { reverseGeocode, fmtDate } from './utils'

const QP_SCHEMA = {
  lat:     { type: 'number' },
  lng:     { type: 'number' },
  name:    { type: 'string' },
  mode:    { type: 'string', default: 'now' },
  month:   { type: 'number' },
  species: { type: 'string' },
}

export default function ExploreApp({ config }) {
  const { service } = config
  const {
    fetchRecentSightings,
    fetchMonthSightings,
    fetchSeasonalPattern,
    fetchINatSightings,
    aggregateSpecies,
  } = service

  useSEO({
    title: config.seo.title,
    description: config.seo.description,
    path: `/${config.slug}`,
    image: config.seo.image,
  })

  const [qp, setQP] = useQueryParams(QP_SCHEMA)

  // Derive initial phase from URL: if lat+lng present, skip hero
  const hasUrlCoords = qp.lat != null && qp.lng != null
  const [phase, setPhase] = useState(hasUrlCoords ? 'loading' : 'hero')

  const mode = qp.mode
  const activeMonth = qp.month != null ? qp.month - 1 : null  // URL is 1-based, display is 0-based
  const activeSpecies = qp.species
  const displayedMonth = activeMonth !== null ? activeMonth : new Date().getMonth()

  // Derive location from URL params or local state
  const [localLocation, setLocalLocation] = useState(null)
  const location = useMemo(() => {
    if (hasUrlCoords) return { lat: qp.lat, lng: qp.lng, name: qp.name || null }
    return localLocation
  }, [hasUrlCoords, qp.lat, qp.lng, qp.name, localLocation])

  const [locError, setLocError] = useState(null)

  // Data
  const [sightings, setSightings]         = useState([])
  const [species, setSpecies]             = useState([])
  const [seasonPattern, setSeasonPattern] = useState([])
  const [baselinePattern, setBaselinePattern] = useState([]) // all-species pattern
  const [loadingData, setLoadingData]     = useState(false)
  const [dataError, setDataError]         = useState(null)
  const [openInfoKey, setOpenInfoKey]     = useState(null)
  const [totalCount, setTotalCount]       = useState(0)

  // Interaction
  const [activeSighting, setActiveSighting] = useState(null)
  const [timeRange, setTimeRange]         = useState({ start: null, end: null })
  const [tooManyResults, setTooManyResults] = useState(false)
  const MAX_SIGHTINGS = config.defaults.maxSightings

  // ─── Zoom → search radius mapping ─────────────────────────────────────────
  function zoomToRadius(z) {
    if (z == null) return config.defaults.radiusKm
    return Math.round(config.defaults.radiusKm * Math.pow(2, config.defaults.zoom - z))
  }
  const mapZoomRef = useRef(null)
  const abortRef = useRef(null)

  // ─── Load data for a location ─────────────────────────────────────────────
  const loadData = useCallback(async (loc, radiusKm) => {
    // Cancel any in-flight requests
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    setLoadingData(true)
    setDataError(null)
    setTimeRange({ start: null, end: null })

    try {
      const r = radiusKm || config.defaults.radiusKm
      const [recentResult, patternResult, inatResult] = await Promise.allSettled([
        fetchRecentSightings({ lat: loc.lat, lng: loc.lng, radiusKm: r, days: config.defaults.days, signal }),
        fetchSeasonalPattern({ lat: loc.lat, lng: loc.lng, radiusKm: r, signal }),
        fetchINatSightings({ lat: loc.lat, lng: loc.lng, radiusKm: r, days: config.defaults.days, signal }),
      ])

      if (signal.aborted) return

      const recentSightings = recentResult.status === 'fulfilled' ? recentResult.value.sightings : []
      const inatSightings   = inatResult.status === 'fulfilled'   ? inatResult.value : []
      const pattern         = patternResult.status === 'fulfilled' ? patternResult.value : []

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
      if (signal.aborted) return
      setDataError('Could not load sightings data. Please try again.')
      setPhase('explore')
    } finally {
      if (!signal.aborted) setLoadingData(false)
    }
  }, [fetchRecentSightings, fetchSeasonalPattern, fetchINatSightings, aggregateSpecies, config.defaults.radiusKm, config.defaults.days, MAX_SIGHTINGS])

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
        speciesKey: activeSpecies ? Number(activeSpecies) : null,
        radiusKm: zoomToRadius(mapZoomRef.current),
      })
      setSightings(result.sightings)
      setSpecies(aggregateSpecies(result.sightings))
      setTotalCount(result.total)
    } catch { /* fail silently, keep existing sightings */ }
  }, [mode, location, activeSpecies, setQP, fetchMonthSightings, aggregateSpecies])

  // Only reload when mode *changes* (not on mount — coldLoaded handles that)
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current === mode) return
    prevModeRef.current = mode
    if (mode === 'now' && location) loadData(location, zoomToRadius(mapZoomRef.current))
    if (mode === 'patterns' && location) handleMonthChange(displayedMonth)
  }, [mode, location, loadData, handleMonthChange, displayedMonth])

  // Re-fetch month sightings when species selection changes in patterns mode
  useEffect(() => {
    if (mode !== 'patterns' || !location) return
    handleMonthChange(displayedMonth)
  }, [activeSpecies])

  // Fetch per-species seasonal pattern when a species card is clicked
  useEffect(() => {
    if (!location) return
    if (!activeSpecies) {
      setSeasonPattern(baselinePattern)
      return
    }
    let cancelled = false
    fetchSeasonalPattern({ lat: location.lat, lng: location.lng, speciesKey: Number(activeSpecies) })
      .then(pattern => { if (!cancelled) setSeasonPattern(pattern) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeSpecies, location, baselinePattern, fetchSeasonalPattern])

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
      () => {
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

  const filteredSpecies = useMemo(() => aggregateSpecies(filteredSightings), [filteredSightings, aggregateSpecies])
  const filteredCount = filteredSightings.length

  // ─── Theme CSS custom properties ──────────────────────────────────────────
  const themeVars = {
    '--glow': config.theme.glow,
    '--glow-dim': config.theme.glowDim,
    '--glow-mid': config.theme.glowMid,
    '--hero-bg': config.hero.bgColor,
    '--hero-image': `url(${config.hero.image})`,
  }

  const heroVars = {
    '--hero-bg': config.hero.bgColor,
    '--hero-accent': config.hero.accentColor,
  }

  // ─── Render: Hero ─────────────────────────────────────────────────────────
  if (phase === 'hero') {
    return (
      <div className={styles.heroPage} style={{ ...heroVars, ...themeVars }}>
        <div className={styles.heroBgPhoto} style={{ backgroundImage: `url(${config.hero.image})`, ...config.hero.imageStyle }} />
        <div className={styles.heroOverlay} />

        <nav className={styles.heroNav}>
          <a href={`/${config.slug}`} className={styles.navWordmark}>
            <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent} style={{ color: config.hero.navAccent }}>/ {config.name}</span></span>
          </a>
          <a href="/" className={styles.navHomeLink}>&larr; Back to EarthAtlas</a>
        </nav>

        <div className={styles.heroContent}>
          <div className={styles.heroEyebrow}>{config.hero.eyebrow}</div>
          <h1 className={styles.heroTitle}>
            {config.hero.title[0]}<em>{config.hero.title[1]}</em>
          </h1>
          <div className={styles.heroSubtitle}>{config.hero.subtitle}</div>
          <p className={styles.heroSub}>
            {config.hero.description}
          </p>
          <div className={styles.heroActions}>
            <button className={styles.locateBtn} onClick={handleLocate}>
              <span>&#9678;</span> Use my location
            </button>
            {locError && (
              <div style={{ fontSize: 12, color: 'rgba(240,100,100,0.85)', maxWidth: 320, textAlign: 'center' }}>
                {locError}
              </div>
            )}
            <div className={styles.locateDivider}>or search a destination</div>
            <LocationSearch onSelect={handleLocationSelect} styles={styles} />
          </div>
        </div>

        <div className={styles.heroFooter}>
          <div className={styles.footerText}>
            Sighting data from{' '}
            <a className={styles.footerLink} href="https://www.gbif.org" target="_blank" rel="noopener">GBIF</a>
            {' \u00b7 '}
            <a className={styles.footerLink} href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>
          </div>
          <div className={styles.footerText}>
            Built by <a className={styles.footerLink} href="https://knauernever.com" target="_blank" rel="noopener noreferrer">KnauerNever.com</a>
          </div>
          <div className={styles.footerText}>
            &copy; 2026 <a className={styles.footerLink} href="/">EarthAtlas.org</a>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Loading ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    const loadingMessage = config.loading.message.replace('{location}', location?.name || 'you')
    return (
      <div className={styles.exploreApp} style={themeVars}>
        <header className={styles.exploreNavWrapper}>
          <nav className={styles.exploreNav}>
            <a href={`/${config.slug}`} className={styles.navWordmark}>
              <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent} style={{ color: config.hero.navAccent }}>/ {config.name}</span></span>
            </a>
            <a href="/" className={styles.navHomeLink}>&larr; Back to EarthAtlas</a>
          </nav>
        </header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', flexDirection: 'column', gap: 20 }}>
          <div className={styles.loadingEmoji}>{config.loading.emoji}</div>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 300, color: 'var(--text)' }}>
            {loadingMessage}
          </div>
          <div style={{ fontSize: 13, color: '#5a6b7a', maxWidth: 320, textAlign: 'center' }}>
            {config.loading.detail}
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Explore ──────────────────────────────────────────────────────

  return (
    <div className={styles.exploreApp} style={themeVars}>
      <header className={styles.exploreNavWrapper}>
        <nav className={styles.exploreNav}>
          <a href={`/${config.slug}`} className={styles.navWordmark}>
            <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent} style={{ color: config.hero.navAccent }}>/ {config.name}</span></span>
          </a>
          <a href="/" className={styles.navHomeLink}>&larr; Back to EarthAtlas</a>
        </nav>
      </header>

      <div className={styles.mainLayout}>
        {/* Topbar */}
        <div className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.backBtn} onClick={handleChangeLocation}>&larr; Change location</button>
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

        {/* Status strip */}
        {!loadingData && (
          <div className={styles.statusStrip}>
            <div className={`${styles.statusDot} ${mode === 'patterns' ? styles.statusDotAmber : ''}`} />
            {mode === 'now'
              ? `${filteredCount} ${config.taxonLabel} sightings${timeRange.start || timeRange.end ? ` \u00b7 ${fmtDate(timeRange.start || sightings.reduce((m, s) => s.date && (!m || s.date < m) ? s.date : m, null))} \u2013 ${fmtDate(timeRange.end || sightings.reduce((m, s) => s.date && (!m || s.date > m) ? s.date : m, null))}` : ` in the past ${config.defaults.days} days`} \u00b7 ${filteredSpecies.length} species`
              : `${totalCount.toLocaleString()} historical sightings for ${['January','February','March','April','May','June','July','August','September','October','November','December'][displayedMonth]} across all years`
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
                  {mode === 'now' ? `Past ${config.defaults.days} days` : 'Historical'}
                </div>
                {!loadingData && (
                  <div className={styles.mapSightingCount}>
                    {filteredCount.toLocaleString()} sightings shown
                  </div>
                )}
              </div>
              <ExploreMap
                sightings={filteredSightings}
                center={location}
                activeSpecies={activeSpecies}
                onCenterChange={handleMapCenterChange}
                patternsMonth={mode === 'patterns' ? displayedMonth + 1 : null}
                config={{
                  fallbackColor: config.fallback.color,
                  fallbackEmoji: config.fallback.emoji,
                  heatmapLayers: config.heatmapLayers,
                }}
              />
            </div>
            {mode === 'now' && !loadingData && sightings.length > 0 && (
              <TimeSlider
                sightings={sightings}
                value={timeRange}
                onChange={setTimeRange}
                styles={styles}
              />
            )}
          </div>

          {/* Season chart (below map in grid) */}
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
                <div className={styles.emptyStateEmoji}>{config.empty.emoji}</div>
                <div className={styles.emptyStateText}>{config.empty.text}</div>
                <div
                  className={styles.emptyStateSub}
                  dangerouslySetInnerHTML={{ __html: config.empty.sub }}
                />
              </div>
            ) : (
              filteredSpecies.map((sp, i) => (
                <SpeciesListItem
                  key={sp.speciesKey || sp.common}
                  species={sp}
                  active={activeSpecies == sp.speciesKey}
                  onClick={() => setQP({ species: sp.speciesKey == activeSpecies ? null : sp.speciesKey })}
                  style={{ animationDelay: `${i * 0.03}s` }}
                  styles={styles}
                  openInfoKey={openInfoKey}
                  setOpenInfoKey={setOpenInfoKey}
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

      <footer className={styles.exploreFooter}>
        <div className={styles.footerText}>
          Sighting data from{' '}
          <a className={styles.footerLink} href="https://www.gbif.org" target="_blank" rel="noopener">GBIF</a>
          {' \u00b7 '}
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
