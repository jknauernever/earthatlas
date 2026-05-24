import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchRecentINat, fetchRecentEBird } from './liveService'
import GeoSearch from '../components/GeoSearch.jsx'
import styles from './LiveGlobe.module.css'
import localStyles from './LiveLocal.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const STADIA_KEY = import.meta.env.VITE_STADIA_KEY || ''
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || ''
const THUNDERFOREST_KEY = import.meta.env.VITE_THUNDERFOREST_KEY || ''

// ─── Constants (match LiveGlobe) ────────────────────────────────────────
const FADE_DURATION = 5 * 60 * 1000
const GLOW_DURATION = 5 * 1000
const POLL_INTERVAL = 60000
const RENDER_TICK = 1000
const DOT_RADIUS = 4
const MAX_FEED_ITEMS = 80

// ─── Basemaps (same as LiveGlobe) ──────────────────────────────────────
const BASEMAPS = {
  'Mapbox Satellite': 'mapbox://styles/mapbox/satellite-streets-v12',
  'Mapbox Dark': 'mapbox://styles/mapbox/dark-v11',
  'Mapbox Outdoors': 'mapbox://styles/mapbox/outdoors-v12',
  'ESRI World Imagery': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  'ESRI NatGeo': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  'CartoDB Dark Matter': {
    tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
    attribution: '&copy; CARTO',
    tileSize: 512,
  },
  'CartoDB Voyager': {
    tiles: ['https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png'],
    attribution: '&copy; CARTO',
    tileSize: 512,
  },
  'Stadia Alidade Satellite': {
    tiles: [`https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}@2x.jpg?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Stamen Watercolor': {
    tiles: [`https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 256,
  },
}

function buildCustomStyle(config, labels = false) {
  const sources = {
    'custom-tiles': {
      type: 'raster',
      tiles: config.tiles,
      tileSize: config.tileSize || 256,
      attribution: config.attribution || '',
      maxzoom: config.maxzoom || 19,
    },
  }
  const layers = [{
    id: 'custom-tiles-layer',
    type: 'raster',
    source: 'custom-tiles',
    paint: config.paint || {},
  }]
  if (labels) {
    sources['mapbox-streets'] = { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' }
    layers.push(
      { id: 'admin-boundaries', type: 'line', source: 'mapbox-streets', 'source-layer': 'admin', filter: ['==', ['get', 'admin_level'], 0], paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': 1 } },
      { id: 'country-labels', type: 'symbol', source: 'mapbox-streets', 'source-layer': 'place_label', filter: ['==', ['get', 'class'], 'country'], layout: { 'text-field': ['get', 'name_en'], 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 14, 8, 18], 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 8 }, paint: { 'text-color': 'rgba(255,255,255,0.7)', 'text-halo-color': 'rgba(0,0,0,0.6)', 'text-halo-width': 1.5 } },
      { id: 'state-labels', type: 'symbol', source: 'mapbox-streets', 'source-layer': 'place_label', filter: ['==', ['get', 'class'], 'state'], minzoom: 3, layout: { 'text-field': ['get', 'name_en'], 'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 6, 12], 'text-max-width': 7 }, paint: { 'text-color': 'rgba(255,255,255,0.45)', 'text-halo-color': 'rgba(0,0,0,0.5)', 'text-halo-width': 1 } },
      { id: 'city-labels', type: 'symbol', source: 'mapbox-streets', 'source-layer': 'place_label', filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]], minzoom: 4, layout: { 'text-field': ['get', 'name_en'], 'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 8, 13], 'text-max-width': 7 }, paint: { 'text-color': 'rgba(255,255,255,0.4)', 'text-halo-color': 'rgba(0,0,0,0.5)', 'text-halo-width': 1 } },
    )
  }
  return { version: 8, glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf', sources, layers }
}

function getStyle(basemap, labels = false) {
  const entry = BASEMAPS[basemap]
  if (typeof entry === 'string') return entry
  return buildCustomStyle(entry, labels)
}

// ─── Taxon emoji ────────────────────────────────────────────────────────
const TAXON_EMOJI = {
  Aves: '\uD83D\uDC26', Mammalia: '\uD83D\uDC3E', Reptilia: '\uD83E\uDD8E',
  Amphibia: '\uD83D\uDC38', Insecta: '\uD83E\uDD97', Arachnida: '\uD83D\uDD77\uFE0F',
  Actinopterygii: '\uD83D\uDC1F', Mollusca: '\uD83D\uDC1A', Plantae: '\uD83C\uDF3F',
  Fungi: '\uD83C\uDF44', Chromista: '\uD83D\uDD2C',
}
function getTaxonEmoji(iconic) { return TAXON_EMOJI[iconic] || '\uD83C\uDF0D' }

function formatTimeAgo(ts) {
  if (!ts) return ''
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 10) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ago`
}

// ─── Location search overlay ────────────────────────────────────────────
// Wraps the canonical GeoSearch in the existing dark search card. If Mapbox
// doesn't supply a bbox (e.g. for a POI), fabricate a ~0.18° box so the
// downstream "fit to area" code still has something to work with.
function PlaceSearch({ onSelect }) {
  return (
    <div className={localStyles.searchOverlay}>
      <div className={localStyles.searchCard}>
        <div className={localStyles.searchWordmark}>Earth<em>Atlas</em></div>
        <div className={localStyles.searchSubtitle}>Live observations in your area</div>
        <div className={localStyles.searchBox}>
          <GeoSearch
            autoFocus
            placeholder="Search a city, region, park, or country..."
            onSelect={(r) => {
              const bbox = (r.bbox && r.bbox.length === 4)
                ? r.bbox
                : [r.lng - 0.18, r.lat - 0.18, r.lng + 0.18, r.lat + 0.18]
              onSelect({ name: r.name, lat: r.lat, lng: r.lng, bbox })
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Feed observation card ──────────────────────────────────────────────
function ObsCard({ obs, isNew }) {
  const emoji = getTaxonEmoji(obs.iconicTaxon)
  const photo = obs.photoUrl
  const timeAgo = formatTimeAgo(obs.addedAt)
  return (
    <div className={`${localStyles.obsCard} ${isNew ? localStyles.obsNew : ''}`} style={{ opacity: Math.max(0.3, obs._opacity ?? 1) }}>
      {photo
        ? <img className={localStyles.obsPhoto} src={photo} alt="" loading="lazy" />
        : <div className={localStyles.obsPhotoPlaceholder}>{emoji}</div>}
      <div className={localStyles.obsInfo}>
        <div className={localStyles.obsName}>{obs.commonName || 'Unknown'}</div>
        {obs.scientificName && <div className={localStyles.obsSci}>{obs.scientificName}</div>}
        <div className={localStyles.obsMeta}>
          <span className={localStyles.obsSource}>{obs.source}</span>
          {obs.location && <span>{obs.location}</span>}
          <span className={localStyles.obsTimestamp}>{timeAgo}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────────
export default function LiveLocal() {
  const [place, setPlace] = useState(null)
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const mapReadyRef = useRef(false)

  const observationsRef = useRef([])
  const seenIdsRef = useRef(new Set())
  const dripQueueRef = useRef([])
  const dripTimerRef = useRef(null)
  const renderTimerRef = useRef(null)
  const pollIntervalRef = useRef(null)
  const pollCancelledRef = useRef(false)
  const boundsRef = useRef(null)
  const newIdsRef = useRef(new Set())

  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)
  const [feedItems, setFeedItems] = useState([])
  const [photoOverlays, setPhotoOverlays] = useState([])
  const [hoveredPhoto, setHoveredPhoto] = useState(null)
  const [basemap, setBasemap] = useState('Mapbox Satellite')
  const [showLabels, setShowLabels] = useState(true)
  const [sourceFilter, setSourceFilter] = useState('All')
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter

  // ─── GeoJSON with fade + glow (same as LiveGlobe) ────────────────────
  function buildGeoJSON() {
    const now = Date.now()
    const features = []
    for (const o of observationsRef.current) {
      const age = now - o.addedAt
      const t = Math.min(age / FADE_DURATION, 1)
      const opacity = Math.max(0.1, 1.0 - t * 0.9)
      const glowT = Math.min(age / GLOW_DURATION, 1)
      const glowOpacity = glowT < 1 ? 0.8 * (1 - glowT) : 0
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
        properties: { opacity, glowOpacity },
      })
    }
    return { type: 'FeatureCollection', features }
  }

  function syncSource() {
    const src = mapRef.current?.getSource('live-obs')
    if (!src) return
    src.setData(buildGeoJSON())
  }

  function updateCounts() {
    const species = new Set()
    observationsRef.current.forEach(o => { if (o.scientificName) species.add(o.scientificName) })
    setObsCount(observationsRef.current.length)
    setSpeciesCount(species.size)
  }

  function updateFeed() {
    const now = Date.now()
    const items = observationsRef.current
      .slice().sort((a, b) => b.addedAt - a.addedAt).slice(0, MAX_FEED_ITEMS)
      .map(o => {
        const t = Math.min((now - o.addedAt) / FADE_DURATION, 1)
        return { ...o, _opacity: Math.max(0.3, 1.0 - t * 0.7) }
      })
    setFeedItems(items)
  }

  // ─── Photo overlays (same as LiveGlobe) ──────────────────────────────
  function updatePhotoOverlays() {
    const map = mapRef.current
    if (!map) return
    const now = Date.now()
    const canvas = map.getCanvas()
    const w = canvas.width / (window.devicePixelRatio || 1)
    const h = canvas.height / (window.devicePixelRatio || 1)
    const overlays = []
    for (const obs of observationsRef.current) {
      if (!obs.photoUrl) continue
      const pt = map.project([obs.lng, obs.lat])
      if (pt.x < -30 || pt.x > w + 30 || pt.y < -30 || pt.y > h + 30) continue
      const t = Math.min((now - obs.addedAt) / FADE_DURATION, 1)
      const opacity = Math.max(0.1, 1.0 - t * 0.9)
      overlays.push({ id: obs.id, x: pt.x, y: pt.y, opacity, obs })
    }
    setPhotoOverlays(overlays)
  }

  function tick() {
    const now = Date.now()
    const before = observationsRef.current.length
    observationsRef.current = observationsRef.current.filter(o => (now - o.addedAt) < FADE_DURATION)
    if (observationsRef.current.length < before) {
      seenIdsRef.current = new Set(observationsRef.current.map(o => o.id))
    }
    for (const id of newIdsRef.current) {
      const obs = observationsRef.current.find(o => o.id === id)
      if (!obs || (now - obs.addedAt) > 2000) newIdsRef.current.delete(id)
    }
    syncSource()
    updatePhotoOverlays()
    updateCounts()
    updateFeed()
  }

  function dripOne() {
    const queue = dripQueueRef.current
    if (queue.length === 0) return
    const obs = queue.shift()
    if (seenIdsRef.current.has(obs.id)) { if (queue.length > 0) scheduleDrip(); return }
    obs.addedAt = Date.now()
    seenIdsRef.current.add(obs.id)
    newIdsRef.current.add(obs.id)
    observationsRef.current.push(obs)
    syncSource()
    updatePhotoOverlays()
    updateCounts()
    updateFeed()
    if (queue.length > 0) scheduleDrip()
  }

  function scheduleDrip() {
    clearTimeout(dripTimerRef.current)
    const queue = dripQueueRef.current
    if (queue.length === 0) return
    const delay = Math.max(500, POLL_INTERVAL / (queue.length + 1))
    dripTimerRef.current = setTimeout(dripOne, delay)
  }

  // ─── Add GL layers (same as LiveGlobe) ───────────────────────────────
  function addLayers(map) {
    if (map.getSource('live-obs')) return
    map.addSource('live-obs', { type: 'geojson', data: buildGeoJSON() })
    map.addLayer({
      id: 'live-obs-glow', type: 'circle', source: 'live-obs',
      filter: ['>', ['get', 'glowOpacity'], 0],
      paint: { 'circle-radius': DOT_RADIUS * 3, 'circle-color': '#ffee00', 'circle-opacity': ['get', 'glowOpacity'], 'circle-blur': 1 },
    })
    map.addLayer({
      id: 'live-obs-dots', type: 'circle', source: 'live-obs',
      paint: { 'circle-radius': DOT_RADIUS, 'circle-color': '#ff6a00', 'circle-opacity': ['get', 'opacity'], 'circle-stroke-width': 0.5, 'circle-stroke-color': '#ff8c00', 'circle-stroke-opacity': ['get', 'opacity'] },
    })
    mapReadyRef.current = true
  }

  function getMapView() {
    const b = boundsRef.current
    if (!b) return undefined
    return {
      center: { lat: (b[1] + b[3]) / 2, lng: (b[0] + b[2]) / 2 },
      zoom: 8,
      bounds: { swlat: b[1], swlng: b[0], nelat: b[3], nelng: b[2] },
    }
  }

  // ─── Initialize map ──────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getStyle(basemap, showLabels),
      center: [0, 20],
      zoom: 1.8,
      projection: 'globe',
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(10, 14, 23)',
        'high-color': 'rgb(20, 30, 60)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(6, 8, 16)',
        'star-intensity': 0.7,
      })
      addLayers(map)
    })

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')
    map.on('move', () => updatePhotoOverlays())

    mapRef.current = map

    return () => {
      clearTimeout(dripTimerRef.current)
      clearInterval(renderTimerRef.current)
      clearInterval(pollIntervalRef.current)
      pollCancelledRef.current = true
      map.remove()
      mapRef.current = null
      mapReadyRef.current = false
    }
  }, [])

  // ─── Fly to place when selected ──────────────────────────────────────
  useEffect(() => {
    if (!place || !mapRef.current) return
    const bbox = place.bbox
    boundsRef.current = bbox
    mapRef.current.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: 40,
      duration: 2000,
      essential: true,
    })
  }, [place])

  // ─── Basemap change ──────────────────────────────────────────────────
  const basemapMountRef = useRef(true)
  useEffect(() => {
    if (basemapMountRef.current) { basemapMountRef.current = false; return }
    const map = mapRef.current
    if (!map) return
    mapReadyRef.current = false
    map.once('style.load', () => {
      map.setFog({
        color: 'rgb(10, 14, 23)',
        'high-color': 'rgb(20, 30, 60)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(6, 8, 16)',
        'star-intensity': 0.7,
      })
      addLayers(map)
    })
    map.setStyle(getStyle(basemap, showLabels))
  }, [basemap, showLabels])

  // ─── Render tick ─────────────────────────────────────────────────────
  useEffect(() => {
    renderTimerRef.current = setInterval(tick, RENDER_TICK)
    return () => clearInterval(renderTimerRef.current)
  }, [])

  // ─── Polling loop ────────────────────────────────────────────────────
  useEffect(() => {
    if (!place) return
    pollCancelledRef.current = false
    let isFirstPoll = true

    function waitForMap(cb) {
      if (mapReadyRef.current) { cb(); return }
      const check = setInterval(() => {
        if (pollCancelledRef.current) { clearInterval(check); return }
        if (mapReadyRef.current) { clearInterval(check); cb() }
      }, 100)
    }

    async function poll() {
      try {
        const view = getMapView()
        const [inat, ebird] = await Promise.all([
          fetchRecentINat(view).catch(() => []),
          fetchRecentEBird(view).catch(() => []),
        ])
        if (pollCancelledRef.current) return

        const all = sourceFilterRef.current === 'All'
          ? [...inat, ...ebird]
          : [...inat, ...ebird].filter(o => o.source === sourceFilterRef.current)
        const newObs = all.filter(o => !seenIdsRef.current.has(o.id))

        if (isFirstPoll && all.length > 0) {
          isFirstPoll = false
          const now = Date.now()
          const shuffled = [...all].sort(() => Math.random() - 0.5)
          for (let i = 0; i < shuffled.length; i++) {
            const obs = shuffled[i]
            if (seenIdsRef.current.has(obs.id)) continue
            obs.addedAt = now - (i / shuffled.length) * FADE_DURATION * 0.8
            seenIdsRef.current.add(obs.id)
            observationsRef.current.push(obs)
          }
          syncSource()
          updatePhotoOverlays()
          updateCounts()
          updateFeed()
        } else if (newObs.length > 0) {
          dripQueueRef.current = [...dripQueueRef.current, ...newObs]
          scheduleDrip()
        }
      } catch (err) {
        console.error('[LiveLocal] Poll error:', err)
      }
    }

    waitForMap(() => {
      if (pollCancelledRef.current) return
      poll()
      pollIntervalRef.current = setInterval(poll, POLL_INTERVAL)
    })

    return () => {
      pollCancelledRef.current = true
      clearInterval(pollIntervalRef.current)
      clearTimeout(dripTimerRef.current)
    }
  }, [place])

  // ─── Source filter change ────────────────────────────────────────────
  const filterMountRef = useRef(true)
  useEffect(() => {
    if (filterMountRef.current) { filterMountRef.current = false; return }
    if (!place) return
    observationsRef.current = []
    seenIdsRef.current.clear()
    dripQueueRef.current = []
    clearTimeout(dripTimerRef.current)
    syncSource()
    setObsCount(0)
    setSpeciesCount(0)
    setFeedItems([])
    setPhotoOverlays([])

    const view = getMapView()
    Promise.all([
      fetchRecentINat(view).catch(() => []),
      fetchRecentEBird(view).catch(() => []),
    ]).then(([inat, ebird]) => {
      const all = sourceFilter === 'All' ? [...inat, ...ebird] : [...inat, ...ebird].filter(o => o.source === sourceFilter)
      const now = Date.now()
      const shuffled = [...all].sort(() => Math.random() - 0.5)
      for (let i = 0; i < shuffled.length; i++) {
        const obs = shuffled[i]
        obs.addedAt = now - (i / shuffled.length) * FADE_DURATION * 0.8
        seenIdsRef.current.add(obs.id)
        observationsRef.current.push(obs)
      }
      syncSource()
      updatePhotoOverlays()
      updateCounts()
      updateFeed()
    }).catch(() => {})
  }, [sourceFilter])

  // ─── Override body for fullscreen ────────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.cssText
    document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#0a0e17;min-height:0;'
    document.documentElement.style.overflow = 'hidden'
    return () => { document.body.style.cssText = prev; document.documentElement.style.overflow = '' }
  }, [])

  // ─── Reset on place change ───────────────────────────────────────────
  const handleChangePlace = useCallback(() => {
    observationsRef.current = []
    seenIdsRef.current.clear()
    dripQueueRef.current = []
    newIdsRef.current.clear()
    clearTimeout(dripTimerRef.current)
    clearInterval(pollIntervalRef.current)
    pollCancelledRef.current = true
    boundsRef.current = null
    setObsCount(0)
    setSpeciesCount(0)
    setFeedItems([])
    setPhotoOverlays([])
    setPlace(null)
    // Zoom back to globe
    if (mapRef.current) {
      mapRef.current.flyTo({ center: [0, 20], zoom: 1.8, duration: 1500 })
    }
  }, [])

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      {/* Full-screen map (always mounted, same as /live) */}
      <div ref={containerRef} className={styles.mapWrap} />

      {/* Photo overlays (same as /live) */}
      {place && photoOverlays.map(p => (
        <div
          key={p.id}
          className="live-photo-marker"
          style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            transform: 'translate(-50%, -100%) translateY(-12px)',
            opacity: hoveredPhoto === p.id ? 1 : p.opacity,
            zIndex: hoveredPhoto === p.id ? 50 : 5,
            transition: 'opacity 0.2s ease',
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => setHoveredPhoto(p.id)}
          onMouseLeave={() => setHoveredPhoto(null)}
        >
          <img src={p.obs.photoUrl} className="live-photo-thumb" alt="" />
          <div className="live-photo-stem" />
          {hoveredPhoto === p.id && (
            <a
              className="live-photo-card visible"
              href={p.obs.taxonId
                ? `/species/${p.obs.taxonId}`
                : p.obs.scientificName
                  ? `/species/${encodeURIComponent(p.obs.scientificName)}`
                  : null}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <img
                src={p.obs.photoUrl.replace('/square', '/medium').replace('/small', '/medium')}
                className="live-photo-card-img"
                alt=""
              />
              <div className="live-photo-card-info">
                <div className="live-photo-card-name">{p.obs.commonName || 'Unknown'}</div>
                {p.obs.scientificName && <div className="live-photo-card-sci">{p.obs.scientificName}</div>}
                {p.obs.location && <div className="live-photo-card-loc">{p.obs.location}</div>}
                <div className="live-photo-card-source">{p.obs.source}</div>
              </div>
            </a>
          )}
        </div>
      ))}

      {/* Search overlay (shown until place is selected) */}
      {!place && <PlaceSearch onSelect={setPlace} />}

      {/* Branding (always visible, same as /live) */}
      <a href="/" className={styles.branding}>
        <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          {place ? 'LIVE LOCAL' : 'LIVE'}
        </span>
      </a>

      {/* Stats (top-right) */}
      {place && (
        <div className={styles.stats}>
          {obsCount} observations &middot; {speciesCount} species
        </div>
      )}

      {/* Place name + change button (below stats) */}
      {place && (
        <div className={localStyles.placeBar}>
          <span className={localStyles.placeBarName}>{place.name}</span>
          <button className={localStyles.placeBarBtn} onClick={handleChangePlace}>Change</button>
        </div>
      )}

      {/* Source filter (bottom-left, same as /live) */}
      {place && (
        <div className={styles.sourceFilter}>
          {['All', 'iNaturalist', 'eBird'].map(src => (
            <button
              key={src}
              className={sourceFilter === src ? styles.sourceBtnActive : styles.sourceBtn}
              onClick={() => setSourceFilter(src)}
            >
              {src}
            </button>
          ))}
        </div>
      )}

      {/* Basemap selector (bottom-center, same as /live) */}
      {place && (
        <div className={styles.basemapSelector}>
          <select
            className={styles.basemapSelect}
            value={basemap}
            onChange={e => setBasemap(e.target.value)}
          >
            {Object.keys(BASEMAPS).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button
            className={showLabels ? styles.labelsBtnActive : styles.labelsBtn}
            onClick={() => setShowLabels(v => !v)}
            title="Toggle place labels"
          >
            Labels
          </button>
        </div>
      )}

      {/* Feed panel (right side, only when place selected) */}
      {place && (
        <div className={localStyles.feedPanel}>
          <div className={localStyles.feedHeader}>Latest Observations</div>
          {feedItems.length === 0 ? (
            <div className={localStyles.feedEmpty}>
              <div className={localStyles.feedEmptyIcon}>{'\uD83D\uDD2D'}</div>
              <div>Scanning for observations&hellip;</div>
            </div>
          ) : (
            <div className={localStyles.feedScroll}>
              {feedItems.map(obs => (
                <ObsCard key={obs.id} obs={obs} isNew={newIdsRef.current.has(obs.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
