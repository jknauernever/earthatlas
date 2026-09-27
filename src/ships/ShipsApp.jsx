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
import TrackMonths, { TRACK_KINDS, fmtMonth } from './TrackControls.jsx'
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
// US-wide tracks (scripts/ships/bake-us/, tileset in trackSource.us). Josh 2026-09-26 (option B):
// US-wide lines everywhere below SALISH_Z; from SALISH_Z up, the detailed Salish tracks take over
// inside the Salish box and US-wide lines fully inside it are hidden. US tiles only carry one line
// per track (with its MMSI) from z9, which is why the handover is at 9.
const SALISH_Z = 9

// Mapbox 3.24's removeSource() also refreshes terrain, which reads terrain properties that only
// exist after a frame has rendered. In a background tab (no frames) that throws and took the page
// down (2026-09-26). The source is already gone by then, so swallow it and ask for a repaint.
function removeSourceSafe(map, id) {
  if (!map.getSource(id)) return
  try { map.removeSource(id) } catch (e) { if (map.getSource(id)) throw e; map.triggerRepaint() }
}
const usSrc = (ym) => `shiptrk-us-${ym}`
const usLo = (ym) => `shiptrk-us-${ym}-lo`
const usHi = (ym) => `shiptrk-us-${ym}-hi`
const usTileUrl = (ym) =>
  `${TILES_BASE}/api/ship-tracks?r=us&t=${ym}&v=${trackSource.us.rules}${import.meta.env.DEV ? '&dev=1' : ''}&z={z}&x={x}&y={y}`
// ─── Worldwide context from Global Fishing Watch (Phase 3) ────────────────────
// Tiles come through api/gfw-tiles.js (token stays server-side). Square grid
// cells of radar detections with no AIS match, drawn as hotspots (see darkPaint).
const DARK_ICON = '<circle cx="12" cy="12" r="3"/><path d="M3 12c2.5-4.5 5.5-7 9-7s6.5 2.5 9 7c-2.5 4.5-5.5 7-9 7s-6.5-2.5-9-7z"/><path d="M4 4l16 16"/>'
const DARK = {
  id: 'dark', name: 'Dark vessels', sub: 'where ships run without AIS', hue: '#e879f9', iconSvg: DARK_ICON,
  sourceName: 'Global Fishing Watch', sourceUrl: 'https://globalfishingwatch.org',
}
const gfwTileUrl = (l, from, to) => `${TILES_BASE}/api/gfw-tiles?l=${l}&from=${from}&to=${to}&z={z}&x={x}&y={y}`
const SALISH_POLY = { type: 'Polygon', coordinates: [[[trackSource.bbox[0], trackSource.bbox[1]], [trackSource.bbox[2], trackSource.bbox[1]],
  [trackSource.bbox[2], trackSource.bbox[3]], [trackSource.bbox[0], trackSource.bbox[3]], [trackSource.bbox[0], trackSource.bbox[1]]]] }
/**
 * Dark vessels as "areas of concern" (Josh, 2026-09-26): quiet cells are hidden, and the more
 * radar detections without AIS a cell has per month, the deeper and more opaque it draws.
 * d = log10(detections per month). Thresholds come from GFW's own counts (Oct 2022 sample:
 * the top 10% of cells ≈ 10/month at z3, the top 1% ≈ 44), and move ~0.4 per zoom step
 * because a cell covers 1/4 the area each step but detections cluster. No floor: zoomed in,
 * cells are small and a few detections a year is exactly what you zoomed in to find.
 */
function darkPaint(months) {
  const d = ['log10', ['/', ['max', ['get', 'count'], 1], Math.max(1, months)]]
  const color = [], opacity = []
  for (let z = 0; z <= 12; z++) {
    const lo = 1.0 + (3 - z) * 0.4   // ≈ top 10% of cells: starts to show
    const hi = 1.7 + (3 - z) * 0.4   // ≈ top 1%: full "hotspot"
    // Less purple → more purple (Josh): one hue, deepening, with opacity doing most of the work.
    color.push(z, ['interpolate', ['linear'], d, lo, '#d946ef', hi, '#a21caf'])
    opacity.push(z, ['interpolate', ['linear'], d, lo - 0.15, 0, lo, 0.25, hi, 0.95])
  }
  return { 'fill-color': ['interpolate', ['linear'], ['zoom'], ...color], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], ...opacity] }
}
const fmtN = (n) => Number(n).toLocaleString('en-US')
const KIND_LABEL = Object.fromEntries(TRACK_KINDS)
// GFW / taxonomy enums → words ("CONTAINER_REEFER" → "Container reefer"); names → "Dole Europa".
const typeLabel = (t) => String(t).toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
const titleCase = (n) => String(n).toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase())
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
function nearPopupHTML({ loading, error, total, ships, tol, months, ids }) {
  const s = styles
  const head = `<div class="${s.popupHead}">Ship tracks · this spot</div>`
  if (loading) return `<div class="${s.popup}">${head}<div class="${s.popupMeta}">Finding the ships that passed here…</div></div>`
  if (error) return `<div class="${s.popup}">${head}<div class="${s.popupMeta}">Couldn’t look up ships here right now.</div></div>`
  const km = tol >= 1000 ? `${(tol / 1000).toFixed(tol >= 10000 ? 0 : 1)} km` : `${tol} m`
  const period = months.length === 1 ? fmtMonth(months[0]) : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`
  if (!total) return `<div class="${s.popup}">${head}<div class="${s.popupTitle}">No ships within ${km}</div><div class="${s.popupMeta}">${period}. Try zooming in.</div></div>`
  const rows = ships.map((v) => {
    const id = ids?.[String(v.mmsi)]
    const named = id && (id.status === 'db' || id.status === 'gfw') && id.name
    const kind = (named && id.type ? typeLabel(id.type) : null) || KIND_LABEL[v.kind] || 'Vessel'
    const src = id?.status === 'gfw' ? ' · via Global Fishing Watch' : ''
    const title = named ? `${escapeHtml(titleCase(id.name))} <span class="${s.popupShipType}">${escapeHtml(kind)}</span>`
      : escapeHtml(kind)
    const meta = [id?.flag, `MMSI ${v.mmsi}`, v.months.map(fmtMonth).join(', ')].filter(Boolean).join(' · ') +
      (id?.status === 'ambiguous' ? ' · MMSI shared by several ships' : '') + src
    return `<button type="button" class="${s.popupShip}" data-mmsi="${v.mmsi}" data-t0="${v.t0 ?? ''}" data-month="${v.months[0]}">` +
      `<span class="${s.popupShipKind}">${title}</span><span class="${s.popupShipMeta}">${escapeHtml(meta)}</span></button>`
  }).join('')
  return `<div class="${s.popup}">${head}` +
    `<div class="${s.popupTitle}">${fmtN(total)} ship${total === 1 ? '' : 's'} passed within ${km}</div>` +
    `<div class="${s.popupMeta}">${period}${total > ships.length ? ` · nearest ${ships.length} shown` : ''}. Pick one to see it.</div>` +
    `<div class="${s.popupList}">${rows}</div>` +
    (ids ? '' : `<div class="${s.popupMeta}">Looking up names…</div>`) +
    `<div class="${s.popupNote}">Tracks: <a href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener noreferrer">MarineCadastre AIS (NOAA / BOEM / USCG)</a>, public domain. ` +
    `Names: EarthAtlas ship records and <a href="https://globalfishingwatch.org" target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch</a> (CC BY-NC 4.0).</div></div>`
}
function darkPopupHTML({ count, months, period, pct, detail }) {
  const s = styles
  const perMonth = count / Math.max(1, months)
  const rate = months > 1 ? ` · about ${perMonth >= 10 ? fmtN(Math.round(perMonth)) : perMonth.toFixed(1)} a month` : ''
  let body = ''
  if (!detail) body = `<div class="${s.popupMeta}">Loading details…</div>`
  else if (detail.error) body = `<div class="${s.popupMeta}">Details unavailable right now.</div>`
  else {
    const part = (k, v) => `<div class="${s.popupRow}"><span class="${s.popupK}">${k}</span><span class="${s.popupV}">${fmtN(v)}</span></div>`
    body =
      `<div class="${s.popupMeta}">Seen on ${fmtN(detail.passes)} radar pass${detail.passes === 1 ? '' : 'es'}` +
      (detail.maxInPass > 1 ? `, up to ${fmtN(detail.maxInPass)} at once` : '') + `</div>` +
      `<div class="${s.popupSub}">What the radar image suggests</div>` +
      part('Likely fishing', detail.fishing) + part('Likely not fishing', detail.nonFishing) + part('Unclear', detail.unknown)
  }
  return (
    `<div class="${s.popup}">` +
    `<div class="${s.popupHead}">Dark vessels · ${period}</div>` +
    `<div class="${s.popupTitle}">${fmtN(count)} detection${count === 1 ? '' : 's'} with no AIS</div>` +
    `<div class="${s.popupMeta}">${pct != null ? `More than ${pct}% of the dark cells in view${rate}` : rate.replace(' · ', '')}</div>` +
    body +
    `<div class="${s.popupNote}">No AIS isn’t proof of wrongdoing: many small boats don’t have to carry it. Radar misses most boats under 15 m.</div>` +
    `<div class="${s.popupNote}">Data: <a href="https://globalfishingwatch.org/map" target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch</a> (Sentinel-1 radar), CC BY-NC 4.0.</div>` +
    `</div>`
  )
}
// ─── Marine protected areas (NOAA MPA Inventory) ─────────────────────────────
// Baked by scripts/ships/bake-mpa/ into one PMTiles file, served by /api/ship-tracks?r=mpa.
// One green, deepening with how strict the protection is (NOAA's "Level of Protection").
const MPA_ICON = '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M8.5 12.5c1.2-1 2.3-1 3.5 0s2.3 1 3.5 0"/>'
const MPA = {
  id: 'mpa', name: 'Protected areas', sub: 'US marine protected areas and their rules', hue: '#4ade80', iconSvg: MPA_ICON,
  sourceName: 'NOAA Marine Protected Areas Inventory', sourceUrl: 'https://marineprotectedareas.noaa.gov/dataanalysis/mpainventory/',
}
// Least → most restrictive, as NOAA's MPA classification system orders them.
const MPA_LEVELS = [
  ['Uniform Multiple Use', 'Multiple use', 'the same rules everywhere; some uses allowed'],
  ['Zoned Multiple Use', 'Zoned multiple use', 'different rules in different zones'],
  ['Zoned w/No Take Areas', 'Zoned, with no-take areas', 'some zones ban all removal'],
  ['No Take', 'No take', 'nothing may be removed'],
  ['No Impact', 'No impact', 'no removal and no harm'],
  ['No Access', 'No access', 'entry prohibited or restricted'],
]
const MPA_SHADES = ['#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d']
const mpaTileUrl = `${TILES_BASE}/api/ship-tracks?r=mpa&v=${trackSource.mpa.version}${import.meta.env.DEV ? '&dev=1' : ''}&z={z}&x={x}&y={y}`
const mpaLevelMatch = (vals, fallback) => ['match', ['get', 'Prot_Lvl'], ...MPA_LEVELS.flatMap(([k], i) => [k, vals[i]]), fallback]
const MPA_FILL_COLOR = mpaLevelMatch(MPA_SHADES, MPA_SHADES[0])
const MPA_FILL_OPACITY = mpaLevelMatch([0.18, 0.22, 0.27, 0.34, 0.38, 0.42], 0.18)
const MPA_LINE_OPACITY = ['interpolate', ['linear'], ['zoom'], 3, 0.75, 8, 0.95]
const MPA_LINE_WIDTH = ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.4, 12, 2]
function mpaPopupHTML(p) {
  const s = styles
  const lvl = MPA_LEVELS.find(([k]) => k === p.Prot_Lvl)
  const row = (k, v) => (v == null || v === '' ? '' : `<div class="${s.popupRow}"><span class="${s.popupK}">${k}</span><span class="${s.popupV}">${escapeHtml(v)}</span></div>`)
  const km2 = (v) => (v == null ? null : `${Number(v) >= 100 ? fmtN(Math.round(v)) : Number(v).toFixed(v >= 1 ? 1 : 2)} km²`)
  const who = [p.Design, p.Gov_Level, p.State].filter(Boolean)
  const safeUrl = p.URL && /^https?:\/\//i.test(p.URL) ? p.URL : null
  return (
    `<div class="${s.popup}">` +
    `<div class="${s.popupHead}">Marine protected area</div>` +
    `<div class="${s.popupTitle}">${escapeHtml(p.Site_Name || 'Unnamed site')}</div>` +
    `<div class="${s.popupMeta}">${escapeHtml(who.join(' · '))}${p.Estab_Yr ? ` · since ${p.Estab_Yr}` : ''}</div>` +
    row('Protection', lvl ? `${lvl[1]}: ${lvl[2]}` : p.Prot_Lvl) +
    row('Fishing', p.Fish_Rstr) +
    row('Vessels', p.Vessel) +
    row('Anchoring', p.Anchor) +
    row('Season', p.Constancy) +
    row('Protects', p.Cons_Focus) +
    row('Managed by', p.Mgmt_Agen) +
    row('Marine area', km2(p.AreaMar)) +
    (p.AreaNT ? row('No-take area', km2(p.AreaNT)) : '') +
    (p.IUCNcat ? row('IUCN category', p.IUCNcat) : '') +
    ((safeUrl || p.WDPA_Cd) ? `<div class="${s.popupMeta}">` +
      [safeUrl && `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Site information</a>`,
        p.WDPA_Cd && `<a href="https://www.protectedplanet.net/${Number(p.WDPA_Cd)}" target="_blank" rel="noopener noreferrer">Protected Planet record</a>`].filter(Boolean).join(' · ') +
      `</div>` : '') +
    `<div class="${s.popupNote}">Not for navigation and not a legal boundary: check the Code of Federal Regulations or state code for official rules.</div>` +
    `<div class="${s.popupNote}">Data: <a href="${MPA.sourceUrl}" target="_blank" rel="noopener noreferrer">${MPA.sourceName}</a> (site ${escapeHtml(p.Site_ID || '?')}, data as of ${fmtIsoDay(trackSource.mpa.version)}), public domain.</div>` +
    `</div>`
  )
}
const fmtIsoDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
const monthStart = (ym) => `${ym}-01`
const monthAfter = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01` }

const OWN_SRC = 'shiptrk-own'
const OWN_LINE = 'shiptrk-own-line'
const OWN_CASING = 'shiptrk-own-casing'
// The one track that was clicked, drawn over the ship's other tracks that month (Josh, 2026-09-26:
// option 1). The rest of the month dims while it's set, so "this line" and "where the ship went" both read.
const OWN_HI = 'shiptrk-own-hi'
const OWN_HI_CASING = 'shiptrk-own-hi-casing'
const OWN_HI_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 2.4, 10, 3.4, 14, 4.6]
const OWN_HI_CASING_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 4.2, 10, 5.6, 14, 7.2]

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
//   mp  '1' = Protected areas on (default off)
//   ct  ship card tab: 'history' | 'incidents' | 'ports' | 'matches' (default overview)       cf  '1' = ship card folded
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  return {
    v: sp.get('v'), q: sp.get('q'), k: sp.get('k'), id: sp.get('id'), tr: sp.get('tr'), tm: sp.get('tm'), tk: sp.get('tk'), bm: sp.get('bm'),
    dk: sp.get('dk'), mp: sp.get('mp'), ct: sp.get('ct'), cf: sp.get('cf'),
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
  const [panelOpen, setPanelOpen] = useState(true) // Josh 2026-09-26: open on every load; collapsible
  const [mobileView, setMobileView] = useState('dock')

  const [identityOn, setIdentityOn] = useState(initial.id !== '0')
  const [tracksOn, setTracksOn] = useState(initial.tr !== '0')
  const [darkOn, setDarkOn] = useState(initial.dk !== '0')
  const [mpaOn, setMpaOn] = useState(initial.mp === '1')
  const [styleVersion, setStyleVersion] = useState(0) // bumps on every style.load so layers re-add after a basemap swap
  const [mmsiPeriods, setMmsiPeriods] = useState([])  // the picked ship's MMSIs with their observed windows (epoch s)
  const [trackNote, setTrackNote] = useState(null)    // transient message after a track click
  const [pickedTrack, setPickedTrack] = useState(null) // { mmsi, t0 } of a clicked line, or null
  const [stopFocus, setStopFocus] = useState(null)     // { t0s } the ship's tracks arriving at / leaving a stop opened from the Ports tab
  const stopMarkerRef = useRef(null)
  const [ownTracks, setOwnTracks] = useState([])      // the picked ship's complete tracks (from the per-MMSI pack)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState(initial.q || '')
  const [kinds, setKinds] = useState(() => (initial.k ? initial.k.split(',').filter(Boolean) : []))
  const [vesselId, setVesselId] = useState(initial.v || null)
  // The ship card reopens where the user left it: tab (ct) and folded (cf).
  const [cardTab, setCardTab] = useState(['history', 'incidents', 'ports', 'matches'].includes(initial.ct) ? initial.ct : 'overview')
  const [cardFolded, setCardFolded] = useState(initial.cf === '1')
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
  // Months = the detailed Salish months plus every month the US-wide bake has published (its
  // Blob index grows as the backfill runs). The selection is kept as month names, so it survives
  // the list growing, and is capped at TRACK_MONTH_CAP months (each month is its own map source).
  // null until the index answers, so a linked month (tm=2019-07) isn't first drawn as the default
  // months and then swapped out.
  const [usMonths, setUsMonths] = useState(null)
  useEffect(() => {
    fetch(trackSource.us.index).then((r) => (r.ok ? r.json() : null))
      .then((idx) => setUsMonths(Object.keys(idx?.months || {}))).catch(() => setUsMonths([]))
  }, [])
  const salishMonths = trackSource.months || []
  const allTrackMonths = useMemo(() => [...new Set([...salishMonths, ...(usMonths || [])])].sort(), [salishMonths, usMonths])
  const defaultSel = [salishMonths[Math.max(0, salishMonths.length - TRACK_MONTH_CAP)], salishMonths[salishMonths.length - 1]]
  const [trackSel, setTrackSel] = useState(() => {
    const [a, b] = (initial.tm || '').split('_')
    return a && /^\d{4}-\d{2}$/.test(a) ? [a, b && /^\d{4}-\d{2}$/.test(b) ? b : a].sort() : defaultSel
  })
  const trackRange = useMemo(() => {
    const ia = allTrackMonths.indexOf(trackSel[0]), ib = allTrackMonths.indexOf(trackSel[1])
    if (ia >= 0 && ib >= 0) return [ia, ib]
    const n = allTrackMonths.length
    return [Math.max(0, n - TRACK_MONTH_CAP), Math.max(0, n - 1)]
  }, [allTrackMonths, trackSel])
  const setTrackRange = useCallback(([ia, ib]) => {
    if (ib - ia + 1 > TRACK_MONTH_CAP) ia = ib - TRACK_MONTH_CAP + 1
    setTrackSel([allTrackMonths[ia], allTrackMonths[ib]])
  }, [allTrackMonths])
  const [trackKinds, setTrackKinds] = useState(() => (initial.tk ? initial.tk.split(',').filter(Boolean) : []))
  const trackMonths = useMemo(() => allTrackMonths.slice(trackRange[0], trackRange[1] + 1), [allTrackMonths, trackRange])
  const addedMonthsRef = useRef(new Set())
  const nearPopupRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || usMonths === null) return
    // Mid style load (basemap swap, hot reload), addSource throws "Style is not
    // done loading" and would take the whole page down. Wait, then re-run.
    // Only the style JSON must be loaded to add layers. map.isStyleLoaded() also
    // waits for every tile, which on a moving globe can stay false indefinitely
    // (that hid all layers, 2026-09-25). So check the style itself.
    if (!map.style?._loaded) {
      const t = setTimeout(() => setStyleVersion((n) => n + 1), 200)
      return () => clearTimeout(t)
    }
    // Exactly /shiptraffic's rule (ShipTrafficApp.jsx): 0.7 / √(months drawn), floor 0.08.
    // Josh wants the lines identical to /shiptraffic; don't re-tune this.
    const opacity = Math.max(0.08, 0.7 / Math.sqrt(Math.max(1, trackMonths.length)))
    // Drop months no longer selected (a basemap swap already dropped everything).
    for (const ym of [...addedMonthsRef.current]) {
      if (trackMonths.includes(ym) && map.getSource(usSrc(ym))) continue
      for (const l of [trkLine(ym), usLo(ym), usHi(ym)]) if (map.getLayer(l)) map.removeLayer(l)
      for (const src of [trkSrc(ym), usSrc(ym)]) removeSourceSafe(map, src)
      addedMonthsRef.current.delete(ym)
    }
    const kindFilter = trackKinds.length ? ['in', ['get', 'kind'], ['literal', trackKinds]] : null
    const outsideSalish = ['!', ['within', SALISH_POLY]]
    const usHiFilter = kindFilter ? ['all', kindFilter, outsideSalish] : outsideSalish
    // Tracks go under the basemap's labels (place names stay readable), as on /shiptraffic.
    const labelsId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    for (const ym of trackMonths) {
      if (!map.getSource(usSrc(ym))) {
        addedMonthsRef.current.add(ym)
        const paint = { 'line-color': TRACK_COLOR, 'line-width': TRACK_WIDTH, 'line-blur': 0.6, 'line-opacity': opacity }
        map.addSource(usSrc(ym), { type: 'vector', tiles: [usTileUrl(ym)], minzoom: trackSource.us.minzoom, maxzoom: trackSource.us.maxzoom,
          attribution: 'Ship tracks: MarineCadastre AIS (NOAA / BOEM / USCG)' })
        // Months with detailed Salish tracks hand over at SALISH_Z; older months are US-wide only.
        const salish = salishMonths.includes(ym)
        map.addLayer({ id: usLo(ym), type: 'line', source: usSrc(ym), 'source-layer': trackSource.us.sourceLayer,
          ...(salish ? { maxzoom: SALISH_Z } : {}), layout: { 'line-join': 'round' }, paint }, labelsId)
        if (salish) {
          map.addLayer({ id: usHi(ym), type: 'line', source: usSrc(ym), 'source-layer': trackSource.us.sourceLayer, minzoom: SALISH_Z,
            layout: { 'line-join': 'round' }, paint }, labelsId)
          map.addSource(trkSrc(ym), { type: 'vector', tiles: [trackTileUrl(ym)], minzoom: 5, maxzoom: 10,
            bounds: trackSource.bbox, attribution: 'Ship tracks: MarineCadastre AIS (NOAA / BOEM / USCG)' })
          map.addLayer({ id: trkLine(ym), type: 'line', source: trkSrc(ym), 'source-layer': trackSource.sourceLayer, minzoom: SALISH_Z,
            layout: { 'line-join': 'round' }, paint }, labelsId)
        }
      }
      for (const l of [usLo(ym), usHi(ym), trkLine(ym)]) {
        if (!map.getLayer(l)) continue
        map.setLayoutProperty(l, 'visibility', tracksOn ? 'visible' : 'none')
        map.setPaintProperty(l, 'line-opacity', opacity)
      }
      if (map.getLayer(trkLine(ym))) map.setFilter(trkLine(ym), kindFilter)
      map.setFilter(usLo(ym), kindFilter)
      if (map.getLayer(usHi(ym))) map.setFilter(usHi(ym), usHiFilter)
    }
    if (!map.getSource(OWN_SRC)) {
      map.addSource(OWN_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: OWN_CASING, type: 'line', source: OWN_SRC, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0a0e17', 'line-width': OWN_CASING_WIDTH, 'line-opacity': 0.85 } }, labelsId)
      map.addLayer({ id: OWN_LINE, type: 'line', source: OWN_SRC, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': OWN_COLOR, 'line-width': OWN_WIDTH, 'line-opacity': 1 } }, labelsId)
      map.addLayer({ id: OWN_HI_CASING, type: 'line', source: OWN_SRC, filter: ['==', ['get', 't0'], -1], layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0a0e17', 'line-width': OWN_HI_CASING_WIDTH, 'line-opacity': 0.9 } }, labelsId)
      map.addLayer({ id: OWN_HI, type: 'line', source: OWN_SRC, filter: ['==', ['get', 't0'], -1], layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': OWN_COLOR, 'line-width': OWN_HI_WIDTH, 'line-opacity': 1 } }, labelsId)
    }
    const ownVis = tracksOn && identityOn && vesselId ? 'visible' : 'none'
    for (const l of [OWN_CASING, OWN_LINE, OWN_HI_CASING, OWN_HI]) map.setLayoutProperty(l, 'visibility', ownVis)
    const hi = pickedTrack ? ['all', ['==', ['get', 'mmsi'], pickedTrack.mmsi], ['==', ['get', 't0'], pickedTrack.t0]]
      : stopFocus?.t0s?.length ? ['in', ['get', 't0'], ['literal', stopFocus.t0s]] : ['==', ['get', 't0'], -1]
    const dim = !!(pickedTrack || stopFocus?.t0s?.length)
    map.setFilter(OWN_HI_CASING, hi); map.setFilter(OWN_HI, hi)
    map.setPaintProperty(OWN_LINE, 'line-opacity', dim ? 0.55 : 1)
    map.setPaintProperty(OWN_CASING, 'line-opacity', dim ? 0.5 : 0.85)
    // Keep the picked ship above month layers added later, and still under the labels.
    for (const l of [OWN_CASING, OWN_LINE, OWN_HI_CASING, OWN_HI]) if (map.getLayer(l)) map.moveLayer(l, labelsId)
  }, [mapReady, styleVersion, trackMonths, trackKinds, tracksOn, identityOn, vesselId, usMonths, pickedTrack, stopFocus])

  // The picked ship's own tracks: every selected month × every MMSI it held.
  useEffect(() => {
    if (!vesselId || !mmsiPeriods.length || !trackMonths.length) { setOwnTracks([]); return }
    const ctl = new AbortController()
    const mmsis = [...new Set(mmsiPeriods.map((p) => p.mmsi))]
    const get = (url) => fetch(url, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] }))
    const [w, s, e, n] = trackSource.bbox
    const insideSalish = (f) => f.geometry.coordinates.every(([x, y]) => x >= w && x <= e && y >= s && y <= n)
    const salishM = new Set(trackSource.months || [])
    Promise.all(trackMonths.flatMap((ym) => mmsis.flatMap((m) => [
      ...(salishM.has(ym) ? [get(`/api/ship-tracks?t=${ym}&mmsi=${m}&v=${trackSource.version}`)] : []),
      // US-wide pack: in Salish months only the tracks outside the box (the detailed pack covers inside).
      get(`/api/ship-tracks?r=us&t=${ym}&mmsi=${m}&v=${trackSource.us.rules}`)
        .then((fc) => ({ features: salishM.has(ym) ? fc.features.filter((f) => !insideSalish(f)) : fc.features })),
    ])))
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

  // ─── Worldwide GFW layers, driven by the same month grid as the tracks ─────
  const gfwRange = useMemo(() => (trackMonths.length && usMonths !== null
    ? { from: monthStart(trackMonths[0]), to: monthAfter(trackMonths[trackMonths.length - 1]) } : null), [trackMonths, usMonths])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !gfwRange) return
    // Only the style JSON must be loaded to add layers. map.isStyleLoaded() also
    // waits for every tile, which on a moving globe can stay false indefinitely
    // (that hid all layers, 2026-09-25). So check the style itself.
    if (!map.style?._loaded) {
      const t = setTimeout(() => setStyleVersion((n) => n + 1), 200)
      return () => clearTimeout(t)
    }
    const labelsId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
    // Under our tracks (and the labels): the first track layer if present.
    const below = () => map.getStyle().layers.find((l) => l.id.startsWith('shiptrk'))?.id || labelsId
    // Ship presence was removed (Josh, 2026-09-26); only dark vessels remain.
    if (map.getLayer('gfw-presence-fill')) map.removeLayer('gfw-presence-fill')
    removeSourceSafe(map, 'gfw-presence')
    const src = 'gfw-dark', lyr = 'gfw-dark-fill'
    const url = gfwTileUrl('dark', gfwRange.from, gfwRange.to)
    const cur = map.getSource(src)
    // Swap the URL in place (the range changes as the US month list loads) instead of
    // re-creating the source; see removeSourceSafe.
    if (cur && cur.tiles?.[0] !== url) cur.setTiles([url])
    const paint = darkPaint(trackMonths.length)
    if (!map.getSource(src)) {
      map.addSource(src, { type: 'vector', tiles: [url], minzoom: 0, maxzoom: 12,
        attribution: '<a href="https://globalfishingwatch.org" target="_blank" rel="noopener">Powered by Global Fishing Watch.</a>' })
      map.addLayer({ id: lyr, type: 'fill', source: src, 'source-layer': 'main',
        paint: { ...paint, 'fill-antialias': false } }, below())
    }
    map.setLayoutProperty(lyr, 'visibility', darkOn ? 'visible' : 'none')
    map.setPaintProperty(lyr, 'fill-color', paint['fill-color'])
    map.setPaintProperty(lyr, 'fill-opacity', paint['fill-opacity'])
  }, [mapReady, styleVersion, gfwRange, darkOn, trackMonths.length])

  // Click a track → which ship held that MMSI when the track started → its card.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !trackMonths.length) return
    // Lines with an MMSI (Salish tracks, US-wide from z9) open their ship. Zoomed-out US tiles
    // merge lines per type (no MMSI), so a click there lists the ships that passed (op=near).
    const layers = trackMonths.flatMap((ym) => [trkLine(ym), usHi(ym), usLo(ym)])
    const hit = (pt) => {
      const live = layers.filter((l) => map.getLayer(l))
      if (!live.length) return []
      return map.queryRenderedFeatures([[pt.x - 4, pt.y - 4], [pt.x + 4, pt.y + 4]], { layers: live })
    }
    const onMove = (e) => { map.getCanvas().style.cursor = hit(e.point).length ? 'pointer' : '' }
    const openShip = async (mmsi, t0, month) => {
      setPickedTrack(t0 ? { mmsi: Number(mmsi), t0: Number(t0) } : null)
      setStopFocus(null); stopMarkerRef.current?.remove()
      const when = new Date(t0 * 1000).toISOString()
      const resolve = async () => (await fetch(`/api/ships?op=mmsi&mmsi=${mmsi}&at=${encodeURIComponent(when)}`)).json()
      try {
        let d = await resolve()
        // Not in our database yet: save what Global Fishing Watch knows (server checks the track
        // is real), then resolve again, so the ship opens with a full card (Josh, 2026-09-26).
        if (d.status === 'unresolved' && month) {
          setIdentityOn(true); setPickerOpen(false); setVesselId(null); setTrackNote(`Looking up MMSI ${mmsi} with Global Fishing Watch…`)
          const sv = await fetch(`/api/ships?op=save&items=${mmsi}:${month}`, { method: 'POST' }).catch(() => null)
          if (sv?.ok) d = await resolve()
        }
        // Several of our ships share this MMSI: GFW's identity for this exact time may settle it.
        if (d.status === 'ambiguous' && month) {
          const lr = await fetch(`/api/ships?op=lookup&items=${mmsi}:${month}:${t0}`).catch(() => null)
          const hit = lr?.ok ? (await lr.json()).ships?.[0] : null
          if (hit?.status === 'db' && hit.vesselId) d = { status: 'resolved', vesselIds: [hit.vesselId] }
        }
        if (d.status === 'resolved') {
          setIdentityOn(true); setPickerOpen(false); setVesselName(null); setVesselId(d.vesselIds[0]); setTrackNote(null)
        } else {
          setIdentityOn(true); setPickerOpen(false); setVesselId(null); setMmsiPeriods([])
          setTrackNote(d.status === 'ambiguous'
            ? `MMSI ${mmsi} was used by ${d.vesselIds.length} different ships at ${when.slice(0, 10)}, so EarthAtlas won't guess which one this track is.`
            : `No identity record for MMSI ${mmsi} on ${when.slice(0, 10)}, here or at Global Fishing Watch. Its AIS track is real; the ship just isn't identified.`)
        }
      } catch { setTrackNote('Could not look up this track’s ship.') }
    }
    const onClick = async (e) => {
      const hits = hit(e.point)
      if (!hits.length) return
      const f = hits.find((h) => h.properties.mmsi != null)
      if (f) { nearPopupRef.current?.remove(); return openShip(f.properties.mmsi, f.properties.t0, f.properties.month) }
      // Zoomed out: ~6 px around the click, in metres (512 px tiles).
      const mpp = (40075016.686 * Math.cos((e.lngLat.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
      const tol = Math.round(Math.min(25000, Math.max(200, 6 * mpp)))
      const months = trackMonths
      nearPopupRef.current?.remove()
      const popup = new mapboxgl.Popup({ offset: 8, maxWidth: '300px' }).setLngLat(e.lngLat)
        .setHTML(nearPopupHTML({ loading: true })).addTo(map)
      nearPopupRef.current = popup
      let d = null
      try {
        const r = await fetch(`${TILES_BASE}/api/ship-tracks?op=near&t=${months.join(',')}&lng=${e.lngLat.lng.toFixed(4)}&lat=${e.lngLat.lat.toFixed(4)}&tol=${tol}`)
        d = r.ok ? await r.json() : null
      } catch { d = null }
      if (nearPopupRef.current !== popup) return
      const render = (ids) => {
        popup.setHTML(nearPopupHTML(d ? { ...d, tol, months, ids } : { error: true }))
        popup.getElement()?.querySelectorAll('[data-mmsi]').forEach((b) => b.addEventListener('click', () => {
          popup.remove(); openShip(Number(b.dataset.mmsi), Number(b.dataset.t0), b.dataset.month)
        }))
      }
      render(null)
      if (!d?.ships?.length) return
      // Names + kinds: our database first, then Global Fishing Watch; GFW finds are saved.
      const items = d.ships.filter((v) => v.t0).map((v) => `${v.mmsi}:${v.months[0]}:${v.t0}`)
      try {
        const lr = await fetch(`/api/ships?op=lookup&items=${items.join(',')}`)
        const ids = lr.ok ? Object.fromEntries((await lr.json()).ships.map((x) => [x.mmsi, x])) : {}
        if (nearPopupRef.current === popup) render(ids)
        const toSave = d.ships.filter((v) => ids[v.mmsi]?.status === 'gfw')
        for (let i = 0; i < toSave.length; i += 10) {
          fetch(`/api/ships?op=save&items=${toSave.slice(i, i + 10).map((v) => `${v.mmsi}:${v.months[0]}`).join(',')}`, { method: 'POST' }).catch(() => {})
        }
      } catch { /* names are a bonus; the list still works by MMSI */ }
    }
    map.on('mousemove', onMove)
    map.on('click', onClick)
    return () => { map.off('mousemove', onMove); map.off('click', onClick); nearPopupRef.current?.remove() }
  }, [mapReady, trackMonths])

  // ─── Dark-vessel cell popup: regional context for one grid cell ───────────
  // (nearPopupRef: the zoomed-out "ships that passed here" popup, opened by the tracks click handler)
  // Track lines win a click (their handler opens the ship); otherwise a dark cell opens this.
  const darkPopupRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !darkOn || !gfwRange) return
    const trackLayers = () => map.getStyle().layers.filter((l) => l.id.startsWith('shiptrk')).map((l) => l.id)
    const onClick = async (e) => {
      if (!map.getLayer('gfw-dark-fill')) return
      if (map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: trackLayers() }).length) return
      const f = map.queryRenderedFeatures(e.point, { layers: ['gfw-dark-fill'] })[0]
      if (!f) return
      const [z, x, y, cell] = String(f.properties.id).split('/').map(Number)
      const count = f.properties.count
      // Rank among the dark cells currently drawn (real counts, same period).
      const inView = map.queryRenderedFeatures({ layers: ['gfw-dark-fill'] }).map((g) => g.properties.count)
      const below = inView.filter((c) => c < count).length
      const pct = inView.length > 20 ? Math.round((100 * below) / inView.length) : null
      const months = trackMonths.length
      const period = months === 1 ? fmtMonth(trackMonths[0]) : `${fmtMonth(trackMonths[0])} – ${fmtMonth(trackMonths[months - 1])}`
      darkPopupRef.current?.remove()
      const popup = new mapboxgl.Popup({ offset: 8, maxWidth: '290px' }).setLngLat(e.lngLat)
        .setHTML(darkPopupHTML({ count, months, period, pct, detail: null })).addTo(map)
      darkPopupRef.current = popup
      try {
        const r = await fetch(`${TILES_BASE}/api/gfw-tiles?op=cell&from=${gfwRange.from}&to=${gfwRange.to}&z=${z}&x=${x}&y=${y}&cell=${cell}`)
        const detail = r.ok ? await r.json() : { error: true }
        if (darkPopupRef.current === popup) popup.setHTML(darkPopupHTML({ count, months, period, pct, detail }))
      } catch {
        if (darkPopupRef.current === popup) popup.setHTML(darkPopupHTML({ count, months, period, pct, detail: { error: true } }))
      }
    }
    const onMove = (e) => {
      if (!map.getLayer('gfw-dark-fill') || map.getCanvas().style.cursor === 'pointer') return
      if (map.queryRenderedFeatures(e.point, { layers: ['gfw-dark-fill'] }).length) map.getCanvas().style.cursor = 'pointer'
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)
    return () => { map.off('click', onClick); map.off('mousemove', onMove); darkPopupRef.current?.remove() }
  }, [mapReady, darkOn, gfwRange, trackMonths])

  // ─── Marine protected areas ────────────────────────────────────────────────────
  // Fill under everything (dark cells, tracks); outline over the track lines so a boundary still
  // reads through busy lanes, but under the picked ship's cyan tracks and the labels. Tracks are
  // (re)added under the labels whenever the months change, so the outline is re-seated after them.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    // Same gate as the track layers: only the style JSON must be loaded (see there).
    if (!map.style?._loaded) {
      const t = setTimeout(() => setStyleVersion((n) => n + 1), 200)
      return () => clearTimeout(t)
    }
    const layers = map.getStyle().layers
    if (!map.getSource('mpa')) {
      const below = layers.find((l) => l.id === 'gfw-dark-fill' || l.id.startsWith('shiptrk'))?.id || layers.find((l) => l.type === 'symbol')?.id
      map.addSource('mpa', { type: 'vector', tiles: [mpaTileUrl], minzoom: 0, maxzoom: trackSource.mpa.maxzoom,
        attribution: `<a href="${MPA.sourceUrl}" target="_blank" rel="noopener">NOAA MPA Inventory</a>` })
      map.addLayer({ id: 'mpa-fill', type: 'fill', source: 'mpa', 'source-layer': trackSource.mpa.sourceLayer,
        paint: { 'fill-color': MPA_FILL_COLOR, 'fill-opacity': MPA_FILL_OPACITY } }, below)
      map.addLayer({ id: 'mpa-line', type: 'line', source: 'mpa', 'source-layer': trackSource.mpa.sourceLayer, layout: { 'line-join': 'round' },
        paint: { 'line-color': MPA_FILL_COLOR, 'line-opacity': MPA_LINE_OPACITY, 'line-width': MPA_LINE_WIDTH } }, below)
    }
    const top = map.getLayer(OWN_CASING) ? OWN_CASING : layers.find((l) => l.type === 'symbol')?.id
    if (top) map.moveLayer('mpa-line', top)
    for (const id of ['mpa-fill', 'mpa-line']) map.setLayoutProperty(id, 'visibility', mpaOn ? 'visible' : 'none')
  }, [mapReady, styleVersion, mpaOn, trackMonths])

  // Click inside a protected area → its rules. Tracks and dark-vessel cells take the click first.
  const mpaPopupRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !mpaOn) return
    const otherLayers = () => map.getStyle().layers.filter((l) => l.id.startsWith('shiptrk') || l.id === 'gfw-dark-fill').map((l) => l.id)
    const onClick = (e) => {
      if (!map.getLayer('mpa-fill')) return
      const others = otherLayers()
      if (others.length && map.queryRenderedFeatures([[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]], { layers: others }).length) return
      const hits = map.queryRenderedFeatures(e.point, { layers: ['mpa-fill'] })
      if (!hits.length) return
      // Overlapping sites (a reserve inside a sanctuary): show the smallest, the most specific one.
      const f = hits.reduce((a, b) => ((b.properties.AreaKm ?? Infinity) < (a.properties.AreaKm ?? Infinity) ? b : a))
      mpaPopupRef.current?.remove()
      mpaPopupRef.current = new mapboxgl.Popup({ offset: 8, maxWidth: '310px' }).setLngLat(e.lngLat).setHTML(mpaPopupHTML(f.properties)).addTo(map)
    }
    const onMove = (e) => {
      if (!map.getLayer('mpa-fill') || map.getCanvas().style.cursor === 'pointer') return
      if (map.queryRenderedFeatures(e.point, { layers: ['mpa-fill'] }).length) map.getCanvas().style.cursor = 'pointer'
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)
    return () => { map.off('click', onClick); map.off('mousemove', onMove); mpaPopupRef.current?.remove() }
  }, [mapReady, mpaOn])

  // ─── A stop from the Ports tab on the map (Josh, 2026-09-27) ────────────────
  // Marker on GFW's stop point (the anchorage cell, not the exact berth), the ship's own track arriving
  // before and leaving after highlighted, the view fitted to them, and AIS silences around the stop named.
  const showStop = useCallback((v) => {
    const map = mapRef.current
    if (!map || !Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return
    const s = Date.parse(v.start_at) / 1000, e = v.end_at ? Date.parse(v.end_at) / 1000 : s
    const month = String(v.start_at).slice(0, 7)
    const before = ownTracks.filter((f) => f.properties.t1 <= s + 3600).sort((a, b) => b.properties.t1 - a.properties.t1)[0]
    const after = ownTracks.filter((f) => f.properties.t0 >= e - 3600).sort((a, b) => a.properties.t0 - b.properties.t0)[0]
    const hrs = (h) => (h < 48 ? `${Math.round(h)} hours` : `${(h / 24).toFixed(1)} days`)
    const notes = []
    if (!trackMonths.includes(month)) notes.push(`${fmtMonth(month)} isn’t among the months shown, so the ship’s tracks around this stop aren’t drawn. Pick it under When.`)
    else {
      const gapIn = before ? (s - before.properties.t1) / 3600 : null, gapOut = after ? (after.properties.t0 - e) / 3600 : null
      if (!before) notes.push('No AIS track before this stop in the months shown.')
      else if (gapIn > 3) notes.push(`AIS was silent for ${hrs(gapIn)} before the ship arrived.`)
      if (!after) notes.push('No AIS track after this stop in the months shown.')
      else if (gapOut > 3) notes.push(`AIS was silent for ${hrs(gapOut)} after the ship left.`)
    }
    setPickedTrack(null)
    setStopFocus({ t0s: [before, after].filter(Boolean).map((f) => f.properties.t0) })
    stopMarkerRef.current?.remove()
    const el = document.createElement('div')
    el.className = styles.stopMarker
    const day = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '?')
    const popup = new mapboxgl.Popup({ offset: 12, maxWidth: '290px' }).setHTML(
      `<div class="${styles.popup}">` +
      // Which ship: its name and IMO from the card, and the MMSI it was broadcasting on at this stop (GFW).
      (v.ship?.name ? `<div class="${styles.popupShipHead}">${escapeHtml(v.ship.name)}</div>` : '') +
      `<div class="${styles.popupMeta}">${[v.ship?.imo && `IMO ${escapeHtml(v.ship.imo)}`, (v.ssvid || v.ship?.mmsi) && `MMSI ${escapeHtml(v.ssvid || v.ship.mmsi)}`].filter(Boolean).join(' · ')}</div>` +
      `<div class="${styles.popupHead}" style="margin-top:8px">Stop · ${escapeHtml(v.stop_kind_text || 'port visit')}</div>` +
      `<div class="${styles.popupTitle}">${escapeHtml(v.title || v.port_label || 'Stop')}</div>` +
      `<div class="${styles.popupMeta}">${escapeHtml(day(v.start_at))} → ${escapeHtml(day(v.end_at))} UTC</div>` +
      notes.map((n) => `<div class="${styles.popupNote}">${escapeHtml(n)}</div>`).join('') +
      `<div class="${styles.popupNote}">The marker is Global Fishing Watch’s point for this anchorage (a grid cell about 0.5 km across), not the ship’s exact berth. A ship sitting still draws no track line.</div></div>`)
    stopMarkerRef.current = new mapboxgl.Marker({ element: el }).setLngLat([v.lon, v.lat]).setPopup(popup).addTo(map)
    stopMarkerRef.current.togglePopup()
    // Fit to the stop plus the nearby ends of the arriving / leaving tracks (within 20 km); after a long
    // AIS silence those ends can be far away, so they don't count, and the view stays on the stop.
    const km = (c) => Math.hypot((c[0] - v.lon) * 111.32 * Math.cos((v.lat * Math.PI) / 180), (c[1] - v.lat) * 111.32)
    const near = [...(before ? before.geometry.coordinates.slice(-60) : []), ...(after ? after.geometry.coordinates.slice(0, 60) : [])].filter((c) => km(c) <= 20)
    const b = new mapboxgl.LngLatBounds([v.lon - 0.01, v.lat - 0.006], [v.lon + 0.01, v.lat + 0.006])
    near.forEach((c) => b.extend(c))
    const card = document.querySelector('[aria-label="Ship card"]')?.getBoundingClientRect()
    map.fitBounds(b, { padding: { top: 90, bottom: 50, left: isMobile ? 30 : 330, right: isMobile ? 30 : Math.min(480, (card?.width || 400) + 60) },
      maxZoom: 14, duration: 1200 })
  }, [ownTracks, trackMonths, isMobile])
  useEffect(() => () => { stopMarkerRef.current?.remove() }, [])
  useEffect(() => { setStopFocus(null); stopMarkerRef.current?.remove() }, [vesselId])

  const handlePlace = useCallback((r) => { flyToSearchResult(mapRef.current, r) }, [])

  // ─── Shareable URL ────────────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (!identityOn) sp.set('id', '0')
    if (!tracksOn) sp.set('tr', '0')
    if (!darkOn) sp.set('dk', '0')
    if (mpaOn) sp.set('mp', '1')
    if (trackSel[0] !== defaultSel[0] || trackSel[1] !== defaultSel[1]) {
      const [a, b] = trackSel
      sp.set('tm', a === b ? a : `${a}_${b}`)
    }
    if (trackKinds.length) sp.set('tk', trackKinds.join(','))
    if (vesselId) sp.set('v', vesselId)
    if (vesselId && cardTab !== 'overview') sp.set('ct', cardTab)
    if (vesselId && cardFolded) sp.set('cf', '1')
    if (query.trim()) sp.set('q', query.trim())
    if (kinds.length) sp.set('k', kinds.join(','))
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityOn, tracksOn, darkOn, mpaOn, trackSel, trackKinds, vesselId, cardTab, cardFolded, query, kinds, basemap, mapView, mapReady])

  const toggleIdentity = () => {
    const next = !identityOn
    setIdentityOn(next)
    setPickerOpen(next && !vesselId) // turning on with nothing picked → open the search
  }
  const pickShip = (r) => { fitToOwnRef.current = true; setPickedTrack(null); setVesselName(r.latest?.name?.value || null); setVesselId(r.id); setPickerOpen(false) }

  if (!MAPBOX_TOKEN) return <div className={styles.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div>

  const activeCount = (identityOn ? 1 : 0) + (tracksOn && allTrackMonths.length ? 1 : 0) + (darkOn ? 1 : 0) + (mpaOn ? 1 : 0)
  const anyTimed = tracksOn || darkOn
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
            <VesselCard vesselId={vesselId} tab={cardTab} onTab={setCardTab} folded={cardFolded} onFold={setCardFolded}
              onClose={() => { setVesselId(null); setVesselName(null); setMmsiPeriods([]); setCardTab('overview'); setCardFolded(false); setPickedTrack(null) }}
              onSelectVessel={(id) => setVesselId(id)}
              onShowPlace={showStop}
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
              {[[DARK, darkOn, setDarkOn]].map(([def, on, set]) => (
                <button key={def.id} type="button" className={`${styles.dockBtn} ${on ? styles.dockOn : ''}`}
                  style={on ? hueStyle(def.hue) : undefined} onClick={() => set((o) => !o)} aria-pressed={on} aria-label={def.name}>
                  <Icon svg={def.iconSvg} size={isMobile ? 16 : 19} />
                  {on && <span className={styles.liveDotHue} aria-hidden="true" />}
                  {!isMobile && <span className={styles.dockTip} aria-hidden="true">{def.name} <span>· {def.sub}</span></span>}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.dockGroup}>
            <div className={styles.dockGroupLabel}>PLACES</div>
            <div className={styles.dockGrid}>
              <button type="button" className={`${styles.dockBtn} ${mpaOn ? styles.dockOn : ''}`}
                style={mpaOn ? hueStyle(MPA.hue) : undefined} onClick={() => setMpaOn((o) => !o)} aria-pressed={mpaOn} aria-label={MPA.name}>
                <Icon svg={MPA.iconSvg} size={isMobile ? 16 : 19} />
                {mpaOn && <span className={styles.liveDotHue} aria-hidden="true" />}
                {!isMobile && <span className={styles.dockTip} aria-hidden="true">{MPA.name} <span>· {MPA.sub}</span></span>}
              </button>
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
                {anyTimed && allTrackMonths.length > 0 && (
                  <div className={styles.whenBlock}>
                    <TrackMonths months={allTrackMonths} range={trackRange} onRange={setTrackRange} styles={styles} cap={TRACK_MONTH_CAP} />
                    <div className={styles.legendNoteText}>Applies to tracks and dark vessels.</div>
                  </div>
                )}
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
                        <div className={styles.fieldLabel}>Kind of ship</div>
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
                        US waters, {fmtMonth(allTrackMonths[0])} – {fmtMonth(allTrackMonths[allTrackMonths.length - 1])}, with more detailed
                        tracks in the Salish Sea for {fmtMonth(salishMonths[0])} – {fmtMonth(salishMonths[salishMonths.length - 1])}. Zoom in and
                        click a track for its ship; a picked ship’s own tracks show in cyan. Data:{' '}
                        <a className={styles.sourceLink} href={TRACKS.sourceUrl} target="_blank" rel="noopener noreferrer">{TRACKS.sourceName}</a>, public domain.
                      </div>
                    )}
                  </div>
                )}
                {[[DARK, darkOn, setDarkOn]].map(([def, on, set]) => (
                  <div key={def.id} className={styles.layerBlock}>
                    <div className={styles.layerRow} role="switch" aria-checked={on} tabIndex={0} onClick={() => set((o) => !o)}
                      onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set((o) => !o) } }}>
                      <span className={`${styles.rowIcon} ${on ? styles.dockOn : ''}`} style={on ? hueStyle(def.hue) : undefined} aria-hidden="true">
                        <Icon svg={def.iconSvg} size={16} />
                      </span>
                      <div className={styles.layerInfo}>
                        <span className={styles.layerName}>{def.name}</span>
                        <span className={styles.layerSub}>{def.sub}</span>
                      </div>
                    </div>
                    {on && def.id === 'dark' && (
                      <div className={styles.liveNote}>
                        Hotspots of vessels seen by Sentinel-1 radar while not broadcasting AIS: the brighter the cell, the more such
                        detections per month. Quiet areas are hidden. Not every dark vessel is doing wrong (many small boats aren’t required
                        to carry AIS), and there are no identities. Radar misses most
                        boats under 15 m and anything within 1 km of shore, doesn’t cover most of the open ocean, and some detections are noise.
                        About 5–6 days behind.{' '}
                        <a className={styles.sourceLink} href={def.sourceUrl} target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch.</a> CC BY-NC 4.0.
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className={styles.group}>
                <div className={styles.groupHead}>Places</div>
                <div className={styles.layerBlock}>
                  <div className={styles.layerRow} role="switch" aria-checked={mpaOn} tabIndex={0} onClick={() => setMpaOn((o) => !o)}
                    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setMpaOn((o) => !o) } }}>
                    <span className={`${styles.rowIcon} ${mpaOn ? styles.dockOn : ''}`} style={mpaOn ? hueStyle(MPA.hue) : undefined} aria-hidden="true">
                      <Icon svg={MPA.iconSvg} size={16} />
                    </span>
                    <div className={styles.layerInfo}>
                      <span className={styles.layerName}>{MPA.name}</span>
                      <span className={styles.layerSub}>{MPA.sub}</span>
                    </div>
                  </div>
                  {mpaOn && (
                    <div className={styles.liveNote}>
                      <div className={styles.mpaLegend}>
                        {MPA_LEVELS.map(([k, name], i) => (
                          <div key={k} className={styles.mpaLegendRow}>
                            <span className={styles.mpaSwatch} style={{ background: MPA_SHADES[i], opacity: 0.35 + i * 0.12 }} aria-hidden="true" />
                            {name}
                          </div>
                        ))}
                      </div>
                      Every US marine protected area that meets the IUCN definition: federal, state, territorial, local and jointly run. Deeper
                      green = stricter protection. Click one for its fishing, vessel and anchoring rules. Not for navigation or legal
                      boundaries. Data:{' '}
                      <a className={styles.sourceLink} href={MPA.sourceUrl} target="_blank" rel="noopener noreferrer">{MPA.sourceName}</a>,
                      as of {fmtIsoDay(trackSource.mpa.version)}, public domain.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </MapSheet>
      )}
    </div>
  )
}
