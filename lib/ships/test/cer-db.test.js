/**
 * Canada Energy Regulator records, database tests (migration 033, lib/ships/cer.js). DEV database in SHIPS_DATABASE_URL, throwaway
 * schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * REAL: the Westridge entry of lib/ships/data/salish-facilities.json (imported with no BC register / NRCED / EAO input) and the
 * recorded CER rows and order page in fixtures/cer-westridge-2026-10-07.json.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadFacilityData, ensureFacilitySources } from '../facilities.js'
import { ensureBcSources, importBcFacilities } from '../bcPermits.js'
import { cerRecords, ensureCerSources, importCer, cerFacilityDetail, ORDERS } from '../cer.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
const KEY = 'bc-westridge-marine-terminal'
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('cer-westridge-2026-10-07.json')
const fdata = await loadFacilityData()
const data = { ...fdata, facilities: fdata.facilities.filter((f) => f.id === KEY) }
const records = cerRecords(fx.files, { lat: 49.290971, lon: -122.949893 })
const pages = () => new Map([[fx.order.url, { ...fx.order }]])   // only BL-001-2023's own page is recorded: its related pages are reported missing

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureFacilitySources(c, S))
  await withTx(pool, (c) => ensureBcSources(c, S))
  await withTx(pool, (c) => ensureCerSources(c, S))
  await withTx(pool, (c) => importBcFacilities(c, S, data, { ema: { url: 'x', rows: new Map() }, nrced: new Map(), eao: new Map() }, { partial: true }))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('import: shown and hidden records linked with their reason; the order stored; idempotent', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importCer(c, S, KEY, records, pages()))
  assert.deepEqual(r1.accepted, { cva: 2, incident: 2, om: 1, contamination: 1, condition: 2 })
  assert.deepEqual(r1.candidates, { cva: 1, om: 1, condition: 2 })
  assert.equal(r1.orders, 1)
  assert.deepEqual(r1.problems, [`order ${ORDERS[0].id}: ${ORDERS[0].related[0].title} not cached`, `order ${ORDERS[0].id}: ${ORDERS[0].related[1].title} not cached`,
    `order ${ORDERS[1].id}: page not cached`])
  const roles = await q(`SELECT entity_key, status, detail->>'why' AS why FROM ${S}.facility_links WHERE role = 'cer_record' ORDER BY entity_key`)
  assert.equal(roles.find((x) => x.entity_key === 'cva:CV1718-267').why, 'Facilities: "WESTRIDGE [Westridge Delivery Line]"')
  const n = async () => (await q(`SELECT (SELECT count(*) FROM ${S}.source_records) + (SELECT count(*) FROM ${S}.facility_links) AS n`))[0].n
  const before2 = await n()
  const r2 = await withTx(pool, (c) => importCer(c, S, KEY, records, pages()))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(await n(), before2)
})

test('read: the card’s CER section shows accepted records only, with plain words and dataset links', { skip }, async () => {
  const c = await cerFacilityDetail(q, S, (await q(`SELECT id FROM ${S}.facilities WHERE key = $1`, [KEY]))[0].id)
  assert.deepEqual(c.inspections.map((x) => x.id), ['CV1718-267', 'CV1617-196'])
  assert.equal(c.inspections[0].findings.length, 6)
  assert.deepEqual(c.incidents.map((x) => x.id), ['INC2023-091', 'INC2015-059'])
  assert.deepEqual(c.conditions.map((x) => x.number).sort(), ['134', '84'])
  assert.equal(c.orders[0].id, 'BL-001-2023')
  assert.equal(c.contamination[0].id, 'REM2021-052')
  assert.deepEqual(c.hidden, { cva: 1, om: 1, condition: 2 })
  assert.match(c.datasets.incident.url, /^https:\/\/open\.canada\.ca\/data\/en\/dataset\//)
})
