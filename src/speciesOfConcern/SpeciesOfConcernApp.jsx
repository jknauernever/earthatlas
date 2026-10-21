/**
 * EarthAtlas /species-of-concern: click a spot, see what agencies have mapped there (federal critical habitat, WDFW
 * Priority Habitats and Species) and every state- or federally-listed species reported within a chosen distance and
 * time. The lookup is /api/species-of-concern (lib/speciesOfConcern/lookup.js); its lists live in data/species-of-concern/.
 *
 * Layout as /ships, /whalewatch and /permits: the left panel holds the controls and the map layers (dataset rows with
 * their legends); the results live in the top-right pill's popover, and the picked item's card hangs under the pill.
 * Every map item has a hover readout (src/lib/mapHoverTip.js).
 *
 * Follows docs/MAP_TOOL_CONVENTIONS.md: URL state (camera, basemap, photos, point, radius, unit, window, lists off,
 * layers off, picked item), satellite default, shared zoom badge / share / place search / basemap menu, style.load
 * readiness, MapSheet on phones. Every status links to the list that sets it, every record to where it was reported.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { installPopupSheet } from '../lib/popupSheet.js'
import { installHoverTip } from '../lib/mapHoverTip.js'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import { fetchSpeciesOfConcern, KM_PER_MILE } from '../lib/speciesOfConcern.js'
import { STATUS_ORDER, NOT_CONFIRMED, BLURRED_ONLY, statusRank, groupRank } from '../../lib/speciesOfConcern/statusOrder.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import MapSheet from '../components/MapSheet.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import { BasemapMenu, ImageryLine, useMapPhotos, writePhoto } from '../components/basemap/index.js'
import { DatasetRow, LegendSwatchRow, LegendTurndown, SourcesFooter, LoadingInline } from '../components/panel/index.js'
import { SOC_SOURCES, SOC_SOURCES_INTRO, SOC_SOURCES_NOTES } from './socSources.js'
import SocPicker from './SocPicker.jsx'
import { SpeciesCard, AgencyCard } from './SocCard.jsx'
import { colorOf, DOT_LEGEND, REG_COLORS, shortStatus, SOURCE_NAMES, fmtDate, fmtKm, esc } from './socShared.js'
import q from '../quakes/QuakesApp.module.css'
import styles from './SpeciesOfConcernApp.module.css'

installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-120.6, 47.35], zoom: 6.2 }   // Washington State: the lists are Washington's
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

const WINDOWS = [['30d', '30 days'], ['1y', '1 year'], ['10y', '10 years'], ['all', 'All years']]
const WINDOW_WORDS = { '30d': 'last 30 days', '1y': 'past year', '10y': 'past 10 years', all: 'all years on record' }
const RADII = [1, 2, 5, 10, 25]
const MAX_KM = 50
const HABITAT_DRAW_KM = 10   // lib/speciesOfConcern/regulatory.js draws habitat outlines up to this radius

const LISTS = [
  { id: 'wa-state', label: 'Washington State' },
  { id: 'us-federal', label: 'Federal (ESA)' },
  { id: 'wa-plants', label: 'WA rare plants (DNR)' },
  { id: 'wa-sgcn', label: 'WA Greatest Conservation Need' },
  { id: 'wa-phs', label: 'WA Priority species (PHS)' },
]
const LIST_IDS = new Set(LISTS.map((l) => l.id))
// Map layers (left-panel dataset rows). Habitats start off: wetland outlines would bury everything else.
const LAYERS = ['sightings', 'critical-habitat', 'phs-species', 'phs-habitat']
const LAYERS_OFF_DEFAULT = ['phs-habitat']

// ─── Shareable URL state ────────────────────────────────────────────────────
//   bm, ph       basemap, photos           lat,lng,z   camera
//   p            the clicked point "lat,lng"
//   r, u         radius (default 5) and unit ('mi'; km by default)
//   w            window (default 1y)       lo          lists turned off, comma ids
//   ly           map layers on/off where they differ from the default ("+phs-habitat,-sightings")
//   sel          picked item: "sp:<scientific name>" or "reg:<id>"
function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  const p = (sp.get('p') || '').split(',').map(Number)
  const layersOff = new Set(LAYERS_OFF_DEFAULT)
  for (const t of (sp.get('ly') || '').split(',')) { const id = t.slice(1); if (!LAYERS.includes(id)) continue; t[0] === '+' ? layersOff.delete(id) : layersOff.add(id) }
  return {
    bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'),
    point: p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 ? { lat: p[0], lng: p[1] } : null,
    r: num('r'), u: sp.get('u'), w: sp.get('w'), lo: (sp.get('lo') || '').split(',').filter((id) => LIST_IDS.has(id)),
    layersOff, sel: sp.get('sel'), labels: sp.get('lb') === '1',
  }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

// A circle as a GeoJSON polygon (64 steps), for the radius ring.
function circle(lat, lng, km) {
  const coords = []
  const dLat = km / 110.574, dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]) }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}
const EMPTY = { type: 'FeatureCollection', features: [] }

// A point inside a polygon ring for its label: the bbox centre if it falls inside, else the middle of the widest
// horizontal run through the ring at that latitude (good enough for wetlands, bays and strait-shaped areas).
function insidePoint(ring) {
  let w = 180, s = 90, e = -180, n = -90
  for (const [x, y] of ring) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y }
  const y = (s + n) / 2
  const xs = []
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi))
  }
  xs.sort((a, b) => a - b)
  let best = null
  for (let k = 0; k + 1 < xs.length; k += 2) if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]]
  return { point: best ? [(best[0] + best[1]) / 2, y] : [(w + e) / 2, y], size: (e - w) * (n - s) }
}

function labelPoints(features) {
  const out = []
  for (const f of features) {
    if (f.geometry.type !== 'MultiPolygon') continue
    // label the larger pieces only (each tile of a big designation is its own piece)
    const pieces = f.geometry.coordinates.map((poly) => insidePoint(poly[0])).sort((a, b) => b.size - a.size)
    for (const p of pieces.slice(0, 3)) out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p.point }, properties: f.properties })
  }
  return out
}

function boundsOf(geoms) {
  let w = 180, s = 90, e = -180, n = -90
  const walk = (c) => { if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]) } else c.forEach(walk) }
  geoms.forEach((g) => walk(g.coordinates))
  return w <= e ? [[w, s], [e, n]] : null
}

export default function SpeciesOfConcernApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  const initial = useMemo(() => readUrlState(), [])
  const initialCamera = Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z)
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null

  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const photos = useMapPhotos(mapRef, { mapReady, basemap })
  const [mapView, setMapView] = useState(initialCamera)
  const [point, setPoint] = useState(initial.point)
  const [unit, setUnit] = useState(initial.u === 'mi' ? 'mi' : 'km')
  const [radius, setRadius] = useState(() => (initial.r > 0 ? initial.r : 5))
  const [win, setWin] = useState(() => (WINDOWS.some(([id]) => id === initial.w) ? initial.w : '1y'))
  const [listsOff, setListsOff] = useState(() => new Set(initial.lo))
  const [layersOff, setLayersOff] = useState(initial.layersOff)
  const [sel, setSel] = useState(initial.sel)
  const [labels, setLabels] = useState(initial.labels)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const radiusKm = Math.min(MAX_KM, unit === 'mi' ? radius * KM_PER_MILE : radius)

  // ─── Lookup ────────────────────────────────────────────────────────────────
  // A shared link keeps its picked item (its card shows); any later lookup clears the pick and opens the results box.
  const firstLookupRef = useRef(true)
  useEffect(() => {
    if (!point) { setData(null); setLoading(false); return }
    const ac = new AbortController()
    const first = firstLookupRef.current
    firstLookupRef.current = false
    setLoading(true); setError(null)
    if (!first) setSel(null)
    fetchSpeciesOfConcern({ lat: point.lat, lng: point.lng, radius: radiusKm, window: win, signal: ac.signal })
      .then((d) => { setData(d); if (!(first && initial.sel)) setPickerOpen(true) })
      .catch((e) => { if (e.name !== 'AbortError') setError('The lookup did not finish. Try again in a moment.') })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point, radiusKm, win])

  // Rows as the list filters see them: only statuses from lists that are on, grouped by the highest confirmed one.
  const rows = useMemo(() => {
    if (!data) return []
    return data.species.map((r) => {
      const statuses = r.statuses.filter((s) => !listsOff.has(s.list))
      if (!statuses.length) return null
      const confirmed = statuses.filter((s) => s.confirmed).sort((a, b) => statusRank(a.status) - statusRank(b.status))
      const group = !confirmed.length ? NOT_CONFIRMED : r.locations.exact > 0 ? confirmed[0].status : BLURRED_ONLY
      return { ...r, statuses, group, unconfirmed: statuses.filter((s) => !s.confirmed) }
    }).filter(Boolean).sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.common_name || a.scientific_name).localeCompare(b.common_name || b.scientific_name))
  }, [data, listsOff])
  const groups = useMemo(() => [...STATUS_ORDER, BLURRED_ONLY, NOT_CONFIRMED].filter((g) => rows.some((r) => r.group === g)), [rows])
  const exactCount = rows.filter((r) => r.group !== NOT_CONFIRMED && r.group !== BLURRED_ONLY).length
  const reg = data?.regulatory
  const regItems = useMemo(() => (reg ? [...reg.critical_habitat, ...reg.phs] : []), [reg])
  const picked = sel?.startsWith('sp:') ? rows.find((r) => `sp:${r.scientific_name}` === sel) : sel?.startsWith('reg:') ? regItems.find((it) => `reg:${it.id}` === sel) : null
  const pickedName = picked ? (picked.common_name || picked.name || picked.scientific_name) : null

  // ─── Map init (once) ──────────────────────────────────────────────────────
  const clickRef = useRef(null)
  const hoverRef = useRef(null)
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const start = initialCamera || (initial.point ? { lat: initial.point.lat, lng: initial.point.lng, zoom: 11 } : null)
    const map = new mapboxgl.Map({
      container: containerRef.current, style: basemapStyleFor(basemap),
      center: start ? [start.lng, start.lat] : DEFAULT_VIEW.center, zoom: start ? start.zoom : DEFAULT_VIEW.zoom,
      preserveDrawingBuffer: true,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('style.load', () => { addLayers(map); setMapReady(true) })
    map.on('click', (e) => clickRef.current?.(e))
    const offHover = installHoverTip(map, {
      layers: ['soc-records', 'reg-point', 'reg-line', 'reg-fill', 'soc-point'],
      html: (feats) => hoverRef.current?.(feats) || null,
    })
    return () => { offHover(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clicks: a sighting dot opens its species; a WDFW site (point/line) opens its entry; anywhere else moves the spot
  // (critical habitat covers whole straits, so its area is hover-only; pick it from the list).
  clickRef.current = (e) => {
    const map = mapRef.current
    const hit = map.queryRenderedFeatures(e.point, { layers: ['soc-records', 'reg-point', 'reg-line'].filter((l) => map.getLayer(l)) })[0]
    if (hit?.layer.id === 'soc-records') { setSel(`sp:${hit.properties.sci}`); setPickerOpen(false); return }
    if (hit) { setSel(`reg:${hit.properties.id}`); setPickerOpen(false); return }
    setPoint({ lat: Math.round(e.lngLat.lat * 1e4) / 1e4, lng: Math.round(e.lngLat.lng * 1e4) / 1e4 })
  }

  // Hover readouts: every map item says what it is, and a sighting says the animal's status.
  hoverRef.current = (feats) => {
    const dots = feats.filter((f) => f.layer.id === 'soc-records')
    if (dots.length) {
      const d = dots[0].properties
      const more = dots.length > 1 ? `<div class="${styles.tipDim}">+${dots.length - 1} more here</div>` : ''
      return `<div class="${styles.tip}">${d.thumb ? `<img class="${styles.tipThumb}" src="${esc(d.thumb)}" alt="">` : ''}<div class="${styles.tipTitle}">${esc(d.name)}</div>
        <div class="${styles.tipStatus}" style="--c:${d.color}">${esc(d.status)}</div>
        <div>${esc(fmtDate(d.date))} · ${esc(d.source)} · ${esc(d.distance)}${d.ecotype ? ` · ${esc(d.ecotype)}` : ''}</div>
        <div class="${styles.tipDim}">Click for its card</div>${more}</div>`
    }
    const spot = feats.find((f) => f.layer.id === 'soc-point')
    if (spot) return `<div class="${styles.tip}"><div class="${styles.tipTitle}">The spot</div><div>${point ? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)} · ` : ''}click elsewhere to move it</div></div>`
    const seen = new Set()
    const lines = []
    for (const f of feats) {
      const { id, layer, name, source } = f.properties
      if (seen.has(id)) continue
      seen.add(id)
      const kind = layer === 'critical-habitat' ? 'Federal critical habitat' : layer === 'phs-species' ? 'WDFW priority species' : 'WDFW priority habitat'
      lines.push(`<div><span class="${styles.tipSq}" style="background:${REG_COLORS[layer]}"></span><b>${esc(name)}</b> <span class="${styles.tipDim}">${kind}${source && layer !== 'critical-habitat' ? ` · ${esc(source)}` : ''}</span></div>`)
    }
    if (!lines.length) return null
    const clickable = feats.some((f) => f.layer.id !== 'reg-fill')
    return `<div class="${styles.tip}">${lines.slice(0, 6).join('')}${lines.length > 6 ? `<div class="${styles.tipDim}">+${lines.length - 6} more</div>` : ''}
      <div class="${styles.tipDim}">${clickable ? 'Click for its card' : 'Listed in the Species of concern box (top right)'}</div></div>`
  }

  // ─── Map layers ───────────────────────────────────────────────────────────
  function addLayers(map) {
    if (map.getSource('soc-area')) return
    for (const id of ['soc-area', 'soc-point', 'soc-records', 'soc-reg', 'soc-reg-labels']) map.addSource(id, { type: 'geojson', data: EMPTY })
    const regPaint = ['match', ['get', 'layer'], 'critical-habitat', REG_COLORS['critical-habitat'], 'phs-species', REG_COLORS['phs-species'], REG_COLORS['phs-habitat']]
    const isPoly = ['in', ['geometry-type'], ['literal', ['Polygon', 'MultiPolygon']]]
    // the picked item: drawn on top, stronger; the rest fade (properties, not feature-state: setData clears that)
    const hot = ['boolean', ['get', 'hot'], false]
    const dim = ['boolean', ['get', 'dim'], false]
    const byLayer = (ch, species, habitat) => ['match', ['get', 'layer'], 'critical-habitat', ch, 'phs-species', species, habitat]
    map.addLayer({ id: 'reg-fill', type: 'fill', source: 'soc-reg', filter: isPoly,
      paint: { 'fill-color': regPaint, 'fill-opacity': ['case', hot, 0.5, dim, 0.05, byLayer(0.1, 0.2, 0.26)] } })
    // a dark casing under every outline, so edges read on bright fields and dark water alike
    const isOutline = ['==', ['get', 'outline'], true]
    map.addLayer({ id: 'reg-casing', type: 'line', source: 'soc-reg', filter: isOutline,
      paint: { 'line-color': '#0a0e17', 'line-width': ['case', hot, 7, byLayer(3, 3.2, 3.6)], 'line-opacity': ['case', hot, 0.8, dim, 0.15, 0.55] } })
    map.addLayer({ id: 'reg-outline', type: 'line', source: 'soc-reg', filter: isOutline,
      paint: { 'line-color': regPaint, 'line-width': ['case', hot, 4, byLayer(1.3, 1.6, 2)], 'line-opacity': ['case', dim, 0.3, 1] } })
    map.addLayer({ id: 'reg-line', type: 'line', source: 'soc-reg', filter: ['all', ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]], ['!=', ['get', 'outline'], true]],
      paint: { 'line-color': regPaint, 'line-width': ['case', hot, 6, 3.5], 'line-opacity': ['case', dim, 0.3, 1] } })
    map.addLayer({ id: 'reg-point', type: 'circle', source: 'soc-reg', filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
      paint: { 'circle-color': regPaint, 'circle-radius': ['case', hot, 8, 5.5], 'circle-opacity': ['case', dim, 0.35, 1], 'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 1.5 } })
    // Labels (the "Labels on the map" switch): areas at a point inside them, lines along the line, sites beside the dot.
    const label = { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-max-width': 9, 'text-padding': 6 }
    const labelPaint = { 'text-color': regPaint, 'text-halo-color': '#0a0e17', 'text-halo-width': 1.6, 'text-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.35, 1] }
    map.addLayer({ id: 'reg-label-area', type: 'symbol', source: 'soc-reg-labels', layout: { ...label, visibility: 'none' }, paint: labelPaint })
    map.addLayer({ id: 'reg-label-line', type: 'symbol', source: 'soc-reg', filter: ['all', ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]], ['!=', ['get', 'outline'], true]],
      layout: { ...label, 'symbol-placement': 'line', 'text-max-angle': 35, visibility: 'none' }, paint: labelPaint })
    map.addLayer({ id: 'reg-label-point', type: 'symbol', source: 'soc-reg', filter: ['in', ['geometry-type'], ['literal', ['Point', 'MultiPoint']]],
      layout: { ...label, 'text-anchor': 'left', 'text-offset': [0.8, 0], visibility: 'none' }, paint: labelPaint })
    map.addLayer({ id: 'soc-area-fill', type: 'fill', source: 'soc-area', paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.05 } })
    map.addLayer({ id: 'soc-area-line', type: 'line', source: 'soc-area', paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [3, 2] } })
    map.addLayer({ id: 'soc-records', type: 'circle', source: 'soc-records', paint: {
      'circle-color': ['get', 'color'], 'circle-stroke-color': '#0a0e17',
      'circle-radius': ['case', ['boolean', ['get', 'hot'], false], 8, 5.5],
      'circle-stroke-width': ['case', ['boolean', ['get', 'hot'], false], 2, 1],
      'circle-opacity': ['case', ['boolean', ['get', 'dim'], false], 0.3, 0.95],
    } })
    map.addLayer({ id: 'soc-point', type: 'circle', source: 'soc-point', paint: { 'circle-radius': 6, 'circle-color': '#ffffff', 'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 2 } })
    syncLayersRef.current?.()
  }

  const syncLayers = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.getSource('soc-area')) return
    map.getSource('soc-area').setData(point ? circle(point.lat, point.lng, radiusKm) : EMPTY)
    map.getSource('soc-point').setData(point ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lng, point.lat] } } : EMPTY)
    const selSci = sel?.startsWith('sp:') ? sel.slice(3) : null
    const feats = []
    if (!layersOff.has('sightings')) {
      for (const r of rows) {
        for (const rec of r.records) {
          if (rec.location !== 'exact' || rec.lat == null) continue
          const best = r.statuses.find((x) => x.confirmed)
          feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [rec.lng, rec.lat] }, properties: {
            sci: r.scientific_name, color: colorOf(r.group), name: r.common_name || r.scientific_name, thumb: r.info?.photo?.thumb || '',
            status: r.statuses.filter((x) => x.confirmed).map(shortStatus).join(' · ') || `Listed ${best ? shortStatus(best) : 'population'} not confirmed`,
            date: rec.date, source: SOURCE_NAMES[rec.source] || rec.source, distance: `${fmtKm(rec.distance_km, unit)} from the spot`,
            ecotype: rec.ecotype ? `${rec.ecotype.name}${rec.ecotype.tentative ? '?' : ''}` : '',
            hot: selSci === r.scientific_name, dim: !!selSci && selSci !== r.scientific_name,
          } })
        }
      }
    }
    map.getSource('soc-records').setData({ type: 'FeatureCollection', features: feats })
    const selReg = sel?.startsWith('reg:') ? sel.slice(4) : null
    const regFeats = (reg?.features || []).filter((f) => !layersOff.has(f.properties.layer))
      .map((f) => ({ ...f, properties: { ...f.properties, hot: f.properties.id === selReg, dim: !!selReg && f.properties.id !== selReg } }))
      .sort((a, b) => a.properties.hot - b.properties.hot)   // the picked item last, so it draws on top
    map.getSource('soc-reg').setData({ type: 'FeatureCollection', features: regFeats })
    map.getSource('soc-reg-labels').setData({ type: 'FeatureCollection', features: labels ? labelPoints(regFeats) : [] })
    for (const id of ['reg-label-area', 'reg-label-line', 'reg-label-point']) map.setLayoutProperty(id, 'visibility', labels ? 'visible' : 'none')
  }, [point, radiusKm, rows, reg, layersOff, sel, unit, labels])
  const syncLayersRef = useRef(null)
  useEffect(() => { syncLayersRef.current = syncLayers; if (mapReady) syncLayers() }, [syncLayers, mapReady])

  // Frame a new point and its circle (not on a shared link's first load: that keeps its camera).
  const suppressFrameRef = useRef(!!initialCamera)
  const leftPad = () => (window.innerWidth > 768 ? 400 : 40)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !point) return
    if (suppressFrameRef.current) { suppressFrameRef.current = false; return }
    const d = radiusKm / 111, k = Math.cos((point.lat * Math.PI) / 180)
    map.fitBounds([[point.lng - d / k, point.lat - d], [point.lng + d / k, point.lat + d]], { padding: { top: 80, bottom: 60, left: leftPad(), right: 440 }, duration: 900 })
  }, [point, radiusKm, mapReady])

  // Picking from the list frames the item; picking on the map doesn't move it.
  const pickFromList = (s) => {
    setSel(s)
    const map = mapRef.current
    if (!map) return
    let b = null
    if (s.startsWith('sp:')) {
      const r = rows.find((x) => `sp:${x.scientific_name}` === s)
      const pts = (r?.records || []).filter((x) => x.location === 'exact').map((x) => ({ coordinates: [x.lng, x.lat] }))
      if (pts.length) b = boundsOf(pts)
    } else {
      b = boundsOf((reg?.features || []).filter((f) => `reg:${f.properties.id}` === s).map((f) => f.geometry))
    }
    if (b) map.fitBounds(b, { padding: { top: 90, bottom: 60, left: leftPad(), right: 460 }, maxZoom: 14, duration: 800 })
  }

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))   // style.load re-adds the layers
  }, [basemap, mapReady])

  // ─── Persist the view to the URL ──────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (basemap !== 'satellite') sp.set('bm', basemap)
    writePhoto(sp, photos.photo)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    if (point) sp.set('p', `${point.lat},${point.lng}`)
    if (radius !== 5) sp.set('r', String(radius))
    if (unit === 'mi') sp.set('u', 'mi')
    if (win !== '1y') sp.set('w', win)
    if (listsOff.size) sp.set('lo', [...listsOff].sort().join(','))
    const ly = LAYERS.filter((id) => layersOff.has(id) !== LAYERS_OFF_DEFAULT.includes(id)).map((id) => `${layersOff.has(id) ? '-' : '+'}${id}`)
    if (ly.length) sp.set('ly', ly.join(','))
    if (sel) sp.set('sel', sel)
    if (labels) sp.set('lb', '1')
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, photos.photo, mapView, point, radius, unit, win, listsOff, layersOff, sel, labels, mapReady])

  useEffect(() => {
    const prev = document.title
    document.title = 'Species of Concern — listed species near any spot · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  // Clear the spot: no dot, circle, results or card (the URL loses p and sel with them).
  const clearSpot = () => { setPoint(null); setSel(null); setPickerOpen(false); setError(null) }
  const toggleList = (id) => setListsOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleLayer = (id) => setLayersOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const changeUnit = (u) => {
    if (u === unit) return
    setRadius((r) => { const v = u === 'mi' ? r / KM_PER_MILE : r * KM_PER_MILE; return v >= 10 ? Math.round(v) : Math.round(v * 2) / 2 })
    setUnit(u)
  }

  if (!MAPBOX_TOKEN) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  const exactDots = rows.reduce((n, r) => n + r.locations.exact, 0)
  const count = (layer) => (reg ? reg[layer === 'critical-habitat' ? 'critical_habitat' : 'phs'].filter((it) => layer === 'critical-habitat' || (layer === 'phs-species') === (it.kind === 'species')).length : null)
  const sub = (n, word) => (!point ? 'click the map' : loading ? <LoadingInline /> : n == null ? '' : `${n} ${word}`)
  const usedColors = new Set(rows.map((r) => r.group))

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <div className={q.branding}>
        <a className={q.brandingLink} href="/" aria-label="EarthAtlas home"><span className={q.wordmark}>Earth<em>Atlas</em></span></a>
        <span className={q.subBadge}>Species of Concern</span>
      </div>

      <MapSearch className={q.searchBox}>
        <GeoSearch
          placeholder="Search a place in Washington…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => {
            if (Number.isFinite(r.lat) && Number.isFinite(r.lng)) { suppressFrameRef.current = true; setPoint({ lat: Math.round(r.lat * 1e4) / 1e4, lng: Math.round(r.lng * 1e4) / 1e4 }) }
            flyToSearchResult(mapRef.current, r)
          }}
        />
      </MapSearch>

      <SocPicker point={point} loading={loading} error={error} data={data} rows={rows} groups={groups} exactCount={exactCount}
        radius={radius} unit={unit} windowWords={WINDOW_WORDS[win]} picked={pickedName} onPick={pickFromList} open={pickerOpen} onOpen={setPickerOpen}>
        {picked && sel.startsWith('sp:') && <SpeciesCard r={picked} unit={unit} onClose={() => setSel(null)} />}
        {picked && sel.startsWith('reg:') && <AgencyCard it={picked} radius={radius} unit={unit} onClose={() => setSel(null)} />}
      </SocPicker>

      <BasemapMenu basemaps={BASEMAPS} basemap={basemap} onBasemap={setBasemap} photos={photos} className={q.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} />

      <MapSheet title="Species of concern" summary={point ? `${radius} ${unit} · ${WINDOW_WORDS[win]}` : 'Click the map to choose a spot'} className={styles.panel}>
        <div className={styles.panelBody}>
          <div className={styles.title}>Species of concern near a spot</div>
          <div className={styles.meta}>
            {point ? <>Spot {point.lat.toFixed(4)}, {point.lng.toFixed(4)} <button type="button" className={styles.clearSpot} onClick={clearSpot}>Clear spot</button><br />Click the map to move it; the results are in the <b>Species of concern</b> box, top right.</>
              : <>Click anywhere in Washington, or search a place. Agency mapping and listed species reported nearby appear on the map and in the box at top right.</>}
          </div>

          {/* Time and distance drive the whole lookup, so they sit on top (panel standard). */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>Recorded in</div>
            <div className={styles.chips}>
              {WINDOWS.map(([id, label]) => <button key={id} type="button" className={win === id ? styles.chipOn : styles.chip} onClick={() => setWin(id)}>{label}</button>)}
            </div>
            <div className={styles.sectionTitle} style={{ marginTop: 8 }}>Within</div>
            <div className={styles.chips}>
              {RADII.map((v) => <button key={v} type="button" className={radius === v ? styles.chipOn : styles.chip} onClick={() => setRadius(v)}>{v}</button>)}
              <input className={styles.radiusInput} type="number" min="0.1" max={unit === 'mi' ? 31 : 50} step="0.5" value={radius} aria-label="Distance"
                onChange={(e) => { const v = parseFloat(e.target.value); if (v > 0) setRadius(Math.min(unit === 'mi' ? 31 : 50, v)) }} />
              <span className={styles.unitToggle}>
                {['km', 'mi'].map((u) => <button key={u} type="button" className={unit === u ? styles.unitOn : styles.unit} onClick={() => changeUnit(u)}>{u}</button>)}
              </span>
            </div>
          </div>

          <div className={styles.section}>
            <DatasetRow storageKey="soc.sightings" name="Sightings of listed species" hue="#ef4444"
              sub={sub(data ? exactDots : null, 'exact locations')} on={!layersOff.has('sightings')} onToggle={() => toggleLayer('sightings')}
              controls={<>
                <div className={styles.sectionTitle}>Lists</div>
                {LISTS.map((l) => (
                  <label key={l.id} className={styles.toggle}>
                    <input type="checkbox" checked={!listsOff.has(l.id)} onChange={() => toggleList(l.id)} />{l.label}
                  </label>
                ))}
              </>}
              legend={<>
                <LegendSwatchRow swatch={<span className={styles.legendDot} style={{ background: '#ef4444' }} />}>Dot color = the species’ highest confirmed status on the lists that are on; hover a dot for it</LegendSwatchRow>
                <LegendTurndown storageKey="soc.statusColors" label={`Status colors (${DOT_LEGEND.length})`}>
                  {DOT_LEGEND.map(([label, keys]) => (
                    <LegendSwatchRow key={label} swatch={<span className={styles.legendDot} style={{ background: colorOf(keys[0]), opacity: keys.some((k) => usedColors.has(k)) || !data ? 1 : 0.35 }} />}>{label}</LegendSwatchRow>
                  ))}
                </LegendTurndown>
                <LegendSwatchRow swatch={<span className={styles.legendRing} />}>Blurred locations (iNaturalist) aren’t drawn; they are listed in the box</LegendSwatchRow>
              </>}
              info={<>Records of listed species from <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer">iNaturalist</a>, <a href="https://www.gbif.org" target="_blank" rel="noopener noreferrer">GBIF</a>, <a href="https://ebird.org" target="_blank" rel="noopener noreferrer">eBird</a> (last 30 days) and EarthAtlas’s whale-sighting database (Whale Alert, Happywhale, SalishSea.io, OBIS, Orcasound). Only species on the lists are asked for. Each record links to where it was reported.</>} />

            <DatasetRow storageKey="soc.criticalHabitat" name="Federal critical habitat" hue={REG_COLORS['critical-habitat']}
              sub={sub(count('critical-habitat'), 'designations')} on={!layersOff.has('critical-habitat')} onToggle={() => toggleLayer('critical-habitat')}
              legend={<LegendSwatchRow swatch={<span className={styles.legendSq} style={{ background: REG_COLORS['critical-habitat'] }} />}>Designated critical habitat (NOAA Fisheries, USFWS); hover for the species, pick it in the box for its rule</LegendSwatchRow>}
              info={<>Areas designated under the Endangered Species Act as essential to a listed species, each with its Federal Register rule and 50 CFR section. From <a href="https://www.fisheries.noaa.gov/national/endangered-species-conservation/critical-habitat" target="_blank" rel="noopener noreferrer">NOAA Fisheries</a> and <a href="https://ecos.fws.gov/ecp/report/critical-habitat" target="_blank" rel="noopener noreferrer">USFWS</a>.</>} />

            <DatasetRow storageKey="soc.phsSpecies" name="WDFW priority species" hue={REG_COLORS['phs-species']}
              sub={sub(count('phs-species'), 'mapped')} on={!layersOff.has('phs-species')} onToggle={() => toggleLayer('phs-species')}
              legend={<LegendSwatchRow swatch={<span className={styles.legendSq} style={{ background: REG_COLORS['phs-species'] }} />}>Where WDFW has mapped a priority species (haul-outs, spawning beaches, colonies); sensitive species only as a section or township</LegendSwatchRow>}
              info={<>From WDFW’s public <a href="https://geodataservices.wdfw.wa.gov/hp/phs/" target="_blank" rel="noopener noreferrer">Priority Habitats and Species on the Web</a>. WDFW generalizes sensitive species to a section (1 sq mi), quarter township (9 sq mi) or township (36 sq mi); its exact records are not public.</>} />

            <DatasetRow storageKey="soc.phsHabitat" name="WDFW priority habitats" hue={REG_COLORS['phs-habitat']}
              sub={radiusKm > HABITAT_DRAW_KM ? `listed in the box; drawn up to ${HABITAT_DRAW_KM} km` : sub(count('phs-habitat'), 'kinds')} on={!layersOff.has('phs-habitat')} onToggle={() => toggleLayer('phs-habitat')}
              legend={<LegendSwatchRow swatch={<span className={styles.legendSq} style={{ background: REG_COLORS['phs-habitat'] }} />}>Wetlands, estuaries, cliffs, shellfish and other priority habitats mapped by WDFW</LegendSwatchRow>}
              info={<>From WDFW’s public <a href="https://geodataservices.wdfw.wa.gov/hp/phs/" target="_blank" rel="noopener noreferrer">Priority Habitats and Species on the Web</a>.</>} />
            <label className={styles.toggle} style={{ marginTop: 6 }}>
              <input type="checkbox" checked={labels} onChange={() => setLabels((v) => !v)} />Labels on the map (agency areas)
            </label>
          </div>

          <SourcesFooter intro={SOC_SOURCES_INTRO} sections={SOC_SOURCES} notes={SOC_SOURCES_NOTES} />
        </div>
      </MapSheet>
    </div>
  )
}
