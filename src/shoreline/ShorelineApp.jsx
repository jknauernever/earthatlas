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
import { NavAdminBar, NodeTools, RemovedList } from '../components/panel/NavAdmin.jsx'
import { useSiteContent, resolveTree } from '../lib/siteContent.js'
import { SITE, SHORELINE_TREE, GLYPHS, STYLE_LABELS, layerConfig, pinSpecOf } from './shorelineTree.js'
import { pinDataUri } from '../friends/habitatOverlay.js'
import { buildChooserCard, swatchHtml, escapeHtml } from '../friends/popupCard.js'
import {
  LAYERS as POPUP_LAYERS, buildFriendsPopup, featureTitle, fishUseEntries, fishUseLinesHtml, fishCodesForMode, fishIconSvg,
  installPopupCardHandlers, preloadFriendsContent,
} from '../friends/habitatPopups.js'
import { FRIENDS_PAGE } from '../permits/habitat.js'
import {
  ALL_IDS, FISH_COLOR_MODES, DEFAULT_FISH_MODE,
  mapboxZoom, loadShorelineData, addShorelineLayers, removeShorelineLayers, installParcelHover,
  CLICK_LAYERS, rowOfLayer, sseLayerId, isPinLayer,
} from './shorelineLayers.js'
import { SHORELINE_SOURCES, SHORELINE_SOURCES_INTRO } from './shorelineSources.js'
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
// '#rrggbb' at an opacity
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})` }
// Each row's pin (the chooser's swatch); rows without one get a line / fill swatch in the layer's color.
// node: the row's panel node (shorelineTree.js), so admin edits show here too.
function rowSwatch(row, node) {
  if (row === 'fish') return fishIconSvg(16)
  if (row === 'parcels') return swatchHtml('fill', node.style.line, rgba(node.style.line, 0.25))
  if (node?.style.glyph) return `<img src="${pinDataUri(pinSpecOf(node.style))}" alt="" style="width:14px;height:15px;object-fit:contain">`
  const c = POPUP_LAYERS[sseLayerId(row)]
  return swatchHtml(c.swatch === 'point' ? 'line' : c.swatch, node?.style.line || c.accent, node?.style.fill ? rgba(node.style.fill, 0.3) : c.swatchColor)
}
// The panel node behind a map row id (a leaf: 'kelp', 'docks', …)
const nodeOfLeaf = (tree, leaf) => Object.values(tree.byId).find((n) => n.leaf === leaf && n.kind !== 'class')
// A renamed layer's name for popups / hover / chooser (the popup's own name when not renamed)
const renamed = (n) => (n && n.name !== n.defaults.name ? n.name : undefined)
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
  // Admin-edited panel (order, names, text, colors, icons, zooms, removed, popup images): src/lib/siteContent.js
  const sc = useSiteContent(SITE)
  const [editing, setEditing] = useState(false)
  const tree = useMemo(() => resolveTree(SHORELINE_TREE, sc.content), [sc.content])
  const cfg = useMemo(() => layerConfig(tree), [tree])
  const cfgKey = JSON.stringify(cfg)
  const treeRef = useRef(tree)
  treeRef.current = tree
  const effOff = useMemo(() => new Set([...off, ...cfg.removed]), [off, cfg])
  const effOffKey = [...effOff].sort().join(',')
  useEffect(() => { preloadFriendsContent() }, [])

  // ─── Popups (SSE FeaturePopup): a pin opens its card; a line or area with others within reach offers "What's here" ───
  const openFeature = (hit, lngLat) => {
    const map = mapRef.current
    if (!map) return
    if (hit.row === 'parcels') return openParcel(hit.fid, lngLat)
    const n = nodeOfLeaf(treeRef.current, hit.row)
    const html = () => buildFriendsPopup(hit.sse, hit.props, { fishMode: fishModeRef.current, related: false, detailsExpanded: true,
      layerName: renamed(n), photos: n?.media || [], autoPhotos: n?.style.autoPhotos !== false })  // /shoreline (Josh 2026-11-09): no "Related content from Friends"; "All details" starts open
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
    const t = treeRef.current, order = layerConfig(t).order
    const rank = (h) => order.indexOf(h.row)
    const rows = hits.map((h, i) => ({ h, i })).sort((a, b) => rank(a.h) - rank(b.h) || a.i - b.i).map((x) => x.h)
    const card = rows.map((h) => ({
      swatch: rowSwatch(h.row, nodeOfLeaf(t, h.row)), layerName: h.row === 'parcels' ? nodeOfLeaf(t, 'parcels').name : renamed(nodeOfLeaf(t, h.row)) || POPUP_LAYERS[h.sse].name, title: h.title,
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
          return pc ? `<div class="${styles.tip}"><b>${escapeHtml(nodeOfLeaf(treeRef.current, 'parcels').name)}</b> · Parcel ${escapeHtml(pc.properties.PIN)}<div>Click for its property report</div></div>` : null
        }
        const row = rowOfLayer(f.layer.id), sse = sseLayerId(row)
        if (row === 'fish') return `<div class="${styles.tip}">${fishUseLinesHtml(fishUseEntries(f.properties), fishCodesForMode(fishModeRef.current))}</div>`
        return `<div class="${styles.tip}"><b>${escapeHtml(renamed(nodeOfLeaf(treeRef.current, row)) || POPUP_LAYERS[sse].name)}</b> · ${escapeHtml(featureTitle(sse, f.properties))}</div>`
      },
    })
    return () => { offHover(); offTip(); popupRef.current?.remove(); map.remove(); mapRef.current = null; ctlRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Layers go on once the data and the panel content are in, after every style load (basemap switch), and again
  // whenever an admin changes a color, icon or zoom (taken off and re-added with the new settings)
  const builtRef = useRef('')
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !data || !sc.ready) return
    const has = !!map.getSource('sl-parcels')
    if (has && builtRef.current === cfgKey) return
    if (has) removeShorelineLayers(map)
    builtRef.current = cfgKey
    ctlRef.current = addShorelineLayers(map, data, cfg)
    ctlRef.current.setFishMode(fishMode)
    ctlRef.current.setVisible(effOff)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, styleLoads, data, sc.ready, cfgKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { ctlRef.current?.setVisible(effOff) }, [effOffKey])
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
  // Before a layer's zoom the row says from which zoom it shows (the zoom badge's numbers)
  // One line per dataset, as on Salish Sea Explorer: no descriptor, only a hint while zoom hides the layer
  const gate = (z) => (z && zoom < z ? `shows from zoom ${z}` : null)
  const kit = { glyphs: GLYPHS, styleLabels: STYLE_LABELS, pinUri: pinDataUri }
  const leafIds = (n) => n.children?.some((c) => c.kind === 'item') ? n.children.map((c) => c.leaf) : [n.leaf]
  const itemSwatch = (c) => (c.style.fill ? box(rgba(c.style.fill, 0.45), c.style.line || c.style.fill)
    : <span className={styles.pinSwatch}>{c.style.line && line(c.style.line, 3)}{c.style.glyph && pinImg(pinSpecOf(c.style), 16)}</span>)
  const rowIcon = (n) => {
    if (n.style.glyph) return pinImg(pinSpecOf(n.style), 18)
    if (n.id === 'parcels') return box(rgba(n.style.line, 0.35), n.style.line)
    if (n.style.fill) return box(rgba(n.style.fill, 0.45), n.style.fill)
    const first = n.children?.find((c) => c.kind === 'item')
    if (first?.style.glyph) return pinImg(pinSpecOf(first.style), 18)
    if (first?.style.fill) return box(rgba(first.style.fill, 0.45), first.style.fill)
    return first ? line(first.style.line, 3) : box(rgba(n.style.color, 0.4), n.style.color)
  }
  const info = (n) => <>{n.info} {n.source && ext(n.source[0], n.source[1])}</>
  // Admin tools under a row while editing: the row's own, then each item / legend class inside it
  const adminFor = (n, siblings) => editing && (
    <>
      <NodeTools node={n} siblings={siblings} sc={sc} kit={kit} />
      {n.children?.map((c) => (
        <div key={c.id} className={styles.adminChild}>
          <span className={styles.adminChildName}>{c.kind === 'class' ? line(c.style.line, 3) : itemSwatch(c)} {c.name}</span>
          <NodeTools node={c} siblings={n.children} sc={sc} kit={kit} compact />
        </div>
      ))}
    </>
  )
  const legendOf = (n) => {
    if (n.id === 'fish') return <LegendFlow>{n.children.map((c) => <LegendSwatchRow key={c.id} swatch={line(c.style.line, 3)}>{c.name}</LegendSwatchRow>)}</LegendFlow>
    if (n.id === 'geology') return <LegendFlow>{n.children.map((c) => <LegendSwatchRow key={c.id} swatch={line(c.style.line, 3)}>{c.name}</LegendSwatchRow>)}</LegendFlow>
    if (n.id === 'forage') return <LegendFlow>{n.children.map((c) => <LegendToggleRow key={c.id} on={isOn(c.leaf)} onToggle={() => toggle(c.leaf)} swatch={itemSwatch(c)}>{c.name}</LegendToggleRow>)}</LegendFlow>
    if (n.id === 'mods') {
      return <LegendTurndown storageKey="shoreline.mods.legend" label={`Structure types (${n.children.filter((c) => isOn(c.leaf)).length} of ${n.children.length})`} flush>
        {n.children.map((c) => <LegendToggleRow key={c.id} on={isOn(c.leaf)} onToggle={() => toggle(c.leaf)} swatch={itemSwatch(c)}>{c.name}</LegendToggleRow>)}
      </LegendTurndown>
    }
    return undefined
  }
  const STORAGE = { forage: 'shoreline.forage', mods: 'shoreline.mods' }
  const NEEDS_DATA = new Set(['kelp', 'eelgrass', 'fish', 'forage', 'geology', 'mods'])
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
          placeholder="Search an address in San Juan County…"
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

          <NavAdminBar sc={sc} editing={editing} setEditing={setEditing} />

          <div className={p.section}>
            {tree.roots.map((n) => {
              const ids = leafIds(n).filter(Boolean)
              const group = ids.length > 1
              return (
                <DatasetRow key={n.id} look="list" storageKey={STORAGE[n.id] || `shoreline.${n.id}`} name={n.name} hue={n.style.color} icon={rowIcon(n)}
                  sub={gate(n.minZoom)} on={group ? groupOn(ids) : isOn(ids[0])} onToggle={() => (group ? toggleGroup(ids) : toggle(ids[0]))}
                  disabled={loading && NEEDS_DATA.has(n.id)}
                  controls={n.id === 'fish' && <label className={styles.select}>Color by
                    <select value={fishMode} onChange={(e) => setFishMode(e.target.value)}>
                      {FISH_COLOR_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select></label>}
                  legend={legendOf(n)} info={info(n)} admin={adminFor(n, tree.roots)} />
              )
            })}
            {editing && <RemovedList tree={tree} sc={sc} />}
            {loadError && <div className={p.error}>{loadError}</div>}
          </div>

          <SourcesFooter intro={SHORELINE_SOURCES_INTRO} sections={SHORELINE_SOURCES} poweredBy
            reports={[{ href: '/shoreline/reports', label: 'Shoreline data by island' }]} />
        </div>
      </MapSheet>
    </div>
  )
}
