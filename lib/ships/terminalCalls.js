/**
 * Terminal calls counted from EarthAtlas's own AIS positions (Josh 2026-09-28): replaces Global Fishing Watch port visits as
 * what the terminal card counts. GFW logs a visit against a whole port area (e.g. "can-vancouver" = all of Burrard Inlet), so
 * terminal-level counts from it come out near zero; MarineCadastre's ~1-per-minute positions show the ship at the berth.
 * Rules: src/ships/CLAUDE.md.
 *
 *   evidence        MarineCadastre AIS daily points (CC0), cached by scripts/ships/bake-ais/fetch_points.py (salish-v6 box).
 *                   Positions never go in Postgres.
 *   derived         scripts/ships/bake-ais/terminal_calls.py keeps the STOPPED points near a berth (hits);
 *                   scripts/ships/terminal-calls.mjs splits them into calls with splitCalls() below and stores the calls in
 *                   terminal_calls (migration 016), evidence class 'inferred' (an EarthAtlas rule applied to AIS reports).
 *   interpretation  read time only: which EarthAtlas ship held the MMSI at the call (vessels_for_mmsi_at), and whether its
 *                   kind fits the terminal (terminalCard.js shipFit).
 *
 * The rule (CALL_RULE): an AIS position counts at a berth when the ship reports speed over ground < 0.5 kn within the berth's
 * radius (150 m, larger for a long berth whose length an official record states: half the length + 50 m, at most 300 m). When
 * the radii of two terminals' berths overlap, the nearest berth wins and the other terminal is recorded on the call
 * ("also near"), never counted twice. Per terminal and MMSI, positions sorted by time; a gap of more than 6 h starts a new
 * call; a call counts when it lasts at least 15 minutes (first to last stopped position).
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { MC_SOURCE } from './marinecadastre.js'

export const BAKE_VERSION = 'tc1'
export const CALL_RULE = Object.freeze({ sogKn: 0.5, radiusM: 150, maxRadiusM: 300, halfLengthPadM: 50, gapHours: 6, minMinutes: 15 })
export const COVERAGE = Object.freeze({ from: '2025-07', to: '2026-06' }) // months of the salish-v6 points cache (bake-ais)

export const TERMINAL_CALLS_SOURCE = {
  id: 'earthatlas-terminal-calls',
  name: 'EarthAtlas terminal calls (derived from MarineCadastre AIS)',
  publisher: 'EarthAtlas, from NOAA Office for Coastal Management / BOEM MarineCadastre AIS (U.S. Coast Guard receivers)',
  homepage_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  license: 'CC0 1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_use: true,
  attribution_text: 'MarineCadastre AIS (NOAA / BOEM / USCG), calls derived by EarthAtlas',
  attribution_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  notes: 'Derived dataset, evidence class inferred: an EarthAtlas rule applied to AIS self-reported positions. A call = the ship '
    + 'reports speed over ground < 0.5 kn within 150 m of a terminal berth (half the berth length + 50 m, max 300 m, when an '
    + 'official record states the length); nearest berth wins where terminals overlap; a gap of > 6 h starts a new call; calls '
    + 'shorter than 15 min are dropped. Input: MarineCadastre daily points (CC0 1.0), US terrestrial receivers only, box '
    + 'W -126.2 S 47 E -122.05 N 49.6; terminals outside the box are not covered. Names, IMO, type and length on a call are as '
    + 'the ship broadcast them (AIS reported), never a registry fact.',
}

// ── Berth radius (pure) ──────────────────────────────────────────────────────

/**
 * The longest berth length an official berth description states, in metres, or null. Reads "length 350 m", "91.4 m long",
 * "305 m between extreme mooring dolphins", "216 m between mooring buoys", "243 m apart", "extends 400 m from shore".
 * Depths, drafts, widths and vessel sizes ("vessels up to 250 m in length") are ignored.
 */
export function berthLengthM(desc) {
  if (!desc) return null
  const s = String(desc)
  const out = []
  const re = /(\d+(?:\.\d+)?)\s*m\b/g
  let m
  while ((m = re.exec(s))) {
    const before = s.slice(Math.max(0, m.index - 12), m.index).toLowerCase()
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 30).toLowerCase()
    if (/depth|draft|width|up to\s*$/.test(before) || /^\s*in length/.test(after)) continue
    if (/length[:\s]*$/.test(before) || /^\s*(long|length|between|apart|from shore)/.test(after) || /extends\s*$/.test(before)) out.push(Number(m[1]))
  }
  return out.length ? Math.max(...out) : null
}

/**
 * A berth's length from its official record, metres, or null: the BC Ports and Terminals berth description (berthLengthM), or
 * USACE Navigation Facilities BERTHING_LARGEST (feet: the longest berthing space). Returns { m, from } | null.
 */
export function berthLength({ desc = null, usaceBerthingLargestFt = null } = {}) {
  const ft = Number(usaceBerthingLargestFt)
  if (Number.isFinite(ft) && ft > 0) return { m: Math.round(ft * 0.3048), from: 'USACE BERTHING_LARGEST (ft)' }
  const m = berthLengthM(desc)
  return m ? { m, from: 'BC Ports and Terminals berth description' } : null
}

/** Radius (m) within which a stopped ship counts at a berth of this length (null = not stated) (pure). */
export function berthRadiusM(lengthM, rule = CALL_RULE) {
  if (!lengthM) return rule.radiusM
  return Math.round(Math.min(rule.maxRadiusM, Math.max(rule.radiusM, lengthM / 2 + rule.halfLengthPadM)))
}

/** Is a point inside the points cache's box? (salish-v6, scripts/ships/bake-ais/region.py) */
export const AIS_BOX = Object.freeze({ w: -126.2, s: 47.0, e: -122.05, n: 49.6 })
export const inAisBox = (lat, lon, box = AIS_BOX) => lat >= box.s && lat <= box.n && lon >= box.w && lon <= box.e

/** Great-circle distance in metres (same formula and radius as terminal_calls.py). */
export function metres(lat1, lon1, lat2, lon2) {
  const r = (d) => (d * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a))
}

/**
 * The bake's point rule in JS (terminal_calls.py does the same in DuckDB SQL over whole day files): MarineCadastre rows →
 * hits { terminal, mmsi, p: { t, m, berth, also, name, imo, type, length } }. Keeps rows with sog < sogKn within a berth's
 * radius; the nearest berth wins (ties: terminal key, then berth key); other terminals within their radius go in `also`;
 * one hit per MMSI and timestamp (MarineCadastre repeats some rows exactly). base_date_time is UTC (MarineCadastre).
 */
export function stoppedHits(rows, berths, rule = CALL_RULE) {
  const out = [], seen = new Set()
  for (const r of rows) {
    if (!(r.sog < rule.sogKn) || r.mmsi == null || !r.base_date_time) continue
    const t = Date.parse(`${String(r.base_date_time).replace(' ', 'T')}Z`)
    const k = `${r.mmsi}|${t}`
    if (seen.has(k)) continue
    const near = berths.map((b) => ({ b, m: metres(r.latitude, r.longitude, b.lat, b.lon) })).filter((x) => x.m <= x.b.radius_m)
      .sort((x, y) => x.m - y.m || x.b.terminal.localeCompare(y.b.terminal) || x.b.berth.localeCompare(y.b.berth))
    if (!near.length) continue
    seen.add(k)
    const win = near[0]
    const also = [...new Set(near.map((x) => x.b.terminal).filter((x) => x !== win.b.terminal))].sort()
    out.push({ terminal: win.b.terminal, mmsi: String(r.mmsi), p: { t, m: Math.round(win.m * 10) / 10, berth: win.b.berth, also: also.length ? also : null,
      name: r.vessel_name ?? null, imo: r.imo ?? null, type: r.vessel_type ?? null, length: r.length ?? null } })
  }
  return out
}

// ── Splitting stopped positions into calls (pure) ────────────────────────────

/**
 * points: one terminal + one MMSI, each { t (ms since epoch, UTC), m (metres to its berth), berth, also: [terminal keys] | null,
 * name, imo, type, length } — any order. Returns the calls, oldest first:
 * { t0, t1, n, minM, berth (the berth of the closest point), also (sorted union), ambiguousPoints, name, imo, type, length }
 * where the static fields are the value the ship broadcast most often during the call (ties: the latest), nulls ignored.
 * A gap of MORE than gapHours starts a new call; a call is kept when t1 - t0 >= minMinutes.
 */
export function splitCalls(points, rule = CALL_RULE) {
  const ps = [...points].sort((a, b) => a.t - b.t)
  const gap = rule.gapHours * 3600e3, min = rule.minMinutes * 60e3
  const calls = []
  let cur = null
  for (const p of ps) {
    if (!cur || p.t - cur.t1 > gap) { if (cur) calls.push(cur); cur = startCall(p) } else addPoint(cur, p)
  }
  if (cur) calls.push(cur)
  return calls.filter((c) => c.t1 - c.t0 >= min).map(finishCall)
}
function startCall(p) {
  const c = { t0: p.t, t1: p.t, n: 0, minM: Infinity, berth: null, also: new Set(), ambiguousPoints: 0, votes: { name: new Map(), imo: new Map(), type: new Map(), length: new Map() } }
  addPoint(c, p)
  return c
}
function addPoint(c, p) {
  c.t1 = Math.max(c.t1, p.t); c.n++
  if (p.m < c.minM) { c.minM = p.m; c.berth = p.berth }
  if (p.also && p.also.length) { c.ambiguousPoints++; for (const a of p.also) c.also.add(a) }
  for (const k of ['name', 'imo', 'type', 'length']) {
    const v = p[k]
    if (v == null || v === '') continue
    const e = c.votes[k].get(v) || { n: 0, t: 0 }
    e.n++; e.t = Math.max(e.t, p.t)
    c.votes[k].set(v, e)
  }
}
function finishCall(c) {
  const top = (m) => { let best = null; for (const [v, e] of m) if (!best || e.n > best.e.n || (e.n === best.e.n && e.t > best.e.t)) best = { v, e }; return best ? best.v : null }
  return { t0: c.t0, t1: c.t1, n: c.n, minM: Math.round(c.minM * 10) / 10, berth: c.berth, also: [...c.also].sort(), ambiguousPoints: c.ambiguousPoints,
    name: top(c.votes.name), imo: top(c.votes.imo), type: top(c.votes.type), length: top(c.votes.length) }
}

/**
 * Streaming form for the bake: feed hits sorted by (terminal, mmsi, t); emit(call) gets every kept call with terminal + mmsi.
 * Holds one (terminal, mmsi) group in memory at a time.
 */
export function callSplitter(emit, rule = CALL_RULE) {
  let key = null, group = []
  const flush = () => {
    if (!group.length) return
    const [terminal, mmsi] = key.split('|')
    for (const c of splitCalls(group, rule)) emit({ terminal, mmsi, ...c })
    group = []
  }
  return {
    push(terminal, mmsi, p) {
      const k = `${terminal}|${mmsi}`
      if (k !== key) { flush(); key = k }
      group.push(p)
    },
    end: flush,
  }
}

// ── Months (pure) ────────────────────────────────────────────────────────────

/** Which picked months the AIS bake covers: { covered: [...], missing: [...] } (coverage months from the stored bake). */
export function coveredMonths(months, bakeMonths) {
  const have = new Set(bakeMonths || [])
  return { covered: months.filter((m) => have.has(m)), missing: months.filter((m) => !have.has(m)) }
}

// ── Storage (dev DB via scripts/ships/terminal-calls.mjs; tests in a throwaway schema) ──────────────────────────────────

/**
 * Store one bake: the bake record (source_records, source 'earthatlas-terminal-calls': rule, berths + radii, days, terminals
 * not covered), its calls (terminal_calls, replacing this bake version's earlier rows) and the coverage row
 * (terminal_call_bakes). One transaction; c = a client inside withTx. calls: callSplitter output ({ terminal, mmsi, ...call }).
 * bake: { rule, input, days, months: [{ month, complete }], notCovered: [keys], berths: [{ terminal, berth, radius_m, ... }] }.
 * Returns { recordId, recordCreated, calls }.
 */
export async function storeTerminalCalls(c, S, { calls, bake, runId = null, version = BAKE_VERSION }) {
  await upsertSource(c, S, MC_SOURCE)
  await upsertSource(c, S, TERMINAL_CALLS_SOURCE)
  const terms = new Map((await c.query(`SELECT key, id FROM ${S}.terminals`)).rows.map((r) => [r.key, r.id]))
  const radius = new Map((bake.berths || []).map((b) => [b.berth, b.radius_m]))
  const unknown = [...new Set(calls.filter((x) => !terms.has(x.terminal)).map((x) => x.terminal))]
  if (unknown.length) throw new Error(`calls for terminals not in ${S}.terminals: ${unknown.join(', ')}`)
  const ent = await findOrCreateEntity(c, S, { sourceId: TERMINAL_CALLS_SOURCE.id, kind: 'terminal_call_bake', anchor: version })
  const payload = { method: TERMINAL_CALLS_SOURCE.notes, bake_version: version, ...bake, calls: calls.length }
  const rec = await upsertRecord(c, S, { sourceId: TERMINAL_CALLS_SOURCE.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: null, runId })
  // Derived rows of this version only (the evidence is the AIS cache): a re-import of the same version replaces them.
  await c.query(`DELETE FROM ${S}.terminal_calls WHERE bake_version = $1`, [version])
  for (let i = 0; i < calls.length; i += 1000) {
    const b = calls.slice(i, i + 1000)
    await c.query(
      `INSERT INTO ${S}.terminal_calls (bake_version, terminal_id, terminal_key, berth_key, mmsi, t0, t1, n_points, min_m, radius_m,
              also_near, ambiguous_points, ais_name, ais_imo, ais_vessel_type, ais_length, bake_record_id)
       SELECT $1, x.tid, x.tkey, x.berth, x.mmsi, x.t0, x.t1, x.n, x.minm, x.radius, string_to_array(nullif(x.also, ''), '|'), x.amb,
              x.name, x.imo, x.vtype, x.len, $2
         FROM unnest($3::bigint[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::timestamptz[], $9::int[], $10::real[], $11::int[],
                     $12::text[], $13::int[], $14::text[], $15::text[], $16::int[], $17::real[])
              AS x(tid, tkey, berth, mmsi, t0, t1, n, minm, radius, also, amb, name, imo, vtype, len)`,
      [version, rec.id, b.map((x) => terms.get(x.terminal)), b.map((x) => x.terminal), b.map((x) => x.berth), b.map((x) => String(x.mmsi)),
        b.map((x) => new Date(x.t0).toISOString()), b.map((x) => new Date(x.t1).toISOString()), b.map((x) => x.n), b.map((x) => x.minM),
        b.map((x) => radius.get(x.berth) ?? null), b.map((x) => (x.also || []).join('|')), b.map((x) => x.ambiguousPoints || 0), b.map((x) => x.name ?? null),
        b.map((x) => (x.imo == null ? null : String(x.imo))), b.map((x) => (x.type == null ? null : Number(x.type))), b.map((x) => x.length ?? null)])
  }
  await c.query(`INSERT INTO ${S}.terminal_call_bakes (bake_version, source_id, bake_record_id, months, not_covered, rule, imported_at)
                 VALUES ($1, $2, $3, $4, $5, $6, now())
                 ON CONFLICT (bake_version) DO UPDATE SET bake_record_id = EXCLUDED.bake_record_id, months = EXCLUDED.months,
                   not_covered = EXCLUDED.not_covered, rule = EXCLUDED.rule, imported_at = now()`,
    [version, TERMINAL_CALLS_SOURCE.id, rec.id, (bake.months || []).filter((m) => m.complete).map((m) => m.month), bake.notCovered || [], bake.rule || CALL_RULE])
  return { recordId: rec.id, recordCreated: rec.created, calls: calls.length }
}
