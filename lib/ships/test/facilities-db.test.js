/**
 * Facilities pilot, database tests (migration 022, lib/ships/facilities.js). DEV database in SHIPS_DATABASE_URL, throwaway
 * schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * REAL rows: ECHO DFRs + SEPA Register pages recorded 2026-10-06 (fixtures/facilities-live-2026-10-06.json) and the recorded
 * terminal rows of terminals-db.test.js (fixtures/terminals-live-2026-09-27.json). The BP entry is the real data-file entry
 * trimmed to the two FRS ids the fixture holds.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { loadFacilityData, ensureFacilitySources, importFacilities, terminalPermits, permitPage } from '../facilities.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('facilities-live-2026-10-06.json')
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
const bp = fdata.facilities.find((f) => f.id === 'wa-bp-cherry-point-refinery')
const data = { ...fdata, facilities: [{ ...bp, frs_related: bp.frs_related.filter((r) => r.id in fx.dfr) }] }
const raw = () => ({
  dfr: new Map(Object.entries(fx.dfr)),
  sepa: new Map(['202303911', '201801445'].map((n) => [n, { ...fx.sepaRecords[n] }])),
  sepaHits: new Map([[bp.id, [{ sepa: '202303911', searches: ['Applicant: bp Cherry Point'] }, { sepa: '201801445', searches: ['Applicant: BP West Coast'] }]]]),
  ctRecordIds: new Map(),
})

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => ensureFacilitySources(c, S))
  await withTx(pool, (c) => importTerminals(c, S, tdata, traw))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('import: facility, FRS links, permits, SEPA accepted + candidate, terminal link; idempotent', { skip }, async () => {
  const ctRec = await q(`SELECT max(sr.id) AS id FROM ${S}.source_entities se JOIN ${S}.source_records sr ON sr.source_entity_id = se.id
                          WHERE se.source_id = 'climate-trace' AND se.entity_key = '1753291'`)
  const r1 = await withTx(pool, (c) => importFacilities(c, S, data, { ...raw(), ctRecordIds: new Map([[1753291, Number(ctRec[0].id)]]) }))
  assert.deepEqual(r1.problems, [])
  assert.equal(r1.facilities, 1)
  assert.equal(r1.frsRecords, 2)
  assert.equal(r1.sepaAccepted, 1)
  assert.equal(r1.sepaCandidates, 1)
  const [f] = await q(`SELECT * FROM ${S}.facilities`)
  assert.equal(f.key, bp.id)
  assert.ok(Math.abs(f.lat - 48.891937) < 1e-6)
  const links = await q(`SELECT role, entity_key, status, method FROM ${S}.facility_links ORDER BY role, entity_key`)
  assert.deepEqual(links.map((l) => `${l.role}:${l.entity_key}:${l.status}`), [
    'ct_refinery:1753291:accepted', 'epa_frs_primary:110070752633:accepted', 'epa_frs_related:110071668371:accepted',
    'sepa_review:201801445:candidate', 'sepa_review:202303911:accepted'])
  const [npdes] = await q(`SELECT * FROM ${S}.permits WHERE permit_key = 'WA0022900'`)
  assert.equal(npdes.epa_system, 'ICIS-NPDES')
  assert.deepEqual(npdes.frs_ids, ['110070752633'])
  const [tf] = await q(`SELECT count(*)::int AS n FROM ${S}.terminal_facilities`)
  assert.equal(tf.n, 1)
  const permits1 = (await q(`SELECT count(*)::int AS n FROM ${S}.permits`))[0].n
  // Same payloads again: no new evidence, no duplicate rows.
  const r2 = await withTx(pool, (c) => importFacilities(c, S, data, { ...raw(), ctRecordIds: new Map([[1753291, Number(ctRec[0].id)]]) }))
  assert.equal(r2.recordsCreated, 0)
  assert.equal((await q(`SELECT count(*)::int AS n FROM ${S}.permits`))[0].n, permits1)
  assert.equal((await q(`SELECT count(*)::int AS n FROM ${S}.facility_links`))[0].n, 5)
})

test('read: the terminal card gets the facility, permits, enforcement and accepted SEPA reviews only', { skip }, async () => {
  const r = await terminalPermits(q, S, 'wa-bp-cherry-point')
  assert.equal(r.facilities.length, 1)
  const f = r.facilities[0]
  assert.equal(f.name, 'BP Cherry Point Refinery')
  assert.equal(f.frs.length, 2)
  assert.ok(f.frs.find((x) => x.primary).enforcement.notices.length > 0)
  assert.ok(f.permits.some((p) => p.permit_key === 'WA0022900'))
  assert.deepEqual(f.sepa.map((x) => x.sepa), ['202303911'])
  assert.equal(f.sepaCandidates, 1)
  assert.equal(f.sepa[0].fileNumber, 'SEPA2023-00051')
  assert.deepEqual(r.sources.map((s) => s.id).sort(), ['earthatlas-facilities', 'epa-echo', 'wa-ecology-sepa-register'])
  // A terminal with no facility: empty list, not an error. An unknown terminal: null.
  assert.deepEqual((await terminalPermits(q, S, 'bc-westridge')).facilities, [])
  assert.equal(await terminalPermits(q, S, 'wa-nope'), null)
})

test('permit page: the permit, its facility and dock, enforcement filed against its id only', { skip }, async () => {
  const r = await permitPage(q, S, 'WA0022900')
  assert.equal(r.permit.system, 'ICIS-NPDES')
  assert.equal(r.permit.expires, '2027-06-30')
  assert.deepEqual(r.facilities.map((f) => f.key), ['wa-bp-cherry-point-refinery'])
  assert.deepEqual(r.facilities[0].terminals.map((t) => t.key), ['wa-bp-cherry-point'])
  assert.ok(r.enforcement.every((x) => x.permit_key === 'WA0022900'))
  assert.deepEqual(r.documents, [])   // no document listing imported in this test
  assert.equal(r.issuer, null)
  assert.equal(await permitPage(q, S, 'WA9999999'), null)
})

test('a partial (--only) import never withdraws the facilities it was not given', { skip }, async () => {
  const other = { ...data.facilities[0], id: 'wa-test-other-facility', name: 'TEST other facility (synthetic id, real BP records)' }
  await withTx(pool, (c) => importFacilities(c, S, { ...data, facilities: [other] }, raw(), { partial: true }))
  const [bp] = await q(`SELECT list_status FROM ${S}.facilities WHERE key = 'wa-bp-cherry-point-refinery'`)
  assert.equal(bp.list_status, 'listed')
  await withTx(pool, (c) => importFacilities(c, S, data, raw()))   // a full run withdraws what the file no longer lists
  const [o] = await q(`SELECT list_status FROM ${S}.facilities WHERE key = 'wa-test-other-facility'`)
  assert.equal(o.list_status, 'withdrawn')
})
