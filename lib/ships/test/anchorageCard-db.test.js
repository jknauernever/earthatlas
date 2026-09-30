/**
 * Anchorage aliases + stays on the DEV database, throwaway schema (ships_t_<random>), dropped afterwards; never "ships", never
 * production. Skipped (NOT RUN) without SHIPS_DATABASE_URL. Inputs are REAL: the Vendovi South row and GFW points
 * (anchorage-aliases-dev-2026-09-30.json), GFW's reviewed-list row for cell 54859d89 exactly as stored, and the MarineCadastre rows
 * of mc-ais-anchorage-vendovi-south.json. SYNTHETIC: the bake record says only April 2026 was read (a one-month bake).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { upsertSource, findOrCreateEntity, upsertRecord } from '../store.js'
import { ensureAnchorageSources, ingestAnchorages, pointInGeometry, NONDES_SOURCE, KIND } from '../anchorages.js'
import { OVERRIDES_SOURCE } from '../ports.js'
import { aliasCandidates, storeAnchorageAliases } from '../anchorageAliases.js'
import { bakeAnchorages, staySplitter, storeAnchorageStays, STAY_RULE } from '../anchorageStays.js'
import { readAnchorageCard, anchoragesLayer } from '../anchorageCard.js'
import { parseCardWindow } from '../portCard.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool, anchId
const q = async (text, params) => (await pool.query(text, params)).rows
const fx = fixture('anchorage-aliases-dev-2026-09-30.json')
const mc = fixture('mc-ais-anchorage-vendovi-south.json')
const vs = fx.anchorages.find((a) => a.source_key === '(a)(15)(i)')
const OVERRIDE_ROW = { iso3: 'USA', s2id: '54859d89', label: 'USA-1547', latitude: '48.5952431', sublabel: 'ANACORTES', longitude: '-122.6024686' }

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureAnchorageSources(pool, S)
  await withTx(pool, async (c) => {
    const { id, source_id, source_key, source_record_id, ...row } = vs
    await ingestAnchorages(c, S, NONDES_SOURCE.id, KIND.fr, [{ key: source_key, payload: { paragraph: source_key, note: 'test copy of the dev row' }, row: { ...row, detail: { paragraph: source_key } } }])
  })
  anchId = Number((await q(`SELECT id FROM ${S}.anchorages WHERE source_key = '(a)(15)(i)'`))[0].id)
})
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

test('alias: Vendovi South "Anacortes" stored with its GFW reviewed-list record, shown as also known as', { skip }, async () => {
  const rid = await withTx(pool, async (c) => {
    await upsertSource(c, S, OVERRIDES_SOURCE)
    const ent = await findOrCreateEntity(c, S, { sourceId: OVERRIDES_SOURCE.id, kind: 'anchorage_override', anchor: '54859d89' })
    return (await upsertRecord(c, S, { sourceId: OVERRIDES_SOURCE.id, entityId: ent.id, payload: OVERRIDE_ROW, datasetVersion: null, retrievalUrl: null, runId: null })).id
  })
  const pt = fx.points.find((p) => p.kind === 'override' && p.s2 === '54859d89')
  const rows = aliasCandidates([vs], [{ ...pt, record_id: Number(rid) }])
  const r1 = await withTx(pool, (c) => storeAnchorageAliases(c, S, rows))
  const r2 = await withTx(pool, (c) => storeAnchorageAliases(c, S, rows))
  assert.equal(r1.inserted, rows.length)
  assert.equal(r2.inserted, 0, 'idempotent')
  const win = parseCardWindow('2026-04', '2026-04', null, new Date('2026-09-30T00:00:00Z'))
  const card = await readAnchorageCard(q, S, anchId, { win })
  assert.deepEqual(card.aliases.map((a) => [a.alias, a.sourceId, a.recordId]), [['Anacortes', 'gfw-anchorage-overrides', Number(rid)]])
  assert.equal(card.stays.coverage, 'not_loaded', 'no bake yet: "not counted", never 0')
})

test('stays: REAL rows → stored stays → card counts; a month the bake did not read is missing, not 0', { skip }, async () => {
  const seen = new Set(), got = []
  const sp = staySplitter((s) => got.push(s))
  const key = `${NONDES_SOURCE.id}|(a)(15)(i)`
  for (const r of [...mc.rows].sort((a, b) => a.mmsi - b.mmsi || a.base_date_time.localeCompare(b.base_date_time))) {
    const t = Date.parse(`${r.base_date_time.replace(' ', 'T')}Z`)
    if (!(r.sog < STAY_RULE.sogKn) || !pointInGeometry(vs.geometry, r.latitude, r.longitude) || seen.has(`${r.mmsi}|${t}`)) continue
    seen.add(`${r.mmsi}|${t}`)
    sp.push(key, String(r.mmsi), { t, also: null, name: r.vessel_name, imo: r.imo, type: r.vessel_type, length: r.length })
  }
  sp.end()
  const anchorages = bakeAnchorages([{ ...vs, id: anchId }]).map(({ geometry, ...a }) => a)
  const bake = { rule: STAY_RULE, days: ['2026-04-26', '2026-04-27', '2026-04-28'], months: [{ month: '2026-04', complete: true }], anchorages } // SYNTHETIC coverage
  const r = await withTx(pool, (c) => storeAnchorageStays(c, S, { stays: got, bake }))
  assert.equal(r.stays, 4)
  const win = parseCardWindow('2026-04', '2026-05', null, new Date('2026-09-30T00:00:00Z'))
  const card = await readAnchorageCard(q, S, anchId, { win })
  const s = card.stays
  assert.equal(s.coverage, 'covered')
  assert.deepEqual(s.months, { covered: ['2026-04'], missing: ['2026-05'] })
  assert.equal(s.summary.stays, 4)
  assert.equal(s.summary.ships, 2)
  assert.deepEqual(s.summary.perMonth, [{ month: '2026-04', n: 4 }, { month: '2026-05', n: null }])
  assert.deepEqual(s.top.map((t) => [t.aisName, t.days, t.stays]), [['SIOUX ARROW', 3, 3], ['PRIDE', 2, 1]], 'most days first')
  assert.equal(s.top[1].hours, 27.8, 'PRIDE: 2026-04-26 14:43:45 → 04-27 18:29:16')
  assert.equal(s.bake.recordId, Number(r.recordId))
  const layer = await anchoragesLayer(q, S)
  assert.equal(layer.features.length, 1)
  assert.equal(layer.features[0].properties.a, 1, 'inside the AIS box')
})
