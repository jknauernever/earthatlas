/**
 * EU MRV, database tests (migration 019, lib/ships/euMrv.js, resolver v1.8). DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network.
 * MRV rows: REAL, copied verbatim from the 2021 v219 and 2024 v245 publication files (fixtures/eu-mrv-live-2026-09-29.json).
 * Vessel: the REAL recorded GFW entry for EURODAM (fixtures/gfw-live-eurodam-2026-09-25.json), IMO 9378448, no edits.
 * Edits built here (a revised file version, a file without a ship) are marked SYNTHETIC in the test name.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { getVessel, getRecordView } from '../queries.js'
import { groupWorkbook, importMrvChunk, finishMrvYear, storeFileHeader, ensureMrvSource, MRV_SOURCE } from '../euMrv.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool, eurodamId
const q = async (text, params) => (await pool.query(text, params)).rows
const count = async (t, where = 'true', params = []) => Number((await q(`SELECT count(*) FROM ${S}.${t} WHERE ${where}`, params))[0].count)

const fx = fixture('eu-mrv-live-2026-09-29.json')
const sheetsOf = (k) => fx.files[k].sheets.map((s) => ({ name: s.name, rows: [...s.header_rows, ...s.rows.map((r) => r.cells)] }))
const fileOf = (k) => ({ name: fx.files[k].fileName, year: fx.files[k].year, version: fx.files[k].version, generated: fx.files[k].generated, sha256: fx.files[k].sha256 })
const wb24 = groupWorkbook(sheetsOf('2024-v245'), { year: 2024 })
const wb21 = groupWorkbook(sheetsOf('2021-v219'), { year: 2021 })
const gfwEurodam = () => JSON.parse(readFileSync(new URL('./fixtures/gfw-live-eurodam-2026-09-25.json', import.meta.url), 'utf8'))

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S)
  await withTx(pool, (c) => ensureMrvSource(c, S))
  await ingestGfwEntry(pool, S, gfwEurodam())
  eurodamId = (await q(`SELECT vessel_id FROM ${S}.vessel_assertions WHERE attribute = 'imo' AND value_norm = '9378448' AND evidence_class = 'registry' LIMIT 1`))[0]?.vessel_id
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('migration 019: verified_report and emissions_report are allowed; the source row carries the licence', { skip }, async () => {
  const [src] = await q(`SELECT license, license_url, commercial_use, attribution_text FROM ${S}.sources WHERE id = $1`, [MRV_SOURCE.id])
  assert.match(src.license, /Reproduction is authorised, provided the source is acknowledged, save where otherwise stated\./)
  assert.equal(src.license_url, 'https://www.emsa.europa.eu/disclaimer.html')
  const [chk] = await q(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'assertions_evidence_class_check' AND connamespace = $1::regnamespace`, [S])
  assert.match(chk.d, /verified_report/)
})

test('REAL rows: EURODAM attaches by registry IMO; ships we don\'t hold stay unresolved; no vessel is created; idempotent', { skip }, async () => {
  assert.ok(eurodamId, 'the REAL GFW EURODAM vessel exists')
  const vessels = await count('vessels')
  await withTx(pool, (c) => storeFileHeader(c, S, fileOf('2024-v245'), wb24.header))
  const r1 = await withTx(pool, (c) => importMrvChunk(c, S, wb24.groups, wb24.layout, fileOf('2024-v245')))
  assert.equal(r1.groups, 3)
  assert.equal(r1.recordsCreated, 3)
  assert.equal(r1.claimsCreated, 4) // EURODAM full, AEGEAN DREAM full, MORNING CALM full + partial
  assert.equal(r1.resolved.accept, 1)
  assert.equal(r1.resolved['unresolved:no_vessel_with_imo'], 2)
  const r0 = await withTx(pool, (c) => importMrvChunk(c, S, wb21.groups, wb21.layout, fileOf('2021-v219')))
  assert.equal(r0.resolved.accept, 1)
  assert.equal(await count('vessels'), vessels)

  const v = await getVessel(q, S, eurodamId)
  const mrv = v.assertions.filter((a) => a.source_id === MRV_SOURCE.id)
  assert.deepEqual(mrv.map((a) => [a.attribute, a.evidence_class, a.value_raw, a.detail.period.year]).sort((a, b) => a[3] - b[3]),
    [['emissions_report', 'verified_report', '19476.9', 2021], ['emissions_report', 'verified_report', '298.0592', 2024]])
  const a24 = mrv.find((a) => a.detail.period.year === 2024)
  assert.equal(a24.link_method, 'IMO_EXACT')
  assert.equal(a24.period_kind, 'validity')
  assert.equal(new Date(a24.from).toISOString(), '2024-01-01T00:00:00.000Z')
  assert.equal(new Date(a24.to).toISOString(), '2025-01-01T00:00:00.000Z')
  assert.equal(a24.detail.co2eq_t, 302.71282)
  assert.equal(a24.detail.verifier.name, 'DNV')
  assert.ok(v.sources.some((s) => s.id === MRV_SOURCE.id))
  const view = await getRecordView(q, S, a24.last_source_record_id)
  assert.deepEqual(view.identifiers, [{ label: 'IMO Number', value: '9378448' }, { label: 'Reporting period', value: '2024' }])
  assert.equal(view.links[0].href, 'https://mrv.emsa.europa.eu/#public/emission-report/ship/9378448/rp/2024')
  assert.equal(view.payload.rows[0].cells.AC, '298.0592')

  const r2 = await withTx(pool, (c) => importMrvChunk(c, S, wb24.groups, wb24.layout, fileOf('2024-v245')))
  assert.equal(r2.recordsCreated, 0)
  assert.equal(r2.claimsCreated, 0)
  assert.equal(r2.resolved.keep, 1)
})

test('a revised file version (SYNTHETIC: EURODAM 2024 CO₂ cell changed in a "v246"): new record, old claim superseded and kept', { skip }, async () => {
  const before = await count('assertions')
  const g = structuredClone(wb24.groups.find((x) => x.imo === '9378448'))
  g.rows[0].cells.AC = '300.0'
  const r = await withTx(pool, (c) => importMrvChunk(c, S, [g], wb24.layout, { ...fileOf('2024-v245'), version: 246 }))
  assert.equal(r.recordsCreated, 1)
  assert.equal(r.claimsCreated, 1)
  assert.equal(r.superseded, 1)
  assert.equal(await count('assertions'), before + 1)
  const v = await getVessel(q, S, eurodamId)
  assert.deepEqual(v.assertions.filter((a) => a.source_id === MRV_SOURCE.id && a.detail.period.year === 2024).map((a) => a.value_raw), ['300.0'])
  // Back to the published cells: the original claim is active again.
  await withTx(pool, (c) => importMrvChunk(c, S, wb24.groups.filter((x) => x.imo === '9378448'), wb24.layout, fileOf('2024-v245')))
  const v2 = await getVessel(q, S, eurodamId)
  assert.deepEqual(v2.assertions.filter((a) => a.source_id === MRV_SOURCE.id && a.detail.period.year === 2024).map((a) => a.value_raw), ['298.0592'])
})

test('a ship-year no longer in its year\'s file: claims superseded, never deleted; other years untouched (SYNTHETIC: 2024 file without EURODAM)', { skip }, async () => {
  const before = await count('assertions')
  const r = await withTx(pool, (c) => finishMrvYear(c, S, 2024, wb24.groups.filter((g) => g.imo !== '9378448').map((g) => g.key)))
  assert.equal(r.superseded, 1)
  assert.equal(await count('assertions'), before)
  const v = await getVessel(q, S, eurodamId)
  assert.deepEqual(v.assertions.filter((a) => a.source_id === MRV_SOURCE.id).map((a) => a.detail.period.year), [2021])
})
