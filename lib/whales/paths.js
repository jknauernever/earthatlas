/**
 * Whale paths (Josh 2026-10-26): a day's reports of the same animals joined in time order, so a pod watched from shore
 * all afternoon reads as one route instead of a pile of dots. One rule for every site that draws them (/whalewatch,
 * /whales, /shiptraffic). Plain JS (Node + browser); our own rule, written from how the reports look, not from any
 * other site's code.
 *
 * A report joins a path when it is the same species, its time is exact, it is placed well enough to follow (not an
 * obscured or 0.1°-rounded location), and it is a plausible swim from the path's latest report: within MAX_GAP_S and
 * within SLACK_KM + MAX_KMH × hours of it. IDs named in the reports (T37A, J27, BCY0324, a HappyWhale individual) decide
 * when both sides name some: a shared ID joins across a longer gap, no shared ID never joins. Everything else is left
 * as a single report.
 */
import { APPROX_M, locationRadiusM, whalesIn } from './precision.js'

export const MAX_KMH = 8           // a travelling orca pod's usual pace (bursts are faster, but a straight line at speed cuts across land)
export const SLACK_KM = 2          // two observers on different shores watching the same animals at the same minute
export const MAX_GAP_S = 2 * 3600  // longer silences start a new path …
export const ID_GAP_S = 4 * 3600   // … unless the reports name the same animals

const tOf = (s) => (s.time_precision === 'exact' && s.observed_at ? Date.parse(s.observed_at) : null)
// Species, not subspecies or ecotype: "Bigg's killer whale" and "Killer whale" reports of one pod are one path.
const speciesKey = (s) => {
  const sci = String(s.taxon?.scientific || '').split(/\s+/).slice(0, 2).join(' ')
  return sci || String(s.taxon?.id ?? s.taxon?.reported_as ?? '?')
}
const isOrca = (s) => /^orcinus orca/i.test(s.taxon?.scientific || '') || /orca|killer whale/i.test(s.taxon?.reported_as || '')

function km(a, b) {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  return Math.hypot((a.lng - b.lng) * k * 111.32, (a.lat - b.lat) * 111.32)
}

/**
 * The animals a report names: its HappyWhale individual, catalogue numbers in its notes (BCY0324, CRC-12, MMX…) and,
 * for orcas, Center for Whale Research / Bigg's IDs (J27, K, L, T37A2). Upper-case, deduplicated, in the order written.
 */
export function reportIds(s) {
  const out = []
  const add = (x) => { const v = String(x).toUpperCase().replace(/\s+/g, ''); if (v && !out.includes(v)) out.push(v) }
  if (s.individual?.label) add(s.individual.label)
  else if (s.individual?.id) add(s.individual.id)
  const text = String(s.remarks || '')
  for (const m of text.matchAll(/\b(BCY\d{3,4}|BCX\d{3,4}|CRC-?\d{1,4}|MMX\d{3,4}|CRC\d{1,4})\b/gi)) add(m[1])
  if (isOrca(s)) for (const m of text.matchAll(/\b([JKLT]\d{1,3}(?:[A-Z]\d{0,2})?)\b/g)) add(m[1])
  return out
}

/**
 * Join reports into paths. Returns [{ key, species, members (oldest first), ids, whales, firstMs, lastMs }], newest
 * path first; only paths of two or more reports at two or more places (a lone report is drawn as a dot by each site).
 */
export function chainSightings(sightings) {
  const usable = sightings
    .filter((s) => tOf(s) != null && Number.isFinite(s.lat) && Number.isFinite(s.lng) && locationRadiusM(s) < APPROX_M && !s.location_obscured)
    .sort((a, b) => tOf(a) - tOf(b))
  const open = []   // paths still taking reports
  const all = []
  for (const s of usable) {
    const t = tOf(s), key = speciesKey(s), ids = reportIds(s)
    let best = null, bestScore = Infinity
    for (const p of open) {
      if (p.key !== key) continue
      const shared = ids.length && p.ids.length ? ids.some((x) => p.ids.includes(x)) : null
      if (shared === false) continue
      const last = p.members[p.members.length - 1]
      const dt = (t - tOf(last)) / 1000
      if (dt > (shared ? ID_GAP_S : MAX_GAP_S)) continue
      const d = km(last, s), reach = SLACK_KM + MAX_KMH * (dt / 3600)
      if (d > reach) continue
      const score = (shared ? 0 : 1) + d / reach   // a named match wins over a nearer unnamed one
      if (score < bestScore) { best = p; bestScore = score }
    }
    if (!best) {
      best = { key, species: s.taxon?.common || s.taxon?.scientific || s.taxon?.reported_as || 'Whale', members: [], ids: [] }
      open.push(best)
      all.push(best)
    }
    best.members.push(s)
    for (const x of ids) if (!best.ids.includes(x)) best.ids.push(x)
  }
  return all
    .filter((p) => p.members.length > 1 && new Set(p.members.map((m) => `${m.lng.toFixed(4)},${m.lat.toFixed(4)}`)).size > 1)
    .map((p) => ({ ...p, whales: Math.max(...p.members.map(whalesIn)), firstMs: tOf(p.members[0]), lastMs: tOf(p.members[p.members.length - 1]) }))
    .sort((a, b) => b.lastMs - a.lastMs)
}

/** "seen 15× over 8 h" / "seen 3× over 40 min". */
export function pathSpan(p) {
  const min = Math.round((p.lastMs - p.firstMs) / 60000)
  const dur = min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')} min` : ''}`
  return `seen ${p.members.length}× over ${dur}`
}
