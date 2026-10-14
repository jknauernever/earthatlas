/**
 * EarthAtlas /permits (PermitTracker): Clean Water Act permits and related actions in the San Juan Islands (San Juan County, WA).
 * Data: permits.json + wq303d.geojson + shellfish.geojson (permitsData.js: Blob in production, public/permits-data/ on
 * localhost), baked weekly by scripts/permits/bake-permits.mjs from
 * data/permits/curated.json (hand-compiled) and live EPA ECHO / Ecology / DOH services.
 *
 * Follows docs/MAP_TOOL_CONVENTIONS.md: URL state (camera, basemap, selected record, layers), county aerials default
 * (as /sanjuan-docks), shared zoom badge / share / place search, style.load readiness. Every value in a popup carries
 * its own source link (↗) to a readable page: the agency's own, or /permits/source/<key> (PermitsSourcePage.jsx) for
 * data-service records. "How this is sourced" is the rollup (src/permits/permitsSources.js).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { keepPopupOnMap } from '../lib/popupFit.js'
import { installPopupSheet } from '../lib/popupSheet.js'
import { flyToSearchResult } from '../lib/eaGeoSearch.js'
import { ensureWebGLSupport } from '../utils/webglSupport'
import { scheduleViewCard, captureMapImage } from '../lib/shareCard.js'
import { sjcAerialsSource } from '../lib/localAerials.js'
import GeoSearch from '../components/GeoSearch.jsx'
import MapSearch from '../components/MapSearch.jsx'
import ZoomIndicator from '../components/ZoomIndicator.jsx'
import ShareControl from '../components/ShareControl.jsx'
import SourcesFooter from '../components/panel/SourcesFooter.jsx'
import { STATUS_WORDS, statusKey } from '../ships/permitStatus.js'
import { fetchPermitsJson } from './permitsData.js'
import { LAW, fmtDate, recordPage, docHref, permitKindOf, whyItems, calm, whatOf, activityYears } from './permitLogic.js'
import { PERMITS_SOURCES, PERMITS_SOURCES_INTRO, PERMITS_SOURCES_NOTES } from './permitsSources.js'
import q from '../quakes/QuakesApp.module.css'
import styles from './PermitsApp.module.css'

installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DEFAULT_VIEW = { center: [-122.98, 48.6], zoom: 10 }

// Same basemaps as /sanjuan-docks: the county's 2025 aerials by default (no sun-glint on the water).
const SJC_WATER = '#3f6073'
const sjcAerialsStyle = {
  version: 8,
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
  sources: {
    'mapbox-satellite': { type: 'raster', url: 'mapbox://mapbox.satellite', tileSize: 256 },
    'mapbox-streets': { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v8' },
    'sjc-aerials': sjcAerialsSource,
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
const DEFAULT_BASEMAP = 'sjc2025'
const basemapStyleFor = (id) => (BASEMAPS.find((b) => b.id === id) || BASEMAPS[1]).style

// Record layers (points) and receiving-water layers (polygons). Ids are the URL keys.
// One color per kind of permit (Josh 2026-10-14: "label the colored dots for which type of permit they represent").
// A record's kind comes from its own source documents (permitKindOf below), never from a guess.
const LAYERS = [
  { id: 'cert401', label: '401', desc: 'Ecology’s water-quality sign-off', note: 'Ecology’s water-quality sign-off: a Clean Water Act §401 certification of a federal permit, or a state order (Ecology’s “administrative order” under RCW 90.48) for waters the Corps doesn’t cover', color: '#a78bfa' },
  { id: 'structures', label: '404', desc: 'Army Corps permit to build in the water', note: 'Army Corps permit to build or place fill in the water (Clean Water Act §404 / Rivers and Harbors Act §10)', color: '#38bdf8' },
  { id: 'npdes', label: '402', desc: 'Discharge permit (sewage, stormwater, boatyards)', note: 'Discharge permit (Clean Water Act §402, NPDES), issued by Ecology', color: '#f472b6' },
  { id: 'local', label: 'Other', desc: 'No permit record found yet', note: 'In-water work or a related county action with no 404, 401 or 402 record found', color: '#fbbf24' },
]
const VIO_COLORS = { red: '#ef4444', orange: '#fb923c' }
const DEFAULT_OFF = ['shell', 'wq'] // sorted, as the URL writes them
const WATERS = [
  { id: 'wq', label: 'Impaired waters', note: 'Ecology 303(d), Category 5', color: '#f97316' },
  { id: 'shell', label: 'Shellfish growing areas', note: 'DOH classification', color: '#4ade80' },
]
// Matched by substring in this order, so "Conditionally Approved" is caught before "Approved".
const SHELL_COLORS = { Conditionally: '#facc15', Prohibited: '#ef4444', Restricted: '#fb923c', Approved: '#4ade80' }

function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); return v == null || v === '' ? NaN : Number(v) }
  return { bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), r: sp.get('r'), off: sp.get('off'), t: sp.get('t') }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
const todayIso = () => new Date().toISOString().slice(0, 10)
const latestPast = (r) => (r.trail || []).map((t) => t.date).filter((d) => d <= todayIso()).sort().pop() || ''

// Is an in-water work window ("MM-DD" to "MM-DD", may wrap the new year) open today?
function windowOpen(r) {
  if (!r.window) return false
  const now = new Date()
  const md = (now.getMonth() + 1) * 100 + now.getDate()
  const f = Number(r.window.from.replace('-', '')), t = Number(r.window.to.replace('-', ''))
  return f <= t ? md >= f && md <= t : md >= f || md <= t
}

// ─── Popup HTML, laid out like /sanjuan-docks: title, place line, count line, then one closed <details> per source
// document (date, agency tag, title); inside, what that document states and its links. Grouping by document makes
// "as listed in Ecology's order" visible: another agency's action sits under the document that reports it. ───
const OPEN_LABEL = { PDF: 'Open the PDF', Page: 'Open the page', Record: 'Open the record' }
function docLinks(docs, key) {
  const d = docs[key]
  if (!d) return ''
  const a = (href, label, local) => `<a class="${styles.popupLink}" href="${escapeHtml(href)}"${local ? '' : ' target="_blank" rel="noopener noreferrer"'}>${label}</a>`
  const parts = []
  if (d.url) parts.push(a(d.url, `${OPEN_LABEL[d.kind] || 'Open'} ↗`))
  if (d.record) parts.push(a(recordPage(key), d.url ? 'data as received' : 'Open the record ↗', true))
  if (d.map) parts.push(a(d.map, 'on Ecology’s map ↗'))
  return `<div class="${styles.docLinks}">${parts.join(' · ')}</div>`
}
function agencyChip(tags, agency) {
  const [tag, full] = tags[agency] || [String(agency || '').toUpperCase(), agency]
  return `<span class="${styles.agency}" title="${escapeHtml(full)}">${escapeHtml(tag)}</span>`
}
// "In force" etc. for an ECHO status; EPA's own term on hover.
const ECHO_ALIAS = { 'admin continued': 'administratively continued' }
function statusPill(st) {
  if (!st.raw) return `<span class="${styles.pill} ${styles[st.cls]}">${escapeHtml(st.label)}</span>`
  const k = ECHO_ALIAS[statusKey(st.raw)] || statusKey(st.raw)
  const w = STATUS_WORDS[k]
  const title = `${st.by || 'The source'} lists it as “${st.raw}”${w ? `: ${w.long}` : ''}`
  return `<span class="${styles.pill} ${styles[st.cls]}" title="${escapeHtml(title)}">${escapeHtml(w?.short || st.raw)}</span>`
}


// "Why it needs a permit" (permitLogic.js whyItems): each law named and linked.
const lawLink = (k) => `<a class="${styles.popupLink}" href="${LAW[k].url}" target="_blank" rel="noopener noreferrer">${LAW[k].name} ↗</a>`
const whyLines = (r, docs) => whyItems(r, docs).map((pieces) => pieces.map((x) => (typeof x === 'string' ? escapeHtml(x) : lawLink(x.law))).join(''))
function whyHtml(r, docs) {
  // A closed turndown at the bottom of the popup, like the document sections (Josh 2026-10-14).
  return `<details class="${styles.doc} ${styles.why}"><summary>Why it needs a permit</summary>` +
    `<ul>${whyLines(r, docs).map((l) => `<li>${l}</li>`).join('')}</ul></details>`
}


// Ecology's documents for a permit, newest first; its fact sheet (why the permit exists and how its limits were set) on top.
function ecyHtml(list) {
  const fs = list.find((x) => x.factSheet)
  const a = (x, label) => `<a class="${styles.popupLink}" href="${escapeHtml(x.url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`
  const shown = list.slice(0, 12)
  return (fs ? `<p class="${styles.docText}">${a(fs, 'Ecology’s fact sheet')} explains what the facility discharges and how the permit’s limits were set${fs.date ? ` (${escapeHtml(fs.date)})` : ''}.</p>` : '') +
    `<ol class="${styles.events}">${shown.map((x) => `<li><span class="${styles.when}">${x.date ? fmtDate(x.date) : ''}</span><span>${escapeHtml(x.what)} ${a(x, 'PDF')}</span></li>`).join('')}</ol>` +
    (list.length > shown.length ? `<p class="${styles.docText}">${list.length - shown.length} older documents on Ecology’s page.</p>` : '')
}
// The same dock in EarthAtlas Docks: county and WDFW permits there, and how the match was made.
function dockHtml(d, tags) {
  return `<p class="${styles.docText}">Permits at a dock ${d.m} m from this point that name ${escapeHtml(d.shared.join(', '))}:</p>` +
    `<ol class="${styles.events}">${d.permits.slice(0, 15).map((x) => `<li><span class="${styles.when}">${x.date ? fmtDate(x.date) : ''}</span><span>` +
      `${agencyChip(tags, x.agency)}${escapeHtml(calm(x.what))}${x.number ? ` <span class="${styles.num}">${escapeHtml(x.number)}</span>` : ''}${x.status ? ` · ${escapeHtml(String(x.status).toLowerCase())}` : ''}</span></li>`).join('')}</ol>` +
    (d.permits.length > 15 ? `<p class="${styles.docText}">${d.permits.length - 15} more on the San Juan docks map.</p>` : '')
}

// "Map location: from the Army Corps record (NWS-2003-00823 ↗)" (Josh 2026-10-14): where the dot comes from, with a
// short link to that source. A note of more than one sentence gets "Source:" before the link instead.
function mapLocationHtml(r, docs, href) {
  const d = docs[r.position.src]
  const text = escapeHtml(String(r.position.text).replace(/\.$/, ''))
  const link = href && d ? `<a class="${styles.popupLink}" href="${escapeHtml(href)}"${d.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(d.look_up || d.title)} ↗</a>` : ''
  return `<div class="${styles.matchNote}"><b>Map location:</b> ${text}${link ? (/\. /.test(text) ? `. Source: ${link}` : ` (${link})`) : ''}</div>`
}
// "What it is" (permitLogic.js whatOf), its source named after it.
function whatHtml(r, docs) {
  const w = whatOf(r)
  if (!w) return ''
  const d = docs[w.srcKey], href = docHref(docs, w.srcKey), name = escapeHtml(w.srcLabel || d?.title || '')
  const source = href ? `<a class="${styles.popupLink}" href="${escapeHtml(href)}"${d?.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>${name}</a>` : name
  return `<div class="${styles.what}"><b>${escapeHtml(w.label)}</b> ${escapeHtml(calm(w.text))} <span class="${styles.whatSrc}">Source: ${source}</span></div>`
}
function recordHtml(r, docs, tags, byId, unmappedById) {
  const groups = new Map() // doc key → { rows, paras, events }
  const g = (key) => {
    if (!key || !docs[key]) return null
    if (!groups.has(key)) groups.set(key, { rows: [], paras: [], events: [] })
    return groups.get(key)
  }
  if (r.summary?.src) g(r.summary.src)?.paras.push(escapeHtml(r.summary.text))
  if (r.status?.src) g(r.status.src)?.rows.push(['Status', statusPill(r.status)], ['Applicant', escapeHtml(r.applicant)])
  if (r.water && r.summary?.src) g(r.summary.src)?.rows.push(['Water', escapeHtml(r.water)])
  if (r.window) g(r.window.src)?.rows.push(['In-water work', escapeHtml(r.window.text) + (windowOpen(r) ? ` <span class="${styles.pill} ${styles.warn}">Open today</span>` : '')])
  for (const f of r.facts || []) g(f.src)?.rows.push([escapeHtml(f.label), escapeHtml(f.value)])
  for (const x of r.refs || []) g(x.src)?.rows.push(['Number', escapeHtml(x.label)])
  if (r.note) g(r.note.src)?.paras.push(`<span class="${styles.noteInline}">${escapeHtml(r.note.text)}</span>`)
  for (const t of r.trail || []) g(t.src)?.events.push(t)
  if (r.position?.src) g(r.position.src)
  if (r.ecyDocs) { const x = g(r.ecyDocs.src); if (x) x.ecy = r.ecyDocs.list }
  for (const d of r.docks || []) { const x = g(d.src); if (x) x.dock = d }

  const today = todayIso()
  const dateOf = (grp) => {
    const ds = [...grp.events.map((t) => t.date), ...(grp.ecy || []).map((x) => x.date), ...(grp.dock?.permits || []).map((x) => x.date)].filter(Boolean).sort()
    return ds.filter((d) => d <= today).pop() || ds[0] || ''
  }
  const items = [...groups.entries()].map(([key, grp]) => ({ key, grp, date: dateOf(grp) }))
    .sort((a, b) => (!a.date) - (!b.date) || a.date.localeCompare(b.date))
  const agencyCount = new Set(items.map((i) => docs[i.key].agency)).size

  const html = items.map(({ key, grp, date }) => {
    const d = docs[key]
    const events = grp.events.sort((a, b) => a.date.localeCompare(b.date)).map((t) =>
      `<li class="${t.date > today ? styles.future : ''}"${t.title ? ` title="${escapeHtml(t.title)}"` : ''}><span class="${styles.when}">${fmtDate(t.date)}</span><span>` +
      `${t.agency !== d.agency ? agencyChip(tags, t.agency) : ''}${escapeHtml(t.event)}${t.url ? ` <a class="${styles.popupLink}" href="${escapeHtml(t.url)}" target="_blank" rel="noopener noreferrer">↗</a>` : ''}</span></li>`).join('')
    const isPosition = r.position?.src === key
    return `<details class="${styles.doc}"><summary><span class="${styles.docDate}">${date ? escapeHtml(date) : 'undated'}</span>` +
      `${agencyChip(tags, d.agency)}${escapeHtml(d.title)}</summary>` +
      grp.paras.map((p) => `<p class="${styles.docText}">${p}</p>`).join('') +
      (grp.rows.length ? `<table class="${styles.attrs}">${grp.rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>` : '') +
      (events ? `<ol class="${styles.events}">${events}</ol>` : '') +
      (isPosition && !grp.rows.length && !grp.paras.length && !events ? `<p class="${styles.docText}">Used for this record’s position on the map.</p>` : '') +
      (grp.ecy ? ecyHtml(grp.ecy) : '') + (grp.dock ? dockHtml(grp.dock, tags) : '') +
      (d.rows?.length ? `<details class="${styles.full}"><summary>Everything this record says (${d.rows.length})</summary>` +
        `<table class="${styles.attrs}">${d.rows.map((x) => `<tr><th>${escapeHtml(x.label)}</th><td>${escapeHtml(x.value)}</td></tr>`).join('')}</table></details>` : '') +
      docLinks(docs, key) + `</details>`
  }).join('')

  const flags = (r.flags || []).map((f) => `<p class="${styles.flag}"><b>Sources disagree.</b> ${escapeHtml(f.text)} ` +
    f.srcs.map((k) => (docHref(docs, k) ? `<a class="${styles.popupLink}" href="${escapeHtml(docHref(docs, k))}" target="_blank" rel="noopener noreferrer">${escapeHtml(docs[k].title)} ↗</a>` : '')).join(' · ') + `</p>`).join('')
  const joins = (r.joins || []).map((j) => byId.get(j)
    ? `<button type="button" class="${styles.joinBtn}" data-join="${escapeHtml(j)}">${escapeHtml(byId.get(j).name)}</button>`
    : unmappedById.get(j) ? `${escapeHtml(unmappedById.get(j).name)} (not on the map yet)` : '').filter(Boolean)
  const posHref = r.position?.src && docHref(docs, r.position.src)
  const place = [r.type, r.island].filter(Boolean).map(escapeHtml).join(' · ')
  return `<div class="${styles.popup}">` +
    `<div class="${styles.popupTitle}">${escapeHtml(r.name)}</div>` +
    `<div class="${styles.place}">${statusPill(r.status)} ${place} · <a class="${styles.popupLink}" href="/permits/report/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">Printable report ↗</a></div>` +
    whatHtml(r, docs) +
    (r.violations ? `<div class="${styles.vioLine}" style="border-color:${VIO_COLORS[r.violations.level]}"><b>Violations since ${escapeHtml(r.violations.since)}:</b> ` +
      [[r.violations.pollution, 'over a pollution limit'], [r.violations.evasion, 'reports or samples never done'], [r.violations.minor, 'smaller (late, lab errors, capacity)']]
        .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(' · ') + ` <span class="${styles.whyNote}">(listed in the sections below)</span></div>` : '') +
    `<div class="${styles.popupCount}">${items.length} source document${items.length === 1 ? '' : 's'} from ${agencyCount} publisher${agencyCount === 1 ? '' : 's'}, by date</div>` +
    html + flags +
    (joins.length ? `<div class="${styles.joins}"><b>Linked records:</b> ${joins.join(' · ')}</div>` : '') +
    mapLocationHtml(r, docs, posHref) + whyHtml(r, docs) + `</div>`
}
function wqHtml(p, docs, tags) {
  const d = docs[p.doc]
  return `<div class="${styles.popup}"><div class="${styles.popupTitle}">${escapeHtml(p.ListingWaterbodyName)}</div>` +
    `<div class="${styles.place}">Impaired water · Category ${escapeHtml(p.CategoryCode)} (303(d) list)</div>` +
    `<div class="${styles.popupCount}">1 source document, from Washington State Department of Ecology</div>` +
    `<details class="${styles.doc}"><summary>${agencyChip(tags, 'ecology')}${escapeHtml(d?.title || `Listing ${p.ListingNumber}`)}</summary>` +
    `<table class="${styles.attrs}"><tr><th>Impairment</th><td>${escapeHtml(p.ParameterName)}${p.MediumName ? ` (${escapeHtml(p.MediumName)})` : ''}</td></tr>` +
    `<tr><th>Listing</th><td>${escapeHtml(p.ListingNumber)}</td></tr>` +
    `<tr><th>Water type</th><td>${escapeHtml(p.EnvironmentTypeCode)}</td></tr>` +
    `<tr><th>Assessment unit</th><td>${escapeHtml(p.AssessmentUnitNumber)}</td></tr></table>` +
    docLinks(docs, p.doc) + `</details></div>`
}
function shellHtml(p, docs, tags) {
  const items = [p.report, p.doc].filter((k) => k && docs[k])
  return `<div class="${styles.popup}"><div class="${styles.popupTitle}">${escapeHtml(p.NAME)}</div>` +
    `<div class="${styles.place}">Shellfish growing area · ${escapeHtml(p.CLASS)}</div>` +
    `<div class="${styles.popupCount}">${items.length} source document${items.length === 1 ? '' : 's'}, from Washington State Department of Health</div>` +
    `<details class="${styles.doc}"><summary>${p.Updated ? `<span class="${styles.docDate}">${escapeHtml(p.Updated)}</span>` : ''}${agencyChip(tags, 'doh')}${escapeHtml(docs[p.doc]?.title || 'Classification')}</summary>` +
    `<table class="${styles.attrs}"><tr><th>Classification</th><td>${escapeHtml(p.CLASS)}</td></tr>` +
    (p.Reason && p.Reason !== 'None' ? `<tr><th>Reason</th><td>${escapeHtml(p.Reason)}</td></tr>` : '') +
    (p.ACRES != null ? `<tr><th>This part of the area</th><td>${escapeHtml(Math.round(p.ACRES).toLocaleString('en-US'))} acres</td></tr>` : '') +
    (p.Updated ? `<tr><th>Layer updated</th><td>${escapeHtml(p.Updated)}</td></tr>` : '') + `</table>` +
    docLinks(docs, p.doc) + `</details>` +
    (p.report ? `<details class="${styles.doc}"><summary>${agencyChip(tags, 'doh')}${escapeHtml(docs[p.report].title)}</summary>` +
      `<p class="${styles.docText}">DOH’s yearly review of this growing area: sampling results and the reasons for its classification.</p>${docLinks(docs, p.report)}</details>` : '') +
    `</div>`
}

export default function PermitsApp() {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const popupRef = useRef(null)
  const styledMapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [styleLoads, setStyleLoads] = useState(0)
  const [data, setData] = useState(null)
  const [waters, setWaters] = useState(null)
  const [error, setError] = useState(null)
  const captureShareImage = () => (mapRef.current ? captureMapImage(mapRef.current) : Promise.resolve(null))

  const initial = typeof window !== 'undefined' ? readUrlState() : {}
  const initialCamera = Number.isFinite(initial.lat) && Number.isFinite(initial.lng) && Number.isFinite(initial.z)
    ? { lat: initial.lat, lng: initial.lng, zoom: initial.z } : null
  const [basemap, setBasemap] = useState(() => (BASEMAPS.some((b) => b.id === initial.bm) ? initial.bm : DEFAULT_BASEMAP))
  const [basemapMenuOpen, setBasemapMenuOpen] = useState(false)
  const basemapMenuRef = useRef(null)
  const [mapView, setMapView] = useState(initialCamera)
  const [selected, setSelected] = useState(initial.r || null)
  // Impaired waters and shellfish areas start off (Josh 2026-10-14); a shared link carries its own choice (off=none = all on).
  const [off, setOff] = useState(() => new Set(initial.off == null ? DEFAULT_OFF : initial.off.split(',').filter((x) => x && x !== 'none')))

  // ─── Data ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all(['permits.json', 'wq303d.geojson', 'shellfish.geojson'].map(fetchPermitsJson))
      .then(([d, wq, shell]) => { setData(d); setWaters({ wq, shell }) })
      .catch((e) => setError(`Could not load permit data (${e.message}).`))
  }, [])

  const records = useMemo(() => (data ? [...data.projects, ...data.npdes].map((r) => ({ ...r, ...permitKindOf(r, data.docs), years: activityYears(r) })) : []), [data])
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records])
  const unmappedById = useMemo(() => new Map((data?.unmapped || []).filter((u) => u.id).map((u) => [u.id, u])), [data])
  // Time: a record shows when any of its activity years falls in the chosen span (activityYears in permitLogic.js).
  const yearBounds = useMemo(() => {
    const ys = records.flatMap((r) => r.years)
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : [2007, new Date().getFullYear()]
  }, [records])
  const [span, setSpan] = useState(() => { const m = /^(\d{4})-(\d{4})$/.exec(initial.t || ''); return m ? [+m[1], +m[2]] : null })
  const [y0, y1] = span || yearBounds
  const allTime = !span || (y0 <= yearBounds[0] && y1 >= yearBounds[1])
  const inTime = (r) => allTime || r.years.some((y) => y >= y0 && y <= y1)
  const timed = useMemo(() => records.filter(inTime), [records, y0, y1, allTime]) // eslint-disable-line react-hooks/exhaustive-deps
  const visible = useMemo(() => timed.filter((r) => !off.has(r.layer)), [timed, off])
  const vioCounts = useMemo(() => ({ red: timed.filter((r) => r.violations?.level === 'red').length, orange: timed.filter((r) => r.violations?.level === 'orange').length }), [timed])
  const counts = useMemo(() => Object.fromEntries(LAYERS.map((l) => [l.id, timed.filter((r) => r.layer === l.id).length])), [timed])

  const geojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: visible.map((r) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { id: r.id, layer: r.layer, approx: !!r.approx, tag: r.tag || '', vio: r.violations?.level || '' },
    })),
  }), [visible])

  // ─── Popups ───────────────────────────────────────────────────────────────
  const showPopup = useCallback((lngLat, html, recordId) => {
    const map = mapRef.current
    if (!map) return
    popupRef.current?.remove()
    const popup = new mapboxgl.Popup({ offset: 10, maxWidth: '420px' }).setLngLat(lngLat).setHTML(html).addTo(map)
    popup.on('close', () => { if (popupRef.current === popup) setSelected(null) })
    popup.getElement()?.addEventListener('click', (e) => {
      const j = e.target.closest?.('[data-join]')?.getAttribute('data-join')
      if (j) openRecordRef.current(j, true)
    })
    popupRef.current = keepPopupOnMap(popup)
    setSelected(recordId ?? null)
  }, [])
  const openRecord = useCallback((id, fly) => {
    const r = byId.get(id)
    if (!r || !data) return
    if (fly && mapRef.current) mapRef.current.easeTo({ center: [r.lon, r.lat], zoom: Math.max(mapRef.current.getZoom(), 12) })
    showPopup([r.lon, r.lat], recordHtml(r, data.docs, data.tags, byId, unmappedById), r.id)
  }, [byId, data, unmappedById, showPopup])
  const openRecordRef = useRef(openRecord)
  openRecordRef.current = openRecord

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
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    for (const id of ['records', 'wq-fill', 'shell-fill']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }
    // Points sit above polygons: one click opens only the topmost thing.
    map.on('click', 'records', (e) => { const f = e.features?.[0]; if (f) openRecordRef.current(f.properties.id, false) })
    const pointHit = (e) => map.getLayer('records') && map.queryRenderedFeatures(e.point, { layers: ['records'] }).length > 0
    map.on('click', 'wq-fill', (e) => { if (pointHit(e)) return; const f = e.features?.[0]; if (f && dataRef.current) showPopup(e.lngLat, wqHtml(f.properties, dataRef.current.docs, dataRef.current.tags), null) })
    map.on('click', 'shell-fill', (e) => {
      if (pointHit(e) || map.queryRenderedFeatures(e.point, { layers: ['wq-fill'].filter((l) => map.getLayer(l)) }).length) return
      const f = e.features?.[0]; if (f && dataRef.current) showPopup(e.lngLat, shellHtml(f.properties, dataRef.current.docs, dataRef.current.tags), null)
    })
    map.on('style.load', () => { styledMapRef.current = map; setMapReady(true); setStyleLoads((n) => n + 1) })
    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; setMapReady(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const dataRef = useRef(null)
  dataRef.current = data

  // ─── Layers: (re)add after every style load once the data is in ─────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !waters || styledMapRef.current !== map || map.getSource('records')) return
    map.addSource('shell', { type: 'geojson', data: waters.shell })
    map.addSource('wq', { type: 'geojson', data: waters.wq })
    map.addSource('records', { type: 'geojson', data: geojson })
    const shellColor = ['case', ...Object.entries(SHELL_COLORS).flatMap(([k, c]) => [['in', k, ['get', 'CLASS']], c]), '#9ca3af']
    map.addLayer({ id: 'shell-fill', type: 'fill', source: 'shell', paint: { 'fill-color': shellColor, 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'shell-line', type: 'line', source: 'shell', paint: { 'line-color': shellColor, 'line-width': 1.2, 'line-opacity': 0.8 } })
    map.addLayer({ id: 'wq-fill', type: 'fill', source: 'wq', paint: { 'fill-color': '#f97316', 'fill-opacity': 0.14 } })
    map.addLayer({ id: 'wq-line', type: 'line', source: 'wq', paint: { 'line-color': '#f97316', 'line-width': 1.4, 'line-dasharray': [2, 1.5] } })
    // Violations (discharge permits only): red = pollution or evasion, orange = smaller, last three years.
    map.addLayer({
      id: 'records-vio', type: 'circle', source: 'records', filter: ['!=', ['get', 'vio'], ''],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 8.5, 14, 13],
        'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 3,
        'circle-stroke-color': ['match', ['get', 'vio'], 'red', VIO_COLORS.red, VIO_COLORS.orange],
      },
    })
    map.addLayer({
      id: 'records', type: 'circle', source: 'records',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 5, 14, 9],
        'circle-color': ['match', ['get', 'layer'], ...LAYERS.flatMap((l) => [l.id, l.color]), '#9ca3af'],
        // One meaning per dot (Josh 2026-10-13): fill = layer; a hollow ring in the layer's color = approximate
        // position. Status and the work window live in the popup and the panel filter, not on the dot.
        'circle-opacity': ['case', ['get', 'approx'], 0, 1],
        'circle-stroke-width': ['case', ['get', 'approx'], 3, 2],
        'circle-stroke-color': ['case', ['get', 'approx'], ['match', ['get', 'layer'], ...LAYERS.flatMap((l) => [l.id, l.color]), '#9ca3af'], '#ffffff'],
      },
    })
    // The permit type next to each dot once zoomed in (the legend explains the numbers).
    map.addLayer({
      id: 'records-tag', type: 'symbol', source: 'records', minzoom: 11.5, filter: ['!=', ['get', 'tag'], ''],
      layout: { 'text-field': ['get', 'tag'], 'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Regular'], 'text-size': 11,
        'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-allow-overlap': false, 'text-optional': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(10, 14, 23, 0.85)', 'text-halo-width': 1.4 },
    })
    applyWaters(map, off)
  }, [mapReady, styleLoads, waters, geojson, off])

  useEffect(() => { mapRef.current?.getSource('records')?.setData(geojson) }, [geojson])
  useEffect(() => { if (mapRef.current?.getLayer('wq-fill')) applyWaters(mapRef.current, off) }, [off, mapReady])

  // Open the shared record once data and map are ready (cold load from a link).
  const openedFromUrl = useRef(false)
  useEffect(() => {
    if (openedFromUrl.current || !mapReady || !data || !initial.r) return
    openedFromUrl.current = true
    openRecord(initial.r, !initialCamera)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data])

  // ─── URL state ────────────────────────────────────────────────────────────
  useEffect(() => {
    const sp = new URLSearchParams()
    if (basemap !== DEFAULT_BASEMAP) sp.set('bm', basemap)
    if (mapView) { sp.set('lat', mapView.lat.toFixed(4)); sp.set('lng', mapView.lng.toFixed(4)); sp.set('z', mapView.zoom.toFixed(1)) }
    if (selected) sp.set('r', selected)
    const offKey = [...off].sort().join(',')
    if (offKey !== DEFAULT_OFF.join(',')) sp.set('off', offKey || 'none')
    if (!allTime) sp.set('t', `${y0}-${y1}`)
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, mapView, selected, off, mapReady, y0, y1, allTime])

  // ─── Basemap switch ───────────────────────────────────────────────────────
  const appliedBasemapRef = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || appliedBasemapRef.current === basemap) return
    appliedBasemapRef.current = basemap
    setMapReady(false)
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
    document.title = 'PermitTracker: water permits, San Juan County · EarthAtlas'
    return () => { document.title = prev }
  }, [])

  const toggle = (id) => setOff((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const list = useMemo(() => [...visible].sort((a, b) =>
    latestPast(b).localeCompare(latestPast(a)) || a.name.localeCompare(b.name)), [visible])

  if (!MAPBOX_TOKEN) return <div className={q.container}><div className={q.tokenError}>Missing <code>VITE_MAPBOX_TOKEN</code>.</div></div>

  return (
    <div className={q.container}>
      <div className={q.mapWrap} ref={containerRef} />
      {mapReady && <ZoomIndicator map={mapRef.current} />}
      {mapReady && <ShareControl capture={captureShareImage} className={q.shareCtl} />}

      <div className={q.branding}>
        <a className={q.brandingLink} href="/" aria-label="EarthAtlas home"><span className={q.wordmark}>Earth<em>Atlas</em></span></a>
        <span className={`${q.subBadge} ${styles.subBadge}`}>PermitTracker</span>
      </div>

      <MapSearch className={q.searchBox}>
        <GeoSearch
          placeholder="Search a place…"
          proximity={() => { const c = mapRef.current?.getCenter(); return c ? { lng: c.lng, lat: c.lat } : undefined }}
          onSelect={(r) => mapRef.current && flyToSearchResult(mapRef.current, r)}
        />
      </MapSearch>

      <div className={q.basemapMenu} ref={basemapMenuRef}>
        <button className={basemapMenuOpen ? q.basemapToggleActive : q.basemapToggle} onClick={() => setBasemapMenuOpen((o) => !o)} aria-label="Choose basemap" title="Basemap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
        {basemapMenuOpen && (
          <div className={q.basemapMenuPanel}>
            <div className={q.basemapMenuTitle}>Basemap</div>
            {BASEMAPS.map((b) => (
              <button key={b.id} className={b.id === basemap ? q.basemapMenuItemActive : q.basemapMenuItem} onClick={() => { setBasemap(b.id); setBasemapMenuOpen(false) }}>
                <span className={q.basemapMenuItemLabel}>{b.label}</span>
                {b.id === basemap && <span className={q.basemapMenuCheck}>✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.infoTitle}>Water permits · San Juan Islands (San Juan County, WA)</div>
        {error ? <div className={styles.infoMeta}>{error}</div> : !data ? <div className={styles.infoMeta}>Loading…</div> : (
          <>
            <div className={styles.infoMeta}>
              Clean Water Act permits for work in and around the waters of the San Juan Islands: Army Corps permits to build
              in the water (404), Ecology’s water-quality sign-offs (401) and discharge permits (402), with their violations.
              Click a dot for its full record; every value links to its source.
            </div>

            <div className={styles.section}>
              <TimeSpan bounds={yearBounds} value={[y0, y1]} onChange={(v) => setSpan(v)} shown={timed.length} total={records.length} />
            </div>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>Permits, by Clean Water Act section</div>
              {LAYERS.map((l) => (
                <label key={l.id} className={styles.toggle} title={l.note}>
                  <input type="checkbox" checked={!off.has(l.id)} onChange={() => toggle(l.id)} />
                  <span className={styles.swatch} style={{ background: l.color }} />
                  <span className={styles.kind}><b>{l.label}</b> {l.desc}</span>
                  <span className={styles.count}>{counts[l.id]}</span>
                </label>
              ))}
              <div className={styles.legendHollow}><span className={styles.swatch} style={{ background: 'transparent', borderColor: VIO_COLORS.red, borderWidth: 2.5 }} />Red ring: discharged over a pollution limit, or repeatedly failed to report or sample (3+ times, last 3 years)<span className={styles.count}>{vioCounts.red}</span></div>
              <div className={styles.legendHollow}><span className={styles.swatch} style={{ background: 'transparent', borderColor: VIO_COLORS.orange, borderWidth: 2.5 }} />Orange ring: smaller violations (late reports, lab errors, a missed report or two)<span className={styles.count}>{vioCounts.orange}</span></div>
              <div className={styles.legendNote}>Only discharge permits (402) carry violation records; no ring on a 404 or 401 dot does not mean a clean record.</div>
              <div className={styles.legendHollow}><span className={styles.swatch} style={{ background: 'transparent', borderColor: LAYERS[0].color, borderWidth: 2 }} />Hollow dot: position approximate</div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Receiving waters</div>
              {WATERS.map((w) => (
                <label key={w.id} className={styles.toggle} title={w.note}>
                  <input type="checkbox" checked={!off.has(w.id)} onChange={() => toggle(w.id)} />
                  <span className={styles.swatchSq} style={{ background: w.color, opacity: 0.7 }} />{w.label}
                  <span className={styles.count}>{w.id === 'wq' ? data.meta.counts.wq303d : data.meta.counts.shellfish}</span>
                </label>
              ))}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Records, newest activity first</div>
              <div className={styles.list}>
                {list.map((r) => (
                  <button key={r.id} type="button" className={`${styles.item} ${r.id === selected ? styles.itemActive : ''}`} onClick={() => openRecord(r.id, true)}>
                    <span className={styles.itemDot} style={{ background: LAYERS.find((l) => l.id === r.layer)?.color }} />
                    <span><span className={styles.itemName}>{r.name}</span><br /><span className={styles.itemSub}>{r.type}</span></span>
                    <span className={styles.itemDate}>{fmtDate(latestPast(r))}</span>
                  </button>
                ))}
              </div>
            </div>

            {data.unmapped.length > 0 && <details className={`${styles.section} ${styles.details}`}>
              <summary>Not yet on the map ({data.unmapped.length})</summary>
              <div className={styles.infoMeta} style={{ margin: '4px 0' }}>2026 actions whose source gives no usable location yet.</div>
              {data.unmapped.map((u) => (
                <div key={u.name} className={styles.unmapped}>
                  <div className={styles.itemName}>{u.name}</div>
                  <div className={styles.itemSub}>{fmtDate(u.date)} · {u.applicant}</div>
                  <div className={styles.infoMeta}>{u.summary}{' '}
                    <a className={styles.source} href={docHref(data.docs, u.src)} {...(data.docs[u.src]?.url ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{u.srcLabel} ↗</a></div>
                </div>
              ))}
            </details>}

            <div className={styles.section}>
              <div className={styles.infoMeta}>
                Sources:{' '}
                <a className={styles.source} href="https://permits.ops.usace.army.mil/orm-public" target="_blank" rel="noopener noreferrer">U.S. Army Corps of Engineers permit database (404)</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/aquatics/status" target="_blank" rel="noopener noreferrer">Washington Dept. of Ecology water-quality certifications (401)</a>{' · '}
                <a className={styles.source} href="https://echo.epa.gov/facilities/facility-search" target="_blank" rel="noopener noreferrer">U.S. EPA discharge permits and violations (402)</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/paris/PermitSearch.aspx" target="_blank" rel="noopener noreferrer">Washington Dept. of Ecology discharge permit documents</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/waterqualityatlas/wqa/map" target="_blank" rel="noopener noreferrer">Washington Dept. of Ecology impaired waters</a>{' · '}
                <a className={styles.source} href="https://doh.wa.gov/bs/node/5891" target="_blank" rel="noopener noreferrer">Washington Dept. of Health shellfish growing areas</a>
              </div>
              <div className={styles.infoMeta} style={{ marginTop: 4 }}>
                Agency records read {fmtDate(data.meta.baked.slice(0, 10))} (updated weekly); hand-compiled 2026 records {fmtDate(data.meta.curated)}.
              </div>
            </div>

            <SourcesFooter intro={PERMITS_SOURCES_INTRO} sections={PERMITS_SOURCES} notes={PERMITS_SOURCES_NOTES} />
          </>
        )}
      </div>
    </div>
  )
}

function applyWaters(map, off) {
  const vis = (id) => (off.has(id) ? 'none' : 'visible')
  for (const l of ['wq-fill', 'wq-line']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis('wq'))
  for (const l of ['shell-fill', 'shell-line']) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis('shell'))
}

// "Activity" span for the panel top (panel standard: the time control sits above the datasets). Two handles on one
// track, plus quick spans; the count says how many records the span keeps.
function TimeSpan({ bounds, value, onChange, shown, total }) {
  const [lo, hi] = bounds, [a, b] = value
  const now = new Date().getFullYear()
  const quick = [['All', [lo, hi]], ['Since 2020', [2020, hi]], ['Last 3 years', [now - 2, hi]], ['This year', [now, hi]]]
  const pct = (y) => ((y - lo) / Math.max(1, hi - lo)) * 100
  const isAll = a <= lo && b >= hi
  return (
    <div className={styles.time}>
      <div className={styles.sectionTitle}>Activity <span className={styles.timeLabel}>{isAll ? `All years (${lo}–${hi})` : a === b ? a : `${a}–${b}`} · {shown} of {total} records</span></div>
      <div className={styles.timeTrack}>
        <div className={styles.timeFill} style={{ left: `${pct(a)}%`, width: `${pct(b) - pct(a)}%` }} />
        <input type="range" min={lo} max={hi} value={a} aria-label="From year" onChange={(e) => onChange([Math.min(+e.target.value, b), b])} />
        <input type="range" min={lo} max={hi} value={b} aria-label="To year" onChange={(e) => onChange([a, Math.max(+e.target.value, a)])} />
      </div>
      <div className={styles.timeQuick}>
        {quick.map(([label, v]) => (
          <button key={label} type="button" className={a === v[0] && b === v[1] ? styles.timeChipOn : styles.timeChip} onClick={() => onChange(v)}>{label}</button>
        ))}
      </div>
    </div>
  )
}
