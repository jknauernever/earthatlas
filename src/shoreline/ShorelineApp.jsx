/**
 * EarthAtlas /shoreline — Shoreline Explorer: Salish Sea Explorer's (salishsea.knauernever.com) default map, ported to
 * EarthAtlas for Friends of the San Juans (sanjuans.earthatlas.org/shoreline). Plan and decisions:
 * docs/SHORELINE_PORT_PLAN.md. The 16 layers on SSE's default "On the map" list, in its 8 rows, each drawn as SSE draws it
 * and only from SSE's zoom (src/shoreline/shorelineLayers.js, src/friends/habitatOverlay.js).
 *
 * Data: Friends + fish-use layers ship in public/shoreline-data (scripts/shoreline/import-sse-static.mjs) and
 * public/permits-data/friends-habitat.geojson; parcels + buildings are tiles of the County's own layers
 * (scripts/shoreline/bake-parcels.py → api/parcel-tiles, region shoreline-sjc).
 *
 * Follows docs/MAP_TOOL_CONVENTIONS.md: URL state (camera, basemap, photos, layers off, fish Color by), satellite
 * default, shared zoom badge / share / place search / basemap menu, style.load readiness, MapSheet on phones, the
 * shared left panel and sources rollup.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { mapboxToken } from '../lib/mapboxToken.js'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { installPopupSheet } from '../lib/popupSheet.js'
import { keepPopupOnMap } from '../lib/popupFit.js'
import { installHoverTip } from '../lib/mapHoverTip.js'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import MapSheet from '../components/MapSheet.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import SiteBrand from '../components/SiteBrand.jsx'
import { BRANDS } from '../lib/brand.js'
import { BasemapMenu, ImageryLine, useMapPhotos, writePhoto } from '../components/basemap/index.js'
import { DatasetRow, LegendTurndown, LegendSwatchRow, LegendFlow, LegendToggleRow, SourcesFooter } from '../components/panel/index.js'
import { pinDataUri } from '../friends/habitatOverlay.js'
import { buildChooserCard, swatchHtml, escapeHtml } from '../friends/popupCard.js'
import {
  LAYERS as POPUP_LAYERS, buildFriendsPopup, featureTitle, fishUseEntries, fishUseLinesHtml, fishCodesForMode, fishIconSvg,
  installPopupCardHandlers, preloadFriendsContent,
} from '../friends/habitatPopups.js'
import { FRIENDS_PAGE } from '../permits/habitat.js'
import {
  ALL_IDS, FORAGE, MODIFICATIONS, FISH_TIERS, FISH_COLOR_MODES, DEFAULT_FISH_MODE, SHOREFORM_GROUPS, SHOREFORM_GROUP_ORDER,
  PIN_SPECS, MIN_ZOOM, mapboxZoom, loadShorelineData, addShorelineLayers, installParcelHover,
  CLICK_LAYERS, LEGEND_ORDER, rowOfLayer, sseLayerId, isPinLayer,
} from './shorelineLayers.js'
import { SHORELINE_SOURCES, SHORELINE_SOURCES_INTRO, GUIDE_URL } from './shorelineSources.js'
import WelcomeBox from './WelcomeBox.jsx'
import { fetchParcelDetail, loadFriendsProjects, buildPropertyPopupHtml, mountPropertyPopup, parcelBbox } from './propertyPopup.js'
import q from '../quakes/QuakesApp.module.css'
import p from '../speciesOfConcern/SpeciesOfConcernApp.module.css'
import styles from './ShorelineApp.module.css'

installPopupSheet()
installPopupCardHandlers()

// SSE's default view (config/presets.ts: 48.605, -123.0 at Google zoom 10.8)
const DEFAULT_VIEW = { center: [-123.0, 48.605], zoom: mapboxZoom(10.8) }
const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style
const FISH_MODES = new Set(FISH_COLOR_MODES.map((m) => m.id))

// ─── Shareable URL state ────────────────────────────────────────────────────
//   bm, ph   basemap, photos       lat,lng,z   camera
//   off      layers turned off (ALL_IDS, comma)   fc   fish Color by (default chinook)
function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'),
    off: new Set((sp.get('off') || '').split(',').filter((id) => ALL_IDS.includes(id))),
    fc: FISH_MODES.has(sp.get('fc')) ? sp.get('fc') : DEFAULT_FISH_MODE,
  }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

const pinImg = (spec, size = 18) => <img src={pinDataUri(spec)} alt="" width={Math.round(size * 24 / 26)} height={size} className={styles.pin} />
const ext = (href, text) => <a className={p.src} href={href} target="_blank" rel="noopener noreferrer">{text}</a>
const line = (color, h = 4, opacity = 1) => <span className={styles.line} style={{ background: color, height: h, opacity }} />
// Filled-box icon for area layers (Salish Sea Explorer's swatches)
const box = (fill, stroke = fill) => <span className={styles.box} style={{ background: fill, borderColor: stroke }} />
// Each row's pin (the chooser's swatch); rows without one get a line / fill swatch in the layer's color
const ROW_PIN = { kelp: 'kelp', eelgrass: 'eelgrass', fish: PIN_SPECS.fish, geology: PIN_SPECS.shoreform, armor: PIN_SPECS.armor, docks: PIN_SPECS.dock,
  buoys: PIN_SPECS.buoy, ramps: PIN_SPECS.ramp, railway: PIN_SPECS.railway, groins: PIN_SPECS.groin, pilings: PIN_SPECS.piling }
function rowSwatch(row) {
  if (row === 'fish') return fishIconSvg(16)
  if (row === 'parcels') return swatchHtml('fill', '#F97316', 'rgba(249,115,22,0.25)')
  if (ROW_PIN[row]) return `<img src="${pinDataUri(ROW_PIN[row])}" alt="" style="width:14px;height:15px;object-fit:contain">`
  const c = POPUP_LAYERS[sseLayerId(row)]
  return swatchHtml(c.swatch === 'point' ? 'line' : c.swatch, c.accent, c.swatchColor)
}
// Everything a click or hover touches (12 px box, SSE CHOOSER_TOL_PX), top first: one entry per line/area layer, one per
// layer + title for points, so distinct structures nearby are each offered.
function hitsAt(map, point, fishMode, tol = 6) {
  const live = CLICK_LAYERS.filter((id) => map.getLayer(id))
  const feats = live.length ? map.queryRenderedFeatures([[point.x - tol, point.y - tol], [point.x + tol, point.y + tol]], { layers: live }) : []
  const out = [], seen = new Set()
  for (const f of feats) {
    const row = rowOfLayer(f.layer.id)
    if (!row) continue
    const sse = sseLayerId(row), props = f.properties || {}
    const title = featureTitle(sse, props, { fishMode })
    const point0 = f.geometry?.type === 'Point'
    const key = point0 ? `${row}|${title}` : row
    if (seen.has(key)) continue
    seen.add(key)
    // Pins sit on their point (icon-anchor bottom), so the icon's middle is ~10 px above it: distance from there to the click
    const at = point0 ? map.project(f.geometry.coordinates) : null
    const dist = at ? Math.hypot(at.x - point.x, at.y - 10 - point.y) : Infinity
    out.push({ row, sse, props, title, pin: isPinLayer(f.layer.id), dist })
  }
  const parcel = map.getLayer('sl-parcels-fill') && map.getLayoutProperty('sl-parcels-fill', 'visibility') !== 'none'
    ? map.queryRenderedFeatures(point, { layers: ['sl-parcels-fill'] })[0] : null
  if (parcel) out.push({ row: 'parcels', props: parcel.properties, fid: parcel.properties.fid, title: `Parcel ${parcel.properties.PIN}`, pin: false })
  return out
}

const FRIENDS_BRAND = BRANDS.find((b) => b.id === 'friends')

export default function ShorelineApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const ctlRef = useRef(null)
  const popupRef = useRef(null)
  const clickRef = useRef(null)
  const fishModeRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [styleLoads, setStyleLoads] = useState(0)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  const initial = useMemo(() => readUrlState(), [])
  const initialCamera = Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z)
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const photos = useMapPhotos(mapRef, { mapReady, basemap })
  const [mapView, setMapView] = useState(initialCamera)
  const [off, setOff] = useState(initial.off)
  const [fishMode, setFishMode] = useState(initial.fc)
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const zoom = mapView?.zoom ?? DEFAULT_VIEW.zoom
  fishModeRef.current = fishMode
  useEffect(() => { preloadFriendsContent() }, [])

  // ─── Popups (SSE FeaturePopup): a pin opens its card; a line or area with others within reach offers "What's here" ───
  const openFeature = (hit, lngLat) => {
    const map = mapRef.current
    if (!map) return
    if (hit.row === 'parcels') return openParcel(hit.fid, lngLat)
    const html = () => buildFriendsPopup(hit.sse, hit.props, { fishMode: fishModeRef.current, related: false, detailsExpanded: true })  // /shoreline (Josh 2026-11-09): no "Related content from Friends"; "All details" starts open
    popupRef.current?.remove()
    const popup = new mapboxgl.Popup({ maxWidth: '360px', offset: 10 }).setLngLat(lngLat).setHTML(html()).addTo(map)
    preloadFriendsContent().then(() => { if (popup.isOpen()) popup.setHTML(html()) })
    popupRef.current = keepPopupOnMap(popup)
  }
  // The property report (SSE handleParcelClick): one detail shard, the parcel outlined on the map
  const openParcel = (fid, lngLat) => {
    const map = mapRef.current
    if (!map || fid == null) return
    popupRef.current?.remove()
    ctlRef.current?.setSelected(fid)
    const bbox = parcelBbox(map.querySourceFeatures('sl-parcels', { sourceLayer: 'parcels', filter: ['==', ['get', 'fid'], Number(fid)] }))
    const popup = new mapboxgl.Popup({ maxWidth: '600px', offset: 10 }).setLngLat(lngLat)
      .setHTML('<div class="fp"><div class="fp-body"><div class="fp-sub">Loading property report…</div></div></div>').addTo(map)
    let unmount = () => {}
    popup.on('close', () => { unmount(); if (popupRef.current === popup) ctlRef.current?.setSelected(null) })
    popupRef.current = keepPopupOnMap(popup)
    Promise.all([fetchParcelDetail(fid), loadFriendsProjects(), preloadFriendsContent()]).then(([rec, projects]) => {
      if (!popup.isOpen()) return
      if (!rec) { popup.setHTML('<div class="fp"><div class="fp-body"><div class="fp-sub">This property’s report did not load. Click it again to retry.</div></div></div>'); return }
      popup.setHTML(buildPropertyPopupHtml(fid, rec, [lngLat.lng, lngLat.lat], projects))
      unmount = mountPropertyPopup(popup.getElement(), { at: [lngLat.lng, lngLat.lat], bbox, fid })
    })
  }
  // Search: an address inside a parcel opens that parcel's report once the map has flown there (decision 5)
  const onSearch = (r) => {
    const map = mapRef.current
    if (!map) return
    flyToSearchResult(map, r)
    if (r.bbox || !Number.isFinite(r.lng) || !Number.isFinite(r.lat)) return
    map.once('moveend', () => map.once('idle', () => {
      const hit = map.getLayer('sl-parcels-fill') && map.queryRenderedFeatures(map.project([r.lng, r.lat]), { layers: ['sl-parcels-fill'] })[0]
      if (hit) openParcel(hit.properties.fid, { lng: r.lng, lat: r.lat })
    }))
  }
  clickRef.current = (e) => {
    const map = mapRef.current
    const hits = hitsAt(map, e.point, fishModeRef.current)
    popupRef.current?.remove()
    if (!hits.length) return
    // Pins open directly: the one nearest the cursor, so stacked pins (a dock beside a shoreform pin) are each reachable
    const pins = hits.filter((h) => h.pin).sort((a, b) => a.dist - b.dist)
    if (pins.length) return openFeature(pins[0], e.lngLat)
    if (hits.length === 1) return openFeature(hits[0], e.lngLat)
    const rank = (h) => LEGEND_ORDER.indexOf(h.row)
    const rows = hits.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map((x) => x.h)
    const card = rows.map((h) => ({
      swatch: rowSwatch(h.row), layerName: h.row === 'parcels' ? 'Properties' : POPUP_LAYERS[h.sse].name, title: h.title,
      titleHtml: h.row === 'fish' ? fishUseLinesHtml(fishUseEntries(h.props, fishCodesForMode(fishModeRef.current))) : undefined,
    }))
    const popup = new mapboxgl.Popup({ maxWidth: '320px', offset: 10 }).setLngLat(e.lngLat).setHTML(buildChooserCard(card)).addTo(map)
    popup.getElement().addEventListener('click', (ev) => {
      const b = ev.target.closest?.('[data-fp-pick]')
      if (b) openFeature(rows[Number(b.dataset.fpPick)], e.lngLat)
    })
    popupRef.current = keepPopupOnMap(popup)
  }

  useEffect(() => {
    const ac = new AbortController()
    loadShorelineData(ac.signal).then(setData).catch((e) => { if (e.name !== 'AbortError') setLoadError('The shoreline layers did not load. Reload to try again.') })
    return () => ac.abort()
  }, [])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapboxToken || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = mapboxToken
    const map = new mapboxgl.Map({
      container: containerRef.current, style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center,
      zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom,
      // North-up and flat: the Friends overlays are painted in screen space (as on Salish Sea Explorer)
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
      preserveDrawingBuffer: true,
    })
    map.touchZoomRotate.disableRotation()
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    map.on('zoom', () => ctlRef.current?.thin())
    map.on('style.load', () => { ctlRef.current = null; setStyleLoads((n) => n + 1); setMapReady(true) })
    const offHover = installParcelHover(map)
    map.on('click', (e) => clickRef.current?.(e))
    // Hover card (SSE's hover label): "Layer · title", or the fish line's species and levels
    const offTip = installHoverTip(map, {
      layers: [...CLICK_LAYERS, 'sl-parcels-fill'],
      html: (feats) => {
        const f = feats.find((x) => rowOfLayer(x.layer.id))
        if (!f) {
          // Nothing else here: the property under the pointer (its report opens on click)
          const pc = feats.find((x) => x.layer.id === 'sl-parcels-fill')
          return pc ? `<div class="${styles.tip}"><b>Property</b> · Parcel ${escapeHtml(pc.properties.PIN)}<div>Click for its property report</div></div>` : null
        }
        const row = rowOfLayer(f.layer.id), sse = sseLayerId(row)
        if (row === 'fish') return `<div class="${styles.tip}">${fishUseLinesHtml(fishUseEntries(f.properties), fishCodesForMode(fishModeRef.current))}</div>`
        return `<div class="${styles.tip}"><b>${escapeHtml(POPUP_LAYERS[sse].name)}</b> · ${escapeHtml(featureTitle(sse, f.properties))}</div>`
      },
    })
    return () => { offHover(); offTip(); popupRef.current?.remove(); map.remove(); mapRef.current = null; ctlRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Layers go on once the data is in and after every style load (basemap switch)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !data || map.getSource('sl-parcels')) return
    ctlRef.current = addShorelineLayers(map, data)
    ctlRef.current.setFishMode(fishMode)
    ctlRef.current.setVisible(off)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, styleLoads, data])
  useEffect(() => { ctlRef.current?.setVisible(off) }, [off])
  useEffect(() => { ctlRef.current?.setFishMode(fishMode) }, [fishMode])

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
    if (off.size) sp.set('off', ALL_IDS.filter((id) => off.has(id)).join(','))
    if (fishMode !== DEFAULT_FISH_MODE) sp.set('fc', fishMode)
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, photos.photo, mapView, off, fishMode, mapReady])

  useEffect(() => {
    const prev = document.title
    document.title = 'Salish Sea Explorer: Shoreline Ecosystems — San Juan County · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  if (!mapboxToken) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  const isOn = (id) => !off.has(id)
  const toggle = (id) => setOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // A group row is on while any member is; its switch turns them all off, or all back on
  const groupOn = (ids) => ids.some(isOn)
  const toggleGroup = (ids) => setOff((s) => { const n = new Set(s); const anyOn = ids.some((id) => !s.has(id)); for (const id of ids) anyOn ? n.add(id) : n.delete(id); return n })
  const forageIds = FORAGE.map((f) => f.id), modIds = MODIFICATIONS.map((m) => m.id)
  // Before a layer's zoom the row says from which zoom it shows (the zoom badge's numbers)
  // One line per dataset, as on Salish Sea Explorer: no descriptor, only a hint while zoom hides the layer
  const gate = (g) => (zoom < mapboxZoom(g) ? `shows from zoom ${mapboxZoom(g)}` : null)
  const loading = !data && !loadError

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      {/* Friends of the San Juans' tool on every host: their logo in the chip, "Powered by EarthAtlas" in the panel */}
      <SiteBrand styles={q} brand={FRIENDS_BRAND}>
        <span className={q.subBadge}>Shoreline Ecosystems</span>
      </SiteBrand>

      <MapSearch className={q.searchBox}>
        <GeoSearch
          placeholder="Search an address or place in San Juan County…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={onSearch}
        />
      </MapSearch>

      <BasemapMenu basemaps={BASEMAPS} basemap={basemap} onBasemap={setBasemap} photos={photos} className={q.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} />
      <WelcomeBox defaultDismissed={!!initialCamera} />

      <MapSheet title="On the map" summary="San Juan County shorelines" className={`${p.panel} ${styles.panel}`} desktopCollapse="side">
        <div className={p.panelBody}>
          <div className={p.title}>On the map</div>
          <a className={styles.friends} href={FRIENDS_PAGE} target="_blank" rel="noopener noreferrer">Shoreline data from Friends of the San Juans</a>

          <div className={p.section}>
            <DatasetRow look="list" storageKey="shoreline.kelp" name="Bull Kelp" hue="#B89A3A" icon={pinImg('kelp', 18)} on={isOn('kelp')} onToggle={() => toggle('kelp')} disabled={loading}
              info={<>Canopy (floating) kelp mapping by the Washington Department of Natural Resources and Friends of the San Juans. Zoomed in, beds are drawn with the nautical-chart kelp symbol. {ext(FRIENDS_PAGE, 'Friends of the San Juans')}</>} />

            <DatasetRow look="list" storageKey="shoreline.eelgrass" name="Deepwater/Edge Eelgrass" hue="#20B2AA" icon={pinImg('eelgrass', 18)} on={isOn('eelgrass')} onToggle={() => toggle('eelgrass')} disabled={loading}
              info={<>Friends of the San Juans, Washington DNR and Friday Harbor Labs (countywide eelgrass study). {ext(FRIENDS_PAGE, 'Friends of the San Juans')}</>} />

            <DatasetRow look="list" storageKey="shoreline.parcels" name="Properties" hue="#F97316" icon={box('rgba(249,115,22,0.35)', '#F97316')}
              sub={gate(MIN_ZOOM.parcels)} on={isOn('parcels')} onToggle={() => toggle('parcels')}
              info={<>Property boundaries from the San Juan County Assessor’s parcel layer. {ext('https://gis.sanjuancountywa.gov/arcgis/rest/services/OpenData/Parcels/MapServer/1', 'San Juan County GIS')}</>} />

            <DatasetRow look="list" storageKey="shoreline.buildings" name="Building Footprints" hue="#60A5FA" icon={box('rgba(96,165,250,0.45)', '#60A5FA')}
              sub={gate(MIN_ZOOM.buildings)} on={isOn('buildings')} onToggle={() => toggle('buildings')}
              info={<>Building outlines across San Juan County. {ext('https://gis.sanjuancountywa.gov/arcgis/rest/services/Polaris/Buildings/MapServer/3', 'San Juan County GIS')}</>} />

            <DatasetRow look="list" storageKey="shoreline.fish" name="Priority Shorelines for Fish" hue="#F97316" icon={pinImg(PIN_SPECS.fish, 18)}
              sub={gate(MIN_ZOOM.fish)} on={isOn('fish')} onToggle={() => toggle('fish')} disabled={loading}
              controls={<label className={styles.select}>Color by
                <select value={fishMode} onChange={(e) => setFishMode(e.target.value)}>
                  {FISH_COLOR_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select></label>}
              legend={<LegendFlow>
                {[1, 2, 3].map((t) => <LegendSwatchRow key={t} swatch={line(FISH_TIERS[t].color, 3)}>{FISH_TIERS[t].label}</LegendSwatchRow>)}
              </LegendFlow>}
              info={<>How likely juvenile salmon, forage fish, and greenlings and cods are to be present and abundant along each stretch of shoreline, from 1,350 beach seine sets at 80 sites across the San Juan Islands (high-resolution model). Friends of the San Juans groups the model scores into moderate, high and highest priority, as in the countywide salmon recovery prioritization. Salmon levels are for rearing juveniles. Nothing is ranked low: fish can and do use every shoreline. Beamer &amp; Fresh 2012, Skagit River System Cooperative. {ext('https://gis.sanjuancountywa.gov/arcgis/rest/services/Habitat/SRSC_ShorelineFishPresence/MapServer', 'San Juan County map service')}</>} />

            <DatasetRow look="list" storageKey="shoreline.forage" name="Forage Fish Spawning" hue="#E11D74" icon={box('rgba(139,92,246,0.45)', '#8B5CF6')}
              sub={gate(MIN_ZOOM.forage)} on={groupOn(forageIds)} onToggle={() => toggleGroup(forageIds)} disabled={loading}
              legend={<LegendFlow>
                {FORAGE.map((f) => <LegendToggleRow key={f.id} on={isOn(f.id)} onToggle={() => toggle(f.id)}
                  swatch={f.id === 'herring' ? box('rgba(139,92,246,0.45)', f.color) : line(f.color, 3)}>{f.name}</LegendToggleRow>)}
              </LegendFlow>}
              info={<>Where forage fish spawn in San Juan County: Pacific herring on eelgrass and algae in sheltered bays (WDFW), and surf smelt and Pacific sand lance on upper-beach sand and gravel (Friends of the San Juans and WDFW surveys). Documented beaches have been surveyed with eggs found; potential habitat is beach substrate suitable for spawning that fronts the shore. {ext(FRIENDS_PAGE, 'Friends of the San Juans')}</>} />

            <DatasetRow look="list" storageKey="shoreline.geology" name="Shoreline Geology: Shoreforms" hue="#9A3412" icon={pinImg(PIN_SPECS.shoreform, 18)}
              sub={gate(MIN_ZOOM.geology)} on={isOn('geology')} onToggle={() => toggle('geology')} disabled={loading}
              legend={<LegendFlow>
                {SHOREFORM_GROUP_ORDER.map((g) => <LegendSwatchRow key={g} swatch={line(SHOREFORM_GROUPS[g].color, 3)}>{SHOREFORM_GROUPS[g].label}</LegendSwatchRow>)}
              </LegendFlow>}
              info={<>Geomorphic shoreforms: the primary geologic features of the marine shoreline. Coastal processes affect each shore form differently, so each carries different management concerns and priorities. Friends of the San Juans geomorphic shoreform mapping. {ext(GUIDE_URL, 'Living with the Shoreline')}</>} />

            <DatasetRow look="list" storageKey="shoreline.mods" name="Shoreline Modifications" hue="#8B0000" icon={pinImg(PIN_SPECS.armor, 18)}
              sub={gate(MIN_ZOOM.modifications)} on={groupOn(modIds)} onToggle={() => toggleGroup(modIds)} disabled={loading}
              legend={<LegendTurndown storageKey="shoreline.mods.legend" label={`Structure types (${MODIFICATIONS.filter((m) => isOn(m.id)).length} of ${MODIFICATIONS.length})`} flush>
                {MODIFICATIONS.map((m) => (
                  <LegendToggleRow key={m.id} on={isOn(m.id)} onToggle={() => toggle(m.id)}
                    swatch={<span className={styles.pinSwatch}>{m.line && line(m.line, 3)}{pinImg(PIN_SPECS[m.pin], 16)}</span>}>{m.name}</LegendToggleRow>
                ))}
              </LegendTurndown>}
              info={<>Hard armor and in- and over-water structures along the shore, from Friends of the San Juans’ Inventory of Shoreline Modifications (2010) and the 2019 countywide armor survey. {ext(GUIDE_URL, 'Living with the Shoreline')}</>} />
            {loadError && <div className={p.error}>{loadError}</div>}
          </div>

          <SourcesFooter intro={SHORELINE_SOURCES_INTRO} sections={SHORELINE_SOURCES} poweredBy
            reports={[{ href: '/shoreline/reports', label: 'Shoreline data by island' }]} />
        </div>
      </MapSheet>
    </div>
  )
}
