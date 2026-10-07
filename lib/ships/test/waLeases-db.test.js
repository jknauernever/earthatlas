/**
 * WA DNR leases + Whatcom shoreline pilot, database tests (lib/ships/dnrLeases.js, lib/ships/countyShoreline.js). DEV database in
 * SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN)
 * without the URL. No network. REAL: fixtures/wa-leases-live-2026-10-07.json and the entries of lib/ships/data/wa-leases-sites.json.
 * The four terminal rows are SYNTHETIC stand-ins (keys and berths copied from salish-terminals.json; the import of terminals itself is
 * tested elsewhere).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { upsertSource, findOrCreateEntity, upsertRecord } from '../store.js'
import { buildIndex, importDnrLeases, terminalLand, loadLeaseSites } from '../dnrLeases.js'
import { importCountyShoreline } from '../countyShoreline.js'
import { FACILITIES_LIST_SOURCE } from '../facilities.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('wa-leases-live-2026-10-07.json')
const index = buildIndex(Object.entries(fx.layers).map(([layer, features]) => ({ layer: Number(layer), body: { features } })))
const all = JSON.parse(await readFile(new URL('../data/salish-terminals.json', import.meta.url), 'utf8')).terminals
const KEYS = ['wa-bp-cherry-point', 'wa-marathon-anacortes', 'wa-anacortes-petcoke', 'wa-intalco-wharf']
const terminals = all.filter((t) => KEYS.includes(t.id))
const full = await loadLeaseSites()
const data = { ...full, terminals: Object.fromEntries(KEYS.map((k) => [k, full.terminals[k]])) }
// Intalco's own DNR lease is not in the fixture: only its county pilot is tested here.
data.terminals['wa-intalco-wharf'] = { ...data.terminals['wa-intalco-wharf'], dnr: { uses: [], none: 'SYNTHETIC: DNR part not in this fixture' } }
const sepaPages = new Map(Object.entries(fx.sepa))
const notices = () => new Map([[data.terminals['wa-intalco-wharf'].county.shoreline[0].notice_doc, fx.notice]])

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, async (c) => {
    await upsertSource(c, S, FACILITIES_LIST_SOURCE)
    const ent = await findOrCreateEntity(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, kind: 'test_entry', anchor: 'SYNTHETIC' })
    const rec = await upsertRecord(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, entityId: ent.id, payload: { synthetic: true } })
    for (const t of terminals) {
      await c.query(`INSERT INTO ${S}.terminals (key, name, kind, country, entry_source_record_id) VALUES ($1,$2,$3,'US',$4)`, [t.id, t.name, t.kind, rec.id])
    }
  })
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

const count = async () => (await q(`SELECT (SELECT count(*) FROM ${S}.source_records) + (SELECT count(*) FROM ${S}.terminal_land_records) AS n`))[0].n

test('import: leases, the PMA and the shoreline permits land on their terminals; a second run adds nothing', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importDnrLeases(c, S, data, index, terminals, { retrieved: '2026-10-07' }))
  assert.deepEqual(r1.problems, [])
  assert.equal(r1.uses, 2)
  assert.equal(r1.pma, 1)
  const c1 = await withTx(pool, (c) => importCountyShoreline(c, S, data, sepaPages, notices()))
  assert.equal(c1.permits, 1)   // SHR2020-00006's notice is not in the fixture: reported, not stored
  assert.match(c1.problems[0], /SHR2020-00006/)
  const n1 = await count()
  const r2 = await withTx(pool, (c) => importDnrLeases(c, S, data, index, terminals, { retrieved: '2026-10-07' }))
  const c2 = await withTx(pool, (c) => importCountyShoreline(c, S, data, sepaPages, notices()))
  assert.equal(r2.recordsCreated + c2.recordsCreated, 0)
  assert.equal(await count(), n1)
})

test('read: the BP card shows lease 20-A09122 with DNR’s fields, its why, and the DNR credit; staff names are not stored', { skip }, async () => {
  const [t] = await q(`SELECT id FROM ${S}.terminals WHERE key = 'wa-bp-cherry-point'`)
  const land = await terminalLand(q, S, t.id)
  assert.equal(land.records.length, 1)
  const r = land.records[0]
  assert.equal(r.kind, 'dnr_use_authorization')
  assert.equal(r.lease, '20-A09122')
  assert.equal(r.lessee, 'BP WEST COAST PRODUCTS LLC')
  assert.equal(r.effective, '1999-04-01')
  assert.equal(r.ends, null)
  assert.ok(r.why.includes('BP West Coast Products'))
  assert.deepEqual(land.sources.map((s) => s.id), ['wa-dnr-aquatic-uses'])
  const [p] = await q(`SELECT payload FROM ${S}.source_records WHERE id = $1`, [r.record_id])
  assert.equal(p.payload.attributes.EDIT_NM, undefined)
  const [i] = await q(`SELECT id FROM ${S}.terminals WHERE key = 'wa-intalco-wharf'`)
  const shore = (await terminalLand(q, S, i.id)).records.find((x) => x.kind === 'county_shoreline_permit')
  assert.equal(shore.file, 'SHR2020-00002')
  assert.equal(shore.type, 'Shoreline Substantial Development Permit')
  assert.deepEqual(shore.sepa.map((x) => x.sepa), ['202001715', '202003309'])
})

test('withdraw: a lease the file no longer names is kept, marked withdrawn, and no longer shown', { skip }, async () => {
  const less = { ...data, terminals: { ...data.terminals, 'wa-bp-cherry-point': { dnr: { uses: [], none: 'SYNTHETIC: lease removed from the file' } } } }
  const r = await withTx(pool, (c) => importDnrLeases(c, S, less, index, terminals, { retrieved: '2026-10-07' }))
  assert.equal(r.withdrawn, 1)
  const [t] = await q(`SELECT id FROM ${S}.terminals WHERE key = 'wa-bp-cherry-point'`)
  assert.equal((await terminalLand(q, S, t.id)).records.length, 0)
  const rows = await q(`SELECT status FROM ${S}.terminal_land_records WHERE terminal_id = $1`, [t.id])
  assert.deepEqual(rows.map((x) => x.status), ['withdrawn'])
})
