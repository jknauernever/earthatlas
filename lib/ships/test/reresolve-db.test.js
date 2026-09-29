/**
 * Re-resolution must only ever consider vessel-describing source entities.
 * Bug (noted 2026-09-27): reresolveAll picked up EVERY source entity without an accepted
 * link, including ports, terminals, anchorages, incidents and port visits, and the
 * generic resolver path turned each of them into a new EarthAtlas vessel.
 *
 * DEV database, throwaway schema ships_t_<random>, dropped afterwards (src/ships/CLAUDE.md).
 * Without SHIPS_DATABASE_URL these tests are skipped (NOT RUN).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from '../store.js'
import { resolveEntity } from '../resolve.js'
import { reresolveAll, reresolveSource } from '../reresolve.js'
import { WPI_SOURCE, KIND as PORT_KIND } from '../ports.js'
import { INCIDENTNEWS_SOURCE, INCIDENTNEWS_ENTITY_KIND } from '../incidentsNames.js'
import { PORT_VISITS_SOURCE, PORT_VISIT_ENTITY_KIND } from '../portVisits.js'
import { CLIMATE_TRACE_SOURCE, CT_KIND } from '../climateTrace.js'
import { TERMINALS_LIST_SOURCE, RAW_KIND } from '../terminals.js'
import { gabuReefer } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

// Non-vessel entities as their importers create them. The incident and the port visit also
// carry vessel-looking claims (a name, an MMSI), the worst case for an attribute-based guess.
const NON_VESSELS = [
  { src: WPI_SOURCE, kind: PORT_KIND.wpi, key: 'test-wpi-1' },
  { src: TERMINALS_LIST_SOURCE, kind: RAW_KIND.entry, key: 'test-terminal-1' },
  { src: CLIMATE_TRACE_SOURCE, kind: CT_KIND, key: 'test-ct-port-1' },
  { src: INCIDENTNEWS_SOURCE, kind: INCIDENTNEWS_ENTITY_KIND, key: 'test-incident-1',
    claims: [{ attribute: 'name', value_raw: 'TEST SPILLER', value_norm: 'TESTSPILLER' }] },
  { src: PORT_VISITS_SOURCE, kind: PORT_VISIT_ENTITY_KIND, key: 'test-visit-1',
    claims: [{ attribute: 'mmsi', value_raw: '367000555', value_norm: '367000555' }] },
]

async function addNonVessel(c, { src, kind, key, claims = [] }) {
  await upsertSource(c, S, src)
  const ent = await findOrCreateEntity(c, S, { sourceId: src.id, kind, anchor: key })
  const rec = await upsertRecord(c, S, { sourceId: src.id, entityId: ent.id, payload: { test: key } })
  if (claims.length) {
    await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions: claims.map((a) => ({
      ...a, period_from: null, period_to: null, period_kind: 'unknown', evidence_class: 'unverified' })) })
  }
  return ent.id
}

const nonVesselIds = []
before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S)
  for (const nv of NON_VESSELS) nonVesselIds.push(await withTx(pool, (c) => addNonVessel(c, nv)))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

const linksOf = (ids) => q(`SELECT count(*)::int n FROM ${S}.entity_links WHERE source_entity_id = ANY($1)`, [ids])

test('import path: resolving a non-vessel entity never creates a vessel or a link', { skip }, async () => {
  const before = await q(`SELECT count(*)::int n FROM ${S}.vessels`)
  for (const id of nonVesselIds) {
    const d = await withTx(pool, (c) => resolveEntity(c, S, id))
    assert.equal(d.action, 'unresolved', `entity ${id}`)
    assert.equal(d.vesselId, null)
  }
  assert.deepEqual(await q(`SELECT count(*)::int n FROM ${S}.vessels`), before)
  assert.deepEqual(await linksOf(nonVesselIds), [{ n: 0 }])
})

test('reresolveAll: non-ship entities never produce a vessel; real ships still do', { skip }, async () => {
  const g = await ingestGfwEntry(pool, S, gabuReefer())
  assert.equal(g.resolution.action, 'new')
  const assertionsBefore = await q(`SELECT count(*)::int n FROM ${S}.assertions`)
  const st = await reresolveAll(pool, S)
  assert.equal(st.new_NEW_FROM_SOURCE_ENTITY, 1, JSON.stringify(st)) // the GFW ship only
  assert.deepEqual(await linksOf(nonVesselIds), [{ n: 0 }])
  const active = await q(`SELECT count(*)::int n FROM ${S}.vessels WHERE status = 'active'`)
  assert.deepEqual(active, [{ n: 1 }])
  const shipLinks = await q(`SELECT count(*)::int n FROM ${S}.entity_links WHERE source_entity_id = $1 AND status = 'accepted'`, [g.entityId])
  assert.deepEqual(shipLinks, [{ n: 1 }])
  assert.deepEqual(await q(`SELECT count(*)::int n FROM ${S}.assertions`), assertionsBefore) // evidence untouched
})

test('reresolveSource on a non-vessel source creates nothing', { skip }, async () => {
  const before = await q(`SELECT count(*)::int n FROM ${S}.vessels`)
  await reresolveSource(pool, S, PORT_VISITS_SOURCE.id)
  await reresolveSource(pool, S, WPI_SOURCE.id)
  assert.deepEqual(await q(`SELECT count(*)::int n FROM ${S}.vessels`), before)
  assert.deepEqual(await linksOf(nonVesselIds), [{ n: 0 }])
})
