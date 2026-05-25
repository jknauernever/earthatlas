import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchAllRecent } from './liveService'
import { useQueryParams } from '../hooks/useQueryParams'
import styles from './LiveGlobe.module.css'

// URL-shareable filters for /live. Source, basemap, and labels-on/off are
// persisted so a specific view can be copy-pasted as a link.
const LIVE_QP_SCHEMA = {
  source:  { type: 'string', default: 'All' },
  basemap: { type: 'string', default: 'NASA Blue Marble' },
  labels:  { type: 'string', default: 'off' }, // 'on' | 'off'
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const STADIA_KEY = import.meta.env.VITE_STADIA_KEY || ''
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || ''
const THUNDERFOREST_KEY = import.meta.env.VITE_THUNDERFOREST_KEY || ''

// ─── Constants ────────────────────────────────────────────────────────────
const CAMERA_ROTATE = 'rotate'
const CAMERA_FLYTO = 'flyto'
const CAMERA_FIXED = 'fixed'

const FADE_DURATION = 5 * 60 * 1000
const GLOW_DURATION = 5 * 1000    // yellow glow for first 5 seconds
const ROTATION_SPEED_BASE = 0.03  // baseline degrees/frame at 1× speed
const SPEED_STEP = 0.5            // multiplier increment per +/- click
const SPEED_MIN = 0
const SPEED_MAX = 5
const RENDER_TICK = 1000
const DOT_RADIUS = 4

// Fetching strategy: position-driven, not time-driven. As the globe rotates
// (or the user pans), refetch when the view has shifted enough that visible
// land points have changed. Idle safety net keeps fresh observations flowing
// when the globe is paused.
const FETCH_TICK_MS = 1000            // how often we evaluate "should we fetch?"
const FETCH_POS_THRESHOLD_DEG = 12    // refetch once center moves this far
const FETCH_ZOOM_THRESHOLD = 0.6      // or zoom changes this much
const FETCH_MIN_INTERVAL_MS = 5000    // rate-limit floor between any two fetches
const FETCH_IDLE_INTERVAL_MS = 5 * 60 * 1000  // idle refresh cadence
const DRIP_WINDOW_MS = 30000          // spread drip-in of new observations over this window

// Great-circle-friendly lng delta (handles 180° wrap-around).
function lngDelta(a, b) {
  const d = Math.abs(a - b)
  return Math.min(d, 360 - d)
}

// Basemaps: string = Mapbox style URL, object = custom XYZ raster tiles
const BASEMAPS = {
  // ── Featured ──
  'NASA Blue Marble': {
    tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'],
    attribution: '&copy; NASA GIBS',
    maxzoom: 8,
    paint: {
      'raster-brightness-min': 0.13,
    },
  },
  'NASA Blue Marble (Next Gen)': {
    tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'],
    attribution: '&copy; NASA GIBS',
    maxzoom: 8,
    paint: {
      'raster-brightness-min': 0.13,
    },
  },
  'ESRI Ocean': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  'ESRI NatGeo': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  'MapTiler Landscape': {
    tiles: [`https://api.maptiler.com/maps/landscape/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`],
    attribution: '&copy; MapTiler',
  },
  'Thunderforest Pioneer': {
    tiles: [`https://tile.thunderforest.com/pioneer/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_KEY}`],
    attribution: '&copy; Thunderforest',
  },
  // ── Mapbox ──
  'Mapbox Satellite': 'mapbox://styles/mapbox/satellite-streets-v12',
  'Mapbox Satellite (no labels)': 'mapbox://styles/mapbox/satellite-v9',
  'Mapbox Dark': 'mapbox://styles/mapbox/dark-v11',
  'Mapbox Light': 'mapbox://styles/mapbox/light-v11',
  'Mapbox Outdoors': 'mapbox://styles/mapbox/outdoors-v12',
  'Mapbox Streets': 'mapbox://styles/mapbox/streets-v12',
  // ── ESRI ──
  'ESRI World Imagery': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  'ESRI World Topo': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  'ESRI Dark Gray': {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'],
    attribution: '&copy; Esri',
  },
  // ── CartoDB ──
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
  'CartoDB Positron': {
    tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'],
    attribution: '&copy; CARTO',
    tileSize: 512,
  },
  // ── Stadia ──
  'Stadia Alidade Satellite': {
    tiles: [`https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}@2x.jpg?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Alidade Smooth': {
    tiles: [`https://tiles.stadiamaps.com/tiles/alidade_smooth/{z}/{x}/{y}@2x.png?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Alidade Smooth Dark': {
    tiles: [`https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}@2x.png?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Outdoors': {
    tiles: [`https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}@2x.png?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia OSM Bright': {
    tiles: [`https://tiles.stadiamaps.com/tiles/osm_bright/{z}/{x}/{y}@2x.png?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Stamen Toner': {
    tiles: [`https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}@2x.png?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Stamen Terrain': {
    tiles: [`https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}@2x.png?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 512,
  },
  'Stadia Stamen Watercolor': {
    tiles: [`https://tiles.stadiamaps.com/tiles/stamen_watercolor/{z}/{x}/{y}.jpg?api_key=${STADIA_KEY}`],
    attribution: '&copy; Stadia Maps',
    tileSize: 256,
  },
  // ── Google (requires API key in VITE_GOOGLE_MAPS_KEY) ──
  'Google Satellite': {
    tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
    attribution: '&copy; Google',
  },
  'Google Hybrid': {
    tiles: ['https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'],
    attribution: '&copy; Google',
  },
  'Google Terrain': {
    tiles: ['https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}'],
    attribution: '&copy; Google',
  },
}

// Build a Mapbox style object for custom XYZ tile sources
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

  const layers = [
    {
      id: 'custom-tiles-layer',
      type: 'raster',
      source: 'custom-tiles',
      paint: config.paint || {},
    },
  ]

  if (labels) {
    sources['mapbox-streets'] = {
      type: 'vector',
      url: 'mapbox://mapbox.mapbox-streets-v8',
    }

    // Country boundaries
    layers.push({
      id: 'admin-boundaries',
      type: 'line',
      source: 'mapbox-streets',
      'source-layer': 'admin',
      filter: ['==', ['get', 'admin_level'], 0],
      paint: {
        'line-color': 'rgba(255, 255, 255, 0.3)',
        'line-width': 1,
      },
    })

    // Country labels
    layers.push({
      id: 'country-labels',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['==', ['get', 'class'], 'country'],
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 14, 8, 18],
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.1,
        'text-max-width': 8,
      },
      paint: {
        'text-color': 'rgba(255, 255, 255, 0.7)',
        'text-halo-color': 'rgba(0, 0, 0, 0.6)',
        'text-halo-width': 1.5,
      },
    })

    // State/region labels (visible when zoomed in)
    layers.push({
      id: 'state-labels',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['==', ['get', 'class'], 'state'],
      minzoom: 3,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 9, 6, 12],
        'text-max-width': 7,
      },
      paint: {
        'text-color': 'rgba(255, 255, 255, 0.45)',
        'text-halo-color': 'rgba(0, 0, 0, 0.5)',
        'text-halo-width': 1,
      },
    })

    // City labels (visible when more zoomed in)
    layers.push({
      id: 'city-labels',
      type: 'symbol',
      source: 'mapbox-streets',
      'source-layer': 'place_label',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]],
      minzoom: 4,
      layout: {
        'text-field': ['get', 'name_en'],
        'text-font': ['DIN Pro Regular', 'Arial Unicode MS Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 8, 13],
        'text-max-width': 7,
      },
      paint: {
        'text-color': 'rgba(255, 255, 255, 0.4)',
        'text-halo-color': 'rgba(0, 0, 0, 0.5)',
        'text-halo-width': 1,
      },
    })
  }

  return {
    version: 8,
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    sources,
    layers,
  }
}

function getStyle(basemap, labels = false) {
  const entry = BASEMAPS[basemap]
  if (typeof entry === 'string') return entry
  return buildCustomStyle(entry, labels)
}

// Format an observation's raw timestamp for the popup card. Sources vary:
//   • iNat `time_observed_at`: ISO 8601 with TZ offset → convert to user's tz
//   • iNat `created_at`:       ISO UTC (also tz-aware)
//   • iNat `observed_on`:      "YYYY-MM-DD" date only  → show date only
//   • eBird `obsDt`:           "YYYY-MM-DD HH:MM" (site-local, no offset)
//
// Returns { text, hint }:
//   • text: the primary timestamp line (with user's tz abbrev when we can
//          authoritatively convert)
//   • hint: a small qualifier shown after a dot (e.g. "local") for cases
//          where the raw timestamp has no timezone info and would be
//          misleading to label with the user's tz.
function formatObservedAt(raw) {
  if (!raw) return null
  // Date-only — no time component, no tz to convert.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number)
    return {
      text: new Date(y, m - 1, d).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      }),
      hint: null,
    }
  }
  // ISO 8601 timestamps end with Z, +HH:MM, or -HH:MM (with or without
  // the colon). Anything else (e.g. eBird's bare "YYYY-MM-DD HH:MM") is a
  // "naive" wall-clock time we can't honestly convert to the user's tz.
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(raw.trim())
  const isoish = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(' ', 'T') : raw
  const date = new Date(isoish)
  if (isNaN(date.getTime())) return null
  if (hasTz) {
    // Authoritative conversion to the user's locale + timezone; tz abbrev
    // (e.g. "PST", "CET") makes it explicit which tz the time is in.
    return {
      text: date.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
        timeZoneName: 'short',
      }),
      hint: null,
    }
  }
  return {
    text: date.toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }),
    hint: 'local',
  }
}

export default function LiveGlobe() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const mapReadyRef = useRef(false)

  const observationsRef = useRef([])
  const seenIdsRef = useRef(new Set())
  const dripQueueRef = useRef([])
  const dripTimerRef = useRef(null)
  const renderTimerRef = useRef(null)

  const rotationRef = useRef(null)
  const interactingRef = useRef(false)
  const interactTimeoutRef = useRef(null)
  const flyingRef = useRef(false)
  const flyTimerRef = useRef(null)
  const fetchTickRef = useRef(null)
  const pollCancelledRef = useRef(false)
  const fetchInFlightRef = useRef(false)
  const lastFetchPosRef = useRef(null)   // { lat, lng, zoom } of most recent successful fetch
  const lastFetchTimeRef = useRef(0)

  const [cameraMode, setCameraMode] = useState(CAMERA_ROTATE)
  const [qp, setQP] = useQueryParams(LIVE_QP_SCHEMA)
  const sourceFilter = qp.source
  const setSourceFilter = (src) => setQP({ source: src })
  const basemap = qp.basemap
  const setBasemap = (b) => setQP({ basemap: b })
  const showLabels = qp.labels === 'on'
  const setShowLabels = (v) => setQP({ labels: v ? 'on' : 'off' })
  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)
  const [photoOverlays, setPhotoOverlays] = useState([]) // { id, x, y, opacity, obs }
  const [hoveredPhoto, setHoveredPhoto] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [speedMult, setSpeedMult] = useState(1)
  const lastNonZeroSpeedRef = useRef(1)

  const cameraModeRef = useRef(cameraMode)
  cameraModeRef.current = cameraMode
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter
  const speedMultRef = useRef(speedMult)
  speedMultRef.current = speedMult

  function getMapView() {
    const map = mapRef.current
    if (!map) return undefined
    const c = map.getCenter()
    const b = map.getBounds()
    return {
      center: { lat: c.lat, lng: c.lng },
      zoom: map.getZoom(),
      bounds: {
        swlat: b.getSouth(),
        swlng: b.getWest(),
        nelat: b.getNorth(),
        nelng: b.getEast(),
      },
    }
  }

  // ─── Build GeoJSON point features with age-based opacity + glow ────────
  function buildGeoJSON() {
    const now = Date.now()
    const features = []
    for (const o of observationsRef.current) {
      const age = now - o.addedAt
      const t = Math.min(age / FADE_DURATION, 1)

      // Opacity: 1.0 when new → 0.1 at end of life
      const opacity = Math.max(0.1, 1.0 - t * 0.9)

      // Glow: bright yellow halo for the first few seconds
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

  // ─── Photo overlays (React-rendered, positioned via map.project) ───────
  function isOnFrontSide(lng, lat) {
    const map = mapRef.current
    if (!map) return false
    const center = map.getCenter()
    const toRad = d => d * Math.PI / 180
    const dLng = toRad(lng - center.lng)
    const lat1 = toRad(center.lat)
    const lat2 = toRad(lat)
    const cosAngle = Math.sin(lat1) * Math.sin(lat2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng)
    return cosAngle > 0.15
  }

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
      if (!isOnFrontSide(obs.lng, obs.lat)) continue

      const pt = map.project([obs.lng, obs.lat])
      // Skip if projected outside viewport
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
    observationsRef.current = observationsRef.current.filter(
      o => (now - o.addedAt) < FADE_DURATION
    )
    if (observationsRef.current.length < before) {
      const activeIds = new Set(observationsRef.current.map(o => o.id))
      seenIdsRef.current = activeIds
    }
    syncSource()
    updatePhotoOverlays()
    updateCounts()
  }

  function updateCounts() {
    const species = new Set()
    observationsRef.current.forEach(o => {
      if (o.scientificName) species.add(o.scientificName)
    })
    setObsCount(observationsRef.current.length)
    setSpeciesCount(species.size)
  }

  function clearObservations() {
    observationsRef.current = []
    seenIdsRef.current.clear()
    dripQueueRef.current = []
    clearTimeout(dripTimerRef.current)
    syncSource()
    updatePhotoOverlays()
    setObsCount(0)
    setSpeciesCount(0)
  }

  function adjustSpeed(delta) {
    setSpeedMult(s => {
      const next = Math.round((s + delta) * 10) / 10
      const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, next))
      if (clamped > 0) lastNonZeroSpeedRef.current = clamped
      return clamped
    })
  }

  function togglePause() {
    setSpeedMult(s => {
      if (s > 0) {
        lastNonZeroSpeedRef.current = s
        return 0
      }
      return lastNonZeroSpeedRef.current || 1
    })
  }

  function dripOne() {
    const queue = dripQueueRef.current
    if (queue.length === 0) return

    const obs = queue.shift()
    if (seenIdsRef.current.has(obs.id)) {
      if (queue.length > 0) scheduleDrip()
      return
    }

    obs.addedAt = Date.now()
    seenIdsRef.current.add(obs.id)
    observationsRef.current.push(obs)
    syncSource()
    updatePhotoOverlays()
    updateCounts()

    if (queue.length > 0) scheduleDrip()
  }

  function scheduleDrip() {
    clearTimeout(dripTimerRef.current)
    const queue = dripQueueRef.current
    if (queue.length === 0) return
    const delay = Math.max(500, DRIP_WINDOW_MS / (queue.length + 1))
    dripTimerRef.current = setTimeout(dripOne, delay)
  }

  // ─── Add source + layers to map ────────────────────────────────────────
  function addLayers(map) {
    if (map.getSource('live-obs')) return

    map.addSource('live-obs', {
      type: 'geojson',
      data: buildGeoJSON(),
    })

    // Yellow glow behind new dots
    map.addLayer({
      id: 'live-obs-glow',
      type: 'circle',
      source: 'live-obs',
      filter: ['>', ['get', 'glowOpacity'], 0],
      paint: {
        'circle-radius': DOT_RADIUS * 3,
        'circle-color': '#ffee00',
        'circle-opacity': ['get', 'glowOpacity'],
        'circle-blur': 1,
      },
    })

    // Orange dots
    map.addLayer({
      id: 'live-obs-dots',
      type: 'circle',
      source: 'live-obs',
      paint: {
        'circle-radius': DOT_RADIUS,
        'circle-color': '#ff6a00',
        'circle-opacity': ['get', 'opacity'],
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#ff8c00',
        'circle-stroke-opacity': ['get', 'opacity'],
      },
    })

    mapReadyRef.current = true
  }

  // ─── Initialize map ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getStyle(basemap, showLabels),
      center: [10, 40],
      zoom: 1.8,
      projection: 'globe',
      attributionControl: false,
      logoPosition: 'bottom-right',
      pitch: 0,
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

    const onInteractStart = () => {
      interactingRef.current = true
      clearTimeout(interactTimeoutRef.current)
    }
    const onInteractEnd = () => {
      clearTimeout(interactTimeoutRef.current)
      interactTimeoutRef.current = setTimeout(() => {
        interactingRef.current = false
      }, 5000)
    }

    map.on('mousedown', onInteractStart)
    map.on('touchstart', onInteractStart)
    map.on('mouseup', onInteractEnd)
    map.on('touchend', onInteractEnd)
    map.on('wheel', () => { onInteractStart(); onInteractEnd() })

    // Update photo overlay positions as globe moves
    map.on('move', () => updatePhotoOverlays())

    mapRef.current = map

    return () => {
      clearTimeout(interactTimeoutRef.current)
      cancelAnimationFrame(rotationRef.current)
      clearTimeout(dripTimerRef.current)
      clearInterval(renderTimerRef.current)
      clearTimeout(flyTimerRef.current)
      clearInterval(fetchTickRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ─── Basemap change ────────────────────────────────────────────────────
  const basemapMountRef = useRef(true)
  useEffect(() => {
    if (basemapMountRef.current) { basemapMountRef.current = false; return }
    const map = mapRef.current
    if (!map) return
    mapReadyRef.current = false
    const applyStyle = () => {
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
    }
    // Wait for any in-progress style load to finish before swapping — calling
    // setStyle mid-load triggers Mapbox's "Unable to perform style diff" warning
    // and forces a full rebuild.
    if (map.isStyleLoaded()) applyStyle()
    else map.once('style.load', applyStyle)
  }, [basemap, showLabels])

  // ─── Override body styles for fullscreen ────────────────────────────────
  useEffect(() => {
    const prev = document.body.style.cssText
    document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#0a0e17;min-height:0;'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.cssText = prev
      document.documentElement.style.overflow = ''
    }
  }, [])

  // ─── Render tick ───────────────────────────────────────────────────────
  useEffect(() => {
    renderTimerRef.current = setInterval(tick, RENDER_TICK)
    return () => clearInterval(renderTimerRef.current)
  }, [])

  // ─── Rotation loop ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let running = true
    function rotateStep() {
      if (!running) return
      if (cameraModeRef.current === CAMERA_ROTATE && !interactingRef.current && !flyingRef.current) {
        const step = ROTATION_SPEED_BASE * speedMultRef.current
        if (step > 0) {
          const center = map.getCenter()
          center.lng = (center.lng + step) % 360
          map.setCenter(center)
        }
      }
      rotationRef.current = requestAnimationFrame(rotateStep)
    }
    rotationRef.current = requestAnimationFrame(rotateStep)
    return () => { running = false; cancelAnimationFrame(rotationRef.current) }
  }, [])

  // ─── Fly-to tour ───────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let running = true
    function flyToNext() {
      if (!running || cameraModeRef.current !== CAMERA_FLYTO) {
        flyingRef.current = false
        return
      }
      const obs = observationsRef.current
      if (obs.length === 0) {
        flyTimerRef.current = setTimeout(flyToNext, 1000)
        return
      }
      const target = obs[Math.floor(Math.random() * obs.length)]
      flyingRef.current = true
      map.flyTo({
        center: [target.lng, target.lat],
        zoom: 4,
        pitch: 45,
        duration: 3000,
        essential: true,
      })
      flyTimerRef.current = setTimeout(flyToNext, 5000)
    }

    if (cameraMode === CAMERA_FLYTO) flyToNext()
    else flyingRef.current = false

    return () => {
      running = false
      clearTimeout(flyTimerRef.current)
      flyingRef.current = false
    }
  }, [cameraMode])

  // ─── Position-driven fetch loop ────────────────────────────────────────
  // Replaces fixed-interval polling. A 1Hz tick checks whether the globe view
  // has shifted enough since the last fetch, or whether the idle refresh
  // interval has elapsed. This keeps observations flowing while the globe
  // rotates (or the user pans) without hammering the APIs when stationary.
  useEffect(() => {
    pollCancelledRef.current = false

    function waitForMap(cb) {
      if (mapReadyRef.current) { cb(); return }
      const check = setInterval(() => {
        if (pollCancelledRef.current) { clearInterval(check); return }
        if (mapReadyRef.current) { clearInterval(check); cb() }
      }, 100)
    }

    // `replace` = wipe existing observations and load the fresh batch with
    // staggered addedAt timestamps (used on first load and big jumps so the
    // globe doesn't look empty during the drip-in). Otherwise we incrementally
    // drip-in only the IDs we haven't seen yet.
    async function doFetch(replace) {
      if (fetchInFlightRef.current) return
      if (cameraModeRef.current === CAMERA_FLYTO && flyingRef.current) return
      fetchInFlightRef.current = true
      const view = getMapView()
      try {
        const observations = await fetchAllRecent(view)
        if (pollCancelledRef.current) return
        const filtered = sourceFilterRef.current === 'All'
          ? observations
          : observations.filter(o => o.source === sourceFilterRef.current)

        if (replace && filtered.length > 0) {
          observationsRef.current = []
          seenIdsRef.current.clear()
          dripQueueRef.current = []
          clearTimeout(dripTimerRef.current)
          const now = Date.now()
          const shuffled = [...filtered].sort(() => Math.random() - 0.5)
          for (let i = 0; i < shuffled.length; i++) {
            const obs = shuffled[i]
            obs.addedAt = now - (i / shuffled.length) * FADE_DURATION * 0.8
            seenIdsRef.current.add(obs.id)
            observationsRef.current.push(obs)
          }
          syncSource()
          updatePhotoOverlays()
          updateCounts()
        } else {
          const newObs = filtered.filter(o => !seenIdsRef.current.has(o.id))
          if (newObs.length > 0) {
            dripQueueRef.current = [...dripQueueRef.current, ...newObs]
            scheduleDrip()
          }
        }

        if (view?.center) {
          lastFetchPosRef.current = { lat: view.center.lat, lng: view.center.lng, zoom: view.zoom }
        }
        lastFetchTimeRef.current = Date.now()
        console.log(`[LiveGlobe] Fetch (${replace ? 'replace' : 'inc'}): ${filtered.length} total, ${observationsRef.current.length} on globe`)
      } catch (err) {
        console.error('[LiveGlobe] Fetch error:', err)
      } finally {
        fetchInFlightRef.current = false
      }
    }

    function tick() {
      if (pollCancelledRef.current || !mapReadyRef.current) return
      if (fetchInFlightRef.current) return
      const map = mapRef.current
      if (!map) return

      const now = Date.now()
      const sinceFetch = now - lastFetchTimeRef.current
      if (sinceFetch < FETCH_MIN_INTERVAL_MS) return

      const last = lastFetchPosRef.current
      if (!last) {
        // First fetch: replace mode so the globe fills immediately
        doFetch(true)
        return
      }

      const c = map.getCenter()
      const z = map.getZoom()
      const dLat = Math.abs(c.lat - last.lat)
      const dLng = lngDelta(c.lng, last.lng)
      const dZoom = Math.abs(z - last.zoom)

      if (dZoom > FETCH_ZOOM_THRESHOLD) {
        // Big zoom change: replace so the new scale's observations dominate
        doFetch(true)
      } else if (dLat > FETCH_POS_THRESHOLD_DEG || dLng > FETCH_POS_THRESHOLD_DEG) {
        // View has moved: drip-in observations from the new area
        doFetch(false)
      } else if (sinceFetch > FETCH_IDLE_INTERVAL_MS) {
        // Stationary but stale: pick up anything fresh from the APIs
        doFetch(false)
      }
    }

    waitForMap(() => {
      if (pollCancelledRef.current) return
      tick()  // fire immediately on mount
      fetchTickRef.current = setInterval(tick, FETCH_TICK_MS)
    })

    return () => {
      pollCancelledRef.current = true
      clearInterval(fetchTickRef.current)
      clearTimeout(dripTimerRef.current)
    }
  }, [])

  // ─── Source filter change ──────────────────────────────────────────────
  const filterMountRef = useRef(true)
  useEffect(() => {
    if (filterMountRef.current) { filterMountRef.current = false; return }

    observationsRef.current = []
    seenIdsRef.current.clear()
    dripQueueRef.current = []
    clearTimeout(dripTimerRef.current)
    syncSource()
    setObsCount(0)
    setSpeciesCount(0)

    // Force the position tick to do a fresh replace-fetch next iteration.
    lastFetchPosRef.current = null
    lastFetchTimeRef.current = 0
  }, [sourceFilter])

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.mapWrap} />

      {/* Photo thumbnails */}
      {photoOverlays.map(p => (
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
                ? `https://earthatlas.org/species/${p.obs.taxonId}`
                : p.obs.scientificName
                  ? `https://earthatlas.org/species/${encodeURIComponent(p.obs.scientificName)}`
                  : null}
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <img
                src={p.obs.photoUrl.replace('/square', '/medium').replace('/small', '/medium')}
                className="live-photo-card-img"
                alt=""
              />
              <div className="live-photo-card-info">
                <div className="live-photo-card-name">{p.obs.commonName || 'Unknown'}</div>
                {p.obs.scientificName && (
                  <div className="live-photo-card-sci">{p.obs.scientificName}</div>
                )}
                {p.obs.location && (
                  <div className="live-photo-card-loc">{p.obs.location}</div>
                )}
                {(() => {
                  const t = formatObservedAt(p.obs.observedAt)
                  if (!t) return null
                  return (
                    <div className="live-photo-card-time">
                      {t.text}
                      {t.hint && <span className="live-photo-card-time-hint"> &middot; {t.hint}</span>}
                    </div>
                  )
                })()}
                <div className="live-photo-card-source">{p.obs.source}</div>
              </div>
            </a>
          )}
        </div>
      ))}

      {/* Branding */}
      <a href="/" className={styles.branding}>
        <span className={styles.wordmark}>
          Earth<em>Atlas</em>
        </span>
        <span className={styles.liveBadge}>
          <span className={styles.liveDot} />
          LIVE
        </span>
      </a>

      {/* Stats */}
      <div className={styles.stats}>
        {obsCount} observations &middot; {speciesCount} species
      </div>

      {/* Play / Pause (rotation) */}
      <button
        className={styles.playPauseBtn}
        onClick={togglePause}
        title={speedMult > 0 ? 'Pause rotation' : 'Play rotation'}
        aria-label={speedMult > 0 ? 'Pause rotation' : 'Play rotation'}
        aria-pressed={speedMult === 0}
      >
        {speedMult > 0 ? '⏸' : '▶'}
      </button>

      {/* Settings (gear) */}
      <div className={styles.settingsWrap}>
        <button
          className={settingsOpen ? styles.settingsBtnActive : styles.settingsBtn}
          onClick={() => setSettingsOpen(v => !v)}
          title="Settings"
          aria-label="Settings"
          aria-expanded={settingsOpen}
        >
          {'⚙️'}
        </button>
        {settingsOpen && (
          <div className={styles.settingsPanel} role="dialog" aria-label="Globe settings">
            <div className={styles.settingsRow}>
              <span className={styles.settingsLabel}>Observations</span>
              <button
                className={styles.settingsActionBtn}
                onClick={clearObservations}
                title="Clear all observations from the globe"
              >
                {'\u{1F5D1}️'} Clear
              </button>
            </div>
            <div className={styles.settingsRow}>
              <span className={styles.settingsLabel}>Camera</span>
              <div className={styles.controls}>
                <button
                  className={cameraMode === CAMERA_ROTATE ? styles.controlBtnActive : styles.controlBtn}
                  onClick={() => setCameraMode(CAMERA_ROTATE)}
                  title="Slow rotation"
                  aria-label="Slow rotation"
                  aria-pressed={cameraMode === CAMERA_ROTATE}
                >
                  {'\u{1F30D}'}
                </button>
                <button
                  className={cameraMode === CAMERA_FLYTO ? styles.controlBtnActive : styles.controlBtn}
                  onClick={() => setCameraMode(CAMERA_FLYTO)}
                  title="Fly to sightings"
                  aria-label="Fly to sightings"
                  aria-pressed={cameraMode === CAMERA_FLYTO}
                >
                  {'✈️'}
                </button>
                <button
                  className={cameraMode === CAMERA_FIXED ? styles.controlBtnActive : styles.controlBtn}
                  onClick={() => setCameraMode(CAMERA_FIXED)}
                  title="Fixed view"
                  aria-label="Fixed view"
                  aria-pressed={cameraMode === CAMERA_FIXED}
                >
                  {'\u{1F512}'}
                </button>
              </div>
            </div>

            <div className={styles.settingsRow}>
              <span className={styles.settingsLabel}>Speed</span>
              <div className={styles.speedControl}>
                <button
                  className={styles.speedBtn}
                  onClick={() => adjustSpeed(-SPEED_STEP)}
                  disabled={speedMult <= SPEED_MIN || cameraMode !== CAMERA_ROTATE}
                  title="Slower"
                  aria-label="Decrease rotation speed"
                >&minus;</button>
                <span className={styles.speedValue}>{speedMult.toFixed(1)}&times;</span>
                <button
                  className={styles.speedBtn}
                  onClick={() => adjustSpeed(SPEED_STEP)}
                  disabled={speedMult >= SPEED_MAX || cameraMode !== CAMERA_ROTATE}
                  title="Faster"
                  aria-label="Increase rotation speed"
                >+</button>
              </div>
            </div>

            <div className={styles.settingsDivider} />

            <div className={styles.settingsRow}>
              <span className={styles.settingsLabel}>Dataset</span>
              <div className={styles.sourceFilter}>
                {['All', 'iNaturalist', 'eBird'].map(src => (
                  <button
                    key={src}
                    className={sourceFilter === src ? styles.sourceBtnActive : styles.sourceBtn}
                    onClick={() => setSourceFilter(src)}
                    aria-pressed={sourceFilter === src}
                  >
                    {src}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.settingsRowStacked}>
              <span className={styles.settingsLabel}>Basemap</span>
              <div className={styles.basemapSelector}>
                <select
                  className={styles.basemapSelect}
                  value={basemap}
                  onChange={e => setBasemap(e.target.value)}
                  aria-label="Basemap"
                >
                  {Object.keys(BASEMAPS).map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  className={showLabels ? styles.labelsBtnActive : styles.labelsBtn}
                  onClick={() => setShowLabels(!showLabels)}
                  title="Toggle place labels"
                  aria-pressed={showLabels}
                >
                  Labels
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
