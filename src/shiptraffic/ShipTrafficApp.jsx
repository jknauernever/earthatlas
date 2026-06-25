/**
 * EarthAtlas ShipTraffic — Salish Sea vessel traffic vs. whale presence at
 * /shiptraffic.
 *
 * Three layers:
 *   - Vessels (yellow) : real MarineCadastre AIS vessel tracks, baked to our own
 *                        PMTiles (Salish Sea, by class + month) and served as MVT
 *                        by /api/vessel-tiles; filtered by vessel type + month.
 *   - Whales (magenta) : real iNaturalist + OBIS cetacean sightings as points.
 *   - Concern (heatmap): the computed ship×whale overlap surface — a red→white-hot
 *                        alarm heatmap, from a coarse grid aggregated client-side.
 * A month/year range drives all three. Vessel type + whale source filters apply
 * across the matching layers.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import {
  loadGrid,
  loadWhales,
  aggregate,
  buildConcernPointsViewport,
  buildWhaleGeoJSON,
  monthRangeIndices,
  fmtMonth,
  interactionBand,
  VESSEL_LINE_COLOR,
  WHALE_POINT_COLOR,
  CONCERN_HEATMAP_RAMP,
  VESSEL_TYPE_LABELS,
  WHALE_SOURCE_LABELS,
  WHALE_SOURCE_URLS,
} from './shiptrafficData.js'
import trackSource from './trackSource.json'
import styles from './ShipTrafficApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const DEFAULT_VIEW = { center: [-123.0, 48.45], zoom: 8.4 }

// Vessel tracks: our own PMTiles of real MarineCadastre AIS, served as MVT by
// /api/vessel-tiles (which range-reads the .pmtiles; see that file for why we
// don't use Mapbox's native pmtiles:// under Vite). Each tile feature is a real
// track tagged with `class` (one of our 7 types); the type chips filter it
// client-side.
//
// A "tileset" id is a month ("2025-07"), a year ("2025"), or "all". We pick the
// smallest set of sources that covers the selected range:
//   single month  -> that month's tileset (1 source)
//   a full year   -> the year aggregate   (1 source, true all-12-months)
//   everything    -> the "all" aggregate  (1 source, all 24 months)
//   partial span  -> per-month, capped + sampled (the rare shift-click case)
// Year/all are density-capped aggregates (~200-430 KB/tile) so the big views load
// in ONE light source — a single un-capped combined file produced ~16 MB tiles
// that hung the Mapbox worker.
//
// The tiles URL MUST be absolute: Mapbox resolves a root-relative tile URL against
// the Mapbox API base (not the page), so it silently never loads.
// VITE_VESSEL_TILES_BASE lets plain-vite QA point at a standalone tile server.
const VESSEL_TILES_BASE = (import.meta.env.VITE_VESSEL_TILES_BASE
  || (typeof window !== 'undefined' ? window.location.origin : '')).trim()
const vesselTileUrl = (id) =>
  `${VESSEL_TILES_BASE}/api/vessel-tiles?t=${id}&v=${trackSource.version}&z={z}&x={x}&y={y}`
const vesselSrcId = (id) => `ves-${id}`
const vesselLayerId = (id) => `ves-${id}-line`
const VESSEL_TILE_MAXZOOM = 10 // matches the tippecanoe bake; Mapbox over-zooms past this
const SALISH_BBOX = [-123.8, 47.85, -122.2, 49.0] // source bounds → no tile requests outside the region
const VESSEL_ATTRIBUTION = 'Vessel tracks: MarineCadastre AIS (NOAA / BOEM / USCG)'

// Only the rare arbitrary partial span stacks per-month sources; cap how many at
// once (sampled evenly — tracks vary little month to month) to bound tile weight.
const VESSEL_MONTH_CAP = 6

// Evenly sample `cap` items (keeping first + last) from a list.
function sampleEvenly(arr, cap) {
  if (arr.length <= cap) return arr.slice()
  const out = []
  const step = (arr.length - 1) / (cap - 1)
  for (let i = 0; i < cap; i++) out.push(arr[Math.round(i * step)])
  return [...new Set(out)]
}

// The minimal set of tileset ids covering months[a..b]: one aggregate for a full
// year or "all", a single month, else per-month (capped) for a partial span.
function tilesetsForRange(months, a, b) {
  if (!months.length) return []
  const selected = months.slice(a, b + 1)
  if (selected.length === months.length) return ['all']
  const years = [...new Set(selected.map((m) => m.slice(0, 4)))]
  if (years.length === 1 && selected.length === months.filter((m) => m.startsWith(years[0])).length) {
    return [years[0]] // exactly one full calendar year
  }
  if (selected.length === 1) return [selected[0]]
  return sampleEvenly(selected, VESSEL_MONTH_CAP)
}

const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

const VESSEL_TYPES = Object.keys(VESSEL_TYPE_LABELS)
const WHALE_SOURCES = Object.keys(WHALE_SOURCE_LABELS)

const WHALE_LAYER = 'st-whale-pts'
const WHALE_SRC = 'st-whale-src'
const CONCERN_LAYER = 'st-concern-heat'
const CONCERN_SRC = 'st-concern-src'

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ─── Shareable URL state ────────────────────────────────────────────────────
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const list = (k) => {
    const v = sp.get(k)
    return v == null ? null : v.split(',').filter(Boolean)
  }
  return {
    ts: num('ts'), te: num('te'),
    ly: list('ly'), vt: list('vt'), ws: list('ws'),
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

const LAYER_CODE = { vessels: 'v', whales: 'w', concern: 'c' }
const CODE_LAYER = { v: 'vessels', w: 'whales', c: 'concern' }
const LAYER_ORDER = ['vessels', 'whales', 'concern']

export default function ShipTrafficApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const aggRef = useRef(null)            // latest aggregation, for the moveend concern rebuild
  const cellMetaRef = useRef(null)       // grid cell {lngStep, latStep}, for click hit-testing
  const vesselSrcRef = useRef(new Set()) // active per-month vessel source ids
  const [mapReady, setMapReady] = useState(false)

  const initial = (typeof window !== 'undefined') ? readUrlState() : {}
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null

  const [grid, setGrid] = useState(null)
  const [whales, setWhales] = useState(null)
  const [loadErr, setLoadErr] = useState(null)
  const months = grid?.meta?.months || whales?.meta?.months || []

  const [visible, setVisible] = useState(() => {
    if (initial.ly) {
      const set = new Set(initial.ly.map((c) => CODE_LAYER[c]).filter(Boolean))
      return { vessels: set.has('vessels'), whales: set.has('whales'), concern: set.has('concern') }
    }
    return { vessels: true, whales: true, concern: true }
  })

  const [vesselTypes, setVesselTypes] = useState(() => new Set(initial.vt?.length ? initial.vt.filter((t) => VESSEL_TYPES.includes(t)) : VESSEL_TYPES))
  const [whaleSources, setWhaleSources] = useState(() => new Set(initial.ws?.length ? initial.ws.filter((s) => WHALE_SOURCES.includes(s)) : WHALE_SOURCES))
  const [range, setRange] = useState(null)

  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [showMethodology, setShowMethodology] = useState(false)
  const [mapView, setMapView] = useState(initialCamera)
  const suppressFlyRef = useRef(!!initialCamera)

  // ─── Load both data files once ────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()
    Promise.all([loadGrid(ac.signal), loadWhales(ac.signal)])
      .then(([g, w]) => {
        if (ac.signal.aborted) return
        setGrid(g)
        setWhales(w)
        cellMetaRef.current = g.meta.cell
        const m = g.meta.months
        const [a, b] = (Number.isFinite(initial.ts) && Number.isFinite(initial.te))
          ? monthRangeIndices(m, m[initial.ts], m[initial.te])
          : [0, m.length - 1]
        setRange([a, b])
      })
      .catch((err) => {
        if (ac.signal.aborted || err.name === 'AbortError') return
        setLoadErr('Could not load the ship-traffic data.')
      })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Aggregate concern grid over the window + filters ─────────────────────
  const agg = useMemo(() => {
    if (!grid || !range) return null
    return aggregate(grid, { months, startIdx: range[0], endIdx: range[1], vesselTypes, whaleSources })
  }, [grid, range, vesselTypes, whaleSources, months])

  const whaleGeo = useMemo(() => {
    if (!whales || !range) return null
    return buildWhaleGeoJSON(whales, range[0], range[1], whaleSources, WHALE_SOURCES)
  }, [whales, range, whaleSources])

  // Which vessel tilesets to show (usually one aggregate; per-month for spans).
  const vesselTilesets = useMemo(() => {
    if (!range || !months.length) return []
    return tilesetsForRange(months, range[0], range[1])
  }, [range, months])


  // Rebuild the concern heatmap normalized to the current viewport.
  const pushConcern = useCallback((map) => {
    if (!map || !aggRef.current) return
    const src = map.getSource(CONCERN_SRC)
    if (!src) return
    const b = map.getBounds()
    const bounds = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }
    src.setData(buildConcernPointsViewport(aggRef.current.cells, bounds))
  }, [])

  // Find the aggregated grid cell containing a clicked lng/lat (whale-bearing
  // cells only — that's what the grid stores). Returns the cell with its
  // vessel + whale breakdown, or null.
  const findCellAt = useCallback((lngLat) => {
    const cells = aggRef.current?.cells
    const meta = cellMetaRef.current
    if (!cells || !meta) return null
    const hx = meta.lngStep / 2
    const hy = meta.latStep / 2
    for (const c of cells) {
      if (Math.abs(lngLat.lng - c.lng) <= hx && Math.abs(lngLat.lat - c.lat) <= hy) return c
    }
    return null
  }, [])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const start = initialCamera
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: start ? [start.lng, start.lat] : DEFAULT_VIEW.center,
      zoom: start ? start.zoom : DEFAULT_VIEW.zoom,
    })
    mapRef.current = map
    // Swallow vessel tile/source errors so a single failed tile degrades
    // gracefully instead of becoming an uncaught global that spams Sentry. Real
    // config errors still surface in the console.
    map.on('error', (e) => {
      const msg = e?.error?.message || ''
      if (e?.sourceId?.startsWith('ves-') || /Unimplemented type|tile/i.test(msg)) return
      // eslint-disable-next-line no-console
      console.warn('[shiptraffic] map error', e?.error || e)
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
      pushConcern(map) // re-normalize concern colors to the new viewport
    })

    const vesselLayerIds = () => [...vesselSrcRef.current]
      .map((sid) => `${sid}-line`).filter((id) => map.getLayer(id))

    // One click handler for the whole map: a concern cell gives the full area
    // readout (vessels + whales + overlap, with sources); else a whale point or
    // a vessel track gives its own detail.
    map.on('click', (e) => {
      const whaleHit = map.getLayer(WHALE_LAYER) ? map.queryRenderedFeatures(e.point, { layers: [WHALE_LAYER] })[0] : null
      const cell = findCellAt(e.lngLat)
      let html = null
      if (cell) html = cellPopupHTML(cell, whaleHit?.properties)
      else if (whaleHit) html = whalePopupHTML(whaleHit.properties)
      else {
        const vids = vesselLayerIds()
        const vHit = vids.length ? map.queryRenderedFeatures(e.point, { layers: vids })[0] : null
        if (vHit) html = vesselPopupHTML(vHit.properties)
      }
      if (!html) return
      popupRef.current?.remove()
      popupRef.current = new mapboxgl.Popup({ offset: 8, maxWidth: '280px' }).setLngLat(e.lngLat).setHTML(html).addTo(map)
    })

    // Pointer cursor over anything clickable.
    map.on('mousemove', (e) => {
      const overFeature = map.queryRenderedFeatures(e.point, { layers: [WHALE_LAYER, ...vesselLayerIds()].filter((id) => map.getLayer(id)) }).length > 0
      map.getCanvas().style.cursor = (overFeature || findCellAt(e.lngLat)) ? 'pointer' : ''
    })

    const addStaticLayers = () => {
      // Vessel tracks are per-month sources added dynamically (below) so only the
      // months in view load; here we just set up concern + whales above them.
      // Concern heatmap (below whale points).
      if (!map.getSource(CONCERN_SRC)) {
        map.addSource(CONCERN_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: CONCERN_LAYER,
          type: 'heatmap',
          source: CONCERN_SRC,
          paint: {
            // weight is the normalized overlap index (0..1); a slight power curve
            // lifts mid-range concern so it's visible, not just the very top cells.
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0.05, 0.3, 0.45, 1, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 1.1, 12, 2.6],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...CONCERN_HEATMAP_RAMP],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 6, 14, 9, 26, 13, 48],
            'heatmap-opacity': 0.9,
          },
        })
      }
      // Whale points (top).
      if (!map.getSource(WHALE_SRC)) {
        map.addSource(WHALE_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: WHALE_LAYER,
          type: 'circle',
          source: WHALE_SRC,
          paint: {
            // Grow markers as you zoom in so sightings are easy to pick out up close.
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 2, 9, 3.5, 11, 6, 13, 9, 16, 14],
            'circle-color': WHALE_POINT_COLOR,
            'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.65, 12, 0.8],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 13, 1],
            'circle-stroke-color': 'rgba(255,255,255,0.5)',
          },
        })
      }
      setMapReady(true)
    }

    map.on('style.load', () => addStaticLayers())
    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Sync vessel sources (one aggregate, or stacked months for a span) ─────
  // Adds one vector source+layer per id in `vesselTilesets`, removes stale ones,
  // and applies the vessel-type filter + visibility. Keyed on mapReady so it
  // re-applies after a basemap swap (which drops all sources/layers).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer(CONCERN_LAYER)) return
    const types = VESSEL_TYPES.filter((t) => vesselTypes.has(t))
    const typeFilter = ['in', ['get', 'class'], ['literal', types]]
    const show = visible.vessels
    // Stacked sources overlap; dim each so heavily-trafficked lanes build up
    // brightness instead of saturating (a single aggregate stays at full 0.7).
    const opacity = show ? Math.max(0.4, 0.7 / Math.sqrt(Math.max(1, vesselTilesets.length))) : 0
    const wanted = new Set(vesselTilesets.map(vesselSrcId))

    // Remove tilesets no longer in view.
    for (const sid of [...vesselSrcRef.current]) {
      if (wanted.has(sid)) continue
      const lid = `${sid}-line`
      if (map.getLayer(lid)) map.removeLayer(lid)
      if (map.getSource(sid)) map.removeSource(sid)
      vesselSrcRef.current.delete(sid)
    }
    // Add new tilesets + refresh filter/visibility on all.
    for (const id of vesselTilesets) {
      const sid = vesselSrcId(id)
      const lid = vesselLayerId(id)
      if (!map.getSource(sid)) {
        map.addSource(sid, {
          type: 'vector',
          tiles: [vesselTileUrl(id)],
          minzoom: 5,
          maxzoom: VESSEL_TILE_MAXZOOM,
          bounds: SALISH_BBOX,
          attribution: VESSEL_ATTRIBUTION,
        })
        map.addLayer({
          id: lid,
          type: 'line',
          source: sid,
          'source-layer': trackSource.sourceLayer,
          layout: { 'line-join': 'round' },
          paint: {
            'line-color': VESSEL_LINE_COLOR,
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.35, 10, 0.8, 14, 1.5],
            'line-blur': 0.6,
          },
        }, CONCERN_LAYER) // keep vessels beneath concern + whales
        vesselSrcRef.current.add(sid)
      }
      if (map.getLayer(lid)) {
        map.setFilter(lid, typeFilter)
        map.setLayoutProperty(lid, 'visibility', show ? 'visible' : 'none')
        map.setPaintProperty(lid, 'line-opacity', opacity)
      }
    }
  }, [vesselTilesets, vesselTypes, visible.vessels, mapReady])

  // ─── Push concern (viewport-normalized) + whale data ──────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !agg || !grid) return
    aggRef.current = agg
    pushConcern(map)
    if (map.getLayer(CONCERN_LAYER)) map.setLayoutProperty(CONCERN_LAYER, 'visibility', visible.concern ? 'visible' : 'none')
  }, [agg, grid, visible.concern, mapReady, pushConcern])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !whaleGeo) return
    map.getSource(WHALE_SRC)?.setData(whaleGeo)
    if (map.getLayer(WHALE_LAYER)) map.setLayoutProperty(WHALE_LAYER, 'visibility', visible.whales ? 'visible' : 'none')
  }, [whaleGeo, visible.whales, mapReady])

  // ─── Persist URL ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!grid || !range) return
    const sp = new URLSearchParams()
    if (range[0] !== 0) sp.set('ts', String(range[0]))
    if (range[1] !== months.length - 1) sp.set('te', String(range[1]))
    const ly = LAYER_ORDER.filter((l) => visible[l]).map((l) => LAYER_CODE[l])
    if (ly.length !== 3) sp.set('ly', ly.join(','))
    if (vesselTypes.size !== VESSEL_TYPES.length) sp.set('vt', VESSEL_TYPES.filter((t) => vesselTypes.has(t)).join(','))
    if (whaleSources.size !== WHALE_SOURCES.length) sp.set('ws', WHALE_SOURCES.filter((s) => whaleSources.has(s)).join(','))
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
  }, [grid, range, visible, vesselTypes, whaleSources, basemap, mapView, months])

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    setMapReady(false)
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  useEffect(() => {
    const prevTitle = document.title
    document.title = 'Ship Traffic & Whales — Salish Sea · EarthAtlas'
    return () => { document.title = prevTitle }
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleSelect = useCallback((r) => {
    const map = mapRef.current
    if (!map || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
    map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(r.zoom || 10, 9), duration: 1200, essential: true })
  }, [])

  const toggleLayer = useCallback((layer) => setVisible((v) => ({ ...v, [layer]: !v[layer] })), [])

  const toggleSetMember = (setter, value, allValues) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next.size === 0 ? new Set(allValues) : next
    })
  }

  const applyYear = useCallback((year) => {
    if (!months.length) return
    if (year === 'all') { setRange([0, months.length - 1]); return }
    const idxs = months.map((m, i) => (m.startsWith(String(year)) ? i : -1)).filter((i) => i >= 0)
    if (idxs.length) setRange([idxs[0], idxs[idxs.length - 1]])
  }, [months])

  // Click a month → that single month. Shift-click → span from the current
  // anchor to the clicked month.
  const pickMonth = useCallback((idx, shift) => {
    setRange((prev) => (shift && prev ? [Math.min(prev[0], idx), Math.max(prev[0], idx)] : [idx, idx]))
  }, [])

  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenError}>
          <strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.
        </div>
      </div>
    )
  }

  const startKey = range ? months[range[0]] : null
  const endKey = range ? months[range[1]] : null
  const whaleCount = whaleGeo?.features.length ?? 0
  const concernCount = agg ? agg.cells.filter((c) => c.iRaw > 0).length : 0
  const rngLen = range ? range[1] - range[0] + 1 : 0
  const isAll = !!range && range[0] === 0 && range[1] === months.length - 1
  const isYear = (y) => rngLen === 12 && startKey?.startsWith(String(y)) && endKey?.startsWith(String(y))
  const rangeLabel = !range ? ''
    : isAll ? 'All (2024–2025)'
    : rngLen === 1 ? fmtMonth(startKey)
    : isYear(2024) ? '2024' : isYear(2025) ? '2025'
    : `${fmtMonth(startKey)} – ${fmtMonth(endKey)}`

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>Ship Traffic × Whales</span>
      </div>

      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search a place in the Salish Sea…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handleSelect}
        />
      </div>

      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button
          className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)} aria-label="Choose basemap" title="Basemap"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button key={b.id} className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}>
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`${styles.panel} ${panelOpen ? '' : styles.panelCollapsed}`}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>Salish Sea</span>
          <button className={styles.panelCollapse} onClick={() => setPanelOpen((o) => !o)} aria-label={panelOpen ? 'Collapse' : 'Expand'}>
            {panelOpen ? '▾' : '▸'}
          </button>
        </div>

        {panelOpen && (
          <div className={styles.panelBody}>
            {loadErr && <div className={styles.statusError}>{loadErr}</div>}
            {!grid && !loadErr && <div className={styles.status}>Loading data…</div>}

            {grid && range && (
              <>
                {/* Timeframe */}
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Timeframe · <span className={styles.fieldHint}>{rangeLabel}</span></label>
                  <div className={styles.chipRow}>
                    <button className={isAll ? styles.chipActive : styles.chip} onClick={() => applyYear('all')}>All</button>
                    <button className={isYear(2024) ? styles.chipActive : styles.chip} onClick={() => applyYear(2024)}>2024</button>
                    <button className={isYear(2025) ? styles.chipActive : styles.chip} onClick={() => applyYear(2025)}>2025</button>
                  </div>
                  <MonthStrip months={months} range={range} onPick={pickMonth} />
                  <div className={styles.monthHint}>Click a month · shift-click for a span</div>
                </div>

                {/* Layers */}
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Layers</label>
                  <div className={styles.layerRows}>
                    <LayerRow on={visible.vessels} onToggle={() => toggleLayer('vessels')}
                      swatch="linear-gradient(90deg,#ca8a04,#eab308,#fde047)" label="Vessel traffic" sub="MarineCadastre AIS" />
                    <LayerRow on={visible.whales} onToggle={() => toggleLayer('whales')}
                      swatch="radial-gradient(circle,#f472b6,#db2777)" label="Whale sightings" count={whaleCount} />
                    <LayerRow on={visible.concern} onToggle={() => toggleLayer('concern')}
                      swatch="linear-gradient(90deg,#991b1b,#f97316,#fffbe6)" label="Concern (overlap)" count={concernCount} />
                  </div>
                </div>

                {/* Vessel type filter */}
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Vessel class</label>
                  <div className={styles.chipRow}>
                    {VESSEL_TYPES.map((t) => (
                      <button key={t} className={vesselTypes.has(t) ? styles.chipActive : styles.chip}
                        onClick={() => toggleSetMember(setVesselTypes, t, VESSEL_TYPES)}>{VESSEL_TYPE_LABELS[t]}</button>
                    ))}
                  </div>
                </div>

                {/* Whale source filter */}
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Whale source</label>
                  <div className={styles.chipRow}>
                    {WHALE_SOURCES.map((s) => {
                      const disabled = (grid.meta.whaleCounts?.[s] ?? 0) === 0 && s === 'happywhale'
                      return (
                        <button key={s} className={whaleSources.has(s) && !disabled ? styles.chipActive : styles.chip}
                          onClick={() => !disabled && toggleSetMember(setWhaleSources, s, WHALE_SOURCES)}
                          disabled={disabled} title={disabled ? 'No data yet (API not live)' : undefined}
                          style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>{WHALE_SOURCE_LABELS[s]}</button>
                      )
                    })}
                  </div>
                </div>

                <div className={styles.statGrid}>
                  <div className={styles.statBox}><span className={styles.statVal}>{whaleCount.toLocaleString()}</span><span className={styles.statKey}>whale sightings</span></div>
                  <div className={styles.statBox}><span className={styles.statVal}>{concernCount.toLocaleString()}</span><span className={styles.statKey}>concern cells</span></div>
                </div>

                <button type="button" className={styles.methodology} onClick={() => setShowMethodology(true)}>ⓘ How this is sourced</button>
                <div className={styles.builtBy}>
                  EarthAtlas is built by{' '}
                  <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={styles.builtByLink}>KnauerNever.com</a>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className={styles.tip}>Click anywhere for the area's vessel + whale data · yellow = tracks · magenta = whales · red glow = overlap</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} counts={grid?.meta?.whaleCounts} />}
    </div>
  )
}

const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

// Clickable month grid (one row per year). Click a cell → single month;
// shift-click → span from the current anchor. Active months are highlighted.
function MonthStrip({ months, range, onPick }) {
  const years = [...new Set(months.map((m) => m.slice(0, 4)))]
  return (
    <div className={styles.monthStrip}>
      {years.map((y) => (
        <div className={styles.monthRow} key={y}>
          <span className={styles.monthYear}>’{y.slice(2)}</span>
          {MONTH_LETTERS.map((L, mi) => {
            const idx = months.indexOf(`${y}-${String(mi + 1).padStart(2, '0')}`)
            if (idx < 0) return <span key={mi} className={styles.monthCellEmpty} />
            const active = range && idx >= range[0] && idx <= range[1]
            return (
              <button
                key={mi}
                className={active ? styles.monthCellActive : styles.monthCell}
                onClick={(e) => onPick(idx, e.shiftKey)}
                title={fmtMonth(months[idx])}
              >{L}</button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function LayerRow({ on, onToggle, swatch, label, count, sub }) {
  return (
    <button className={on ? styles.layerRowOn : styles.layerRow} onClick={onToggle}>
      <span className={styles.layerSwatch} style={{ background: swatch, opacity: on ? 1 : 0.3 }} />
      <span className={styles.layerLabel}>
        {label}
        {sub && <span className={styles.layerSub}>{sub}</span>}
      </span>
      {count != null && <span className={styles.layerCount}>{count.toLocaleString()}</span>}
      <span className={styles.layerCheck}>{on ? '●' : '○'}</span>
    </button>
  )
}

function whalePopupHTML(p) {
  const src = p.src
  const url = WHALE_SOURCE_URLS[src] || '#'
  const label = WHALE_SOURCE_LABELS[src] || src
  return (
    `<div class="${styles.popup}">` +
    `<div class="${styles.popupHead}">Whale sighting</div>` +
    `<div class="${styles.popupSpecies}">${escapeHtml(p.species || 'Cetacean')}</div>` +
    `<div class="${styles.popupMeta}">${escapeHtml(p.m || '')}</div>` +
    `<div class="${styles.popupSrc}">Source: <a href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></div>` +
    `</div>`
  )
}

// Rich "click a spot" readout for a concern grid cell: vessels + whales +
// overlap for the current timeframe/filters, each with its inline source.
function cellPopupHTML(cell, whaleProps) {
  const vSum = cell.vSum || 0
  const wSum = cell.wSum || 0
  const nI = cell.nI || 0  // 0..1 relative to the most-concerning cell in the region
  const band = interactionBand(nI)
  const wBySrc = cell.wBySrc || {}
  // Each present source as a linked name with its count, e.g. "iNaturalist (1) · OBIS (4)".
  const srcLinks = WHALE_SOURCES.filter((s) => wBySrc[s])
    .map((s) => `<a href="${WHALE_SOURCE_URLS[s]}" target="_blank" rel="noopener noreferrer">${WHALE_SOURCE_LABELS[s]}</a> (${wBySrc[s]})`)
    .join(' · ')
  return (
    `<div class="${styles.popup}">` +
    `<div class="${styles.popupHead}">This area · selected timeframe</div>` +
    (whaleProps ? `<div class="${styles.popupSpecies}">${escapeHtml(whaleProps.species || 'Cetacean')}</div>` : '') +
    `<div class="${styles.popupRow}"><span class="${styles.popupDotV}"></span><span class="${styles.popupK}">Vessel transits</span><span class="${styles.popupV}">${vSum.toLocaleString()}</span></div>` +
    `<div class="${styles.popupSrc}">Source: <a href="https://marinecadastre.gov/ais/" target="_blank" rel="noopener noreferrer">MarineCadastre AIS</a></div>` +
    `<div class="${styles.popupRow}"><span class="${styles.popupDotW}"></span><span class="${styles.popupK}">Whale sightings</span><span class="${styles.popupV}">${wSum.toLocaleString()}</span></div>` +
    `<div class="${styles.popupSrc}">Sources: ${srcLinks || `<a href="${WHALE_SOURCE_URLS.inat}" target="_blank" rel="noopener noreferrer">iNaturalist</a> · <a href="${WHALE_SOURCE_URLS.obis}" target="_blank" rel="noopener noreferrer">OBIS</a>`}</div>` +
    `<div class="${styles.popupIx} ${styles['popupIx_' + band.tone]}">${escapeHtml(band.label)} · ${Math.round(nI * 100)}/100</div>` +
    `<div class="${styles.popupFormula}">relative ship×whale overlap (0–100 across the region)</div>` +
    `</div>`
  )
}

function vesselPopupHTML(p) {
  const label = VESSEL_TYPE_LABELS[p.class] ?? 'Vessel'
  const meta = [p.month && fmtMonth(p.month), p.mmsi ? `MMSI ${p.mmsi}` : null].filter(Boolean).join(' · ')
  return (
    `<div class="${styles.popup}">` +
    `<div class="${styles.popupHead}">Vessel track</div>` +
    `<div class="${styles.popupSpecies}">${escapeHtml(label)}</div>` +
    (meta ? `<div class="${styles.popupMeta}">${escapeHtml(meta)}</div>` : '') +
    `<div class="${styles.popupSrc}">Source: <a href="https://marinecadastre.gov/ais/" target="_blank" rel="noopener noreferrer">MarineCadastre AIS</a> (NOAA / BOEM / USCG)</div>` +
    `</div>`
  )
}

function MethodologyModal({ onClose, counts }) {
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
            <strong>Yellow</strong> tracks are real vessel traffic; <strong>magenta</strong> dots are whale
            sightings; the <strong>red glow</strong> is where they overlap — the areas of concern. A month/year
            range drives all three.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Where the data comes from</h3>
          <ul>
            <li>
              <strong>Vessel traffic — MarineCadastre AIS.</strong> Real monthly AIS
              vessel tracks from{' '}
              <a href="https://marinecadastre.gov/ais/" target="_blank" rel="noopener noreferrer">NOAA MarineCadastre</a>{' '}
              (U.S. Coast Guard AIS), clipped to the Salish Sea and tiled by class and
              month, drawn straight from the raw tracks. AIS is published with a
              multi-month processing lag, so the timeframe ends at the latest
              available month.
            </li>
            <li>
              <strong>Whale sightings — real.</strong>{' '}
              <a href="https://www.inaturalist.org/" target="_blank" rel="noopener noreferrer">iNaturalist</a>{' '}
              (order Cetacea{counts?.inat ? `, ${counts.inat.toLocaleString()} obs` : ''}) and{' '}
              <a href="https://obis.org/" target="_blank" rel="noopener noreferrer">OBIS</a>
              {counts?.obis ? ` (${counts.obis.toLocaleString()})` : ''}, Jan 2024 – Jun 2025.{' '}
              <a href="https://happywhale.com/" target="_blank" rel="noopener noreferrer">Happywhale</a> joins
              when its public API ships.
            </li>
            <li>
              <strong>Concern heatmap.</strong> A coarse grid of local vessel density × whale presence,
              aggregated over your selected months and filters — a co-occurrence heuristic for exploration,
              <strong> not</strong> a validated ship-strike risk model.
            </li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>Caveats</h3>
          <p>
            Whale "presence" is observed-sighting density, biased toward where people and surveys go. Vessel
            tracks are shown for representative months across long ranges (they vary little month to month).
          </p>
        </section>
      </div>
    </div>
  )
}
