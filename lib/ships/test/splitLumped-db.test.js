/**
 * Database test for splitting lumped records (lib/ships/splitLumped.js, B2). DEV database in SHIPS_DATABASE_URL, throwaway
 * schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. Shaped
 * like the real KODIAK record: one GFW entry mixing hulls plus three radio licences on three MMSIs, one of whose numbers
 * another record (MY DEERE) already holds. Values are test values, not real claims.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from '../store.js'
import { findLumped, planVessel, applySplit } from '../splitLumped.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

before(async () => { if (skip) return; pool = shipsPool(); await migrate(pool, S) })
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

const SRC = { id: 'test-reg', name: 'test', publisher: 'test', homepage_url: null, license: 'test', license_url: null, commercial_use: false, attribution_text: 'test', attribution_url: null, notes: null }
const F = '2020-01-01', T = '2026-01-01'
const ais = (attribute, v) => ({ attribute, value_raw: v, value_norm: v, period_from: F, period_to: T, period_kind: 'observed', evidence_class: 'ais_self_reported' })
const doc = (n) => ({ attribute: 'official_number', value_raw: n, value_norm: n, period_from: F, period_to: T, period_kind: 'validity', evidence_class: 'registry', detail: { scheme: 'us_official_number' } })

async function entry(c, key, vessel, claims) {
  const e = await findOrCreateEntity(c, S, { sourceId: SRC.id, kind: 'test_vessel', anchor: key })
  const r = await upsertRecord(c, S, { sourceId: SRC.id, entityId: e.id, payload: { key }, retrievalUrl: null })
  await upsertAssertions(c, S, { entityId: e.id, recordId: r.id, assertions: claims })
  await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, decided_by) VALUES ($1, $2, 'accepted', 'NEW_FROM_SOURCE_ENTITY', 'resolver:v1.4')`, [e.id, vessel])
  return String(e.id)
}

test('a lumped record splits by MMSI: one group to the record already holding its number, one to a new record; nothing deleted', { skip }, async () => {
  const ids = await withTx(pool, async (c) => {
    await upsertSource(c, S, SRC)
    const [{ id: lump }] = (await c.query(`INSERT INTO ${S}.vessels DEFAULT VALUES RETURNING id::text`)).rows
    const [{ id: deere }] = (await c.query(`INSERT INTO ${S}.vessels DEFAULT VALUES RETURNING id::text`)).rows
    const gfw = await entry(c, 'gfw', lump, [ais('name', 'KODIAK'), ais('mmsi', '367634660'), ais('mmsi', '367640780'), ais('mmsi', '366994170'), ais('callsign', 'WDH6101')])
    const a = await entry(c, 'lic-a', lump, [ais('name', 'KODIAK'), ais('mmsi', '367634660'), ais('callsign', 'WDH6101'), doc('637055'), ais('length_m', '19')])
    const b = await entry(c, 'lic-b', lump, [ais('name', 'KODIAK'), ais('mmsi', '367640780'), ais('callsign', 'WDH6701'), doc('1215169')])
    const cc = await entry(c, 'lic-c', lump, [ais('name', 'KODIAK'), ais('mmsi', '366994170'), ais('callsign', 'WDC2516'), doc('1119183')])
    await entry(c, 'psix-deere', deere, [ais('name', 'MYDEERE'), doc('1215169')])
    return { lump, deere, gfw, a, b, c: cc }
  })
  const before = await q(`SELECT count(*)::int n FROM ${S}.assertions`)
  assert.deepEqual((await findLumped(q, S)).map((r) => r.id), [ids.lump])
  const plan = await planVessel(pool, S, ids.lump)
  assert.equal(plan.split, true)
  assert.deepEqual(plan.keep.entities.sort(), [ids.a, ids.gfw].sort())
  const r = await withTx(pool, (c) => applySplit(c, S, plan))
  assert.deepEqual(r.moves.map((m) => [m.entities, m.created]), [[[ids.b], false], [[ids.c], true]])
  assert.equal(r.moves[0].into, ids.deere)
  // Each entry now has exactly one accepted link, on the right record; the old links are superseded, marked split_from.
  const acc = await q(`SELECT source_entity_id::text e, vessel_id::text v FROM ${S}.entity_links WHERE status = 'accepted' ORDER BY 1`)
  const at = Object.fromEntries(acc.map((x) => [x.e, x.v]))
  assert.equal(at[ids.a], ids.lump); assert.equal(at[ids.gfw], ids.lump); assert.equal(at[ids.b], ids.deere)
  assert.equal(at[ids.c], r.moves[1].into)
  const sup = await q(`SELECT source_entity_id::text e FROM ${S}.entity_links WHERE status = 'superseded' ORDER BY 1`)
  assert.deepEqual(sup.map((x) => x.e).sort(), [ids.b, ids.c].sort())
  const ev = await q(`SELECT evidence FROM ${S}.entity_links WHERE status = 'accepted' AND source_entity_id = $1`, [ids.c])
  assert.equal(ev[0].evidence.split_from, ids.lump)
  assert.equal((await q(`SELECT count(*)::int n FROM ${S}.assertions`))[0].n, before[0].n)
  // The kept record no longer holds two numbers; nothing left to split.
  assert.equal((await findLumped(q, S)).length, 0)
})
