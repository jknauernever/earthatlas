/**
 * EarthAtlas /spills: Lake Michigan oil-spill exposure. Oil and petroleum releases reported to the National Response
 * Center (2015–2024) on NOAA's Lake Michigan Environmental Sensitivity Index: spill points styled by how precisely
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
import { ReportCard, ListCard, ShoreCard, SpeciesList, EXPOSURE_NOTE } from './SpillCard.jsx'
import {
  DATA_URL, ESI_URL, SCOPE_URL, ESI_COLORS, ESI_HOME, NRC_HOME, WBD, PRECISION, PRECISION_BY_ID, PRECISION_GROUPS,
  nearbyHighlights, statusShort, spName, esiColor, esiNumber, esiShort, esiSentence, esiLevel, isListed, fmtInt, fmtDate, esc, titleCase,
} from './spillsShared.js'
import q from '../quakes/QuakesApp.module.css'
import styles from './SpillsApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-86.9, 43.9], zoom: 5.9 }
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

const LAYERS = ['reports', 'esi', 'scope']
const LAYERS_OFF_DEFAULT = ['scope']
const MATCHES = [
  { id: 'named', label: 'Names a Lake Michigan water' },
  { id: 'basin', label: 'Reached a river, lake or harbor inside the basin' },
  { id: 'drain', label: 'Reached a storm drain or sewer inside the basin' },
]
const MATCHES_OFF_DEFAULT = ['drain']
const PT = '#ff1f3d'    // report points: alarm red, with a glow beneath
const EMPTY = { type: 'FeatureCollection', features: [] }
const absUrl = (p) => new URL(p, window.location.origin).href

// ─── Shareable URL state ────────────────────────────────────────────────────
//   bm, ph       basemap, photos           lat,lng,z   camera
//   y0, y1       first and last year shown (default: all)
//   ly           layers on/off where they differ from the default ("+scope,-esi")
//   po           location kinds turned off (PRECISION ids)     mo   match bases on/off where they differ from the default
//   sel          "r:<NRC report>" | "p:<place>" | "g:<lng>,<lat>" (reports at one spot) | "e:<ESI class>|<segment classes>"
function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), y0: num('y0'), y1: num('y1'), layersOff: plusMinus(sp.get('ly'), LAYERS, LAYERS_OFF_DEFAULT),
    precOff: (sp.get('po') || '').split(',').filter((id) => PRECISION_BY_ID[id]),
    matchOff: plusMinus(sp.get('mo'), MATCHES.map((m) => m.id), MATCHES_OFF_DEFAULT),
    sel: sp.get('sel'),
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
  const [scope, setScope] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json() })
    get(DATA_URL).then(setData).catch(() => setError('The spill reports did not load. Reload to try again.'))
    get(ESI_URL).then(setEsi).catch(() => {})
    get(SCOPE_URL).then(setScope).catch(() => {})
  }, [])

  const yearsAll = data?.summary.years || [2015, 2024]
  const [y0, setY0] = useState(initial.y0)
  const [y1, setY1] = useState(initial.y1)
  const from = y0 ?? yearsAll[0], to = y1 ?? yearsAll[1]

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
        top: nearbyHighlights(pl.pts.flatMap((p) => p.sp || []), data.species).listed.filter((sp) => !sp.masked).slice(0, 3).map((sp) => sp.n) }
    }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
  }, [data, shown])
  const [allPlaces, setAllPlaces] = useState(false)
  const precCount = useMemo(() => { const c = {}; for (const p of inYears) if (p.loc) c[p.loc] = (c[p.loc] || 0) + 1; return c }, [inYears])
  const unlocated = inYears.filter((p) => !p.loc).length

  // ─── Picked item ──────────────────────────────────────────────────────────
  const picked = useMemo(() => {
    if (!sel || !data) return null
    if (sel.startsWith('r:')) { const p = bySeq.get(sel.slice(2)); return p ? { kind: 'report', p } : null }
    if (sel.startsWith('p:')) { const pl = places.find((x) => x.id === sel.slice(2)); return pl ? { kind: 'place', pl } : null }
    if (sel.startsWith('g:')) { const pts = shown.filter((p) => spotKey(p) === sel.slice(2)); return pts.length ? { kind: 'spot', pts } : null }
    if (sel.startsWith('e:')) { const [code, segment] = sel.slice(2).split('|'); return { kind: 'esi', code, segment: segment || code } }
    return null
  }, [sel, data, bySeq, places, shown])
  const pick = (v, from = null) => { setBack(from); setSel(v) }
  // A place from the list: open its reports and frame them.
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
    const offHover = installHoverTip(map, { layers: ['sp-pts', 'sp-esi'], html: (feats) => hoverRef.current?.(feats) || null })
    return () => { offHover(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addLayers(map) {
    if (map.getSource('sp-pts')) return
    for (const id of ['sp-pts', 'sp-esi', 'sp-scope', 'sp-ring']) map.addSource(id, { type: 'geojson', data: EMPTY })
    map.addLayer({ id: 'sp-scope-line', type: 'line', source: 'sp-scope', paint: { 'line-color': '#7dd3fc', 'line-width': 1.4, 'line-dasharray': [3, 2], 'line-opacity': 0.85 } })
    const esiMatch = ['match', ['get', 'c']]
    for (const [code, color] of Object.entries(ESI_COLORS)) esiMatch.push(code, color)
    esiMatch.push('#9ca3af')
    map.addLayer({ id: 'sp-esi-casing', type: 'line', source: 'sp-esi', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#0a0e17', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 10, 4, 14, 7] } })
    map.addLayer({ id: 'sp-esi', type: 'line', source: 'sp-esi', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': esiMatch, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2.4, 14, 4.5] } })
    map.addLayer({ id: 'sp-ring', type: 'line', source: 'sp-ring', paint: { 'line-color': '#ffffff', 'line-width': 1.6, 'line-dasharray': [3, 2] } })
    // Report points, styled by how precisely the report could be placed: solid = reported coordinates, smaller and
    // translucent = street address / named site / distance from a city, hollow ring = nearest city only (sized by how
    // many reports share that city's point).
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
    map.getSource('sp-scope').setData(on('scope') && scope ? scope : EMPTY)
    map.getSource('sp-ring').setData(picked?.kind === 'report' && picked.p.loc ? circle(picked.p.lon, picked.p.lat, picked.p.r / 1000) : EMPTY)
  }, [shown, esi, scope, layersOff, picked])
  const syncRef = useRef(null)
  useEffect(() => { syncRef.current = sync; if (mapReady) sync() }, [sync, mapReady])

  // Clicks: a report opens its card (several at one spot open their list); a shoreline
  // segment opens its ESI class. Anywhere else closes the card.
  clickRef.current = (e) => {
    const map = mapRef.current
    const hits = map.queryRenderedFeatures(e.point, { layers: ['sp-pts', 'sp-esi'].filter((l) => map.getLayer(l)) })
    const pt = hits.find((f) => f.layer.id === 'sp-pts')
    if (pt) {
      const { seq, spot, n } = pt.properties
      if (seq) return pick(`r:${seq}`)
      if (spot && n > 1) return pick(`g:${spot}`)
    }
    const line = hits.find((f) => f.layer.id === 'sp-esi')
    if (line) return pick(`e:${line.properties.c}|${line.properties.esi}`)
    pick(null)
  }

  // "Could be harmed nearby" lines for hover readouts.
  const harmTip = (ids, e, home) => {
    const h = nearbyHighlights(ids, data.species)
    const names = h.listed.slice(0, 3).map((sp) => `<b>${esc(spName(sp))}</b> <span class="${styles.tipStatus}">${esc(statusShort(sp, home))}</span>`).join('<br>')
    return `<div class="${styles.tipHarm}"><div class="${styles.tipHarmHead}">Could be harmed nearby</div>
      ${e ? `<div>${esc(esiShort(e))} shoreline (${esiNumber(e)} of 10)</div>` : ''}
      ${names || '<div>No listed species mapped here</div>'}
      ${h.listed.length > 3 ? `<div>+${h.listed.length - 3} more listed species</div>` : ''}
      <div class="${styles.tipDim}">${h.other} other wildlife and habitat areas</div></div>`
  }
  hoverRef.current = (feats) => {
    const pt = feats.find((f) => f.layer.id === 'sp-pts')
    if (pt) {
      const { seq, spot, n } = pt.properties
      if (!seq && spot) {
        const pts = shown.filter((p) => spotKey(p) === spot)
        return `<div class="${styles.tip}"><div class="${styles.tipTitle}">${n} reports placed at ${esc(pts[0]?.city || '')}, ${esc(pts[0]?.st || '')}</div>
          ${harmTip(pts.flatMap((p) => p.sp || []), null, pts[0]?.st)}
          <div class="${styles.tipDim}">Nearest city only: the reports give no closer location</div><div class="${styles.tipDim}">Unverified initial reports · click for the list</div></div>`
      }
      const p = bySeq.get(seq)
      if (!p) return null
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}">${esc(fmtDate(p.d))} · ${esc(p.m[0] ? titleCase(p.m[0]) : 'Material not given')}</div>
        <div>${esc(p.t)}${p.g != null ? ` · ${fmtInt(Math.round(p.g))} gal reported` : ''}${p.city ? ` · ${esc(p.city)}, ${esc(p.st)}` : ''}</div>
        ${harmTip(p.sp || [], p.e, p.st)}
        <div class="${styles.tipDim}">Placed by ${esc(PRECISION_BY_ID[p.loc].short)}</div>
        <div class="${styles.tipDim}">Unverified initial report (NRC ${esc(p.seq)}) · click for its card</div></div>`
    }
    const line = feats.find((f) => f.layer.id === 'sp-esi')
    if (line) {
      const c = line.properties.c
      return `<div class="${styles.tip}"><div class="${styles.tipTitle}"><span class="${styles.tipSq}" style="background:${esiColor(c)}"></span>${esc(esiShort(c))}</div>
        <div>${esc(esiLevel(c))} by oil (${esiNumber(c)} of 10). ${esc(esiSentence(c))}</div>
        <div class="${styles.tipDim}">NOAA ESI ${esc(line.properties.esi)} · click for more</div></div>`
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
    if (y0 != null && y0 !== yearsAll[0]) sp.set('y0', String(y0))
    if (y1 != null && y1 !== yearsAll[1]) sp.set('y1', String(y1))
    const ly = toPlusMinus(layersOff, LAYERS, LAYERS_OFF_DEFAULT)
    if (ly) sp.set('ly', ly)
    if (precOff.size) sp.set('po', [...precOff].join(','))
    const mo = toPlusMinus(matchOff, MATCHES.map((m) => m.id), MATCHES_OFF_DEFAULT)
    if (mo) sp.set('mo', mo)
    if (sel) sp.set('sel', sel)
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, photos.photo, mapView, y0, y1, layersOff, precOff, matchOff, sel, mapReady])

  useEffect(() => {
    const prev = document.title
    document.title = 'Lake Michigan oil spill exposure — NRC reports on NOAA ESI · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  const toggle = (setter) => (id) => setter((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleLayer = toggle(setLayersOff), togglePrec = toggle(setPrecOff), toggleMatch = toggle(setMatchOff)

  if (!MAPBOX_TOKEN) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  const years = []
  for (let y = yearsAll[0]; y <= yearsAll[1]; y++) years.push(y)
  const usedEsi = Object.keys(data?.esi_names || {}).sort((a, b) => esiNumber(a) - esiNumber(b) || a.localeCompare(b))
  const listedNear = shown.filter((p) => (p.sp || []).some((i) => isListed(data.species[i]))).length
  const ext = { target: '_blank', rel: 'noopener noreferrer' }

  let card = null
  if (picked?.kind === 'report') {
    card = <ReportCard p={picked.p} species={data.species} esiNames={data.esi_names} onClose={() => pick(null)} onBack={back ? () => pick(back) : null} />
  } else if (picked?.kind === 'place') {
    const pl = picked.pl
    const sp = [...new Set(pl.pts.flatMap((p) => p.sp || []))]
    card = (
      <ListCard title={`${pl.name}, ${pl.st}`} meta={`${fmtInt(pl.n)} oil spill report${pl.n === 1 ? '' : 's'}, ${from}–${to}`}
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
    card = <ListCard title={`${picked.pts.length} reports placed at ${p0.city}, ${p0.st}`} meta={`${from}–${to} · ${PRECISION_BY_ID[p0.loc].label}`}
      points={picked.pts} onPick={(seq) => pick(`r:${seq}`, sel)} onClose={() => pick(null)} />
  } else if (picked?.kind === 'esi') {
    card = <ShoreCard code={picked.code} esi={picked.segment} esiNames={data?.esi_names || {}} onClose={() => pick(null)} />
  }

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <SiteBrand styles={q}>
        <span className={q.subBadge}>Spills</span>
      </SiteBrand>

      <MapSearch className={q.searchBox}>
        <GeoSearch placeholder="Search a place on Lake Michigan…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => flyToSearchResult(mapRef.current, r)} />
      </MapSearch>

      {card && <div className={styles.cardWrap}>{card}</div>}

      <BasemapMenu basemaps={BASEMAPS} basemap={basemap} onBasemap={setBasemap} photos={photos} className={q.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} />

      <MapSheet title="Lake Michigan oil spills" summary={data ? `${fmtInt(shown.length)} reports · ${from}–${to}` : ''} className={styles.panel}>
        <div className={styles.panelBody}>
          <div className={styles.title}>Lake Michigan oil spill exposure</div>
          <div className={styles.exposure}>{EXPOSURE_NOTE}</div>
          {error && <div className={styles.error}>{error}</div>}
          {!data && !error && <Loading />}
          {data && (
            <div className={styles.meta}>
              {fmtInt(inYears.length)} oil spill reports {from}–{to} (<a className={styles.src} href={NRC_HOME} {...ext}>NRC ↗</a>); {fmtInt(listedNear)} near a listed species (<a className={styles.src} href={ESI_HOME} {...ext}>NOAA ESI ↗</a>).
            </div>
          )}

          <div className={styles.section}>
            <div className={styles.sectionTitle}>Years</div>
            <div className={styles.years}>
              <select value={from} aria-label="First year" onChange={(e) => { const v = +e.target.value; setY0(v); if (v > to) setY1(v) }}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <span>to</span>
              <select value={to} aria-label="Last year" onChange={(e) => { const v = +e.target.value; setY1(v); if (v < from) setY0(v) }}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              {(from !== yearsAll[0] || to !== yearsAll[1]) && <button type="button" className={styles.linkBtn} onClick={() => { setY0(null); setY1(null) }}>All years</button>}
            </div>
          </div>

          {data && places.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Most-reported places, {from}–{to}</div>
              <ol className={styles.places}>
                {(allPlaces ? places : places.slice(0, 4)).map((pl) => (
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
              sub={data ? `${fmtInt(shown.length)} on the map` : ''} on={!layersOff.has('reports')} onToggle={() => toggleLayer('reports')}
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
                {MATCHES.map((m) => (
                  <label key={m.id} className={styles.toggle}>
                    <input type="checkbox" checked={!matchOff.has(m.id)} onChange={() => toggleMatch(m.id)} />{m.label}
                  </label>
                ))}
              </>}
              legend={<>
                <LegendSwatchRow swatch={<span className={styles.lgExact} />}>Reported coordinates <span className={styles.count}>{fmtInt((precCount.coords || 0) + (precCount.text || 0))}</span></LegendSwatchRow>
                <LegendSwatchRow swatch={<span className={styles.lgNear} />}>Street address, named site or distance from a city <span className={styles.count}>{fmtInt((precCount.address || 0) + (precCount.place || 0) + (precCount.offset || 0))}</span></LegendSwatchRow>
                <LegendSwatchRow swatch={<span className={styles.lgCity} />}>Nearest city only (number = reports there) <span className={styles.count}>{fmtInt(precCount.city || 0)}</span></LegendSwatchRow>
              </>}
              info={<>Oil and petroleum releases reported to the <a className={styles.src} href={NRC_HOME} {...ext}>National Response Center ↗</a> (U.S. Coast Guard) from 2015 to 2024, as first reported by the caller. A report is included when it names Lake Michigan or one of its bays, harbors or connected waters, or when it reached water inside the Lake Michigan basin (<a className={styles.src} href={WBD} {...ext}>USGS WBD ↗</a>). Each point is placed as precisely as the report allows; the card says how.</>} />

            <DatasetRow storageKey="spills.esi" name="How easily oil harms the shore" hue="#ff0000" icon={<ShoreIcon />}
              sub={esi ? 'NOAA, Lake Michigan 2025' : ''} on={!layersOff.has('esi')} onToggle={() => toggleLayer('esi')}
              legend={<>
                <LegendSwatchRow swatch={<span className={styles.lgEsiRamp} />}>Purple/blue: oil washes off · yellow/red: oil stays and harms wildlife</LegendSwatchRow>
                <LegendTurndown storageKey="spills.esiClasses" label={`Shoreline types (${usedEsi.length})`}>
                  {usedEsi.map((c) => <LegendSwatchRow key={c} swatch={<span className={styles.legendSq} style={{ background: esiColor(c) }} />}>{esiShort(c)} <span className={styles.count}>{esiNumber(c)}/10</span></LegendSwatchRow>)}
                </LegendTurndown>
              </>}
              info={<>Shoreline types ranked by sensitivity to oil in NOAA’s <a className={styles.src} href={ESI_HOME} {...ext}>Environmental Sensitivity Index atlas for Lake Michigan (2025) ↗</a>, in the atlas’s own colors. A segment with several classes is colored by its most sensitive one.</>} />

            <DatasetRow storageKey="spills.scope" name="Matching area" hue="#7dd3fc" icon={<BasinIcon />}
              sub="Lake Michigan basin + mapped water" on={!layersOff.has('scope')} onToggle={() => toggleLayer('scope')}
              legend={<LegendSwatchRow swatch={<span className={styles.lgDash} />}>Reports that reached water inside this line are matched by location</LegendSwatchRow>}
              info={<>The Lake Michigan basin (<a className={styles.src} href={WBD} {...ext}>USGS Watershed Boundary Dataset ↗</a>, hydrologic units 0403–0406) joined with the lake, harbor and river water mapped in the <a className={styles.src} href={ESI_HOME} {...ext}>NOAA ESI ↗</a>.</>} />
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
function BasinIcon() { return <svg {...ic} strokeDasharray="3 2.5"><path d="M6 4c-3 5-2 11 3 15 4 2 9 0 10-5 1-6-4-11-13-10z" /></svg> }
