/**
 * EarthAtlas QuakesApp — live earthquake map at /quakes.
 *
 * A native EarthAtlas port of the standalone "seismic-data" project: the same
 * features (global + location/radius earthquake map, magnitude-colored
 * circles, age fade, time-range filtering with presets, magnitude & daily
 * charts, summary stats) rebuilt in the EarthAtlas idiom —
 * full-bleed Mapbox map, dark glass panels, the shared GeoSearch box, the
 * VITE_MAPBOX_TOKEN convention, CSS modules. No Supabase, no API keys beyond
 * Mapbox: earthquake data comes straight from the public USGS GeoJSON feeds.
 *
 * Data flow: fetch one month of quakes once (per magnitude band), then derive
 * the global view and any location/radius view by filtering in memory, and
 * the displayed set by the time-range window. The map, charts, and stats all
 * read from that single filtered set.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import {
  FEEDS,
  fetchQuakes,
  filterByRadius,
  ageOpacity,
  magColor,
  aggregateDaily,
  computeStats,
  MAG_RAMP,
} from './quakesService.js'
import styles from './QuakesApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const DEFAULT_VIEW = { center: [-101.672, 31.245], zoom: 2.4 }
const RADIUS_OPTIONS = [25, 50, 100, 250, 500, 1000]
const DEFAULT_RADIUS = 250

// Time-range presets — each returns a [start, end] window in ms from now.
const HOUR = 3.6e6
const DAY = 24 * HOUR
const TIME_PRESETS = [
  { id: 'today', label: 'Today', start: () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() } },
  { id: '24h', label: '24 hours', start: () => Date.now() - DAY },
  { id: '48h', label: '48 hours', start: () => Date.now() - 2 * DAY },
  { id: 'week', label: 'Week', start: () => Date.now() - 7 * DAY },
  { id: 'month', label: 'Month', start: () => Date.now() - 30 * DAY },
]

const BASEMAPS = [
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// ─── Geometry: a geodesic circle polygon for the radius overlay ─────────────
function radiusCircleGeoJSON(centerLat, centerLng, radiusMiles, points = 96) {
  const coords = []
  const rRad = radiusMiles / 3959
  const latR = (centerLat * Math.PI) / 180
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const lat = Math.asin(Math.sin(latR) * Math.cos(rRad) + Math.cos(latR) * Math.sin(rRad) * Math.cos(angle))
    const lng =
      (centerLng * Math.PI) / 180 +
      Math.atan2(Math.sin(angle) * Math.sin(rRad) * Math.cos(latR), Math.cos(rRad) - Math.sin(latR) * Math.sin(lat))
    coords.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}

// Mapbox zoom that roughly frames a given radius (miles) on screen.
function zoomForRadius(miles) {
  if (miles <= 25) return 8.5
  if (miles <= 50) return 7.5
  if (miles <= 100) return 6.5
  if (miles <= 250) return 5.2
  if (miles <= 500) return 4.2
  return 3.2
}

function fmtTime(t) {
  return new Date(t).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Evenly sample up to `max` items from a (time-sorted) array, so a scatter
// spreads across the whole window instead of bunching on the densest end — a
// plain slice(0, max) of newest-first data would pile every dot on the right.
function sampleEvenly(arr, max) {
  if (arr.length <= max) return arr
  const step = arr.length / max
  const out = []
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)])
  return out
}

// Count histograms use a single neutral hue (sky blue, matching the radius
// circle) so they never read as magnitude — that's what the warm ramp is for.
const COUNT_BAR_COLOR = '#38bdf8'

// ─── Lightweight inline SVG charts (no chart library) ───────────────────────
function ScatterChart({ events, range }) {
  const W = 280, H = 110, padL = 22, padB = 16, padT = 6, padR = 6
  const [t0, t1] = range
  const span = Math.max(1, t1 - t0)
  const maxMag = Math.max(2, ...events.map((e) => e.mag))
  const x = (t) => padL + ((t - t0) / span) * (W - padL - padR)
  const y = (m) => padT + (1 - m / maxMag) * (H - padT - padB)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Magnitude over time">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      {[0, maxMag / 2, maxMag].map((m, i) => (
        <text key={i} x={padL - 4} y={y(m) + 3} textAnchor="end" className={styles.chartAxis}>{m.toFixed(0)}</text>
      ))}
      {events.map((e) => (
        <circle key={e.id} cx={x(e.time)} cy={y(e.mag)} r={Math.max(1.6, 1 + e.mag * 0.8)}
          fill={magColor(e.mag)} fillOpacity={ageOpacity(e.time)} />
      ))}
    </svg>
  )
}

function DailyChart({ events }) {
  const days = aggregateDaily(events)
  const W = 280, H = 110, padL = 22, padB = 18, padT = 6, padR = 6
  const maxCount = Math.max(1, ...days.map((d) => d.count))
  const bw = days.length ? (W - padL - padR) / days.length : 0
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img" aria-label="Earthquakes per day">
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
      {[0, maxCount].map((c, i) => (
        <text key={i} x={padL - 4} y={i === 0 ? H - padB : padT + 8} textAnchor="end" className={styles.chartAxis}>{c}</text>
      ))}
      {days.map((d, i) => {
        const h = (d.count / maxCount) * (H - padT - padB)
        return (
          <rect key={d.key} x={padL + i * bw + 0.5} y={H - padB - h} width={Math.max(1, bw - 1)} height={h}
            fill={COUNT_BAR_COLOR} fillOpacity="0.85" rx="0.5" />
        )
      })}
      {days.length > 1 && (
        <>
          <text x={padL} y={H - 4} textAnchor="start" className={styles.chartAxis}>
            {days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
          <text x={W - padR} y={H - 4} textAnchor="end" className={styles.chartAxis}>
            {days[days.length - 1].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        </>
      )}
    </svg>
  )
}

// ─── Shareable URL state ────────────────────────────────────────────────────
// Every EarthAtlas map tool round-trips its full view into the query string so
// a copied link reproduces exactly what the user sees. This is a required
// convention — see docs/MAP_TOOL_CONVENTIONS.md. Params (each omitted at its
// default, to keep links clean):
//   mag                magnitude band (feed id; default 'all')
//   clat,clng,cname    selected location center + label (absent = worldwide)
//   r                  radius in miles (default 250; only meaningful with a location)
//   t                  time preset id (default 'month'); t=custom also writes ts,te
//   ts,te              custom window start/end (epoch ms)
//   bm                 basemap id (default 'satellite')
//   lat,lng,z          map camera (omitted at the default world view)
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    mag: sp.get('mag'),
    clat: num('clat'), clng: num('clng'), cname: sp.get('cname'),
    r: num('r'),
    t: sp.get('t'), ts: num('ts'), te: num('te'),
    bm: sp.get('bm'),
    lat: num('lat'), lng: num('lng'), z: num('z'),
  }
}

function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  // replaceState (not push) — no history entry per pan/zoom, just a live,
  // copy-pasteable URL.
  window.history.replaceState(window.history.state, '', url)
}

export default function QuakesApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)

  // Hydrate the full view from the URL once on mount so shared links recreate it.
  const initial = (typeof window !== 'undefined') ? readUrlState() : {}
  const initialCenter = (Number.isFinite(initial.clat) && Number.isFinite(initial.clng))
    ? { lat: initial.clat, lng: initial.clng, name: initial.cname || 'Shared location' }
    : null
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z }
    : null

  // Data
  const [feed, setFeed] = useState(() => (initial.mag && FEEDS.some((f) => f.id === initial.mag) ? initial.mag : 'all'))
  const [allEvents, setAllEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // View
  const [center, setCenter] = useState(initialCenter) // { lat, lng, name } | null (=global)
  const [radius, setRadius] = useState(() => (Number.isFinite(initial.r) && initial.r > 0 ? initial.r : DEFAULT_RADIUS))
  const [range, setRange] = useState(() => (
    initial.t === 'custom' && Number.isFinite(initial.ts) && Number.isFinite(initial.te) ? [initial.ts, initial.te] : null
  )) // [startMs, endMs] | null (=derived from preset)
  const [activePreset, setActivePreset] = useState(() => (
    initial.t && (initial.t === 'custom' || TIME_PRESETS.some((p) => p.id === initial.t)) ? initial.t : 'month'
  ))
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [showMethodology, setShowMethodology] = useState(false)
  // Live map camera (lat/lng/zoom), tracked on moveend for the shareable URL.
  const [mapView, setMapView] = useState(initialCamera)
  // Skip the first auto-flyTo when we hydrated a camera/location from the URL —
  // the map is already initialized at the shared view, so don't override it.
  const suppressFlyRef = useRef(!!(initialCamera || initialCenter))

  const isGlobal = !center

  // ─── Fetch a month of quakes whenever the magnitude band changes ──────────
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    fetchQuakes(feed, ac.signal)
      .then((events) => {
        if (ac.signal.aborted) return
        setAllEvents(events)
        setLoading(false)
      })
      .catch((err) => {
        if (ac.signal.aborted || err.name === 'AbortError') return
        setError('Could not load earthquake data from USGS. Please try again.')
        setLoading(false)
      })
    return () => ac.abort()
  }, [feed])

  // ─── Derive the view set (global or radius-filtered) ──────────────────────
  const viewEvents = useMemo(() => {
    if (isGlobal) return allEvents
    return filterByRadius(allEvents, center.lat, center.lng, radius)
  }, [allEvents, isGlobal, center, radius])

  // Reset the time window to the full data span whenever the view set changes,
  // unless a relative preset (e.g. "24 hours") is pinned.
  const dataSpan = useMemo(() => {
    if (!viewEvents.length) return null
    let min = Infinity, max = -Infinity
    for (const e of viewEvents) { if (e.time < min) min = e.time; if (e.time > max) max = e.time }
    return [min, max]
  }, [viewEvents])

  useEffect(() => {
    if (!dataSpan) return
    if (activePreset && activePreset !== 'custom') {
      const preset = TIME_PRESETS.find((p) => p.id === activePreset)
      if (preset) { setRange([preset.start(), Date.now()]); return }
    }
    setRange((r) => r || dataSpan)
  }, [dataSpan, activePreset])

  // ─── Apply the time window ────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    if (!range) return viewEvents
    const [a, b] = range
    return viewEvents.filter((e) => e.time >= a && e.time <= b)
  }, [viewEvents, range])

  const stats = useMemo(() => computeStats(filteredEvents), [filteredEvents])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    // Start at the shared camera if the URL had one, else frame the shared
    // location, else the default world view.
    const startCamera = initialCamera
      || (initialCenter ? { lng: initialCenter.lng, lat: initialCenter.lat, zoom: zoomForRadius(radius) } : null)
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: startCamera ? [startCamera.lng, startCamera.lat] : DEFAULT_VIEW.center,
      zoom: startCamera ? startCamera.zoom : DEFAULT_VIEW.zoom,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    // Track the camera so the shareable URL always reflects the current view.
    map.on('moveend', () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    })

    const addLayers = () => {
      if (!map.getSource('radius-circle')) {
        map.addSource('radius-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius-circle', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.08 } })
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius-circle', paint: { 'line-color': '#38bdf8', 'line-width': 1.5, 'line-opacity': 0.7 } })
      }
      if (!map.getSource('quakes')) {
        map.addSource('quakes', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: 'quakes-layer',
          type: 'circle',
          source: 'quakes',
          paint: {
            'circle-radius': [
              'interpolate', ['linear'], ['zoom'],
              1, ['interpolate', ['linear'], ['get', 'mag'], 1, 2.5, 9, 18],
              5, ['interpolate', ['linear'], ['get', 'mag'], 1, 4, 9, 30],
              10, ['interpolate', ['linear'], ['get', 'mag'], 1, 6, 9, 55],
            ],
            'circle-color': [
              'interpolate', ['linear'], ['get', 'mag'],
              -1, '#FFD700', 0, '#FF8C00', 1, '#FF6347', 2, '#FF4500', 3, '#FF0000',
              4, '#DC143C', 5, '#B22222', 6, '#8B0000', 7, '#800080', 8, '#4B0082',
            ],
            'circle-opacity': ['get', 'opacity'],
            'circle-stroke-width': 0.5,
            'circle-stroke-color': 'rgba(0,0,0,0.35)',
          },
        })

        map.on('mouseenter', 'quakes-layer', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'quakes-layer', () => { map.getCanvas().style.cursor = '' })
        map.on('click', 'quakes-layer', (e) => {
          const f = e.features?.[0]
          if (!f) return
          const p = f.properties
          const coords = f.geometry.coordinates.slice()
          popupRef.current?.remove()
          popupRef.current = new mapboxgl.Popup({ offset: 12, maxWidth: '260px' })
            .setLngLat(coords)
            .setHTML(
              `<div class="${styles.popup}">` +
              `<div class="${styles.popupMag}" style="color:${magColor(Number(p.mag))}">M${Number(p.mag).toFixed(1)}</div>` +
              `<div class="${styles.popupPlace}">${escapeHtml(p.place)}</div>` +
              `<div class="${styles.popupMeta}">${escapeHtml(fmtTime(Number(p.time)))}</div>` +
              `<div class="${styles.popupMeta}">Depth ${Number(p.depth).toFixed(1)} km` +
              (Number(p.tsunami) ? ' · <strong>tsunami flag</strong>' : '') + `</div>` +
              `<a class="${styles.popupLink}" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">USGS event page ↗</a>` +
              `</div>`,
            )
            .addTo(map)
        })
      }
    }

    // style.load fires on the initial style AND after every basemap switch, so
    // re-add our sources/layers and (re)assert readiness each time. More robust
    // than 'load' (which can be missed under StrictMode's mount/unmount with
    // heavier styles like satellite) — mirrors how /fire wires mapReady.
    map.on('style.load', () => { addLayers(); setMapReady(true) })

    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Push filtered events into the map source ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource('quakes')
    if (!src) return
    const now = Date.now()
    src.setData({
      type: 'FeatureCollection',
      features: filteredEvents.map((e) => ({
        type: 'Feature',
        properties: { mag: e.mag, place: e.place, time: e.time, depth: e.depth, url: e.url, tsunami: e.tsunami, opacity: ageOpacity(e.time, now) },
        geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      })),
    })
  }, [filteredEvents, mapReady])

  // ─── Radius circle overlay ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource('radius-circle')
    if (!src) return
    src.setData({
      type: 'FeatureCollection',
      features: isGlobal ? [] : [radiusCircleGeoJSON(center.lat, center.lng, radius)],
    })
  }, [isGlobal, center, radius, mapReady])

  // ─── Camera follows the selected location ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // On a cold load hydrated from the URL the map already opened at the shared
    // view — don't fly away from it on the first run.
    if (suppressFlyRef.current) { suppressFlyRef.current = false; return }
    if (isGlobal) {
      map.flyTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom, duration: 1200, essential: true })
    } else {
      map.flyTo({ center: [center.lng, center.lat], zoom: zoomForRadius(radius), duration: 1400, essential: true })
    }
  }, [isGlobal, center, radius, mapReady])

  // ─── Persist the full view to the URL (shareable links) ───────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (feed && feed !== 'all') sp.set('mag', feed)
    if (center) {
      sp.set('clat', center.lat.toFixed(4))
      sp.set('clng', center.lng.toFixed(4))
      if (center.name) sp.set('cname', center.name)
      if (radius !== DEFAULT_RADIUS) sp.set('r', String(radius))
    }
    if (activePreset && activePreset !== 'month') {
      sp.set('t', activePreset)
      if (activePreset === 'custom' && range) {
        sp.set('ts', String(Math.round(range[0])))
        sp.set('te', String(Math.round(range[1])))
      }
    }
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3))
      sp.set('lng', mapView.lng.toFixed(3))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
  }, [feed, center, radius, activePreset, range, basemap, mapView])

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

  // ─── Per-route SEO (client side; the static quakes.html covers crawlers) ──
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Quakes — Live earthquake map · EarthAtlas'
    const setMeta = (sel, val) => {
      const el = document.head.querySelector(sel)
      if (!el) return null
      const prev = el.getAttribute('content')
      el.setAttribute('content', val)
      return prev
    }
    const desc = 'Explore worldwide earthquakes from the past 30 days — search any location, set a radius, filter by time, and inspect magnitude and depth. Live USGS data. An EarthAtlas tool.'
    const prevDesc = setMeta('meta[name="description"]', desc)
    const prevOgT = setMeta('meta[property="og:title"]', document.title)
    const prevOgD = setMeta('meta[property="og:description"]', desc)
    const prevOgU = setMeta('meta[property="og:url"]', 'https://earthatlas.org/quakes')
    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', prevDesc)
      if (prevOgT != null) setMeta('meta[property="og:title"]', prevOgT)
      if (prevOgD != null) setMeta('meta[property="og:description"]', prevOgD)
      if (prevOgU != null) setMeta('meta[property="og:url"]', prevOgU)
    }
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleSelect = useCallback((r) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
    setCenter({ lat: r.lat, lng: r.lng, name: r.name || r.place_formatted || 'Selected location' })
    setRadius(DEFAULT_RADIUS)
  }, [])

  const handleClearLocation = useCallback(() => { setCenter(null) }, [])

  const applyPreset = useCallback((id) => {
    setActivePreset(id)
    const preset = TIME_PRESETS.find((p) => p.id === id)
    if (preset) setRange([preset.start(), Date.now()])
  }, [])

  const handleRangeInput = useCallback((which, value) => {
    setActivePreset('custom')
    setRange((r) => {
      const base = r || dataSpan || [Date.now() - 30 * DAY, Date.now()]
      const next = [...base]
      next[which] = value
      if (next[0] > next[1]) next[which === 0 ? 1 : 0] = value
      return next
    })
  }, [dataSpan])

  // ─── No token guard ───────────────────────────────────────────────────────
  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenError}>
          <strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.
        </div>
      </div>
    )
  }

  const sliderMin = dataSpan ? dataSpan[0] : Date.now() - 30 * DAY
  const sliderMax = dataSpan ? dataSpan[1] : Date.now()

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      {/* Branding */}
      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>Quakes</span>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search a place to see nearby quakes…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handleSelect}
        />
      </div>

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

      {/* Control panel */}
      <div className={`${styles.panel} ${panelOpen ? '' : styles.panelCollapsed}`}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>Earthquakes</span>
          <button className={styles.panelCollapse} onClick={() => setPanelOpen((o) => !o)} aria-label={panelOpen ? 'Collapse' : 'Expand'}>
            {panelOpen ? '▾' : '▸'}
          </button>
        </div>

        {panelOpen && (
          <div className={styles.panelBody}>
            {/* Status line */}
            <div className={styles.status}>
              {loading ? 'Loading USGS data…'
                : error ? <span className={styles.statusError}>{error}</span>
                : isGlobal
                  ? `${stats.count.toLocaleString()} quakes worldwide`
                  : `${stats.count.toLocaleString()} within ${radius} mi of ${center.name}`}
            </div>

            {/* Location chip / clear */}
            {!isGlobal && (
              <button className={styles.clearLoc} onClick={handleClearLocation}>
                ✕ Clear location · back to worldwide
              </button>
            )}

            {/* Magnitude band */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Magnitude</label>
              <div className={styles.chipRow}>
                {FEEDS.map((f) => (
                  <button key={f.id} className={feed === f.id ? styles.chipActive : styles.chip} onClick={() => setFeed(f.id)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Radius (location mode only) */}
            {!isGlobal && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Radius</label>
                <div className={styles.chipRow}>
                  {RADIUS_OPTIONS.map((r) => (
                    <button key={r} className={radius === r ? styles.chipActive : styles.chip} onClick={() => setRadius(r)}>
                      {r} mi
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Time range */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Time range</label>
              <div className={styles.chipRow}>
                {TIME_PRESETS.map((p) => (
                  <button key={p.id} className={activePreset === p.id ? styles.chipActive : styles.chip} onClick={() => applyPreset(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
              {dataSpan && range && (
                <div className={styles.rangeWrap}>
                  <div className={styles.rangeTrack}>
                    <input type="range" className={styles.rangeInput} min={sliderMin} max={sliderMax} value={Math.min(Math.max(range[0], sliderMin), sliderMax)} onChange={(e) => handleRangeInput(0, Number(e.target.value))} aria-label="Range start" />
                    <input type="range" className={styles.rangeInput} min={sliderMin} max={sliderMax} value={Math.min(Math.max(range[1], sliderMin), sliderMax)} onChange={(e) => handleRangeInput(1, Number(e.target.value))} aria-label="Range end" />
                  </div>
                  <div className={styles.rangeLabels}>
                    <span>{fmtTime(range[0])}</span><span>{fmtTime(range[1])}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Stats */}
            <div className={styles.statGrid}>
              <div className={styles.statBox}><span className={styles.statVal}>{stats.count.toLocaleString()}</span><span className={styles.statKey}>events</span></div>
              <div className={styles.statBox}><span className={styles.statVal} style={{ color: magColor(stats.maxMag) }}>{stats.maxMag.toFixed(1)}</span><span className={styles.statKey}>max mag</span></div>
              <div className={styles.statBox}><span className={styles.statVal}>{stats.avgMag.toFixed(2)}</span><span className={styles.statKey}>avg mag</span></div>
            </div>

            {/* Charts */}
            {filteredEvents.length > 0 && (
              <>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Magnitude over time</label>
                  <ScatterChart events={sampleEvenly(filteredEvents, 2000)} range={range || dataSpan} />
                </div>

                {/* Magnitude scale — sits under the scatter because it explains
                    those dot colors (and the map circles). */}
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Magnitude scale</label>
                  <div className={styles.legendBar} style={{ background: `linear-gradient(to right, ${MAG_RAMP.map(([, c]) => c).join(',')})` }} />
                  <div className={styles.legendScale}><span>0</span><span>4</span><span>8+</span></div>
                  <div className={styles.legendNote}>Brighter dots are more recent (last 6 h fully opaque).</div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Quakes per day</label>
                  <DailyChart events={filteredEvents} />
                </div>
              </>
            )}

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
      </div>

      <div className={styles.tip}>Click a quake for details · search a place or stay worldwide</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

// ─── "How this is sourced" modal ────────────────────────────────────────────
function MethodologyModal({ onClose }) {
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
          <h3>What you're looking at</h3>
          <p>
            Every circle is a single earthquake recorded by the{' '}
            <strong>USGS Earthquake Hazards Program</strong> over the past ~30 days. Circle{' '}
            <strong>color</strong> encodes magnitude (yellow = small → red → purple for great quakes),{' '}
            <strong>size</strong> grows with magnitude, and <strong>brightness</strong> with recency —
            quakes in the last 6 hours render fully opaque, older ones fade back.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Where the data comes from</h3>
          <ul>
            <li>
              <strong>Earthquakes — USGS GeoJSON feeds.</strong> The public{' '}
              <a href="https://earthquake.usgs.gov/earthquakes/feed/v1.0/" target="_blank" rel="noopener noreferrer">USGS real-time feeds</a>{' '}
              (e.g. <code>all_month</code>, <code>M2.5+</code>, <code>M4.5+</code>), pulled straight from the
              browser and refreshed each load. No account or API key — and no third-party database.
            </li>
            <li>
              <strong>Location &amp; radius.</strong> Picking a place filters to quakes within the chosen
              radius, computed in your browser with the haversine great-circle distance. Place search uses
              Mapbox geocoding.
            </li>
            <li>
              <strong>Basemap.</strong> Mapbox satellite, dark, light, and streets styles.
            </li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>Caveats</h3>
          <p>
            Magnitudes and depths are <strong>preliminary</strong> for recent events and may be revised by
            USGS as more data arrives. Detection completeness varies by region — areas with denser seismic
            networks report more small quakes. Times are shown in your local timezone. For authoritative
            details on any event, click it and follow the link to its USGS event page.
          </p>
        </section>
      </div>
    </div>
  )
}
