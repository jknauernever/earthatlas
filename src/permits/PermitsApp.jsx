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
import { HABITATS, FACTOR_BY_ID, FRIENDS_LOGO, FRIENDS_PAGE, LIST_M, distanceWords } from './habitat.js'
import { QUESTION_BY_ID } from './dashboardLogic.js'
import { TIERS, GAPS } from './review.js'
import ProjectPicker from './ProjectPicker.jsx'
import { processOf, statusShown } from './process.js'
import { addFriendsHabitat, LAYERS_OF, CLICK_LAYERS } from '../friends/habitatOverlay.js'
import { buildFriendsHabitatPopup, installPopupFrameHandlers, preloadFriendsContent, POPUP_CLOSE_EVENT } from '../friends/habitatPopups.js'
import '../friends/ssx.css'
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
  { id: 'cert401', label: '401', desc: 'Washington State Department of Ecology’s water-quality sign-off', note: 'Washington State Department of Ecology’s water-quality sign-off: a Clean Water Act §401 certification of a federal permit, or a state order (Washington State Department of Ecology’s “administrative order” under RCW 90.48) for waters the U.S. Army Corps of Engineers doesn’t cover', color: '#a78bfa' },
  { id: 'structures', label: '404', desc: 'U.S. Army Corps of Engineers permit to build in the water', note: 'U.S. Army Corps of Engineers permit to build or place fill in the water (Clean Water Act §404 / Rivers and Harbors Act §10)', color: '#38bdf8' },
  { id: 'npdes', label: '402', desc: 'Discharge permit (sewage, stormwater, boatyards)', note: 'Discharge permit (Clean Water Act §402, NPDES), issued by Washington State Department of Ecology', color: '#f472b6' },
  { id: 'hpa', label: 'HPA', desc: 'Washington Department of Fish and Wildlife permit for work in or near water', note: 'Washington Department of Fish and Wildlife Hydraulic Project Approval (RCW 77.55) with no U.S. Army Corps of Engineers or Washington State Department of Ecology record found yet; from Washington Department of Fish and Wildlife’s own application search', color: '#2dd4bf' },
  { id: 'local', label: 'Other', desc: 'No permit record found yet', note: 'In-water work or a related county action with no 404, 401 or 402 record found', color: '#fbbf24' },
]
const VIO_COLORS = { red: '#ef4444', orange: '#fb923c' }
// Only permits show at county scale; waters and habitat appear from this zoom, all on (Josh 2026-10-15).
const HABITAT_MIN_ZOOM = 12
const DEFAULT_OFF = [] // sorted, as the URL writes them
const WATERS = [
  { id: 'wq', label: 'Impaired waters', note: 'Washington State Department of Ecology 303(d), Category 5', color: '#f97316' },
  { id: 'shell', label: 'Shellfish growing areas', note: 'Washington State Department of Health classification', color: '#4ade80' },
]
// Matched by substring in this order, so "Conditionally Approved" is caught before "Approved".
const SHELL_COLORS = { Conditionally: '#facc15', Prohibited: '#ef4444', Restricted: '#fb923c', Approved: '#4ade80' }

function readUrlState() {
  const sp = new URLSearchParams(window.location.search)
  const num = (k) => { const v = sp.get(k); return v == null || v === '' ? NaN : Number(v) }
  return { bm: sp.get('bm'), lat: num('lat'), lng: num('lng'), z: num('z'), r: sp.get('r'), off: sp.get('off'), t: sp.get('t'), q: sp.get('q') }
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
  if (d.map) parts.push(a(d.map, 'on Washington State Department of Ecology’s map ↗'))
  return `<div class="${styles.docLinks}">${parts.join(' · ')}</div>`
}
function agencyChip(tags, agency) {
  const [tag, full] = tags[agency] || [String(agency || '').toUpperCase(), agency]
  return `<span class="${styles.agency}">${escapeHtml(full || tag)}</span>`
}
// "In force" etc. for an ECHO status; EPA's own term on hover.
const ECHO_ALIAS = { 'admin continued': 'administratively continued' }
function statusPill(st) {
  if (!st.raw) return `<span class="${styles.pill} ${styles[st.cls]}">${escapeHtml(statusShown(st.label))}</span>`
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
  return (fs ? `<p class="${styles.docText}">${a(fs, 'Washington State Department of Ecology’s fact sheet')} explains what the facility discharges and how the permit’s limits were set${fs.date ? ` (${escapeHtml(fs.date)})` : ''}.</p>` : '') +
    `<ol class="${styles.events}">${shown.map((x) => `<li><span class="${styles.when}">${x.date ? fmtDate(x.date) : ''}</span><span>${escapeHtml(x.what)} ${a(x, 'PDF')}</span></li>`).join('')}</ol>` +
    (list.length > shown.length ? `<p class="${styles.docText}">${list.length - shown.length} older documents on Washington State Department of Ecology’s page.</p>` : '')
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
// Waters and habitat near the record's map point (habitat.js; attached by the bake as `near`), each with its own source:
// Ecology / DOH records for the waters, Friends for habitat (with the Friends logo, required wherever Friends data
// shows). Distances are from the map point, not the project footprint.
function factorsHtml(r, docs) {
  if (!r.near?.length && !r.receiving?.length) return ''
  const link = (href, text, local) => `<a class="${styles.popupLink}" href="${escapeHtml(href)}"${local ? '' : ' target="_blank" rel="noopener noreferrer"'}>${text}</a>`
  const rows = (r.near || []).map((x) => {
    const f = FACTOR_BY_ID[x.h]
    if (!f) return ''
    const href = f.friends ? FRIENDS_PAGE : docHref(docs, x.src)
    const src = href ? ` ${link(href, f.friends ? 'Friends ↗' : `${escapeHtml(docs[x.src]?.title || 'source')} ↗`, !f.friends && !docs[x.src]?.url)}` : ''
    return `<li><span class="${styles.habDot}" style="background:${f.color}"></span>` +
      `<span><b>${escapeHtml(f.short)}</b>, ${distanceWords(x.m)}${x.name ? ` <span class="${styles.whyNote}">(${escapeHtml(x.name)})</span>` : ''}` +
      `<span class="${styles.whyNote}">${src}</span></span></li>`
  }).join('')
  const friends = (r.near || []).some((x) => FACTOR_BY_ID[x.h]?.friends)
  // Discharge permits: waters named as their receiving water (the plant's map point is not its outfall).
  const recv = (r.receiving || []).map((x) => { const f = FACTOR_BY_ID[x.h]; const href = docHref(docs, x.src)
    return `<li><span class="${styles.habDot}" style="background:${f.color}"></span><span><b>${escapeHtml(f.short)}</b>, receives this discharge <span class="${styles.whyNote}">(${escapeHtml(x.name)})${href ? ` ${link(href, `${escapeHtml(docs[x.src]?.title || 'source')} ↗`, !docs[x.src]?.url)}` : ''}</span></span></li>` }).join('')
  return `<div class="${styles.habBox}"><div class="${styles.habHead}"><b>Waters and habitat within ${LIST_M} m</b>` +
    (friends ? `<a href="${FRIENDS_PAGE}" target="_blank" rel="noopener noreferrer"><img src="${FRIENDS_LOGO}" alt="Friends of the San Juans"></a>` : '') + `</div>` +
    `<ul class="${styles.habList}">${recv}${rows}</ul></div>`
}

// "Needs review" (review.js, attached by the bake): the gaps, the way to act, and any review marks.
const TIER_COLOR = { now: '#dc2626', watch: '#f59e0b', record: '#64748b' }
function reviewHtml(r) {
  const v = r.review
  if (!v) return ''
  return `<div class="${styles.reviewBox}" style="border-color:${TIER_COLOR[v.tier]}"><div><span class="${styles.tierPill}" style="background:${TIER_COLOR[v.tier]}">Needs review · ${TIERS[v.tier].label}</span></div>` +
    `<ul class="${styles.habList}">${v.gaps.map((g) => `<li title="${escapeHtml(GAPS[g.id])}"><span>${escapeHtml(g.text)}${g.mark ? ` <b>Reviewed: ${escapeHtml(g.mark.status)}${g.mark.note ? `, ${escapeHtml(g.mark.note)}` : ''}</b>` : ''}</span></li>`).join('')}</ul>` +
    `<div class="${styles.whyNote}">${escapeHtml(v.lever)}</div></div>`
}

// "Where it is" (process.js): one row per review track this record shows evidence of, each step done (dated, linked to
// its source), under way, not part of this path, or not in public records.
const STEP_MARK = { done: '●', now: '◐', na: '–', unknown: '○' }
function processHtml(r, docs) {
  const tracks = processOf(r)
  if (!tracks.length) return ''
  const src = (k) => { const href = k && docHref(docs, k); return href ? ` <a class="${styles.popupLink}" href="${escapeHtml(href)}"${docs[k]?.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>↗</a>` : '' }
  return `<details class="${styles.doc} ${styles.process}" open><summary>Where it is in the review process</summary>` + tracks.map((t) =>
    `<div class="${styles.track}"><div class="${styles.trackName}">${escapeHtml(t.label)}</div><ol class="${styles.steps}">` +
    t.steps.map((s) => `<li class="${styles['step_' + s.state]}" title="${escapeHtml(s.text || '')}"><span class="${styles.stepMark}">${STEP_MARK[s.state]}</span>` +
      `<span><b>${escapeHtml(s.name)}</b>${s.date ? ` ${fmtDate(s.date)}` : ''}` +
      (s.state === 'unknown' ? `<span class="${styles.whyNote}"> ${escapeHtml(s.text || 'not in public records we hold')}</span>`
        : s.text && s.text !== s.name ? `<span class="${styles.whyNote}"> ${escapeHtml(s.text)}</span>` : '') + `${src(s.src)}</span></li>`).join('') +
    `</ol>${t.note ? `<div class="${styles.whyNote}">${escapeHtml(t.note)}</div>` : ''}</div>`).join('') +''
}

// What the WDFW permit at this site says about the forage fish spawning nearby (scripts/permits/hpa-conditions.mjs,
// attached by the bake as `conditions`): for each species whose spawning beach or area is near the point, the
// provision that names it, quoted, or that none does. States the permit's words only; never judges them sufficient.
const SPECIES_NEAR = [['smelt', 'Surf smelt', /surf smelt/i], ['sandlance', 'Pacific sand lance', /sand lance/i]]
function conditionsHtml(r) {
  if (!r.conditions?.length) return ''
  const near = []
  for (const x of r.near || []) {
    if (x.h === 'hhe') near.push(['herring', 'Pacific herring', `spawning area ${distanceWords(x.m)}`])
    if (x.h === 'hfd') for (const [k, label, re] of SPECIES_NEAR) if (re.test(x.name || '')) near.push([k, label, `documented spawning beach ${distanceWords(x.m)}`])
  }
  const seen = new Set(), species = near.filter(([k]) => !seen.has(k) && seen.add(k))
  const a = (href, text) => `<a class="${styles.popupLink}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
  return r.conditions.map((c) => `<div class="${styles.habBox}"><div class="${styles.habHead}"><b>Spawning-season conditions in Washington Department of Fish and Wildlife permit ${escapeHtml(c.permit)}</b></div>` +
    `<div class="${styles.whyNote}">Hydraulic Project Approval issued ${fmtDate(c.issued)} · ${a(c.file, 'the permit ↗')} · ${a(c.record, 'Washington Department of Fish and Wildlife record ↗')}</div>` +
    (species.length ? `<ul class="${styles.habList}">${species.map(([k, label, where]) => {
      const q = c.species?.[k]
      return `<li><span><b>${label}</b> (${where}): ${q ? `provision ${q.provision}, “${escapeHtml(q.quote)}”` : `<b>not named in the permit.</b>`}</span></li>`
    }).join('')}</ul>` : '') +
    (c.timing?.length ? `<div><b>Work window:</b> ${escapeHtml(c.timing[0].split(/(?<=\.)\s/)[0])}</div>` : `<div><b>No timing limitation in the permit.</b></div>`) +
    // Survey files: named as WDFW lists them, each linked; what each says is quoted from its own text, never inferred.
    (c.surveys?.length
      ? `<div><b>Files in Washington Department of Fish and Wildlife’s record named as forage fish surveys:</b></div><ul class="${styles.habList}">${c.surveys.map((f) => `<li><span>${a(f.url, `${escapeHtml(f.name)} ↗`)}: ` +
        (f.permitCopy ? 'a copy of the permit, not a survey.'
          : f.image ? 'photo or scan.'
          : `${f.dates?.length ? `dated ${escapeHtml(f.dates[0])}; ` : ''}${f.result ? `the file says “${escapeHtml(f.result)}”${f.ocr ? ' (read by OCR)' : ''}.` : 'no egg result stated in its text.'}`) + `</span></li>`).join('')}</ul>`
      : `<div>No file in Washington Department of Fish and Wildlife’s record is named as a forage fish survey.</div>`) +
    `<div class="${styles.whyNote}">Read ${fmtDate(c.read)}.</div></div>`).join('')
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
    reviewHtml(r) +
    `<div class="${styles.place}">${statusPill(r.status)} ${place} · <a class="${styles.popupLink}" href="/permits/report/${encodeURIComponent(r.id)}" target="_blank" rel="noopener noreferrer">Printable report ↗</a></div>` +
    whatHtml(r, docs) + processHtml(r, docs) + factorsHtml(r, docs) + conditionsHtml(r) +
    (r.violations ? `<div class="${styles.vioLine}" style="border-color:${VIO_COLORS[r.violations.level]}"><b>Violations since ${escapeHtml(r.violations.since)}:</b> ` +
      [[r.violations.pollution, 'over a pollution limit'], [r.violations.evasion, 'reports or samples never done'], [r.violations.minor, 'smaller (late, lab errors, capacity)']]
        .filter(([n]) => n).map(([n, w]) => `${n} ${w}`).join(' · ') + `</div>` : '') +
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
      `<p class="${styles.docText}">Washington State Department of Health’s yearly review of this growing area: sampling results and the reasons for its classification.</p>${docLinks(docs, p.report)}</details>` : '') +
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
  const [habitat, setHabitat] = useState(null)
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
  // A dashboard question (?q=, dashboardLogic.js): the map shows only the records that answer it.
  const [qf, setQf] = useState(() => (QUESTION_BY_ID[initial.q] ? initial.q : null))
  const [off, setOff] = useState(() => new Set(initial.off == null ? DEFAULT_OFF : initial.off.split(',').filter((x) => x && x !== 'none')))

  // ─── Data ─────────────────────────────────────────────────────────────────
  useEffect(() => { installPopupFrameHandlers(); preloadFriendsContent() }, [])
  useEffect(() => {
    Promise.all(['permits.json', 'wq303d.geojson', 'shellfish.geojson'].map(fetchPermitsJson))
      .then(([d, wq, shell]) => { setData(d); setWaters({ wq, shell }) })
      .catch((e) => setError(`Could not load permit data (${e.message}).`))
    // Static with the site (scripts/permits/import-friends-habitat.mjs), not part of the weekly Blob bake.
    fetch('/permits-data/friends-habitat.geojson').then((r) => (r.ok ? r.json() : null)).then(setHabitat).catch(() => {})
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
  const visible = useMemo(() => timed.filter((r) => !off.has(r.layer) && (!qf || QUESTION_BY_ID[qf].test(r))), [timed, off, qf])
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
  // A Friends habitat feature: Salish Sea Explorer's own popup (src/friends/habitatPopups.js), plus the Friends logo
  // in its footer (required wherever Friends data shows).
  const showHabitatPopup = useCallback((lngLat, props) => {
    const map = mapRef.current
    if (!map) return
    const { mid, lengthRank, ...own } = props // eslint-disable-line no-unused-vars
    const html = () => buildFriendsHabitatPopup(own.h, own).replace('<div class="ssx-foot">',
      `<div class="ssx-foot"><a class="ssx-friends" href="${FRIENDS_PAGE}" target="_blank" rel="noopener noreferrer"><img src="${FRIENDS_LOGO}" alt="Friends of the San Juans"></a>`)
    popupRef.current?.remove()
    const popup = new mapboxgl.Popup({ className: 'ssx-host', maxWidth: '380px', closeButton: false, offset: 10 }).setLngLat(lngLat).setHTML(html()).addTo(map)
    const close = () => popup.remove()
    window.addEventListener(POPUP_CLOSE_EVENT, close)
    popup.on('close', () => window.removeEventListener(POPUP_CLOSE_EVENT, close))
    preloadFriendsContent().then(() => { if (popup.isOpen()) popup.setHTML(html()) })
    popupRef.current = keepPopupOnMap(popup)
    setSelected(null)
  }, [])
  const showHabitatPopupRef = useRef(showHabitatPopup)
  showHabitatPopupRef.current = showHabitatPopup
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
    // North-up and flat: the Friends habitat overlays are painted in screen space (as on Salish Sea Explorer).
    map.dragRotate.disable(); map.touchZoomRotate.disableRotation(); map.setMaxPitch(0)
    map.on('zoom', () => thinPinsRef.current?.())
    map.on('moveend', () => { const c = map.getCenter(); setMapView({ lat: c.lat, lng: c.lng, zoom: map.getZoom() }) })
    for (const id of ['records', 'wq-fill', 'shell-fill']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }
    // Points sit above polygons: one click opens only the topmost thing.
    map.on('click', 'records', (e) => { const f = e.features?.[0]; if (f) openRecordRef.current(f.properties.id, false) })
    const habitatAt = (e) => map.queryRenderedFeatures(e.point, { layers: CLICK_LAYERS.filter((l) => map.getLayer(l)) })[0]
    map.on('click', (e) => {
      if (map.getLayer('records') && map.queryRenderedFeatures(e.point, { layers: ['records'] }).length) return
      const f = habitatAt(e)
      if (f) showHabitatPopupRef.current(e.lngLat, f.properties)
    })
    for (const id of CLICK_LAYERS) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = '' })
    }
    // Points sit above habitat, habitat above receiving waters: one click opens only the topmost thing.
    const pointHit = (e) => (map.getLayer('records') && map.queryRenderedFeatures(e.point, { layers: ['records'] }).length > 0) || !!habitatAt(e)
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
    map.addLayer({ id: 'shell-fill', minzoom: HABITAT_MIN_ZOOM, type: 'fill', source: 'shell', paint: { 'fill-color': shellColor, 'fill-opacity': 0.18 } })
    map.addLayer({ id: 'shell-line', minzoom: HABITAT_MIN_ZOOM, type: 'line', source: 'shell', paint: { 'line-color': shellColor, 'line-width': 1.2, 'line-opacity': 0.8 } })
    map.addLayer({ id: 'wq-fill', minzoom: HABITAT_MIN_ZOOM, type: 'fill', source: 'wq', paint: { 'fill-color': '#f97316', 'fill-opacity': 0.14 } })
    map.addLayer({ id: 'wq-line', minzoom: HABITAT_MIN_ZOOM, type: 'line', source: 'wq', paint: { 'line-color': '#f97316', 'line-width': 1.4, 'line-dasharray': [2, 1.5] } })
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
  }, [mapReady, styleLoads, waters, geojson, off]) // eslint-disable-line react-hooks/exhaustive-deps

  // Friends habitat, drawn as Salish Sea Explorer draws it (src/friends/habitatOverlay.js), under the permit dots.
  const thinPinsRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !habitat || styledMapRef.current !== map || !map.getLayer('records-vio') || map.getSource('fhab')) return
    thinPinsRef.current = addFriendsHabitat(map, habitat, 'records-vio', { minZoom: HABITAT_MIN_ZOOM })
    applyWaters(map, off)
  }, [mapReady, styleLoads, habitat, waters]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (qf) sp.set('q', qf)
    writeUrlQuery(sp.toString())
    if (mapReady) scheduleViewCard(captureShareImage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, mapView, selected, off, mapReady, y0, y1, allTime, qf])

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
  const [pickerOpen, setPickerOpen] = useState(false)

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

      {/* Projects pill — /ships' ShipPicker construct: find a project by name, applicant, number or place. */}
      {data && <ProjectPicker records={records} layers={LAYERS} picked={selected ? byId.get(selected)?.name : null}
        onPick={(r) => { setPickerOpen(false); openRecord(r.id, true) }} open={pickerOpen} onOpen={setPickerOpen} />}

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
              Clean Water Act permits for work in and around the waters of the San Juan Islands: U.S. Army Corps of Engineers permits to build
              in the water (404), Washington State Department of Ecology’s water-quality sign-offs (401) and discharge permits (402), with their violations.
              Click a dot for its full record; every value links to its source.{' '}
              <a className={styles.source} href="/permits/dashboard">Open the dashboard →</a>
            </div>
            {qf && <div className={styles.qBanner}>
              <span>Showing: <b>{QUESTION_BY_ID[qf].title}</b> ({visible.length})</span>
              <a className={styles.source} href={`/permits/dashboard?q=${qf}`}>Dashboard</a>
              <button type="button" className={styles.qClear} onClick={() => setQf(null)}>Show all</button>
            </div>}

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
              {/* Receiving waters and habitat are weighed alike in a permit decision (Josh 2026-10-15): one section. */}
              <div className={styles.sectionTitle}>Waters and habitat{(mapView?.zoom ?? DEFAULT_VIEW.zoom) < HABITAT_MIN_ZOOM && <span className={styles.timeLabel}> · shows from zoom {HABITAT_MIN_ZOOM}</span>}</div>
              {WATERS.map((w) => (
                <label key={w.id} className={styles.toggle} title={w.note}>
                  <input type="checkbox" checked={!off.has(w.id)} onChange={() => toggle(w.id)} />
                  <span className={styles.swatchSq} style={{ background: w.color, opacity: 0.7 }} />{w.label}
                  <span className={styles.count}>{w.id === 'wq' ? data.meta.counts.wq303d : data.meta.counts.shellfish}</span>
                </label>
              ))}
              {HABITATS.map((h) => (
                <label key={h.id} className={styles.toggle} title={h.credit}>
                  <input type="checkbox" checked={!off.has(h.id)} onChange={() => toggle(h.id)} />
                  <span className={h.kind === 'fill' ? styles.swatchSq : styles.swatchLine} style={{ background: h.color, opacity: h.kind === 'fill' ? 0.7 : 1 }} />{h.label}
                </label>
              ))}
              <a className={styles.friendsCredit} href={FRIENDS_PAGE} target="_blank" rel="noopener noreferrer">
                <img src={FRIENDS_LOGO} alt="" />Habitat maps courtesy of Friends of the San Juans
              </a>
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
                <a className={styles.source} href="https://apps.ecology.wa.gov/aquatics/status" target="_blank" rel="noopener noreferrer">Washington Dept. of Washington State Department of Ecology water-quality certifications (401)</a>{' · '}
                <a className={styles.source} href="https://echo.epa.gov/facilities/facility-search" target="_blank" rel="noopener noreferrer">U.S. EPA discharge permits and violations (402)</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/paris/PermitSearch.aspx" target="_blank" rel="noopener noreferrer">Washington Dept. of Washington State Department of Ecology discharge permit documents</a>{' · '}
                <a className={styles.source} href="https://apps.ecology.wa.gov/waterqualityatlas/wqa/map" target="_blank" rel="noopener noreferrer">Washington Dept. of Washington State Department of Ecology impaired waters</a>{' · '}
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
  for (const [h, ids] of Object.entries(LAYERS_OF)) for (const l of ids) if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', vis(h))
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
