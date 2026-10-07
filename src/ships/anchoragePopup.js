/**
 * Anchorage areas on the /ships map (Josh 2026-09-30): the layer style and the popup a click opens (api/ships op=anchorage,
 * lib/ships/anchorageCard.js). Every figure carries its own source link: the area's record, each alias's record, and the bake
 * record behind the stays EarthAtlas counted from MarineCadastre AIS (lib/ships/anchorageStays.js).
 */
import { fmtMonth } from './TrackControls.jsx'

export const ANCHORAGE_SRC = 'anchorages'
export const ANCHORAGE_FILL = 'anchorages-fill'
export const ANCHORAGE_LINE = 'anchorages-line'
export const ANCHORAGE_LABEL = 'anchorages-label' // clickable name: wins over the tracks crossing the area (as a port marker does)
export const ANCHORAGE_LABEL_MINZOOM = 10
export const ANCHORAGE_MINZOOM = 8
export const ANCHORAGE_COLOR = '#e0f2fe'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const n = (x) => Number(x).toLocaleString('en-US')
const rec = (id, text, title) => (id ? `<a href="/ships/source/${id}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">${esc(text)}</a>` : esc(text))
export const SRC_SHORT = { 'noaa-mc-anchorages': 'USCG/NOAA', 'dfo-pacific-commercial-anchorages': 'DFO', 'uscg-vts-ps-nondesignated': '82 FR 10313' }
export const ALIAS_SHORT = { 'uscg-vts-ps-users-manual': 'USCG VTS manual', 'gfw-anchorage-overrides': 'GFW', 'gfw-port-visits': 'GFW', 'nga-wpi': 'WPI' }

export function statusWords(a) {
  if (a.no_anchoring) return 'No-anchoring area'
  if (a.legal_status === 'designated') return `Anchorage · designated${a.citation ? ` (${a.citation.replace(/^33 CFR /, '33 CFR ')})` : ''}`
  if (a.legal_status === 'active_listed') return 'Anchorage · DFO active list'
  return 'Anchorage · non-designated'
}
/** What the area's boundary comes from, in words (the card and the popup share it). */
export function areaWhat(a) {
  return a.source_id === 'noaa-mc-anchorages' ? 'MarineCadastre “Anchorages” polygon (NOAA Office for Coastal Management and U.S. Coast Guard, from 33 CFR; public domain)'
    : a.source_id === 'dfo-pacific-commercial-anchorages' ? `Fisheries and Oceans Canada “Active Commercial Shipping Anchorages in Pacific Canada” point (OGL-Canada 2.0); the circle of its ${a.radius_m} m swing radius is drawn by EarthAtlas`
      : `the Coast Guard’s WITHDRAWN 2017 proposed rule (82 FR 10313, withdrawn 2018-04-27): the Vessel Traffic Service uses this anchorage, but it was never designated in law. ${a.boundary_note || ''}`
}
function areaSource(a) {
  return rec(a.source_record_id, SRC_SHORT[a.source_id] || a.source_id, `Area from ${areaWhat(a)} — click for the record as received`)
}
export function aliasTitle(x) {
  if (x.sourceId === 'uscg-vts-ps-users-manual') return `The name and code the Coast Guard’s Puget Sound Vessel Traffic Service uses for this anchorage: VTS Puget Sound User’s Manual (2024), p. ${x.page || '3-6'}, “Puget Sound Anchorages – Quick Reference Sheet” — click for the record (with the manual’s link)`
  if (x.sourceId === 'gfw-anchorage-overrides' && x.method?.startsWith('gfw_override_group')) {
    return `Global Fishing Watch’s reviewed anchorage-name list (pipe-anchorages, Apache-2.0) files a point inside this area under “${x.alias}”, so GFW port visits here are reported as ${x.alias}. The point’s own label in that list is a code. Click for the row`
  }
  if (x.sourceId === 'gfw-anchorage-overrides') return `Global Fishing Watch’s reviewed anchorage-name list names a point inside this area “${x.alias}” — click for the row`
  if (x.sourceId === 'gfw-port-visits') return `Global Fishing Watch’s port-visit events name a point inside this area “${x.alias}” — click for an event carrying it`
  return `${x.sourceName || x.sourceId} — click for the record`
}

const period = (months) => (months.length === 1 ? fmtMonth(months[0]) : `${fmtMonth(months[0])} – ${fmtMonth(months[months.length - 1])}`)

function staysHTML(s, months, st) {
  const bake = s.bake
  const rule = s.rule || { sogKn: 0.5, minMinutes: 60, gapHours: 6 }
  const src = (text = 'MarineCadastre AIS') => `<a href="${bake ? `/ships/source/${bake.recordId}` : 'https://hub.marinecadastre.gov/pages/vesseltraffic'}" target="_blank" rel="noopener noreferrer" title="Counted by EarthAtlas from MarineCadastre AIS positions (CC0): a ship reporting under ${rule.sogKn} kn inside this area for ${rule.minMinutes} minutes or more; a gap of more than ${rule.gapHours} h starts a new stay — click for the bake record">${esc(text)}</a>`
  if (s.coverage === 'no_anchoring') return `<div class="${st.popupMeta}">Anchoring is not allowed here, so no stays are counted.</div>`
  if (s.coverage === 'no_boundary') return `<div class="${st.popupMeta}">No boundary is published for this area, so stays can’t be counted.</div>`
  if (s.coverage === 'not_loaded') return `<div class="${st.popupMeta}">Stays haven’t been counted here yet.</div>`
  if (s.coverage === 'not_covered') return `<div class="${st.popupMeta}">Outside the area our AIS positions cover, so stays aren’t counted here (not zero). ${src()}</div>`
  if (!s.months.covered.length) return `<div class="${st.popupMeta}">No AIS positions for ${esc(period(months))} yet (we have ${esc(fmtMonth(s.aisFrom))} – ${esc(fmtMonth(s.aisTo))}), so nothing is counted for these months (not zero). ${src()}</div>`
  const x = s.summary
  const missing = s.months.missing.length ? ` · ${s.months.covered.length} of ${months.length} months have AIS so far` : ''
  let h = `<div class="${st.popupRow}"><span class="${st.popupK}">Stays</span><span class="${st.popupV}">${n(x.stays)} by ${n(x.ships)} ship${x.ships === 1 ? '' : 's'} ${src('AIS')}</span></div>` +
    `<div class="${st.popupRow}"><span class="${st.popupK}">Ship-hours stopped here</span><span class="${st.popupV}">${n(x.hours)} h ${src('AIS')}</span></div>`
  if (x.kinds.length) {
    h += `<div class="${st.popupMeta}" title="Ships of each kind: EarthAtlas’s classification from its ship records, else the type the ship broadcast (AIS)">Ships by kind: ${x.kinds.slice(0, 5).map((k) => `${esc(k.label)} ${n(k.ships)}`).join(' · ')}${x.kinds.length > 5 ? ' · …' : ''} ${src('AIS')}</div>`
  }
  h += `<div class="${st.popupMeta}">${esc(period(s.months.covered))}: ships stopped (under ${rule.sogKn} kn) inside the area for ${rule.minMinutes} min or more, counted by EarthAtlas from ${src()}${missing}.</div>`
  if (s.top?.length) {
    h += `<div class="${st.popupHead}" style="margin:9px 0 2px">Most days here</div>` + s.top.slice(0, 5).map((t) => {
      const name = t.aisName || `MMSI ${t.mmsi}`
      const meta = [t.kind, `${n(t.days)} day${t.days === 1 ? '' : 's'}`, `${n(Math.round(t.hours))} h`, t.stays > 1 ? `${t.stays} stays` : null].filter(Boolean).join(' · ')
      const title = `Name as the ship broadcast it (AIS). ${t.days} UTC day${t.days === 1 ? '' : 's'} with a stay here, ${t.hours} ship-hours, ${t.stays} stay${t.stays === 1 ? '' : 's'}${t.vesselId ? ' — click for its card' : t.ambiguousVessels ? ` — MMSI ${t.mmsi} belonged to ${t.ambiguousVessels} ships in our records then, so no card is opened` : ' — not identified in our ship records'}`
      return t.vesselId
        ? `<button type="button" class="${st.popupShip}" data-vessel="${esc(t.vesselId)}" title="${esc(title)}"><span class="${st.popupShipKind}">${esc(name)}</span><span class="${st.popupShipMeta}">${esc(meta)}</span></button>`
        : `<div class="${st.popupShip}" style="cursor:default" title="${esc(title)}"><span class="${st.popupShipKind}">${esc(name)}</span><span class="${st.popupShipMeta}">${esc(meta)}</span></div>`
    }).join('')
  } else if (!x.stays) h += `<div class="${st.popupMeta}">No ship stayed here long enough to count in these months.</div>`
  return h
}

/**
 * Stays ESTIMATED from Global Fishing Watch hourly positions for picked months NOAA's AIS doesn't count here
 * (lib/ships/activityEstimates.js readAnchorageEstimates; Josh 2026-10-06). Marked ≈, own source link, kept apart from counted stays.
 */
function estimatesHTML(e, st) {
  if (!e) return ''
  const r = e.records?.[e.records.length - 1]
  const src = (text = 'Global Fishing Watch') => `<a href="${r ? `/ships/source/${r.recordId}` : 'https://globalfishingwatch.org'}" target="_blank" rel="noopener noreferrer" title="Estimated by EarthAtlas from one AIS position per ship per hour (Powered by Global Fishing Watch, CC BY-NC 4.0): a ship whose positions stay within about two grid cells (~1 km each) from one hour to the next, inside this area, for two hours or more. Checked against NOAA per-minute AIS for June 2026: 62% of NOAA’s stays found, 64% of estimated stays confirmed — click for the month’s record">${esc(text)}</a>`
  let h = `<div class="${st.popupHead}" style="margin:9px 0 2px">Estimated from hourly positions · ${esc(period(e.months))}</div>`
  if (e.tooSmall) return h + `<div class="${st.popupMeta}">Too small to estimate from hourly positions: they sit on a grid about 1 km across, and this area falls between its points. Not counted, not zero.</div>`
  if (!e.estimatedMonths.length) return h + `<div class="${st.popupMeta}">Not estimated yet for these months (left out, not counted as zero).</div>`
  h += `<div class="${st.popupRow}"><span class="${st.popupK}">Stays</span><span class="${st.popupV}">≈ ${n(e.stays)} by ${n(e.ships)} ship${e.ships === 1 ? '' : 's'} ${src('GFW')}</span></div>` +
    `<div class="${st.popupRow}"><span class="${st.popupK}">Ship-hours here</span><span class="${st.popupV}">≈ ${n(e.hours)} h ${src('GFW')}</span></div>`
  if (e.kinds.length) h += `<div class="${st.popupMeta}" title="EarthAtlas’s kind of ship from its records, else Global Fishing Watch’s type">Ships by kind: ${e.kinds.slice(0, 5).map((k) => `${esc(k.label)} ${n(k.ships)}`).join(' · ')}${e.kinds.length > 5 ? ' · …' : ''}</div>`
  if (e.missing.length) h += `<div class="${st.popupMeta}">Not estimated yet: ${esc(e.missing.map(fmtMonth).join(', '))} (left out).</div>`
  h += `<div class="${st.popupMeta}">${esc(period(e.estimatedMonths))}${e.through ? `, data through ${esc(e.through)}` : ''}: estimated, not counted. When NOAA publishes these months, its counted stays replace them. ${src('Powered by Global Fishing Watch')}</div>`
  if (e.top?.length) {
    h += e.top.map((t) => {
      const name = t.name || (t.mmsi ? `MMSI ${t.mmsi}` : 'Unnamed ship')
      const meta = [t.kind, `≈ ${n(t.days)} day${t.days === 1 ? '' : 's'}`, `${n(t.hours)} h`].filter(Boolean).join(' · ')
      return t.vesselId
        ? `<button type="button" class="${st.popupShip}" data-vessel="${esc(t.vesselId)}" title="Name as the ship broadcast it (AIS, via Global Fishing Watch) — click for its card"><span class="${st.popupShipKind}">${esc(name)}</span><span class="${st.popupShipMeta}">${esc(meta)}</span></button>`
        : `<div class="${st.popupShip}" style="cursor:default" title="Name as the ship broadcast it; not identified in our ship records"><span class="${st.popupShipKind}">${esc(name)}</span><span class="${st.popupShipMeta}">${esc(meta)}</span></div>`
    }).join('')
  }
  return h
}

/** props = the clicked feature's properties ({ i, n, l, x, a }); data = op=anchorage response (or null while loading). */
export function anchoragePopupHTML(props, { months, data, error }, st) {
  const a = data?.anchorage
  let body = `<div class="${st.popupMeta}">Counting stays…</div>`
  if (error) body = `<div class="${st.popupMeta}">Couldn’t load this anchorage right now.</div>`
  else if (a) {
    const aka = (data.aliases || []).length ? `<div class="${st.popupMeta}">Also known as: ${data.aliases.map((x) => `${esc(x.alias)} · ${rec(x.recordId, ALIAS_SHORT[x.sourceId] || x.sourceId, aliasTitle(x))}`).join('; ')}</div>` : ''
    const alt = a.alternate_name ? `<div class="${st.popupMeta}">DFO alternate name: ${esc(a.alternate_name)} · ${areaSource(a)}</div>` : ''
    body = `<div class="${st.popupMeta}">${a.location ? `${esc(a.location)} · ` : ''}${areaSource(a)}</div>` + aka + alt + staysHTML(data.stays, months, st) + estimatesHTML(data.estimated, st)
  }
  const head = a ? statusWords(a) : props.x ? 'No-anchoring area' : 'Anchorage'
  return `<div class="${st.popup}"><div class="${st.popupHead}">${esc(head)}</div><div class="${st.popupTitle}">${esc(a?.name || props.n)}</div>${body}</div>`
}
