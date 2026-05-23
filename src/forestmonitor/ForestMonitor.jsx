import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import styles from './ForestMonitor.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// Default to the existing SJC-bounded endpoint until the global function is
// deployed (blocked on billing quota). Swap to the global URL by setting
// VITE_FOREST_TILES_API_BASE in .env.local / Vercel.
const TILES_API_BASE = import.meta.env.VITE_FOREST_TILES_API_BASE
  || 'https://us-west1-salish-sea-property-mapper.cloudfunctions.net/opera-dist-alert'

const MODES = [
  { id: 'recency',  label: 'Recency',  blurb: 'Brighter = more recent disturbance.' },
  { id: 'status',   label: 'Status',   blurb: 'Provisional vs. confirmed; first vs. ongoing.' },
  { id: 'severity', label: 'Severity', blurb: 'Percent vegetation loss in the disturbed pixel.' },
]

// Legend gradients mirror the cloud function's palettes (RECENCY_VIS,
// STATUS_VIS, SEVERITY_VIS in main.py).
const RECENCY_GRADIENT = 'linear-gradient(to right, #450a0a, #7f1d1d, #b91c1c, #dc2626, #ef4444, #fb923c, #fbbf24)'
const SEVERITY_GRADIENT = 'linear-gradient(to right, #fef3c7, #fde68a, #fbbf24, #fb923c, #ef4444, #b91c1c)'

const STATUS_SWATCHES = [
  { color: '#fde68a', label: 'Provisional (first)' },
  { color: '#fcd34d', label: 'Provisional (recurrent)' },
  { color: '#f59e0b', label: 'Confirmed' },
  { color: '#fb923c', label: 'Provisional · high loss (first)' },
  { color: '#ef4444', label: 'Provisional · high loss (recurrent)' },
  { color: '#b91c1c', label: 'Confirmed · high loss' },
  { color: '#92400e', label: 'Finished provisional' },
  { color: '#450a0a', label: 'Finished confirmed' },
]

// OPERA DIST-ALERT publishes from late 2022 onward; we treat 2023-01-01 as the
// usable floor (matches DATE_MIN=730 in the cloud function).
const DAY_MS = 86_400_000
const DATA_START_MS = Date.UTC(2023, 0, 1)
const todayUtcMs = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const fmtMonthDay = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// Curated basemap options. Picked specifically for alert-color readability:
// the dark/light/gray options eliminate the satellite-vs-recency color
// conflict that hits in arid regions (Sahara, Outback, the desert SW).
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite',  style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark',      label: 'Dark',       style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light',     label: 'Light',      style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'outdoors',  label: 'Terrain',    style: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'streets',   label: 'Streets',    style: 'mapbox://styles/mapbox/streets-v12' },
]
const DEFAULT_BASEMAP_ID = 'satellite'
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// Slider quick-pick presets. `days: null` means "all available data".
const RANGE_PRESETS = [
  { label: '24h',   days: 1 },
  { label: 'Week',  days: 7 },
  { label: 'Month', days: 30 },
  { label: 'Year',  days: 365 },
  { label: 'All',   days: null },
]

// Land-use filter chips. `id: 'all'` is the unfiltered default; the cloud
// function maps the rest to WorldCover class groups (see LANDUSE_FILTERS in
// main.py). Newer-data tiered version is a planned follow-up.
const LANDUSE_PRESETS = [
  { id: 'all',       label: 'All' },
  { id: 'forest',    label: 'Forest' },
  { id: 'cropland',  label: 'Cropland' },
  { id: 'grassland', label: 'Grassland' },
  { id: 'built',     label: 'Built' },
]

export default function ForestMonitor() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const lastTileUrlReqRef = useRef(0)

  const [mode, setMode] = useState('recency')
  const [tileLoading, setTileLoading] = useState(true)
  const [tileError, setTileError] = useState(null)
  // Flips true on `map.on('load')`. Gates tile-source adds so we don't race
  // the style finishing — addLayer() before the style is ready silently no-ops.
  const [mapReady, setMapReady] = useState(false)
  // [startMs, endMs] in UTC epoch ms. Default = full available window.
  const [dateRange, setDateRange] = useState(() => [DATA_START_MS, todayUtcMs()])
  // WorldCover-derived land use filter. 'all' = no filter applied.
  const [landuse, setLanduse] = useState('all')
  // Methodology modal — opened from a button rendered inside popups, so we
  // catch clicks via document-level delegation (popups are setHTML strings,
  // can't directly attach React handlers).
  const [showMethodology, setShowMethodology] = useState(false)
  // Selected basemap id (see BASEMAPS above). Default = satellite.
  const [basemap, setBasemap] = useState(DEFAULT_BASEMAP_ID)
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  // Opacity of the OPERA disturbance raster overlay (0–1). Default 0.85.
  const [opacity, setOpacity] = useState(0.85)
  // Ref-mirror so applyTileLayer reads the latest value without re-running
  // the tile-fetch effect on opacity changes.
  const opacityRef = useRef(0.85)
  useEffect(() => { opacityRef.current = opacity }, [opacity])
  // Most-recent OPERA tile URL — cached so we can immediately re-apply it
  // after a basemap switch without round-tripping the cloud function again.
  const lastTileUrlRef = useRef(null)

  // ─── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(DEFAULT_BASEMAP_ID),
      center: [0, 20],
      zoom: 1.6,
      projection: 'mercator',
      attributionControl: false,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Mapbox occasionally instantiates before the container has its final
    // bounding rect (depending on fonts/CSS load order), which leaves it stuck
    // with zero internal viewport — no tile requests ever fire. A ResizeObserver
    // on the container forces a recompute as soon as a real size lands.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    const markReady = () => setMapReady(true)
    if (map.isStyleLoaded()) markReady()
    else map.on('style.load', markReady)

    // Crosshair signals "pick a point to inspect" — clearer than Mapbox's
    // default grab hand. Mapbox momentarily flips to a closed-fist grabbing
    // cursor on active drag (via inline style), so panning still has feedback.
    const setCrosshair = () => { map.getCanvas().style.cursor = 'crosshair' }
    if (map.getCanvas()) setCrosshair()
    map.on('load', setCrosshair)
    map.on('mouseup', setCrosshair)

    // Mapbox 3.x sometimes leaves its render loop idle after init: the style
    // loads, but no tile request ever fires until the camera moves. A tiny
    // round-trip pan after mount is enough to start the loop in most browsers.
    const kick = () => {
      try {
        map.panBy([1, 0], { duration: 0 })
        map.panBy([-1, 0], { duration: 0 })
      } catch {}
    }
    const kickRAF = requestAnimationFrame(kick)
    const kickT1 = setTimeout(kick, 100)
    const kickT2 = setTimeout(kick, 500)
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
        showUserLocation: false,
      }),
      'top-right'
    )

    mapRef.current = map
    return () => {
      cancelAnimationFrame(kickRAF)
      clearTimeout(kickT1)
      clearTimeout(kickT2)
      ro.disconnect()
      if (popupRef.current) popupRef.current.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // ─── Fetch tile URL whenever mode or date range changes ──────────────────
  // Debounced 250 ms so dragging the slider doesn't hammer the cloud function.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    let cancelled = false
    const reqId = ++lastTileUrlReqRef.current
    setTileLoading(true)
    setTileError(null)

    const [startMs, endMs] = dateRange
    const params = new URLSearchParams({
      mode,
      start: isoDay(startMs),
      end: isoDay(endMs),
    })
    if (landuse && landuse !== 'all') params.set('landuse', landuse)

    const t = setTimeout(() => {
      fetch(`${TILES_API_BASE}?${params}`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (cancelled || reqId !== lastTileUrlReqRef.current) return
          if (!data.tileUrl) throw new Error('Empty tileUrl in response')
          applyTileLayer(map, data.tileUrl, opacityRef.current)
          lastTileUrlRef.current = data.tileUrl
          setTileLoading(false)
        })
        .catch((err) => {
          if (cancelled) return
          console.error('[ForestMonitor] tile URL fetch failed', err)
          setTileError(err.message || 'Failed to load disturbance tiles')
          setTileLoading(false)
        })
    }, 250)

    return () => { cancelled = true; clearTimeout(t) }
  }, [mode, mapReady, dateRange, landuse])

  // ─── Click → fetch point sample, draw popup + patch outline ───────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handler = (e) => {
      const { lng, lat } = e.lngLat

      if (popupRef.current) popupRef.current.remove()
      removePatchOutline(map)

      const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '280px', offset: 12 })
        .setLngLat([lng, lat])
        .setHTML(`<div class="${styles.popupLoading}">Looking up disturbance…</div>`)
        .addTo(map)
      popupRef.current = popup
      popup.on('close', () => removePatchOutline(map))

      // Progressive rendering: fire all five lookups in parallel and repaint
      // the popup whenever any of them resolves. Cloud-function endpoints
      // are split — `core` returns date/status/severity/landCover in ~1 s,
      // `extras` returns patch geometry + MODIS burn in ~2-3 s.
      const state = {
        point:   { status: 'pending', data: null, error: null },
        extras:  { status: 'pending', data: null },
        admin:   { status: 'pending', value: null },
        protectedAreas:  { status: 'pending', value: [] },
        naturalFeatures: { status: 'pending', value: [] },
      }
      const myPopup = popup
      const stillCurrent = () => popupRef.current === myPopup

      const render = () => {
        if (!stillCurrent()) return

        const pois = []
        const seen = new Set()
        for (const name of [...state.protectedAreas.value, ...state.naturalFeatures.value]) {
          const k = name.toLowerCase()
          if (!seen.has(k)) { seen.add(k); pois.push(name) }
          if (pois.length >= 3) break
        }

        if (state.point.status === 'rejected') {
          myPopup.setHTML(`<div class="${styles.popupError}">Couldn't load disturbance info for that spot.</div>`)
          return
        }

        if (state.point.status === 'pending') {
          myPopup.setHTML(renderLoadingPopupHTML(pois, state.admin.value))
          return
        }

        const data = state.point.data
        if (!data.date) {
          // Use extras' namedFires if they've arrived (US clicks always get them)
          const extrasNamedFires = state.extras.status === 'fulfilled'
            ? (state.extras.data?.namedFires || [])
            : []
          myPopup.setHTML(renderEmptyPopupHTML(pois, state.admin.value, data.landCover, extrasNamedFires))
          return
        }

        // Merge in extras (patch outline + MODIS burn + acres) once they
        // arrive. While extras are still pending, the popup renders the
        // core info with a small "loading extras…" footer.
        const extras = state.extras.status === 'fulfilled' ? state.extras.data : null
        const merged = { ...data, ...(extras || {}) }
        if (extras && extras.patchGeometry) addPatchOutline(map, extras.patchGeometry)
        myPopup.setHTML(renderPopupHTML(merged, pois, state.admin.value, state.extras.status === 'pending'))
      }

      // Each lookup updates its slice of state and rerenders independently.
      fetch(`${TILES_API_BASE}?lat=${lat}&lng=${lng}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          state.point = { status: 'fulfilled', data, error: null }
          render()
        })
        .catch((err) => {
          console.error('[ForestMonitor] point lookup failed', err)
          state.point = { status: 'rejected', data: null, error: err }
          render()
        })

      fetch(`${TILES_API_BASE}?lat=${lat}&lng=${lng}&extras=1`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          state.extras = { status: 'fulfilled', data }
          render()
        })
        .catch((err) => {
          console.warn('[ForestMonitor] extras lookup failed', err)
          state.extras = { status: 'fulfilled', data: null }
          render()
        })

      reverseGeocode(lat, lng)
        .then((v) => { state.admin = { status: 'fulfilled', value: v }; render() })
        .catch(() => { state.admin = { status: 'fulfilled', value: null }; render() })

      findProtectedAreas(lat, lng)
        .then((v) => { state.protectedAreas = { status: 'fulfilled', value: v || [] }; render() })
        .catch(() => { state.protectedAreas = { status: 'fulfilled', value: [] }; render() })

      findNaturalFeatures(lat, lng)
        .then((v) => { state.naturalFeatures = { status: 'fulfilled', value: v || [] }; render() })
        .catch(() => { state.naturalFeatures = { status: 'fulfilled', value: [] }; render() })
    }

    map.on('click', handler)
    return () => map.off('click', handler)
  }, [])

  // ─── Basemap change ──────────────────────────────────────────────────────
  // setStyle() blows away all custom sources/layers (OPERA raster + any
  // patch outline), so we listen for the new style's `style.load` and
  // re-apply the cached tile URL immediately. The first render is skipped —
  // the map was already initialized with the chosen style.
  const basemapMountRef = useRef(true)
  useEffect(() => {
    if (basemapMountRef.current) { basemapMountRef.current = false; return }
    const map = mapRef.current
    if (!map) return

    map.once('style.load', () => {
      // Re-apply the most recent OPERA tile URL — skips a GEE roundtrip,
      // makes basemap switching feel instant.
      if (lastTileUrlRef.current) {
        applyTileLayer(map, lastTileUrlRef.current, opacityRef.current)
      }
      // Patch outline is per-popup; it'll redraw on next click.
    })
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap])

  // ─── OPERA layer opacity (live update via setPaintProperty) ─────────────
  // Avoids re-adding the layer on every opacity change — much smoother than
  // tearing it down. Layer might not exist yet if tiles haven't loaded; the
  // try/catch covers that.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    try {
      if (map.getLayer(RASTER_LAYER_ID)) {
        map.setPaintProperty(RASTER_LAYER_ID, 'raster-opacity', opacity)
      }
    } catch {}
  }, [opacity, mapReady])

  // ─── Basemap menu: close on outside click / Esc ──────────────────────────
  useEffect(() => {
    if (!basemapMenuOpen) return
    const onClick = (e) => {
      if (!basemapMenuRef.current?.contains(e.target)) setBasemapMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [basemapMenuOpen])

  // ─── Methodology modal click delegation ──────────────────────────────────
  // Popup HTML is plain strings, so we can't attach React onClick. Instead
  // intercept any click on an element with data-action="show-methodology".
  useEffect(() => {
    const docHandler = (e) => {
      if (e.target.closest('[data-action="show-methodology"]')) {
        e.preventDefault()
        setShowMethodology(true)
      }
    }
    document.addEventListener('click', docHandler)
    return () => document.removeEventListener('click', docHandler)
  }, [])

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.mapWrap} />

      <a href="/" className={styles.branding}>
        <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        <span className={styles.subBadge}>Forest Monitor</span>
      </a>

      <SearchBox map={mapRef.current} />

      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button
          type="button"
          className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)}
          aria-label="Change basemap"
          aria-expanded={basemapMenuOpen}
          title={`Basemap: ${BASEMAPS.find((b) => b.id === basemap)?.label || ''}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel} role="menu">
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => {
              const active = basemap === b.id
              return (
                <button
                  key={b.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={active ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                  onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}
                >
                  <span className={`${styles.basemapSwatch} ${styles[`basemapSwatch_${b.id}`]}`} />
                  <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={styles.basemapMenuCheck}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className={styles.modePanel}>
        {MODES.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? styles.modeBtnActive : styles.modeBtn}
            onClick={() => setMode(m.id)}
            title={m.blurb}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className={styles.legend}>
        <div className={styles.legendTitle}>
          {mode === 'recency' && 'Forest disturbance recency'}
          {mode === 'status' && 'Alert status'}
          {mode === 'severity' && 'Vegetation loss'}
        </div>

        <div className={styles.opacityControl}>
          <div className={styles.opacityHeader}>
            <span className={styles.opacityLabel}>Layer opacity</span>
            <span className={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            className={styles.opacitySlider}
            aria-label="Disturbance layer opacity"
          />
        </div>

        <RangePresets dateRange={dateRange} onPick={setDateRange} />

        <DateRangeSlider
          minMs={DATA_START_MS}
          maxMs={todayUtcMs()}
          startMs={dateRange[0]}
          endMs={dateRange[1]}
          onChange={(s, e) => setDateRange([s, e])}
        />

        <div className={styles.filterSection}>
          <div className={styles.filterLabel}>Land use</div>
          <div className={styles.presets}>
            {LANDUSE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={landuse === p.id ? styles.presetBtnActive : styles.presetBtn}
                onClick={() => setLanduse(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {mode === 'recency' && (
          <>
            <div className={styles.legendGradient} style={{ background: RECENCY_GRADIENT }} />
            <div className={styles.legendScale}>
              <span>Jan 2023</span>
              <span>Today</span>
            </div>
            <div className={styles.legendBlurb}>
              <strong>Dark red</strong> = oldest disturbance, <strong>bright yellow</strong> = most recent. The slider above limits which pixels are shown but doesn't change the colors. Source: NASA OPERA L3 DIST-ALERT, 30 m.
            </div>
          </>
        )}
        {mode === 'severity' && (
          <>
            <div className={styles.legendGradient} style={{ background: SEVERITY_GRADIENT }} />
            <div className={styles.legendScale}>
              <span>0%</span>
              <span>100%</span>
            </div>
            <div className={styles.legendBlurb}>
              Percent of the pixel's vegetation that's been lost.
            </div>
          </>
        )}
        {mode === 'status' && (
          <>
            <ul className={styles.legendList}>
              {STATUS_SWATCHES.map((s) => (
                <li key={s.label}>
                  <span className={styles.swatch} style={{ background: s.color }} />
                  {s.label}
                </li>
              ))}
            </ul>
            <div className={styles.legendBlurb}>
              Provisional = single-detection; confirmed = multi-detection.
            </div>
          </>
        )}
      </div>

      {tileLoading && <div className={styles.statusBadge}>Loading tiles…</div>}
      {tileError && (
        <div className={styles.errorBadge}>
          Tile load failed: {tileError}
        </div>
      )}

      <div className={styles.tip}>Click anywhere on a colored pixel for details.</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

// ─── Methodology modal ─────────────────────────────────────────────────────
function MethodologyModal({ onClose }) {
  // Esc to close
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        <h2 className={styles.modalTitle}>How this is sourced</h2>

        <section className={styles.modalSection}>
          <h3>What you're looking at</h3>
          <p>
            Colored pixels are forest-disturbance alerts from <strong>NASA OPERA L3 DIST-ALERT</strong> (Vegetation Disturbance Alert),
            derived from harmonized Landsat-8 and Sentinel-2 imagery at 30 m resolution. New alerts typically appear within ~5 days
            of the most recent satellite pass. Color encodes <em>recency</em> (default), <em>status</em>, or <em>severity</em>;
            switch modes at the top of the screen. The date slider in the legend masks which alerts are shown but does not change colors.
          </p>
          <p>
            The <strong>Land use filter chips</strong> in the legend (Forest / Cropland / Grassland / Built) run the same tiered land-cover
            classifier described below, server-side: pixels that don't match the chosen category are masked out before the tiles render.
            The result is the highest-resolution available source per region — CDL crop classes in the US, MapBiomas in Brazil, Dynamic
            World everywhere else, with WorldCover catching gaps.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>When you click a pixel</h3>
          <p>
            We fire multiple parallel lookups in two phases so the popup tells you not just <em>that</em> something happened,
            but plausibly <em>why</em>. The fast core arrives in ~2 s; the slower cause-inference signals stream in 1–2 s after that.
          </p>
          <p><strong>Core (fast, ~2 s):</strong></p>
          <ol>
            <li><strong>OPERA point sample</strong> — date, status code, severity %.</li>
            <li><strong>Reverse geocode (Mapbox v6)</strong> — town, county/district, state/region, country.</li>
            <li><strong>Protected areas (Mapbox Tilequery)</strong> — named national parks, forests, wilderness, monuments.</li>
            <li><strong>Natural features (Google Geocoding)</strong> — mountain ranges, named regions, watersheds where they exist.</li>
            <li>
              <strong>Land-cover (tiered)</strong> — most-specific available source: USDA CDL (US) → MapBiomas (Brazil) →
              Dynamic World (global, near-real-time) → ESA WorldCover (global fallback).
            </li>
          </ol>
          <p><strong>Extras (slower, ~1–2 s):</strong></p>
          <ol start={6}>
            <li><strong>Connected-component patch outline</strong> — vectorized 5 km around the click. Acres come from the polygon area, not a pixel-count cap.</li>
            <li><strong>MODIS burned-area check (MCD64A1)</strong> — 500 m monthly. Detects burns within ±90 days of the OPERA date.</li>
            <li><strong>Active-fire detections (NASA FIRMS)</strong> — counts hot-spots within 3 km of the click and ±60 days of the OPERA date. Higher resolution and sensitivity than the burned-area product; catches small or short-lived fires.</li>
            <li><strong>Sentinel-2 NBR delta (dNBR)</strong> — Normalized Burn Ratio before vs after the OPERA date, sampled at 20 m. A dNBR above ~0.27 typically indicates a moderate-to-high severity burn (USGS classification).</li>
            <li><strong>Patch shape analysis</strong> — compactness and aspect ratio of the polygon. Blocky shapes suggest human cuts; irregular shapes suggest natural events.</li>
            <li>
              <strong>Named US fires (MTBS + NIFC)</strong> — for clicks inside the United States, we check whether the point falls inside a known historical (MTBS, ≤3 yr lookback) or current (NIFC WFIGS, ≤1.5 yr lookback) fire perimeter. Filtered so the fire's ignition date must precede the OPERA detection — cause must precede effect. When a match exists, the fire's name, ignition date, acres, and (for active fires) containment status appear at the top of the popup with an InciWeb link.
            </li>
          </ol>
        </section>

        <section className={styles.modalSection}>
          <h3>How "Likely cause" is decided</h3>
          <p>
            The colored card in the popup is a simple weighted scoring rule, not a trained classifier. We tally signals into
            four bins — <em>fire</em>, <em>human activity</em>, <em>natural</em>, <em>agricultural context</em> — and pick the
            label that wins. The reasoning line under the label shows you exactly which signals fired.
          </p>
          <p>Roughly:</p>
          <ul>
            <li><strong>Fire</strong> wins when MODIS burned-area, VIIRS/MODIS active fires, or a substantial dNBR (&gt;0.27) line up near the OPERA date.</li>
            <li><strong>Mechanical / agricultural clearing</strong> wins when the patch is blocky or linear AND no fire signal is present. The "agricultural" qualifier appears when the land-cover label is a crop or pasture class.</li>
            <li><strong>Natural</strong> wins when the patch is highly irregular AND no fire or human-shape signals are present.</li>
            <li><strong>Inconclusive</strong> when signals are absent or contradictory — we'd rather say nothing than misattribute.</li>
          </ul>
          <p>
            <strong>Crop-aware refinements (US, CDL pixels):</strong> When the click lands on a known crop, we look up the crop's
            management profile and seasonal harvest window before assigning a label.
          </p>
          <ul>
            <li><strong>Multi-cut forages</strong> (alfalfa, hay, clover, sod, switchgrass) get cut 2–5× per season. A dNBR spike during their cutting window is almost always a routine hay cut, not a burn — these crops are very rarely burned. The label says "Likely alfalfa harvest cut" instead of "Possible agricultural burn".</li>
            <li><strong>Burn-managed crops</strong> (sugarcane, rice, cotton) routinely use pre- or post-harvest field burning. The fire signal is interpreted as a managed burn rather than a wildfire here.</li>
            <li><strong>Annual harvest crops</strong> (corn, soybeans, wheat, etc.) produce dNBR spikes at harvest. In-season harvest reads as harvest; out-of-season fire signal is more suspicious.</li>
            <li><strong>Orchards</strong> (apples, citrus, almonds, grapes) don't disturb the canopy during routine harvest — a blocky dNBR signal usually means tree removal or replanting.</li>
            <li><strong>USDA NASS Census of Agriculture</strong> tillage data, when available, softens burn-related labels in counties where no-till management is dominant (residue burning is incompatible with no-till).</li>
          </ul>
          <p>
            The thresholds are heuristic. False positives and false negatives are expected, especially in mixed-use landscapes
            (e.g. fire-managed cropland) or in areas where one of the underlying datasets is sparse. The reasoning line is
            there so you can sanity-check each call.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Datasets</h3>
          <dl className={styles.datasetList}>
            <dt>NASA OPERA L3 DIST-ALERT HLS V1</dt>
            <dd>
              30 m, near-real-time, global · NASA via GLAD's GEE mirror <code>projects/glad/HLSDIST/current</code>.{' '}
              <a href="https://www.earthdata.nasa.gov/data/catalog/lpcloud-opera-l3-dist-alert-hls-v1-1" target="_blank" rel="noopener noreferrer">Catalog</a>{' · '}
              <a href="https://glad.umd.edu/dataset/glad-forest-alerts" target="_blank" rel="noopener noreferrer">GLAD mirror</a>
            </dd>

            <dt>USDA Cropland Data Layer (CDL)</dt>
            <dd>
              30 m, annual, US only · USDA NASS, latest year used: 2024 · Used for both popup labels (specific crop species)
              and as the highest-priority tier in the land-use filter classifier.{' '}
              <a href="https://nassgeodata.gmu.edu/CropScape/" target="_blank" rel="noopener noreferrer">CropScape</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/USDA_NASS_CDL" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>MapBiomas Brazil — Collection 9</dt>
            <dd>
              30 m, annual, Brazil · Latest year: 2023. Detailed national LULC including pasture, soybean, sugarcane, mining ·
              Used for popup labels and as the second tier in the land-use filter classifier.{' '}
              <a href="https://brasil.mapbiomas.org/en/" target="_blank" rel="noopener noreferrer">MapBiomas</a>
            </dd>

            <dt>Google Dynamic World V1</dt>
            <dd>
              10 m, near-real-time, global · Per-Sentinel-2-scene classifications. We sample the mode label over the most recent 90 days ·
              Used for popup labels and as the third tier in the filter classifier (the global near-real-time backstop).{' '}
              <a href="https://dynamicworld.app/" target="_blank" rel="noopener noreferrer">Dynamic World</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>ESA WorldCover 2021 (v200)</dt>
            <dd>
              10 m, single 2021 snapshot, global · Bottom-tier fallback for both popup labels and the land-use filter classifier —
              used wherever CDL, MapBiomas, and Dynamic World all have no data.{' '}
              <a href="https://esa-worldcover.org/" target="_blank" rel="noopener noreferrer">esa-worldcover.org</a>
            </dd>

            <dt>MODIS MCD64A1 Burned Area (Collection 6.1)</dt>
            <dd>
              500 m, monthly, global · NASA / Univ. of Maryland. We check ±90 days around the OPERA detection date.{' '}
              <a href="https://lpdaac.usgs.gov/products/mcd64a1v061/" target="_blank" rel="noopener noreferrer">LP DAAC</a>
            </dd>

            <dt>NASA FIRMS Active Fires</dt>
            <dd>
              MODIS + VIIRS hot-spot detections, daily, near-real-time, global · Used as a complementary fire signal to
              MCD64A1: counts detections within a 3 km buffer / ±60 days of the OPERA date.{' '}
              <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener noreferrer">FIRMS</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/FIRMS" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>Copernicus Sentinel-2 L2A (Harmonized)</dt>
            <dd>
              10–20 m, ~5-day revisit, global · Used to compute dNBR (Normalized Burn Ratio delta) — median NBR over the
              60–240 days before the OPERA date vs the 0–60 days after, sampled at the click point. Quantifies burn severity
              from spectral change even when active-fire products miss the event.{' '}
              <a href="https://sentiwiki.copernicus.eu/web/sentinel-2" target="_blank" rel="noopener noreferrer">Sentinel-2 SentiWiki</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>Patch shape analysis (derived)</dt>
            <dd>
              Pure-Python geometry stats over the OPERA-derived polygon — area, perimeter, compactness (4πA/P²), aspect
              ratio of the bounding box. Drives the "blocky / linear / irregular" hint that feeds the cause inference.
              No external dataset; the polygon comes from <code>ee.Image.reduceToVectors</code> on the OPERA disturbance mask.
            </dd>

            <dt>Crop management profiles (derived from CDL + agronomic references)</dt>
            <dd>
              Per-crop lookup table mapping each USDA CDL crop class to a management profile
              (multi-cut forage / burn-prone / annual harvest / orchard / fallow), a typical
              harvest month window, and a residue-burning practice rating (rare / occasional /
              common). Used to refine the cause label for US cropland clicks — e.g. alfalfa
              cuts vs sugarcane burns vs corn harvest. Northern-hemisphere windows are shifted
              ~6 months for southern-latitude clicks. Profile assignments are based on USDA
              crop-calendar references and standard regional agronomic practice; expect to
              tune over time.
            </dd>

            <dt>USDA NASS Quick Stats — Census of Agriculture (optional)</dt>
            <dd>
              County-level tillage practice data (conventional / conservation / reduced / no-till
              share by acreage) from the most recent Census of Ag (typically 2022). Used as a
              tiebreaker for ambiguous "burn vs harvest" calls — a no-till-dominant county is
              very unlikely to be producing residue-burn signals. Activated when{' '}
              <code>NASS_API_KEY</code> is set on the cloud function; degrades gracefully
              (cause label still works, just without county-level refinement) when absent.{' '}
              <a href="https://quickstats.nass.usda.gov/api" target="_blank" rel="noopener noreferrer">Quick Stats API</a>
            </dd>

            <dt>MTBS — Monitoring Trends in Burn Severity (US)</dt>
            <dd>
              Authoritative US named-fire perimeters since 1984 (fires ≥1000 acres in the West, ≥500 acres in the East).
              Each fire has name, ignition date, acres, severity classification. ~1–2 year lag in latest available year.{' '}
              <a href="https://www.mtbs.gov/" target="_blank" rel="noopener noreferrer">mtbs.gov</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/USFS_GTAC_MTBS_burned_area_boundaries_v1" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>NIFC WFIGS — Wildland Fire Interagency Geospatial Services (US)</dt>
            <dd>
              Current US fire perimeters, updated daily during fire season. Each fire has name, IRWIN ID, acres,
              containment %, cause, location. Used at click-time via ArcGIS REST.{' '}
              <a href="https://data-nifc.opendata.arcgis.com/" target="_blank" rel="noopener noreferrer">data-nifc.opendata.arcgis.com</a>
            </dd>

            <dt>Mapbox Geocoding API v6</dt>
            <dd>
              Admin region hierarchy (place, district, region, country) for the click point.{' '}
              <a href="https://docs.mapbox.com/api/search/geocoding/" target="_blank" rel="noopener noreferrer">Docs</a>
            </dd>

            <dt>Mapbox Tilequery against mapbox-streets-v8</dt>
            <dd>
              Names of protected areas (parks, forests, wilderness, monuments) within 500 m of the click.{' '}
              <a href="https://docs.mapbox.com/api/maps/tilequery/" target="_blank" rel="noopener noreferrer">Docs</a>
            </dd>

            <dt>Google Geocoding API</dt>
            <dd>
              Named natural features (mountain ranges, large regions) at the click point — filtered to <code>result_type=natural_feature</code>.{' '}
              <a href="https://developers.google.com/maps/documentation/geocoding/overview" target="_blank" rel="noopener noreferrer">Docs</a>
            </dd>
          </dl>
        </section>

        <section className={styles.modalSection}>
          <h3>Limitations we want you to know about</h3>
          <ul>
            <li><strong>OPERA detects vegetation loss, not deforestation.</strong> Harvested cropland, prescribed burns, storm blowdown, mining, urban clearing all look similar in the OPERA signal. The "Likely cause" line tries to disambiguate, but the underlying land-cover and fire context are the most reliable inputs.</li>
            <li><strong>"Likely cause" is a heuristic, not a model.</strong> The label comes from a simple rule that weighs fire and shape signals against land-cover context. Expect occasional misses — particularly on small patches, in landscapes with ambiguous land use (e.g. fire-managed cropland), or when supporting data (Sentinel-2, MODIS, FIRMS) has gaps for the relevant window. The reasoning line under the label exposes the inputs so you can sanity-check.</li>
            <li><strong>Named-fire context is US-only.</strong> MTBS and NIFC cover the United States; international clicks won't get the fire-name treatment. Global named-fire coverage (e.g. GlobFire, EFFIS for Europe) is a planned follow-up.</li>
            <li><strong>dNBR can be missing.</strong> If Sentinel-2 imagery in the pre- or post-window is too cloudy (or too sparse, especially in winter at high latitudes), the dNBR sample comes back null and the heuristic falls back on other signals.</li>
            <li><strong>Patch shape uses raster-derived polygons.</strong> Every polygon edge is on the 30 m pixel grid, so we can't directly measure "straightness" of perimeter the way you'd want for a vector field boundary. The shape hint relies on compactness and aspect ratio, which still discriminate blocky vs irregular reliably for patches above ~10 acres.</li>
            <li><strong>Filter accuracy varies by region.</strong> The tiered classifier is most precise where CDL (US, 2024) or MapBiomas (Brazil, 2023) cover the click point. Elsewhere it falls back to Dynamic World (mode of recent ~90 days, global) and finally to WorldCover (2021). Deep-international clicks may misclassify land that was converted from forest after 2021 if Dynamic World hasn't caught up either.</li>
            <li><strong>Orchards and tree crops classify as Cropland, not Forest.</strong> Cherries, almonds, apples, citrus groves are tree-covered but managed agriculture. CDL's specific orchard codes (66–77, plus most 200-series) are mapped to Cropland in our filter — so a "Forest" filter won't show them.</li>
            <li><strong>MODIS burned area is 500 m.</strong> Much coarser than 30 m OPERA. A pixel-perfect OPERA click can fall just outside the MODIS-detected burn boundary even when fire clearly drove the disturbance. FIRMS active fires (375 m–1 km) help, but a strong fire signal sometimes only shows up in dNBR.</li>
            <li><strong>"Nearest place" in remote forest can be misleading.</strong> Mapbox returns the closest containing or nearest settlement — sometimes 50+ km away in the Amazon or Congo. We always include the larger admin region as a more honest anchor.</li>
            <li><strong>Patch size measured within a 5 km search radius.</strong> The acres number comes from polygon area, not pixel counts — so it's accurate for any patch that fits within 5 km of the click point (about 19,000 acres of search area). Megafires or very large clearcuts that extend beyond that radius are flagged "extends beyond 5 km search radius" in the popup; the reported area is the in-radius portion only.</li>
            <li><strong>Provisional vs Confirmed.</strong> A provisional OPERA alert is a single satellite-pass detection; confirmed requires multiple. Provisional alerts will sometimes be revoked when more data comes in. "Finished" variants of either are real alerts whose current change activity has stopped.</li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>About this tool</h3>
          <p>
            Built by <a href="https://earthatlas.org" target="_blank" rel="noopener noreferrer">EarthAtlas</a> as an open
            exploration of near-real-time forest disturbance. The cloud function source and all dataset choices live in this repo and are reviewable.
            Please cite the underlying datasets (above) if you reproduce or publish from this data — we're a thin presentation layer over their work.
          </p>
        </section>

        <button type="button" className={styles.modalCloseBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

// ─── Search box (Mapbox Search Box API) ────────────────────────────────────
// Autocomplete over addresses, places, POIs (incl. national parks / protected
// areas), neighborhoods, regions, countries. On select → flyTo on the map.

// Zoom level per Mapbox feature type. Smaller value = wider view.
const SEARCH_ZOOM_BY_TYPE = {
  country:      4,
  region:       6,
  district:     8,
  postcode:    11,
  place:       10,
  locality:    12,
  neighborhood: 14,
  street:      15,
  address:     16,
  poi:         13,
}

// Human-readable category label for each Mapbox feature_type, shown inline
// in the result meta line so users know what kind of thing they're picking.
const SEARCH_TYPE_LABELS = {
  country:      'Country',
  region:       'State / Region',
  district:     'District / County',
  postcode:     'ZIP / Postcode',
  place:        'City',
  locality:     'Town',
  neighborhood: 'Neighborhood',
  street:       'Street',
  address:      'Address',
  poi:          'Place',
}

// Categorize each result into a small icon set. POIs further split by
// poi_category (parks → nature glyph; rest → pin glyph).
function searchCategoryOf(s) {
  const t = s.feature_type
  if (t === 'poi') {
    const cats = (s.poi_category || []).map((c) => c.toLowerCase())
    if (cats.some((c) => /park|forest|nature|reserve|wilderness|garden|mountain|peak|trail/.test(c))) {
      return 'nature'
    }
    return 'poi'
  }
  if (t === 'country' || t === 'region' || t === 'district' || t === 'postcode') return 'region'
  if (t === 'place' || t === 'locality' || t === 'neighborhood') return 'city'
  if (t === 'address' || t === 'street') return 'address'
  return 'pin'
}

// SVG glyphs per category — small, theme-appropriate, no emoji.
const SEARCH_ICON_PATHS = {
  nature: 'M12 2C8.13 2 5 5.13 5 9c0 5 7 13 7 13s7-8 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z M12 14l-2 3h4l-2-3z',
  poi:    'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  region: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
  city:   'M15 11V5l-3-3-3 3v2H3v14h18V11h-6zm-8 8H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2zm6 8h-2v-2h2v2zm0-4h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2zm6 12h-2v-2h2v2zm0-4h-2v-2h2v2z',
  address:'M12 2c-4.2 0-8 3.22-8 8.2 0 3.32 2.67 7.25 8 11.8 5.33-4.55 8-8.48 8-11.8C20 5.22 16.2 2 12 2zm0 10c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
  pin:    'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
}

// Wrap matching substrings of `query` inside `text` with a <mark> tag so we
// can style them. Case-insensitive substring match — Mapbox's matches are
// fuzzy so this won't always cover everything, but it covers the common case.
function highlightMatch(text, query) {
  if (!text || !query) return escapeHTML(text || '')
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return escapeHTML(text)
  return (
    escapeHTML(text.slice(0, idx)) +
    '<mark>' + escapeHTML(text.slice(idx, idx + query.length)) + '</mark>' +
    escapeHTML(text.slice(idx + query.length))
  )
}

function SearchBox({ map }) {
  const [query, setQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const sessionTokenRef = useRef(null)
  const debounceRef = useRef(null)
  const inputRef = useRef(null)
  const containerRef = useRef(null)

  // Lazy-init session token. Mapbox Search Box groups suggest+retrieve calls
  // under one session token for billing; reset after each retrieve.
  if (sessionTokenRef.current == null) {
    sessionTokenRef.current = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random())
  }

  // Debounced suggest. Bias results toward what's currently on screen via
  // the `proximity` param — searching "Springfield" from a Brazil viewport
  // surfaces nearby places before US matches.
  useEffect(() => {
    clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) {
      setSuggestions([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      const token = import.meta.env.VITE_MAPBOX_TOKEN
      if (!token) { setLoading(false); return }
      const params = new URLSearchParams({
        q,
        access_token: token,
        session_token: sessionTokenRef.current,
        limit: '8',
        types: 'country,region,district,postcode,place,locality,neighborhood,street,address,poi',
      })
      // Proximity bias from current map center
      if (map) {
        try {
          const c = map.getCenter()
          params.set('proximity', `${c.lng},${c.lat}`)
        } catch {}
      }
      try {
        const res = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${params}`)
        const data = await res.json()
        setSuggestions(data.suggestions || [])
        setOpen(true)
        setActiveIdx(-1)
      } catch (err) {
        console.error('[SearchBox] suggest failed', err)
        setSuggestions([])
      } finally {
        setLoading(false)
      }
    }, 220)
    return () => clearTimeout(debounceRef.current)
  }, [query, map])

  // Close on click outside
  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = async (suggestion) => {
    if (!map) return
    const token = import.meta.env.VITE_MAPBOX_TOKEN
    const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}` +
      `?access_token=${token}&session_token=${sessionTokenRef.current}`
    try {
      const res = await fetch(url)
      const data = await res.json()
      const feature = data.features?.[0]
      if (!feature) return
      const [lng, lat] = feature.geometry.coordinates
      const zoom = SEARCH_ZOOM_BY_TYPE[suggestion.feature_type] ?? 10

      // Use bbox if Mapbox provided one — better than centroid + zoom guess
      // for things like national parks or large regions.
      const bbox = feature.properties?.bbox
      if (bbox && bbox.length === 4) {
        map.fitBounds(
          [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
          { padding: 80, duration: 1400, maxZoom: 14 }
        )
      } else {
        map.flyTo({ center: [lng, lat], zoom, duration: 1400, essential: true })
      }

      setQuery(suggestion.name)
      setOpen(false)
      setSuggestions([])
      // New session token — Mapbox docs: one session per "search transaction"
      sessionTokenRef.current = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random())
      inputRef.current?.blur()
    } catch (err) {
      console.error('[SearchBox] retrieve failed', err)
    }
  }

  const handleKeyDown = (e) => {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const idx = activeIdx >= 0 ? activeIdx : 0
      if (suggestions[idx]) handleSelect(suggestions[idx])
    } else if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
    }
  }

  return (
    <div className={styles.searchBox} ref={containerRef}>
      <div className={styles.searchInputWrap}>
        <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          // Non-standard name so Chrome's autofill heuristics don't latch
          // onto this as an address/email/name field and paint it tinted.
          name="fm-search-q"
          className={styles.searchInput}
          // Inline style wins over any UA / global / extension CSS that
          // might paint the input white on load. Belt-and-braces — the CSS
          // module class also sets these, but inline guarantees it applies
          // before any cascade games or autofill tinting kick in.
          style={{
            backgroundColor: '#0f1726',
            color: '#fff',
            WebkitTextFillColor: '#fff',
          }}
          placeholder="Search a place, address, park, or feature…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        {query && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => { setQuery(''); setSuggestions([]); setOpen(false); inputRef.current?.focus() }}
            aria-label="Clear"
          >×</button>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <ul className={styles.searchResults} role="listbox">
          {suggestions.map((s, i) => {
            const cat = searchCategoryOf(s)
            const typeLabel = s.feature_type === 'poi' && s.poi_category?.length
              ? toTitleCase(s.poi_category[0])
              : SEARCH_TYPE_LABELS[s.feature_type] || 'Place'
            return (
              <li
                key={s.mapbox_id}
                role="option"
                aria-selected={i === activeIdx}
                className={i === activeIdx ? styles.searchResultActive : styles.searchResult}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s) }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                <div className={`${styles.searchResultIcon} ${styles[`searchIcon_${cat}`]}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d={SEARCH_ICON_PATHS[cat]} />
                  </svg>
                </div>
                <div className={styles.searchResultText}>
                  <div
                    className={styles.searchResultName}
                    dangerouslySetInnerHTML={{ __html: highlightMatch(s.name, query) }}
                  />
                  <div className={styles.searchResultMeta}>
                    <span className={styles.searchResultType}>{typeLabel}</span>
                    {searchResultMeta(s) && (
                      <>
                        <span className={styles.searchResultSep}>·</span>
                        <span className={styles.searchResultContext}>{searchResultMeta(s)}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {open && loading && suggestions.length === 0 && (
        <div className={styles.searchEmpty}>
          <span className={styles.searchSpinner}></span> Searching…
        </div>
      )}
      {open && !loading && query.trim().length >= 2 && suggestions.length === 0 && (
        <div className={styles.searchEmpty}>No results found</div>
      )}
    </div>
  )
}

function searchResultMeta(s) {
  // Geographic context only (e.g. "California, United States") — feature
  // type is already shown separately as a badge.
  return s.place_formatted || s.full_address || ''
}

function toTitleCase(s) {
  return String(s).replace(/(^|[\s_-])(\w)/g, (_, sep, c) => sep + c.toUpperCase())
}

// ─── Range presets ──────────────────────────────────────────────────────────
// Quick-pick buttons that set the slider to a relative window ending today.
// The active preset is highlighted when the current range exactly matches.

function rangeForPreset(days) {
  const end = todayUtcMs()
  const start = days == null ? DATA_START_MS : end - days * DAY_MS
  return [Math.max(start, DATA_START_MS), end]
}

function RangePresets({ dateRange, onPick }) {
  const [curStart, curEnd] = dateRange
  return (
    <div className={styles.presets}>
      {RANGE_PRESETS.map((p) => {
        const [pStart, pEnd] = rangeForPreset(p.days)
        const active = pStart === curStart && pEnd === curEnd
        return (
          <button
            key={p.label}
            type="button"
            className={active ? styles.presetBtnActive : styles.presetBtn}
            onClick={() => onPick([pStart, pEnd])}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Date range slider ──────────────────────────────────────────────────────
// Two-handle range over [minMs, maxMs] in UTC epoch ms, snapping to whole days.
// Live-updates on drag (parent debounces the tile refetch).

function DateRangeSlider({ minMs, maxMs, startMs, endMs, onChange }) {
  const trackRef = useRef(null)

  const valueToPct = (ms) =>
    Math.max(0, Math.min(100, ((ms - minMs) / (maxMs - minMs)) * 100))

  const clientToMs = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const ms = minMs + ratio * (maxMs - minMs)
    return Math.round(ms / DAY_MS) * DAY_MS
  }

  const dragHandler = (which) => (e) => {
    e.preventDefault()
    const move = (mv) => {
      const ms = clientToMs(mv.clientX)
      if (which === 'start') onChange(Math.min(ms, endMs - DAY_MS), endMs)
      else onChange(startMs, Math.max(ms, startMs + DAY_MS))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={styles.sliderWrap}>
      <div className={styles.sliderTrack} ref={trackRef}>
        <div
          className={styles.sliderActive}
          style={{
            left: `${valueToPct(startMs)}%`,
            right: `${100 - valueToPct(endMs)}%`,
          }}
        />
        <button
          type="button"
          aria-label={`Start date: ${fmtMonthDay(startMs)}`}
          className={styles.sliderHandle}
          style={{ left: `${valueToPct(startMs)}%` }}
          onPointerDown={dragHandler('start')}
        />
        <button
          type="button"
          aria-label={`End date: ${fmtMonthDay(endMs)}`}
          className={styles.sliderHandle}
          style={{ left: `${valueToPct(endMs)}%` }}
          onPointerDown={dragHandler('end')}
        />
      </div>
      <div className={styles.sliderLabels}>
        <span>{fmtMonthDay(startMs)}</span>
        <span>{fmtMonthDay(endMs)}</span>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RASTER_SOURCE_ID = 'opera-dist-alert'
const RASTER_LAYER_ID = 'opera-dist-alert-layer'

function applyTileLayer(map, tileUrl, opacity = 0.85) {
  // Replacing the source's tiles requires removing and re-adding it in
  // Mapbox GL — there's no setTiles() method.
  if (map.getLayer(RASTER_LAYER_ID)) map.removeLayer(RASTER_LAYER_ID)
  if (map.getSource(RASTER_SOURCE_ID)) map.removeSource(RASTER_SOURCE_ID)
  map.addSource(RASTER_SOURCE_ID, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    attribution: 'NASA OPERA L3 DIST-ALERT · GLAD',
  })
  map.addLayer({
    id: RASTER_LAYER_ID,
    type: 'raster',
    source: RASTER_SOURCE_ID,
    paint: { 'raster-opacity': opacity },
  })
}

const PATCH_SOURCE_ID = 'opera-patch'
const PATCH_FILL_ID = 'opera-patch-fill'
const PATCH_LINE_ID = 'opera-patch-line'

function addPatchOutline(map, geometry) {
  removePatchOutline(map)
  map.addSource(PATCH_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'Feature', geometry, properties: {} },
  })
  map.addLayer({
    id: PATCH_FILL_ID,
    type: 'fill',
    source: PATCH_SOURCE_ID,
    paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.18 },
  })
  map.addLayer({
    id: PATCH_LINE_ID,
    type: 'line',
    source: PATCH_SOURCE_ID,
    paint: { 'line-color': '#fbbf24', 'line-width': 2 },
  })
}

function removePatchOutline(map) {
  if (map.getLayer(PATCH_LINE_ID)) map.removeLayer(PATCH_LINE_ID)
  if (map.getLayer(PATCH_FILL_ID)) map.removeLayer(PATCH_FILL_ID)
  if (map.getSource(PATCH_SOURCE_ID)) map.removeSource(PATCH_SOURCE_ID)
}

function renderLocationLines(pois, admin) {
  const lines = []
  if (pois && pois.length) {
    lines.push(`<div class="${styles.popupPoi}">${escapeHTML(pois.join(' · '))}</div>`)
  }
  if (admin) {
    lines.push(`<div class="${styles.popupLocation}">${escapeHTML(admin)}</div>`)
  }
  return lines.join('')
}

// Words that signal the disturbance is agricultural rather than deforestation.
// Hits across CDL crop names (Corn, Cotton, Soybeans, etc.), Dynamic World
// "Crops", WorldCover "Cropland", MapBiomas crop-specific classes.
const AG_KEYWORDS = /^(crops?|cropland|farming|agriculture|sugar|soybean|cotton|corn|wheat|rice|sorghum|barley|oats|millet|rye|canola|alfalfa|fallow|hay|sunflower|peanuts|tobacco|sugarcane|coffee|citrus|pasture|temporary crop|perennial crop|other (small grains|temporary crops|hay|tree crops|crops|perennial crops|small grains))|^(blueberries|cherries|peaches|apples|grapes|pistachios|triticale|carrots|asparagus|garlic|cantaloupes|prunes|olives|oranges|broccoli|avocados|peppers|pomegranates|nectarines|plums|strawberries|squash|apricots|vetch|lettuce|pumpkins|cabbage|cauliflower|celery|radishes|turnips|eggplants|gourds|cranberries|tomatoes|onions|cucumbers|chick peas|lentils|peas|caneberries|hops|herbs|clover\/wildflowers|sod\/grass seed|switchgrass|sugarbeets|dry beans|potatoes|sweet potatoes|misc vegs & fruits|watermelons|honeydew melons|greens|christmas trees|pecans|almonds|walnuts|pears|aquaculture|mint|sweet corn|pop or orn corn|camelina|buckwheat|speltz|flaxseed|safflower|rape seed|mustard|dbl crop .+)/i

function renderLandCover(lc) {
  if (!lc) return ''
  const isAg = AG_KEYWORDS.test(lc.label)
  const cls = isAg ? styles.popupLandCoverCropland : styles.popupLandCover
  const hint = isAg ? ' — likely agricultural, not deforestation' : ''
  const yearStr = lc.year ? ` ${lc.year}` : ''
  const sourceStr = lc.source ? ` <span class="${styles.popupLandCoverSource}">${escapeHTML(lc.source)}${yearStr}</span>` : ''
  return `<div class="${cls}">${escapeHTML(lc.label)}${hint}${sourceStr}</div>`
}

function renderNamedFires(fires, operaDateStr) {
  if (!fires || fires.length === 0) return ''

  // First fire shows full detail (most recent — likely most relevant to
  // current OPERA detection). Remaining fires render as a compact list
  // under the heading "Other historic fires at this location."
  const [first, ...rest] = fires
  const dateLabel = first.date
    ? new Date(first.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : (first.year ? String(first.year) : null)
  const acres = first.acres != null ? `${Math.round(Number(first.acres)).toLocaleString()} acres` : null
  const contained = first.contained_pct != null ? `${Math.round(first.contained_pct)}% contained` : null
  const parts = [dateLabel, acres, contained, first.incident_type, first.source]
    .filter(Boolean).map(escapeHTML).join(' · ')
  const link = first.inciweb_url
    ? `<a href="${escapeHTML(first.inciweb_url)}" target="_blank" rel="noopener noreferrer" class="${styles.popupFireLink}">InciWeb ↗</a>`
    : ''
  let delta = ''
  if (operaDateStr && first.date) {
    const days = Math.round((new Date(operaDateStr) - new Date(first.date)) / 86_400_000)
    if (days >= 0) {
      const yrs = days >= 365 ? `${(days / 365).toFixed(1)} yr` : `${days} day${days === 1 ? '' : 's'}`
      delta = `<div class="${styles.popupFireDelta}">${yrs} before OPERA detection</div>`
    }
  }
  const firstBlock = `
    <div class="${styles.popupFireItem}">
      <div class="${styles.popupFireName}">🔥 ${escapeHTML(first.name)}</div>
      <div class="${styles.popupFireMeta}">${parts}</div>
      ${delta}
      ${link}
    </div>
  `

  let historyBlock = ''
  if (rest.length > 0) {
    const rows = rest.map((f) => {
      const yr = f.year || (f.date ? new Date(f.date).getFullYear() : '—')
      const ac = f.acres != null ? `${Math.round(Number(f.acres)).toLocaleString()} ac` : ''
      return `
        <li class="${styles.popupFireHistRow}">
          <span class="${styles.popupFireHistYear}">${escapeHTML(String(yr))}</span>
          <span class="${styles.popupFireHistName}">${escapeHTML(f.name)}</span>
          <span class="${styles.popupFireHistAcres}">${escapeHTML(ac)}</span>
        </li>
      `
    }).join('')
    historyBlock = `
      <div class="${styles.popupFireHistTitle}">
        Other historic fires at this location (${rest.length})
      </div>
      <ul class="${styles.popupFireHistList}">${rows}</ul>
    `
  }

  return `<div class="${styles.popupNamedFires}">${firstBlock}${historyBlock}</div>`
}

function renderBurn(burn, operaDateStr) {
  if (!burn || !burn.date) return ''
  const burnDate = new Date(burn.date)
  const prettyBurn = burnDate.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  // If we have the OPERA date, show the delta — "12 days before" reads as a
  // strong cause-effect signal; "45 days after" is weaker but still useful.
  let delta = ''
  if (operaDateStr) {
    const opDate = new Date(operaDateStr)
    const diffDays = Math.round((burnDate - opDate) / 86_400_000)
    if (diffDays < 0) delta = ` (${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} before)`
    else if (diffDays > 0) delta = ` (${diffDays} day${diffDays === 1 ? '' : 's'} after)`
    else delta = ' (same day)'
  }
  return `<div class="${styles.popupBurn}">Fire detected ${prettyBurn}${delta} <span class="${styles.popupLandCoverSource}">MODIS MCD64A1</span></div>`
}

function renderLikelyCause(cause) {
  if (!cause || !cause.label) return ''
  // Color by cause family for at-a-glance scanning. Inconclusive stays neutral.
  // Crop-aware additions: "harvest" / "cut" / "replanting" / "orchard
  // management" all read as routine agricultural activity (human, amber).
  // A standalone "Possible fire" still wins fire-red even if it mentions
  // a crop name, because "fire" appears in the label.
  const label = cause.label.toLowerCase()
  let cls = styles.popupCauseNeutral
  if (label.includes('fire') || label.includes('burn')) cls = styles.popupCauseFire
  else if (
    label.includes('harvest') ||
    label.includes(' cut') ||
    label.includes('replanting') ||
    label.includes('removal') ||
    label.includes('management') ||
    label.includes('clearing') ||
    label.includes('agricultural activity') ||
    label.includes('field activity') ||
    label.includes('field operations') ||
    label.includes('orchard') ||
    label.includes('fallow')
  ) cls = styles.popupCauseHuman
  else if (label.includes('natural')) cls = styles.popupCauseNatural
  const reasoning = cause.reasoning
    ? `<div class="${styles.popupCauseReason}">${escapeHTML(cause.reasoning)}</div>`
    : ''
  return `
    <div class="${cls}">
      <div class="${styles.popupCauseLabel}">${escapeHTML(cause.label)}</div>
      ${reasoning}
    </div>
  `
}

function renderPopupHTML(data, pois, admin, extrasPending = false) {
  const prettyDate = data.date
    ? new Date(data.date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null
  const severityStr = data.severity != null ? `${Math.round(data.severity)}% loss` : null

  // Patch size + burn live in the "extras" payload — render them as soon as
  // they arrive, otherwise show a small placeholder.
  let patchLine = ''
  if (data.acres != null) {
    const acresStr = data.acres >= 0.01
      ? `${data.acres.toFixed(2)} acre${Math.abs(data.acres - 1) < 0.005 ? '' : 's'}`
      : '< 0.01 acres'
    // `truncated` now means the patch extends beyond our 5 km search radius,
    // not that the count maxed out at 228 acres. Wording reflects that.
    const truncatedNote = data.truncated
      ? '<span class="' + styles.truncatedNote + '">(extends beyond 5 km search radius)</span>'
      : ''
    patchLine = `<div class="${styles.popupMuted}">${acresStr} in this connected patch ${truncatedNote}</div>`
  } else if (extrasPending) {
    patchLine = `<div class="${styles.popupMuted}"><span class="${styles.popupSpinner}"></span> Asking NASA, USDA, and a few satellites about this spot…</div>`
  }

  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupHeader}">Disturbance detected ${prettyDate}</div>
      ${renderLocationLines(pois, admin)}
      ${renderLandCover(data.landCover)}
      ${renderNamedFires(data.namedFires, data.date)}
      ${renderLikelyCause(data.likelyCause)}
      ${renderBurn(data.burn, data.date)}
      ${data.statusLabel ? `<div>${escapeHTML(data.statusLabel)}</div>` : ''}
      ${severityStr ? `<div>${severityStr}</div>` : ''}
      ${patchLine}
      ${renderMethodologyLink()}
    </div>
  `
}

function renderEmptyPopupHTML(pois, admin, landCover, namedFires) {
  const fireBlock = renderNamedFires(namedFires, null)
  const blurb = (namedFires && namedFires.length)
    ? `<div class="${styles.popupMuted}">OPERA isn't currently flagging change here, but this area is inside a known fire perimeter:</div>`
    : `<div class="${styles.popupMuted}">OPERA DIST-ALERT hasn't flagged this pixel since 2023.</div>`
  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupHeader}">No current disturbance here</div>
      ${renderLocationLines(pois, admin)}
      ${renderLandCover(landCover)}
      ${(namedFires && namedFires.length) ? blurb + fireBlock : blurb}
      ${renderMethodologyLink()}
    </div>
  `
}

// Interim state shown while we wait for the slow OPERA cloud-function call.
// Geocoders typically resolve first, so the location appears immediately and
// only the disturbance line stays in the "looking up" state.
function renderLoadingPopupHTML(pois, admin) {
  const hasLocation = (pois && pois.length) || admin
  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupLoadingHeader}">
        <span class="${styles.popupSpinner}"></span>Looking up disturbance…
      </div>
      ${hasLocation ? renderLocationLines(pois, admin) : ''}
      ${renderMethodologyLink()}
    </div>
  `
}

function renderMethodologyLink() {
  return `<button type="button" class="${styles.popupMethodology}" data-action="show-methodology">ⓘ How this is sourced</button>`
}

// Mapbox Geocoding v6 — hierarchical reverse lookup. Includes `district`
// (county-level in US, équivalents elsewhere) so popups get more local
// context than just "New York, United States". v6 always returns the
// nearest containing/closest feature at each level, so deep-forest clicks
// still get a region/country line; populated clicks add town + county.
async function reverseGeocode(lat, lng) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return null
  const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}` +
    `&types=country,region,district,place&access_token=${token}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const byType = {}
  for (const f of data.features || []) {
    const t = f.properties?.feature_type
    const name = f.properties?.name
    if (t && name && !byType[t]) byType[t] = name
  }
  const parts = ['place', 'district', 'region', 'country']
    .map((t) => byType[t])
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

// Google Geocoding API — pulls named "natural features" (mountain ranges,
// regions, watersheds) that Mapbox's tilesets generally don't have. We filter
// to result_type=natural_feature on the server side so the response stays
// small. Returns up to 2 unique names. Falls back to empty list silently.
async function findNaturalFeatures(lat, lng) {
  const key = import.meta.env.VITE_GOOGLE_GEOCODING_KEY
  if (!key) return []
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}` +
    `&result_type=natural_feature&key=${key}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.warn('[ForestMonitor] Google geocode status:', data.status, data.error_message)
    return []
  }
  const names = []
  for (const r of data.results || []) {
    // Each result's first address component is the feature's own name.
    const name = r.address_components?.[0]?.long_name
    if (name && !names.includes(name)) names.push(name)
    if (names.length >= 2) break
  }
  return names
}

// Mapbox Tilequery against streets-v8 — finds named protected areas (national
// parks, forests, wilderness, monuments — all class=national_park) at a point.
// Returns up to 2 unique names ordered as Mapbox stores them in the tileset.
async function findProtectedAreas(lat, lng) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return []
  const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
    `?radius=500&limit=10&layers=landuse_overlay&access_token=${token}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  const names = []
  for (const f of data.features || []) {
    const p = f.properties || {}
    if (p.class === 'national_park' && p.name && !names.includes(p.name)) {
      names.push(p.name)
      if (names.length >= 2) break
    }
  }
  return names
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}
