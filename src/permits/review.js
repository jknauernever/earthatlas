/**
 * "Needs review" for /permits (Josh 2026-10-15, for Friends of the San Juans' CWA watchdog work). A record needs review
 * when it has a GAP (something Friends cares about that its permit does not show, stated as a sourced fact) and a
 * LEVER (a way Friends can still act). Tiers: 'now' (a lever exists today), 'watch' (an agency still lists the file
 * as open, but nothing is recorded on it for over QUIET_DAYS: likely dormant; Josh 2026-10-15, Sacks/Pollack dock),
 * 'record' (no lever left: pattern evidence). An active permit or a discharge permit in force is current by definition. The machine proposes;
 * Friends confirms, dismisses or acts, recorded in data/permits/reviews.json (attached by the bake as `review.marks`).
 * Everything here is public on /permits for now (Josh 2026-10-15). Rules are drafts until Tina approves them.
 *
 * Pure: used by the bake (scripts/permits/bake-permits.mjs attachReview) so the dashboard and map read one answer.
 */
import { isOpen, isDecided, latestPast } from './dashboardLogic.js'
import { distanceWords } from './habitat.js'
import { activityYears, fmtDate } from './permitLogic.js'

export const TIERS = {
  now: { label: 'Act now', note: 'A way to act exists today.' },
  watch: { label: 'Watch', note: 'Listed as open; nothing recorded on it for over a year.' },
  record: { label: 'On record', note: 'No way left to act on this permit; kept as evidence of patterns.' },
}
export const NEAR_M = 50
export const QUIET_DAYS = 365

// What each gap means, in plain words (shown in the legend and on hover).
export const GAPS = {
  'spawn-unnamed': 'A spawning species within 50 m is not named in the Washington Department of Fish and Wildlife permit.',
  'no-window': 'The Washington Department of Fish and Wildlife permit has no work window, though spawning habitat is within 50 m.',
  'eggs-found': 'A forage fish survey in the Washington Department of Fish and Wildlife record found eggs; the permit allows work in that period only when none are found.',
  'open-no-401': 'Still open, at sensitive waters or habitat, with no 401 decision on record yet.',
  'discharge-impaired': 'Over a permit limit for the same pollutant a nearby water is listed as impaired for (303(d)).',
  'discharge-shellfish': 'Over its fecal coliform limit near a shellfish growing area.',
  'sepa-open': 'A county SEPA review with its comment period open, at sensitive waters or habitat.',
}

const SPECIES = [['smelt', 'surf smelt', /surf smelt/i], ['sandlance', 'Pacific sand lance', /sand lance/i]]
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5

function spawningNear(r) {
  const out = []
  for (const x of r.near || []) {
    if (x.m > NEAR_M) continue
    if (x.h === 'hhe') out.push({ k: 'herring', label: 'Pacific herring', m: x.m })
    if (x.h === 'hfd') for (const [k, label, re] of SPECIES) if (re.test(x.name || '')) out.push({ k, label, m: x.m })
  }
  return [...new Map(out.map((s) => [s.k, s])).values()]
}

// Pollutants a discharge permit went over its limit for, from its violation events ("Coliform, fecal … over its permit limit").
const POLLUTANTS = [['fecal coliform', /coliform/i, /fecal coliform/i], ['phosphorus', /phosph/i, /phosph/i], ['dissolved oxygen', /oxygen/i, /oxygen/i], ['temperature', /temperature/i, /temperature/i]]
function overLimitFor(r) {
  const ev = (r.trail || []).filter((t) => /over its permit limit/i.test(t.event || ''))
  return POLLUTANTS.filter(([, re]) => ev.some((t) => re.test(t.event))).map(([name, , wqRe]) => ({ name, wqRe }))
}

/** { tier, lever, gaps: [{ id, text }] } or null when the record has no gap. */
export function reviewOf(r, today = new Date().toISOString().slice(0, 10)) {
  const gaps = []
  const sp = spawningNear(r)
  for (const c of r.conditions || []) {
    // No window, but the permit may protect the species another way: say which provision names it.
    if (sp.length && !c.timing?.length) gaps.push({ id: 'no-window', text: `Washington Department of Fish and Wildlife permit ${c.permit} has no work window; ${sp.map((s) => `${s.label} spawning ${distanceWords(s.m)}${c.species?.[s.k] ? ` (named in provision ${c.species[s.k].provision}: “${c.species[s.k].quote}”)` : ''}`).join(', ')}.` })
    const unnamed = sp.filter((s) => !c.species?.[s.k])
    if (unnamed.length) gaps.push({ id: 'spawn-unnamed', text: `Washington Department of Fish and Wildlife permit ${c.permit} does not name ${unnamed.map((s) => `${s.label} (spawning ${distanceWords(s.m)})`).join(' or ')}.` })
    for (const f of c.surveys || []) {
      if (f.result && /\beggs?\b[^.]*\bfound\b/i.test(f.result) && !/\bno\b/i.test(f.result)) gaps.push({ id: 'eggs-found', text: `Survey file “${f.name}”${f.dates?.[0] ? ` (${f.dates[0]})` : ''} says “${f.result}”. The permit allows work in that period only if no eggs are found.` })
    }
  }
  const at = (r.near || []).filter((x) => x.m <= NEAR_M && ['wq', 'shell', 'hfd', 'hhe', 'hee', 'hkb'].includes(x.h))
  const no401 = (r.facts || []).some((f) => /401/.test(f.label) && /no 401 action/i.test(f.value))
  const sepaOpen = (r.sepa || []).find((s) => s.commentsDue && s.commentsDue >= today)
  if (sepaOpen && at.length) gaps.push({ id: 'sepa-open', text: `County SEPA ${sepaOpen.type} issued ${sepaOpen.issued}; comments are open until ${sepaOpen.commentsDue}, at sensitive waters or habitat.` })
  if (isOpen(r) && at.length && (no401 || !r.cert401)) gaps.push({ id: 'open-no-401', text: 'Still open at the U.S. Army Corps of Engineers or Washington State Department of Ecology, at sensitive waters or habitat, with no 401 decision on record.' })
  if (r.layer === 'npdes') {
    for (const p of overLimitFor(r)) {
      // Receiving waters matched by name (habitat.js receivingMatches): the plant's map point is not its outfall.
      const wq = (r.receiving || []).find((x) => x.h === 'wq' && p.wqRe.test(x.name || ''))
      if (wq) gaps.push({ id: 'discharge-impaired', text: `Over its ${p.name} limit; it discharges to ${wq.name.split(':')[0]}, listed as impaired for ${p.name} (303(d)).` })
      const sh = p.name === 'fecal coliform' && (r.receiving || []).find((x) => x.h === 'shell')
      if (sh) gaps.push({ id: 'discharge-shellfish', text: `Over its fecal coliform limit; it discharges to ${sh.name.split(',')[0]}, a shellfish growing area (${sh.name.split(',')[1]?.trim() || 'classified'}).` })
    }
  }
  if (!gaps.length) return null

  // Lever: the first way Friends can still act.
  const active = (r.conditions || []).find((c) => (c.expires && c.expires >= today) || (!c.expires && /\bactive\b/i.test(c.status || '')))
  const last = latestPast(r)
  let tier = 'record', lever = 'No open review, appeal window or active permit found.'
  // An open file counts only while something happens on it: the last dated event, else January 1 of its file year.
  const years = activityYears(r, today)
  const lastSeen = last || (years.length ? `${Math.max(...years)}-01-01` : null)
  const quiet = !lastSeen || days(lastSeen, today) > QUIET_DAYS
  if (sepaOpen) { tier = 'now'; lever = `County SEPA comments open until ${sepaOpen.commentsDue} (SEPA Register ${sepaOpen.sepa}).` }
  else if (isOpen(r) && !quiet) { tier = 'now'; lever = `${r.status.label}; last activity ${fmtDate(lastSeen)}.` }
  else if (isOpen(r)) {
    // Consultations the Corps closed as "withdrawn" are said outright: the strongest sign a pending file is dead.
    const wd = (r.trail || []).filter((t) => /closed: withdrawn/i.test(t.event || '') && t.date <= today).map((t) => t.date).sort().pop()
    tier = 'watch'
    lever = `${r.status.label}, but ${last ? `nothing is recorded since ${fmtDate(last)}` : lastSeen ? `no dated activity in the records (file opened ${lastSeen.slice(0, 4)})` : 'no dated activity in the records'}` +
      `${wd ? `; agency consultations closed as withdrawn on ${fmtDate(wd)}` : ''}.`
  }
  else if (isDecided(r) && last && days(last, today) <= 30) { tier = 'now'; lever = `Decided ${fmtDate(last)}; within the 30-day appeal period to the Pollution Control Hearings Board.` }
  else if (active) { tier = 'now'; lever = `Washington Department of Fish and Wildlife permit ${active.permit} is active${active.expires ? ` until ${active.expires}` : ''}.` }
  else if (r.layer === 'npdes' && !r.ended) { tier = 'now'; lever = `Discharge permit in force${(r.facts || []).find((f) => f.label === 'Permit expires')?.value ? ` (expires ${(r.facts || []).find((f) => f.label === 'Permit expires').value})` : ''}.` }
  return { tier, lever, gaps }
}
