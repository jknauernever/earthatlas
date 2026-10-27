/**
 * B, the same-MMSI match rules (Josh 2026-10-19, "all three merge rules"). Pure: one pair of ACTIVE vessel records that a
 * same-MMSI candidate link ties, plus each record's identity facts (scripts/ships/match/export-pairs.mjs) and, where our own
 * AIS positions cover the MMSI, the position check (scripts/ships/match/profile.py) → one verdict. Study and samples:
 * docs/SHIP_MATCH_SCORE.md (rules + the score for what they leave open).
 *
 * Verdicts (first that applies):
 *   two_ships   different registry ids (IMO / USCG number), or call sign AND length both differ, or both identities broadcast
 *               in the same minute ≥ 5 km apart at least 3 times → kept apart; the card says another ship used this MMSI.
 *   blank_mmsi  the shared MMSI is a blank/default one (…000000, 123456789, not starting 2–7…): it is no evidence at all.
 *   lumped      either record already holds two different USCG / Canadian official numbers or registry IMOs (it may mix
 *               boats; lib/ships/splitLumped.js splits the clear ones): never merged into. State registrations, PSIX
 *               ids, hull numbers and HINs don't count here: owners file them with typos and they change (B2 study).
 *   merge_r1    same registry id (IMO or USCG number), none conflicting.
 *   merge_r2    exactly the same name (normalized), no conflicting call sign or length, real MMSI, no position veto.
 *   merge_r3    one record has no name (and no conflicting call sign), and its MMSI dates lie inside the other's, and inside
 *               no OTHER named record on that MMSI (ctx.r3Hosts; a stub that fits two boats could be either).
 *   gear        either record is AIS-equipped fishing gear: a name carrying a battery level or voltage ("HSD-NET-85%",
 *               "ST JOHN BUOY 10-61%", "BM11 12.1V"; record.gear from export-pairs.mjs). Not ships: no ship conclusion; the card
 *               says so (prod 2026-10-27: the "numbers" in SANDEMARINE68 / 95 or HSDNET99 / 94 are battery levels).
 *   numbered_fleet  names differ only by their number (SANDEMARINE68 / 95, BLACKFISH II / III, MISTY K II / III): kept
 *               apart like two_ships (C, Josh 2026-10-20).
 *   shared_mmsi 6+ records on the MMSI AND signs of many boats (ctx.manyBoats: 3+ records in numbered fleets with each
 *               other, or a 98x number, craft tied to a parent ship, which cruise lines reuse across lifeboats/tenders): net
 *               buoys, lifeboats. No MMSI-based conclusion; the card says the MMSI is shared. Fragments of ONE ship don't count
 *               (USCGC Munro: MUNRO, USCG755; USCGC Waesche and RCMSAR 31 carry 3+ call-sign spellings, so call signs don't count).
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

/** Official-number schemes that identify one hull for life (the "lumped" test and lib/ships/splitLumped.js). */
export const DOC_SCHEMES = ['us_official_number', 'ca_official_number']

// Gear is checked before any merge rule: two buoys at the same battery level have the same name.
/** A raw AIS name that carries a battery level or voltage: fishing gear (net buoys), not a ship. */
export const isGearName = (raw) => /\d{1,3}\s?%\s*$/.test(String(raw ?? '')) || /\b\d{1,2}(\.\d)?\s?V\s*$/i.test(String(raw ?? ''))

/** Records sharing one MMSI from which the MMSI stops meaning "one boat" (C study 2026-10-20: 42% of open pairs). */
export const CROWDED_MMSI = 6

const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 }
/**
 * A normalized name split into stem + hull number: trailing digits (SANDEMARINE068 → 68) or a trailing Roman numeral up to
 * X (BLACKFISHIII → 3), and a run of ones as a Roman numeral too (WHISKERS111 → 3). Ambiguous endings read both ways (MISTYKII: MISTYK + 2, MISTYKI + 1), so callers compare every
 * reading. Stems shorter than 3 letters don't count (all-digit buoy names). Pure; tested.
 */
export function hullNumbers(name) {
  const out = []
  const d = /^(.*?)0*(\d+)$/.exec(name || '')
  if (d && d[1].length >= 3) {
    out.push({ stem: d[1], n: Number(d[2]), digits: d[2] })
    // A run of ones may be a Roman numeral typed as digits (WHISKERS111 = WHISKERS III).
    if (/^1{1,3}$/.test(d[2])) out.push({ stem: d[1], n: d[2].length })
  }
  for (let k = 4; k >= 1; k--) {
    const tail = (name || '').slice(-k)
    if (ROMAN[tail] && name.length - k >= 3) out.push({ stem: name.slice(0, -k), n: ROMAN[tail] })
  }
  return out
}

/**
 * 'fleet' = some pair of names has the same stem with different numbers and no pair agrees on stem AND number ('same'; a
 * number that starts the other one also counts as 'same': a cut-off name, not another hull).
 */
export function numberRelation(as = [], bs = []) {
  let fleet = false
  for (const x of as) for (const y of bs) for (const u of hullNumbers(x)) for (const v of hullNumbers(y)) {
    if (u.stem !== v.stem) continue
    if (u.n === v.n) return 'same'
    // One number the start of the other (YUEJIANGCHENGYU96 / …96133): likely a name cut off at AIS's 20 characters.
    if (u.digits && v.digits && (u.digits.startsWith(v.digits) || v.digits.startsWith(u.digits))) return 'same'
    fleet = true
  }
  return fleet ? 'fleet' : null
}

const agree = (x = [], y = [], eq = (u, v) => u === v) => (!x.length || !y.length ? 'missing' : x.some((u) => y.some((v) => eq(u, v))) ? 'agree' : 'conflict')
const lenEq = (u, v) => Math.abs(u - v) <= Math.max(1, 0.1 * Math.max(u, v))

/** The record's MMSI window for one MMSI: [first, last] ISO dates, or null. */
function windowOf(rec, mmsi) {
  const ps = (rec.mmsi || []).filter((x) => x.mmsi === mmsi && x.f && x.t)
  return ps.length ? [ps.map((x) => x.f).sort()[0], ps.map((x) => x.t).sort().at(-1)] : null
}

const windowOn = (r, m) => { const ps = (r.mmsi || []).filter((x) => x.mmsi === m && x.f && x.t); return ps.length ? [ps.map((x) => x.f).sort()[0], ps.map((x) => x.t).sort().at(-1)] : null }

/**
 * MMSI-wide context for judgePair from an export (scripts/ships/match/export-pairs.mjs): `pairs` [{ a, b, mmsi }] and
 * `records` { id: record }. Returns ctxOf(pair) → { crowd, manyBoats, r3Hosts }.
 */
export function mmsiContexts(pairs, records) {
  const on = {}
  for (const p of pairs) for (const id of [p.a, p.b]) (on[p.mmsi] ||= new Set()).add(id)
  const many = {}
  for (const [m, set] of Object.entries(on)) {
    const ids = [...set]
    const fleet = ids.filter((x) => ids.some((y) => y !== x && numberRelation(records[x].names, records[y].names) === 'fleet')).length
    many[m] = fleet >= 3 || /^98/.test(m)
  }
  const hosts = (stub, m) => {
    const ws = windowOn(records[stub], m)
    return ws ? [...on[m]].filter((id) => { const w = id !== stub && records[id].names.length && windowOn(records[id], m); return w && w[0] <= ws[0] && ws[1] <= w[1] }).length : 0
  }
  return (p) => {
    const [A, B] = [records[p.a], records[p.b]]
    const stub = !A.names.length && B.names.length ? p.a : !B.names.length && A.names.length ? p.b : null
    return { crowd: on[p.mmsi].size, manyBoats: many[p.mmsi], r3Hosts: stub ? hosts(stub, p.mmsi) : undefined }
  }
}

/**
 * Decide one pair. `A`, `B` = records ({ claims, names, callsigns, imos, official, lengths, mmsi: [{ mmsi, f, t }] }),
 * `mmsi` = the shared MMSI, `pos` = the position check or null, `ctx` = MMSI-wide facts from the caller:
 * { crowd: records sharing the MMSI, r3Hosts: named records whose MMSI dates contain the nameless one's }. Returns
 * { verdict, keep?, merge?, why }.
 */
export function judgePair(A, B, mmsi, pos = null, ctx = {}) {
  const imo = agree(A.imos, B.imos), off = agree(A.official, B.official)
  const cs = agree(A.callsigns, B.callsigns), len = agree(A.lengths, B.lengths, lenEq)
  if (imo === 'conflict' || off === 'conflict') return { verdict: 'two_ships', why: 'different registry ids' }
  if ((pos?.same_minute_far ?? 0) >= 3) return { verdict: 'two_ships', why: `both broadcast at once, ≥5 km apart (${pos.same_minute_far} minutes)` }
  if (cs === 'conflict' && len === 'conflict') return { verdict: 'two_ships', why: 'call sign and length both differ' }
  if (isBlankMmsi(mmsi)) return { verdict: 'blank_mmsi', why: `MMSI ${mmsi} is a blank / default one` }
  if (A.gear || B.gear) return { verdict: 'gear', why: 'AIS-equipped fishing gear (its name carries a battery level), not a ship' }
  // `docs` = official numbers in DOC_SCHEMES only (export-pairs.mjs); older exports without it fall back to every number.
  const docs = (r) => r.docs ?? r.official
  if (docs(A).length > 1 || docs(B).length > 1 || A.imos.length > 1 || B.imos.length > 1) return { verdict: 'lumped', why: 'a record already holds two registry ids' }
  // The fuller record is kept: more claims, then the one listed first (the caller passes the older first).
  const [keep, merge] = A.claims >= B.claims ? ['a', 'b'] : ['b', 'a']
  if (imo === 'agree' || off === 'agree') return { verdict: 'merge_r1', keep, merge, why: imo === 'agree' ? 'same registry IMO' : 'same USCG number' }
  const exactName = A.names.some((n) => B.names.includes(n))
  if (exactName && cs !== 'conflict' && len !== 'conflict') return { verdict: 'merge_r2', keep, merge, why: 'exactly the same name, nothing conflicting' }
  const bare = (r) => !r.names.length // no name (a call sign, if any, must agree: checked just below)
  if (cs !== 'conflict' && (bare(A) || bare(B)) && !(bare(A) && bare(B))) {
    const stub = bare(A) ? A : B, named = stub === A ? B : A
    const ws = windowOf(stub, mmsi), wn = windowOf(named, mmsi)
    if (ws && wn && wn[0] <= ws[0] && ws[1] <= wn[1] && !((ctx.r3Hosts ?? 1) > 1)) {
      return { verdict: 'merge_r3', keep: stub === A ? 'b' : 'a', merge: stub === A ? 'a' : 'b', why: 'nameless entry inside the named record’s MMSI dates' }
    }
  }
  if (cs !== 'agree' && numberRelation(A.names, B.names) === 'fleet') return { verdict: 'numbered_fleet', why: 'names differ only by their number' }
  if ((ctx.crowd ?? 0) >= CROWDED_MMSI && ctx.manyBoats) return { verdict: 'shared_mmsi', why: `MMSI ${mmsi} is shared by ${ctx.crowd} records` }
  return { verdict: 'open', why: 'not settled by the rules' }
}
