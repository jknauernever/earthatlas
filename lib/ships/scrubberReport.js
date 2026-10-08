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
 *   large ships      calls whose AIS ship type is passenger, cargo or tanker (AIS 60–89): the denominator for "share", and the only
 *                    calls a scrubber ship is credited with (tugs, fishing boats, tenders and pleasure craft are not in the report).
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
const CALLS_CTE = (S, extra = '') => `
  c AS (
    SELECT tc.id, tc.terminal_key, tc.mmsi, tc.t0, tc.t1, tc.ais_name, tc.ais_imo, tc.ais_vessel_type,
           to_char(tc.t0 AT TIME ZONE 'UTC', 'YYYY-MM') AS month, to_char(tc.t0 AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
      FROM ${S}.terminal_calls tc
     WHERE tc.bake_version = $3 AND tc.t0 >= $4::date AND tc.t0 < ($5::date + interval '1 month') ${extra}),
  m AS MATERIALIZED (
    SELECT sm.vessel_id, sm.mmsi, sm.period, sm.period_kind, si.imos FROM sm LEFT JOIN si ON si.vessel_id = sm.vessel_id),
  hit AS (
    SELECT DISTINCT ON (c.id) c.id, m.vessel_id
      FROM c JOIN m ON m.mmsi = c.mmsi
     WHERE (m.period_kind = 'unknown' OR m.period IS NULL OR m.period @> c.t0)
       AND (c.ais_imo IS NULL OR c.ais_imo !~ '^[0-9]{7}$' OR m.imos IS NULL OR c.ais_imo = ANY(m.imos))
       -- Only passenger, cargo and tanker ships (AIS 60-89), as Lovel's wording says (2026-10-08): this also drops boats that only share
       -- a scrubber ship's name or MMSI (a fishing boat called SARA, a cruise ship's tenders).
       AND c.ais_vessel_type BETWEEN 60 AND 89
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

  // Estimates are used for the months NOAA hasn't published, and for EVERY month at terminals outside NOAA's coverage (Howe Sound,
  // Texada: north of the US shore receivers), so those terminals are reported from hourly positions instead of left out.
  const notCovered = new Set(bake?.not_covered || [])
  const estBakes = await q(`SELECT month, through::text AS through, bake_record_id FROM ${S}.activity_estimate_bakes
                              WHERE bake_version = $1 AND kind = 'terminal' AND month = ANY($2) ORDER BY month`,
    [ACTIVITY_BAKE_VERSION, notCovered.size ? months : months.filter((m) => !covered.has(m))])
  const estAll = estBakes.map((b) => b.month)
  const estMonths = estAll.filter((m) => !covered.has(m))   // whole months estimated (after NOAA's latest)
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
    estAll.length ? scrubberEstimates(q, S, estAll, { keep: (tk, m) => !covered.has(m) || notCovered.has(tk) }) : null,
  ])

  // Registry names for the ships seen (latest name assertion), so the list reads like the ship cards.
  const ids = [...new Set(ships.map((r) => r.vessel_id))]
  // The name each ship broadcast most at the docks in these calls (tender boats' "… T12" names left out).
  const dockNames = new Map()
  for (const r of ships) {
    if (!r.ais_name || / T\d+$/.test(r.ais_name)) continue
    const m = dockNames.get(r.vessel_id) || dockNames.set(r.vessel_id, new Map()).get(r.vessel_id)
    m.set(r.ais_name, (m.get(r.ais_name) || 0) + r.calls)
  }
  const dockName = new Map([...dockNames].map(([id, m]) => [id, [...m].sort((a, b) => b[1] - a[1])[0][0]]))
  const shipInfo = await scrubberShipInfo(q, S, [...new Set([...ids, ...(est?.ships || []).map((r) => r.vessel_id)])], dockName)

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
    terminals: terms.map((t) => ({ ...t, counted: baked.has(t.key) && !notCovered.has(t.key), estimatedOnly: notCovered.has(t.key) })),
    cells: cells.filter((r) => covered.has(r.month)),
    estimated: est ? { months: estMonths, allMonths: estAll, through: estBakes.at(-1)?.through || null, source: TERMINAL_ESTIMATES_SOURCE.id,
      records: estBakes.map((b) => ({ month: b.month, recordId: Number(b.bake_record_id) })), ...est } : null,
    ships: ships.filter((r) => covered.has(r.month)).map((r) => ({ ...r, name: shipInfo[r.vessel_id]?.name || r.ais_name || null })),
    shipInfo,
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
export async function scrubberEstimates(q, S, months, { keep = () => true } = {}) {
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
    if (!s.candidates.some((c) => keep(c, s.month))) continue   // a NOAA-counted month at NOAA-covered terminals: NOAA's count stands
    if (!fitting.length) { other++; continue }      // the ship's kind fits none of the candidates (e.g. a tug, or a tanker by a grain dock)
    if (fitting.length > 1) { shared.calls++; shared.ships.add(s.vessel_id); shared.byMonth[s.month] = (shared.byMonth[s.month] || 0) + 1; continue }
    const tk = fitting[0]
    if (!keep(tk, s.month)) continue
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

// ── The scrubber ships themselves (Josh 2026-10-08: names, flag, operator, owner, equipment) ──

const LOOPS = ['open', 'hybrid', 'closed']
/** A ship's scrubber type from its IMO notifications: hybrid if any notification says hybrid, else open, else closed; else not reported. */
export function loopOf(notifications) {
  const all = new Set(notifications.flatMap((n) => n?.loop || []))
  return all.has('hybrid') ? 'hybrid' : all.has('open') ? 'open' : all.has('closed') ? 'closed' : 'not_reported'
}
/** The MEP Alliance list's own ship category, used when the registries only say "cargo" / "tanker" / "passenger". */
export function kindFromMep(category) {
  const x = String(category || '')
  if (/cruise|passenger/i.test(x)) return { group: 'passenger', label: 'Cruise ship', source: 'mep' }
  if (/container/i.test(x)) return { group: 'cargo', label: 'Container ship', source: 'mep' }
  if (/ro-?ro|vehicle|car carrier/i.test(x)) return { group: 'cargo', label: 'Vehicle carrier', source: 'mep' }
  if (/bulk/i.test(x)) return { group: 'cargo', label: 'Bulk carrier', source: 'mep' }
  if (/tanker|lng|lpg/i.test(x)) return { group: 'tanker', label: 'Tanker', source: 'mep' }
  return null
}
const stripQ = (v) => (v ? String(v).replace(/\s*\(Q\d+\)\s*$/, '').trim() : null)

/**
 * → { [vessel_id]: { name, kind: { group, label }, flag: { iso3, name }, operator: { name, source }, owner: { name, source },
 *      scrubber: { loop, maker, model, submitted, sources: { gisis?: url, mep?: url } } } }
 * name: the name the ship broadcast most at the docks (registries via GFW drop the spaces); operator: the MEP Alliance list's
 * "controller", else Wikidata's operator; owner: the registry owner GFW reports. Every value names its source.
 */
export async function scrubberShipInfo(q, S, ids, dockName = new Map()) {
  if (!ids.length) return {}
  const [rows, kinds] = await Promise.all([
    q(`SELECT va.vessel_id, va.attribute, va.source_id, va.evidence_class, va.value_raw, va.value_norm, va.detail
         FROM ${S}.vessel_assertions va
        WHERE va.vessel_id = ANY($1::uuid[]) AND va.attribute IN ('name', 'flag', 'registry_owner', 'owner', 'operator', 'scrubber')`, [ids]),
    classifyVessels(q, S, ids),
  ])
  const by = new Map()
  for (const r of rows) (by.get(r.vessel_id) || by.set(r.vessel_id, []).get(r.vessel_id)).push(r)
  const iso3s = [...new Set(rows.filter((r) => r.attribute === 'flag' && /^[A-Z]{3}$/.test(r.value_norm || '')).map((r) => r.value_norm))]
  const countries = new Map((iso3s.length ? await q(`SELECT iso3, name FROM ${S}.countries WHERE iso3 = ANY($1)`, [iso3s]) : []).map((r) => [r.iso3, r.name]))
  const out = {}
  for (const id of ids) {
    const A = by.get(id) || []
    const of = (attr) => A.filter((a) => a.attribute === attr)
    const top = (list, key) => {   // the most frequent value, registry first
      const n = new Map()
      for (const a of list) { const k = key(a); if (k) n.set(k, (n.get(k) || 0) + (a.evidence_class === 'registry' ? 10 : 1)) }
      return [...n.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null
    }
    const flag = top(of('flag'), (a) => (/^[A-Z]{3}$/.test(a.value_norm || '') ? a.value_norm : null))
    const sc = of('scrubber')
    const gis = sc.filter((a) => a.source_id === SCRUBBER_SOURCES.gisis).map((a) => a.detail || {})
      .sort((x, y) => String(y.submitted || '').localeCompare(String(x.submitted || '')))
    const mep = sc.filter((a) => SCRUBBER_SOURCES.mep.includes(a.source_id)).map((a) => a.detail || {})
    const mepWithController = mep.find((d) => d.controller)
    const wdOperator = stripQ(of('operator').find((a) => a.source_id === 'wikidata')?.value_raw)
    const owner = of('registry_owner')[0]?.value_raw || stripQ(of('owner').find((a) => a.source_id === 'wikidata')?.value_raw) || null
    const regName = of('name').find((a) => /\s/.test(a.value_raw || '') && a.evidence_class !== 'ais_self_reported')?.value_raw
    const mepName = mep.find((d) => d.ship_name)?.ship_name
    out[id] = {
      name: dockName.get(id) || mepName || regName || of('name')[0]?.value_raw || null,
      kind: (() => {
        const k = kinds.get(id)
        const specific = k && k.class && !String(k.class).endsWith('_unspecified')
        const fromMep = kindFromMep(mep.find((d) => d.category)?.category)
        return specific ? { group: k.group, label: k.label } : fromMep || (k ? { group: k.group, label: k.label } : null)
      })(),
      flag: flag ? { iso3: flag, name: countries.get(flag) || flag } : null,
      operator: mepWithController ? { name: mepWithController.controller, source: 'mep', url: mepWithController.page_url || null }
        : wdOperator ? { name: wdOperator, source: 'wikidata' } : null,
      owner: owner ? { name: owner, source: of('registry_owner').length ? 'gfw' : 'wikidata' } : null,
      scrubber: {
        loop: loopOf(gis),
        maker: gis[0]?.manufacturer || null, model: gis[0]?.model || null, submitted: gis[0]?.submitted || null,
        sources: { ...(gis.length ? { gisis: gis[0].page_url || null } : {}), ...(mep.length ? { mep: mep[0].page_url || null } : {}) },
      },
    }
  }
  return out
}

/** One terminal's scrubber-ship calls and ships in a period (the terminal card's line linking to the report). Counted months only. */
export async function scrubberTerminalSummary(q, S, { key, from, to }) {
  if (!MONTH.test(from) || !MONTH.test(to) || from > to || !key) throw new Error('key, from, to required')
  const [bake] = await q(`SELECT months, not_covered FROM ${S}.terminal_call_bakes WHERE bake_version = $1`, [CALLS_VERSION])
  const months = monthsBetween(from, to).filter((m) => (bake?.months || []).includes(m))
  const [t] = await q(`SELECT key, state_code FROM ${S}.terminals WHERE key = $1`, [key])
  if (!t || (bake?.not_covered || []).includes(key) || !months.length) return { key, counted: false }
  const [r] = await q(`WITH ${SCRUBBER_CTE(S)}, ${CALLS_CTE(S, 'AND tc.terminal_key = $6')}
     SELECT count(vessel_id)::int AS calls, count(DISTINCT vessel_id)::int AS ships FROM cs`,
    [SCRUBBER_SOURCES.gisis, SCRUBBER_SOURCES.mep, CALLS_VERSION, `${months[0]}-01`, `${months.at(-1)}-01`, key])
  return { key, counted: true, state: t.state_code, from: months[0], to: months.at(-1), calls: r?.calls || 0, ships: r?.ships || 0 }
}
