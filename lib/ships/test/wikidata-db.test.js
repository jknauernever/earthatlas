/**
 * Database tests for Wikidata (community-curated) ingestion and resolution.
 * DEV database in SHIPS_DATABASE_URL, throwaway schemas (ships_t_<random>) dropped
 * afterwards; never "ships", never production. Skipped (NOT RUN) without the URL.
 * Fixtures: real recorded Wikidata / GFW / MarineCadastre data, except where a
 * case is marked SYNTHETIC (test-only Q-ids ≥ Q900000000, MMSIs 36700090x).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensureMcSource, ingestMcMmsi } from '../ingestMc.js'
import { ensureWikidataSource, ingestWikidataItem } from '../ingestWikidata.js'
import { aggregateRows } from '../marinecadastre.js'
import { vesselsForMmsiAt, getVessel, getRecord } from '../queries.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S1 = `ships_t_${randomBytes(4).toString('hex')}` // NOAA first, then Wikidata, then GFW
const S2 = `ships_t_${randomBytes(4).toString('hex')}` // GFW first, then Wikidata
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const wdE = fixture('wd-live-eurodam-2026-09-25.json')
const wdM = fixture('wd-live-misc-2026-09-25.json')
const eurodam = () => structuredClone(wdE.response.entities.Q548546)
const gfwEurodam = () => fixture('gfw-live-eurodam-2026-09-25.json')
const mcEurodam = () => aggregateRows(readFileSync(new URL('./fixtures/mc-live-eurodam-2026-06.ndjson', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)))[0]
const count = async (S, t, where = 'true') => Number((await q(`SELECT count(*) FROM ${S}.${t} WHERE ${where}`))[0].count)

before(async () => {
  if (skip) return
  pool = shipsPool()
  for (const S of [S1, S2]) {
    await migrate(pool, S)
    await ensureGfwSource(pool, S); await ensureMcSource(pool, S); await ensureWikidataSource(pool, S)
  }
})
after(async () => {
  if (skip) return
  for (const S of [S1, S2]) await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('source registered with its licence: CC0, commercial use allowed, attribution "Wikidata"', { skip }, async () => {
  const [s] = await q(`SELECT license, commercial_use, attribution_text FROM ${S1}.sources WHERE id = 'wikidata'`)
  assert.deepEqual(s, { license: 'CC0 1.0', commercial_use: true, attribution_text: 'Wikidata' })
})

test('EURODAM, NOAA first: AIS-published IMO + MMSI + call sign corroborate → IMO_EXACT; GFW then joins the same vessel', { skip }, async () => {
  const m = await ingestMcMmsi(pool, S1, mcEurodam())
  const w = await ingestWikidataItem(pool, S1, eurodam(), wdE.lookup)
  // Decision 2026-09-25: an AIS-IMO attachment names its strongest corroboration.
  assert.deepEqual([w.resolution.action, w.resolution.method, w.resolution.vesselId], ['accept', 'IMO_AIS_MMSI', m.resolution.vesselId])
  assert.match(w.resolution.via, /^ais_imo\+mmsi\+callsign/)
  const g = await ingestGfwEntry(pool, S1, gfwEurodam())
  assert.equal(g.resolution.vesselId, m.resolution.vesselId)
  // All three views of its type sit side by side, each under its own evidence class.
  const types = await q(`SELECT DISTINCT evidence_class, value_norm FROM ${S1}.vessel_assertions
                          WHERE vessel_id = $1 AND attribute = 'vessel_type' ORDER BY 1, 2`, [m.resolution.vesselId])
  assert.ok(types.some((t) => t.evidence_class === 'community_curated' && t.value_norm === 'WD_Q39804'))
  assert.ok(types.some((t) => t.evidence_class === 'ais_published' && t.value_norm === 'AIS_60'))
  assert.ok(types.some((t) => t.evidence_class === 'inferred' && t.value_norm === 'PASSENGER'))
})

test('EURODAM, GFW first: a registry IMO needs no second identifier', { skip }, async () => {
  const g = await ingestGfwEntry(pool, S2, gfwEurodam())
  const w = await ingestWikidataItem(pool, S2, eurodam(), wdE.lookup)
  assert.deepEqual([w.resolution.action, w.resolution.vesselId, w.resolution.via], ['accept', g.resolution.vesselId, 'registry_imo'])
  const detail = await getVessel(q, S2, g.resolution.vesselId)
  const op = detail.assertions.find((a) => a.attribute === 'operator')
  assert.equal(op.value_raw, 'Holland America Line (Q1624735)')
  assert.equal(op.evidence_class, 'community_curated')
  // Traceability: the claim leads back to the exact Wikidata entity as received.
  const rec = await getRecord(q, S2, op.first_source_record_id)
  assert.equal(rec.source_id, 'wikidata'); assert.equal(rec.payload.id, 'Q548546')
  assert.ok(rec.payload.claims.P137.some((st) => st.id === op.sub_record_ref))
  assert.ok(detail.sources.some((s) => s.id === 'wikidata' && s.license === 'CC0 1.0'))
})

test('re-importing the same item changes nothing', { skip }, async () => {
  const before1 = { r: await count(S2, 'source_records'), a: await count(S2, 'assertions'), l: await count(S2, 'entity_links'), v: await count(S2, 'vessels') }
  for (let i = 0; i < 2; i++) {
    const r = await ingestWikidataItem(pool, S2, eurodam(), wdE.lookup)
    assert.deepEqual([r.recordCreated, r.assertions.created, r.assertions.superseded, r.resolution.action], [false, 0, 0, 'keep'])
  }
  assert.deepEqual({ r: await count(S2, 'source_records'), a: await count(S2, 'assertions'), l: await count(S2, 'entity_links'), v: await count(S2, 'vessels') }, before1)
})

test('a Wikidata edit is a new raw record; dropped statements are superseded, never deleted', { skip }, async () => {
  const e = eurodam()
  e.lastrevid += 1
  e.claims.P137 = [] // the operator statement removed in a later revision
  const r = await ingestWikidataItem(pool, S2, e, wdE.lookup)
  assert.equal(r.recordCreated, true)
  const ops = await q(`SELECT status FROM ${S2}.assertions WHERE source_entity_id = $1 AND attribute = 'operator'`, [r.entityId])
  assert.deepEqual(ops, [{ status: 'superseded' }])
  await ingestWikidataItem(pool, S2, eurodam(), wdE.lookup) // restated → active again
  assert.deepEqual(await q(`SELECT status FROM ${S2}.assertions WHERE source_entity_id = $1 AND attribute = 'operator'`, [r.entityId]), [{ status: 'active' }])
})

test('Wikidata never creates vessels: a company with an IMO company number and an unknown IMO stay unresolved', { skip }, async () => {
  const v0 = await count(S2, 'vessels')
  const c = await ingestWikidataItem(pool, S2, wdM.response.entities.Q5338367, wdM.lookup)
  assert.deepEqual([c.isVessel, c.resolution.action, c.resolution.reason], [false, 'unresolved', 'not_a_vessel'])
  const k = await ingestWikidataItem(pool, S2, wdM.response.entities.Q52331308, wdM.lookup) // Horizon Kodiak: IMO not in S2
  assert.deepEqual([k.resolution.action, k.resolution.reason], ['unresolved', 'no_vessel_with_imo'])
  assert.equal(await count(S2, 'vessels'), v0)
  // The evidence is still stored.
  assert.equal(await count(S2, 'source_records', `source_id = 'wikidata'`), 4)
})

test('an IMO on two vessels → unresolved with two candidates (SYNTHETIC NOAA rows around real Q135414827)', { skip }, async () => {
  const mk = (mmsi) => ({ mmsi, values: [{ attr: 'imo', value: '9043914', first: '2026-06-01T00:00:00.000Z', last: '2026-06-02T00:00:00.000Z', n: 1 }] })
  const a = await ingestMcMmsi(pool, S2, mk('367000901'))
  const b = await ingestMcMmsi(pool, S2, mk('367000902'))
  assert.notEqual(a.resolution.vesselId, b.resolution.vesselId)
  const w = await ingestWikidataItem(pool, S2, wdM.response.entities.Q135414827, wdM.lookup)
  assert.deepEqual([w.resolution.action, w.resolution.reason, w.resolution.candidates], ['unresolved', 'imo_on_several_vessels', 2])
})

test('a community-curated MMSI never resolves an AIS observation, even with dates (SYNTHETIC item)', { skip }, async () => {
  const e = eurodam()
  e.id = 'Q900000001'; e.lastrevid = 1
  const st = e.claims.P587[0]
  st.id = 'Q900000001$test-mmsi'
  st.mainsnak.datavalue.value = '367000999'
  st.qualifiers = { P580: [{ snaktype: 'value', property: 'P580', datavalue: { type: 'time',
    value: { time: '+2020-00-00T00:00:00Z', timezone: 0, before: 0, after: 0, precision: 9, calendarmodel: 'http://www.wikidata.org/entity/Q1985727' } } }] }
  const r = await ingestWikidataItem(pool, S2, e, wdE.lookup)
  assert.equal(r.resolution.action, 'accept') // same IMO as EURODAM → attaches there
  const [m] = await q(`SELECT period_kind FROM ${S2}.assertions WHERE source_entity_id = $1 AND attribute = 'mmsi'`, [r.entityId])
  assert.equal(m.period_kind, 'validity')
  assert.equal((await vesselsForMmsiAt(q, S2, '367000999', '2021-06-01T00:00:00Z')).status, 'unresolved')
  // EURODAM's real transmitted MMSI still resolves to exactly one vessel.
  assert.equal((await vesselsForMmsiAt(q, S2, '245206000', '2025-06-01T00:00:00Z')).status, 'resolved')
})

test('images: the claim carries its file licence and leads to the exact Commons response; link method exposed', { skip }, async () => {
  const { imageFiles } = await import('../wikidata.js')
  const { getVessel: gv, getRecord: gr } = await import('../queries.js')
  const c = fixture('commons-live-eurodam-2026-09-25.json')
  const e = eurodam()
  const pages = Object.fromEntries(imageFiles(e).map((f) => [f, Object.values(c.response.query.pages).find((p) => p.title === `File:${f}`)]))
  const r = await ingestWikidataItem(pool, S1, e, wdE.lookup, { commonsPages: pages, commonsUrl: c.request })
  assert.deepEqual(r.images.map((i) => i.status), ['kept', 'kept'])
  const v = await gv(q, S1, r.resolution.vesselId)
  const img = v.assertions.filter((a) => a.attribute === 'image')
  assert.equal(img.length, 2)
  assert.ok(img.every((a) => a.link_method === 'IMO_AIS_MMSI'))
  const sa = img.find((a) => a.detail.license_kind === 'cc_by_sa')
  const rec = await gr(q, S1, sa.detail.commons_record_id)
  assert.equal(rec.source_id, 'wikimedia-commons')
  assert.equal(rec.payload.imageinfo[0].extmetadata.LicenseShortName.value, 'CC BY-SA 4.0')
  assert.ok(v.sources.some((s) => s.id === 'wikidata'))
  // Re-import is a no-op, including the Commons records.
  const again = await ingestWikidataItem(pool, S1, e, wdE.lookup, { commonsPages: pages, commonsUrl: c.request })
  assert.deepEqual([again.recordCreated, again.assertions.created, again.assertions.superseded], [false, 0, 0])
  assert.equal(await count(S1, 'source_records', `source_id = 'wikimedia-commons'`), 2)
})
