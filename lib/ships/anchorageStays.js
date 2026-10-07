/**
 * Anchorage stays counted from EarthAtlas's own AIS positions (Josh 2026-09-30): who anchors in each official / listed
 * anchorage, the same way terminal calls are counted (lib/ships/terminalCalls.js). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        MarineCadastre AIS daily points (CC0), the salish-v6 cache of scripts/ships/bake-ais/fetch_points.py.
 *                   Positions never go in Postgres.
 *   derived         scripts/ships/bake-ais/anchorage_stays.py keeps the STOPPED positions inside an anchorage polygon;
 *                   scripts/ships/anchorage-stays.mjs splits them into stays with splitStays() below and stores them in
 *                   anchorage_stays (migration 020), evidence class 'inferred'.
 *   interpretation  read time only: which EarthAtlas ship held the MMSI at t0 (vessels_for_mmsi_at) and its kind
 *                   (EarthAtlas classification, else the AIS type the ship broadcast: terminalCard.js callKind).
 *
 * The rule (STAY_RULE): an AIS position counts when the ship reports speed over ground < 0.5 kn inside the anchorage's polygon
 * (the real polygon, not its bounding box; even-odd rule, as anchorages.js pointInGeometry). Where polygons overlap, the
 * position goes to ONE anchorage — designated over DFO-listed over non-designated, then the smaller one (the same order as
 * anchorages.js matchPoint) — and the others are recorded ("also in"), never counted twice. No-anchoring areas are never
 * anchorages. Per anchorage and MMSI, positions sorted by time; a gap of more than 6 h starts a new stay; a stay counts when it
 * lasts at least 60 minutes (first to last stopped position). 60 min, not the terminals' 15: anchorages lie across traffic
 * lanes and pilot boarding grounds, where ships slow and drift for minutes without anchoring; an hour at < 0.5 kn is a ship
 * waiting at anchor (or drifting while it waits), not one passing through.
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { MC_SOURCE } from './marinecadastre.js'
import { splitCalls, AIS_BOX, COVERAGE, coveredMonths } from './terminalCalls.js'
import { daysOf } from './activityEstimates.js'
import { classifyVessels, callKind } from './terminalCard.js'
import { labelOf } from './taxonomy.js'

// as1 (2026-09-30): first bake; 110 anchorage polygons inside the salish-v6 box (79 DFO circles, 20 CFR, 11 non-designated).
export const STAY_BAKE_VERSION = 'as1'
export const STAY_RULE = Object.freeze({ sogKn: 0.5, gapHours: 6, minMinutes: 60 })
export { COVERAGE as STAY_COVERAGE }

export const ANCHORAGE_STAYS_SOURCE = {
  id: 'earthatlas-anchorage-stays',
  name: 'EarthAtlas anchorage stays (derived from MarineCadastre AIS)',
  publisher: 'EarthAtlas, from NOAA Office for Coastal Management / BOEM MarineCadastre AIS (U.S. Coast Guard receivers)',
  homepage_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  license: 'CC0 1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_use: true,
  attribution_text: 'MarineCadastre AIS (NOAA / BOEM / USCG), anchorage stays derived by EarthAtlas',
  attribution_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  notes: 'Derived dataset, evidence class inferred: an EarthAtlas rule applied to AIS self-reported positions. A stay = the ship '
    + 'reports speed over ground < 0.5 kn inside an anchorage polygon (33 CFR areas as digitised by NOAA / USCG; DFO anchorages as '
    + 'circles of their listed swing radius, built by EarthAtlas; Puget Sound non-designated anchorages from the withdrawn 2017 '
    + 'proposed rule 82 FR 10313) for at least 60 minutes; a gap of > 6 h starts a new stay; where polygons overlap a position counts '
    + 'once (designated, then DFO-listed, then non-designated, then the smaller area). Input: MarineCadastre daily points (CC0 1.0), '
    + 'US terrestrial receivers only, box W -126.2 S 47 E -122.05 N 49.6; anchorages outside the box are not covered. Names, IMO, '
    + 'type and length on a stay are as the ship broadcast them (AIS reported), never a registry fact.',
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const RANK = { designated: 0, active_listed: 1, non_designated: 2 }
export const anchorageKey = (a) => `${a.source_id}|${a.source_key}`

/** 'covered' when the whole polygon (its bounding box) lies inside the AIS points box, 'partial' when it only overlaps, else 'none'. */
export function aisCoverage(a, box = AIS_BOX) {
  if (a.min_lat == null) return 'none'
  if (a.min_lat >= box.s && a.max_lat <= box.n && a.min_lon >= box.w && a.max_lon <= box.e) return 'covered'
  if (a.max_lat >= box.s && a.min_lat <= box.n && a.max_lon >= box.w && a.min_lon <= box.e) return 'partial'
  return 'none'
}

/**
 * Anchorage rows → what the bake reads (pure): every active anchorage with a polygon, no no-anchoring areas, with its overlap
 * priority (lower wins: legal status, then bounding-box area) and whether the AIS box covers it. Only `covered` ones are baked.
 */
export function bakeAnchorages(rows) {
  const area = (a) => (a.max_lat - a.min_lat) * (a.max_lon - a.min_lon)
  const usable = rows.filter((a) => a.geometry && !a.no_anchoring)
  const ordered = [...usable].sort((x, y) => RANK[x.legal_status] - RANK[y.legal_status] || area(x) - area(y) || anchorageKey(x).localeCompare(anchorageKey(y)))
  return ordered.map((a, i) => ({ key: anchorageKey(a), id: Number(a.id), source_id: a.source_id, source_key: a.source_key, name: a.name,
    legal_status: a.legal_status, priority: i, coverage: aisCoverage(a), geometry: a.geometry,
    bbox: [a.min_lat, a.max_lat, a.min_lon, a.max_lon] }))
}

/** Polygon edges for the bake's point-in-polygon join: [{ key, x1, y1, x2, y2 }] over every ring (pure). */
export function polygonEdges(key, g) {
  const rings = g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates.flat() : []
  const out = []
  for (const r of rings) for (let i = 1; i < r.length; i++) out.push({ key, x1: r[i - 1][0], y1: r[i - 1][1], x2: r[i][0], y2: r[i][1] })
  return out
}

/**
 * Stopped positions of one anchorage + one MMSI → stays (pure): { t0, t1, n, also, ambiguousPoints, name, imo, type, length }.
 * points: { t (ms, UTC), also: [anchorage keys] | null, name, imo, type, length }. The same splitting as terminal calls
 * (terminalCalls.js splitCalls: gap > gapHours = new stay; kept when t1 - t0 >= minMinutes; static fields = the value the
 * ship broadcast most often), with the anchorage rule.
 */
export function splitStays(points, rule = STAY_RULE) {
  return splitCalls(points.map((p) => ({ ...p, m: 0, berth: null })), rule)
    .map(({ t0, t1, n, also, ambiguousPoints, name, imo, type, length }) => ({ t0, t1, n, also, ambiguousPoints, name, imo, type, length }))
}

/** Streaming form: feed hits sorted by (anchorage, mmsi, t); emit(stay) gets { anchorage, mmsi, ...stay }. */
export function staySplitter(emit, rule = STAY_RULE) {
  let key = null, group = []
  const flush = () => {
    if (!group.length) return
    const i = key.lastIndexOf('#')
    const anchorage = key.slice(0, i), mmsi = key.slice(i + 1)
    for (const s of splitStays(group, rule)) emit({ anchorage, mmsi, ...s })
    group = []
  }
  return {
    push(anchorage, mmsi, p) {
      const k = `${anchorage}#${mmsi}`
      if (k !== key) { flush(); key = k }
      group.push(p)
    },
    end: flush,
  }
}

/** UTC calendar days (YYYY-MM-DD) a stay touches (pure). */
export function stayDays(t0, t1) {
  const out = []
  const a = new Date(t0), b = new Date(t1)
  let d = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const end = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  for (; d <= end; d += 864e5) out.push(new Date(d).toISOString().slice(0, 10))
  return out
}

// ── Storage (dev DB via scripts/ships/anchorage-stays.mjs; tests in a throwaway schema) ─────────────────────────────────

/**
 * Store one bake (one transaction; c inside withTx): the bake record, its stays (replacing this version's rows) and the
 * coverage row. stays: staySplitter output. bake: { rule, input, days, months: [{ month, complete }], anchorages: [{ key, id,
 * name, coverage, ... }] }. Returns { recordId, recordCreated, stays }.
 */
// months: as storeTerminalCalls (2026-10-07): replace only these months and add them to the version's months.
export async function storeAnchorageStays(c, S, { stays, bake, runId = null, version = STAY_BAKE_VERSION, months = null }) {
  await upsertSource(c, S, MC_SOURCE)
  await upsertSource(c, S, ANCHORAGE_STAYS_SOURCE)
  const byKey = new Map((bake.anchorages || []).map((a) => [a.key, a]))
  const unknown = [...new Set(stays.filter((s) => !byKey.has(s.anchorage)).map((s) => s.anchorage))]
  if (unknown.length) throw new Error(`stays for anchorages not in the bake: ${unknown.join(', ')}`)
  // Row ids come from THIS database, by each anchorage's stable key (source_id|source_key): an input file's ids can be another
  // database's (2026-10-07: dev and production ids differ).
  const keys = [...byKey.keys()]
  const idOf = new Map((await c.query(`SELECT source_id || '|' || source_key AS k, id FROM ${S}.anchorages WHERE status = 'active' AND source_id || '|' || source_key = ANY($1)`, [keys])).rows.map((r) => [r.k, Number(r.id)]))
  const missing = [...new Set(stays.map((s) => s.anchorage))].filter((k) => !idOf.has(k))
  if (missing.length) throw new Error(`anchorages not in ${S}.anchorages: ${missing.slice(0, 5).join(', ')}`)
  const ent = await findOrCreateEntity(c, S, { sourceId: ANCHORAGE_STAYS_SOURCE.id, kind: 'anchorage_stay_bake', anchor: version })
  const payload = { method: ANCHORAGE_STAYS_SOURCE.notes, bake_version: version, ...bake,
    anchorages: (bake.anchorages || []).map(({ key, id, name, legal_status, coverage, priority }) => ({ key, id, name, legal_status, coverage, priority })),
    stays: stays.length }
  const rec = await upsertRecord(c, S, { sourceId: ANCHORAGE_STAYS_SOURCE.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: null, runId })
  if (months) {
    const off = stays.filter((x) => !months.includes(new Date(x.t0).toISOString().slice(0, 7)))
    if (off.length) throw new Error(`${off.length} stays fall outside ${months.join(', ')}`)
    await c.query(`DELETE FROM ${S}.anchorage_stays WHERE bake_version = $1 AND to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($2)`, [version, months])
  } else await c.query(`DELETE FROM ${S}.anchorage_stays WHERE bake_version = $1`, [version])
  for (let i = 0; i < stays.length; i += 1000) {
    const b = stays.slice(i, i + 1000)
    const a = (s) => byKey.get(s.anchorage)
    await c.query(
      `INSERT INTO ${S}.anchorage_stays (bake_version, anchorage_id, anchorage_source_id, anchorage_source_key, mmsi, t0, t1, n_points,
              also_in, ambiguous_points, ais_name, ais_imo, ais_vessel_type, ais_length, bake_record_id)
       SELECT $1, x.aid, x.asrc, x.akey, x.mmsi, x.t0, x.t1, x.n, string_to_array(nullif(x.also, ''), '#'), x.amb, x.name, x.imo, x.vtype, x.len, $2
         FROM unnest($3::bigint[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::timestamptz[], $9::int[], $10::text[], $11::int[],
                     $12::text[], $13::text[], $14::int[], $15::real[])
              AS x(aid, asrc, akey, mmsi, t0, t1, n, also, amb, name, imo, vtype, len)`,
      [version, rec.id, b.map((s) => idOf.get(s.anchorage)), b.map((s) => a(s).source_id), b.map((s) => a(s).source_key), b.map((s) => String(s.mmsi)),
        b.map((s) => new Date(s.t0).toISOString()), b.map((s) => new Date(s.t1).toISOString()), b.map((s) => s.n),
        b.map((s) => (s.also || []).join('#')), b.map((s) => s.ambiguousPoints || 0), b.map((s) => s.name ?? null),
        b.map((s) => (s.imo == null ? null : String(s.imo))), b.map((s) => (s.type == null ? null : Number(s.type))), b.map((s) => s.length ?? null)])
  }
  await c.query(`INSERT INTO ${S}.anchorage_stay_bakes (bake_version, source_id, bake_record_id, months, covered, rule, imported_at)
                 VALUES ($1, $2, $3, $4, $5, $6, now())
                 ON CONFLICT (bake_version) DO UPDATE SET bake_record_id = EXCLUDED.bake_record_id,
                   months = CASE WHEN $7 THEN ARRAY(SELECT DISTINCT unnest(${S}.anchorage_stay_bakes.months || EXCLUDED.months) ORDER BY 1) ELSE EXCLUDED.months END,
                   covered = EXCLUDED.covered, rule = EXCLUDED.rule, imported_at = now()`,
    [version, ANCHORAGE_STAYS_SOURCE.id, rec.id, (bake.months || []).filter((m) => m.complete && (!months || months.includes(m.month))).map((m) => m.month),
      (bake.anchorages || []).filter((x) => x.coverage === 'covered').map((x) => x.key), bake.rule || STAY_RULE, !!months])
  return { recordId: rec.id, recordCreated: rec.created, stays: stays.length }
}

// ── Read (no network) ────────────────────────────────────────────────────────

const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d))

/**
 * Stays at one anchorage (any version: keyed by source_id + source_key) in the picked months, summarised for the popup:
 * { bake, coverage: 'covered' | 'not_covered' | 'no_boundary' | 'no_anchoring' | 'not_loaded', months: { covered, missing },
 *   summary: { stays, ships, hours, perMonth, kinds: [{ label, stays, ships }] }, top: [{ ship, days, hours, stays }] }.
 * win = portCard.js parseCardWindow() ({ from, to, months }).
 */
export async function readAnchorageStays(q, S, a, win, { top = 8 } = {}) {
  const base = { rule: STAY_RULE, aisFrom: COVERAGE.from, aisTo: COVERAGE.to }
  if (a.no_anchoring) return { ...base, coverage: 'no_anchoring', months: { covered: [], missing: win.months } }
  if (!a.geometry && a.built_from === 'not_built') return { ...base, coverage: 'no_boundary', months: { covered: [], missing: win.months } }
  let bake
  try {
    [bake] = await q(`SELECT bake_version, months, covered, rule, bake_record_id, imported_at FROM ${S}.anchorage_stay_bakes WHERE bake_version = $1`, [STAY_BAKE_VERSION])
  } catch (e) {
    if (e?.code === '42P01') return { ...base, coverage: 'not_loaded', months: { covered: [], missing: win.months } } // before migration 020
    throw e
  }
  if (!bake) return { ...base, coverage: 'not_loaded', months: { covered: [], missing: win.months } }
  const bakeInfo = { version: bake.bake_version, recordId: Number(bake.bake_record_id), importedAt: iso(bake.imported_at), months: bake.months }
  // The months the AIS actually covers now (ships-noaa-month adds them), not the hand-run bake's fixed span.
  if (bake.months?.length) { const ms = [...bake.months].sort(); base.aisFrom = ms[0]; base.aisTo = ms[ms.length - 1] }
  if (!(bake.covered || []).includes(anchorageKey(a))) return { ...base, bake: bakeInfo, coverage: 'not_covered', months: { covered: [], missing: win.months } }
  const months = coveredMonths(win.months, bake.months)
  const rows = months.covered.length ? await q(
    `SELECT s.mmsi, s.t0, s.t1, s.n_points, s.also_in, s.ais_name, s.ais_imo, s.ais_vessel_type, s.ais_length
       FROM ${S}.anchorage_stays s
      WHERE s.bake_version = $1 AND s.anchorage_source_id = $2 AND s.anchorage_source_key = $3
        AND to_char(s.t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($4) ORDER BY s.t0`,
    [STAY_BAKE_VERSION, a.source_id, a.source_key, months.covered]) : []
  if (rows.length) {
    const res = await q(
      `SELECT x.i, array_agg(DISTINCT v.vessel_id) AS vessel_ids
         FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS x(i, mmsi, at)
         CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
      [rows.map((_, i) => i), rows.map((r) => r.mmsi), rows.map((r) => iso(r.t0))])
    for (const r of res) {
      const s = rows[r.i]
      if (r.vessel_ids.length === 1) s.vesselId = r.vessel_ids[0]
      else s.ambiguousVessels = r.vessel_ids.length
    }
  }
  const byVessel = await classifyVessels(q, S, [...new Set(rows.map((r) => r.vesselId).filter(Boolean))])
  return { ...base, bake: bakeInfo, coverage: 'covered', months, ...summarizeStays(rows, win.months, months.covered, byVessel, top) }
}

/**
 * The popup's figures from stay rows (pure; rows already resolved: vesselId / ambiguousVessels): stays, distinct ships,
 * ship-hours, per month (null = no AIS that month), by kind, and the top ships by days then hours.
 */
export function summarizeStays(rows, months, coveredList, byVessel = new Map(), top = 8) {
  const hrs = (r) => (new Date(r.t1) - new Date(r.t0)) / 3600e3
  const shipKey = (r) => r.vesselId || `mmsi:${r.mmsi}`
  const kinds = new Map(), ships = new Map()
  for (const r of rows) {
    const k = callKind({ vesselId: r.vesselId, ais_vessel_type: r.ais_vessel_type }, byVessel)
    const label = k.group && k.group !== 'unknown' ? (labelOf(k.group) || k.group) : 'Kind not stated'
    const kk = kinds.get(label) || { label, group: k.group || 'unknown', stays: 0, ships: new Set(), hours: 0 }
    kk.stays++; kk.ships.add(shipKey(r)); kk.hours += hrs(r)
    kinds.set(label, kk)
    const id = shipKey(r)
    const s = ships.get(id) || { key: id, vesselId: r.vesselId || null, ambiguousVessels: r.ambiguousVessels || 0, mmsi: r.mmsi,
      aisName: null, kind: k.class && !String(k.class).endsWith('_unspecified') ? labelOf(k.class) : (k.group && k.group !== 'unknown' ? labelOf(k.group) : null),
      kindBasis: k.basis, aisType: r.ais_vessel_type ?? null, aisLength: r.ais_length == null ? null : Number(r.ais_length),
      stays: 0, hours: 0, days: new Set(), lastAt: null }
    s.stays++; s.hours += hrs(r)
    for (const d of stayDays(r.t0, r.t1)) s.days.add(d)
    const t0 = iso(r.t0)
    if (!s.lastAt || t0 > s.lastAt) { s.lastAt = t0; s.aisName = r.ais_name || s.aisName }
    ships.set(id, s)
  }
  const covered = new Set(coveredList)
  const list = [...ships.values()].map((s) => ({ ...s, days: s.days.size, hours: Math.round(s.hours * 10) / 10 }))
    .sort((a, b) => b.days - a.days || b.hours - a.hours || String(b.lastAt).localeCompare(String(a.lastAt)))
  return {
    summary: {
      stays: rows.length, ships: ships.size, hours: Math.round(rows.reduce((h, r) => h + hrs(r), 0)),
      shipDays: list.reduce((n, s) => n + s.days, 0),
      perMonth: months.map((m) => ({ month: m, n: covered.has(m) ? rows.filter((r) => iso(r.t0).slice(0, 7) === m).length : null })),
      // By day when one or two months are picked (Josh 2026-10-07); null = no AIS that day.
      perDay: months.length <= 2 ? daysOf(months).map((d) => ({ day: d, n: covered.has(d.slice(0, 7)) ? rows.filter((r) => iso(r.t0).slice(0, 10) === d).length : null })) : null,
      kinds: [...kinds.values()].map((k) => ({ label: k.label, group: k.group, stays: k.stays, ships: k.ships.size, hours: Math.round(k.hours) }))
        .sort((a, b) => b.ships - a.ships || b.stays - a.stays),
    },
    top: list.slice(0, top),
  }
}
