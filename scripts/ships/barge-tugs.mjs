#!/usr/bin/env node
/**
 * Barge ↔ tug pair proposals (lib/ships/bargeTugs.js; Josh 2026-11-07). Read-only on the database it is pointed at.
 *
 *   node --env-file=.env.local scripts/ships/barge-tugs.mjs propose [--prod]
 *       → scripts/ships/bake-ais/cache/barge-tugs/proposals.json: for every barge Ecology's notices name (transfers with no vessel
 *         with AIS, at a terminal or tracked dock), the tug AIS shows at the berth through most of them (BARGE_TUG_RULE).
 *         --prod reads SHIPS_PROD_DATABASE_URL in a read-only transaction.
 * The reviewed pairs are copied by hand into lib/ships/data/bargeTugs.js, each with its evidence and published source if any.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import pg from 'pg'
import { computeOilTransfers } from '../../lib/ships/oilTransfers.js'
import { proposePairs, TUG_TYPES, BARGE_TUG_RULE } from '../../lib/ships/bargeTugs.js'
import { BAKE_VERSION as CALL_BAKE } from '../../lib/ships/terminalCalls.js'
import { DOCK_BAKE_VERSION } from '../../lib/ships/dockCalls.js'

const prod = process.argv.includes('--prod')
const url = prod ? process.env.SHIPS_PROD_DATABASE_URL : process.env.SHIPS_DATABASE_URL
const S = 'ships'
const pool = new pg.Pool({ connectionString: url, max: 1 })
const client = await pool.connect()
try {
  await client.query('BEGIN READ ONLY')
  const q = async (t, a) => (await client.query(t, a)).rows
  const r = await computeOilTransfers(q, S)
  if (!r.available) throw new Error('report not available')
  // Every barge transfer at a terminal or tracked dock, whatever rule 8 made of it (the proposal never reads the reviewed pairs).
  const ops = r.ops.filter((o) => o.group === 'noAis' && o.ship && /BARGE/i.test(o.shipType || '') && o.terminals.length && o.reason !== 'outside')
    .map((o) => ({ barge: o.ship, startAt: o.startAt, durationH: o.durationH, places: o.terminals, type: o.shipType }))
  const places = [...new Set(ops.flatMap((o) => o.places))]
  const rows = [
    ...await q(`SELECT terminal_key AS k, mmsi, ais_name, t0, t1 FROM ${S}.terminal_calls WHERE bake_version = $1 AND terminal_key = ANY($2) AND ais_vessel_type = ANY($3)`, [CALL_BAKE, places, TUG_TYPES]),
    ...await q(`SELECT dock_key AS k, mmsi, ais_name, t0, t1 FROM ${S}.dock_calls WHERE bake_version = $1 AND dock_key = ANY($2) AND ais_vessel_type = ANY($3)`, [DOCK_BAKE_VERSION, places, TUG_TYPES]).catch(() => []),
  ]
  const callsAt = new Map()
  for (const c of rows) (callsAt.get(c.k) || callsAt.set(c.k, []).get(c.k)).push({ mmsi: String(c.mmsi), aisName: c.ais_name, t0: new Date(c.t0).getTime(), t1: new Date(c.t1).getTime() })
  const props = proposePairs(ops, callsAt)
  const typeOf = new Map(ops.map((o) => [o.barge, o.type]))
  const out = props.map((p) => ({ ...p, bargeType: typeOf.get(p.barge) || null }))
  await mkdir('scripts/ships/bake-ais/cache/barge-tugs', { recursive: true })
  await writeFile('scripts/ships/bake-ais/cache/barge-tugs/proposals.json', JSON.stringify({ rule: BARGE_TUG_RULE, from: prod ? 'prod' : 'dev', made: new Date().toISOString(), proposals: out }, null, 1))
  console.log(`${ops.length} barge transfers, ${new Set(ops.map((o) => o.barge)).size} barges → ${out.length} proposals`)
  for (const p of out) console.log(String(p.ops).padStart(4), (p.bargeType || '').padEnd(10), p.barge.padEnd(34), p.aisName, p.mmsi, `${p.together}/${p.full}`, p.fullShare)
  await client.query('ROLLBACK')
} finally { client.release(); await pool.end() }
