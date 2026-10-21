/**
 * Likely bunkering at anchorages, counted from EarthAtlas's own AIS positions (Josh 2026-10-18; Lovel's question about Port
 * Angeles, Vendovi and other anchorages). Rules: src/ships/CLAUDE.md.
 *
 *   evidence        MarineCadastre AIS daily points (CC0), the salish-v6 cache of scripts/ships/bake-ais/fetch_points.py.
 *                   Positions never go in Postgres.
 *   derived         scripts/ships/bake-ais/bunker_events.py pairs a tug / towing vessel or small tanker with an anchored large
 *                   ship (BUNKER_RULE); scripts/ships/bunker-events.mjs joins events cut at midnight (mergeAcrossDays) and
 *                   stores them in bunker_events (migration 036), evidence class 'inferred'.
 *   interpretation  read time only: which EarthAtlas ships held the two MMSIs at t0 (vessels_for_mmsi_at) and their kinds;
 *                   an event whose receiver EarthAtlas classifies as a ferry is left out (ferries are fueled at their docks).
 *
 * The rule (BUNKER_RULE, bunker_events.py RULE): a bunker barge carries no AIS of its own, so a fueling shows as its tug lying
 * right beside the ship. Receiver = AIS type 60–89 (passenger, cargo, tanker), >= 100 m, under 1 kn, inside an anchorage polygon,
 * or reporting AIS status "at anchor" more than 400 m from any terminal berth (then filed under the nearest anchorage that is
 * not a tug-and-barge holding area, marked outside). Supplier = AIS type 31 / 32 / 52 (towing, tug) or a tanker under 100 m,
 * at least 15 m long (launches bring crew and stores), not a US Navy harbor tug (YT…), under 1 kn, within 200 m of the receiver
 * at the same minute (positions paired within 90 s). Paired minutes of one receiver + supplier at one anchorage, split where
 * they stop for more than 15 minutes, count when they span at least 60 minutes. A tug can also lie alongside an anchored ship
 * for other reasons (an escort standing by, a repair, stores), so every count is "likely bunkering", never a confirmed transfer.
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { MC_SOURCE } from './marinecadastre.js'
import { coveredMonths } from './terminalCalls.js'
import { classifyVessels, callKind } from './terminalCard.js'
import { anchorageKey } from './anchorageStays.js'

export const BUNKER_BAKE_VERSION = 'be4'
export const BUNKER_RULE = Object.freeze({ sogKn: 1, receiverMinLen: 100, nearM: 200, pairS: 90, gapMin: 15, minMinutes: 60,
  supplierMinLen: 15, berthClearM: 400, nearestAnchorageKm: 6 })

export const BUNKER_EVENTS_SOURCE = {
  id: 'earthatlas-bunker-events',
  name: 'EarthAtlas likely bunkering at anchorages (derived from MarineCadastre AIS)',
  publisher: 'EarthAtlas, from NOAA Office for Coastal Management / BOEM MarineCadastre AIS (U.S. Coast Guard receivers)',
  homepage_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  license: 'CC0 1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_use: true,
  attribution_text: 'MarineCadastre AIS (NOAA / BOEM / USCG), likely bunkering derived by EarthAtlas',
  attribution_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  notes: 'Derived dataset, evidence class inferred: an EarthAtlas rule applied to AIS self-reported positions. A likely bunkering = '
    + 'a tug, towing vessel or small tanker (>= 15 m, not a US Navy harbor tug) within 200 m of a large ship (AIS type 60-89, '
    + '>= 100 m) anchored at an anchorage (inside its polygon, or reporting "at anchor" > 400 m from any terminal berth), both under '
    + '1 kn, for at least 60 minutes; paired minutes split where they stop for > 15 minutes. A bunker barge has no AIS, so its tug '
    + 'stands for it. Not a confirmed transfer: Washington Ecology records transfers (advance notice of transfer), which are not '
    + 'published per transfer. Input: MarineCadastre daily points (CC0 1.0), US terrestrial receivers, box W -126.2 S 47 E -122.05 N 49.6.',
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

const ms = (t) => new Date(t).getTime()

/**
 * Join events of the same anchorage + receiver + supplier that the day files cut at midnight (or that a short break split):
 * consecutive events less than gapMin apart become one (paired minutes summed, closest distance kept). Then drop any that
 * still span less than minMinutes. Pure; events = bunker_events.py export rows ({ anchorage, receiver, supplier, t0, t1, ... }).
 */
export function mergeAcrossDays(events, rule = BUNKER_RULE) {
  const key = (e) => `${e.anchorage}~${e.receiver}~${e.supplier}`
  const sorted = [...events].sort((a, b) => key(a).localeCompare(key(b)) || ms(a.t0) - ms(b.t0))
  const out = []
  for (const e of sorted) {
    const last = out[out.length - 1]
    if (last && key(last) === key(e) && ms(e.t0) - ms(last.t1) <= rule.gapMin * 60e3) {
      last.t1 = ms(e.t1) > ms(last.t1) ? e.t1 : last.t1
      last.minutes = Number(last.minutes) + Number(e.minutes)
      last.min_m = Math.min(Number(last.min_m), Number(e.min_m))
      last.inside = !!(last.inside || e.inside)
    } else out.push({ ...e, minutes: Number(e.minutes), min_m: Number(e.min_m), median_m: Number(e.median_m) })
  }
  return out.filter((e) => ms(e.t1) - ms(e.t0) >= rule.minMinutes * 60e3)
}

// ── Store ────────────────────────────────────────────────────────────────────

/** Replace the version's events for `months` (or all), and record the bake. events = mergeAcrossDays() rows. */
export async function storeBunkerEvents(c, S, { events, bake, runId = null, version = BUNKER_BAKE_VERSION, months = null }) {
  await upsertSource(c, S, MC_SOURCE)
  await upsertSource(c, S, BUNKER_EVENTS_SOURCE)
  const byKey = new Map((bake.anchorages || []).map((a) => [a.key, a]))
  const unknown = [...new Set(events.filter((e) => !byKey.has(e.anchorage)).map((e) => e.anchorage))]
  if (unknown.length) throw new Error(`events for anchorages not in the bake: ${unknown.join(', ')}`)
  const ent = await findOrCreateEntity(c, S, { sourceId: BUNKER_EVENTS_SOURCE.id, kind: 'bunker_event_bake', anchor: version })
  const payload = { method: BUNKER_EVENTS_SOURCE.notes, bake_version: version, rule: bake.rule, days: bake.days, events: events.length,
    anchorages: [...new Set(events.map((e) => e.anchorage))].map((k) => ({ key: k, name: byKey.get(k)?.name ?? null })) }
  const rec = await upsertRecord(c, S, { sourceId: BUNKER_EVENTS_SOURCE.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: null, runId })
  if (months) {
    const off = events.filter((x) => !months.includes(new Date(x.t0).toISOString().slice(0, 7)))
    if (off.length) throw new Error(`${off.length} events fall outside ${months.join(', ')}`)
    await c.query(`DELETE FROM ${S}.bunker_events WHERE bake_version = $1 AND to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($2)`, [version, months])
  } else await c.query(`DELETE FROM ${S}.bunker_events WHERE bake_version = $1`, [version])
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))
  const str = (v) => (v === '' || v == null ? null : String(v))
  for (let i = 0; i < events.length; i += 1000) {
    const b = events.slice(i, i + 1000)
    const a = (e) => byKey.get(e.anchorage)
    await c.query(
      `INSERT INTO ${S}.bunker_events (bake_version, anchorage_source_id, anchorage_source_key, outside, receiver_mmsi, supplier_mmsi,
              t0, t1, paired_minutes, min_m, median_m, r_name, r_imo, r_type, r_length, s_name, s_imo, s_type, s_length, bake_record_id)
       SELECT $1, x.asrc, x.akey, x.outside, x.rm, x.sm, x.t0, x.t1, x.n, x.mn, x.md, x.rn, x.ri, x.rt, x.rl, x.sn, x.si, x.st, x.sl, $2
         FROM unnest($3::text[], $4::text[], $5::boolean[], $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[], $10::int[],
                     $11::real[], $12::real[], $13::text[], $14::text[], $15::int[], $16::real[], $17::text[], $18::text[], $19::int[], $20::real[])
              AS x(asrc, akey, outside, rm, sm, t0, t1, n, mn, md, rn, ri, rt, rl, sn, si, st, sl)
       ON CONFLICT DO NOTHING`,
      [version, rec.id, b.map((e) => a(e).source_id), b.map((e) => a(e).source_key), b.map((e) => !(e.inside === true || e.inside === 'true')),
        b.map((e) => String(e.receiver)), b.map((e) => String(e.supplier)), b.map((e) => new Date(e.t0).toISOString()), b.map((e) => new Date(e.t1).toISOString()),
        b.map((e) => Math.round(Number(e.minutes))), b.map((e) => num(e.min_m)), b.map((e) => num(e.median_m)),
        b.map((e) => str(e.r_name)), b.map((e) => str(e.r_imo)), b.map((e) => num(e.r_type)), b.map((e) => num(e.r_len)),
        b.map((e) => str(e.s_name)), b.map((e) => str(e.s_imo)), b.map((e) => num(e.s_type)), b.map((e) => num(e.s_len))])
  }
  await c.query(`INSERT INTO ${S}.bunker_event_bakes (bake_version, source_id, bake_record_id, months, rule, imported_at)
                 VALUES ($1, $2, $3, $4, $5, now())
                 ON CONFLICT (bake_version) DO UPDATE SET bake_record_id = EXCLUDED.bake_record_id,
                   months = ARRAY(SELECT DISTINCT unnest(${S}.bunker_event_bakes.months || EXCLUDED.months) ORDER BY 1),
                   rule = EXCLUDED.rule, imported_at = now()`,
    [version, BUNKER_EVENTS_SOURCE.id, rec.id, bake.months || [], bake.rule || BUNKER_RULE])
  return { recordId: rec.id, events: events.length }
}

// ── Read (no network) ────────────────────────────────────────────────────────

const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d))

/**
 * Likely bunkering at one anchorage in the picked months, for its card:
 * { coverage: 'covered' | 'not_loaded', bake, rule, months: { covered, missing }, summary: { events, ships, suppliers, perMonth },
 *   events: [{ t0, t1, hours, outside, receiver: { mmsi, vesselId, name, kind }, supplier: { mmsi, vesselId, name, kind } }],
 *   suppliers: [{ name, vesselId, events }] }. win = portCard.js parseCardWindow().
 */
export async function readAnchorageBunkering(q, S, a, win, { counted = null } = {}) {
  const base = { rule: BUNKER_RULE }
  let bake
  try {
    [bake] = await q(`SELECT bake_version, months, rule, bake_record_id, imported_at FROM ${S}.bunker_event_bakes WHERE bake_version = $1`, [BUNKER_BAKE_VERSION])
  } catch (e) {
    if (e?.code === '42P01') return { ...base, coverage: 'not_loaded' } // before migration 036
    throw e
  }
  if (!bake) return { ...base, coverage: 'not_loaded' }
  const bakeInfo = { version: bake.bake_version, recordId: Number(bake.bake_record_id), importedAt: iso(bake.imported_at), months: bake.months }
  const months = coveredMonths(win.months, bake.months)
  const rows = months.covered.length ? await q(
    `SELECT receiver_mmsi, supplier_mmsi, t0, t1, outside, paired_minutes, min_m, r_name, r_type, r_length, s_name, s_type, s_length
       FROM ${S}.bunker_events
      WHERE bake_version = $1 AND anchorage_source_id = $2 AND anchorage_source_key = $3
        AND to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($4) ORDER BY t0`,
    [BUNKER_BAKE_VERSION, a.source_id, a.source_key, months.covered]) : []
  const resolve = async (col) => {
    if (!rows.length) return
    const res = await q(
      `SELECT x.i, array_agg(DISTINCT v.vessel_id) AS ids
         FROM unnest($1::int[], $2::text[], $3::timestamptz[]) AS x(i, mmsi, at)
         CROSS JOIN LATERAL ${S}.vessels_for_mmsi_at(x.mmsi, x.at) v GROUP BY 1`,
      [rows.map((_, i) => i), rows.map((r) => r[col]), rows.map((r) => iso(r.t0))])
    for (const r of res) if (r.ids.length === 1) rows[r.i][`${col}_vessel`] = r.ids[0]
  }
  await resolve('receiver_mmsi')
  await resolve('supplier_mmsi')
  const byVessel = await classifyVessels(q, S, [...new Set(rows.flatMap((r) => [r.receiver_mmsi_vessel, r.supplier_mmsi_vessel]).filter(Boolean))])
  const kindOf = (vid, type) => callKind({ vesselId: vid, ais_vessel_type: type }, byVessel)
  const evs = rows.map((r) => ({
    t0: iso(r.t0), t1: iso(r.t1), hours: Math.round(((new Date(r.t1) - new Date(r.t0)) / 3600e3) * 10) / 10, outside: r.outside,
    minM: r.min_m == null ? null : Math.round(r.min_m),
    receiver: { mmsi: r.receiver_mmsi, vesselId: r.receiver_mmsi_vessel || null, name: r.r_name, kind: kindOf(r.receiver_mmsi_vessel, r.r_type) },
    supplier: { mmsi: r.supplier_mmsi, vesselId: r.supplier_mmsi_vessel || null, name: r.s_name, kind: kindOf(r.supplier_mmsi_vessel, r.s_type) },
  })).filter((e) => e.receiver.kind?.class !== 'ferry')
  // The shared rule (lib/ships/bunkerMatch.js, stored with the bunkering report): only fuelings it counts — matched to an Ecology
  // notice, or a known bunker tug alongside — so the card, the map badge and the report agree. Each keeps its notice, if any.
  const key = `${a.source_id}|${a.source_key}`
  const keep = counted ? (f) => { const c = counted.get(`${key}|${f.receiver.mmsi}|${f.t0}`); if (c) f.notified = c.notified; return !!c } : null
  return { ...base, bake: bakeInfo, coverage: 'covered', months, rule: counted ? 'shared' : 'pairs', ...summarizeBunkering(evs, win.months, months.covered, keep) }
}

/**
 * Events on the same receiver that overlap in time are ONE fueling (two tugs often handle one barge, 2026-10-18: SAN VICENTE at
 * Port Angeles had SEVERN and DR MILTON WANER alongside at once). Pure: events sorted by receiver then t0 → fuelings
 * { t0, t1, hours, outside, minM, receiver, suppliers: [...] }.
 */
export function groupFuelings(evs) {
  const shipKey = (s) => s.vesselId || `mmsi:${s.mmsi}`
  const sorted = [...evs].sort((a, b) => shipKey(a.receiver).localeCompare(shipKey(b.receiver)) || a.t0.localeCompare(b.t0))
  const out = []
  for (const e of sorted) {
    const last = out[out.length - 1]
    if (last && shipKey(last.receiver) === shipKey(e.receiver) && e.t0 <= last.t1) {
      if (e.t1 > last.t1) last.t1 = e.t1
      last.outside = last.outside && e.outside
      if (e.minM != null) last.minM = last.minM == null ? e.minM : Math.min(last.minM, e.minM)
      if (!last.suppliers.some((x) => shipKey(x) === shipKey(e.supplier))) last.suppliers.push(e.supplier)
    } else out.push({ t0: e.t0, t1: e.t1, outside: e.outside, minM: e.minM, receiver: e.receiver, suppliers: [e.supplier] })
  }
  for (const f of out) f.hours = Math.round(((new Date(f.t1) - new Date(f.t0)) / 3600e3) * 10) / 10
  return out
}

/** The card's figures (pure): fuelings, distinct ships fueled, per month (null = no AIS), supplying vessels. */
export function summarizeBunkering(evs, months, coveredList, keep = null) {
  const covered = new Set(coveredList)
  const shipKey = (s) => s.vesselId || `mmsi:${s.mmsi}`
  const fuelings = groupFuelings(evs).filter((f) => !keep || keep(f))
  const sup = new Map()
  for (const f of fuelings) for (const s of f.suppliers) {
    const k = shipKey(s)
    const x = sup.get(k) || { name: s.name, vesselId: s.vesselId, mmsi: s.mmsi, kind: s.kind, fuelings: 0 }
    x.fuelings++
    sup.set(k, x)
  }
  return {
    summary: { fuelings: fuelings.length, ships: new Set(fuelings.map((f) => shipKey(f.receiver))).size, suppliers: sup.size,
      hours: Math.round(fuelings.reduce((h, f) => h + f.hours, 0)),
      perMonth: months.map((m) => ({ month: m, n: covered.has(m) ? fuelings.filter((f) => f.t0.slice(0, 7) === m).length : null })) },
    fuelings: fuelings.sort((a, b) => b.t0.localeCompare(a.t0)),
    suppliers: [...sup.values()].sort((a, b) => b.fuelings - a.fuelings || String(a.name).localeCompare(String(b.name))),
  }
}

/** Anchorages with likely bunkering in the picked months (the map badge): [{ k: source_id|source_key, n }]. */
export async function bunkeringAnchorages(q, S, win) {
  try {
    const [bake] = await q(`SELECT months FROM ${S}.bunker_event_bakes WHERE bake_version = $1`, [BUNKER_BAKE_VERSION])
    if (!bake) return { anchorages: [] }
    const months = coveredMonths(win.months, bake.months).covered
    if (!months.length) return { anchorages: [], months }
    const rows = await q(`SELECT anchorage_source_id || '|' || anchorage_source_key AS k, count(*)::int AS n FROM ${S}.bunker_events
                           WHERE bake_version = $1 AND to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($2) GROUP BY 1`, [BUNKER_BAKE_VERSION, months])
    return { anchorages: rows, months }
  } catch (e) {
    if (e?.code === '42P01') return { anchorages: [] }
    throw e
  }
}

export { anchorageKey }
