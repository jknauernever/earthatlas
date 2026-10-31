/**
 * EarthAtlas /risks: coastal flooding and erosion risk in San Juan County, WA, from the County's 2024 sea-level-rise
 * assessment by Environmental Science Associates (ESA). Pick a scenario (2 or 5 ft of sea-level rise, with the 1-year
 * or 100-year storm) and see its flood extent, the buildings in it, the roads the assessment found flooding, and the
 * six places it names as at higher risk of erosion.
 *
 * Data: the flood extents are tiled from the County's public map service (scripts/bake-risks → api/risks-tiles.js);
 * the small layers ship as public/risks-data/assessment.geojson. Labels and numbers come from the report (risksLayers.js).
 * ESA's erosion hazard zones and flood depth / wave runup are not public; a new dataset is one more DatasetRow here
 * and one more layer in the bake.
 *
 * Follows docs/MAP_TOOL_CONVENTIONS.md: URL state (camera, basemap, photos, scenario, compare, layers off), satellite
 * default, shared zoom badge / share / place search / basemap menu, style.load readiness, MapSheet on phones, hover
 * readouts on every map item (src/lib/mapHoverTip.js), the shared left panel and sources rollup.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { installPopupSheet } from '../lib/popupSheet.js'
import { keepPopupOnMap } from '../lib/popupFit.js'
import { installHoverTip } from '../lib/mapHoverTip.js'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import MapSheet from '../components/MapSheet.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import { BasemapMenu, ImageryLine, useMapPhotos, writePhoto } from '../components/basemap/index.js'
import { DatasetRow, LegendSwatchRow, SourcesFooter } from '../components/panel/index.js'
import {
  SCENARIOS, SLR_LEVELS, STORMS, SCENARIO_COLORS, scenarioOf, TILES_VERSION,
  SLR_SERVICE_URL, VA_SERVICE_URL, EROSION_SERVICE_URL, EROSION_ZONES_URL,
} from './risksLayers.js'
import { RISKS_SOURCES, RISKS_SOURCES_INTRO, RISKS_SOURCES_NOTES, reportPage } from './risksSources.js'
import q from '../quakes/QuakesApp.module.css'
import p from '../speciesOfConcern/SpeciesOfConcernApp.module.css'
import styles from './RisksApp.module.css'

installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-123.0806, 48.5691], zoom: 10.2 }   // the San Juan Islands (Josh's pick, 2026-10-30)
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

const DEFAULT_SCENARIO = 'slr5_100'
const DEFAULT_OPACITY = 60   // percent
const LAYERS = ['flood', 'buildings', 'lots', 'roads', 'erosion']
const COLORS = { flood: '#ef4444', buildings: '#facc15', roads: '#f97316', erosion: '#c084fc' }
// Property lines: the San Juan County Assessor parcels EarthAtlas already serves for /fire (src/fire/parcelSources.json)
const LOTS_TILES = () => `${typeof window !== 'undefined' ? window.location.origin : ''}/api/parcel-tiles?r=sanjuan-wa&v=2025&z={z}&x={x}&y={y}`
// The county's four flood layers are bands that don't overlap: each holds only the ground a worse scenario adds to the
// milder ones (SCENARIOS is mildest first). A scenario's flood extent is therefore its band plus every milder band.
const rankOf = (id) => SCENARIOS.findIndex((s) => s.id === id) + 1
const floodLayerId = (id) => `risks-flood-${id}`
const floodLineId = (id) => `risks-flood-line-${id}`
const ASSESSMENT_LAYERS = ['risks-roads', 'risks-erosion']
const BUILDING_LAYERS = ['risks-buildings-hit', 'risks-hits']
// ESA's projected erosion zones; the report pairs 2060 with the moderate (2 ft) and 2100 with the high (5 ft) rise.
// Like the flood layers they are rings that don't overlap (2060: shoreline to the 2060 line; 2100: on from there), so
// "by 2100" is both rings.
const EROSION_YEARS = { '2ft': 2060, '5ft': 2100 }
const erosionLayerId = (y) => `risks-erosion-zone-${y}`
const EROSION_ZONE_LAYERS = [2060, 2100].map(erosionLayerId)
const HOVER_LAYERS = [...ASSESSMENT_LAYERS, ...BUILDING_LAYERS, ...EROSION_ZONE_LAYERS, ...SCENARIOS.map((s) => floodLayerId(s.id))]

// ─── Shareable URL state ────────────────────────────────────────────────────
//   bm, ph       basemap, photos           lat,lng,z   camera
//   s            scenario id (default slr5_100)          all   1 = all four scenarios stacked
//   off          map layers turned off, comma ids           op    flood opacity, percent (default 60)
function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'),
    s: SCENARIOS.some((x) => x.id === sp.get('s')) ? sp.get('s') : DEFAULT_SCENARIO,
    all: sp.get('all') === '1',
    off: new Set((sp.get('off') || '').split(',').filter((id) => LAYERS.includes(id))),
    op: num('op'),
  }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const slrOf = (id) => SLR_LEVELS.find((l) => l.id === id)
const stormOf = (id) => STORMS.find((s) => s.id === id)
const scenarioWords = (sc) => `${slrOf(sc.slr).words} + ${stormOf(sc.storm).words}`
const scenarioShort = (sc) => `${slrOf(sc.slr).label} + ${stormOf(sc.storm).label}`
const fmt = (n) => n.toLocaleString('en-US')
const tilesUrl = () => `${typeof window !== 'undefined' ? window.location.origin : ''}/api/risks-tiles?v=${TILES_VERSION}&z={z}&x={x}&y={y}`

// The card for one assessment item (hover readout and click popup share it; `link` adds the source line).
function itemHtml(f, link) {
  const pr = f.properties
  const src = (href, text) => (link ? `<a class="${styles.popupSrc}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : '')
  if (pr.kind === 'road') {
    const lists = String(pr.lists || '').split(',')
    const which = lists.includes('coastal') && lists.includes('other') ? 'Coastal roads flooding and Other roads flooding layers'
      : lists.includes('coastal') ? 'Coastal roads flooding layer' : 'Other roads flooding layer'
    const lid = String(pr.lids || '').split(',')[0]
    return `<div class="${styles.card}"><div class="${styles.cardTitle}"><span class="${styles.sw}" style="background:${COLORS.roads}"></span>${esc(pr.name || 'Road')}</div>
      <div>${esc(pr.island || '')} Island${pr.miles != null ? ` · this segment ${pr.miles} mi` : ''}</div>
      <div class="${styles.dim}">Road at risk of flooding with sea-level rise · county ${which}</div>
      ${src(`${VA_SERVICE_URL}/${lid}`, 'San Juan County / ESA 2024 →')}</div>`
  }
  if (pr.kind === 'erosion') {
    return `<div class="${styles.card}"><div class="${styles.cardTitle}"><span class="${styles.sw}" style="background:${COLORS.erosion}"></span>${esc(pr.name)}</div>
      <div class="${styles.dim}">Named in the report as at higher risk of erosion with sea-level rise</div>
      ${src(reportPage(30), 'Report, p. 25 →')}</div>`
  }
  return ''
}

export default function RisksApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  const initial = useMemo(() => readUrlState(), [])
  const initialCamera = Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z)
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null

  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const photos = useMapPhotos(mapRef, { mapReady, basemap })
  const [mapView, setMapView] = useState(initialCamera)
  const [scenarioId, setScenarioId] = useState(initial.s)
  const [all, setAll] = useState(initial.all)
  const [layersOff, setLayersOff] = useState(initial.off)
  const [opacity, setOpacity] = useState(() => (initial.op >= 10 && initial.op <= 100 ? Math.round(initial.op) : DEFAULT_OPACITY))
  const [assessment, setAssessment] = useState(null)
  const [hotspots, setHotspots] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)
  const shownRank = all ? SCENARIOS.length : rankOf(scenarioId)

  useEffect(() => {
    const ac = new AbortController()
    fetch('/risks-data/assessment.geojson', { signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(setAssessment)
      .catch((e) => { if (e.name !== 'AbortError') setLoadError('The assessment layers did not load. Reload to try again.') })
    fetch('/risks-data/hotspots.json', { signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then((j) => setHotspots(j.spots))
      .catch(() => {})   // the jump list just doesn't show
    return () => ac.abort()
  }, [])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  const hoverRef = useRef(null)
  const clickRef = useRef(null)
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current, style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center,
      zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom,
      preserveDrawingBuffer: true,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('style.load', () => { addLayers(map); setMapReady(true) })
    map.on('click', (e) => clickRef.current?.(e))
    const offHover = installHoverTip(map, {
      layers: HOVER_LAYERS,
      html: (feats) => hoverRef.current?.(feats) || null,
    })
    return () => { offHover(); popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Hover: an assessment item wins, then a building; otherwise say from which scenario on the spot floods.
  const firstFloodsLine = (rank) => {
    const sc = SCENARIOS[rank - 1]
    const worse = SCENARIOS.slice(rank).map(scenarioShort)
    return `<div>First floods with <b>${esc(scenarioWords(sc))}</b></div>
      <div class="${styles.dim}">${worse.length ? `Also floods with ${esc(worse.join(', '))}` : 'Floods only in the worst scenario mapped'}</div>`
  }
  hoverRef.current = (feats) => {
    const item = feats.find((f) => ASSESSMENT_LAYERS.includes(f.layer.id))
    if (item) return `${itemHtml(item, false)}<div class="${styles.tipHint}">Click for its source</div>`
    const bld = feats.find((f) => BUILDING_LAYERS.includes(f.layer.id))
    if (bld) {
      const b = bld.properties
      return `<div class="${styles.card}"><div class="${styles.cardTitle}"><span class="${styles.sw}" style="background:${COLORS.buildings}"></span>Building in the flood extent</div>
        ${firstFloodsLine(b.first)}
        <div class="${styles.dim}">${b.sqft ? `${fmt(b.sqft)} sq ft footprint · ` : ''}${b.island ? `${esc(b.island)} · ` : ''}parcel ${esc(b.pin || '—')}</div></div>`
    }
    const zone = feats.find((f) => EROSION_ZONE_LAYERS.includes(f.layer.id))
    if (zone) {
      return `<div class="${styles.card}"><div class="${styles.cardTitle}"><span class="${styles.sw}" style="background:${COLORS.erosion}"></span>Projected erosion by ${zone.properties.year}</div>
        <div>${zone.properties.year === 2060 ? 'Shoreline ESA projects erosion to take by 2060' : 'Shoreline ESA projects erosion to take between 2060 and 2100'}</div>
        <div class="${styles.dim}">ESA 2023, from shore type and increased historic erosion rates</div></div>`
    }
    const band = SCENARIOS.find((s) => feats.some((f) => f.layer.id === floodLayerId(s.id)))
    if (!band) return null
    return `<div class="${styles.card}"><div class="${styles.cardTitle}"><span class="${styles.sw}" style="background:${all ? SCENARIO_COLORS[band.id] : COLORS.flood}"></span>Flood extent</div>
      ${firstFloodsLine(rankOf(band.id))}<div class="${styles.dim}">ESA 2024 modelled flooding</div></div>`
  }

  clickRef.current = (e) => {
    const map = mapRef.current
    const hit = map.queryRenderedFeatures(e.point, { layers: ASSESSMENT_LAYERS.filter((l) => map.getLayer(l)) })[0]
    popupRef.current?.remove()
    if (!hit) return
    const popup = new mapboxgl.Popup({ offset: 10, maxWidth: '320px' }).setLngLat(e.lngLat).setHTML(itemHtml(hit, true)).addTo(map)
    popupRef.current = keepPopupOnMap(popup)
  }

  // ─── Map layers ───────────────────────────────────────────────────────────
  function addLayers(map) {
    if (map.getSource('risks-slr')) return
    map.addSource('risks-slr', { type: 'vector', tiles: [tilesUrl()], minzoom: 6, maxzoom: 14, attribution: 'San Juan County / ESA 2024' })
    map.addSource('risks-lots', { type: 'vector', tiles: [LOTS_TILES()], minzoom: 13, maxzoom: 16, attribution: 'Parcels: San Juan County Assessor' })
    for (const { id } of SCENARIOS) {
      map.addLayer({ id: floodLayerId(id), type: 'fill', source: 'risks-slr', 'source-layer': id, layout: { visibility: 'none' },
        paint: { 'fill-color': COLORS.flood, 'fill-opacity': 0.6 } })
    }
    // A fixed-width edge on every flood band, so the thin shoreline strips still read at county zoom
    for (const { id } of SCENARIOS) {
      map.addLayer({ id: floodLineId(id), type: 'line', source: 'risks-slr', 'source-layer': id, layout: { visibility: 'none' },
        paint: { 'line-color': COLORS.flood, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.6, 14, 0.8], 'line-opacity': 0.9 } })
    }
        for (const y of [2100, 2060]) {
      map.addLayer({ id: erosionLayerId(y), type: 'fill', source: 'risks-slr', 'source-layer': `erosion${y}`, layout: { visibility: 'none' },
        paint: { 'fill-color': COLORS.erosion, 'fill-opacity': 0.45 } })
      map.addLayer({ id: `${erosionLayerId(y)}-line`, type: 'line', source: 'risks-slr', 'source-layer': `erosion${y}`, layout: { visibility: 'none' },
        paint: { 'line-color': COLORS.erosion, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.4, 15, 1] } })
    }
    map.addLayer({ id: 'risks-lots', type: 'line', source: 'risks-lots', 'source-layer': 'parcels', minzoom: 13,
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 17, 1.4], 'line-opacity': 0.6 } })
    map.addLayer({ id: 'risks-buildings', type: 'line', source: 'risks-slr', 'source-layer': 'buildings', minzoom: 13,
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.6], 'line-opacity': 0.85 } })
    map.addLayer({ id: 'risks-buildings-hit', type: 'fill', source: 'risks-slr', 'source-layer': 'buildings', filter: ['==', ['get', 'first'], -1],
      paint: { 'fill-color': COLORS.buildings, 'fill-opacity': 0.95, 'fill-outline-color': '#0a0e17' } })
    // Flooded buildings as glowing dots where a footprint is only a few pixels; they fade out as the footprints take over
    const fade = (v) => ['interpolate', ['linear'], ['zoom'], 13, v, 14.5, 0]
    map.addLayer({ id: 'risks-hits-glow', type: 'circle', source: 'risks-slr', 'source-layer': 'hits', filter: ['==', ['get', 'first'], -1],
      paint: { 'circle-color': COLORS.buildings, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 5, 13, 12], 'circle-blur': 1, 'circle-opacity': fade(0.5) } })
    map.addLayer({ id: 'risks-hits', type: 'circle', source: 'risks-slr', 'source-layer': 'hits', filter: ['==', ['get', 'first'], -1],
      paint: { 'circle-color': COLORS.buildings, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.6, 13, 3.5],
        'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 0.5, 'circle-opacity': fade(1), 'circle-stroke-opacity': fade(1) } })
    map.addSource('risks-assessment', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const kind = (k) => ['==', ['get', 'kind'], k]
    map.addLayer({ id: 'risks-roads-casing', type: 'line', source: 'risks-assessment', filter: kind('road'),
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0a0e17', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 4, 15, 9], 'line-opacity': 0.6 } })
    map.addLayer({ id: 'risks-roads', type: 'line', source: 'risks-assessment', filter: kind('road'),
      layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': COLORS.roads, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 15, 5] } })
    map.addLayer({ id: 'risks-erosion', type: 'circle', source: 'risks-assessment', filter: kind('erosion'),
      paint: { 'circle-color': COLORS.erosion, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 6, 14, 9], 'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 2 } })
    syncRef.current?.()
  }

  const sync = () => {
    const map = mapRef.current
    if (!map || !map.getSource('risks-slr')) return
    SCENARIOS.forEach(({ id }, i) => {
      const on = !layersOff.has('flood') && i + 1 <= shownRank
      const color = all ? SCENARIO_COLORS[id] : COLORS.flood
      map.setLayoutProperty(floodLayerId(id), 'visibility', on ? 'visible' : 'none')
      map.setLayoutProperty(floodLineId(id), 'visibility', on ? 'visible' : 'none')
      map.setPaintProperty(floodLayerId(id), 'fill-color', color)
      map.setPaintProperty(floodLayerId(id), 'fill-opacity', opacity / 100)
      map.setPaintProperty(floodLineId(id), 'line-color', color)
      map.setPaintProperty(floodLineId(id), 'line-opacity', Math.min(1, opacity / 100 + 0.3))
    })
    for (const y of [2060, 2100]) {
      const on = !layersOff.has('erosion') && (all || y <= EROSION_YEARS[scenario.slr])
      map.setLayoutProperty(erosionLayerId(y), 'visibility', on ? 'visible' : 'none')
      map.setLayoutProperty(`${erosionLayerId(y)}-line`, 'visibility', on ? 'visible' : 'none')
      map.setPaintProperty(erosionLayerId(y), 'fill-opacity', all && y === 2100 ? 0.25 : 0.45)   // All four: the later ring paler
    }
    const bOn = !layersOff.has('buildings')
    map.setLayoutProperty('risks-buildings', 'visibility', bOn ? 'visible' : 'none')
    const hit = ['all', ['>', ['get', 'first'], 0], ['<=', ['get', 'first'], shownRank]]
    for (const id of ['risks-buildings-hit', 'risks-hits', 'risks-hits-glow']) {
      map.setLayoutProperty(id, 'visibility', bOn ? 'visible' : 'none')
      map.setFilter(id, hit)
    }
    map.setLayoutProperty('risks-lots', 'visibility', layersOff.has('lots') ? 'none' : 'visible')
    if (assessment) {
      map.getSource('risks-assessment').setData({ type: 'FeatureCollection',
        features: assessment.features.filter((f) => !layersOff.has(f.properties.kind === 'road' ? 'roads' : 'erosion')) })
    }
  }
  const syncRef = useRef(null)
  syncRef.current = sync
  useEffect(() => { if (mapReady) sync() })   // cheap: four visibility flips and one setData of ~100 features

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
    if (mapView) { sp.set('lat', mapView.lat.toFixed(4)); sp.set('lng', mapView.lng.toFixed(4)); sp.set('z', mapView.zoom.toFixed(1)) }
    if (scenarioId !== DEFAULT_SCENARIO) sp.set('s', scenarioId)
    if (all) sp.set('all', '1')
    if (layersOff.size) sp.set('off', LAYERS.filter((id) => layersOff.has(id)).join(','))
    if (opacity !== DEFAULT_OPACITY) sp.set('op', String(opacity))
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, photos.photo, mapView, scenarioId, all, layersOff, opacity, mapReady])

  useEffect(() => {
    const prev = document.title
    document.title = 'Sea-Level Rise Risks — San Juan County flooding scenarios · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  const toggleLayer = (id) => setLayersOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pick = (slr, storm) => { setScenarioId(scenarioOf(slr, storm).id); setAll(false) }

  if (!MAPBOX_TOKEN) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  const counts = assessment ? {
    roads: new Set(assessment.features.filter((f) => f.properties.kind === 'road').map((f) => `${f.properties.name}|${f.properties.island}`)).size,
    erosion: assessment.features.filter((f) => f.properties.kind === 'erosion').length,
  } : null
  // Hotspots ranked by this scenario's count (the worst scenario's with All four)
  const hotRank = shownRank - 1
  const hot = hotspots ? [...hotspots].filter((h) => h.counts[hotRank] > 0).sort((a, b) => b.counts[hotRank] - a.counts[hotRank]).slice(0, 5) : []
  const flyTo = (h) => mapRef.current?.flyTo({ center: h.center, zoom: 15.6, duration: 2500, essential: true })
  const sub = (n, word) => (loadError ? '' : n == null ? '…' : `${n} ${word}`)
  const ext = (href, text) => <a className={p.src} href={href} target="_blank" rel="noopener noreferrer">{text}</a>

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <div className={q.branding}>
        <a className={q.brandingLink} href="/" aria-label="EarthAtlas home"><span className={q.wordmark}>Earth<em>Atlas</em></span></a>
        <span className={q.subBadge}>Sea-Level Rise Risks</span>
      </div>

      <MapSearch className={q.searchBox}>
        <GeoSearch
          placeholder="Search a place in San Juan County…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => flyToSearchResult(mapRef.current, r)}
        />
      </MapSearch>

      <BasemapMenu basemaps={BASEMAPS} basemap={basemap} onBasemap={setBasemap} photos={photos} className={q.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} />

      <MapSheet title="Sea-level rise" summary={all ? 'All four scenarios' : scenarioShort(scenario)} className={p.panel}>
        <div className={p.panelBody}>
          <div className={p.title}>Sea-level rise, San Juan County</div>

          {/* The question the page answers, one choice: how far the sea rises. A major (100-year) storm is the default; the
              yearly storm and the four-scenario comparison sit in the Flood extent row's options. */}
          <div className={p.section}>
            <div className={styles.lead}>If the sea rises…</div>
            <div className={styles.seg}>
              {SLR_LEVELS.map((l) => (
                <button key={l.id} type="button" className={!all && scenario.slr === l.id ? styles.segOn : styles.segBtn} onClick={() => pick(l.id, scenario.storm)}>
                  <b>{l.label}</b><span>{l.year}</span>
                </button>
              ))}
            </div>
            {all ? (
              <div className={styles.fact}>Each area colored by the mildest scenario that floods it. {ext(reportPage(29), 'Buildings and roads per scenario (report, Table 6-1)')}</div>
            ) : (
              <div>
                <div className={styles.lead}>…then {stormOf(scenario.storm).lead}</div>
                <div className={styles.bigNum}>{ext(reportPage(29), fmt(scenario.buildings))}</div>
                <div className={styles.bigLabel}>buildings and {ext(reportPage(29), `${scenario.roadMiles} miles of road`)}</div>
                <div className={styles.factDim}>
                  {slrOf(scenario.slr).label} of rise: {slrOf(scenario.slr).when} {ext(reportPage(22), '(p. 17)')}
                  {' · '}{stormOf(scenario.storm).plain}: {stormOf(scenario.storm).label}, {stormOf(scenario.storm).what} {ext(reportPage(scenario.storm === '1yr' ? 30 : 9), scenario.storm === '1yr' ? '(p. 25)' : '(p. 4)')}
                </div>
              </div>
            )}
            {hot.length > 0 && (
              <div className={styles.hotLine}>
                Most flooded on this map{all ? ' (5 ft + 100-year)' : ''}:{' '}
                {hot.map((h, i) => (
                  <span key={h.center.join()}>{i > 0 && ' · '}<button type="button" className={styles.hot} title={`${h.name || ''}, ${h.island} Island: fly there`} onClick={() => flyTo(h)}>
                    {h.name || `${h.island} Island`} <span className={styles.hotN}>{fmt(h.counts[hotRank])}</span></button></span>
                ))}
                {' '}{ext(SLR_SERVICE_URL, '(county data)')}
              </div>
            )}
          </div>

          <div className={p.section}>
            <DatasetRow storageKey="risks.flood" name="Flood extent" hue={COLORS.flood}
              sub={all ? 'when each area first floods' : scenarioShort(scenario)} on={!layersOff.has('flood')} onToggle={() => toggleLayer('flood')}
              controls={<>
                <div className={styles.ctlLabel}>Storm</div>
                <div className={p.chips}>
                  {[...STORMS].reverse().map((st) => (
                    <button key={st.id} type="button" className={!all && scenario.storm === st.id ? p.chipOn : p.chip} onClick={() => pick(scenario.slr, st.id)}>{st.label}</button>
                  ))}
                  <button type="button" className={all ? p.chipOn : p.chip} onClick={() => setAll((v) => !v)}>All four</button>
                </div>
                <label className={styles.slider} style={{ marginTop: 8 }}>Opacity
                  <input type="range" min="10" max="100" step="5" value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} aria-label="Flood opacity" />
                  <span className={styles.sliderVal}>{opacity}%</span></label>
              </>}
              legend={all ? (
                <LegendSwatchRow swatch={<span className={styles.ramp}>{SCENARIOS.map((sc) => <span key={sc.id} style={{ background: SCENARIO_COLORS[sc.id] }} />)}</span>}>
                  Darkest floods first (2 ft + 1-year); palest only at 5 ft + 100-year</LegendSwatchRow>
              ) : (
                <LegendSwatchRow swatch={<span className={p.legendSq} style={{ background: COLORS.flood }} />}>Land that floods in this scenario</LegendSwatchRow>
              )}
              info={<>Land ESA’s modelling shows flooding at each scenario’s total water level (still water level plus wave runup), around the whole county shoreline, with RCP 8.5 (high-emissions) sea-level rise. The County publishes each scenario as only the ground it adds to the milder ones; EarthAtlas draws a scenario as its ground plus every milder scenario’s, and trims the 1-year layer’s open water to the shoreline. {ext(SLR_SERVICE_URL, 'County map service')} · {ext(reportPage(22), 'scenarios (report, p. 17)')}</>} />

            <DatasetRow storageKey="risks.buildings" name="Buildings" hue={COLORS.buildings}
              sub="in the flood extent" on={!layersOff.has('buildings')} onToggle={() => toggleLayer('buildings')}
              legend={<LegendSwatchRow swatch={<span className={p.legendSq} style={{ background: COLORS.buildings }} />}>In the flood extent (others outlined)</LegendSwatchRow>}
              info={<>San Juan County’s building footprints (2009 LiDAR and later), as Salish Sea Explorer holds them. A building is highlighted when any part of its footprint touches the flood extent shown. {ext(SLR_SERVICE_URL + '/0', 'County map service')}</>} />

            <DatasetRow storageKey="risks.lots" name="Property lines" hue="#e5e7eb"
              sub="from zoom 13" on={!layersOff.has('lots')} onToggle={() => toggleLayer('lots')}
              info={<>Tax parcel boundaries from the {ext('https://www.sanjuanco.com/167/Assessor', 'San Juan County Assessor')}.</>} />

            <DatasetRow storageKey="risks.roads" name="Roads at risk of flooding" hue={COLORS.roads}
              sub={sub(counts?.roads, 'roads')} on={!layersOff.has('roads')} onToggle={() => toggleLayer('roads')}
              legend={<LegendSwatchRow swatch={<span className={styles.legendLine} style={{ background: COLORS.roads }} />}>Road on the assessment’s flooding lists</LegendSwatchRow>}
              info={<>Roads the assessment lists as at risk of flooding with sea-level rise, from the County’s Coastal Roads Flooding (by island) and Other Roads Flooding layers. {ext(VA_SERVICE_URL, 'County map service')} · {ext(reportPage(30), 'report, p. 25')}</>} />

            <DatasetRow storageKey="risks.erosion" name="Erosion" hue={COLORS.erosion}
              sub={<>by {all ? '2060 and 2100' : EROSION_YEARS[scenario.slr]}</>} on={!layersOff.has('erosion')} onToggle={() => toggleLayer('erosion')}
              legend={<LegendSwatchRow swatch={<span className={p.legendSq} style={{ background: COLORS.erosion }} />}>Projected to erode by {all ? '2060 and 2100' : EROSION_YEARS[scenario.slr]}; dots: higher risk</LegendSwatchRow>}
              info={<>ESA’s projected erosion zones: the band inland of today’s shoreline that erosion is projected to take by 2060 and by 2100, from each stretch’s shore type (feeder bluff, transport zone, accretion, pocket beach) and its historic erosion rate, increased for sea-level rise. The report pairs 2060 with the moderate and 2100 with the high sea-level rise scenario. Dots: the six places the report names as at higher risk (the south ends of San Juan and Lopez islands, Waldron’s northeast coast, Blakely’s east point, Decatur’s southeast side). {ext(EROSION_ZONES_URL, 'County map service')} · {ext(EROSION_SERVICE_URL, 'higher-risk places')} · {ext(reportPage(30), 'report, p. 25')}</>} />
            {loadError && <div className={p.error}>{loadError}</div>}
          </div>

          <div className={styles.notice}>County data: educational use only, no warranty (see sources).</div>
          <SourcesFooter intro={RISKS_SOURCES_INTRO} sections={RISKS_SOURCES} notes={RISKS_SOURCES_NOTES} />
        </div>
      </MapSheet>
    </div>
  )
}
