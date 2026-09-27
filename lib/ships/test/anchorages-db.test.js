/**
 * Database tests for official anchorage areas. DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL.
 * No network: inputs are the REAL recorded extracts in fixtures/anchorages-live-2026-09-27.json and the GFW
 * port-visit / identity responses recorded live 2026-09-25/26. Edited cases are marked SYNTHETIC.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensurePortVisitSource, ingestPortVisitEvents, vesselPortVisits } from '../portVisits.js'
import { storeRawRecords } from '../ports.js'
import {
  ensureAnchorageSources, ingestAnchorages, withdrawMissingAnchorages, anchorageCandidates, annotateVisits, amendedSince,
  mapMcFeature, mapDfoFeature, parseProposedParagraphs, mapProposedParagraph, ANCHORAGE_SOURCES, MC_SOURCE, DFO_SOURCE, NONDES_SOURCE, ECFR_SOURCE, KIND,
} from '../anchorages.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
const EMPTY = `ships_t_${randomBytes(4).toString('hex')}` // a schema without migration 009
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const one = async (text, params) => (await q(text, params))[0]
const count = async (text, params) => Number((await one(text, params)).n)

const fx = fixture('anchorages-live-2026-09-27.json')
const ed = fixture('gfw-live-portvisits-eurodam-2026-09-26.json').body.entries
const EURODAM_MAIN = '6d8a6e1eb-b3d2-0380-37fd-33d6c9a79741'
const paras = parseProposedParagraphs(fx.fr_lines.join('\n'))
let mcItems, dfoItems, frItems

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureAnchorageSources(pool, S)
  const ecfr = await withTx(pool, (c) => storeRawRecords(c, S, ECFR_SOURCE.id, KIND.ecfr, [{ key: 'title-33-part-110', payload: fx.ecfr }]))
  const amended = amendedSince(fx.ecfr), amendRid = ecfr.byKey.get('title-33-part-110').at(-1)
  mcItems = fx.mc.features.map((f) => { const m = mapMcFeature(f, { amended, amendRid }); return { key: m.key, payload: f, row: m.row } })
  dfoItems = fx.dfo.features.map((f) => { const m = mapDfoFeature(f); return { key: m.key, payload: f, row: m.row } })
  frItems = paras.map((p) => ({ key: p.para, payload: { paragraph: p.para, text: p.text }, row: mapProposedParagraph(p).row ?? null }))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.query(`DROP SCHEMA IF EXISTS ${EMPTY} CASCADE`)
  await pool.end()
})

test('migration 009: table exists; the four sources carry licence + attribution', { skip }, async () => {
  assert.ok((await one(`SELECT to_regclass('${S}.anchorages') AS r`)).r)
  const src = await q(`SELECT id, license, attribution_text FROM ${S}.sources WHERE id = ANY($1)`, [ANCHORAGE_SOURCES.map((s) => s.id)])
  assert.equal(src.length, 4)
  for (const s of src) assert.ok(s.license && s.attribution_text)
})

test('import: raw rows kept exactly as received; one anchorage per mapped row; idempotent', { skip }, async () => {
  const a = await withTx(pool, (c) => ingestAnchorages(c, S, MC_SOURCE.id, KIND.mc, mcItems))
  const b = await withTx(pool, (c) => ingestAnchorages(c, S, DFO_SOURCE.id, KIND.dfo, dfoItems))
  const f = await withTx(pool, (c) => ingestAnchorages(c, S, NONDES_SOURCE.id, KIND.fr, frItems))
  assert.deepEqual([a.created, b.created, f.created], [9, 3, 14])
  assert.equal(f.recordsCreated, 16) // the two revising paragraphs are kept as evidence, without an anchorage row
  const rec = await one(`SELECT r.payload FROM ${S}.anchorages a JOIN ${S}.source_records r ON r.id = a.source_record_id
                          WHERE a.source_id = $1 AND a.source_key = '605'`, [MC_SOURCE.id])
  assert.deepEqual(rec.payload, fx.mc.features.find((x) => x.properties.objectid === 605))
  const again = await withTx(pool, (c) => ingestAnchorages(c, S, MC_SOURCE.id, KIND.mc, mcItems))
  assert.deepEqual([again.created, again.seenAgain, again.recordsCreated, again.superseded], [0, 9, 0, 0])
  assert.equal(await count(`SELECT count(*) AS n FROM ${S}.anchorages WHERE status = 'active'`), 26)
  const older = await one(`SELECT boundary_note, detail FROM ${S}.anchorages WHERE source_key = '591' AND source_id = $1`, [MC_SOURCE.id])
  assert.match(older.boundary_note, /110\.228 has been amended since/)
  const ev = await one(`SELECT source_id FROM ${S}.source_records WHERE id = $1`, [older.detail.amendment_record_id])
  assert.equal(ev.source_id, ECFR_SOURCE.id)
})

test('a changed feature supersedes the old version (kept); the original coming back re-activates it (SYNTHETIC rename)', { skip }, async () => {
  const cp = mcItems.find((i) => i.key === '605')
  const renamed = { key: '605', payload: { ...cp.payload, properties: { ...cp.payload.properties, anchoragename: 'TEST Cherry Point renamed' } },
    row: { ...cp.row, name: 'TEST Cherry Point renamed' } }
  const r = await withTx(pool, (c) => ingestAnchorages(c, S, MC_SOURCE.id, KIND.mc, [renamed]))
  assert.deepEqual([r.created, r.superseded], [1, 1])
  assert.deepEqual((await q(`SELECT name, status FROM ${S}.anchorages WHERE source_key = '605' ORDER BY id`)).map((x) => [x.name, x.status]),
    [['Cherry Point', 'superseded'], ['TEST Cherry Point renamed', 'active']])
  const back = await withTx(pool, (c) => ingestAnchorages(c, S, MC_SOURCE.id, KIND.mc, [cp]))
  assert.deepEqual([back.created, back.superseded], [0, 1])
  assert.deepEqual((await q(`SELECT name, status FROM ${S}.anchorages WHERE source_key = '605' ORDER BY id`)).map((x) => [x.name, x.status]),
    [['Cherry Point', 'active'], ['TEST Cherry Point renamed', 'superseded']])
  assert.equal(await count(`SELECT count(*) AS n FROM ${S}.source_records WHERE source_id = $1 AND payload->'properties'->>'objectid' = '605'`, [MC_SOURCE.id]), 2)
})

test('a complete import without a feature withdraws it (row and evidence kept); it comes back when seen again', { skip }, async () => {
  const n = await withTx(pool, (c) => withdrawMissingAnchorages(c, S, DFO_SOURCE.id, dfoItems.filter((i) => i.key !== '81').map((i) => i.key)))
  assert.equal(n, 1)
  assert.equal((await one(`SELECT status FROM ${S}.anchorages WHERE source_id = $1 AND source_key = '81'`, [DFO_SOURCE.id])).status, 'withdrawn')
  await withTx(pool, (c) => ingestAnchorages(c, S, DFO_SOURCE.id, KIND.dfo, dfoItems))
  assert.equal((await one(`SELECT status FROM ${S}.anchorages WHERE source_id = $1 AND source_key = '81'`, [DFO_SOURCE.id])).status, 'active')
})

test('read: bbox prefilter returns only nearby areas with geometry; annotateVisits marks in / near / outside', { skip }, async () => {
  const P = Object.fromEntries(fx.positions.map((p) => [p.case.split(' ')[0], p.position]))
  const c = await anchorageCandidates(q, S, [P.Seattle])
  assert.ok(c.some((x) => x.name === 'Smith Cove West'))
  assert.ok(c.length < 26 && c.every((x) => /Puget Sound, WA/.test(x.location)))
  assert.ok(c.every((x) => x.geometry && !x.no_anchoring))
  const visits = fx.positions.map((p) => ({ event_id: p.event_id, ...p.position }))
  const summary = await annotateVisits(q, S, visits, fx.positions.map((p) => ({ ...p.position, n: 2 })))
  const by = Object.fromEntries(visits.map((v, i) => [fx.positions[i].case.split(' ')[0], v]))
  assert.equal(by.Vendovi.anchorage.name, 'Vendovi East General Anchorage')
  assert.equal(by.Vendovi.anchorage.legal_status, 'non_designated')
  assert.ok(by.Vendovi.anchorage.source_record_id > 0)
  assert.equal(by.Vendovi.anchorage.geometry, undefined)
  assert.equal(by.Seattle.anchorage.citation, '33 CFR 110.230(a)(7)(i)')
  assert.equal(by.English.anchorage.radius_m, 556)
  assert.equal(by.Oleum.anchorage, undefined)
  assert.equal(by.Oleum.anchorage_near.name, 'Anchorage 20')
  assert.ok(by.Oleum.anchorage_near.distance_m <= 500)
  assert.equal(by.Cherry.anchorage ?? by.Cherry.anchorage_near ?? null, null)
  assert.deepEqual(summary, { inside: { designated: 2, active_listed: 2, non_designated: 4 }, near: 2, near_m: 500 })
})

test('card read: a EURODAM stop in Elliott Bay says Smith Cove West; the GFW evidence is untouched', { skip }, async () => {
  await ensureGfwSource(pool, S)
  await ensurePortVisitSource(pool, S)
  await withTx(pool, (c) => ingestPortVisitEvents(c, S, ed, { datasetVersion: 'public-global-port-visits-events:v4.0' }))
  await ingestGfwEntry(pool, S, fixture('gfw-live-eurodam-2026-09-25.json'))
  const [{ vessel_id: vid }] = await q(`SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions WHERE sub_record_ref = $1`, [EURODAM_MAIN])
  const before = await q(`SELECT id, content_sha256, status FROM ${S}.port_visits ORDER BY id`)
  const out = await vesselPortVisits(q, S, vid, { from: '2024-09-26', to: '2026-09-27', limit: 1000 })
  const sea = out.visits.find((v) => v.lat === 47.6325 && v.lon === -122.4174)
  assert.equal(sea.anchorage.name, 'Smith Cove West')
  assert.ok(out.anchorages.inside.designated >= 1)
  assert.deepEqual(await q(`SELECT id, content_sha256, status FROM ${S}.port_visits ORDER BY id`), before)
})

test('before migration 009 the read degrades to "no anchorage info" instead of failing', { skip }, async () => {
  await pool.query(`CREATE SCHEMA ${EMPTY}`)
  const v = [{ lat: 47.6325, lon: -122.4174 }]
  assert.equal(await annotateVisits(q, EMPTY, v, v), null)
  assert.equal(v[0].anchorage, undefined)
})
