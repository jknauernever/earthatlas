/**
 * SharksApp — main page component for earthatlas.org/sharks
 *
 * Phases:
 *   'hero'    — full-bleed entry screen, user has not yet chosen a location
 *   'loading' — location granted/entered, fetching initial data
 *   'explore' — main explore view with map, species cards, season chart
 *
 * Mode (within 'explore'):
 *   'now'      — recent sightings (past 90 days)
 *   'patterns' — historical monthly view, scrubbed by month
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQueryParams } from '../hooks/useQueryParams'
import { useSEO } from '../hooks/useSEO'
import styles from './SharksApp.module.css'

import SharkMap from './components/SharkMap'
import SpeciesCard from './components/SpeciesCard'
import SpeciesListItem from './components/SpeciesListItem'
import SeasonChart from './components/SeasonChart'
import LocationSearch from './components/LocationSearch'
import TimeSlider from './components/TimeSlider'

import {
  fetchRecentSightings,
  fetchMonthSightings,
  fetchSeasonalPattern,
  fetchINatSightings,
  aggregateSpecies,
} from './services/sharks'

// ─── Shark SVG silhouette ─────────────────────────────────────────────────────
function SharkSilhouette({ className }) {
  return (
    <svg className={className} viewBox="0 0 900 300" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M900 155 C870 90 780 60 660 65 C600 68 540 80 480 100 C410 122 360 145 300 160
               C240 172 180 170 130 158 C88 148 44 130 0 110 L0 168
               C44 152 88 145 130 150 C180 156 240 162 300 158
               C360 152 410 132 480 116 C540 102 600 92 660 92
               C780 88 865 120 882 175 C890 198 892 220 882 245
               L900 245 Z
               M840 178 C832 196 818 210 800 217 C778 225 752 222 730 210
               L800 172 C818 164 836 164 840 178 Z
               M480 65 C490 30 510 8 530 0 C520 18 515 40 518 65 Z" />
    </svg>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return d }
}

const QP_SCHEMA = {
  lat:     { type: 'number' },
  lng:     { type: 'number' },
  name:    { type: 'string' },
  mode:    { type: 'string', default: 'now' },
  month:   { type: 'number' },
  species: { type: 'string' },
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function SharksApp() {
  useSEO({
    title: 'Shark Sightings Near You',
    description: 'Discover which sharks have been sighted near any coastline — and when they\'re most likely to be there. Real-time data from GBIF and iNaturalist.',
    path: '/sharks',
    image: '/shark-hero.jpg',
  })

  const [qp, setQP] = useQueryParams(QP_SCHEMA)

  const hasUrlCoords = qp.lat != null && qp.lng != null
  const [phase, setPhase] = useState(hasUrlCoords ? 'loading' : 'hero')

  const mode = qp.mode
  const activeMonth = qp.month != null ? qp.month - 1 : null
  const activeSpecies = qp.species

  const [localLocation, setLocalLocation] = useState(null)
  const location = useMemo(() => {
    if (hasUrlCoords) return { lat: qp.lat, lng: qp.lng, name: qp.name || null }
    return localLocation
  }, [hasUrlCoords, qp.lat, qp.lng, qp.name, localLocation])

  const [locError, setLocError] = useState(null)
  const [sightings, setSightings]         = useState([])
  const [species, setSpecies]             = useState([])
  const [seasonPattern, setSeasonPattern] = useState([])
  const [baselinePattern, setBaselinePattern] = useState([])
  const [loadingData, setLoadingData]     = useState(false)
  const [dataError, setDataError]         = useState(null)
  const [totalCount, setTotalCount]       = useState(0)
  const [activeSighting, setActiveSighting] = useState(null)
  const [timeRange, setTimeRange]         = useState({ start: null, end: null })
  const [tooManyResults, setTooManyResults] = useState(false)
  const [openInfoKey, setOpenInfoKey] = useState(null)
  const MAX_SIGHTINGS = 500

  function zoomToRadius(z) {
    if (z == null) return 400
    return Math.round(400 * Math.pow(2, 6 - z))
  }
  const mapZoomRef = useRef(null)
  const abortRef = useRef(null)

  const loadData = useCallback(async (loc, radiusKm) => {
    // Cancel any in-flight requests
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    setLoadingData(true)
    setDataError(null)
    setSightings([])
    setSpecies([])
    setTimeRange({ start: null, end: null })

    try {
      const r = radiusKm || 400
      const [recentResult, patternResult, inatResult] = await Promise.allSettled([
        fetchRecentSightings({ lat: loc.lat, lng: loc.lng, radiusKm: r, signal }),
        fetchSeasonalPattern({ lat: loc.lat, lng: loc.lng, radiusKm: r, signal }),
        fetchINatSightings({ lat: loc.lat, lng: loc.lng, radiusKm: r, signal }),
      ])

      if (signal.aborted) return

      const recentSightings = recentResult.status === 'fulfilled' ? recentResult.value.sightings : []
      const inatSightings   = inatResult.status === 'fulfilled'   ? inatResult.value : []
      const pattern         = patternResult.status === 'fulfilled' ? patternResult.value : []
      const allSightings    = [...recentSightings, ...inatSightings]

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
  }, [])

  const coldLoaded = useRef(false)
  useEffect(() => {
    if (coldLoaded.current) return
    if (hasUrlCoords) {
      coldLoaded.current = true
      const loc = { lat: qp.lat, lng: qp.lng, name: qp.name || null }
      if (!qp.name) {
        reverseGeocode(qp.lat, qp.lng).then(name => { if (name) setQP({ name }) })
      }
      loadData(loc)
    }
  }, [hasUrlCoords, qp.lat, qp.lng, qp.name, loadData, setQP])

  const handleMonthChange = useCallback(async (monthIdx) => {
    setQP({ month: monthIdx + 1 })
    if (mode !== 'patterns' || !location) return
    try {
      const result = await fetchMonthSightings({
        lat: location.lat, lng: location.lng,
        month: monthIdx + 1,
        radiusKm: zoomToRadius(mapZoomRef.current),
      })
      setSightings(result.sightings)
      setSpecies(aggregateSpecies(result.sightings))
      setTotalCount(result.sightings.length)
    } catch { /* silent */ }
  }, [mode, location, setQP])

  // Only reload when mode *changes* (not on mount — coldLoaded handles that)
  const prevModeRef = useRef(mode)
  useEffect(() => {
    if (prevModeRef.current === mode) return
    prevModeRef.current = mode
    if (mode === 'now' && location) loadData(location, zoomToRadius(mapZoomRef.current))
  }, [mode, location, loadData])

  useEffect(() => {
    if (!location) return
    if (!activeSpecies) { setSeasonPattern(baselinePattern); return }
    let cancelled = false
    fetchSeasonalPattern({ lat: location.lat, lng: location.lng, speciesKey: Number(activeSpecies) })
      .then(pattern => { if (!cancelled) setSeasonPattern(pattern) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeSpecies, location, baselinePattern])

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
      () => { setLocError('Location access denied. Try searching for a place below.') },
      { timeout: 8000 }
    )
  }

  async function handleLocationSelect({ name, lat, lng }) {
    const loc = { lat, lng, name }
    setLocalLocation(loc)
    setQP({ lat, lng, name })
    setPhase('loading')
    await loadData(loc)
  }

  const handleMapCenterChange = useCallback(async ({ lat, lng, zoom }) => {
    mapZoomRef.current = zoom
    const name = await reverseGeocode(lat, lng) || 'this area'
    const loc = { lat, lng, name }
    setLocalLocation(loc)
    setQP({ lat, lng, name })
    loadData(loc, zoomToRadius(zoom))
  }, [loadData, setQP])

  const handleChangeLocation = useCallback(() => {
    setQP({ lat: null, lng: null, name: null, mode: 'now', month: null, species: null })
    setLocalLocation(null)
    setPhase('hero')
  }, [setQP])

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
  const filteredCount   = filteredSightings.length

  // ─── Hero ─────────────────────────────────────────────────────────────────
  if (phase === 'hero') {
    return (
      <div className={styles.heroPage}>
        <div className={styles.heroBgPhoto} />
        <div className={styles.heroOverlay} />
        <SharkSilhouette className={styles.sharkSvg} />
        <SharkSilhouette className={styles.sharkSvgSmall} />

        <nav className={styles.heroNav}>
          <a href="/sharks" className={styles.navWordmark}>
            <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent}>/ Sharks</span></span>
          </a>
          <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
        </nav>

        <div className={styles.heroContent}>
          <div className={styles.heroEyebrow}>EarthAtlas · Shark Sightings</div>
          <h1 className={styles.heroTitle}>
            Find <em>sharks.</em><br />
            Near you. Before you go.
          </h1>
          <p className={styles.heroSub}>
            Discover which sharks have been sighted near any coastline — and when they're most likely to be there.
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
            <LocationSearch onSelect={handleLocationSelect} styles={styles} />
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

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.sharksApp}>
        <header className={styles.sharksNavWrapper}>
          <nav className={styles.sharksNav}>
            <a href="/sharks" className={styles.navWordmark}>
              <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent}>/ Sharks</span></span>
            </a>
            <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
          </nav>
        </header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', flexDirection: 'column', gap: 20 }}>
          <div className={styles.loadingShark}>🦈</div>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 300, color: 'var(--text)' }}>
            Scanning the waters near {location?.name || 'you'}…
          </div>
          <div style={{ fontSize: 13, color: '#5a6b7a', maxWidth: 320, textAlign: 'center' }}>
            Querying global biodiversity records and citizen science sighting networks
          </div>
        </div>
      </div>
    )
  }

  // ─── Explore ──────────────────────────────────────────────────────────────
  const displayedMonth = activeMonth !== null ? activeMonth : new Date().getMonth()

  return (
    <div className={styles.sharksApp}>
      <header className={styles.sharksNavWrapper}>
        <nav className={styles.sharksNav}>
          <a href="/sharks" className={styles.navWordmark}>
            <span className={styles.navTitle}>Earth<em>Atlas</em> <span className={styles.navAccent}>/ Sharks</span></span>
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

        {/* Status strip */}
        {!loadingData && (
          <div className={styles.statusStrip}>
            <div className={`${styles.statusDot} ${mode === 'patterns' ? styles.statusDotAmber : ''}`} />
            {mode === 'now'
              ? `${filteredCount} shark sightings${timeRange.start || timeRange.end ? ` · ${fmtDate(timeRange.start || sightings.reduce((m, s) => s.date && (!m || s.date < m) ? s.date : m, null))} – ${fmtDate(timeRange.end || sightings.reduce((m, s) => s.date && (!m || s.date > m) ? s.date : m, null))}` : ' in the past 90 days'} · ${filteredSpecies.length} species`
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
          <div className={styles.mapBlock}>
            <div className={styles.mapWrap}>
              <div className={styles.mapOverlay}>
                <div className={styles.mapBadge}>
                  <div className={styles.mapBadgeDot} />
                  {mode === 'now' ? 'Past 90 days' : 'Historical'}
                </div>
                {!loadingData && (
                  <div className={styles.mapSightingCount}>
                    {filteredCount.toLocaleString()} sightings shown
                  </div>
                )}
              </div>
              <SharkMap
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
                styles={styles}
              />
            )}
          </div>

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
                <div className={styles.emptyStateShark}>🦈</div>
                <div className={styles.emptyStateText}>No sightings found nearby</div>
                <div className={styles.emptyStateSub}>
                  Try switching to Seasonal patterns to see historical data,<br />
                  or search a different coastline.
                </div>
              </div>
            ) : filteredSpecies.length > 10 ? (
              filteredSpecies.map((sp, i) => (
                <SpeciesListItem
                  key={sp.speciesKey || sp.common}
                  species={sp}
                  totalCount={filteredCount}
                  active={activeSpecies == sp.speciesKey}
                  onClick={() => setQP({ species: sp.speciesKey == activeSpecies ? null : sp.speciesKey })}
                  style={{ animationDelay: `${i * 0.03}s` }}
                  styles={styles}
                  openInfoKey={openInfoKey}
                  setOpenInfoKey={setOpenInfoKey}
                />
              ))
            ) : (
              filteredSpecies.map((sp, i) => (
                <SpeciesCard
                  key={sp.speciesKey || sp.common}
                  species={sp}
                  totalCount={filteredCount}
                  active={activeSpecies == sp.speciesKey}
                  onClick={() => setQP({ species: sp.speciesKey == activeSpecies ? null : sp.speciesKey })}
                  style={{ animationDelay: `${i * 0.07}s` }}
                  styles={styles}
                  openInfoKey={openInfoKey}
                  setOpenInfoKey={setOpenInfoKey}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <div className={styles.footerWave}>
        <svg viewBox="0 0 1440 32" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0 18 C200 32,400 4,600 18 C800 32,1000 4,1200 18 C1300 25,1380 12,1440 18 L1440 0 L0 0 Z" fill="#f2f4f7"/>
        </svg>
      </div>

      <footer className={styles.sharksFooter}>
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
