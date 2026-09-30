/**
 * MEP Alliance lists, database tests (migration 021, lib/ships/mepAlliance.js, resolver v1.9 decideMep, scrubberFilter.js). DEV
 * database in SHIPS_DATABASE_URL, throwaway schemas (ships_t_<random>) dropped afterwards; never "ships", never production.
 * Skipped (NOT RUN) without the URL. No network.
 * List rows: REAL, copied verbatim from mepalliance.org 2026-09-30 (fixtures/mep-live-2026-09-30.json). Vessel: the REAL GFW entry
 * (fixtures/gfw-live-eurodam-2026-09-25.json) and REAL MarineCadastre Salish identity rows (fixtures/mc-live-eurodam-2026-06.ndjson)
 * of EURODAM, IMO 9378448, which the real cruise-ship list names. The voyage list does not name EURODAM, so the voyage row here is
 * SYNTHETIC: the real GOLDEN FELLOW row with its ship name changed to EURODAM (marked in the test names).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensureMcSource, ingestMcMmsi } from '../ingestMc.js'
import { aggregateRows } from '../marinecadastre.js'
import { getVessel, getRecordView } from '../queries.js'
import { scrubberMmsis } from '../scrubberFilter.js'
import {
  parseVoyagePage, parseFittedPage, knownNames, groupVoyages, groupFitted, ensureMepSources, importMepChunk, mepEntityIds, resolveMepIds,
  VOYAGES_SOURCE, FITTED_SOURCE,
} from '../mepAlliance.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S1 = `ships_t_${randomBytes(4).toString('hex')}`, S2 = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const qS = (S) => async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('mep-live-2026-09-30.json')
const voyHtml = fx.voyages.header_html + fx.voyages.options_html.join('') + fx.voyages.items_html.join('')
const known = knownNames(voyHtml)
const realVoy = parseVoyagePage(voyHtml)
const fitted = groupFitted(parseFittedPage(fx.fitted.header_html + fx.fitted.items_html.join('')).map((r) => ({ ...r, list: 'cruise-ships' })))
// SYNTHETIC: the real GOLDEN FELLOW row renamed EURODAM.
const synthVoy = groupVoyages([{ ...realVoy[0], cells: { ...realVoy[0].cells, 'Ship Name': 'EURODAM' } }])
const gfwEurodam = () => JSON.parse(readFileSync(new URL('./fixtures/gfw-live-eurodam-2026-09-25.json', import.meta.url), 'utf8'))
const mcEurodam = () => aggregateRows(readFileSync(new URL('./fixtures/mc-live-eurodam-2026-06.ndjson', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)))[0]
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/
const resolveAll = async (S, src) => withTx(pool, async (c) => resolveMepIds(c, S, await mepEntityIds(c, S, src)))
const links = (S, src) => q(`SELECT se.entity_key, l.status, l.method, l.evidence, l.vessel_id FROM ${S}.entity_links l
  JOIN ${S}.source_entities se ON se.id = l.source_entity_id WHERE se.source_id = $1 ORDER BY se.entity_key`, [src])

before(async () => {
  if (skip) return
  pool = shipsPool()
  for (const S of [S1, S2]) { await migrate(pool, S); await ensureGfwSource(pool, S); await ensureMcSource(pool, S); await withTx(pool, (c) => ensureMepSources(c, S)) }
})
after(async () => {
  if (skip) return
  for (const S of [S1, S2]) await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('migration 021: the MEP link methods are allowed; sources carry the permission and "MEP Alliance"', { skip }, async () => {
  const [chk] = await q(`SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'entity_links_method_check' AND connamespace = $1::regnamespace`, [S1])
  for (const m of ['MEP_NAME_CORROBORATED', 'MEP_NAME_SALISH_SIZE', 'MEP_NAME_ONLY', 'IMO_EXACT']) assert.match(chk.d, new RegExp(m))
  const src = await q(`SELECT id, license, attribution_text FROM ${S1}.sources WHERE id = ANY($1) ORDER BY id`, [[VOYAGES_SOURCE.id, FITTED_SOURCE.id]])
  assert.deepEqual(src.map((s) => [s.license, s.attribution_text]), Array(2).fill(['Permission via Friends of the San Juans (MEP Alliance founding member), 2026-09-30', 'MEP Alliance']))
})

test('REAL cruise-list rows: EURODAM attaches by registry IMO; the two ships we don\'t hold stay unresolved; idempotent', { skip }, async () => {
  const g = await ingestGfwEntry(pool, S1, gfwEurodam())
  await ingestMcMmsi(pool, S1, mcEurodam())
  const vid = g.vesselId ?? g.resolution?.vesselId
  const r1 = await withTx(pool, (c) => importMepChunk(c, S1, FITTED_SOURCE.id, fitted, {}))
  assert.deepEqual([r1.recordsCreated, r1.claimsCreated], [3, 3])
  const t = await resolveAll(S1, FITTED_SOURCE.id)
  assert.deepEqual(t, { 'accept:IMO_EXACT': 1, 'unresolved:no_vessel_with_imo': 2 })
  const ls = await links(S1, FITTED_SOURCE.id)
  assert.deepEqual(ls.map((l) => [l.entity_key, l.method]), [['IMO 9378448', 'IMO_EXACT']])
  assert.equal(ls[0].vessel_id, vid)
  const r2 = await withTx(pool, (c) => importMepChunk(c, S1, FITTED_SOURCE.id, fitted, {}))
  assert.deepEqual([r2.recordsCreated, r2.claimsCreated], [0, 0])
  assert.deepEqual(await resolveAll(S1, FITTED_SOURCE.id), { keep: 1, 'unresolved:no_vessel_with_imo': 2 })
})

test('SYNTHETIC voyage row "EURODAM": corroborated by the cruise list\'s own IMO for that name; card data has no contact details', { skip }, async () => {
  await withTx(pool, (c) => importMepChunk(c, S1, VOYAGES_SOURCE.id, synthVoy, { known }))
  assert.deepEqual(await resolveAll(S1, VOYAGES_SOURCE.id), { 'accept:MEP_NAME_CORROBORATED': 1 })
  const [l] = await links(S1, VOYAGES_SOURCE.id)
  assert.deepEqual([l.method, l.evidence.corroborated_by, l.evidence.inferred], ['MEP_NAME_CORROBORATED', ['imo_list'], false])
  const v = await getVessel(qS(S1), S1, l.vessel_id)
  const mep = v.assertions.filter((a) => a.source_id.startsWith('mep-alliance'))
  assert.deepEqual(mep.map((a) => a.link_method).sort(), ['IMO_EXACT', 'MEP_NAME_CORROBORATED'])
  assert.doesNotMatch(JSON.stringify(v), EMAIL)
  const voyA = mep.find((a) => a.source_id === VOYAGES_SOURCE.id)
  assert.deepEqual([voyA.detail.owner, voyA.detail.charterer, voyA.detail.reported], ['GOLDEN OCEAN', 'NORDEN', '2025-12-02'])
  // The stored record keeps the contact cells; the record page never shows them.
  const [raw] = await q(`SELECT payload FROM ${S1}.source_records WHERE id = $1`, [voyA.last_source_record_id])
  assert.match(JSON.stringify(raw.payload), EMAIL)
  const view = await getRecordView(qS(S1), S1, voyA.last_source_record_id)
  assert.doesNotMatch(JSON.stringify(view), EMAIL)
  // Scrubber filter: EURODAM's MMSI, via the MEP lists (no GISIS rows in this schema).
  const f = await scrubberMmsis(qS(S1), S1)
  assert.deepEqual([f.vessels, f.mmsis.includes(245206000), f.by.mep, f.by.gisis], [1, true, 1, 0]) // + every MMSI GFW lists for it
})

test('SYNTHETIC voyage row "EURODAM", AIS-only Salish ship, no IMO list: accepted as MEP_NAME_SALISH_SIZE, inferred (Josh 2026-09-30)', { skip }, async () => {
  const m = await ingestMcMmsi(pool, S2, mcEurodam()) // REAL Salish AIS identity, 287 m, IMO only as broadcast
  await withTx(pool, (c) => importMepChunk(c, S2, VOYAGES_SOURCE.id, synthVoy, { known }))
  assert.deepEqual(await resolveAll(S2, VOYAGES_SOURCE.id), { 'accept:MEP_NAME_SALISH_SIZE': 1 })
  const [l] = await links(S2, VOYAGES_SOURCE.id)
  assert.equal(l.vessel_id, m.resolution.vesselId)
  assert.deepEqual([l.evidence.inferred, l.evidence.salish, l.evidence.big], [true, true, true])
  const f = await scrubberMmsis(qS(S2), S2)
  assert.deepEqual([f.vessels, f.by.mep_inferred], [1, 1])
})
