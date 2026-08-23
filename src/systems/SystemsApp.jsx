/**
 * EarthAtlas In Motion — animated earth-systems globe at /inmotion (code lives under src/systems/).
 *
 * Live planetary systems in motion: wind and ocean currents as flowing
 * particles, sea-surface temperature and wave height as color overlays, on a
 * true globe with atmosphere. Inspired by earth.nullschool.net, rebuilt
 * clean-room in the EarthAtlas idiom — with the EarthAtlas emphasis on
 * explaining WHAT you're seeing, WHY it matters, and where every number
 * comes from.
 *
 * Layer definitions live in src/systems/layerDefs.js; data pipelines in
 * api/cron/gfs-wind.js + api/cron/systems-bake.js (see SYSTEMS-NOTES.md).
 * Every layer's animation/overlay AND its click readout sample the same
 * baked grid from the same model run — one source of truth, stamped in the
 * panel and popups. A layer with no live data shows an honest "unavailable"
 * state, never stale or made-up values.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { ensureWebGLSupport } from '../utils/webglSupport'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import MapSheet from '../components/MapSheet.jsx'
import MapSearch from '../components/MapSearch.jsx'
import { installPopupSheet } from '../lib/popupSheet.js'
import { useIsMobile } from '../hooks/useMediaQuery'
import { loadGridField, loadSystemsJson, SOURCE_BASES } from './windField.js'
import { ParticleLayer } from './windParticles.js'
import { ScalarOverlayLayer } from './scalarOverlay.js'
import { TapeField } from './tape.js'
import { loadLandMask, getLandMaskSync, isLand } from './landMask.js'
import { ReplayController } from './replay.js'
import { EventTape } from './eventTape.js'
import TransportBar from './TransportBar.jsx'
import { formatAiText } from './aiFormat.js'
import { EventPingLayer } from './eventPings.js'
import { FireEventsOverlay, fireEventName } from './fireEventsOverlay.js'
import { LAYERS, GROUPS, fmtRun, fmtDay, agoWord, rampGradient } from './layerDefs.js'
import { buildViewFacts } from './viewFacts.js'
import ClipStudio from './ClipStudio.jsx'
import styles from './SystemsApp.module.css'

// Mobile popups get a drag-to-extend grab handle (no-op after first call).
installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const WATER_MASK_LAYER = 'systems-water-mask'

// Opens on the Atlantic so both hemispheres' circulation belts are in view.
const DEFAULT_VIEW = { center: [-40, 24], zoom: 1.9 }

const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// Particle density presets, shared by all particle layers.
const DENSITIES = [
  { id: 'low', label: 'Low', count: 1800 },
  { id: 'med', label: 'Medium', count: 3500 },
  { id: 'high', label: 'High', count: 6000 },
]
const densityCount = (id) => (DENSITIES.find((d) => d.id === id) || DENSITIES[1]).count

// Overlay canvas stack in draw order (bottom → top), mirroring the JSX order —
// the clip recorder composites these over the basemap in exactly this order.
const OVERLAY_KEYS = ['scalar', 'aerosol:flow', 'currents', 'wind', 'hotspots', 'fireevents', 'quakes']

// ─── Shareable URL state ────────────────────────────────────────────────────
// Required convention (docs/MAP_TOOL_CONVENTIONS.md). Per-layer params come
// from layerDefs (w/c/t/h — written only away from their defaults), plus:
//   d            particle density id (default 'med')
//   bm           basemap id (default 'satellite')
//   lat,lng,z    map camera
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const layers = {}
  for (const def of LAYERS) layers[def.id] = sp.get(def.param)
  return {
    layers,
    d: sp.get('d'),
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

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

// One compact chip per analyzed layer — these are the facts engine's own
// numbers, shown under the AI prose so readers see the numbers' source.
function factChip(f) {
  if (f.id === 'wind' || f.id === 'currents') {
    return `${f.name}: avg ${f.mean} · max ${f.max} m/s, ${f.dominant_direction}`
  }
  if (f.id === 'quakes') {
    return f.in_view
      ? `${f.name}: ${f.in_view} in view · biggest M${f.max_magnitude}`
      : `${f.name}: none in view (${f.global_count} worldwide this month)`
  }
  if (f.id === 'hotspots') {
    return `${f.name}: ${f.detections_in_view.toLocaleString()} detections in view` +
      (f.pct_of_global != null ? ` (${f.pct_of_global}% of global)` : '') +
      (f.est_co2_tonnes_per_day != null
        ? ` · ~${f.est_co2_tonnes_per_day >= 1e6
          ? (f.est_co2_tonnes_per_day / 1e6).toFixed(1) + ' Mt'
          : f.est_co2_tonnes_per_day.toLocaleString() + ' t'} CO₂/day (est.)`
        : '')
  }
  if (f.note) return `${f.name}: 30-day alert overlay`
  return `${f.name}: ${f.min} to ${f.max} ${f.unit} in view`
}

const b64url = (s) => btoa(unescape(encodeURIComponent(s)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Dev only: the map layers are long-lived class instances (particles, pings,
// overlays, replay controllers) that a hot swap leaves running on OLD code —
// which looked like bugs that "survived" fixes. Any edit under src/systems
// reloads the page instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())

// Scroll affordance for tall popups: a subtle ▾ pinned at the card's bottom,
// shown only while more content is below the fold (the card itself scrolls).
function attachPopupScrollHint(popup, styles) {
  const content = popup.getElement()?.querySelector('.mapboxgl-popup-content')
  const scroller = content?.querySelector(`.${styles.popup.split(' ')[0]}`)
  if (!content || !scroller) return
  let hint = content.querySelector(`.${styles.popupScrollHint.split(' ')[0]}`)
  const update = () => {
    const more = scroller.scrollHeight - scroller.clientHeight > 8 &&
      scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 8
    hint.style.opacity = more ? '1' : '0'
    hint.style.pointerEvents = more ? 'auto' : 'none'
  }
  if (!hint) {
    hint = document.createElement('button')
    hint.type = 'button'
    hint.className = styles.popupScrollHint
    hint.title = 'More'
    hint.setAttribute('aria-label', 'Scroll for more')
    hint.textContent = '▾'
    hint.addEventListener('click', () => scroller.scrollBy({ top: 160, behavior: 'smooth' }))
    scroller.addEventListener('scroll', update, { passive: true })
    // The card resizes after this runs (AI text lands, Mapbox re-anchors) —
    // re-evaluate whenever its box changes, not just once.
    new ResizeObserver(update).observe(scroller)
    content.appendChild(hint)
  }
  update()
  setTimeout(update, 400)
}

// Monoline layer icon (paths from the design handoff), colored by currentColor.
function LayerIcon({ svg, size = 19 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  )
}
// On-state derivations from a layer hue: border .6, background .13, icon = hue.
function hueStyle(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return { '--hue': hex, '--hue-border': `rgba(${r},${g},${b},0.6)`, '--hue-bg': `rgba(${r},${g},${b},0.13)` }
}

function useMediaQuery(q) {
  const [m, setM] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}

export default function SystemsApp() {
  const containerRef = useRef(null)
  const canvasEls = useRef({})       // layer id (or 'scalar') → canvas element
  const popupAiReqRef = useRef(0)    // staleness guard for popup narrations
  const mapRef = useRef(null)
  const instancesRef = useRef({})    // layer id → ParticleLayer; 'scalar' slot holds {id, layer}
  const replayRef = useRef(null)     // ReplayController for the active tape layer
  const [replay, setReplay] = useState(null) // same, as state for the TransportBar
  const [replayRange, setReplayRange] = useState({}) // layer id → 'short' | 'year' (layers with a year tape)
  const eventReplayRef = useRef(null) // ReplayController over an EventTape (quakes) when no scalar replay owns the bar
  const [dataEpoch, setDataEpoch] = useState(0) // bumped when a visible layer's data is refreshed
  const resumeRef = useRef({}) // layer id → { t, playing } to restore a replay across a data refresh
  const [eventReplay, setEventReplay] = useState(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const fieldsRef = useRef({})       // layer id → GridField
  const popupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  const initial = (typeof window !== 'undefined') ? readUrlState() : { layers: {} }
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z }
    : null

  const [layerOn, setLayerOn] = useState(() => {
    const on = {}
    for (const def of LAYERS) {
      const p = initial.layers?.[def.id]
      on[def.id] = def.defaultOn ? p !== '0' : p === '1'
    }
    // Scalars are mutually exclusive; if a shared link somehow has both, keep
    // the first.
    let seenScalar = false
    for (const def of LAYERS) {
      if (def.kind === 'scalar' && on[def.id]) {
        if (seenScalar) on[def.id] = false
        seenScalar = true
      }
    }
    return on
  })
  const [layerStatus, setLayerStatus] = useState({})   // id → 'loading' | 'ok' | 'error'
  const [layerMeta, setLayerMeta] = useState({})       // id → meta
  const [density, setDensity] = useState(() => (DENSITIES.some((d) => d.id === initial.d) ? initial.d : 'med'))
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  // Layer navigation (Claude Design handoff, 2026-08-22): an icon DOCK is the
  // default everywhere — one monoline icon per dataset, click = toggle, hover
  // tooltip. Desktop: dock ⇄ expanded panel (panelOpen). Mobile: pill ⇄ dock
  // ⇄ full drawer (mobileView). Nothing auto-expands.
  const [panelOpen, setPanelOpen] = useState(false)
  const [mobileView, setMobileView] = useState('dock') // 'pill' | 'dock' | 'drawer'
  const [drawerSignal, setDrawerSignal] = useState(0)
  const [chip, setChip] = useState(null) // mobile tap confirmation { id, on }
  const chipTimerRef = useRef(0)
  const [showMethodology, setShowMethodology] = useState(false)
  const isMobile = useIsMobile()
  if (import.meta.env.DEV) window.__systemsNav = { panelOpen, mobileView, isMobile } // dev-only QA handle
  const [mapView, setMapView] = useState(initialCamera)
  // Bumped on every style.load; raster overlays live inside the style and
  // must be re-added after basemap switches.
  const [styleEpoch, setStyleEpoch] = useState(0)

  // Latest layer state for map event handlers (clicks) outside React's cycle.
  const stateRef = useRef({})
  stateRef.current = { layerOn, layerStatus, layerMeta }

  // ─── Lazy loading: fetch a layer's data the first time it's turned on ─────
  // Grid layers load the baked meta+bin pair; events/raster layers bring
  // their own loader (USGS feed, hotspot JSON, GEE tile URL).
  useEffect(() => {
    for (const def of LAYERS) {
      if (layerOn[def.id]) {
        if (def.tape?.year && replayRange[def.id] === 'year') {
          const yk = `${def.id}:tape:year`
          if (!layerStatus[yk]) {
            setLayerStatus((s) => ({ ...s, [yk]: 'loading' }))
            TapeField.load(def.tape.year.dataset, def.tape.expectKind)
              .then((tape) => { fieldsRef.current[yk] = tape; setLayerStatus((s) => ({ ...s, [yk]: 'ok' })) })
              .catch((err) => { console.warn(`[systems] ${def.id} year tape unavailable:`, err); setLayerStatus((s) => ({ ...s, [yk]: 'error' })) })
          }
        }
      }
      if (!layerOn[def.id] || layerStatus[def.id]) continue
      setLayerStatus((s) => ({ ...s, [def.id]: 'loading' }))
      const loading = def.load ? def.load() : loadGridField(def.dataset, def.expectKind)
      if (def.tape) {
        const tk = `${def.id}:tape`
        if (!layerStatus[tk]) {
          setLayerStatus((s) => ({ ...s, [tk]: 'loading' }))
          TapeField.load(def.tape.dataset, def.tape.expectKind)
            .then((tape) => {
              fieldsRef.current[tk] = tape
              setLayerStatus((s) => ({ ...s, [tk]: 'ok' }))
            })
            .catch((err) => { console.warn(`[systems] ${def.id} tape unavailable:`, err); setLayerStatus((s) => ({ ...s, [tk]: 'error' })) })
        }
      }
      if (def.flow) {
        const fk = `${def.id}:flow`
        if (!layerStatus[fk]) {
          setLayerStatus((s) => ({ ...s, [fk]: 'loading' }))
          loadGridField(def.flow.dataset, def.flow.expectKind)
            .then((payload) => {
              fieldsRef.current[fk] = payload
              setLayerMeta((m) => ({ ...m, [fk]: payload.meta }))
              setLayerStatus((s) => ({ ...s, [fk]: 'ok' }))
            })
            .catch(() => setLayerStatus((s) => ({ ...s, [fk]: 'error' })))
        }
      }
      loading
        .then((payload) => {
          fieldsRef.current[def.id] = payload
          setLayerMeta((m) => ({ ...m, [def.id]: payload.meta }))
          setLayerStatus((s) => ({ ...s, [def.id]: 'ok' }))
        })
        .catch(() => setLayerStatus((s) => ({ ...s, [def.id]: 'error' })))
    }
  }, [layerOn, layerStatus, replayRange])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center,
      zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom,
      projection: 'globe',
    })
    mapRef.current = map
    if (import.meta.env.DEV) { window.__systemsMap = map; window.__systemsInst = instancesRef.current } // dev-only QA handles
    loadLandMask().catch(() => {}) // 0.1° land raster: popup land/water flag, ocean masks
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
        showUserLocation: false,
      }),
      'bottom-right'
    )

    map.on('moveend', () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    })

    // Click anywhere → readout for every active layer, from the same grids
    // that drive the visuals.
    map.on('click', (e) => {
      const { layerOn, layerStatus, layerMeta } = stateRef.current
      const sections = []
      const aiItems = [] // structured copies of each section, for the popup narration
      const sectionHtml = (p) => {
        aiItems.push({ what: p.head, value: `${p.big} (${p.alt})`, detail: p.meta })
        return `<div class="${styles.popupSection}">` +
        `<div class="${styles.popupHead}">${escapeHtml(p.head)}</div>` +
        `<div class="${styles.popupSpeed}">${escapeHtml(p.big)} <span>(${escapeHtml(p.alt)})</span></div>` +
        `<div class="${styles.popupMeta}">${escapeHtml(p.meta)}</div>` +
        (p.link
          ? `<div class="${styles.popupMeta}"><a href="${escapeHtml(p.link.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.link.label)}</a></div>`
          : '') +
        `</div>`
      }
      for (const def of LAYERS) {
        if (!layerOn[def.id] || layerStatus[def.id] !== 'ok') continue
        if (def.kind === 'events') {
          // Fires: prefer the rich derived event (name, duration, footprint)
          // over the raw cluster when the click lands on one.
          if (def.id === 'hotspots') {
            const fev = instancesRef.current.fireevents?.hitTest(e.point.x, e.point.y, 18)
            if (fev) {
              const nowMs = Date.now()
              // Official discovery date (NIFC join) gives TRUE fire age; our
              // own tracking only bounds it from below — say which is which.
              let ageStr
              if (fev.discovered_ms) {
                const days = Math.max(1, Math.round((nowMs - fev.discovered_ms) / 8.64e7))
                ageStr = `Burning since ${fmtDay(fev.discovered_ms)} (day ${days}) — NIFC`
              } else {
                const days = Math.max(1, Math.round((nowMs - fev.first_seen_ms) / 8.64e7))
                ageStr = days <= 1 ? 'Newly detected in the last 24 h' : `Tracked for ${days}+ days`
              }
              const official = []
              if (fev.acres != null) official.push(`${fev.acres.toLocaleString()} acres`)
              if (fev.contained != null) official.push(`${fev.contained}% contained`)
              const growth = fev.growth != null && Math.abs(fev.growth) >= 25
                ? ` · ${fev.growth > 0 ? 'growing (+' : 'shrinking ('}${fev.growth} detections vs. previous update)`
                : ''
              // Deterministic per-fire emission estimate (same GFAS-style
              // FRP conversion the Explain card uses).
              if (fev.frp_sum) {
                const t = (fev.frp_sum / 2) * 86400 * 0.368 * 1.65 / 1000
                official.push(`releasing roughly ${t >= 1e6 ? (t / 1e6).toFixed(1) + ' Mt' : Math.round(t).toLocaleString() + ' t'} CO₂/day (rough satellite estimate)`)
              }
              sections.push(sectionHtml({
                head: fireEventName(fev),
                big: `${fev.n.toLocaleString()} detections in the last 24 h`,
                alt: fev.acres != null ? `${fev.acres.toLocaleString()} acres total` : `~${fev.area_km2.toLocaleString()} km² footprint`,
                meta: `${ageStr}${official.length ? ' · ' + official.join(' · ') : ''} · peak ${fev.frp.toLocaleString()} MW${growth} · ${fev.perimeter_src === 'nifc' ? 'official NIFC perimeter shown; glows are the last 24 h of satellite detections' : 'footprint derived from VIIRS detections, not an official perimeter'}`,
              }))
              continue
            }
          }
          const ev = instancesRef.current[def.id]?.nearest(e.point.x, e.point.y, 16)
          if (ev) sections.push(sectionHtml(def.popupEvent(ev)))
          continue
        }
        if (def.kind === 'raster') continue // raster popups: open the full tool instead
        // Replay layers read the frame on screen, stamped with ITS run/time.
        const rc = replayRef.current
        const tapeField = rc && rc.layerId === def.id ? rc.tape : null
        const field = tapeField || fieldsRef.current[def.id]
        if (!field) continue
        const sample = def.kind === 'vector'
          ? field.sample(e.lngLat.lng, e.lngLat.lat)
          : field.sampleScalar(e.lngLat.lng, e.lngLat.lat)
        if (!sample) continue
        sections.push(sectionHtml(def.popup(sample, tapeField ? tapeField.metaAt() : layerMeta[def.id])))
        // Companion flow: cite the wind that's carrying the haze (skipped if
        // the Wind layer itself is on — it already prints the same run).
        if (def.flow && !layerOn.wind && (!rc || rc.layerId !== def.id || rc.atLive)) {
          const fk = `${def.id}:flow`
          const windDef = LAYERS.find((d) => d.dataset === def.flow.dataset)
          const flowField = fieldsRef.current[fk]
          const ws = flowField && windDef ? flowField.sample(e.lngLat.lng, e.lngLat.lat) : null
          if (ws) sections.push(sectionHtml(windDef.popup(ws, layerMeta[fk])))
        }
      }
      if (!sections.length) return
      popupRef.current?.remove()
      // No fixed anchor: Mapbox picks the side with room so the card stays
      // on screen; content itself is height-capped and scrolls (CSS).
      popupRef.current = new mapboxgl.Popup({ offset: 10, maxWidth: '290px' })
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class="${styles.popup}">${sections.join('')}` +
          `<div class="${styles.popupAnalysis}" data-sys-ai>Adding context…</div></div>`,
        )
        .addTo(map)
      attachPopupScrollHint(popupRef.current, styles)
      // Phones: the replay bar shrinks to a pill while a popup is open so the
      // two never overlap; restored on close.
      setPopupOpen(true)
      popupRef.current.once('close', () => setPopupOpen(false))

      // Same facts→narration pipeline as "Explain this view", popup-sized.
      // Click point rounded to ~10 km so repeat clicks on the same feature
      // (by anyone) share one cached generation. Failure just removes the
      // pending line — the deterministic facts above it stand alone.
      const popup = popupRef.current
      const reqId = ++popupAiReqRef.current
      // Ground the location for the narrator: hemisphere-lettered coordinates
      // (models misread signed decimals — 4.6°E once became "near Ullapool",
      // which is 5°W) and a deterministic land/water flag from the basemap's
      // own water polygons (a "fire" over water is a platform flare or ship,
      // not a wildfire).
      const lat = Math.round(e.lngLat.lat * 10) / 10
      const lng = Math.round((((e.lngLat.lng + 180) % 360 + 360) % 360 - 180) * 10) / 10
      let overWater = false
      try {
        overWater = map.getLayer(WATER_MASK_LAYER)
          ? map.queryRenderedFeatures(e.point, { layers: [WATER_MASK_LAYER] }).length > 0
          : map.queryRenderedFeatures(e.point).some((f) => f.sourceLayer === 'water')
      } catch { /* style not ready — fall through to the raster mask */ }
      // Basemap tiles may not be loaded yet (or at all, in a hidden tab);
      // the 0.1° Natural Earth land raster answers the same question offline.
      if (!overWater) {
        const bits = getLandMaskSync()
        if (bits && !isLand(bits, e.lngLat.lng, e.lngLat.lat)) overWater = true
        else if (!bits) loadLandMask().catch(() => {})
      }
      const popupFacts = {
        v: 1,
        mode: 'popup',
        time_utc: new Date(Math.floor(Date.now() / 3.6e6) * 3.6e6).toISOString().slice(0, 13) + ':00Z',
        point: {
          label: `${Math.abs(lat)}°${lat < 0 ? 'S' : 'N'}, ${Math.abs(lng)}°${lng < 0 ? 'W' : 'E'}`,
          lat,
          lng,
          surface: overWater ? 'open water (from basemap water polygons)' : 'land or nearshore',
        },
        layers: aiItems,
        ...(replayRef.current && !replayRef.current.atLive
          ? { replay: { frame_time_utc: new Date(replayRef.current.tape.metaAt().valid_ms).toISOString().slice(0, 16) + 'Z', note: 'archived analysis frame, not live conditions' } }
          : {}),
      }
      fetch(`/api/systems-explain?v=2&f=${b64url(JSON.stringify(popupFacts))}`)
        .then(async (r) => {
          const j = await r.json().catch(() => ({}))
          if (popupAiReqRef.current !== reqId || popupRef.current !== popup) return
          const el = popup.getElement()?.querySelector('[data-sys-ai]')
          if (!el) return
          if (r.ok && j.text) {
            el.innerHTML = formatAiText(j.text, { headers: false }) // escaped + formatted (aiFormat.js)
            el.classList.add(styles.popupAnalysisDone)
            // Re-run Mapbox's layout so the anchor is re-chosen for the GROWN
            // card — the anchor was picked while the popup still said
            // "Adding context…", and without this the added text runs off the
            // top of the map.
            try { popup.setLngLat(popup.getLngLat()) } catch { /* popup closed */ }
            attachPopupScrollHint(popup, styles)
          } else {
            el.remove()
          }
        })
        .catch(() => {
          if (popupAiReqRef.current === reqId && popupRef.current === popup) {
            popup.getElement()?.querySelector('[data-sys-ai]')?.remove()
          }
        })
    })

    // style.load fires on the initial style AND after every basemap switch —
    // (re)assert readiness and the globe atmosphere each time (required
    // convention; the one-shot 'load' can be missed under StrictMode). The
    // layer canvases are plain DOM above the map, untouched by style swaps.
    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(10, 14, 23)',
        'high-color': 'rgb(20, 30, 60)',
        'horizon-blend': 0.08,
        'space-color': 'rgb(6, 8, 16)',
        'star-intensity': 0.7,
      })
      // Invisible water polygons for clipping ocean overlays to true
      // shorelines and for the popup's land/water test. Satellite Streets
      // has NO water fill of its own (learned the hard way — the mask
      // silently no-op'd), but every Mapbox style's `composite` source is
      // Mapbox Streets v8, which carries the `water` layer already loaded
      // for labels/roads — so this costs no extra tiles.
      try {
        if (map.getSource('composite') && !map.getLayer(WATER_MASK_LAYER)) {
          map.addLayer({
            id: WATER_MASK_LAYER,
            type: 'fill',
            source: 'composite',
            'source-layer': 'water',
            paint: { 'fill-opacity': 0 },
          })
        }
      } catch (err) {
        console.warn('[systems] water mask layer unavailable on this style:', err)
      }
      setMapReady(true)
      // Basemap swaps wipe in-style layers (the raster overlays); bumping the
      // epoch re-runs the instances effect, which re-adds them.
      setStyleEpoch((n) => n + 1)
    })

    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Layer instance lifecycle ─────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    const inst = instancesRef.current

    // Vector layers: one particle canvas each; instances persist, visibility
    // toggles.
    for (const def of LAYERS) {
      if (def.kind !== 'vector') continue
      const ready = layerOn[def.id] && layerStatus[def.id] === 'ok'
      if (ready && !inst[def.id] && canvasEls.current[def.id]) {
        try {
          inst[def.id] = new ParticleLayer(map, canvasEls.current[def.id], fieldsRef.current[def.id], {
            count: densityCount(density),
            colorStops: def.stops,
            ...def.vector,
          })
        } catch (err) {
          console.error(`[systems] ${def.id} particle layer init failed:`, err)
          continue
        }
      }
      inst[def.id]?.setVisible(!!layerOn[def.id])
    }

    // Companion flow animations (e.g. wind particles under Smoke & haze).
    for (const def of LAYERS) {
      if (!def.flow) continue
      const fk = `${def.id}:flow`
      const ready = layerOn[def.id] && layerStatus[fk] === 'ok'
      if (ready && !inst[fk] && canvasEls.current[fk]) {
        try {
          inst[fk] = new ParticleLayer(map, canvasEls.current[fk], fieldsRef.current[fk], {
            count: Math.round(densityCount(density) * (def.flow.countScale ?? 1)),
            colorStops: def.flow.stops,
            ...def.flow.vector,
          })
        } catch (err) {
          console.error(`[systems] ${fk} particle layer init failed:`, err)
          continue
        }
      }
      const rc = replayRef.current
      inst[fk]?.setVisible(!!layerOn[def.id] && (!rc || rc.layerId !== def.id || rc.atLive))
    }

    // Event layers (quakes, fires): one ping canvas each. Layers with a
    // resolution ladder are owned by the zoom-swap effect below.
    for (const def of LAYERS) {
      if (def.kind !== 'events' || def.variants) continue
      const ready = layerOn[def.id] && layerStatus[def.id] === 'ok'
      if (ready && !inst[def.id] && canvasEls.current[def.id]) {
        try {
          inst[def.id] = new EventPingLayer(map, canvasEls.current[def.id], fieldsRef.current[def.id].events, {
            maxRender: def.ping.maxRender,
            ...def.ping,
          })
        } catch (err) {
          console.error(`[systems] ${def.id} ping layer init failed:`, err)
          continue
        }
      }
      inst[def.id]?.setVisible(!!layerOn[def.id])
    }

    // Raster overlays (vegetation loss): live inside the map style itself —
    // added/removed there and re-added after every basemap swap (styleEpoch).
    for (const def of LAYERS) {
      if (def.kind !== 'raster') continue
      const srcId = `systems-${def.id}-src`
      const layerId = `systems-${def.id}-layer`
      const payload = fieldsRef.current[def.id]
      const ready = layerOn[def.id] && layerStatus[def.id] === 'ok' && payload?.tileUrl
      try {
        if (ready && !map.getSource(srcId)) {
          map.addSource(srcId, {
            type: 'raster',
            tiles: [payload.tileUrl],
            tileSize: 256,
            attribution: 'NASA OPERA L3 DIST-ALERT · GLAD',
          })
          map.addLayer({
            id: layerId,
            type: 'raster',
            source: srcId,
            paint: { 'raster-opacity': def.raster.opacity },
          })
        }
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', ready ? 'visible' : 'none')
        }
      } catch (err) {
        console.error(`[systems] ${def.id} raster layer failed:`, err)
      }
    }

    // Scalar layers share one canvas (they're mutually exclusive) — swap the
    // overlay instance when the active scalar changes.
    const active = LAYERS.find((d) => d.kind === 'scalar' && layerOn[d.id] && layerStatus[d.id] === 'ok')
    // Replay-capable layers swap to the tape as soon as it's loaded (the
    // static "now" wash shows in the meantime). Earth's systems are in
    // motion: the tape starts playing the moment it's on screen.
    const wantYear = !!active?.tape?.year && replayRange[active.id] === 'year'
    const tapeKey = wantYear && layerStatus[`${active.id}:tape:year`] === 'ok' ? `${active.id}:tape:year`
      : layerStatus[`${active?.id}:tape`] === 'ok' ? `${active.id}:tape` : null
    const tape = active?.tape && tapeKey ? fieldsRef.current[tapeKey] : null
    const slotId = active ? (tape ? tapeKey : active.id) : null
    if (inst.scalar && inst.scalar.id !== slotId) {
      inst.scalar.layer.destroy()
      inst.scalar = null
      if (replayRef.current) { replayRef.current.destroy(); replayRef.current = null; setReplay(null) }
    }
    if (active && !inst.scalar && canvasEls.current.scalar) {
      try {
        if (tape) tape.appendLive(fieldsRef.current[active.id])
        const layer = new ScalarOverlayLayer(map, canvasEls.current.scalar, tape || fieldsRef.current[active.id], {
          colorStops: active.stops,
          min: active.legend.min,
          max: active.legend.max,
          opacity: active.scalar.opacity,
          mask: active.scalar.mask,
          tape: !!tape,
        })
        inst.scalar = { id: slotId, layer }
        if (tape) {
          const rc = new ReplayController(tape, { windowDays: active.tape.windowDays }) // pace/window follow the tape cadence
          rc.layerId = active.id
          const resume = resumeRef.current[active.id]
          if (resume) { delete resumeRef.current[active.id]; rc.seek(resume.t); if (resume.playing) rc.play(); else rc.pause() }
          rc.attach(layer)
          // Companion flow particles show today's wind — only honest at "now".
          if (active.flow) {
            const fk = `${active.id}:flow`
            rc.subscribe((c) => inst[fk]?.setVisible(c.atLive && !!stateRef.current.layerOn[active.id]))
          }
          replayRef.current = rc
          if (import.meta.env.DEV) window.__systemsReplay = rc // dev-only QA handle
          setReplay(rc)
        }
      } catch (err) {
        console.error(`[systems] ${active.id} overlay init failed:`, err)
      }
    }
    inst.scalar?.layer.setVisible(!!active)

    // Event timelines (earthquakes): the feed's own timestamps drive a time
    // cursor. One transport bar: a scalar replay (if any) owns it and the
    // event layer follows its time; otherwise the event layer gets its own
    // controller.
    const tlDef = LAYERS.find((d) => d.timeline && layerOn[d.id] && layerStatus[d.id] === 'ok' && inst[d.id])
    const ev = eventReplayRef.current
    if (ev && (!tlDef || ev.layerId !== tlDef.id || replayRef.current)) {
      ev.destroy(); eventReplayRef.current = null; setEventReplay(null)
      inst[ev.layerId]?.setTime(null)
    }
    if (tlDef) {
      const ping = inst[tlDef.id]
      if (replayRef.current) {
        // Follow the scalar replay's cursor (within the feed's window).
        const rc = replayRef.current
        if (!rc.followers?.has(tlDef.id)) {
          rc.followers = rc.followers || new Set(); rc.followers.add(tlDef.id)
          rc.subscribe((c) => ping.setTime(c.atLive ? null : c.t, c.playing ? 'flow' : 'day'))
        }
      } else if (!eventReplayRef.current) {
        const tape = new EventTape(fieldsRef.current[tlDef.id].events, tlDef.timeline)
        const rc = new ReplayController(tape, { windowDays: tlDef.timeline.windowDays, rateHoursPerSec: tlDef.timeline.rateHoursPerSec || 24 })
        rc.layerId = tlDef.id
        const resumeE = resumeRef.current[tlDef.id]
        if (resumeE) { delete resumeRef.current[tlDef.id]; rc.seek(resumeE.t); if (resumeE.playing) rc.play(); else rc.pause() }
        const modeOf = (c) => (c.atLive ? 'last24' : c.playing && !c.holding ? 'flow' : 'day')
        rc.attach({ tick: () => ping.setTime(rc.t, modeOf(rc)) })
        rc.subscribe((c) => ping.setTime(c.t, modeOf(c))) // pause → whole day; Now → past 24 h
        eventReplayRef.current = rc
        if (import.meta.env.DEV) window.__systemsReplay = rc
        setEventReplay(rc)
      }
    }
  }, [mapReady, layerOn, layerStatus, density, styleEpoch, replayRange, dataEpoch])

  // ─── Keep a globe left open current: every 10 min, check each visible
  // layer's source for a newer bake (tiny metadata/index fetch) and, only if
  // there is one, reload it and rebuild that layer in place — replay position
  // and camera untouched. Crons refresh upstream every 3–12 h; Blob/CDN
  // caches are ≤5 min, so a 10-min poll sees every new run.
  useEffect(() => {
    if (!mapReady) return
    const REFRESH_MS = 10 * 60 * 1000
    const id = setInterval(async () => {
      if (document.hidden) return
      const { layerOn: on, layerStatus: st, layerMeta: lm } = stateRef.current
      let changed = false
      for (const def of LAYERS) {
        if (!on[def.id] || st[def.id] !== 'ok') continue
        try {
          if (def.load) {
            // Event/raster loaders (USGS, hotspots JSON, GEE) are small — reload outright.
            const payload = await def.load()
            const newer = !lm[def.id]?.fetched_ms || (payload.meta?.fetched_ms || 0) > lm[def.id].fetched_ms || def.id === 'quakes'
            if (newer) {
              fieldsRef.current[def.id] = payload
              setLayerMeta((m) => ({ ...m, [def.id]: payload.meta }))
              const inst = instancesRef.current
              const ev = eventReplayRef.current
              if (ev && ev.layerId === def.id) { resumeRef.current[def.id] = { t: ev.t, playing: ev.playing }; ev.destroy(); eventReplayRef.current = null; setEventReplay(null) }
              if (inst[def.id]) { inst[def.id].destroy?.(); inst[def.id] = null }
              changed = true
            }
          } else {
            const base = fieldsRef.current[def.id]?.meta
            const metaRes = await fetch(`${SOURCE_BASES[0]}/${def.dataset}-meta.json`, { cache: 'no-cache' }).catch(() => null)
            const meta = metaRes?.ok ? await metaRes.json() : null
            let gridNewer = meta && base && (meta.fetched_ms || 0) > (base.fetched_ms || 0)
            let tapeNewer = false
            let newTape = null
            if (def.tape && fieldsRef.current[`${def.id}:tape`]) {
              const cur = fieldsRef.current[`${def.id}:tape`]
              const idxRes = await fetch(`${SOURCE_BASES[0]}/${def.tape.dataset}-tape.json`, { cache: 'no-cache' }).catch(() => null)
              const idx = idxRes?.ok ? await idxRes.json() : null
              if (idx && (idx.fetched_ms || 0) > (cur.index.fetched_ms || 0)) {
                newTape = await TapeField.load(def.tape.dataset, def.tape.expectKind)
                tapeNewer = true
              }
            }
            if (gridNewer) fieldsRef.current[def.id] = await loadGridField(def.dataset, def.expectKind)
            if (gridNewer || tapeNewer) {
              if (gridNewer) setLayerMeta((m) => ({ ...m, [def.id]: fieldsRef.current[def.id].meta }))
              if (newTape) fieldsRef.current[`${def.id}:tape`] = newTape
              const inst = instancesRef.current
              const rc = replayRef.current
              if (rc && rc.layerId === def.id) { resumeRef.current[def.id] = { t: rc.t, playing: rc.playing }; rc.destroy(); replayRef.current = null; setReplay(null) }
              if (inst.scalar && inst.scalar.id.startsWith(def.id)) { inst.scalar.layer.destroy(); inst.scalar = null }
              if (inst[def.id]) { inst[def.id].destroy?.(); inst[def.id] = null }
              if (inst[`${def.id}:flow`]) { inst[`${def.id}:flow`].destroy?.(); inst[`${def.id}:flow`] = null }
              changed = true
            }
          }
        } catch (err) {
          console.warn(`[systems] refresh ${def.id} failed:`, err)
        }
      }
      // Re-render regardless so "fetched N min ago" stamps stay honest.
      setDataEpoch((n) => n + 1)
      if (changed) console.info('[systems] refreshed layer data')
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [mapReady])

  // ─── Zoom-dependent resolution ladder for event layers with variants
  // (fires: 0.5° clusters at world view → 0.25° past z4.5 → ~5 km cells past
  // z6.5, so fires resolve into their actual shape). Finer files lazy-load on
  // first need; while one loads, the finest already-loaded tier shows. The
  // instance is recreated when the active tier changes.
  const [fineTick, setFineTick] = useState(0)
  const fineLoadingRef = useRef({})
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    const inst = instancesRef.current
    for (const def of LAYERS) {
      if (def.kind !== 'events' || !def.variants) continue
      const on = !!layerOn[def.id]
      const ready = on && layerStatus[def.id] === 'ok'
      if (!ready) { inst[def.id]?.setVisible(false); continue }
      const zoom = mapView?.zoom ?? map.getZoom()
      const keyFor = (v) => (v.id === 'coarse' ? def.id : `${def.id}_${v.id}`)
      const wantIdx = def.variants.reduce((acc, v, i) => (zoom >= v.minZoom ? i : acc), 0)
      const want = def.variants[wantIdx]
      if (wantIdx > 0 && !fieldsRef.current[keyFor(want)] && !fineLoadingRef.current[keyFor(want)]) {
        fineLoadingRef.current[keyFor(want)] = true
        def.loadVariant(want.dataset)
          .then((p) => { fieldsRef.current[keyFor(want)] = p; setFineTick((t) => t + 1) })
          .catch(() => { fineLoadingRef.current[keyFor(want)] = 'failed' }) // stay on a coarser tier
      }
      // Finest tier at or below the wanted one that has loaded (coarse always has).
      let active = def.variants[0]
      for (let i = wantIdx; i >= 0; i--) {
        if (fieldsRef.current[keyFor(def.variants[i])]) { active = def.variants[i]; break }
      }
      const payload = fieldsRef.current[keyFor(active)]
      if (inst[def.id] && inst[def.id]._variant !== active.id) {
        inst[def.id].destroy()
        inst[def.id] = null
      }
      if (!inst[def.id] && canvasEls.current[def.id]) {
        try {
          inst[def.id] = new EventPingLayer(map, canvasEls.current[def.id], payload.events, {
            ...def.ping,
            maxRender: active.maxRender ?? def.ping.maxRender,
          })
          inst[def.id]._variant = active.id
        } catch (err) {
          console.error(`[systems] ${def.id} ping layer init failed:`, err)
          continue
        }
      }
      inst[def.id]?.setVisible(on)
    }
  }, [mapReady, layerOn, layerStatus, mapView, fineTick])

  // ─── Fire events: lazy-load with the fires layer; overlay draws hulls +
  // labels past MIN_DRAW_ZOOM and upgrades fire clicks to rich event popups.
  const [eventsTick, setEventsTick] = useState(0)
  const fireEventsLoadRef = useRef(false)
  useEffect(() => {
    const on = !!layerOn.hotspots
    const inst = instancesRef.current
    if (on && !fieldsRef.current.fireevents && !fireEventsLoadRef.current) {
      fireEventsLoadRef.current = true
      loadSystemsJson('fire-events', 'fire-events')
        .then((j) => { fieldsRef.current.fireevents = j; setEventsTick((t) => t + 1) })
        .catch(() => { fireEventsLoadRef.current = 'failed' }) // glows still work
    }
    if (mapReady && on && fieldsRef.current.fireevents && !inst.fireevents && canvasEls.current.fireevents) {
      try {
        inst.fireevents = new FireEventsOverlay(
          mapRef.current, canvasEls.current.fireevents, fieldsRef.current.fireevents.events,
        )
      } catch (err) {
        console.error('[systems] fire-events overlay init failed:', err)
      }
    }
    inst.fireevents?.setVisible(on)
  }, [mapReady, layerOn, eventsTick])

  // Destroy all layer instances on unmount.
  useEffect(() => () => {
    const inst = instancesRef.current
    for (const key of Object.keys(inst)) {
      if (!inst[key]) continue
      if (key === 'scalar') inst[key].layer.destroy()
      else inst[key].destroy()
      inst[key] = null
    }
  }, [])

  useEffect(() => {
    for (const def of LAYERS) {
      if (def.kind === 'vector') instancesRef.current[def.id]?.setCount(densityCount(density))
      if (def.flow) instancesRef.current[`${def.id}:flow`]?.setCount(Math.round(densityCount(density) * (def.flow.countScale ?? 1)))
    }
  }, [density])

  // Mobile: the drawer mounts only in 'drawer' view; open it once mounted.
  useEffect(() => {
    if (isMobile && mobileView === 'drawer') { const t = setTimeout(() => setDrawerSignal((n) => n + 1), 0); return () => clearTimeout(t) }
  }, [isMobile, mobileView])

  // Mobile: no hover, so a tap shows a transient "Name on/off" chip (~1.5 s).
  const showChip = useCallback((id, on) => {
    clearTimeout(chipTimerRef.current)
    setChip({ id, on })
    chipTimerRef.current = setTimeout(() => setChip(null), 1500)
  }, [])

  const toggleLayer = useCallback((id) => {
    setLayerOn((on) => {
      const def = LAYERS.find((d) => d.id === id)
      const next = { ...on, [id]: !on[id] }
      // One "surface color" slot: enabling a scalar layer disables the other.
      if (def.kind === 'scalar' && next[id]) {
        for (const other of LAYERS) {
          if (other.kind === 'scalar' && other.id !== id) next[other.id] = false
        }
      }
      return next
    })
  }, [])
  if (import.meta.env.DEV) window.__systemsToggle = toggleLayer // dev-only QA handle

  // ─── Centre the globe in the VISIBLE map, not the whole window: tell Mapbox
  // the open panel occupies the left edge (padding), so the globe sits in the
  // middle of what the user can actually see. Re-evaluated on collapse/resize.
  useEffect(() => {
    if (!mapReady) return
    const map = mapRef.current
    const apply = () => {
      const el = document.querySelector(`.${styles.panel.split(' ')[0]}`)
      const dock = document.querySelector(`.${styles.dock.split(' ')[0]}`)
      const left = isMobile ? 0
        : panelOpen && el ? Math.round(el.getBoundingClientRect().right)
        : dock ? Math.round(dock.getBoundingClientRect().right) : 0
      const cur = map.getPadding()
      if (cur.left !== left) map.easeTo({ padding: { top: 0, right: 0, bottom: 0, left }, duration: 350 })
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [mapReady, panelOpen, isMobile, mobileView])

  // ─── Persist the full view to the URL (shareable links) ───────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    for (const def of LAYERS) {
      if (def.defaultOn && !layerOn[def.id]) sp.set(def.param, '0')
      if (!def.defaultOn && layerOn[def.id]) sp.set(def.param, '1')
    }
    if (density !== 'med') sp.set('d', density)
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3))
      sp.set('lng', mapView.lng.toFixed(3))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
  }, [layerOn, density, basemap, mapView])

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

  // ─── Per-route SEO (client side; the static systems.html covers crawlers) ─
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'In Motion — Earth’s systems, animated · EarthAtlas'
    const setMeta = (sel, val) => {
      const el = document.head.querySelector(sel)
      if (!el) return null
      const prev = el.getAttribute('content')
      el.setAttribute('content', val)
      return prev
    }
    const desc = 'Watch Earth’s systems in motion — live winds and ocean currents as flowing particles, sea temperature and waves painted on a globe, with plain-language explanations and inline sources for every value. An EarthAtlas tool.'
    const prevDesc = setMeta('meta[name="description"]', desc)
    const prevOgT = setMeta('meta[property="og:title"]', document.title)
    const prevOgD = setMeta('meta[property="og:description"]', desc)
    const prevOgU = setMeta('meta[property="og:url"]', 'https://earthatlas.org/inmotion')
    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', prevDesc)
      if (prevOgT != null) setMeta('meta[property="og:title"]', prevOgT)
      if (prevOgD != null) setMeta('meta[property="og:description"]', prevOgD)
      if (prevOgU != null) setMeta('meta[property="og:url"]', prevOgU)
    }
  }, [])

  // ─── Clip recorder wiring (ClipStudio) ────────────────────────────────────
  const getClipMap = useCallback(() => mapRef.current, [])
  const clipBeforeRecord = useCallback(() => popupRef.current?.remove(), [])
  const getClipOverlays = useCallback(
    () => OVERLAY_KEYS.map((k) => canvasEls.current[k]).filter(Boolean),
    [],
  )
  const getClipBrand = useCallback(() => {
    const imagery = basemap === 'satellite' ? '© Mapbox © Maxar' : '© Mapbox © OpenStreetMap'
    const fmtD = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const activeNow = () => {
      const { layerOn, layerStatus } = stateRef.current
      return LAYERS.filter((d) => layerOn[d.id] && layerStatus[d.id] === 'ok')
    }
    // Re-read layers and replay position per frame: a playing replay's date
    // (and a mid-take layer toggle) must stamp what's actually on screen.
    const sourceLine = () => {
      const rc = replayRef.current || eventReplayRef.current
      const when = rc && !rc.atLive ? `showing ${fmtD(rc.t)}` : fmtD(Date.now())
      return [...activeNow().map((d) => `${d.name}: ${d.sourceName}`), imagery, when].join(' · ')
    }
    return { sourceLine, shareUrl: window.location.href, layerIds: activeNow().map((d) => d.id) }
  }, [basemap])

  const handleSelect = useCallback((r) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
    mapRef.current?.flyTo({ center: [r.lng, r.lat], zoom: 4.5, duration: 1600, essential: true })
  }, [])

  // ─── "Explain this view": facts engine → AI narration ─────────────────────
  // explain: null | { status: 'loading'|'ok'|'error'|'not_configured', facts, text }
  const [explain, setExplain] = useState(null)
  const [revealed, setRevealed] = useState(0)
  const explainReqRef = useRef(0)

  const handleExplain = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const active = LAYERS
      .filter((d) => layerOn[d.id] && layerStatus[d.id] === 'ok')
      .map((d) => {
        const rc = replayRef.current
        if (rc && rc.layerId === d.id) return { def: d, payload: rc.tape, meta: rc.tape.metaAt() }
        return { def: d, payload: fieldsRef.current[d.id], meta: layerMeta[d.id] }
      })
    if (!active.length) return
    // Facts are instant and free — show them immediately while the prose loads.
    const facts = buildViewFacts(map, active)
    const reqId = ++explainReqRef.current
    setExplain({ status: 'loading', facts, text: null })
    fetch(`/api/systems-explain?v=2&f=${b64url(JSON.stringify(facts))}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (explainReqRef.current !== reqId) return
        if (r.ok && j.text) setExplain({ status: 'ok', facts, text: j.text })
        else setExplain({ status: j.error === 'not_configured' ? 'not_configured' : 'error', facts, text: null })
      })
      .catch(() => {
        if (explainReqRef.current === reqId) setExplain({ status: 'error', facts, text: null })
      })
  }, [layerOn, layerStatus, layerMeta])

  // Typewriter reveal for the narration — time-based (not per-tick) so
  // browser timer throttling can't slow it down.
  useEffect(() => {
    if (explain?.status !== 'ok' || !explain.text) return
    setRevealed(0)
    const start = performance.now()
    const CHARS_PER_SEC = 220
    const id = setInterval(() => {
      const n = Math.floor(((performance.now() - start) / 1000) * CHARS_PER_SEC)
      if (n >= explain.text.length) { clearInterval(id) }
      setRevealed(Math.min(n, explain.text.length))
    }, 33)
    return () => clearInterval(id)
  }, [explain])

  const anyExplainable = LAYERS.some((d) => layerOn[d.id] && layerStatus[d.id] === 'ok')

  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenError}>
          <strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.
        </div>
      </div>
    )
  }

  const activeDefs = LAYERS.filter((d) => layerOn[d.id])
  const anyVectorOn = activeDefs.some((d) => d.kind === 'vector' || d.flow)
  const summary = activeDefs.length
    ? `${activeDefs.map((d) => d.name).join(' + ')} on`
    : 'All layers off'

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {/* Overlay stack: scalar color wash below, particle layers above,
          event pings (fires, quakes) on top. */}
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current.scalar = el }} aria-hidden="true" />
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current['aerosol:flow'] = el }} aria-hidden="true" />
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current.currents = el }} aria-hidden="true" />
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current.wind = el }} aria-hidden="true" />
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current.hotspots = el }} aria-hidden="true" />
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current.fireevents = el }} aria-hidden="true" />
      <canvas className={styles.windCanvas} ref={(el) => { canvasEls.current.quakes = el }} aria-hidden="true" />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      {/* Branding */}
      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>In Motion</span>
      </div>

      {/* Search — full box on desktop, magnifier icon top-right on phones */}
      <MapSearch className={styles.searchBox}>
        <GeoSearch
          placeholder="Fly to a place on the globe…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handleSelect}
        />
      </MapSearch>

      {/* Explain this view — the facts engine + AI narration entry point */}
      <button
        type="button"
        className={styles.explainBtn}
        onClick={handleExplain}
        disabled={!anyExplainable}
        title={anyExplainable ? 'Analyze what you’re seeing' : 'Turn on a layer first'}
      >
        <span className={styles.explainSpark} aria-hidden="true">✦</span>
        Explain this view
      </button>

      {explain && (
        <div className={styles.explainCard}>
          <button type="button" className={styles.explainClose} onClick={() => setExplain(null)} aria-label="Close">×</button>
          {explain.status === 'loading' && (
            <div className={styles.explainLoading}>Reading the view<span className={styles.explainEllipsis} /></div>
          )}
          {explain.status === 'ok' && (
            <div className={styles.explainText}>
              {/* Formatted from the narrator's strict mini-format; escaped first (aiFormat.js). */}
              <div dangerouslySetInnerHTML={{ __html: formatAiText(explain.text.slice(0, revealed)) }} />
              {revealed < explain.text.length && <span className={styles.explainCursor} />}
            </div>
          )}
          {explain.status === 'not_configured' && (
            <p className={styles.explainMuted}>
              The numbers below are computed live from the data on screen. AI narration
              isn&apos;t configured yet — it activates once an Anthropic API key is set.
            </p>
          )}
          {explain.status === 'error' && (
            <p className={styles.explainMuted}>
              AI narration is unavailable right now — the numbers below are still real,
              computed from the data on screen.
            </p>
          )}
          <div className={styles.explainChips}>
            {explain.facts.layers.map((f) => (
              <span key={f.id} className={styles.explainChip}>{factChip(f)}</span>
            ))}
          </div>
          <div className={styles.explainFooter}>
            <button type="button" className={styles.explainRefresh} onClick={handleExplain}>re-analyze</button>
          </div>
        </div>
      )}

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

      {/* Record a clip — shareable branded video of exactly this view */}
      {mapReady && (
        <ClipStudio
          getMap={getClipMap}
          getOverlays={getClipOverlays}
          getBrand={getClipBrand}
          onBeforeRecord={clipBeforeRecord}
        />
      )}

      {/* Control panel — floating left panel on desktop, drawer on phones */}
      {/* Icon dock — default navigation on every screen size. */}
      {((!isMobile && !panelOpen) || (isMobile && mobileView === 'dock')) && (
        <div className={`${styles.dock} ${isMobile ? styles.dockMobile : ''}`} role="toolbar" aria-label="Layers">
          <div className={styles.dockTitle}>I want to see…</div>
          <div className={styles.dockMeta}>
            <span className={styles.countChip}>{activeDefs.length} on</span>
            <div className={styles.dockCtl}>
              {isMobile && (
                <button type="button" className={styles.dockBtnSm} onClick={() => setMobileView('pill')} aria-label="Hide layer icons">«</button>
              )}
              <button
                type="button"
                className={styles.dockBtnSm}
                onClick={() => { if (isMobile) setMobileView('drawer'); else setPanelOpen(true) }}
                aria-label="Expand panel"
              >▸</button>
            </div>
          </div>
          {GROUPS.map((group) => (
            <div key={group.id} className={styles.dockGroup}>
              <div className={styles.dockGroupLabel}>{group.label}</div>
              <div className={styles.dockGrid}>
                {LAYERS.filter((d) => d.group === group.id).map((def) => {
                  const on = !!layerOn[def.id]
                  return (
                    <button
                      key={def.id}
                      type="button"
                      className={`${styles.dockBtn} ${on ? styles.dockOn : ''}`}
                      style={on ? hueStyle(def.hue) : undefined}
                      onClick={() => { toggleLayer(def.id); if (isMobile) showChip(def.id, !on) }}
                      aria-pressed={on}
                      aria-label={def.name}
                      data-name={def.name}
                      data-sub={def.sub}
                    >
                      <LayerIcon svg={def.iconSvg} size={isMobile ? 16 : 19} />
                      {on && <span className={styles.liveDotHue} aria-hidden="true" />}
                      {!isMobile && (
                        <span className={styles.dockTip} aria-hidden="true">{def.name} <span>· {def.sub}</span></span>
                      )}
                      {isMobile && chip?.id === def.id && (
                        <span className={styles.tapChip} style={{ '--hue': def.hue }} aria-hidden="true">{def.name} <b>{chip.on ? 'on' : 'off'}</b></span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {isMobile && mobileView === 'pill' && (
        <button type="button" className={styles.pill} onClick={() => setMobileView('dock')} aria-label="Show layers">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
            <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
            <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
          </svg>
          {activeDefs.length > 0 && <span className={styles.pillBadge}>{activeDefs.length}</span>}
        </button>
      )}
      {(!isMobile || mobileView === 'drawer') && <MapSheet
        title="I want to see…"
        summary={summary}
        className={`${styles.panel} ${!isMobile && !panelOpen ? styles.panelHidden : ''}`}
        expandSignal={drawerSignal}
        onSnapChange={(snap) => { if (isMobile && snap === 'peek' && mobileView === 'drawer') setMobileView('dock') }}
      >
        <div className={styles.panelHead}>
          <span className={styles.dockTitle}>I want to see…</span>
          <span className={styles.countChip}>{activeDefs.length} on</span>
          <button className={styles.panelCollapse} onClick={() => { if (isMobile) setMobileView('dock'); else setPanelOpen(false) }} aria-label="Collapse to icons">◂</button>
        </div>

        {(panelOpen || isMobile) && (
          <div className={styles.panelBody}>
            {GROUPS.map((group) => (
              <div key={group.id} className={styles.group}>
                <div className={styles.groupHead}>{group.label}</div>
            {LAYERS.filter((d) => d.group === group.id).map((def) => {
              const on = layerOn[def.id]
              const status = layerStatus[def.id]
              const meta = layerMeta[def.id]
              return (
                <div key={def.id} className={styles.layerBlock}>
                  <div
                    className={styles.layerRow}
                    role="switch"
                    aria-checked={on}
                    tabIndex={0}
                    onClick={() => toggleLayer(def.id)}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleLayer(def.id) } }}
                  >
                    <span className={`${styles.rowIcon} ${on ? styles.dockOn : ''}`} style={on ? hueStyle(def.hue) : undefined} aria-hidden="true">
                      <LayerIcon svg={def.iconSvg} size={16} />
                    </span>
                    <div className={styles.layerInfo}>
                      <span className={styles.layerName}>{def.name}</span>
                      <span className={styles.layerSub}>{def.sub}</span>
                    </div>
                  </div>

                  {on && status === 'ok' && meta && (
                    <div className={styles.liveNote}>
                      <span className={styles.liveDot} aria-hidden="true" />
                      Live —{' '}
                      <a className={styles.sourceLink} href={def.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                        {def.sourceName}
                      </a>
                      {' · '}{def.stamp(meta)}, fetched {agoWord(meta.fetched_ms)}.
                    </div>
                  )}
                  {on && status === 'loading' && (
                    <div className={styles.loadingNote}>Loading live data…</div>
                  )}
                  {on && status === 'error' && (
                    <div className={styles.errorNote}>
                      Live data for this layer is unavailable right now, so it stays off —
                      we don&apos;t show stale or made-up values. Try again shortly.
                    </div>
                  )}

                  {on && status === 'ok' && def.legend && (
                    <div className={styles.field}>
                      <div
                        className={styles.legendBar}
                        style={{ background: rampGradient(def.stops, def.legend.min, def.legend.max) }}
                      />
                      <div className={styles.legendScale}>
                        {def.legend.ticks.map((t) => <span key={t}>{t}</span>)}
                      </div>
                      {def.words && (
                        <div className={styles.legendWords}>
                          {def.words.map((w) => (
                            <span key={w.label} className={styles.legendWord}>
                              <strong>{w.label}</strong> {w.range}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {on && status === 'ok' && !def.legend && def.legendNote && (
                    <div className={styles.field}>
                      <div className={styles.legendNoteText}>{def.legendNote}</div>
                    </div>
                  )}
                </div>
              )
            })}
              </div>
            ))}

            {anyVectorOn && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Particle density</label>
                <div className={styles.chipRow}>
                  {DENSITIES.map((d) => (
                    <button key={d.id} className={density === d.id ? styles.chipActive : styles.chip} onClick={() => setDensity(d.id)}>
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* The explain layer — the reason /systems exists */}
            <div className={styles.explainBox}>
              <label className={styles.explainBoxLabel}>What am I seeing?</label>
              {activeDefs.length ? (
                activeDefs.map((def) => (
                  <p key={def.id} className={styles.explain}>{def.explain}</p>
                ))
              ) : (
                <p className={styles.explain}>
                  All layers are off — flip one on to see Earth in motion. Click anywhere
                  on the globe for the conditions there.
                </p>
              )}
            </div>

            <div className={styles.comingNext}>
              Coming next: carbon monoxide · CO₂ &amp; methane · air quality (PM2.5)
            </div>

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
      </MapSheet>}

      {(replay || eventReplay) ? (
        <TransportBar
          controller={replay || eventReplay}
          sourceName={LAYERS.find((d) => d.id === (replay || eventReplay).layerId)?.sourceName}
          sourceUrl={LAYERS.find((d) => d.id === (replay || eventReplay).layerId)?.sourceUrl}
          shifted={panelOpen && !isMobile}
          mini={isMobile && popupOpen}
          range={replay && LAYERS.find((d) => d.id === replay.layerId)?.tape?.year ? (replayRange[replay.layerId] || 'short') : undefined}
          onRange={replay && LAYERS.find((d) => d.id === replay.layerId)?.tape?.year
            ? (k) => setReplayRange((r) => ({ ...r, [replay.layerId]: k }))
            : undefined}
        />
      ) : (
        <div className={styles.tip}>Drag to spin the globe · click anywhere for conditions there</div>
      )}

      {showMethodology && (
        <MethodologyModal onClose={() => setShowMethodology(false)} layerMeta={layerMeta} />
      )}
    </div>
  )
}

// ─── "How this is sourced" modal ────────────────────────────────────────────
function MethodologyModal({ onClose, layerMeta }) {
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
          <h3>What you&apos;re looking at</h3>
          <p>
            <strong>Model analysis data</strong>: physics simulations of the atmosphere and
            ocean, anchored to millions of real observations from satellites, buoys, ships,
            balloons, and surface stations. Moving particles trace flow (wind, currents) —
            direction follows the flow, color encodes strength. Color washes paint scalar
            fields (temperature, wave height). Every layer&apos;s animation and its
            click-readout sample the <strong>same downloaded grid from the same model
            run</strong>, refreshed on each source&apos;s own update cycle and stamped with
            its run time.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Where the data comes from</h3>
          <ul>
            {LAYERS.map((def) => (
              <li key={def.id}>
                <strong>{def.name} — </strong>
                <a href={def.sourceUrl} target="_blank" rel="noopener noreferrer">{def.sourceName}</a>
                {'. '}
                {def.id === 'wind' && 'NOAA’s global weather model (GFS), published openly every six hours; we fetch the step nearest now from Unidata’s THREDDS server at 0.5°.'}
                {def.id === 'currents' && 'The US Navy’s global ocean analysis (ESPC-D, HYCOM model, 1/12°), fetched from the HYCOM consortium’s public server; land is masked by the model itself.'}
                {def.id === 'sst' && 'NOAA Coral Reef Watch’s daily 5 km CoralTemp analysis, fetched via NOAA CoastWatch at 0.5°.'}
                {def.id === 'waves' && 'NOAA’s WaveWatch III global wave model (significant wave height), fetched via the PacIOOS server at 0.5°.'}
                {layerMeta[def.id] && <> Currently: <strong>{def.stamp(layerMeta[def.id])}</strong>.</>}
              </li>
            ))}
            <li>
              <strong>Rendering.</strong> In-house renderers built for EarthAtlas — no
              third-party weather service in between. Basemap: Mapbox satellite, dark,
              light, and streets styles.
            </li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>Why it matters</h3>
          <p>
            These layers are one connected engine: wind drives the currents and the waves;
            the ocean&apos;s stored heat steers the wind and feeds storms. Warm sea surfaces
            fuel hurricanes and bleach corals; upwelling cold water feeds fisheries; swell
            from distant storms becomes the surf on your coast. Learning to read these maps
            together is learning to see how the planet actually works.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Caveats</h3>
          <p>
            Global models smooth over local detail — gusts, harbor chop, and shoreline
            effects live below their grid scale, and we serve everything at ~0.5° (~55 km).
            Between refreshes a field can lag current conditions by a few hours (each
            layer&apos;s run and fetch times are always stamped). Analyses are estimates,
            not measurements, though heavily constrained by real observations. Wind is
            described by where it blows <em>from</em>; currents by where they flow{' '}
            <em>toward</em> — both conventions are followed here.
          </p>
        </section>
      </div>
    </div>
  )
}
