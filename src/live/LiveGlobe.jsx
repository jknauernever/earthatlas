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

const DOT_COLOR = '#4ecdc4'            // single color for all dots
const FADE_DURATION = 5 * 60 * 1000    // 5 minutes to fully fade
const POLL_INTERVAL = 60000            // fetch new data every 60s
const ROTATION_SPEED = 0.03            // degrees per frame
const RENDER_TICK = 1000               // update dot opacities every 1s

export default function LiveGlobe() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const mapReadyRef = useRef(false)

  // Each obs: { id, lng, lat, addedAt, commonName, scientificName, source, ... }
  const observationsRef = useRef([])
  const seenIdsRef = useRef(new Set())
  const dripQueueRef = useRef([])      // new obs waiting to be dripped onto globe
  const dripTimerRef = useRef(null)
  const renderTimerRef = useRef(null)

  const rotationRef = useRef(null)
  const interactingRef = useRef(false)
  const interactTimeoutRef = useRef(null)
  const flyingRef = useRef(false)
  const flyTimerRef = useRef(null)

  const [cameraMode, setCameraMode] = useState(CAMERA_ROTATE)
  const [sourceFilter, setSourceFilter] = useState('All')
  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)

  const cameraModeRef = useRef(cameraMode)
  cameraModeRef.current = cameraMode
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter

  // ─── Build GeoJSON with age-based opacity ──────────────────────────────
  function buildGeoJSON() {
    const now = Date.now()
    return {
      type: 'FeatureCollection',
      features: observationsRef.current.map(o => {
        const age = now - o.addedAt
        // 1.0 when brand new → 0.08 at FADE_DURATION
        const opacity = Math.max(0.08, 1.0 - (age / FADE_DURATION) * 0.92)
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [o.lng, o.lat] },
          properties: { opacity },
        }
      }),
    }
  }

  // ─── Push current state to map ─────────────────────────────────────────
  function syncSource() {
    const src = mapRef.current?.getSource('live-obs')
    if (!src) return
    src.setData(buildGeoJSON())
  }

  // ─── Expire old observations & refresh display ─────────────────────────
  function tick() {
    const now = Date.now()
    const before = observationsRef.current.length
    observationsRef.current = observationsRef.current.filter(
      o => (now - o.addedAt) < FADE_DURATION
    )
    // Clean up seenIds for expired obs so they could re-appear if re-fetched
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

  // ─── Drip a single observation onto the globe ──────────────────────────
  function dripOne() {
    const queue = dripQueueRef.current
    if (queue.length === 0) return

    const obs = queue.shift()
    // Skip if already on globe (shouldn't happen but safety check)
    if (seenIdsRef.current.has(obs.id)) {
      // Try next one immediately
      if (queue.length > 0) scheduleDrip()
      return
    }

    obs.addedAt = Date.now()
    seenIdsRef.current.add(obs.id)
    observationsRef.current.push(obs)
    syncSource()
    updateCounts()

    // Schedule next drip
    if (queue.length > 0) scheduleDrip()
  }

  function scheduleDrip() {
    clearTimeout(dripTimerRef.current)
    const queue = dripQueueRef.current
    if (queue.length === 0) return
    // Spread remaining queue evenly across the poll interval
    const delay = Math.max(500, POLL_INTERVAL / (queue.length + 1))
    dripTimerRef.current = setTimeout(dripOne, delay)
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

    map.on('load', () => {
      map.addSource('live-obs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Outer glow — uses per-feature opacity
      map.addLayer({
        id: 'live-obs-glow',
        type: 'circle',
        source: 'live-obs',
        paint: {
          'circle-radius': 16,
          'circle-color': DOT_COLOR,
          'circle-opacity': ['*', ['get', 'opacity'], 0.15],
          'circle-blur': 1,
        },
      })

      // Main dot — uses per-feature opacity
      map.addLayer({
        id: 'live-obs-dots',
        type: 'circle',
        source: 'live-obs',
        paint: {
          'circle-radius': 4,
          'circle-color': DOT_COLOR,
          'circle-opacity': ['get', 'opacity'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 0.8,
          'circle-stroke-opacity': ['*', ['get', 'opacity'], 0.5],
        },
      })

      mapReadyRef.current = true
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
      clearTimeout(dripTimerRef.current)
      clearInterval(renderTimerRef.current)
      clearTimeout(flyTimerRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [])

  // ─── Render tick: update opacities & expire old dots ───────────────────
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
      // 3s fly + 2s dwell
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
    let cancelled = false
    let pollInterval = null

    function waitForMap(cb) {
      if (mapReadyRef.current) { cb(); return }
      const check = setInterval(() => {
        if (cancelled) { clearInterval(check); return }
        if (mapReadyRef.current) { clearInterval(check); cb() }
      }, 100)
    }

    async function poll() {
      try {
        const observations = await fetchAllRecent()
        if (cancelled) return

        // Apply source filter
        const filtered = sourceFilterRef.current === 'All'
          ? observations
          : observations.filter(o => o.source === sourceFilterRef.current)

        // Find new observations not already on globe
        const newObs = filtered.filter(o => !seenIdsRef.current.has(o.id))

        if (observationsRef.current.length === 0 && newObs.length === 0) {
          // Very first load — drip all fetched observations in quickly
          dripQueueRef.current = [...filtered]
          // Fast initial drip: ~200ms apart
          const fastDrip = () => {
            if (cancelled || dripQueueRef.current.length === 0) return
            dripOne()
            dripTimerRef.current = setTimeout(fastDrip, 200)
          }
          fastDrip()
        } else if (newObs.length > 0) {
          // Subsequent polls — queue new obs and spread them out
          dripQueueRef.current = [...dripQueueRef.current, ...newObs]
          scheduleDrip()
        }

        console.log(`[LiveGlobe] Poll: ${filtered.length} total, ${newObs.length} new, ${observationsRef.current.length} on globe`)
      } catch (err) {
        console.error('[LiveGlobe] Poll error:', err)
      }
    }

    waitForMap(() => {
      if (cancelled) return
      poll()
      pollInterval = setInterval(poll, POLL_INTERVAL)
    })

    return () => {
      cancelled = true
      clearInterval(pollInterval)
      clearTimeout(dripTimerRef.current)
    }
  }, [])

  // ─── Source filter change ──────────────────────────────────────────────
  const filterMountRef = useRef(true)
  useEffect(() => {
    if (filterMountRef.current) { filterMountRef.current = false; return }

    // Clear everything
    observationsRef.current = []
    seenIdsRef.current.clear()
    dripQueueRef.current = []
    clearTimeout(dripTimerRef.current)
    syncSource()
    setObsCount(0)
    setSpeciesCount(0)

    // Re-fetch and drip
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
    </div>
  )
}
