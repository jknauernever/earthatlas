import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { mapboxToken } from '../lib/mapboxToken.js'
import { BASE_IMAGERY } from '../lib/localAerials.js'
import { autoViewCard } from '../lib/shareCard.js'
import { STORY_SUBSITES } from './subsites.js'
import m from './StoryMap.module.css'

/**
 * The live map of a story, for any layout: Sentinel-2 cloudless under the subsite's layers drawn in its story look
 * (src/stories/looks/<subsite>.js), framed by the chapter's view. People can drag and zoom it (no buttons are drawn:
 * nothing on the map but the data, Josh 2026-11-12); the next chapter brings it back to that chapter's view.
 *
 *   subsite      e.g. 'shoreline'
 *   layerIds     every layer the story shows (loaded once, up front)
 *   view         the chapter's view: { camera: { bounds } | { center, zoom }, layers, labels, frames }; a layer's
 *                highlight ({ prop, ids }) draws those features at full glow and the rest at the layer's emphasis
 *   reducedMotion  no camera flight, pulsing or flowing; instant changes
 *   onCamera     ({ lng, lat, zoom }) after each move, for "Open the full map"
 *
 * Phone layout settings (docs/design/stories-split/DESIGN-PHONE.md, "Map on a phone"):
 *   locked       no pan, pinch or tap: the map stays on the chapter's view
 *   fit          (width, height) → { top, right, bottom, left } px the chapter's view is fitted inside, clear of what
 *                the layout draws over the map
 *   small        only the labels marked for small screens (labelSet items with "small": true)
 *   lineScale    every line width and blur times this
 */
/** The satellite credit every layout shows with the map (EOX's licence asks for this wording). */
export const MAP_CREDIT = {
  text: 'Sentinel-2 cloudless 2025 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2025)',
  href: 'https://cloudless.eox.at',
}
const S2 = BASE_IMAGERY.find((b) => b.id === 's2-2025')
const LAYER_MS = 1100               // layer opacity change (DESIGN.md Motion)
const CAMERA_MS = 2400              // camera to and from a detail view
const DETAIL = { ms: 1200, delay: 600 }  // layers after a camera move

// CSS cubic-bezier(x1, y1, x2, y2) as a function of t
function bezier(x1, y1, x2, y2) {
  const at = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3
  return (x) => {
    let lo = 0, hi = 1
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (at(x1, x2, mid) < x) lo = mid; else hi = mid }
    return at(y1, y2, (lo + hi) / 2)
  }
}
const easeCamera = bezier(0.65, 0, 0.2, 1)
const ease = bezier(0.25, 0.1, 0.25, 1)  // CSS 'ease'

// Dashes moving along a line, as Mapbox line-dasharray steps (in line widths): dash d, gap g, shifted forward by s
function dashAt(d, g, s) {
  const P = d + g
  return s + d <= P ? [0, s, d, P - s - d] : [s + d - P, P - d, P - s, 0]
}
const ANIM = {
  flow: { d: 5 / 4.2, g: 7 / 4.2, period: 0.6 },   // Chinook: 5/7 dashes, 36 units per 1.8 s
  sparkle: { d: 1.5 / 2, g: 10.5 / 2, period: 7 / 6 },  // shoreline: 1.5/10.5 dashes, 72 units per 7 s
}
const STEPS = 16
const pulse = (t) => 0.55 + 0.45 * (0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 3.4))

const rect = ([w, s, e, n]) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] } })
const sameCamera = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// a line width (a number, or the look's zoom interpolation) times k
const scaled = (v, k) => (k === 1 ? v : typeof v === 'number' ? v * k
  : Array.isArray(v) && v[0] === 'interpolate' ? [...v.slice(0, 3), ...v.slice(3).map((x, i) => (i % 2 ? x * k : x))] : v)

export default function StoryMap({ subsite, layerIds, view, reducedMotion = false, onCamera, locked = false, fit, small = false, lineScale = 1 }) {
  const box = useRef(null)
  const st = useRef({ map: null, ready: false, parts: [], labels: [], view: null, camera: null })
  const [ready, setReady] = useState(false)
  const motion = useRef(reducedMotion)
  motion.current = reducedMotion
  const fitRef = useRef(fit)
  fitRef.current = fit
  // the padding the chapter's view is fitted inside, for the map's current size
  const padding = () => { const c = st.current.map?.getContainer() || box.current; return fitRef.current ? fitRef.current(c.clientWidth, c.clientHeight) : 0 }

  // ── Map, data and story layers, once ──
  useEffect(() => {
    const s = st.current
    mapboxgl.accessToken = mapboxToken
    const first = view.camera
    const map = new mapboxgl.Map({
      container: box.current,
      style: {
        version: 8,
        sources: { s2: S2.source },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#061624' } },
          // dark satellite: water near black, land muted green (DESIGN.md "Map look")
          { id: 's2', type: 'raster', source: 's2', paint: { 'raster-brightness-max': 0.8, 'raster-saturation': -0.05, 'raster-contrast': 0, 'raster-fade-duration': 0 } },
        ],
      },
      ...(first.bounds ? { bounds: first.bounds, fitBoundsOptions: { padding: padding() } } : { center: first.center, zoom: first.zoom, padding: padding() }),
      // Pan and zoom by hand, with nothing drawn for it (Josh 2026-11-12); no rotating or tilting. Arrow keys stay
      // with the story (chapters), so the map's own keyboard handling is off.
      dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false, boxZoom: false,
      minZoom: 8, maxZoom: 17,
      // on a phone the map is locked to the chapter's view; a swipe on it changes chapter (the layout's)
      interactive: !locked,
      attributionControl: false,
      fadeDuration: 0,
    })
    s.map = map
    // a picture of the story's map for its link previews, as every EarthAtlas map saves (src/lib/shareCard.js)
    const stopCard = autoViewCard(map)
    s.camera = first
    s.userMoved = false
    if (!locked) map.touchZoomRotate.disableRotation()
    // the map is pictures for the eye (its words are in the chapter); keep it out of the tab order, like its aria-hidden box
    map.getCanvas().setAttribute('tabindex', '-1')
    // a person moved the map (not the story's own camera)
    map.on('movestart', (e) => { if (e.originalEvent) s.userMoved = true })
    const ac = new AbortController()

    map.on('load', async () => {
      const look = await STORY_SUBSITES[subsite].look()
      const data = await Promise.all(layerIds.map((id) => fetch(look.layers[id].file, { signal: ac.signal }).then((r) => r.json()))).catch(() => null)
      if (!data || ac.signal.aborted) return
      layerIds.forEach((id, i) => {
        const L = look.layers[id]
        map.addSource(`story-${id}`, { type: 'geojson', data: L.prepare ? L.prepare(data[i]) : data[i] })
        L.parts.forEach((p, j) => {
          const lid = `story-${id}-${j}`
          map.addLayer({ id: lid, type: 'line', source: `story-${id}`, layout: { ...p.layout }, paint: { ...p.paint, 'line-width': scaled(p.paint['line-width'], lineScale), ...(p.paint['line-blur'] != null && { 'line-blur': scaled(p.paint['line-blur'], lineScale) }), 'line-opacity': 0, 'line-opacity-transition': { duration: 0 } } })
          s.parts.push({ lid, layer: id, role: p.role, base: p.opacity, animate: p.animate, cur: 0, from: 0, to: 0, hi: { cur: 0, from: 0, to: 0 }, set: null, t0: 0, ms: 0, shown: -1, dash: -1 })
        })
      })
      map.addSource('story-frames', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'story-frames', type: 'line', source: 'story-frames', paint: { 'line-color': '#FFFFFF', 'line-width': 2, 'line-dasharray': [3.5, 3], 'line-opacity': 0, 'line-opacity-transition': { duration: LAYER_MS } } })
      s.ready = true
      setReady(true)
    })
    const report = () => {
      const c = map.getCenter()
      onCamera?.({ lng: c.lng, lat: c.lat, zoom: map.getZoom() })
    }
    map.on('moveend', report)
    map.on('load', report)
    // keep the chapter's framing when the window changes size
    map.on('resize', () => {
      const c = s.camera
      if (!c || s.userMoved) return
      if (c.bounds) map.fitBounds(c.bounds, { duration: 0, padding: padding() }); else map.jumpTo({ center: c.center, zoom: c.zoom, padding: padding() })
    })

    // ── Animation: layer fades, glow pulse, flowing dashes ──
    let raf = 0
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      if (!s.ready) return
      const t = now / 1000
      for (const p of s.parts) {
        const k = p.ms ? Math.min(1, Math.max(0, (now - p.t0) / p.ms)) : 1
        p.cur = p.from + (p.to - p.from) * ease(k)
        p.hi.cur = p.hi.from + (p.hi.to - p.hi.from) * ease(k)
        const beat = p.animate === 'pulse' && !motion.current ? pulse(t) : 1
        const shown = p.cur * beat, hiShown = p.hi.cur * beat
        // a highlighted set: its features on their own opacity, the rest of the layer on the chapter's
        if (Math.abs(shown - p.shown) > 0.004 || Math.abs(hiShown - p.hiShown) > 0.004) {
          map.setPaintProperty(p.lid, 'line-opacity', p.set ? ['case', ['in', ['get', p.set.prop], ['literal', p.set.ids]], hiShown, shown] : shown)
          p.shown = shown; p.hiShown = hiShown
        }
        const a = ANIM[p.animate]
        if (a) {
          const step = motion.current ? 0 : Math.floor(((t / a.period) % 1) * STEPS)
          if (step !== p.dash) { map.setPaintProperty(p.lid, 'line-dasharray', dashAt(a.d, a.g, (step / STEPS) * (a.d + a.g))); p.dash = step }
        }
      }
    }
    raf = requestAnimationFrame(tick)

    return () => { stopCard(); ac.abort(); cancelAnimationFrame(raf); s.labels.forEach((x) => x.remove()); map.remove(); s.ready = false; s.parts = []; s.labels = []; s.labelKey = null; s.view = null; setReady(false) }
    // the map is made once per story; chapters change it below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subsite, layerIds.join(','), locked, lineScale])

  // ── A chapter's view: camera, layer strengths, labels, frames ──
  useEffect(() => {
    const s = st.current, map = s.map
    // s.ready, not just the state: a remade map (hot reload, a new story) isn't ready until its own load
    if (!map || !ready || !s.ready) return
    const moving = !sameCamera(view.camera, s.camera)
    const instant = reducedMotion || s.view === null
    // a new chapter brings the map back to its view, also after someone has panned or zoomed it
    const back = !moving && s.userMoved && s.view !== null && s.view !== view
    s.camera = view.camera
    s.userMoved = false
    if (moving || back) {
      const opts = { duration: instant ? 0 : moving ? CAMERA_MS : LAYER_MS, easing: easeCamera, linear: true, padding: padding() }
      if (view.camera.bounds) map.fitBounds(view.camera.bounds, opts); else map.easeTo({ center: view.camera.center, zoom: view.camera.zoom, ...opts })
    }

    const now = performance.now()
    const timing = instant ? { ms: 0, delay: 0 } : moving ? DETAIL : { ms: LAYER_MS, delay: 0 }
    const byId = Object.fromEntries(view.layers.map((l) => [l.id, l]))
    for (const p of s.parts) {
      const l = byId[p.layer]
      let to = 0
      if (l) {
        const strength = l.emphasis === 'dim' ? l.opacity : 1
        to = p.role === 'core' ? p.base * strength : l.emphasis === 'on' ? 0 : p.base * strength
      }
      // highlighted features: the layer's full glow; without a highlight they follow the rest
      const hiTo = l?.highlight ? p.base : to
      if (l?.highlight) p.set = l.highlight
      if (to === p.to && hiTo === p.hi.to) continue
      p.from = p.cur; p.to = to; p.hi.from = p.hi.cur; p.hi.to = hiTo; p.t0 = now + timing.delay; p.ms = timing.ms
    }
    // feature filters (e.g. only the highest Chinook level)
    for (const id of layerIds) {
      const f = byId[id]?.filter
      const expr = f ? ['all', ...Object.entries(f).map(([k, v]) => (Array.isArray(v) ? ['in', ['get', k], ['literal', v]] : ['==', ['get', k], v]))] : null
      for (const p of s.parts.filter((x) => x.layer === id)) map.setFilter(p.lid, expr)
    }

    map.getSource('story-frames').setData({ type: 'FeatureCollection', features: view.frames.map(rect) })
    map.setPaintProperty('story-frames', 'line-opacity-transition', { duration: instant ? 0 : LAYER_MS })
    map.setPaintProperty('story-frames', 'line-opacity', view.frames.length ? 1 : 0)

    // Labels: kept as page text (Inter, as designed), placed on the map; faded with the layers
    const labels = small ? view.labels.filter((lb) => lb.small) : view.labels
    const key = JSON.stringify(labels)
    if (key !== s.labelKey) {
      const old = s.labels
      s.labelKey = key
      s.labels = labels.map((lb) => {
        const el = document.createElement('div')
        el.className = m.label
        el.textContent = lb.text
        el.style.transition = instant ? 'none' : `opacity ${LAYER_MS}ms ease`
        el.style.opacity = '0'
        const mk = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat(lb.at).addTo(map)
        requestAnimationFrame(() => { el.style.opacity = '1' })
        return mk
      })
      for (const mk of old) {
        const el = mk.getElement()
        el.style.transition = instant ? 'none' : `opacity ${LAYER_MS}ms ease`
        el.style.opacity = '0'
        setTimeout(() => mk.remove(), instant ? 0 : LAYER_MS)
      }
    }
    s.view = view
    // padding() reads the layout's fit through a ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ready, reducedMotion, layerIds, small])

  return (
    <div className={m.wrap}>
      <div ref={box} className={m.map} aria-hidden="true" />
    </div>
  )
}
