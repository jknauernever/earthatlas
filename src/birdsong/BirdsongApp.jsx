/**
 * EarthAtlas BirdsongApp — live bird-audio map at /birdsong.
 *
 * A native EarthAtlas tool over BirdWeather's *global* public network of PUC +
 * BirdNET-Pi acoustic stations. Pan the map and it shows the stations in view,
 * what's being heard there right now (with playable audio), and the most-heard
 * species over a chosen time window. Click any station for its detail — its top
 * species and recent calls — and pin one as "my station".
 *
 * Built in the EarthAtlas idiom (see docs/MAP_TOOL_CONVENTIONS.md): full-bleed
 * Mapbox, satellite default, dark-glass panels, shared GeoSearch + ZoomIndicator,
 * shareable URL state, the VITE_MAPBOX_TOKEN convention, CSS modules. Stateless —
 * no Supabase, no API key beyond Mapbox; data comes from the public BirdWeather
 * GraphQL endpoint via our cached edge proxy (/api/birdweather).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import {
  PERIOD_PRESETS,
  DEFAULT_PERIOD_ID,
  periodById,
  bboxFromMap,
  fetchStations,
  fetchStationSnapshot,
  fetchDetections,
  fetchTopSpecies,
  fetchCounts,
  fetchStation,
  relativeTime,
  confidenceLabel,
  compactNumber,
  stationTypeLabel,
} from './birdsongService.js'
import styles from './BirdsongApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const DEFAULT_VIEW = { center: [-98, 39.5], zoom: 3.2 }
const MY_STATION_KEY = 'earthatlas.birdsong.myStation'

const BASEMAPS = [
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[1]).style

const STATION_ACCENT = '#22d3ee' // cyan — stations
const HIGHLIGHT_ACCENT = '#fbbf24' // amber — selected / my station

// ─── Shareable URL state ────────────────────────────────────────────────────
// Round-trips the full view into the query string (required convention — see
// docs/MAP_TOOL_CONVENTIONS.md). Params (omitted at default to keep links clean):
//   t              time-window preset id (default '24h')
//   s              selected station id (opens its detail panel)
//   bm             basemap id (default 'satellite')
//   lat,lng,z      map camera
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    t: sp.get('t'),
    s: sp.get('s'),
    bm: sp.get('bm'),
    lat: num('lat'), lng: num('lng'), z: num('z'),
  }
}

function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

function loadMyStation() {
  try { return window.localStorage.getItem(MY_STATION_KEY) || null } catch { return null }
}

// Build the clustered GeoJSON source from station records. We carry only `id`
// (for selection) and `recency` (dot brightness, from time since last
// detection) per feature — everything else clusters. Handles both snapshot
// records (`last`) and live-fallback records (`latestDetectionAt`).
function buildStationsFC(arr) {
  const now = Date.now()
  const features = new Array(arr.length)
  for (let i = 0; i < arr.length; i++) {
    const s = arr[i]
    const last = s.last ?? s.latestDetectionAt
    const ageH = last ? (now - new Date(last).getTime()) / 3.6e6 : 1e9
    const recency = ageH < 1 ? 1 : ageH < 24 ? 0.75 : ageH < 24 * 7 ? 0.5 : 0.25
    features[i] = {
      type: 'Feature',
      properties: { id: String(s.id), recency },
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
    }
  }
  return { type: 'FeatureCollection', features }
}

// Count stations inside the map's current bounds (local filter over the full
// registry — sub-ms for ~22k points, no API call).
function countInView(map, arr) {
  if (!map || !arr.length) return 0
  try {
    const b = map.getBounds()
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth()
    let c = 0
    for (let i = 0; i < arr.length; i++) { const st = arr[i]; if (st.lng >= w && st.lng <= e && st.lat >= s && st.lat <= n) c++ }
    return c
  } catch { return 0 }
}

export default function BirdsongApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const audioRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  const initial = (typeof window !== 'undefined') ? readUrlState() : {}
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z }
    : null

  // ─── View / control state ──────────────────────────────────────────────────
  const [periodId, setPeriodId] = useState(() => (
    PERIOD_PRESETS.some((p) => p.id === initial.t) ? initial.t : DEFAULT_PERIOD_ID
  ))
  const period = useMemo(() => periodById(periodId), [periodId])
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [showMethodology, setShowMethodology] = useState(false)
  const [mapView, setMapView] = useState(initialCamera)
  const [viewport, setViewport] = useState(null) // {swlat,swlng,nelat,nelng}
  const suppressFlyRef = useRef(!!initialCamera)

  // ─── Data state ─────────────────────────────────────────────────────────────
  // Full global station registry (static weekly snapshot, ~22k) — loaded once
  // and clustered client-side, so the map shows the ENTIRE network with zero
  // per-pan load on BirdWeather (the Quakes "fetch once, filter locally" idiom).
  const allStationsRef = useRef([])
  const byIdRef = useRef(new Map())
  const snapshotFailedRef = useRef(false)
  const [snapshotReady, setSnapshotReady] = useState(false)
  const [stationsInView, setStationsInView] = useState(0)
  const [styleEpoch, setStyleEpoch] = useState(0) // bumps on every style.load (incl. basemap switch)
  // Live, viewport-scoped feeds (the genuinely fresh data).
  const [detections, setDetections] = useState([])
  const [topSpecies, setTopSpecies] = useState([])
  const [counts, setCounts] = useState(null) // { detections, species, stations } real totals
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // ─── Selection / personal station ───────────────────────────────────────────
  const [selectedId, setSelectedId] = useState(initial.s || null)
  const [selectedStation, setSelectedStation] = useState(null)
  const [selDetections, setSelDetections] = useState([])
  const [selTopSpecies, setSelTopSpecies] = useState([])
  const [selLoading, setSelLoading] = useState(false)
  const [myStationId, setMyStationId] = useState(() => (typeof window !== 'undefined' ? loadMyStation() : null))

  // ─── Audio playback ─────────────────────────────────────────────────────────
  const [playingId, setPlayingId] = useState(null)
  const togglePlay = useCallback((det) => {
    const a = audioRef.current
    if (!a || !det?.audioUrl) return
    if (playingId === det.id) { a.pause(); setPlayingId(null); return }
    a.src = det.audioUrl
    a.play().then(() => setPlayingId(det.id)).catch(() => setPlayingId(null))
  }, [playingId])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onEnd = () => setPlayingId(null)
    a.addEventListener('ended', onEnd)
    a.addEventListener('error', onEnd)
    return () => { a.removeEventListener('ended', onEnd); a.removeEventListener('error', onEnd) }
  }, [])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center,
      zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    const syncView = () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
      setViewport(bboxFromMap(map))
      setStationsInView(countInView(map, allStationsRef.current))
    }
    map.on('moveend', syncView)

    const addLayers = () => {
      if (!map.getSource('stations')) {
        // Clustered source over the FULL registry. clusterRadius below the
        // default (50) and a modest clusterMaxZoom mean dots break apart sooner
        // — per the "small dots, cluster less" preference.
        map.addSource('stations', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
          cluster: true,
          clusterRadius: 36,
          clusterMaxZoom: 9,
        })
        // Cluster bubbles — size & color step up with how many stations they hold.
        map.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'stations',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], '#0e7490', 50, '#0891b2', 250, '#06b6d4', 1000, '#22d3ee'],
            'circle-radius': ['step', ['get', 'point_count'], 11, 50, 15, 250, 20, 1000, 27],
            'circle-opacity': 0.82,
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(8,12,20,0.55)',
          },
        })
        map.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'stations',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
            'text-size': 11,
          },
          paint: { 'text-color': '#e0f7ff' },
        })
        // Individual stations — deliberately SMALL dots; brightness by recency.
        map.addLayer({
          id: 'stations-layer',
          type: 'circle',
          source: 'stations',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 3.2, 14, 5],
            'circle-color': STATION_ACCENT,
            'circle-opacity': ['interpolate', ['linear'], ['get', 'recency'], 0, 0.4, 1, 0.95],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(8,12,20,0.5)',
          },
        })
        for (const layer of ['clusters', 'stations-layer']) {
          map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
          map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
        }
        // Click a cluster → zoom in toward it so it breaks apart.
        map.on('click', 'clusters', (e) => {
          const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
          if (!f) return
          map.easeTo({ center: f.geometry.coordinates, zoom: Math.min(map.getZoom() + 2.5, 14), duration: 500 })
        })
        // Click an individual station → open its detail.
        map.on('click', 'stations-layer', (e) => {
          const f = e.features?.[0]
          if (f) setSelectedId(String(f.properties.id))
        })
      }
      if (!map.getSource('station-highlight')) {
        map.addSource('station-highlight', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: 'station-highlight-layer',
          type: 'circle',
          source: 'station-highlight',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 9, 7, 16, 12, 24],
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-width': 2.5,
            'circle-stroke-color': HIGHLIGHT_ACCENT,
          },
        })
      }
    }

    // style.load fires on the initial style AND after every basemap switch (which
    // drops & recreates sources), so re-add layers and bump styleEpoch to make
    // the data-populate effects re-run and refill the clustered source.
    map.on('style.load', () => { addLayers(); setMapReady(true); setStyleEpoch((n) => n + 1) })
    // Seed the first viewport once the map is created (moveend may not fire on
    // a cold load with no interaction).
    syncView()

    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Load the global station registry once (static weekly snapshot) ─────────
  // Filtered & clustered client-side, so the map shows the ENTIRE network with
  // no per-pan load on BirdWeather. Falls back to live viewport queries if the
  // snapshot isn't available (e.g. a fresh dev clone before a build).
  useEffect(() => {
    const ac = new AbortController()
    fetchStationSnapshot({ signal: ac.signal })
      .then(({ stations }) => {
        if (ac.signal.aborted) return
        allStationsRef.current = stations
        const m = new Map()
        for (const s of stations) m.set(String(s.id), s)
        byIdRef.current = m
        setSnapshotReady(true)
        setStationsInView(countInView(mapRef.current, stations))
      })
      .catch((err) => {
        if (ac.signal.aborted || err.name === 'AbortError') return
        snapshotFailedRef.current = true
        // eslint-disable-next-line no-console
        console.warn('[birdsong] station snapshot unavailable; falling back to live queries:', err.message)
      })
    return () => ac.abort()
  }, [])

  // ─── Fetch live viewport feeds (debounced) on view / window change ──────────
  // Stations come from the snapshot, not here — so this only pulls the genuinely
  // live data: recent detections + top species for the visible area.
  useEffect(() => {
    if (!viewport) return
    const ac = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const tasks = [
          fetchDetections({ bbox: viewport, period, first: 60, signal: ac.signal }),
          fetchTopSpecies({ bbox: viewport, period, limit: 12, signal: ac.signal }),
          fetchCounts({ bbox: viewport, period, signal: ac.signal }),
        ]
        // Fallback: if the static snapshot didn't load, fetch stations live
        // (capped) so the map still shows something.
        if (snapshotFailedRef.current) {
          tasks.push(fetchStations({ bbox: viewport, period, first: 200, signal: ac.signal }))
        }
        const [det, top, cts, st] = await Promise.all(tasks)
        if (ac.signal.aborted) return
        setDetections(det.detections)
        setTopSpecies(top)
        setCounts(cts)
        if (st) {
          const src = mapRef.current?.getSource('stations')
          if (src) src.setData(buildStationsFC(st.stations))
          setStationsInView(st.stations.length)
        }
        setLoading(false)
      } catch (err) {
        if (ac.signal.aborted || err.name === 'AbortError') return
        setError('Could not load BirdWeather data. Pan the map or try again.')
        setLoading(false)
      }
    }, 450)
    return () => { ac.abort(); clearTimeout(timer) }
  }, [viewport, period])

  // ─── Populate the clustered station source ──────────────────────────────────
  // Runs when the snapshot arrives and re-runs after every basemap switch
  // (styleEpoch), since setStyle drops & recreates the source.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !snapshotReady) return
    const src = map.getSource('stations')
    if (src) src.setData(buildStationsFC(allStationsRef.current))
  }, [snapshotReady, mapReady, styleEpoch])

  // ─── Highlight selected + my station ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource('station-highlight')
    if (!src) return
    const feats = []
    for (const id of new Set([selectedId, myStationId].filter(Boolean).map(String))) {
      let s = byIdRef.current.get(id)
      if (!s && selectedStation && String(selectedStation.id) === id) s = selectedStation
      if (s) feats.push({ type: 'Feature', properties: { id }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } })
    }
    src.setData({ type: 'FeatureCollection', features: feats })
  }, [selectedId, myStationId, selectedStation, mapReady, styleEpoch, snapshotReady])

  // ─── Load the selected station's detail ─────────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setSelectedStation(null); setSelDetections([]); setSelTopSpecies([]); return }
    const ac = new AbortController()
    setSelLoading(true)
    Promise.all([
      fetchStation({ id: selectedId, period, signal: ac.signal }),
      fetchDetections({ stationId: selectedId, period, first: 40, signal: ac.signal }),
      fetchTopSpecies({ stationId: selectedId, period, limit: 10, signal: ac.signal }),
    ])
      .then(([station, det, top]) => {
        if (ac.signal.aborted) return
        setSelectedStation(station)
        setSelDetections(det.detections)
        setSelTopSpecies(top)
        setSelLoading(false)
        // Fly to the station the first time it's opened (not on a hydrated cold
        // load, which already framed the shared camera).
        if (station && !suppressFlyRef.current) {
          mapRef.current?.flyTo({ center: [station.lng, station.lat], zoom: Math.max(mapRef.current.getZoom(), 9), duration: 1200, essential: true })
        }
        suppressFlyRef.current = false
      })
      .catch((err) => { if (!ac.signal.aborted && err.name !== 'AbortError') setSelLoading(false) })
    return () => ac.abort()
  }, [selectedId, period])

  // ─── Persist the full view to the URL ───────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (periodId !== DEFAULT_PERIOD_ID) sp.set('t', periodId)
    if (selectedId) sp.set('s', selectedId)
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3))
      sp.set('lng', mapView.lng.toFixed(3))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
  }, [periodId, selectedId, basemap, mapView])

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  // ─── Per-route SEO (client side; static birdsong.html covers crawlers) ─────
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Birdsong — Live bird-audio map · EarthAtlas'
    const setMeta = (sel, val) => {
      const el = document.head.querySelector(sel)
      if (!el) return null
      const prev = el.getAttribute('content')
      el.setAttribute('content', val)
      return prev
    }
    const desc = 'Hear what birds are calling anywhere on Earth — a live map of BirdWeather’s global acoustic monitoring network. Pan to any place to see its stations, recent detections with playable audio, and most-heard species. An EarthAtlas tool.'
    const prevDesc = setMeta('meta[name="description"]', desc)
    const prevOgT = setMeta('meta[property="og:title"]', document.title)
    const prevOgD = setMeta('meta[property="og:description"]', desc)
    const prevOgU = setMeta('meta[property="og:url"]', 'https://earthatlas.org/birdsong')
    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', prevDesc)
      if (prevOgT != null) setMeta('meta[property="og:title"]', prevOgT)
      if (prevOgD != null) setMeta('meta[property="og:description"]', prevOgD)
      if (prevOgU != null) setMeta('meta[property="og:url"]', prevOgU)
    }
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleSelect = useCallback((r) => {
    const map = mapRef.current
    if (!map || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
    map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 9), duration: 1400, essential: true })
  }, [])

  const closeStation = useCallback(() => { setSelectedId(null) }, [])

  const toggleMyStation = useCallback((id) => {
    setMyStationId((cur) => {
      const next = cur === id ? null : id
      try {
        if (next) window.localStorage.setItem(MY_STATION_KEY, next)
        else window.localStorage.removeItem(MY_STATION_KEY)
      } catch { /* ignore */ }
      return next
    })
  }, [])

  const goToMyStation = useCallback(() => { if (myStationId) setSelectedId(myStationId) }, [myStationId])

  // ─── No token guard ───────────────────────────────────────────────────────
  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenError}>
          <strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} preload="none" />

      {/* Branding */}
      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>Birdsong</span>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search a place to hear its birds…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handleSelect}
        />
      </div>

      {/* Basemap picker */}
      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button
          className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)}
          aria-label="Choose basemap" title="Basemap"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}
              >
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Control panel */}
      <div className={`${styles.panel} ${panelOpen ? '' : styles.panelCollapsed}`}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>{selectedStation ? 'Station' : 'Birdsong'}</span>
          <button className={styles.panelCollapse} onClick={() => setPanelOpen((o) => !o)} aria-label={panelOpen ? 'Collapse' : 'Expand'}>
            {panelOpen ? '▾' : '▸'}
          </button>
        </div>

        {panelOpen && (
          <div className={styles.panelBody}>
            {/* Time window — applies to both global and station views */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Time window</label>
              <div className={styles.chipRow}>
                {PERIOD_PRESETS.map((p) => (
                  <button key={p.id} className={periodId === p.id ? styles.chipActive : styles.chip} onClick={() => setPeriodId(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedStation
              ? (
                <StationDetail
                  station={selectedStation}
                  detections={selDetections}
                  topSpecies={selTopSpecies}
                  loading={selLoading}
                  isMine={myStationId === selectedStation.id}
                  playingId={playingId}
                  onPlay={togglePlay}
                  onClose={closeStation}
                  onToggleMine={() => toggleMyStation(selectedStation.id)}
                />
              )
              : (
                <GlobalView
                  loading={loading}
                  error={error}
                  snapshotReady={snapshotReady}
                  stationsInView={stationsInView}
                  counts={counts}
                  topSpecies={topSpecies}
                  detections={detections}
                  playingId={playingId}
                  onPlay={togglePlay}
                  myStationId={myStationId}
                  onGoToMyStation={goToMyStation}
                />
              )}

            <button type="button" className={styles.methodology} onClick={() => setShowMethodology(true)}>
              ⓘ How this is sourced
            </button>
            <div className={styles.builtBy}>
              EarthAtlas is built by{' '}
              <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={styles.builtByLink}>
                KnauerNever.com
              </a>
            </div>
          </div>
        )}
      </div>

      <div className={styles.tip}>Pan anywhere · click a station for its calls · ▶ to listen</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

// ─── Global (viewport) view ──────────────────────────────────────────────────
function GlobalView({ loading, error, snapshotReady, stationsInView, counts, topSpecies, detections, playingId, onPlay, myStationId, onGoToMyStation }) {
  return (
    <>
      <div className={styles.status}>
        {error ? <span className={styles.statusError}>{error}</span>
          : stationsInView === 0
            ? (snapshotReady ? 'No stations in this view — pan or zoom out.' : 'Loading the global station network…')
            : `${stationsInView.toLocaleString()} stations in view${loading ? ' · listening…' : ''}`}
      </div>

      {myStationId && (
        <button className={styles.myStationBtn} onClick={onGoToMyStation}>
          ★ Go to my station
        </button>
      )}

      {/* Real viewport totals over the window (BirdWeather `counts` aggregation).
          "stations" is every station registered in view (matches the dots);
          species & detections are actual totals, not a sample. */}
      <div className={styles.statGrid}>
        <div className={styles.statBox}><span className={styles.statVal}>{stationsInView.toLocaleString()}</span><span className={styles.statKey}>stations in view</span></div>
        <div className={styles.statBox}><span className={styles.statVal}>{counts ? compactNumber(counts.species) : '—'}</span><span className={styles.statKey}>species heard</span></div>
        <div className={styles.statBox}><span className={styles.statVal}>{counts ? compactNumber(counts.detections) : '—'}</span><span className={styles.statKey}>detections</span></div>
      </div>

      {topSpecies.length > 0 && (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Most heard here</label>
          <TopSpeciesList items={topSpecies} />
        </div>
      )}

      {detections.length > 0 && (
        <div className={styles.field}>
          <label className={styles.fieldLabel}>Latest calls{counts && counts.detections > detections.length ? ` · newest ${detections.length} of ${compactNumber(counts.detections)}` : ''}</label>
          <DetectionFeed detections={detections} playingId={playingId} onPlay={onPlay} showStation />
        </div>
      )}
    </>
  )
}

// ─── Station detail view ──────────────────────────────────────────────────────
function StationDetail({ station, detections, topSpecies, loading, isMine, playingId, onPlay, onClose, onToggleMine }) {
  const place = [station.location, station.state, station.country].filter(Boolean).join(', ')
  return (
    <>
      <button className={styles.clearLoc} onClick={onClose}>← Back to all stations</button>

      <div className={styles.stationHead}>
        <div className={styles.stationName}>{station.name}</div>
        <div className={styles.stationMeta}>
          <span className={styles.typeBadge}>{stationTypeLabel(station.type)}</span>
          {place && <span className={styles.stationPlace}>{place}</span>}
        </div>
      </div>

      <button className={isMine ? styles.myStationActive : styles.myStationBtn} onClick={onToggleMine}>
        {isMine ? '★ My station — pinned' : '☆ Pin as my station'}
      </button>

      <div className={styles.statGrid}>
        <div className={styles.statBox}><span className={styles.statVal}>{station.detections.toLocaleString()}</span><span className={styles.statKey}>detections</span></div>
        <div className={styles.statBox}><span className={styles.statVal}>{station.species.toLocaleString()}</span><span className={styles.statKey}>species</span></div>
      </div>

      {loading
        ? <div className={styles.status}>Loading station…</div>
        : (
          <>
            {topSpecies.length > 0 && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Top species</label>
                <TopSpeciesList items={topSpecies} />
              </div>
            )}
            {detections.length > 0 ? (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Recent calls</label>
                <DetectionFeed detections={detections} playingId={playingId} onPlay={onPlay} />
              </div>
            ) : (
              <div className={styles.status}>No detections in this window.</div>
            )}
          </>
        )}
    </>
  )
}

// ─── Shared sub-components ─────────────────────────────────────────────────────
function TopSpeciesList({ items }) {
  const max = Math.max(1, ...items.map((s) => s.count))
  return (
    <div className={styles.speciesList}>
      {items.map((s, i) => (
        <div key={`${s.commonName}-${i}`} className={styles.speciesRow} title={s.scientificName}>
          <span className={styles.speciesDot} style={{ background: s.color }} />
          <span className={styles.speciesName}>{s.commonName}</span>
          <span className={styles.speciesBarWrap}>
            <span className={styles.speciesBar} style={{ width: `${(s.count / max) * 100}%`, background: s.color }} />
          </span>
          <span className={styles.speciesCount}>{s.count.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

function DetectionFeed({ detections, playingId, onPlay, showStation }) {
  return (
    <div className={styles.feed}>
      {detections.map((d) => {
        const playing = playingId === d.id
        return (
          <div key={d.id} className={styles.feedRow}>
            <button
              className={playing ? styles.playBtnActive : styles.playBtn}
              onClick={() => onPlay(d)}
              disabled={!d.audioUrl}
              aria-label={playing ? 'Pause' : 'Play call'}
              title={d.audioUrl ? (playing ? 'Pause' : 'Play call') : 'No audio'}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            {d.species.imageUrl
              ? <img className={styles.feedThumb} src={d.species.imageUrl} alt="" loading="lazy" />
              : <span className={styles.feedThumb} style={{ background: d.species.color }} />}
            <div className={styles.feedInfo}>
              <div className={styles.feedSpecies}>{d.species.commonName}</div>
              <div className={styles.feedSub}>
                {showStation && d.stationName ? `${d.stationName} · ` : ''}{relativeTime(d.time)} ago
                {d.confidence != null && ` · ${confidenceLabel(d.confidence)}`}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── "How this is sourced" modal ────────────────────────────────────────────
function MethodologyModal({ onClose }) {
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
            Each cyan circle is a public <strong>BirdWeather</strong> station — a PUC or BirdNET-Pi device that
            listens continuously and identifies birds from their calls using the{' '}
            <strong>BirdNET</strong> acoustic model. Circle <strong>size</strong> grows with how many detections
            the station logged in your chosen time window, and <strong>brightness</strong> with how recently it
            last heard something. An amber ring marks the station you're viewing or have pinned.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Where the data comes from</h3>
          <ul>
            <li>
              <strong>BirdWeather — public GraphQL API.</strong> Stations, detections, and species counts for the
              area in view come straight from{' '}
              <a href="https://app.birdweather.com/api/index.html" target="_blank" rel="noopener noreferrer">BirdWeather's public API</a>,
              cached briefly at our edge. No account or token needed — it's the global citizen network.
            </li>
            <li>
              <strong>Audio.</strong> The ▶ button plays the actual soundscape recording BirdWeather captured for
              that detection. Confidence is BirdNET's certainty for the identification.
            </li>
            <li>
              <strong>Place search &amp; basemap.</strong> Mapbox geocoding and satellite/dark/light/streets styles.
            </li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>Caveats</h3>
          <p>
            Identifications are <strong>automated</strong> and occasionally wrong, especially at low confidence —
            treat them as probable, not certain. Coverage is wherever volunteers have placed devices, so dense
            areas reflect more listeners, not necessarily more birds. Detection counts depend on a station's
            settings and uptime. Times are shown relative to now in your local timezone.
          </p>
        </section>
      </div>
    </div>
  )
}
