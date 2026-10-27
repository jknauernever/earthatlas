/**
 * EarthAtlas Whale Watch (/whalewatch, Josh 2026-10-17): the tracks of the Salish Sea's whale-watching boats over the last
 * 12 months, newest data included.
 *
 * - The boats are the 'whalewatch' fleet in the /ships database (migration 034, lib/ships/fleets.js; list and how each boat
 *   was tied to its company in docs/WHALE_WATCH_FLEET.md). Adding a boat is a data step (scripts/ships/import-fleet.mjs),
 *   live within minutes, no deploy.
 * - Tracks are /ships' own (api/ship-tracks op=all, from = 11 months before the newest month): NOAA minute-level lines
 *   where published, Global Fishing Watch hourly positions after that. A boat's tracks follow its own MMSI periods (the
 *   /ships card rule), so a reassigned MMSI never pulls in another boat.
 * - LIVE (no replay hour): a boat with a live AIS report newer than its tracks is drawn from the aisstream.io recorder's
 *   snapshot (scripts/ships/aisstream/recorder.mjs → Blob ships/live/salish-v6.json, rewritten every 60 s): its latest
 *   position (last 24 h) and, if it was reported in the last 30 min, its trail (its last hour). Hover gives how long ago.
 * - The Ships pill searches every boat in /ships; a found boat's tracks join the map in the /ships "picked ship" color.
 *   That only changes this view (and its link), never the fleet list.
 *
 * Shell, panel, card and search are /ships' (ShipsApp.module.css, ShipPicker, VesselCard, components/panel), so the two
 * sites feel the same (docs/MAP_TOOL_CONVENTIONS.md: URL state, satellite default, ZoomIndicator, style.load readiness).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
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
import ShipPicker from '../ships/ShipPicker.jsx'
import VesselCard, { currentIdentity } from '../ships/VesselCard.jsx'
import trackSource from '../ships/trackSource.json'
import { DatasetRow, SourcesFooter, LegendSwatchRow, LoadingInline, Chevron } from '../components/panel'
import { SHIPS_SOURCES, SHIPS_SOURCES_NOTES } from '../ships/shipsSources.js'
import { BasemapMenu, ImageryLine, useMapPhotos, writePhoto } from '../components/basemap/index.js'
import shipsStyles from '../ships/ShipsApp.module.css'
import own from './WhaleWatchApp.module.css'
import { keepPopupOnMap } from '../lib/popupFit.js'
import WhaleTimeBar from './WhaleTimeBar.jsx'
import { buildTimeline, positionAt, latestPosition, trailAt, homePort, tripsOf } from './timeline.js'
import { useRecentWhales, drawRecentWhales, nearestWhaleHTML, RECENT_HOURS, PATH_HOURS, WHALE_COLOR } from './recentWhales.js'

const styles = { ...shipsStyles, ...own }
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const STYLE = 'mapbox://styles/mapbox/satellite-streets-v12'
const DEFAULT_CENTER = [-123.05, 48.5], DEFAULT_ZOOM = 9
const MOBILE_BOUNDS = [[-123.75, 48.05], [-122.45, 49.35]]
const FLEET_KEY = 'whalewatch'
const MONTHS_SHOWN = 12
// Minute-by-minute tracks from the live-AIS recorder (daily packs, from 2026-10-18); its build time keys the track cache.
const AIS_TRACKS_INDEX = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/tracks/aisstream-v1/index.json'

// Two kinds of boat only (Josh 2026-10-17: "the boats that have live data are most important"):
const LIVE_COLOR = '#fbbf24'    // live: drawn at its live AIS report (aisstream.io), full size, named, with its trail
const LIVE_TRAIL = '#fde68a'
const FLEET_COLOR = '#c4b5fd'   // on record (pale violet: reads on water, forest and pale shallows alike): newest position we hold,
                                // or in replay where it was at the hour shown; smaller, no name. Boats added with the search follow the same rule.
const PICK_COLOR = '#ffffff'    // the boat whose card is open: the trip picked in its Trips tab
const LINE_WIDTH = ['interpolate', ['linear'], ['zoom'], 7, 0.6, 10, 1.1, 14, 2]
const CASING_WIDTH = ['interpolate', ['linear'], ['zoom'], 7, 1.6, 10, 2.1, 14, 3]   // LINE_WIDTH + 1 (zoom may only sit at the top of an interpolate)
const PICK_WIDTH = ['interpolate', ['linear'], ['zoom'], 7, 1.6, 10, 2.4, 14, 3.5]
const SRC = 'ww-tracks', CASING = 'ww-casing', LINE = 'ww-line', EST = 'ww-est', PICK = 'ww-pick'
const LINE_OPACITY = 0.7
const TRAIL_SRC = 'ww-trail', TRAIL = 'ww-trail-line', BOAT_SRC = 'ww-boats', BOAT = 'ww-boat', BOAT_LABEL = 'ww-boat-label', BOAT_GROUP = 'ww-boat-group'
const REPLAY_TRAIL_H = 1   // replay: the hour behind each moving boat
const HOLD_S = 24 * 3600   // between tracks (tied up, or out of AIS range) a boat stays at its last fix this long
const TICK_MS = 450        // playback: one step per tick
const PORT_BOX = [-125.5, 46.8, -121.8, 50.6]   // ports considered for home ports (Salish Sea + approaches)
const NO_PORT = 'Home port not found'
// Each trip says where its positions come from (prime directive: the source beside the value).
const SOURCE_WORDS = { noaa: 'minute by minute (NOAA)', gfw: 'hourly, positions to about 1 km (Global Fishing Watch)', ais: 'minute by minute (live AIS, aisstream.io)' }
const fmtTripDay = (s) => new Date(s * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Vancouver' })
const fmtTripTime = (s) => new Date(s * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver' })
const fmtDur = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` }
const esc = (x) => String(x ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
const fmtWhen = (s) => new Date(s * 1000).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver', timeZoneName: 'short' })
// The shared white popup card (src/index.css), body as /ships' track hover: name, company, time, speed and heading.
function boatTipHTML(p) {
  const head = `<b>${esc(p.name || 'Unnamed boat')}</b>${p.company ? `<br><span style="color:#4b5563">${esc(p.company)}</span>` : ''}`
  if (p.live) {
    const ago = fmtAgo(Math.max(0, Date.now() / 1000 - p.at))
    const motion = p.moving
      ? `${p.kn != null ? `${p.kn.toFixed(1)} kn · ` : ''}heading ${String(Math.round(p.heading) % 360).padStart(3, '0')}°`
      : `<span style="color:#4b5563">${p.kn != null && p.kn >= 1 ? `${p.kn.toFixed(1)} kn when last reported` : 'Not under way when last reported'}</span>`
    return `<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45">${head}<br><b style="color:#047857">Live AIS</b>, reported ${ago} (${fmtWhen(p.at)})<br>${motion}<br><span style="color:#4b5563">Source: aisstream.io live AIS</span></div>`
  }
  // LIVE, not heard now: how long since it was last heard (Josh 2026-10-26), above the time itself.
  const when = `${p.heardH != null ? `<b>Last heard ${fmtAgo(p.heardH * 3600)}</b><br>` : ''}${p.exact ? '' : '≈ '}${fmtWhen(p.at)}`
  const motion = p.moving
    ? `${p.kn != null ? `${p.exact ? '' : 'avg '}${p.kn.toFixed(1)} kn · ` : ''}heading ${String(Math.round(p.heading) % 360).padStart(3, '0')}°`
    : `<span style="color:#4b5563">Last position on record (tied up, or out of AIS range); heading ${String(Math.round(p.heading) % 360).padStart(3, '0')}° on arrival</span>`
  // Global Fishing Watch's hourly positions are given to the nearest 0.01° (about 1 km here): said so, not drawn as exact.
  const approx = p.approx === 1 || p.src === 'gfw'
    ? '<br><span style="color:#4b5563">Position to about 1 km: Global Fishing Watch hourly data</span>' : ''
  return `<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45">${head}<br>${when}<br>${motion}${approx}</div>`
}
// A small boat seen from above, pointing north (the icon rotates to the heading), in the fleet / found-boat colours.
const boatSvg = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="54" viewBox="0 0 40 60"><path d="M20 3 C27 12 29 21 29 30 L29 52 Q29 57 20 57 Q11 57 11 52 L11 30 C11 21 13 12 20 3 Z" fill="${fill}" stroke="#0a0e17" stroke-width="3" stroke-linejoin="round"/><rect x="15.5" y="26" width="9" height="12" rx="2" fill="#0a0e17" opacity="0.55"/></svg>`
// GFW's path estimated along the water between two hourly positions: dashed and fainter, as on /ships.
const OBSERVED = ['!=', ['get', 'est'], 1], ESTIMATED = ['==', ['get', 'est'], 1]

// Live AIS (aisstream.io via our Fly.io recorder). Localhost reads a copy in public/dev-data/ when the Blob file isn't there.
const LIVE_URL = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com/ships/live/salish-v6.json'
const LIVE_DEV_URL = '/dev-data/aisstream-live.json'
const AISSTREAM = 'https://aisstream.io'
const LIVE_POLL_MS = 60_000
const LIVE_RECENT_S = 3600        // "reporting now" in the panel count
const LIVE_MOVING_S = 30 * 60     // a live boat counts as under way only if reported this recently at ≥ 1 kn
const fmtAgo = (sec) => (sec < 90 ? 'just now' : sec < 3600 ? `${Math.round(sec / 60)} min ago` : sec < 48 * 3600 ? `${Math.round(sec / 3600)} h ago` : `${Math.round(sec / 86400)} days ago`)
const fmtClock = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Vancouver', timeZoneName: 'short' })

const BASIS_WORDS = { fcc_licensee: 'FCC radio license', tc_registered_owner: 'Transport Canada register', operator_website: 'Named by the operator', manual: 'Added by EarthAtlas' }
const PWWA = 'https://pacificwhalewatchassociation.com/members'

// URL (docs/MAP_TOOL_CONVENTIONS.md §1):  lat,lng,z camera · v open ship card (vessel id) · add found boats (vessel ids, comma)
//   tk '1' = the 12 months of tracks on (default off: boats + trails) · hp hidden home ports (comma, as listed) · fl '0' = fleet off · t replay hour (YYYY-MM-DDTHH, UTC; absent = live)
function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); const n = v == null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null }
  const list = (k) => (sp.get(k) || '').split(',').map((s) => s.trim()).filter(Boolean)
  return { lat: num('lat'), lng: num('lng'), z: num('z'), v: sp.get('v'), add: list('add').filter((s) => /^[0-9a-f-]{36}$/i.test(s)), hp: list('hp'), fl: sp.get('fl'), wh: sp.get('wh'),
    tk: sp.get('tk'), ct: sp.get('ct'), tr: /^\d{9,10}$/.test(sp.get('tr') || '') ? Number(sp.get('tr')) : null,
    t: /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(sp.get('t') || '') ? Date.parse(`${sp.get('t')}:00:00Z`) / 1000 : null }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}

const monthAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const fmtMonth = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
// A track belongs to a boat only if its MMSI is one the boat held and it starts inside that MMSI's window (as /ships).
const inOwnWindow = (f, periods) => periods.some(({ mmsi, from, to }) =>
  f.properties.mmsi === mmsi && (from == null || f.properties.t0 >= from) && (to == null || f.properties.t0 <= to))
const periodsOf = (v) => {
  const secs = (x) => (x ? Math.floor(new Date(x).getTime() / 1000) : null)
  return v.assertions.filter((a) => a.attribute === 'mmsi' && /^\d{9}$/.test(a.value_norm) && a.period_kind !== 'unknown')
    .map((a) => ({ mmsi: Number(a.value_norm), from: secs(a.from), to: secs(a.to) }))
}

// Run `fn` over `items`, at most `n` at a time, taking each from the front of `items` (so items can be pulled out meanwhile).
async function eachLimit(items, n, fn) {
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (items.length) await fn(items.shift()) }))
}

export default function WhaleWatchApp() {
  const isMobile = useIsMobile()
  const initial = useMemo(() => readUrlState(), [])
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const photos = useMapPhotos(mapRef, { mapReady })   // the photo picker shared by every site (components/basemap)
  const [styleVersion, setStyleVersion] = useState(0)
  const [mapView, setMapView] = useState(initial.lat != null && initial.lng != null && initial.z != null ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null)

  const [fleet, setFleet] = useState(null)          // { name, members: [...] } from api/ships op=fleet
  const [fleetError, setFleetError] = useState(null)
  const [fleetOn, setFleetOn] = useState(initial.fl !== '0')
  const [whalesOn, setWhalesOn] = useState(initial.wh !== '0')   // whale paths and recent reports, live and in replay (recentWhales.js)
  const [hidden, setHidden] = useState(() => new Set(initial.hp))   // home ports switched off
  const [openCo, setOpenCo] = useState(null)        // home port whose boats are listed
  const [ports, setPorts] = useState(null)          // our ports near the Salish Sea (api/ships op=portsLayer)
  const [t, setT] = useState(initial.t)             // replay hour (epoch s); null = live
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [allTracks, setAllTracks] = useState(initial.tk === '1')   // the 12 months of every boat's tracks
  const [win, setWin] = useState(null)              // { from, newest, through, key }
  const [tracks, setTracks] = useState({})          // vessel id → features (the last 12 months)
  const [pending, setPending] = useState(0)
  const [added, setAdded] = useState(() => initial.add.map((id) => ({ id, name: null, periods: null })))
  const [sel, setSel] = useState(initial.v)         // open ship card
  const [cardTab, setCardTab] = useState(initial.ct || 'overview')   // the ship card's tab (trips = this site's Trips tab)
  const [tripT0, setTripT0] = useState(initial.tr)  // the picked boat's trip shown (its start, epoch s); null = none until one is clicked
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState([])
  const fitRef = useRef(false)                      // fit to the picked boat once its tracks are in
  const [liveSnap, setLiveSnap] = useState(null)    // aisstream recorder snapshot (LIVE_URL)
  const recentWhales = useRecentWhales(whalesOn, t)
  const whaleGroupsRef = useRef([])
  const whalesOnRef = useRef(whalesOn); whalesOnRef.current = whalesOn
  const tRef = useRef(t); tRef.current = t
  whaleGroupsRef.current = recentWhales.groups
  const whalePathsRef = useRef([])
  whalePathsRef.current = recentWhales.paths
  const [nowS, setNowS] = useState(() => Math.floor(Date.now() / 1000))

  // ─── Map ───
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current, style: STYLE,
      ...(mapView ? { center: [mapView.lng, mapView.lat], zoom: mapView.zoom }
        : isMobile ? { bounds: MOBILE_BOUNDS, fitBoundsOptions: { padding: 20 } } : { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }),
      projection: 'globe',   // as /ships: same imagery and atmosphere (the flat map drew Mapbox's pale sun-glint haze around the islands)
    })
    mapRef.current = map
    if (import.meta.env.DEV) window.__whalewatchMap = map
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

  // ─── The fleet and the 12-month window ───
  useEffect(() => {
    fetch(`/api/ships?op=fleet&key=${FLEET_KEY}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`fleet ${r.status}`))))
      .then(setFleet).catch((e) => setFleetError(e.message))
    fetch('/api/ships?op=portsLayer&v=2026-10-19').then((r) => r.json()).then((d) => setPorts((d.features || []).filter((f) => {
      const [x, y] = f.geometry.coordinates; return f.properties.n && x >= PORT_BOX[0] && x <= PORT_BOX[2] && y >= PORT_BOX[1] && y <= PORT_BOX[3]
    }))).catch(() => setPorts([]))
    Promise.all([
      fetch('/api/ship-tracks?op=gfwindex').then((r) => r.json()).catch(() => ({ months: {} })),
      fetch('/api/ship-tracks?op=salishindex').then((r) => r.json()).catch(() => ({ months: {} })),
      fetch(`${AIS_TRACKS_INDEX}?t=${Math.floor(Date.now() / 60000)}`).then((r) => (r.ok ? r.json() : { days: {} })).catch(() => ({ days: {} })),
    ]).then(([g, s, a]) => {
      const all = [...Object.keys(g.months || {}), ...Object.keys(s.months || {})].sort()
      const newest = all[all.length - 1]
      if (!newest) return
      const from = monthAdd(newest, -(MONTHS_SHOWN - 1))
      // Changes whenever either bake adds or rebuilds a month, so a cached response is never stale.
      const aisDays = Object.keys(a.days || {}).sort(), aisLast = aisDays[aisDays.length - 1]
      const key = [from, g.months?.[newest]?.built || '', s.updated || '', aisLast ? a.days[aisLast].built : '', trackSource.version, trackSource.us?.rules || ''].join('.')
      setWin({ from, newest, through: g.fetched_through || null, key })
    })
  }, [])

  // ─── Live AIS: the recorder's snapshot, every minute while the tab is visible ───
  useEffect(() => {
    let stop = false
    const load = async () => {
      if (document.hidden) return
      setNowS(Math.floor(Date.now() / 1000))
      let snap = await fetch(LIVE_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (!snap && import.meta.env.DEV) snap = await fetch(LIVE_DEV_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      if (!stop && snap?.ships) setLiveSnap(snap)
    }
    load()
    const id = setInterval(load, LIVE_POLL_MS)
    const onVis = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVis)
    return () => { stop = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  const liveByMmsi = useMemo(() => {
    const m = new Map()
    for (const r of liveSnap?.ships || []) {
      const [mmsi, at, lon, lat, sog, cog, heading] = r
      m.set(mmsi, { mmsi, at, lngLat: [lon, lat], sog, cog, heading })
    }
    return m
  }, [liveSnap])

  // ─── Tracks: one request per MMSI (cached at the edge per window key) ───
  const loadedRef = useRef(new Set())
  const loadBoat = async (vid, periods) => {
    const mmsis = [...new Set(periods.map((p) => p.mmsi))]
    const fcs = await Promise.all(mmsis.map((m) => fetch(`/api/ship-tracks?op=all&mmsi=${m}&from=${win.from}&v=${encodeURIComponent(win.key)}`)
      .then((r) => (r.ok ? r.json() : { features: [] })).catch(() => ({ features: [] }))))
    const feats = fcs.flatMap((fc) => fc.features).filter((f) => inOwnWindow(f, periods))
    for (const f of feats) f.properties.vid = vid
    setTracks((t) => ({ ...t, [vid]: feats }))
  }
  // The open card's boat goes first (Josh 2026-10-23: its Trips tab waited behind the other 44): queued boats sit in
  // queueRef, and opening a card pulls its boat out of the queue and loads it at once.
  const queueRef = useRef([])
  const loadQueued = (m) => loadBoat(m.vessel_id, m.mmsiPeriods).finally(() => setPending((n) => n - 1))
  useEffect(() => {
    if (!win || !fleet) return
    const todo = fleet.members.filter((m) => !loadedRef.current.has(m.vessel_id))
    if (!todo.length) return
    for (const m of todo) loadedRef.current.add(m.vessel_id)
    setPending((n) => n + todo.length)
    const q = queueRef.current, idle = !q.length   // workers already running drain whatever is added
    q.push(...todo.filter((m) => m.vessel_id !== sel))
    const first = todo.find((m) => m.vessel_id === sel)
    if (first) loadQueued(first)
    if (idle) eachLimit(q, 6, loadQueued)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, fleet])
  useEffect(() => {
    const q = queueRef.current, i = q.findIndex((m) => m.vessel_id === sel)
    if (i >= 0) loadQueued(q.splice(i, 1)[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel])
  // Found boats: their identity (name, MMSI periods) from the ship record, then their tracks.
  useEffect(() => {
    if (!win) return
    for (const a of added) {
      if (loadedRef.current.has(a.id)) continue
      loadedRef.current.add(a.id)
      setPending((n) => n + 1)
      fetch(`/api/ships?op=vessel&id=${a.id}`).then((r) => r.json()).then(async (v) => {
        const periods = periodsOf(v)
        setAdded((list) => list.map((x) => (x.id === a.id ? { ...x, name: currentIdentity(v).name?.value_raw || 'Unnamed vessel', periods } : x)))
        await loadBoat(a.id, periods)
      }).catch(() => {}).finally(() => setPending((n) => n - 1))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, added])

  const members = fleet?.members || []
  const memberIds = useMemo(() => new Set(members.map((m) => m.vessel_id)), [members])
  // Each boat's tracks as a timeline (positions at any hour), and its home port: where it ties up overnight (from AIS).
  const segsByVid = useMemo(() => Object.fromEntries(Object.entries(tracks).map(([vid, fs]) => [vid, buildTimeline(fs)])), [tracks])
  const homes = useMemo(() => {
    if (!ports) return {}
    const out = {}
    for (const m of members) { const segs = segsByVid[m.vessel_id]; if (segs) out[m.vessel_id] = segs.length ? homePort(segs, ports) : null }
    return out
  }, [members, segsByVid, ports])
  const portOf = (vid) => homes[vid]?.name || (vid in homes ? NO_PORT : null)
  const groups = useMemo(() => {
    const by = new Map()
    for (const m of members) {
      const key = portOf(m.vessel_id) || 'Finding home ports…'
      if (!by.has(key)) by.set(key, { name: key, portId: homes[m.vessel_id]?.portId ?? null, boats: [] })
      by.get(key).boats.push(m)
    }
    for (const g of by.values()) g.boats.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    const last = (n) => (n === NO_PORT || n === 'Finding home ports…' ? 1 : 0)
    return [...by.values()].sort((a, b) => last(a.name) - last(b.name) || b.boats.length - a.boats.length || a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, homes])
  const memberById = useMemo(() => new Map(members.map((m) => [m.vessel_id, m])), [members])
  // A boat's live AIS report: by its current MMSI (fleet boats), or the MMSI of its newest period (boats found with search).
  const liveOf = (vid) => {
    const m = memberById.get(vid)
    const ids = m ? [Number(m.mmsi)]
      : (added.find((x) => x.id === vid)?.periods || []).slice().sort((a, b) => (b.to ?? Infinity) - (a.to ?? Infinity)).slice(0, 1).map((q) => q.mmsi)
    let best = null
    for (const id of ids) { const r = liveByMmsi.get(id); if (r && (!best || r.at > best.at)) best = r }
    return best
  }
  const liveNow = useMemo(() => members.filter((m) => { const r = liveByMmsi.get(Number(m.mmsi)); return r && nowS - r.at <= LIVE_RECENT_S }).length,
    [members, liveByMmsi, nowS])
  const shownIds = useMemo(() => [
    ...(fleetOn ? members.filter((m) => !hidden.has(portOf(m.vessel_id))).map((m) => m.vessel_id) : []),
    ...added.filter((a) => !memberIds.has(a.id)).map((a) => a.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [fleetOn, members, hidden, added, memberIds, homes])
  // The picked boat's trips (Josh 2026-10-17: follow a boat through its history one trip at a time, not a year of white lines).
  const trips = useMemo(() => (sel && segsByVid[sel] ? tripsOf(segsByVid[sel]) : []), [sel, segsByVid])
  // No trip line until one is clicked in the Trips tab (Josh 2026-10-23: a white line on opening the card confused things).
  const shownTrip = trips.find((tr) => tr.t0 === tripT0) || null
  // Lines: every shown boat's 12 months when that's on (muted), plus the picked boat's shown trip (white).
  const features = useMemo(() => [
    ...(allTracks ? shownIds.flatMap((id) => tracks[id] || []) : []),
    ...(shownTrip ? shownTrip.segs.map((sg) => ({ ...sg.f, properties: { ...sg.f.properties, pick: 1 } })) : []),
  ], [allTracks, shownIds, tracks, shownTrip])

  // ─── Time: the slider runs from the window's first hour to the newest fix on record (= LIVE) ───
  const startS = win ? Date.parse(`${win.from}-01T00:00:00Z`) / 1000 : null
  const latest = useMemo(() => Object.fromEntries(Object.entries(segsByVid).map(([vid, segs]) => [vid, latestPosition(segs)])), [segsByVid])
  // Each boat's newest position recorded by aisstream.io (minute by minute, since Oct 18, 2026): what LIVE draws.
  const latestAis = useMemo(() => Object.fromEntries(Object.entries(segsByVid).map(([vid, segs]) => [vid, latestPosition(segs.filter((sg) => sg.src === 'ais'))])), [segsByVid])
  const endS = useMemo(() => {
    let m = 0
    for (const p of Object.values(latest)) if (p && p.at > m) m = p.at
    return m ? Math.ceil(m / 3600) * 3600 : null
  }, [latest])
  useEffect(() => {
    if (!playing || endS == null) return
    const id = setInterval(() => setT((cur) => {
      const n = (cur ?? endS) + speed * 3600
      if (n >= endS) { setPlaying(false); return null }
      return n
    }), TICK_MS)
    return () => clearInterval(id)
  }, [playing, speed, endS])
  const boatsNow = useMemo(() => {
    const points = [], trails = []
    for (const vid of shownIds) {
      const segs = segsByVid[vid]
      const isAddedBoat = !memberIds.has(vid)
      // LIVE: the boat's live AIS report, when it is newer than its tracks.
      const lv = t == null ? liveOf(vid) : null
      if (lv && (!latestAis[vid] || lv.at > latestAis[vid].at)) {
        const age = nowS - lv.at
        const moving = (lv.sog ?? 0) >= 1 && age <= LIVE_MOVING_S
        points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: lv.lngLat },
          properties: { vid, heading: lv.heading ?? lv.cog ?? 0, kn: lv.sog ?? null, at: lv.at, exact: 1, added: isAddedBoat ? 1 : 0, moving: moving ? 1 : 0, live: 1, ageH: age / 3600,
            name: memberById.get(vid)?.name || added.find((x) => x.id === vid)?.name || '', company: memberById.get(vid)?.company || '' } })
        const tr = moving && (!sel || sel === vid) ? liveSnap?.trails?.[lv.mmsi] : null   // with a card open, only its own boat's trail
        if (tr?.length >= 2) trails.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: tr.map((q) => [q[0], q[1]]) }, properties: { vid, added: isAddedBoat ? 1 : 0, live: 1 } })
        continue
      }
      if (!segs?.length) continue
      // LIVE draws only what aisstream.io recorded (Josh 2026-10-19): a boat not live now shows at its newest recorded live-AIS
      // position, or not at all; Global Fishing Watch's ~1 km hourly positions are for replay only.
      const p = t == null ? latestAis[vid] : positionAt(segs, t, HOLD_S)
      if (!p) continue
      const isAdded = !memberIds.has(vid)
      const ageH = ((t ?? nowS) - p.at) / 3600   // LIVE: against now, so days-old travel draws no trail (Josh 2026-10-17)
      points.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p.lngLat },
        properties: { vid, heading: p.heading, kn: p.kn ?? null, at: p.at, exact: p.exact ? 1 : 0, approx: p.src === 'gfw' ? 1 : 0, added: isAdded ? 1 : 0, moving: p.moving ? 1 : 0, ageH,
          ...(t == null ? { heardH: ageH } : {}),   // LIVE: fades with time since last heard (BOAT icon-opacity) and the hover says so
          name: memberById.get(vid)?.name || added.find((x) => x.id === vid)?.name || '', company: memberById.get(vid)?.company || '' } })
      // A trail only for a boat that moved in the hours before the time shown (Josh 2026-10-17: none for a boat that has sat for days).
      // Trails: in LIVE only live boats have one (above); in replay, a boat's last hour, only where it moved.
      // While a boat's card is open its picked trip (white) is the only line; other boats are dots (Josh 2026-10-17).
      if (t == null || !p.moving || sel) continue
      for (const c of trailAt(segs, t, REPLAY_TRAIL_H)) {
        trails.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: { vid, added: isAdded ? 1 : 0 } })
      }
    }
    return { points, trails }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownIds, segsByVid, latest, latestAis, t, endS, memberIds, memberById, added, liveByMmsi, liveSnap, nowS, sel])

  // ─── Layers ───
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    if (!map.getSource(SRC)) {
      const labelsId = map.getStyle().layers.find((l) => l.type === 'symbol')?.id
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      const color = FLEET_COLOR
      map.addLayer({ id: CASING, type: 'line', source: SRC, filter: OBSERVED, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0a0e17', 'line-width': CASING_WIDTH, 'line-opacity': 0.35 } }, labelsId)
      map.addLayer({ id: LINE, type: 'line', source: SRC, filter: OBSERVED, layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': color, 'line-width': LINE_WIDTH, 'line-opacity': LINE_OPACITY } }, labelsId)
      map.addLayer({ id: EST, type: 'line', source: SRC, filter: ESTIMATED, layout: { 'line-join': 'round' },
        paint: { 'line-color': color, 'line-width': LINE_WIDTH, 'line-opacity': LINE_OPACITY * 0.65, 'line-dasharray': [2, 2] } }, labelsId)
      map.addLayer({ id: PICK, type: 'line', source: SRC, filter: ['==', ['get', 'vid'], ''], layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': PICK_COLOR, 'line-width': PICK_WIDTH, 'line-opacity': 1 } }, labelsId)
      const hover = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: styles.hoverTip, maxWidth: '260px' })
      for (const id of [LINE, EST, PICK]) {
        map.on('mousemove', id, (e) => {
          map.getCanvas().style.cursor = 'pointer'
          // On a track: the boat's position nearest the cursor along it, with its time, speed and heading.
          const f = e.features[0], vid = f?.properties.vid
          const hit = nearestRef.current(vid, [e.lngLat.lng, e.lngLat.lat])
          const who = nameRef.current(vid)
          if (!who) return
          const [name, company] = who.split(' · ')
          if (hit) hover.setLngLat(e.lngLat).setHTML(boatTipHTML({ ...hit, name, company, moving: true })).addTo(map)
          else hover.setLngLat(e.lngLat).setHTML(boatTipHTML({ name, company, at: f.properties.t0, exact: false, moving: true, heading: 0, kn: null })).addTo(map)
        })
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; hover.remove() })
        map.on('click', id, (e) => { const vid = e.features[0]?.properties.vid; if (vid) { hover.remove(); setSel(vid); setPickerOpen(false) } })
      }
    }
    map.getSource(SRC).setData({ type: 'FeatureCollection', features })
  }, [mapReady, styleVersion, features])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getSource(SRC)) return
    let cancelled = false
    const ensure = async () => {
      for (const [id, fill] of [['ww-boat-fleet', FLEET_COLOR], ['ww-boat-live', LIVE_COLOR]]) {
        if (map.hasImage(id)) continue
        const img = new Image(36, 54)
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(boatSvg(fill))}`
        await img.decode().catch(() => {})
        if (cancelled || map.hasImage(id)) continue
        map.addImage(id, img, { pixelRatio: 2 })
      }
      if (cancelled) return
      if (!map.getSource(TRAIL_SRC)) {
        map.addSource(TRAIL_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
        map.addLayer({ id: TRAIL, type: 'line', source: TRAIL_SRC, layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['case', ['==', ['get', 'live'], 1], LIVE_TRAIL, FLEET_COLOR], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 1.6, 12, 3], 'line-opacity': ['case', ['==', ['get', 'live'], 1], 0.95, 0.7] } })
        // Boats drawn on top of each other (several tied up in one marina, or sharing one Global Fishing Watch position): one
        // boat with a count instead; a click lists them (Josh 2026-10-19). Amber when any of them is live.
        map.addSource(BOAT_SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] },
          cluster: true, clusterRadius: 12, clusterMaxZoom: 23, maxzoom: 24, clusterProperties: { live: ['max', ['get', 'live']] } })
        map.addLayer({ id: BOAT, type: 'symbol', source: BOAT_SRC, filter: ['!', ['has', 'point_count']], layout: {
          'icon-image': ['case', ['==', ['get', 'live'], 1], 'ww-boat-live', 'ww-boat-fleet'],
          'icon-rotate': ['get', 'heading'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, ['case', ['==', ['get', 'live'], 1], 1.05, 0.8], 11, ['case', ['==', ['get', 'live'], 1], 1.3, 1], 14, ['case', ['==', ['get', 'live'], 1], 1.6, 1.2]],
          'symbol-sort-key': ['case', ['==', ['get', 'live'], 1], 1, 0] },   // live boats draw on top
          // Not heard now (LIVE): fainter the longer since it was last heard (Josh 2026-10-26), so days-old positions read as old.
          paint: { 'icon-opacity': ['case', ['==', ['get', 'live'], 1], 1, ['has', 'heardH'],
            ['interpolate', ['linear'], ['get', 'heardH'], 1, 0.85, 24, 0.6, 72, 0.4, 168, 0.25], 0.85] } })
        map.addLayer({ id: BOAT_GROUP, type: 'symbol', source: BOAT_SRC, filter: ['has', 'point_count'], layout: {
          'icon-image': ['case', ['==', ['get', 'live'], 1], 'ww-boat-live', 'ww-boat-fleet'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 1.05, 11, 1.3, 14, 1.6],
          'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-offset': [1.1, -1.1], 'text-allow-overlap': true, 'text-ignore-placement': true,
          'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'] },
          paint: { 'text-color': '#f8fafc', 'text-halo-color': 'rgba(10,14,23,0.95)', 'text-halo-width': 2.2 } })
        map.addLayer({ id: BOAT_LABEL, type: 'symbol', source: BOAT_SRC, minzoom: 10.5, filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'live'], 1]], layout: {   // names on live boats only
          'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.4], 'text-anchor': 'top', 'text-optional': true,
          'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'] },
          paint: { 'text-color': '#f8fafc', 'text-halo-color': 'rgba(10,14,23,0.9)', 'text-halo-width': 1.4 } })
        const hover = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: styles.hoverTip, maxWidth: '260px' })
        map.on('mousemove', BOAT, (e) => {
          map.getCanvas().style.cursor = 'pointer'
          const f = e.features[0]
          if (!f) return
          const pr = f.properties   // (GeoJSON properties come back as plain values; null survives as null)
          const [lng, lat] = f.geometry.coordinates
          const near = pr.live === 1 && whalesOnRef.current && tRef.current == null ? nearestWhaleHTML(whaleGroupsRef.current, lng, lat, RECENT_HOURS, whalePathsRef.current) : ''
          hover.setLngLat(f.geometry.coordinates).setHTML(boatTipHTML({ ...pr, moving: pr.moving === 1, exact: pr.exact === 1, live: pr.live === 1, kn: pr.kn == null ? null : Number(pr.kn) }) + near).addTo(map)
        })
        map.on('mouseleave', BOAT, () => { map.getCanvas().style.cursor = ''; hover.remove() })
        map.on('click', BOAT, (e) => { const vid = e.features[0]?.properties.vid; if (vid) { hover.remove(); setSel(vid); setPickerOpen(false) } })
        map.on('mousemove', BOAT_GROUP, (e) => {
          map.getCanvas().style.cursor = 'pointer'
          const f = e.features[0]
          if (f) hover.setLngLat(f.geometry.coordinates).setHTML(`<div style="padding:6px 10px;color:#111827;font-size:12px;line-height:1.45"><b>${f.properties.point_count} boats here</b><br><span style="color:#4b5563">Click to pick one</span></div>`).addTo(map)
        })
        map.on('mouseleave', BOAT_GROUP, () => { map.getCanvas().style.cursor = ''; hover.remove() })
        let groupPopup = null
        map.on('click', BOAT_GROUP, (e) => {
          const f = e.features[0]
          if (!f) return
          hover.remove()
          map.getSource(BOAT_SRC).getClusterLeaves(f.properties.cluster_id, 100, 0, (err, leaves) => {
            if (err || !leaves?.length) return
            const boats = [...leaves].sort((a, b) => (b.properties.live - a.properties.live) || (b.properties.at - a.properties.at))
            const s = shipsStyles
            const rows = boats.map((b, i) => {
              const q = b.properties
              const when = q.live === 1 ? `Live, reported ${fmtAgo(Math.max(0, Date.now() / 1000 - q.at))}` : `On record ${q.exact ? '' : '≈ '}${fmtWhen(q.at)}`
              return `<button type="button" class="${s.popupShip}" data-pick="${i}"><span class="${s.popupShipKind}"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px;background:${q.live === 1 ? LIVE_COLOR : FLEET_COLOR};border:1px solid rgba(0,0,0,0.3)"></span>${esc(q.name || 'Unnamed boat')}</span><span class="${s.popupShipMeta}" style="padding-left:15px">${esc(when)}</span></button>`
            }).join('')
            groupPopup?.remove()
            groupPopup = keepPopupOnMap(new mapboxgl.Popup({ offset: 14, maxWidth: '280px' }).setLngLat(f.geometry.coordinates)
              .setHTML(`<div class="${s.popup}"><div class="${s.popupTitle}">${boats.length} boats at this spot</div><div class="${s.popupMeta}">Pick one to see it.</div><div class="${s.popupList}">${rows}</div></div>`).addTo(map))
            groupPopup.getElement()?.querySelectorAll('[data-pick]').forEach((el) => el.addEventListener('click', () => {
              groupPopup.remove(); setSel(boats[Number(el.dataset.pick)].properties.vid); setPickerOpen(false)
            }))
          })
        })
      }
      map.getSource(TRAIL_SRC).setData({ type: 'FeatureCollection', features: boatsNow.trails })
      map.getSource(BOAT_SRC).setData({ type: 'FeatureCollection', features: boatsNow.points })
    }
    ensure()
    return () => { cancelled = true }
  }, [mapReady, styleVersion, boatsNow, features])
  // Recent whale reports (LIVE only): above the boats so a pod beside a boat stays visible.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    drawRecentWhales(map, recentWhales.groups, !whalesOn, styles.hoverTip, recentWhales.paths, recentWhales.endMs ?? Date.now(), t == null)
  }, [mapReady, styleVersion, recentWhales, whalesOn, t])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !map.getLayer(PICK)) return
    map.setFilter(PICK, ['==', ['get', 'pick'], 1])
    for (const l of [CASING, LINE, EST]) { map.setLayoutProperty(l, 'visibility', allTracks ? 'visible' : 'none'); map.setFilter(l, ['all', l === EST ? ESTIMATED : OBSERVED, ['!=', ['get', 'pick'], 1]]) }
    map.setPaintProperty(LINE, 'line-opacity', sel ? LINE_OPACITY * 0.5 : LINE_OPACITY)
    map.setPaintProperty(EST, 'line-opacity', (sel ? LINE_OPACITY * 0.5 : LINE_OPACITY) * 0.65)
  }, [sel, mapReady, styleVersion, allTracks])
  // Fit to the shown trip when a boat or a trip is picked.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !fitRef.current || !sel || !segsByVid[sel]) return
    fitRef.current = false
    if (!shownTrip) return
    const b = new mapboxgl.LngLatBounds()
    for (const sg of shownTrip.segs) for (const c of sg.c) b.extend(c)
    map.fitBounds(b, { padding: isMobile ? 30 : { top: 80, bottom: 110, left: 380, right: 420 }, maxZoom: 13, duration: 1000 })
  }, [sel, segsByVid, shownTrip, isMobile])
  // While the slider runs, a clicked trip follows it: the trip under way at the hour shown.
  useEffect(() => {
    if (t == null || !trips.length || tripT0 == null) return
    const on = trips.find((tr) => t >= tr.t0 - 1800 && t <= tr.t1 + 1800)
    if (on && on.t0 !== shownTrip?.t0) setTripT0(on.t0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, trips])
  const pickTrip = (tr) => { setPlaying(false); setTripT0(tr.t0); setT(tr.t0); fitRef.current = true }

  const nameOf = (vid) => {
    const m = memberById.get(vid)
    if (m) return `${m.name || 'Unnamed boat'} · ${m.company}`
    const a = added.find((x) => x.id === vid)
    return a?.name || null
  }
  const nameRef = useRef(nameOf)
  nameRef.current = nameOf
  // The point of a boat's tracks nearest the cursor (for the track hover): its time, speed and heading there.
  const nearestRef = useRef(null)
  nearestRef.current = (vid, ll) => {
    const segs = segsByVid[vid]
    if (!segs) return null
    let best = null, bd = Infinity
    for (const s of segs) for (let i = 1; i < s.c.length; i++) {
      const a = s.c[i - 1], b = s.c[i]
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy
      const k = L ? Math.max(0, Math.min(1, ((ll[0] - a[0]) * dx + (ll[1] - a[1]) * dy) / L)) : 0
      const px = a[0] + dx * k, py = a[1] + dy * k, d = (px - ll[0]) ** 2 + (py - ll[1]) ** 2
      if (d < bd) { bd = d; best = { s, i, k } }
    }
    if (!best) return null
    const { s, i, k } = best
    const at = s.ts[i - 1] + (s.ts[i] - s.ts[i - 1]) * k
    return positionAt([s], at)
  }

  // ─── URL + share card ───
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))
  useEffect(() => {
    const sp = new URLSearchParams()
    if (sel) sp.set('v', sel)
    if (sel && tripT0 != null) sp.set('tr', String(tripT0))
    if (sel && cardTab !== 'overview') sp.set('ct', cardTab)
    if (added.length) sp.set('add', added.map((a) => a.id).join(','))
    if (hidden.size) sp.set('hp', [...hidden].join(','))
    if (t != null) sp.set('t', new Date(t * 1000).toISOString().slice(0, 13))
    if (!fleetOn) sp.set('fl', '0')
    if (!whalesOn) sp.set('wh', '0')
    if (allTracks) sp.set('tk', '1')
    writePhoto(sp, photos.photo)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1)) }
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, tripT0, cardTab, added, hidden, fleetOn, whalesOn, allTracks, photos.photo, mapView, mapReady, playing ? null : t])

  const pickShip = (r) => {
    setPickerOpen(false)
    fitRef.current = true
    setSel(r.id)
    if (!memberIds.has(r.id) && !added.some((a) => a.id === r.id)) setAdded((list) => [...list, { id: r.id, name: r.latest?.name?.value || null, periods: null }])
  }
  const pickBoat = (vid) => { fitRef.current = true; setTripT0(null); setSel(vid) }
  const togglePort = (name) => setHidden((h) => { const n = new Set(h); if (n.has(name)) n.delete(name); else n.add(name); return n })
  const removeAdded = (id) => { setAdded((list) => list.filter((a) => a.id !== id)); if (sel === id) setSel(null) }

  // The picked boat's trips, as a tab on its ship card (the card is where a ship's own detail lives, as on /ships).
  const tripsTab = sel ? { id: 'trips', label: trips.length ? `Trips · ${trips.length}` : 'Trips', content: (
    <div className={styles.wwTrips}>
                {!segsByVid[sel] ? <div className={styles.wwMuted}>Loading its tracks…</div>
                  : !trips.length ? <div className={styles.wwMuted}>No trips in these 12 months.</div>
                  : (
                    <ul className={styles.wwTripList}>
                      {trips.map((tr) => (
                        <li key={tr.t0}>
                          <button type="button" className={`${styles.wwTrip} ${shownTrip?.t0 === tr.t0 ? styles.wwTripOn : ''}`} onClick={() => pickTrip(tr)}
                            title="Show this trip and set the time slider to its start">
                            <span className={styles.wwTripWhen}>{fmtTripDay(tr.t0)} · {fmtTripTime(tr.t0)} – {fmtTripTime(tr.t1)}</span>
                            <span className={styles.wwTripMeta}>{fmtDur(tr.t1 - tr.t0)} · {tr.km < 10 ? tr.km.toFixed(1) : Math.round(tr.km)} km · {[...tr.sources].map((x) => SOURCE_WORDS[x] || x).join(' + ')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
  ) } : null

  if (!MAPBOX_TOKEN) return <div className={styles.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div>

  const boatsWithTracks = members.filter((m) => tracks[m.vessel_id]?.length).length
  const fleetSources = {
    heading: 'Whale-watching boat list',
    sources: [
      { name: 'Pacific Whale Watch Association, member companies', href: PWWA, publisher: 'Pacific Whale Watch Association',
        method: 'The list of companies. Each boat is tied to its company by one of the official records below, or where the company names the boat itself.' },
      { name: 'FCC Universal Licensing System, ship radio station licences', href: 'https://www.fcc.gov/wireless/systems-utilities/universal-licensing-system',
        publisher: 'U.S. Federal Communications Commission', licence: 'US government work (17 U.S.C. § 105)', licenceHref: 'https://www.law.cornell.edu/uscode/text/17/105',
        method: 'US boats: the company holding the boat’s ship radio license. The license holder is not stated to be the owner.' },
      { name: 'Transport Canada, Vessel Registration Query System', href: 'https://wwwapps.tc.gc.ca/Saf-Sec-Sur/4/vrqs-srib/eng/vessel-registrations/advanced-search',
        publisher: 'Transport Canada', licence: 'Open Government Licence – Canada', licenceHref: 'https://open.canada.ca/en/open-government-licence-canada',
        method: 'Canadian boats: the registered owner of the boat.' },
    ],
  }

  const liveSources = {
    heading: 'Live positions',
    sources: [
      { name: 'aisstream.io live AIS feed', href: AISSTREAM, publisher: 'AIS Stream',
        method: 'Boats’ AIS broadcasts as received by aisstream.io’s receiver network, relayed by EarthAtlas every minute. LIVE shows a boat at its newest report from the last 24 hours, with how long ago it was received.' },
    ],
  }

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}

      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home"><span className={styles.wordmark}>Earth<em>Atlas</em></span></a>
        <span className={styles.subBadge}>Whale Watch</span>
      </div>

      <MapSearch className={styles.searchBox}>
        <GeoSearch placeholder="Fly to a place…"
          proximity={() => { const m = mapRef.current; if (!m) return undefined; const c = m.getCenter(); return { lng: c.lng, lat: c.lat } }}
          onSelect={(r) => mapRef.current && flyToSearchResult(mapRef.current, r)} />
      </MapSearch>

      <ShipPicker shipName={sel ? nameOf(sel)?.split(' · ')[0] : null} query={query} onQuery={setQuery} kinds={kinds} onKinds={setKinds}
        onPick={pickShip} open={pickerOpen} onOpen={setPickerOpen}>
        {sel && (
          <VesselCard vesselId={sel} tab={cardTab} onTab={setCardTab} extraTabs={tripsTab ? [tripsTab] : []}
            onClose={() => { setSel(null); setTripT0(null) }} onSelectVessel={(id) => { setTripT0(null); setSel(id) }} />
        )}
      </ShipPicker>

      {mapReady && <ShareControl capture={captureShareImage} className={styles.shareCtl} />}
      <BasemapMenu basemap="satellite" photos={photos} className={styles.basemapMenu} />
      <ImageryLine photos={photos} mapRef={mapRef} raise={72} />   {/* above the time bar */}

      {startS != null && endS != null && (
        <WhaleTimeBar start={startS} end={endS} t={t} onT={setT} playing={playing} onPlaying={setPlaying} speed={speed} onSpeed={setSpeed}
          shifted={!isMobile} newestFix={endS}
          liveStatus={liveSnap ? `live AIS (aisstream.io) updated ${fmtClock(liveSnap.generated)}` : null} />
      )}

      <MapSheet id="whalewatch-panel" title="Whale-watching boats" summary={fleet ? `${members.length} boats` : ''} className={styles.panel} desktopCollapsible={false}>
        <div className={styles.panelHead}>
          <span className={styles.dockTitle}>Whale-watching boats</span>
          {pending > 0 && <span className={styles.countChip}><LoadingInline kind="quick" size={11} /> {pending}</span>}
        </div>
        <div className={`${styles.panelBody} ${styles.wwBody}`}>
          {win && (
            <div className={styles.wwWhen}>
              Tracks: {fmtMonth(win.from)} – {fmtMonth(win.newest)}{win.through ? <> (recorded positions through {fmtDay(win.through)})</> : null}
            </div>
          )}
          <div className={styles.wwWhen}>
            {liveSnap
              ? <>Live now: {liveNow} of {members.length} boats reported by AIS in the last hour · <a href={AISSTREAM} target="_blank" rel="noopener noreferrer">aisstream.io</a> live AIS, updated {fmtClock(liveSnap.generated)}</>
              : <>Live AIS not available right now; LIVE shows each boat’s newest position recorded by live AIS.</>}
          </div>
          <label className={`${styles.wwCheck} ${styles.wwAllTracks}`}>
            <input type="checkbox" checked={allTracks} onChange={() => setAllTracks((o) => !o)} />
            <span>Show all 12 months of tracks</span>
          </label>
          <DatasetRow storageKey="whalewatch.fleet" name="Whale-watching boats" sub={fleet ? `${members.length} boats, by home port` : 'loading…'}
            hue={FLEET_COLOR} on={fleetOn} onToggle={() => setFleetOn((o) => !o)}
            status={fleetError ? <div className={styles.wwMuted}>Could not load the boat list ({fleetError}).</div> : null}
            legend={<>
              <LegendSwatchRow swatch={<img alt="" width="12" height="18" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(boatSvg(LIVE_COLOR))}`} />}>Live: reported by AIS in the last 24 hours (<a href={AISSTREAM} target="_blank" rel="noopener noreferrer">aisstream.io</a>), with its last hour of travel</LegendSwatchRow>
              <LegendSwatchRow swatch={<img alt="" width="12" height="18" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(boatSvg(FLEET_COLOR))}`} />}>Not live now: its newest position recorded by live AIS since Oct 18, 2026, fainter the longer since it was last heard (in replay: where it was at the hour shown, with its last hour of travel). Boats not heard live since then are listed but not drawn.</LegendSwatchRow>
              <LegendSwatchRow swatch={<span className={styles.wwSwatch} style={{ background: PICK_COLOR }} />}>The boat whose card is open: the trip picked in its Trips tab</LegendSwatchRow>
            </>}
            info={<>
              The boats of the <a href={PWWA} target="_blank" rel="noopener noreferrer">Pacific Whale Watch Association</a>’s member companies.
              Each boat is tied to its company by an official record, linked beside the boat: the company holding its{' '}
              <a href="https://www.fcc.gov/wireless/systems-utilities/universal-licensing-system" target="_blank" rel="noopener noreferrer">FCC radio license</a> (US) or its
              registered owner at <a href="https://wwwapps.tc.gc.ca/Saf-Sec-Sur/4/vrqs-srib/eng/vessel-registrations/advanced-search" target="_blank" rel="noopener noreferrer">Transport Canada</a>.
              Tracks: <a href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener noreferrer">NOAA MarineCadastre AIS</a> (minute by minute) where
              NOAA has published the month, then <a href="https://globalfishingwatch.org/our-apis/" target="_blank" rel="noopener noreferrer">Global Fishing Watch</a> hourly
              positions (given to about 1 km, so shown in replay only), and from Oct 18, 2026 minute-by-minute live AIS recorded by EarthAtlas from{' '}
              <a href={AISSTREAM} target="_blank" rel="noopener noreferrer">aisstream.io</a>. Powered by Global Fishing Watch. {fleet && <>{boatsWithTracks} of {members.length} boats have tracks in these months.</>}
            </>} />

          <DatasetRow storageKey="whalewatch.whales" name="Whale reports" hue={WHALE_COLOR} on={whalesOn} onToggle={() => setWhalesOn((o) => !o)}
            sub={recentWhales.endMs != null ? `${t != null ? 'before the hour shown' : `last ${PATH_HOURS} hours`} · ${recentWhales.paths.length} path${recentWhales.paths.length === 1 ? '' : 's'}, ${recentWhales.groups.length} other report${recentWhales.groups.length === 1 ? '' : 's'}` : 'loading…'}
            status={recentWhales.error ? <div className={styles.wwMuted}>Could not load whale reports ({recentWhales.error}).</div> : null}
            legend={<>
              <LegendSwatchRow swatch={<span style={{ display: 'inline-block', width: 14, height: 3, borderRadius: 2, background: WHALE_COLOR, verticalAlign: 'middle' }} />}>Paths: reports of the same animals over the last {PATH_HOURS} hours joined in time order, a large dot at the newest. Fainter = older. Click for every report and its source.</LegendSwatchRow>
              <LegendSwatchRow swatch={<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: WHALE_COLOR, border: '1.5px solid #fff' }} />}>Other whales reported in the last {RECENT_HOURS} hours: size = whales seen, fainter = older.</LegendSwatchRow>
              <LegendSwatchRow swatch={<img alt="" width="12" height="18" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(boatSvg(LIVE_COLOR))}`} />}>Hover a live boat for its nearest whale report</LegendSwatchRow>
            </>}
            info={<>
              Whale, dolphin and porpoise reports with an exact time before the time shown, from the EarthAtlas whale database:{' '}
              <a href="https://www.whalealert.org" target="_blank" rel="noopener noreferrer">Whale Alert</a> (with <a href="https://www.orcanetwork.org" target="_blank" rel="noopener noreferrer">Orca Network</a> and its other channels),{' '}
              <a href="https://salishsea.io" target="_blank" rel="noopener noreferrer">SalishSea.io</a>, <a href="https://www.orcasound.net" target="_blank" rel="noopener noreferrer">Orcasound</a>,{' '}
              <a href="https://happywhale.com" target="_blank" rel="noopener noreferrer">HappyWhale</a> and <a href="https://www.inaturalist.org" target="_blank" rel="noopener noreferrer">iNaturalist</a>.
              The Salish Sea feeds are re-read every 10 minutes, and most reports reach the map within about half an hour of the sighting.
              Reports of the same animals are joined into a path: same species, each report a plausible swim from the one before (up to about 8 km an hour, 2 hours apart), and never two reports that name different animals (J27, T37A, BCY0324); reports naming the same animals join across up to 4 hours. Other reports of the same animals (same species, within 2 km and 2 hours) draw as one dot, counted once at the largest number given.
              {recentWhales.fetchedAt && <> Checked {fmtClock(recentWhales.fetchedAt)}.</>}
            </>} />

          {/* The boats, always listed (Josh 2026-10-17: the list was hidden behind the row's ⌄), grouped by home port. */}
          {fleetOn && (
            <div className={styles.wwListing}>
              <div className={styles.fieldLabel}>Boats by home port</div>
              <div className={styles.wwCompanies}>
                  <div className={styles.wwAllNone}>
                    <button type="button" className={styles.inlineLink} onClick={() => setHidden(new Set())}>Show all</button>{' · '}
                    <button type="button" className={styles.inlineLink} onClick={() => setHidden(new Set(groups.map((g) => g.name)))}>Hide all</button>
                  </div>
                  {groups.map((g) => {
                    const on = !hidden.has(g.name)
                    return (
                      <div key={g.name} className={styles.wwCompany}>
                        <div className={styles.wwCompanyRow}>
                          <label className={styles.wwCheck}>
                            <input type="checkbox" checked={on} onChange={() => togglePort(g.name)} />
                            <span>{g.name}</span>
                          </label>
                          <button type="button" className={styles.wwCount} onClick={() => setOpenCo((o) => (o === g.name ? null : g.name))}
                            aria-expanded={openCo === g.name} title="List the boats based here">
                            {g.boats.length} boat{g.boats.length === 1 ? '' : 's'} <Chevron up={openCo === g.name} size={13} />
                          </button>
                        </div>
                        {openCo === g.name && (
                          <ul className={styles.wwBoats}>
                            {g.portId != null && (
                              <li className={styles.wwPlace}>Port name: <a href={`/ships?pc=${g.portId}`} target="_blank" rel="noopener noreferrer">EarthAtlas Ships port</a></li>
                            )}
                            {g.boats.map((b) => {
                              const h = homes[b.vessel_id]
                              return (
                                <li key={b.vessel_id} className={`${styles.wwBoat} ${sel === b.vessel_id ? styles.wwBoatOn : ''}`}>
                                  <button type="button" className={styles.inlineLink} onClick={() => pickBoat(b.vessel_id)} title="Open this boat’s card">{b.name || `MMSI ${b.mmsi}`}</button>
                                  <span className={styles.wwMuted}> · {b.company}</span>
                                  <div className={styles.wwSrc}>
                                    <a href={b.source_url} target="_blank" rel="noopener noreferrer" title={b.source_label}>{BASIS_WORDS[b.basis] || 'Source'}</a>
                                    {b.note && <span> · {b.note}</span>}
                                  </div>
                                  {t == null && tracks[b.vessel_id] && !liveOf(b.vessel_id) && (
                                    <div className={styles.wwSrc}>{latestAis[b.vessel_id] ? `Last heard live ${fmtTripDay(latestAis[b.vessel_id].at)}` : 'Not heard live since Oct 18, 2026'}</div>
                                  )}
                                  <div className={styles.wwSrc}>
                                    {tracks[b.vessel_id] && !tracks[b.vessel_id].length ? 'No tracks in these 12 months'
                                      : h ? <>Home port from its AIS tracks: ended {h.nights} of its {h.days} days here{h.name ? '' : ` (no port we hold within 6 km of ${h.lngLat[1].toFixed(3)}, ${h.lngLat[0].toFixed(3)})`}</> : null}
                                  </div>
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    )
                  })}
                </div>
            </div>
          )}

          <div className={styles.wwAdded}>
            <div className={styles.fieldLabel}>Other boats</div>
            {added.length === 0
              ? <div className={styles.wwMuted}>Use the <strong>Ships</strong> search at the top to add any boat in EarthAtlas Ships to this map.</div>
              : (
                <ul className={styles.wwBoats}>
                  {added.map((a) => (
                    <li key={a.id} className={`${styles.wwBoat} ${sel === a.id ? styles.wwBoatOn : ''}`}>
                      
                      <button type="button" className={styles.inlineLink} onClick={() => pickBoat(a.id)}>{a.name || 'Loading…'}</button>
                      {tracks[a.id] && !tracks[a.id].length && <span className={styles.wwMuted}> · no tracks in these months</span>}
                      <button type="button" className={styles.wwRemove} onClick={() => removeAdded(a.id)} aria-label={`Remove ${a.name || 'this boat'} from the map`}>×</button>
                    </li>
                  ))}
                </ul>
              )}
          </div>

          <SourcesFooter intro="The whale-watching boats, how each was tied to its company, and where their tracks come from. Every boat in the list links its own record."
            sections={[fleetSources, liveSources, ...SHIPS_SOURCES.filter((s) => s.heading === 'Ship tracks' || s.heading === 'Ship identity')]}
            notes={SHIPS_SOURCES_NOTES} />
        </div>
      </MapSheet>
    </div>
  )
}
