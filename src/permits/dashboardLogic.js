/**
 * /permits/dashboard questions (Magali Cota's CWA §401/§404 watchdog plan, Friends of the San Juans, Oct 2026).
 * Shared by the dashboard (PermitsDashboard.jsx) and the map's ?q= filter (PermitsApp.jsx), so "See all on the map"
 * always shows the same records the dashboard counted.
 */
import { FACTOR_BY_ID } from './habitat.js'

const todayIso = () => new Date().toISOString().slice(0, 10)
export const latestPast = (r) => (r.trail || []).map((t) => t.date).filter((d) => d <= todayIso()).sort().pop() || ''

// Still before a decision at the Corps or Ecology: the window in which comments and early contact can change a project.
const OPEN = new Set(['Open at Washington State Department of Ecology', 'U.S. Army Corps of Engineers review pending', 'U.S. Army Corps of Engineers permit pending', '401: pre-filing requested', '401: in review', 'Environmental assessment in progress'])
const DECIDED = new Set(['Issued with special conditions', 'Issued without special conditions', 'Verified with special conditions', '401: decision issued', '401 issued',
  'U.S. Army Corps of Engineers permit issued', 'Letter of Permission issued', 'After-the-fact permit issued'])
// WDFW applications: Submitted or Accepted (not rejected, withdrawn or incomplete) are under review.
const wdfwOpen = (label) => /^Washington Department of Fish and Wildlife: (Submitted|Accepted)\b/.test(label || '') && !/Rejected|Withdrawn|Incomplete/.test(label)
export const isOpen = (r) => r.layer !== 'npdes' && (OPEN.has(r.status?.label) || wdfwOpen(r.status?.label))
export const isDecided = (r) => r.layer !== 'npdes' && DECIDED.has(r.status?.label)

// Sensitive waters and habitat, weighed alike (Josh 2026-10-15): impaired (303(d)) waters, shellfish growing areas,
// and the plan's habitat that Friends maps (documented forage fish spawning, herring spawning, eelgrass, bull kelp),
// within PRIORITY_M of the record's map point. Potential spawning beaches are listed in the popup but not counted
// here: they line most of the county's shore, so nearly every in-water project is next to one.
export const PRIORITY = ['wq', 'shell', 'hfd', 'hhe', 'hee', 'hkb']
export const PRIORITY_M = 50
export const priorityHits = (r) => (r.near || []).filter((x) => PRIORITY.includes(x.h) && x.m <= PRIORITY_M)
export const atPriority = (r) => priorityHits(r).length > 0

const TIER_ORDER = { now: 0, watch: 1, record: 2 }
export const QUESTIONS = [
  { id: 'review', title: 'Needs review', ask: 'Which permits have a gap and a way to act?',
    why: 'A permit is listed when its records show a gap (for example, spawning habitat nearby that the permit does not name) and a way to act. Act now: a way to act exists today. Watch: listed as open, but nothing has happened on it for over a year. On record: no way left to act; kept to show patterns.',
    test: (r) => !!r.review },
  { id: 'open', title: 'Open now', ask: 'Which projects are still before the U.S. Army Corps of Engineers or Washington State Department of Ecology?',
    why: 'Before a decision is the time when comments, conditions and avoidance can still change a project.',
    test: isOpen },
  { id: 'open-habitat', title: 'Open, at sensitive waters or habitat', ask: 'Which of those sit at sensitive waters or habitat?',
    why: `Open projects within ${PRIORITY_M} m of an impaired water (303(d)), a shellfish growing area, or habitat mapped by Friends of the San Juans: documented forage fish spawning, herring spawning, eelgrass or bull kelp.`,
    test: (r) => isOpen(r) && atPriority(r) },
  { id: 'decided-habitat', title: 'Approved at sensitive waters or habitat', ask: 'What has been approved at sensitive waters or habitat?',
    why: 'Issued permits to check against what was built, and to compare conditions across similar projects. Newest first.',
    test: (r) => isDecided(r) && atPriority(r) },
  { id: 'violations', title: 'Discharge permits with violations', ask: 'Which discharge permits have violations?',
    why: 'Permits with violations in U.S. Environmental Protection Agency’s and Washington State Department of Ecology’s records in the last three years; red = over a pollution limit or repeated missed reporting.',
    test: (r) => r.layer === 'npdes' && !!r.violations },
]
export const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]))

// Sort for a question's list: newest activity first (open-at-habitat: closest factor first).
export function rankFor(q) {
  if (q.id === 'review') return (a, b) => TIER_ORDER[a.review.tier] - TIER_ORDER[b.review.tier] || (a.review.gaps.every((g) => g.mark) - b.review.gaps.every((g) => g.mark)) || latestPast(b).localeCompare(latestPast(a)) || a.name.localeCompare(b.name)
  if (q.id === 'violations') return (a, b) => (a.violations.level === 'red' ? 0 : 1) - (b.violations.level === 'red' ? 0 : 1) || (b.violations.pollution || 0) - (a.violations.pollution || 0)
  const near = (r) => Math.min(99999, ...priorityHits(r).map((x) => x.m))
  return (a, b) => (q.id === 'open-habitat' ? near(a) - near(b) : 0) || latestPast(b).localeCompare(latestPast(a)) || a.name.localeCompare(b.name)
}

export const factorLabel = (h) => FACTOR_BY_ID[h]?.short || h
