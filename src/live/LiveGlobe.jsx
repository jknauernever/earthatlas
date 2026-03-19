import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { fetchAllRecent } from './liveService'
import styles from './LiveGlobe.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// ─── Taxon color palette ──────────────────────────────────────────────────
const TAXON_COLORS = {
  Aves: '#4ecdc4',
  Mammalia: '#ff9f43',
  Insecta: '#a29bfe',
  Arachnida: '#a29bfe',
  Reptilia: '#6ab04c',
  Amphibia: '#22a6b3',
  Plantae: '#badc58',
  Fungi: '#e056a0',
  Actinopterygii: '#0abde3',
  Mollusca: '#c7a0dc',
  Chromista: '#95afc0',
}
const DEFAULT_COLOR = '#dfe6e9'

function taxonColor(iconic) {
  return TAXON_COLORS[iconic] || DEFAULT_COLOR
}

// ─── Camera modes ─────────────────────────────────────────────────────────
const CAMERA_ROTATE = 'rotate'
const CAMERA_FLYTO = 'flyto'
const CAMERA_FIXED = 'fixed'

const MAX_OBS = 200
const POLL_INTERVAL = 60000
const ROTATION_SPEED = 0.03

export default function LiveGlobe() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const observationsRef = useRef([]) // array of obs objects currently on globe
  const animQueueRef = useRef([])
  const animTimerRef = useRef(null)
  const rotationRef = useRef(null)
  const interactingRef = useRef(false)
  const interactTimeoutRef = useRef(null)
  const seenIdsRef = useRef(new Set())

  const [cameraMode, setCameraMode] = useState(CAMERA_ROTATE)
  const [sourceFilter, setSourceFilter] = useState('All')
  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)

  const cameraModeRef = useRef(cameraMode)
  cameraModeRef.current = cameraMode
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter

  // ─── Build GeoJSON from observations ───────────────────────────────────
  function buildGeoJSON(obs) {
    return {
      type: 'FeatureCollection',
      features: obs.map(o => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
        properties: {
          id: o.id,
          color: taxonColor(o.iconicTaxon),
          commonName: o.commonName,
          source: o.source,
        },
      })),
    }
  }

  // ─── Push current observations to the map source ───────────────────────
  function syncSource() {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('live-obs')
    if (!src) return
    src.setData(buildGeoJSON(observationsRef.current))
  }

  // ─── Initialize map ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [10, 20],
      zoom: 1.8,
      projection: 'globe',
      attributionControl: false,
      logoPosition: 'bottom-right',
    })

    // Dreamy atmosphere
    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(10, 14, 23)',
        'high-color': 'rgb(20, 30, 60)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(6, 8, 16)',
        'star-intensity': 0.7,
      })
    })

    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Add GL layers on load
    map.on('load', () => {
      map.addSource('live-obs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Outer glow layer
      map.addLayer({
        id: 'live-obs-glow',
        type: 'circle',
        source: 'live-obs',
        paint: {
          'circle-radius': 14,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.12,
          'circle-blur': 1,
        },
      })

      // Main dot layer
      map.addLayer({
        id: 'live-obs-dots',
        type: 'circle',
        source: 'live-obs',
        paint: {
          'circle-radius': 5,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.9,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1,
          'circle-stroke-opacity': 0.4,
        },
      })
    })

    // Track user interaction for rotation pause
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
      clearTimeout(animTimerRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ─── Rotation loop ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let running = true

    function rotateStep() {
      if (!running) return
      if (cameraModeRef.current === CAMERA_ROTATE && !interactingRef.current) {
        const center = map.getCenter()
        // Spin the globe on its north/south axis by shifting longitude
        center.lng = (center.lng + ROTATION_SPEED) % 360
        map.setCenter(center)
      }
      rotationRef.current = requestAnimationFrame(rotateStep)
    }

    rotationRef.current = requestAnimationFrame(rotateStep)
    return () => {
      running = false
      cancelAnimationFrame(rotationRef.current)
    }
  }, [])

  // ─── Add observation to the globe ──────────────────────────────────────
  const addObservation = useCallback((obs) => {
    const map = mapRef.current
    if (!map) return

    // Source filter
    if (sourceFilterRef.current !== 'All' && obs.source !== sourceFilterRef.current) return

    // Already shown?
    if (seenIdsRef.current.has(obs.id)) return
    seenIdsRef.current.add(obs.id)

    // Cap: remove oldest
    if (observationsRef.current.length >= MAX_OBS) {
      observationsRef.current.shift()
    }

    observationsRef.current.push(obs)
    syncSource()

    // Fly-to mode
    if (cameraModeRef.current === CAMERA_FLYTO) {
      map.flyTo({
        center: [obs.lng, obs.lat],
        zoom: 3.5,
        pitch: 40,
        duration: 3000,
        essential: true,
      })
    }

    // Update counts
    const species = new Set()
    observationsRef.current.forEach(o => {
      if (o.scientificName) species.add(o.scientificName)
    })
    setObsCount(observationsRef.current.length)
    setSpeciesCount(species.size)
  }, [])

  // ─── Animation queue: stagger new observations ─────────────────────────
  function processQueue() {
    const queue = animQueueRef.current
    if (queue.length === 0) return

    addObservation(queue.shift())

    const delay = queue.length > 0
      ? Math.max(1500, Math.min(4000, POLL_INTERVAL / (queue.length + 1)))
      : 2000
    animTimerRef.current = setTimeout(processQueue, delay)
  }

  // ─── Polling loop ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const observations = await fetchAllRecent()
        if (cancelled) return

        const newObs = observations.filter(o => !seenIdsRef.current.has(o.id))

        if (observationsRef.current.length === 0 && newObs.length === 0) {
          // First load — seed with stagger
          const initial = observations.slice(0, MAX_OBS)
          animQueueRef.current = [...animQueueRef.current, ...initial]
          clearTimeout(animTimerRef.current)
          const fastProcess = () => {
            const q = animQueueRef.current
            if (q.length === 0 || cancelled) return
            addObservation(q.shift())
            animTimerRef.current = setTimeout(fastProcess, 300)
          }
          fastProcess()
        } else if (newObs.length > 0) {
          animQueueRef.current = [...animQueueRef.current, ...newObs]
          if (animQueueRef.current.length === newObs.length) {
            clearTimeout(animTimerRef.current)
            processQueue()
          }
        }
      } catch (err) {
        console.error('[LiveGlobe] Poll error:', err)
      }
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL)

    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(animTimerRef.current)
    }
  }, [addObservation])

  // ─── Source filter change ──────────────────────────────────────────────
  const filterMountRef = useRef(true)
  useEffect(() => {
    if (filterMountRef.current) { filterMountRef.current = false; return }

    observationsRef.current = []
    seenIdsRef.current.clear()
    animQueueRef.current = []
    clearTimeout(animTimerRef.current)
    animTimerRef.current = null
    syncSource()
    setObsCount(0)
    setSpeciesCount(0)

    fetchAllRecent().then(observations => {
      const filtered = sourceFilter === 'All'
        ? observations
        : observations.filter(o => o.source === sourceFilter)
      const initial = filtered.slice(0, MAX_OBS)
      animQueueRef.current = initial
      const fastProcess = () => {
        const q = animQueueRef.current
        if (q.length === 0) return
        addObservation(q.shift())
        animTimerRef.current = setTimeout(fastProcess, 300)
      }
      fastProcess()
    }).catch(() => {})
  }, [sourceFilter, addObservation])

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
    </div>
  )
}
