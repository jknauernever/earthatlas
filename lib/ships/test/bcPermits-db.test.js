/**
 * BC permits pilot, database tests (migration 027, lib/ships/bcPermits.js). DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * REAL rows: fixtures/bc-permits-live-2026-10-07.json (BC EMA register rows, NRCED + EAO searches) and the recorded terminal rows
 * of terminals-db.test.js (fixtures/terminals-live-2026-09-27.json, which hold bc-westridge and bc-westshore). The facility
 * entries are the real BC entries of lib/ships/data/salish-facilities.json.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { rowsToObjects } from '../xlsx.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { loadFacilityData, importFacilities, ensureFacilitySources, terminalPermits, permitPage } from '../facilities.js'
import { ensureBcSources, importBcFacilities, nrcedRecords, eaoProjects } from '../bcPermits.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('bc-permits-live-2026-10-07.json')
const tfx = fixture('terminals-live-2026-09-27.json')
const full = await loadTerminalData()
const tdata = { main: { ...full.main, terminals: full.main.terminals.filter((t) => tfx.terminals.includes(t.id)) },
  osm: { ...full.osm, berths: full.osm.berths.filter((b) => tfx.terminals.includes(b.terminal)) } }
const traw = {
  usace: tfx.usace.features, ecology: tfx.ecology.features, bcpt: tfx.bcpt.features,
  osm: { elements: tfx.osm.elements, osmBase: tfx.osm.osm_base }, gem: parseCsv(tfx.gem.csv), ctRefinery: tfx.ct_refinery.features,
  release: tfx.ct_refinery.release, urls: {},
}
const fdata = await loadFacilityData()
const data = { ...fdata, facilities: fdata.facilities.filter((f) => f.country === 'CA') }
const raw = () => {
  const rows = new Map(rowsToObjects([fx.ema.header, ...fx.ema.rows]).map((o) => [o['Authorization Number'], o]))
  const nrced = new Map(), eao = new Map()
  for (const f of data.facilities) {
    nrced.set(f.id, f.bc.nrced.searches.map((s) => ({ search: s, url: fx.nrced[s].url, retrieved_at: fx.nrced[s].retrieved_at, ...nrcedRecords(fx.nrced[s].body) })))
    eao.set(f.id, f.bc.eao.searches.map((s) => ({ search: s, url: fx.eao[s].url, retrieved_at: fx.eao[s].retrieved_at, projects: eaoProjects(fx.eao[s].body) })))
  }
  return { ema: { url: fx.ema.url, retrieved_at: fx.ema.retrieved_at, rows }, nrced, eao }
}

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => ensureFacilitySources(c, S))
  await withTx(pool, (c) => ensureBcSources(c, S))
  await withTx(pool, (c) => importTerminals(c, S, tdata, traw))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('import: 2 BC facilities, EMA permits, NRCED records + files, EAO projects, terminal links; idempotent', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importBcFacilities(c, S, data, raw()))
  assert.deepEqual(r1.problems, [])
  assert.equal(r1.facilities, 2)
  assert.equal(r1.ema, 5)
  assert.equal(r1.nrcedAccepted, 7)
  assert.equal(r1.nrcedCandidates, 0)
  assert.equal(r1.nrcedIgnored, 2)
  assert.equal(r1.eaoAccepted, 1)
  assert.equal(r1.eaoCandidates, 1)
  const permits = await q(`SELECT epa_system, permit_key, statute, universe, program_status, expires::text, frs_ids FROM ${S}.permits ORDER BY permit_key`)
  assert.deepEqual(permits.map((p) => `${p.epa_system}:${p.permit_key}:${p.program_status}`),
    ['BC-EMA:109085:Expired', 'BC-EMA:14058:Active', 'BC-EMA:16534:Active', 'BC-EMA:3678:Active', 'BC-EMA:6819:Active'])
  assert.equal(permits.find((p) => p.permit_key === '109085').expires, '2020-02-15')
  const links = await q(`SELECT f.key, l.role, l.entity_key, l.status FROM ${S}.facility_links l JOIN ${S}.facilities f ON f.id = l.facility_id ORDER BY 1, 2, 3`)
  assert.deepEqual(links.filter((l) => l.role === 'eao_project').map((l) => `${l.entity_key}:${l.status}`),
    ['58851022aaecd9001b80b9e6:candidate', '5885121eaaecd9001b82b274:accepted'])
  // Raw evidence: the register row exactly as read; the NRCED record without "score".
  const [row] = await q(`SELECT sr.payload FROM ${S}.source_records sr JOIN ${S}.source_entities se ON se.id = sr.source_entity_id
                          WHERE se.source_id = 'bc-ema-authorizations' AND se.entity_key = '6819'`)
  assert.equal(row.payload.Longitude, fx.ema.rows.find((r) => r[0] === '6819')[19])
  // NRCED files: linked to the permit whose number the record names; the dangerous-goods inspection (no EMA number) to the facility.
  const dl = await q(`SELECT d.title, l.method, p.permit_key FROM ${S}.document_links l JOIN ${S}.documents d ON d.id = l.document_id
                        LEFT JOIN ${S}.permits p ON p.id = l.permit_id ORDER BY d.title`)
  assert.equal(dl.length, 7)
  assert.deepEqual(dl.filter((x) => x.method === 'nrced_facility').map((x) => x.title), ['2023-05-12_IR206339_DGIR231070_Advisory.pdf'])
  assert.equal(dl.find((x) => x.title === '2025-03-31_IR239355_Warning_FINAL_.pdf').permit_key, '3678')
  const n = async () => (await q(`SELECT (SELECT count(*) FROM ${S}.permits) + (SELECT count(*) FROM ${S}.facility_links)
                                    + (SELECT count(*) FROM ${S}.documents) + (SELECT count(*) FROM ${S}.document_links) AS n`))[0].n
  const before2 = await n()
  const r2 = await withTx(pool, (c) => importBcFacilities(c, S, data, raw()))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(await n(), before2)
})

test('read: the Westridge card gets BC permits (with why), NRCED records and the EAO project; candidates hidden', { skip }, async () => {
  const r = await terminalPermits(q, S, 'bc-westridge')
  assert.equal(r.facilities.length, 1)
  const f = r.facilities[0]
  assert.equal(f.country, 'CA')
  assert.deepEqual(f.frs, [])
  assert.deepEqual(f.permits.map((p) => p.permit_key).sort(), ['109085', '14058', '3678'])
  const p3678 = f.permits.find((p) => p.permit_key === '3678')
  assert.equal(p3678.bcEma.issued, '1974-10-18')
  assert.match(p3678.bcEma.why, /Westridge Marine Terminal/)
  assert.equal(p3678.documents.length, 2)
  assert.deepEqual(f.bc.nrced.map((x) => x.date), ['2025-04-01', '2024-04-04', '2018-11-14'])
  assert.deepEqual(f.bc.eao.map((x) => x.name), ['Trans Mountain Expansion (TMX)'])
  assert.deepEqual(f.sepa, [])
  assert.deepEqual(r.sources.map((s) => s.id).sort(), ['bc-eao-epic', 'bc-ema-authorizations', 'bc-nrced', 'earthatlas-facilities'])
  const s = (await terminalPermits(q, S, 'bc-westshore')).facilities[0]
  assert.deepEqual(s.bc.eao, [])
  assert.match(s.bc.eaoNone, /No BC EAO project with Westshore as proponent/)
  assert.equal(s.bc.nrced.length, 4)
})

test('read: the permit page for a BC authorization shows its NRCED inspections and files', { skip }, async () => {
  const r = await permitPage(q, S, '6819', 'BC-EMA')
  assert.equal(r.permit.system, 'BC-EMA')
  assert.equal(r.permit.bcEma.issued, '1983-06-28')
  assert.equal(r.issuer, null)   // the register does not name the issuing office
  assert.deepEqual(r.facilities.map((f) => f.key), ['bc-westshore-terminals'])
  assert.deepEqual(r.enforcement.map((x) => `${x.date}:${x.result}`), ['2019-02-12:Out of Compliance - Advisory', '2018-02-06:Out of Compliance - Warning 120(6)'])
  assert.equal(r.documents.length, 2)
  assert.equal(r.listings.length, 1)
  assert.equal(r.sepaLead, null)
  assert.deepEqual(r.sources.map((x) => x.id).sort(), ['bc-ema-authorizations', 'bc-nrced', 'earthatlas-facilities'])
})

test('a Washington import never withdraws BC facilities (and vice versa)', { skip }, async () => {
  await withTx(pool, (c) => importFacilities(c, S, { ...fdata, facilities: [] }, { dfr: new Map(), sepa: new Map(), sepaHits: new Map() }))
  assert.deepEqual((await q(`SELECT DISTINCT list_status FROM ${S}.facilities WHERE country = 'CA'`)).map((x) => x.list_status), ['listed'])
  await withTx(pool, (c) => importBcFacilities(c, S, { ...data, facilities: data.facilities.filter((f) => f.id === 'bc-westshore-terminals') }, raw()))
  assert.deepEqual((await q(`SELECT key, list_status FROM ${S}.facilities ORDER BY key`)).map((x) => `${x.key}:${x.list_status}`),
    ['bc-westridge-marine-terminal:withdrawn', 'bc-westshore-terminals:listed'])
})
