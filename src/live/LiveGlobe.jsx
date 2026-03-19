import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchAllRecent } from './liveService'
import styles from './LiveGlobe.module.css'

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
const POLL_INTERVAL = 60000
const ROTATION_SPEED = 0.03
const RENDER_TICK = 1000
const DOT_RADIUS = 4

// Basemaps: string = Mapbox style URL, object = custom XYZ raster tiles
const BASEMAPS = {
  // ── Featured ──
  'NASA Blue Marble': {
    tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'],
    attribution: '&copy; NASA GIBS',
    maxzoom: 8,
  },
  'NASA Blue Marble (Next Gen)': {
    tiles: ['https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/2004-08/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'],
    attribution: '&copy; NASA GIBS',
    maxzoom: 8,
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
function buildCustomStyle(config) {
  return {
    version: 8,
    glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
    sources: {
      'custom-tiles': {
        type: 'raster',
        tiles: config.tiles,
        tileSize: config.tileSize || 256,
        attribution: config.attribution || '',
        maxzoom: config.maxzoom || 19,
      },
    },
    layers: [
      {
        id: 'custom-tiles-layer',
        type: 'raster',
        source: 'custom-tiles',
      },
    ],
  }
}

function getStyle(basemap) {
  const entry = BASEMAPS[basemap]
  if (typeof entry === 'string') return entry
  return buildCustomStyle(entry)
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
  const pollIntervalRef = useRef(null)
  const pollCancelledRef = useRef(false)

  const [cameraMode, setCameraMode] = useState(CAMERA_ROTATE)
  const [sourceFilter, setSourceFilter] = useState('All')
  const [basemap, setBasemap] = useState('Mapbox Dark')
  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)
  const [photoOverlays, setPhotoOverlays] = useState([]) // { id, x, y, opacity, obs }
  const [hoveredPhoto, setHoveredPhoto] = useState(null)

  const cameraModeRef = useRef(cameraMode)
  cameraModeRef.current = cameraMode
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter

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
    const delay = Math.max(500, POLL_INTERVAL / (queue.length + 1))
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
      style: getStyle(basemap),
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
      clearInterval(pollIntervalRef.current)
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
    map.setStyle(getStyle(basemap))
  }, [basemap])

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
        const center = map.getCenter()
        center.lng = (center.lng + ROTATION_SPEED) % 360
        map.setCenter(center)
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

  // ─── Polling loop ──────────────────────────────────────────────────────
  useEffect(() => {
    pollCancelledRef.current = false

    function waitForMap(cb) {
      if (mapReadyRef.current) { cb(); return }
      const check = setInterval(() => {
        if (pollCancelledRef.current) { clearInterval(check); return }
        if (mapReadyRef.current) { clearInterval(check); cb() }
      }, 100)
    }

    async function poll() {
      try {
        const observations = await fetchAllRecent()
        if (pollCancelledRef.current) return

        const filtered = sourceFilterRef.current === 'All'
          ? observations
          : observations.filter(o => o.source === sourceFilterRef.current)

        const newObs = filtered.filter(o => !seenIdsRef.current.has(o.id))

        if (observationsRef.current.length === 0 && newObs.length === 0) {
          dripQueueRef.current = [...filtered]
          const fastDrip = () => {
            if (pollCancelledRef.current || dripQueueRef.current.length === 0) return
            dripOne()
            dripTimerRef.current = setTimeout(fastDrip, 200)
          }
          fastDrip()
        } else if (newObs.length > 0) {
          dripQueueRef.current = [...dripQueueRef.current, ...newObs]
          scheduleDrip()
        }

        console.log(`[LiveGlobe] Poll: ${filtered.length} total, ${newObs.length} new, ${observationsRef.current.length} on globe`)
      } catch (err) {
        console.error('[LiveGlobe] Poll error:', err)
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

    fetchAllRecent().then(observations => {
      const filtered = sourceFilter === 'All'
        ? observations
        : observations.filter(o => o.source === sourceFilter)
      dripQueueRef.current = filtered
      const fastDrip = () => {
        if (dripQueueRef.current.length === 0) return
        dripOne()
        dripTimerRef.current = setTimeout(fastDrip, 200)
      }
      fastDrip()
    }).catch(() => {})
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
            opacity: p.opacity,
            zIndex: hoveredPhoto === p.id ? 50 : 5,
            pointerEvents: 'auto',
          }}
          onMouseEnter={() => setHoveredPhoto(p.id)}
          onMouseLeave={() => setHoveredPhoto(null)}
        >
          <img src={p.obs.photoUrl} className="live-photo-thumb" alt="" />
          <div className="live-photo-stem" />
          {hoveredPhoto === p.id && (
            <div className="live-photo-card visible">
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
                <div className="live-photo-card-source">{p.obs.source}</div>
              </div>
            </div>
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

      {/* Camera mode controls */}
      <div className={styles.controls}>
        <button
          className={cameraMode === CAMERA_ROTATE ? styles.controlBtnActive : styles.controlBtn}
          onClick={() => setCameraMode(CAMERA_ROTATE)}
          title="Slow rotation"
        >
          {'\u{1F30D}'}
        </button>
        <button
          className={cameraMode === CAMERA_FLYTO ? styles.controlBtnActive : styles.controlBtn}
          onClick={() => setCameraMode(CAMERA_FLYTO)}
          title="Fly to sightings"
        >
          {'\u2708\uFE0F'}
        </button>
        <button
          className={cameraMode === CAMERA_FIXED ? styles.controlBtnActive : styles.controlBtn}
          onClick={() => setCameraMode(CAMERA_FIXED)}
          title="Fixed view"
        >
          {'\u{1F512}'}
        </button>
      </div>

      {/* Source filter */}
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

      {/* Basemap selector */}
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
      </div>
    </div>
  )
}
