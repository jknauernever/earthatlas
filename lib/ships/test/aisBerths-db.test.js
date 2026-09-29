/**
 * Database test for AIS-inferred berths (migration 017): they are stored as basis 'ais_inferred' from their own evidence record,
 * never flagged ODbL, never move the terminal's display point, and a re-import stores nothing new. DEV database in
 * SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN)
 * without the URL. No live calls: the REAL BC Ports and Terminals row for Vancouver Wharves (fixtures/README.md) and the REAL
 * entries of lib/ships/data.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, listTerminals } from '../terminals.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const bc = fixture('bc-ports-terminals-272-live-2026-09-28.json')
const full = await loadTerminalData()
const KEY = 'bc-vancouver-wharves'
const data = { main: { ...full.main, terminals: full.main.terminals.filter((t) => t.id === KEY) }, osm: { ...full.osm, berths: [] }, ais: { ...full.ais, berths: full.ais.berths.filter((b) => b.terminal === KEY) } }
const raw = { usace: [], ecology: [], bcpt: bc.features, osm: { elements: [], osmBase: null }, gem: [], ctRefinery: [], release: null, urls: { bcpt: bc.url } }

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('AIS-inferred berths: stored apart, with their evidence record; the display point stays on the cited berth (REAL rows)', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importTerminals(c, S, data, raw))
  assert.equal(r1.terminals, 1)
  assert.equal(r1.berths, 3)
  const b = await q(`SELECT b.berth_key, b.basis, b.source_id, b.odbl, b.source_record_ids, b.detail FROM ${S}.terminal_berths b ORDER BY b.berth_key`)
  assert.deepEqual(b.map((x) => `${x.berth_key}:${x.basis}:${x.source_id}`), ['ais-1:ais_inferred:earthatlas-ais-berths', 'ais-2:ais_inferred:earthatlas-ais-berths',
    'bcpt-272:bc_ports_terminals:bc-ports-terminals'])
  assert.ok(b.every((x) => x.odbl === false && x.source_record_ids.length === 1))
  const [rec] = await q(`SELECT sr.source_id, sr.payload, se.entity_kind, se.entity_key FROM ${S}.source_records sr JOIN ${S}.source_entities se ON se.id = sr.source_entity_id
                          WHERE sr.id = $1`, [b[0].source_record_ids[0]])
  assert.equal(rec.source_id, 'earthatlas-ais-berths')
  assert.equal(rec.entity_kind, 'ais_inferred_berth')
  assert.equal(rec.entity_key, `${KEY}/ais-1`)
  assert.ok(rec.payload.evidence.stops >= 10 && rec.payload.evidence.input.days.n === 365, 'the record carries the evidence behind the point')
  assert.match(rec.payload.guard, /footprint/)
  const [t] = await listTerminals(q, S)
  assert.equal(t.lat, 49.3094333, 'the pin is the mean of the cited berths only (here the BC Ports and Terminals point)')
  assert.equal(t.lon, -123.1178373)
  const [src] = await q(`SELECT license, notes FROM ${S}.sources WHERE id = 'earthatlas-ais-berths'`)
  assert.equal(src.license, 'CC0 1.0')
  assert.match(src.notes, /NEVER an official berth position/)
  const r2 = await withTx(pool, (c) => importTerminals(c, S, data, raw))
  assert.equal(r2.recordsCreated, 0, 'unchanged: nothing new stored')
  await assert.rejects(q(`UPDATE ${S}.terminal_berths SET odbl = true WHERE berth_key = 'ais-1'`), /check/i, 'an AIS berth can never carry the OSM flag')
})
