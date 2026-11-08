/**
 * Dock calls (Josh 2026-11-07: "track the docks we don't track"): AIS calls at the docks Washington Ecology's oil-transfer notices
 * name that no EarthAtlas terminal covers (lib/ships/data/antDocks.js). Report-only: these docks are not terminals. The same rule
 * as terminal calls (lib/ships/terminalCalls.js), from the same AIS cache, counted separately so terminal calls, terminal cards
 * and the frozen scrubber edition never change. Rules: src/ships/CLAUDE.md.
 *
 *   evidence        MarineCadastre AIS daily points (CC0), bake-ais points cache. Positions never go in Postgres.
 *   derived         scripts/ships/bake-ais/terminal_calls.py --set dock-calls keeps every STOPPED position (SOG < 0.5 kn) within
 *                   DOCK_RULE.collectM of a dock point (each dock that holds it, not only the nearest); dock-calls.mjs keeps
 *                   those within the dock's own radius_m and splits them into calls (callSplitter: gap > 6 h = new call,
 *                   >= 15 min kept) → dock_calls (migration 043), evidence class 'inferred'.
 *   interpretation  read time only (lib/ships/oilTransfers.js): whether the notified ship made the call.
 *
 * collectM is wider than any dock radius so a radius can be checked and changed without reading the AIS cache again.
 */
import { upsertSource, findOrCreateEntity, upsertRecord } from './store.js'
import { MC_SOURCE } from './marinecadastre.js'
import { CALL_RULE, inAisBox, aisRegionOf } from './terminalCalls.js'
import { ANT_DOCKS, ANT_DOCKS_VERSION } from './data/antDocks.js'

// dc1 (2026-11-07): the 72 docks of antDocks.js (radii applied at import, so ad2's radii reuse the dc1 scan).
export const DOCK_BAKE_VERSION = 'dc1'
export const DOCK_RULE = Object.freeze({ sogKn: CALL_RULE.sogKn, collectM: 1000, gapHours: CALL_RULE.gapHours, minMinutes: CALL_RULE.minMinutes })

export const DOCK_CALLS_SOURCE = {
  id: 'earthatlas-dock-calls',
  name: 'EarthAtlas dock calls (derived from MarineCadastre AIS)',
  publisher: 'EarthAtlas, from NOAA Office for Coastal Management / BOEM MarineCadastre AIS (U.S. Coast Guard receivers)',
  homepage_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  license: 'CC0 1.0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  commercial_use: true,
  attribution_text: 'MarineCadastre AIS (NOAA / BOEM / USCG), calls derived by EarthAtlas',
  attribution_url: 'https://hub.marinecadastre.gov/pages/vesseltraffic',
  notes: 'Derived dataset, evidence class inferred: an EarthAtlas rule applied to AIS self-reported positions. A call = the ship '
    + 'reports speed over ground < 0.5 kn within a dock\'s radius (150 m unless the docks list says otherwise) of the point '
    + 'Washington Ecology publishes for that dock on its Advance Notices of Transfer; a gap of > 6 h starts a new call; calls '
    + 'shorter than 15 min are dropped. Docks are the ones Ecology\'s notices name that no EarthAtlas terminal covers. Input: '
    + 'MarineCadastre daily points (CC0 1.0), US terrestrial receivers only, box W -126.2 S 47 E -122.05 N 49.6. Names, IMO, type '
    + 'and length on a call are as the ship broadcast them (AIS reported), never a registry fact.',
}

// ── Pure ─────────────────────────────────────────────────────────────────────

/** The scan's input (cache/dock-calls/berths.json): one "berth" per dock, at the collection radius. */
export function dockScanFile(docks = ANT_DOCKS) {
  return {
    bake_version: DOCK_BAKE_VERSION, docks_version: ANT_DOCKS_VERSION, overlap: 'all', rule: { sogKn: DOCK_RULE.sogKn, collectM: DOCK_RULE.collectM },
    berths: docks.map((d) => ({ terminal: d.key, berth: d.key, lat: d.lat, lon: d.lon, radius_m: DOCK_RULE.collectM, call_radius_m: d.radius_m ?? CALL_RULE.radiusM,
      in_box: inAisBox(d.lat, d.lon), region: aisRegionOf(d.lat, d.lon) })),
  }
}

/** A scan hit counts for its dock when within that dock's own radius. Pure. */
export function dockRadius(docks = ANT_DOCKS) {
  const r = new Map(docks.map((d) => [d.key, d.radius_m ?? CALL_RULE.radiusM]))
  return (key, m) => { const x = r.get(key); return x != null && m <= x }
}

// ── Storage (dev DB via scripts/ships/dock-calls.mjs; prod via prod.sh / the monthly workflow; tests in a throwaway schema) ──

/**
 * Store one bake (or, with months, those months of it): the bake record, its calls (replacing this version's earlier rows, or
 * only those months'), and the coverage row. One transaction; c = a client inside withTx. calls: callSplitter output
 * ({ terminal: dockKey, mmsi, t0, t1, n, minM, name, imo, type, length }). bake: { rule, input, days, months: [{ month, complete }],
 * docks: [{ key, lat, lon, radius_m }] }.
 */
export async function storeDockCalls(c, S, { calls, bake, runId = null, version = DOCK_BAKE_VERSION, months = null, docks = ANT_DOCKS }) {
  await upsertSource(c, S, MC_SOURCE)
  await upsertSource(c, S, DOCK_CALLS_SOURCE)
  const radius = new Map(docks.map((d) => [d.key, d.radius_m ?? CALL_RULE.radiusM]))
  const unknown = [...new Set(calls.filter((x) => !radius.has(x.terminal)).map((x) => x.terminal))]
  if (unknown.length) throw new Error(`calls for docks not in antDocks.js: ${unknown.join(', ')}`)
  const ent = await findOrCreateEntity(c, S, { sourceId: DOCK_CALLS_SOURCE.id, kind: 'dock_call_bake', anchor: version })
  const payload = { method: DOCK_CALLS_SOURCE.notes, bake_version: version, docks_version: ANT_DOCKS_VERSION, ...bake, calls: calls.length }
  const rec = await upsertRecord(c, S, { sourceId: DOCK_CALLS_SOURCE.id, entityId: ent.id, payload, datasetVersion: version, retrievalUrl: null, runId })
  if (months) {
    const off = calls.filter((x) => !months.includes(new Date(x.t0).toISOString().slice(0, 7)))
    if (off.length) throw new Error(`${off.length} calls fall outside ${months.join(', ')}`)
    await c.query(`DELETE FROM ${S}.dock_calls WHERE bake_version = $1 AND to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') = ANY($2)`, [version, months])
  } else await c.query(`DELETE FROM ${S}.dock_calls WHERE bake_version = $1`, [version])
  for (let i = 0; i < calls.length; i += 1000) {
    const b = calls.slice(i, i + 1000)
    await c.query(
      `INSERT INTO ${S}.dock_calls (bake_version, dock_key, mmsi, t0, t1, n_points, min_m, radius_m, ais_name, ais_imo, ais_vessel_type, ais_length, bake_record_id)
       SELECT $1, x.dock, x.mmsi, x.t0, x.t1, x.n, x.minm, x.radius, x.name, x.imo, x.vtype, x.len, $2
         FROM unnest($3::text[], $4::text[], $5::timestamptz[], $6::timestamptz[], $7::int[], $8::real[], $9::int[], $10::text[], $11::text[], $12::int[], $13::real[])
              AS x(dock, mmsi, t0, t1, n, minm, radius, name, imo, vtype, len)`,
      [version, rec.id, b.map((x) => x.terminal), b.map((x) => String(x.mmsi)), b.map((x) => new Date(x.t0).toISOString()), b.map((x) => new Date(x.t1).toISOString()),
        b.map((x) => x.n), b.map((x) => x.minM), b.map((x) => radius.get(x.terminal)), b.map((x) => x.name ?? null),
        b.map((x) => (x.imo == null ? null : String(x.imo))), b.map((x) => (x.type == null ? null : Number(x.type))), b.map((x) => x.length ?? null)])
  }
  const complete = (bake.months || []).filter((m) => m.complete).map((m) => m.month)
  await c.query(`INSERT INTO ${S}.dock_call_bakes (bake_version, source_id, bake_record_id, docks_version, months, rule, imported_at)
                 VALUES ($1, $2, $3, $4, $5, $6, now())
                 ON CONFLICT (bake_version) DO UPDATE SET bake_record_id = EXCLUDED.bake_record_id, docks_version = EXCLUDED.docks_version,
                   months = CASE WHEN $7 THEN ARRAY(SELECT DISTINCT unnest(${S}.dock_call_bakes.months || EXCLUDED.months) ORDER BY 1) ELSE EXCLUDED.months END,
                   rule = EXCLUDED.rule, imported_at = now()`,
    [version, DOCK_CALLS_SOURCE.id, rec.id, ANT_DOCKS_VERSION, months ? complete.filter((m) => months.includes(m)) : complete, DOCK_RULE, !!months])
  return { recordId: rec.id, recordCreated: rec.created, calls: calls.length }
}
