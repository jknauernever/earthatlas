import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import styles from './ForestMonitor.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

// Cloud function endpoint. Configurable via VITE_FOREST_TILES_API_BASE in
// .env.local / Vercel, with a hardcoded default to the global earthatlas
// function so production never falls back to a dead URL. .trim() defends
// against trailing newlines in env vars (vercel env pull has historically
// inserted "\n" inside the value).
const TILES_API_BASE = (
  import.meta.env.VITE_FOREST_TILES_API_BASE
  || 'https://us-west1-earthatlas.cloudfunctions.net/opera-dist-alert-global'
).trim()

// fetch + parse JSON with a hard client-side timeout. The cloud function has
// a 60 s server timeout, and the `extras` path can occasionally still chew
// through it; without an AbortController the popup spinner would hang the full
// minute on a slow/stuck request. Aborting early lets the caller's .catch fall
// back to a degraded popup instead. Throws on timeout, network error, or !ok.
const fetchJSON = async (url, timeoutMs) => {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctrl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

const MODES = [
  { id: 'recency',  label: 'Recency',  blurb: 'Redder = more recent disturbance.' },
  { id: 'status',   label: 'Status',   blurb: 'Provisional vs. confirmed; first vs. ongoing.' },
  { id: 'severity', label: 'Severity', blurb: 'Percent vegetation loss in the disturbed pixel.' },
]

// Forest Data Partnership commodity overlay layers. `key` is the cloud-function
// `?commodity=` param; `color` is the bold end of that crop's gradient palette
// (mirrors COMMODITY_TILE_PALETTES in main.py) and doubles as the legend swatch.
const COMMODITY_LAYERS = [
  { key: 'palm',   label: 'Oil palm', color: '#fb923c' },
  { key: 'rubber', label: 'Rubber',   color: '#2dd4bf' },
  { key: 'cocoa',  label: 'Cocoa',    color: '#a855f7' },
  { key: 'coffee', label: 'Coffee',   color: '#a16207' },
]

// Additional single-raster overlays (?layer=<id>), each its own panel row with
// on/off + opacity. `legend.gradient` renders a color ramp; `legend.swatches`
// renders a categorical key. Palettes mirror RADD_VIS / HANSEN_VIS / TMF_VIS in
// main.py. `defaultOpacity` is the row's starting opacity.
const EXTRA_LAYERS = [
  {
    id: 'radd', label: 'RADD radar alerts', defaultOpacity: 0.9,
    legend: {
      gradient: 'linear-gradient(to right, #3b0764, #a21caf, #e879f9, #fbcfe8)',
      left: 'older', right: 'recent',
      blurb: 'Sentinel-1 radar deforestation alerts — cloud-penetrating and near-real-time, so they catch clearings the optical disturbance layer misses under cloud. Humid tropics only. Source: WUR RADD, 10 m.',
    },
  },
  {
    id: 'hansen', label: 'Forest loss (Hansen)', defaultOpacity: 0.85,
    legend: {
      gradient: 'linear-gradient(to right, #fde68a, #fb923c, #dc2626, #7f1d1d)',
      left: '2001', right: '2025',
      blurb: 'Validated annual tree-cover loss, 30 m, global (2001–2025). The trusted long-term loss record. Source: Hansen / UMD-GLAD.',
    },
  },
  {
    id: 'tmf', label: 'Moist-forest change (TMF)', defaultOpacity: 0.75,
    legend: {
      swatches: [
        { c: '#0d4d0d', l: 'Undisturbed' }, { c: '#f59e0b', l: 'Degraded' },
        { c: '#b91c1c', l: 'Deforested' }, { c: '#86efac', l: 'Regrowth' },
      ],
      blurb: 'JRC Tropical Moist Forest — distinguishes degradation vs. deforestation vs. regrowth (latest year). Pan-tropical, 30 m.',
    },
  },
]

// Legend gradients mirror the cloud function's palettes (RECENCY_VIS,
// STATUS_VIS, SEVERITY_VIS in main.py).
const RECENCY_GRADIENT = 'linear-gradient(to right, #fde68a, #fbbf24, #fb923c, #ef4444, #dc2626, #b91c1c, #7f1d1d)'
const SEVERITY_GRADIENT = 'linear-gradient(to right, #fef3c7, #fde68a, #fbbf24, #fb923c, #ef4444, #b91c1c)'

const STATUS_SWATCHES = [
  { color: '#fde68a', label: 'Provisional (first)' },
  { color: '#fcd34d', label: 'Provisional (recurrent)' },
  { color: '#f59e0b', label: 'Confirmed' },
  { color: '#fb923c', label: 'Provisional · high loss (first)' },
  { color: '#ef4444', label: 'Provisional · high loss (recurrent)' },
  { color: '#b91c1c', label: 'Confirmed · high loss' },
  { color: '#92400e', label: 'Finished provisional' },
  { color: '#450a0a', label: 'Finished confirmed' },
]

// OPERA DIST-ALERT publishes from late 2022 onward; we treat 2023-01-01 as the
// usable floor (matches DATE_MIN=730 in the cloud function).
const DAY_MS = 86_400_000
const DATA_START_MS = Date.UTC(2023, 0, 1)
const todayUtcMs = () => {
  const d = new Date()
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const fmtMonthDay = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

// Curated basemap options. Picked specifically for alert-color readability:
// the dark/light/gray options eliminate the satellite-vs-recency color
// conflict that hits in arid regions (Sahara, Outback, the desert SW).
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite',  style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark',      label: 'Dark',       style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light',     label: 'Light',      style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'outdoors',  label: 'Terrain',    style: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'streets',   label: 'Streets',    style: 'mapbox://styles/mapbox/streets-v12' },
]
const DEFAULT_BASEMAP_ID = 'satellite'
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// Slider quick-pick presets. `days: null` means "all available data".
const RANGE_PRESETS = [
  { label: '24h',   days: 1 },
  { label: 'Week',  days: 7 },
  { label: 'Month', days: 30 },
  { label: 'Year',  days: 365 },
  { label: 'All',   days: null },
]

// Land-use filter chips. `id: 'all'` is the unfiltered default; the cloud
// function maps the rest to WorldCover class groups (see LANDUSE_FILTERS in
// main.py). Newer-data tiered version is a planned follow-up.
const LANDUSE_PRESETS = [
  { id: 'all',       label: 'All' },
  { id: 'forest',    label: 'Forest' },
  { id: 'cropland',  label: 'Cropland' },
  { id: 'grassland', label: 'Grassland' },
  { id: 'built',     label: 'Built' },
]

// ─── URL state encoding ────────────────────────────────────────────────────
// Every view of the map is fully described by its URL query string, so
// any view can be copy/pasted to share. Parameters use short keys to keep
// URLs compact; defaults are omitted so a clean homepage URL stays clean.
//
//   m=recency|status|severity       (default: recency)
//   start=YYYY-MM-DD                (default: 2023-01-01)
//   end=YYYY-MM-DD                  (default: today)
//   lu=forest|cropland|grassland|built  (default: 'all', omitted)
//   bm=satellite|dark|light|outdoors|streets  (default: satellite)
//   op=0-100                        (default: 85, layer opacity %)
//   lat=NN.NNN  lng=NN.NNN  z=Z.Z   (map view; default: world view)

function _readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    mode:    sp.get('m'),
    start:   sp.get('start'),
    end:     sp.get('end'),
    landuse: sp.get('lu'),
    basemap: sp.get('bm'),
    opacity: num('op'),
    lat:     num('lat'),
    lng:     num('lng'),
    zoom:    num('z'),
  }
}

// Serialize the current view state to a query string. Defaults are omitted
// to keep the canonical "no params" URL clean.
function _viewStateToQuery({ mode, start, end, landuse, basemap, opacity, lat, lng, zoom }) {
  const sp = new URLSearchParams()
  if (mode && mode !== 'recency') sp.set('m', mode)
  if (start) sp.set('start', start)
  if (end) sp.set('end', end)
  if (landuse && landuse !== 'all') sp.set('lu', landuse)
  if (basemap && basemap !== DEFAULT_BASEMAP_ID) sp.set('bm', basemap)
  if (opacity != null && Math.abs(opacity - 0.85) > 0.005) {
    sp.set('op', String(Math.round(opacity * 100)))
  }
  if (lat != null && lng != null && zoom != null) {
    sp.set('lat', lat.toFixed(3))
    sp.set('lng', lng.toFixed(3))
    sp.set('z', zoom.toFixed(1))
  }
  return sp.toString()
}

// Apply the query string back to the address bar without adding a history
// entry. Pass an empty string to clear all params.
function _writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

// Hydrate the date range from URL params, falling back to "all available
// data" when either bound is missing or unparseable.
function _initialDateRange() {
  const { start, end } = _readUrlState()
  let s = DATA_START_MS
  let e = todayUtcMs()
  if (start) {
    const ms = Date.parse(start + 'T00:00:00Z')
    if (Number.isFinite(ms)) s = Math.max(ms, DATA_START_MS)
  }
  if (end) {
    const ms = Date.parse(end + 'T00:00:00Z')
    if (Number.isFinite(ms)) e = ms
  }
  if (e <= s) e = todayUtcMs()
  return [s, e]
}

const VALID_MODES = ['recency', 'status', 'severity']
const VALID_LANDUSE = ['all', 'forest', 'cropland', 'grassland', 'built']

export default function ForestMonitor() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const lastTileUrlReqRef = useRef(0)

  // Hydrate state from URL on first mount so shared links recreate the view.
  // Each useState initializer reads the URL once. Defaults are applied when
  // the param is missing or invalid; out-of-range values are clamped.
  const _initial = (typeof window !== 'undefined') ? _readUrlState() : {}

  const [mode, setMode] = useState(
    VALID_MODES.includes(_initial.mode) ? _initial.mode : 'recency'
  )
  const [tileLoading, setTileLoading] = useState(true)
  const [tileError, setTileError] = useState(null)
  // Flips true on `map.on('load')`. Gates tile-source adds so we don't race
  // the style finishing — addLayer() before the style is ready silently no-ops.
  const [mapReady, setMapReady] = useState(false)
  // [startMs, endMs] in UTC epoch ms. Default = full available window.
  const [dateRange, setDateRange] = useState(_initialDateRange)
  // WorldCover-derived land use filter. 'all' = no filter applied.
  const [landuse, setLanduse] = useState(
    VALID_LANDUSE.includes(_initial.landuse) ? _initial.landuse : 'all'
  )
  // Methodology modal — opened from a button rendered inside popups, so we
  // catch clicks via document-level delegation (popups are setHTML strings,
  // can't directly attach React handlers).
  const [showMethodology, setShowMethodology] = useState(false)
  // Selected basemap id (see BASEMAPS above). Default = satellite.
  const [basemap, setBasemap] = useState(
    BASEMAPS.some((b) => b.id === _initial.basemap) ? _initial.basemap : DEFAULT_BASEMAP_ID
  )
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  // Opacity of the OPERA disturbance raster overlay (0–1). Default 0.85.
  const [opacity, setOpacity] = useState(
    _initial.opacity != null
      ? Math.max(0, Math.min(1, _initial.opacity / 100))
      : 0.85
  )
  // Map view (lat/lng/zoom). Tracked in state so we can write it back to the
  // URL on moveend; the map itself remains the source of truth.
  const [mapView, setMapView] = useState(() => {
    const { lat, lng, zoom } = _initial
    if (lat != null && lng != null && zoom != null) {
      return { lat, lng, zoom }
    }
    return null
  })
  // Ref-mirror so applyTileLayer reads the latest value without re-running
  // the tile-fetch effect on opacity changes.
  const opacityRef = useRef(0.85)
  useEffect(() => { opacityRef.current = opacity }, [opacity])
  // Most-recent OPERA tile URL — cached so we can immediately re-apply it
  // after a basemap switch without round-tripping the cloud function again.
  const lastTileUrlRef = useRef(null)

  // ─── Layer panel state ───────────────────────────────────────────────────
  // The OPERA disturbance overlay is now layer #1 of a growing stack; each
  // layer has its own on/off + opacity. Commodity crops are layer #2 (a group
  // of four per-crop rasters under one parent toggle/opacity).
  const [operaVisible, setOperaVisible] = useState(true)
  const [operaExpanded, setOperaExpanded] = useState(true)
  const operaVisibleRef = useRef(true)
  useEffect(() => { operaVisibleRef.current = operaVisible }, [operaVisible])

  const [commodityVisible, setCommodityVisible] = useState(false)
  const [commodityExpanded, setCommodityExpanded] = useState(false)
  const [commodityOpacity, setCommodityOpacity] = useState(0.8)
  const commodityOpacityRef = useRef(0.8)
  useEffect(() => { commodityOpacityRef.current = commodityOpacity }, [commodityOpacity])
  // Per-crop on/off within the commodity group. All on by default.
  const [commodityCrops, setCommodityCrops] = useState(
    () => Object.fromEntries(COMMODITY_LAYERS.map((c) => [c.key, true]))
  )
  // Cache of fetched commodity tile URLs (one per crop) — these don't depend on
  // date/mode, so we fetch each once and reuse across toggles + basemap swaps.
  const commodityUrlRef = useRef({})
  // Ref-mirrors so the (stable) reconcile fn and style.load handler read the
  // latest visibility without being torn down/recreated.
  const commodityVisibleRef = useRef(false)
  const commodityCropsRef = useRef(commodityCrops)

  // Extra single-raster overlays (RADD / Hansen / TMF) — keyed by layer id.
  const [extraVisible, setExtraVisible] = useState(
    () => Object.fromEntries(EXTRA_LAYERS.map((l) => [l.id, false]))
  )
  const [extraExpanded, setExtraExpanded] = useState(
    () => Object.fromEntries(EXTRA_LAYERS.map((l) => [l.id, false]))
  )
  const [extraOpacity, setExtraOpacity] = useState(
    () => Object.fromEntries(EXTRA_LAYERS.map((l) => [l.id, l.defaultOpacity]))
  )
  const extraVisibleRef = useRef(extraVisible)
  const extraOpacityRef = useRef(extraOpacity)
  const extraUrlRef = useRef({})   // cached tile URLs per layer id

  // ─── Init map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    // Initial view from URL if present, otherwise the default world view.
    const initView = mapView
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: initView ? [initView.lng, initView.lat] : [0, 20],
      zoom: initView ? initView.zoom : 1.6,
      projection: 'mercator',
      attributionControl: false,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right')

    // Mapbox occasionally instantiates before the container has its final
    // bounding rect (depending on fonts/CSS load order), which leaves it stuck
    // with zero internal viewport — no tile requests ever fire. A ResizeObserver
    // on the container forces a recompute as soon as a real size lands.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)

    const markReady = () => setMapReady(true)
    if (map.isStyleLoaded()) markReady()
    else map.on('style.load', markReady)

    // Crosshair signals "pick a point to inspect" — clearer than Mapbox's
    // default grab hand. Mapbox momentarily flips to a closed-fist grabbing
    // cursor on active drag (via inline style), so panning still has feedback.
    const setCrosshair = () => { map.getCanvas().style.cursor = 'crosshair' }
    if (map.getCanvas()) setCrosshair()
    map.on('load', setCrosshair)
    map.on('mouseup', setCrosshair)

    // Mapbox 3.x sometimes leaves its render loop idle after init: the style
    // loads, but no tile request ever fires until the camera moves. A tiny
    // round-trip pan after mount is enough to start the loop in most browsers.
    const kick = () => {
      try {
        map.panBy([1, 0], { duration: 0 })
        map.panBy([-1, 0], { duration: 0 })
      } catch {}
    }
    const kickRAF = requestAnimationFrame(kick)
    const kickT1 = setTimeout(kick, 100)
    const kickT2 = setTimeout(kick, 500)
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: false },
        trackUserLocation: false,
        showUserLocation: false,
      }),
      'top-right'
    )

    // Persist the map view (lat/lng/zoom) to React state on moveend so the
    // URL-sync effect picks it up. `moveend` fires once after each pan/zoom
    // settles, so this naturally debounces against the per-frame view changes.
    const onMoveEnd = () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    }
    map.on('moveend', onMoveEnd)

    mapRef.current = map
    return () => {
      cancelAnimationFrame(kickRAF)
      clearTimeout(kickT1)
      clearTimeout(kickT2)
      ro.disconnect()
      map.off('moveend', onMoveEnd)
      if (popupRef.current) popupRef.current.remove()
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [])

  // ─── Per-route document title & meta tags ────────────────────────────────
  // The pre-built /forestmonitor.html (served via Vercel rewrite) sets these
  // on initial page load for SEO crawlers. This effect covers users who land
  // on / first and then React-Router-navigate to /forestmonitor.
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Forest Monitor — Near-real-time global forest disturbance · EarthAtlas'

    const setMeta = (selector, attr, value) => {
      let el = document.head.querySelector(selector)
      if (!el) {
        el = document.createElement('meta')
        const [k, v] = selector.replace(/[\[\]"]/g, '').split('=')
        el.setAttribute(k, v)
        document.head.appendChild(el)
      }
      const prev = el.getAttribute(attr)
      el.setAttribute(attr, value)
      return prev
    }
    const desc = 'Track forest loss anywhere on Earth, updated every 12 hours. 30-meter NASA OPERA DIST-ALERT data with crop-aware cause inference, named-fire context, and per-pixel diagnostics.'
    const prevDesc = setMeta('meta[name="description"]', 'content', desc)
    const prevOgTitle = setMeta('meta[property="og:title"]', 'content', document.title)
    const prevOgDesc = setMeta('meta[property="og:description"]', 'content', desc)
    const prevOgUrl = setMeta('meta[property="og:url"]', 'content', 'https://earthatlas.org/forestmonitor')

    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', 'content', prevDesc)
      if (prevOgTitle != null) setMeta('meta[property="og:title"]', 'content', prevOgTitle)
      if (prevOgDesc != null) setMeta('meta[property="og:description"]', 'content', prevOgDesc)
      if (prevOgUrl != null) setMeta('meta[property="og:url"]', 'content', prevOgUrl)
    }
  }, [])

  // ─── Persist view state to URL ────────────────────────────────────────────
  // Whenever any user-visible state changes, rewrite the address bar so the
  // current view is always shareable. Uses replaceState (no history entry per
  // pan/click) and skips defaults (so the bare URL stays clean for a fresh
  // visit). The dependency array covers everything _viewStateToQuery reads.
  useEffect(() => {
    const qs = _viewStateToQuery({
      mode,
      start: isoDay(dateRange[0]),
      end:   isoDay(dateRange[1]),
      landuse,
      basemap,
      opacity,
      lat:  mapView ? mapView.lat  : null,
      lng:  mapView ? mapView.lng  : null,
      zoom: mapView ? mapView.zoom : null,
    })
    _writeUrlQuery(qs)
  }, [mode, dateRange, landuse, basemap, opacity, mapView])

  // ─── Fetch tile URL whenever mode or date range changes ──────────────────
  // Debounced 250 ms so dragging the slider doesn't hammer the cloud function.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    let cancelled = false
    const reqId = ++lastTileUrlReqRef.current
    setTileLoading(true)
    setTileError(null)

    const [startMs, endMs] = dateRange
    const params = new URLSearchParams({
      mode,
      start: isoDay(startMs),
      end: isoDay(endMs),
    })
    if (landuse && landuse !== 'all') params.set('landuse', landuse)

    const t = setTimeout(() => {
      fetch(`${TILES_API_BASE}?${params}`)
        .then(async (r) => {
          // 503 = cloud function reporting upstream data unavailable.
          // Pull the structured title + body so the badge shows the
          // user-facing copy (no acronyms) instead of "HTTP 503".
          if (r.status === 503) {
            const body = await r.json().catch(() => ({}))
            const e = new Error(body.message || 'Data temporarily unavailable')
            e._badge = {
              title: body.title || 'Disturbance overlay offline',
              body: body.message || 'Data is temporarily unavailable. Try again later.',
            }
            throw e
          }
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (cancelled || reqId !== lastTileUrlReqRef.current) return
          if (!data.tileUrl) throw new Error('Empty tileUrl in response')
          applyTileLayer(map, data.tileUrl, opacityRef.current)
          if (!operaVisibleRef.current && map.getLayer(RASTER_LAYER_ID)) {
            map.setLayoutProperty(RASTER_LAYER_ID, 'visibility', 'none')
          }
          lastTileUrlRef.current = data.tileUrl
          setTileLoading(false)
        })
        .catch((err) => {
          if (cancelled) return
          if (err._badge) {
            // Soft warn — transient upstream condition, not a bug here.
            console.warn('[ForestMonitor]', err.message)
            setTileError(err._badge)
          } else {
            console.error('[ForestMonitor] tile URL fetch failed', err)
            setTileError({
              title: "Couldn't load disturbance tiles",
              body: err.message || 'Please try again in a moment.',
            })
          }
          setTileLoading(false)
        })
    }, 250)

    return () => { cancelled = true; clearTimeout(t) }
  }, [mode, mapReady, dateRange, landuse])

  // ─── Click → fetch point sample, draw popup + patch outline ───────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handler = (e) => {
      const { lng, lat } = e.lngLat

      if (popupRef.current) popupRef.current.remove()
      removePatchOutline(map)

      const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '380px', offset: 12 })
        .setLngLat([lng, lat])
        .setHTML(`<div class="${styles.popupLoading}">Looking up disturbance…</div>`)
        .addTo(map)
      popupRef.current = popup
      popup.on('close', () => removePatchOutline(map))

      // Progressive rendering: fire every lookup in parallel and repaint the
      // popup whenever any resolves, so each section streams in as soon as it's
      // ready (fastest-first). Cloud-function streams:
      //   point   — date/status/severity/landCover     ~1 s
      //   context — commodity + RADD/Hansen/TMF         ~0.5-1 s
      //   aef     — AlphaEarth 5-signal block           ~3-6 s
      //   extras  — patch geometry + cause + fires      ~5-15 s (slow tail)
      const state = {
        point:   { status: 'pending', data: null, error: null },
        extras:  { status: 'pending', data: null },
        context: { status: 'pending', data: null },
        aef:     { status: 'pending', data: null },
        admin:   { status: 'pending', value: null },
        protectedAreas:  { status: 'pending', value: [] },
        naturalFeatures: { status: 'pending', value: [] },
        // Two-step "analyze this spot" tool, used when no datasets are selected:
        // anyLayerOn fixes the mode at click time; deep flips to the full
        // analysis when the user clicks "Deeper analysis"; deepFired guards the
        // one-time launch of the slow streams.
        anyLayerOn: false, deep: false, deepFired: false,
        // Click-gated plain-language AI summary (idle → loading → done | error).
        ai: { status: 'idle', text: null },
      }
      const myPopup = popup
      const stillCurrent = () => popupRef.current === myPopup

      // Dedup protected-area + natural-feature names into one ordered list,
      // capped at 3. Shared by render() and the AI-summary fact assembler.
      const getPois = () => {
        const pois = []
        const seen = new Set()
        for (const name of [...state.protectedAreas.value, ...state.naturalFeatures.value]) {
          const k = name.toLowerCase()
          if (!seen.has(k)) { seen.add(k); pois.push(name) }
          if (pois.length >= 3) break
        }
        return pois
      }

      const render = () => {
        if (!stillCurrent()) return

        const pois = getPois()

        if (state.point.status === 'rejected') {
          myPopup.setHTML(`<div class="${styles.popupError}">Couldn't load disturbance info for that spot.</div>`)
          return
        }

        if (state.point.status === 'pending') {
          myPopup.setHTML(renderLoadingPopupHTML(pois, state.admin.value))
          return
        }

        const data = state.point.data
        // Independent streams behind the popup.
        const extras  = state.extras.status === 'fulfilled' ? state.extras.data : null
        const context = state.context.status === 'fulfilled' ? state.context.data : null
        const aefData = state.aef.status === 'fulfilled' ? (state.aef.data?.aef || null) : null
        const extrasPending  = state.extras.status === 'pending'
        const contextPending = state.context.status === 'pending'
        const aefPending     = state.aef.status === 'pending'

        // ── No datasets selected → two-step "analyze this spot" tool ────────
        if (!state.anyLayerOn) {
          if (!state.deep) {
            // Step 1: fast cross-dataset overview (core + context) + a button
            // that launches the deep analysis.
            myPopup.setHTML(renderOverviewPopupHTML(
              pois, state.admin.value, data, context, contextPending))
            return
          }
          // Step 2: full analysis, every dataset shown (ungated).
          const commodity = context?.commodityCrop || null
          const forest = { radd: context?.radd || null, hansen: context?.hansen || null, tmf: context?.tmf || null }
          const items = (extra) => {
            const a = [...extra]
            if (aefPending) a.push('AlphaEarth + greenness')
            if (contextPending) a.push('commodity & forest context')
            return a.join(' · ')
          }
          if (!data.date) {
            const nf = extras ? (extras.namedFires || []) : []
            myPopup.setHTML(renderEmptyPopupHTML(
              pois, state.admin.value, data.landCover, nf, aefData, commodity, forest,
              items(extrasPending ? ['fire history'] : []), state.ai))
            return
          }
          const mergedAll = {
            ...data, ...(extras || {}), aef: aefData,
            commodityCrop: commodity, radd: forest.radd, hansen: forest.hansen, tmf: forest.tmf,
          }
          if (extras && extras.patchGeometry) addPatchOutline(map, extras.patchGeometry)
          myPopup.setHTML(renderPopupHTML(
            mergedAll, pois, state.admin.value,
            items(extrasPending ? ['patch size', 'likely cause', 'fire history'] : []), state.ai))
          return
        }

        // ── Datasets selected → mirror the visible layers (read live via refs).
        const showOpera = operaVisibleRef.current
        const showCommodity = commodityVisibleRef.current
        const commodity = showCommodity ? (context?.commodityCrop || null) : null
        const ev = extraVisibleRef.current
        const forest = {
          radd: ev.radd ? (context?.radd || null) : null,
          hansen: ev.hansen ? (context?.hansen || null) : null,
          tmf: ev.tmf ? (context?.tmf || null) : null,
        }
        // Build the "still gathering" list from only the streams that (a) are
        // still pending and (b) will actually produce visible content here.
        const layerContextOn = showCommodity || ev.radd || ev.hansen || ev.tmf
        const pendingItems = (extra) => {
          const items = [...extra]
          if (aefPending) items.push('AlphaEarth context')
          if (contextPending && layerContextOn) items.push('commodity & forest-change context')
          return items.join(' · ')
        }

        // Disturbance layer off → neutral location card (no disturbance framing).
        if (!showOpera) {
          myPopup.setHTML(renderLocationPopupHTML(
            pois, state.admin.value, data.landCover, commodity, forest,
            contextPending && layerContextOn ? 'commodity & forest-change context' : '', state.ai))
          return
        }

        if (!data.date) {
          const extrasNamedFires = extras ? (extras.namedFires || []) : []
          myPopup.setHTML(renderEmptyPopupHTML(
            pois, state.admin.value, data.landCover, extrasNamedFires, aefData, commodity, forest,
            pendingItems(extrasPending ? ['fire history'] : []), state.ai))
          return
        }

        const merged = {
          ...data, ...(extras || {}), aef: aefData,
          commodityCrop: commodity, radd: forest.radd, hansen: forest.hansen, tmf: forest.tmf,
        }
        if (extras && extras.patchGeometry) addPatchOutline(map, extras.patchGeometry)
        myPopup.setHTML(renderPopupHTML(
          merged, pois, state.admin.value,
          pendingItems(extrasPending ? ['patch size', 'likely cause', 'fire history'] : []), state.ai))
      }

      // Fix the popup mode at click time: are any datasets selected?
      state.anyLayerOn = operaVisibleRef.current || commodityVisibleRef.current
        || extraVisibleRef.current.radd || extraVisibleRef.current.hansen || extraVisibleRef.current.tmf

      // Slow streams: AlphaEarth + greenness, and patch geometry + cause + fires.
      // Launched immediately when the disturbance layer is on (its popup needs
      // them); otherwise deferred until the user clicks "Deeper analysis".
      // Timeouts are client-side backstops above the server's own budgets.
      const fireDeep = () => {
        if (state.deepFired) return
        state.deepFired = true
        fetchJSON(`${TILES_API_BASE}?lat=${lat}&lng=${lng}&aefonly=1`, 20000)
          .then((d) => { state.aef = { status: 'fulfilled', data: d }; render() })
          .catch((err) => { console.warn('[ForestMonitor] aef lookup failed', err); state.aef = { status: 'fulfilled', data: null }; render() })
        fetchJSON(`${TILES_API_BASE}?lat=${lat}&lng=${lng}&extras=1`, 20000)
          .then((d) => { state.extras = { status: 'fulfilled', data: d }; render() })
          .catch((err) => { console.warn('[ForestMonitor] extras lookup failed', err); state.extras = { status: 'fulfilled', data: null }; render() })
      }
      deepenRef.current = () => { if (!stillCurrent()) return; state.deep = true; fireDeep(); render() }

      // Click-gated AI summary. Assembles the plain-English facts we've already
      // computed for this point and POSTs them to /api/ai-analysis (Claude
      // Haiku), then renders the returned paragraph in place. Only runs on the
      // user's click, so it costs nothing unless asked for.
      aiSummaryRef.current = () => {
        if (!stillCurrent() || state.ai.status === 'loading') return
        const facts = assembleAiFacts({
          data: state.point.data,
          context: state.context.status === 'fulfilled' ? state.context.data : null,
          extras: state.extras.status === 'fulfilled' ? state.extras.data : null,
          aef: state.aef.status === 'fulfilled' ? (state.aef.data?.aef || null) : null,
          pois: getPois(),
          admin: state.admin.value,
        })
        state.ai = { status: 'loading', text: null }
        render()
        fetch('/api/ai-analysis', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(facts),
        })
          .then(async (res) => {
            const d = await res.json().catch(() => ({}))
            if (!stillCurrent()) return
            if (res.ok && d.text) {
              state.ai = { status: 'done', text: d.text }
            } else if (res.status === 503 || d.error === 'not_configured') {
              state.ai = { status: 'error', text: 'Plain-language summaries aren’t switched on yet.' }
            } else {
              state.ai = { status: 'error', text: 'Couldn’t write a summary just now. Try again.' }
            }
            render()
          })
          .catch(() => {
            if (!stillCurrent()) return
            state.ai = { status: 'error', text: 'Couldn’t reach the summary service. Try again.' }
            render()
          })
      }

      // Core (date / status / severity / land cover) — always, fast (~1 s).
      fetchJSON(`${TILES_API_BASE}?lat=${lat}&lng=${lng}`, 15000)
        .then((data) => {
          state.point = { status: 'fulfilled', data, error: null }
          render()
        })
        .catch((err) => {
          console.error('[ForestMonitor] point lookup failed', err)
          state.point = { status: 'rejected', data: null, error: err }
          render()
        })

      // Fast context (commodity + RADD/Hansen/TMF) — always, ~1 s. Powers both
      // the no-selection overview and the mirrored commodity/forest popups.
      fetchJSON(`${TILES_API_BASE}?lat=${lat}&lng=${lng}&context=1`, 15000)
        .then((data) => { state.context = { status: 'fulfilled', data }; render() })
        .catch((err) => {
          console.warn('[ForestMonitor] context lookup failed', err)
          state.context = { status: 'fulfilled', data: null }; render()
        })

      // Disturbance analysis needs the deep streams up front; commodity/forest-
      // only popups don't, and no-selection defers them to "Deeper analysis".
      if (operaVisibleRef.current) fireDeep()

      reverseGeocode(lat, lng)
        .then((v) => { state.admin = { status: 'fulfilled', value: v }; render() })
        .catch(() => { state.admin = { status: 'fulfilled', value: null }; render() })

      findProtectedAreas(lat, lng)
        .then((v) => { state.protectedAreas = { status: 'fulfilled', value: v || [] }; render() })
        .catch(() => { state.protectedAreas = { status: 'fulfilled', value: [] }; render() })

      findNaturalFeatures(lat, lng)
        .then((v) => { state.naturalFeatures = { status: 'fulfilled', value: v || [] }; render() })
        .catch(() => { state.naturalFeatures = { status: 'fulfilled', value: [] }; render() })
    }

    map.on('click', handler)
    return () => map.off('click', handler)
  }, [])

  // ─── Commodity overlay: reconcile which crop rasters are on the map ──────
  // Stable (reads refs) so the basemap-reload handler can call it too. For each
  // crop: show it (fetching + caching its tile URL on first use) when the group
  // is on AND that crop is checked; otherwise remove it. Inserted beneath the
  // OPERA layer so disturbance alerts stay on top. Declared above the basemap
  // effect because that effect lists it as a dependency (avoids a TDZ crash).
  const reconcileCommodity = useCallback((map) => {
    if (!map) return
    COMMODITY_LAYERS.forEach(async ({ key }) => {
      const sId = commoditySourceId(key)
      const lId = commodityLayerId(key)
      const want = () => commodityVisibleRef.current && !!commodityCropsRef.current[key]
      if (!want()) { removeRasterLayer(map, sId, lId); return }
      let url = commodityUrlRef.current[key]
      if (!url) {
        try {
          const r = await fetch(`${TILES_API_BASE}?commodity=${key}`)
          const d = await r.json()
          url = d.tileUrl
          if (url) commodityUrlRef.current[key] = url
        } catch (err) {
          console.error(`[ForestMonitor] commodity tile fetch failed (${key})`, err)
          return
        }
      }
      // Re-check: the user may have toggled the crop off during the fetch.
      if (url && want()) {
        applyRasterLayer(map, sId, lId, url, commodityOpacityRef.current, RASTER_LAYER_ID)
      } else {
        removeRasterLayer(map, sId, lId)
      }
    })
  }, [])

  // Reconcile the extra single-raster overlays (RADD / Hansen / TMF). Same
  // pattern as commodity: stable, reads refs, fetches+caches each tile URL on
  // first show, slots beneath the OPERA layer. Declared above the basemap
  // effect that depends on it.
  const reconcileExtra = useCallback((map) => {
    if (!map) return
    EXTRA_LAYERS.forEach(async ({ id }) => {
      const sId = `extra-${id}`
      const lId = `extra-${id}-layer`
      if (!extraVisibleRef.current[id]) { removeRasterLayer(map, sId, lId); return }
      let url = extraUrlRef.current[id]
      if (!url) {
        try {
          const r = await fetch(`${TILES_API_BASE}?layer=${id}`)
          const d = await r.json()
          url = d.tileUrl
          if (url) extraUrlRef.current[id] = url
        } catch (err) {
          console.error(`[ForestMonitor] ${id} tile fetch failed`, err)
          return
        }
      }
      if (url && extraVisibleRef.current[id]) {
        applyRasterLayer(map, sId, lId, url, extraOpacityRef.current[id] ?? 0.8, RASTER_LAYER_ID)
      } else {
        removeRasterLayer(map, sId, lId)
      }
    })
  }, [])

  // ─── Basemap change ──────────────────────────────────────────────────────
  // setStyle() blows away all custom sources/layers (OPERA raster + any
  // patch outline), so we listen for the new style's `style.load` and
  // re-apply the cached tile URL immediately. The first render is skipped —
  // the map was already initialized with the chosen style.
  const basemapMountRef = useRef(true)
  useEffect(() => {
    if (basemapMountRef.current) { basemapMountRef.current = false; return }
    const map = mapRef.current
    if (!map) return

    map.once('style.load', () => {
      // Re-apply the most recent OPERA tile URL — skips a GEE roundtrip,
      // makes basemap switching feel instant.
      if (lastTileUrlRef.current) {
        applyTileLayer(map, lastTileUrlRef.current, opacityRef.current)
        if (!operaVisibleRef.current && map.getLayer(RASTER_LAYER_ID)) {
          map.setLayoutProperty(RASTER_LAYER_ID, 'visibility', 'none')
        }
      }
      // Commodity + extra rasters were wiped by setStyle — re-add from cache.
      reconcileCommodity(map)
      reconcileExtra(map)
      // Patch outline is per-popup; it'll redraw on next click.
    })
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, reconcileCommodity, reconcileExtra])

  // ─── OPERA layer opacity (live update via setPaintProperty) ─────────────
  // Avoids re-adding the layer on every opacity change — much smoother than
  // tearing it down. Layer might not exist yet if tiles haven't loaded; the
  // try/catch covers that.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    try {
      if (map.getLayer(RASTER_LAYER_ID)) {
        map.setPaintProperty(RASTER_LAYER_ID, 'raster-opacity', opacity)
      }
    } catch {}
  }, [opacity, mapReady])

  // ─── OPERA layer on/off ──────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    try {
      if (map.getLayer(RASTER_LAYER_ID)) {
        map.setLayoutProperty(RASTER_LAYER_ID, 'visibility', operaVisible ? 'visible' : 'none')
      }
    } catch {}
  }, [operaVisible, mapReady])

  useEffect(() => {
    commodityVisibleRef.current = commodityVisible
    commodityCropsRef.current = commodityCrops
    const map = mapRef.current
    if (map && mapReady) reconcileCommodity(map)
  }, [commodityVisible, commodityCrops, mapReady, reconcileCommodity])

  // ─── Commodity group opacity (live update across all crop rasters) ───────
  useEffect(() => {
    commodityOpacityRef.current = commodityOpacity
    const map = mapRef.current
    if (!map) return
    COMMODITY_LAYERS.forEach(({ key }) => {
      const lId = commodityLayerId(key)
      try {
        if (map.getLayer(lId)) map.setPaintProperty(lId, 'raster-opacity', commodityOpacity)
      } catch {}
    })
  }, [commodityOpacity, mapReady])

  // ─── Extra overlays (RADD / Hansen / TMF): reconcile + opacity ───────────
  useEffect(() => {
    extraVisibleRef.current = extraVisible
    const map = mapRef.current
    if (map && mapReady) reconcileExtra(map)
  }, [extraVisible, mapReady, reconcileExtra])

  useEffect(() => {
    extraOpacityRef.current = extraOpacity
    const map = mapRef.current
    if (!map) return
    EXTRA_LAYERS.forEach(({ id }) => {
      const lId = `extra-${id}-layer`
      try {
        if (map.getLayer(lId)) map.setPaintProperty(lId, 'raster-opacity', extraOpacity[id])
      } catch {}
    })
  }, [extraOpacity, mapReady])

  // ─── Basemap menu: close on outside click / Esc ──────────────────────────
  useEffect(() => {
    if (!basemapMenuOpen) return
    const onClick = (e) => {
      if (!basemapMenuRef.current?.contains(e.target)) setBasemapMenuOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [basemapMenuOpen])

  // ─── Methodology modal click delegation ──────────────────────────────────
  // Popup HTML is plain strings, so we can't attach React onClick. Instead
  // intercept any click on an element with data-action="show-methodology".
  useEffect(() => {
    const docHandler = (e) => {
      if (e.target.closest('[data-action="show-methodology"]')) {
        e.preventDefault()
        setShowMethodology(true)
      }
    }
    document.addEventListener('click', docHandler)
    return () => document.removeEventListener('click', docHandler)
  }, [])

  // ─── AEF "similar disturbance" fly-to delegation ─────────────────────────
  // Buttons inside the AlphaEarth context block carry lat/lng for a similar
  // OPERA-disturbed pixel within 30 km. Clicking flies the map there so the
  // user can compare the popup-clicked spot against its lookalikes.
  useEffect(() => {
    const handler = (e) => {
      const btn = e.target.closest('[data-action="aef-fly"]')
      if (!btn) return
      e.preventDefault()
      const lat = parseFloat(btn.dataset.lat)
      const lng = parseFloat(btn.dataset.lng)
      const m = mapRef.current
      if (!m || !Number.isFinite(lat) || !Number.isFinite(lng)) return
      m.flyTo({ center: [lng, lat], zoom: Math.max(m.getZoom(), 13), essential: true })
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // ─── "Deeper analysis" delegation ────────────────────────────────────────
  // The overview popup (shown when no datasets are selected) carries a button
  // that launches the full cross-dataset analysis. The per-click handler stores
  // its trigger on deepenRef; this global listener just invokes it.
  const deepenRef = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('[data-action="deepen"]')) return
      e.preventDefault()
      deepenRef.current?.()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // ─── "✨ Plain-language summary" delegation ──────────────────────────────
  // The AI-summary button (and its retry) live in the popup HTML; the per-click
  // handler stores the trigger on aiSummaryRef, which this listener invokes.
  const aiSummaryRef = useRef(null)
  useEffect(() => {
    const handler = (e) => {
      if (!e.target.closest('[data-action="ai-summary"]')) return
      e.preventDefault()
      aiSummaryRef.current?.()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  // ─── News lookup click delegation ───────────────────────────────────────
  // Same plain-HTML popup constraint. The "📰 News from this time and
  // place" button carries the diagnosis (cause, location, named-fire,
  // OPERA date) as data-* attributes; we fire a /news request to the
  // cloud function and replace the button with the results in place.
  useEffect(() => {
    const handler = async (e) => {
      const btn = e.target.closest('[data-action="load-news"]')
      if (!btn) return
      e.preventDefault()
      const targetId = btn.dataset.targetId
      const container = document.getElementById(targetId)
      if (!container) return
      // Loading skeleton — 3 placeholder cards.
      container.innerHTML = `
        <div class="${styles.popupNewsHeader}">Searching for related news…</div>
        ${[0, 1, 2].map(() => `
          <div class="${styles.popupNewsSkel}">
            <div class="${styles.popupNewsSkelImg}"></div>
            <div class="${styles.popupNewsSkelText}">
              <div class="${styles.popupNewsSkelLine}"></div>
              <div class="${styles.popupNewsSkelLine} ${styles.popupNewsSkelShort}"></div>
            </div>
          </div>
        `).join('')}
      `
      const params = new URLSearchParams({
        news: '1',
        cause: btn.dataset.cause || '',
        location: btn.dataset.location || '',
        named: btn.dataset.named || '',
        date: btn.dataset.date || '',
      })
      try {
        const res = await fetch(`${TILES_API_BASE}?${params}`)
        const data = await res.json()
        container.innerHTML = renderArticleList(data, btn.dataset)
      } catch (err) {
        container.innerHTML = `
          <div class="${styles.popupNewsHeader}">Couldn't load news</div>
          <div class="${styles.popupNewsEmpty}">${escapeHTML(String(err))}</div>
        `
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.mapWrap} />

      {/* Branding lockup: two independent links so "Forest Monitor" reliably
          re-opens this view (clears query state, closes modal, etc.) while
          "EarthAtlas" still goes home. */}
      <div className={styles.branding}>
        <a href="/" className={styles.brandingLink}>
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <a href="/forestmonitor" className={styles.brandingLink}>
          <span className={styles.subBadge}>Forest Monitor</span>
        </a>
      </div>

      <div className={styles.searchBox}>
        <GeoSearch
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={(r) => {
            const m = mapRef.current
            if (!m) return
            if (r.bbox && r.bbox.length === 4) {
              m.fitBounds(
                [[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]],
                { padding: 80, duration: 1400, maxZoom: 14 },
              )
            } else if (Number.isFinite(r.lng) && Number.isFinite(r.lat)) {
              m.flyTo({ center: [r.lng, r.lat], zoom: r.zoom, duration: 1400, essential: true })
            }
          }}
        />
      </div>

      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button
          type="button"
          className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)}
          aria-label="Change basemap"
          aria-expanded={basemapMenuOpen}
          title={`Basemap: ${BASEMAPS.find((b) => b.id === basemap)?.label || ''}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel} role="menu">
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => {
              const active = basemap === b.id
              return (
                <button
                  key={b.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  className={active ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                  onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}
                >
                  <span className={`${styles.basemapSwatch} ${styles[`basemapSwatch_${b.id}`]}`} />
                  <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                  {active && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={styles.basemapMenuCheck}>
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <aside className={styles.layerPanel} aria-label="Map layers">
        <div className={styles.layerPanelTitle}>Layers</div>

        {/* ── Layer 1: NASA OPERA vegetation disturbance ───────────────── */}
        <div className={styles.layerRow}>
          <div className={styles.layerHeader}>
            <button
              type="button"
              className={styles.layerCaret}
              onClick={() => setOperaExpanded((v) => !v)}
              aria-expanded={operaExpanded}
              aria-label={operaExpanded ? 'Collapse layer' : 'Expand layer'}
            >
              <span className={operaExpanded ? styles.caretOpen : styles.caretClosed}>▸</span>
            </button>
            <span className={styles.layerName}>Vegetation disturbance</span>
            <button
              type="button"
              role="switch"
              aria-checked={operaVisible}
              className={operaVisible ? styles.switchOn : styles.switchOff}
              onClick={() => setOperaVisible((v) => !v)}
              aria-label="Toggle vegetation disturbance layer"
            >
              <span className={styles.switchKnob} />
            </button>
          </div>

          {operaExpanded && (
            <div className={`${styles.layerBody} ${operaVisible ? '' : styles.layerBodyMuted}`}>
              <div className={styles.opacityControl}>
                <div className={styles.opacityHeader}>
                  <span className={styles.opacityLabel}>Opacity</span>
                  <span className={styles.opacityValue}>{Math.round(opacity * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="100" step="1"
                  value={Math.round(opacity * 100)}
                  onChange={(e) => setOpacity(Number(e.target.value) / 100)}
                  className={styles.opacitySlider}
                  aria-label="Disturbance layer opacity"
                />
              </div>

              <div className={styles.subLabel}>View</div>
              <div className={styles.modeRow}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    className={mode === m.id ? styles.modeBtnActive : styles.modeBtn}
                    onClick={() => setMode(m.id)}
                    title={m.blurb}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <RangePresets dateRange={dateRange} onPick={setDateRange} />

              <DateRangeSlider
                minMs={DATA_START_MS}
                maxMs={todayUtcMs()}
                startMs={dateRange[0]}
                endMs={dateRange[1]}
                onChange={(s, e) => setDateRange([s, e])}
              />

              <div className={styles.filterSection}>
                <div className={styles.filterLabel}>Land use</div>
                <div className={styles.presets}>
                  {LANDUSE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={landuse === p.id ? styles.presetBtnActive : styles.presetBtn}
                      onClick={() => setLanduse(p.id)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {mode === 'recency' && (
                <>
                  <div className={styles.legendGradient} style={{ background: RECENCY_GRADIENT }} />
                  <div className={styles.legendScale}>
                    <span>Jan 2023</span>
                    <span>Today</span>
                  </div>
                  <div className={styles.legendBlurb}>
                    <strong>Pale yellow</strong> = oldest disturbance, <strong>deep red</strong> = most recent — same as the forest-loss (Hansen) layer. The slider above limits which pixels are shown but doesn't change the colors. Source: NASA OPERA L3 DIST-ALERT, 30 m.
                  </div>
                </>
              )}
              {mode === 'severity' && (
                <>
                  <div className={styles.legendGradient} style={{ background: SEVERITY_GRADIENT }} />
                  <div className={styles.legendScale}>
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                  <div className={styles.legendBlurb}>
                    Percent of the pixel's vegetation that's been lost.
                  </div>
                </>
              )}
              {mode === 'status' && (
                <>
                  <ul className={styles.legendList}>
                    {STATUS_SWATCHES.map((s) => (
                      <li key={s.label}>
                        <span className={styles.swatch} style={{ background: s.color }} />
                        {s.label}
                      </li>
                    ))}
                  </ul>
                  <div className={styles.legendBlurb}>
                    Provisional = single-detection; confirmed = multi-detection.
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Layer 2: Forest Data Partnership commodity crops ─────────── */}
        <div className={styles.layerRow}>
          <div className={styles.layerHeader}>
            <button
              type="button"
              className={styles.layerCaret}
              onClick={() => setCommodityExpanded((v) => !v)}
              aria-expanded={commodityExpanded}
              aria-label={commodityExpanded ? 'Collapse layer' : 'Expand layer'}
            >
              <span className={commodityExpanded ? styles.caretOpen : styles.caretClosed}>▸</span>
            </button>
            <span className={styles.layerName}>Tropical commodity crops</span>
            <button
              type="button"
              role="switch"
              aria-checked={commodityVisible}
              className={commodityVisible ? styles.switchOn : styles.switchOff}
              onClick={() => setCommodityVisible((v) => !v)}
              aria-label="Toggle commodity crops layer"
            >
              <span className={styles.switchKnob} />
            </button>
          </div>

          {commodityExpanded && (
            <div className={`${styles.layerBody} ${commodityVisible ? '' : styles.layerBodyMuted}`}>
              <div className={styles.opacityControl}>
                <div className={styles.opacityHeader}>
                  <span className={styles.opacityLabel}>Opacity</span>
                  <span className={styles.opacityValue}>{Math.round(commodityOpacity * 100)}%</span>
                </div>
                <input
                  type="range" min="0" max="100" step="1"
                  value={Math.round(commodityOpacity * 100)}
                  onChange={(e) => setCommodityOpacity(Number(e.target.value) / 100)}
                  className={styles.opacitySlider}
                  aria-label="Commodity layer opacity"
                />
              </div>

              <div className={styles.subLabel}>Crops</div>
              <ul className={styles.cropList}>
                {COMMODITY_LAYERS.map((c) => (
                  <li key={c.key}>
                    <label className={styles.cropRow}>
                      <input
                        type="checkbox"
                        checked={!!commodityCrops[c.key]}
                        onChange={() => setCommodityCrops((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
                      />
                      <span className={styles.cropSwatch} style={{ background: c.color }} />
                      {c.label}
                    </label>
                  </li>
                ))}
              </ul>

              <div className={styles.legendBlurb}>
                Faint → bold = lower → higher model confidence. These models under-detect smallholder & shade-grown crops (e.g. Colombian coffee), so treat faint areas as "possible," not absent. Pan-tropical only. Source: Forest Data Partnership (Google), 10 m.
              </div>
            </div>
          )}
        </div>

        {/* ── Extra single-raster overlays: RADD / Hansen / TMF ─────────── */}
        {EXTRA_LAYERS.map((layer) => (
          <div key={layer.id} className={styles.layerRow}>
            <div className={styles.layerHeader}>
              <button
                type="button"
                className={styles.layerCaret}
                onClick={() => setExtraExpanded((p) => ({ ...p, [layer.id]: !p[layer.id] }))}
                aria-expanded={!!extraExpanded[layer.id]}
                aria-label={extraExpanded[layer.id] ? 'Collapse layer' : 'Expand layer'}
              >
                <span className={extraExpanded[layer.id] ? styles.caretOpen : styles.caretClosed}>▸</span>
              </button>
              <span className={styles.layerName}>{layer.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={!!extraVisible[layer.id]}
                className={extraVisible[layer.id] ? styles.switchOn : styles.switchOff}
                onClick={() => setExtraVisible((p) => ({ ...p, [layer.id]: !p[layer.id] }))}
                aria-label={`Toggle ${layer.label} layer`}
              >
                <span className={styles.switchKnob} />
              </button>
            </div>

            {extraExpanded[layer.id] && (
              <div className={`${styles.layerBody} ${extraVisible[layer.id] ? '' : styles.layerBodyMuted}`}>
                <div className={styles.opacityControl}>
                  <div className={styles.opacityHeader}>
                    <span className={styles.opacityLabel}>Opacity</span>
                    <span className={styles.opacityValue}>{Math.round((extraOpacity[layer.id] ?? 0) * 100)}%</span>
                  </div>
                  <input
                    type="range" min="0" max="100" step="1"
                    value={Math.round((extraOpacity[layer.id] ?? 0) * 100)}
                    onChange={(e) => setExtraOpacity((p) => ({ ...p, [layer.id]: Number(e.target.value) / 100 }))}
                    className={styles.opacitySlider}
                    aria-label={`${layer.label} opacity`}
                  />
                </div>

                {layer.legend.gradient && (
                  <>
                    <div className={styles.legendGradient} style={{ background: layer.legend.gradient }} />
                    <div className={styles.legendScale}>
                      <span>{layer.legend.left}</span>
                      <span>{layer.legend.right}</span>
                    </div>
                  </>
                )}
                {layer.legend.swatches && (
                  <ul className={styles.legendList}>
                    {layer.legend.swatches.map((s) => (
                      <li key={s.l}>
                        <span className={styles.swatch} style={{ background: s.c }} />
                        {s.l}
                      </li>
                    ))}
                  </ul>
                )}
                <div className={styles.legendBlurb}>{layer.legend.blurb}</div>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setShowMethodology(true)}
          className={styles.legendMethodology}
        >
          ⓘ How this is sourced
        </button>

        <div className={styles.legendFooter}>
          EarthAtlas is built by{' '}
          <a
            href="https://knauernever.com"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.legendFooterLink}
          >
            KnauerNever.com
          </a>
        </div>
      </aside>

      {tileLoading && <div className={styles.statusBadge}>Loading tiles…</div>}
      {tileError && (
        <div className={styles.errorBadge}>
          <div className={styles.errorBadgeTitle}>
            <span className={styles.errorBadgeIcon}>⚠️</span>
            {tileError.title}
          </div>
          <div className={styles.errorBadgeBody}>{tileError.body}</div>
        </div>
      )}

      <div className={styles.tip}>Click anywhere on a colored pixel for details.</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

// ─── Methodology modal ─────────────────────────────────────────────────────
function MethodologyModal({ onClose }) {
  // Esc to close
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
            Colored pixels are forest-disturbance alerts from <strong>NASA OPERA L3 DIST-ALERT</strong> (Vegetation Disturbance Alert),
            derived from harmonized Landsat-8 and Sentinel-2 imagery at 30 m resolution. New alerts typically appear within ~5 days
            of the most recent satellite pass. Color encodes <em>recency</em> (default), <em>status</em>, or <em>severity</em>;
            switch modes at the top of the screen. In recency view the ramp runs from pale yellow (older alerts) to deep red (most
            recent) — the same direction as the Hansen forest-loss layer, so the freshest disturbance reads as urgent red. The
            date slider in the legend masks which alerts are shown but does not change colors.
          </p>
          <p>
            The <strong>Land use filter chips</strong> in the legend (Forest / Cropland / Grassland / Built) run the same tiered land-cover
            classifier described below, server-side: pixels that don't match the chosen category are masked out before the tiles render.
            The result is the highest-resolution available source per region — CDL crop classes in the US, MapBiomas in Brazil, Dynamic
            World everywhere else, with WorldCover catching gaps.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>When you click a pixel</h3>
          <p>
            We fire multiple parallel lookups in two phases so the popup tells you not just <em>that</em> something happened,
            but plausibly <em>why</em>. The fast core arrives in ~2 s; the slower cause-inference signals stream in 1–2 s after that.
          </p>
          <p><strong>Core (fast, ~2 s):</strong></p>
          <ol>
            <li><strong>OPERA point sample</strong> — date, status code, severity %.</li>
            <li><strong>Reverse geocode (Mapbox v6)</strong> — town, county/district, state/region, country.</li>
            <li><strong>Protected areas (Mapbox Tilequery)</strong> — named national parks, forests, wilderness, monuments.</li>
            <li><strong>Natural features (Google Geocoding)</strong> — mountain ranges, named regions, watersheds where they exist.</li>
            <li>
              <strong>Land-cover (tiered)</strong> — most-specific available source: USDA CDL (US) → MapBiomas (Brazil) →
              Dynamic World (global, near-real-time) → ESA WorldCover (global fallback).
            </li>
          </ol>
          <p><strong>Extras (slower, ~1–2 s):</strong></p>
          <ol start={6}>
            <li><strong>Connected-component patch outline</strong> — vectorized 5 km around the click. Acres come from the polygon area, not a pixel-count cap.</li>
            <li><strong>MODIS burned-area check (MCD64A1)</strong> — 500 m monthly. Detects burns within ±90 days of the OPERA date.</li>
            <li><strong>Active-fire detections (NASA FIRMS)</strong> — counts hot-spots within 3 km of the click and ±60 days of the OPERA date. Higher resolution and sensitivity than the burned-area product; catches small or short-lived fires.</li>
            <li><strong>Sentinel-2 NBR delta (dNBR)</strong> — Normalized Burn Ratio before vs after the OPERA date, sampled at 20 m. A dNBR above ~0.27 typically indicates a moderate-to-high severity burn (USGS classification).</li>
            <li><strong>Patch shape analysis</strong> — compactness and aspect ratio of the polygon. Blocky shapes suggest human cuts; irregular shapes suggest natural events.</li>
            <li>
              <strong>Named US fires (MTBS + NIFC)</strong> — for clicks inside the United States, we check whether the point falls inside a known historical (MTBS, ≤3 yr lookback) or current (NIFC WFIGS, ≤1.5 yr lookback) fire perimeter. Filtered so the fire's ignition date must precede the OPERA detection — cause must precede effect. When a match exists, the fire's name, ignition date, acres, and (for active fires) containment status appear at the top of the popup with an InciWeb link.
            </li>
            <li>
              <strong>AlphaEarth Foundations context</strong> — five derived signals from
              Google DeepMind's annual 10 m embedding dataset (nearest land-use class, pre/post
              change magnitude, multi-year trajectory sparkline, similar-disturbance kNN, and
              pre-disturbance stability). All five are computed in parallel with the extras
              above, so they don't extend the popup wait time. Renders in a purple "AlphaEarth
              context" block at the bottom of the popup on both disturbance and stable clicks.
              Detailed in its own section below.
            </li>
          </ol>
        </section>

        <section className={styles.modalSection}>
          <h3>How "Likely cause" is decided</h3>
          <p>
            The colored card in the popup is a simple weighted scoring rule, not a trained classifier. We tally signals into
            four bins — <em>fire</em>, <em>human activity</em>, <em>natural</em>, <em>agricultural context</em> — and pick the
            label that wins. The reasoning line under the label shows you exactly which signals fired.
          </p>
          <p>Roughly:</p>
          <ul>
            <li><strong>Fire</strong> wins when MODIS burned-area, VIIRS/MODIS active fires, or a substantial dNBR (&gt;0.27) line up near the OPERA date.</li>
            <li><strong>Mechanical / agricultural clearing</strong> wins when the patch is blocky or linear AND no fire signal is present. The "agricultural" qualifier appears when the land-cover label is a crop or pasture class.</li>
            <li><strong>Natural</strong> wins when the patch is highly irregular AND no fire or human-shape signals are present.</li>
            <li><strong>Inconclusive</strong> when signals are absent or contradictory — we'd rather say nothing than misattribute.</li>
          </ul>
          <p>
            <strong>Crop-aware refinements (US, CDL pixels):</strong> When the click lands on a known crop, we look up the crop's
            management profile and seasonal harvest window before assigning a label.
          </p>
          <ul>
            <li><strong>Multi-cut forages</strong> (alfalfa, hay, clover, sod, switchgrass) get cut 2–5× per season. A dNBR spike during their cutting window is almost always a routine hay cut, not a burn — these crops are very rarely burned. The label says "Likely alfalfa harvest cut" instead of "Possible agricultural burn".</li>
            <li><strong>Burn-managed crops</strong> (sugarcane, rice, cotton) routinely use pre- or post-harvest field burning. The fire signal is interpreted as a managed burn rather than a wildfire here.</li>
            <li><strong>Annual harvest crops</strong> (corn, soybeans, wheat, etc.) produce dNBR spikes at harvest. In-season harvest reads as harvest; out-of-season fire signal is more suspicious.</li>
            <li><strong>Orchards</strong> (apples, citrus, almonds, grapes) don't disturb the canopy during routine harvest — a blocky dNBR signal usually means tree removal or replanting.</li>
            <li><strong>USDA NASS Census of Agriculture</strong> tillage data, when available, softens burn-related labels in counties where no-till management is dominant (residue burning is incompatible with no-till).</li>
          </ul>
          <p>
            The thresholds are heuristic. False positives and false negatives are expected, especially in mixed-use landscapes
            (e.g. fire-managed cropland) or in areas where one of the underlying datasets is sparse. The reasoning line is
            there so you can sanity-check each call.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>AlphaEarth context (purple box in the popup)</h3>
          <p>
            Google DeepMind's <strong>AlphaEarth Foundations</strong> model summarizes each 10 m
            patch of Earth, every year since 2017, into a 64-dimensional fingerprint built from
            Landsat, Sentinel-1, Sentinel-2, LiDAR, and other inputs. The numbers aren't
            individually meaningful — but two fingerprints can be <em>compared</em> (cosine
            similarity) to ask "how similar are these places, or this place across time?"
          </p>
          <p>The popup surfaces five derived signals on every disturbance click — and on stable clicks too, so you can fingerprint your own land:</p>
          <ol>
            <li>
              <strong>Most resembles</strong> — for the click point, we sample Dynamic World
              class labels for ~25 points per class within an 80 km buffer, average each class's
              AEF embedding, and report the top three classes by cosine similarity to the click's
              own embedding. This benefits from AEF's multi-sensor + multi-year representation
              rather than a single Dynamic World classification, and surfaces ranked confidence.
              <em>Below ±60° latitude we suppress the "Snow &amp; ice" class since Dynamic World
              tends to mislabel bright tropical cloud edges as snow.</em>
            </li>
            <li>
              <strong>Land-use shift</strong> — cosine distance between the pre-disturbance
              year (OPERA year − 1) and the post-disturbance year (OPERA year + 1) AEF
              embeddings. Bucketed into <em>unchanged / subtle / substantial / major</em>.
              When OPERA year + 1 hasn't been published yet (AEF is annual, ~Q4 lag), this
              row is hidden rather than showing a misleading "no change" reading.
            </li>
            <li>
              <strong>Multi-year trajectory</strong> — annual cosine distance of the click's
              AEF embedding from its 2017 baseline. The sparkline shows the year-by-year drift;
              a vertical red dashed line marks the OPERA-detection year on disturbance clicks.
              A flat curve that suddenly jumps tells a different story than a slow upward drift
              that finally crosses an OPERA threshold.
            </li>
            <li>
              <strong>Land-use stability</strong> — median pairwise cosine similarity across
              the three years preceding the click. High similarity (&gt;0.95) =
              previously-stable land; lower values flag already-volatile pixels (shifting
              cultivation, frontier conversion, etc.). On a disturbance click, this answers
              "was this intact land that got cut, or was it already-changing land that crossed
              the OPERA threshold?"
            </li>
            <li>
              <strong>Similar disturbances within 12 km</strong> — we sample up to 20 nearby
              OPERA-flagged pixels, score each by cosine similarity to the click's
              pre-disturbance embedding, and surface the top five. Each row is clickable —
              tapping it pans the map there so you can compare diagnoses. Same-day clusters
              with high similarity often mean the same operation or weather event.
            </li>
          </ol>
          <p>
            AEF gives the popup context that the existing land-cover / fire stack can't:
            land-use <em>change</em> independent of fire, multi-year <em>history</em>,
            and a notion of "this place looks like other places in this region." Failure
            modes: it inherits Dynamic World's regional vocabulary, so "Most resembles" is
            most useful as a confidence/ranking signal — for richer class labels (oil palm,
            rubber, cabruca, mining), a pre-staged labeled reference library per region is
            the planned next step.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Datasets</h3>
          <dl className={styles.datasetList}>
            <dt>AlphaEarth Foundations Satellite Embedding V1 (annual)</dt>
            <dd>
              64-D unit-length embedding per 10 m pixel per year (2017–2025), produced by Google DeepMind's
              AlphaEarth Foundations model from Landsat + Sentinel-1 + Sentinel-2 + LiDAR + other sources.
              Used in the popup's purple "AlphaEarth context" block for nearest-class matching, pre/post
              change magnitude, multi-year trajectory, similar-disturbance kNN, and pre-disturbance
              stability score.{' '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL" target="_blank" rel="noopener noreferrer">EE catalog</a>{' · '}
              <a href="https://deepmind.google/blog/alphaearth-foundations-helps-map-our-planet-in-unprecedented-detail/" target="_blank" rel="noopener noreferrer">DeepMind announcement</a>
            </dd>

            <dt>NASA OPERA L3 DIST-ALERT HLS V1</dt>
            <dd>
              30 m, near-real-time, global · NASA via GLAD's GEE mirror <code>projects/glad/HLSDIST/current</code>.{' '}
              <a href="https://www.earthdata.nasa.gov/data/catalog/lpcloud-opera-l3-dist-alert-hls-v1-1" target="_blank" rel="noopener noreferrer">Catalog</a>{' · '}
              <a href="https://glad.umd.edu/dataset/glad-forest-alerts" target="_blank" rel="noopener noreferrer">GLAD mirror</a>
            </dd>

            <dt>USDA Cropland Data Layer (CDL)</dt>
            <dd>
              30 m, annual, US only · USDA NASS, latest year used: 2024 · ~80 per-species crop classes plus
              forest / grassland / built. Highest-priority tier in the popup labels and the land-use filter.{' '}
              <a href="https://nassgeodata.gmu.edu/CropScape/" target="_blank" rel="noopener noreferrer">CropScape</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/USDA_NASS_CDL" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>AAFC Annual Crop Inventory (Canada)</dt>
            <dd>
              30 m, annual, Canada only · Agriculture and Agri-Food Canada, latest year used: 2024 ·
              Per-species crop classes (wheat, canola, soybeans, corn, barley, etc.) with the same structure
              as CDL — used as the highest-priority tier for Canadian clicks.{' '}
              <a href="https://open.canada.ca/data/en/dataset/ba2645d5-4458-414d-b196-6303ac06c1c9" target="_blank" rel="noopener noreferrer">AAFC data</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/AAFC_ACI" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>MapBiomas Brazil — Collection 9</dt>
            <dd>
              30 m, annual, Brazil · Latest year: 2023. Detailed national LULC including pasture, soybean, sugarcane, mining ·
              Used for popup labels and as a tier in the land-use filter classifier.{' '}
              <a href="https://brasil.mapbiomas.org/en/" target="_blank" rel="noopener noreferrer">MapBiomas Brasil</a>
            </dd>

            <dt>MapBiomas regional collections (eleven, all verified in EE)</dt>
            <dd>
              Eleven additional 30 m annual MapBiomas products that extend the per-species crop legend across
              South America + Indonesia. Each asset path was directly verified via{' '}
              <code>earthengine asset info</code>:
              <ul>
                <li><strong>Bolivia V1</strong> (1985–2024)</li>
                <li><strong>Ecuador V1</strong> (1985–2024)</li>
                <li><strong>Peru</strong> Collection 3 (1985–2023)</li>
                <li><strong>Colombia</strong> Collection 2 (1985–2023)</li>
                <li><strong>Indonesia</strong> Collection 2 (2000–2022)</li>
                <li><strong>Argentina</strong> Collection 1 (1998–2022)</li>
                <li><strong>Paraguay</strong> Collection 1 (1985–2022)</li>
                <li><strong>Venezuela</strong> Collection 1 (1985–2022)</li>
                <li><strong>Chaco</strong> Collection 5 (Argentina / Paraguay / Bolivia biome, 1985–2020)</li>
                <li><strong>Pampa</strong> Collection 4 (Argentina / Uruguay biome, 1985–2023)</li>
                <li><strong>Amazon RAISG</strong> Collection 5 (pan-Amazonia, 1985–2022)</li>
              </ul>
              All share the MapBiomas legend — the same per-species classes (Pasture, Soybean, Sugar Cane, Coffee,
              Citrus, Cotton, Rice, etc.) work uniformly across all eleven. Priority: country-specific collections
              win over multi-country biome collections; biome collections win over pan-Amazonia. The Google EE
              Data Catalog page only documents three (Brazil V1, Bolivia V1, Ecuador V1) — the rest are public
              MapBiomas-published assets accessible by full path but not curated in the catalog.{' '}
              <a href="https://mapbiomas.org/en" target="_blank" rel="noopener noreferrer">mapbiomas.org</a>
            </dd>

            <dt>EUCROPMAP (JRC, EU)</dt>
            <dd>
              10 m, EU + UK, 2018 and 2022 (we use 2022) · European Commission Joint Research Centre.
              18 specific crop classes: common wheat, durum wheat, barley, rye, oats, maize, rice, triticale,
              potatoes, sugar beet, sunflower, rapeseed, soya, dry pulses, fodder, plus woodland and grassland fallbacks.{' '}
              <a href="https://data.jrc.ec.europa.eu/dataset/15f86c84-eb6e-4914-9e84-eaeb5d0fdc3c" target="_blank" rel="noopener noreferrer">JRC catalog</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/JRC_D5_EUCROPMAP_V1" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>ESA WorldCereal v1 (global cereals)</dt>
            <dd>
              10 m, global, 2021 · European Space Agency. Binary per-crop masks for three specific products —
              maize, winter cereals, spring cereals — covering 106 agro-ecological zones globally. Slotted between
              the national crop maps and Dynamic World so cereal pixels worldwide get a species label even when
              no national source covers the region.{' '}
              <a href="https://esa-worldcereal.org/" target="_blank" rel="noopener noreferrer">esa-worldcereal.org</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCereal_2021_MODELS_v100" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>Google Dynamic World V1</dt>
            <dd>
              10 m, near-real-time, global · Per-Sentinel-2-scene classifications. We sample the mode label over the most recent 90 days ·
              Generic categories (Crops, Trees, Grass, Built, Water, etc.) — used as the global near-real-time
              backstop when none of the per-species maps cover the click.{' '}
              <a href="https://dynamicworld.app/" target="_blank" rel="noopener noreferrer">Dynamic World</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>ESA WorldCover 2021 (v200)</dt>
            <dd>
              10 m, single 2021 snapshot, global · Bottom-tier fallback for both popup labels and the land-use filter classifier —
              used wherever the higher-priority maps all have no data (e.g. far-northern tundra, deep ocean clips).{' '}
              <a href="https://esa-worldcover.org/" target="_blank" rel="noopener noreferrer">esa-worldcover.org</a>
            </dd>

            <dt>MODIS MCD64A1 Burned Area (Collection 6.1)</dt>
            <dd>
              500 m, monthly, global · NASA / Univ. of Maryland. We check ±90 days around the OPERA detection date.{' '}
              <a href="https://lpdaac.usgs.gov/products/mcd64a1v061/" target="_blank" rel="noopener noreferrer">LP DAAC</a>
            </dd>

            <dt>NASA FIRMS Active Fires</dt>
            <dd>
              MODIS + VIIRS hot-spot detections, daily, near-real-time, global · Used as a complementary fire signal to
              MCD64A1: counts detections within a 3 km buffer / ±60 days of the OPERA date.{' '}
              <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener noreferrer">FIRMS</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/FIRMS" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>Copernicus Sentinel-2 L2A (Harmonized)</dt>
            <dd>
              10–20 m, ~5-day revisit, global · Used to compute dNBR (Normalized Burn Ratio delta) — median NBR over the
              60–240 days before the OPERA date vs the 0–60 days after, sampled at the click point. Quantifies burn severity
              from spectral change even when active-fire products miss the event.{' '}
              <a href="https://sentiwiki.copernicus.eu/web/sentinel-2" target="_blank" rel="noopener noreferrer">Sentinel-2 SentiWiki</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S2_SR_HARMONIZED" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>Patch shape analysis (derived)</dt>
            <dd>
              Pure-Python geometry stats over the OPERA-derived polygon — area, perimeter, compactness (4πA/P²), aspect
              ratio of the bounding box. Drives the "blocky / linear / irregular" hint that feeds the cause inference.
              No external dataset; the polygon comes from <code>ee.Image.reduceToVectors</code> on the OPERA disturbance mask.
            </dd>

            <dt>Crop management profiles (derived from CDL + MapBiomas + agronomic references)</dt>
            <dd>
              Per-crop lookup table mapping each USDA CDL class (US) and MapBiomas Brazil class
              to a management profile (multi-cut forage / burn-prone / annual harvest / orchard /
              fallow), a typical harvest month window, and a residue-burning practice rating
              (rare / occasional / common). Used to refine the cause label for cropland clicks —
              e.g. alfalfa cuts vs sugarcane burns vs corn harvest in the US; soybean vs
              sugarcane vs coffee vs pasture in Brazil. Northern-hemisphere windows are shifted
              ~6 months for southern-latitude clicks. Sources: USDA NASS crop calendars, USDA FAS
              commodity calendars, Embrapa publications, MAPA Brazil crop-calendar data. Expect
              to tune over time.
            </dd>

            <dt>USDA NASS Quick Stats — Census of Agriculture (optional)</dt>
            <dd>
              County-level tillage practice data (conventional / conservation / reduced / no-till
              share by acreage) from the most recent Census of Ag (typically 2022). Used as a
              tiebreaker for ambiguous "burn vs harvest" calls — a no-till-dominant county is
              very unlikely to be producing residue-burn signals. Activated when{' '}
              <code>NASS_API_KEY</code> is set on the cloud function; degrades gracefully
              (cause label still works, just without county-level refinement) when absent.{' '}
              <a href="https://quickstats.nass.usda.gov/api" target="_blank" rel="noopener noreferrer">Quick Stats API</a>
            </dd>

            <dt>MTBS — Monitoring Trends in Burn Severity (US)</dt>
            <dd>
              Authoritative US named-fire perimeters since 1984 (fires ≥1000 acres in the West, ≥500 acres in the East).
              Each fire has name, ignition date, acres, severity classification. ~1–2 year lag in latest available year.{' '}
              <a href="https://www.mtbs.gov/" target="_blank" rel="noopener noreferrer">mtbs.gov</a>{' · '}
              <a href="https://developers.google.com/earth-engine/datasets/catalog/USFS_GTAC_MTBS_burned_area_boundaries_v1" target="_blank" rel="noopener noreferrer">EE catalog</a>
            </dd>

            <dt>NIFC WFIGS — Wildland Fire Interagency Geospatial Services (US)</dt>
            <dd>
              Current US fire perimeters, updated daily during fire season. Each fire has name, IRWIN ID, acres,
              containment %, cause, location. Used at click-time via ArcGIS REST.{' '}
              <a href="https://data-nifc.opendata.arcgis.com/" target="_blank" rel="noopener noreferrer">data-nifc.opendata.arcgis.com</a>
            </dd>


            <dt>Mapbox Geocoding API v6</dt>
            <dd>
              Admin region hierarchy (place, district, region, country) for the click point.{' '}
              <a href="https://docs.mapbox.com/api/search/geocoding/" target="_blank" rel="noopener noreferrer">Docs</a>
            </dd>

            <dt>Mapbox Tilequery against mapbox-streets-v8</dt>
            <dd>
              Names of protected areas (parks, forests, wilderness, monuments) within 500 m of the click.{' '}
              <a href="https://docs.mapbox.com/api/maps/tilequery/" target="_blank" rel="noopener noreferrer">Docs</a>
            </dd>

            <dt>Google Geocoding API</dt>
            <dd>
              Named natural features (mountain ranges, large regions) at the click point — filtered to <code>result_type=natural_feature</code>.{' '}
              <a href="https://developers.google.com/maps/documentation/geocoding/overview" target="_blank" rel="noopener noreferrer">Docs</a>
            </dd>
          </dl>
        </section>

        <section className={styles.modalSection}>
          <h3>Limitations we want you to know about</h3>
          <ul>
            <li><strong>OPERA detects vegetation loss, not deforestation.</strong> Harvested cropland, prescribed burns, storm blowdown, mining, urban clearing all look similar in the OPERA signal. The "Likely cause" line tries to disambiguate, but the underlying land-cover and fire context are the most reliable inputs.</li>
            <li><strong>"Likely cause" is a heuristic, not a model.</strong> The label comes from a simple rule that weighs fire and shape signals against land-cover context. Expect occasional misses — particularly on small patches, in landscapes with ambiguous land use (e.g. fire-managed cropland), or when supporting data (Sentinel-2, MODIS, FIRMS) has gaps for the relevant window. The reasoning line under the label exposes the inputs so you can sanity-check.</li>
            <li><strong>Named-fire context is currently US-only.</strong> MTBS and NIFC cover the United States; international clicks won't get the fire-name treatment yet. A global option (JRC GlobFire v2) was attempted but its EE asset has known geometry-index issues that prevent reliable spatial filtering. Tracked as follow-up work; alternatives include ESA Fire_cci, EFFIS (Europe), or FIRMS hot-spot clustering.</li>
            <li><strong>dNBR can be missing.</strong> If Sentinel-2 imagery in the pre- or post-window is too cloudy (or too sparse, especially in winter at high latitudes), the dNBR sample comes back null and the heuristic falls back on other signals.</li>
            <li><strong>Patch shape uses raster-derived polygons.</strong> Every polygon edge is on the 30 m pixel grid, so we can't directly measure "straightness" of perimeter the way you'd want for a vector field boundary. The shape hint relies on compactness and aspect ratio, which still discriminate blocky vs irregular reliably for patches above ~10 acres.</li>
            <li><strong>Crop specificity varies by region.</strong> Per-species crop classes are available from national/regional maps where they exist: CDL (US 2024), AAFC ACI (Canada 2024), MapBiomas (Brazil C9 2023 + 10 other regional collections covering Bolivia, Ecuador, Peru, Colombia, Argentina, Paraguay, Venezuela, Indonesia, plus the Chaco / Pampa / pan-Amazonia biomes), EUCROPMAP (EU + UK 2022). ESA WorldCereal adds maize, winter cereals, and spring cereals globally. Outside those, the popup falls back to Dynamic World's generic categories (Crops, Trees, etc.) and finally to WorldCover 2021. Major gaps remaining: Australia (CLUM is not in EE), China (recent crop maps published only as research datasets), India (ICRISAT/MARS data not in EE), Russia, Sub-Saharan Africa beyond cereal crops, Mexico, most of mainland Southeast Asia outside the cereal belt. All would require custom EE ingestion. Tracked as follow-up work.</li>
            <li><strong>Orchards and tree crops classify as Cropland, not Forest.</strong> Cherries, almonds, apples, citrus groves are tree-covered but managed agriculture. CDL's specific orchard codes (66–77, plus most 200-series) are mapped to Cropland in our filter — so a "Forest" filter won't show them.</li>
            <li><strong>MODIS burned area is 500 m.</strong> Much coarser than 30 m OPERA. A pixel-perfect OPERA click can fall just outside the MODIS-detected burn boundary even when fire clearly drove the disturbance. FIRMS active fires (375 m–1 km) help, but a strong fire signal sometimes only shows up in dNBR.</li>
            <li><strong>"Nearest place" in remote forest can be misleading.</strong> Mapbox returns the closest containing or nearest settlement — sometimes 50+ km away in the Amazon or Congo. We always include the larger admin region as a more honest anchor.</li>
            <li><strong>Patch size measured within a 5 km search radius.</strong> The acres number comes from polygon area, not pixel counts — so it's accurate for any patch that fits within 5 km of the click point (about 19,000 acres of search area). Megafires or very large clearcuts that extend beyond that radius are flagged "extends beyond 5 km search radius" in the popup; the reported area is the in-radius portion only.</li>
            <li><strong>Provisional vs Confirmed.</strong> A provisional OPERA alert is a single satellite-pass detection; confirmed requires multiple. Provisional alerts will sometimes be revoked when more data comes in. "Finished" variants of either are real alerts whose current change activity has stopped.</li>
            <li><strong>AlphaEarth is annual, not real-time.</strong> The Satellite Embedding dataset publishes one mosaic per calendar year, typically released in Q4 of the following year. For a 2026 OPERA alert, the "pre" embedding is 2025 and the "post" embedding doesn't exist yet — so the "Land-use shift" row is suppressed until next year's publication. The other AEF signals (trajectory, stability, nearest-class, similar-disturbances) work fine in the meantime.</li>
            <li><strong>AlphaEarth "Most resembles" uses Dynamic World's vocabulary.</strong> Top match is one of the 9 generic Dynamic World classes (Trees / Crops / Built area / etc.), not a specific land-use like "cabruca," "oil palm," or "selective logging scar." AEF makes the ranking more stable than a raw Dynamic World classification (multi-sensor + multi-year representation, AEF-weighted neighbors), but it can't invent class labels we never trained against. Loading a region-specific labeled reference set is the planned next step for gap regions (Bahia cabruca, Indonesian oil palm, etc.).</li>
            <li><strong>Similar-disturbances list is regional, not global.</strong> The "Similar disturbances within 12 km" block samples OPERA-flagged pixels within a 12 km radius of the click. It surfaces same-event clusters and local patterns well, but won't find a similar disturbance on the other side of the world. A global vector-search backend (BigQuery + AEF embeddings) is the way to extend this — that's tracked as a follow-up.</li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>About this tool</h3>
          <p>
            Built by <a href="https://earthatlas.org" target="_blank" rel="noopener noreferrer">EarthAtlas</a> as an open
            exploration of near-real-time forest disturbance. The cloud function source and all dataset choices live in this repo and are reviewable.
            Please cite the underlying datasets (above) if you reproduce or publish from this data — we're a thin presentation layer over their work.
          </p>
        </section>

        <button type="button" className={styles.modalCloseBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

// ─── Range presets ──────────────────────────────────────────────────────────
// Quick-pick buttons that set the slider to a relative window ending today.
// The active preset is highlighted when the current range exactly matches.

function rangeForPreset(days) {
  const end = todayUtcMs()
  const start = days == null ? DATA_START_MS : end - days * DAY_MS
  return [Math.max(start, DATA_START_MS), end]
}

function RangePresets({ dateRange, onPick }) {
  const [curStart, curEnd] = dateRange
  return (
    <div className={styles.presets}>
      {RANGE_PRESETS.map((p) => {
        const [pStart, pEnd] = rangeForPreset(p.days)
        const active = pStart === curStart && pEnd === curEnd
        return (
          <button
            key={p.label}
            type="button"
            className={active ? styles.presetBtnActive : styles.presetBtn}
            onClick={() => onPick([pStart, pEnd])}
          >
            {p.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Date range slider ──────────────────────────────────────────────────────
// Two-handle range over [minMs, maxMs] in UTC epoch ms, snapping to whole days.
// Live-updates on drag (parent debounces the tile refetch).

function DateRangeSlider({ minMs, maxMs, startMs, endMs, onChange }) {
  const trackRef = useRef(null)

  const valueToPct = (ms) =>
    Math.max(0, Math.min(100, ((ms - minMs) / (maxMs - minMs)) * 100))

  const clientToMs = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const ms = minMs + ratio * (maxMs - minMs)
    return Math.round(ms / DAY_MS) * DAY_MS
  }

  const dragHandler = (which) => (e) => {
    e.preventDefault()
    const move = (mv) => {
      const ms = clientToMs(mv.clientX)
      if (which === 'start') onChange(Math.min(ms, endMs - DAY_MS), endMs)
      else onChange(startMs, Math.max(ms, startMs + DAY_MS))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={styles.sliderWrap}>
      <div className={styles.sliderTrack} ref={trackRef}>
        <div
          className={styles.sliderActive}
          style={{
            left: `${valueToPct(startMs)}%`,
            right: `${100 - valueToPct(endMs)}%`,
          }}
        />
        <button
          type="button"
          aria-label={`Start date: ${fmtMonthDay(startMs)}`}
          className={styles.sliderHandle}
          style={{ left: `${valueToPct(startMs)}%` }}
          onPointerDown={dragHandler('start')}
        />
        <button
          type="button"
          aria-label={`End date: ${fmtMonthDay(endMs)}`}
          className={styles.sliderHandle}
          style={{ left: `${valueToPct(endMs)}%` }}
          onPointerDown={dragHandler('end')}
        />
      </div>
      <div className={styles.sliderLabels}>
        <span>{fmtMonthDay(startMs)}</span>
        <span>{fmtMonthDay(endMs)}</span>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RASTER_SOURCE_ID = 'opera-dist-alert'
const RASTER_LAYER_ID = 'opera-dist-alert-layer'

function applyTileLayer(map, tileUrl, opacity = 0.85) {
  // Replacing the source's tiles requires removing and re-adding it in
  // Mapbox GL — there's no setTiles() method.
  if (map.getLayer(RASTER_LAYER_ID)) map.removeLayer(RASTER_LAYER_ID)
  if (map.getSource(RASTER_SOURCE_ID)) map.removeSource(RASTER_SOURCE_ID)
  map.addSource(RASTER_SOURCE_ID, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    attribution: 'NASA OPERA L3 DIST-ALERT · GLAD',
  })
  map.addLayer({
    id: RASTER_LAYER_ID,
    type: 'raster',
    source: RASTER_SOURCE_ID,
    paint: { 'raster-opacity': opacity },
  })
}

// ─── Generic raster overlay helpers (commodity crops + future layers) ───────
const commoditySourceId = (key) => `commodity-${key}`
const commodityLayerId = (key) => `commodity-${key}-layer`

// Add/replace a raster overlay. `beforeId` keeps it under another layer (we
// slot commodity crops beneath the OPERA alerts so disturbances stay on top).
function applyRasterLayer(map, sourceId, layerId, tileUrl, opacity, beforeId) {
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(sourceId)) map.removeSource(sourceId)
  map.addSource(sourceId, {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    attribution: 'Forest Data Partnership (Google)',
  })
  const layer = { id: layerId, type: 'raster', source: sourceId, paint: { 'raster-opacity': opacity } }
  if (beforeId && map.getLayer(beforeId)) map.addLayer(layer, beforeId)
  else map.addLayer(layer)
}

function removeRasterLayer(map, sourceId, layerId) {
  if (map.getLayer(layerId)) map.removeLayer(layerId)
  if (map.getSource(sourceId)) map.removeSource(sourceId)
}

const PATCH_SOURCE_ID = 'opera-patch'
const PATCH_FILL_ID = 'opera-patch-fill'
const PATCH_LINE_ID = 'opera-patch-line'

function addPatchOutline(map, geometry) {
  removePatchOutline(map)
  map.addSource(PATCH_SOURCE_ID, {
    type: 'geojson',
    data: { type: 'Feature', geometry, properties: {} },
  })
  map.addLayer({
    id: PATCH_FILL_ID,
    type: 'fill',
    source: PATCH_SOURCE_ID,
    paint: { 'fill-color': '#fbbf24', 'fill-opacity': 0.18 },
  })
  map.addLayer({
    id: PATCH_LINE_ID,
    type: 'line',
    source: PATCH_SOURCE_ID,
    paint: { 'line-color': '#fbbf24', 'line-width': 2 },
  })
}

function removePatchOutline(map) {
  if (map.getLayer(PATCH_LINE_ID)) map.removeLayer(PATCH_LINE_ID)
  if (map.getLayer(PATCH_FILL_ID)) map.removeLayer(PATCH_FILL_ID)
  if (map.getSource(PATCH_SOURCE_ID)) map.removeSource(PATCH_SOURCE_ID)
}

function renderLocationLines(pois, admin) {
  const lines = []
  if (pois && pois.length) {
    lines.push(`<div class="${styles.popupPoi}">${escapeHTML(pois.join(' · '))}</div>`)
  }
  if (admin) {
    lines.push(`<div class="${styles.popupLocation}">${escapeHTML(admin)}</div>`)
  }
  return lines.join('')
}

// Words that signal the disturbance is agricultural rather than deforestation.
// Hits across CDL crop names (Corn, Cotton, Soybeans, etc.), Dynamic World
// "Crops", WorldCover "Cropland", MapBiomas crop-specific classes.
const AG_KEYWORDS = /^(crops?|cropland|farming|agriculture|sugar|soybean|cotton|corn|wheat|rice|sorghum|barley|oats|millet|rye|canola|alfalfa|fallow|hay|sunflower|peanuts|tobacco|sugarcane|coffee|citrus|pasture|temporary crop|perennial crop|other (small grains|temporary crops|hay|tree crops|crops|perennial crops|small grains))|^(blueberries|cherries|peaches|apples|grapes|pistachios|triticale|carrots|asparagus|garlic|cantaloupes|prunes|olives|oranges|broccoli|avocados|peppers|pomegranates|nectarines|plums|strawberries|squash|apricots|vetch|lettuce|pumpkins|cabbage|cauliflower|celery|radishes|turnips|eggplants|gourds|cranberries|tomatoes|onions|cucumbers|chick peas|lentils|peas|caneberries|hops|herbs|clover\/wildflowers|sod\/grass seed|switchgrass|sugarbeets|dry beans|potatoes|sweet potatoes|misc vegs & fruits|watermelons|honeydew melons|greens|christmas trees|pecans|almonds|walnuts|pears|aquaculture|mint|sweet corn|pop or orn corn|camelina|buckwheat|speltz|flaxseed|safflower|rape seed|mustard|dbl crop .+)/i

function renderLandCover(lc) {
  if (!lc) return ''
  const isAg = AG_KEYWORDS.test(lc.label)
  const cls = isAg ? styles.popupLandCoverCropland : styles.popupLandCover
  const hint = isAg ? ' — likely agricultural, not deforestation' : ''
  const yearStr = lc.year ? ` ${lc.year}` : ''
  const sourceStr = lc.source ? ` <span class="${styles.popupLandCoverSource}">${escapeHTML(lc.source)}${yearStr}</span>` : ''
  return `<div class="${cls}">${escapeHTML(lc.label)}${hint}${sourceStr}</div>`
}

// ─── Commodity tree-crop block (Forest Data Partnership) ───────────────────
// Surfaces the likely commodity driver of a clearing: when a disturbed patch
// is now (very) likely oil palm / rubber / cocoa / coffee. The backend ships a
// ready-made plain-English summary ("Very likely cocoa (88% confidence)") so
// users never see a bare decimal. Gated on a positive hit (≥50%); absent
// entirely outside the pan-tropical coverage. CC BY 4.0 attribution required.
const COMMODITY_EMOJI = {
  'oil palm': '🌴',
  rubber: '🌳',
  cocoa: '🍫',
  coffee: '☕',
}
// `driverContext` true in the disturbance popup (the crop is a possible cause
// of the clearing); false in the location / no-disturbance popups, where the
// framing is simply "what's growing here" with no clearing implied.
function renderCommodity(commodity, driverContext = true) {
  if (!commodity || !commodity.top || !commodity.summary) return ''
  const { top, summary, year, attribution } = commodity
  const emoji = COMMODITY_EMOJI[top.crop] || '🌱'
  const yearStr = year ? ` · ${year} map` : ''
  const lead = driverContext
    ? 'A possible commodity driver of this clearing.'
    : "What the model reads as growing here."
  return `
    <div class="${styles.popupCommodity}">
      <div class="${styles.popupCommodityLabel}">${emoji} ${escapeHTML(summary)}</div>
      <div class="${styles.popupCommodityNote}">${lead} This is a probability, not a certainty — it can over-read regrowth and shade-grown farms.</div>
      <div class="${styles.popupCommoditySource}">${escapeHTML(attribution)}${yearStr}</div>
    </div>
  `
}

// ─── RADD / Hansen / TMF popup rows ─────────────────────────────────────────
// Each renders only when its layer is on (the click handler gates the data) AND
// there's something to say at the clicked pixel. One compact row apiece.
function _forestRow(icon, html, source) {
  return `<div class="${styles.popupForestRow}">${icon} ${html} <span class="${styles.popupForestSource}">${escapeHTML(source)}</span></div>`
}

function renderRadd(r) {
  if (!r || !r.date) return ''
  const when = new Date(r.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const conf = r.status === 'confirmed' ? 'confirmed' : 'unconfirmed'
  return _forestRow('📡', `<strong>Radar deforestation alert</strong> — ${conf}, ${escapeHTML(when)}`, 'WUR RADD · Sentinel-1')
}

function renderHansen(h) {
  if (!h) return ''
  const loss = h.lossYear
    ? `Forest loss in <strong>${h.lossYear}</strong>`
    : 'No tree-cover loss recorded since 2001'
  const tc = (h.treeCover2000 != null) ? ` · ${h.treeCover2000}% tree cover in 2000` : ''
  const gain = h.gain ? ' · regrowth 2000–2012' : ''
  return _forestRow('🌲', `${loss}${tc}${gain}`, 'Hansen / UMD-GLAD, 30 m')
}

function renderTmf(t) {
  if (!t || !t.label) return ''
  let yr = ''
  if (t.deforestationYear) yr = ` (${t.deforestationYear})`
  else if (t.degradationYear) yr = ` (${t.degradationYear})`
  return _forestRow('🌴', `Tropical moist forest: <strong>${escapeHTML(t.label)}</strong>${yr}`, 'JRC TMF')
}

// Bundle the three rows for a popup. `d` carries the (already layer-gated)
// radd / hansen / tmf fields.
function renderForestLayers(d) {
  if (!d) return ''
  return renderRadd(d.radd) + renderHansen(d.hansen) + renderTmf(d.tmf)
}

// Format a fire's display name. MTBS/NIFC fires have a real name (e.g.
// "Bear Gulch Fire"). GlobFire perimeters are unnamed — fall back to
// "{acres}-acre fire" or just "Fire perimeter" if size is unknown.
function fireDisplayName(f) {
  if (f.name) return f.name
  if (f.acres != null) {
    return `${Math.round(Number(f.acres)).toLocaleString()}-acre fire`
  }
  return 'Fire perimeter'
}

function renderNamedFires(fires, operaDateStr) {
  if (!fires || fires.length === 0) return ''

  // First fire shows full detail (most recent — likely most relevant to
  // current OPERA detection). Remaining fires render as a compact list
  // under the heading "Other historic fires at this location."
  const [first, ...rest] = fires
  const dateLabel = first.date
    ? new Date(first.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : (first.year ? String(first.year) : null)
  const acres = first.acres != null ? `${Math.round(Number(first.acres)).toLocaleString()} acres` : null
  const contained = first.contained_pct != null ? `${Math.round(first.contained_pct)}% contained` : null
  // For named MTBS/NIFC fires, the acres appear in the name line — don't
  // duplicate in the meta line. For unnamed GlobFire entries, the name IS
  // the acres, so the meta line keeps date + source.
  const metaParts = first.name
    ? [dateLabel, acres, contained, first.incident_type, first.source]
    : [dateLabel, first.source]
  const parts = metaParts.filter(Boolean).map(escapeHTML).join(' · ')
  const link = first.inciweb_url
    ? `<a href="${escapeHTML(first.inciweb_url)}" target="_blank" rel="noopener noreferrer" class="${styles.popupFireLink}">InciWeb ↗</a>`
    : ''
  let delta = ''
  if (operaDateStr && first.date) {
    const days = Math.round((new Date(operaDateStr) - new Date(first.date)) / 86_400_000)
    if (days >= 0) {
      const yrs = days >= 365 ? `${(days / 365).toFixed(1)} yr` : `${days} day${days === 1 ? '' : 's'}`
      delta = `<div class="${styles.popupFireDelta}">${yrs} before OPERA detection</div>`
    }
  }
  const firstBlock = `
    <div class="${styles.popupFireItem}">
      <div class="${styles.popupFireName}">🔥 ${escapeHTML(fireDisplayName(first))}</div>
      <div class="${styles.popupFireMeta}">${parts}</div>
      ${delta}
      ${link}
    </div>
  `

  let historyBlock = ''
  if (rest.length > 0) {
    const rows = rest.map((f) => {
      const yr = f.year || (f.date ? new Date(f.date).getFullYear() : '—')
      const ac = f.acres != null ? `${Math.round(Number(f.acres)).toLocaleString()} ac` : ''
      return `
        <li class="${styles.popupFireHistRow}">
          <span class="${styles.popupFireHistYear}">${escapeHTML(String(yr))}</span>
          <span class="${styles.popupFireHistName}">${escapeHTML(fireDisplayName(f))}</span>
          <span class="${styles.popupFireHistAcres}">${escapeHTML(ac)}</span>
        </li>
      `
    }).join('')
    historyBlock = `
      <div class="${styles.popupFireHistTitle}">
        Other historic fires at this location (${rest.length})
      </div>
      <ul class="${styles.popupFireHistList}">${rows}</ul>
    `
  }

  return `<div class="${styles.popupNamedFires}">${firstBlock}${historyBlock}</div>`
}

function renderBurn(burn, operaDateStr) {
  if (!burn || !burn.date) return ''
  const burnDate = new Date(burn.date)
  const prettyBurn = burnDate.toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  // If we have the OPERA date, show the delta — "12 days before" reads as a
  // strong cause-effect signal; "45 days after" is weaker but still useful.
  let delta = ''
  if (operaDateStr) {
    const opDate = new Date(operaDateStr)
    const diffDays = Math.round((burnDate - opDate) / 86_400_000)
    if (diffDays < 0) delta = ` (${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} before)`
    else if (diffDays > 0) delta = ` (${diffDays} day${diffDays === 1 ? '' : 's'} after)`
    else delta = ' (same day)'
  }
  return `<div class="${styles.popupBurn}">Fire detected ${prettyBurn}${delta} <span class="${styles.popupLandCoverSource}">MODIS MCD64A1</span></div>`
}

// Compact 8-char random ID for tagging per-popup DOM nodes (so the
// document-level event delegation can find the right news container
// when the user clicks "Related news" on a popup that might co-exist
// with another popup or be re-rendered as extras arrive).
function newsContainerId() {
  return 'fm-news-' + Math.random().toString(36).slice(2, 10)
}

// Render the article-list response from the /news endpoint. Replaces the
// "📰 News from this time and place" button in-place. Each article is a
// compact card: thumbnail (or favicon fallback) + title + source/date +
// snippet, whole card clickable, opens in new tab.
function renderArticleList(payload, btnData) {
  const articles = (payload && payload.articles) || []
  const window = payload && payload.window
  const headerLoc = (btnData && btnData.location) || ''
  const dateRange = window
    ? `${new Date(window.start).toLocaleDateString(undefined, {month:'short',day:'numeric'})} – ${new Date(window.end).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})}`
    : ''
  const headerLine = headerLoc
    ? `News for <strong>${escapeHTML(headerLoc.split(',')[0])}</strong> · ${escapeHTML(dateRange)}`
    : `News · ${escapeHTML(dateRange)}`

  if (articles.length === 0) {
    return `
      <div class="${styles.popupNewsHeader}">${headerLine}</div>
      <div class="${styles.popupNewsEmpty}">
        No matching news in this window. The cause + location combination
        may be too specific, or the search window (±14 days) too narrow.
      </div>
    `
  }

  // Compact cards (no snippet by default — keeps each card to ~50px tall so
  // 5 articles fit in roughly the height of the original cause card).
  const cardHTML = (a) => {
    const date = a.published_date
      ? new Date(a.published_date).toLocaleDateString(undefined, {month:'short',day:'numeric',year:'numeric'})
      : ''
    const thumb = a.image_url
      ? `<img src="${escapeHTML(a.image_url)}" alt="" class="${styles.popupNewsThumb}" loading="lazy" onerror="this.style.display='none'" />`
      : `<div class="${styles.popupNewsThumbFallback}">${
          a.favicon_url ? `<img src="${escapeHTML(a.favicon_url)}" alt="" loading="lazy" />` : ''
        }</div>`
    const meta = [a.source, date].filter(Boolean).map(escapeHTML).join(' · ')
    return `
      <a href="${escapeHTML(a.url)}" target="_blank" rel="noopener noreferrer" class="${styles.popupNewsCard}">
        ${thumb}
        <div class="${styles.popupNewsBody}">
          <div class="${styles.popupNewsTitle}">${escapeHTML(a.title)}</div>
          <div class="${styles.popupNewsMeta}">${meta}</div>
        </div>
      </a>
    `
  }

  const visible = articles.slice(0, 5).map(cardHTML).join('')
  const hidden = articles.length > 5
    ? `<details class="${styles.popupNewsMore}">
         <summary>Show ${articles.length - 5} more</summary>
         ${articles.slice(5).map(cardHTML).join('')}
       </details>`
    : ''

  return `
    <div class="${styles.popupNewsHeader}">${headerLine}</div>
    <div class="${styles.popupNewsList}">${visible}</div>
    ${hidden}
  `
}

// "📰 Related news" button + empty container. The container is replaced
// in-place by the fetch handler with a loading skeleton and then the
// article list.
function renderNewsBlock(cause, data, admin) {
  if (!cause || !cause.label) return ''
  const id = newsContainerId()
  // Pull the first named fire (if any) — strongest possible search anchor.
  const firstFire = (data.namedFires && data.namedFires[0]) || null
  const named = (firstFire && firstFire.name) ? firstFire.name : ''
  return `
    <div id="${id}" class="${styles.popupNewsSection}">
      <button
        type="button"
        class="${styles.popupNewsButton}"
        data-action="load-news"
        data-cause="${escapeHTML(cause.label)}"
        data-location="${escapeHTML(admin || '')}"
        data-named="${escapeHTML(named)}"
        data-date="${escapeHTML(data.date || '')}"
        data-target-id="${id}"
      >
        <span class="${styles.popupNewsButtonIcon}">📰</span>
        <span>News from this time and place</span>
      </button>
    </div>
  `
}

// Designations where commercial logging is legally prohibited — so a "logging"
// guess from patch shape is almost certainly wrong. (National/State *Forests*
// are NOT here: logging is permitted there.)
const NO_LOGGING_RE = /\b(wilderness|national park|national monument|wildlife refuge|nature (reserve|preserve)|national preserve)\b/i

function renderLikelyCause(cause, protectedName = null) {
  if (!cause || !cause.label) return ''
  // Color by cause family for at-a-glance scanning. Inconclusive stays neutral.
  // Crop-aware additions: "harvest" / "cut" / "replanting" / "orchard
  // management" all read as routine agricultural activity (human, amber).
  // A standalone "Possible fire" still wins fire-red even if it mentions
  // a crop name, because "fire" appears in the label.
  const label = cause.label.toLowerCase()
  let cls = styles.popupCauseNeutral
  // "Inconclusive…" labels always stay neutral, even when the text mentions
  // fire (e.g. "Inconclusive — nearby fires but no burn signature here").
  if (label.startsWith('inconclusive')) {
    cls = styles.popupCauseNeutral
  } else if (label.includes('fire') || label.includes('burn')) {
    cls = styles.popupCauseFire
  } else if (
    label.includes('harvest') ||
    label.includes(' cut') ||
    label.includes('replanting') ||
    label.includes('removal') ||
    label.includes('management') ||
    label.includes('clearing') ||
    label.includes('agricultural activity') ||
    label.includes('field activity') ||
    label.includes('field operations') ||
    label.includes('orchard') ||
    label.includes('fallow') ||
    label.includes('logging') ||
    label.includes('corridor') ||
    label.includes('construction') ||
    label.includes('demolition') ||
    label.includes('mechanical')
  ) {
    cls = styles.popupCauseHuman
  } else if (label.includes('natural')) {
    cls = styles.popupCauseNatural
  }

  // If the guess is a human-cutting cause (logging/clearing/etc.) but the click
  // is inside a no-logging protected area, that guess is almost certainly
  // wrong — reframe it as a likely natural disturbance and explain why. The
  // patch-shape heuristic doesn't know protection status; this layers it on.
  const isHumanCut = cls === styles.popupCauseHuman
  const protectedOverride = isHumanCut && protectedName && NO_LOGGING_RE.test(protectedName)
  let displayLabel = cause.label
  if (protectedOverride) {
    cls = styles.popupCauseNatural
    displayLabel = 'Likely natural disturbance'
  }

  // Render plain-English bullets when the backend sends them; fall back to
  // the legacy semicolon-joined string during deploy windows.
  const bullets = Array.isArray(cause.reasoning_bullets) ? [...cause.reasoning_bullets] : []
  if (protectedOverride) {
    bullets.unshift(`Inside ${protectedName}, where logging isn't allowed — so a blocky patch is more likely blowdown, beetle-kill, avalanche, or fire.`)
  }
  let reasoningBlock = ''
  if (bullets.length) {
    const lis = bullets.map((b) => `<li>${escapeHTML(b)}</li>`).join('')
    reasoningBlock = `
      <div class="${styles.popupCauseReasonHeader}">Why we think so:</div>
      <ul class="${styles.popupCauseReasonList}">${lis}</ul>
    `
  } else if (cause.reasoning) {
    reasoningBlock = `<div class="${styles.popupCauseReason}">${escapeHTML(cause.reasoning)}</div>`
  }

  return `
    <div class="${cls}">
      <div class="${styles.popupCauseLabel}">${escapeHTML(displayLabel)}</div>
      ${reasoningBlock}
    </div>
  `
}

// ─── AlphaEarth Foundations (AEF) popup block ───────────────────────────────
// Renders five derived signals from Google's Satellite Embedding dataset:
//   1. Nearest-class match    — kNN against region-bootstrapped class means
//   2. Change magnitude       — pre/post cosine distance
//   3. Trajectory             — multi-year sparkline vs 2017 baseline
//   4. Similar disturbances   — top-K lookalike OPERA pixels (clickable)
//   5. Stability score        — pre-disturbance similarity median
//
// Whole block is gated on `aef` being a truthy object; each subsection
// degrades to a skip if its data is missing. AEF is computed on the
// `?extras=1&aef=1` cloud-function call.
// Plain verdict for the yearly-greenery (NDVI) series. NDVI shows DIRECTION but
// can't prove a CAUSE, so we only call a loss "cleared/burned/harvested" when
// something corroborates it. When a dip isn't corroborated — the spot is inside
// legally-protected no-logging land, or OPERA flagged no disturbance here — we
// frame it as likely natural variation (drought, snow, a hard season) instead.
// Mirrors the protected-area reframe the likely-cause block applies, so the
// greenery line stops contradicting the disturbance layers and the AI summary.
function greennessVerdictText(big, startYear, { protectedName = null, operaDetected = false } = {}) {
  const NOTABLE = 0.05
  if (!big || Math.abs(big.delta) < NOTABLE) {
    return `Greenery here has stayed about the same since ${startYear}.`
  }
  if (big.delta > 0) {
    return `Biggest change around ${big.year}: got greener — likely regrowth or new planting.`
  }
  const noCutZone = protectedName && NO_LOGGING_RE.test(protectedName)
  if (noCutZone) {
    return `Biggest change around ${big.year}: greenery dipped — likely natural (drought, snow, or a hard season). This is protected land and no clearing was detected.`
  }
  if (!operaDetected) {
    return `Biggest change around ${big.year}: greenery dipped — likely a dry or hard season; no clearing was detected here.`
  }
  return `Biggest change around ${big.year}: lost greenery — likely cleared, burned, or harvested.`
}

function renderAef(aef, opts = {}) {
  if (!aef || typeof aef !== 'object') return ''
  const sections = []
  // Translate AEF cosine similarity (0..1) into a friendly percentage
  // string. AEF embeddings are unit-length so 1.0 = identical, 0.0 = no
  // similarity at all — clamping any negatives just keeps the display
  // honest if the backend ever returns slightly < 0.
  const pct = (x) => `${Math.max(0, Math.round(x * 100))}%`

  // Section 1 — "Most resembles" → "What this land looks like"
  // Top-3 nearest Dynamic World classes by AEF-weighted similarity. Plain
  // wording: "Most like: Trees (83% match)" instead of "Trees · cos 0.83".
  const nc = aef.nearestClass
  if (nc && Array.isArray(nc.matches) && nc.matches.length) {
    const top = nc.matches[0]
    const altList = nc.matches.slice(1, 3)
      .map(m => `<li>${escapeHTML(m.label)} <span class="${styles.popupAefSim}">${pct(m.similarity)} match</span></li>`)
      .join('')
    const alts = altList
      ? `<ul class="${styles.popupAefAltList}">${altList}</ul>`
      : ''
    sections.push(`
      <div class="${styles.popupAefRow}">
        <div class="${styles.popupAefRowLabel}">What this land looks like</div>
        <div class="${styles.popupAefMatch}">
          Most like: <strong>${escapeHTML(top.label)}</strong>
          <span class="${styles.popupAefSim}">${pct(top.similarity)} match</span>
        </div>
        ${alts}
        <div class="${styles.popupAefMuted}">
          AI compared this spot to thousands of nearby places within ${nc.bufferKm} km.
        </div>
      </div>
    `)
  }

  // Section 2 — "Land-use shift" → "How much this place changed"
  // Skip on no-disturbance clicks (awaiting_post sentinel) — there's no
  // event to compare around. Plain backend interpretation already; we
  // just relabel the section + tighten the year-range subtitle.
  const cm = aef.changeMagnitude
  if (cm && cm.magnitude !== 'awaiting_post') {
    const tier = cm.magnitude || 'unchanged'
    const tierClass = ({
      unchanged:    styles.popupAefMagUnchanged,
      subtle:       styles.popupAefMagSubtle,
      substantial:  styles.popupAefMagSubstantial,
      major:        styles.popupAefMagMajor,
      awaiting_post:styles.popupAefMagPending,
    })[tier] || styles.popupAefMagSubtle
    const yearLine = cm.preYear && cm.postYear
      ? `<div class="${styles.popupAefMuted}">Comparing ${cm.preYear} (before) to ${cm.postYear} (after).</div>`
      : ''
    sections.push(`
      <div class="${styles.popupAefRow}">
        <div class="${styles.popupAefRowLabel}">How much this place changed</div>
        <div class="${tierClass}">${escapeHTML(cm.interpretation)}</div>
        ${yearLine}
      </div>
    `)
  }

  // Section 3 + 5 merged — "How this place has changed". A plain verdict + a
  // diverging year-by-year bar chart: bars rise (green) when the land got
  // greener — growth/regrowth — and drop (brown) when it lost greenery —
  // clearing/fire/harvest. Driven by a signed Sentinel-2 NDVI series, so it
  // shows DIRECTION, not just magnitude (the old AlphaEarth-distance bars were
  // unsigned and couldn't tell growth from clearing). Falls back to the
  // unsigned AlphaEarth trajectory only if greenness is unavailable.
  const grn = Array.isArray(aef.greenness)
    ? aef.greenness.filter(p => p.ndvi != null && Number.isFinite(p.ndvi))
    : null
  if (grn && grn.length >= 2) {
    const hasDisturbance = !!(cm && cm.magnitude !== 'awaiting_post')
    const operaMarkerYear = hasDisturbance ? aef.operaYear : null
    // Signed year-over-year greenness change: + greener, − browner.
    const steps = grn.slice(1).map((p, i) => ({ year: p.year, delta: p.ndvi - grn[i].ndvi }))
    const big = steps.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), steps[0])
    const NOTABLE = 0.05   // NDVI step that reads as a real greenness change
    const verdict = greennessVerdictText(big, grn[0].year, opts)
    const highlightYear = (operaMarkerYear && steps.some(s => s.year === operaMarkerYear))
      ? operaMarkerYear
      : (Math.abs(big.delta) >= NOTABLE ? big.year : null)
    sections.push(`
      <div class="${styles.popupAefRow}">
        <div class="${styles.popupAefRowLabel}">How this place has changed</div>
        <div class="${styles.popupAefVerdict}">${escapeHTML(verdict)}</div>
        ${renderAefChangeBars(steps, highlightYear)}
        <div class="${styles.popupAefMuted}">Each bar is one year. <span style="color:#15803d">Up = greener (growth)</span>, <span style="color:#b45309">down = lost greenery (clearing, fire, drought, or a hard season)</span>. Taller = bigger change. From yearly Sentinel-2 greenness (NDVI).</div>
      </div>
    `)
  }

  // Section 4 — "Similar disturbances" → "Other nearby spots that look like this"
  // Top-2 inline, rest in "+ N more" <details>. Each row is clickable;
  // click delegates to the aef-fly handler which pans the map.
  const sim = aef.similarDisturbances
  if (sim && Array.isArray(sim.matches) && sim.matches.length) {
    const renderSimRow = (m) => {
      const dateStr = m.operaDate
        ? new Date(m.operaDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : '—'
      return `
        <li class="${styles.popupAefSimilarRow}">
          <button type="button" class="${styles.popupAefSimilarBtn}"
                  data-action="aef-fly" data-lat="${m.lat}" data-lng="${m.lng}">
            <span class="${styles.popupAefSimilarDate}">${escapeHTML(dateStr)}</span>
            <span class="${styles.popupAefSimilarCoord}">${m.lat.toFixed(3)}, ${m.lng.toFixed(3)}</span>
            <span class="${styles.popupAefSim}">${pct(m.similarity)} match</span>
          </button>
        </li>
      `
    }
    const VISIBLE = 2
    const top = sim.matches.slice(0, VISIBLE).map(renderSimRow).join('')
    const hidden = sim.matches.slice(VISIBLE)
    const expander = hidden.length
      ? `
        <details class="${styles.popupAefSimilarMore}">
          <summary>+ ${hidden.length} more</summary>
          <ul class="${styles.popupAefSimilarList}">${hidden.map(renderSimRow).join('')}</ul>
        </details>
      `
      : ''
    sections.push(`
      <div class="${styles.popupAefRow}">
        <div class="${styles.popupAefRowLabel}">Other nearby spots that look like this</div>
        <ul class="${styles.popupAefSimilarList}">${top}</ul>
        ${expander}
        <div class="${styles.popupAefMuted}">
          Within ${sim.radiusKm} km · click any row to fly the map there.
        </div>
      </div>
    `)
  }

  if (!sections.length) return ''
  // Section title in plain English. Methodology modal explains the AI
  // (Google's AlphaEarth Foundations) for users who want details.
  return `
    <details class="${styles.popupAef}" open>
      <summary class="${styles.popupAefTitle}">AI analysis of this place</summary>
      ${sections.join('')}
    </details>
  `
}

// Diverging year-by-year greenness bars. `steps` = [{year, delta}] of signed
// NDVI change. Bars rise from a center line (green) when the land got greener
// and drop (brown) when it lost greenery — so direction reads at a glance.
// Height = magnitude of that year's change. `highlightYear` is outlined.
function renderAefChangeBars(steps, highlightYear) {
  const bars = (steps || []).filter(s => s && Number.isFinite(s.delta))
  if (bars.length < 1) return ''
  // Floor the scale so a flat history shows small bars, not amplified noise.
  const maxAbs = Math.max(0.05, ...bars.map(b => Math.abs(b.delta)))
  const W = 320, H = 64, PAD_L = 6, PAD_R = 6, PAD_T = 8, PAD_B = 16, GAP = 3
  const n = bars.length
  const slot = (W - PAD_L - PAD_R) / n
  const bw = Math.max(5, slot - GAP)
  const half = (H - PAD_T - PAD_B) / 2     // half-height each side of center
  const midY = PAD_T + half                // zero line
  const cx = (i) => PAD_L + i * slot + slot / 2
  const GREEN = '#22c55e', BROWN = '#b45309'
  const rects = bars.map((b, i) => {
    const h = Math.max(1.5, (Math.abs(b.delta) / maxAbs) * half)
    const up = b.delta >= 0
    const yTop = up ? midY - h : midY
    const x = cx(i) - bw / 2
    const isHi = highlightYear && b.year === highlightYear
    const fill = up ? GREEN : BROWN
    const stroke = isHi ? ' stroke="#111827" stroke-width="1"' : ''
    return `<rect x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"${stroke} />`
  }).join('')
  const zeroLine = `<line x1="${PAD_L}" y1="${midY.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${midY.toFixed(1)}" stroke="#d1d5db" stroke-width="0.75" />`
  const labelStyle = 'font-size="10" fill="#6b7280" font-family="sans-serif"'
  const hiIdx = bars.findIndex(b => b.year === highlightYear)
  const labels = [
    `<text x="${cx(0).toFixed(1)}" y="${H - 3}" text-anchor="middle" ${labelStyle}>${bars[0].year}</text>`,
    `<text x="${cx(n - 1).toFixed(1)}" y="${H - 3}" text-anchor="middle" ${labelStyle}>${bars[n - 1].year}</text>`,
    (highlightYear && hiIdx > 0 && hiIdx < n - 1)
      ? `<text x="${cx(hiIdx).toFixed(1)}" y="${H - 3}" text-anchor="middle" font-size="10" fill="#111827" font-family="sans-serif">${highlightYear}</text>` : '',
  ].join('')
  return `
    <svg class="${styles.popupAefSparkline}" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none">
      ${zeroLine}${rects}${labels}
    </svg>
  `
}

// Assemble the compact, already-plain-English facts the AI summary endpoint
// synthesizes. Pulls from the raw streams (not the layer-gated locals) so the
// summary reflects everything we know regardless of which layers are toggled,
// and mirrors the popup's own phrasing — including the protected-area reframe
// of a guessed human cause — so the AI never contradicts what's on screen.
function assembleAiFacts({ data, context, extras, aef, pois, admin }) {
  const f = {}
  const ctx = context || {}
  const ex = extras || {}
  const d = data || {}

  // Location + protection. The protected-area line is the key reasoning hook:
  // it lets the model discount a guessed logging cause inside a no-cut area.
  if (admin) f.location = admin
  else if (pois && pois.length) f.location = pois[0]
  const protectedName = (pois || []).find((p) => NO_LOGGING_RE.test(p))
  if (protectedName) f.protectedArea = `${protectedName} — logging is not allowed here`

  // Land cover.
  const lc = d.landCover
  if (lc && lc.label) {
    const ag = AG_KEYWORDS.test(lc.label) ? ' (likely agricultural land, not forest)' : ''
    const src = lc.source ? ` [${lc.source}${lc.year ? ' ' + lc.year : ''}]` : ''
    f.landCover = `${lc.label}${ag}${src}`
  }

  // OPERA near-real-time disturbance.
  if (d.date) {
    const when = new Date(d.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    const bits = [`detected ${when}`]
    if (d.statusLabel) bits.push(d.statusLabel)
    if (d.severity != null) bits.push(`${Math.round(d.severity)}% vegetation loss`)
    f.opera = bits.join('; ')
  } else if (data) {
    f.opera = 'No active disturbance alert here'
  }

  // Our patch-shape cause guess — reframed to "likely natural" inside a
  // protected area, exactly as the popup shows it.
  const cause = ex.likelyCause || d.likelyCause
  if (cause && cause.label) {
    const lower = cause.label.toLowerCase()
    const humanCut = /harvest| cut|replanting|removal|management|clearing|agricultural activity|field activity|field operations|orchard|fallow|logging|corridor|construction|demolition|mechanical/.test(lower)
    f.causeGuess = (humanCut && protectedName)
      ? 'Likely natural disturbance (a human-cut cause is unlikely inside a protected area)'
      : cause.label
  }

  // Annual / radar / commodity context.
  const h = ctx.hansen || d.hansen
  if (h) {
    const loss = h.lossYear ? `forest loss in ${h.lossYear}` : 'no tree-cover loss recorded since 2001'
    const tc = (h.treeCover2000 != null) ? `; ${h.treeCover2000}% tree cover in 2000` : ''
    const gain = h.gain ? '; regrowth seen 2000-2012' : ''
    f.hansen = `${loss}${tc}${gain}`
  }
  const t = ctx.tmf || d.tmf
  if (t && t.label) {
    const yr = t.deforestationYear ? ` (${t.deforestationYear})` : (t.degradationYear ? ` (${t.degradationYear})` : '')
    f.tmf = `${t.label}${yr}`
  }
  const r = ctx.radd || d.radd
  if (r && r.date) {
    const when = new Date(r.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    f.radd = `${r.status === 'confirmed' ? 'confirmed' : 'unconfirmed'} radar alert, ${when}`
  }
  const com = ctx.commodityCrop || d.commodityCrop
  if (com && com.summary) f.commodity = com.summary

  // Greenery trend — same biggest-year-change verdict the diverging bars use.
  const grn = Array.isArray(aef && aef.greenness)
    ? aef.greenness.filter((p) => p && p.ndvi != null && Number.isFinite(p.ndvi))
    : null
  if (grn && grn.length >= 2) {
    const steps = grn.slice(1).map((p, i) => ({ year: p.year, delta: p.ndvi - grn[i].ndvi }))
    const big = steps.reduce((a, b) => (Math.abs(b.delta) > Math.abs(a.delta) ? b : a), steps[0])
    // Same verdict the popup shows — including the protected-area / no-OPERA
    // reframe — so the AI never gets a fact that contradicts the bars on screen.
    f.greenness = greennessVerdictText(big, grn[0].year, { protectedName, operaDetected: !!d.date })
  }

  return f
}

// Click-gated AI summary block: idle → a button, loading → spinner, done → the
// plain-language paragraph, error → a short message + retry. The button/retry
// carry data-action hooks wired by a document-level delegation listener (popup
// HTML is plain strings, so there's no React onClick to attach).
function renderAiSection(ai) {
  const a = ai || { status: 'idle' }
  if (a.status === 'loading') {
    return `
      <div class="${styles.popupAi}">
        <div class="${styles.popupAiLoading}"><span class="${styles.popupSpinner}"></span>Writing a plain-language summary…</div>
      </div>`
  }
  if (a.status === 'done' && a.text) {
    return `
      <div class="${styles.popupAi}">
        <div class="${styles.popupAiLabel}">✨ Plain-language summary</div>
        <div class="${styles.popupAiText}">${escapeHTML(a.text)}</div>
        <div class="${styles.popupAiFoot}">Auto-generated from the data above - double-check anything important</div>
      </div>`
  }
  if (a.status === 'error') {
    return `
      <div class="${styles.popupAi}">
        <div class="${styles.popupAiErr}">${escapeHTML(a.text || 'Couldn’t write a summary just now.')}</div>
        <button type="button" class="${styles.popupAiBtn}" data-action="ai-summary">Try again</button>
      </div>`
  }
  return `<button type="button" class="${styles.popupAiBtn}" data-action="ai-summary">✨ Explain this spot in plain language</button>`
}

function renderPopupHTML(data, pois, admin, pendingItems = '', ai = null) {
  const prettyDate = data.date
    ? new Date(data.date).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : null
  const severityStr = data.severity != null
    ? `${Math.round(data.severity)}% vegetation loss`
    : null

  // Patch size + burn live in the "extras" payload — render them as soon as
  // they arrive, otherwise show a small placeholder. Round acres generously
  // (whole-number with thousands separators) — sub-acre precision is noise
  // given the 30 m OPERA pixel grid.
  // Patch size arrives in the `extras` payload. Round acres generously
  // (whole-number with thousands separators) — sub-acre precision is noise
  // given the 30 m OPERA pixel grid. The "still loading" affordance is handled
  // by one clear pending block below, not a spinner buried on this line.
  let patchLine = ''
  if (data.acres != null) {
    let acresStr
    if (data.acres < 0.01) acresStr = '< 0.01 acres'
    else if (data.acres < 10) acresStr = `${data.acres.toFixed(1)} acres`
    else acresStr = `${Math.round(data.acres).toLocaleString()} acres`
    const truncatedNote = data.truncated
      ? '<span class="' + styles.truncatedNote + '">(extends beyond 5 km search radius)</span>'
      : ''
    patchLine = `<div class="${styles.popupMuted}">${acresStr} in this patch ${truncatedNote}</div>`
  }

  // Combine the status + severity into one compact line. Both are core fields
  // (arrive with the first response), so this shows immediately.
  const statusBits = []
  if (data.statusLabel) statusBits.push(escapeHTML(data.statusLabel))
  if (severityStr) statusBits.push(severityStr)
  const statusLine = statusBits.length
    ? `<div class="${styles.popupMuted}">${statusBits.join(' · ')}</div>`
    : ''

  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupHeader}">Disturbance detected ${prettyDate}</div>
      ${renderLocationLines(pois, admin)}
      ${renderLandCover(data.landCover)}
      ${statusLine}
      ${pendingItems ? renderExtrasPending(pendingItems) : ''}
      ${renderNamedFires(data.namedFires, data.date)}
      ${renderLikelyCause(data.likelyCause, (pois || []).find(p => NO_LOGGING_RE.test(p)) || null)}
      ${renderForestLayers(data)}
      ${renderCommodity(data.commodityCrop)}
      ${renderBurn(data.burn, data.date)}
      ${patchLine}
      ${renderAef(data.aef, { protectedName: (pois || []).find(p => NO_LOGGING_RE.test(p)) || null, operaDetected: !!data.date })}
      ${renderAiSection(ai)}
      ${renderMethodologyLink()}
      ${renderNewsBlock(data.likelyCause, data, admin)}
    </div>
  `
}

// Step 1 of the "analyze this spot" tool (shown when NO datasets are selected):
// a fast cross-dataset snapshot from the core + context streams — location,
// current disturbance status, land cover, forest-change (RADD/Hansen/TMF), and
// commodity — plus a button that launches the deeper analysis (AlphaEarth
// greenness bars, fire history, likely cause, patch size, lookalikes).
function renderOverviewPopupHTML(pois, admin, data, context, contextPending) {
  const c = context || {}
  const distLine = data.date
    ? `<div class="${styles.popupMuted}">⚠️ Disturbance detected ${new Date(data.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>`
    : `<div class="${styles.popupMuted}">No active disturbance alert flagged here.</div>`
  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupHeader}">Quick look</div>
      ${renderLocationLines(pois, admin)}
      ${renderLandCover(data.landCover)}
      ${distLine}
      ${renderForestLayers({ radd: c.radd, hansen: c.hansen, tmf: c.tmf })}
      ${renderCommodity(c.commodityCrop || null, false)}
      ${contextPending ? renderExtrasPending('forest-change & commodity context') : ''}
      <button type="button" class="${styles.popupDeepen}" data-action="deepen">🔍 Deeper analysis — all datasets</button>
      ${renderMethodologyLink()}
    </div>
  `
}

// Neutral "what's at this point" card shown when the Vegetation disturbance
// layer is OFF — so the popup mirrors the map instead of always leading with
// disturbance framing. Carries location + land cover, plus the commodity block
// when the Crops layer is on. If neither layer adds context it's just location.
function renderLocationPopupHTML(pois, admin, landCover, commodity, forest, pendingItems = '', ai = null) {
  const hasForest = forest && (forest.radd || forest.hansen || forest.tmf)
  const heading = (commodity || hasForest || pendingItems) ? 'What grows here' : 'This location'
  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupHeader}">${heading}</div>
      ${renderLocationLines(pois, admin)}
      ${renderLandCover(landCover)}
      ${pendingItems ? renderExtrasPending(pendingItems) : ''}
      ${renderForestLayers(forest)}
      ${renderCommodity(commodity, false)}
      ${renderAiSection(ai)}
      ${renderMethodologyLink()}
    </div>
  `
}

function renderEmptyPopupHTML(pois, admin, landCover, namedFires, aef, commodity, forest, pendingItems = '', ai = null) {
  const fireBlock = renderNamedFires(namedFires, null)
  const blurb = (namedFires && namedFires.length)
    ? `<div class="${styles.popupMuted}">OPERA isn't currently flagging change here, but this area is inside a known fire perimeter:</div>`
    : `<div class="${styles.popupMuted}">OPERA DIST-ALERT hasn't flagged this pixel since 2023.</div>`
  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupHeader}">No current disturbance here</div>
      ${renderLocationLines(pois, admin)}
      ${renderLandCover(landCover)}
      ${blurb}
      ${pendingItems ? renderExtrasPending(pendingItems) : ''}
      ${renderForestLayers(forest)}
      ${renderCommodity(commodity, false)}
      ${(namedFires && namedFires.length) ? fireBlock : ''}
      ${renderAef(aef, { protectedName: (pois || []).find(p => NO_LOGGING_RE.test(p)) || null, operaDetected: false })}
      ${renderAiSection(ai)}
      ${renderMethodologyLink()}
    </div>
  `
}

// Interim state shown while we wait for the slow OPERA cloud-function call.
// Geocoders typically resolve first, so the location appears immediately and
// only the disturbance line stays in the "looking up" state.
function renderLoadingPopupHTML(pois, admin) {
  const hasLocation = (pois && pois.length) || admin
  return `
    <div class="${styles.popupBody}">
      <div class="${styles.popupLoadingHeader}">
        <span class="${styles.popupSpinner}"></span>Looking up disturbance…
      </div>
      ${hasLocation ? renderLocationLines(pois, admin) : ''}
      ${renderMethodologyLink()}
    </div>
  `
}

function renderMethodologyLink() {
  return `<button type="button" class="${styles.popupMethodology}" data-action="show-methodology">ⓘ How this is sourced</button>`
}

// "Still gathering" block shown while the slow `extras` payload is in flight.
// `items` is a short, comma-free list of what's still loading so the user knows
// more is coming below (and isn't surprised when it pops in).
function renderExtrasPending(items) {
  return `
    <div class="${styles.popupPending}">
      <span class="${styles.popupSpinner}"></span>
      <span class="${styles.popupPendingText}">
        <strong>Still gathering details…</strong>
        <span class="${styles.popupPendingItems}">${escapeHTML(items)}</span>
      </span>
    </div>
  `
}

// Mapbox Geocoding v6 — hierarchical reverse lookup. Includes `district`
// (county-level in US, équivalents elsewhere) so popups get more local
// context than just "New York, United States". v6 always returns the
// nearest containing/closest feature at each level, so deep-forest clicks
// still get a region/country line; populated clicks add town + county.
async function reverseGeocode(lat, lng) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return null
  const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}` +
    `&types=country,region,district,place&access_token=${token}`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = await res.json()
  const byType = {}
  for (const f of data.features || []) {
    const t = f.properties?.feature_type
    const name = f.properties?.name
    if (t && name && !byType[t]) byType[t] = name
  }
  const parts = ['place', 'district', 'region', 'country']
    .map((t) => byType[t])
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

// Google Geocoding API — pulls named "natural features" (mountain ranges,
// regions, watersheds) that Mapbox's tilesets generally don't have.
//
// Proxied through the cloud function (?natfeat=1) so the key lives entirely
// server-side. Two wins from the proxy: (1) the key can't be lifted from
// the bundle, (2) the Google Geocoding REST API refuses HTTP-referrer-
// restricted keys, so a browser-side call requires a key with weaker
// restrictions — server-to-server has no referrer at all.
async function findNaturalFeatures(lat, lng) {
  try {
    const res = await fetch(`${TILES_API_BASE}?natfeat=1&lat=${lat}&lng=${lng}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.features || []
  } catch (e) {
    return []
  }
}

// Mapbox Tilequery against streets-v8 — finds named protected areas (national
// parks, forests, wilderness, monuments — all class=national_park) at a point.
// Returns up to 2 unique names ordered as Mapbox stores them in the tileset.
async function findProtectedAreas(lat, lng) {
  const token = import.meta.env.VITE_MAPBOX_TOKEN
  if (!token) return []
  const url = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json` +
    `?radius=500&limit=10&layers=landuse_overlay&access_token=${token}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  const names = []
  for (const f of data.features || []) {
    const p = f.properties || {}
    if (p.class === 'national_park' && p.name && !names.includes(p.name)) {
      names.push(p.name)
      if (names.length >= 2) break
    }
  }
  return names
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])
}

