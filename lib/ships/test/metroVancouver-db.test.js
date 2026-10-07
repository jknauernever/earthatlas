/**
 * Metro Vancouver air quality permits, database tests (lib/ships/metroVancouver.js). DEV database in SHIPS_DATABASE_URL, throwaway
 * schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * REAL: the Neptune and Richardson entries of lib/ships/data/salish-facilities.json and the recorded documents in
 * fixtures/mv-permits-live-2026-10-07.json. The facilities are imported with no BC register / NRCED / EAO input (those are
 * tested in bcPermits-db.test.js), and their terminals are not in this schema, so the dock-quote link is reported, not stored.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadFacilityData, ensureFacilitySources, permitPage } from '../facilities.js'
import { ensureBcSources, importBcFacilities } from '../bcPermits.js'
import { importMvPermits } from '../metroVancouver.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('mv-permits-live-2026-10-07.json')
const fdata = await loadFacilityData()
const data = { ...fdata, facilities: fdata.facilities.filter((f) => ['bc-neptune-site', 'bc-richardson-site'].includes(f.id)) }
const docs = () => new Map([fx.neptune, fx.richardsonApp, fx.richardsonNotice].map((d) => [d.url, d]))

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureFacilitySources(c, S))
  await withTx(pool, (c) => ensureBcSources(c, S))
  await withTx(pool, (c) => importBcFacilities(c, S, data, { ema: { url: 'x', rows: new Map() }, nrced: new Map(), eao: new Map() }, { partial: true }))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('import: a permit document and an application become MV-AQ permits with their documents; idempotent', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importMvPermits(c, S, data, docs()))
  assert.equal(r1.permits, 2)
  assert.equal(r1.documents, 3)
  assert.deepEqual(r1.problems, ['bc-neptune-site: terminal bc-neptune not in the database'])   // the quote itself was found in the text
  const ps = await q(`SELECT permit_key, statute, name, program_status, expires::text, detail FROM ${S}.permits WHERE epa_system = 'MV-AQ' ORDER BY permit_key`)
  assert.deepEqual(ps.map((p) => `${p.permit_key}:${p.program_status}:${p.expires}`), ['GVA0081:Issued:null', 'GVA0617:Renewal applied for:2025-11-30'])
  assert.equal(ps[0].name, 'Neptune Bulk Terminals (Canada) Ltd.')
  assert.equal(ps[1].detail.mv.application.gva, 'GVA1284')
  const [page] = await q(`SELECT sr.payload FROM ${S}.source_records sr JOIN ${S}.source_entities se ON se.id = sr.source_entity_id
                           WHERE se.entity_kind = 'mv_aq_document' AND se.entity_key LIKE '%GVA1284'`)
  assert.match(page.payload.text, /^Richardson International Limited/)
  assert.ok(page.payload.html.includes('GVA1284'))
  const n = async () => (await q(`SELECT (SELECT count(*) FROM ${S}.source_records) + (SELECT count(*) FROM ${S}.documents)
                                   + (SELECT count(*) FROM ${S}.document_links) + (SELECT count(*) FROM ${S}.permits) AS n`))[0].n
  const before2 = await n()
  const r2 = await withTx(pool, (c) => importMvPermits(c, S, data, docs()))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(await n(), before2)
})

test('a number or quote not in the document is reported and not stored', { skip }, async () => {
  const nep = data.facilities.find((f) => f.id === 'bc-neptune-site')
  // SYNTHETIC: the same entry claiming another number, and one quoting words the permit doesn't contain.
  const wrongNo = { ...data, facilities: [{ ...nep, bc: { ...nep.bc, mv: { ...nep.bc.mv, permits: [{ ...nep.bc.mv.permits[0], gva: 'GVA0999', covers: [] }] } } }] }
  const r = await withTx(pool, (c) => importMvPermits(c, S, wrongNo, docs()))
  assert.equal(r.permits, 0)
  assert.match(r.problems[0], /GVA0999 is not named in/)
  const wrongQuote = { ...data, facilities: [{ ...nep, bc: { ...nep.bc, mv: { ...nep.bc.mv, permits: [{ ...nep.bc.mv.permits[0], covers: [{ terminal: 'bc-neptune', where: 'x', says: 'loading of grain' }] }] } } }] }
  const r2 = await withTx(pool, (c) => importMvPermits(c, S, wrongQuote, docs()))
  assert.match(r2.problems[0], /quote not found/)
})

test('read: the permit page for an MV-AQ permit', { skip }, async () => {
  const r = await permitPage(q, S, 'GVA0081', 'MV-AQ')
  assert.equal(r.permit.system, 'MV-AQ')
  assert.equal(r.issuer, 'Metro Vancouver')
  assert.equal(r.permit.mv.amended, '2016-09-23')
  assert.deepEqual(r.facilities.map((f) => f.key), ['bc-neptune-site'])
  assert.equal(r.documents.length, 1)
  assert.equal(r.documents[0].type, 'Air quality permit')
  assert.deepEqual(r.enforcement, [])
  assert.deepEqual(r.sources.map((s) => s.id).sort(), ['earthatlas-facilities', 'metro-vancouver-aq-permits'])
  const a = await permitPage(q, S, 'GVA0617', 'MV-AQ')
  assert.deepEqual(a.documents.map((d) => d.type).sort(), ['Permit application', 'Permit application notice'])
})
