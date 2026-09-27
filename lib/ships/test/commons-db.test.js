/**
 * Database tests for Commons ship photos (IMO categories). DEV database in
 * SHIPS_DATABASE_URL, throwaway schemas (ships_t_<random>) dropped afterwards; never
 * "ships", never production. Skipped (NOT RUN) without the URL.
 * Commons responses: REAL, recorded live (commons-live-imo-2026-09-27.json), replayed.
 * The vessels are SYNTHETIC: the real GFW / NOAA EURODAM fixtures with their IMO
 * swapped to 9509401 (JUPITER SPIRIT), because we hold no GFW record for that ship.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensureMcSource, ingestMcMmsi } from '../ingestMc.js'
import { ensureCommonsSource, fetchImo, ingestImo, commonsPlan, vesselImages } from '../ingestCommons.js'
import { aggregateRows } from '../marinecadastre.js'
import { getVessel, getRecord } from '../queries.js'
import { imoCategory, parseImoCategory } from '../commons.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S1 = `ships_t_${randomBytes(4).toString('hex')}` // registry IMO 9509401 (SYNTHETIC GFW)
const S2 = `ships_t_${randomBytes(4).toString('hex')}` // AIS-only IMO 9509401 (SYNTHETIC NOAA)
const S3 = `ships_t_${randomBytes(4).toString('hex')}` // real GFW EURODAM, freshness check
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const rec = fixture('commons-live-imo-2026-09-27.json')
const catPage = (imo) => rec.categoryInfo.response.query.pages.find((p) => p.title === imoCategory(imo))
const pre = (imo) => ({ request: rec.categoryInfo.request, page: catPage(imo) })
const replay = {
  async members(title) { return (rec.byImo[parseImoCategory(title).imo]?.members || []).map((x) => ({ url: x.request, body: x.response })) },
  async files(cat) {
    for (const e of Object.values(rec.byImo)) if (e.files[cat]) return e.files[cat].map((x) => ({ url: x.request, body: x.response }))
    return []
  },
}
const swap = (s) => s.replaceAll('9378448', '9509401')
const gfwJupiter = () => JSON.parse(swap(readFileSync(new URL('./fixtures/gfw-live-eurodam-2026-09-25.json', import.meta.url), 'utf8')))
const mcJupiter = () => aggregateRows(swap(readFileSync(new URL('./fixtures/mc-live-eurodam-2026-06.ndjson', import.meta.url), 'utf8'))
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)))[0]
const count = async (S, t, where = 'true') => Number((await q(`SELECT count(*) FROM ${S}.${t} WHERE ${where}`))[0].count)

before(async () => {
  if (skip) return
  pool = shipsPool()
  for (const S of [S1, S2, S3]) {
    await migrate(pool, S)
    await ensureGfwSource(pool, S); await ensureMcSource(pool, S); await ensureCommonsSource(pool, S)
  }
})
after(async () => {
  if (skip) return
  for (const S of [S1, S2, S3]) await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('source registered with a per-file licence', { skip }, async () => {
  const [s] = await q(`SELECT name, license, commercial_use FROM ${S1}.sources WHERE id = 'wikimedia-commons'`)
  assert.equal(s.name, 'Wikimedia Commons (ship photos)')
  assert.match(s.license, /^Per file/)
})

test('SYNTHETIC registry IMO 9509401 + real Commons responses: photos attach by IMO_EXACT, evidence kept, idempotent', { skip }, async () => {
  const g = await ingestGfwEntry(pool, S1, gfwJupiter())
  const vid = g.resolution.vesselId
  assert.equal((await commonsPlan(q, S1, vid)).status, 'fetch')
  const r = await ingestImo(pool, S1, await fetchImo(replay, '9509401', { pre: pre('9509401') }))
  assert.deepEqual([r.exists, r.resolution.action, r.resolution.method, r.resolution.vesselId], [true, 'accept', 'IMO_EXACT', vid])
  const imgs = await vesselImages(q, S1, vid)
  assert.equal(imgs.length, 2)
  assert.ok(imgs.every((a) => a.source_id === 'wikimedia-commons' && a.evidence_class === 'community_curated'))
  // Each photo's licence traces to that file's own page object, as received.
  const best = imgs.find((a) => a.detail.best)
  const fileRec = await getRecord(q, S1, best.detail.commons_record_id)
  assert.equal(fileRec.payload.title, `File:${best.value_raw}`)
  assert.equal(fileRec.payload.imageinfo[0].extmetadata.LicenseShortName.value, best.detail.license_short_name)
  // The category's own record keeps every response we used.
  const catRec = await getRecord(q, S1, best.last_source_record_id)
  assert.equal(catRec.payload.category, 'Category:IMO 9509401')
  assert.equal(catRec.payload.responses.length, 3)
  // The card sees them; no IMO claim was added from Commons (identity untouched).
  const v = await getVessel(q, S1, vid)
  assert.equal(v.assertions.filter((a) => a.attribute === 'image').length, 2)
  assert.equal(v.assertions.filter((a) => a.source_id === 'wikimedia-commons' && a.attribute !== 'image').length, 0)
  assert.equal((await commonsPlan(q, S1, vid)).status, 'has_photo')
  // Re-import: same records, same claims.
  const before = [await count(S1, 'source_records'), await count(S1, 'assertions'), await count(S1, 'entity_links')]
  const again = await ingestImo(pool, S1, await fetchImo(replay, '9509401', { pre: pre('9509401') }))
  assert.equal(again.resolution.action, 'keep')
  assert.deepEqual([await count(S1, 'source_records'), await count(S1, 'assertions'), await count(S1, 'entity_links')], before)
  assert.deepEqual([again.assertions.created, again.assertions.seen, again.assertions.superseded], [0, 2, 0])
})

test('SYNTHETIC AIS-only IMO 9509401: Commons photos stay unattached (registry IMO required)', { skip }, async () => {
  const m = await ingestMcMmsi(pool, S2, mcJupiter())
  assert.equal((await commonsPlan(q, S2, m.resolution.vesselId)).status, 'no_registry_imo')
  const r = await ingestImo(pool, S2, await fetchImo(replay, '9509401', { pre: pre('9509401') }))
  assert.deepEqual([r.resolution.action, r.resolution.reason], ['unresolved', 'imo_only_ais_reported'])
  assert.equal((await vesselImages(q, S2, m.resolution.vesselId)).length, 0)
  assert.equal(await count(S2, 'entity_links', `method = 'IMO_EXACT' AND source_entity_id IN (SELECT id FROM ${S2}.source_entities WHERE source_id = 'wikimedia-commons')`), 0)
})

test('a checked IMO with no Commons category counts as fresh for 30 days (SYNTHETIC "missing" page for EURODAM)', { skip }, async () => {
  const g = await ingestGfwEntry(pool, S3, fixture('gfw-live-eurodam-2026-09-25.json'))
  const vid = g.resolution.vesselId
  assert.equal((await commonsPlan(q, S3, vid)).status, 'fetch')
  const r = await ingestImo(pool, S3, await fetchImo(replay, '9378448',
    { pre: { request: 'synthetic', page: { ns: 14, title: 'Category:IMO 9378448', missing: true } } }))
  assert.deepEqual([r.exists, r.resolution.reason, r.assertions.created], [false, 'no_category', 0])
  const plan = await commonsPlan(q, S3, vid)
  assert.deepEqual([plan.status, plan.imo], ['checked_recently', '9378448'])
  await q(`UPDATE ${S3}.source_entities SET last_seen_at = now() - interval '31 days' WHERE entity_key = 'Category:IMO 9378448'`)
  assert.equal((await commonsPlan(q, S3, vid)).status, 'fetch')
  assert.equal((await commonsPlan(q, S3, '00000000-0000-0000-0000-000000000000')).status, 'not_found')
})
