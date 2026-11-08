/**
 * Dock calls on the DEV database, throwaway schema (ships_t_<random>), dropped afterwards; never "ships", never production.
 * Skipped (NOT RUN) without SHIPS_DATABASE_URL. The calls are SYNTHETIC (shape of callSplitter output); the docks are the real list.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { storeDockCalls, DOCK_BAKE_VERSION } from '../dockCalls.js'
import { ANT_DOCKS, ANT_DOCKS_VERSION } from '../data/antDocks.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const dock = ANT_DOCKS[0].key
const call = (mmsi, t0, t1) => ({ terminal: dock, mmsi, t0: Date.parse(t0), t1: Date.parse(t1), n: 10, minM: 42.5, name: 'SAMISH', imo: null, type: 60, length: 110 })
const bake = (months) => ({ rule: {}, input: {}, days: [], months: months.map((m) => ({ month: m, complete: true })), docks: [] })

before(async () => { if (skip) return; pool = shipsPool(); await migrate(pool, S) })
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('storeDockCalls: whole bake, then one month replaced and added to the covered months', { skip }, async () => {
  await withTx(pool, (c) => storeDockCalls(c, S, { calls: [call('366000001', '2025-07-01T01:00:00Z', '2025-07-01T03:00:00Z'), call('366000001', '2025-08-01T01:00:00Z', '2025-08-01T02:00:00Z')], bake: bake(['2025-07', '2025-08']) }))
  let [b] = await q(`SELECT months, docks_version FROM ${S}.dock_call_bakes WHERE bake_version = $1`, [DOCK_BAKE_VERSION])
  assert.deepEqual(b.months, ['2025-07', '2025-08']); assert.equal(b.docks_version, ANT_DOCKS_VERSION)
  const [r] = await q(`SELECT radius_m, ais_name, evidence_class FROM ${S}.dock_calls LIMIT 1`)
  assert.equal(r.radius_m, ANT_DOCKS[0].radius_m ?? 150); assert.equal(r.ais_name, 'SAMISH'); assert.equal(r.evidence_class, 'inferred')
  await withTx(pool, (c) => storeDockCalls(c, S, { calls: [call('366000002', '2025-09-02T01:00:00Z', '2025-09-02T05:00:00Z')], bake: bake(['2025-09']), months: ['2025-09'] }))
  ;[b] = await q(`SELECT months FROM ${S}.dock_call_bakes WHERE bake_version = $1`, [DOCK_BAKE_VERSION])
  assert.deepEqual(b.months, ['2025-07', '2025-08', '2025-09'])
  assert.equal((await q(`SELECT count(*)::int AS n FROM ${S}.dock_calls`))[0].n, 3)
  await assert.rejects(() => withTx(pool, (c) => storeDockCalls(c, S, { calls: [{ ...call('1', '2025-07-01T00:00:00Z', '2025-07-01T01:00:00Z'), terminal: 'nope' }], bake: bake([]) })), /not in antDocks/)
})
