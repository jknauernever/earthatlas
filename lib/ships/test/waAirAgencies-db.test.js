/**
 * WA local clean air agencies, database tests (lib/ships/waAirAgencies.js). DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * REAL: the Puget LNG and Kinder Morgan entries of lib/ships/data/wa-air-permits.json and the recorded documents in
 * fixtures/wa-air-live-2026-10-07.json. SYNTHETIC: the facility row is inserted bare (no EPA records), Puget LNG's entry is cut
 * to Order 11386A without its listing page (the page is not in the fixture), and the terminals are not in this schema, so the
 * dock quote is reported, not stored.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { findOrCreateEntity, upsertRecord } from '../store.js'
import { ensureFacilitySources, FACILITIES_LIST_SOURCE, permitPage } from '../facilities.js'
import { importWaAir, airSearchesFor } from '../waAirAgencies.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('wa-air-live-2026-10-07.json')
const full = JSON.parse(await readFile(new URL('../data/wa-air-permits.json', import.meta.url), 'utf8'))
const puget = full.entries.find((e) => e.terminal === 'wa-puget-lng-tacoma')
const km = full.entries.find((e) => e.terminal === 'wa-km-harbor-island')
const p11386A = { ...puget.permits.find((p) => p.number === '11386A') }
delete p11386A.page_url
const data = { ...full, entries: [{ ...puget, permits: [p11386A] }, km] }
const docs = () => new Map([fx.order11386A, fx.draft12449].map((d) => [d.url, d]))

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, async (c) => {
    await ensureFacilitySources(c, S)
    const ent = await findOrCreateEntity(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, kind: 'facility_entry', anchor: 'wa-puget-lng-tacoma-facility' })
    const rec = await upsertRecord(c, S, { sourceId: FACILITIES_LIST_SOURCE.id, entityId: ent.id, payload: { id: 'wa-puget-lng-tacoma-facility' }, datasetVersion: 'test', retrievalUrl: null, runId: null })
    await c.query(`INSERT INTO ${S}.facilities (key, name, kind, country, entry_source_record_id) VALUES ('wa-puget-lng-tacoma-facility', 'Tacoma LNG facility', 'lng_terminal', 'US', $1)`, [rec.id])
  })
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('import: Order 11386A becomes a PSCAA permit held by the facility, with its document; searches recorded; idempotent', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importWaAir(c, S, data, docs()))
  assert.equal(r1.searches, 2)
  assert.equal(r1.permits, 1)
  assert.equal(r1.documents, 6)
  assert.deepEqual(r1.problems, ['wa-puget-lng-tacoma PSCAA 11386A: terminal wa-puget-lng-tacoma not in the database'])   // the quote itself was found
  const [p] = await q(`SELECT epa_system, permit_key, statute, name, program_status, detail FROM ${S}.permits`)
  assert.deepEqual([p.epa_system, p.permit_key, p.statute, p.name, p.program_status], ['PSCAA', '11386A', 'WA air', 'Puget Sound Energy', 'Approved'])
  assert.equal(p.detail.wa_air.issued, '2022-09-14')
  assert.equal(p.detail.wa_air.registration, '30022')
  const docRows = await q(`SELECT d.url, d.doc_date::text, l.detail FROM ${S}.documents d JOIN ${S}.document_links l ON l.document_id = d.id ORDER BY d.id`)
  assert.equal(docRows[0].url, 'https://pscleanair.gov/DocumentCenter/View/6544')
  assert.equal(docRows[0].doc_date, '2022-09-14')
  assert.equal(docRows[0].detail.read, true)
  assert.equal(docRows[1].detail.read, false)   // linked only: evidenced by the order's record, the file wasn't read
  const n = async () => (await q(`SELECT (SELECT count(*) FROM ${S}.source_records) + (SELECT count(*) FROM ${S}.documents)
                                   + (SELECT count(*) FROM ${S}.document_links) + (SELECT count(*) FROM ${S}.permits)
                                   + (SELECT count(*) FROM ${S}.facility_permits) AS n`))[0].n
  const before2 = await n()
  const r2 = await withTx(pool, (c) => importWaAir(c, S, data, docs()))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(await n(), before2)
})

test('a terminal with no facility: the search is still recorded and read back with its "none found" words', { skip }, async () => {
  const rows = await airSearchesFor(q, S, 'wa-km-harbor-island')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].result, 'none found')
  assert.match(rows[0].none, /^Puget Sound Clean Air Agency publishes no permit for this site online/)
  assert.deepEqual(rows[0].searched.map((s) => s.url), ['https://pscleanair.gov/182/List-of-Approved-Permits', 'https://pscleanair.gov/DocumentCenter',
    'https://pscleanair.gov/460/Recent-Permitting-Projects'])
  assert.deepEqual(await airSearchesFor(q, S, 'wa-km'), [])   // the key is matched whole, not as a prefix
})

test('permitPage: the agency is the issuer, the agency record is the source, facts carry the order\'s own values', { skip }, async () => {
  const pg = await permitPage(q, S, '11386A', 'PSCAA')
  assert.equal(pg.issuer, 'Puget Sound Clean Air Agency')
  assert.equal(pg.permit.waAir.label, 'Order of Approval 11386A')
  assert.deepEqual(pg.permit.enforcementOn, [])   // no EPA air record linked in this schema
  assert.deepEqual(pg.enforcement, [])
  assert.deepEqual(pg.facilities.map((f) => f.key), ['wa-puget-lng-tacoma-facility'])
  assert.ok(pg.sources.some((s) => s.id === 'pscaa-documents'))
  assert.equal(pg.documents.length, 6)
})
