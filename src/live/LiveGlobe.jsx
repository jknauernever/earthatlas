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

const TAXON_EMOJI = {
  Aves: '\u{1F426}',
  Mammalia: '\u{1F43E}',
  Insecta: '\u{1F98B}',
  Arachnida: '\u{1F577}',
  Reptilia: '\u{1F98E}',
  Amphibia: '\u{1F438}',
  Plantae: '\u{1F33F}',
  Fungi: '\u{1F344}',
  Actinopterygii: '\u{1F41F}',
  Mollusca: '\u{1F41A}',
}

// ─── Camera modes ─────────────────────────────────────────────────────────
const CAMERA_ROTATE = 'rotate'
const CAMERA_FLYTO = 'flyto'
const CAMERA_FIXED = 'fixed'

// Max observations on the globe at once
const MAX_OBS = 200
// How long a card stays visible (ms)
const CARD_LINGER = 12000
// Poll interval (ms)
const POLL_INTERVAL = 60000
// Rotation speed (degrees per frame at ~60fps)
const ROTATION_SPEED = 0.03

export default function LiveGlobe() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef(new Map()) // id → { marker, obs, addedAt }
  const animQueueRef = useRef([])
  const animTimerRef = useRef(null)
  const rotationRef = useRef(null)
  const interactingRef = useRef(false)
  const interactTimeoutRef = useRef(null)
  const seenIdsRef = useRef(new Set())
  const activeCardsRef = useRef(new Map()) // id → { element, timer, lineId }
  const lineIdCounter = useRef(0)

  const [cameraMode, setCameraMode] = useState(CAMERA_ROTATE)
  const [sourceFilter, setSourceFilter] = useState('All')
  const [obsCount, setObsCount] = useState(0)
  const [speciesCount, setSpeciesCount] = useState(0)

  const cameraModeRef = useRef(cameraMode)
  cameraModeRef.current = cameraMode
  const sourceFilterRef = useRef(sourceFilter)
  sourceFilterRef.current = sourceFilter

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
      pitch: 0,
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
      // Clean up markers
      markersRef.current.forEach(({ marker }) => marker.remove())
      markersRef.current.clear()
      // Clean up cards
      activeCardsRef.current.forEach(({ element, timer }) => {
        clearTimeout(timer)
        element?.remove()
      })
      activeCardsRef.current.clear()
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
        const bearing = map.getBearing() + ROTATION_SPEED
        map.setBearing(bearing % 360)
      }
      rotationRef.current = requestAnimationFrame(rotateStep)
    }

    rotationRef.current = requestAnimationFrame(rotateStep)
    return () => {
      running = false
      cancelAnimationFrame(rotationRef.current)
    }
  }, [])

  // ─── Card positioning (update on map move) ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    function updateCardPositions() {
      activeCardsRef.current.forEach(({ element, obs }) => {
        if (!element || !map) return
        const pos = map.project([obs.lng, obs.lat])
        // Offset card above and to the right of the dot
        element.style.left = `${pos.x + 20}px`
        element.style.top = `${pos.y - 140}px`
      })
      // Update SVG lines
      updateLines()
    }

    map.on('move', updateCardPositions)
    return () => map.off('move', updateCardPositions)
  }, [])

  // ─── SVG line management ───────────────────────────────────────────────
  const svgRef = useRef(null)

  function updateLines() {
    const map = mapRef.current
    const svg = svgRef.current
    if (!map || !svg) return

    activeCardsRef.current.forEach(({ obs, lineId, element }) => {
      const line = svg.querySelector(`[data-line-id="${lineId}"]`)
      if (!line || !element) return

      const dotPos = map.project([obs.lng, obs.lat])
      const cardRect = element.getBoundingClientRect()
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect) return

      const cardX = cardRect.left - containerRect.left + cardRect.width * 0.1
      const cardY = cardRect.top - containerRect.top + cardRect.height

      line.setAttribute('x1', dotPos.x)
      line.setAttribute('y1', dotPos.y)
      line.setAttribute('x2', cardX)
      line.setAttribute('y2', cardY)
    })
  }

  // ─── Add observation to the globe ──────────────────────────────────────
  const addObservation = useCallback((obs) => {
    const map = mapRef.current
    if (!map) return

    // Source filter
    if (sourceFilterRef.current !== 'All' && obs.source !== sourceFilterRef.current) return

    // Already shown?
    if (markersRef.current.has(obs.id)) return

    // Cap: remove oldest if at limit
    if (markersRef.current.size >= MAX_OBS) {
      let oldestId = null
      let oldestTime = Infinity
      markersRef.current.forEach(({ addedAt }, id) => {
        if (addedAt < oldestTime) { oldestTime = addedAt; oldestId = id }
      })
      if (oldestId) removeObservation(oldestId)
    }

    const color = taxonColor(obs.iconicTaxon)

    // Create pulsing dot marker
    const el = document.createElement('div')
    el.className = styles.dotNew
    el.style.background = color
    el.style.boxShadow = `0 0 8px ${color}, 0 0 20px ${color}60`

    const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
      .setLngLat([obs.lng, obs.lat])
      .addTo(map)

    markersRef.current.set(obs.id, { marker, obs, addedAt: Date.now() })
    seenIdsRef.current.add(obs.id)

    // After dot appear animation, switch to normal pulse
    setTimeout(() => {
      el.className = styles.dot
      el.style.background = color
      el.style.boxShadow = `0 0 8px ${color}, 0 0 20px ${color}60`
    }, 700)

    // Show card
    showCard(obs, color)

    // Fly-to mode: fly to this observation
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
    updateStats()
  }, [])

  // ─── Show floating card ────────────────────────────────────────────────
  function showCard(obs, color) {
    const map = mapRef.current
    if (!map) return

    // Limit concurrent cards to 4
    if (activeCardsRef.current.size >= 4) {
      const oldest = activeCardsRef.current.entries().next().value
      if (oldest) dismissCard(oldest[0])
    }

    const lineId = ++lineIdCounter.current
    const pos = map.project([obs.lng, obs.lat])
    const emoji = TAXON_EMOJI[obs.iconicTaxon] || ''

    const card = document.createElement('div')
    card.className = styles.card
    card.style.left = `${pos.x + 20}px`
    card.style.top = `${pos.y - 140}px`
    card.style.borderColor = `${color}30`

    // Glow border
    const glow = document.createElement('div')
    glow.className = styles.cardGlow
    glow.style.boxShadow = `inset 0 0 30px ${color}15, 0 0 20px ${color}10`
    card.appendChild(glow)

    // Photo or emoji placeholder
    if (obs.photoUrl) {
      const img = document.createElement('img')
      img.className = styles.cardPhoto
      img.src = obs.photoUrl
      img.alt = obs.commonName
      img.onerror = () => { img.style.display = 'none' }
      card.appendChild(img)
    } else {
      const ph = document.createElement('div')
      ph.className = styles.cardNoPhoto
      ph.textContent = emoji
      card.appendChild(ph)
    }

    // Body
    const body = document.createElement('div')
    body.className = styles.cardBody

    const name = document.createElement('div')
    name.className = styles.cardName
    name.textContent = obs.commonName
    body.appendChild(name)

    if (obs.scientificName) {
      const sci = document.createElement('div')
      sci.className = styles.cardSci
      sci.textContent = obs.scientificName
      body.appendChild(sci)
    }

    if (obs.location) {
      const loc = document.createElement('div')
      loc.className = styles.cardLocation
      const pin = document.createElement('span')
      pin.style.opacity = '0.6'
      pin.textContent = '\u{1F4CD}'
      loc.appendChild(pin)
      loc.appendChild(document.createTextNode(' ' + obs.location))
      body.appendChild(loc)
    }

    const src = document.createElement('div')
    src.className = styles.cardSource
    src.style.color = `${color}80`
    src.textContent = `via ${obs.source}`
    body.appendChild(src)

    card.appendChild(body)

    // Add connecting line to SVG
    const svg = svgRef.current
    if (svg) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      line.setAttribute('data-line-id', lineId)
      line.setAttribute('stroke', color)
      line.setAttribute('x1', pos.x)
      line.setAttribute('y1', pos.y)
      line.setAttribute('x2', pos.x + 20)
      line.setAttribute('y2', pos.y - 40)
      line.classList.add(styles.connectLine)
      svg.appendChild(line)
    }

    // Add card to container
    containerRef.current?.appendChild(card)

    // Schedule removal
    const timer = setTimeout(() => dismissCard(obs.id), CARD_LINGER)
    activeCardsRef.current.set(obs.id, { element: card, obs, timer, lineId })

    // Position update
    updateLines()
  }

  // ─── Dismiss card ──────────────────────────────────────────────────────
  function dismissCard(obsId) {
    const entry = activeCardsRef.current.get(obsId)
    if (!entry) return

    clearTimeout(entry.timer)

    // Fade out card
    entry.element.classList.add(styles.cardOut)
    setTimeout(() => entry.element.remove(), 800)

    // Fade out line
    const svg = svgRef.current
    if (svg) {
      const line = svg.querySelector(`[data-line-id="${entry.lineId}"]`)
      if (line) {
        line.classList.add(styles.connectLineOut)
        setTimeout(() => line.remove(), 600)
      }
    }

    // Dim the dot
    const markerEntry = markersRef.current.get(obsId)
    if (markerEntry) {
      markerEntry.marker.getElement().className = styles.dotFaded
    }

    activeCardsRef.current.delete(obsId)
  }

  // ─── Remove observation entirely ───────────────────────────────────────
  function removeObservation(obsId) {
    dismissCard(obsId)
    const entry = markersRef.current.get(obsId)
    if (entry) {
      entry.marker.remove()
      markersRef.current.delete(obsId)
    }
  }

  // ─── Update stats ──────────────────────────────────────────────────────
  function updateStats() {
    const species = new Set()
    markersRef.current.forEach(({ obs }) => {
      if (obs.scientificName) species.add(obs.scientificName)
    })
    setObsCount(markersRef.current.size)
    setSpeciesCount(species.size)
  }

  // ─── Animation queue: stagger new observations ─────────────────────────
  function processQueue() {
    const queue = animQueueRef.current
    if (queue.length === 0) return

    const obs = queue.shift()
    addObservation(obs)

    // Space out animations: target ~2-3 seconds between each
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

        // Filter to new observations only
        const newObs = observations.filter(o => !seenIdsRef.current.has(o.id))

        // On first load, seed the globe with a spread of observations
        if (markersRef.current.size === 0 && newObs.length === 0) {
          // First load: add all (up to MAX_OBS) directly, staggered
          const initial = observations.slice(0, MAX_OBS)
          animQueueRef.current = [...animQueueRef.current, ...initial]
          if (!animTimerRef.current || animQueueRef.current.length === initial.length) {
            clearTimeout(animTimerRef.current)
            // Faster stagger on initial load
            const fastProcess = () => {
              const q = animQueueRef.current
              if (q.length === 0 || cancelled) return
              addObservation(q.shift())
              animTimerRef.current = setTimeout(fastProcess, 300)
            }
            fastProcess()
          }
        } else if (newObs.length > 0) {
          // Add new observations to queue
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

    // Initial fetch
    poll()

    // Set up interval
    const interval = setInterval(poll, POLL_INTERVAL)

    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(animTimerRef.current)
    }
  }, [addObservation])

  // ─── Source filter change: clear and re-fetch ──────────────────────────
  const filterMountRef = useRef(true)
  useEffect(() => {
    // Skip initial mount (polling effect handles first load)
    if (filterMountRef.current) { filterMountRef.current = false; return }

    // Clear everything and re-seed on filter change
    markersRef.current.forEach(({ marker }) => marker.remove())
    markersRef.current.clear()
    activeCardsRef.current.forEach(({ element, timer }) => {
      clearTimeout(timer)
      element?.remove()
    })
    activeCardsRef.current.clear()
    seenIdsRef.current.clear()
    animQueueRef.current = []
    clearTimeout(animTimerRef.current)
    animTimerRef.current = null

    // Clear SVG lines
    if (svgRef.current) svgRef.current.innerHTML = ''

    setObsCount(0)
    setSpeciesCount(0)

    // Re-fetch
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
      {/* Map */}
      <div ref={containerRef} className={styles.mapWrap} />

      {/* SVG overlay for connecting lines */}
      <svg ref={svgRef} className={styles.lineOverlay} />

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
