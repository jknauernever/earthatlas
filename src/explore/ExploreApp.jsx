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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const SOURCE_URLS = {
  GBIF: 'https://www.gbif.org',
  iNaturalist: 'https://www.inaturalist.org',
  eBird: 'https://ebird.org',
}

// View-local species colors: the species visible right now get distinct hues
// (in count order), overflow goes neutral gray. Guarantees the on-screen set
// is distinguishable without hand-assigning colors to every species config.
const SPECIES_PALETTE = ['#e74c3c', '#2e86de', '#27ae60', '#8e44ad', '#e67e22', '#16a085', '#d81b60', '#6d4c41']
const SPECIES_OVERFLOW_COLOR = '#7a8ba0'

// "2026-08-29" → "Today" / "Yesterday" / "3d ago"
function relDay(dateStr) {
  const days = Math.round((Date.now() - new Date(dateStr + 'T12:00:00')) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

const QP_SCHEMA = {
  lat:     { type: 'number' },
  lng:     { type: 'number' },
  name:    { type: 'string' },
  mode:    { type: 'string', default: 'now' },
  month:   { type: 'number' },
  species: { type: 'string' },
  from:    { type: 'string' }, // time-slider range start (YYYY-MM-DD), absent = data min
  to:      { type: 'string' }, // time-slider range end (YYYY-MM-DD), absent = data max
  z:       { type: 'number' }, // map zoom — lat/lng already track the map center
}

export default function ExploreApp({ config }) {
  const { service } = config
  const {
    fetchRecentSightings,
    fetchMonthSightings,
    fetchSeasonalPattern,
    fetchINatSightings,
    fetchEBirdSightings,
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
  const [fetching, setFetching]           = useState(false)  // lightweight spinner for pan/zoom re-fetches
  const [dataError, setDataError]         = useState(null)
  const [openInfoKey, setOpenInfoKey]     = useState(null)
  const [totalCount, setTotalCount]       = useState(0)

  // Interaction
  const [activeSighting, setActiveSighting] = useState(null)
  // Time-slider range lives in the URL (from/to) so shared links reproduce it
  const timeRange = useMemo(() => ({ start: qp.from, end: qp.to }), [qp.from, qp.to])
  const setTimeRange = useCallback(
    ({ start, end }) => setQP({ from: start || null, to: end || null }),
    [setQP]
  )
  const [tooManyResults, setTooManyResults] = useState(false)
  const MAX_SIGHTINGS = config.defaults.maxSightings

  // ─── Map state ────────────────────────────────────────────────────────────
  const mapZoomRef = useRef(null)
  const mapBoundsRef = useRef(null)
  const abortRef = useRef(null)

  // Compute approximate viewport bounds from center + zoom (for initial load).
  // Clamped to valid coordinates — at world zooms the raw span exceeds ±90/±180
  // and GBIF rejects the bbox.
  function boundsFromZoom(lat, lng, zoom) {
    const z = zoom || config.defaults.zoom || 6
    const latSpan = 180 / Math.pow(2, z)
    const lngSpan = 360 / Math.pow(2, z)
    return {
      minLat: Math.max(-90, lat - latSpan),
      maxLat: Math.min(90, lat + latSpan),
      minLng: Math.max(-180, lng - lngSpan),
      maxLng: Math.min(180, lng + lngSpan),
    }
  }

  // ─── Load data for a location ─────────────────────────────────────────────
  const loadData = useCallback(async (loc, { bounds, silent = false } = {}) => {
    // Cancel any in-flight requests
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    // Only show full loading state on initial load, not on pan/zoom re-fetches
    if (!silent) setLoadingData(true)
    setFetching(true)
    setDataError(null)

    try {
      // Use viewport bounds when available, otherwise estimate from default zoom
      const geo = bounds
        ? { lat: loc.lat, lng: loc.lng, bounds }
        : { lat: loc.lat, lng: loc.lng, bounds: boundsFromZoom(loc.lat, loc.lng) }
      const [recentResult, patternResult, inatResult, ebirdResult] = await Promise.allSettled([
        fetchRecentSightings({ ...geo, days: config.defaults.days, limit: MAX_SIGHTINGS, signal }),
        fetchSeasonalPattern({ ...geo, signal }),
        fetchINatSightings({ ...geo, days: config.defaults.days, signal }),
        fetchEBirdSightings({ ...geo, days: config.defaults.days, signal }),
      ])

      if (signal.aborted) return

      const recentData      = recentResult.status === 'fulfilled' ? recentResult.value : { sightings: [], total: 0 }
      const inatSightings   = inatResult.status === 'fulfilled'   ? inatResult.value : []
      const ebirdSightings  = ebirdResult.status === 'fulfilled'  ? ebirdResult.value : []
      const pattern         = patternResult.status === 'fulfilled' ? patternResult.value : []


      // Merge sources (GBIF already filters out iNat-sourced records to avoid duplicates)
      const allSightings = [...recentData.sightings, ...inatSightings, ...ebirdSightings]

      // Use the GBIF estimated total as the "real" total for display
      const apiTotal = Math.max(recentData.total, allSightings.length)

      if (allSightings.length > MAX_SIGHTINGS) {
        setTooManyResults(true)
        setSightings(allSightings.slice(0, MAX_SIGHTINGS))
        setSpecies(aggregateSpecies(allSightings.slice(0, MAX_SIGHTINGS)))
      } else {
        setTooManyResults(allSightings.length < apiTotal)
        setSightings(allSightings)
        setSpecies(aggregateSpecies(allSightings))
      }
      setSeasonPattern(pattern)
      setBaselinePattern(pattern)
      setTotalCount(apiTotal)
      setPhase('explore')
      initialLoadDone.current = true
    } catch (err) {
      if (signal.aborted) return
      setDataError('Could not load sightings data. Please try again.')
      setPhase('explore')
      initialLoadDone.current = true
    } finally {
      if (!signal.aborted) {
        setLoadingData(false)
        setFetching(false)
      }
    }
  }, [fetchRecentSightings, fetchSeasonalPattern, fetchINatSightings, fetchEBirdSightings, aggregateSpecies, config.defaults.days, MAX_SIGHTINGS])

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
      // Scope the fetch to the zoom the shared URL encodes — the map opens at
      // that view, so the data must cover it (not the default-zoom box).
      loadData(loc, qp.z != null ? { bounds: boundsFromZoom(qp.lat, qp.lng, qp.z) } : undefined)
    }
  }, [hasUrlCoords, qp.lat, qp.lng, qp.name, loadData, setQP])

  // ─── Handle month selection in patterns mode ──────────────────────────────
  const handleMonthChange = useCallback(async (monthIdx) => {
    setQP({ month: monthIdx + 1 }) // store 1-based in URL
    if (mode !== 'patterns' || !location) return

    try {
      const bounds = mapBoundsRef.current
      const result = await fetchMonthSightings({
        lat: location.lat,
        lng: location.lng,
        month: monthIdx + 1, // 1-based for API
        speciesKey: activeSpecies ? Number(activeSpecies) : null,
        ...(bounds ? { bounds } : { bounds: boundsFromZoom(location.lat, location.lng, mapZoomRef.current ?? qp.z) }),
      })
      setSightings(result.sightings)
      setSpecies(aggregateSpecies(result.sightings))
      setTotalCount(result.total)
    } catch { /* fail silently, keep existing sightings */ }
  }, [mode, location, activeSpecies, qp.z, setQP, fetchMonthSightings, aggregateSpecies])

  // Only reload when mode *changes* (not on mount — coldLoaded handles that)
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current === mode) return
    prevModeRef.current = mode
    if (mode === 'now' && location) loadData(location, { bounds: mapBoundsRef.current, silent: true })
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
        setQP({ lat, lng, name, from: null, to: null })
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
    setQP({ lat, lng, name, from: null, to: null })
    setPhase('loading')
    await loadData(loc)
  }

  // ─── Map moved — re-search at new center ────────────────────────────────
  const initialLoadDone = useRef(false)
  const handleMapCenterChange = useCallback(async ({ lat, lng, zoom, bounds }) => {
    // Skip map-move re-fetches until initial load completes (otherwise the
    // map's own moveend event aborts the first GBIF request mid-pagination)
    if (!initialLoadDone.current) return
    mapZoomRef.current = zoom
    mapBoundsRef.current = bounds
    const name = await reverseGeocode(lat, lng) || 'this area'
    const loc = { lat, lng, name }
    setLocalLocation(loc)
    setQP({ lat, lng, name, z: zoom })
    loadData(loc, { bounds, silent: true })
  }, [loadData, setQP])

  // ─── "Change location" — clear URL and go back to hero ──────────────────
  const handleChangeLocation = useCallback(() => {
    setQP({ lat: null, lng: null, name: null, mode: 'now', month: null, species: null, from: null, to: null })
    setLocalLocation(null)
    setPhase('hero')
  }, [setQP])

  // ─── Filtered sightings (time slider) ────────────────────────────────────
  // The slider is a recent-mode concept: patterns mode shows historical
  // records across all years, so a from/to range (still in the URL for the
  // trip back to recent mode) must not filter them.
  const filteredSightings = useMemo(() => {
    const { start, end } = timeRange
    if (mode === 'patterns') return sightings
    if (!start && !end) return sightings
    return sightings.filter(s => {
      if (!s.date) return false
      if (start && s.date < start) return false
      if (end && s.date > end) return false
      return true
    })
  }, [sightings, timeRange, mode])

  const filteredSpecies = useMemo(() => aggregateSpecies(filteredSightings), [filteredSightings, aggregateSpecies])
  const filteredCount = filteredSightings.length

  // View-local color assignment (see SPECIES_PALETTE)
  const speciesColorMap = useMemo(() => {
    const map = {}
    filteredSpecies.forEach((sp, i) => {
      map[sp.speciesKey] = i < SPECIES_PALETTE.length ? SPECIES_PALETTE[i] : SPECIES_OVERFLOW_COLOR
    })
    return map
  }, [filteredSpecies])

  const coloredSightings = useMemo(
    () => filteredSightings.map(s => ({ ...s, color: speciesColorMap[s.speciesKey] || SPECIES_OVERFLOW_COLOR })),
    [filteredSightings, speciesColorMap]
  )
  const coloredSpecies = useMemo(
    () => filteredSpecies.map(sp => ({ ...sp, color: speciesColorMap[sp.speciesKey] })),
    [filteredSpecies, speciesColorMap]
  )

  // Nearest sighting to the searched point — "could I see one from here?"
  const nearest = useMemo(() => {
    if (!location) return null
    let best = null
    for (const s of filteredSightings) {
      if (s.lat == null || s.lng == null) continue
      const dLat = (s.lat - location.lat) * Math.PI / 180
      const dLng = (s.lng - location.lng) * Math.PI / 180
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(location.lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
      const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      if (!best || km < best.km) best = { km, sighting: s }
    }
    return best
  }, [filteredSightings, location])
  const timeFilterActive = !!(timeRange.start || timeRange.end)

  // Effective displayed date range: explicit slider bounds, falling back to
  // the data's own min/max when only one end is set.
  const filteredRangeLabel = useMemo(() => {
    if (!timeFilterActive) return null
    const start = timeRange.start || sightings.reduce((m, s) => s.date && (!m || s.date < m) ? s.date : m, null)
    const end = timeRange.end || sightings.reduce((m, s) => s.date && (!m || s.date > m) ? s.date : m, null)
    return `${fmtDate(start)} – ${fmtDate(end)}`
  }, [timeFilterActive, timeRange, sightings])

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
            {config.localizable !== false && (
              <button className={styles.locateBtn} onClick={handleLocate}>
                <span>&#9678;</span> Use my location
              </button>
            )}
            {locError && (
              <div style={{ fontSize: 12, color: 'rgba(240,100,100,0.85)', maxWidth: 320, textAlign: 'center' }}>
                {locError}
              </div>
            )}
            {config.hotspots && config.hotspots.length > 0 && (
              <>
                {config.localizable !== false ? (
                  <div className={styles.locateDivider}>or jump to a hotspot</div>
                ) : (
                  <div className={styles.locateDivider}>explore a hotspot</div>
                )}
                <div className={styles.hotspotChips}>
                  {config.hotspots.map(hs => (
                    <button
                      key={hs.name}
                      className={styles.hotspotChip}
                      onClick={() => handleLocationSelect({ name: hs.name, lat: hs.lat, lng: hs.lng })}
                    >
                      {hs.emoji || '📍'} {hs.name}
                    </button>
                  ))}
                </div>
              </>
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
              {/^\d+ km from /.test(location?.name || '')
                ? <span>{location.name}</span>
                : <>Near <span>{location?.name || 'your location'}</span></>}
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

        {/* Stat tiles \u2014 the one place counts/window/provenance appear */}
        {!loadingData && (
          <div className={styles.statRow}>
            <div className={styles.statTile}>
              <div className={styles.statVal}>
                {(mode === 'patterns' ? totalCount : filteredCount).toLocaleString()}
              </div>
              <div className={styles.statLabel}>
                {fetching ? 'Updating\u2026'
                  : mode === 'patterns' ? 'Historical sightings'
                  : 'Sightings in view'}
              </div>
              <div className={styles.statSub}>
                {['iNaturalist', 'eBird', 'GBIF']
                  .map(src => ({ src, n: filteredSightings.filter(s => s.source === src).length }))
                  .filter(({ n }) => n > 0)
                  .map(({ src, n }, i) => (
                    <span key={src}>
                      {i > 0 && ' \u00b7 '}
                      <a href={SOURCE_URLS[src]} target="_blank" rel="noopener">{src === 'iNaturalist' ? 'iNat' : src}</a> {n.toLocaleString()}
                    </span>
                  ))}
              </div>
            </div>

            <div className={styles.statTile}>
              <div className={styles.statVal}>{filteredSpecies.length}</div>
              <div className={styles.statLabel}>Species observed</div>
              <div className={styles.statSub}>
                {filteredSpecies.slice(0, 2).map(sp => sp.common).join(' \u00b7 ') || '\u2014'}
              </div>
            </div>

            <div className={styles.statTile}>
              <div className={`${styles.statVal} ${styles.statValSm}`}>
                {mode === 'patterns'
                  ? MONTH_NAMES[displayedMonth]
                  : timeFilterActive ? filteredRangeLabel : `Past ${config.defaults.days} days`}
              </div>
              <div className={styles.statLabel}>Date range</div>
              <div className={styles.statSub}>
                {mode === 'patterns' ? 'All years combined' : (location?.name || '\u2014')}
              </div>
            </div>

            {mode === 'now' && nearest && (
              <div className={styles.statTile}>
                <div className={styles.statVal}>
                  {nearest.km < 1 ? '< 1 km' : `${Math.round(nearest.km)} km`}
                </div>
                <div className={styles.statLabel}>Nearest sighting</div>
                <div className={styles.statSub}>
                  {`${relDay(nearest.sighting.date)} \u00b7 `}<a href={SOURCE_URLS[nearest.sighting.source]} target="_blank" rel="noopener">{nearest.sighting.source}</a>
                </div>
              </div>
            )}

          </div>
        )}

        {tooManyResults && !loadingData && (
          <div style={{ padding: '12px 20px', background: 'rgba(212,160,23,0.1)', border: '1px solid rgba(212,160,23,0.25)', borderRadius: 10, fontSize: 13, color: '#b8842a', marginBottom: 8 }}>
            Showing {filteredCount.toLocaleString()} of {totalCount.toLocaleString()} sightings — zoom in for a more detailed view.
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
              <ExploreMap
                sightings={coloredSightings}
                center={location}
                activeSpecies={activeSpecies}
                onCenterChange={handleMapCenterChange}
                patternsMonth={mode === 'patterns' ? displayedMonth + 1 : null}
                initialView={qp.z != null ? { zoom: qp.z } : null}
                config={{
                  fallbackColor: config.fallback.color,
                  fallbackEmoji: config.fallback.emoji,
                  defaultZoom: config.defaults.zoom,
                  gbifTaxonKey: config.gbifTaxonKey,
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

          {/* Species visible on the map */}
          <aside className={styles.speciesBox}>
            <div className={styles.speciesBoxHead}>
              Species on the map
              {filteredSpecies.length > 0 && (
                <span className={styles.speciesBoxCount}>{filteredSpecies.length}</span>
              )}
            </div>
            <div className={styles.speciesBoxList}>
              {loadingData && filteredSpecies.length === 0 ? (
                [0, 1, 2].map(i => (
                  <div key={i} className={styles.shimmerCard} style={{ animationDelay: `${i * 0.12}s` }} />
                ))
              ) : filteredSpecies.length === 0 ? (
                <div className={styles.speciesBoxEmpty}>No sightings in this view</div>
              ) : (
                coloredSpecies.map((sp, i) => (
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
          </aside>

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
