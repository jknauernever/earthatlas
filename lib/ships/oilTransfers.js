/**
 * Planned vs. observed over-water oil transfers in Washington (Josh + Lovel Pratt, 2026-11-06): EVERY Washington Ecology Advance
 * Notice of Transfer (cargo, fueling, lightering, vacuum, other), not only fueling at anchorages (lib/ships/bunkerMatch.js), set
 * beside what EarthAtlas sees in AIS. Read-only: nothing here changes a source record, assertion or link. Rules: src/ships/CLAUDE.md.
 *
 *   evidence        ecology_ant_rows (migration 039; each notice its own source record), terminal_calls (migration 016, AIS),
 *                   bunker_events via the stored bunkering report (migration 040)
 *   interpretation  read time only (this file): notices grouped into operations (groupAntOperations), each operation's ship
 *                   picked, its setting and place classified, then checked against AIS; stored as a snapshot (migration 042)
 *
 * Rules (OT_RULE):
 *   1. Scope: Washington only (Ecology's records). Every notice counts as notified; the AIS check covers only months of AIS
 *      (both the terminal-call bake and the bunkering bake) and only notices inside the AIS box (salish-v6). Notices outside it
 *      (Grays Harbor, the Columbia and Snake rivers) are "can't be checked: outside AIS coverage", never "not seen".
 *   2. The ship: the notice party that carries AIS. Receiver first, else deliverer; never a facility, a truck ("Mobile") or a
 *      barge (barges carry no AIS of their own; ATB barge names are not the tug's AIS name). Small craft (fishing boats, work
 *      boats, recreational and unregulated vessels) are their own group, kept out of the main counts (Josh 2026-11-06).
 *   3. Anchorages ("Anchor - …"): fueling and lightering take the bunkering report's result for the same notice (same rule).
 *   4. Docks: the notified place is matched to EarthAtlas terminals (placeTerminals: the hand-checked table, else the nearest
 *      terminal with a berth within autoKm); the operation is seen when that
 *      ship has an AIS terminal call at one of them overlapping the notified window widened by tolH hours on each side. The ship
 *      is the same when one of its EarthAtlas records' MMSIs made the call, or the call's AIS name agrees with the notified name.
 *   5. A dock with no EarthAtlas terminal (ferry terminals, marinas, shipyards), or one whose berth points miss its ships ("gap"), is "can't be checked: not at a
 *      terminal EarthAtlas tracks", never "not seen". So is a military receiver (warships often do not broadcast AIS).
 *   6. A dock operation not found whose widened window runs past the first or last month of AIS is "can't be checked", not "not seen".
 *   4b (2026-11-07, Josh: "track the docks we don't track"). A dock Ecology names that no terminal covers (or a "gap" terminal) but
 *      that is in lib/ships/data/antDocks.js is checked the same way against DOCK calls (lib/ships/dockCalls.js, migration 043),
 *      in the months the dock-call bake covers. A military vessel found at its terminal or dock is seen; one not found stays
 *      "can't be checked: military vessel" (warships often do not broadcast AIS).
 *   7. Scrubber ships (2026-11-07): an operation's ship is scrubber-fitted when the EarthAtlas ships carrying its notified name
 *      (narrowed to the one holding the MMSI AIS saw, when seen) are all scrubber-fitted (scrubberFilter.js: IMO GISIS Reg. 4.2
 *      notifications or the MEP Alliance lists). A name that also belongs to a ship without a scrubber is never flagged.
 *   8. Barges (2026-11-07): a transfer naming only a barge (no vessel with AIS) at a terminal or tracked dock is checked through the
 *      barge's reviewed tug (lib/ships/data/bargeTugs.js): seen when that tug has a call there overlapping the widened window. An
 *      ATB barge and its tug are one unit, so an ATB transfer whose tug is not there is "not seen"; a towed barge can be left at
 *      the dock, so one whose tug is not there is "can't be checked".
 *   9. The other Seattle cruise pier (2026-11-08, Josh): a passenger-ship dock operation in Seattle that would be "not seen" is seen when its ship
 *      has a call at one of Seattle's two cruise terminals (Smith Cove / Pier 91, Bell Street / Pier 66) overlapping the widened
 *      window, at a pier other than the notified one (seen.kind 'otherPier', the pier AIS shows named on the operation). Seven
 *      cruise notices of Jan 2025–Jun 2026 named Pier 91 while the ship was at Pier 66, or the reverse, or the fuel barge's base.
 */
import { normName } from './normalize.js'
import { antShipName, groupAntOperations } from './ecologyAnt.js'
import { namesAgree, readBunkerSnapshot, computeBunkerReport } from './bunkerMatch.js'
import { BAKE_VERSION as CALL_BAKE, AIS_BOX } from './terminalCalls.js'
import { BUNKER_BAKE_VERSION } from './bunkerEvents.js'
import { ANT_PLACES } from './data/antPlaces.js'
import { ANT_DOCKS } from './data/antDocks.js'
import { DOCK_BAKE_VERSION } from './dockCalls.js'
import { SCRUBBER_SOURCES } from './scrubberFilter.js'
import { findTugCall } from './bargeTugs.js'
import { BARGE_TUGS, BARGE_TUGS_VERSION } from './data/bargeTugs.js'
import { packOps } from './oilTransfersPack.js'

// ot2 (2026-11-07): rule 4b (dock calls), military seen when found, rule 7 (scrubber ships).
// ot3 (2026-11-08): rule 9 (the other Seattle cruise pier); notified names shortened as ships broadcast them (antShipName).
// ot4 (2026-11-10): anchorage results from the bunkering report's bm2 (lightering matched on the non-barge side).
export const OT_VERSION = 'ot4'
/** Seattle's two cruise terminals (rule 9). */
export const SEATTLE_CRUISE_TERMINALS = ['wa-pos-t91-smith-cove', 'wa-pos-pier66-bell-street']
export const OT_RULE = Object.freeze({ tolH: 6, autoKm: 0.3 })
const DOCK_OF = new Map(ANT_DOCKS.map((d) => [d.ecology, d.key]))
const PAIR_OF = new Map(BARGE_TUGS.map((p) => [p.barge, p]))
const scrubberFields = (o, seen, scr) => {
  if (o.group !== 'ships') return { scrubberVessel: null, scrubberSrc: null }
  const x = scrubberOf(scr.byName.get(normName(antShipName(o.ship))) || [], scr.fitted, seen?.mmsi || null)
  return { scrubberVessel: x?.vesselId || null, scrubberSrc: x?.src || null }
}

// ── Pure ─────────────────────────────────────────────────────────────────────

const up = (s) => String(s || '').toUpperCase()
const NON_VESSEL = /^(FACILITY|MOBILE)$/
const BARGE = /BARGE/
const SMALL = /^(FISHING VESSEL|WORK BOAT|UN-REGULATED VESSEL|RECREATIONAL VESSEL)$/
const MILITARY = /^MILITARY/

/** A notice party's kind from Ecology's own type name. Pure. */
export function partyKind(type) {
  const t = up(type).trim()
  if (!t || /^Z- UNKNOWN$|^VESSEL$/.test(t)) return 'unknown'
  if (NON_VESSEL.test(t)) return 'facility'
  if (BARGE.test(t)) return 'barge'
  if (SMALL.test(t)) return 'small'
  if (MILITARY.test(t)) return 'military'
  return 'ship'
}

/**
 * The operation's ship (rule 2) and group. Pure. → { ship, shipType, role, group } where group is 'ships' (the main counts),
 * 'small' (small craft), or 'noAis' (facility / barge / unknown only: nothing that broadcasts AIS is named).
 */
export function pickShip(op) {
  const parties = [
    { role: 'receiver', name: op.receiver, type: op.receiverType, kind: partyKind(op.receiverType) },
    { role: 'deliverer', name: op.deliverers[0], type: op.delivererType, kind: partyKind(op.delivererType) },
  ]
  for (const k of ['ship', 'military']) {
    const p = parties.find((x) => x.kind === k && x.name)
    if (p) return { ship: p.name, shipType: p.type, role: p.role, group: 'ships', military: k === 'military' }
  }
  const s = parties.find((x) => x.kind === 'small' && x.name)
  if (s) return { ship: s.name, shipType: s.type, role: s.role, group: 'small', military: false }
  const v = parties.find((x) => x.kind === 'barge' && x.name) || parties.find((x) => x.kind === 'unknown' && x.name)
  return { ship: v?.name || null, shipType: v?.type || null, role: v?.role || null, group: 'noAis', military: false }
}

export const isAnchorage = (location) => /^Anchor - /i.test(String(location || ''))
export const inAisBox = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && lat >= AIS_BOX.s && lat <= AIS_BOX.n && lon >= AIS_BOX.w && lon <= AIS_BOX.e

export { productGroup } from './oilTransfersPack.js'

const km = (a, b) => {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

/**
 * Each notified dock location → the EarthAtlas terminals whose berth calls show a ship at that dock (pure). The hand-checked
 * table (lib/ships/data/antPlaces.js) decides where it lists the location: a list of terminal ids, [] (a dock EarthAtlas does
 * not track) or "gap" (tracked nearby, but its berth points miss the ships using this dock). Else the nearest terminal with a
 * berth within autoKm of the notices' mean position, else none.
 * locs: [{ location, lat, lon }]; berths: [{ terminalKey, lat, lon }]. → Map location → { terminals: [key], gap, from }
 */
export function placeTerminals(locs, berths, table = {}, rule = OT_RULE) {
  const out = new Map()
  for (const l of locs) {
    const t = table[l.location]
    if (t === 'gap') { out.set(l.location, { terminals: [], gap: true, from: 'table' }); continue }
    if (Array.isArray(t)) { out.set(l.location, { terminals: t, gap: false, from: 'table' }); continue }
    let best = null
    for (const b of berths) { const d = km(l, b); if (d <= rule.autoKm && (!best || d < best.d)) best = { d, key: b.terminalKey } }
    out.set(l.location, { terminals: best ? [best.key] : [], gap: false, from: best ? 'auto' : 'none' })
  }
  return out
}

const ms = (t) => new Date(t).getTime()

/**
 * Dock check (pure): the first AIS call at one of the place's terminals, by the same ship, overlapping the widened window.
 * calls: [{ terminalKey, mmsi, aisName, t0, t1 }] (sorted by t0); mmsis: Set of the ship's EarthAtlas MMSIs.
 */
export function findCall(op, terminals, calls, mmsis, rule = OT_RULE) {
  const w0 = ms(op.startAt) - rule.tolH * 3600e3, w1 = ms(op.startAt) + ((op.durationH || 0) + rule.tolH) * 3600e3
  const keys = new Set(terminals)
  let best = null
  for (const c of calls) {
    if (!keys.has(c.terminalKey) || ms(c.t1) < w0 || ms(c.t0) > w1) continue
    if (!(mmsis.has(c.mmsi) || namesAgree(op.ship, c.aisName))) continue
    const d = Math.abs(ms(c.t0) - ms(op.startAt))
    if (!best || d < best.d) best = { d, c }
  }
  return best?.c || null
}

/** A notified ship's MMSIs from mmsisForNames, under both of its names. Pure. */
export const shipMmsis = (mm, name) => new Set([...(mm.get(normName(antShipName(name))) || []), ...(mm.get(normName(name)) || [])])

// ── Read ─────────────────────────────────────────────────────────────────────

const iso = (d) => (d instanceof Date ? d.toISOString() : String(d))
const monthsBetween = (a, b) => { const out = []; for (let d = new Date(`${a}-01T00:00:00Z`); d <= new Date(`${b}-01T00:00:00Z`); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d.toISOString().slice(0, 7)); return out }
const pacMonth = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 7)

/** Every ANT row starting in [fromIso, toIso), typed as groupAntOperations wants (with record ids). */
async function readAntRows(q, S, { fromIso, toIso }) {
  const rows = await q(
    `SELECT ant_id, company, start_local, start_at, duration_h, deliverer, receiver, location, lat, lon, city, region, product, gallons, transfer_type,
            is_preboomed, rate_gt500, contact_name, contact_phone, deliverer_type, receiver_type, source_record_id
       FROM ${S}.ecology_ant_rows WHERE start_at >= $1 AND start_at < $2 ORDER BY start_at, ant_id, row_no`, [fromIso, toIso])
  return rows.map((r) => ({ antId: r.ant_id, company: r.company, startLocal: r.start_local, startAt: iso(new Date(r.start_at).toISOString()),
    durationH: r.duration_h, deliverer: r.deliverer, receiver: r.receiver, location: r.location, lat: r.lat, lon: r.lon, city: r.city, region: r.region,
    product: r.product, gallons: r.gallons, transferType: r.transfer_type, isPreboomed: r.is_preboomed, rateGt500: r.rate_gt500,
    contactName: r.contact_name, contactPhone: r.contact_phone, delivererType: r.deliverer_type, receiverType: r.receiver_type, remarks: null,
    recordId: Number(r.source_record_id) }))
}

/** Notified names → the MMSIs of the EarthAtlas ships carrying that name, as notified or as broadcast (antShipName).
 * Map normName → Set(mmsi); read with shipMmsis. */
async function mmsisForNames(q, S, names) {
  const norms = [...new Set(names.flatMap((n) => [normName(antShipName(n)), normName(n)]).filter(Boolean))]
  if (!norms.length) return new Map()
  const rows = await q(
    `SELECT n.value_norm AS name, m.value_norm AS mmsi FROM ${S}.vessel_assertions n
       JOIN ${S}.vessel_assertions m ON m.vessel_id = n.vessel_id AND m.attribute = 'mmsi'
      WHERE n.attribute = 'name' AND n.value_norm = ANY($1)`, [norms])
  const out = new Map()
  for (const r of rows) if (r.mmsi) (out.get(r.name) || out.set(r.name, new Set()).get(r.name)).add(String(r.mmsi))
  return out
}

/**
 * Rule 7 (pure): the scrubber-fitted EarthAtlas ship behind an operation, or null. cands: [{ vesselId, mmsis: Set }] carrying the
 * notified name; fitted: Map vesselId → 'gisis' | 'mep' | 'both'; seenMmsi: the MMSI AIS saw (or null).
 */
export function scrubberOf(cands, fitted, seenMmsi = null) {
  const pool = seenMmsi ? cands.filter((c) => c.mmsis.has(String(seenMmsi))) : cands
  const ids = [...new Set((pool.length ? pool : seenMmsi ? [] : cands).map((c) => c.vesselId))]
  if (!ids.length || !ids.every((id) => fitted.has(id))) return null
  const srcs = new Set(ids.map((id) => fitted.get(id)))
  return { vesselId: ids.length === 1 ? ids[0] : null, src: srcs.size === 1 ? [...srcs][0] : 'both' }
}

/** Notified names → [{ vesselId, mmsis }] per normalized name, and the scrubber-fitted ones among them. */
async function scrubberCandidates(q, S, names) {
  const norms = [...new Set(names.map((n) => normName(antShipName(n))).filter(Boolean))]
  if (!norms.length) return { byName: new Map(), fitted: new Map() }
  const rows = await q(
    `SELECT n.value_norm AS name, n.vessel_id::text AS v, array_remove(array_agg(DISTINCT m.value_norm), NULL) AS mmsis
       FROM ${S}.vessel_assertions n LEFT JOIN ${S}.vessel_assertions m ON m.vessel_id = n.vessel_id AND m.attribute = 'mmsi'
      WHERE n.attribute = 'name' AND n.value_norm = ANY($1) GROUP BY 1, 2`, [norms])
  const byName = new Map()
  for (const r of rows) (byName.get(r.name) || byName.set(r.name, []).get(r.name)).push({ vesselId: r.v, mmsis: new Set((r.mmsis || []).map(String)) })
  const ids = [...new Set(rows.map((r) => r.v))]
  const sc = ids.length ? await q(
    `SELECT DISTINCT va.vessel_id::text AS v, va.source_id FROM ${S}.vessel_assertions va
       JOIN ${S}.entity_links l ON l.source_entity_id = va.source_entity_id AND l.status = 'accepted'
      WHERE va.attribute = 'scrubber' AND va.vessel_id = ANY($1::uuid[]) AND (va.source_id = $2 OR va.source_id = ANY($3))`,
    [ids, SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep]) : []
  const fitted = new Map()
  for (const r of sc) { const k = r.source_id === SCRUBBER_SOURCES.gisis ? 'gisis' : 'mep'; const was = fitted.get(r.v); fitted.set(r.v, was && was !== k ? 'both' : k) }
  return { byName, fitted }
}

/**
 * The whole computation (every covered month). Serializable; stored by buildOilTransferSnapshot, read by readOilTransfers.
 * → { available, months (AIS-checked), antMonths, rule, release, callRecordId, bunkerRecordId, terminals: { key: name }, ops: [...] }
 */
export async function computeOilTransfers(q, S) {
  const [calls0] = await q(`SELECT months, bake_record_id FROM ${S}.terminal_call_bakes WHERE bake_version = $1`, [CALL_BAKE]).catch(() => [])
  const [bunk0] = await q(`SELECT months FROM ${S}.bunker_event_bakes WHERE bake_version = $1`, [BUNKER_BAKE_VERSION]).catch(() => [])
  const [span] = await q(`SELECT min(start_local) AS a, max(start_local) AS b, max(release_id) AS release FROM ${S}.ecology_ant_rows`).catch(() => [])
  if (!calls0 || !span?.a) return { available: false }
  const antMonths = monthsBetween(span.a.slice(0, 7), span.b.slice(0, 7))
  const bunkMonths = new Set(bunk0?.months || [])
  const months = [...calls0.months].sort().filter((m) => antMonths.includes(m) && bunkMonths.has(m))
  if (!months.length) return { available: false }
  // Pacific months: read a day either side, then keep operations whose Pacific start month is covered.
  const fromIso = new Date(ms(`${months[0]}-01T00:00:00Z`) - 24 * 3600e3).toISOString()
  const toIso = new Date(Date.UTC(+months.at(-1).slice(0, 4), +months.at(-1).slice(5, 7), 1) + 24 * 3600e3).toISOString()
  const ops = groupAntOperations(await readAntRows(q, S, { fromIso, toIso }), { keyOf: (n) => pickShip(n).ship ?? `${n.receiver}|${n.deliverers.join(',')}` }).filter((o) => months.includes(pacMonth(o.startAt)))

  // Places: each dock location's mean notified position → terminals (placeTerminals).
  const cen = new Map()
  for (const o of ops) if (!isAnchorage(o.location) && inAisBox(o.lat, o.lon)) {
    const x = cen.get(o.location) || { location: o.location, lat: 0, lon: 0, n: 0 }
    x.lat += o.lat; x.lon += o.lon; x.n++; cen.set(o.location, x)
  }
  const locs = [...cen.values()].map((x) => ({ location: x.location, lat: x.lat / x.n, lon: x.lon / x.n }))
  const berths = (await q(`SELECT t.key AS terminal_key, t.name, b.lat, b.lon FROM ${S}.terminal_berths b JOIN ${S}.terminals t ON t.id = b.terminal_id
                            WHERE b.lat IS NOT NULL AND t.country = 'US'`)).map((r) => ({ terminalKey: r.terminal_key, name: r.name, lat: Number(r.lat), lon: Number(r.lon) }))
  const terminalNames = Object.fromEntries(berths.map((b) => [b.terminalKey, b.name]))
  const places = placeTerminals(locs, berths, ANT_PLACES)

  // Classify every operation.
  for (const o of ops) {
    Object.assign(o, pickShip(o))
    o.setting = isAnchorage(o.location) ? 'anchorage' : 'dock'
    o.covered = inAisBox(o.lat, o.lon)
    const pl = o.setting === 'dock' ? places.get(o.location) : null
    o.terminals = pl?.terminals || []
    o.placeGap = !!pl?.gap
    o.dock = o.setting === 'dock' && !o.terminals.length ? DOCK_OF.get(o.location) || null : null
  }

  // Anchorages: the bunkering report's result for the same notices.
  const bunker = (await readBunkerSnapshot(q, S)) || await computeBunkerReport(q, S)
  const bunkerByAnt = new Map()
  for (const m of bunker?.matched || []) for (const a of m.op.antIds) bunkerByAnt.set(a, { status: 'seen', f: m.fueling, delayH: m.delayH })
  for (const op of bunker?.notSeen || []) for (const a of op.antIds) bunkerByAnt.set(a, { status: 'notSeen' })

  // Docks: AIS calls at the matched terminals in the covered months.
  const dockOps = ops.filter((o) => o.setting === 'dock' && o.covered && o.group === 'ships' && (o.terminals.length || o.dock))
  const keys = [...new Set([...dockOps.flatMap((o) => o.terminals), ...SEATTLE_CRUISE_TERMINALS])]
  const callRows = keys.length ? await q(
    `SELECT terminal_key, mmsi, ais_name, t0, t1 FROM ${S}.terminal_calls WHERE bake_version = $1 AND terminal_key = ANY($2) AND t0 < $4 AND t1 >= $3 ORDER BY t0`,
    [CALL_BAKE, keys, new Date(ms(fromIso) - 2 * 24 * 3600e3).toISOString(), toIso]) : []
  const calls = callRows.map((r) => ({ terminalKey: r.terminal_key, mmsi: String(r.mmsi), aisName: r.ais_name, t0: iso(new Date(r.t0).toISOString()), t1: iso(new Date(r.t1).toISOString()) }))
  const byTerminal = new Map()
  for (const c of calls) (byTerminal.get(c.terminalKey) || byTerminal.set(c.terminalKey, []).get(c.terminalKey)).push(c)
  const mm = await mmsisForNames(q, S, dockOps.map((o) => o.ship))

  // Rule 4b: dock calls at the untracked docks, in the dock bake's months.
  const [dock0] = await q(`SELECT months, bake_record_id FROM ${S}.dock_call_bakes WHERE bake_version = $1`, [DOCK_BAKE_VERSION]).catch((e) => { if (e?.code === '42P01') return []; throw e })
  const dockMonths = new Set(dock0?.months || [])
  const dockKeys = [...new Set(dockOps.filter((o) => o.dock).map((o) => o.dock))]
  const dockRows = dock0 && dockKeys.length ? await q(
    `SELECT dock_key, mmsi, ais_name, t0, t1 FROM ${S}.dock_calls WHERE bake_version = $1 AND dock_key = ANY($2) AND t0 < $4 AND t1 >= $3 ORDER BY t0`,
    [DOCK_BAKE_VERSION, dockKeys, new Date(ms(fromIso) - 2 * 24 * 3600e3).toISOString(), toIso]) : []
  const byDock = new Map()
  for (const r of dockRows) {
    const c = { terminalKey: r.dock_key, mmsi: String(r.mmsi), aisName: r.ais_name, t0: new Date(r.t0).toISOString(), t1: new Date(r.t1).toISOString() }
    ;(byDock.get(c.terminalKey) || byDock.set(c.terminalKey, []).get(c.terminalKey)).push(c)
  }
  const dockEdge = (o) => { const ys = [...dockMonths].sort(); if (!ys.length) return true
    const a = Date.UTC(+ys[0].slice(0, 4), +ys[0].slice(5, 7) - 1, 1), z = Date.UTC(+ys.at(-1).slice(0, 4), +ys.at(-1).slice(5, 7), 1)
    return ms(o.startAt) - OT_RULE.tolH * 3600e3 < a || ms(o.startAt) + ((o.durationH || 0) + OT_RULE.tolH) * 3600e3 > z }

  // The months of AIS read (UTC): a notified window running past either end can't be called "not seen".
  const aisStart = Date.UTC(+calls0.months.slice().sort()[0].slice(0, 4), +calls0.months.slice().sort()[0].slice(5, 7) - 1, 1)
  const aisEnd = Date.UTC(+calls0.months.slice().sort().at(-1).slice(0, 4), +calls0.months.slice().sort().at(-1).slice(5, 7), 1)
  // Rule 8: the paired tugs' calls at the barge transfers' places (terminal and dock calls).
  const bargeOps = ops.filter((o) => o.group === 'noAis' && o.covered && PAIR_OF.has(o.ship) && (o.terminals.length || o.dock))
  const bargeSet = new Set(bargeOps)
  const tugMmsis = [...new Set(bargeOps.map((o) => String(PAIR_OF.get(o.ship).mmsi)))]
  const lo = new Date(ms(fromIso) - 2 * 24 * 3600e3).toISOString()
  const tugCalls = tugMmsis.length ? [
    ...(await q(`SELECT terminal_key AS k, mmsi, ais_name, t0, t1 FROM ${S}.terminal_calls WHERE bake_version = $1 AND mmsi = ANY($2) AND t0 < $4 AND t1 >= $3`,
      [CALL_BAKE, tugMmsis, lo, toIso])),
    ...(dock0 ? await q(`SELECT dock_key AS k, mmsi, ais_name, t0, t1 FROM ${S}.dock_calls WHERE bake_version = $1 AND mmsi = ANY($2) AND t0 < $4 AND t1 >= $3`,
      [DOCK_BAKE_VERSION, tugMmsis, lo, toIso]) : []),
  ].map((r) => ({ terminalKey: r.k, mmsi: String(r.mmsi), aisName: r.ais_name, t0: new Date(r.t0).toISOString(), t1: new Date(r.t1).toISOString() })) : []
  const callMonths = new Set(calls0.months)
  const scr = await scrubberCandidates(q, S, ops.filter((o) => o.group === 'ships').map((o) => o.ship))
  const out = ops.map((o) => {
    let status, reason = null, seen = null
    if (o.group === 'small') { status = 'small' }
    else if (o.group === 'noAis' && bargeSet.has(o) && (o.dock ? dockMonths : callMonths).has(pacMonth(o.startAt))) {
      const pair = PAIR_OF.get(o.ship), places = o.dock ? [o.dock] : o.terminals
      const c = findTugCall(o, places, tugCalls, pair.mmsi, { ...OT_RULE })
      const edge = o.dock ? dockEdge(o) : ms(o.startAt) - OT_RULE.tolH * 3600e3 < aisStart || ms(o.startAt) + ((o.durationH || 0) + OT_RULE.tolH) * 3600e3 > aisEnd
      if (c) { status = 'seen'; seen = { kind: 'tug', terminalKey: c.terminalKey, t0: c.t0, t1: c.t1, mmsi: c.mmsi, aisName: c.aisName,
        delayH: Math.round(((ms(c.t0) - ms(o.startAt)) / 3600e3) * 10) / 10 } }
      else if (edge) { status = 'cantCheck'; reason = 'edge' }
      else if (pair.atb) status = 'notSeen'
      else { status = 'cantCheck'; reason = 'bargeTug' }
    }
    else if (o.group === 'noAis') { status = 'cantCheck'; reason = 'noAis' }
    else if (!o.covered) { status = 'cantCheck'; reason = 'outside' }
    else if (o.setting === 'anchorage' && o.military) { status = 'cantCheck'; reason = 'military' }
    else if (o.setting === 'anchorage') {
      const b = o.antIds.map((a) => bunkerByAnt.get(a)).find(Boolean)
      if (b) { status = b.status; if (b.f) seen = { kind: 'alongside', t0: b.f.t0, t1: b.f.t1, hours: b.f.hours, place: b.f.anchorageName,
        tugs: (b.f.suppliers || []).map((s) => s.name || `MMSI ${s.mmsi}`), delayH: b.delayH } }
      else { status = 'cantCheck'; reason = 'anchorageType' }
    } else if (o.dock && dockMonths.has(pacMonth(o.startAt))) {
      const c = findCall(o, [o.dock], byDock.get(o.dock) || [], shipMmsis(mm, o.ship))
      if (c) { status = 'seen'; seen = { kind: 'dock', terminalKey: c.terminalKey, t0: c.t0, t1: c.t1, mmsi: c.mmsi, aisName: c.aisName,
        delayH: Math.round(((ms(c.t0) - ms(o.startAt)) / 3600e3) * 10) / 10 } }
      else if (o.military) { status = 'cantCheck'; reason = 'military' }
      else if (dockEdge(o)) { status = 'cantCheck'; reason = 'edge' }
      else status = 'notSeen'
    } else if (o.placeGap) { status = 'cantCheck'; reason = o.military ? 'military' : 'berthGap' }
    else if (!o.terminals.length) { status = 'cantCheck'; reason = o.military ? 'military' : 'noTerminal' }
    else {
      const cs = o.terminals.flatMap((k) => byTerminal.get(k) || []).sort((a, z) => a.t0.localeCompare(z.t0))
      const c = findCall(o, o.terminals, cs, shipMmsis(mm, o.ship))
      if (c) { status = 'seen'; seen = { kind: 'call', terminalKey: c.terminalKey, t0: c.t0, t1: c.t1, mmsi: c.mmsi, aisName: c.aisName,
        delayH: Math.round(((ms(c.t0) - ms(o.startAt)) / 3600e3) * 10) / 10 } }
      else if (o.military) { status = 'cantCheck'; reason = 'military' }
      else if (ms(o.startAt) - OT_RULE.tolH * 3600e3 < aisStart || ms(o.startAt) + ((o.durationH || 0) + OT_RULE.tolH) * 3600e3 > aisEnd) { status = 'cantCheck'; reason = 'edge' }
      else status = 'notSeen'
    }
    // Rule 9: not seen at the notified Seattle pier, but at Seattle's other cruise pier.
    if (status === 'notSeen' && o.setting === 'dock' && /^PASSENGER SHIP$/i.test(String(o.shipType || '').trim())
      && /^SEATTLE\b/i.test(String(o.city || o.location || ''))) {
      const other = SEATTLE_CRUISE_TERMINALS.filter((k) => !o.terminals.includes(k))
      const c = findCall(o, other, other.flatMap((k) => byTerminal.get(k) || []), shipMmsis(mm, o.ship))
      if (c) { status = 'seen'; seen = { kind: 'otherPier', terminalKey: c.terminalKey, t0: c.t0, t1: c.t1, mmsi: c.mmsi, aisName: c.aisName,
        delayH: Math.round(((ms(c.t0) - ms(o.startAt)) / 3600e3) * 10) / 10 } }
    }
    return { antIds: o.antIds, recordIds: o.recordIds, startAt: o.startAt, durationH: o.durationH, company: o.company, receiver: o.receiver,
      receiverType: o.receiverType, deliverers: o.deliverers, delivererType: o.delivererType, location: o.location, city: o.city, region: o.region,
      transferTypes: o.transferTypes, products: o.products, gallons: o.gallons, isPreboomed: o.isPreboomed, rateGt500: o.rateGt500,
      contacts: o.contacts, ship: o.ship, shipType: o.shipType, group: o.group, setting: o.setting, terminals: o.dock ? [o.dock] : o.terminals,
      status, reason, seen, ...scrubberFields(o, seen, scr) }
  })
  return { available: true, version: OT_VERSION, months, antMonths, rule: OT_RULE, release: span.release, callRecordId: Number(calls0.bake_record_id),
    bunkerRecordId: bunker?.aisRecordId ?? null, dockRecordId: dock0 ? Number(dock0.bake_record_id) : null, dockMonths: [...dockMonths].sort(),
    terminals: terminalNames, docks: Object.fromEntries(ANT_DOCKS.map((d) => [d.key, d.ecology])),
    bargeTugs: { version: BARGE_TUGS_VERSION, pairs: Object.fromEntries(BARGE_TUGS.map((p) => [p.barge, p])) }, ops: out }
}

// ── Snapshot (migration 042) ─────────────────────────────────────────────────

/** Compute and store (run after an AIS bake, a terminal-call import or an Ecology release). */
export async function buildOilTransferSnapshot(q, S) {
  const r = await computeOilTransfers(q, S)
  if (!r.available) throw new Error('no AIS months or Ecology notices loaded')
  const [row] = await q(`INSERT INTO ${S}.oil_transfer_snapshots (version, ant_release, call_bake_version, rule, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id, built_at`,
    [OT_VERSION, r.release, CALL_BAKE, OT_RULE, packed(r)])
  const n = (s) => r.ops.filter((o) => o.status === s).length
  return { id: Number(row.id), builtAt: row.built_at, ops: r.ops.length, seen: n('seen'), notSeen: n('notSeen'), cantCheck: n('cantCheck'), small: n('small') }
}

/** The report's wire shape: everything but the operations as is, the operations packed (lib/ships/oilTransfersPack.js). */
const packed = (r) => (r.available ? { ...r, ops: undefined, packed: packOps(r.ops) } : r)

let memo = null   // { at, value }: a fresh computation is reused for 10 minutes (before a snapshot exists, or on localhost)
/** The stored snapshot for the current Ecology release and call bake, else a fresh computation (wire shape: ops packed). */
export async function readOilTransfers(q, S) {
  try {
    const [row] = await q(`SELECT payload, built_at FROM ${S}.oil_transfer_snapshots
                            WHERE version = $1 AND call_bake_version = $2 AND ant_release IS NOT DISTINCT FROM (SELECT max(release_id) FROM ${S}.ecology_ant_rows)
                            ORDER BY built_at DESC LIMIT 1`, [OT_VERSION, CALL_BAKE])
    if (row) return { ...row.payload, builtAt: row.built_at }
  } catch (e) { if (e?.code !== '42P01') throw e }
  if (memo && Date.now() - memo.at < 600e3) return memo.value
  const value = packed(await computeOilTransfers(q, S))
  memo = { at: Date.now(), value }
  return value
}
