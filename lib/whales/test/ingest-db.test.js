/**
 * Ingest against the real whales database, in a throwaway schema
 * (whales_t_<random>, dropped afterwards) — never "whales". There is no dev
 * database (Josh 2026-10-17), so these tests must stay schema-scoped.
 * Skipped (NOT RUN) without WHALES_DATABASE_URL. No network: the maplify and
 * salishsea feed readers are swapped for fakes serving real fixture rows whose
 * taxa are already known.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { whalesPool } from '../db.js'
import { migrate } from '../migrate.js'
import { runFeed, FEEDS } from '../ingest.js'
import { parseWhaleQuery, queryWhales } from '../query.js'
import * as maplify from '../feeds/maplify.js'
import * as salishsea from '../feeds/salishsea.js'

const F = JSON.parse(readFileSync(new URL('./fixtures/feeds-2026-10-17.json', import.meta.url), 'utf8'))
const url = process.env.WHALES_DATABASE_URL || ''
const skip = !url ? 'WHALES_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `whales_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const ORCA = { inat_id: 41521, scientific: 'Orcinus orca', common: 'Orca', ancestors: [48460, 1, 2, 355675, 40151, 848317, 152870, 925158, 152871, 41482, 41520] }
const DAY = '2026-10-11'
const K = (id) => `maplify:${F.maplify[0].source}:${id}`

const serve = { maplify: [], salishsea: [] }
const real = { maplify: FEEDS.maplify, salishsea: FEEDS.salishsea }
const fake = (name) => ({ fetchWindow: async () => ({ records: structuredClone(serve[name]), coveredDays: [DAY] }) })

function mp(id, hour = 10) {
  const r = maplify.normalizeRow({ ...F.maplify[0], id, created: `${DAY} ${hour}:00:00` })
  r.norm.taxon = ORCA
  return r
}

function ssCopy(id, observer) {
  const r = salishsea.normalizeRow({ ...F.salishsea.maplify, id: `maplify:${id}`, attribution: `cascadiaWebMap on ${F.maplify[0].source}`, observer, collection: 'Orca Network' }, DAY)
  r.norm.taxon = ORCA
  return r
}

before(async () => {
  if (skip) return
  FEEDS.maplify = fake('maplify')
  FEEDS.salishsea = fake('salishsea')
  pool = whalesPool()
  await migrate(pool, S)
})
after(async () => {
  FEEDS.maplify = real.maplify
  FEEDS.salishsea = real.salishsea
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('ingest: insert, merge with the SalishSea.io copy, no-op re-run', { skip }, async () => {
  serve.maplify = [mp(900001), mp(900002, 11)]
  serve.salishsea = [ssCopy(900001, 'Curated Observer')]
  const a = await runFeed(pool, S, 'maplify', DAY, DAY)
  const b = await runFeed(pool, S, 'salishsea', DAY, DAY)
  assert.equal(a.inserted, 2)
  assert.equal(b.inserted, 1)
  const [s] = await q(`SELECT via, observer, animal_group, quality, removed_at FROM ${S}.sightings WHERE key = '${K(900001)}'`)
  assert.deepEqual(s.via, ['maplify', 'salishsea'])
  assert.equal(s.observer, 'Curated Observer')
  assert.equal(s.animal_group, 'cetacean')
  assert.equal(s.removed_at, null)
  const again = await runFeed(pool, S, 'maplify', DAY, DAY)
  assert.deepEqual([again.inserted, again.changed, again.removed, again.rebuilt], [0, 0, 0, 0])
})

test('ingest: a record the feed stops returning is removed, and comes back if it returns', { skip }, async () => {
  serve.maplify = [mp(900001)]
  const r = await runFeed(pool, S, 'maplify', DAY, DAY)
  assert.equal(r.removed, 1)
  const [gone] = await q(`SELECT removed_at FROM ${S}.sightings WHERE key = '${K(900002)}'`)
  assert.ok(gone.removed_at, 'maplify:900002 removed')
  const [kept] = await q(`SELECT removed_at FROM ${S}.sightings WHERE key = '${K(900001)}'`)
  assert.equal(kept.removed_at, null)
  serve.maplify = [mp(900001), mp(900002, 11)]
  await runFeed(pool, S, 'maplify', DAY, DAY)
  const [back] = await q(`SELECT removed_at FROM ${S}.sightings WHERE key = '${K(900002)}'`)
  assert.equal(back.removed_at, null)
})

test('ingest: an empty answer for a busy window is treated as an outage', { skip }, async () => {
  serve.maplify = Array.from({ length: 8 }, (_, i) => mp(910000 + i, 10 + i))
  await runFeed(pool, S, 'maplify', DAY, DAY)
  serve.maplify = []
  const r = await runFeed(pool, S, 'maplify', DAY, DAY)
  assert.equal(r.removed, 0)
  assert.match(r.note, /removal skipped/)
  const [{ n }] = await q(`SELECT count(*)::int n FROM ${S}.records WHERE feed = 'maplify' AND removed_at IS NULL`)
  assert.equal(n, 8)
  const [run] = await q(`SELECT ok, note FROM ${S}.ingest_runs ORDER BY id DESC LIMIT 1`)
  assert.equal(run.ok, true)
})

test('query: what /api/whales returns for this data — newest first, credited, taxon subtree', { skip }, async () => {
  const q = (qs) => parseWhaleQuery(new URLSearchParams(qs), '2026-10-17').q
  const all = await queryWhales(pool, q(`bbox=-180,-90,180,90&from=${DAY}&to=${DAY}`), S)
  // 8 still served by Maplify + maplify:900001, which Maplify dropped but SalishSea.io still carries.
  assert.equal(all.total, 9)
  assert.deepEqual(all.sources.map((s) => s.id), ['maplify'])
  assert.equal(all.sources[0].label, 'Whale Alert')
  const s = all.sightings[0]
  assert.equal(s.taxon.id, 41521)
  assert.equal(s.taxon.group, 'cetacean')
  assert.equal(s.license, 'CC-BY-4.0')
  assert.ok(s.channel && s.attribution, 'every sighting carries its credit')
  assert.ok(all.sightings.every((x, i, a) => i === 0 || a[i - 1].observed_date >= x.observed_date), 'newest first')
  // Cetacea (152871) is an ancestor of Orcinus orca → included; a different taxon → nothing.
  assert.equal((await queryWhales(pool, q(`taxon=152871&from=${DAY}&to=${DAY}`), S)).total, all.total)
  assert.equal((await queryWhales(pool, q(`taxon=41566&from=${DAY}&to=${DAY}`), S)).total, 0)
  assert.equal((await queryWhales(pool, q(`bbox=-180,-90,180,90&from=${DAY}&to=${DAY}&exclude=maplify`), S)).total, 0)
  const lim = await queryWhales(pool, q(`bbox=-180,-90,180,90&from=${DAY}&to=${DAY}&limit=2`), S)
  assert.equal(lim.count, 2)
  assert.equal(lim.truncated, true)
})
