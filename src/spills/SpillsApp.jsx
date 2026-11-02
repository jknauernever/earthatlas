/**
 * EarthAtlas /spills, “Fossil Fuel Spills & Releases”: Lake Michigan oil-spill exposure plus U.S. pipeline accidents. Oil and petroleum releases reported to the National Response
 * Center (2015 to the latest NRC file) on NOAA's Lake Michigan Environmental Sensitivity Index: spill points styled by how precisely
 * each report could be placed, a ranked list of the most-reported places, ESI shoreline coloured by sensitivity class, and a card per report
 * listing the ESI shoreline and species near it with their listing status. Everything is exposure from unverified
 * initial reports, not measured impact.
 *
 * Data is baked by scripts/bake-spills (extract.py → geocode.py → analyze.py) into public/spills-data/.
 *
 * Follows docs/MAP_TOOL_CONVENTIONS.md: URL state (camera, basemap, photos, years, layers, location kinds, match basis,
 * picked item), satellite default, shared zoom badge / share / place search / basemap menu, style.load readiness,
 * MapSheet on phones, the one left-panel standard (DatasetRow, SourcesFooter).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { mapboxToken } from '../lib/mapboxToken.js'
import { installHoverTip } from '../lib/mapHoverTip.js'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import MapSheet from '../components/MapSheet.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import SiteBrand from '../components/SiteBrand.jsx'
import { BasemapMenu, ImageryLine, useMapPhotos, writePhoto } from '../components/basemap/index.js'
import { DatasetRow, LegendSwatchRow, LegendTurndown, SourcesFooter, Loading } from '../components/panel/index.js'
import { SPILLS_SOURCES, SPILLS_SOURCES_INTRO, SPILLS_SOURCES_NOTES } from './spillsSources.jsx'
import { ReportCard, ListCard, ShoreCard, AreaCard, PipeCard, GasCard, SpeciesList } from './SpillCard.jsx'
import {
  loadSpillsFiles, loadRegion, loadRegionList, critNear, chStatus, FWS_CH, PHMSA_HOME, PIPE_COLOR, COMMODITY_PLAIN, bblText, GAS_COLOR, GAS_SYSTEM, mcfText, PADUS_HOME, PA_COLOR, gapOf, MANAGER, ESI_COLORS, ESI_HOME, NRC_HOME, WBD, PRECISION, PRECISION_BY_ID, PRECISION_GROUPS,
  nearbyHighlights, statusShort, esiColor, esiNumber, esiShort, esiSentence, esiLevel, isListed, fmtInt, fmtDate, esc, titleCase,
} from './spillsShared.js'
import q from '../quakes/QuakesApp.module.css'
import { padusSource, padusArea, PADUS_FILTER, PADUS_FILL_OPACITY, PADUS_LINE_OPACITY } from '../lib/national/padus.js'
import styles from './SpillsApp.module.css'

const MAPBOX_TOKEN = mapboxToken
const DEFAULT_VIEW = { center: [-86.9, 43.9], zoom: 5.9 }
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

const LAYERS = ['reports', 'pipe', 'gas', 'esi', 'pa']
const LAYERS_OFF_DEFAULT = ['gas', 'pa']   // protected areas: drawn around a picked report instead (Josh 2026-11-02)
const MATCHES = [
  { id: 'named', label: 'Names a Lake Michigan water' },
  { id: 'basin', label: 'Reached a river, lake or harbor inside the basin' },
  { id: 'drain', label: 'Reached a storm drain or sewer' },
  { id: 'water', label: 'Reached a river, lake, bay or the sea' },   // states (national.py)
]
const MATCHES_OFF_DEFAULT = ['drain']
const PT = '#ff1f3d'    // report points: alarm red, with a glow beneath
const EMPTY = { type: 'FeatureCollection', features: [] }
const absUrl = (p) => new URL(p, window.location.origin).href

// ─── Shareable URL state ────────────────────────────────────────────────────
//   bm, ph       basemap, photos           lat,lng,z   camera
//   rg           region: a state's postal code, or Lake Michigan (default, omitted)
//   y0, y1       first and last year shown (default: the latest year)
//   ly           layers on/off where they differ from the default ("-esi,-pa")
//   po           location kinds turned off (PRECISION ids)     mo   match bases on/off where they differ from the default
//   sel          "r:<NRC report>" | "p:<place>" | "g:<lng>,<lat>" (reports at one spot) | "e:<ESI class>|<segment classes>"
//                | "a:<protected area index>" | "x:<PHMSA pipeline accident report>" | "q:<PHMSA gas incident>"
function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), y0: num('y0'), y1: num('y1'), layersOff: plusMinus(sp.get('ly'), LAYERS, LAYERS_OFF_DEFAULT),
    precOff: (sp.get('po') || '').split(',').filter((id) => PRECISION_BY_ID[id]),
    matchOff: plusMinus(sp.get('mo'), MATCHES.map((m) => m.id), MATCHES_OFF_DEFAULT),
    sel: sp.get('sel'), rg: /^[A-Z]{2}$/.test(sp.get('rg') || '') ? sp.get('rg') : 'lm',
  }
}
// "+id,-id" against a default set of ids that are off
function plusMinus(v, ids, offDefault) {
  const off = new Set(offDefault)
  for (const t of (v || '').split(',')) { const id = t.slice(1); if (!ids.includes(id)) continue; t[0] === '+' ? off.delete(id) : off.add(id) }
  return off
}
const toPlusMinus = (off, ids, offDefault) => ids.filter((id) => off.has(id) !== offDefault.includes(id)).map((id) => `${off.has(id) ? '-' : '+'}${id}`).join(',')
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

function circle(lng, lat, km) {
  const coords = []
  const dLat = km / 110.574, dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180))
  for (let i = 0; i <= 64; i++) { const a = (i / 64) * 2 * Math.PI; coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]) }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}
const spotKey = (p) => `${p.lon},${p.lat}`

export default function SpillsApp() {
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
  const [layersOff, setLayersOff] = useState(initial.layersOff)
  const [precOff, setPrecOff] = useState(() => new Set(initial.precOff))
  const [matchOff, setMatchOff] = useState(initial.matchOff)
  const [sel, setSel] = useState(initial.sel)
  const [back, setBack] = useState(null)   // the list a report was opened from
  const [data, setData] = useState(null)
  const [esi, setEsi] = useState(null)
  const [protectedAreas, setProtectedAreas] = useState(null)
  const [nearShapes, setNearShapes] = useState({})   // region → its protected-area shapes (the bake's), loaded on first pick
  // National PAD-US tiles (docs/NATIONAL_DATA.md) for every region; the bake's per-region GeoJSON is the fallback.
  const [padus, setPadus] = useState(null)
  const padusRef = useRef(null)
  const tileAreaRef = useRef(new Map())   // id → area, for areas picked on the national tiles
  const [tileTick, setTileTick] = useState(0)   // re-reads `picked` once a linked area is found in the tiles
  useEffect(() => { padusSource().then((p) => { padusRef.current = p; setPadus(p) }) }, [])
  const [pipeRaw, setPipeRaw] = useState(null)
  const [gasRaw, setGasRaw] = useState(null)
  const [error, setError] = useState(null)

  // Region: Lake Michigan (with NOAA ESI) or a state (critical habitat only, so far). Files come from the manifest.
  const [region, setRegion] = useState(initial.rg)
  const [files, setFiles] = useState(null)
  const [regionList, setRegionList] = useState(null)
  const fitRegionRef = useRef(false)
  useEffect(() => {
    if (!files) return
    let live = true
    loadRegion(files, region).then((d) => { if (live) { setData(d); setError(null) } })
      .catch(() => { if (live) setError('The spill reports did not load. Reload to try again.') })
    return () => { live = false }
  }, [files, region])
  useEffect(() => {
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json() })
    loadSpillsFiles().then((f) => {
      setFiles(f)
      loadRegionList(f).then(setRegionList)
      get(f.esi).then(setEsi).catch(() => {})
      get(f.protected).then(setProtectedAreas).catch(() => {})
      get(f.pipe).then(setPipeRaw).catch(() => {})
      if (f.gas) get(f.gas).then(setGasRaw).catch(() => {})
    })
  }, [])

  const yearsAll = data?.summary.years || [2015, 2026]
  // newest report date in the bake (the current year's NRC file is partial)
  const latest = useMemo(() => (data ? data.points.reduce((m, p) => (p.d > m ? p.d : m), '') : ''), [data])
  const [y0, setY0] = useState(initial.y0)
  const [y1, setY1] = useState(initial.y1)
  const from = y0 ?? yearsAll[1], to = y1 ?? yearsAll[1]
  // Year shortcuts, all ending at the latest year; anything else shows the two year selectors.
  const presets = [
    { id: 'p1', label: `${yearsAll[1]} so far`, n: 1 },
    { id: 'p2', label: 'Past 2 years', n: 2 },
    { id: 'p5', label: 'Past 5 years', n: 5 },
    { id: 'all', label: `All years (${yearsAll[0]}–${yearsAll[1]})`, n: yearsAll[1] - yearsAll[0] + 1 },
  ]
  const preset = to === yearsAll[1] ? presets.find((p) => from === Math.max(yearsAll[0], yearsAll[1] - p.n + 1))?.id : null
  const [custom, setCustom] = useState(false)
  const yrLabel = from === to ? String(from) : `${from}–${to}`

  // Reports in the years and kinds shown; `inYears` ignores the kind filters (for the counts beside them).
  const inYears = useMemo(() => (data ? data.points.filter((p) => p.y >= from && p.y <= to && !matchOff.has(p.match)) : []), [data, from, to, matchOff])
  const shown = useMemo(() => inYears.filter((p) => p.loc && !precOff.has(p.loc)), [inYears, precOff])
  const bySeq = useMemo(() => new Map((data?.points || []).map((p) => [p.seq, p])), [data])
  const shownSeq = useMemo(() => new Set(shown.map((p) => p.seq)), [shown])
  // Most-reported places: each report counts under the place its 5 km cell is known by (the bake's commonest nearest
  // city in that cell), so misspelled city names and the reports around one town add up together.
  const places = useMemo(() => {
    if (!data) return []
    const label = new Map()
    for (const h of data.hotspots) if (h.places[0]) for (const sq of h.seqs) label.set(sq, h.places[0])
    const by = new Map()
    for (const p of shown) {
      const name = label.get(p.seq) || p.city
      if (!name) continue
      const pl = by.get(name) || { id: name, name, pts: [], states: {} }
      pl.pts.push(p); pl.states[p.st] = (pl.states[p.st] || 0) + 1
      by.set(name, pl)
    }
    return [...by.values()].map((pl) => {
      const near = (p, test) => (p.sp || []).some((i) => test(data.species[i]))
      return { ...pl, n: pl.pts.length, st: Object.entries(pl.states).sort((a, b) => b[1] - a[1])[0][0],
        listed: pl.pts.filter((p) => near(p, isListed)).length, fed: pl.pts.filter((p) => near(p, (sp) => !!sp.fed)).length,
        wetland: pl.pts.filter((p) => p.e && esiNumber(p.e) >= 9).length,
        top: (() => {
          const esiTop = nearbyHighlights(pl.pts.flatMap((p) => p.sp || []), data.species).listed.slice(0, 3).map((sp) => sp.n)
          if (esiTop.length) return esiTop
          const c = new Map()
          for (const p of pl.pts) for (const { sp } of critNear(p, data.ch_species || [])) c.set(sp.n, (c.get(sp.n) || 0) + 1)
          return [...c].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n)
        })() }
    }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [data, shown])
  const [allPlaces, setAllPlaces] = useState(false)
  // U.S. pipeline accidents (PHMSA), decoded from the compact layer file; shown for the same years as the reports.
  const decode = (raw) => (raw ? raw.rows.map((r) => {
    const a = Object.fromEntries(raw.fields.map((f, k) => [f, r[k]]))
    a.o = raw.operators[a.o]
    return a
  }) : [])
  const pipes = useMemo(() => decode(pipeRaw), [pipeRaw])
  // Gas pipeline incidents (PHMSA gas forms): their own layer, off by default.
  const gases = useMemo(() => decode(gasRaw), [gasRaw])
  const gasById = useMemo(() => new Map(gases.map((g) => [g.id, g])), [gases])
  const gasShown = useMemo(() => gases.filter((g) => g.y >= from && g.y <= to), [gases, from, to])
  const pipeById = useMemo(() => new Map(pipes.map((a) => [a.id, a])), [pipes])
  const pipesShown = useMemo(() => pipes.filter((a) => a.y >= from && a.y <= to), [pipes, from, to])
  const precCount = useMemo(() => { const c = {}; for (const p of inYears) if (p.loc) c[p.loc] = (c[p.loc] || 0) + 1; return c }, [inYears])
  const unlocated = inYears.filter((p) => !p.loc).length

  // ─── Picked item ──────────────────────────────────────────────────────────
  const picked = useMemo(() => {
    if (!sel || !data) return null
    if (sel.startsWith('r:')) { const p = bySeq.get(sel.slice(2)); return p ? { kind: 'report', p } : null }
    if (sel.startsWith('p:')) { const pl = places.find((x) => x.id === sel.slice(2)); return pl ? { kind: 'place', pl } : null }
    if (sel.startsWith('g:')) { const pts = shown.filter((p) => spotKey(p) === sel.slice(2)); return pts.length ? { kind: 'spot', pts } : null }
    if (sel.startsWith('q:')) { const g = gasById.get(sel.slice(2)); return g ? { kind: 'gas', g } : null }
    if (sel.startsWith('x:')) { const a = pipeById.get(sel.slice(2)); return a ? { kind: 'pipe', a } : null }
    if (sel.startsWith('A:')) { const a = tileAreaRef.current.get(sel.slice(2)); return a ? { kind: 'area', i: -1, tile: sel.slice(2), a } : null }
    if (sel.startsWith('a:')) { const a = data.areas?.[+sel.slice(2)]; return a ? { kind: 'area', i: +sel.slice(2), a } : null }
    if (sel.startsWith('e:')) { const [code, segment] = sel.slice(2).split('|'); return { kind: 'esi', code, segment: segment || code } }
    return null
  }, [sel, data, bySeq, places, shown, pipeById, gasById, tileTick])
  const pick = (v, from = null) => { setBack(from); setSel(v) }
  // A place from the list: open its reports and frame them.
  useEffect(() => {
    const map = mapRef.current
    if (!data || !map || !fitRegionRef.current) return
    fitRegionRef.current = false
    const pts = data.points.filter((p) => p.loc)
    if (!pts.length) return
    const xs = pts.map((p) => p.lon).sort((a, b) => a - b), ys = pts.map((p) => p.lat).sort((a, b) => a - b)
    const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))]   // 1st–99th percentile: a few stray points don't zoom out to the ocean
    map.fitBounds([[q(xs, 0.01), q(ys, 0.01)], [q(xs, 0.99), q(ys, 0.99)]],
      { padding: { top: 80, bottom: 60, left: window.innerWidth > 768 ? 400 : 40, right: 60 }, maxZoom: 10, duration: 900 })
  }, [data])
  const pickPlace = (pl) => {
    pick(`p:${pl.id}`)
    const map = mapRef.current
    if (!map) return
    const xs = pl.pts.map((p) => p.lon), ys = pl.pts.map((p) => p.lat)
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
      { padding: { top: 80, bottom: 60, left: window.innerWidth > 768 ? 400 : 40, right: window.innerWidth > 768 ? 470 : 40 }, maxZoom: 12, duration: 800 })
  }

  // ─── Map init (once) ──────────────────────────────────────────────────────
  const clickRef = useRef(null)
  const hoverRef = useRef(null)
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current, style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center, zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom,
      preserveDrawingBuffer: true,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('style.load', () => { addLayers(map); setMapReady(true) })
    map.on('click', (e) => clickRef.current?.(e))
    const offHover = installHoverTip(map, { layers: ['sp-pts', 'sp-pipe', 'sp-gas', 'sp-esi', 'sp-pa-fill'], html: (feats) => hoverRef.current?.(feats) || null })
    return () => { offHover(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Protected areas: the national PAD-US tiles when published (or built locally), else the bake's GeoJSON. Re-added when
  // the tiles turn up after the map, under the shoreline and reports either way.
  function addPaLayers(map) {
    for (const id of ['sp-pa-hi', 'sp-pa-line', 'sp-pa-fill']) if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource('sp-pa')) map.removeSource('sp-pa')
    const p = padusRef.current
    const before = map.getLayer('sp-esi-casing') ? 'sp-esi-casing' : undefined
    const sl = p ? { 'source-layer': 'padus', filter: PADUS_FILTER } : {}
    const key = p ? 'id' : 'i'
    map.addSource('sp-pa', p ? p.source : { type: 'geojson', data: EMPTY, tolerance: 0.5 })
    map.addLayer({ id: 'sp-pa-fill', type: 'fill', source: 'sp-pa', ...sl, paint: { 'fill-color': PA_COLOR, 'fill-opacity': ['case', ['==', ['to-string', ['get', key]], '-1'], 0.5, PADUS_FILL_OPACITY] } }, before)
    map.addLayer({ id: 'sp-pa-line', type: 'line', source: 'sp-pa', ...sl, paint: { 'line-color': PA_COLOR, 'line-opacity': PADUS_LINE_OPACITY, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 9, 1, 12, 2] } }, before)
    map.addLayer({ id: 'sp-pa-hi', type: 'line', source: 'sp-pa', ...sl, filter: ['==', ['to-string', ['get', key]], '-1'], paint: { 'line-color': '#ffffff', 'line-width': 2.2 } }, before)
  }
  useEffect(() => { const map = mapRef.current; if (padus && mapReady && map?.getSource('sp-pa')) { addPaLayers(map); syncRef.current?.() } }, [padus, mapReady])
  // A shared link to an area on the national tiles (sel=A:<id>): find it in the loaded tiles once the map is idle.
  useEffect(() => {
    const map = mapRef.current
    if (!padus || !mapReady || !sel?.startsWith('A:') || tileAreaRef.current.has(sel.slice(2))) return
    const id = sel.slice(2)
    const find = () => {
      const f = map.querySourceFeatures('sp-pa', { sourceLayer: 'padus', filter: ['==', ['to-string', ['get', 'id']], id] })[0]
      if (f) { tileAreaRef.current.set(id, padusArea(f.properties)); setSel((s) => s) ; setTileTick((t) => t + 1) }
    }
    map.once('idle', find)
    return () => map.off('idle', find)
  }, [padus, mapReady, sel])

  function addLayers(map) {
    if (map.getSource('sp-pts')) return
    for (const id of ['sp-pts', 'sp-esi', 'sp-ring', 'sp-pipe', 'sp-gas']) map.addSource(id, { type: 'geojson', data: EMPTY })
    // Protected areas: Mapbox simplifies each zoom's tiles itself; a fine tolerance keeps the outlines true to the land.
    addPaLayers(map)
    // Protected areas (PAD-US) under everything else, in one clear green; how strongly each is protected is in its card.
    const esiMatch = ['match', ['get', 'c']]
    for (const [code, color] of Object.entries(ESI_COLORS)) esiMatch.push(code, color)
    esiMatch.push('#9ca3af')
    map.addLayer({ id: 'sp-esi-casing', type: 'line', source: 'sp-esi', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#0a0e17', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 4, 14, 7] } })
    map.addLayer({ id: 'sp-esi', type: 'line', source: 'sp-esi', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': esiMatch, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2.4, 14, 4.5] } })
    // The report's search radius: red dashes on a white outline, so it reads on satellite, dark and light maps.
    // The protected areas inside a picked report's radius (the card's "What could be harmed"), whatever the layer toggle.
    map.addSource('sp-pa-near', { type: 'geojson', data: EMPTY, tolerance: 0.3 })
    map.addLayer({ id: 'sp-pa-near-fill', type: 'fill', source: 'sp-pa-near', paint: { 'fill-color': PA_COLOR, 'fill-opacity': ['case', ['get', 'big'], 0, 0.3] } })
    map.addLayer({ id: 'sp-pa-near-line', type: 'line', source: 'sp-pa-near', paint: { 'line-color': PA_COLOR, 'line-width': 1.5 } })
    map.addLayer({ id: 'sp-ring-casing', type: 'line', source: 'sp-ring', paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-opacity': 0.9 } })
    map.addLayer({ id: 'sp-ring', type: 'line', source: 'sp-ring', paint: { 'line-color': '#ff1f3d', 'line-width': 2.2, 'line-dasharray': [2, 1.5] } })
    // Report points, styled by how precisely the report could be placed: solid = reported coordinates, smaller and
    // translucent = street address / named site / distance from a city, hollow ring = nearest city only (sized by how
    // many reports share that city's point).
    // Pipeline accidents (PHMSA): orange diamonds sized by barrels released, under the NRC report points.
    if (!map.hasImage('sp-diamond')) {
      const n = 64, c = document.createElement('canvas'); c.width = c.height = n
      const x = c.getContext('2d')
      x.beginPath(); x.moveTo(n / 2, 3); x.lineTo(n - 3, n / 2); x.lineTo(n / 2, n - 3); x.lineTo(3, n / 2); x.closePath()
      x.fillStyle = PIPE_COLOR; x.fill(); x.lineWidth = 5; x.strokeStyle = '#ffffff'; x.stroke()
      map.addImage('sp-diamond', x.getImageData(0, 0, n, n), { pixelRatio: 2 })
    }
    // Gas pipeline incidents: purple triangles sized by gas released.
    if (!map.hasImage('sp-tri')) {
      const n = 64, c = document.createElement('canvas'); c.width = c.height = n
      const x = c.getContext('2d')
      x.beginPath(); x.moveTo(n / 2, 4); x.lineTo(n - 4, n - 6); x.lineTo(4, n - 6); x.closePath()
      x.fillStyle = GAS_COLOR; x.fill(); x.lineWidth = 5; x.strokeStyle = '#ffffff'; x.stroke()
      map.addImage('sp-tri', x.getImageData(0, 0, n, n), { pixelRatio: 2 })
    }
    map.addLayer({ id: 'sp-gas', type: 'symbol', source: 'sp-gas', layout: {
      'icon-image': 'sp-tri', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['+', 0.3, ['*', 0.055, ['ln', ['+', 1, ['get', 'mcf']]]]],
      'symbol-sort-key': ['get', 'mcf'],
    }, paint: { 'icon-opacity': ['case', ['boolean', ['get', 'hot'], false], 1, 0.9] } })
    map.addLayer({ id: 'sp-pipe', type: 'symbol', source: 'sp-pipe', layout: {
      'icon-image': 'sp-diamond', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['+', 0.32, ['*', 0.09, ['ln', ['+', 1, ['get', 'bbl']]]]],
      'symbol-sort-key': ['get', 'bbl'],
    }, paint: { 'icon-opacity': ['case', ['boolean', ['get', 'hot'], false], 1, 0.92] } })
    const g = ['get', 'pg']
    map.addLayer({ id: 'sp-pts-glow', type: 'circle', source: 'sp-pts', paint: {
      'circle-color': PT, 'circle-blur': 1, 'circle-opacity': ['match', g, 'city', 0.35, 0.55],
      'circle-radius': ['match', g, 'exact', 13, 'near', 10, ['+', 9, ['*', 2, ['sqrt', ['get', 'n']]]]],
    } })
    map.addLayer({ id: 'sp-pts', type: 'circle', source: 'sp-pts', paint: {
      'circle-color': ['match', g, 'city', 'rgba(0,0,0,0)', PT],
      'circle-opacity': ['match', g, 'near', 0.85, 1],
      'circle-radius': ['case', ['boolean', ['get', 'hot'], false], 9,
        ['match', g, 'exact', 5.5, 'near', 4.2, ['+', 5, ['*', 1.6, ['sqrt', ['get', 'n']]]]]],
      'circle-stroke-color': ['match', g, 'city', PT, '#ffffff'],
      'circle-stroke-width': ['match', g, 'city', 2.4, 'exact', 1.6, 0.8],
      'circle-stroke-opacity': 1,
    } })
    map.addLayer({ id: 'sp-pts-n', type: 'symbol', source: 'sp-pts', filter: ['all', ['==', g, 'city'], ['>', ['get', 'n'], 1]], layout: {
      'text-field': ['to-string', ['get', 'n']], 'text-size': 10.5, 'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'], 'text-allow-overlap': true,
    }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0e17', 'text-halo-width': 1.4 } })
    syncRef.current?.()
  }

  // ─── Map data ─────────────────────────────────────────────────────────────
  const sync = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.getSource('sp-pts')) return
    const on = (id) => !layersOff.has(id)
    const selSeq = picked?.kind === 'report' ? picked.p.seq : null
    const inPlace = picked?.kind === 'place' ? new Set(picked.pl.pts.map((p) => p.seq)) : null
    const feats = []
    if (on('reports')) {
      const cityAgg = new Map()
      for (const p of shown) {
        const pg = PRECISION_BY_ID[p.loc].group
        if (pg === 'city') {
          const k = spotKey(p)
          const a = cityAgg.get(k) || { lon: p.lon, lat: p.lat, n: 0, seqs: [] }
          a.n++; a.seqs.push(p.seq); cityAgg.set(k, a)
          continue
        }
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { seq: p.seq, pg, n: 1, hot: p.seq === selSeq || !!inPlace?.has(p.seq) } })
      }
      for (const a of cityAgg.values()) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { pg: 'city', n: a.n, spot: `${a.lon},${a.lat}`, seq: a.n === 1 ? a.seqs[0] : '' } })
      feats.sort((a, b) => (a.properties.pg === 'city') - (b.properties.pg === 'city') || a.properties.hot - b.properties.hot).reverse()
    }
    map.getSource('sp-pts').setData({ type: 'FeatureCollection', features: feats })
    map.getSource('sp-esi').setData(on('esi') && esi ? esi : EMPTY)
    const vec = map.getSource('sp-pa')?.type === 'vector'
    if (vec) for (const id of ['sp-pa-fill', 'sp-pa-line', 'sp-pa-hi']) map.setLayoutProperty(id, 'visibility', on('pa') ? 'visible' : 'none')
    else map.getSource('sp-pa').setData(on('pa') && protectedAreas ? protectedAreas : EMPTY)
    const key = vec ? 'id' : 'i'
    const ai = picked?.kind !== 'area' ? '-1' : String(vec ? picked.tile ?? -1 : picked.i)
    map.setFilter('sp-pa-hi', ['==', ['to-string', ['get', key]], ai])
    map.setPaintProperty('sp-pa-fill', 'fill-opacity', ['case', ['==', ['to-string', ['get', key]], ai], 0.5, PADUS_FILL_OPACITY])
    const selPipe = picked?.kind === 'pipe' ? picked.a.id : null
    map.getSource('sp-pipe').setData(on('pipe') ? { type: 'FeatureCollection', features: pipesShown.map((a) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] }, properties: { id: a.id, bbl: a.bbl || 0, hot: a.id === selPipe },
    })) } : EMPTY)
    const selGas = picked?.kind === 'gas' ? picked.g.id : null
    map.getSource('sp-gas').setData(on('gas') ? { type: 'FeatureCollection', features: gasShown.map((g) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: { id: g.id, mcf: g.mcf || 0, hot: g.id === selGas },
    })) } : EMPTY)
    const ring = picked?.kind === 'report' && picked.p.loc ? circle(picked.p.lon, picked.p.lat, picked.p.r / 1000)
      : picked?.kind === 'pipe' && data?.pipes?.[picked.a.id] ? circle(picked.a.lon, picked.a.lat, data.pipes[picked.a.id].r / 1000) : EMPTY
    map.getSource('sp-ring').setData(ring)
    const nearIds = new Set((picked?.kind === 'report' ? picked.p.pa : picked?.kind === 'pipe' ? data?.pipes?.[picked.a.id]?.pa : null)?.map((x) => x[0]) || [])
    const shapes = nearShapes[data?.region]
    // an area bigger than the ring (a national monument, a county-wide marine preserve) is outlined, not filled
    const ringR = picked?.kind === 'report' ? picked.p.r : picked?.kind === 'pipe' ? data?.pipes?.[picked.a.id]?.r : 0
    const ringAc = Math.PI * (ringR || 0) ** 2 / 4046.86
    map.getSource('sp-pa-near').setData(nearIds.size && shapes ? { type: 'FeatureCollection', features: shapes.features.filter((f) => nearIds.has(f.properties.i))
      .map((f) => ({ ...f, properties: { ...f.properties, big: (data.areas?.[f.properties.i]?.ac || 0) > ringAc } })) } : EMPTY)
  }, [shown, esi, protectedAreas, nearShapes, pipesShown, gasShown, data, layersOff, picked])
  // A picked report's nearby areas come from its region's shape file (Lake Michigan's, or the state's), fetched once.
  useEffect(() => {
    const rg = data?.region
    const has = picked?.kind === 'report' ? picked.p.pa?.length : picked?.kind === 'pipe' ? data?.pipes?.[picked.a.id]?.pa?.length : 0
    if (!has || !files || !rg || nearShapes[rg]) return
    const url = rg === 'lm' ? files.protected : files.statePaDir && `${files.statePaDir}${rg}.geojson`
    if (url) fetch(url).then((r) => (r.ok ? r.json() : null)).then((g) => g && setNearShapes((m) => ({ ...m, [rg]: g }))).catch(() => {})
  }, [picked, data, files, nearShapes])
  const syncRef = useRef(null)
  useEffect(() => { syncRef.current = sync; if (mapReady) sync() }, [sync, mapReady])

  // Clicks: a report opens its card (several at one spot open their list); a shoreline
  // segment opens its ESI class. Anywhere else closes the card.
  clickRef.current = (e) => {
    const map = mapRef.current
    const hits = map.queryRenderedFeatures(e.point, { layers: ['sp-pts', 'sp-pipe', 'sp-gas', 'sp-esi', 'sp-pa-fill'].filter((l) => map.getLayer(l)) })
    const pt = hits.find((f) => f.layer.id === 'sp-pts')
    if (pt) {
      const { seq, spot, n } = pt.properties
      if (seq) return pick(`r:${seq}`)
      if (spot && n > 1) return pick(`g:${spot}`)
    }
    const pipe = hits.find((f) => f.layer.id === 'sp-pipe')
    if (pipe) return pick(`x:${pipe.properties.id}`)
    const gf = hits.find((f) => f.layer.id === 'sp-gas')
    if (gf) return pick(`q:${gf.properties.id}`)
    const line = hits.find((f) => f.layer.id === 'sp-esi')
    if (line) return pick(`e:${line.properties.c}|${line.properties.esi}`)
    // overlapping areas (a wilderness study area on BLM land): the smallest one under the click is the most specific
    const area = hits.filter((f) => f.layer.id === 'sp-pa-fill').sort((a, b) => (Number(a.properties.GIS_Acres) || Infinity) - (Number(b.properties.GIS_Acres) || Infinity))[0]
    if (area && map.getSource('sp-pa')?.type === 'vector') {
      const a = padusArea(area.properties)
      tileAreaRef.current.set(String(a.id), a)
      return pick(`A:${a.id}`)
    }
    if (area) return pick(`a:${area.properties.i}`)
    pick(null)
  }

  // "Could be harmed nearby" lines for hover readouts.
  const harmTip = (ids, e, home, pa = [], ch = []) => {
    const h = nearbyHighlights(ids, data.species)
    const crit = critNear({ ch }, data.ch_species || [])
    const paNames = [...new Set(pa.map(([i]) => data.areas[i].n))]
    const names = h.listed.slice(0, 3).map((sp) => `<b>${esc(sp.n)}</b> <span class="${styles.tipStatus}">${esc(statusShort(sp, home))}</span>`).join('<br>')
    return `<div class="${styles.tipHarm}"><div class="${styles.tipHarmHead}">Could be harmed nearby</div>
      ${e ? `<div>${esc(esiShort(e))} shoreline (${esiNumber(e)} of 10)</div>` : ''}
      ${names || (crit.length ? '' : (data.species.length ? '<div>No listed species mapped here</div>' : ''))}
      ${crit.length ? `<div>Critical habitat: ${esc(crit.slice(0, 2).map((c) => c.sp.n).join(', '))}${crit.length > 2 ? ` +${crit.length - 2} more` : ''}</div>` : ''}
      ${h.listed.length > 3 ? `<div>+${h.listed.length - 3} more listed species</div>` : ''}
      ${data.species.length ? `<div class="${styles.tipDim}">${h.other} other wildlife and habitat areas</div>` : ''}
      ${paNames.length ? `<div>Protected areas: ${esc(paNames.slice(0, 2).join(', '))}${paNames.length > 2 ? ` +${paNames.length - 2} more` : ''}</div>` : ''}</div>`
  }
  hoverRef.current = (feats) => {
    const pt = feats.find((f) => f.layer.id === 'sp-pts')
    if (pt) {
      const { seq, spot, n } = pt.properties
      if (!seq && spot) {
        const pts = shown.filter((p) => spotKey(p) === spot)
        return `<div class="${styles.tip}"><div class="${styles.tipTitle}">${n} reports placed at ${esc(pts[0]?.city || '')}, ${esc(pts[0]?.st || '')}</div>
          ${harmTip(pts.flatMap((p) => p.sp || []), null, pts[0]?.st, pts.flatMap((p) => p.pa || []), [...new Map(pts.flatMap((p) => p.ch || []).map((c) => [c[0], c])).values()])}
          <div class="${styles.tipDim}">Nearest city only: the reports give no closer location</div><div class="${styles.tipDim}">Unverified initial reports · click for the list</div></div>`
      }
      const p = bySeq.get(seq)
      if (!p) return null
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}">${esc(fmtDate(p.d))} · ${esc(p.m[0] ? titleCase(p.m[0]) : 'Material not given')}</div>
        <div>${esc(p.t)}${p.g != null ? ` · ${fmtInt(Math.round(p.g))} gal reported` : ''}${p.city ? ` · ${esc(p.city)}, ${esc(p.st)}` : ''}</div>
        ${harmTip(p.sp || [], p.e, p.st, p.pa || [], p.ch || [])}
        <div class="${styles.tipDim}">Placed by ${esc(PRECISION_BY_ID[p.loc].short)}</div>
        <div class="${styles.tipDim}">Unverified initial report (NRC ${esc(p.seq)}) · click for its card</div></div>`
    }
    const pf = feats.find((f) => f.layer.id === 'sp-pipe')
    const pa = pf && pipeById.get(pf.properties.id)
    if (pa) {
      const ex = data?.pipes?.[pa.id]
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}">${esc(fmtDate(pa.d))} · Pipeline accident</div>
        <div><b>${esc(bblText(pa.bbl))}</b> of ${esc((COMMODITY_PLAIN[pa.c] || 'material').toLowerCase())} released</div>
        <div>${esc(pa.o)}${pa.city ? ` · ${esc(pa.city)}, ${esc(pa.st)}` : pa.st ? ` · ${esc(pa.st)}` : ''}</div>
        ${ex ? harmTip(ex.sp, ex.e, pa.st, ex.pa) : ''}
        <div class="${styles.tipDim}">Operator’s report to PHMSA (${esc(pa.id)}) · click for its card</div></div>`
    }
    const gq = feats.find((f) => f.layer.id === 'sp-gas')
    const gi = gq && gasById.get(gq.properties.id)
    if (gi) {
      const harms = [gi.fat ? `${gi.fat} killed` : '', gi.inj ? `${gi.inj} injured` : '', gi.fire ? 'fire' : '', gi.boom ? 'explosion' : ''].filter(Boolean)
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}">${esc(fmtDate(gi.d))} · Gas pipeline incident</div>
        <div><b>${esc(mcfText(gi.mcf))}</b> of gas released</div>
        ${harms.length ? `<div>${esc(harms.join(' · '))}</div>` : ''}
        <div>${esc(gi.o)}${gi.city ? ` · ${esc(gi.city)}, ${esc(gi.st)}` : gi.st ? ` · ${esc(gi.st)}` : ''}</div>
        <div class="${styles.tipDim}">${esc(GAS_SYSTEM[gi.s])} · PHMSA · click for its card</div></div>`
    }
    const line = feats.find((f) => f.layer.id === 'sp-esi')
    if (line) {
      const c = line.properties.c
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}"><span class="${styles.tipSq}" style="background:${esiColor(c)}"></span>${esc(esiShort(c))}</div>
        <div>${esc(esiLevel(c))} by oil (${esiNumber(c)} of 10). ${esc(esiSentence(c))}</div>
        <div class="${styles.tipDim}">NOAA ESI ${esc(line.properties.esi)} · click for more</div></div>`
    }
    const area = feats.find((f) => f.layer.id === 'sp-pa-fill')
    const a = area && (area.properties.id != null && area.properties.i == null ? padusArea(area.properties) : data?.areas?.[area.properties.i])
    if (a) {
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}"><span class="${styles.tipSq}" style="background:${PA_COLOR}"></span>${esc(a.n)}</div>
        <div>${esc(a.d)} · ${esc(MANAGER[a.mt] || a.mt)}</div><div>${esc(gapOf(a).label)}</div>
        <div class="${styles.tipDim}">USGS PAD-US · click for more</div></div>`
    }
    return null
  }

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  // ─── Persist the view to the URL ──────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (basemap !== 'satellite') sp.set('bm', basemap)
    writePhoto(sp, photos.photo)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    if (y0 != null && y0 !== yearsAll[1]) sp.set('y0', String(y0))
    if (y1 != null && y1 !== yearsAll[1]) sp.set('y1', String(y1))
    const ly = toPlusMinus(layersOff, LAYERS, LAYERS_OFF_DEFAULT)
    if (ly) sp.set('ly', ly)
    if (precOff.size) sp.set('po', [...precOff].join(','))
    const mo = toPlusMinus(matchOff, MATCHES.map((m) => m.id), MATCHES_OFF_DEFAULT)
    if (mo) sp.set('mo', mo)
    if (sel) sp.set('sel', sel)
    if (region !== 'lm') sp.set('rg', region)
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, photos.photo, mapView, y0, y1, layersOff, precOff, matchOff, sel, mapReady])

  const areaName = data?.name || (region === 'lm' ? 'Lake Michigan' : null)
  useEffect(() => {
    const prev = document.title
    document.title = `Fossil Fuel Spills & Releases${areaName ? ` — ${areaName}` : ''} · EarthAtlas`
    return () => { document.title = prev }
  }, [areaName])

  const toggle = (setter) => (id) => setter((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleLayer = toggle(setLayersOff), togglePrec = toggle(setPrecOff), toggleMatch = toggle(setMatchOff)

  if (!MAPBOX_TOKEN) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  const years = []
  for (let y = yearsAll[0]; y <= yearsAll[1]; y++) years.push(y)
  const usedEsi = Object.keys(data?.esi_names || {}).sort((a, b) => esiNumber(a) - esiNumber(b) || a.localeCompare(b))
  const listedNear = shown.filter((p) => (p.sp || []).some((i) => isListed(data.species[i])) || (p.ch || []).length > 0).length
  const ext = { target: '_blank', rel: 'noopener noreferrer' }

  let card = null
  if (picked?.kind === 'report') {
    card = <ReportCard p={picked.p} species={data.species} areas={data.areas || []} esiNames={data.esi_names} onClose={() => pick(null)} onBack={back ? () => pick(back) : null} onArea={(i) => pick(`a:${i}`, sel)}
      pipe={picked.p.ph ? pipeById.get(picked.p.ph) : null} onPipe={(id) => pick(`x:${id}`, sel)} chSpecies={data.ch_species || []} />
  } else if (picked?.kind === 'place') {
    const pl = picked.pl
    const sp = [...new Set(pl.pts.flatMap((p) => p.sp || []))]
    card = (
      <ListCard title={`${pl.name}, ${pl.st}`} meta={`${fmtInt(pl.n)} oil spill report${pl.n === 1 ? '' : 's'}, ${yrLabel}`}
        points={pl.pts} onPick={(seq) => pick(`r:${seq}`, sel)} onClose={() => pick(null)}>
        <ul className={styles.placeFacts}>
          <li><b>{fmtInt(pl.fed)}</b> of these were near a federally listed species</li>
          <li><b>{fmtInt(pl.listed)}</b> were near a state- or federally-listed species</li>
          <li><b>{fmtInt(pl.wetland)}</b> were near the most oil-sensitive shorelines (ESI 9–10: wetlands, marshes, vegetated banks)</li>
        </ul>
        <div className={styles.cardSub}>Species and habitats near these reports</div>
        <SpeciesList ids={sp} species={data.species} radiusKm="each report’s distance (1–5 km) of" />
      </ListCard>
    )
  } else if (picked?.kind === 'spot') {
    const p0 = picked.pts[0]
    card = <ListCard title={`${picked.pts.length} reports placed at ${p0.city}, ${p0.st}`} meta={`${yrLabel} · ${PRECISION_BY_ID[p0.loc].label}`}
      points={picked.pts} onPick={(seq) => pick(`r:${seq}`, sel)} onClose={() => pick(null)} />
  } else if (picked?.kind === 'gas') {
    card = <GasCard g={picked.g} onClose={() => pick(null)} onBack={back ? () => pick(back) : null} />
  } else if (picked?.kind === 'pipe') {
    card = <PipeCard a={picked.a} exposure={data?.pipes?.[picked.a.id] || null} species={data?.species || []} areas={data?.areas || []}
      nrcOnMap={(n) => bySeq.has(n)} onReport={(n) => pick(`r:${n}`, sel)} onArea={(i) => pick(`a:${i}`, sel)}
      onClose={() => pick(null)} onBack={back ? () => pick(back) : null} />
  } else if (picked?.kind === 'area') {
    card = <AreaCard a={picked.a} onClose={() => pick(null)} onBack={back ? () => pick(back) : null} />
  } else if (picked?.kind === 'esi') {
    card = <ShoreCard code={picked.code} esi={picked.segment} esiNames={data?.esi_names || {}} onClose={() => pick(null)} />
  }

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <SiteBrand styles={q}>
        <span className={q.subBadge}>Fossil Fuel Spills &amp; Releases</span>
      </SiteBrand>

      <MapSearch className={q.searchBox}>
        <GeoSearch placeholder={areaName ? `Search a place ${region === 'lm' ? 'on' : 'in'} ${areaName}…` : 'Search a place…'}
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => flyToSearchResult(mapRef.current, r)} />
      </MapSearch>

      {card && <div className={styles.cardWrap}>{card}</div>}

      <BasemapMenu basemaps={BASEMAPS} basemap={basemap} onBasemap={setBasemap} photos={photos} className={q.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} />

      <MapSheet title="Fossil Fuel Spills & Releases" summary={data ? `${fmtInt(shown.length)} reports · ${yrLabel}` : ''} className={styles.panel}>
        <div className={styles.panelBody}>
          <div className={styles.title}>Fossil Fuel Spills &amp; Releases
            {/* the report for these years and filters (/spills/reports) */}
            <a className={styles.src} style={{ float: 'right', fontSize: 12, fontWeight: 500, lineHeight: '20px', marginRight: 26 }} href={`/spills/reports${(() => { const r = new URLSearchParams(); if (y0 != null || y1 != null) { r.set('y0', String(from)); if (to !== yearsAll[1]) r.set('y1', String(to)) } const mo = toPlusMinus(matchOff, MATCHES.map((m) => m.id), MATCHES_OFF_DEFAULT); if (mo) r.set('mo', mo); if (precOff.size) r.set('po', [...precOff].join(',')); if (region !== 'lm') r.set('scope', `st:${region}`); const s = r.toString(); return s ? `?${s}` : '' })()}`}>See the report →</a>
          </div>
          {error && <div className={styles.error}>{error}</div>}
          {!data && !error && <Loading />}
          {data && (
            <div className={styles.meta}>
              {data.name}: {fmtInt(inYears.length)} oil spill reports in {yrLabel} (<a className={styles.src} href={NRC_HOME} {...ext}>NRC ↗</a>); {fmtInt(listedNear)} near listed wildlife (<a className={styles.src} href={data.region === 'lm' ? ESI_HOME : FWS_CH} {...ext}>{data.region === 'lm' ? 'NOAA ESI' : 'FWS · NOAA'} ↗</a>).
            </div>
          )}

          <div className={styles.section}>
            <div style={{ display: 'flex', gap: 6 }}>
            {regionList && (
              <select className={styles.yearPreset} style={{ flex: 1, minWidth: 0 }} value={region} aria-label="Area"
                onChange={(e) => { fitRegionRef.current = true; setSel(null); setRegion(e.target.value) }}>
                <option value="lm">Lake Michigan</option>
                {[...regionList.regions].sort((a, b) => a.name.localeCompare(b.name)).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
            <select className={styles.yearPreset} style={{ flex: 1, minWidth: 0 }} value={custom || !preset ? 'custom' : preset} aria-label="Years shown"
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value)
                if (!p) { setCustom(true); return }
                setCustom(false); setY1(null); setY0(p.n === 1 ? null : Math.max(yearsAll[0], yearsAll[1] - p.n + 1))
              }}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              <option value="custom">Choose years…</option>
            </select>
            </div>
            {(custom || !preset) && (
              <div className={styles.years} style={{ marginTop: 6 }}>
                <select value={from} aria-label="First year" onChange={(e) => { const v = +e.target.value; setY0(v); if (v > to) setY1(v) }}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
                <span>to</span>
                <select value={to} aria-label="Last year" onChange={(e) => { const v = +e.target.value; setY1(v); if (v < from) setY0(v) }}>
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            )}
          </div>

          {data && places.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Most-reported places, {yrLabel}</div>
              <ol className={styles.places}>
                {(allPlaces ? places : places.slice(0, 3)).map((pl) => (
                  <li key={pl.id}>
                    <button type="button" className={picked?.kind === 'place' && picked.pl.id === pl.id ? styles.placeOn : undefined} onClick={() => pickPlace(pl)}>
                      <span className={styles.placeName}>{pl.name}, {pl.st}</span>
                      <span className={styles.placeN}>{fmtInt(pl.n)}</span>
                      <span className={styles.placeSub}>{pl.top.length ? <>At risk: {pl.top.join(', ')}</> : 'No listed species mapped nearby'}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {places.length > 4 && <button type="button" className={styles.linkBtn} onClick={() => setAllPlaces((v) => !v)}>{allPlaces ? 'Show the top 4' : `Show all ${places.length} places`}</button>}
            </div>
          )}

          <div className={styles.section}>
            <DatasetRow storageKey="spills.reports" name="NRC oil spill reports" hue={PT} icon={<DropIcon />}
              sub={data ? fmtInt(shown.length) : ''} on={!layersOff.has('reports')} onToggle={() => toggleLayer('reports')}
              controls={<>
                <div className={styles.sectionTitle}>Placed by</div>
                {PRECISION.map((pr) => (
                  <label key={pr.id} className={styles.toggle}>
                    <input type="checkbox" checked={!precOff.has(pr.id)} onChange={() => togglePrec(pr.id)} />{pr.label}
                    <span className={styles.count}>{fmtInt(precCount[pr.id] || 0)}</span>
                  </label>
                ))}
                {unlocated > 0 && <div className={styles.dim}>{fmtInt(unlocated)} more have no readable location and are not on the map.</div>}
                <div className={styles.sectionTitle} style={{ marginTop: 8 }}>Matched to Lake Michigan because the report</div>
                {MATCHES.filter((m) => data?.points.some((p) => p.match === m.id)).map((m) => (
                  <label key={m.id} className={styles.toggle}>
                    <input type="checkbox" checked={!matchOff.has(m.id)} onChange={() => toggleMatch(m.id)} />{m.label}
                  </label>
                ))}
              </>}
              legend={<>
                <LegendSwatchRow swatch={<span className={styles.lgExact} />}>Reported coordinates <span className={styles.count}>{fmtInt((precCount.coords || 0) + (precCount.text || 0))}</span></LegendSwatchRow>
                <LegendSwatchRow swatch={<span className={styles.lgNear} />}>Address, named site or distance from a city <span className={styles.count}>{fmtInt((precCount.address || 0) + (precCount.place || 0) + (precCount.offset || 0))}</span></LegendSwatchRow>
                <LegendSwatchRow swatch={<span className={styles.lgCity} />}>Nearest city only (number = reports there) <span className={styles.count}>{fmtInt(precCount.city || 0)}</span></LegendSwatchRow>
              </>}
              info={<>Oil and petroleum releases reported to the <a className={styles.src} href={NRC_HOME} {...ext}>National Response Center ↗</a> (U.S. Coast Guard) from {yearsAll[0]} to {latest ? fmtDate(latest) : yearsAll[1]}, as first reported by the caller. {region === 'lm' ? <>A report is included when it names Lake Michigan or one of its bays, harbors or connected waters, or when it reached water inside the Lake Michigan basin (<a className={styles.src} href={WBD} {...ext}>USGS WBD ↗</a>).</> : 'A report is included when the caller said the oil reached water.'} Each point is placed as precisely as the report allows; the card says how.</>} />

            {region === 'lm' && (
            <DatasetRow storageKey="spills.esi" name="How easily oil harms the shore" hue="#ff0000" icon={<ShoreIcon />}
              on={!layersOff.has('esi')} onToggle={() => toggleLayer('esi')}
              legend={<>
                <LegendSwatchRow swatch={<span className={styles.lgEsiRamp} />}>Purple: oil washes off · red: oil stays</LegendSwatchRow>
                <LegendTurndown storageKey="spills.esiClasses" label={`Shoreline types (${usedEsi.length})`}>
                  {usedEsi.map((c) => <LegendSwatchRow key={c} swatch={<span className={styles.legendSq} style={{ background: esiColor(c) }} />}>{esiShort(c)} <span className={styles.count}>{esiNumber(c)}/10</span></LegendSwatchRow>)}
                </LegendTurndown>
              </>}
              info={<>Shoreline types ranked by sensitivity to oil in NOAA’s <a className={styles.src} href={ESI_HOME} {...ext}>Environmental Sensitivity Index atlas for Lake Michigan (2025) ↗</a>, in the atlas’s own colors. A segment with several classes is colored by its most sensitive one.</>} />
            )}

            <DatasetRow storageKey="spills.pipe" name="Pipeline accidents" hue={PIPE_COLOR} icon={<PipeIcon />}
              sub={pipeRaw ? 'U.S. · PHMSA' : ''} on={!layersOff.has('pipe') || !layersOff.has('gas')}
              onToggle={() => setLayersOff((prev) => { const n = new Set(prev); const anyOn = !prev.has('pipe') || !prev.has('gas'); for (const k of ['pipe', 'gas']) anyOn ? n.add(k) : n.delete(k); return n })}
              legend={<>
                <label className={styles.toggle} title="Bigger diamond = more barrels released">
                  <input type="checkbox" checked={!layersOff.has('pipe')} onChange={() => toggleLayer('pipe')} />
                  <span className={styles.lgPipe} /> Oil, fuel and gas liquids <span className={styles.count}>{fmtInt(pipesShown.length)}</span>
                </label>
                <label className={styles.toggle} title="Bigger triangle = more gas released into the air">
                  <input type="checkbox" checked={!layersOff.has('gas')} onChange={() => toggleLayer('gas')} />
                  <span className={styles.lgGas} /> Natural gas, into the air <span className={styles.count}>{fmtInt(gasShown.length)}</span>
                </label>
              </>}
              info={<>Every pipeline accident in the U.S. since 2010, as the operator reported it to the <a className={styles.src} href={PHMSA_HOME} {...ext}>Pipeline and Hazardous Materials Safety Administration ↗</a>. Diamonds: crude oil, fuels, propane and other gas liquids, and carbon dioxide, sized by barrels released; each card has barrels released and recovered, cause, and the NRC reports it names. Triangles: natural gas and other gases from transmission, gathering and distribution lines and LNG facilities, sized by gas released, with deaths, injuries, evacuations, fire and explosion. Operators file these after the fact, so volumes are measured, not first estimates. Gas goes into the air, so only the liquid accidents get the shoreline and wildlife check.</>} />

            <DatasetRow storageKey="spills.pa" name="Protected areas" hue={PA_COLOR} icon={<LeafIcon />}
              sub="Parks and preserves" on={!layersOff.has('pa')} onToggle={() => toggleLayer('pa')}
              info={<>Federal, state, local, tribal and nonprofit protected land from the <a className={styles.src} href={PADUS_HOME} {...ext}>USGS Protected Areas Database of the United States (PAD-US 4.1) ↗</a>: parks, refuges, nature preserves, forests and conservation easements, with how strongly each is protected for nature in its card. Shown where they lie within 1 km of the shore or near a spill report.</>} />
          </div>

          <SourcesFooter intro={SPILLS_SOURCES_INTRO} sections={SPILLS_SOURCES} notes={SPILLS_SOURCES_NOTES} />
        </div>
      </MapSheet>
    </div>
  )
}

const ic = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
function DropIcon() { return <svg {...ic}><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" /></svg> }
function ShoreIcon() { return <svg {...ic}><path d="M3 15c3-2 5 2 9 0s6-2 9 0" /><path d="M3 9c3-2 5 2 9 0s6-2 9 0" /></svg> }
function FlameIcon() { return <svg {...ic}><path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5" /></svg> }
function PipeIcon() { return <svg {...ic}><path d="M3 9h7v6H3zM14 9h7v6h-7zM10 12h4" /></svg> }
function LeafIcon() { return <svg {...ic}><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" /><path d="M5 19l7-7" /></svg> }
