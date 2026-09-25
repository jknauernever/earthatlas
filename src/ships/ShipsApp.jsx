/**
 * /ships — vessel identity, tracks and ship pollution from open sources.
 * Rules: src/ships/CLAUDE.md.
 *
 * Shell = /inmotion's (Josh, 2026-09-24): globe + atmosphere, the universal
 * "Fly to a place" search top right, icon dock ("I want to see…") ⇄ panel on
 * the left, control column on the right. Ship lookup uses /inmotion's pill
 * construct (MeasurePicker): a top-center "Ships: …" pill whose popover holds
 * the ship search, kind-of-ship chips and results. The picked ship's card
 * hangs under the pill. Once ships have positions (tracks, Phase 2) the card
 * can move to the map like the facility cards.
 *
 * Map conventions (docs/MAP_TOOL_CONVENTIONS.md): shareable URL state,
 * satellite default, ZoomIndicator, mapReady from style.load, globe carve-out.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import MapSheet from '../components/MapSheet.jsx'
import MapSearch from '../components/MapSearch.jsx'
import GeoSearch from '../components/GeoSearch.jsx'
import ShareControl from '../components/ShareControl.jsx'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import { useIsMobile } from '../hooks/useMediaQuery'
import ShipPicker from './ShipPicker.jsx'
import TrackMonths, { TRACK_KINDS } from './TrackControls.jsx'
import VesselCard, { Ev, currentIdentity } from './VesselCard.jsx'
import trackSource from './trackSource.json'
import styles from './ShipsApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-40, 24], zoom: 1.9 } // same opening globe as /inmotion

const BASEMAPS = [
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[1]).style

// Dock/panel entries — only what exists. More ship layers (tracks, traffic,
// emissions…) join as their phases land, never as placeholders.
const SHIP_ICON = '<path d="M3 17l2 4h14l2-4-9-3-9 3z"/><path d="M5 15V9h14v6"/><path d="M12 3v6"/><path d="M9 6h6"/>'
const IDENTITY = {
  id: 'identity', name: 'Ship identity', sub: 'names, numbers, flags, owners over time', hue: '#67e8f9', iconSvg: SHIP_ICON,
  sourceName: 'Global Fishing Watch', sourceUrl: 'https://globalfishingwatch.org',
}

const TRACK_ICON = '<path d="M3 19c3-1 4-5 7-6s5 2 8 0 3-6 3-6"/><circle cx="3" cy="19" r="1.5"/><circle cx="21" cy="7" r="1.5"/>'
const TRACKS = {
  id: 'tracks', name: 'Ship tracks', sub: 'where ships went, from AIS', hue: '#fde047', iconSvg: TRACK_ICON,
  sourceName: 'MarineCadastre AIS (NOAA / BOEM / USCG)', sourceUrl: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
}

// Track lines: /shiptraffic's exact style (src/shiptraffic/ShipTrafficApp.jsx) —
// one yellow, width by zoom, slight blur, and stacked months dimmed by √count so
// busy lanes glow instead of saturating. Tiles: /api/ship-tracks (bake:
// scripts/ships/bake-ais/). A picked ship's own tracks draw on top, brighter,
// from the complete per-MMSI pack (?mmsi=): the density tiles drop lines in
// crowded areas, so they can't be trusted to hold one particular ship.
const TRACK_COLOR = '#fde047'
const TRACK_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 0.35, 10, 0.8, 14, 1.5]
// A picked ship's tracks: bold cyan (the Ship identity accent) over a dark casing,
// so they read through any density of yellow and on satellite (Josh, 2026-09-25).
const OWN_COLOR = '#22d3ee'
// Halved 2026-09-25 (Josh: "too wide… cut in half").
const OWN_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 1.1, 10, 1.6, 14, 2.25]
const OWN_CASING_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 2.1, 10, 2.9, 14, 3.75]
const TRACK_MONTH_CAP = 12
const TILES_BASE = typeof window !== 'undefined' ? window.location.origin : ''
const trackTileUrl = (ym) =>
  `${TILES_BASE}/api/ship-tracks?t=${ym}&v=${trackSource.version}${import.meta.env.DEV ? '&dev=1' : ''}&z={z}&x={x}&y={y}`
const trkSrc = (ym) => `shiptrk-${ym}`
const trkLine = (ym) => `shiptrk-${ym}-line`
const OWN_SRC = 'shiptrk-own'
const OWN_LINE = 'shiptrk-own-line'
const OWN_CASING = 'shiptrk-own-casing'

/**
 * A track belongs to the picked ship only if its MMSI is one the ship held AND
 * it starts inside that MMSI's observed window (temporal identity,
 * src/ships/CLAUDE.md). An MMSI reused by another boat in another year never
 * lights up.
 */
const inOwnWindow = (f, periods) => periods.some(({ mmsi, from, to }) =>
  f.properties.mmsi === mmsi && (from == null || f.properties.t0 >= from) && (to == null || f.properties.t0 <= to))

// On-state derivations from a hue, as /inmotion: border .6, background .13, icon = hue.
function hueStyle(hex) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return { '--hue': hex, '--hue-border': `rgba(${r},${g},${b},0.6)`, '--hue-bg': `rgba(${r},${g},${b},0.13)` }
}
const Icon = ({ svg, size = 19 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
)

//   v   picked vessel (EarthAtlas uuid)     q  ship search text      k  kinds (comma list)
//   id  '0' = Ship identity layer off       tr '0' = tracks off      bm basemap    lat,lng,z camera
//   tm  track months: 'YYYY-MM' or 'YYYY-MM_YYYY-MM' (default: all)   tk  track kinds (comma list)
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    v: sp.get('v'), q: sp.get('q'), k: sp.get('k'), id: sp.get('id'), tr: sp.get('tr'), tm: sp.get('tm'), tk: sp.get('tk'), bm: sp.get('bm'),
    lat: num('lat'), lng: num('lng'), z: num('z'),
  }
}
function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

export default function ShipsApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const isMobile = useIsMobile()
  const initial = useMemo(() => readUrlState(), [])
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [mapView, setMapView] = useState(initial.lat != null && initial.lng != null && initial.z != null ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  // Navigation exactly like /inmotion: desktop dock ⇄ panel; phones pill ⇄ dock ⇄ drawer.
  const [panelOpen, setPanelOpen] = useState(false)
  const [mobileView, setMobileView] = useState('dock')

  const [identityOn, setIdentityOn] = useState(initial.id !== '0')
  const [tracksOn, setTracksOn] = useState(initial.tr !== '0')
  const [styleVersion, setStyleVersion] = useState(0) // bumps on every style.load so layers re-add after a basemap swap
  const [mmsiPeriods, setMmsiPeriods] = useState([])  // the picked ship's MMSIs with their observed windows (epoch s)
  const [trackNote, setTrackNote] = useState(null)    // transient message after a track click
  const [ownTracks, setOwnTracks] = useState([])      // the picked ship's complete tracks (from the per-MMSI pack)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState(initial.q || '')
  const [kinds, setKinds] = useState(() => (initial.k ? initial.k.split(',').filter(Boolean) : []))
  const [vesselId, setVesselId] = useState(initial.v || null)
  const [vesselName, setVesselName] = useState(null)

  // ─── Map init (once) — globe + atmosphere, as /inmotion ───────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: mapView ? [mapView.lng, mapView.lat] : DEFAULT_VIEW.center,
      zoom: mapView ? mapView.zoom : DEFAULT_VIEW.zoom,
      projection: 'globe',
    })
    mapRef.current = map
    if (import.meta.env.DEV) window.__shipsMap = map // dev-only QA handle (as /inmotion's __systemsMap)
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('style.load', () => {
      map.setFog({ color: 'rgb(10, 14, 23)', 'high-color': 'rgb(20, 30, 60)', 'horizon-blend': 0.08, 'space-color': 'rgb(6, 8, 16)', 'star-intensity': 0.7 })
      setMapReady(true)
      setStyleVersion((n) => n + 1)
    })
    return () => { map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  useEffect(() => { document.title = 'Ships — vessel identity over time · EarthAtlas' }, [])

  // ─── Track layers (one source per selected month, stacked) ─────────────────
  const allTrackMonths = useMemo(() => (trackSource.months || []).slice(-TRACK_MONTH_CAP), [])
  const [trackRange, setTrackRange] = useState(() => {
    const n = allTrackMonths.length
    const [a, b] = (initial.tm || '').split('_')
    const ia = allTrackMonths.indexOf(a), ib = allTrackMonths.indexOf(b || a)
    return ia >= 0 && ib >= 0 ? [Math.min(ia, ib), Math.max(ia, ib)] : [0, Math.max(0, n - 1)]
  })
  const [trackKinds, setTrackKinds] = useState(() => (initial.tk ? initial.tk.split(',').filter(Boolean) : []))
  const trackMonths = useMemo(() => allTrackMonths.slice(trackRange[0], trackRange[1] + 1), [allTrackMonths, trackRange])
  const addedMonthsRef = useRef(new Set())
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // Mid style load (basemap swap, hot reload), addSource throws "Style is not
    // done loading" and would take the whole page down. Wait, then re-run.
    if (!map.isStyleLoaded()) {
      const retry = () => setStyleVersion((n) => n + 1)
      map.once('idle', retry)
      return () => map.off('idle', retry)
    }
    // Exactly /shiptraffic's rule (ShipTrafficApp.jsx): 0.7 / √(months drawn), floor 0.08.
    // Josh wants the lines identical to /shiptraffic; don't re-tune this.
    const opacity = Math.max(0.08, 0.7 / Math.sqrt(Math.max(1, trackMonths.length)))
    // Drop months no longer selected (a basemap swap already dropped everything).
    for (const ym of [...addedMonthsRef.current]) {
      if (trackMonths.includes(ym) && map.getSource(trkSrc(ym))) continue
      if (map.getLayer(trkLine(ym))) map.removeLayer(trkLine(ym))
      if (map.getSource(trkSrc(ym))) map.removeSource(trkSrc(ym))
      addedMonthsRef.current.delete(ym)
    }
    const kindFilter = trackKinds.length ? ['in', ['get', 'kind'], ['literal', trackKinds]] : null
    // Tracks go under the basemap's labels (place names stay readable), as on /shiptraffic.
    const labelsId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    for (const ym of trackMonths) {
      if (!map.getSource(trkSrc(ym))) {
        addedMonthsRef.current.add(ym)
        map.addSource(trkSrc(ym), { type: 'vector', tiles: [trackTileUrl(ym)], minzoom: 5, maxzoom: 10,
          bounds: trackSource.bbox, attribution: 'Ship tracks: MarineCadastre AIS (NOAA / BOEM / USCG)' })
        map.addLayer({ id: trkLine(ym), type: 'line', source: trkSrc(ym), 'source-layer': trackSource.sourceLayer,
          layout: { 'line-join': 'round' },
          paint: { 'line-color': TRACK_COLOR, 'line-width': TRACK_WIDTH, 'line-blur': 0.6, 'line-opacity': opacity } }, labelsId)
      }
      map.setLayoutProperty(trkLine(ym), 'visibility', tracksOn ? 'visible' : 'none')
      map.setPaintProperty(trkLine(ym), 'line-opacity', opacity)
      map.setFilter(trkLine(ym), kindFilter)
    }
    if (!map.getSource(OWN_SRC)) {
      map.addSource(OWN_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: OWN_CASING, type: 'line', source: OWN_SRC, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0a0e17', 'line-width': OWN_CASING_WIDTH, 'line-opacity': 0.85 } }, labelsId)
      map.addLayer({ id: OWN_LINE, type: 'line', source: OWN_SRC, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': OWN_COLOR, 'line-width': OWN_WIDTH, 'line-opacity': 1 } }, labelsId)
    }
    const ownVis = tracksOn && identityOn && vesselId ? 'visible' : 'none'
    map.setLayoutProperty(OWN_CASING, 'visibility', ownVis)
    map.setLayoutProperty(OWN_LINE, 'visibility', ownVis)
    // Keep the picked ship above month layers added later, and still under the labels.
    if (map.getLayer(OWN_CASING)) { map.moveLayer(OWN_CASING, labelsId); map.moveLayer(OWN_LINE, labelsId) }
  }, [mapReady, styleVersion, trackMonths, trackKinds, tracksOn, identityOn, vesselId])

  // The picked ship's own tracks: every selected month × every MMSI it held.
  useEffect(() => {
    if (!vesselId || !mmsiPeriods.length || !trackMonths.length) { setOwnTracks([]); return }
    const ctl = new AbortController()
    const mmsis = [...new Set(mmsiPeriods.map((p) => p.mmsi))]
    Promise.all(trackMonths.flatMap((ym) => mmsis.map((m) =>
      fetch(`/api/ship-tracks?t=${ym}&mmsi=${m}&v=${trackSource.version}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] })))))
      .then((fcs) => { if (!ctl.signal.aborted) setOwnTracks(fcs.flatMap((fc) => fc.features).filter((f) => inOwnWindow(f, mmsiPeriods))) })
    return () => ctl.abort()
  }, [vesselId, mmsiPeriods, trackMonths])
  const fitToOwnRef = useRef(false) // set when a ship is picked from search; a track click doesn't move the map
  useEffect(() => {
    const map = mapRef.current
    const src = map?.getSource(OWN_SRC)
    if (src) src.setData({ type: 'FeatureCollection', features: ownTracks })
    if (map && ownTracks.length && fitToOwnRef.current) {
      fitToOwnRef.current = false
      const b = new mapboxgl.LngLatBounds()
      for (const f of ownTracks) for (const c of f.geometry.coordinates) b.extend(c)
      // The card hangs from the top centre, so fit the tracks into the map below it.
      const card = document.querySelector('[aria-label="Ship card"]')?.getBoundingClientRect()
      const h = map.getContainer().clientHeight
      const top = card ? Math.min(card.bottom + 24, h * 0.6) : 90
      map.fitBounds(b, { padding: { top, bottom: 40, left: isMobile ? 30 : 140, right: isMobile ? 30 : 80 }, maxZoom: 12, duration: 1200 })
    }
  }, [ownTracks, mapReady, styleVersion, isMobile])

  // Click a track → which ship held that MMSI when the track started → its card.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !trackMonths.length) return
    const layers = trackMonths.map(trkLine)
    const hit = (pt) => {
      const live = layers.filter((l) => map.getLayer(l))
      if (!live.length) return []
      return map.queryRenderedFeatures([[pt.x - 4, pt.y - 4], [pt.x + 4, pt.y + 4]], { layers: live })
    }
    const onMove = (e) => { map.getCanvas().style.cursor = hit(e.point).length ? 'pointer' : '' }
    const onClick = async (e) => {
      const f = hit(e.point)[0]
      if (!f) return
      const { mmsi, t0 } = f.properties
      const when = new Date(t0 * 1000).toISOString()
      try {
        const r = await fetch(`/api/ships?op=mmsi&mmsi=${mmsi}&at=${encodeURIComponent(when)}`)
        const d = await r.json()
        if (d.status === 'resolved') {
          setIdentityOn(true); setPickerOpen(false); setVesselName(null); setVesselId(d.vesselIds[0]); setTrackNote(null)
        } else {
          setIdentityOn(true); setPickerOpen(false); setVesselId(null); setMmsiPeriods([])
          setTrackNote(d.status === 'ambiguous'
            ? `MMSI ${mmsi} was used by ${d.vesselIds.length} different ships at ${when.slice(0, 10)}, so EarthAtlas won't guess which one this track is.`
            : `No identity record yet for MMSI ${mmsi} on ${when.slice(0, 10)}. Its AIS track is real; the ship just isn't in the identity database.`)
        }
      } catch { setTrackNote('Could not look up this track’s ship.') }
    }
    map.on('mousemove', onMove)
    map.on('click', onClick)
    return () => { map.off('mousemove', onMove); map.off('click', onClick) }
  }, [mapReady, trackMonths])

  const handlePlace = useCallback((r) => { flyToSearchResult(mapRef.current, r) }, [])

  // ─── Shareable URL ────────────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (!identityOn) sp.set('id', '0')
    if (!tracksOn) sp.set('tr', '0')
    if (allTrackMonths.length && !(trackRange[0] === 0 && trackRange[1] === allTrackMonths.length - 1)) {
      const [a, b] = [allTrackMonths[trackRange[0]], allTrackMonths[trackRange[1]]]
      sp.set('tm', a === b ? a : `${a}_${b}`)
    }
    if (trackKinds.length) sp.set('tk', trackKinds.join(','))
    if (vesselId) sp.set('v', vesselId)
    if (query.trim()) sp.set('q', query.trim())
    if (kinds.length) sp.set('k', kinds.join(','))
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityOn, tracksOn, trackRange, trackKinds, vesselId, query, kinds, basemap, mapView, mapReady])

  const toggleIdentity = () => {
    const next = !identityOn
    setIdentityOn(next)
    setPickerOpen(next && !vesselId) // turning on with nothing picked → open the search
  }
  const pickShip = (r) => { fitToOwnRef.current = true; setVesselName(r.latest?.name?.value || null); setVesselId(r.id); setPickerOpen(false) }

  if (!MAPBOX_TOKEN) return <div className={styles.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div>

  const activeCount = (identityOn ? 1 : 0) + (tracksOn && allTrackMonths.length ? 1 : 0)
  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>Ships</span>
      </div>

      {/* Search — the universal place search, as on every EarthAtlas map */}
      <MapSearch className={styles.searchBox}>
        <GeoSearch
          placeholder="Fly to a place on the globe…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handlePlace}
        />
      </MapSearch>

      {/* Ships pill — /inmotion's MeasurePicker construct; the card hangs under it.
          (Track months and kinds live in the left panel, under Ship tracks.) */}
      {identityOn && (
        <ShipPicker shipName={vesselId ? vesselName : null} query={query} onQuery={setQuery} kinds={kinds} onKinds={setKinds}
          onPick={pickShip} open={pickerOpen} onOpen={setPickerOpen}>
          {!vesselId && trackNote && (
            <div className={styles.trackNote} role="status">{trackNote}
              <button type="button" className={styles.inlineLink} onClick={() => setTrackNote(null)}> dismiss</button>
            </div>
          )}
          {vesselId && (
            <VesselCard vesselId={vesselId} onClose={() => { setVesselId(null); setVesselName(null); setMmsiPeriods([]) }}
              onSelectVessel={(id) => setVesselId(id)}
              onLoaded={(v) => {
                setVesselName(currentIdentity(v).name?.value_raw || 'Unnamed vessel')
                const secs = (x) => (x ? Math.floor(new Date(x).getTime() / 1000) : null)
                setMmsiPeriods(v.assertions.filter((a) => a.attribute === 'mmsi' && /^\d{9}$/.test(a.value_norm) && a.period_kind !== 'unknown')
                  .map((a) => ({ mmsi: Number(a.value_norm), from: secs(a.from), to: secs(a.to) })))
              }} />
          )}
        </ShipPicker>
      )}

      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)} aria-label="Choose basemap" title="Basemap">
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

      {mapReady && <ShareControl capture={captureShareImage} className={styles.shareCtl} />}

      {/* Icon dock — default navigation on every screen size (as /inmotion). */}
      {((!isMobile && !panelOpen) || (isMobile && mobileView === 'dock')) && (
        <div className={`${styles.dock} ${isMobile ? styles.dockMobile : ''}`} role="toolbar" aria-label="Ship data">
          <div className={styles.dockTitle}>I want to see…</div>
          <div className={styles.dockMeta}>
            <span className={styles.countChip}>{activeCount} on</span>
            <div className={styles.dockCtl}>
              {isMobile && <button type="button" className={styles.dockBtnSm} onClick={() => setMobileView('pill')} aria-label="Hide icons">«</button>}
              <button type="button" className={styles.dockBtnSm} onClick={() => { if (isMobile) setMobileView('drawer'); else setPanelOpen(true) }} aria-label="Expand panel">▸</button>
            </div>
          </div>
          <div className={styles.dockGroup}>
            <div className={styles.dockGroupLabel}>SHIPS</div>
            <div className={styles.dockGrid}>
              <button type="button" className={`${styles.dockBtn} ${identityOn ? styles.dockOn : ''}`}
                style={identityOn ? hueStyle(IDENTITY.hue) : undefined} onClick={toggleIdentity} aria-pressed={identityOn} aria-label={IDENTITY.name}>
                <Icon svg={IDENTITY.iconSvg} size={isMobile ? 16 : 19} />
                {identityOn && <span className={styles.liveDotHue} aria-hidden="true" />}
                {!isMobile && <span className={styles.dockTip} aria-hidden="true">{IDENTITY.name} <span>· {IDENTITY.sub}</span></span>}
              </button>
              {allTrackMonths.length > 0 && (
                <button type="button" className={`${styles.dockBtn} ${tracksOn ? styles.dockOn : ''}`}
                  style={tracksOn ? hueStyle(TRACKS.hue) : undefined} onClick={() => setTracksOn((o) => !o)} aria-pressed={tracksOn} aria-label={TRACKS.name}>
                  <Icon svg={TRACKS.iconSvg} size={isMobile ? 16 : 19} />
                  {tracksOn && <span className={styles.liveDotHue} aria-hidden="true" />}
                  {!isMobile && <span className={styles.dockTip} aria-hidden="true">{TRACKS.name} <span>· {TRACKS.sub}</span></span>}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      {isMobile && mobileView === 'pill' && (
        <button type="button" className={styles.pill} onClick={() => setMobileView('dock')} aria-label="Show ship data">
          <Icon svg={SHIP_ICON} size={20} />
          {activeCount > 0 && <span className={styles.pillBadge}>{activeCount}</span>}
        </button>
      )}

      {(!isMobile || mobileView === 'drawer') && (
        <MapSheet title="I want to see…" summary={`${activeCount} on`}
          className={`${styles.panel} ${!isMobile && !panelOpen ? styles.panelHidden : ''}`}
          desktopCollapsible={false}
          onSnapChange={(snap) => { if (isMobile && snap === 'peek' && mobileView === 'drawer') setMobileView('dock') }}>
          <div className={styles.panelHead}>
            <span className={styles.dockTitle}>I want to see…</span>
            <span className={styles.countChip}>{activeCount} on</span>
            <button className={styles.panelCollapse} onClick={() => { if (isMobile) setMobileView('dock'); else setPanelOpen(false) }} aria-label="Back to icon bar" title="Back to icon bar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>
          {(panelOpen || isMobile) && (
            <div className={styles.panelBody}>
              <div className={styles.group}>
                <div className={styles.groupHead}>Ships</div>
                <div className={styles.layerBlock}>
                  <div className={styles.layerRow} role="switch" aria-checked={identityOn} tabIndex={0} onClick={toggleIdentity}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleIdentity() } }}>
                    <span className={`${styles.rowIcon} ${identityOn ? styles.dockOn : ''}`} style={identityOn ? hueStyle(IDENTITY.hue) : undefined} aria-hidden="true">
                      <Icon svg={IDENTITY.iconSvg} size={16} />
                    </span>
                    <div className={styles.layerInfo}>
                      <span className={styles.layerName}>{IDENTITY.name}</span>
                      <span className={styles.layerSub}>{IDENTITY.sub}</span>
                    </div>
                  </div>
                  {identityOn && (
                    <div className={styles.liveNote}>
                      Use the <strong>Ships</strong> pill at the top to find a ship. Every value on its card says whether the ship broadcast it
                      (<Ev c="ais_self_reported" />) or a registry recorded it (<Ev c="registry" />). Data:{' '}
                      <a className={styles.sourceLink} href={IDENTITY.sourceUrl} target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch.</a>
                    </div>
                  )}
                </div>
                {allTrackMonths.length > 0 && (
                  <div className={styles.layerBlock}>
                    <div className={styles.layerRow} role="switch" aria-checked={tracksOn} tabIndex={0} onClick={() => setTracksOn((o) => !o)}
                      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setTracksOn((o) => !o) } }}>
                      <span className={`${styles.rowIcon} ${tracksOn ? styles.dockOn : ''}`} style={tracksOn ? hueStyle(TRACKS.hue) : undefined} aria-hidden="true">
                        <Icon svg={TRACKS.iconSvg} size={16} />
                      </span>
                      <div className={styles.layerInfo}>
                        <span className={styles.layerName}>{TRACKS.name}</span>
                        <span className={styles.layerSub}>{TRACKS.sub}</span>
                      </div>
                    </div>
                    {tracksOn && (
                      <div className={styles.kindFilter}>
                        <TrackMonths months={allTrackMonths} range={trackRange} onRange={setTrackRange} styles={styles} />
                        <div className={styles.fieldLabel} style={{ marginTop: 12 }}>Kind of ship</div>
                        <div className={styles.chipRow}>
                          <button type="button" className={!trackKinds.length ? styles.chipTrack : styles.chip} onClick={() => setTrackKinds([])}>Every kind</button>
                          {TRACK_KINDS.map(([k, name]) => (
                            <button key={k} type="button" className={trackKinds.includes(k) ? styles.chipTrack : styles.chip}
                              onClick={() => setTrackKinds(trackKinds.includes(k) ? trackKinds.filter((x) => x !== k) : [...trackKinds, k])}>{name}</button>
                          ))}
                        </div>
                        <div className={styles.legendNoteText}>From the AIS type code each ship broadcasts, as NOAA publishes it (the Coast Guard corrects some). Tracks stay yellow; this only filters.</div>
                      </div>
                    )}
                    {tracksOn && (
                      <div className={styles.liveNote}>
                        Salish Sea (US waters), {allTrackMonths[0]} → {allTrackMonths[allTrackMonths.length - 1]}. Zoom into the region to see them; click a track
                        for its ship. A picked ship’s own tracks show in cyan. Data:{' '}
                        <a className={styles.sourceLink} href={TRACKS.sourceUrl} target="_blank" rel="noopener noreferrer">{TRACKS.sourceName}</a>, public domain.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </MapSheet>
      )}
    </div>
  )
}
