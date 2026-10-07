/**
 * Terminal pins on the map + the terminal card (/ships; Josh's decisions 2026-09-28, UI "A + C").
 * Facts and rules behind each choice: docs/OIL_GAS_INFRASTRUCTURE_SOURCES.md ("Built (dev)" and "Terminal card (dev)").
 * Rules: src/ships/CLAUDE.md.
 *
 *   counted         calls from EarthAtlas's own AIS positions (Josh 2026-09-28): terminal_calls (migration 016), baked from
 *                   the MarineCadastre points cache by lib/ships/terminalCalls.js's rule (stopped within a berth's radius for
 *                   15+ min). Resolved to EarthAtlas ships at read time by the MMSI valid at the call (vessels_for_mmsi_at).
 *   comparison      the stored GFW port-visit events (port_visits, 007) matched to the terminal (terminals.js matchVisit):
 *                   shown, never counted (GFW logs a visit against a whole port area, so terminal counts came out near zero).
 *                   ensureTerminalCard still fetches them, but only when asked (api op=terminal&fetch=1); the card doesn't.
 *   claim           terminals / terminal_berths / terminal_links (012, 015): lib/ships/terminals.js
 *   interpretation  read time only: whether the ship's kind fits the terminal (shipFit below, decision 1). Nothing stored.
 *
 * Decision 1 (Josh 2026-09-28): a visit counts at a terminal only if the ship's kind fits the terminal's kind (tankers and
 * bunker barges at oil terminals, bulk carriers at coal / grain, gas carriers at LNG, …). The ship's kind = EarthAtlas's
 * classification (lib/ships/taxonomy.js, all its type claims) when the ship is in our database; otherwise the AIS type the
 * ship broadcast during the call. Other traffic is listed, folded, as "Other vessels"; ships whose kind nobody states are
 * kept apart as "kind not known" (never counted, never guessed).
 */
import { classifyClaims, fromGfwType, fromAisCode, labelOf } from './taxonomy.js'
import { BAKE_VERSION, CALL_RULE, COVERAGE, coveredMonths, TERMINAL_CALLS_SOURCE } from './terminalCalls.js'
import { terminalVisits, terminalGfwLabels, allBerths, REACH_KM, MATCH_KM, AMBIGUITY_RATIO } from './terminals.js'
import { discover, fetchMonthEvents, fetchIsFresh, gfwCallsToday, nextMonth, EVENT_PAGES, DAILY_GFW_CALLS, FULL_REFRESH_DAYS } from './portCard.js'
import { PORT_VISITS_SOURCE } from './portVisits.js'
import { startRun, finishRun, upsertSource } from './store.js'
import { withTx } from './db.js'
import { haversineKm } from './ports.js'
import { CT_STAYS_VERSION, CT_VOYAGES_SOURCE, CT_STAY_RULE, fromCtType } from './ctStays.js'
import { trackerOf } from './ctVoyages.js'
import { readTerminalEstimates, daysOf } from './activityEstimates.js'

// ── Decision 1: which kinds of ship fit which kind of terminal (pure) ────────

const OIL_TANKERS = ['oil_tanker', 'oil_chemical_tanker', 'bunker_tanker', 'other_tanker']
/**
 * Josh 2026-09-29 (B3): a pure "chemical tanker" counts at refinery docks and crude / fuel-product terminals, for AIS visits
 * AND Climate TRACE port stays (one rule for both). Product tankers, the ships that load refined fuel at these docks, are
 * often filed as chemical tankers (e.g. by Climate TRACE). Not at bunkering, fuel-dock or military piers.
 */
const OIL_DOCK_TANKERS = [...OIL_TANKERS, 'chemical_tanker']
const BULK = ['bulk_carrier', 'general_cargo']
/**
 * Per terminal kind: `classes` fit; `unspecified` groups fit when the ship's class is only known as "<group>, kind not
 * specific" (AIS 80-89 = tanker: a tanker at an oil dock fits); `maybe` groups in that case are kept apart as "could be"
 * (AIS 70-79 = cargo: at Roberts Bank that is as likely a Deltaport container ship as a Westshore coal ship, so it is not
 * counted); `groups` fit whatever their class. Anything else is "other".
 * Judgement calls, listed for Josh in the report: tug / tow counts at aggregate, cement and forest-product docks (those
 * cargoes move by tug and barge, and a barge has no AIS of its own); a fuel dock serves the working boats that refuel there.
 */
export const SHIP_FIT = {
  // Tugs count at oil and fuel docks (Josh 2026-09-28): a tank or bunker barge has no AIS of its own, so its tug is what GFW sees.
  refinery_dock: { classes: OIL_DOCK_TANKERS, unspecified: ['tanker'], groups: ['tug_tow'], tugNote: true },
  crude_terminal: { classes: OIL_DOCK_TANKERS, unspecified: ['tanker'], groups: ['tug_tow'], tugNote: true },
  product_terminal: { classes: OIL_DOCK_TANKERS, unspecified: ['tanker'], groups: ['tug_tow'], tugNote: true },
  bunkering_terminal: { classes: OIL_TANKERS, unspecified: ['tanker'], groups: ['tug_tow'], tugNote: true },
  military_fuel_pier: { classes: OIL_TANKERS, unspecified: ['tanker'], groups: ['naval', 'tug_tow'], tugNote: true },
  fuel_dock: { classes: OIL_TANKERS, unspecified: ['tanker'], groups: ['fishing', 'tug_tow', 'port_service', 'government'], tugNote: true },
  lng_terminal: { classes: ['lng_carrier', 'gas_carrier', 'bunker_tanker'] },
  lpg_terminal: { classes: ['lpg_carrier', 'gas_carrier'], unspecified: ['tanker'] },
  chemical_terminal: { classes: ['chemical_tanker', 'oil_chemical_tanker', 'other_tanker'], unspecified: ['tanker'] },
  coal_terminal: { classes: ['bulk_carrier'], maybe: ['cargo'] },
  grain_terminal: { classes: BULK, maybe: ['cargo'] },
  dry_bulk_terminal: { classes: BULK, maybe: ['cargo'], groups: ['tug_tow'] },
  cement_terminal: { classes: BULK, maybe: ['cargo'], groups: ['tug_tow'] },
  scrap_metal_terminal: { classes: BULK, maybe: ['cargo'] },
  forest_products_terminal: { classes: BULK, maybe: ['cargo'], groups: ['tug_tow'] },
  other_bulk_terminal: { classes: BULK, maybe: ['cargo'] },
  // migration 028 (scrubber-ship calls report, Josh 2026-10-07)
  cruise_terminal: { classes: ['cruise_ship', 'other_passenger'], unspecified: ['passenger'] },
  // A ship known only as "cargo" (AIS 70-79) fits these the way an unspecified tanker fits an oil dock: container, ro-ro and general
  // cargo berths are used by cargo ships only (2026-10-07: container ships at Deltaport / Centerm broadcast plain AIS 70).
  container_terminal: { classes: ['container_ship'], unspecified: ['cargo'] },
  roro_terminal: { classes: ['roro_cargo', 'vehicle_carrier'], unspecified: ['cargo'] },
  general_cargo_terminal: { classes: [...BULK, 'heavy_lift', 'reefer', 'container_ship', 'roro_cargo', 'vehicle_carrier'], unspecified: ['cargo'] },
}
/** The rule for a terminal (AIS visits and Climate TRACE port stays alike): its kind's, widened by the data file's own `ship_fit` (e.g. a mixed dry / liquid bulk terminal). */
export function fitRule(kind, override = null) {
  const base = SHIP_FIT[kind] || { classes: [] }
  if (!override) return base
  const u = (a, b) => [...new Set([...(a || []), ...(b || [])])]
  return { classes: u(base.classes, override.classes), unspecified: u(base.unspecified, override.unspecified), maybe: u(base.maybe, override.maybe),
    groups: u(base.groups, override.groups), tugNote: base.tugNote || override.tugNote || false }
}
/**
 * 'fits' | 'maybe' | 'other' | 'unknown' for one ship's classification { group, class } (pure).
 * unknown = no source states a kind (group unknown / null = sources disagree / a bare "other" with no class).
 */
export function shipFit(rule, cls) {
  const g = cls?.group ?? null, c = cls?.class ?? null
  if (!g || g === 'unknown' || (g === 'other' && (!c || c === 'other_unspecified'))) return 'unknown'
  if ((rule.classes || []).includes(c)) return 'fits'
  if ((rule.groups || []).includes(g)) return 'fits'
  if (c === `${g}_unspecified` && (rule.unspecified || []).includes(g)) return 'fits'
  if (c === `${g}_unspecified` && (rule.maybe || []).includes(g)) return 'maybe'
  return 'other'
}
/** Words for a rule, for the card's About text (pure). */
export function fitWords(rule) {
  const cls = (rule.classes || []).map((c) => labelOf(c)?.toLowerCase()).filter(Boolean)
  const uns = (rule.unspecified || []).map((g) => `${labelOf(g)?.toLowerCase()}s whose exact kind isn’t stated`)
  const grp = (rule.groups || []).map((g) => labelOf(g)?.toLowerCase())
  return [...cls, ...uns, ...grp]
}

// ── Classification of the ships in a list of visits ──────────────────────────

/** EarthAtlas classification (now) of each vessel id, from all its vessel_type claims (as its card). */
export async function classifyVessels(q, S, ids) {
  const out = new Map()
  if (!ids.length) return out
  const claims = await q(
    `SELECT va.vessel_id, va.attribute, va.source_id, va.evidence_class, va.value_raw, va.value_norm, va.detail, va.period_kind,
            lower(va.period) AS "from", upper(va.period) AS "to"
       FROM ${S}.vessel_assertions va WHERE va.attribute = 'vessel_type' AND va.vessel_id = ANY($1)`, [ids])
  const by = new Map()
  for (const c of claims) (by.get(c.vessel_id) || by.set(c.vessel_id, []).get(c.vessel_id)).push(c)
  const now = new Date().toISOString()
  for (const id of ids) {
    const cs = by.get(id) || []
    if (!cs.length) continue
    const c = classifyClaims(cs, { from: now, to: now, keepObserved: true })
    out.set(id, { group: c.group, class: c.class, label: c.classLabel && !String(c.class).endsWith('_unspecified') ? c.classLabel : c.groupLabel,
      basis: 'earthatlas', conflict: c.conflict, sources: [...new Set(cs.map((x) => x.source_id))].sort() })
  }
  return out
}
/** The kind used for one visit: EarthAtlas's classification when it states one, else the visit's GFW AIS type. Pure. */
export function visitKind(v, byVessel) {
  const e = v.vessel.vesselId ? byVessel.get(v.vessel.vesselId) : null
  // A stated kind; a bare "other" (or sources that disagree: group null) says nothing, so the visit's GFW type is tried.
  if (e && e.group && e.group !== 'unknown' && !(e.group === 'other' && (!e.class || e.class === 'other_unspecified'))) return e
  const g = fromGfwType(v.vessel.gfwType)
  return { group: g.group, class: g.class ?? (g.group && g.group !== 'unknown' ? `${g.group}_unspecified` : null),
    label: g.class ? labelOf(g.class) : g.group !== 'unknown' ? labelOf(g.group) : null, basis: 'gfw', gfwType: v.vessel.gfwType ?? null }
}

// ── Fetch: this terminal's GFW labels, every picked month (decision 2) ──────

const firstOf = (ym) => `${ym}-01`
const d10 = (x) => String(x instanceof Date ? x.toISOString() : x).slice(0, 10)
export const TERMINAL_DISCOVER_KM = 4 // same radius as a port's discovery (ports.js MATCH_KM: GFW groups anchorages within 4 km)
export const MAX_LABELS = 3
export const FETCH_CONCURRENCY = 3

async function terminalRow(q, S, key) {
  const [t] = await q(`SELECT id, key, name, kind, country, commodities, commodities_source_id, commodities_ref, operator, operator_source_url,
                              operator_checked, status, status_source_url, lat, lon, entry_source_record_id, detail, updated_at
                         FROM ${S}.terminals WHERE key = $1 AND list_status = 'listed'`, [key])
  return t || null
}

/**
 * Make sure every picked month of this terminal's GFW labels is stored. Labels = the GFW port labels whose anchorages lie
 * within REACH_KM of the terminal's berths (terminals.js terminalGfwLabels); when none is known yet, or the last look is
 * older than FULL_REFRESH_DAYS, one discovery call around the terminal finds them. A label-month counts as done when ANY
 * succeeded events fetch (a port card's or a terminal card's) covers it and is still good (portCard.js fetchIsFresh:
 * fresh for 24 h, and kept for good once the month had settled). Everything else is fetched, within the daily budget.
 * win = portCard.js parseCardWindow(). Returns { status, labels, discover, months: { fresh, fetched, failed, budget }, calls }.
 */
export async function ensureTerminalCard(pool, S, key, { win, gfw = null, now = new Date(), budget = DAILY_GFW_CALLS }) {
  const q = async (text, params) => (await pool.query(text, params)).rows
  const t = await terminalRow(q, S, key)
  if (!t) return { status: 'not_found' }
  const out = { status: 'ok', discover: 'none', labels: [], months: { fresh: 0, fetched: 0, failed: 0, budget: 0, no_gfw: 0 }, calls: 0 }
  let budgetLeft = gfw ? budget - (await gfwCallsToday(q, S)) : 0
  let runId = null
  const run = async () => {
    if (runId) return runId
    await withTx(pool, (c) => upsertSource(c, S, PORT_VISITS_SOURCE))
    runId = await withTx(pool, (c) => startRun(c, S, PORT_VISITS_SOURCE.id, { terminalCard: t.key, from: win.from, to: win.to }))
    return runId
  }
  let labels = await terminalGfwLabels(q, S, key)
  // 1. Discovery: once per FULL_REFRESH_DAYS per terminal (for the latest picked month).
  const [lastDisc] = await q(`SELECT finished_at FROM ${S}.port_card_fetches WHERE terminal_id = $1 AND kind = 'discover' AND status = 'succeeded'
                                ORDER BY finished_at DESC LIMIT 1`, [t.id])
  if (lastDisc && now - new Date(lastDisc.finished_at) < FULL_REFRESH_DAYS * 864e5) out.discover = 'fresh'
  else if (!gfw) out.discover = 'no_gfw'
  else if (budgetLeft < 1) out.discover = 'budget'
  else {
    try {
      const m = win.months[win.months.length - 1]
      const r = await discover(pool, S, { port: { id: null, lat: t.lat, lon: t.lon }, terminalId: t.id, radiusKm: TERMINAL_DISCOVER_KM,
        win: { monthFrom: firstOf(m), monthTo: capDay(firstOf(nextMonth(m)), now) }, gfw, runId: await run() })
      out.calls += r.calls; budgetLeft -= r.calls; out.discover = 'fetched'
      labels = await terminalGfwLabels(q, S, key)
    } catch (e) { console.error('ships terminal discover', key, e.message); out.discover = 'failed' }
  }
  labels = labels.slice(0, MAX_LABELS)
  out.labels = labels.map((l) => l.label)
  if (!labels.length) return finish()
  // Which of our ports each label is, when that port has exactly this one label (then its port card reuses the fetch).
  const al = await q(`SELECT a.key, a.port_id, (SELECT array_agg(b.key ORDER BY b.key) FROM ${S}.port_aliases b
                              WHERE b.port_id = a.port_id AND b.key_kind = 'gfw_port_label' AND b.status = 'accepted') AS port_labels
                        FROM ${S}.port_aliases a WHERE a.key_kind = 'gfw_port_label' AND a.status = 'accepted' AND a.key = ANY($1)`, [out.labels])
  const portFor = new Map(al.filter((a) => a.port_labels?.length === 1).map((a) => [a.key, a.port_id]))
  // 2. What the log already covers.
  const monthFroms = win.months.map(firstOf)
  const done = await q(`SELECT port_labels, range_from, range_to, status, finished_at, complete FROM ${S}.port_card_fetches
                         WHERE kind = 'events' AND status = 'succeeded' AND port_labels && $1::text[] AND range_from = ANY($2::date[])`,
    [out.labels, monthFroms])
  const tasks = []
  for (const l of out.labels) {
    for (const m of win.months) {
      const good = done.some((r) => r.port_labels.includes(l) && d10(r.range_from) === firstOf(m) && fetchIsFresh(r, now))
      if (good) { out.months.fresh++; continue }
      tasks.push({ label: l, month: m })
    }
  }
  // 3. Fetch the rest, a few at a time, never past the budget (one month can take EVENT_PAGES + 1 calls).
  const queue = [...tasks]
  const worker = async () => {
    while (queue.length) {
      const { label, month } = queue.shift()
      if (!gfw) { out.months.no_gfw++; continue }
      if (budgetLeft < EVENT_PAGES + 1) { out.months.budget++; continue }
      budgetLeft -= EVENT_PAGES + 1 // reserve; the unused part is given back
      try {
        const r = await fetchMonthEvents(pool, S, { port: { id: portFor.get(label) ?? null }, terminalId: t.id, labels: [label], gfw, runId: await run(),
          win: { monthFrom: firstOf(month), monthTo: capDay(firstOf(nextMonth(month)), now) } })
        out.calls += r.calls; budgetLeft += EVENT_PAGES + 1 - r.calls; out.months.fetched++
      } catch (e) { budgetLeft += EVENT_PAGES + 1; console.error('ships terminal events', key, label, month, e.message); out.months.failed++ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, worker))
  return finish()

  async function finish() {
    if (runId) {
      const failed = out.discover === 'failed' || out.months.failed > 0
      await withTx(pool, (c) => finishRun(c, S, runId, { status: failed ? 'failed' : 'succeeded', stats: out })).catch(() => {})
    }
    return out
  }
}
const capDay = (d, now) => {
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10)
  return d > tomorrow ? tomorrow : d
}

// ── Read (no network) ────────────────────────────────────────────────────────

const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d))

/** The kind used for one AIS call: EarthAtlas's classification when it states one, else the type the ship broadcast. Pure. */
export function callKind(call, byVessel) {
  const e = call.vesselId ? byVessel.get(call.vesselId) : null
  if (e && e.group && e.group !== 'unknown' && !(e.group === 'other' && (!e.class || e.class === 'other_unspecified'))) return e
  const g = fromAisCode(call.ais_vessel_type)
  return { group: g.group, class: g.class ?? (g.group && g.group !== 'unknown' ? `${g.group}_unspecified` : null),
    label: g.class ? labelOf(g.class) : g.group !== 'unknown' ? labelOf(g.group) : null, basis: 'ais', aisType: call.ais_vessel_type ?? null }
}

/**
 * The stored AIS calls (terminal_calls, migration 016) at one terminal in the picked window, each with the EarthAtlas ship
 * that held the MMSI at the call's start (vessels_for_mmsi_at: 1 = resolved, >1 = ambiguous, never guessed).
 * Returns { bake, notCovered, months: { covered, missing }, calls }.
 */
export async function terminalAisCalls(q, S, t, win) {
  const [bake] = await q(`SELECT bake_version, months, not_covered, rule, bake_record_id, imported_at FROM ${S}.terminal_call_bakes WHERE bake_version = $1`, [BAKE_VERSION])
  if (!bake) return { bake: null, notCovered: false, months: { covered: [], missing: win.months }, calls: [] }
  const notCovered = (bake.not_covered || []).includes(t.key)
  const months = notCovered ? { covered: [], missing: win.months } : coveredMonths(win.months, bake.months)
  const calls = notCovered || !months.covered.length ? [] : await q(
    `SELECT c.id, c.berth_key, c.mmsi, c.t0, c.t1, c.n_points, c.min_m, c.radius_m, c.also_near, c.ambiguous_points,
            c.ais_name, c.ais_imo, c.ais_vessel_type, c.ais_length, c.bake_record_id
       FROM ${S}.terminal_calls c
      WHERE c.bake_version = $1 AND c.terminal_id = $2 AND c.t0 >= $3::date AND c.t0 < $4::date AND to_char(c.t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($5)
      ORDER BY c.t0`, [BAKE_VERSION, t.id, win.from, win.to, months.covered])
  if (calls.length) {
    const res = await q(
      `SELECT x.i, array_agg(DISTINCT v.vessel_id) AS vessel_ids
         FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS x(i, mmsi, at)
         CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
      [calls.map((_, i) => i), calls.map((c) => c.mmsi), calls.map((c) => iso(c.t0))])
    for (const r of res) {
      const c = calls[r.i]
      if (r.vessel_ids.length === 1) c.vesselId = r.vessel_ids[0]
      else c.ambiguousVessels = r.vessel_ids.length
    }
  }
  return { bake, notCovered, months, calls }
}

/**
 * Everything the terminal card (and, with summaryOnly, the map popup) shows, from the database only (no GFW call).
 * win = parseCardWindow(). Visits = our own AIS calls (terminalCalls.js rule) in the months the AIS bake covers, split by
 * decision 1 into fits / maybe / other / unknown kind. Global Fishing Watch port visits matched to the terminal are kept as
 * secondary evidence (`gfw`), never counted.
 */
export async function readTerminalCard(q, S, key, { win, summaryOnly = false }) {
  const t = await terminalRow(q, S, key)
  if (!t) return null
  const ais = await terminalAisCalls(q, S, t, win)
  const vesselIds = [...new Set(ais.calls.map((c) => c.vesselId).filter(Boolean))]
  const byVessel = await classifyVessels(q, S, vesselIds)
  const rule = fitRule(t.kind, t.detail?.ship_fit)
  const rows = ais.calls.map((c) => {
    let k = callKind(c, byVessel)
    const fit = shipFit(rule, k)
    // Josh 2026-09-28: a tug at an oil or fuel dock counts, labelled for what it most likely is doing.
    if (fit === 'fits' && rule.tugNote && k.group === 'tug_tow') k = { ...k, label: `${k.label || 'Tug'} (likely moving a barge)`, tug: true }
    return { c, k, fit }
  })
  const part = (fit) => rows.filter((r) => r.fit === fit)
  const fits = part('fits'), maybe = part('maybe'), other = part('other'), unknown = part('unknown')
  const shipKey = (c) => c.vesselId || `mmsi:${c.mmsi}`
  const ships = (rs) => new Set(rs.map((r) => shipKey(r.c))).size
  const covered = new Set(ais.months.covered)
  const perMonth = win.months.map((m) => ({ month: m, n: covered.has(m) ? fits.filter((r) => iso(r.c.t0).slice(0, 7) === m).length : null }))
  const last = fits.length ? iso(fits[fits.length - 1].c.t0) : null
  const summary = {
    visits: fits.length, ships: ships(fits), lastAt: last,
    oneOf: fits.filter((r) => r.c.also_near?.length).length, tugs: fits.filter((r) => r.k.tug).length,
    hours: Math.round(fits.reduce((h, r) => h + (new Date(r.c.t1) - new Date(r.c.t0)) / 3600e3, 0)),
    maybe: { visits: maybe.length, ships: ships(maybe) }, other: { visits: other.length, ships: ships(other) },
    unknown: { visits: unknown.length, ships: ships(unknown) },
    months: perMonth,
    // By day when one or two months are picked (Josh 2026-10-07); null = no AIS that day (month not covered).
    days: win.months.length <= 2 ? daysOf(win.months).map((d) => ({ day: d, n: covered.has(d.slice(0, 7)) ? fits.filter((r) => iso(r.c.t0).slice(0, 10) === d).length : null })) : null,
  }
  const gfw = await gfwComparison(q, S, key, win)
  // Months NOAA's AIS doesn't cover: visits estimated from GFW hourly positions, kept apart (lib/ships/activityEstimates.js).
  const estimated = await readTerminalEstimates(q, S, t, win, { covered: ais.months.covered, notCovered: ais.notCovered,
    deps: { fitRule, shipFit, classifyVessels, fromGfwType } })
  const bakeInfo = ais.bake ? { version: ais.bake.bake_version, recordId: Number(ais.bake.bake_record_id), importedAt: iso(ais.bake.imported_at),
    months: ais.bake.months } : null
  // Each berth's radius as the bake used it (the bake record lists every berth, with or without calls).
  const radii = ais.bake ? await q(`SELECT b->>'berth' AS berth_key, (b->>'radius_m')::int AS radius_m FROM ${S}.source_records sr, jsonb_array_elements(sr.payload->'berths') b
                                     WHERE sr.id = $1 AND b->>'terminal' = $2 ORDER BY 1`, [ais.bake.bake_record_id, t.key]) : []
  const base = { terminal: publicTerminal(t), window: win, summary,
    coverage: { source: 'ais', notCovered: ais.notCovered, months: ais.months.covered, missing: ais.months.missing, of: win.months.length, bake: bakeInfo,
      aisFrom: ais.bake?.months?.length ? [...ais.bake.months].sort()[0] : COVERAGE.from,
      aisTo: ais.bake?.months?.length ? [...ais.bake.months].sort().pop() : COVERAGE.to },
    rule: { ...CALL_RULE, fits: fitWords(rule), maybe: (rule.maybe || []).map((g) => labelOf(g)?.toLowerCase()),
      radii: radii.map((r) => ({ berth: r.berth_key, m: r.radius_m })) },
    gfw, estimated }
  if (summaryOnly) return base

  const allKeys = [...new Set(rows.flatMap((r) => r.c.also_near || []))]
  const names = allKeys.length ? new Map((await q(`SELECT key, name FROM ${S}.terminals WHERE key = ANY($1)`, [allKeys])).map((r) => [r.key, r.name])) : new Map()
  const group = (rs) => {
    const m = new Map()
    for (const { c, k } of rs) {
      const id = shipKey(c)
      const s = m.get(id) || { key: id, vesselId: c.vesselId || null, ambiguousVessels: c.ambiguousVessels || 0, name: c.ais_name, mmsi: c.mmsi,
        kind: k.label, kindBasis: k.basis, kindSources: k.sources || null, aisType: c.ais_vessel_type, aisLength: c.ais_length, visits: 0, hours: 0,
        oneOf: 0, oneOfNames: new Set(), lastAt: null, nearestM: Infinity, bakeRecordId: Number(c.bake_record_id) }
      s.visits++
      s.hours += (new Date(c.t1) - new Date(c.t0)) / 3600e3
      if (c.also_near?.length) { s.oneOf++; for (const o of c.also_near) s.oneOfNames.add(names.get(o) || o) }
      s.nearestM = Math.min(s.nearestM, Number(c.min_m))
      const t0 = iso(c.t0)
      if (!s.lastAt || t0 > s.lastAt) { s.lastAt = t0; s.name = c.ais_name || s.name }
      m.set(id, s)
    }
    return [...m.values()].map((s) => ({ ...s, hours: Math.round(s.hours * 10) / 10, oneOfNames: [...s.oneOfNames].sort(),
      nearestM: Number.isFinite(s.nearestM) ? Math.round(s.nearestM) : null }))
      .sort((a, b) => b.visits - a.visits || String(b.lastAt).localeCompare(String(a.lastAt)))
  }
  const kinds = (rs) => {
    const m = new Map()
    for (const { k } of rs) { const l = k.label || 'kind not stated'; m.set(l, (m.get(l) || 0) + 1) }
    return [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n)
  }
  return { ...base, ships: group(fits), maybe: { ships: group(maybe).slice(0, 60) }, other: { ships: group(other).slice(0, 60), kinds: kinds(other) },
    unknown: { ships: group(unknown).slice(0, 60) }, ...(await terminalDetail(q, S, t)) }
}

/**
 * Global Fishing Watch port visits whose stops match this terminal (terminals.js rule), stored ones only, all kinds of ship:
 * kept on the card as a comparison, never counted (GFW logs a visit against a whole port area). Read-only.
 */
async function gfwComparison(q, S, key, win) {
  const tv = await terminalVisits(q, S, key, { from: win.from, to: win.to, all: true })
  const visits = tv?.visits || []
  const lab = (await terminalGfwLabels(q, S, key)).slice(0, MAX_LABELS).map((l) => l.label)
  const logged = lab.length ? await q(
    `SELECT DISTINCT unnest(port_labels) AS label, to_char(range_from, 'YYYY-MM') AS month FROM ${S}.port_card_fetches
      WHERE kind = 'events' AND status = 'succeeded' AND port_labels && $1::text[] AND range_from = ANY($2::date[])`,
    [lab, win.months.map(firstOf)]) : []
  const checked = win.months.filter((m) => lab.length > 0 && lab.every((l) => logged.some((r) => r.label === l && r.month === m)))
  return { visits: visits.length, ships: new Set(visits.map((v) => v.vessel.gfwId)).size, labels: lab, monthsChecked: checked.length, matchKm: MATCH_KM }
}

function publicTerminal(t) {
  const d = t.detail || {}
  return { key: t.key, name: t.name, kind: t.kind, country: t.country, commodities: t.commodities, commoditiesSource: t.commodities_source_id,
    commoditiesRef: t.commodities_ref, commoditiesHistory: d.commodities_history || [], operator: t.operator, operatorSourceUrl: t.operator_source_url,
    operatorChecked: iso(t.operator_checked)?.slice(0, 10) ?? null, operatorNote: d.operator_note ?? null,
    status: t.status, statusSourceUrl: t.status_source_url, statusDate: d.status_date ?? null, statusNote: d.status_note ?? null,
    lat: t.lat, lon: t.lon, entryRecordId: t.entry_source_record_id, notes: d.notes || [], shipFit: d.ship_fit ?? null,
    officialBerths: d.official_berths || [], officialDockFacts: d.official_dock_facts || [] }
}

/** Berths (with their source records), links (with records), and the licences of every source they touch. */
async function terminalDetail(q, S, t) {
  const berths = await q(`SELECT berth_key AS key, name, lat, lon, basis, source_id, source_record_ids, odbl, detail
                            FROM ${S}.terminal_berths WHERE terminal_id = $1 AND status = 'active' ORDER BY berth_key`, [t.id])
  const links = await q(`SELECT role, source_id, entity_key, source_record_id, detail FROM ${S}.terminal_links
                          WHERE terminal_id = $1 AND status = 'active' ORDER BY role, entity_key`, [t.id])
  const d = t.detail || {}
  const official = [...(d.official_berths || []).flatMap((o) => o.facts || []), ...(d.official_dock_facts || [])].map((f) => f.source)
  const ids = [...new Set([...berths.map((b) => b.source_id), ...links.map((l) => l.source_id), ...official, 'earthatlas-terminals', TERMINAL_CALLS_SOURCE.id, 'marinecadastre-ais', PORT_VISITS_SOURCE.id,
    ...(t.commodities_source_id ? [t.commodities_source_id] : [])])]
  const sources = await q(`SELECT id, name, publisher, homepage_url, license, license_url, commercial_use, attribution_text, attribution_url, notes
                             FROM ${S}.sources WHERE id = ANY($1)`, [ids])
  // Record ids of the rows the commodity list and the history lines were read from (same source + key as a link/berth).
  return { berths: berths.map((b) => ({ ...b, source_record_ids: (b.source_record_ids || []).map(Number) })),
    links: links.map((l) => ({ ...l, source_record_id: l.source_record_id == null ? null : Number(l.source_record_id) })), sources }
}

// ── Emissions (Climate TRACE ids the terminal lists) ─────────────────────────

/**
 * part 'ships' → the Climate TRACE ship-port sources the list links (voyage emissions assigned to that port);
 * part 'refinery' → the Climate TRACE refinery plant(s) (the plant's own emissions). Same shape as op=portEmissions'
 * `joined` so the card reuses PortEmissions.jsx: [{ id, name, sub, record_id, km }].
 */
export async function terminalEmissions(q, S, key, part) {
  const t = await terminalRow(q, S, key)
  if (!t) return null
  const role = part === 'refinery' ? 'ct_refinery' : 'ct_ship_port'
  const rows = await q(`SELECT l.entity_key, l.source_record_id, sr.payload FROM ${S}.terminal_links l
                          LEFT JOIN ${S}.source_records sr ON sr.id = l.source_record_id
                         WHERE l.terminal_id = $1 AND l.status = 'active' AND l.role = $2 ORDER BY l.entity_key`, [t.id, role])
  const joined = rows.map((r) => {
    const p = r.payload || {}
    const km = Number.isFinite(p.lat) ? Math.round(haversineKm(t.lat, t.lon, p.lat, p.lon) * 10) / 10 : null
    return { id: Number(r.entity_key), name: p.name ?? null, sub: p.sub ?? (part === 'refinery' ? 'oil-and-gas-refining' : null),
      record_id: r.source_record_id == null ? null : Number(r.source_record_id), km, confidence: p.confidence ?? null, owner: p.owner ?? null, capacity: p.capacity ?? null }
  })
  return { terminal: { key: t.key, name: t.name }, part, joined }
}

// ── Climate TRACE port stays placed at this terminal (ctStays.js, migration 018; Josh 2026-09-29) ──

const CT_GAS_COLS = { co2: 'co2', ch4: 'ch4', n2o: 'n2o', pm2_5: 'pm2_5', so2: 'sox', nox: 'nox', co: 'co' }
const ymOf = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 7)

/**
 * The Climate TRACE port stays the ctStays.js rule placed at this terminal, for the picked months (by the month each stay
 * began), split by decision 1 (Climate TRACE's ship type → shipFit, the same fitRule as the AIS visits): `fits` is the terminal's figure; `other` / `unknown`
 * kinds are totalled apart, never added in. Months outside the pull's start dates are "missing", not zero; a terminal
 * outside the pull's area is notCovered. Every figure is Climate TRACE's own (tonnes), summed. win = parseCardWindow().
 */
export async function terminalCtStays(q, S, key, win) {
  const t = await terminalRow(q, S, key)
  if (!t) return null
  const [bake] = await q(
    `SELECT sr.id, sr.payload->>'release' AS release, sr.payload->'startDates' AS dates, sr.payload->'notCovered' AS not_covered,
            sr.payload->'written' AS written, sr.payload->'pullBox' AS box, sr.payload->>'pulled' AS pulled
       FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
      WHERE se.source_id = $1 AND se.entity_kind = 'ct_stay_bake' AND se.entity_key = $2
      ORDER BY sr.last_retrieved_at DESC, sr.id DESC LIMIT 1`, [CT_VOYAGES_SOURCE.id, CT_STAYS_VERSION])
  const base = { terminal: { key: t.key, name: t.name }, version: CT_STAYS_VERSION, rule: CT_STAY_RULE, window: { months: win.months } }
  if (!bake) return { ...base, state: 'not_loaded' }
  const bakeInfo = { recordId: Number(bake.id), release: bake.release, pulled: bake.pulled, startDates: bake.dates, box: bake.box }
  if ((bake.not_covered || []).includes(t.key)) return { ...base, state: 'not_covered', bake: bakeInfo }
  if (Array.isArray(bake.written) && !bake.written.includes(t.key)) return { ...base, state: 'not_loaded', bake: bakeInfo }
  const lo = String(bake.dates?.from || '').slice(0, 7), hi = String(bake.dates?.to || '').slice(0, 7)
  const covered = win.months.filter((m) => m >= lo && m <= hi), missing = win.months.filter((m) => !covered.includes(m))
  const rows = covered.length ? await q(
    `SELECT asset_identifier, ship_name, ct_type, t0, t1, km, co2e_100yr, co2, ch4, n2o, sox, nox, pm2_5, co
       FROM ${S}.terminal_ct_stays
      WHERE bake_version = $1 AND terminal_id = $2 AND to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($3) ORDER BY t0`,
    [CT_STAYS_VERSION, t.id, covered]) : []
  const rule = fitRule(t.kind, t.detail?.ship_fit)
  const parts = { fits: [], maybe: [], other: [], unknown: [] }
  for (const r of rows) {
    const k = fromCtType(r.ct_type, r.asset_identifier)
    parts[shipFit(rule, k)].push({ ...r, kind: k })
  }
  const sum = (rs, col) => rs.reduce((a, r) => a + (r[col] == null ? 0 : Number(r[col])), 0)
  const coveredSet = new Set(covered)
  const group = (rs) => {
    const gas = {}
    for (const [g, col] of Object.entries(CT_GAS_COLS)) if (rs.some((r) => r[col] != null)) gas[g] = sum(rs, col)
    const trackers = {}
    for (const r of rs) { const tr = trackerOf(r.asset_identifier)?.id || 'other'; trackers[tr] = (trackers[tr] || 0) + 1 }
    const kinds = new Map()
    for (const r of rs) { const l = r.ct_type || 'type not stated'; kinds.set(l, (kinds.get(l) || 0) + 1) }
    return { stays: rs.length, ships: new Set(rs.map((r) => r.asset_identifier)).size, co2e: sum(rs, 'co2e_100yr'), gas, trackers,
      hours: Math.round(rs.reduce((h, r) => h + (new Date(r.t1) - new Date(r.t0)) / 3600e3, 0)),
      types: [...kinds].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n),
      perMonth: win.months.map((m) => { const x = rs.filter((r) => ymOf(r.t0) === m); return { month: m, n: coveredSet.has(m) ? (x.length ? sum(x, 'co2e_100yr') : 0) : null } }),
      // One or two months: per day too, like the Ships tab's calls (Josh 2026-10-07), by the day each stay began.
      perDay: win.months.length <= 2 ? daysOf(win.months).map((d) => {
        const x = rs.filter((r) => iso(r.t0).slice(0, 10) === d)
        return { day: d, n: coveredSet.has(d.slice(0, 7)) ? (x.length ? sum(x, 'co2e_100yr') : 0) : null }
      }) : null }
  }
  const top = [...parts.fits].sort((a, b) => Number(b.co2e_100yr ?? 0) - Number(a.co2e_100yr ?? 0)).slice(0, 5)
    .map((r) => ({ id: r.asset_identifier, name: r.ship_name, type: r.ct_type, t0: iso(r.t0), t1: iso(r.t1), co2e: r.co2e_100yr == null ? null : Number(r.co2e_100yr) }))
  return { ...base, state: 'ok', bake: bakeInfo, months: { covered, missing }, fits: group(parts.fits), top,
    maybe: group(parts.maybe), other: group(parts.other), unknown: group(parts.unknown), fitWords: fitWords(rule) }
}

// ── The map layer ─────────────────────────────────────────────────────────────

/** Every listed terminal as a compact GeoJSON FeatureCollection: k key, n name, t kind, s status. */
export async function terminalsLayer(q, S) {
  const rows = await q(`SELECT key, name, kind, status, lat, lon FROM ${S}.terminals WHERE list_status = 'listed' AND lat IS NOT NULL ORDER BY key`)
  const r5 = (x) => Math.round(Number(x) * 1e5) / 1e5
  return { type: 'FeatureCollection', features: rows.map((t) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r5(t.lon), r5(t.lat)] },
    properties: { k: t.key, n: t.name, t: t.kind, s: t.status || 'unknown' } })) }
}

export { REACH_KM, allBerths }
