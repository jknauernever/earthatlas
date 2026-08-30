/**
 * EarthAtlas HappyWhaleApp — whale encounters & individual journeys at
 * /happywhale, powered by HappyWhale's external API (hwx).
 *
 * What makes this tool different from /whales (the iNat/eBird/GBIF explorer):
 * HappyWhale photo-ID-matches encounters to *named individuals*, so beyond the
 * encounter map you can click an identified whale and see its journey — every
 * encounter of that one animal worldwide, drawn as a track.
 *
 * Data flow: one POST /encounters per (location, time window) via the
 * /api/happywhale proxy (which owns the OAuth dance server-side); species
 * filtering happens client-side (the API has no species parameter).
 * Individual journeys come from /individual/info/{id}.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { ensureWebGLSupport } from '../utils/webglSupport'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import {
  fetchSpeciesConfig,
  fetchEncounters,
  fetchIndividualTrack,
  sampleArrowPoints,
  speciesColor,
  individualUrl,
} from './happywhaleService.js'
import { routeJourney } from './oceanRouting.js'
import styles from './HappyWhaleApp.module.css'
import MapSheet from '../components/MapSheet.jsx'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN

const DEFAULT_VIEW = { center: [-130, 25], zoom: 2.1 }
const RADIUS_OPTIONS = [25, 50, 100, 250, 500, 1000] // miles, same chips as /quakes
const DEFAULT_RADIUS = 250
const MILES_TO_METERS = 1609.34

const DAY = 86400e3
// The API caps a search at 10,000 encounters; since HappyWhale's 2026-08-28
// fix, a capped result keeps the NEWEST rows (verified on beta), so wide
// windows degrade gracefully into "the most recent 10,000". Default is
// 9 months — the widest worldwide window that currently stays under the cap,
// i.e. genuinely complete rather than truncated.
const TIME_PRESETS = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '6m', label: '6 months', days: 183 },
  { id: '9m', label: '9 months', days: 274 },
  { id: '1y', label: 'Year', days: 365 },
]
const DEFAULT_PRESET = '9m'

const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style

// ─── Small helpers ───────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function fmtDate(d) {
  if (!d) return ''
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

// HappyWhale individual bios arrive as markdown ("Mother of [**Scuba**](url)").
// Render just the subset they actually use — links and bold — as React nodes:
// text stays escaped, and hrefs are regex-limited to http(s), so nothing a
// bio author writes can inject markup.
function renderBoldRuns(text, keyBase) {
  const out = []
  const re = /\*\*([^*]+)\*\*/g
  let last = 0
  let m
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<strong key={`${keyBase}b${i++}`}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderMarkdownLite(text) {
  const nodes = []
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0
  let m
  let i = 0
  while ((m = linkRe.exec(text))) {
    if (m.index > last) nodes.push(...renderBoldRuns(text.slice(last, m.index), `t${i}`))
    nodes.push(
      <a key={`a${i}`} href={m[2]} target="_blank" rel="noopener noreferrer">
        {renderBoldRuns(m[1], `l${i}`)}
      </a>,
    )
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(...renderBoldRuns(text.slice(last), 'tail'))
  return nodes
}

function countLabel(min, max) {
  if (min == null && max == null) return null
  if (min != null && max != null && min !== max) return `${min}–${max} animals`
  const n = max ?? min
  return n === 1 ? '1 animal' : `${n} animals`
}

const SEX_GLYPH = { MALE: '♂', FEMALE: '♀' }

// Geodesic circle polygon for the radius overlay (same as /quakes).
function radiusCircleGeoJSON(centerLat, centerLng, radiusMiles, points = 96) {
  const coords = []
  const rRad = radiusMiles / 3959
  const latR = (centerLat * Math.PI) / 180
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI
    const lat = Math.asin(Math.sin(latR) * Math.cos(rRad) + Math.cos(latR) * Math.sin(rRad) * Math.cos(angle))
    const lng =
      (centerLng * Math.PI) / 180 +
      Math.atan2(Math.sin(angle) * Math.sin(rRad) * Math.cos(latR), Math.cos(rRad) - Math.sin(latR) * Math.sin(lat))
    coords.push([(lng * 180) / Math.PI, (lat * 180) / Math.PI])
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } }
}

// Wrap-aware bounds: shift each longitude to within 180° of the first point,
// so a set of points spanning the antimeridian fits the short way around
// instead of stretching the bounds across the whole globe (which zooms the
// camera out to z≈1 centered somewhere meaningless).
function lngLatBoundsFor(coords) {
  if (!coords.length) return null
  const ref = coords[0][0]
  const b = new mapboxgl.LngLatBounds()
  for (const [lng, lat] of coords) {
    let L = lng
    while (L - ref > 180) L -= 360
    while (L - ref < -180) L += 360
    b.extend([L, lat])
  }
  return b
}

function zoomForRadius(miles) {
  if (miles <= 25) return 8.5
  if (miles <= 50) return 7.5
  if (miles <= 100) return 6.5
  if (miles <= 250) return 5.2
  if (miles <= 500) return 4.2
  return 3.2
}

// ─── Shareable URL state (required convention — docs/MAP_TOOL_CONVENTIONS.md)
// Params, each omitted at its default:
//   sp                 species key filter (default all)
//   t                  time preset id (default '90d')
//   clat,clng,cname    selected location center + label (absent = worldwide)
//   r                  radius in miles (default 250)
//   ind                selected individual id (journey mode)
//   bm                 basemap id (default 'satellite')
//   lat,lng,z          map camera
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    sp: sp.get('sp'),
    t: sp.get('t'),
    clat: num('clat'), clng: num('clng'), cname: sp.get('cname'),
    r: num('r'),
    ind: num('ind'),
    bm: sp.get('bm'),
    lat: num('lat'), lng: num('lng'), z: num('z'),
  }
}

function writeUrlQuery(qs) {
  if (typeof window === 'undefined') return
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

export default function HappyWhaleApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  // Per-view social share card capture (docs/MAP_TOOL_CONVENTIONS.md §6).
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  const initial = (typeof window !== 'undefined') ? readUrlState() : {}
  const initialCenter = (Number.isFinite(initial.clat) && Number.isFinite(initial.clng))
    ? { lat: initial.clat, lng: initial.clng, name: initial.cname || 'Shared location' }
    : null
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z }
    : null

  // Data
  const [speciesConfig, setSpeciesConfig] = useState([])
  const [encounters, setEncounters] = useState([])
  const [limitExceeded, setLimitExceeded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // View
  const [species, setSpecies] = useState(() => initial.sp || 'all')
  const [preset, setPreset] = useState(() => (TIME_PRESETS.some((p) => p.id === initial.t) ? initial.t : DEFAULT_PRESET))
  const [center, setCenter] = useState(initialCenter)
  const [radius, setRadius] = useState(() => (RADIUS_OPTIONS.includes(initial.r) ? initial.r : DEFAULT_RADIUS))
  const [selectedInd, setSelectedInd] = useState(() => (Number.isFinite(initial.ind) ? initial.ind : null))
  const [track, setTrack] = useState(null) // { individual, encounters } | null
  const [journeyLegs, setJourneyLegs] = useState(null) // water-routed [[lng,lat],…] legs
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [showMethodology, setShowMethodology] = useState(false)
  const [speciesExpanded, setSpeciesExpanded] = useState(false)
  const [mapView, setMapView] = useState(initialCamera)
  const suppressFlyRef = useRef(!!(initialCamera || initialCenter))
  // Read by the camera effect without re-triggering it on journey changes.
  const selectedIndRef = useRef(null)
  // A shared link with both a camera and a journey shouldn't fit-bounds away
  // from the shared camera on load.
  const suppressTrackFitRef = useRef(!!(initialCamera && Number.isFinite(initial.ind)))
  // Lets the (once-registered) map popup listener re-zoom to the current
  // journey without stale closures.
  const fitTrackRef = useRef(null)
  // Camera as it was just before a journey zoom, so closing the journey card
  // returns the user to the view they were browsing (null when the journey
  // came from a shared URL — then there is no "prior" view to restore).
  const preJourneyCameraRef = useRef(null)

  const isGlobal = !center
  selectedIndRef.current = selectedInd

  const speciesByKey = useMemo(
    () => Object.fromEntries(speciesConfig.map((s) => [s.code, s])),
    [speciesConfig],
  )
  const speciesName = useCallback(
    (key) => speciesByKey[key]?.name || key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    [speciesByKey],
  )

  // ─── Species config (once) ────────────────────────────────────────────────
  useEffect(() => {
    const ac = new AbortController()
    fetchSpeciesConfig({ signal: ac.signal })
      .then(({ species: list }) => { if (!ac.signal.aborted) setSpeciesConfig(list) })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  // ─── Encounters whenever location/radius/time window changes ─────────────
  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    setError(null)
    const days = (TIME_PRESETS.find((p) => p.id === preset) || TIME_PRESETS[1]).days
    fetchEncounters({
      circle: center ? { lat: center.lat, lng: center.lng, radiusMeters: radius * MILES_TO_METERS } : null,
      from: Date.now() - days * DAY,
      signal: ac.signal,
    })
      .then((res) => {
        if (ac.signal.aborted) return
        setEncounters(res.encounters)
        setLimitExceeded(res.limitExceeded)
        setLoading(false)
      })
      .catch((err) => {
        if (ac.signal.aborted || err.name === 'AbortError') return
        setError('Could not load encounter data. Please try again.')
        setLoading(false)
      })
    return () => ac.abort()
  }, [center, radius, preset])

  // ─── Species filter (client-side — the API has no species param) ─────────
  const filteredEncounters = useMemo(
    () => (species === 'all' ? encounters : encounters.filter((e) => e.speciesKey === species)),
    [encounters, species],
  )

  // Species chips: every species present in the current encounter set, by count.
  const speciesCounts = useMemo(() => {
    const counts = new Map()
    for (const e of encounters) counts.set(e.speciesKey, (counts.get(e.speciesKey) || 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [encounters])

  const stats = useMemo(() => {
    const inds = new Set()
    const sps = new Set()
    for (const e of filteredEncounters) {
      if (e.individual) inds.add(e.individual.id)
      sps.add(e.speciesKey)
    }
    return { count: filteredEncounters.length, individuals: inds.size, species: sps.size }
  }, [filteredEncounters])

  // A species filter can leave every match outside the current viewport (e.g.
  // sei whales all in Tierra del Fuego while the camera sits over North
  // America) — the map then LOOKS empty/broken. Detect it so the status area
  // can offer a "zoom to them" nudge without ever moving the camera uninvited.
  const noneInView = useMemo(() => {
    const map = mapRef.current
    if (!map || !mapReady || !filteredEncounters.length) return false
    try {
      const b = map.getBounds()
      return !filteredEncounters.some((e) => b.contains([e.lng, e.lat]))
    } catch {
      return false
    }
    // mapView (updated on moveend) is what keeps this fresh as the user pans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEncounters, mapView, mapReady])

  // ─── Map init (once) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const startCamera = initialCamera
      || (initialCenter ? { lng: initialCenter.lng, lat: initialCenter.lat, zoom: zoomForRadius(radius) } : null)
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: startCamera ? [startCamera.lng, startCamera.lat] : DEFAULT_VIEW.center,
      zoom: startCamera ? startCamera.zoom : DEFAULT_VIEW.zoom,
    })
    mapRef.current = map
    if (import.meta.env.DEV) window.__hwMap = map // dev-only: lets browser QA drive canvas clicks
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('moveend', () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    })

    const addLayers = () => {
      if (!map.getSource('radius-circle')) {
        map.addSource('radius-circle', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius-circle', paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.08 } })
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius-circle', paint: { 'line-color': '#38bdf8', 'line-width': 1.5, 'line-opacity': 0.7 } })
      }
      if (!map.getSource('hw-track')) {
        map.addSource('hw-track', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        // Water-routed journey legs (see oceanRouting.js): a dotted sea path
        // between consecutive stops…
        map.addLayer({
          id: 'hw-track-line',
          type: 'line',
          source: 'hw-track',
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 1.5,
            'line-opacity': 0.65,
            'line-dasharray': [1.5, 2.2],
          },
        })
        // …with direction-of-travel arrows sampled along it. Pre-sampled
        // point glyphs with a zoom-LOD rank (Mapbox line placement drops
        // symbols unpredictably; see sampleArrowPoints).
        const rankGate = (minRank) => ['case', ['>=', ['get', 'rank'], minRank], 26, 0]
        map.addLayer({
          id: 'hw-track-arrows',
          type: 'symbol',
          source: 'hw-track',
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': '→',
            'text-size': ['interpolate', ['linear'], ['zoom'],
              2, rankGate(7), 3, rankGate(6), 4, rankGate(5), 5, rankGate(4),
              6, rankGate(3), 7, rankGate(2), 8, rankGate(1), 9, rankGate(0),
            ],
            'text-rotate': ['get', 'rot'],
            'text-rotation-alignment': 'map',
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': ['get', 'color'],
            'text-halo-color': 'rgba(0,0,0,0.55)',
            'text-halo-width': 1.4,
          },
        })
      }
      if (!map.getSource('hw-encounters')) {
        map.addSource('hw-encounters', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({
          id: 'hw-encounters-layer',
          type: 'circle',
          source: 'hw-encounters',
          paint: {
            // Journey stops (seq set) render larger so the numbered badges
            // fit. NB: a zoom interpolate must be the OUTERMOST expression —
            // wrapping it in ['+', …] silently rejects the whole layer.
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              1, ['case', ['to-boolean', ['get', 'seq']], 8, ['case', ['get', 'identified'], 4.5, 3]],
              6, ['case', ['to-boolean', ['get', 'seq']], 11, ['case', ['get', 'identified'], 8, 5.5]],
              10, ['case', ['to-boolean', ['get', 'seq']], 15, ['case', ['get', 'identified'], 12, 8]],
            ],
            'circle-color': ['get', 'color'],
            // Journey mode GHOSTS everything that isn't the selected whale —
            // in dense areas (Salish Sea!) a mild dim still drowns the 8 dots
            // that matter under thousands that don't.
            'circle-opacity': ['case', ['get', 'dim'], 0.07, 0.85],
            'circle-stroke-width': ['case', ['get', 'dim'], 0, ['case', ['get', 'identified'], 1.5, 0.5]],
            'circle-stroke-color': ['case', ['get', 'identified'], '#ffffff', 'rgba(0,0,0,0.35)'],
          },
        })
        // Chronological stop numbers for the active journey (1 = oldest).
        // Numbered stops replace path lines entirely: real encounters carry no
        // route information, and straight connectors send whales over land.
        map.addLayer({
          id: 'hw-journey-seq',
          type: 'symbol',
          source: 'hw-encounters',
          filter: ['to-boolean', ['get', 'seq']],
          layout: {
            'text-field': ['to-string', ['get', 'seq']],
            'text-size': 11,
            'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': 'rgba(0,0,0,0.7)',
            'text-halo-width': 1.2,
          },
        })

        map.on('mouseenter', 'hw-encounters-layer', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'hw-encounters-layer', () => { map.getCanvas().style.cursor = '' })
        map.on('click', 'hw-encounters-layer', (e) => {
          // Among overlapping dots, prefer an identified whale — its popup has
          // the journey button.
          const hits = e.features || []
          const f = hits.find((x) => Number(x.properties?.indId) > 0) || hits[0]
          if (!f) return
          const p = f.properties
          const coords = f.geometry.coordinates.slice()
          // Mapbox serializes feature properties — depending on version, a null
          // can come back as null, undefined, or the string 'null'. Normalize.
          const str = (v) => (v == null || v === 'null' || v === '' ? null : String(v))
          const posNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null }
          const identified = posNum(p.indId) != null
          const placeBits = [str(p.location), str(p.region)].filter(Boolean)
          const seaBits = [str(p.sea), str(p.ocean)].filter(Boolean)
          const count = countLabel(posNum(p.minCount), posNum(p.maxCount))

          popupRef.current?.remove()
          popupRef.current = new mapboxgl.Popup({ offset: 12, maxWidth: '280px' })
            .setLngLat(coords)
            .setHTML(
              `<div class="${styles.popup}">` +
              (str(p.photoUrl)
                ? `<img class="${styles.popupPhoto}" src="${escapeHtml(str(p.photoUrl))}" alt="" loading="lazy" />`
                : '') +
              `<div class="${styles.popupSpecies}"><span class="${styles.popupDot}" style="background:${escapeHtml(p.color)}"></span>${escapeHtml(p.speciesName)}</div>` +
              (identified
                ? `<div class="${styles.popupInd}">${SEX_GLYPH[p.sex] ? SEX_GLYPH[p.sex] + ' ' : ''}<strong>${escapeHtml(str(p.nickname) || 'Identified individual')}</strong>${str(p.primaryId) ? ' · ' + escapeHtml(str(p.primaryId)) : ''}</div>`
                : (count ? `<div class="${styles.popupInd}">${escapeHtml(count)}</div>` : '')) +
              `<div class="${styles.popupMeta}">${escapeHtml(fmtDate(p.date))}</div>` +
              (placeBits.length ? `<div class="${styles.popupMeta}">${escapeHtml(placeBits.join(' · '))}</div>` : '') +
              (seaBits.length ? `<div class="${styles.popupMeta}">${escapeHtml(seaBits.join(' · '))}</div>` : '') +
              (identified ? `<button class="${styles.popupTrackBtn}" data-hw-ind="${escapeHtml(p.indId)}">⟶ Show this whale's journey</button>` : '') +
              (identified
                ? `<a class="${styles.popupLink}" href="${escapeHtml(individualUrl(p.indId))}" target="_blank" rel="noopener noreferrer">View on HappyWhale ↗</a>`
                : '') +
              `</div>`,
            )
            .addTo(map)

          // The popup is plain HTML (setHTML), so wire the journey button by
          // hand. Re-clicking for the already-selected whale re-zooms (the
          // state doesn't change, so the fit effect alone would never re-run).
          popupRef.current.getElement()?.querySelector('[data-hw-ind]')?.addEventListener('click', (ev) => {
            const id = Number(ev.currentTarget.getAttribute('data-hw-ind'))
            if (Number.isFinite(id)) {
              // Entering journey mode from browsing? Remember where the user
              // was, so closing the journey card can take them back.
              if (selectedIndRef.current == null) {
                const c = map.getCenter()
                preJourneyCameraRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() }
              }
              setSelectedInd(id)
              fitTrackRef.current?.(id)
            }
            popupRef.current?.remove()
          })
        })
      }
    }

    // style.load fires on the initial style AND after every basemap switch —
    // re-add sources/layers and (re)assert readiness each time (see
    // docs/MAP_TOOL_CONVENTIONS.md §4).
    map.on('style.load', () => { addLayers(); setMapReady(true) })

    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Push encounters into the map source ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource('hw-encounters')
    if (!src) return
    // A journey is a full-history view: the selected whale's own encounters
    // always render as dots even when the time-range/species filters would
    // hide them. Each carries its chronological stop number (1 = oldest).
    const seqById = new Map((track?.encounters || []).map((e, i) => [e.id, i + 1]))
    const shown = new Set(filteredEncounters.map((e) => e.id))
    const journeyEncounters = (track?.encounters || [])
      .filter((e) => !shown.has(e.id))
      .map((e) => ({ ...e, individual: e.individual || { id: selectedInd } }))
    // Identified encounters go last so they render ON TOP of unidentified ones
    // in dense clusters — and journey stops last of all.
    const ordered = [...filteredEncounters, ...journeyEncounters]
      .sort((a, b) => ((seqById.has(a.id) ? 2 : a.individual ? 1 : 0) - (seqById.has(b.id) ? 2 : b.individual ? 1 : 0)))
    src.setData({
      type: 'FeatureCollection',
      features: ordered.map((e) => ({
        type: 'Feature',
        properties: {
          color: speciesColor(e.speciesKey),
          speciesName: speciesName(e.speciesKey),
          identified: !!e.individual,
          seq: seqById.get(e.id) ?? null,
          dim: selectedInd != null && !seqById.has(e.id),
          date: e.date,
          region: e.region,
          location: e.location,
          sea: e.sea,
          ocean: e.ocean,
          minCount: e.minCount,
          maxCount: e.maxCount,
          // Prefer the 1200px medium variant for the popup photo; the 100px
          // thumbUrl turns to mush in a ~250px-wide slot.
          photoUrl: e.media?.url || e.media?.thumbUrl || null,
          indId: e.individual?.id ?? null,
          nickname: e.individual?.nickname || null,
          primaryId: e.individual?.primaryId || null,
          sex: e.individual?.sex || null,
        },
        geometry: { type: 'Point', coordinates: [e.lng, e.lat] },
      })),
    })
  }, [filteredEncounters, track, selectedInd, mapReady, speciesName])

  // ─── Journey mode: fetch the selected individual's track ──────────────────
  // Deliberately NOT keyed on mapReady — a second fetch after map init would
  // produce a fresh track object, re-running the draw effect after its
  // fit-suppression flag was consumed and stomping a URL-shared camera.
  useEffect(() => {
    if (selectedInd == null) { setTrack(null); return }
    const ac = new AbortController()
    fetchIndividualTrack({ id: selectedInd, signal: ac.signal })
      .then((res) => {
        if (ac.signal.aborted) return
        if (!res.individual) { setSelectedInd(null); return }
        setTrack(res)
      })
      .catch((err) => {
        if (ac.signal.aborted || err.name === 'AbortError') return
        console.error('happywhale: individual track failed', err)
        setSelectedInd(null)
      })
    return () => ac.abort()
  }, [selectedInd])

  // Frame the active journey (the numbered stops render via the encounters
  // source — see the seq property above).
  const fitToTrack = useCallback((id) => {
    const map = mapRef.current
    if (!map || !track || (id != null && track.individual?.id !== id)) return
    const b = lngLatBoundsFor(track.encounters.map((e) => [e.lng, e.lat]))
    if (b) map.fitBounds(b, { padding: 90, maxZoom: 8, duration: 1400, essential: true })
  }, [track])
  useEffect(() => { fitTrackRef.current = fitToTrack }, [fitToTrack])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !track) return
    if (suppressTrackFitRef.current) { suppressTrackFitRef.current = false; return }
    fitTrackRef.current?.()
  }, [track, mapReady])

  // Route the journey's legs through water (async: lazy-loads the land mask
  // on the first journey, then A* per leg).
  useEffect(() => {
    if (!track || track.encounters.length < 2) { setJourneyLegs(null); return }
    let cancelled = false
    routeJourney(track.encounters)
      .then((legs) => { if (!cancelled) setJourneyLegs(legs) })
      .catch(() => { if (!cancelled) setJourneyLegs(null) })
    return () => { cancelled = true }
  }, [track])

  // Draw (or clear) the routed legs + direction arrows.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const src = map.getSource('hw-track')
    if (!src) return
    if (!journeyLegs || !track) {
      src.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    const color = speciesColor(track.individual?.speciesKey)
    src.setData({
      type: 'FeatureCollection',
      features: [
        ...journeyLegs.map((l) => ({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'LineString', coordinates: l.coords },
        })),
        ...sampleArrowPoints(journeyLegs).map((p) => ({
          type: 'Feature',
          properties: { color, rot: p.rot, rank: p.rank },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
      ],
    })
  }, [journeyLegs, track, mapReady])

  // ─── Radius circle overlay ────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.getSource('radius-circle')?.setData({
      type: 'FeatureCollection',
      features: isGlobal ? [] : [radiusCircleGeoJSON(center.lat, center.lng, radius)],
    })
  }, [isGlobal, center, radius, mapReady])

  // ─── Camera follows the selected location ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (suppressFlyRef.current) { suppressFlyRef.current = false; return }
    if (isGlobal) {
      // An active journey owns the camera (its fitBounds may have just run on
      // this same render) — don't yank the view back to the world default.
      if (selectedIndRef.current != null) return
      map.flyTo({ center: DEFAULT_VIEW.center, zoom: DEFAULT_VIEW.zoom, duration: 1200, essential: true })
    } else {
      map.flyTo({ center: [center.lng, center.lat], zoom: zoomForRadius(radius), duration: 1400, essential: true })
    }
  }, [isGlobal, center, radius, mapReady])

  // ─── Persist the full view to the URL (shareable links) ───────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (species !== 'all') sp.set('sp', species)
    if (preset !== DEFAULT_PRESET) sp.set('t', preset)
    if (center) {
      sp.set('clat', center.lat.toFixed(4))
      sp.set('clng', center.lng.toFixed(4))
      if (center.name) sp.set('cname', center.name)
      if (radius !== DEFAULT_RADIUS) sp.set('r', String(radius))
    }
    if (selectedInd != null) sp.set('ind', String(selectedInd))
    if (basemap !== 'satellite') sp.set('bm', basemap)
    if (mapView) {
      sp.set('lat', mapView.lat.toFixed(3))
      sp.set('lng', mapView.lng.toFixed(3))
      sp.set('z', mapView.zoom.toFixed(1))
    }
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage) // per-view social card
  }, [species, preset, center, radius, selectedInd, basemap, mapView, mapReady])

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    map.setStyle(basemapStyleFor(basemap))
  }, [basemap, mapReady])

  useEffect(() => {
    if (!basemapMenuOpen) return
    const onDoc = (e) => { if (basemapMenuRef.current && !basemapMenuRef.current.contains(e.target)) setBasemapMenuOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [basemapMenuOpen])

  // ─── Per-route SEO (client side; static happywhale.html covers crawlers) ──
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'HappyWhale — Whale encounters & individual journeys · EarthAtlas'
    const setMeta = (sel, val) => {
      const el = document.head.querySelector(sel)
      if (!el) return null
      const prev = el.getAttribute('content')
      el.setAttribute('content', val)
      return prev
    }
    const desc = 'Explore whale encounters from HappyWhale\'s photo-ID network — search any coast, filter by species and time, and follow a named whale\'s journey across oceans. An EarthAtlas tool.'
    const prevDesc = setMeta('meta[name="description"]', desc)
    const prevOgT = setMeta('meta[property="og:title"]', document.title)
    const prevOgD = setMeta('meta[property="og:description"]', desc)
    const prevOgU = setMeta('meta[property="og:url"]', 'https://earthatlas.org/happywhale')
    return () => {
      document.title = prevTitle
      if (prevDesc != null) setMeta('meta[name="description"]', prevDesc)
      if (prevOgT != null) setMeta('meta[property="og:title"]', prevOgT)
      if (prevOgD != null) setMeta('meta[property="og:description"]', prevOgD)
      if (prevOgU != null) setMeta('meta[property="og:url"]', prevOgU)
    }
  }, [])

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleSelect = useCallback((r) => {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return
    setCenter({ lat: r.lat, lng: r.lng, name: r.name || r.place_formatted || 'Selected location' })
    setRadius(DEFAULT_RADIUS)
  }, [])

  const handleClearLocation = useCallback(() => { setCenter(null) }, [])
  const handleClearJourney = useCallback(() => {
    setSelectedInd(null)
    // The effects clear these too; doing it here as well guarantees no
    // leftover route/stop artifacts even if a state update is interrupted.
    mapRef.current?.getSource('hw-track')?.setData({ type: 'FeatureCollection', features: [] })
    const cam = preJourneyCameraRef.current
    preJourneyCameraRef.current = null
    if (cam) mapRef.current?.flyTo({ center: cam.center, zoom: cam.zoom, duration: 1000, essential: true })
  }, [])

  const handleZoomToResults = useCallback(() => {
    const map = mapRef.current
    if (!map || !filteredEncounters.length) return
    const b = lngLatBoundsFor(filteredEncounters.map((e) => [e.lng, e.lat]))
    if (b) map.fitBounds(b, { padding: 90, maxZoom: 8, duration: 1200, essential: true })
  }, [filteredEncounters])

  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.container}>
        <div className={styles.tokenError}>
          <strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.
        </div>
      </div>
    )
  }

  const trackInd = track?.individual
  const trackSpan = track?.encounters.length
    ? [track.encounters[0].date, track.encounters[track.encounters.length - 1].date]
    : null

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={styles.shareCtl} />}

      {/* Branding */}
      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home">
          <span className={styles.wordmark}>Earth<em>Atlas</em></span>
        </a>
        <span className={styles.subBadge}>HappyWhale</span>
      </div>

      {/* Search */}
      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search a coast to see nearby whales…"
          proximity={() => {
            const m = mapRef.current
            if (!m) return undefined
            try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined }
          }}
          onSelect={handleSelect}
        />
      </div>

      {/* Basemap picker */}
      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button
          className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle}
          onClick={() => setBasemapMenuOpen((o) => !o)}
          aria-label="Choose basemap" title="Basemap"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem}
                onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}
              >
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <MapSheet title="Whale encounters" className={styles.panel}>
        <div className={styles.panelHead}>
          <span className={styles.panelTitle}>Whale encounters</span>
        </div>

          <div className={styles.panelBody}>
            {/* Status line */}
            <div className={styles.status}>
              {loading ? 'Loading encounters…'
                : error ? <span className={styles.statusError}>{error}</span>
                : isGlobal
                  ? `${stats.count.toLocaleString()} encounters worldwide`
                  : `${stats.count.toLocaleString()} encounters within ${radius} mi of ${center.name}`}
              {limitExceeded && !loading && !error && (
                <span className={styles.statusNote}> · showing the 10,000 most recent — narrow the time range or location for full coverage</span>
              )}
            </div>

            {!loading && !error && noneInView && (
              <button className={styles.zoomToResults} onClick={handleZoomToResults}>
                ⟶ None in this view — zoom to the encounters
              </button>
            )}

            {!isGlobal && (
              <button className={styles.clearLoc} onClick={handleClearLocation}>
                ✕ Clear location · back to worldwide
              </button>
            )}

            {/* Journey card */}
            {trackInd && (
              <div className={styles.journeyCard}>
                <div className={styles.journeyHead}>
                  {trackInd.avatar?.thumbUrl
                    ? <img className={styles.journeyAvatar} src={trackInd.avatar.thumbUrl} alt="" />
                    : <span className={styles.journeyDot} style={{ background: speciesColor(trackInd.speciesKey) }} />}
                  <span className={styles.journeyName}>
                    {SEX_GLYPH[trackInd.sex] ? `${SEX_GLYPH[trackInd.sex]} ` : ''}{trackInd.nickname || 'Identified individual'}
                  </span>
                  <button className={styles.journeyClose} onClick={handleClearJourney} aria-label="Clear journey">✕</button>
                </div>
                <div className={styles.journeyMeta}>
                  {speciesName(trackInd.speciesKey)}
                  {trackInd.primaryId ? ` · ${trackInd.primaryId}` : ''}
                </div>
                <div className={styles.journeyMeta}>
                  {track.encounters.length} encounters
                  {trackSpan ? ` · ${fmtDate(trackSpan[0])} → ${fmtDate(trackSpan[1])}` : ''}
                </div>
                <div className={styles.journeyMeta}>
                  Stops numbered on the map, ① oldest → newest
                </div>
                {trackInd.bio && <div className={styles.journeyBio}>{renderMarkdownLite(trackInd.bio)}</div>}
                <button type="button" className={styles.journeyZoom} onClick={() => fitToTrack()}>
                  ⟶ Zoom to journey
                </button>
                <a className={styles.journeyLink} href={individualUrl(trackInd.id)} target="_blank" rel="noopener noreferrer">
                  View on HappyWhale ↗
                </a>
              </div>
            )}

            {/* Species filter — long live taxonomy, so cap the list at 10
                (plus the active selection, which must never hide). */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Species</label>
              <div className={styles.chipRow}>
                <button className={species === 'all' ? styles.chipActive : styles.chip} onClick={() => setSpecies('all')}>
                  All
                </button>
                {(() => {
                  const CHIP_LIMIT = 10
                  let visible = speciesExpanded ? speciesCounts : speciesCounts.slice(0, CHIP_LIMIT)
                  if (!speciesExpanded && species !== 'all' && !visible.some(([k]) => k === species)) {
                    const active = speciesCounts.find(([k]) => k === species)
                    if (active) visible = [...visible, active]
                  }
                  return visible.map(([key, n]) => (
                    <button key={key} className={species === key ? styles.chipActive : styles.chip} onClick={() => setSpecies(key)}>
                      <span className={styles.chipDot} style={{ background: speciesColor(key) }} />
                      {speciesName(key)} · {n}
                    </button>
                  ))
                })()}
                {speciesCounts.length > 10 && (
                  <button className={styles.chipMore} onClick={() => setSpeciesExpanded((o) => !o)}>
                    {speciesExpanded ? '− Show fewer' : `+ ${speciesCounts.length - 10} more`}
                  </button>
                )}
              </div>
            </div>

            {/* Time range */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Time range</label>
              <div className={styles.chipRow}>
                {TIME_PRESETS.map((p) => (
                  <button key={p.id} className={preset === p.id ? styles.chipActive : styles.chip} onClick={() => setPreset(p.id)}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Radius (location mode only) */}
            {!isGlobal && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Radius</label>
                <div className={styles.chipRow}>
                  {RADIUS_OPTIONS.map((r) => (
                    <button key={r} className={radius === r ? styles.chipActive : styles.chip} onClick={() => setRadius(r)}>
                      {r} mi
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className={styles.statGrid}>
              <div className={styles.statBox}><span className={styles.statVal}>{stats.count.toLocaleString()}</span><span className={styles.statKey}>encounters</span></div>
              <div className={styles.statBox}><span className={styles.statVal}>{stats.individuals.toLocaleString()}</span><span className={styles.statKey}>known whales</span></div>
              <div className={styles.statBox}><span className={styles.statVal}>{stats.species.toLocaleString()}</span><span className={styles.statKey}>species</span></div>
            </div>

            <div className={styles.legendNote}>
              Rings mark photo-identified whales — click one, then “Show this
              whale's journey” to follow it across oceans.
            </div>

            <button type="button" className={styles.methodology} onClick={() => setShowMethodology(true)}>
              ⓘ How this is sourced
            </button>

            <div className={styles.builtBy}>
              EarthAtlas is built by{' '}
              <a href="https://knauernever.com" target="_blank" rel="noopener noreferrer" className={styles.builtByLink}>
                KnauerNever.com
              </a>
            </div>
          </div>
      </MapSheet>

      <div className={styles.tip}>Click an encounter for details · ringed dots are identified whales with journeys</div>

      {showMethodology && <MethodologyModal onClose={() => setShowMethodology(false)} />}
    </div>
  )
}

// ─── "How this is sourced" modal ────────────────────────────────────────────
function MethodologyModal({ onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">×</button>
        <h2 className={styles.modalTitle}>How this is sourced</h2>

        <section className={styles.modalSection}>
          <h3>What you're looking at</h3>
          <p>
            Every dot is a whale <strong>encounter</strong> — a documented sighting,
            usually with photos — contributed to{' '}
            <a href="https://happywhale.com" target="_blank" rel="noopener noreferrer">HappyWhale</a> by
            researchers, naturalists, and whale watchers. Color encodes species. Dots with a{' '}
            <strong>white ring</strong> are encounters matched by photo-ID (flukes, fins, and
            markings are as distinctive as fingerprints) to a <strong>known individual</strong> —
            click one to follow that whale's journey across oceans.
          </p>
        </section>

        <section className={styles.modalSection}>
          <h3>Where the data comes from</h3>
          <ul>
            <li>
              <strong>Encounters &amp; individuals — HappyWhale.</strong> Live data from
              HappyWhale's external API, served through an EarthAtlas proxy. HappyWhale's
              photo-ID matching is what links sightings of the same animal years and oceans
              apart. Photos are © their contributing photographers, via HappyWhale.
            </li>
            <li>
              <strong>Location &amp; radius.</strong> Picking a place searches encounters within
              the chosen radius. Place search uses Mapbox geocoding.
            </li>
            <li>
              <strong>Basemap.</strong> Mapbox satellite, dark, light, and streets styles.
            </li>
          </ul>
        </section>

        <section className={styles.modalSection}>
          <h3>Caveats</h3>
          <p>
            Encounter coverage follows where people watch whales — busy coasts report far more
            than open ocean, so empty water on this map is <strong>absence of observers, not
            absence of whales</strong>. Identifications depend on photo quality and catalog
            coverage, and recent encounters may still be awaiting a match.
          </p>
        </section>
      </div>
    </div>
  )
}
