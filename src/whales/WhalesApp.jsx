/**
 * WhalesApp — main page component for earthatlas.org/whales
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

import { useState, useEffect, useCallback, useMemo } from 'react'
import styles from './WhalesApp.module.css'

import WhaleMap from './components/WhaleMap'
import SpeciesCard from './components/SpeciesCard'
import SeasonChart from './components/SeasonChart'
import LocationSearch from './components/LocationSearch'
import TimeSlider from './components/TimeSlider'

import {
  fetchRecentSightings,
  fetchMonthSightings,
  fetchSeasonalPattern,
  fetchHotlineSightings,
  fetchINatSightings,
  aggregateSpecies,
} from './services/whales'

// ─── Whale SVG silhouette ─────────────────────────────────────────────────────
// Simple sperm whale silhouette used as ambient background element
function WhaleSilhouette({ className }) {
  return (
    <svg className={className} viewBox="0 0 800 300" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M780 140 C760 80 680 50 580 55 C520 58 460 70 400 90 C340 110 280 140 220 155 C170 168 120 168 80 160 C50 154 20 140 0 125 L0 175 C20 165 50 158 80 160 C120 165 170 168 220 165 C280 160 340 145 400 130 C460 115 520 105 580 105 C680 100 755 130 775 180 C785 200 790 220 780 240 L800 240 L800 120 Z M760 180 C750 195 735 208 720 215 C700 223 675 220 655 210 L720 175 C735 168 752 168 760 180Z" />
    </svg>
  )
}

// ─── Helper: reverse-geocode lat/lng to a human-readable place name ───────────
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,region,locality&limit=1&access_token=${MAPBOX_TOKEN}`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.features?.[0]?.text || null
  } catch { return null }
}

// ─── Helper: format date ──────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  catch { return d }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function WhalesApp() {
  const [phase, setPhase] = useState('hero') // 'hero' | 'loading' | 'explore'
  const [mode, setMode] = useState('now')    // 'now' | 'patterns'

  const [location, setLocation] = useState(null)   // { lat, lng, name }
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
  const [activeMonth, setActiveMonth]   = useState(null)  // 0-based month index
  const [activeSpecies, setActiveSpecies] = useState(null) // speciesKey
  const [activeSighting, setActiveSighting] = useState(null)
  const [timeRange, setTimeRange]       = useState({ start: null, end: null }) // ISO date bounds, null = full extent

  // ─── Load data for a location ─────────────────────────────────────────────
  const loadData = useCallback(async (loc) => {
    setLoadingData(true)
    setDataError(null)
    setSightings([])
    setSpecies([])
    setTimeRange({ start: null, end: null })

    try {
      // Fetch recent sightings + seasonal pattern + iNaturalist in parallel
      const [recentResult, patternResult, hotlineResult, inatResult] = await Promise.allSettled([
        fetchRecentSightings({ lat: loc.lat, lng: loc.lng }),
        fetchSeasonalPattern({ lat: loc.lat, lng: loc.lng }),
        fetchHotlineSightings(),
        fetchINatSightings({ lat: loc.lat, lng: loc.lng }),
      ])

      const recentSightings = recentResult.status === 'fulfilled' ? recentResult.value.sightings : []
      const hotlineSightings = hotlineResult.status === 'fulfilled' ? hotlineResult.value : []
      const inatSightings = inatResult.status === 'fulfilled' ? inatResult.value : []
      const pattern = patternResult.status === 'fulfilled' ? patternResult.value : []

      // Merge sources (GBIF already filters out iNat-sourced records to avoid duplicates)
      const allSightings = [...recentSightings, ...hotlineSightings, ...inatSightings]
      const aggregated = aggregateSpecies(allSightings)

      setSightings(allSightings)
      setSpecies(aggregated)
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

  // ─── Handle month selection in patterns mode ──────────────────────────────
  const handleMonthChange = useCallback(async (monthIdx) => {
    setActiveMonth(monthIdx)
    if (mode !== 'patterns' || !location) return

    try {
      const result = await fetchMonthSightings({
        lat: location.lat,
        lng: location.lng,
        month: monthIdx + 1, // 1-based for API
      })
      setSightings(result.sightings)
      setSpecies(aggregateSpecies(result.sightings))
      setTotalCount(result.sightings.length)
    } catch { /* fail silently, keep existing sightings */ }
  }, [mode, location])

  // When mode switches to 'now', reload recent sightings
  useEffect(() => {
    if (mode === 'now' && location) loadData(location)
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
        setLocation(loc)
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
    setLocation(loc)
    setPhase('loading')
    await loadData(loc)
  }

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
      <div className={styles.whalesApp}>
        <nav className={styles.whalesNav}>
          <div className={styles.navLogo}>
            EarthAtlas <span className={styles.navLogoAccent}> / Whales</span>
          </div>
          <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
        </nav>

        <div className={styles.hero}>
          <div className={styles.heroGlow} />
          <div className={styles.whaleCanvas}>
            <WhaleSilhouette className={styles.whaleSvg} />
            <WhaleSilhouette className={styles.whaleSvgSmall} />
          </div>

          <div className={styles.heroContent}>
            <div className={styles.heroEyebrow}>EarthAtlas · Cetacean Sightings</div>
            <h1 className={styles.heroTitle}>
              Find <em>whales.</em><br />
              Near you. Whenever you go.
            </h1>
            <p className={styles.heroSub}>
              Discover which whales and dolphins have been seen near any coastline — and when you're most likely to see them.
            </p>

            <div className={styles.heroActions}>
              <button
                className={styles.locateBtn}
                onClick={handleLocate}
              >
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
        </div>
      </div>
    )
  }

  // ─── Render: Loading ──────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className={styles.whalesApp}>
        <nav className={styles.whalesNav}>
          <div className={styles.navLogo}>
            EarthAtlas <span className={styles.navLogoAccent}> / Whales</span>
          </div>
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '70vh', flexDirection: 'column', gap: 20 }}>
          <div className={styles.loadingWhale}>🐋</div>
          <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 22, fontWeight: 300, color: 'var(--text)' }}>
            Scanning the ocean near {location?.name || 'you'}…
          </div>
          <div style={{ fontSize: 13, color: '#5a6b7a', maxWidth: 320, textAlign: 'center' }}>
            Querying global biodiversity records and Pacific coast sighting networks
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: Explore ─────────────────────────────────────────────────────
  const displayedMonth = activeMonth !== null ? activeMonth : new Date().getMonth()

  return (
    <div className={styles.whalesApp}>
      <nav className={styles.whalesNav}>
        <div className={styles.navLogo}>
          EarthAtlas <span className={styles.navLogoAccent}> / Whales</span>
        </div>
        <a href="/" className={styles.navHomeLink}>← Back to EarthAtlas</a>
      </nav>

      <div className={styles.mainLayout}>
        {/* Topbar */}
        <div className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button className={styles.backBtn} onClick={() => setPhase('hero')}>← Change location</button>
            <div className={styles.locationLabel}>
              Near <span>{location?.name || 'your location'}</span>
            </div>
          </div>

          <div className={styles.topbarRight}>
            <div className={styles.modeBar}>
              <button
                className={`${styles.modeBtn} ${mode === 'now' ? styles.modeBtnActive : ''}`}
                onClick={() => setMode('now')}
              >
                Recent sightings
              </button>
              <button
                className={`${styles.modeBtn} ${mode === 'patterns' ? styles.modeBtnActive : ''}`}
                onClick={() => setMode('patterns')}
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
              ? `${filteredCount} cetacean sightings${timeRange.start || timeRange.end ? ` · ${fmtDate(timeRange.start || sightings.reduce((m, s) => s.date && (!m || s.date < m) ? s.date : m, null))} – ${fmtDate(timeRange.end || sightings.reduce((m, s) => s.date && (!m || s.date > m) ? s.date : m, null))}` : ' in the past 90 days'} · ${filteredSpecies.length} species`
              : `Showing historical sightings for ${['January','February','March','April','May','June','July','August','September','October','November','December'][displayedMonth]} across all years`
            }
          </div>
        )}

        {dataError && (
          <div style={{ padding: '12px 20px', background: 'rgba(220,80,80,0.1)', border: '1px solid rgba(220,80,80,0.25)', borderRadius: 10, fontSize: 13, color: '#e08080', marginBottom: 20 }}>
            {dataError}
          </div>
        )}

        {/* Content grid */}
        <div className={styles.contentGrid}>
          {/* Map */}
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
            <WhaleMap
              sightings={filteredSightings}
              center={location}
              activeSpecies={activeSpecies}
            />
            {mode === 'now' && !loadingData && sightings.length > 0 && (
              <TimeSlider
                sightings={sightings}
                value={timeRange}
                onChange={setTimeRange}
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
                <div className={styles.emptyStateWhale}>🐋</div>
                <div className={styles.emptyStateText}>No sightings found nearby</div>
                <div className={styles.emptyStateSub}>
                  Try switching to Seasonal patterns to see historical data,<br />
                  or search a different coastline.
                </div>
              </div>
            ) : (
              filteredSpecies.map((sp, i) => (
                <SpeciesCard
                  key={sp.speciesKey || sp.common}
                  species={sp}
                  totalCount={filteredCount}
                  active={activeSpecies === sp.speciesKey}
                  onClick={() => setActiveSpecies(sp.speciesKey === activeSpecies ? null : sp.speciesKey)}
                  style={{ animationDelay: `${i * 0.07}s` }}
                  styles={styles}
                />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className={styles.whalesFooter}>
          <div className={styles.footerText}>
            Sighting data from{' '}
            <a className={styles.footerLink} href="https://www.gbif.org" target="_blank" rel="noopener">GBIF</a>
            {' · '}
            <a className={styles.footerLink} href="https://www.inaturalist.org" target="_blank" rel="noopener">iNaturalist</a>
            {' · '}
            <a className={styles.footerLink} href="https://www.whalemuseum.org" target="_blank" rel="noopener">Whale Museum Hotline</a>
          </div>
          <div className={styles.footerText}>
            <a className={styles.footerLink} href="/">EarthAtlas.org</a>
          </div>
        </div>
      </div>
    </div>
  )
}
