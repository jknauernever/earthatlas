/**
 * EarthAtlas /permits (PermitTracker): Clean Water Act permits and related actions in San Juan County, WA, 2026.
 * Data: public/permits-data/permits.json + wq303d.geojson + shellfish.geojson, baked by scripts/permits/bake-permits.mjs from
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
import { PERMITS_SOURCES, PERMITS_SOURCES_INTRO, PERMITS_SOURCES_NOTES } from './permitsSources.js'
import q from '../quakes/QuakesApp.module.css'
import styles from './PermitsApp.module.css'

installPopupSheet()

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const DATA_URL = '/permits-data/permits.json'
const WQ_URL = '/permits-data/wq303d.geojson'
const SHELL_URL = '/permits-data/shellfish.geojson'
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
const LAYERS = [
  { id: 'structures', label: 'Fill, dredge & in-water structures', note: 'Corps §404/§10 and Ecology §401', color: '#38bdf8' },
  { id: 'npdes', label: 'Discharge permits', note: 'NPDES (§402)', color: '#f472b6' },
  { id: 'local', label: 'Local & related actions', note: 'Town, county', color: '#fbbf24' },
]
const WATERS = [
  { id: 'wq', label: 'Impaired waters', note: 'Ecology 303(d), Category 5', color: '#f97316' },
  { id: 'shell', label: 'Shellfish growing areas', note: 'DOH classification', color: '#4ade80' },
]
// Matched by substring in this order, so "Conditionally Approved" is caught before "Approved".
const SHELL_COLORS = { Conditionally: '#facc15', Prohibited: '#ef4444', Restricted: '#fb923c', Approved: '#4ade80' }

function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); return v == null || v === '' ? NaN : Number(v) }
  return { bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), r: sp.get('r'), off: sp.get('off'), win: sp.get('win') }
}
function writeUrlQuery(qs) {
  const url = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash
  if (url === window.location.pathname + window.location.search + window.location.hash) return
  window.history.replaceState(window.history.state, '', url)
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
const fmtDate = (d) => {
  if (!d) return ''
  const p = d.split('-')
  if (p.length < 3) return d
  return `${+p[2]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+p[1] - 1]} ${p[0]}`
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
// A doc's readable link: the agency's own page, else EarthAtlas's source-record page (never raw JSON).
const recordPage = (key) => `/permits/source/${encodeURIComponent(key)}`
const docHref = (docs, key) => {
  const d = docs[key]
  return d ? d.url || (d.record ? recordPage(key) : null) : null
}
const OPEN_LABEL = { PDF: 'Open the PDF', Page: 'Open the page', Record: 'Open the record' }
function docLinks(docs, key) {
  const d = docs[key]
  if (!d) return ''
  const a = (href, label, local) => `<a class="${styles.popupLink}" href="${escapeHtml(href)}"${local ? '' : ' target="_blank" rel="noopener noreferrer"'}>${label}</a>`
  const parts = []
  if (d.url) parts.push(a(d.url, `${OPEN_LABEL[d.kind] || 'Open'} ↗`))
  if (d.record) parts.push(a(recordPage(key), d.url ? 'as EarthAtlas read it' : 'Open the record as EarthAtlas read it ↗', true))
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


// ─── "Why it needs a permit": EarthAtlas's plain summary of the law behind each record (Josh 2026-10-13: "how would a
// user know what any of these have to do with the Clean Water Act?"). Each line links the law itself. Which laws apply
// is read from the record's own documents and type; nothing is guessed beyond what the line says. ───
const LAW = {
  s10: ['Rivers and Harbors Act §10', 'https://www.law.cornell.edu/uscode/text/33/403'],
  s404: ['Clean Water Act §404', 'https://www.law.cornell.edu/uscode/text/33/1344'],
  s402: ['Clean Water Act §402', 'https://www.law.cornell.edu/uscode/text/33/1342'],
  s401: ['Clean Water Act §401', 'https://www.law.cornell.edu/uscode/text/33/1341'],
  s408: ['33 U.S.C. §408', 'https://www.law.cornell.edu/uscode/text/33/408'],
  czma: ['Coastal Zone Management Act §307', 'https://www.law.cornell.edu/uscode/text/16/1456'],
  mmpa: ['Marine Mammal Protection Act §101', 'https://www.law.cornell.edu/uscode/text/16/1371'],
  nepa: ['National Environmental Policy Act §102', 'https://www.law.cornell.edu/uscode/text/42/4332'],
  sma: ['Washington Shoreline Management Act', 'https://app.leg.wa.gov/rcw/default.aspx?cite=90.58'],
  hpa: ['Washington Hydraulic Code', 'https://app.leg.wa.gov/rcw/default.aspx?cite=77.55'],
}
const law = (k) => `<a class="${styles.popupLink}" href="${LAW[k][1]}" target="_blank" rel="noopener noreferrer">${LAW[k][0]} ↗</a>`
function whyLines(r, docs) {
  const lines = []
  const titles = Object.keys(docs).filter((k) => JSON.stringify(r).includes(`"${k}"`)).map((k) => docs[k].title).join(' | ')
  const events = (r.trail || []).map((t) => t.event).join(' | ')
  if (r.layer === 'npdes') {
    const water = (r.facts || []).find((f) => f.label === 'Receiving water')?.value
    const what = /stormwater/i.test(r.type) ? 'Stormwater that runs off this site' : /wastewater/i.test(r.type) ? 'Treated wastewater from this plant' : 'Water this operation releases'
    lines.push(`${what} goes to ${water ? escapeHtml(water) : 'a water body'}. Discharging pollutants to water needs a permit under ${law('s402')} (NPDES); in Washington, Ecology issues it, under its own water pollution law as well.`)
  }
  const corps = r.corpsKind || (/Army Corps/.test(titles) ? 'curated' : null)
  if (corps === 's408') lines.push(`Changing anything built by a federal Corps project${r.civilWorks ? ` (here: ${escapeHtml(r.civilWorks)})` : ''} needs Corps permission under ${law('s408')}. The Corps decided none was needed here.`)
  else if (corps === 'jds' || /jurisdictional determination/i.test(titles)) lines.push(`A jurisdictional determination is the Corps’ ruling on whether a site holds “waters of the United States”; that decides whether ${law('s404')} applies to work there.`)
  else if (corps) lines.push(`Building in or over navigable water (docks, piles, floats, buoys, cables) needs an Army Corps permit under ${law('s10')}; putting fill or dredged material in water needs one under ${law('s404')}.${r.corpsKind ? ' The Corps record does not say which applies here.' : ''}`)
  if (corps === 'nepa_ea' || /environmental assessment/i.test(`${titles} ${events}`)) lines.push(`For a permit with possible significant effects, the Corps writes an environmental assessment under ${law('nepa')}.`)
  if (/401 certification/i.test(titles)) lines.push(`Before the Corps can issue its permit, Ecology must certify under ${law('s401')} that the work will meet Washington’s water quality standards.`)
  if (/Coastal Zone/i.test(titles)) lines.push(`Ecology also decides whether a federal permit is consistent with Washington’s coastal program (${law('czma')}).`)
  if (/marine mammal|incidental take/i.test(`${titles} ${events}`)) lines.push(`In-water noise from pile work can harm marine mammals; NOAA Fisheries authorizes that “incidental take” under ${law('mmpa')}.`)
  if (/shoreline/i.test(`${events} ${titles}`) || r.docks?.some((d) => d.permits.some((x) => x.agency === 'county'))) lines.push(`Work on Washington’s shorelines needs county (or town) approval under the ${law('sma')}.`)
  if (/WDFW|HPA/i.test(events) || r.docks?.some((d) => d.permits.some((x) => x.agency === 'wdfw'))) lines.push(`Work in or near salt or fresh water needs a WDFW Hydraulic Project Approval under the ${law('hpa')}.`)
  if (!lines.length) lines.push(`Not a permit itself: a related ${escapeHtml(String(r.type).toLowerCase())} step on the shore. Any in-water work it leads to needs the permits above (${law('s10')}, ${law('s404')}, ${law('s401')}).`)
  return lines
}
function whyHtml(r, docs) {
  return `<div class="${styles.why}"><div class="${styles.whyTitle}">Why it needs a permit <span>EarthAtlas’s summary of the law</span></div>` +
    `<ul>${whyLines(r, docs).map((l) => `<li>${l}</li>`).join('')}</ul></div>`
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
  return `<p class="${styles.docText}">Matched by EarthAtlas, not by the agencies: this dock lies ${d.m} m away and its permits name the same surname or company (${escapeHtml(d.shared.join(', '))}).</p>` +
    `<ol class="${styles.events}">${d.permits.slice(0, 15).map((x) => `<li><span class="${styles.when}">${x.date ? fmtDate(x.date) : ''}</span><span>` +
      `${agencyChip(tags, x.agency)}${escapeHtml(x.what)}${x.number ? ` <span class="${styles.num}">${escapeHtml(x.number)}</span>` : ''}${x.status ? ` · ${escapeHtml(String(x.status).toLowerCase())}` : ''}</span></li>`).join('')}</ol>` +
    (d.permits.length > 15 ? `<p class="${styles.docText}">${d.permits.length - 15} more on EarthAtlas Docks.</p>` : '')
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
      `${t.agency !== d.agency ? agencyChip(tags, t.agency) : ''}${escapeHtml(t.event)}</span></li>`).join('')
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
    `<div class="${styles.place}">${statusPill(r.status)} ${place}</div>` +
    whyHtml(r, docs) +
    `<div class="${styles.popupCount}">${items.length} source document${items.length === 1 ? '' : 's'} from ${agencyCount} publisher${agencyCount === 1 ? '' : 's'}, by date</div>` +
    html + flags +
    (joins.length ? `<div class="${styles.joins}"><b>Linked records:</b> ${joins.join(' · ')}</div>` : '') +
    `<div class="${styles.matchNote}">${escapeHtml(r.position.text)}` +
    (posHref ? ` <a class="${styles.popupLink}" href="${escapeHtml(posHref)}"${docs[r.position.src].url ? ' target="_blank" rel="noopener noreferrer"' : ''}>${escapeHtml(docs[r.position.src].title)} ↗</a>` : '') +
    `</div></div>`
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
  const [off, setOff] = useState(() => new Set((initial.off || '').split(',').filter(Boolean)))
  const [onlyWindow, setOnlyWindow] = useState(initial.win === '1')

  // ─── Data ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([DATA_URL, WQ_URL, SHELL_URL].map((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json() })))
      .then(([d, wq, shell]) => { setData(d); setWaters({ wq, shell }) })
      .catch((e) => setError(`Could not load permit data (${e.message}).`))
  }, [])

  const records = useMemo(() => (data ? [...data.projects, ...data.npdes] : []), [data])
  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records])
  const unmappedById = useMemo(() => new Map((data?.unmapped || []).filter((u) => u.id).map((u) => [u.id, u])), [data])
  const visible = useMemo(() => records.filter((r) => !off.has(r.layer) && (!onlyWindow || windowOpen(r))), [records, off, onlyWindow])
  const counts = useMemo(() => Object.fromEntries(LAYERS.map((l) => [l.id, records.filter((r) => r.layer === l.id).length])), [records])

  const geojson = useMemo(() => ({
    type: 'FeatureCollection',
    features: visible.map((r) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: { id: r.id, layer: r.layer, approx: !!r.approx },
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
    if (off.size) sp.set('off', [...off].sort().join(','))
    if (onlyWindow) sp.set('win', '1')
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, mapView, selected, off, onlyWindow, mapReady])

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
  const nOpen = records.filter(windowOpen).length

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
        <div className={styles.infoTitle}>Water permits · San Juan County</div>
        {error ? <div className={styles.infoMeta}>{error}</div> : !data ? <div className={styles.infoMeta}>Loading…</div> : (
          <>
            <div className={styles.infoMeta}>
              Clean Water Act permits and the actions around them, joined across the Corps, Ecology, EPA, WDFW, the county,
              the town and NOAA. Click a point for its full record; every value links to its source.
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>Permits and actions</div>
              {LAYERS.map((l) => (
                <label key={l.id} className={styles.toggle} title={l.note}>
                  <input type="checkbox" checked={!off.has(l.id)} onChange={() => toggle(l.id)} />
                  <span className={styles.swatch} style={{ background: l.color }} />{l.label}
                  <span className={styles.count}>{counts[l.id]}</span>
                </label>
              ))}
              <label className={styles.toggle}>
                <input type="checkbox" checked={onlyWindow} onChange={(e) => setOnlyWindow(e.target.checked)} />
                In-water work window open today
                <span className={styles.count}>{nOpen}</span>
              </label>
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
                <a className={styles.source} href="https://permits.ops.usace.army.mil/orm-public" target="_blank" rel="noopener noreferrer">Army Corps permits ↗</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/aquatics/decisions/" target="_blank" rel="noopener noreferrer">Ecology Aquatics decisions ↗</a>{' · '}
                <a className={styles.source} href="https://echo.epa.gov/facilities/facility-search" target="_blank" rel="noopener noreferrer">EPA ECHO ({data.meta.counts.npdes} discharge permits) ↗</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/waterqualityatlas/wqa/map" target="_blank" rel="noopener noreferrer">Ecology Water Quality Atlas ↗</a>{' · '}
                <a className={styles.source} href="https://doh.wa.gov/bs/node/5891" target="_blank" rel="noopener noreferrer">DOH shellfish growing areas ↗</a>
              </div>
              <div className={styles.infoMeta} style={{ marginTop: 4 }}>
                Live layers read {fmtDate(data.meta.baked.slice(0, 10))}; hand-compiled records {fmtDate(data.meta.curated)}.
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
