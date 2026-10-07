/**
 * Terminal calls and anchorage stays ESTIMATED from Global Fishing Watch hourly positions (Josh 2026-10-06;
 * docs/SHIPS_ACTIVITY_FUSION.md Part 2, accuracy check docs/SHIPS_ACTIVITY_CHECK_2026-06.md). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        GFW 4Wings hourly presence (CC BY-NC 4.0), fetched by the GFW track bake; positions never go in Postgres
 *   derived         scripts/ships/bake-gfw/activity.py → stops.csv → storeActivityEstimates() → terminal_call_estimates /
 *                   anchorage_stay_estimates (migration 025), evidence class 'inferred', one source record per month
 *   interpretation  read time only (terminal card): which EarthAtlas ship held the MMSI, whether its kind fits each candidate
 *                   terminal, and so whether the stop is credited to one terminal, shared, or not counted. Tugs are never
 *                   counted from these estimates (Josh 2026-10-06: hourly positions can't tell a tug at a berth from one at its
 *                   own base next door; only 10 of 31 terminals came within ±50% of NOAA's tug counts).
 *
 * Kept apart from the NOAA-counted terminal_calls / anchorage_stays: a card shows which months were counted from NOAA AIS and
 * which were estimated from hourly positions, never one number made of both.
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'

export const ACTIVITY_BAKE_VERSION = 'gfw1'
// The rule activity.py applied, as agreed 2026-10-06 (stored on every month's record; the bake sends its own copy).
export const ACTIVITY_RULE = Object.freeze({ match_km: 0.65, neighbour_km: 1.0, stop_cells: 2, min_rows: 2, gap_h: 6, anch_buffer_km: 0, cell_deg: 0.01 })

const COMMON = {
  publisher: 'EarthAtlas, from Global Fishing Watch hourly vessel presence (AIS)',
  homepage_url: 'https://globalfishingwatch.org/our-apis/',
  license: 'CC BY-NC 4.0',
  license_url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  commercial_use: false,
  attribution_url: 'https://globalfishingwatch.org',
}
export const TERMINAL_ESTIMATES_SOURCE = {
  ...COMMON,
  id: 'earthatlas-terminal-calls-gfw',
  name: 'EarthAtlas terminal visits estimated from hourly positions (Global Fishing Watch)',
  attribution_text: 'Powered by Global Fishing Watch; visits estimated by EarthAtlas',
  notes: 'Derived dataset, evidence class inferred. Input: one AIS position per ship per hour on a 0.01° grid (GFW 4Wings presence). '
    + 'A stop = consecutive hourly positions at most two grid cells apart (about one hour at under ~1.2 knots); it counts near a '
    + 'terminal when a position lies within 0.65 km of a berth. Terminals with berths within 1 km of each other cannot be told apart, '
    + 'so a stop keeps all of them as candidates and is credited to one only when the ship\'s kind fits only that one. Tug visits are '
    + 'not counted from these estimates. Checked against NOAA per-minute AIS for June 2026 (Salish Sea): 90% of NOAA\'s cargo-ship and '
    + 'tanker visits found; 90% of credited visits at the same terminal.',
}
export const ANCHORAGE_ESTIMATES_SOURCE = {
  ...COMMON,
  id: 'earthatlas-anchorage-stays-gfw',
  name: 'EarthAtlas anchorage stays estimated from hourly positions (Global Fishing Watch)',
  attribution_text: 'Powered by Global Fishing Watch; stays estimated by EarthAtlas',
  notes: 'Derived dataset, evidence class inferred. Input: one AIS position per ship per hour on a 0.01° grid (GFW 4Wings presence). '
    + 'A stay = consecutive hourly positions at most two grid cells apart whose cell centres lie inside the anchorage polygon, at '
    + 'least two hours, a gap of more than 6 h starting a new stay. Checked against NOAA per-minute AIS for June 2026: 62% of NOAA\'s '
    + 'stays found, 64% of estimated stays confirmed.',
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** Validate and normalise stops.csv rows of one kind (pure). Throws on anything malformed: nothing half-stored. */
export function normalizeStops(kind, rows) {
  return rows.filter((r) => r.kind === kind).map((r, i) => {
    const t0 = Number(r.t0), t1 = Number(r.t1), n = Number(r.rows)
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) throw new Error(`row ${i}: bad t0/t1`)
    if (!r.vid) throw new Error(`row ${i}: no GFW vessel id`)
    const mmsi = /^\d{1,9}$/.test(String(r.mmsi || '')) ? String(r.mmsi) : null
    const base = { mmsi, vid: r.vid, name: r.name || null, gfwType: r.gfw_type || null, t0: new Date(t0 * 1000).toISOString(), t1: new Date(t1 * 1000).toISOString(), n }
    if (kind === 'anchorage') {   // target = "<source_id>|<source_key>" (an anchorage's stable identity)
      const [sid, ...key] = String(r.target).split('|')
      if (!sid || !key.length || !key.join('|')) throw new Error(`row ${i}: anchorage ${r.target}`)
      return { ...base, anchorageSourceId: sid, anchorageSourceKey: key.join('|') }
    }
    const cands = String(r.target).split('+').filter(Boolean)
    if (!cands.length || !r.terminal_nearest) throw new Error(`row ${i}: no terminal`)
    return { ...base, nearest: r.terminal_nearest, candidates: [r.terminal_nearest, ...cands.filter((t) => t !== r.terminal_nearest)], minKm: Number(r.min_km) }
  })
}

/**
 * Store one month of one kind, replacing that (version, kind, month) whole. c = a client inside a transaction (withTx).
 * rows = normalizeStops() output. Returns { recordId, rows }.
 */
export async function storeActivityEstimates(c, S, { kind, month, through = null, rule = ACTIVITY_RULE, inputs = null, rows, version = ACTIVITY_BAKE_VERSION }) {
  if (!['terminal', 'anchorage'].includes(kind)) throw new Error('kind must be terminal or anchorage')
  if (!MONTH.test(month)) throw new Error('month must be YYYY-MM')
  const src = kind === 'terminal' ? TERMINAL_ESTIMATES_SOURCE : ANCHORAGE_ESTIMATES_SOURCE
  await upsertSource(c, S, src)
  if (kind === 'terminal') {
    const known = new Set((await c.query(`SELECT key FROM ${S}.terminals`)).rows.map((r) => r.key))
    const unknown = [...new Set(rows.flatMap((r) => r.candidates).filter((t) => !known.has(t)))]
    if (unknown.length) throw new Error(`terminals not in ${S}.terminals: ${unknown.join(', ')}`)
  } else {
    const keys = [...new Set(rows.map((r) => `${r.anchorageSourceId}|${r.anchorageSourceKey}`))]
    const have = new Set((await c.query(`SELECT source_id || '|' || source_key AS k FROM ${S}.anchorages WHERE status = 'active' AND source_id || '|' || source_key = ANY($1)`, [keys])).rows.map((r) => r.k))
    const missing = keys.filter((k) => !have.has(k))
    if (missing.length) throw new Error(`anchorages not in ${S}.anchorages: ${missing.join(', ')}`)
  }
  const ent = await findOrCreateEntity(c, S, { sourceId: src.id, kind: `${kind}_estimate_month`, anchor: `${version}:${month}` })
  const payload = { method: src.notes, bake_version: version, kind, month, through, rule, inputs, rows: rows.length }
  const rec = await upsertRecord(c, S, { sourceId: src.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: null, runId: null })
  const table = kind === 'terminal' ? 'terminal_call_estimates' : 'anchorage_stay_estimates'
  await c.query(`DELETE FROM ${S}.${table} WHERE bake_version = $1 AND month = $2`, [version, month])
  for (let i = 0; i < rows.length; i += 1000) {
    const b = rows.slice(i, i + 1000)
    const common = [b.map((x) => x.mmsi), b.map((x) => x.vid), b.map((x) => x.name), b.map((x) => x.gfwType), b.map((x) => x.t0), b.map((x) => x.t1), b.map((x) => x.n)]
    if (kind === 'terminal') {
      await c.query(
        `INSERT INTO ${S}.terminal_call_estimates (bake_version, month, mmsi, gfw_vessel_id, gfw_name, gfw_type, t0, t1, n_hours,
                candidates, nearest_terminal, min_km, bake_record_id)
         SELECT $1, $2, x.mmsi, x.vid, x.name, x.gt, x.t0, x.t1, x.n, string_to_array(x.cands, '|'), x.nearest, x.km, $3
           FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[], $10::int[], $11::text[], $12::text[], $13::real[])
                AS x(mmsi, vid, name, gt, t0, t1, n, cands, nearest, km)`,
        [version, month, rec.id, ...common, b.map((x) => x.candidates.join('|')), b.map((x) => x.nearest), b.map((x) => x.minKm)])
    } else {
      await c.query(
        `INSERT INTO ${S}.anchorage_stay_estimates (bake_version, month, mmsi, gfw_vessel_id, gfw_name, gfw_type, t0, t1, n_hours,
                anchorage_source_id, anchorage_source_key, bake_record_id)
         SELECT $1, $2, x.mmsi, x.vid, x.name, x.gt, x.t0, x.t1, x.n, x.asid, x.akey, $3
           FROM unnest($4::text[], $5::text[], $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[], $10::int[], $11::text[], $12::text[])
                AS x(mmsi, vid, name, gt, t0, t1, n, asid, akey)`,
        [version, month, rec.id, ...common, b.map((x) => x.anchorageSourceId), b.map((x) => x.anchorageSourceKey)])
    }
  }
  await c.query(`INSERT INTO ${S}.activity_estimate_bakes (bake_version, kind, month, through, rows, rule, bake_record_id, imported_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, now())
                 ON CONFLICT (bake_version, kind, month) DO UPDATE SET through = EXCLUDED.through, rows = EXCLUDED.rows, rule = EXCLUDED.rule,
                   bake_record_id = EXCLUDED.bake_record_id, imported_at = now()`,
    [version, kind, month, through, rows.length, rule, rec.id])
  return { recordId: Number(rec.id), rows: rows.length }
}

// ── Read helpers ──────────────────────────────────────────────────────────────

/**
 * Sets s.vesselId on each stop: first by GFW's own vessel id (its grouping, as stored by the GFW ship-records import,
 * gfw-4wings-ais), else the ship that held the MMSI at the stop (vessels_for_mmsi_at; several = ambiguous, left unresolved).
 * Returns classifyVessels() for the resolved ships.
 */
async function resolveStops(q, S, stops, deps) {
  const gfwIds = [...new Set(stops.map((s) => s.gfw_vessel_id))]
  const byGfw = new Map((gfwIds.length ? await q(
    `SELECT se.entity_key, min(el.vessel_id::text) AS vessel_id, count(DISTINCT el.vessel_id)::int AS n FROM ${S}.source_entities se
       JOIN ${S}.entity_links el ON el.source_entity_id = se.id AND el.status = 'accepted' AND el.superseded_at IS NULL
      WHERE se.source_id = 'gfw-4wings-ais' AND se.entity_key = ANY($1) GROUP BY 1`, [gfwIds]) : []).filter((r) => r.n === 1).map((r) => [r.entity_key, r.vessel_id]))
  for (const s of stops) if (byGfw.has(s.gfw_vessel_id)) s.vesselId = byGfw.get(s.gfw_vessel_id)
  const withMmsi = stops.filter((s) => s.mmsi && !s.vesselId)
  if (withMmsi.length) {
    const res = await q(`SELECT x.i, array_agg(DISTINCT v.vessel_id) AS ids FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS x(i, mmsi, at)
                           CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
      [withMmsi.map((_, i) => i), withMmsi.map((s) => s.mmsi), withMmsi.map((s) => new Date(s.t0).toISOString())])
    for (const r of res) if (r.ids.length === 1) withMmsi[r.i].vesselId = r.ids[0]
  }
  return deps.classifyVessels(q, S, [...new Set(stops.map((s) => s.vesselId).filter(Boolean))])
}

/** Does the anchorage polygon contain any grid cell centre (multiples of step)? Pure; pip = pointInGeometry(geometry, lat, lon). */
export function containsGridPoint(g, step, pip) {
  for (let i = Math.floor(g.min_lat / step); i <= Math.ceil(g.max_lat / step); i++) {
    for (let j = Math.floor(g.min_lon / step); j <= Math.ceil(g.max_lon / step); j++) {
      if (pip(g.geometry, +(i * step).toFixed(6), +(j * step).toFixed(6))) return true   // pointInGeometry(g, lat, lon)
    }
  }
  return false
}

const dayOf = (t) => new Date(t).toISOString().slice(0, 10)
/** Every UTC day of the given 'YYYY-MM' months, in order. */
export function daysOf(months) {
  const out = []
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number)
    for (let d = 1; d <= new Date(Date.UTC(y, mo, 0)).getUTCDate(); d++) out.push(`${m}-${String(d).padStart(2, '0')}`)
  }
  return out
}

const stated = (e) => e && e.group && e.group !== 'unknown' && !(e.group === 'other' && (!e.class || e.class === 'other_unspecified'))
/** The stop's kind: EarthAtlas's classification of its ship when it states one, else GFW's vessel type. */
function kindOf(s, byVessel, deps) {
  const e = s.vesselId ? byVessel.get(s.vesselId) : null
  if (stated(e)) return e
  const g = deps.fromGfwType(s.gfw_type)
  return { group: g.group, class: g.class ?? (g.group && g.group !== 'unknown' ? `${g.group}_unspecified` : null), label: g.label || null }
}

// ── Read: a terminal card's estimated months ─────────────────────────────────

/**
 * The GFW-estimated visits at one terminal for the picked months NOAA's AIS doesn't cover (all picked months when the terminal is
 * outside NOAA's reach: Josh 2026-10-06, decision 4). Same ship-kind rule as the counted calls (fitRule / shipFit, the ship that held
 * the MMSI at the stop); tugs are never counted from estimates. A stop counts here when this terminal fits the ship: CREDITED when it
 * is the only candidate that fits, SHARED when other candidates fit too (hourly positions can't tell them apart).
 * deps = { fitRule, shipFit, classifyVessels, fromGfwType } (terminalCard.js / taxonomy.js; passed in to keep this module free of a
 * circular import). Returns null when no picked month is estimated.
 */
export async function readTerminalEstimates(q, S, t, win, { covered = [], notCovered = false, deps, version = ACTIVITY_BAKE_VERSION }) {
  const months = notCovered ? win.months : win.months.filter((m) => !covered.includes(m))
  if (!months.length) return null
  const bakes = await q(`SELECT month, through::text AS through, rows, rule, bake_record_id, imported_at FROM ${S}.activity_estimate_bakes
                          WHERE bake_version = $1 AND kind = 'terminal' AND month = ANY($2) ORDER BY month`, [version, months])
  const have = bakes.map((b) => b.month)
  const base = { months, estimatedMonths: have, missing: months.filter((m) => !have.includes(m)), source: TERMINAL_ESTIMATES_SOURCE.id,
    through: bakes.length ? bakes[bakes.length - 1].through : null, rule: bakes[0]?.rule || ACTIVITY_RULE,
    records: bakes.map((b) => ({ month: b.month, recordId: Number(b.bake_record_id) })) }
  // Outside every box the estimates covered (the rule's area_boxes): "not estimated here", never ≈0 (2026-10-07, Texada).
  const boxes = bakes.flatMap((b) => b.rule?.area_boxes || [])
  const inBox = ([w, s, e, n]) => Number(t.lon) >= w && Number(t.lon) <= e && Number(t.lat) >= s && Number(t.lat) <= n
  if (boxes.length && Number.isFinite(Number(t.lat)) && !boxes.some(inBox)) return { ...base, outsideArea: true, estimatedMonths: [], missing: months }
  const stops = have.length ? await q(
    `SELECT id, month, candidates, nearest_terminal, min_km, mmsi, gfw_vessel_id, gfw_name, gfw_type, t0, t1, n_hours, bake_record_id
       FROM ${S}.terminal_call_estimates WHERE bake_version = $1 AND month = ANY($2) AND $3 = ANY(candidates) ORDER BY t0`, [version, have, t.key]) : []
  const byVessel = await resolveStops(q, S, stops, deps)
  const candKeys = [...new Set(stops.flatMap((s) => s.candidates))]
  const terms = new Map((candKeys.length ? await q(`SELECT key, name, kind, detail FROM ${S}.terminals WHERE key = ANY($1)`, [candKeys]) : [])
    .map((r) => [r.key, { name: r.name, rule: deps.fitRule(r.kind, r.detail?.ship_fit) }]))
  const credited = [], shared = []
  let tugs = 0, other = 0
  for (const s of stops) {
    const k = kindOf(s, byVessel, deps)
    if (k.group === 'tug_tow') { tugs++; continue }
    const fitting = s.candidates.filter((c) => terms.has(c) && deps.shipFit(terms.get(c).rule, k) === 'fits')
    if (!fitting.includes(t.key)) { other++; continue }
    const row = { ...s, k, with: fitting.filter((c) => c !== t.key) }
    ;(row.with.length ? shared : credited).push(row)
  }
  const shipKey = (s) => s.vesselId || (s.mmsi ? `mmsi:${s.mmsi}` : `gfw:${s.gfw_vessel_id}`)
  const ships = (rs) => new Set(rs.map(shipKey)).size
  const hours = (rs) => Math.round(rs.reduce((h, s) => h + (new Date(s.t1) - new Date(s.t0)) / 3600e3, 0))
  const sharedWith = [...new Set(shared.flatMap((s) => s.with))].map((key) => ({ key, name: terms.get(key)?.name || key }))
  const list = (rs, isShared) => {
    const m = new Map()
    for (const s of rs) {
      const id = shipKey(s)
      const x = m.get(id) || { key: id, vesselId: s.vesselId || null, name: s.gfw_name, mmsi: s.mmsi, kind: s.k.label || null, shared: isShared, visits: 0, hours: 0, lastAt: null }
      x.visits++; x.hours += (new Date(s.t1) - new Date(s.t0)) / 3600e3
      const t0 = new Date(s.t0).toISOString()
      if (!x.lastAt || t0 > x.lastAt) { x.lastAt = t0; x.name = s.gfw_name || x.name }
      m.set(id, x)
    }
    return [...m.values()].map((x) => ({ ...x, hours: Math.round(x.hours) })).sort((a, b) => b.visits - a.visits)
  }
  return { ...base, visits: credited.length, ships: ships(credited), hours: hours(credited),
    // shipsWithShared: distinct ships in credited + shared (the top of the card's range, Josh 2026-10-07)
    shared: { visits: shared.length, ships: ships(shared), shipsWithShared: ships([...credited, ...shared]), with: sharedWith }, notCounted: { tugs, other },
    perMonth: months.map((m) => ({ month: m, n: have.includes(m) ? credited.filter((s) => s.month === m).length : null, shared: shared.filter((s) => s.month === m).length })),
    // By day when one or two months are picked (Josh 2026-10-07): a stop counts on the day it began; days past the data are null.
    perDay: months.length <= 2 ? daysOf(months).map((d) => {
      const b = bakes.find((x) => x.month === d.slice(0, 7))
      const ok = b && (!b.through || d <= b.through)
      return { day: d, n: ok ? credited.filter((s) => dayOf(s.t0) === d).length : null, shared: ok ? shared.filter((s) => dayOf(s.t0) === d).length : 0 }
    }) : null,
    list: [...list(credited, false), ...list(shared, true)].slice(0, 80) }
}

// ── Read: an anchorage popup's estimated months ──────────────────────────────

/**
 * GFW-estimated stays at one anchorage for the picked months NOAA's AIS doesn't count there (all picked months when the anchorage is
 * outside NOAA's reach). Every kind of ship, split by kind, as the counted stays are. Returns null when no picked month is estimated.
 * deps = { classifyVessels, fromGfwType, labelOf }.
 */
export async function readAnchorageEstimates(q, S, a, win, { covered = [], all = false, deps, top = 5, version = ACTIVITY_BAKE_VERSION }) {
  const months = all ? win.months : win.months.filter((m) => !covered.includes(m))
  if (!months.length) return null
  // An anchorage containing no 0.01° grid centre can't be estimated: hourly positions sit on those centres (31 of 112 in the
  // Salish area are circles about a cell wide). Said so on the card, never shown as zero (2026-10-06).
  const [g] = await q(`SELECT geometry, min_lat, max_lat, min_lon, max_lon FROM ${S}.anchorages WHERE id = $1`, [a.id])
  if (g?.geometry && !containsGridPoint(g, ACTIVITY_RULE.cell_deg || 0.01, deps.pointInGeometry)) return { months, tooSmall: true, estimatedMonths: [], missing: months, records: [] }
  const bakes = await q(`SELECT month, through::text AS through, rule, bake_record_id FROM ${S}.activity_estimate_bakes
                          WHERE bake_version = $1 AND kind = 'anchorage' AND month = ANY($2) ORDER BY month`, [version, months])
  const have = bakes.map((b) => b.month)
  if (!have.length) return { months, estimatedMonths: [], missing: months, records: [] }
  const stops = await q(`SELECT month, mmsi, gfw_vessel_id, gfw_name, gfw_type, t0, t1 FROM ${S}.anchorage_stay_estimates
                          WHERE bake_version = $1 AND month = ANY($2) AND anchorage_source_id = $3 AND anchorage_source_key = $4 ORDER BY t0`,
    [version, have, a.source_id, a.source_key])
  const byVessel = await resolveStops(q, S, stops, deps)
  const hrs = (s) => (new Date(s.t1) - new Date(s.t0)) / 3600e3
  const shipKey = (s) => s.vesselId || (s.mmsi ? `mmsi:${s.mmsi}` : `gfw:${s.gfw_vessel_id}`)
  const kinds = new Map(), ships = new Map()
  for (const s of stops) {
    const k = kindOf(s, byVessel, deps)
    const label = k.group && k.group !== 'unknown' ? (deps.labelOf(k.group) || k.group) : 'Kind not stated'
    const kk = kinds.get(label) || { label, ships: new Set(), stays: 0 }
    kk.stays++; kk.ships.add(shipKey(s)); kinds.set(label, kk)
    const x = ships.get(shipKey(s)) || { vesselId: s.vesselId || null, name: s.gfw_name, mmsi: s.mmsi,
      kind: k.class && !String(k.class).endsWith('_unspecified') ? deps.labelOf(k.class) : (k.group && k.group !== 'unknown' ? deps.labelOf(k.group) : null),
      stays: 0, hours: 0, days: new Set() }
    x.stays++; x.hours += hrs(s)
    for (let d = new Date(s.t0); d < new Date(s.t1); d = new Date(d.getTime() + 864e5)) x.days.add(d.toISOString().slice(0, 10))
    x.days.add(new Date(new Date(s.t1).getTime() - 1).toISOString().slice(0, 10))
    ships.set(shipKey(s), x)
  }
  const dayOK = (d) => { const b = bakes.find((x) => x.month === d.slice(0, 7)); return !!b && (!b.through || d <= b.through) }
  return { months, estimatedMonths: have, missing: months.filter((m) => !have.includes(m)), source: ANCHORAGE_ESTIMATES_SOURCE.id,
    perMonth: months.map((m) => ({ month: m, n: have.includes(m) ? stops.filter((s) => s.month === m).length : null })),
    perDay: months.length <= 2 ? daysOf(months).map((d) => ({ day: d, n: dayOK(d) ? stops.filter((s) => dayOf(s.t0) === d).length : null })) : null,
    through: bakes[bakes.length - 1].through, rule: bakes[0].rule, records: bakes.map((b) => ({ month: b.month, recordId: Number(b.bake_record_id) })),
    stays: stops.length, ships: ships.size, hours: Math.round(stops.reduce((h, s) => h + hrs(s), 0)),
    kinds: [...kinds.values()].map((k) => ({ label: k.label, ships: k.ships.size, stays: k.stays })).sort((a, b) => b.ships - a.ships),
    top: [...ships.values()].map((x) => ({ ...x, days: x.days.size, hours: Math.round(x.hours) })).sort((a, b) => b.days - a.days || b.hours - a.hours).slice(0, top) }
}
