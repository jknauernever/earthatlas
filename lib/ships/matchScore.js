/**
 * A (Josh 2026-10-20, "C then A"): a Fellegi–Sunter match score for same-MMSI pairs the rules (lib/ships/matchRules.js) leave
 * open. Pure. Each pair → categorical features → one weight per feature (log2 m/u: how much more often that value occurs
 * when the two records are the same ship than when they are two ships) → total → probability → band.
 *
 * Weights are FIT, not hand-set (scripts/ships/match/score.mjs): semi-supervised EM over the open pairs, with the pairs the
 * rules already decided as anchors, but an anchor only teaches the features its own rule did NOT look at (R3 needs "no
 * name", so R3 pairs say nothing about the name feature; otherwise the weights just repeat the rules).
 *
 * The fitted model is lib/ships/data/matchModel.json (from the hand labels in lib/ships/data/matchLabels.json).
 * Bands (thresholds checked against a hand-labeled sample, docs/SHIP_MATCH_SCORE.md):
 *   merge     the score says same ship AND hard guards hold (a one-letter name typo, call sign or length agreeing, nothing
 *             conflicting). Never merged automatically: listed for Josh.
 *   probably  "probably the same ship": shown on the card, not merged.
 *   separate  "probably two different ships": shown on the card, not acted on.
 *   unknown   not enough evidence either way: stays "may be the same ship".
 */
import { crosswalkClaim } from './taxonomy.js'
import { numberRelation } from './matchRules.js'

export const SCORE_MODEL = 'b-score-v1'

/** Features and their levels; `missing` levels carry no information by design (weight fit like any other). */
export const FEATURES = {
  name: ['exact', 'typo', 'prefix', 'different', 'one_missing', 'both_missing'],
  callsign: ['agree', 'conflict', 'missing'],
  length: ['agree', 'conflict', 'missing'],
  type: ['agree', 'conflict', 'missing'],
  flag: ['agree', 'conflict', 'missing'],
  window: ['nested', 'out_le180d', 'out_gt180d', 'disjoint', 'missing'],
  fragment: ['small', 'larger'],
  crowd: ['2', '3-5'],
  // GFW port visits of both records over their shared dates (scripts/ships/match/label-evidence.mjs): seen at the same port at
  // the same time, impossible travel between them (two places at once), or both seen in port but never together.
  ports: ['together', 'impossible', 'apart', 'missing'],
}

/** Which features each rule verdict looked at (its anchors don't teach those). */
export const RULE_FEATURES = {
  merge_r1: [],
  merge_r2: ['name', 'callsign', 'length'],
  merge_r3: ['name', 'callsign', 'window'],
  two_ships: ['callsign', 'length'],
  numbered_fleet: ['name', 'callsign'],
}

const lev = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}

/** Name relation between two records' normalized names (numbered fleets never reach here: matchRules decides them). */
export function nameRelation(as = [], bs = []) {
  if (!as.length && !bs.length) return 'both_missing'
  if (!as.length || !bs.length) return 'one_missing'
  let best = 'different'
  for (const x of as) for (const y of bs) {
    if (x === y) return 'exact'
    if (numberRelation([x], [y]) === 'fleet') continue
    if (Math.min(x.length, y.length) >= 5 && lev(x, y) === 1 && x.replace(/\D/g, '') === y.replace(/\D/g, '')) best = 'typo'
    else if (best === 'different' && Math.min(x.length, y.length) >= 5 && (x.startsWith(y) || y.startsWith(x))) best = 'prefix'
  }
  return best
}

/** Taxonomy group of one stored type ("source:VALUE"); GFW's "passenger" covers pleasure craft, so the two are one family. */
function typeFamily(t) {
  const i = t.indexOf(':')
  const m = crosswalkClaim({ source_id: t.slice(0, i), value_norm: t.slice(i + 1) })
  const g = m?.group
  if (!g || ['unknown', 'other'].includes(g)) return null
  return g === 'recreational' ? 'passenger' : g
}

const agree = (x = [], y = [], eq = (u, v) => u === v) => (!x.length || !y.length ? 'missing' : x.some((u) => y.some((v) => eq(u, v))) ? 'agree' : 'conflict')
const lenEq = (u, v) => Math.abs(u - v) <= Math.max(1, 0.1 * Math.max(u, v))
const day = (s) => Date.parse(s) / 864e5
const windowOf = (r, m) => { const ps = (r.mmsi || []).filter((x) => x.mmsi === m && x.f && x.t); return ps.length ? [ps.map((x) => x.f).sort()[0], ps.map((x) => x.t).sort().at(-1)] : null }

/**
 * One pair's features. `A`, `B` = records as exported (scripts/ships/match/export-pairs.mjs); ctx.crowd = records on the MMSI,
 * ctx.ports = the port-visit test (portRelation) when fetched.
 */
export function pairFeatures(A, B, mmsi, ctx = {}) {
  const wa = windowOf(A, mmsi), wb = windowOf(B, mmsi)
  let window = 'missing'
  if (wa && wb) {
    if (wa[1] < wb[0] || wb[1] < wa[0]) window = 'disjoint'
    else {
      // How far the smaller record's dates stick out of the bigger one's (a fragment inside its ship's history is "nested").
      const [s, b] = A.claims <= B.claims ? [wa, wb] : [wb, wa]
      const out = Math.max(0, day(b[0]) - day(s[0])) + Math.max(0, day(s[1]) - day(b[1]))
      window = out === 0 ? 'nested' : out <= 180 ? 'out_le180d' : 'out_gt180d'
    }
  }
  const fam = (r) => [...new Set((r.types || []).map(typeFamily).filter(Boolean))]
  return {
    name: nameRelation(A.names, B.names),
    callsign: agree(A.callsigns, B.callsigns),
    length: agree(A.lengths, B.lengths, lenEq),
    type: agree(fam(A), fam(B)),
    flag: agree(A.flags, B.flags),
    window,
    fragment: Math.min(A.claims, B.claims) <= 5 ? 'small' : 'larger',
    crowd: (ctx.crowd ?? 2) <= 2 ? '2' : '3-5',
    ports: ctx.ports ?? 'missing',
  }
}

const MISSING = new Set(['missing', 'one_missing', 'both_missing'])
const AGREE = new Set(['agree', 'exact', 'typo', 'nested', 'together'])
const CONFLICT = new Set(['conflict', 'different', 'disjoint', 'impossible'])

/**
 * Fit m/u. `rows` = [{ x: features, label: 1 | 0 | null, rule? }]; labeled rows are fixed and teach only features outside
 * RULE_FEATURES[rule]. `fixedU` = { feature: { level: u } } measured elsewhere (chance agreement between RANDOM records:
 * score.mjs), which pins what "two ships" looks like; plain EM without it split stubs from full records instead of same
 * from different (dev 2026-10-20: "different call signs" came out as evidence FOR a match). Missing values are ignored (no
 * weight either way: whether a source carries a call sign says nothing about the match). After fitting, agreement can't
 * count against a match and conflict can't count for one. Laplace smoothing. Returns { lambda, m, u }.
 */
export function fitEM(rows, { iters = 100, alpha = 1, fixedU = {}, unlabeled = true } = {}) {
  if (!unlabeled) { rows = rows.filter((r) => r.label != null); iters = 1 }
  const F = Object.keys(FEATURES)
  const lv = (k) => FEATURES[k].filter((v) => !MISSING.has(v))
  const flat = (k) => Object.fromEntries(lv(k).map((v) => [v, 1 / lv(k).length]))
  let m = Object.fromEntries(F.map((k) => [k, flat(k)])), u = Object.fromEntries(F.map((k) => [k, fixedU[k] ? { ...fixedU[k] } : flat(k)]))
  for (const k of F) for (const v of lv(k)) { if (AGREE.has(v)) m[k][v] *= 3; if (CONFLICT.has(v)) m[k][v] /= 3 }
  let lambda = 0.3
  const post = (x) => { let a = Math.log(lambda), b = Math.log(1 - lambda); for (const k of F) { if (x[k] == null || MISSING.has(x[k])) continue; a += Math.log(m[k][x[k]]); b += Math.log(u[k][x[k]]) } return 1 / (1 + Math.exp(b - a)) }
  for (let it = 0; it < iters; it++) {
    const g = rows.map((r) => (r.label ?? post(r.x)))
    const unl = rows.map((r, i) => (r.label == null ? g[i] : null)).filter((v) => v != null)
    lambda = unlabeled ? Math.min(0.99, Math.max(0.01, unl.length ? unl.reduce((s, v) => s + v, 0) / unl.length : 0.5)) : 0.5
    for (const k of F) {
      const cm = Object.fromEntries(lv(k).map((v) => [v, alpha])), cu = { ...cm }
      rows.forEach((r, i) => {
        if (r.x[k] == null || MISSING.has(r.x[k]) || (r.label != null && (RULE_FEATURES[r.rule] || []).includes(k))) return
        cm[r.x[k]] += g[i]; cu[r.x[k]] += 1 - g[i]
      })
      const sm = Object.values(cm).reduce((s, v) => s + v, 0), su = Object.values(cu).reduce((s, v) => s + v, 0)
      for (const v of lv(k)) { m[k][v] = cm[v] / sm; if (!fixedU[k]) u[k][v] = cu[v] / su }
    }
  }
  return { lambda, m, u }
}

/** Weights (log2 m/u) from a fit: the table stored with the model and shown in the docs. */
export const weightsOf = ({ m, u }) => Object.fromEntries(Object.keys(FEATURES).map((k) => [k, Object.fromEntries(FEATURES[k].map((v) => {
  if (MISSING.has(v)) return [v, 0]
  let w = Math.log2(m[k][v] / u[k][v])
  if (AGREE.has(v)) w = Math.max(0, w); if (CONFLICT.has(v)) w = Math.min(0, w)
  return [v, +w.toFixed(2)]
}))]))

// Chosen 2026-10-20 from the leave-one-out check (docs/SHIP_MATCH_SCORE.md): probably 15/16, separate 7/7.
export const DEFAULT_BANDS = { probably: 0.8, separate: 0.3 }

/**
 * Score one pair: { total (sum of weights, bits), p (probability same ship, with the fit's prior), band, parts }.
 * `model` = { lambda, weights, bands }.
 */
export function scorePair(x, model) {
  // A feature the model or the pair lacks (an older model, ports not fetched) counts as missing: no weight.
  const parts = Object.keys(FEATURES).map((k) => ({ feature: k, value: x[k] ?? 'missing', w: model.weights[k]?.[x[k]] ?? 0 }))
  const total = parts.reduce((s, p) => s + p.w, 0)
  const logit = total * Math.LN2 + Math.log(model.lambda / (1 - model.lambda))
  const p = 1 / (1 + Math.exp(-logit))
  const bands = model.bands || DEFAULT_BANDS
  const conflict = x.callsign === 'conflict' || x.length === 'conflict' || x.flag === 'conflict' || x.type === 'conflict' || x.ports === 'impossible'
  let band = 'unknown'
  if (p >= bands.probably && !conflict && x.name !== 'different') {
    band = x.name === 'typo' && (x.callsign === 'agree' || x.length === 'agree') ? 'merge' : 'probably'
  } else if (p <= bands.separate) band = 'separate'
  return { total: +total.toFixed(2), p: +p.toFixed(3), band, parts }
}

/**
 * The port-visit test for one pair: `visits` = [{ who: 'A'|'B', s, e, port, lat, lon }] over the shared dates. 'impossible' =
 * a moment A was seen in port and a moment B was, > 50 km apart and closer in time than a 50-knot boat could cover; else
 * 'together' = same port, overlapping stays; else 'apart' (both seen, never together); 'missing' = one side has no visits.
 */
export function portRelation(visits) {
  const A = visits.filter((v) => v.who === 'A'), B = visits.filter((v) => v.who === 'B')
  if (!A.length || !B.length) return 'missing'
  const hav = (a, b) => { const r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lon - a.lon) * r; return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2)) }
  const inst = (v) => [v.s, v.e].map((t) => ({ t: Date.parse(t), lat: v.lat, lon: v.lon }))
  for (const x of A.flatMap(inst)) for (const y of B.flatMap(inst)) {
    if (x.lat == null || y.lat == null) continue
    const km = hav(x, y), h = Math.abs(x.t - y.t) / 36e5
    if (km > 50 && km / Math.max(h, 0.25) > 50 * 1.852) return 'impossible'
  }
  return A.some((a) => B.some((b) => a.port && a.port !== '?' && a.port === b.port && a.s < b.e && b.s < a.e)) ? 'together' : 'apart'
}

/** Plain-English reasons for the card, strongest first (only features that moved the score). */
const SAYS = {
  name: { exact: 'same name', typo: 'names differ by one letter', prefix: 'one name starts the other', different: 'different names' },
  callsign: { agree: 'same call sign', conflict: 'different call signs' },
  length: { agree: 'same length', conflict: 'different lengths' },
  type: { agree: 'same kind of vessel', conflict: 'different kinds of vessel' },
  flag: { agree: 'same flag', conflict: 'different flags' },
  ports: { together: 'seen at the same port at the same time', impossible: 'seen in two places at once', apart: 'never seen in port together' },
  window: { nested: 'dates fit inside the other record’s', out_le180d: 'dates nearly fit', out_gt180d: 'dates run well past the other record’s', disjoint: 'never on this MMSI at the same time' },
}
export function reasons(scored, min = 0.5) {
  return scored.parts.filter((p) => SAYS[p.feature]?.[p.value] && Math.abs(p.w) >= min).sort((a, b) => Math.abs(b.w) - Math.abs(a.w))
    .map((p) => ({ text: SAYS[p.feature][p.value], for: p.w > 0 }))
}
