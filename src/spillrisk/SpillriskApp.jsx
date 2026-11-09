/**
 * EarthAtlas /spillrisk: prebaked oil spill scenarios along the Salish Sea tanker routes.
 *
 * Ten approved release points (scripts/spillrisk/points.json) × two real past 72-hour weather periods. Each scenario is a
 * 10-run PyGNOME ensemble on SSCOFS nowcast currents and wind (scripts/spillrisk/bake_scenarios.py), baked to
 * public/spillrisk-data/<point>--<window>.json. The page plays a scenario hour by hour: where oil is in how many runs,
 * run 1's particles (floating / ashore), its oil budget, the habitats and protected areas reached so far, and the
 * response-time milestones (responseTimes.js) on the time bar.
 *
 * Follows docs/MAP_TOOL_CONVENTIONS.md: URL state (p, w, h, camera, basemap), satellite default, zoom badge, share,
 * place search, basemap menu, style.load readiness, MapSheet on phones, hover readouts, shared left panel + sources.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { installPopupSheet } from '../lib/popupSheet.js'
import { installHoverTip } from '../lib/mapHoverTip.js'
import { ChartTipProvider, useChartTip } from '../components/ChartTip.jsx'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import MapSheet from '../components/MapSheet.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import SiteBrand from '../components/SiteBrand.jsx'
import { BasemapMenu, ImageryLine, useMapPhotos, writePhoto } from '../components/basemap/index.js'
import { DatasetRow, LegendSwatchRow, LegendTurndown, SourcesFooter } from '../components/panel/index.js'
import { FRIENDS_LOGO, FRIENDS_PAGE } from '../permits/habitat.js'
import { SPILLRISK_SOURCES, SPILLRISK_SOURCES_INTRO, SPILLRISK_SOURCES_NOTES, PYGNOME_URL, SSCOFS_ARCHIVE_URL, MARINECADASTRE_URL } from './spillriskSources.js'
import { RESPONSE_MARKS, RECOVERY_NOTE } from './responseTimes.js'
import q from '../quakes/QuakesApp.module.css'
import p from '../speciesOfConcern/SpeciesOfConcernApp.module.css'
import styles from './SpillriskApp.module.css'

installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
// Scenario files: public/spillrisk-data on localhost; Vercel Blob in production (scripts/spillrisk/upload.mjs <stamp>).
// A re-bake goes live by uploading under a new stamp and changing DATA_STAMP.
const DATA_STAMP = '20261106'
const DATA = import.meta.env.DEV ? '/spillrisk-data/' : `https://fxj3imydg9misw9w.public.blob.vercel-storage.com/spillrisk/${DATA_STAMP}/`
const DEFAULT_VIEW = { center: [-123.05, 48.5], zoom: 8.6 }
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style
const DEFAULT_POINT = 'haro'
const DEFAULT_WINDOW = 'winter-storm'
const OIL = '#f97316'          // one hue, faint → deep with the share of runs (feedback: intensity ramps)
const ASHORE = '#facc15'
const SPEEDS = [{ id: 1, label: '1×', ms: 700 }, { id: 2, label: '2×', ms: 350 }, { id: 4, label: '4×', ms: 160 }]
const GROUP_GROUPS = [
  { layer: 'friends', label: 'Friends of the San Juans habitat' },
  { layer: 'crithab', label: 'ESA critical habitat' },
  { layer: 'padus', label: 'Protected areas' },
]

function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return { bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), p: sp.get('p'), w: sp.get('w'), h: num('h') }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fmt = (n) => n.toLocaleString('en-US')
const pct = (x) => `${Math.round(x * 100)}%`
// barrels, rounded to 2 significant figures (model output, not a measurement)
const bbl = (x) => { if (x < 1) return '0'; const d = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1); return fmt(Math.round(x / d) * d) }
// "2,500 barrels, the federal …" -> what follows the number
const volWhat = (v) => v.label.slice(v.label.indexOf(', ') + 2)
const countUpTo = (sorted, h) => { let n = 0; for (const v of sorted) { if (v > h) break; n++ } return n }
const localTime = (startIso, h) => {
  const t = new Date(new Date(startIso.replace(' ', 'T') + 'Z').getTime() + h * 3600e3)
  return t.toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Oil cells of one hour → squares, with k = runs (of n) that had oil there
function cellsGeojson(sc, h) {
  const { dlat, dlon } = sc.grid
  const fr = sc.hours[Math.min(h, sc.hours.length - 1)]
  return { type: 'FeatureCollection', features: fr.cells.map(([iy, ix, k]) => {
    const x0 = ix * dlon, y0 = iy * dlat
    return { type: 'Feature', properties: { k, n: sc.members }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x0 + dlon, y0], [x0 + dlon, y0 + dlat], [x0, y0 + dlat], [x0, y0]]] } }
  }) }
}
// Every cell any run reached up to hour h (faint "where it has been")
function reachedGeojson(sc, h) {
  const { dlat, dlon } = sc.grid, seen = new Set(), features = []
  for (let i = 0; i <= Math.min(h, sc.hours.length - 1); i++) {
    for (const [iy, ix] of sc.hours[i].cells) {
      const key = iy * 100000 + ix
      if (seen.has(key)) continue
      seen.add(key)
      const x0 = ix * dlon, y0 = iy * dlat
      features.push({ type: 'Feature', properties: { fh: i }, geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x0 + dlon, y0], [x0 + dlon, y0 + dlat], [x0, y0 + dlat], [x0, y0]]] } })
    }
  }
  return { type: 'FeatureCollection', features }
}
const pointsGeojson = (fr, key) => ({ type: 'FeatureCollection', features: (fr?.[key] || []).map(([x, y]) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, y] } })) })

export default function SpillriskApp() {
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
  const [index, setIndex] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [pointId, setPointId] = useState(initial.p || DEFAULT_POINT)
  const [windowId, setWindowId] = useState(initial.w || DEFAULT_WINDOW)
  const [hour, setHour] = useState(initial.h != null ? Math.max(0, Math.min(72, Math.round(initial.h))) : 0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [sc, setSc] = useState(null)
  const [scLoading, setScLoading] = useState(false)
  const [show, setShow] = useState({ oil: true, path: true, reached: true })

  useEffect(() => {
    fetch(DATA + 'scenarios.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(setIndex).catch(() => setLoadError('The scenario list did not load. Reload to try again.'))
  }, [])
  const scenarioId = `${pointId}--${windowId}`
  useEffect(() => {
    if (!index) return
    if (!index.scenarios.includes(scenarioId)) { setSc(null); return }
    const ac = new AbortController()
    setScLoading(true)
    fetch(`${DATA}${scenarioId}.json`, { signal: ac.signal }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then((j) => { setSc(j); setScLoading(false) })
      .catch((e) => { if (e.name !== 'AbortError') { setLoadError('This scenario did not load. Reload to try again.'); setScLoading(false) } })
    return () => ac.abort()
  }, [index, scenarioId])

  const point = index?.points.find((x) => x.id === pointId)
  const win = index?.windows.find((x) => x.id === windowId)
  const maxH = sc ? sc.hours.length - 1 : 72
  const h = Math.min(hour, maxH)

  // ─── Play ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !sc) return
    const ms = SPEEDS.find((s) => s.id === speed)?.ms || 700
    const t = setInterval(() => setHour((x) => { if (x >= maxH) { setPlaying(false); return x } return x + 1 }), ms)
    return () => clearInterval(t)
  }, [playing, speed, sc, maxH])

  // ─── Map ─────────────────────────────────────────────────────────────────
  const clickRef = useRef(null)
  const hoverRef = useRef(null)
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current, style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center,
      zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom, preserveDrawingBuffer: true,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('style.load', () => { addLayers(map); setMapReady(true); syncRef.current?.() })
    map.on('click', (e) => clickRef.current?.(e))
    const off = installHoverTip(map, { layers: ['sr-points', 'sr-ashore', 'sr-float', 'sr-oil', 'sr-reached'], html: (f) => hoverRef.current?.(f) || null })
    return () => { off(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function addLayers(map) {
    if (map.getSource('sr-oil')) return
    const empty = { type: 'FeatureCollection', features: [] }
    for (const id of ['sr-reached', 'sr-oil', 'sr-float', 'sr-ashore', 'sr-points']) map.addSource(id, { type: 'geojson', data: empty })
    map.addLayer({ id: 'sr-reached', type: 'fill', source: 'sr-reached', paint: { 'fill-color': OIL, 'fill-opacity': 0.12 } })
    // share of runs → opacity of one hue: less likely (1–3 of 10) faint, possible (4–6), likely (7+) deep
    map.addLayer({ id: 'sr-oil', type: 'fill', source: 'sr-oil', paint: {
      'fill-color': OIL,
      'fill-opacity': ['step', ['/', ['get', 'k'], ['get', 'n']], 0.3, 0.34, 0.55, 0.67, 0.85],
    } })
    map.addLayer({ id: 'sr-float', type: 'circle', source: 'sr-float', paint: {
      'circle-color': '#1c1917', 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.4, 13, 3], 'circle-stroke-color': '#fff7ed', 'circle-stroke-width': 0.4 } })
    map.addLayer({ id: 'sr-ashore', type: 'circle', source: 'sr-ashore', paint: {
      'circle-color': ASHORE, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2, 13, 4.5], 'circle-stroke-color': '#1c1917', 'circle-stroke-width': 0.6 } })
    map.addLayer({ id: 'sr-points', type: 'circle', source: 'sr-points', paint: {
      'circle-color': ['case', ['get', 'sel'], '#ef4444', '#ffffff'], 'circle-radius': ['case', ['get', 'sel'], 11, 9],
      'circle-stroke-color': ['case', ['get', 'sel'], '#ffffff', '#0f172a'], 'circle-stroke-width': 1.6 } })
    map.addLayer({ id: 'sr-points-n', type: 'symbol', source: 'sr-points', layout: {
      'text-field': ['to-string', ['get', 'n']], 'text-size': 11, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true },
      paint: { 'text-color': ['case', ['get', 'sel'], '#ffffff', '#0f172a'] } })
  }

  const sync = () => {
    const map = mapRef.current
    if (!map || !map.getSource('sr-oil') || !index) return
    map.getSource('sr-points').setData({ type: 'FeatureCollection', features: index.points.map((pt, i) => ({
      type: 'Feature', properties: { id: pt.id, n: i + 1, name: pt.name, sel: pt.id === pointId, td: pt.tanker_days, vol: index.volumes?.[pt.volume]?.short || '' },
      geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] } })) })
    const fr = sc?.hours[h]
    map.getSource('sr-oil').setData(sc && show.oil ? cellsGeojson(sc, h) : { type: 'FeatureCollection', features: [] })
    map.getSource('sr-reached').setData(sc && show.reached ? reachedGeojson(sc, h) : { type: 'FeatureCollection', features: [] })
    map.getSource('sr-float').setData(show.path ? pointsGeojson(fr, 'float') : pointsGeojson(null))
    map.getSource('sr-ashore').setData(show.path ? pointsGeojson(fr, 'ashore') : pointsGeojson(null))
  }
  const syncRef = useRef(null)
  syncRef.current = sync
  useEffect(() => { if (mapReady) sync() })

  clickRef.current = (e) => {
    const f = mapRef.current.queryRenderedFeatures(e.point, { layers: ['sr-points'] })[0]
    if (f) { setPointId(f.properties.id); setHour(0); setPlaying(false) }
  }
  hoverRef.current = (feats) => {
    const pt = feats.find((f) => f.layer.id === 'sr-points')
    if (pt) return `<div class="${styles.tip}"><b>${pt.properties.n}. ${esc(pt.properties.name)}</b><div>${esc(pt.properties.vol)} spilled</div><div>${fmt(pt.properties.td)} tanker-days on this stretch in 2025</div><div class="${styles.dim}">Click to load its spill</div></div>`
    // Run 1's particles sit inside the all-runs cells: say both
    const oil = feats.find((f) => f.layer.id === 'sr-oil')
    const cellLine = oil ? `<div>Oil in ${oil.properties.k} of ${oil.properties.n} runs in this cell</div>` : ''
    const when = `hour ${h} (${esc(sc ? localTime(sc.start, h) : '')})`
    const ash = feats.find((f) => f.layer.id === 'sr-ashore')
    if (ash) return `<div class="${styles.tip}"><b>Oil ashore</b><div>Run 1 (recorded winds and currents), ${when}</div>${cellLine}</div>`
    const fl = feats.find((f) => f.layer.id === 'sr-float')
    if (fl) return `<div class="${styles.tip}"><b>Floating oil</b><div>Run 1 (recorded winds and currents), ${when}</div>${cellLine}</div>`
    if (oil) return `<div class="${styles.tip}"><b>Oil in ${oil.properties.k} of ${oil.properties.n} runs</b><div>at ${when}</div></div>`
    const rch = feats.find((f) => f.layer.id === 'sr-reached')
    if (rch) return `<div class="${styles.tip}"><b>Oil has been here</b><div>First reached at hour ${rch.properties.fh} (${esc(sc ? localTime(sc.start, rch.properties.fh) : '')}) in at least one run</div></div>`
    return null
  }

  // Fly to a newly picked point
  // only when the user picks another point (never on load, so a shared camera stays put)
  const shownPointRef = useRef(pointId)
  useEffect(() => {
    if (!mapReady || !point || shownPointRef.current === pointId) return
    shownPointRef.current = pointId
    const cam = { center: [point.lon, point.lat], zoom: Math.max(mapRef.current.getZoom(), 9.2) }
    if (document.hidden) mapRef.current.jumpTo(cam)   // no animation frames in a background tab
    else mapRef.current.flyTo({ ...cam, duration: 1600, essential: true })
  }, [pointId, mapReady, point])

  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    const sp = new URLSearchParams()
    if (basemap !== 'satellite') sp.set('bm', basemap)
    writePhoto(sp, photos.photo)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(4)); sp.set('lng', mapView.lng.toFixed(4)); sp.set('z', mapView.zoom.toFixed(1)) }
    if (pointId !== DEFAULT_POINT) sp.set('p', pointId)
    if (windowId !== DEFAULT_WINDOW) sp.set('w', windowId)
    if (h) sp.set('h', String(h))
    writeUrlQuery(sp.toString())
    if (mapReady && !playing) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, photos.photo, mapView, pointId, windowId, h, mapReady, playing])

  useEffect(() => {
    const prev = document.title
    document.title = 'Oil Spill Scenarios — Salish Sea tanker routes · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  if (!MAPBOX_TOKEN) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  const ext = (href, text) => <a className={p.src} href={href} target="_blank" rel="noopener noreferrer">{text}</a>
  const fr = sc?.hours[h]
  const bud = fr?.budget
  const reachedGroups = sc ? sc.impacts.map((g) => ({ ...g, n: countUpTo(g.first, h), nl: countUpTo(g.first_likely, h) })).filter((g) => g.n > 0) : []
  const shore = sc?.shore
  const vol = point && index?.volumes?.[point.volume]
  const marks = RESPONSE_MARKS.filter((m) => m.h <= maxH)
  const lastMark = [...marks].reverse().find((m) => m.h <= h)
  const nextMark = marks.find((m) => m.h > h)
  const pickPoint = (id) => { setPointId(id); setHour(0); setPlaying(false) }

  return (
    <ChartTipProvider>
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <SiteBrand styles={q}><span className={q.subBadge}>Oil Spill Scenarios</span></SiteBrand>
      <MapSearch className={q.searchBox}>
        <GeoSearch placeholder="Search a place in the Salish Sea…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => flyToSearchResult(mapRef.current, r)} />
      </MapSearch>
      <BasemapMenu basemaps={BASEMAPS} basemap={basemap} onBasemap={setBasemap} photos={photos} className={q.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} />

      {/* Time bar: play the scenario hour by hour; response milestones marked on the track */}
      {sc && (
        <div className={styles.timebar}>
          <button type="button" className={styles.play} onClick={() => { if (h >= maxH) setHour(0); setPlaying((v) => !v) }} aria-label={playing ? 'Pause' : 'Play'}>
            {playing
              ? <svg viewBox="0 0 16 16" width="16" height="16"><rect x="3" y="2" width="3.5" height="12" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" fill="currentColor" /></svg>
              : <svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 2 L14 8 L4 14 Z" fill="currentColor" /></svg>}
          </button>
          <div className={styles.trackWrap}>
            <div className={styles.hourLine}>
              <b>Hour {h}</b> <span className={styles.dim}>since the spill · {localTime(sc.start, h)} Pacific</span>
            </div>
            <div className={styles.track}>
              <input type="range" min="0" max={maxH} step="1" value={h} onChange={(e) => { setHour(Number(e.target.value)); setPlaying(false) }} aria-label="Hour since the spill" />
              {marks.map((m) => (
                <button key={m.id} type="button" className={`${styles.mark} ${h >= m.h ? styles.markPast : ''}`} style={{ left: `${(m.h / maxH) * 100}%` }}
                  title={`Hour ${m.h}: ${m.label} (${m.src})`} onClick={() => { setHour(m.h); setPlaying(false) }}>
                  <span className={`${styles.markTick} ${m.kind === 'rule' ? styles.tickRule : styles.tickRecord}`} />
                </button>
              ))}
            </div>
            <div className={styles.ticks}><span>0</span><span>24 h</span><span>48 h</span><span>72 h</span></div>
            <div className={styles.respLine}>
              {lastMark
                ? <><span className={lastMark.kind === 'rule' ? styles.kRule : styles.kRecord}>{lastMark.kind === 'rule' ? 'Required by' : 'In a real spill'} hour {lastMark.h}:</span> {lastMark.label}</>
                : <><span className={styles.kNone}>No cleanup equipment required on scene yet</span>{nextMark ? <> · first required at hour {nextMark.h}</> : null}</>}
            </div>
          </div>
          <div className={styles.speeds}>
            {SPEEDS.map((s) => <button key={s.id} type="button" className={speed === s.id ? styles.speedOn : styles.speed} onClick={() => setSpeed(s.id)}>{s.label}</button>)}
          </div>
        </div>
      )}

      <MapSheet title="Oil spill scenarios" summary={point ? `${point.name} · ${win?.label || ''}` : 'Salish Sea'} className={p.panel}>
        <div className={p.panelBody}>
          <div className={p.title}>If oil spilled on a Salish Sea tanker route…</div>
          {loadError && <div className={p.error}>{loadError}</div>}

          {index && (
            <div className={p.section}>
              <select className={styles.select} value={pointId} onChange={(e) => pickPoint(e.target.value)} aria-label="Spill location">
                {index.points.map((pt, i) => <option key={pt.id} value={pt.id}>{i + 1}. {pt.name} · {index.volumes?.[pt.volume]?.short}</option>)}
              </select>
              {vol && <div className={`${styles.volume} ${point.volume === 'valdez' ? styles.volumeBig : ''}`}><b>{vol.short}</b> of {ext(index.oil.url, index.oil.name)} <span>· {volWhat(vol)} · {ext(vol.url, vol.src)}</span></div>}
              {point && <div className={styles.factDim}>{ext(MARINECADASTRE_URL, `${fmt(point.tanker_days)} tanker-days`)} on this stretch in 2025 ({fmt(point.ships)} tankers)</div>}
              <div className={p.chips} style={{ marginTop: 6 }}>
                {index.windows.map((w) => (
                  <button key={w.id} type="button" className={w.id === windowId ? p.chipOn : p.chip} onClick={() => { setWindowId(w.id); setPlaying(false) }} title={w.why}>{w.label}</button>
                ))}
              </div>
              {win && <div className={styles.factDim}>{ext(win.buoy_url, win.id === 'summer' ? 'Median summer wind' : 'Windiest winter 72 h')} (buoy 46088) · {ext(SSCOFS_ARCHIVE_URL, 'NOAA SSCOFS currents')}</div>}
            </div>
          )}

          {scLoading && <div className={styles.factDim}>Loading the scenario…</div>}
          {index && !index.scenarios.includes(scenarioId) && <div className={styles.factDim}>This scenario is not baked yet.</div>}

          {sc && (
            <div className={p.section}>
              <div className={styles.stats}>
                <div><b>{shore.first_min == null ? '—' : shore.first_min === shore.first_max ? `h${shore.first_min}` : `h${shore.first_min}–${shore.first_max}`}</b><span>first oil ashore ({shore.members_reaching} of {sc.members} runs)</span></div>
                <div><b>{bud ? bbl(bud.ashore * sc.amount_bbl) : '—'}</b><span>barrels ashore now (run 1, of {fmt(sc.amount_bbl)})</span></div>
              </div>
              {bud && (
                <>
                  <BudgetBar bud={bud} amount={sc.amount_bbl} h={h} />
                  <div className={styles.factDim}>
                    Run 1: <b style={{ color: OIL }}>{pct(bud.floating)} floating ({bbl(bud.floating * sc.amount_bbl)} bbl)</b> · <b style={{ color: ASHORE }}>{pct(bud.ashore)} ashore</b> · {pct(bud.evaporated)} evaporated{bud.dispersed >= 0.005 ? ` · ${pct(bud.dispersed)} dispersed` : ''}{bud.off_map > 0.005 ? ` · ${pct(bud.off_map)} left the model area` : ''} · {ext(PYGNOME_URL, 'PyGNOME')}
                  </div>
                </>
              )}
            </div>
          )}

          {sc && (
            <div className={p.section}>
              <DatasetRow storageKey="spillrisk.oil" name="Oil on the water" hue={OIL} sub={`${fr.cells.length} cells`} on={show.oil} onToggle={() => setShow((s) => ({ ...s, oil: !s.oil }))}
                legend={<LegendSwatchRow swatch={<span className={styles.ramp}><span style={{ background: OIL, opacity: 0.3 }} /><span style={{ background: OIL, opacity: 0.55 }} /><span style={{ background: OIL, opacity: 0.85 }} /></span>}>In 1–3 · 4–6 · 7–10 of 10 runs</LegendSwatchRow>}
                controls={<label className={styles.check}><input type="checkbox" checked={show.reached} onChange={() => setShow((s) => ({ ...s, reached: !s.reached }))} /> Show faintly everywhere it has been so far</label>}
                info={<>Each square (~550 m) is colored by how many of the ten model runs had oil in it at this hour. Run 1 uses the winds and currents as recorded; runs 2–10 vary them a little, so the spread shows how sure the path is. {ext(PYGNOME_URL, 'NOAA PyGNOME')}</>} />
              <DatasetRow storageKey="spillrisk.path" name="Run 1 oil" hue={ASHORE} sub={<><span className={styles.dots}><i style={{ background: '#1c1917' }} /></span> floating · <span className={styles.dots}><i style={{ background: ASHORE }} /></span> ashore</>} on={show.path} onToggle={() => setShow((s) => ({ ...s, path: !s.path }))}
                info={<>Particles from run 1, the run on the recorded winds and currents: dark dots float, yellow dots have reached the shore.</>} />
            </div>
          )}

          {sc && (
            <div className={p.section}>
              <div className={styles.lead}>Reached by hour {h} <span className={styles.dim}>(likely = 7+ of 10 runs)</span></div>
              {reachedGroups.length === 0 && <div className={styles.factDim}>{sc.impacts.length
                ? 'Nothing on the habitat and protected-area maps yet.'
                : 'In all 72 hours this oil reaches none of the U.S. habitat and protected-area maps; British Columbia’s are not assessed yet.'}</div>}
              {GROUP_GROUPS.map(({ layer, label }) => {
                const gs = reachedGroups.filter((g) => g.layer === layer)
                if (!gs.length) return null
                return (
                  <LegendTurndown key={layer} storageKey={`spillrisk.imp.${layer}`} label={<>{layer === 'friends' && <img src={FRIENDS_LOGO} alt="Friends of the San Juans" className={styles.logo} />}{label} ({gs.length})</>}>
                    {gs.map((g) => (
                      <div key={g.group} className={styles.imp}>
                        <div><b>{g.group}</b>{layer === 'padus' ? '' : `: ${fmt(g.n)} ${g.n === 1 ? 'place' : 'places'}`}{g.nl ? <span className={styles.likely}> · {fmt(g.nl)} likely</span> : null}</div>
                        <div className={styles.factDim}>first reached hour {g.first[0]} · {ext(layer === 'friends' ? FRIENDS_PAGE : g.url, g.src)}</div>
                      </div>
                    ))}
                  </LegendTurndown>
                )
              })}
            </div>
          )}

          {marks.length > 0 && (
            <div className={p.section}>
              <LegendTurndown storageKey="spillrisk.response" label={`How long until responders arrive (${marks.length})`}>
                <div className={styles.factDim}>Hours after the spill is <i>reported</i>. <span className={styles.kRule}>Blue</span>: what Washington and federal rules require (planning maximums for covered vessels). <span className={styles.kRecord}>Red</span>: what happened in real Salish Sea spills.</div>
                {marks.map((m) => (
                  <div key={m.id} className={styles.imp}>
                    <div><button type="button" className={m.kind === 'rule' ? styles.markLink : styles.markLinkRec} onClick={() => { setHour(m.h); setPlaying(false) }}>Hour {m.h}</button> {m.label}</div>
                    <div className={styles.factDim}>{m.detail} {ext(m.url, m.src)}</div>
                  </div>
                ))}
                <div className={styles.factDim}>{RECOVERY_NOTE.text} {ext(RECOVERY_NOTE.url, RECOVERY_NOTE.src)}</div>
              </LegendTurndown>
            </div>
          )}

          <div className={styles.notice}>EarthAtlas model runs, not NOAA’s. No cleanup simulated; B.C. not assessed.</div>
          <SourcesFooter intro={SPILLRISK_SOURCES_INTRO} sections={SPILLRISK_SOURCES} notes={SPILLRISK_SOURCES_NOTES} />
        </div>
      </MapSheet>
    </div>
    </ChartTipProvider>
  )
}

// Run 1's oil budget as one stacked bar; each part has its own mouseover
function BudgetBar({ bud, amount, h }) {
  const tip = useChartTip()
  const parts = [
    ['Floating', bud.floating, OIL], ['Ashore', bud.ashore, ASHORE],
    ['Evaporated', bud.evaporated, '#94a3b8'], ['Dispersed', bud.dispersed, '#38bdf8'],
  ]
  const rows = (on) => parts.map(([label, x, color]) => ({ color, label, value: `${pct(x)} · ${bbl(x * amount)} bbl`, on: label === on }))
  return (
    <div className={styles.budget}>
      {parts.map(([label, x, color]) => (
        <span key={label} style={{ width: pct(x), background: color }} {...tip({ head: `Run 1 oil budget, hour ${h}`, rows: rows(label), foot: `of ${fmt(amount)} barrels spilled` })} />
      ))}
    </div>
  )
}
