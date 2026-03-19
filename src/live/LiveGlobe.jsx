import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchAllRecent } from './liveService'
import styles from './LiveGlobe.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// ─── Constants ────────────────────────────────────────────────────────────
const CAMERA_ROTATE = 'rotate'
const CAMERA_FLYTO = 'flyto'
const CAMERA_FIXED = 'fixed'

const COLOR_NEW = '#ff6a00'       // bright orange for new observations
const COLOR_OLD = '#8b3a00'       // dark orange for fading observations
const FADE_DURATION = 5 * 60 * 1000
const GLOW_DURATION = 60 * 1000   // glow visible for first 60s
const POLL_INTERVAL = 60000
const ROTATION_SPEED = 0.03
const RENDER_TICK = 1000
const MAX_HEIGHT = 800000
const COLUMN_SIZE = 0.12
const GLOW_SIZE = 0.35

const BASEMAPS = {
  'Satellite': 'mapbox://styles/mapbox/satellite-streets-v12',
  'Satellite (no labels)': 'mapbox://styles/mapbox/satellite-v9',
  'Dark': 'mapbox://styles/mapbox/dark-v11',
  'Light': 'mapbox://styles/mapbox/light-v11',
  'Outdoors': 'mapbox://styles/mapbox/outdoors-v12',
  'Streets': 'mapbox://styles/mapbox/streets-v12',
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
  const [basemap, setBasemap] = useState('Satellite')
  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)

  const cameraModeRef = useRef(cameraMode)
  cameraModeRef.current = cameraMode
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter

  // ─── Build GeoJSON with age-based height & opacity ─────────────────────
  function buildGeoJSON() {
    const now = Date.now()
    const features = []
    for (const o of observationsRef.current) {
      const age = now - o.addedAt
      const t = Math.min(age / FADE_DURATION, 1)

      // Height: dramatic drop — new columns are very tall, shrink with sqrt curve
      const height = Math.max(2000, MAX_HEIGHT * Math.pow(1 - t, 0.5))

      // Color: bright yellow-white → orange → dark brown
      // t=0: rgb(255, 240, 80) hot yellow
      // t=0.3: rgb(255, 120, 0) bright orange
      // t=1: rgb(100, 30, 0) dark brown
      const r = Math.round(255 - t * (255 - 100))
      const g = Math.round(240 - t * (240 - 30))
      const b = Math.round(80 - t * 80)
      const color = `rgb(${r},${g},${b})`

      // Opacity: very bright at first, fades aggressively
      const opacity = Math.max(0.06, Math.pow(1 - t, 0.7))

      const s = COLUMN_SIZE
      const lng = o.lng, lat = o.lat
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [lng - s, lat - s],
            [lng + s, lat - s],
            [lng + s, lat + s],
            [lng - s, lat + s],
            [lng - s, lat - s],
          ]],
        },
        properties: { opacity, height, color, kind: 'column' },
      })

      // Glow halo at the base for new observations
      const glowT = Math.min(age / GLOW_DURATION, 1)
      if (glowT < 1) {
        const glowOpacity = 0.7 * (1 - glowT)
        const gs = GLOW_SIZE * (1 - glowT * 0.5) // shrinks slightly as it fades
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [lng - gs, lat - gs],
              [lng + gs, lat - gs],
              [lng + gs, lat + gs],
              [lng - gs, lat + gs],
              [lng - gs, lat - gs],
            ]],
          },
          properties: {
            opacity: glowOpacity,
            height: 5000,
            color: `rgb(255, 255, ${Math.round(100 + 155 * (1 - glowT))})`,
            kind: 'glow',
          },
        })
      }
    }
    return { type: 'FeatureCollection', features }
  }

  function syncSource() {
    const src = mapRef.current?.getSource('live-obs')
    if (!src) return
    src.setData(buildGeoJSON())
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

    // Glow halo layer (rendered first, behind columns)
    map.addLayer({
      id: 'live-obs-glow',
      type: 'fill-extrusion',
      source: 'live-obs',
      filter: ['==', ['get', 'kind'], 'glow'],
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': ['get', 'opacity'],
      },
    })

    // Main columns
    map.addLayer({
      id: 'live-obs-columns',
      type: 'fill-extrusion',
      source: 'live-obs',
      filter: ['==', ['get', 'kind'], 'column'],
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'height'],
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': ['get', 'opacity'],
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
      style: BASEMAPS[basemap],
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
    // setStyle triggers style.load which re-adds source/layers via addLayers
    mapReadyRef.current = false
    map.setStyle(BASEMAPS[basemap])
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
