/**
 * GFW ship records (lib/ships/gfwAis.js), database tests. DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * Vessels: REAL 4Wings-derived rows (fixtures/gfw4w-vessels-salish-2026-08-01.json); EURODAM's REAL GFW registry entry
 * (fixtures/gfw-live-eurodam-2026-09-25.json).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { mergeMonths, ensureGfwAisSource, ingestGfwAisVessel, knownPayloads, payloadHash } from '../gfwAis.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const { vessels } = fixture('gfw4w-vessels-salish-2026-08-01.json')
const merged = mergeMonths([vessels])
const byName = (n) => merged.find((v) => v.values.some((x) => x.attr === 'name' && x.value === n))
const gfwEurodam = () => JSON.parse(readFileSync(new URL('./fixtures/gfw-live-eurodam-2026-09-25.json', import.meta.url), 'utf8'))

before(async () => {
  if (skip) return
  pool = shipsPool(url)
  await migrate(pool, S); await ensureGfwSource(pool, S); await ensureGfwAisSource(pool, S)
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`); await pool.end()
})

test('a ship we do not hold (SALISH SEA GLORY) becomes a new EarthAtlas vessel with its broadcast identity', { skip }, async () => {
  const r = await ingestGfwAisVessel(pool, S, byName('SALISH SEA GLORY'))
  assert.equal(r.action, 'new')
  const { rows } = await pool.query(`SELECT attribute, value_raw, evidence_class FROM ${S}.vessel_assertions va
    JOIN ${S}.source_entities se ON se.id = va.source_entity_id WHERE se.source_id = 'gfw-4wings-ais' AND se.entity_key = $1`, [byName('SALISH SEA GLORY').vid])
  const got = Object.fromEntries(rows.map((x) => [x.attribute, x.value_raw]))
  assert.equal(got.name, 'SALISH SEA GLORY'); assert.equal(got.mmsi, '316059231'); assert.equal(got.flag, 'CAN')
})

test('a ship we already hold (EURODAM, from the GFW registry) links to it instead of a new vessel', { skip }, async () => {
  const g = await ingestGfwEntry(pool, S, gfwEurodam())
  const before = (await pool.query(`SELECT count(*)::int n FROM ${S}.vessels`)).rows[0].n
  const r = await ingestGfwAisVessel(pool, S, byName('EURODAM'))
  const after = (await pool.query(`SELECT count(*)::int n FROM ${S}.vessels`)).rows[0].n
  assert.notEqual(r.action, 'new', `resolver said ${r.action}:${r.method}`)
  assert.equal(after, before)
  assert.ok(g)
})

test('re-import of unchanged vessels: payload already known, no new record version', { skip }, async () => {
  const v = byName('SALISH SEA GLORY')
  const known = await knownPayloads(pool, S, [payloadHash(v)])
  assert.ok(known.has(payloadHash(v)))
  const r = await ingestGfwAisVessel(pool, S, v)
  assert.equal(r.recordCreated, false)
})
