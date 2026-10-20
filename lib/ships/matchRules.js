/**
 * B, the same-MMSI match rules (Josh 2026-10-19, "all three merge rules"). Pure: one pair of ACTIVE vessel records that a
 * same-MMSI candidate link ties, plus each record's identity facts (scripts/ships/match/export-pairs.mjs) and, where our own
 * AIS positions cover the MMSI, the position check (scripts/ships/match/profile.py) → one verdict. Study and samples:
 * docs/SHIP_MATCH_RULES.md.
 *
 * Verdicts (first that applies):
 *   two_ships   different registry ids (IMO / USCG number), or call sign AND length both differ, or both identities broadcast
 *               in the same minute ≥ 5 km apart at least 3 times → kept apart; the card says another ship used this MMSI.
 *   blank_mmsi  the shared MMSI is a blank/default one (…000000, 123456789, not starting 2–7…): it is no evidence at all.
 *   lumped      either record already holds two different USCG / IMO numbers (it mixes boats): never merged into.
 *   merge_r1    same registry id (IMO or USCG number), none conflicting.
 *   merge_r2    exactly the same name (normalized), no conflicting call sign or length, real MMSI, no position veto.
 *   merge_r3    one record has no name (and no conflicting call sign), and its MMSI dates lie inside the other's.
 *   open        none of the above: stays "may be the same ship".
 * Near-miss names never count (numbered fleets: Blackfish II / III, SANDEMARINE68 / 95).
 */

/**
 * An MMSI that identifies no particular boat: blank/default values transponders send when unset (…000000, one digit
 * repeated, 123456789), numbers outside the ITU series (starting 0 or 1, or 9 other than 98/99), and emergency beacons
 * (970 SART, 972 MOB, 974 EPIRB: devices, not ships). Valid series stay evidence: 2–7 ships, 8 handheld radios,
 * 98 craft tied to a parent ship (tenders), 99 aids to navigation.
 */
export function isBlankMmsi(m) {
  const s = String(m ?? '')
  if (!/^\d{9}$/.test(s) || s.endsWith('000000') || new Set(s).size === 1 || ['123456789', '987654321'].includes(s)) return true
  if (/^[01]/.test(s)) return true
  if (s[0] === '9') return !/^9[89]/.test(s)
  return false
}

const agree = (x = [], y = [], eq = (u, v) => u === v) => (!x.length || !y.length ? 'missing' : x.some((u) => y.some((v) => eq(u, v))) ? 'agree' : 'conflict')
const lenEq = (u, v) => Math.abs(u - v) <= Math.max(1, 0.1 * Math.max(u, v))

/** The record's MMSI window for one MMSI: [first, last] ISO dates, or null. */
function windowOf(rec, mmsi) {
  const ps = (rec.mmsi || []).filter((x) => x.mmsi === mmsi && x.f && x.t)
  return ps.length ? [ps.map((x) => x.f).sort()[0], ps.map((x) => x.t).sort().at(-1)] : null
}

/**
 * Decide one pair. `A`, `B` = records ({ claims, names, callsigns, imos, official, lengths, mmsi: [{ mmsi, f, t }] }),
 * `mmsi` = the shared MMSI, `pos` = the position check or null. Returns { verdict, keep?, merge?, why }.
 */
export function judgePair(A, B, mmsi, pos = null) {
  const imo = agree(A.imos, B.imos), off = agree(A.official, B.official)
  const cs = agree(A.callsigns, B.callsigns), len = agree(A.lengths, B.lengths, lenEq)
  if (imo === 'conflict' || off === 'conflict') return { verdict: 'two_ships', why: 'different registry ids' }
  if ((pos?.same_minute_far ?? 0) >= 3) return { verdict: 'two_ships', why: `both broadcast at once, ≥5 km apart (${pos.same_minute_far} minutes)` }
  if (cs === 'conflict' && len === 'conflict') return { verdict: 'two_ships', why: 'call sign and length both differ' }
  if (isBlankMmsi(mmsi)) return { verdict: 'blank_mmsi', why: `MMSI ${mmsi} is a blank / default one` }
  if (A.official.length > 1 || B.official.length > 1 || A.imos.length > 1 || B.imos.length > 1) return { verdict: 'lumped', why: 'a record already holds two registry ids' }
  // The fuller record is kept: more claims, then the one listed first (the caller passes the older first).
  const [keep, merge] = A.claims >= B.claims ? ['a', 'b'] : ['b', 'a']
  if (imo === 'agree' || off === 'agree') return { verdict: 'merge_r1', keep, merge, why: imo === 'agree' ? 'same registry IMO' : 'same USCG number' }
  const exactName = A.names.some((n) => B.names.includes(n))
  if (exactName && cs !== 'conflict' && len !== 'conflict') return { verdict: 'merge_r2', keep, merge, why: 'exactly the same name, nothing conflicting' }
  const bare = (r) => !r.names.length // no name (a call sign, if any, must agree: checked just below)
  if (cs !== 'conflict' && (bare(A) || bare(B)) && !(bare(A) && bare(B))) {
    const stub = bare(A) ? A : B, named = stub === A ? B : A
    const ws = windowOf(stub, mmsi), wn = windowOf(named, mmsi)
    if (ws && wn && wn[0] <= ws[0] && ws[1] <= wn[1]) {
      return { verdict: 'merge_r3', keep: stub === A ? 'b' : 'a', merge: stub === A ? 'a' : 'b', why: 'nameless entry inside the named record’s MMSI dates' }
    }
  }
  return { verdict: 'open', why: 'not settled by the rules' }
}
