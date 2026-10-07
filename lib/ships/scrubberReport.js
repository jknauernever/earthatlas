/**
 * Scrubber-ship calls report (/ships/reports/scrubbers; docs/SHIPS_SCRUBBER_REPORT.md, Josh 2026-10-07; asked for by Lovel Pratt,
 * Friends of the San Juans, for the WA legislature). Read-only.
 *
 *   calls            terminal_calls of the current bake (CALLS_VERSION): a ship stopped at a berth, counted from NOAA per-minute AIS.
 *                    Every call counts (Josh 2026-10-07: a cruise ship at Pier 91 every week = one call a week).
 *   scrubber ship    lib/ships/scrubberFilter.js's definition: an IMO GISIS Reg. 4.2 scrubber notification, or a MEP Alliance list
 *                    through an accepted link (name-only "inferred" matches flagged).
 *   call → ship      the call's MMSI was held by that ship at the call's start (MMSI assertion period, or an undated MMSI), and when
 *                    the ship broadcast an IMO during the call it must be one of the ship's IMOs (guards against a reused MMSI).
 *   large ships      the denominator for "share": calls whose AIS ship type is passenger, cargo or tanker (AIS 60–89).
 *   coverage         only months the bake fully read count; terminals outside every AIS box are "not covered", never 0.
 *   estimated        months after NOAA's latest: stops estimated from GFW hourly positions (lib/ships/activityEstimates.js), kept apart and
 *                    marked ≈. A stop is credited to a terminal only when that terminal is the one candidate that fits the ship's kind (the
 *                    terminal card's rule); stops that fit several neighbouring terminals are "shared" and counted only in the totals.
 */
import { SCRUBBER_SOURCES } from './scrubberFilter.js'
import { BAKE_VERSION as CALLS_VERSION } from './terminalCalls.js'
import { ACTIVITY_BAKE_VERSION, TERMINAL_ESTIMATES_SOURCE } from './activityEstimates.js'
import { fitRule, shipFit, classifyVessels } from './terminalCard.js'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
export const monthsBetween = (a, b) => {
  const out = []
  let [y, m] = a.split('-').map(Number)
  const [y2, m2] = b.split('-').map(Number)
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, '0')}`); [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1] }
  return out
}

const SCRUBBER_CTE = (S) => `
  sv AS MATERIALIZED (
    SELECT va.vessel_id,
           bool_or(va.source_id = $1) AS gisis,
           bool_or(va.source_id = ANY($2)) AS mep,
           bool_or(va.source_id = ANY($2) AND l.method = 'MEP_NAME_SALISH_SIZE') AS mep_inferred
      FROM ${S}.vessel_assertions va
      JOIN ${S}.entity_links l ON l.source_entity_id = va.source_entity_id AND l.status = 'accepted'
     WHERE va.attribute = 'scrubber' AND (va.source_id = $1 OR va.source_id = ANY($2))
     GROUP BY va.vessel_id),
  sm AS MATERIALIZED (
    SELECT m.vessel_id, m.value_norm AS mmsi, m.period, m.period_kind
      FROM ${S}.vessel_assertions m JOIN sv ON sv.vessel_id = m.vessel_id
     WHERE m.attribute = 'mmsi'),
  si AS MATERIALIZED (
    SELECT i.vessel_id, array_agg(DISTINCT i.value_norm) AS imos
      FROM ${S}.vessel_assertions i JOIN sv ON sv.vessel_id = i.vessel_id
     WHERE i.attribute = 'imo' GROUP BY i.vessel_id)`

/** Calls in [from, to] months, each with the scrubber ship it belongs to (or NULL). */
const CALLS_CTE = (S) => `
  c AS (
    SELECT tc.id, tc.terminal_key, tc.mmsi, tc.t0, tc.t1, tc.ais_name, tc.ais_imo, tc.ais_vessel_type,
           to_char(tc.t0 AT TIME ZONE 'UTC', 'YYYY-MM') AS month, to_char(tc.t0 AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM ${S}.terminal_calls tc
     WHERE tc.bake_version = $3 AND tc.t0 >= $4::date AND tc.t0 < ($5::date + interval '1 month')),
  m AS MATERIALIZED (
    SELECT sm.vessel_id, sm.mmsi, sm.period, sm.period_kind, si.imos FROM sm LEFT JOIN si ON si.vessel_id = sm.vessel_id),
  hit AS (
    SELECT DISTINCT ON (c.id) c.id, m.vessel_id
      FROM c JOIN m ON m.mmsi = c.mmsi
     WHERE (m.period_kind = 'unknown' OR m.period IS NULL OR m.period @> c.t0)
       AND (c.ais_imo IS NULL OR c.ais_imo !~ '^[0-9]{7}$' OR m.imos IS NULL OR c.ais_imo = ANY(m.imos))
     ORDER BY c.id, m.vessel_id),
  cs AS (
    SELECT c.*, hit.vessel_id, (c.ais_vessel_type BETWEEN 60 AND 89) AS large
      FROM c LEFT JOIN hit ON hit.id = c.id)`

/**
 * The whole report for a period: terminals with their monthly counts, the scrubber ships seen, coverage and source notes.
 * → { period, coverage, scrubberSet, terminals: [...], ships: [...], monthly: [...] }
 */
export async function scrubberReport(q, S, { from, to }) {
  if (!MONTH.test(from) || !MONTH.test(to) || from > to) throw new Error('from / to must be YYYY-MM months, from ≤ to')
  const [bake] = await q(`SELECT b.months, b.not_covered, b.imported_at,
                                 ARRAY(SELECT DISTINCT x->>'terminal' FROM jsonb_array_elements(r.payload->'berths') x) AS baked
                            FROM ${S}.terminal_call_bakes b JOIN ${S}.source_records r ON r.id = b.bake_record_id
                           WHERE b.bake_version = $1`, [CALLS_VERSION])
  const months = monthsBetween(from, to)
  const covered = new Set(bake?.months || [])
  const params = [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep, CALLS_VERSION, `${from}-01`, `${to}-01`]

  const estBakes = await q(`SELECT month, through::text AS through, bake_record_id FROM ${S}.activity_estimate_bakes
                              WHERE bake_version = $1 AND kind = 'terminal' AND month = ANY($2) ORDER BY month`,
    [ACTIVITY_BAKE_VERSION, months.filter((m) => !covered.has(m))])
  const estMonths = estBakes.map((b) => b.month)
  const [terms, cells, ships, set, est] = await Promise.all([
    q(`SELECT key, name, kind, country, state_code, county_name, county_fips, place_name, place_geoid, place_kind, ownership,
              ownership_basis, operator, status, lat, lon
         FROM ${S}.terminals WHERE list_status = 'listed' ORDER BY name`),
    // terminal × month: all calls, large-ship calls, scrubber-ship calls, distinct scrubber ships
    q(`WITH ${SCRUBBER_CTE(S)}, ${CALLS_CTE(S)}
       SELECT terminal_key, month, count(*)::int AS calls, count(*) FILTER (WHERE large)::int AS large,
              count(vessel_id)::int AS scrubber_calls, count(DISTINCT vessel_id)::int AS scrubber_ships
         FROM cs GROUP BY 1, 2`, params),
    // per scrubber ship: where and how often (terminal × month), with the names it broadcast
    q(`WITH ${SCRUBBER_CTE(S)}, ${CALLS_CTE(S)}
       SELECT cs.vessel_id, cs.terminal_key, cs.month, count(*)::int AS calls,
              mode() WITHIN GROUP (ORDER BY cs.ais_name) AS ais_name, max(cs.ais_imo) AS ais_imo,
              sv.gisis, sv.mep, sv.mep_inferred
         FROM cs JOIN sv ON sv.vessel_id = cs.vessel_id
        WHERE cs.vessel_id IS NOT NULL GROUP BY cs.vessel_id, cs.terminal_key, cs.month, sv.gisis, sv.mep, sv.mep_inferred`, params),
    q(`WITH ${SCRUBBER_CTE(S)} SELECT count(*)::int AS vessels, count(*) FILTER (WHERE gisis)::int AS gisis,
              count(*) FILTER (WHERE mep)::int AS mep, count(*) FILTER (WHERE mep_inferred AND NOT gisis)::int AS mep_inferred FROM sv`,
      params.slice(0, 2)),
    estMonths.length ? scrubberEstimates(q, S, estMonths) : null,
  ])

  // Registry names for the ships seen (latest name assertion), so the list reads like the ship cards.
  const ids = [...new Set(ships.map((r) => r.vessel_id))]
  const names = ids.length ? await q(
    `SELECT DISTINCT ON (vessel_id) vessel_id, value_norm AS name FROM ${S}.vessel_assertions
      WHERE vessel_id = ANY($1::uuid[]) AND attribute = 'name' AND value_norm <> ''
      ORDER BY vessel_id, (evidence_class = 'registry') DESC, lower(period) DESC NULLS LAST`, [ids]) : []
  const nameOf = new Map(names.map((r) => [r.vessel_id, r.name]))

  const notCovered = new Set(bake?.not_covered || [])
  const baked = new Set(bake?.baked || [])
  return {
    period: { from, to, months },
    coverage: {
      bake: CALLS_VERSION,
      months: months.filter((m) => covered.has(m)),
      missing: months.filter((m) => !covered.has(m)),
      imported_at: bake?.imported_at || null,
    },
    scrubberSet: set[0] || { vessels: 0, gisis: 0, mep: 0, mep_inferred: 0 },
    // counted: the terminal's berths were in the bake (a terminal added since is "not counted yet"); covered: inside an AIS box
    terminals: terms.map((t) => ({ ...t, counted: baked.has(t.key) && !notCovered.has(t.key) })),
    cells: cells.filter((r) => covered.has(r.month)),
    estimated: est ? { months: estMonths, through: estBakes.at(-1)?.through || null, source: TERMINAL_ESTIMATES_SOURCE.id,
      records: estBakes.map((b) => ({ month: b.month, recordId: Number(b.bake_record_id) })), ...est } : null,
    ships: ships.filter((r) => covered.has(r.month)).map((r) => ({ ...r, name: nameOf.get(r.vessel_id) || r.ais_name || null })),
  }
}

/** One month, day by day, for one terminal or all (drill-down). → [{ terminal_key, day, calls, scrubber_calls }] */
export async function scrubberReportDays(q, S, { month, terminal = null }) {
  if (!MONTH.test(month)) throw new Error('month must be YYYY-MM')
  const params = [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep, CALLS_VERSION, `${month}-01`, `${month}-01`]
  const rows = await q(`WITH ${SCRUBBER_CTE(S)}, ${CALLS_CTE(S)}
     SELECT terminal_key, day, count(*)::int AS calls, count(*) FILTER (WHERE large)::int AS large,
            count(vessel_id)::int AS scrubber_calls
       FROM cs ${terminal ? 'WHERE terminal_key = $6' : ''} GROUP BY 1, 2 ORDER BY 2`, terminal ? [...params, terminal] : params)
  return rows
}

// ── Frozen editions (migration 029) ─────────────────────────────────────────

/** Freeze the report for { from, to } as edition `id` (never overwrites an existing edition). */
export async function createScrubberEdition(q, S, { id, from, to, title = null }) {
  const payload = await scrubberReport(q, S, { from, to })
  // Day-by-day drill-down is frozen too (one query per counted month).
  payload.days = {}
  for (const m of payload.coverage.months) payload.days[m] = await scrubberReportDays(q, S, { month: m })
  // "Where else these ships call", frozen for each area
  const { scrubberWorldPorts } = await import('./scrubberPorts.js')
  payload.world = {}
  for (const [g, states] of [['WA', ['WA']], ['BC', ['BC']], ['ALL', null]]) payload.world[g] = await scrubberWorldPorts(q, S, { from, to, states })
  const rows = await q(`INSERT INTO ${S}.report_editions (report, id, title, params, payload) VALUES ('scrubbers', $1, $2, $3, $4)
                        ON CONFLICT (report, id) DO NOTHING RETURNING id, created_at`, [id, title, { from, to }, payload])
  if (!rows.length) throw new Error(`edition ${id} already exists (editions are never overwritten)`)
  return rows[0]
}
/** → { id, title, params, created_at, payload } or null */
export async function readScrubberEdition(q, S, id) {
  const [r] = await q(`SELECT id, title, params, created_at, payload FROM ${S}.report_editions WHERE report = 'scrubbers' AND id = $1`, [id])
  return r || null
}
export async function listScrubberEditions(q, S) {
  return q(`SELECT id, title, params, created_at FROM ${S}.report_editions WHERE report = 'scrubbers' ORDER BY created_at DESC`)
}

// ── Months after NOAA's latest: GFW-estimated stops of scrubber ships ────────

/**
 * → { cells: [{ terminal_key, month, scrubber_calls, scrubber_ships }], ships: [{ vessel_id, terminal_key, month, calls, name, gisis, mep,
 *     mep_inferred }], shared: { calls, ships, byMonth: { m: n } }, days: { 'YYYY-MM-DD': { terminal_key: n } } }
 * Only scrubber ships' stops are read (their MMSI held at the stop's start), so the cost is bounded by those ships, not all traffic.
 */
export async function scrubberEstimates(q, S, months) {
  const stops = await q(`WITH ${SCRUBBER_CTE(S)}
     SELECT DISTINCT ON (e.id) e.id, e.month, e.candidates, e.t0, e.gfw_name, sm.vessel_id, sv.gisis, sv.mep, sv.mep_inferred
       FROM ${S}.terminal_call_estimates e
       JOIN sm ON sm.mmsi = e.mmsi AND (sm.period_kind = 'unknown' OR sm.period IS NULL OR sm.period @> e.t0)
       JOIN sv ON sv.vessel_id = sm.vessel_id
      WHERE e.bake_version = $3 AND e.month = ANY($4)
      ORDER BY e.id, sm.vessel_id`, [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep, ACTIVITY_BAKE_VERSION, months])
  const byVessel = await classifyVessels(q, S, [...new Set(stops.map((s) => s.vessel_id))])
  const keys = [...new Set(stops.flatMap((s) => s.candidates))]
  const rules = new Map((keys.length ? await q(`SELECT key, kind, detail FROM ${S}.terminals WHERE key = ANY($1)`, [keys]) : [])
    .map((r) => [r.key, fitRule(r.kind, r.detail?.ship_fit)]))
  const cell = new Map(), ship = new Map(), days = {}
  const shared = { calls: 0, ships: new Set(), byMonth: {} }
  let other = 0
  for (const s of stops) {
    const k = byVessel.get(s.vessel_id)
    const fitting = s.candidates.filter((c) => rules.has(c) && shipFit(rules.get(c), k) === 'fits')
    if (!fitting.length) { other++; continue }      // the ship's kind fits none of the candidates (e.g. a tug, or a tanker by a grain dock)
    if (fitting.length > 1) { shared.calls++; shared.ships.add(s.vessel_id); shared.byMonth[s.month] = (shared.byMonth[s.month] || 0) + 1; continue }
    const tk = fitting[0]
    const ck = `${tk}|${s.month}`
    const c = cell.get(ck) || { terminal_key: tk, month: s.month, scrubber_calls: 0, ids: new Set() }
    c.scrubber_calls++; c.ids.add(s.vessel_id); cell.set(ck, c)
    const sk = `${s.vessel_id}|${ck}`
    const e = ship.get(sk) || { vessel_id: s.vessel_id, terminal_key: tk, month: s.month, calls: 0, ais_name: s.gfw_name, gisis: s.gisis, mep: s.mep, mep_inferred: s.mep_inferred }
    e.calls++; ship.set(sk, e)
    const d = new Date(s.t0).toISOString().slice(0, 10)
    ;(days[d] ||= {})[tk] = (days[d][tk] || 0) + 1
  }
  const ids = [...new Set([...ship.values()].map((r) => r.vessel_id))]
  const names = ids.length ? await q(
    `SELECT DISTINCT ON (vessel_id) vessel_id, value_norm AS name FROM ${S}.vessel_assertions
      WHERE vessel_id = ANY($1::uuid[]) AND attribute = 'name' AND value_norm <> ''
      ORDER BY vessel_id, (evidence_class = 'registry') DESC, lower(period) DESC NULLS LAST`, [ids]) : []
  const nameOf = new Map(names.map((r) => [r.vessel_id, r.name]))
  return {
    cells: [...cell.values()].map(({ ids: v, ...c }) => ({ ...c, scrubber_ships: v.size })),
    ships: [...ship.values()].map((r) => ({ ...r, name: nameOf.get(r.vessel_id) || r.ais_name || null })),
    shared: { calls: shared.calls, ships: shared.ships.size, byMonth: shared.byMonth },
    notFitting: other,
    days,
  }
}
