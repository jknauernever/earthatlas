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
  const pending = /Corps (review|permit) pending|assessment in progress/i.test(r.status?.label || '')
  return { id: 'corps', label: 'Army Corps (§404 / §10)', steps: [
    step('Application', applied ? 'done' : 'unknown', applied),
    nwp || lop ? step('Public notice', 'na', null, nwp ? 'Not part of a nationwide permit' : 'Not part of a Letter of Permission') : step('Public notice', notice ? 'done' : 'unknown', notice),
    pending ? step('Decision', 'now', null, r.status.label) : step('Decision', decided ? 'done' : 'unknown', decided,
      decided ? decided.event : 'Not in the Corps’ public database (most nationwide permit verifications are not published)'),
  ] }
}

function ecology(r) {
  const ev = (re) => has(r, 'ecology', re)
  const st = r.status?.label || ''
  const aq = r.source === 'ecology-aquatics' || /Ecology|401/.test(st) || (r.trail || []).some((t) => t.agency === 'ecology') || r.cert401
  if (!aq) return null
  const fact401 = (r.facts || []).find((f) => /401/.test(f.label))?.value || ''
  const prefile = first(ev(/pre-filing/i))
  const request = first(ev(/request received|request: in review/i))
  const notice = last(ev(/public notice/i))
  const decided = last(ev(/certification issued|order #|CZM decision|consistency decision|closed - no action|administrative order/i))
  const open = /Open at Ecology|401: (in review|pre-filing)/i.test(st)
  const closedNo401 = /Closed at Ecology/.test(st) && /no 401 action/i.test(fact401)
  return { id: 'ecology', label: 'Ecology (§401 water quality / coastal zone)', steps: [
    step('Pre-filing meeting request', prefile ? 'done' : 'unknown', prefile),
    step('Certification request', request ? 'done' : 'unknown', request),
    step('Public notice', notice ? 'done' : 'unknown', notice),
    decided ? step('Decision', 'done', decided)
      : open ? step('Decision', 'now', null, 'Under Ecology review')
      : closedNo401 ? step('Decision', 'done', null, 'Ecology review closed with no 401 decision (often: the Corps used a nationwide permit Ecology had already certified)')
      : step('Decision', 'unknown', null, fact401 || null),
  ] }
}

function wdfw(r, today) {
  // An application from WDFW's search (hpa-search.mjs) carries the whole path: submitted → decision → active.
  const app = (r.hpaApps || []).slice().sort((a, b) => String(b.submitted).localeCompare(String(a.submitted)))[0]
  if (app) {
    const under = /Submitted|Accepted/.test(app.status) && !/Rejected|Withdrawn|Incomplete/.test(app.status)
    const ended = /Rejected|Withdrawn|Denied/.test(app.status)
    return { id: 'wdfw', label: 'WDFW (Hydraulic Project Approval)', steps: [
      step('Application', 'done', { date: app.submitted, src: app.src }, `APPS ${app.apps}`),
      under ? step('Decision', 'now', null, `WDFW: ${app.status}`) : ended ? step('Decision', 'done', null, `WDFW: ${app.status}`)
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
  if (!h) return { id: 'wdfw', label: 'WDFW (Hydraulic Project Approval)', steps: [step('Decision', 'done', listed[0])] }
  const active = /active/i.test(h.status || '') || (h.expires && h.expires >= today)
  return { id: 'wdfw', label: 'WDFW (Hydraulic Project Approval)', note: hpas.length > 1 ? `${hpas.length} WDFW permits at this dock; the latest is shown` : null, steps: [
    step('Decision', 'done', { date: h.date }, `Permit ${h.number || ''} issued`.trim()),
    step(active ? 'Active' : 'Ended', active ? 'now' : 'done', h.expires ? { date: h.expires } : null, active ? `Active${h.expires ? ` until ${h.expires}` : ''}` : (h.status || 'Expired')),
  ] }
}

function county(r) {
  const own = has(r, null, /shoreline|SEPA/i).filter((t) => ['county', 'town'].includes(t.agency))
  const dock = (r.docks || []).flatMap((d) => d.permits).filter((p) => p.agency === 'county' && /shoreline|SEPA|exempt/i.test(p.what || ''))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  if (!own.length && !dock.length) return null
  const steps = own.length ? own.map((t) => step(t.event.replace(/\s*\(as listed in Ecology's order\)/, ''), 'done', t))
    : [step(dock[0].what, /ROUTED|OPEN|READY|REVIEW/i.test(dock[0].status || '') ? 'now' : 'done', { date: dock[0].date }, `${dock[0].number || ''} ${String(dock[0].status || '').toLowerCase()}`.trim())]
  return { id: 'county', label: r.trail?.some((t) => t.agency === 'town') ? 'Town of Friday Harbor / County (shoreline, SEPA)' : 'San Juan County (shoreline, SEPA)',
    note: own.length ? null : 'The latest shoreline or SEPA action at this dock', steps }
}

/** The tracks this record shows evidence of, in the order a project usually meets them. */
export function processOf(r, today = new Date().toISOString().slice(0, 10)) {
  if (r.layer === 'npdes') return []
  return [corps(r), ecology(r), wdfw(r, today), county(r)].filter(Boolean)
}

/** Where an open project stands: the first track whose decision is under way, in plain words (dashboard counts). */
export function stageOf(r) {
  for (const t of processOf(r)) {
    const s = t.steps.find((x) => x.state === 'now')
    if (s) return `${t.id === 'corps' ? 'Corps' : t.id === 'ecology' ? 'Ecology 401' : t.id === 'wdfw' ? 'WDFW' : 'County'}: ${s.name.toLowerCase()}`
  }
  return null
}

// Statuses as shown: an Ecology file's state is not the project's (Josh 2026-10-15, Crane Island).
const SHOWN = { 'Closed at Ecology': 'Ecology review closed', 'Open at Ecology': 'Under Ecology review' }
export const statusShown = (label) => SHOWN[label] || label
