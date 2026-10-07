/**
 * EarthAtlas /sanjuan-docks — WDFW Hydraulic Project Approval (HPA) permits for
 * docks in San Juan County, 2014–2024, as baked by scripts/bake-wdfw-hpa-docks.mjs
 * into public/hpa/san-juan-docks.geojson — one point per dock, its permits grouped
 * (shared parcel or same spot). Click a dock for every permit's raw attributes, by date.
 *
 * A plain data viewer: chrome is borrowed from /quakes (QuakesApp.module.css) and
 * follows docs/MAP_TOOL_CONVENTIONS.md — aerial-imagery default (county 2025 aerials), URL state (camera,
 * basemap, selected dock), shared zoom badge / share / popup fitting.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { keepPopupOnMap } from '../lib/popupFit.js'
import { installPopupSheet } from '../lib/popupSheet.js'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import BuiltByCredit from '../components/BuiltByCredit.jsx'
import q from '../quakes/QuakesApp.module.css'
import styles from './HpaDocksApp.module.css'

installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DATA_URL = '/hpa/san-juan-docks.geojson'
const DOCKS_URL = '/hpa/dock-locations.geojson' // scripts/sanjuan-docks/bake-dock-locations.py
const FRIENDS_BADGE = '/hpa/friends-logo.png' // Friends' black-on-white wordmark (from Josh, 2026-10-06)
const FRIENDS_PAGE = 'https://sanjuans.org/our-work/shoreline-ecosystems/'
const SJC_AERIALS_PAGE = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer'

// Every known dock, from any source (OSM tracing, Friends survey point, or the permit's
// own point), carries its matched permit site's permits and wears its permit colour; one
// with no permit found wears its match colour. OSM docks also draw their traced shape.
const OSM_MATCH_COLORS = [
  { id: 'permit_parcel', label: 'Permit on record (same parcel)', color: '#2dd4bf' },
  { id: 'near_wdfw_point', label: 'Permit on record (WDFW dock within 40 m)', color: '#2dd4bf' },
  { id: 'neighbour_parcel', label: 'Permit on record (neighbouring parcel)', color: '#2dd4bf' },
  { id: 'permit_only', label: 'Permit on record (dock located by the permit)', color: '#2dd4bf' },
  { id: 'no_permit_found', label: 'Dock, no permit found in public records', color: '#f472b6' },
  { id: 'no_parcel', label: 'Dock, not next to a waterfront parcel', color: '#9ca3af' },
]
const MATCHED = new Set(['permit_parcel', 'near_wdfw_point', 'neighbour_parcel', 'permit_only'])

// Where a dock's position comes from — closes every dock popup.
const LOCATED_BY = {
  osm: 'Position: traced in OpenStreetMap.',
  friends: 'Position: the Friends of the San Juans shoreline survey point (2008–2009). Not traced in OpenStreetMap.',
  wdfw_permit: "Position: the WDFW permit's dock location. Not in OpenStreetMap or the Friends survey.",
  aerial: 'Position: found in the 2025 county aerial photos and confirmed by eye. Not in OpenStreetMap, the Friends survey or any permit location.',
  parcel_point: 'Position approximate: the county parcel point, not the dock itself — no OpenStreetMap tracing, Friends survey point or WDFW location for this dock.',
}

// Where a dock's position comes from, plus how a Friends survey point joined an OSM
// dock when it wasn't right on it.
function locatedNote(props) {
  const j = props.friends_join
  const join = j?.method === 'same_parcel'
    ? ` The Friends survey point is ${j.distance_m} m from the traced dock — on the same parcel, and the only dock there — so it is taken as this dock's survey record.`
    : ''
  const where = props.located_by === 'parcel_point' && props.position_note
    ? 'Position approximate: where the dock’s parcel meets the water (no OpenStreetMap tracing, Friends survey point or WDFW location for this dock).'
    : (LOCATED_BY[props.located_by] ?? '')
  const lake = props.waterbody === 'lake/pond'
    ? ` On ${props.waterbody_name || 'a lake or pond'} — a freshwater dock, not on the sea.` : ''
  const outline = props.located_by === 'friends' && props.aerial
    ? ' Its outline was drawn from the 2025 county aerials.' : ''
  const gone = props.absent_2025
    ? ' Checked on the 2025 county aerials: no dock is visible here now — it may have been removed since this record.' : ''
  return where + join + lake + outline + gone
}

// The dock's county parcel, with its address and a link to the county record — shown
// near the top of every dock popup, with how it was assigned.
const PARCEL_METHOD = {
  shore_end: 'The dock’s shore end is on this waterfront parcel.',
  permit_record: 'The parcel on this dock’s own permit records.',
  nearest_parcel: 'The nearest parcel to the dock',
}
function parcelHtml(props) {
  if (!props.parcel_number) return `<div class="${styles.parcel}">No county parcel next to this dock</div>`
  const how = PARCEL_METHOD[props.parcel_method] + (props.parcel_method === 'nearest_parcel' && props.parcel_distance_m ? `, ${props.parcel_distance_m} m away.` : '')
  const bits = [props.parcel_address, props.parcel_area, props.parcel_acres ? `${props.parcel_acres} ac` : null].filter(Boolean).map(escapeHtml)
  return `<div class="${styles.parcel}" title="${escapeHtml(how)}">Parcel ` +
    `<a class="${styles.popupLink}" href="${escapeHtml(props.parcel_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(props.parcel_number)} ↗</a>` +
    (bits.length ? ` · ${bits.join(' · ')}` : '') + `<span class="${styles.parcelHow}">${escapeHtml(how)} Source: San Juan County GIS.</span></div>`
}

// How a dock was tied to its permits.
function matchNote(props) {
  const d = props.permit_site_distance_m
  if (props.permit_match === 'permit_parcel') return `Matched by county parcel ${props.parcel_number}: the dock and its permits are on the same parcel.`
  if (props.permit_match === 'near_wdfw_point') return `Matched by location: a WDFW permit marks this dock ${d} m away.`
  if (props.permit_match === 'permit_only') return 'These permits are the only record of this dock.'
  return `Likely match, not certain: the permits are on the neighbouring parcel (dock is on ${props.parcel_number}), ` +
    `and no other mapped dock or permit site sits between them. Permit point is ${d} m away.`
}
const DEFAULT_VIEW = { center: [-122.95, 48.6], zoom: 10 }

// San Juan County's own 2025 orthophotos (EagleView), rendered on demand by the
// county's ArcGIS export endpoint — no pan-sharpening glint "confetti" on the water
// like Mapbox satellite at high zoom. Mapbox satellite sits beneath it outside the
// county and below z10. From z10 the county mosaic also replaces Mapbox's glary
// white water (renders in ~0.6 s/tile, tested 2026-10-06); its own flat blue-grey
// fill shows past the edge of its coverage.
const SJC_AERIALS_2025 = 'https://gis.sanjuancountywa.gov/arcgis/rest/services/Basemaps/Aerials_2025/MapServer'
// The county mosaic's own flat fill past its coverage (sampled from a z10 render).
// Open water outside the county is painted this colour so the seam disappears and
// Mapbox satellite's sun-glint white water never shows.
const SJC_WATER = '#3f6073'
const sjcAerialsStyle = {
  version: 8,
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  sources: {
    'mapbox-satellite': { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 },
    'mapbox-streets': { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
    'sjc-aerials': {
      type: 'raster',
      tiles: [`${SJC_AERIALS_2025}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&transparent=false&f=image`],
      tileSize: 256,
      bounds: [-123.25, 48.4, -122.7, 48.81],
      minzoom: 10,
      maxzoom: 21,
      attribution: '<a href="' + SJC_AERIALS_2025 + '" target="_blank" rel="noopener">2025 aerials: San Juan County / EagleView</a>',
    },
  },
  layers: [
    { id: 'mapbox-satellite', type: 'raster', source: 'mapbox-satellite' },
    { id: 'open-water', type: 'fill', source: 'mapbox-streets', 'source-layer': 'water', paint: { 'fill-color': SJC_WATER } },
    { id: 'sjc-aerials', type: 'raster', source: 'sjc-aerials', minzoom: 10 },
  ],
}

const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'sjc2025', label: 'County aerials 2025', style: sjcAerialsStyle },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
// County aerials by default: no sun-glint on the water, where the docks are.
const DEFAULT_BASEMAP = 'sjc2025'
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// Dock category (set at bake) → dot colour.
const CATEGORY_COLORS = [
  { id: 'wdfw_active', label: 'WDFW permit currently active', color: '#fbbf24' },
  { id: 'wdfw', label: 'WDFW permit 2014–2024, not active', color: '#38bdf8' },
  { id: 'county_recent', label: 'County permit 2010–present (SmartGov), no WDFW permit', color: '#4ade80' },
  { id: 'county_only', label: 'County permits 1972–2010 only — dot at the parcel', color: '#c084fc' },
]
const CATEGORY_COLOR_EXPR = ['match', ['get', 'category'], ...CATEGORY_COLORS.flatMap((c) => [c.id, c.color]), '#9ca3af']
// A dock — click point and traced shape alike — wears its permit colour, or without
// permits its match colour.
const DOCK_COLOR_EXPR = ['case', ['has', 'category'], CATEGORY_COLOR_EXPR,
  ['match', ['get', 'permit_match'], ...OSM_MATCH_COLORS.flatMap((c) => [c.id, c.color]), '#9ca3af']]

// Join the two files: a matched dock takes its permit site's category and count, and the
// site is flagged `traced` so the fused view hides its own dot (every site has a dock).
const permitDate = (p) => p.issued || p.submitted || ''

// Colour from a dock's own permits (same rule as the permit-map bake): latest WDFW
// permit active / any WDFW / any county SmartGov (2010–) / county pre-2010 only.
function categoryOf(permits) {
  const wdfw = permits.filter((p) => /^WDFW/.test(p.source ?? ''))
  if (wdfw.length) return wdfw[wdfw.length - 1].status === 'HPA Issued (Active)' ? 'wdfw_active' : 'wdfw'
  return permits.some((p) => /SmartGov/.test(p.source ?? '')) ? 'county_recent' : 'county_only'
}

// A dock's permits: every permit of its sites (a county permit on its parcel plus a
// WDFW permit at the dock itself…), or — on a parcel with several docks — only the
// ones the bake assigned to it (`permit_keys`: 'site#index'). Null when none are left.
function combineSites(sites, keys) {
  const allow = keys ? new Set(keys) : null
  const permits = sites.flatMap((x) => x.properties.permits.filter((_, i) => !allow || allow.has(`${x.properties.site_id}#${i}`)))
    .sort((a, b) => permitDate(a).localeCompare(permitDate(b)))
  if (!permits.length) return null
  if (sites.length === 1 && !allow) return sites[0]
  const newest = [...permits].reverse().find((p) => p.project_name)
  return {
    ...sites[0],
    properties: {
      ...sites[0].properties,
      permits,
      permit_count: permits.length,
      category: categoryOf(permits),
      latest_name: newest?.project_name ?? sites[0].properties.latest_name,
      combined_site_ids: sites.length > 1 ? sites.map((x) => x.properties.site_id) : undefined,
      split: !!allow,
    },
  }
}

// Join the two files: a matched dock takes its permit sites' combined category and
// count, and each site is flagged `traced` so the fused view hides its own dot.
function fuse(permitFc, osmFc, linked, siteOfDock) {
  const sites = new Map(permitFc.features.map((f) => [f.properties.site_id, f]))
  for (const f of osmFc.features) {
    if (!MATCHED.has(f.properties.permit_match)) continue
    const ids = f.properties.permit_site_ids?.length ? f.properties.permit_site_ids : [f.properties.permit_site_id]
    const own = ids.map((id) => sites.get(id)).filter(Boolean)
    if (!own.length) continue
    const site = combineSites(own, f.properties.permit_keys)
    if (!site) continue
    f.properties.category = site.properties.category
    f.properties.permit_count = site.properties.permit_count
    siteOfDock.set(f.properties.facility_id, site)
    for (const x of own) {
      x.properties.traced = true
      if (f.properties.kind === 'point') linked.set(x.properties.site_id, [...(linked.get(x.properties.site_id) ?? []), f])
    }
  }
}

// Fused view: docks carry the permits (a dock placed only at a parcel point is a faint
// ring). Off: the permit map alone, every permit site as a solid dot.
function applyView(map, showOsm) {
  const fused = showOsm && !!map.getLayer('osm-points')
  for (const id of ['osm-fill', 'osm-line', 'osm-points', 'osm-count']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', fused ? 'visible' : 'none')
  }
  const untraced = ['!', ['to-boolean', ['get', 'traced']]]
  const many = ['>', ['get', 'permit_count'], 1]
  map.setFilter('docks', fused ? untraced : null)
  map.setFilter('docks-count', fused ? ['all', many, untraced] : many)
  map.setPaintProperty('docks', 'circle-opacity', fused ? 0.18 : 1)
  map.setPaintProperty('docks', 'circle-stroke-color', fused ? CATEGORY_COLOR_EXPR : '#ffffff')
  map.setPaintProperty('docks', 'circle-stroke-opacity', fused ? 0.8 : 1)
  map.setPaintProperty('docks-count', 'text-color', fused ? '#ffffff' : '#0a0e17')
}

function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); return v == null || v === '' ? NaN : Number(v) }
  return { bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), p: sp.get('p'), d: sp.get('d'), osm: sp.get('osm') }
}

function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// Every permit at the dock, oldest → newest, each with all its properties exactly as
// stored in the GeoJSON. The newest permit starts expanded.
function attrTable(permit) {
  const rows = Object.entries(permit).map(([k, v]) => {
    const cell = v == null || v === ''
      ? `<span class="${styles.null}">null</span>`
      : k === 'source_url'
        ? `<a class="${styles.popupLink}" href="${escapeHtml(v)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)} ↗</a>`
        : escapeHtml(v)
    return `<tr><th>${escapeHtml(k)}</th><td>${cell}</td></tr>`
  })
  return `<table class="${styles.attrs}">${rows.join('')}</table>`
}

// Which agency filed the permit — a short tag on each permit row (full name on hover).
function agencyOf(permit) {
  return /^WDFW/.test(permit.source ?? '')
    ? { tag: 'WDFW', name: 'Washington Department of Fish and Wildlife (state)' }
    : { tag: 'SJC', name: 'San Juan County' }
}

// OSM record of a dock: its match fields plus, for a clicked shape, that way's OSM tags.
function osmSectionHtml(props) {
  const flat = Object.fromEntries(Object.entries(props).flatMap(([k, v]) => {
    if (['kind', 'friends_survey', 'aerial', 'osm_urls', 'osm_url', 'category', 'permit_count'].includes(k)) return []
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v).map(([tk, tv]) => [`osm:${tk}`, tv])
    return [[k, Array.isArray(v) ? v.join(' ') : v]]
  }))
  const links = (props.osm_urls ?? [props.osm_url]).filter(Boolean)
    .map((u) => `<a class="${styles.popupLink}" href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer">${escapeHtml(u.replace('https://www.', ''))} ↗</a>`).join('<br>')
  return attrTable(flat) + `<div class="${styles.osmLinks}">${links}</div>` +
    `<div class="${styles.popupCount}">Source: OpenStreetMap — © OpenStreetMap contributors, ODbL</div>`
}

// Friends of the San Juans survey record(s) of a dock, with their logo (Friends data
// is always shown with it).
function friendsSectionHtml(survey, open = false) {
  if (!survey?.length) return ''
  return `<details class="${styles.permit}"${open ? ' open' : ''}><summary>Friends of the San Juans shoreline survey` +
    `${survey.length > 1 ? ` (${survey.length} records)` : ''}</summary>` +
    `<img class="${styles.friendsBadge}" src="${FRIENDS_BADGE}" alt="Friends of the San Juans">` +
    survey.map(attrTable).join('') +
    `<div class="${styles.popupCount}">Source: <a class="${styles.popupLink}" href="${FRIENDS_PAGE}" target="_blank" rel="noopener noreferrer">` +
    `Friends of the San Juans shoreline inventory, 2008–2009 ↗</a></div></details>`
}

// Every record of a dock other than its permits: Friends survey, then OSM tracing.
function dockSectionsHtml(props, { openFirst = false } = {}) {
  const osm = props.osm_ways
    ? `<details class="${styles.permit}"${openFirst && !props.friends_survey?.length ? ' open' : ''}><summary>Dock as traced in OpenStreetMap</summary>${osmSectionHtml(props)}</details>`
    : ''
  const a = props.aerial
  const aerial = a
    ? `<details class="${styles.permit}"${openFirst ? ' open' : ''}><summary>Found in the 2025 county aerials</summary>` +
      attrTable({ found_by: a.found_by, model_confidence: a.model_confidence, length_m: a.length_m, area_m2: a.area_m2, aerial_id: a.aerial_id }) +
      `<div class="${styles.popupCount}">Source: <a class="${styles.popupLink}" href="${SJC_AERIALS_PAGE}" target="_blank" rel="noopener noreferrer">` +
      `San Juan County 2025 aerials (EagleView) ↗</a> — dock found by the EarthAtlas dock-detection pilot, confirmed by a reviewer</div></details>`
    : ''
  return aerial + friendsSectionHtml(props.friends_survey, openFirst) + osm
}

// A dock with no permits found: its status, its records, and where its position comes from.
function dockPopupHtml(props) {
  const match = OSM_MATCH_COLORS.find((m) => m.id === props.permit_match)
  const title = props.name || props.osm_tags?.name ||
    ({ friends: 'Dock (Friends survey)', aerial: 'Dock found in 2025 aerials' }[props.located_by] ?? 'Dock traced in OpenStreetMap')
  return `<div class="${styles.popup}">` +
    `<div class="${styles.popupTitle}">${escapeHtml(title)}</div>` +
    parcelHtml(props) +
    `<div class="${styles.popupCount}">${escapeHtml(match?.label ?? '')}</div>` +
    dockSectionsHtml(props, { openFirst: true }) +
    `<div class="${styles.matchNote}">${escapeHtml(locatedNote(props))}</div></div>`
}

// `tail` is appended after the permits (the OSM record of a fused dock); `note` (how the
// dock was matched, or that it isn't traced) closes the popup.
function popupHtml(site, { title, note, tail = '', head = '' } = {}) {
  const { permits } = site.properties
  const items = permits.map((p, i) =>
    `<details class="${styles.permit}"${i === permits.length - 1 ? ' open' : ''}>` +
    `<summary><span class="${styles.permitDate}">${escapeHtml(p.issued || p.submitted || 'undated')}</span>` +
    `<span class="${styles.agency}" title="${escapeHtml(agencyOf(p).name)}">${agencyOf(p).tag}</span>` +
    `${escapeHtml(p.project_name || p.permit_number || '')}</summary>${attrTable(p)}</details>`)
  return `<div class="${styles.popup}">` +
    `<div class="${styles.popupTitle}">${escapeHtml(title || site.properties.latest_name || 'Dock permits')}</div>` +
    head +
    `<div class="${styles.popupCount}">${permits.length} permit${permits.length > 1 ? 's' : ''} at this dock, by date</div>` +
    items.join('') + tail +
    (note ? `<div class="${styles.matchNote}">${escapeHtml(note)}</div>` : '') + `</div>`
}

// A dock with permits: the permit history, then its other records folded away, then
// where its position comes from and how the permits were matched to it.
function fusedPopupHtml(site, props, shareCount) {
  const shared = site.properties.split
    ? ' This parcel has more than one dock, and the county files permits by parcel: ferry permits are shown on the ferry pier, WDFW permits on the dock they name, and county permits that don’t say which dock on each.'
    : shareCount > 1 ? ` These permits are on a parcel with ${shareCount} mapped docks; each shows them all.` : ''
  const ferry = props.ferry_pier ? ' This is the Washington State Ferries pier.' : ''
  return popupHtml(site, {
    title: props.name || site.properties.latest_name,
    head: parcelHtml(props),
    note: `${locatedNote(props)}${ferry} ${matchNote(props)}${shared}` +
      (site.properties.combined_site_ids ? ' Also includes permit records filed separately for this dock (a WDFW permit at the dock itself, or nearby ferry-terminal permits).' : ''),
    tail: dockSectionsHtml(props),
  })
}

export default function HpaDocksApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const dataRef = useRef(null)
  const osmRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [styleLoads, setStyleLoads] = useState(0) // bumps on every style.load, so layers re-add even if mapReady never visibly flips
  const styledMapRef = useRef(null) // the map whose style has loaded (isStyleLoaded() stays false while tiles load)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  const initial = typeof window !== 'undefined' ? readUrlState() : {}
  const initialCamera = Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z)
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : DEFAULT_BASEMAP))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [mapView, setMapView] = useState(initialCamera)
  const [selected, setSelected] = useState(initial.p || null) // site_id of the open popup
  const [selectedDock, setSelectedDock] = useState(initial.d || null) // facility_id of the open dock popup
  const [showOsm, setShowOsm] = useState(() => initial.osm !== '0')
  const [osmMeta, setOsmMeta] = useState(null)

  const linkedRef = useRef(new Map()) // permit site_id → traced dock click points carrying its permits
  const siteOfDockRef = useRef(new Map()) // facility_id → its (combined) permit site

  // ─── Add a missing dock (dev only) ─────────────────────────────────────────
  // Click from the shore end out along the dock; double-click / Enter to finish. The
  // line is saved with the reviewer's drawn docks (vite dev middleware) and the dataset
  // rebuilt in the background (scripts/sanjuan-docks/rebuild.sh). Saved lines stay on
  // the map as solid yellow "pending" docks; when a rebuild covering them finishes, the
  // dock layers refresh in place (no reload), so the reviewer can keep working.
  const [adding, setAdding] = useState(null) // null, or the [lon, lat] points so far
  const [pending, setPending] = useState([]) // saved, not yet in the data: { id, coords, addedAt }
  const [addStatus, setAddStatus] = useState('')
  const addingRef = useRef(null)
  addingRef.current = adding
  const addModeRef = useRef(false)
  addModeRef.current = adding !== null
  const addPointRef = useRef(null)
  addPointRef.current = (ll) => setAdding((a) => [...(a ?? []), [ll.lng, ll.lat]])
  const finishAddRef = useRef(null)
  finishAddRef.current = async (dropLast = false) => {
    const pts = (addingRef.current ?? []).slice(0, dropLast ? -1 : undefined)
    if (pts.length < 2) { setAddStatus('Click at least two points along the dock (shore end first).'); return }
    setAdding(null)
    try {
      const r = await fetch('/api/dock-review/add-dock', { method: 'POST', body: JSON.stringify({ coords: pts }) })
      const { id, addedAt } = await r.json()
      if (!id) throw new Error('not saved')
      setPending((p) => [...p, { id, coords: pts, addedAt }])
      setAddStatus('')
    } catch {
      setAdding(pts) // keep the drawing so it can be finished again
      setAddStatus('NOT saved — is the EarthAtlas dev server running on localhost:5173? Your line is still here; press Enter to try again.')
    }
  }

  // Re-read both data files and refresh the map layers and legend in place.
  const reloadData = useCallback(async () => {
    const bust = `?t=${Date.now()}`
    const [fc, ofc] = await Promise.all([fetch(DATA_URL + bust).then((r) => r.json()), fetch(DOCKS_URL + bust).then((r) => r.json())])
    linkedRef.current = new Map()
    siteOfDockRef.current = new Map()
    fuse(fc, ofc, linkedRef.current, siteOfDockRef.current)
    dataRef.current = fc
    osmRef.current = ofc
    mapRef.current?.getSource('docks')?.setData(fc)
    mapRef.current?.getSource('osm')?.setData(ofc)
    setMeta(fc.metadata)
    setOsmMeta(ofc.metadata)
  }, [])

  // While docks are pending, check quietly whether a finished rebuild includes them.
  useEffect(() => {
    if (!pending.length) return
    const t = setInterval(async () => {
      try {
        const st = await fetch('/api/dock-review/rebuild-status').then((x) => x.json())
        if (st.failed && !st.running && !st.queued) {
          setAddStatus('A saved dock didn’t make it into the data — ask Claude to check data/sanjuan-docks/ml/rebuild-last.log.')
          return
        }
        const done = pending.filter((p) => st.okStartedAt >= p.addedAt)
        if (done.length) {
          await reloadData()
          setPending((p) => p.filter((x) => !done.some((d) => d.id === x.id)))
        }
      } catch { /* dev server restarting — keep waiting */ }
    }, 4000)
    return () => clearInterval(t)
  }, [pending, reloadData])
  const showOsmRef = useRef(showOsm)
  showOsmRef.current = showOsm

  const showPopup = useCallback((lngLat, html, siteId, dockId) => {
    const map = mapRef.current
    if (!map) return
    popupRef.current?.remove()
    const popup = new mapboxgl.Popup({ offset: 10, maxWidth: '380px' })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map)
    popup.on('close', () => { if (popupRef.current === popup) { setSelected(null); setSelectedDock(null) } })
    popupRef.current = keepPopupOnMap(popup)
    setSelected(siteId ?? null)
    setSelectedDock(dockId ?? null)
  }, [])

  // A permit site: at its traced dock in the fused view, else at its own dot.
  const openSite = useCallback((site) => {
    if (!site) return
    const docks = showOsmRef.current ? linkedRef.current.get(site.properties.site_id) : null
    if (docks?.length) {
      const dockSite = siteOfDockRef.current.get(docks[0].properties.facility_id) ?? site
      showPopup(docks[0].geometry.coordinates, fusedPopupHtml(dockSite, docks[0].properties, docks.length), site.properties.site_id, docks[0].properties.facility_id)
      return
    }
    const note = showOsmRef.current && osmRef.current
      ? `No mapped dock for these permits — this dot is at the ${site.properties.located_at}.` : null
    showPopup(site.geometry.coordinates, popupHtml(site, { note }), site.properties.site_id)
  }, [showPopup])

  // A traced dock (click point or shape): its permits when matched, else its OSM record.
  const openOsm = useCallback((props, lngLat) => {
    const site = MATCHED.has(props.permit_match) && siteOfDockRef.current.get(props.facility_id)
    if (!site) { showPopup(lngLat, dockPopupHtml(props), null, props.facility_id); return }
    const point = osmRef.current.features.find((x) => x.properties.kind === 'point' && x.properties.facility_id === props.facility_id)
    const shareCount = linkedRef.current.get(site.properties.site_id)?.length ?? 1
    showPopup(lngLat, fusedPopupHtml(site, { ...props, ...point?.properties }, shareCount), site.properties.site_id, props.facility_id)
  }, [showPopup])

  // ─── Data: both files, joined before any layer is drawn ─────────────────
  useEffect(() => {
    const permits = fetch(DATA_URL).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
    const osm = fetch(DOCKS_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    Promise.all([permits, osm])
      .then(([fc, ofc]) => {
        dataRef.current = fc
        if (ofc) { fuse(fc, ofc, linkedRef.current, siteOfDockRef.current); osmRef.current = ofc; setOsmMeta(ofc.metadata) }
        setMeta(fc.metadata)
      })
      .catch(() => setError('Could not load the dock permit data.'))
  }, [])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: initialCamera ? [initialCamera.lng, initialCamera.lat] : DEFAULT_VIEW.center,
      zoom: initialCamera ? initialCamera.zoom : DEFAULT_VIEW.zoom,
    })
    mapRef.current = map
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    })
    const hit = (e, layers) => map.queryRenderedFeatures(e.point, { layers: layers.filter((id) => map.getLayer(id)) }).length > 0
    for (const id of ['docks', 'osm-points', 'osm-line', 'osm-fill']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }
    // Traced docks draw over the permit dots, and a dock's click point over its shape:
    // one click opens only the topmost.
    // Adding a missing dock (dev only): map clicks place its points instead.
    map.on('click', (e) => { if (addModeRef.current) addPointRef.current(e.lngLat) })
    map.on('dblclick', (e) => { if (addModeRef.current) { e.preventDefault(); finishAddRef.current(true) } })
    map.on('click', 'osm-points', (e) => {
      if (addModeRef.current) return
      const f = e.features?.[0]
      const orig = f && osmRef.current?.features.find((x) => x.properties.kind === 'point' && x.properties.facility_id === f.properties.facility_id)
      if (orig) openOsm(orig.properties, e.lngLat)
    })
    for (const id of ['osm-line', 'osm-fill']) {
      map.on('click', id, (e) => {
        if (addModeRef.current || hit(e, ['osm-points'])) return
        const f = e.features?.[0]
        // Layer features stringify nested properties — use the original feature.
        // OSM ways by way id; an aerial dock's outline by its dock id.
        const orig = f && osmRef.current?.features.find((x) => x.properties.kind === 'shape' &&
          (f.properties.osm_id ? x.properties.osm_id === f.properties.osm_id : x.properties.facility_id === f.properties.facility_id))
        if (orig) openOsm(orig.properties, e.lngLat)
      })
    }
    map.on('click', 'docks', (e) => {
      if (addModeRef.current || hit(e, ['osm-points', 'osm-line', 'osm-fill'])) return
      const f = e.features?.[0]
      // Hand the popup the original feature (layer features stringify the permits array).
      openSite(f && dataRef.current?.features.find((x) => x.properties.site_id === f.properties.site_id))
    })
    map.on('style.load', () => { styledMapRef.current = map; setMapReady(true); setStyleLoads((n) => n + 1) })
    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Layers: (re)add after every style load once the data is in ─────────
  useEffect(() => {
    const map = mapRef.current
    // A hot reload swaps in a new map while mapReady is still true from the old one;
    // wait for the new map's own style.load, which bumps styleLoads and re-runs this.
    if (!map || !mapReady || !meta || styledMapRef.current !== map || map.getSource('docks')) return
    const manyPermits = ['>', ['coalesce', ['get', 'permit_count'], 0], 1]
    const approx = ['==', ['get', 'located_by'], 'parcel_point']
    map.addSource('docks', { type: 'geojson', data: dataRef.current })
    map.addLayer({
      id: 'docks',
      type: 'circle',
      source: 'docks',
      paint: {
        // Docks with several permits draw larger and carry their permit count.
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          8, ['case', manyPermits, 5.5, 3.5],
          12, ['case', manyPermits, 9, 6],
          16, ['case', manyPermits, 12, 9]],
        'circle-color': CATEGORY_COLOR_EXPR,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
    })
    map.addLayer({
      id: 'docks-count',
      type: 'symbol',
      source: 'docks',
      filter: manyPermits,
      minzoom: 10,
      layout: {
        'text-field': ['to-string', ['get', 'permit_count']],
        'text-size': 11,
        'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#0a0e17' },
    })
    if (osmRef.current) {
      map.addSource('osm', { type: 'geojson', data: osmRef.current })
      map.addLayer({
        id: 'osm-fill', type: 'fill', source: 'osm', minzoom: 13,
        filter: ['all', ['==', ['get', 'kind'], 'shape'], ['==', ['geometry-type'], 'Polygon']],
        paint: { 'fill-color': DOCK_COLOR_EXPR, 'fill-opacity': 0.3 },
      })
      map.addLayer({
        id: 'osm-line', type: 'line', source: 'osm', minzoom: 13,
        filter: ['==', ['get', 'kind'], 'shape'],
        paint: { 'line-color': DOCK_COLOR_EXPR, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 4], 'line-opacity': 0.95 },
      })
      // A dock with permits wears its permit colour (and count); one without, its match colour.
      map.addLayer({
        id: 'osm-points', type: 'circle', source: 'osm',
        filter: ['==', ['get', 'kind'], 'point'],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            8, ['case', manyPermits, 4.5, ['has', 'category'], 3.5, 2.5],
            12, ['case', manyPermits, 8, ['has', 'category'], 5.5, 4.5],
            16, ['case', manyPermits, 11, ['has', 'category'], 8, 6.5]],
          'circle-color': DOCK_COLOR_EXPR,
          // A dock placed only at its parcel point (approximate) is a faint ring.
          // Faint ring: placed only at its parcel (approximate). Faded: checked absent in 2025.
          'circle-opacity': ['case', ['==', ['get', 'absent_2025'], true], 0.3, approx, 0.18, 1],
          'circle-stroke-width': ['case', ['has', 'category'], 1.5, 1],
          'circle-stroke-color': ['case', approx, DOCK_COLOR_EXPR, ['has', 'category'], '#ffffff', '#0a0e17'],
          'circle-stroke-opacity': ['case', approx, 0.8, 1],
        },
      })
      map.addLayer({
        id: 'osm-count', type: 'symbol', source: 'osm', minzoom: 10,
        filter: ['all', ['==', ['get', 'kind'], 'point'], manyPermits],
        layout: {
          'text-field': ['to-string', ['get', 'permit_count']],
          'text-size': 11,
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: { 'text-color': ['case', approx, '#ffffff', '#0a0e17'] },
      })
    }
    applyView(map, showOsm)
    // Re-open a shared/selected dock or permit (cold load from URL, or after a basemap switch).
    const dockPoint = selectedDock && osmRef.current?.features.find((x) => x.properties.kind === 'point' && x.properties.facility_id === selectedDock)
    if (dockPoint && !popupRef.current?.isOpen()) {
      openOsm(dockPoint.properties, dockPoint.geometry.coordinates)
    } else if (selected && !popupRef.current?.isOpen()) {
      openSite(dataRef.current.features.find((x) => x.properties.site_id === selected))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, meta, styleLoads])

  useEffect(() => {
    const map = mapRef.current
    if (map && mapReady && map.getSource('docks')) applyView(map, showOsm)
  }, [showOsm, mapReady, meta, styleLoads])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const data = { type: 'FeatureCollection', features: [
      ...pending.map((p) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.coords }, properties: { pending: true } })),
      ...(adding?.length > 1 ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: adding }, properties: {} }] : []),
      ...(adding ?? []).map((c) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: {} })),
    ] }
    if (map.getSource('add-dock')) map.getSource('add-dock').setData(data)
    else {
      map.addSource('add-dock', { type: 'geojson', data })
      // Being drawn: dashed. Saved, waiting for the rebuild: solid.
      map.addLayer({ id: 'add-dock-pending', type: 'line', source: 'add-dock', filter: ['==', ['get', 'pending'], true],
        paint: { 'line-color': '#facc15', 'line-width': 6, 'line-opacity': 0.9 } })
      map.addLayer({ id: 'add-dock-line', type: 'line', source: 'add-dock', filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!', ['to-boolean', ['get', 'pending']]]],
        paint: { 'line-color': '#facc15', 'line-width': 5, 'line-dasharray': [2, 1] } })
      map.addLayer({ id: 'add-dock-pts', type: 'circle', source: 'add-dock', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': '#facc15', 'circle-stroke-color': '#0a0e17', 'circle-stroke-width': 1.5 } })
    }
    map.getCanvas().style.cursor = adding ? 'crosshair' : ''
    if (adding) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [adding, pending, mapReady, styleLoads])

  useEffect(() => {
    if (adding === null) return
    const onKey = (e) => {
      if (e.key === 'Enter') finishAddRef.current(false)
      else if (e.key === 'Escape') { setAdding(null); setAddStatus('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [adding])

  // ─── URL state ────────────────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (basemap !== DEFAULT_BASEMAP) sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(4))
      sp.set('lng', mapView.lng.toFixed(4))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    if (selectedDock) sp.set('d', selectedDock)
    else if (selected) sp.set('p', selected)
    if (!showOsm) sp.set('osm', '0')
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, mapView, selected, selectedDock, showOsm, mapReady])

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    setMapReady(false) // style.load flips it back and the layer effect re-adds the dots
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  useEffect(() => {
    const prev = document.title
    document.title = 'San Juan County dock permits (WDFW HPA) · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  const fused = showOsm && !!osmMeta
  const located = osmMeta?.located_by_counts
  // Legend counts. Combined view: docks drawn as solid dots, by permit colour (the
  // approximate rings and no-permit docks have their own rows, so the rows add up to
  // the total). Permits-only view: permit sites by colour.
  const legendCounts = {}
  if (meta && dataRef.current) {
    const feats = fused
      ? osmRef.current.features.filter((f) => f.properties.kind === 'point' && f.properties.category && f.properties.located_by !== 'parcel_point')
      : dataRef.current.features
    for (const f of feats) legendCounts[f.properties.category] = (legendCounts[f.properties.category] ?? 0) + 1
  }

  if (!MAPBOX_TOKEN) {
    return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>
  }

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <div className={q.branding}>
        <a className={q.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={q.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={`${q.subBadge} ${styles.subBadge}`}>Dock permits</span>
      </div>

      <MapSearch className={q.searchBox}>
        <GeoSearch
          placeholder="Search a place…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => mapRef.current && flyToSearchResult(mapRef.current, r)}
        />
      </MapSearch>

      <div className={q.basemapMenu} ref={basemapMenuRef}>
        <button
          className={basemapMenuOpen ? q.basemapToggleActive : q.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)}
          aria-label="Choose basemap" title="Basemap"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={q.basemapMenuPanel}>
            <div className={q.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                className={b.id === basemap ? q.basemapMenuItemActive : q.basemapMenuItem}
                onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}
              >
                <span className={q.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={q.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.infoTitle}>Dock permits — San Juan County</div>
        {error ? <div className={styles.infoMeta}>{error}</div> : !meta ? <div className={styles.infoMeta}>Loading…</div> : (
          <>
            <div className={styles.infoMeta}>
              {fused
                ? `${osmMeta.facility_count} docks from OpenStreetMap, the Friends of the San Juans shoreline survey and ${meta.permit_count} county and state permits, coloured by their permits; a number marks docks with several.`
                : `${meta.permit_count} dock, pier and float permits at ${meta.site_count} docks. Permits on the same parcel are grouped; a number marks docks with several.`}
              {' '}Click a dock for its full record.
            </div>
            <div className={styles.legend}>
              {CATEGORY_COLORS.map((s) => (
                <div key={s.id} className={styles.legendRow}>
                  <span className={styles.swatch} style={{ background: s.color }} />{fused ? s.label.replace(/ — dot at the parcel$/, '') : s.label}
                  {' '}({legendCounts[s.id] ?? 0})
                </div>
              ))}
              {fused && (
                <>
                  <div className={styles.legendRow}>
                    <span className={styles.swatchFaint} />Permits only, position approximate (parcel’s water edge) ({located.parcel_point})
                  </div>
                  {OSM_MATCH_COLORS.filter((c) => !MATCHED.has(c.id)).map((c) => (
                    <div key={c.id} className={styles.legendRow}>
                      <span className={styles.swatchSmall} style={{ background: c.color }} />{c.label} ({osmMeta.match_counts[c.id]})
                    </div>
                  ))}
                  <div className={styles.legendTotal}>= {osmMeta.facility_count} docks</div>
                  {osmMeta.absent_2025_count > 0 && (
                    <div className={styles.legendRow}>
                      <span className={styles.swatch} style={{ background: '#c084fc', opacity: 0.3 }} />Faded: on record, but no dock visible in the 2025 aerials (checked) — {osmMeta.absent_2025_count} of the above
                    </div>
                  )}
                  <div className={styles.legendRow}><span className={styles.swatchLine} />Dock outline (OpenStreetMap tracing or 2025-aerial find), in its dock’s colour (zoom in)</div>
                </>
              )}
            </div>
            <div className={styles.infoMeta}>
              Sources:{' '}
              {meta.sources.filter((s) => s.count).map((s, i) => (
                <span key={s.name}>{i ? ' · ' : ''}<a className={styles.source} href={s.page || s.service} target="_blank" rel="noopener noreferrer">{s.name} ({s.count} permits) ↗</a></span>
              ))}
              {fused && (
                <> · <a className={styles.source} href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Dock tracings © OpenStreetMap contributors ({located.osm} docks) ↗</a>
                  {located.aerial > 0 && <>{' · '}<a className={styles.source} href={SJC_AERIALS_PAGE} target="_blank" rel="noopener noreferrer">Docks found in San Juan County 2025 aerials ({located.aerial} docks) ↗</a></>}
                  {' · '}<a className={styles.source} href={FRIENDS_PAGE} target="_blank" rel="noopener noreferrer">Friends of the San Juans shoreline survey, 2008–2009 ({osmMeta.friends_survey_count} survey points) ↗</a></>
              )}
            </div>
            {fused && (
              <a className={styles.friendsCredit} href={FRIENDS_PAGE} target="_blank" rel="noopener noreferrer">
                <img src={FRIENDS_BADGE} alt="" />Dock survey data courtesy of Friends of the San Juans
              </a>
            )}
            {osmMeta && (
              <div className={styles.osmBlock}>
                <label className={styles.toggle}>
                  <input type="checkbox" checked={showOsm} onChange={(e) => setShowOsm(e.target.checked)} />
                  Combine permits with mapped docks
                </label>
              </div>
            )}
            {import.meta.env.DEV && (
              <div className={styles.addBlock}>
                {adding === null
                  ? <button className={styles.addBtn} onClick={() => { popupRef.current?.remove(); setAdding([]); setAddStatus('') }}>＋ Add a missing dock</button>
                  : (
                    <>
                      <div className={styles.infoMeta}>Click from the shore end out along the dock (a click at each bend or float), then double-click or press Enter. Esc cancels.</div>
                      <div className={styles.addBtns}>
                        <button className={styles.addBtn} onClick={() => finishAddRef.current(false)}>Finish ({adding.length} point{adding.length === 1 ? '' : 's'})</button>
                        <button className={styles.addBtnQuiet} onClick={() => { setAdding(null); setAddStatus('') }}>Cancel</button>
                      </div>
                    </>
                  )}
                {pending.length > 0 && (
                  <div className={styles.infoMeta}>
                    {pending.length} dock{pending.length > 1 ? 's' : ''} saved (solid yellow) — adding to the map in the background; keep working.
                  </div>
                )}
                {addStatus && <div className={styles.infoMeta}>{addStatus}</div>}
              </div>
            )}
            <BuiltByCredit />
          </>
        )}
      </div>
    </div>
  )
}
