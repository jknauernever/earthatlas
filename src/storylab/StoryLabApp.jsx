/**
 * /storylab — the In Motion lab: one globe, one set of layers, one camera,
 * three modes (Field Guide, Chapters, Here Now). Design brief:
 * docs/design/inmotion-lab/inmotion-lab-build-brief.md.
 *
 * This component owns the shared state and the URL (state.js). The globe
 * (StoryGlobe, a fork of the /inmotion engine) is mounted ONCE and never
 * remounts between modes; each mode is a layout around it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import StoryGlobe from './StoryGlobe.jsx'
import FieldGuide from './FieldGuide.jsx'
import Chapters from './Chapters.jsx'
import HereNow from './HereNow.jsx'
import { CHAPTERS, chapterFor } from './chapters.js'
import { parseLocation, buildUrl, defaultLayers } from './state.js'
import { useIsMobile } from '../hooks/useMediaQuery'
import { tuneHandling } from './handling.js'
import s from './StoryLab.module.css'

// Fonts for the lab only (Source Serif 4 headlines, Inter for the rest).
function useLabFonts() {
  useEffect(() => {
    const id = 'storylab-fonts'
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = 'https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=Inter:wght@400;500;600&display=swap'
    document.head.appendChild(link)
  }, [])
}

// Lab pages stay out of search results until they are linked from the site.
function useNoIndex() {
  useEffect(() => {
    const m = document.createElement('meta')
    m.name = 'robots'
    m.content = 'noindex'
    document.head.appendChild(m)
    return () => m.remove()
  }, [])
}

const DEFAULT_CAMERA = { lat: 24, lng: -40, zoom: 1.9, bearing: 0, pitch: 0 }
// A phone screen fits the whole globe at about zoom 0.9.
const PHONE_CAMERA = { lat: 24, lng: -40, zoom: 0.9, bearing: 0, pitch: 0 }
const PLACE_ZOOM = 6.2
const ZERO = { top: 0, right: 0, bottom: 0, left: 0 }
// Where the globe sits in each mode: the panel or card takes part of the window.
// On phones the header sits on top and a sheet or card covers the bottom.
const padFor = (mode, mobile) => {
  if (mobile) {
    const h = typeof window !== 'undefined' ? window.innerHeight : 800
    if (mode === 'guide') return { ...ZERO, top: 150, bottom: Math.round(h * 0.42) }
    if (mode === 'chapters') return { ...ZERO, top: 50, bottom: Math.round(h * 0.4) }
    return ZERO
  }
  return { ...ZERO, ...(mode === 'guide' ? { left: 380 } : mode === 'chapters' ? { right: 440 } : {}) }
}
const PHONE_QUERY = '(max-width: 768px)'
// Chapter cameras are framed for a laptop; a phone needs about one zoom step wider.
const PHONE_ZOOM_OUT = 1.1
const chapterCamera = (c, mobile) => (mobile ? { ...c, zoom: Math.max(0.6, c.zoom - PHONE_ZOOM_OUT) } : c)

function transportClass(mode, phone) {
  if (phone) return mode === 'chapters' ? s.transportPhoneChapters : s.transportPhoneGuide
  return mode === 'chapters' ? s.transportChapters : s.transportGuide
}

export default function StoryLabApp() {
  useLabFonts()
  useNoIndex()
  const location = useLocation()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const globeRef = useRef(null)
  const mobileRef = useRef(isMobile)
  mobileRef.current = isMobile

  // ─── Shared state ─────────────────────────────────────────────────────────
  const first = useRef(null)
  if (!first.current) first.current = parseLocation(location.pathname, location.search)
  const init = first.current
  const initChapter = init.mode === 'chapters' ? CHAPTERS[Math.min(CHAPTERS.length, init.chapter) - 1] : null
  const initLayers = initChapter ? initChapter.layers : (init.layers ?? defaultLayers())
  const initCamera = initChapter ? chapterCamera(initChapter.camera, window.matchMedia(PHONE_QUERY).matches)
    : init.mode === 'here' && init.place ? { lat: init.place.lat, lng: init.place.lng, zoom: PLACE_ZOOM, bearing: 0, pitch: 0 }
      : (init.camera || (window.matchMedia(PHONE_QUERY).matches ? PHONE_CAMERA : DEFAULT_CAMERA))

  const [mode, setMode] = useState(init.mode)
  const [chapter, setChapter] = useState(init.chapter || 1)
  const [layers, setLayers] = useState(initLayers)       // ids on, mirrored from the globe
  const [order, setOrder] = useState(initLayers)         // ids in the order they came on
  const [legend, setLegend] = useState(init.legend)
  const [view, setView] = useState(init.view)
  const [place, setPlace] = useState(init.place)
  const [time, setTime] = useState(init.time)
  const [firstCard, setFirstCard] = useState(init.first)
  const [camera, setCamera] = useState(initCamera)
  const [status, setStatus] = useState({ layerStatus: {}, layerMeta: {}, anyExplainable: false })
  const [replay, setReplay] = useState(null)
  const [mapReady, setMapReady] = useState(false)

  const globeInitial = useRef(null)
  if (!globeInitial.current) {
    const on = new Set(initLayers)
    const lmap = {}
    // The engine reads /inmotion's per-layer '1'/'0' flags.
    for (const id of initLayers) lmap[id] = '1'
    globeInitial.current = { layers: lmap, lat: initCamera.lat, lng: initCamera.lng, z: initCamera.zoom, bearing: initCamera.bearing, pitch: initCamera.pitch, _on: on }
  }

  // ─── Globe → state ────────────────────────────────────────────────────────
  const onLayersChange = useCallback((layerOn) => {
    const ids = Object.keys(layerOn).filter((id) => layerOn[id])
    setLayers((prev) => (prev.length === ids.length && prev.every((x) => ids.includes(x)) ? prev : ids))
    setOrder((prev) => [...prev.filter((id) => ids.includes(id)), ...ids.filter((id) => !prev.includes(id))])
  }, [])
  const camTimer = useRef(0)
  const onCameraChange = useCallback((v) => {
    clearTimeout(camTimer.current)
    camTimer.current = setTimeout(() => setCamera(v), 150)
  }, [])

  // The legend describes the layer asked for, else the one most recently turned on.
  const legendId = legend && layers.includes(legend) ? legend
    : [...order].reverse().find((id) => layers.includes(id)) || null

  // ─── State → URL (every state has its own URL) ────────────────────────────
  const lastUrl = useRef(null)
  const lastMode = useRef(`${init.mode}:${init.chapter || ''}`)
  useEffect(() => {
    const url = buildUrl({ mode, chapter, layers, camera, view, legend: legend && layers.includes(legend) ? legend : null, place, time, first: firstCard })
    const here = location.pathname + location.search
    if (url === here) { lastUrl.current = url; return }
    const modeKey = `${mode}:${mode === 'chapters' ? chapter : ''}`
    // Changing mode (or chapter) is a step the Back button should undo;
    // camera drags and layer flips replace the current entry.
    const push = modeKey !== lastMode.current
    lastMode.current = modeKey
    lastUrl.current = url
    navigate(url, { replace: !push })
  }, [mode, chapter, layers, camera, view, legend, place, time, firstCard]) // eslint-disable-line react-hooks/exhaustive-deps

  // URL → state, for Back / Forward and pasted links within the page.
  useEffect(() => {
    const url = location.pathname + location.search
    if (url === lastUrl.current) return
    lastUrl.current = url
    const p = parseLocation(location.pathname, location.search)
    lastMode.current = `${p.mode}:${p.mode === 'chapters' ? p.chapter : ''}`
    setMode(p.mode)
    if (p.mode === 'chapters') { goChapter(p.chapter, { fromUrl: true }); return }
    if (p.layers) globeRef.current?.setLayers(p.layers)
    setView(p.view)
    setLegend(p.legend)
    setPlace(p.place)
    setTime(p.time)
    setFirstCard(p.first)
    if (p.mode === 'here' && p.place) flyToPlace(p.place)
    else if (p.camera) globeRef.current?.flyTo({ center: [p.camera.lng, p.camera.lat], zoom: p.camera.zoom, bearing: p.camera.bearing, pitch: p.camera.pitch, padding: padFor('guide', mobileRef.current) })
  }, [location.pathname, location.search]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Actions shared by the modes ──────────────────────────────────────────
  const flyToPlace = useCallback((p, zoom = PLACE_ZOOM) => {
    globeRef.current?.flyTo({ center: [p.lng, p.lat], zoom, bearing: 0, pitch: 0, duration: 1800, padding: padFor('here', mobileRef.current) })
  }, [])

  const toggleLayer = useCallback((id) => {
    const turningOn = !layers.includes(id)
    globeRef.current?.toggleLayer(id)
    if (turningOn) setLegend(id)
    else if (legend === id) setLegend(null)
  }, [layers, legend])

  // A → C: open Here, Now for a spot (globe click, search result, my location).
  const openHere = useCallback((p, opts = {}) => {
    globeRef.current?.closeExplain()
    setTime(0)
    if (!p) { setPlace(null); setFirstCard(opts.first || null); setMode('here'); return }
    setPlace(p)
    setFirstCard(opts.first || null)
    if (opts.layers) globeRef.current?.setLayers(opts.layers)
    setMode('here')
    flyToPlace(p)
    if (!p.name) {
      fetch(`/api/geo/reverse?lat=${p.lat.toFixed(2)}&lng=${p.lng.toFixed(2)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j?.name) return
          setPlace((cur) => (cur && cur.lat === p.lat && cur.lng === p.lng ? { ...cur, name: j.kind === 'near' || j.kind === 'at' ? (j.place || j.name) : j.name } : cur))
        })
        .catch(() => {})
    }
  }, [flyToPlace])

  // C → A, and B → A: back to the Field Guide with these layers on.
  const openGuide = useCallback((opts = {}) => {
    if (opts.layers) {
      globeRef.current?.setLayers(opts.layers)
      setOrder(opts.layers)
    }
    if (opts.legend) setLegend(opts.legend)
    setMode('guide')
    if (opts.center) globeRef.current?.flyTo({ center: [opts.center.lng, opts.center.lat], zoom: opts.zoom ?? PLACE_ZOOM, duration: 1600, padding: padFor('guide', mobileRef.current) })
  }, [])

  // A → B, and chapter to chapter.
  const goChapter = useCallback((n, opts = {}) => {
    const i = Math.max(1, Math.min(CHAPTERS.length, n || 1))
    const ch = CHAPTERS[i - 1]
    globeRef.current?.closeExplain()
    setChapter(i)
    setMode('chapters')
    globeRef.current?.setLayers(ch.layers)
    setOrder(ch.layers)
    setLegend(ch.layers[0])
    const c = chapterCamera(ch.camera, mobileRef.current)
    globeRef.current?.flyTo({ center: [c.lng, c.lat], zoom: c.zoom, bearing: c.bearing || 0, pitch: c.pitch || 0, duration: opts.fromUrl ? 0 : 2600, curve: 1.3, padding: padFor('chapters', mobileRef.current) })
  }, [])

  // Layers with history start playing (last 7 days) as soon as they're on screen, in the
  // Field Guide and in Chapters (Josh, 2026-11-12: unlike /inmotion, which
  // opens parked at Now). Once per chapter / per layer's replay, so a
  // viewer's pause is respected; the controller plays its passes, then parks
  // at Now. Here, Now drives time with its own slider instead.
  const autoPlayed = useRef(null)
  useEffect(() => {
    if (mode === 'here' || !replay) { if (mode === 'here') autoPlayed.current = null; return }
    const key = mode === 'chapters' ? `ch${chapter}` : 'guide'
    if (autoPlayed.current?.key === key && autoPlayed.current.rc === replay) return
    autoPlayed.current = { key, rc: replay }
    // Start on the last 7 days (or the shortest span the bar offers).
    const opts = replay.windowOptions || []
    if (opts.length) replay.setWindowDays(opts.includes(7) ? 7 : Math.min(...opts))
    if (!replay.playing) replay.play()
  }, [mode, chapter, replay])

  const openStories = useCallback(() => goChapter(chapterFor(legendId)), [goChapter, legendId])

  const useMyLocation = useCallback(() => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(false)
    navigator.geolocation.getCurrentPosition(
      (pos) => { openHere({ lat: pos.coords.latitude, lng: pos.coords.longitude, name: '' }); resolve(true) },
      () => resolve(false),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    )
  }), [openHere])

  // The globe sits in the space the mode leaves for it.
  const padding = padFor(mode, isMobile)

  // Here, Now: the one globe moves into the framed panel the mode lays out.
  const [frame, setFrame] = useState(null)
  useEffect(() => {
    if (mode !== 'here') { setFrame(null); return }
    let el = null, ro = null, raf = 0
    const measure = () => {
      el = el || document.querySelector('[data-here-frame]')
      if (!el) { raf = requestAnimationFrame(measure); return }
      const r = el.getBoundingClientRect()
      const hidden = r.width < 2 || r.height < 2 || getComputedStyle(el).display === 'none'
      setFrame((f) => {
        const n = hidden ? { hidden: true } : { left: r.left, top: r.top, width: r.width, height: r.height }
        return f && JSON.stringify(f) === JSON.stringify(n) ? f : n
      })
      if (!ro && el) { ro = new ResizeObserver(() => measure()); ro.observe(el) }
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [mode, isMobile])
  const hostStyle = mode === 'here' && frame
    ? (frame.hidden ? { visibility: 'hidden' } : { left: frame.left, top: frame.top, width: frame.width, height: frame.height, right: 'auto', bottom: 'auto' })
    : undefined

  const shared = {
    globeRef, layers, legendId, status, view, setView, toggleLayer, openHere, openGuide, goChapter, openStories,
    useMyLocation, camera, place, setPlace, time, setTime, firstCard, chapter, replay, mapReady, isMobile, setLegend,
  }

  return (
    <div className={`${s.app} ${s[`mode_${mode}`]}`}>
      <div className={s.globeHost} data-mode={mode} style={hostStyle}>
        <StoryGlobe
          ref={globeRef}
          initial={globeInitial.current}
          // Globe only for now: the /inmotion layer renderers assume the globe
          // projection (src/systems/globeGeom.js), so a flat map would mean
          // changing /inmotion code. View state stays in the URL scheme for later.
          projection="globe"
          padding={padding}
          onLayersChange={onLayersChange}
          onCameraChange={onCameraChange}
          onStatusChange={setStatus}
          onReplayChange={setReplay}
          onReady={(map) => { tuneHandling(map, isMobile); setMapReady(true) }}
          onMapClick={mode === 'chapters' ? null : (ll) => openHere({ lat: ll.lat, lng: ll.lng, name: '' })}
          // The /inmotion time bar: layers with history (smoke, fires, sea
          // temperature, birds…) open parked at Now and move only when played.
          // Here, Now has its own 30-day slider instead.
          showTransport={mode !== 'here'}
          transportClass={transportClass(mode, isMobile)}
          showPickers={mode === 'guide'}
        />
      </div>
      {mode === 'guide' && <FieldGuide {...shared} />}
      {mode === 'chapters' && <Chapters {...shared} />}
      {mode === 'here' && <HereNow {...shared} />}
    </div>
  )
}
