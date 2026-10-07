/**
 * SEPA per permit, database tests (migration 031, lib/ships/permitSepaDb.js). DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * REAL rows: the BP Cherry Point ECHO DFRs + SEPA Register pages of facilities-db.test.js (fixtures/facilities-live-2026-10-06.json),
 * the recorded terminal rows (fixtures/terminals-live-2026-09-27.json), and the SEPA Register "All text" search for WAD069548154
 * (its one hit, 202002476, from fixtures/permit-sepa-live-2026-10-07.json). The BP entry is the real data-file entry trimmed to the
 * two FRS ids the fixture holds. No permit document is imported here, so no fact sheet is read (the pure tests cover that).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, parseCsv } from '../terminals.js'
import { loadFacilityData, ensureFacilitySources, importFacilities, terminalPermits, permitPage, sepaSearchUrl } from '../facilities.js'
import { importPermitSepa, planPermitSepa } from '../permitSepaDb.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('facilities-live-2026-10-06.json')
const sfx = fixture('permit-sepa-live-2026-10-07.json')
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
const data = { ...fdata, facilities: [{ ...bp, frs_related: bp.frs_related.filter((r) => r.id in fx.dfr) }], no_facility: [] }
const raw = () => ({
  dfr: new Map(Object.entries(fx.dfr)),
  sepa: new Map(['202303911', '201801445'].map((n) => [n, { ...fx.sepaRecords[n] }])),
  sepaHits: new Map([[bp.id, [{ sepa: '202303911', searches: ['Applicant: bp Cherry Point'] }, { sepa: '201801445', searches: ['Applicant: BP West Coast'] }]]]),
  ctRecordIds: new Map(),
})
// SYNTHETIC wrapper, REAL values: the record page of 202002476 rebuilt from its recorded, parsed fields (only the spans parseSepaRecord reads;
// the real page carries contact details we do not keep).
const span = (id, v) => (v == null ? '' : `<span id="MainContent_${id}">${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span>`)
const r476 = sfx.sepaRecords['202002476']
const page476 = { url: 'https://apps.ecology.wa.gov/separ/Main/SEPA/Record.aspx?SEPANumber=202002476', retrieved_at: '2026-10-07T00:00:00Z',
  html: [span('lblSepaNumber', r476.sepa), span('lblLeadAgency', r476.lead), span('lblCounty', r476.county), span('lblDocumentType', r476.type),
    span('lblIssuedDate', '05/13/2020'), span('lblProposalDescription', r476.description), span('lblApplicant', r476.applicant)].join('\n') }

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await withTx(pool, (c) => ensureFacilitySources(c, S))
  await withTx(pool, (c) => importTerminals(c, S, tdata, traw))
  await withTx(pool, (c) => importFacilities(c, S, data, raw()))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('plan + import: per-permit SEPA answers for BP (same project, names the permit, none found); idempotent', { skip }, async () => {
  const plan = await planPermitSepa(q, S, data)
  const keys = plan.map((x) => x.permit.permit_key)
  assert.ok(keys.includes('WAR313251') && keys.includes('WA0022900') && keys.includes('WANCA0005307310007'))
  assert.ok(!keys.includes('WAD069548154'), 'no Ecology permit document imported here: the RCRA id is a handler id, no SEPA answer')
  assert.ok(!keys.includes('1006468'), 'reporting ids get none')
  const permitSearch = new Map(plan.filter((x) => x.search).map((x) => [x.search, { url: sepaSearchUrl('All', x.search), hits: [] }]))
  const sraw = { docs: new Map(), permitSearch, sepa: new Map([['202002476', page476]]) }
  const r1 = await withTx(pool, (c) => importPermitSepa(c, S, data, sraw))
  assert.deepEqual(r1.problems, [])
  const rows = await q(`SELECT p.permit_key, ps.kind, ps.entity_key, ps.status, ps.method FROM ${S}.permit_sepa ps JOIN ${S}.permits p ON p.id = ps.permit_id
                         WHERE ps.status = 'accepted' ORDER BY 1, 2, 3`)
  const amp5 = rows.filter((r) => r.permit_key === 'WAR313251')
  assert.deepEqual(amp5.map((r) => `${r.kind}:${r.entity_key}:${r.method}`), ['review:202303911:same_project'])
  assert.deepEqual(rows.filter((r) => r.permit_key === 'WA0022900').map((r) => r.kind), ['none_found'], 'no fact sheet read here → none found, with the searches')
  const n1 = (await q(`SELECT count(*)::int AS n FROM ${S}.permit_sepa`))[0].n
  // Same inputs again: no new evidence, the same rows, nothing retired.
  const r2 = await withTx(pool, (c) => importPermitSepa(c, S, data, sraw))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(r2.retired, 0)
  assert.equal((await q(`SELECT count(*)::int AS n FROM ${S}.permit_sepa`))[0].n, n1)
  // A permit-number search hit is stored as evidence and links when the record names the permit (WAD069548154 needs its permit document
  // to get an answer, so here it is checked through the WA0022900 search instead: a hit that does not name WA0022900 links nothing).
  permitSearch.set('WA0022900', { url: sepaSearchUrl('All', 'WA0022900'), hits: ['202002476'] })
  const r3 = await withTx(pool, (c) => importPermitSepa(c, S, data, sraw))
  assert.equal(r3.recordsCreated, 1, 'the hit is stored as a SEPA record')
  assert.deepEqual((await q(`SELECT ps.kind FROM ${S}.permit_sepa ps JOIN ${S}.permits p ON p.id = ps.permit_id WHERE p.permit_key = 'WA0022900' AND ps.status = 'accepted'`)).map((r) => r.kind), ['none_found'])
})

test('read: the card gets each permit’s SEPA summary; the permit page the evidence or what was searched', { skip }, async () => {
  const card = await terminalPermits(q, S, 'wa-bp-cherry-point')
  const by = Object.fromEntries(card.facilities[0].permits.map((p) => [p.permit_key, p.sepa]))
  assert.deepEqual(by.WAR313251, { status: 'linked', reviews: 1 })
  assert.deepEqual(by.WA0022900, { status: 'none' })
  assert.equal(by['1006468'], null)
  const pg = await permitPage(q, S, 'WAR313251')
  assert.equal(pg.sepaPermit.reviews[0].sepa, '202303911')
  assert.equal(pg.sepaPermit.reviews[0].lead, 'Whatcom County')
  assert.equal(pg.sepaPermit.reviews[0].evidence[0].method, 'same_project')
  assert.equal(pg.sepaPermit.none, null)
  const np = await permitPage(q, S, 'WA0022900')
  assert.equal(np.sepaPermit.summary.status, 'none')
  assert.ok(np.sepaPermit.none.register.some((x) => x.what === 'All text: WA0022900'))
  assert.equal(np.sepaPermit.none.county, 'WHATCOM')
})
