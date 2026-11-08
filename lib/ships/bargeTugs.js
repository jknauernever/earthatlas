/**
 * Barge ↔ tug pairs (Josh 2026-11-07: "connect barges to tugs"). Barges carry no AIS, so an oil-transfer notice naming only a barge
 * and a facility could not be checked. The tug that brings a barge and stays with it while it loads shows in AIS at the berth.
 * Rules: src/ships/CLAUDE.md (an interpretation, kept apart from the evidence; conservative).
 *
 *   evidence        Ecology notices (ecology_ant_rows) naming the barge; terminal_calls / dock_calls (AIS, inferred) of tugs
 *                   (AIS ship-and-cargo types 31, 32, 52) at the notified place.
 *   derived         proposePairs() below: for each barge, the one tug MMSI that is at the berth through most of its notified
 *                   transfers (BARGE_TUG_RULE). Escort, standby and assist tugs come and go at arrival and departure; the tug
 *                   working the barge stays through the transfer, so "present for >= 80% of the notified window" separates them.
 *   reviewed        lib/ships/data/bargeTugs.js: the proposals Claude checked for Josh, each with its AIS evidence counts and, where
 *                   found, a published source (operator fleet page, press release) naming the pair. A pair a source contradicts
 *                   is left out. Never a merge: barge and tug stay separate vessels; the pair is only used to check notices.
 *   interpretation  lib/ships/oilTransfers.js rule 8: a barge transfer is seen when its paired tug has a call at the notified
 *                   place overlapping the notified window widened by tolH.
 */
export const BARGE_TUG_RULE = Object.freeze({ tolH: 6, fullCover: 0.8, minOps: 5, minShare: 0.5, minFullShare: 0.5 })
export const TUG_TYPES = Object.freeze([31, 32, 52])   // AIS: towing, towing (long / wide), tug

const ms = (t) => (typeof t === 'number' ? t : Date.parse(t))

/**
 * Pure. ops: barge operations [{ barge, startAt, durationH, places: [key] }]; callsAt: Map place key → tug calls
 * [{ mmsi, aisName, t0, t1 }]. → proposals [{ barge, mmsi, aisName, ops, together, full, share, fullShare }] (best tug per barge
 * that passes the rule), sorted by ops.
 */
export function proposePairs(ops, callsAt, rule = BARGE_TUG_RULE) {
  const H = 3600e3, by = new Map()
  for (const o of ops) {
    const s = ms(o.startAt), e = s + (o.durationH || 0) * H, a = s - rule.tolH * H, b = e + rule.tolH * H
    const seen = new Map()
    for (const k of o.places) for (const c of callsAt.get(k) || []) {
      const t0 = ms(c.t0), t1 = ms(c.t1)
      if (t1 < a || t0 > b) continue
      const cov = e > s ? Math.max(0, Math.min(t1, e) - Math.max(t0, s)) / (e - s) : (t0 <= s && t1 >= s ? 1 : 0)
      const x = seen.get(c.mmsi)
      if (!x || cov > x.cov) seen.set(c.mmsi, { cov, name: c.aisName })
    }
    const p = by.get(o.barge) || by.set(o.barge, { ops: 0, tugs: new Map() }).get(o.barge)
    p.ops++
    for (const [mmsi, x] of seen) {
      const t = p.tugs.get(mmsi) || p.tugs.set(mmsi, { together: 0, full: 0, names: new Map() }).get(mmsi)
      t.together++; if (x.cov >= rule.fullCover) t.full++
      if (x.name) t.names.set(x.name, (t.names.get(x.name) || 0) + 1)
    }
  }
  const out = []
  for (const [barge, p] of by) {
    if (p.ops < rule.minOps) continue
    const best = [...p.tugs].sort((x, y) => y[1].full - x[1].full || y[1].together - x[1].together)[0]
    if (!best) continue
    const [mmsi, t] = best
    const share = t.together / p.ops, fullShare = t.full / p.ops
    if (share < rule.minShare || fullShare < rule.minFullShare) continue
    const aisName = [...t.names].sort((x, y) => y[1] - x[1])[0]?.[0] || null
    out.push({ barge, mmsi, aisName, ops: p.ops, together: t.together, full: t.full, share: Math.round(share * 100) / 100, fullShare: Math.round(fullShare * 100) / 100 })
  }
  return out.sort((x, y) => y.ops - x.ops)
}

/** Rule 8 (pure): the paired tug's first call at one of the places overlapping the widened window, or null. */
export function findTugCall(op, places, calls, tugMmsi, rule = BARGE_TUG_RULE) {
  const H = 3600e3, s = ms(op.startAt), w0 = s - rule.tolH * H, w1 = s + ((op.durationH || 0) + rule.tolH) * H
  const keys = new Set(places)
  let best = null
  for (const c of calls) {
    if (!keys.has(c.terminalKey) || String(c.mmsi) !== String(tugMmsi) || ms(c.t1) < w0 || ms(c.t0) > w1) continue
    const d = Math.abs(ms(c.t0) - s)
    if (!best || d < best.d) best = { d, c }
  }
  return best?.c || null
}
