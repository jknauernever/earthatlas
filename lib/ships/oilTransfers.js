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
 */
import { normName } from './normalize.js'
import { antShipName, groupAntOperations } from './ecologyAnt.js'
import { namesAgree, readBunkerSnapshot, computeBunkerReport } from './bunkerMatch.js'
import { BAKE_VERSION as CALL_BAKE, AIS_BOX } from './terminalCalls.js'
import { BUNKER_BAKE_VERSION } from './bunkerEvents.js'
import { ANT_PLACES } from './data/antPlaces.js'
import { packOps } from './oilTransfersPack.js'

export const OT_VERSION = 'ot1'
export const OT_RULE = Object.freeze({ tolH: 6, autoKm: 0.3 })

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

/** Notified names → the MMSIs of the EarthAtlas ships carrying that name. Map normName(antShipName) → Set(mmsi). */
async function mmsisForNames(q, S, names) {
  const norms = [...new Set(names.map((n) => normName(antShipName(n))).filter(Boolean))]
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
  }

  // Anchorages: the bunkering report's result for the same notices.
  const bunker = (await readBunkerSnapshot(q, S)) || await computeBunkerReport(q, S)
  const bunkerByAnt = new Map()
  for (const m of bunker?.matched || []) for (const a of m.op.antIds) bunkerByAnt.set(a, { status: 'seen', f: m.fueling, delayH: m.delayH })
  for (const op of bunker?.notSeen || []) for (const a of op.antIds) bunkerByAnt.set(a, { status: 'notSeen' })

  // Docks: AIS calls at the matched terminals in the covered months.
  const dockOps = ops.filter((o) => o.setting === 'dock' && o.covered && o.group === 'ships' && !o.military && o.terminals.length)
  const keys = [...new Set(dockOps.flatMap((o) => o.terminals))]
  const callRows = keys.length ? await q(
    `SELECT terminal_key, mmsi, ais_name, t0, t1 FROM ${S}.terminal_calls WHERE bake_version = $1 AND terminal_key = ANY($2) AND t0 < $4 AND t1 >= $3 ORDER BY t0`,
    [CALL_BAKE, keys, new Date(ms(fromIso) - 2 * 24 * 3600e3).toISOString(), toIso]) : []
  const calls = callRows.map((r) => ({ terminalKey: r.terminal_key, mmsi: String(r.mmsi), aisName: r.ais_name, t0: iso(new Date(r.t0).toISOString()), t1: iso(new Date(r.t1).toISOString()) }))
  const byTerminal = new Map()
  for (const c of calls) (byTerminal.get(c.terminalKey) || byTerminal.set(c.terminalKey, []).get(c.terminalKey)).push(c)
  const mm = await mmsisForNames(q, S, dockOps.map((o) => o.ship))

  // The months of AIS read (UTC): a notified window running past either end can't be called "not seen".
  const aisStart = Date.UTC(+calls0.months.slice().sort()[0].slice(0, 4), +calls0.months.slice().sort()[0].slice(5, 7) - 1, 1)
  const aisEnd = Date.UTC(+calls0.months.slice().sort().at(-1).slice(0, 4), +calls0.months.slice().sort().at(-1).slice(5, 7), 1)
  const out = ops.map((o) => {
    let status, reason = null, seen = null
    if (o.group === 'small') { status = 'small' }
    else if (o.group === 'noAis') { status = 'cantCheck'; reason = 'noAis' }
    else if (!o.covered) { status = 'cantCheck'; reason = 'outside' }
    else if (o.military) { status = 'cantCheck'; reason = 'military' }
    else if (o.setting === 'anchorage') {
      const b = o.antIds.map((a) => bunkerByAnt.get(a)).find(Boolean)
      if (b) { status = b.status; if (b.f) seen = { kind: 'alongside', t0: b.f.t0, t1: b.f.t1, hours: b.f.hours, place: b.f.anchorageName,
        tugs: (b.f.suppliers || []).map((s) => s.name || `MMSI ${s.mmsi}`), delayH: b.delayH } }
      else { status = 'cantCheck'; reason = 'anchorageType' }
    } else if (o.placeGap) { status = 'cantCheck'; reason = 'berthGap' }
    else if (!o.terminals.length) { status = 'cantCheck'; reason = 'noTerminal' }
    else {
      const cs = o.terminals.flatMap((k) => byTerminal.get(k) || []).sort((a, z) => a.t0.localeCompare(z.t0))
      const c = findCall(o, o.terminals, cs, mm.get(normName(antShipName(o.ship))) || new Set())
      if (c) { status = 'seen'; seen = { kind: 'call', terminalKey: c.terminalKey, t0: c.t0, t1: c.t1, mmsi: c.mmsi, aisName: c.aisName,
        delayH: Math.round(((ms(c.t0) - ms(o.startAt)) / 3600e3) * 10) / 10 } }
      else if (ms(o.startAt) - OT_RULE.tolH * 3600e3 < aisStart || ms(o.startAt) + ((o.durationH || 0) + OT_RULE.tolH) * 3600e3 > aisEnd) { status = 'cantCheck'; reason = 'edge' }
      else status = 'notSeen'
    }
    return { antIds: o.antIds, recordIds: o.recordIds, startAt: o.startAt, durationH: o.durationH, company: o.company, receiver: o.receiver,
      receiverType: o.receiverType, deliverers: o.deliverers, delivererType: o.delivererType, location: o.location, city: o.city, region: o.region,
      transferTypes: o.transferTypes, products: o.products, gallons: o.gallons, isPreboomed: o.isPreboomed, rateGt500: o.rateGt500,
      contacts: o.contacts, ship: o.ship, shipType: o.shipType, group: o.group, setting: o.setting, terminals: o.terminals,
      status, reason, seen }
  })
  return { available: true, version: OT_VERSION, months, antMonths, rule: OT_RULE, release: span.release, callRecordId: Number(calls0.bake_record_id),
    bunkerRecordId: bunker?.aisRecordId ?? null, terminals: terminalNames, ops: out }
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
