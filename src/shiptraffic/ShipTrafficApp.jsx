/**
 * EarthAtlas Ship Traffic × Whales — /shiptraffic (rebuilt 2026-10-17, docs/WHALES_AND_SHIPTRAFFIC_PLAN.md).
 *
 * One left panel (the shared panel kit, src/components/panel/): the month picker on top drives everything,
 * then three datasets:
 *   - Ship traffic : /ships' track tiles — NOAA MarineCadastre (US-wide, months late) and Global Fishing Watch
 *                    hourly lines (everywhere else and every recent month, ~4 days behind). Yellow, by kind.
 *   - Whale reports: our whale database (/api/whales — Whale Alert/Orca Network, SalishSea.io, Orcasound,
 *                    HappyWhale, iNaturalist, OBIS), magenta dots; hydrophone detections as rings. Each popup
 *                    lists the ships that passed within 1 km (close passes, baked daily).
 *   - Overlap      : ships × whale reports per ~1 km cell over the picked months (scripts/shiptraffic/
 *                    overlap-bake.mjs), a red heatmap scaled to what's in view.
 * Everything a reader sees carries its own source inline; the "How this is sourced" rollup lists them all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { keepPopupOnMap } from '../lib/popupFit.js'
import { ensureWebGLSupport } from '../utils/webglSupport'
import 'mapbox-gl/dist/mapbox-gl.css'
import GeoSearch from '../components/GeoSearch.jsx'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import MapSheet from '../components/MapSheet.jsx'
import { DatasetRow, LegendSwatchRow, SourcesFooter, Loading, SITE_RUNS_NOTE } from '../components/panel/index.js'
import TrackMonths, { TRACK_KINDS, fmtMonth } from '../ships/TrackControls.jsx'
import shipsStyles from '../ships/ShipsApp.module.css'
import trackSource from '../ships/trackSource.json'
import WhaleReports from '../components/WhaleReports.jsx'
import { fetchWhales, whaleCredit, whaleName, whaleSourceLabel, whalePhoto, whaleLinkLabel, WHALE_SOURCES } from '../lib/whales.js'
import { locationRadiusM, whalesIn, groupSightings, nearPoints, APPROX_M } from '../../lib/whales/precision.js'
import {
  OVERLAP_INDEX_URL, FIRST_MONTH, SHIP_COLOR, WHALE_COLOR, OVERLAP_COLOR, OVERLAP_HEATMAP_RAMP, KIND_LABELS,
  fmtDay, dateSpan, aggregateOverlap, overlapPointsInView, overlapBand,
} from './shiptrafficData.js'
import styles from './ShipTrafficApp.module.css'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-123.45, 48.1], zoom: 7.7 }
const MONTH_CAP = 12 // each month is its own tile source (same cap as /ships)
const TILES_BASE = typeof window !== 'undefined' ? window.location.origin : ''
const DEV = import.meta.env.DEV ? '&dev=1' : ''

// /ships' track tiles (api/ship-tracks.js). b / stamp = the month's build, so a rebuilt month gets new tile URLs.
const usTileUrl = (ym, stamp) => `${TILES_BASE}/api/ship-tracks?r=us&t=${ym}&v=${trackSource.us.rules}${stamp ? `.${stamp}` : ''}${DEV}&z={z}&x={x}&y={y}`
const gfwTileUrl = (ym, built) => `${TILES_BASE}/api/ship-tracks?r=gfw&t=${ym}&v=${trackSource.gfw.rules}${built ? `&b=${encodeURIComponent(built)}` : ''}${DEV}&z={z}&x={x}&y={y}`
// The detailed Salish tracks (/ships' monthly NOAA bake, 2025-01 on): the US-wide tiles leave the Salish box out for
// those months, so without these the Salish Sea would be empty of NOAA tracks.
const salishTileUrl = (ym) => `${TILES_BASE}/api/ship-tracks?t=${ym}&v=${trackSource.version}${DEV}&z={z}&x={x}&y={y}`
const usSrc = (ym) => `st-us-${ym}`
const gfwSrc = (ym) => `st-gfw-${ym}`
const salSrc = (ym) => `st-sal-${ym}`
const shipLayers = (ym) => [`${usSrc(ym)}-line`, `${salSrc(ym)}-line`, `${gfwSrc(ym)}-obs`, `${gfwSrc(ym)}-est`]
const SHIP_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 0.35, 10, 0.8, 14, 1.5]
const NOAA_ATTR = 'Ship tracks: <a href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener">MarineCadastre AIS</a> (NOAA / BOEM / USCG)'
const GFW_ATTR = 'Ship tracks outside NOAA coverage: <a href="https://globalfishingwatch.org" target="_blank" rel="noopener">Powered by Global Fishing Watch</a>'

const WHALE_SRC = 'st-whales'
const WHALE_LAYER = 'st-whales-pts'
const WHALE_COUNT_LAYER = 'st-whales-count'
const OVERLAP_SRC = 'st-overlap'
const OVERLAP_LAYER = 'st-overlap-heat'
const EMPTY_FC = { type: 'FeatureCollection', features: [] }

const BASEMAPS = [
  { id: 'satellite', label: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'dark', label: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'light', label: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
  { id: 'streets', label: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
]
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]).style
const ALL_KINDS = TRACK_KINDS.map(([k]) => k)

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

function sampleEvenly(arr, cap) {
  if (arr.length <= cap) return arr.slice()
  const out = []
  const step = (arr.length - 1) / (cap - 1)
  for (let i = 0; i < cap; i++) out.push(arr[Math.round(i * step)])
  return [...new Set(out)]
}

// ─── Shareable URL state (docs/MAP_TOOL_CONVENTIONS.md) ─────────────────────
function readUrlState() {
  if (typeof window === 'undefined') return {}
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }
  const [a, b] = (sp.get('tm') || '').split('_')
  const ok = (m) => /^\d{4}-\d{2}$/.test(m || '')
  return {
    tm: ok(a) ? [a, ok(b) ? b : a].sort() : null,
    ly: sp.get('ly'),
    tk: sp.get('tk'),
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

const SOURCES = [
  {
    heading: 'Ship traffic',
    sources: [
      { name: 'MarineCadastre AIS vessel traffic', href: 'https://hub.marinecadastre.gov/pages/vesseltraffic', publisher: 'NOAA Office for Coastal Management, BOEM, U.S. Coast Guard', licence: 'Public domain',
        method: 'Ship tracks for US waters, published months after the fact; the same tracks /ships draws.' },
      { name: 'Global Fishing Watch AIS (hourly positions)', href: 'https://globalfishingwatch.org', publisher: 'Global Fishing Watch', licence: 'CC BY-NC 4.0', licenceHref: 'https://creativecommons.org/licenses/by-nc/4.0/',
        method: 'Hourly ship positions joined into tracks for Canadian waters and every month NOAA has not published yet, about 4 days behind. Dashed = our estimated path along the water between two positions. Powered by Global Fishing Watch.' },
    ],
  },
  {
    heading: 'Whale reports',
    sources: Object.entries(WHALE_SOURCES).map(([id, w]) => ({
      name: w.label, href: w.url, publisher: w.publisher, licence: w.license || 'See each report',
      method: id === 'maplify' ? 'Whale Alert and its partner channels (Orca Network, Ocean Wise WhaleReport, NOAA right whale reports and others), via the Acartia data cooperative.'
        : id === 'orcasound' ? 'Hydrophone detections ("heard, not seen"), via SalishSea.io.'
        : id === 'obis' ? 'Human sightings from research surveys (no acoustic or tag records; OBIS copies of HappyWhale and iNaturalist left out).'
        : id === 'inaturalist' ? 'Observations their observers licensed for reuse; obscured locations stay obscured.'
        : 'Reports refreshed hourly into the EarthAtlas whale database; each report is shown once.',
    })),
  },
]
const NOTES = [
  { heading: 'Overlap', body: 'For each ~1 km square: the ships of the picked kinds that crossed it in the picked months (scaled to the busiest square), times the whales seen in it (scaled to the square with the most). Whales, not reports: several people reporting one group (same species, same day, within 2 km and 2 hours) count once, at the largest number anyone gave; every whale HappyWhale identified counts; a report placed only roughly (rounded to 0.1°) counts its whales across the whole ~10 km area it could be in, scored against the busiest such area, and very vague ones (over 10 km) are left out. A co-occurrence measure for exploring, not a ship-strike risk model.' },
  { heading: 'Close passes', body: 'A ship counts as passing a whale report when it was within 1 km of the report within 3 hours of it (reports with only a date: the same day). Only where ships were actually reported counts: estimated paths never do, and where two reported positions are more than 2 km apart (Global Fishing Watch positions are hourly), only those positions count, not the line between them. Recomputed daily.' },
  { heading: 'Caveats', body: 'Whale reports follow where people look and listen. Ships without AIS, or with it switched off, are not here. NOAA covers US waters; Canadian waters come from Global Fishing Watch and are fuller in recent months.' },
  SITE_RUNS_NOTE,
]

export default function ShipTrafficApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const initial = useMemo(() => readUrlState(), [])
  const initialCamera = (Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z))
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null
  const [mapReady, setMapReady] = useState(false)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  // ─── Month lists (from /ships' Blob indexes) + the overlap index ────────────
  const [usIdx, setUsIdx] = useState(null)
  const [gfwIdx, setGfwIdx] = useState(null)
  const [overlapIdx, setOverlapIdx] = useState(null)
  const [salishMonths, setSalishMonths] = useState(trackSource.months || [])
  useEffect(() => {
    fetch('/api/ship-tracks?op=salishindex').then((r) => (r.ok ? r.json() : null))
      .then((j) => { const ms = Object.keys(j?.months || {}).sort(); if (ms.length) setSalishMonths(ms) }).catch(() => {})
  }, [])
  useEffect(() => {
    const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    get(trackSource.us.index).then((j) => setUsIdx(j?.months || {}))
    get(trackSource.gfw.index).then((j) => setGfwIdx(j || { months: {} }))
    // Dev builds fall back to a local bake (scripts/shiptraffic/overlap-bake.mjs --out public/dev-data/shiptraffic/overlap-v1
    // --no-publish, then write its index.json) so the layer can be checked before production has baked anything.
    // ?ovl=local (dev only) forces the local bake, to check a changed overlap job before it publishes.
    const forceLocal = import.meta.env.DEV && new URLSearchParams(window.location.search).get('ovl') === 'local'
    ;(forceLocal ? Promise.resolve(null) : get(OVERLAP_INDEX_URL)).then((j) => (j || !import.meta.env.DEV ? j : get('/dev-data/shiptraffic/overlap-v1/index.json')))
      .then((j) => setOverlapIdx(j || { months: {} }))
  }, [])
  const months = useMemo(() => {
    if (!usIdx || !gfwIdx) return []
    return [...new Set([...Object.keys(usIdx), ...Object.keys(gfwIdx.months || {})])].filter((m) => m >= FIRST_MONTH).sort()
  }, [usIdx, gfwIdx])
  const gfwThrough = gfwIdx?.fetched_through || null

  // ─── Picks (URL state) ──────────────────────────────────────────────────
  const [sel, setSel] = useState(initial.tm) // [fromYm, toYm]; null = the latest month
  const [visible, setVisible] = useState(() => {
    const ly = initial.ly
    return ly ? { ships: ly.includes('s'), whales: ly.includes('w'), overlap: ly.includes('o') } : { ships: true, whales: true, overlap: true }
  })
  const [kinds, setKinds] = useState(() => {
    const tk = (initial.tk || '').split(',').filter((k) => ALL_KINDS.includes(k))
    return tk.length ? tk : []
  }) // [] = every kind
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : 'satellite'))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [mapView, setMapView] = useState(initialCamera || { lat: DEFAULT_VIEW.center[1], lng: DEFAULT_VIEW.center[0], zoom: DEFAULT_VIEW.zoom })

  const range = useMemo(() => {
    if (!months.length) return null
    const last = months.length - 1
    if (!sel) return [last, last]
    const a = months.indexOf(sel[0]), b = months.indexOf(sel[1])
    if (a < 0 || b < 0) return [last, last]
    return [a, Math.max(a, b)]
  }, [months, sel])
  const pickedMonths = useMemo(() => {
    if (!range) return []
    const span = months.slice(range[0], range[1] + 1)
    return span.length > MONTH_CAP ? span.slice(-MONTH_CAP) : span
  }, [months, range])
  const span = useMemo(() => (pickedMonths.length ? dateSpan(pickedMonths[0], pickedMonths[pickedMonths.length - 1]) : null), [pickedMonths])
  const kindsActive = kinds.length ? kinds : ALL_KINDS

  // ─── Map init ───────────────────────────────────────────────────────────
  const whalesRef = useRef([])
  const stackRef = useRef(new Map()) // dot key → indices into whalesRef of the reports it holds
  const groupsAtRef = useRef(new Map()) // dot key → the whale groups it holds (lib/whales/precision.js groupSightings)
  const overlapRef = useRef(null)
  if (import.meta.env.DEV && typeof window !== 'undefined') window.__st = { mapRef, whalesRef, overlapRef } // dev-only QA handle
  const closeCacheRef = useRef(new Map()) // month → Promise<closepasses json|null>
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current || mapRef.current) return
    if (!ensureWebGLSupport(containerRef.current)) return
    mapboxgl.accessToken = MAPBOX_TOKEN
    const start = initialCamera
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: basemapStyleFor(basemap),
      center: start ? [start.lng, start.lat] : DEFAULT_VIEW.center,
      zoom: start ? start.zoom : DEFAULT_VIEW.zoom,
    })
    mapRef.current = map
    map.on('error', (e) => {
      const msg = e?.error?.message || ''
      if (e?.sourceId?.startsWith('st-') || /tile/i.test(msg)) return
      console.warn('[shiptraffic] map error', e?.error || e) // eslint-disable-line no-console
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('moveend', () => {
      const c = map.getCenter()
      setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() })
    })
    map.on('style.load', () => {
      if (!map.getSource(OVERLAP_SRC)) {
        map.addSource(OVERLAP_SRC, { type: 'geojson', data: EMPTY_FC })
        map.addLayer({ id: OVERLAP_LAYER, type: 'heatmap', source: OVERLAP_SRC, paint: {
          // Squares' blurs overlap (~1.2 squares wide), so they add up into one connected surface: intensity drops as
          // the overlap grows, and the weight curve lifts the middle so a shore strip reads as one patch, not one hot dot.
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'w'], 0, 0, 0.1, 0.3, 0.3, 0.6, 1, 1],
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 6, 1.1, 10, 1.2, 12, 1.5, 18, 1.5],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], ...OVERLAP_HEATMAP_RAMP],
          // Past z11 the blur is ~1.2 squares wide and doubles per zoom, so neighboring ~1 km squares merge into one
          // patch at every zoom (it stopped at 48 px: a polka-dot grid at z13, a small dot at z15).
          'heatmap-radius': ['interpolate', ['exponential', 2], ['zoom'], 6, 14, 9, 30, 11, 64, 12, 128, 13, 256, 18, 8192],
          'heatmap-opacity': 0.85,
        } })
      }
      if (!map.getSource(WHALE_SRC)) {
        map.addSource(WHALE_SRC, { type: 'geojson', data: EMPTY_FC })
        map.addLayer({ id: WHALE_LAYER, type: 'circle', source: WHALE_SRC, paint: {
          // Dot size = whales seen at this spot (w, grouped; √ so 100 whales isn't 100× a single one), labelled with the number.
          'circle-radius': ['interpolate', ['linear'], ['zoom'],
            7, ['+', 2.5, ['min', 7, ['*', 1.1, ['-', ['sqrt', ['get', 'w']], 1]]]],
            11, ['+', 5, ['min', 10, ['*', 1.6, ['-', ['sqrt', ['get', 'w']], 1]]]],
            16, ['+', 11, ['min', 14, ['*', 2.2, ['-', ['sqrt', ['get', 'w']], 1]]]]],
          // Seen = filled dot; heard on a hydrophone = ring.
          'circle-color': ['case', ['==', ['get', 'kind'], 'acoustic'], 'rgba(0,0,0,0)', WHALE_COLOR],
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.75, 12, 0.9],
          // A zoom curve must be the OUTERMOST expression (Mapbox drops the whole layer otherwise), so the case sits in its stops.
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 9, ['case', ['==', ['get', 'kind'], 'acoustic'], 2, 0.4], 13, ['case', ['==', ['get', 'kind'], 'acoustic'], 2, 1]],
          'circle-stroke-color': ['case', ['==', ['get', 'kind'], 'acoustic'], WHALE_COLOR, 'rgba(255,255,255,0.55)'],
        } })
        map.addLayer({ id: WHALE_COUNT_LAYER, type: 'symbol', source: WHALE_SRC, filter: ['>', ['get', 'w'], 1], minzoom: 8,
          layout: { 'text-field': ['to-string', ['get', 'w']], 'text-size': 10, 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-allow-overlap': true },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(80,7,36,0.8)', 'text-halo-width': 1 } })
      }
      setMapReady(true)
    })
    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Ship tracks: one source per picked month (NOAA and/or GFW), sampled to the cap ─────
  const addedRef = useRef(new Set())
  const shipMonths = useMemo(() => sampleEvenly(pickedMonths, MONTH_CAP), [pickedMonths])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !usIdx || !gfwIdx || !map.style?._loaded) return
    const opacity = Math.max(0.08, 0.7 / Math.sqrt(Math.max(1, shipMonths.length))) // the /ships + old /shiptraffic rule
    const kindFilter = kinds.length ? ['in', ['get', 'kind'], ['literal', kinds]] : null
    for (const ym of [...addedRef.current]) {
      if (shipMonths.includes(ym) && (map.getSource(usSrc(ym)) || map.getSource(gfwSrc(ym)) || map.getSource(salSrc(ym)))) continue
      for (const l of shipLayers(ym)) if (map.getLayer(l)) map.removeLayer(l)
      for (const s of [usSrc(ym), gfwSrc(ym), salSrc(ym)]) if (map.getSource(s)) map.removeSource(s)
      addedRef.current.delete(ym)
    }
    const below = map.getLayer(OVERLAP_LAYER) ? OVERLAP_LAYER : undefined
    for (const ym of shipMonths) {
      const us = usIdx[ym]
      const gfw = gfwIdx.months?.[ym]
      if (us && !map.getSource(usSrc(ym))) {
        const stamp = us.classes?.rules ? us.classes.rules.replace(/^.*-(cls\d+)$/, '$1') : null
        map.addSource(usSrc(ym), { type: 'vector', tiles: [usTileUrl(ym, stamp)], minzoom: trackSource.us.minzoom, maxzoom: trackSource.us.maxzoom, attribution: NOAA_ATTR })
        map.addLayer({ id: `${usSrc(ym)}-line`, type: 'line', source: usSrc(ym), 'source-layer': trackSource.us.sourceLayer,
          layout: { 'line-join': 'round' }, paint: { 'line-color': SHIP_COLOR, 'line-width': SHIP_WIDTH, 'line-blur': 0.6, 'line-opacity': opacity } }, below)
        addedRef.current.add(ym)
      }
      if (salishMonths.includes(ym) && !map.getSource(salSrc(ym))) {
        map.addSource(salSrc(ym), { type: 'vector', tiles: [salishTileUrl(ym)], minzoom: 5, maxzoom: 10, bounds: trackSource.bbox, attribution: NOAA_ATTR })
        map.addLayer({ id: `${salSrc(ym)}-line`, type: 'line', source: salSrc(ym), 'source-layer': trackSource.sourceLayer,
          layout: { 'line-join': 'round' }, paint: { 'line-color': SHIP_COLOR, 'line-width': SHIP_WIDTH, 'line-blur': 0.6, 'line-opacity': opacity } }, below)
        addedRef.current.add(ym)
      }
      if (gfw && !map.getSource(gfwSrc(ym))) {
        map.addSource(gfwSrc(ym), { type: 'vector', tiles: [gfwTileUrl(ym, gfw.built)], minzoom: trackSource.gfw.minzoom, maxzoom: trackSource.gfw.maxzoom, attribution: GFW_ATTR })
        map.addLayer({ id: `${gfwSrc(ym)}-obs`, type: 'line', source: gfwSrc(ym), 'source-layer': trackSource.gfw.sourceLayer,
          layout: { 'line-join': 'round' }, paint: { 'line-color': SHIP_COLOR, 'line-width': SHIP_WIDTH, 'line-blur': 0.6, 'line-opacity': opacity } }, below)
        map.addLayer({ id: `${gfwSrc(ym)}-est`, type: 'line', source: gfwSrc(ym), 'source-layer': trackSource.gfw.sourceLayer,
          paint: { 'line-color': SHIP_COLOR, 'line-width': SHIP_WIDTH, 'line-opacity': opacity * 0.65, 'line-dasharray': [2, 2] } }, below)
        addedRef.current.add(ym)
      }
      const vis = visible.ships ? 'visible' : 'none'
      for (const l of [`${usSrc(ym)}-line`, `${salSrc(ym)}-line`]) {
        if (!map.getLayer(l)) continue
        map.setFilter(l, kindFilter)
        map.setLayoutProperty(l, 'visibility', vis)
        map.setPaintProperty(l, 'line-opacity', opacity)
      }
      for (const [l, est] of [[`${gfwSrc(ym)}-obs`, false], [`${gfwSrc(ym)}-est`, true]]) {
        if (!map.getLayer(l)) continue
        map.setFilter(l, ['all', est ? ['==', ['get', 'est'], 1] : ['!=', ['get', 'est'], 1], kindFilter || true])
        map.setLayoutProperty(l, 'visibility', vis)
        map.setPaintProperty(l, 'line-opacity', est ? opacity * 0.65 : opacity)
      }
    }
  }, [mapReady, usIdx, gfwIdx, salishMonths, shipMonths, kinds, visible.ships])

  // ─── Whale reports (our database) for the view + picked dates ──────────────
  const [whales, setWhales] = useState(null) // { sightings, sources, updated, truncated } for the current view
  const [whalesErr, setWhalesErr] = useState(null)
  const viewBoundsRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !span || !visible.whales) return
    const b = map.getBounds()
    const bounds = { minLat: Math.max(-90, b.getSouth()), maxLat: Math.min(90, b.getNorth()), minLng: Math.max(-180, b.getWest()), maxLng: Math.min(180, b.getEast()) }
    viewBoundsRef.current = bounds
    const ctl = new AbortController()
    setWhalesErr(null)
    fetchWhales({ bounds, from: span.from, to: span.to, limit: 2000, signal: ctl.signal })
      .then((j) => setWhales(j))
      .catch((e) => { if (e.name !== 'AbortError') setWhalesErr('Whale reports could not be loaded.') })
    return () => ctl.abort()
  }, [mapReady, span, visible.whales, mapView.lat, mapView.lng, mapView.zoom])

  const whalesInView = useMemo(() => {
    const b = mapRef.current?.getBounds()
    if (!whales?.sightings || !b) return []
    return whales.sightings.filter((w) => w.lat >= b.getSouth() && w.lat <= b.getNorth() && w.lng >= b.getWest() && w.lng <= b.getEast())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whales, mapView])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const list = whales?.sightings || []
    whalesRef.current = list
    // One dot per GROUP of animals, the same rule as the overlap score (lib/whales/precision.js): reports of the same
    // species, same day, within 2 km and 2 h are one group (one pod watched from four spots on Lime Kiln is one dot of
    // 27, not four), drawn at its most recent report. Groups that land on exactly the same spot (a shore viewpoint
    // across days, a HappyWhale uploader's rounded position) share one dot. Dot size + number = whales seen.
    const indexOf = new Map(list.map((w, i) => [w, i]))
    const time = (w) => String(w.observed_at || w.observed_date)
    const stacks = new Map() // "lat,lng" → { idx: [report indices], groups: [{ whales, species, members }] }
    for (const g of groupSightings(list)) {
      // Drawn where the animals were: the latest report that gave the group's number. Not simply the latest report —
      // shore stations (e.g. SMRU Consulting at Lime Kiln lighthouse) log every 20 min at the station's own position
      // with no count, which put a pod of 27 on land.
      const counted = g.members.filter((m) => whalesIn(m) === g.whales)
      const pool = counted.length ? counted : g.members
      const lead = pool.reduce((a, b) => (time(b) > time(a) ? b : a), pool[0])
      const k = `${lead.lat.toFixed(5)},${lead.lng.toFixed(5)}`
      if (!stacks.has(k)) stacks.set(k, { idx: [], groups: [], at: lead })
      const st = stacks.get(k)
      st.groups.push(g)
      for (const m of g.members) st.idx.push(indexOf.get(m))
    }
    stackRef.current = new Map([...stacks.entries()].map(([k, st]) => [k, st.idx]))
    groupsAtRef.current = new Map([...stacks.entries()].map(([k, st]) => [k, st.groups]))
    map.getSource(WHALE_SRC)?.setData({
      type: 'FeatureCollection',
      features: [...stacks.entries()].map(([k, st]) => ({ type: 'Feature',
        properties: { k, i: st.idx[0], n: st.idx.length, w: st.groups.reduce((a, g) => a + g.whales, 0),
          kind: st.idx.every((i) => list[i].kind === 'acoustic') ? 'acoustic' : 'sighting' },
        geometry: { type: 'Point', coordinates: [st.at.lng, st.at.lat] } })),
    })
    for (const l of [WHALE_LAYER, WHALE_COUNT_LAYER]) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', visible.whales ? 'visible' : 'none')
  }, [whales, visible.whales, mapReady])

  // ─── Overlap: the picked months' baked grids ───────────────────────────────
  const gridCacheRef = useRef(new Map())
  const [grids, setGrids] = useState(null)
  useEffect(() => {
    if (!overlapIdx || !pickedMonths.length) return
    let dead = false
    const entries = pickedMonths.map((m) => [m, overlapIdx.months?.[m]]).filter(([, e]) => e?.grid)
    Promise.all(entries.map(([m, e]) => {
      const key = `${m}|${e.built}`
      if (!gridCacheRef.current.has(key)) {
        gridCacheRef.current.set(key, fetch(`${e.grid}?b=${encodeURIComponent(e.built)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
      }
      return gridCacheRef.current.get(key)
    })).then((gs) => { if (!dead) setGrids(gs.filter(Boolean)) })
    return () => { dead = true }
  }, [overlapIdx, pickedMonths])
  const overlap = useMemo(() => (grids ? aggregateOverlap(grids, kindsActive) : null), [grids, kindsActive])
  const overlapMonths = grids?.length || 0
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    overlapRef.current = overlap
    const b = map.getBounds()
    map.getSource(OVERLAP_SRC)?.setData(overlap ? overlapPointsInView(overlap.cells, { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }) : EMPTY_FC)
    if (map.getLayer(OVERLAP_LAYER)) map.setLayoutProperty(OVERLAP_LAYER, 'visibility', visible.overlap ? 'visible' : 'none')
  }, [overlap, visible.overlap, mapReady, mapView])

  // ─── Clicks: a whale report (with its close passes), else an overlap square ─
  const closePassesFor = useCallback((w) => {
    const ym = String(w.observed_date || '').slice(0, 7)
    const e = overlapIdx?.months?.[ym]
    if (!e?.closepasses) return Promise.resolve(null)
    const key = `${ym}|${e.built}`
    if (!closeCacheRef.current.has(key)) {
      closeCacheRef.current.set(key, fetch(`${e.closepasses}?b=${encodeURIComponent(e.built)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null))
    }
    return closeCacheRef.current.get(key).then((j) => (j ? { rule: j.rule, ships: j.whales?.[w.id] || [] } : null))
  }, [overlapIdx])

  const showWhalePopup = useCallback((w, lngLat) => {
    const map = mapRef.current
    if (!map) return
    popupRef.current?.remove()
    const popup = new mapboxgl.Popup({ offset: 8, maxWidth: '300px' }).setLngLat(lngLat || [w.lng, w.lat]).setHTML(whalePopupHTML(w, undefined)).addTo(map)
    popupRef.current = keepPopupOnMap(popup)
    closePassesFor(w).then((cp) => { if (popupRef.current === popup) popup.setHTML(whalePopupHTML(w, cp)) })
  }, [closePassesFor])

  // Several reports at one spot: a list (newest first); clicking one opens its own card.
  const showStackPopup = useCallback((groups, lngLat) => {
    const map = mapRef.current
    if (!map) return
    popupRef.current?.remove()
    const t = (w) => String(w.observed_at || w.observed_date)
    const ordered = [...groups].sort((a, b) => t(b.members[b.members.length - 1]).localeCompare(t(a.members[a.members.length - 1])))
    const sorted = ordered.flatMap((g) => [...g.members].sort((a, b) => t(b).localeCompare(t(a))))
    const popup = new mapboxgl.Popup({ offset: 8, maxWidth: '310px' }).setLngLat(lngLat).setHTML(stackPopupHTML(ordered, sorted)).addTo(map)
    popupRef.current = keepPopupOnMap(popup)
    popup.getElement()?.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-stack-i]')
      if (row) showWhalePopup(sorted[Number(row.dataset.stackI)], lngLat)
    })
  }, [showWhalePopup])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const onClick = (e) => {
      const hit = map.getLayer(WHALE_LAYER) ? map.queryRenderedFeatures(e.point, { layers: [WHALE_LAYER] })[0] : null
      if (hit) {
        const idx = stackRef.current.get(hit.properties.k) || [hit.properties.i]
        if (idx.length === 1) { const w = whalesRef.current[idx[0]]; if (w) showWhalePopup(w, e.lngLat); return }
        showStackPopup(groupsAtRef.current.get(hit.properties.k) || [], e.lngLat)
        return
      }
      const ov = overlapRef.current
      if (!ov || !visible.overlap) return
      const { lngStep, latStep } = ov.cell || {}
      const c = ov.cells.find((x) => Math.abs(e.lngLat.lng - x.lng) <= lngStep / 2 && Math.abs(e.lngLat.lat - x.lat) <= latStep / 2)
      if (!c) return
      popupRef.current?.remove()
      popupRef.current = keepPopupOnMap(new mapboxgl.Popup({ offset: 8, maxWidth: '300px' }).setLngLat(e.lngLat).setHTML(cellPopupHTML(c, pickedMonths, groupsCovering(grids || [], c))).addTo(map))
    }
    const onMove = (e) => {
      const over = map.getLayer(WHALE_LAYER) && map.queryRenderedFeatures(e.point, { layers: [WHALE_LAYER] }).length
      map.getCanvas().style.cursor = over ? 'pointer' : ''
    }
    map.on('click', onClick)
    map.on('mousemove', onMove)
    return () => { map.off('click', onClick); map.off('mousemove', onMove) }
  }, [mapReady, showWhalePopup, showStackPopup, visible.overlap, pickedMonths, grids])

  // ─── URL + share card ────────────────────────────────────────────────────
  useEffect(() => {
    if (!months.length) return
    const sp = new URLSearchParams()
    if (sel) sp.set('tm', sel[0] === sel[1] ? sel[0] : `${sel[0]}_${sel[1]}`)
    const ly = [visible.ships && 's', visible.whales && 'w', visible.overlap && 'o'].filter(Boolean).join('')
    if (ly !== 'swo') sp.set('ly', ly || '-')
    if (kinds.length) sp.set('tk', kinds.join(','))
    if (basemap !== 'satellite') sp.set('bm', basemap)
    sp.set('lat', mapView.lat.toFixed(3)); sp.set('lng', mapView.lng.toFixed(3)); sp.set('z', mapView.zoom.toFixed(1))
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('ovl') === 'local') sp.set('ovl', 'local') // keep the dev flag
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months.length, sel, visible, kinds, basemap, mapView, mapReady])

  // ─── Basemap ─────────────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    setMapReady(false)
    addedRef.current.clear()
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
    document.title = 'Ship Traffic & Whales — Salish Sea · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  if (!MAPBOX_TOKEN) {
    return <div className={styles.container}><div className={styles.tokenError}><strong>Mapbox token missing.</strong> Set <code>VITE_MAPBOX_TOKEN</code> to load the map.</div></div>
  }

  const latestYm = months[months.length - 1]
  const pickedLast = pickedMonths[pickedMonths.length - 1]
  const shipsThrough = pickedLast && gfwIdx?.months?.[pickedLast] && pickedLast === latestYm && gfwThrough ? gfwThrough : null
  const whaleUpdated = whales?.updated ? Object.values(whales.updated).filter(Boolean).sort().pop() : null
  const minsAgo = whaleUpdated ? Math.max(0, Math.round((Date.now() - Date.parse(whaleUpdated)) / 60000)) : null
  const kindChip = (k, label) => (
    <button key={k} type="button" className={kinds.includes(k) ? shipsStyles.chipTrack : shipsStyles.chip}
      onClick={() => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))}>{label}</button>
  )
  const reportSources = [...new Set(whalesInView.map((w) => whaleSourceLabel(w)))]

  return (
    <div className={styles.container}>
      <div className={styles.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={styles.shareCtl} />}

      <div className={styles.branding}>
        <a className={styles.brandingLink} href="/" aria-label="EarthAtlas home"><span className={styles.wordmark}>Earth<em>Atlas</em></span></a>
        <span className={styles.subBadge}>Ship Traffic × Whales</span>
      </div>

      <div className={styles.searchBox}>
        <GeoSearch
          placeholder="Search a place…"
          proximity={() => { const m = mapRef.current; if (!m) return undefined; try { const c = m.getCenter(); return { lng: c.lng, lat: c.lat } } catch { return undefined } }}
          onSelect={(r) => flyToSearchResult(mapRef.current, r)}
        />
      </div>

      <div className={styles.basemapMenu} ref={basemapMenuRef}>
        <button className={basemapMenuOpen ? styles.basemapToggleActive : styles.basemapToggle} onClick={() => setBasemapMenuOpen((o) => !o)} aria-label="Choose basemap" title="Basemap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={styles.basemapMenuPanel}>
            <div className={styles.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button key={b.id} className={b.id === basemap ? styles.basemapMenuItemActive : styles.basemapMenuItem} onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}>
                <span className={styles.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={styles.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <MapSheet title="Ship traffic × whales" className={styles.panel}>
        <div className={styles.panelHead}><span className={styles.panelTitle}>Ship traffic × whales</span></div>
        <div className={styles.panelBody}>
          {!range ? <Loading>Loading months…</Loading> : (
            <>
              <div className={shipsStyles.panelWhen}>
                <TrackMonths months={months} range={range} styles={shipsStyles} cap={MONTH_CAP}
                  onRange={([a, b]) => { const s = [months[a], months[b]]; setSel(a === months.length - 1 && b === a ? null : s) }} />
                <div className={styles.freshness}>
                  {shipsThrough ? `Ships through ${fmtDay(shipsThrough)}` : `Ships: ${fmtMonth(pickedMonths[0])}${pickedMonths.length > 1 ? ` – ${fmtMonth(pickedLast)}` : ''}`}
                  {minsAgo != null && ` · whale reports updated ${minsAgo < 90 ? `${minsAgo} min` : `${Math.round(minsAgo / 60)} h`} ago`}
                </div>
              </div>

              <DatasetRow storageKey="shiptraffic.ships" name="Ship traffic" sub={kinds.length ? kinds.map((k) => KIND_LABELS[k]).join(', ') : 'every kind'}
                hue={SHIP_COLOR} icon={<ShipIcon />} on={visible.ships} onToggle={() => setVisible((v) => ({ ...v, ships: !v.ships }))}
                controls={<div>
                  <div className={shipsStyles.fieldLabel}>Kind of ship</div>
                  <div className={shipsStyles.chipRow}>
                    <button type="button" className={!kinds.length ? shipsStyles.chipTrack : shipsStyles.chip} onClick={() => setKinds([])}>Every kind</button>
                    {TRACK_KINDS.map(([k, label]) => kindChip(k, label))}
                  </div>
                </div>}
                legend={<LegendSwatchRow swatch={<span style={{ display: 'inline-block', width: 18, height: 2, background: SHIP_COLOR }} />}>Brighter = busier; dashed = estimated path</LegendSwatchRow>}
                info={<>Ship tracks from AIS: <a className={shipsStyles.sourceLink} href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener noreferrer">NOAA MarineCadastre</a> for US waters (public domain, months late) and <a className={shipsStyles.sourceLink} href="https://globalfishingwatch.org" target="_blank" rel="noopener noreferrer">Powered by Global Fishing Watch</a> hourly positions elsewhere and for recent months (CC BY-NC 4.0, about 4 days behind). The same tracks as <a className={shipsStyles.sourceLink} href="/ships">/ships</a>.</>}
              />

              <DatasetRow storageKey="shiptraffic.whales" name="Whale reports" sub={whales ? `${whalesInView.length.toLocaleString()} in view` : 'loading…'}
                hue={WHALE_COLOR} icon={<WhaleIcon />} on={visible.whales} onToggle={() => setVisible((v) => ({ ...v, whales: !v.whales }))}
                status={whalesErr ? <div className={styles.statusError}>{whalesErr}</div> : (!whales ? <Loading>Loading whale reports…</Loading> : whales.truncated ? <div className={styles.statusNote}>Showing the newest 2,000 — zoom in or pick fewer months for all.</div> : null)}
                controls={whalesInView.length ? <WhaleReports reports={whalesInView} tone="dark" bare onSelect={(w) => { mapRef.current?.easeTo({ center: [w.lng, w.lat], zoom: Math.max(mapRef.current.getZoom(), 11) }); showWhalePopup(w) }} /> : <div className={styles.statusNote}>No whale reports in view for these months.</div>}
                legend={<>
                  <LegendSwatchRow swatch={<span className={styles.dotSeen} />}>Seen{reportSources.length ? ` · ${reportSources.slice(0, 3).join(', ')}${reportSources.length > 3 ? '…' : ''}` : ''}</LegendSwatchRow>
                  <LegendSwatchRow swatch={<span className={styles.dotBig}>12</span>}>Dot size and number = whales seen there</LegendSwatchRow>
                  <LegendSwatchRow swatch={<span className={styles.dotHeard} />}>Heard on a hydrophone (Orcasound)</LegendSwatchRow>
                </>}
                info={<>Every whale, dolphin and porpoise report we know about, each shown once: Whale Alert (with Orca Network and other channels), SalishSea.io, Orcasound, HappyWhale, iNaturalist and OBIS, refreshed hourly. Click a report for its source and the ships that passed within 1 km. The ⌄ list shows every report in view.</>}
              />

              <DatasetRow storageKey="shiptraffic.overlap" name="Overlap" sub={overlapMonths ? `${overlapMonths} month${overlapMonths === 1 ? '' : 's'}` : (overlapIdx ? 'not baked for these months yet' : 'loading…')}
                hue={OVERLAP_COLOR} icon={<OverlapIcon />} on={visible.overlap} onToggle={() => setVisible((v) => ({ ...v, overlap: !v.overlap }))}
                legend={<LegendSwatchRow swatch={<span className={styles.overlapRamp} />}>Where ships{kinds.length ? ' of the picked kinds' : ''} and whales meet; brighter = more, relative to this view</LegendSwatchRow>}
                info={<>For each ~1 km square: ships that crossed it in the picked months (scaled to the busiest square) × whales seen in it (scaled to the square with the most). It counts whales, not reports: one group reported by several people counts once, and whales placed only roughly count for the whole ~10 km area they could be in. Click a square for its numbers. A co-occurrence measure for exploring, not a ship-strike risk model. Recomputed daily.</>}
              />

              <SourcesFooter intro="Ship tracks, whale reports and where they overlap in the Salish Sea and beyond. Every value on the map links its own source; this is the full list." sections={SOURCES} notes={NOTES} />
            </>
          )}
        </div>
      </MapSheet>
    </div>
  )
}

// ─── Popups ─────────────────────────────────────────────────────────────────
function whenText(w) {
  if (w.time_precision === 'exact' && w.observed_at) {
    const t = new Date(w.observed_at)
    return `${t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · ${t.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  }
  return fmtDay(w.observed_date)
}

function whalePopupHTML(w, cp) {
  const credit = whaleCredit(w)
  const n = w.count ? (w.count.max ?? w.count.min) : null
  const ships = cp?.ships || []
  const rule = cp?.rule ? `within ${cp.rule.metres / 1000} km, ±${cp.rule.hours} h` : 'within 1 km, ±3 h'
  const shipRows = ships.slice(0, 8).map(([vid, kind, m, dt]) => {
    const label = KIND_LABELS[kind] || 'Ship'
    const when = dt == null ? 'same day' : dt === 0 ? 'at the time' : `${Math.abs(dt) < 60 ? `${Math.abs(dt)} min` : `${(Math.abs(dt) / 60).toFixed(1)} h`} ${dt < 0 ? 'before' : 'after'}`
    const name = /^\d{9}$/.test(vid) ? `<a href="/ships?q=${vid}" target="_blank" rel="noopener">${escapeHtml(label)} · MMSI ${vid}</a>` : escapeHtml(label)
    return `<div class="${styles.popupShip}"><span>${name}</span><span class="${styles.popupMuted}">${m} m · ${when}</span></div>`
  }).join('')
  const approxM = locationRadiusM(w)
  const approx = approxM >= APPROX_M
  const closeBlock = approx
    ? `<div class="${styles.popupMuted}">Passing ships aren't checked: this report's location is approximate.</div>`
    : cp === undefined
    ? `<div class="${styles.popupMuted}">Checking for passing ships…</div>`
    : !cp ? `<div class="${styles.popupMuted}">Passing ships aren't computed for this month yet.</div>`
    : ships.length
    ? `<div class="${styles.popupK}">${ships.length} ship${ships.length === 1 ? '' : 's'} passed ${rule}</div>${shipRows}${ships.length > 8 ? `<div class="${styles.popupMuted}">and ${ships.length - 8} more</div>` : ''}`
      + `<div class="${styles.popupSrc}">Ships: <a href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener">NOAA MarineCadastre</a> · <a href="https://globalfishingwatch.org" target="_blank" rel="noopener">Powered by Global Fishing Watch</a></div>`
    : `<div class="${styles.popupMuted}">No AIS ship tracks passed ${rule}.</div>`
  const photo = whalePhoto(w)
  const photoBlock = photo
    ? `<a class="${styles.popupPhoto}" ${photo.href ? `href="${escapeHtml(photo.href)}" target="_blank" rel="noopener"` : ''}>` +
      `<img src="${escapeHtml(photo.url)}" alt="${escapeHtml(whaleName(w))}" loading="lazy" onerror="this.parentElement.style.display='none'"></a>` +
      `<div class="${styles.popupPhotoCredit}">${escapeHtml(photo.credit)}</div>`
    : ''
  return (
    `<div class="${styles.popup}">` + photoBlock +
    `<div class="${styles.popupHead}">${w.kind === 'acoustic' ? 'Whale heard' : 'Whale report'}</div>` +
    `<div class="${styles.popupSpecies}">${escapeHtml(whaleName(w))}${n > 1 ? ` × ${n}` : ''}</div>` +
    `<div class="${styles.popupMuted}">${escapeHtml(whenText(w))}${w.observer ? ` · ${escapeHtml(w.observer)}` : ''}</div>` +
    (w.individual?.label ? `<div class="${styles.popupMuted}">${escapeHtml(w.individual.label)}</div>` : '') +
    (approx ? `<div class="${styles.popupApprox}">Approximate location: within about ${Math.max(1, Math.round(approxM / 1000))} km of this point</div>` : '') +
    `<div class="${styles.popupSrc}">${escapeHtml(credit)}${w.url ? ` · <a href="${escapeHtml(w.url)}" target="_blank" rel="noopener">${escapeHtml(whaleLinkLabel(w))} ↗</a>` : ''}</div>` +
    `<div class="${styles.popupDivider}"></div>` + closeBlock +
    `</div>`
  )
}

/** The whale groups (from the picked months' grids) that put whales in this square: exact ones in it, approximate
 *  ones whose spread box covers it. */
function groupsCovering(grids, c) {
  const out = []
  for (const g of grids) {
    const [W, S] = g.bbox
    const { lngStep, latStep } = g.cell
    for (const [lng, lat, whales, species, sources, dLat, dLng, reports, pts] of g.groups || []) {
      const hit = dLat
        ? Math.abs(c.lat - lat) <= dLat + latStep / 2 && Math.abs(c.lng - lng) <= dLng + lngStep / 2
        : pts?.length ? nearPoints(pts, c.lng, c.lat) // same rule as the bake: within 1 km of any of its reports
          : Math.floor((lng - W) / lngStep) === c.i && Math.floor((lat - S) / latStep) === c.j
      if (hit) out.push({ whales, species, sources, approx: !!dLat, km: dLat ? Math.round(dLat * 2 * 111.32) : 0, reports, lat, lng })
    }
  }
  return out
}

const fmtWhales = (n) => (n >= 10 ? Math.round(n).toLocaleString() : n >= 1 ? (Math.round(n * 10) / 10).toString() : n > 0 ? '<1' : '0')

function cellPopupHTML(c, months, groups = []) {
  const band = overlapBand(c.nI)
  const kinds = Object.entries(c.byKind).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${escapeHtml(KIND_LABELS[k] || k)} ${n.toLocaleString()}`).join(' · ')
  const span = months.length === 1 ? fmtMonth(months[0]) : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`
  // Whale breakdown: exact groups first (they sit in this square), then approximate ones (their whales are spread over
  // the whole area they could be in, so this square carries only its share).
  // Approximate groups at the same point (e.g. one HappyWhale uploader's rounded spot, day after day) read as one line.
  const merge = (list) => {
    const m = new Map()
    for (const g of list) {
      const k = `${g.species}|${g.sources}|${g.km}|${g.approx ? `${g.lat},${g.lng}` : Math.random()}`
      const cur = m.get(k)
      if (cur) { cur.whales += g.whales; cur.reports += g.reports } else m.set(k, { ...g })
    }
    return [...m.values()].sort((a, b) => b.whales - a.whales)
  }
  const exact = merge(groups.filter((g) => !g.approx))
  const approx = merge(groups.filter((g) => g.approx))
  const plural = (name, n) => (n === 1 ? name : /s$/i.test(name) ? name : `${name}s`)
  const line = (g) => `${g.whales.toLocaleString()} ${escapeHtml(plural(g.species, g.whales))} · ${escapeHtml(g.sources)}${g.reports > 1 ? ` · ${g.reports} reports` : ''}`
  const whaleLines = [
    ...exact.slice(0, 4).map((g) => `<div class="${styles.popupMuted}">${line(g)}</div>`),
    ...approx.slice(0, 3).map((g) => `<div class="${styles.popupMuted}">${line(g)} · <em>placed only roughly: somewhere in this ~${g.km} km area</em></div>`),
  ].join('')
  const more = exact.length + approx.length - Math.min(4, exact.length) - Math.min(3, approx.length)
  return (
    `<div class="${styles.popup}">` +
    `<div class="${styles.popupHead}">This ~1 km square · ${escapeHtml(span)}</div>` +
    `<div class="${styles.popupRow}"><span class="${styles.popupDotV}"></span><span class="${styles.popupK}">Ships crossing</span><span class="${styles.popupV}">${c.v.toLocaleString()}</span></div>` +
    (kinds ? `<div class="${styles.popupMuted}">${kinds}</div>` : '') +
    `<div class="${styles.popupSrc}">Ships: <a href="https://hub.marinecadastre.gov/pages/vesseltraffic" target="_blank" rel="noopener">NOAA MarineCadastre</a> · <a href="https://globalfishingwatch.org" target="_blank" rel="noopener">Powered by Global Fishing Watch</a></div>` +
    `<div class="${styles.popupRow}"><span class="${styles.popupDotW}"></span><span class="${styles.popupK}">Whales seen in or within 1 km of here</span><span class="${styles.popupV}">${fmtWhales(c.w)}</span></div>` +
    (c.a ? `<div class="${styles.popupRow}"><span class="${styles.popupDotW}" style="opacity:.5"></span><span class="${styles.popupK}">Whales seen in this ~10 km area</span><span class="${styles.popupV}">${fmtWhales(c.a)}</span></div>` : '') +
    whaleLines + (more > 0 ? `<div class="${styles.popupMuted}">and ${more} more group${more === 1 ? '' : 's'}</div>` : '') +
    `<div class="${styles.popupSrc}">Whales, not reports: one group seen by several people counts once, in every square within 1 km of where it was reported; whales placed only roughly count for their whole ~10 km area. From the EarthAtlas whale database.</div>` +
    `<div class="${styles.popupIx} ${styles['popupIx_' + band.tone] || ''}">${escapeHtml(band.label)} · ${Math.round(c.nI * 100)}/100</div>` +
    `<div class="${styles.popupFormula}">relative ship × whale overlap across the region</div>` +
    `</div>`
  )
}

/** One dot's whale groups: each group's whales and span, then its reports (each row opens that report). */
function stackPopupHTML(groups, sorted) {
  const whales = groups.reduce((a, g) => a + g.whales, 0)
  const plural = (name, n) => (n === 1 ? name : /s$/i.test(name) ? name : `${name}s`)
  let row = 0
  const blocks = groups.slice(0, 8).map((g) => {
    const members = sorted.slice(row, row + g.members.length)
    row += g.members.length
    const first = members[members.length - 1], last = members[0]
    const a = whenText(first), b = whenText(last)
    const span = a === b || !b.includes(' · ') ? b : `${a} – ${b.replace(/^.* · /, '')}`
    const rows = members.slice(0, 6).map((w, j) => {
      const i = sorted.indexOf(w)
      const n = whalesIn(w)
      return `<button type="button" class="${styles.stackRow}" data-stack-i="${i}">` +
        `<span>${escapeHtml(whaleName(w))}${n > 1 ? ` × ${n}` : ''}${w.observer ? ` · ${escapeHtml(w.observer)}` : w.individual?.label ? ` · ${escapeHtml(w.individual.label)}` : ''}</span>` +
        `<span class="${styles.popupMuted}">${escapeHtml(whenText(w))} · ${escapeHtml(whaleSourceLabel(w))}${w.count && !(Number(w.count.max) || Number(w.count.min)) ? ' · no count given' : ''}</span></button>`
    }).join('') + (members.length > 6 ? `<div class="${styles.popupMuted}">and ${members.length - 6} more reports</div>` : '')
    return `<div class="${styles.stackGroup}"><div class="${styles.popupK}">${g.whales.toLocaleString()} ${escapeHtml(plural(g.species, g.whales))}` +
      `<span class="${styles.popupMuted}"> · ${escapeHtml(span)}${g.members.length > 1 ? ` · ${g.members.length} reports` : ''}</span></div>${rows}</div>`
  }).join('')
  const reports = groups.reduce((a, g) => a + g.members.length, 0)
  const approx = locationRadiusM(sorted[0]) >= APPROX_M
  return (
    `<div class="${styles.popup}">` +
    `<div class="${styles.popupHead}">${whales.toLocaleString()} whale${whales === 1 ? '' : 's'} seen here · ${reports} report${reports === 1 ? '' : 's'}</div>` +
    `<div class="${styles.popupMuted}">Reports of the same animals (same species, same day, within 2 km and 2 hours) count once, at the largest number given.</div>` +
    (approx ? `<div class="${styles.popupApprox}">Approximate location: within about ${Math.max(1, Math.round(locationRadiusM(sorted[0]) / 1000))} km of this point</div>` : '') +
    `<div class="${styles.stackScroll}">${blocks}${groups.length > 8 ? `<div class="${styles.popupMuted}">and ${groups.length - 8} more groups</div>` : ''}</div>` +
    `</div>`
  )
}

// ─── Icons (≈16 px, currentColor) ─────────────────────────────────────────────
function ShipIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l2 4h14l2-4-9-3-9 3z" /><path d="M12 14V4" /><path d="M8 8h8" /></svg>
}
function WhaleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 13c2 4 6 6 11 5 4-1 6-4 7-7l-3 1c0-2-1-4-3-4-1 3-4 4-7 4-2 0-4 0-5 1z" /><circle cx="8" cy="13" r="0.6" fill="currentColor" /></svg>
}
function OverlapIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="12" r="5" /><circle cx="15" cy="12" r="5" /></svg>
}
