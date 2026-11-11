/**
 * Planned vs. observed fueling and lightering at Washington anchorages (Josh 2026-10-20): Washington Ecology's Advance Notice of Transfer
 * operations (lib/ships/ecologyAnt.js) matched to the fuelings EarthAtlas sees in AIS (lib/ships/bunkerEvents.js). Read-only.
 *
 * Rules (from the March 2026 comparison: 35 of 42 notified fuelings found in AIS):
 *   1. Identity, not raw names: an operation's receiver is resolved to EarthAtlas ships by its normalized name (prefixes such as
 *      "ATB TUG " dropped, antShipName); an AIS fueling matches when its receiver is one of those ships, or, for a ship we can't
 *      resolve, when the names agree (one equal to, or ending with, the other: "MAERSK SAN VICENTE" ~ "SAN VICENTE").
 *   2. Time: the AIS fueling overlaps the notified window widened by TOL_H hours on each side (planned start + planned hours);
 *      Pacific local times are converted to UTC on import, so day and month edges match. One ship's notices pair with its AIS
 *      operations in time order (bm3); a notice left over may take the ship's next free operation at the same anchorage up to
 *      lateH hours past its window, when that operation starts inside no other notice's window (marked late).
 *   3. Place: the anchorage where AIS saw it may differ from the notified location (a berth, a neighboring anchorage); that is
 *      shown as a difference (distance between the two), never a reason to drop the match.
 *   4. Bunker tugs are learned: a supplier in at least LEARN_MIN matched fueling operations is a known bunker tug (bm3: not
 *      lightering, where escort and standby tugs lie by too). An AIS fueling with a
 *      known bunker tug alongside, or matched to a notice, counts; any other tug alongside is "tug alongside" and is left out of
 *      the counts (harbor-assist and escort tugs). Tug / ATB receivers count only with a known bunker tug alongside.
 *   5. Lightering is its own kind, taken from the notice's transfer type. It is matched on the ship AIS sees, the one that is not
 *      a barge (barges carry no AIS; their tug lies beside the ship): the deliverer when a tanker unloads to barges (Port Angeles),
 *      the receiver when a barge loads a tanker (March Point, Vendovi; bm2, 2026-11-10: before, these were always looked for
 *      under the barge and never seen). Barge to barge: the deliverer.
 *   6. Only Fueling and Lightering notices; notices outside the AIS box (the Columbia River) are left out. Tug / ATB receivers
 *      count only when matched to a notice (tugs raft together at their moorages), and an unmatched fueling counts only when it
 *      lasted minUnmatchedHours or more with a known bunker tug alongside.
 * Ecology's records cover Washington only, so British Columbia anchorages are never in "seen in AIS, no notice found".
 */
import { normName } from './normalize.js'
import { antShipName, groupAntOperations, readAntAnchorageRows } from './ecologyAnt.js'
import { groupFuelings, BUNKER_BAKE_VERSION } from './bunkerEvents.js'
import { classifyVessels, callKind } from './terminalCard.js'

// version keys the stored snapshot (readBunkerSnapshot): bm2 (2026-11-10) = lightering matched on the non-barge side (rule 5);
// bm3 (2026-11-10) = in-order pairing + late pass (matchOperations), on bunker events be5.
export const MATCH_RULE = Object.freeze({ version: 'bm3', tolH: 6, lateH: 30, lateKm: 10, learnMin: 2, locationDiffKm: 3, minUnmatchedHours: 2 })
const isBarge = (type) => /BARGE/i.test(String(type || ''))
/** The ship AIS sees for an operation (rule 5): the receiver for fueling; for lightering the side that is not a barge. Pure. */
export function aisShipOf(op) {
  if (op.kind !== 'lightering') return op.receiver
  if (op.deliverers[0] && !isBarge(op.delivererType)) return op.deliverers[0]
  if (op.receiver && !isBarge(op.receiverType)) return op.receiver
  return op.deliverers[0] || op.receiver
}
// The AIS bake's box (scripts/ships/bake-ais/region.py salish-v6): notices outside it (the Columbia River) can't be seen.
const AIS_BOX = { w: -126.2, s: 47.0, e: -122.05, n: 49.6 }
const inAisBox = (o) => Number.isFinite(o.lat) && o.lat >= AIS_BOX.s && o.lat <= AIS_BOX.n && o.lon >= AIS_BOX.w && o.lon <= AIS_BOX.e
const TUG_TYPES = new Set([31, 32, 52])
const US_ANCHORAGE_SOURCES = ['noaa-mc-anchorages', 'uscg-vts-ps-nondesignated']

// ── Pure ─────────────────────────────────────────────────────────────────────

const ms = (t) => new Date(t).getTime()
const km = (a, b) => {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return null
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}
/** Names that refer to the same ship: equal, or one ends with the other as whole words ("MAERSK SAN VICENTE" ~ "SAN VICENTE"). */
export function namesAgree(a, b) {
  const x = antShipName(a), y = antShipName(b)
  if (!x || !y) return false
  if (normName(x) === normName(y)) return true
  const [long, short] = x.length >= y.length ? [x, y] : [y, x]
  return short.split(' ').length >= 2 && long.endsWith(` ${short}`)
}
const shipKey = (s) => s.vesselId || `mmsi:${s.mmsi}`

/**
 * Match operations to AIS fuelings (pure). ops: groupAntOperations() rows + { vesselIds:Set }; fuelings: groupFuelings() rows with
 * { anchorageKey, anchorageName, anchorageCenter }. Each fueling matches at most one operation. Returns
 * { matched: [{ op, fueling, delayH, hoursDiff, locationKm, late }], notSeen: [op], unmatched: [fueling] }.
 *
 * bm3 (2026-11-10): one ship's notices and its AIS operations are paired IN TIME ORDER, the most pairs first, then the
 * smallest total start difference (before, each notice took the closest start, so four back-to-back barges at Port Angeles,
 * each about 4 h early, left the first session and the last notice unpaired: Ohio 2025-12-20). Then a notice still unpaired
 * may take that ship's next unpaired AIS operation up to lateH hours past its window, at the same anchorage (within
 * lateKm), when it does not start inside another notice's window (the ship arrived late: Ohio 2026-03-25, lightered ~21 h later).
 */
export function matchOperations(ops, fuelings, rule = MATCH_RULE) {
  const H = 3600e3
  const fits = (op, f) => (f.receiver.vesselId && op.vesselIds?.size ? op.vesselIds.has(f.receiver.vesselId) : namesAgree(op.ship, f.receiver.name))
  const win = (op) => [ms(op.startAt) - rule.tolH * H, ms(op.startAt) + ((op.durationH || 0) + rule.tolH) * H]
  const inWin = (f, [w0, w1]) => ms(f.t1) >= w0 && ms(f.t0) <= w1
  const pair = (op, f, late = false) => ({ op, fueling: f, late, delayH: Math.round(((ms(f.t0) - ms(op.startAt)) / H) * 10) / 10,
    hoursDiff: op.durationH == null ? null : Math.round((f.hours - op.durationH) * 10) / 10,
    locationKm: (() => { const d = km({ lat: op.lat, lon: op.lon }, f.anchorageCenter); return d == null ? null : Math.round(d * 10) / 10 })() })
  const groupKey = (op) => (op.vesselIds?.size ? `v:${[...op.vesselIds].sort().join(',')}` : `n:${normName(antShipName(op.ship))}`)
  const groups = new Map()
  for (const op of [...ops].sort((a, b) => a.startAt.localeCompare(b.startAt))) (groups.get(groupKey(op)) || groups.set(groupKey(op), []).get(groupKey(op))).push(op)
  const used = new Set()
  const matched = [], notSeen = []
  for (const g of groups.values()) {
    const fs = fuelings.map((f, i) => ({ f, i })).filter(({ f, i }) => !used.has(i) && fits(g[0], f)).sort((a, b) => a.f.t0.localeCompare(b.f.t0))
    const W = g.map(win)
    // Order-preserving alignment: best[i][j] = [pairs, -total |start difference| h] for the first i notices and j operations.
    const n = g.length, m = fs.length
    const best = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => [0, 0]))
    const from = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))   // 0 skip notice, 1 skip operation, 2 pair
    const better = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      if (!i && !j) continue
      let b = null, how = 0
      if (i) { b = best[i - 1][j]; how = 0 }
      if (j && (!b || better(best[i][j - 1], b))) { b = best[i][j - 1]; how = 1 }
      if (i && j && inWin(fs[j - 1].f, W[i - 1])) {
        const c = [best[i - 1][j - 1][0] + 1, best[i - 1][j - 1][1] - Math.abs(ms(fs[j - 1].f.t0) - ms(g[i - 1].startAt)) / H]
        if (better(c, b)) { b = c; how = 2 }
      }
      best[i][j] = b; from[i][j] = how
    }
    const got = new Map()   // notice index → fs index
    for (let i = n, j = m; i > 0 || j > 0;) {
      const how = from[i][j]
      if (how === 2) { got.set(i - 1, j - 1); i--; j-- } else if (how === 1) j--; else i--
    }
    const taken = new Set(got.values())
    // Late pass: the ship's next free operation after the notice, within lateH past its window, same anchorage, in no other window.
    for (let i = 0; i < n; i++) {
      if (got.has(i)) continue
      const [w0, w1] = W[i]
      const j = fs.findIndex(({ f }, k) => !taken.has(k) && ms(f.t0) >= w0 && ms(f.t0) <= w1 + rule.lateH * H
        && W.every(([o0, o1], o) => o === i || ms(f.t0) < o0 || ms(f.t0) > o1)
        && (km({ lat: g[i].lat, lon: g[i].lon }, f.anchorageCenter) ?? Infinity) <= rule.lateKm)
      if (j >= 0) { got.set(i, j); taken.add(j); fs[j].late = true }
    }
    g.forEach((op, i) => {
      if (!got.has(i)) return notSeen.push(op)
      const { f, i: fi, late } = fs[got.get(i)]
      used.add(fi)
      matched.push(pair(op, f, !!late))
    })
  }
  matched.sort((a, b) => a.op.startAt.localeCompare(b.op.startAt))
  notSeen.sort((a, b) => a.startAt.localeCompare(b.startAt))
  return { matched, notSeen, unmatched: fuelings.filter((_, i) => !used.has(i)) }
}

/** Suppliers alongside in at least learnMin matched operations: the known bunker tugs (pure). → Map key → { name, vesselId, mmsi, matches } */
export function learnBunkerTugs(matched, rule = MATCH_RULE) {
  const m = new Map()
  for (const { fueling } of matched) for (const s of fueling.suppliers) {
    const x = m.get(shipKey(s)) || { name: s.name, vesselId: s.vesselId, mmsi: s.mmsi, matches: 0 }
    x.matches++
    m.set(shipKey(s), x)
  }
  return new Map([...m].filter(([, v]) => v.matches >= rule.learnMin))
}

// ── Read ─────────────────────────────────────────────────────────────────────

const iso = (d) => (d instanceof Date ? d.toISOString() : String(d))

/** AIS fuelings (all bunker_events of the version in `months`), receivers / suppliers resolved, grouped per receiver. */
async function readFuelings(q, S, months) {
  const rows = await q(
    `SELECT e.anchorage_source_id AS sid, e.anchorage_source_key AS skey, e.outside, e.receiver_mmsi, e.supplier_mmsi, e.t0, e.t1, e.min_m,
            e.r_name, e.r_type, e.r_length, e.s_name, e.s_type, e.s_length, e.bake_record_id, a.name AS anchorage_name,
            (a.min_lat + a.max_lat) / 2 AS clat, (a.min_lon + a.max_lon) / 2 AS clon
       FROM ${S}.bunker_events e
       LEFT JOIN ${S}.anchorages a ON a.status = 'active' AND a.source_id = e.anchorage_source_id AND a.source_key = e.anchorage_source_key
      WHERE e.bake_version = $1 AND to_char(e.t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($2) ORDER BY e.t0`, [BUNKER_BAKE_VERSION, months])
  if (!rows.length) return []
  const resolve = async (col) => {
    const res = await q(
      `SELECT x.i, array_agg(DISTINCT v.vessel_id) AS ids FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS x(i, mmsi, at)
         CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
      [rows.map((_, i) => i), rows.map((r) => r[col]), rows.map((r) => iso(r.t0))])
    for (const r of res) if (r.ids.length === 1) rows[r.i][`${col}_v`] = r.ids[0]
  }
  await resolve('receiver_mmsi'); await resolve('supplier_mmsi')
  const byVessel = await classifyVessels(q, S, [...new Set(rows.flatMap((r) => [r.receiver_mmsi_v, r.supplier_mmsi_v]).filter(Boolean))])
  const kind = (v, t) => callKind({ vesselId: v, ais_vessel_type: t }, byVessel)
  const evs = rows.map((r) => ({
    t0: iso(r.t0), t1: iso(r.t1), outside: r.outside, minM: r.min_m == null ? null : Math.round(r.min_m), recordId: Number(r.bake_record_id),
    anchorageKey: `${r.sid}|${r.skey}`, anchorageName: r.anchorage_name, us: US_ANCHORAGE_SOURCES.includes(r.sid),
    anchorageCenter: r.clat == null ? null : { lat: Number(r.clat), lon: Number(r.clon) },
    receiver: { mmsi: r.receiver_mmsi, vesselId: r.receiver_mmsi_v || null, name: r.r_name, tug: TUG_TYPES.has(Number(r.r_type)), kind: kind(r.receiver_mmsi_v, r.r_type) },
    supplier: { mmsi: r.supplier_mmsi, vesselId: r.supplier_mmsi_v || null, name: r.s_name, kind: kind(r.supplier_mmsi_v, r.s_type) },
  })).filter((e) => e.receiver.kind?.class !== 'ferry')
  // One fueling per receiver and anchorage when tugs overlap; keep the anchorage fields and every bake record behind it.
  const byAnch = new Map()
  for (const e of evs) (byAnch.get(e.anchorageKey) || byAnch.set(e.anchorageKey, []).get(e.anchorageKey)).push(e)
  const out = []
  for (const list of byAnch.values()) {
    const meta = list[0]
    for (const f of groupFuelings(list)) out.push({ ...f, anchorageKey: meta.anchorageKey, anchorageName: meta.anchorageName, us: meta.us,
      anchorageCenter: meta.anchorageCenter, recordId: meta.recordId, receiverTug: list.some((e) => shipKey(e.receiver) === shipKey(f.receiver) && e.receiver.tug) })
  }
  return out
}

/** ANT receiver names → EarthAtlas ships (by normalized name, prefixes dropped). Map antShipName → Set(vessel_id). */
async function resolveAntReceivers(q, S, names) {
  const norms = [...new Set(names.map((n) => normName(antShipName(n))).filter(Boolean))]
  if (!norms.length) return new Map()
  const rows = await q(`SELECT DISTINCT value_norm, vessel_id FROM ${S}.vessel_assertions WHERE attribute = 'name' AND value_norm = ANY($1)`, [norms])
  const m = new Map()
  for (const r of rows) (m.get(r.value_norm) || m.set(r.value_norm, new Set()).get(r.value_norm)).add(r.vessel_id)
  return m
}

// Months are cut in Pacific time, as the notices are written (a 7 pm Feb 28 notice is February, not March in UTC).
const pacMonth = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)
/** The key the report, the anchorage cards and the map badge share for one AIS fueling. */
export const fuelingKey = (f) => `${f.anchorageKey}|${f.receiver.mmsi}|${f.t0}`
const cleanOp = (o) => { const { vesselIds, ...x } = o; return x }   // Sets don't serialize; the ids aren't shown

/**
 * The whole computation (every covered month): Ecology operations at Washington anchorages matched to AIS fuelings, the learned
 * bunker tugs, and every counted AIS fueling at ANY anchorage (British Columbia too, by the same known-tug rule), for the anchorage
 * cards and the map badge. Serializable; stored by buildBunkerSnapshot, read by readBunkerReport / readCountedFuelings.
 */
export async function computeBunkerReport(q, S) {
  const [bake] = await q(`SELECT months, bake_record_id FROM ${S}.bunker_event_bakes WHERE bake_version = $1`, [BUNKER_BAKE_VERSION]).catch(() => [])
  const [span] = await q(`SELECT min(start_at) AS a, max(start_at) AS b, max(release_id) AS release FROM ${S}.ecology_ant_rows WHERE location LIKE 'Anchor - %'`).catch(() => [])
  if (!bake) return { available: false }
  const antMonths = new Set()
  if (span?.a) for (let d = new Date(span.a); d <= new Date(span.b); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) antMonths.add(d.toISOString().slice(0, 7))
  const aisMonths = [...bake.months].sort()
  const all = aisMonths.filter((m) => antMonths.has(m))
  const base = { available: all.length > 0, months: all, rule: MATCH_RULE, aisRecordId: Number(bake.bake_record_id), release: span?.release || null,
    bakeVersion: BUNKER_BAKE_VERSION, aisMonths }
  let ops = []
  if (all.length) {
    const fromIso = `${all[0]}-01T00:00:00Z`, toIso = new Date(Date.UTC(+all.at(-1).slice(0, 4), +all.at(-1).slice(5, 7), 1)).toISOString()
    const antRows = await readAntAnchorageRows(q, S, { fromIso: new Date(ms(fromIso) - 24 * 3600e3).toISOString(), toIso })
    ops = groupAntOperations(antRows).filter((o) => o.transferTypes.some((t) => /^fuel|lighter/i.test(t)) && inAisBox(o))
    // The ship AIS sees beside the tug (rule 5).
    for (const o of ops) { o.kind = o.transferTypes.some((t) => /lighter/i.test(t)) ? 'lightering' : 'fueling'; o.ship = aisShipOf(o) }
    const names = await resolveAntReceivers(q, S, ops.map((o) => o.ship))
    for (const o of ops) o.vesselIds = names.get(normName(antShipName(o.ship))) || new Set()
  }
  const everywhere = await readFuelings(q, S, aisMonths)
  const fuelings = everywhere.filter((f) => f.us && all.includes(pacMonth(f.t0)))
  const first = matchOperations(ops, fuelings)
  // Learned from fueling matches only (bm3): escort and standby tugs stand by lightering (Guard, Tug Response at Vendovi).
  const tugs = learnBunkerTugs(first.matched.filter((m) => m.op.kind === 'fueling'))
  // Count a fueling when it is matched, or a known bunker tug was alongside an anchored ship (not a tug) for minUnmatchedHours.
  const known = (f) => f.suppliers.some((s) => tugs.has(shipKey(s)))
  const matchedIdx = new Set(first.matched.map((m) => m.fueling))
  const countedHere = (f) => matchedIdx.has(f) || (known(f) && !f.receiverTug && !tugs.has(shipKey(f.receiver)) && f.hours >= MATCH_RULE.minUnmatchedHours)
  for (const m of first.matched) m.kind = m.op.kind
  // Each notified location's center (mean of its notices' positions), with Ecology's City / Region: AIS-only operations are
  // filed under the nearest one, and anchorage cards link to the report at that place.
  const cen = new Map()
  for (const o of ops) if (Number.isFinite(o.lat)) {
    const x = cen.get(o.location) || { location: o.location, lat: 0, lon: 0, n: 0, city: o.city, region: o.region }
    x.lat += o.lat; x.lon += o.lon; x.n++; cen.set(o.location, x)
  }
  const locationCenters = [...cen.values()].map((x) => ({ location: x.location, lat: x.lat / x.n, lon: x.lon / x.n, city: x.city, region: x.region }))
  const nearestLocation = (c0) => {
    let best = null
    if (c0) for (const x of locationCenters) { const d = km(c0, x); if (d != null && d <= 6 && (!best || d < best.d)) best = { d, x } }
    return best?.x.location || null
  }
  // Every counted fueling at any anchorage (cards + badge): key → { notified: record ids of the matched notice, or null }.
  const notifiedOf = new Map(first.matched.map((m) => [m.fueling, { recordIds: m.op.recordIds, antIds: m.op.antIds }]))
  const counted = everywhere.filter((f) => (f.us ? fuelings.includes(f) && countedHere(f)
    : known(f) && !f.receiverTug && !tugs.has(shipKey(f.receiver)) && f.hours >= MATCH_RULE.minUnmatchedHours))
  const anchoragePlace = {}
  for (const f of counted) if (f.us && !(f.anchorageKey in anchoragePlace)) anchoragePlace[f.anchorageKey] = nearestLocation(f.anchorageCenter)
  return { ...base,
    matched: first.matched.map((m) => ({ ...m, op: cleanOp(m.op) })),
    notSeen: first.notSeen.map(cleanOp),
    seenNoNotice: fuelings.filter((f) => !matchedIdx.has(f) && countedHere(f)),
    locations: [...new Set(ops.map((o) => o.location))].sort(), locationCenters,
    bunkerTugs: [...tugs.values()].sort((a, b) => b.matches - a.matches || String(a.name).localeCompare(String(b.name))),
    counted: counted.map((f) => ({ key: fuelingKey(f), month: pacMonth(f.t0), anchorageKey: f.anchorageKey, notified: notifiedOf.get(f) || null })),
    anchoragePlace }
}

/** Compute and store the report (run after an AIS bake or an Ecology release is imported). */
export async function buildBunkerSnapshot(q, S) {
  const r = await computeBunkerReport(q, S)
  if (r.aisRecordId == null) throw new Error('no bunkering bake loaded')
  const [row] = await q(`INSERT INTO ${S}.bunker_snapshots (bake_version, bake_record_id, ant_release, rule, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id, built_at`,
    [BUNKER_BAKE_VERSION, r.aisRecordId, r.release, MATCH_RULE, r])
  return { id: Number(row.id), builtAt: row.built_at, matched: r.matched.length, notSeen: r.notSeen.length, seenNoNotice: r.seenNoNotice.length, counted: r.counted.length }
}

/** The stored report for the current bake (and its Ecology release), else null (before migration 040 or the first build). */
export async function readBunkerSnapshot(q, S) {
  try {
    const [row] = await q(`SELECT s.payload, s.built_at FROM ${S}.bunker_snapshots s
                            JOIN ${S}.bunker_event_bakes b ON b.bake_version = s.bake_version AND b.bake_record_id = s.bake_record_id
                           WHERE s.bake_version = $1 AND s.rule->>'version' = $2
                             AND s.ant_release IS NOT DISTINCT FROM (SELECT max(release_id) FROM ${S}.ecology_ant_rows)
                           ORDER BY s.built_at DESC LIMIT 1`, [BUNKER_BAKE_VERSION, MATCH_RULE.version])
    return row ? { ...row.payload, builtAt: row.built_at } : null
  } catch (e) {
    if (e?.code === '42P01') return null
    throw e
  }
}

/**
 * The report for the picked months: the stored computation (or, before one exists, a fresh one), cut to [from, to] by Pacific
 * month. The learned tugs come from every covered month, so a short pick classifies the same way.
 */
export async function readBunkerReport(q, S, { from = null, to = null } = {}) {
  const r = (await readBunkerSnapshot(q, S)) || await computeBunkerReport(q, S)
  if (!r.available) return { available: false }
  const months = r.months.filter((m) => (!from || m >= from) && (!to || m <= to))
  const inPick = (t) => months.includes(pacMonth(t))
  const { counted, anchoragePlace, aisMonths, ...rest } = r
  return { ...rest, picked: months,
    matched: r.matched.filter((m) => inPick(m.op.startAt)), notSeen: r.notSeen.filter((o) => inPick(o.startAt)), seenNoNotice: r.seenNoNotice.filter((f) => inPick(f.t0)) }
}

/** For the anchorage cards and the map badge: the counted fuelings (key → notified notice or null), learned tugs, places. */
export async function readCountedFuelings(q, S) {
  const r = await readBunkerSnapshot(q, S)
  if (!r) return null
  return { counted: new Map(r.counted.map((x) => [x.key, x])), list: r.counted, anchoragePlace: r.anchoragePlace || {}, months: r.aisMonths || r.months }
}
