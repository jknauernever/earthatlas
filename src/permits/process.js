/**
 * "Where it is": a record's progress through the standard review tracks a San Juan County in-water project passes
 * through (Josh 2026-10-15). One joint application (JARPA) splits into parallel tracks; each track has fixed steps:
 *   Army Corps (§404 / §10): application → public notice (individual permits) → decision
 *   Ecology (§401 / coastal zone): pre-filing meeting request → certification request → public notice → decision
 *   WDFW (Hydraulic Project Approval): decision (issued) → active until / expired
 *   County (shoreline / SEPA): the shoreline and SEPA actions at this dock
 * A step is 'done' (date and source from the record), 'now' (under way), 'na' (not part of this path, e.g. no public
 * notice for a nationwide permit) or 'unknown' (not in public records we hold). Steps are read from the record's own
 * events and statuses only, never guessed. Shared by the map popup and the dashboard.
 */

const has = (r, agency, re) => (r.trail || []).filter((t) => (!agency || t.agency === agency) && re.test(t.event || ''))
const first = (list) => list.slice().sort((a, b) => a.date.localeCompare(b.date))[0]
const last = (list) => list.slice().sort((a, b) => a.date.localeCompare(b.date)).pop()
const step = (name, state, ev, text) => ({ name, state, date: ev?.date || null, src: ev?.src || null, text: text || ev?.event || null })

function corps(r) {
  const ev = (re) => has(r, 'corps', re)
  const any = r.corpsRef || (r.refs || []).some((x) => /NWS-/.test(x.label)) || (r.trail || []).some((t) => t.agency === 'corps')
  if (!any) return null
  const nwp = ev(/nationwide/i).length || /nationwide/i.test(`${r.status?.label} ${r.type}`)
  const lop = ev(/letter of permission/i).length || /letter of permission/i.test(`${r.status?.label} ${r.type}`)
  const applied = first(ev(/application received|request submitted|application$/i))
  const notice = last(ev(/public notice/i))
  const decided = last(ev(/issued|verified|denied|withdrawn|canceled|letter of permission|nationwide permit|finalized|approved jd/i))
  const pending = /U.S. Army Corps of Engineers (review|permit) pending|assessment in progress/i.test(r.status?.label || '')
  // ESA / Essential Fish Habitat / historic consultations (bake ormConsultations): one step, closed only when all are.
  const began = ev(/consultation with .* began|review .* began/i), closed = ev(/ closed(:|$)/i)
  const how = [...new Set(closed.map((t) => (/closed: (.*)$/.exec(t.event) || [])[1]).filter(Boolean))]
  const consult = began.length ? step('Agency consultations', closed.length >= began.length ? 'done' : 'now', closed.length >= began.length ? last(closed) : first(began),
    `${began.length} (${[...new Set(began.map((t) => t.event.replace(/ began$/, '').replace(/ consultation with /, ', ')))].join('; ')})${closed.length >= began.length ? ` closed${how.length ? ` as ${how.join(', ')}` : ''}` : ' under way'}`) : null
  return { id: 'corps', label: 'U.S. Army Corps of Engineers (§404 / §10)', steps: [
    step('Application', applied ? 'done' : 'unknown', applied),
    nwp || lop ? step('Public notice', 'na', null, nwp ? 'Not part of a nationwide permit' : 'Not part of a Letter of Permission') : step('Public notice', notice ? 'done' : 'unknown', notice),
    pending ? step('Decision', 'now', null, r.status.label) : step('Decision', decided ? 'done' : 'unknown', decided,
      decided ? decided.event : 'Not in the U.S. Army Corps of Engineers’ public database'),
  ].flatMap((x, i) => (i === 2 && consult ? [consult, x] : [x])) }
}

function ecology(r) {
  const ev = (re) => has(r, 'ecology', re)
  const st = r.status?.label || ''
  const aq = r.source === 'ecology-aquatics' || /Washington State Department of Ecology|401/.test(st) || (r.trail || []).some((t) => t.agency === 'ecology') || r.cert401
  if (!aq) return null
  const fact401 = (r.facts || []).find((f) => /401/.test(f.label))?.value || ''
  const prefile = first(ev(/pre-filing/i))
  const request = first(ev(/request received|request: in review/i))
  const notice = last(ev(/public notice/i))
  const decided = last(ev(/certification issued|order #|CZM decision|consistency decision|closed - no action|administrative order/i))
  const open = /Open at Washington State Department of Ecology|401: (in review|pre-filing)/i.test(st)
  const closedNo401 = /Closed at Washington State Department of Ecology/.test(st) && /no 401 action/i.test(fact401)
  return { id: 'ecology', label: 'Washington State Department of Ecology (§401 water quality / coastal zone)', steps: [
    step('Pre-filing meeting request', prefile ? 'done' : 'unknown', prefile),
    step('Certification request', request ? 'done' : 'unknown', request),
    step('Public notice', notice ? 'done' : 'unknown', notice),
    decided ? step('Decision', 'done', decided)
      : open ? step('Decision', 'now', null, 'Under Washington State Department of Ecology review')
      : closedNo401 ? step('Decision', 'done', null, 'Washington State Department of Ecology review closed with no 401 decision on record')
      : step('Decision', 'unknown', null, fact401 || null),
  ] }
}

function wdfw(r, today) {
  // An application from WDFW's search (hpa-search.mjs) carries the whole path: submitted → decision → active.
  const app = (r.hpaApps || []).slice().sort((a, b) => String(b.submitted).localeCompare(String(a.submitted)))[0]
  if (app) {
    const under = /Submitted|Accepted/.test(app.status) && !/Rejected|Withdrawn|Incomplete/.test(app.status)
    const ended = /Rejected|Withdrawn|Denied/.test(app.status)
    return { id: 'wdfw', label: 'Washington Department of Fish and Wildlife (Hydraulic Project Approval)', steps: [
      step('Application', 'done', { date: app.submitted, src: app.src }, `APPS ${app.apps}`),
      under ? step('Decision', 'now', null, `Washington Department of Fish and Wildlife: ${app.status}`) : ended ? step('Decision', 'done', null, `Washington Department of Fish and Wildlife: ${app.status}`)
        : step('Decision', app.issued ? 'done' : 'unknown', { date: app.issued, src: app.src }, `Permit ${app.permit || ''} issued`.trim()),
      ...(app.permitStatus ? [step(/active/i.test(app.permitStatus) ? 'Active' : 'Ended', /active/i.test(app.permitStatus) ? 'now' : 'done', null, `Permit ${app.permitStatus.toLowerCase()}`)] : []),
    ] }
  }
  const hpas = [...new Map([
    ...(r.docks || []).flatMap((d) => d.permits).filter((p) => p.agency === 'wdfw').map((p) => [String(p.number || p.date), { number: p.number, date: p.date, status: p.status }]),
    ...(r.conditions || []).map((c) => [c.permit, { number: c.permit, date: c.issued, status: c.status, expires: c.expires }]),
  ]).values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
  const listed = has(r, 'wdfw', /hydraulic project approval/i)
  if (!hpas.length && !listed.length) return null
  const h = hpas[0]
  if (!h) return { id: 'wdfw', label: 'Washington Department of Fish and Wildlife (Hydraulic Project Approval)', steps: [step('Decision', 'done', listed[0])] }
  const active = /active/i.test(h.status || '') || (h.expires && h.expires >= today)
  return { id: 'wdfw', label: 'Washington Department of Fish and Wildlife (Hydraulic Project Approval)', note: hpas.length > 1 ? `${hpas.length} Washington Department of Fish and Wildlife permits at this dock; the latest is shown` : null, steps: [
    step('Decision', 'done', { date: h.date }, `Permit ${h.number || ''} issued`.trim()),
    step(active ? 'Active' : 'Ended', active ? 'now' : 'done', h.expires ? { date: h.expires } : null, active ? `Active${h.expires ? ` until ${h.expires}` : ''}` : (h.status || 'Expired')),
  ] }
}

// Only the project's own county events (SEPA Register joins, actions listed in Ecology's order). Permits at a nearby
// dock are not this project's (Josh 2026-10-15); the report lists them under "Possibly related records".
function county(r) {
  const own = has(r, null, /shoreline|SEPA/i).filter((t) => ['county', 'town'].includes(t.agency))
  if (!own.length) return null
  return { id: 'county', label: own.some((t) => t.agency === 'town') ? 'Town of Friday Harbor / County (shoreline, SEPA)' : 'San Juan County (shoreline, SEPA)',
    steps: own.map((t) => step(t.event.replace(/\s*\(as listed in Washington State Department of Ecology's order\)/, ''), t.date > new Date().toISOString().slice(0, 10) ? 'now' : 'done', t)) }
}

/** The tracks this record shows evidence of, in the order a project usually meets them. */
// Events dated before the record's own Corps file year belong to an earlier file on the same dock (an Ecology record
// can list both), so they are left out of this project's tracks (the report's timeline still shows them, grouped).
export function processOf(r, today = new Date().toISOString().slice(0, 10)) {
  if (r.layer === 'npdes') return []
  const years = [r.id, r.corpsRef, ...(r.refs || []).map((x) => x.label)].map((s) => /NWS-(\d{4})-/.exec(s || '')?.[1]).filter(Boolean)
  const from = years.length ? `${Math.max(...years)}-01-01` : null
  const own = from ? { ...r, trail: (r.trail || []).filter((t) => !t.date || t.date >= from) } : r
  return [corps(own), ecology(own), wdfw(own, today), county(own)].filter(Boolean)
}

/** Where an open project stands: the first track whose decision is under way, in plain words (dashboard counts). */
export function stageOf(r) {
  for (const t of processOf(r)) {
    const s = t.steps.find((x) => x.state === 'now')
    if (s) return `${t.id === 'corps' ? 'U.S. Army Corps of Engineers' : t.id === 'ecology' ? 'Washington State Department of Ecology 401' : t.id === 'wdfw' ? 'Washington Department of Fish and Wildlife' : 'County'}: ${s.name.toLowerCase()}`
  }
  return null
}

// Statuses as shown: an Ecology file's state is not the project's (Josh 2026-10-15, Crane Island).
const SHOWN = { 'Closed at Washington State Department of Ecology': 'Washington State Department of Ecology review closed', 'Open at Washington State Department of Ecology': 'Under Washington State Department of Ecology review' }
export const statusShown = (label) => SHOWN[label] || label
