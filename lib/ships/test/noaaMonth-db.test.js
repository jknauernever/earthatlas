/**
 * NOAA months loading themselves (docs/SHIPS_ACTIVITY_FUSION.md Part 1): month-scoped terminal-call imports (storeTerminalCalls
 * { months }) and the NOAA ship-identity batch import (lib/ships/mcMonths.js). DEV database, throwaway schema (ships_t_<random>),
 * dropped afterwards; never "ships", never production. Skipped (NOT RUN) without SHIPS_DATABASE_URL.
 * Inputs are REAL (fixtures/noaa-month-2026-06-15.json: one day of MarineCadastre AIS through the workflow's test run). SYNTHETIC:
 * the fetch stub that serves the Salish index + identity file to mcMonths.js, and the "2026-07" relabel of the same calls.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { storeTerminalCalls, CALL_RULE } from '../terminalCalls.js'
import { importMcBatch, mcPayloadHash } from '../mcMonths.js'
import { fixture } from './scenarios.js'

const fxm = fixture('noaa-month-2026-06-15.json')
const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const bake = (months) => ({ rule: CALL_RULE, months: months.map((m) => ({ month: m, complete: true })), notCovered: [], berths: [] })

before(async () => {
  if (skip) return
  const fx = fixture('terminals-live-2026-09-27.json')
  const full = await loadTerminalData()
  const data = { main: { ...full.main, terminals: full.main.terminals.filter((t) => fx.terminals.includes(t.id)) },
    osm: { ...full.osm, berths: full.osm.berths.filter((b) => fx.terminals.includes(b.terminal)) } }
  const raw = { usace: fx.usace.features, ecology: fx.ecology.features, bcpt: fx.bcpt.features, osm: { elements: fx.osm.elements, osmBase: fx.osm.osm_base },
    gem: parseCsv(fx.gem.csv), ctRefinery: fx.ct_refinery.features, release: fx.ct_refinery.release,
    urls: { usace: fx.usace.url, ecology: fx.ecology.url, bcpt: fx.bcpt.url, osm: fx.osm.url, gem: fx.gem.url, ct: 'x' } }
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => importTerminals(c, S, data, raw))
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('storeTerminalCalls { months }: replaces only that month, adds it to the version, keeps other months', { skip }, async () => {
  const june = fxm.calls
  // SYNTHETIC: the same real calls moved one month on, to stand for a second month.
  const july = june.map((c) => ({ ...c, t0: c.t0 + 30 * 864e5, t1: c.t1 + 30 * 864e5 }))
  await withTx(pool, (c) => storeTerminalCalls(c, S, { calls: june, bake: bake(['2026-06']), months: ['2026-06'] }))
  await withTx(pool, (c) => storeTerminalCalls(c, S, { calls: july, bake: bake(['2026-07']), months: ['2026-07'] }))
  await withTx(pool, (c) => storeTerminalCalls(c, S, { calls: july.slice(0, 5), bake: bake(['2026-07']), months: ['2026-07'] })) // a re-run of July
  const n = await q(`SELECT to_char(t0 AT TIME ZONE 'UTC', 'YYYY-MM') AS m, count(*)::int AS n FROM ${S}.terminal_calls GROUP BY 1 ORDER BY 1`)
  assert.deepEqual(n, [{ m: '2026-06', n: june.length }, { m: '2026-07', n: 5 }])
  const [b] = await q(`SELECT months FROM ${S}.terminal_call_bakes`)
  assert.deepEqual(b.months, ['2026-06', '2026-07'])
  await assert.rejects(withTx(pool, (c) => storeTerminalCalls(c, S, { calls: june, bake: bake(['2026-07']), months: ['2026-07'] })), /outside 2026-07/)
})

test('importMcBatch: every month from the Salish index, resumable, unchanged MMSIs skipped on a re-run', { skip }, async () => {
  const gz = gzipSync(Buffer.from(fxm.identityRows.map((r) => JSON.stringify(r)).join('\n')))
  const real = globalThis.fetch
  globalThis.fetch = async (u) => {   // SYNTHETIC stub: the index and one month's identity file
    if (String(u).includes('index.json')) return new Response(JSON.stringify({ months: { '2026-06': { built: 'x', identity: 'https://stub/identity.ndjson.gz' } } }))
    if (String(u).includes('identity.ndjson.gz')) return new Response(gz)
    return real(u)
  }
  try {
    const r1 = await importMcBatch(pool, S, { offset: 0, budgetMs: 60000, chunk: 15 })
    assert.equal(r1.total, 40); assert.equal(r1.done, true); assert.equal(r1.ingested, 40); assert.deepEqual(r1.months, ['2026-06'])
    const [n] = await q(`SELECT count(*)::int AS n FROM ${S}.source_entities WHERE source_id = 'marinecadastre-ais'`)
    assert.equal(n.n, 40)
    const r2 = await importMcBatch(pool, S, { offset: 0, budgetMs: 60000 })
    assert.equal(r2.skipped, 40); assert.equal(r2.ingested, 0)
    assert.match(mcPayloadHash({ mmsi: 1, values: [] }), /^[0-9a-f]{64}$/)
  } finally { globalThis.fetch = real }
})
