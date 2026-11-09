/**
 * Database test for terminal calls stored for SOME terminals only (storeTerminalCalls { terminals }, 2026-11-08: Smith Cove's
 * AIS-estimated berths). DEV database in SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>) dropped afterwards; never "ships",
 * never production. Skipped (NOT RUN) without the URL. The terminal is the REAL Vancouver Wharves entry (as aisBerths-db.test.js);
 * a second terminal row is a copy under a test key; the calls are SYNTHETIC (shape of callSplitter output).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources } from '../terminals.js'
import { storeTerminalCalls, BAKE_VERSION } from '../terminalCalls.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const bc = fixture('bc-ports-terminals-272-live-2026-09-28.json')
const full = await loadTerminalData()
const KEY = 'bc-vancouver-wharves', OTHER = 'bc-test-other'
const data = { main: { ...full.main, terminals: full.main.terminals.filter((t) => t.id === KEY) }, osm: { ...full.osm, berths: [] }, ais: { ...full.ais, berths: full.ais.berths.filter((b) => b.terminal === KEY) } }
const raw = { usace: [], ecology: [], bcpt: bc.features, osm: { elements: [], osmBase: null }, gem: [], ctRefinery: [], release: null, urls: { bcpt: bc.url } }
const call = (terminal, mmsi, t0, t1) => ({ terminal, berth: 'b1', mmsi, t0: Date.parse(t0), t1: Date.parse(t1), n: 10, minM: 20, also: [], ambiguousPoints: 0, name: 'X', imo: null, type: 70, length: 200 })
const bake = (months) => ({ rule: {}, input: {}, days: [], months: months.map((m) => ({ month: m, complete: true })), berths: [], notCovered: [] })

before(async () => {
  if (skip) return
  pool = shipsPool(); await migrate(pool, S)
  await withTx(pool, async (c) => { await ensureTerminalSources(c, S); await importTerminals(c, S, data, raw) })
  await pool.query(`INSERT INTO ${S}.terminals (key, name, kind, country, entry_source_record_id) SELECT $2, name || ' (test copy)', kind, country, entry_source_record_id FROM ${S}.terminals WHERE key = $1`, [KEY, OTHER])
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('storeTerminalCalls { terminals }: replaces only those terminals; other calls, the bake record and coverage stay', { skip }, async () => {
  await withTx(pool, (c) => storeTerminalCalls(c, S, { calls: [call(KEY, '1', '2025-07-01T01:00:00Z', '2025-07-01T05:00:00Z'), call(OTHER, '2', '2025-07-02T01:00:00Z', '2025-07-02T05:00:00Z')], bake: bake(['2025-07']) }))
  const [b0] = await q(`SELECT bake_record_id, months FROM ${S}.terminal_call_bakes WHERE bake_version = $1`, [BAKE_VERSION])
  const r = await withTx(pool, (c) => storeTerminalCalls(c, S, { calls: [call(KEY, '3', '2025-07-03T01:00:00Z', '2025-07-03T05:00:00Z'), call(KEY, '4', '2025-07-04T01:00:00Z', '2025-07-04T05:00:00Z')],
    bake: { ...bake(['2025-07']), why: 'test' }, terminals: [KEY] }))
  assert.equal(r.replaced, 1)
  const rows = await q(`SELECT terminal_key, mmsi, bake_record_id FROM ${S}.terminal_calls ORDER BY mmsi`)
  assert.deepEqual(rows.map((x) => [x.terminal_key, x.mmsi]), [[OTHER, '2'], [KEY, '3'], [KEY, '4']])
  assert.equal(rows[0].bake_record_id, b0.bake_record_id)
  assert.notEqual(rows[1].bake_record_id, b0.bake_record_id)
  const [b1] = await q(`SELECT bake_record_id, months FROM ${S}.terminal_call_bakes WHERE bake_version = $1`, [BAKE_VERSION])
  assert.deepEqual(b1, b0)
  await assert.rejects(() => withTx(pool, (c) => storeTerminalCalls(c, S, { calls: [call(OTHER, '5', '2025-07-05T01:00:00Z', '2025-07-05T02:00:00Z')], bake: bake(['2025-07']), terminals: [KEY] })), /outside/)
  await assert.rejects(() => withTx(pool, (c) => storeTerminalCalls(c, S, { calls: [], bake: bake([]), terminals: [KEY] })), /lacks months/)
})
