/**
 * Database tests for the identity model (the required cases in src/ships/CLAUDE.md).
 * Run against the DEV database in SHIPS_DATABASE_URL inside a throwaway schema
 * (ships_t_<random>), which is dropped at the end. Never the "ships" schema,
 * never production. Without SHIPS_DATABASE_URL these tests are skipped (NOT RUN).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { upsertAssertions, upsertRecord, findOrCreateEntity } from '../store.js'
import { vesselsForMmsiAt, valuesAt, searchVessels, getVessel, getRecord } from '../queries.js'
import { fixture, gabuReefer, renamedVessel, sharedMmsiPair, conflictingImos } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
// Neon URLs don't name the database, so the guard is the throwaway schema itself:
// tests only create, use and drop ships_t_*, never touching "ships".
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S)
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

/** Snapshot of all logical rows (ignoring bookkeeping timestamps) for idempotency checks. */
async function snapshot() {
  const counts = {}
  for (const t of ['source_entities', 'source_records', 'assertions', 'vessels', 'entity_links']) {
    counts[t] = Number((await q(`SELECT count(*) FROM ${S}.${t}`))[0].count)
  }
  counts.activeAssertions = Number((await q(`SELECT count(*) FROM ${S}.assertions WHERE status = 'active'`))[0].count)
  return counts
}
const vesselOf = async (gfwId) => (await q(
  `SELECT DISTINCT l.vessel_id FROM ${S}.assertions a JOIN ${S}.entity_links l
     ON l.source_entity_id = a.source_entity_id AND l.status = 'accepted' WHERE a.sub_record_ref = $1`, [gfwId]))[0]?.vessel_id

test('stable IMO, changing MMSI: observations resolve by timestamp (GABU REEFER)', { skip }, async () => {
  await ingestGfwEntry(pool, S, gabuReefer())
  const v = await vesselOf('58cf536b1-1fca-dac3-ad31-7411a3708dcd')
  assert.ok(v)
  // 2015 under the old MMSI → resolves.
  assert.deepEqual(await vesselsForMmsiAt(q, S, '616852000', '2015-06-01T00:00:00Z'), { status: 'resolved', vesselIds: [v] })
  // 2020 under the middle MMSI → same vessel.
  assert.deepEqual((await vesselsForMmsiAt(q, S, '214182732', '2020-06-01T00:00:00Z')).vesselIds, [v])
  // Historical identity: the 2022+ MMSI does NOT resolve a 2015 observation.
  assert.equal((await vesselsForMmsiAt(q, S, '613590000', '2015-06-01T00:00:00Z')).status, 'unresolved')
  // …and the old MMSI does not resolve a 2025 observation merely because it was once this ship's.
  assert.equal((await vesselsForMmsiAt(q, S, '616852000', '2025-06-01T00:00:00Z')).status, 'unresolved')
})

test('split GFW entries sharing a registry IMO join the same vessel via IMO_EXACT', { skip }, async () => {
  const [a, b, c] = gabuReefer({ split: true }).map((e) => { e.selfReportedInfo[0].id += '-split'; e.registryInfo[0].vesselInfoReference += '-split'; return e })
  // A separate IMO-holding vessel already exists from the previous test, so first make these hit a fresh IMO space:
  for (const e of [a, b, c]) for (const r of e.registryInfo) r.imo = '9074729' // any checksum-valid IMO not used by other tests
  const r1 = await ingestGfwEntry(pool, S, a)
  const r2 = await ingestGfwEntry(pool, S, b)
  const r3 = await ingestGfwEntry(pool, S, c)
  assert.equal(r1.resolution.method, 'NEW_FROM_SOURCE_ENTITY')
  assert.deepEqual([r2.resolution.method, r3.resolution.method], ['IMO_EXACT', 'IMO_EXACT'])
  assert.equal(r2.resolution.vesselId, r1.resolution.vesselId)
  assert.equal(r3.resolution.vesselId, r1.resolution.vesselId)
})

test('changing name and flag: history returns the value valid at the requested time; current differs', { skip }, async () => {
  const r = await ingestGfwEntry(pool, S, renamedVessel())
  const v = r.resolution.vesselId
  const n2018 = await valuesAt(q, S, v, 'name', '2018-01-01T00:00:00Z')
  assert.deepEqual([...new Set(n2018.map((x) => x.value_raw))], ['TEST OCEAN WIND'])
  const n2024 = await valuesAt(q, S, v, 'name', '2024-01-01T00:00:00Z')
  assert.deepEqual([...new Set(n2024.map((x) => x.value_raw))], ['TEST PACIFIC STAR'])
  const f2018 = new Set((await valuesAt(q, S, v, 'flag', '2018-01-01T00:00:00Z')).map((x) => x.value_norm))
  assert.deepEqual(f2018, new Set(['USA']))
})

test('conflicting source assertions: both registries’ flags survive', { skip }, async () => {
  const [v] = (await searchVessels(q, S, 'TEST PACIFIC STAR')).map((s) => s.id)
  const f = await valuesAt(q, S, v, 'flag', '2024-01-01T00:00:00Z')
  const byReg = new Set(f.filter((x) => x.evidence_class === 'registry').map((x) => x.value_norm))
  assert.deepEqual(byReg, new Set(['MHL', 'PAN']))
})

test('ownership history is preserved, including an open-ended current owner', { skip }, async () => {
  const [v] = (await searchVessels(q, S, 'TEST OCEAN WIND')).map((s) => s.id)
  assert.deepEqual((await valuesAt(q, S, v, 'registry_owner', '2016-01-01T00:00:00Z')).map((x) => x.value_raw), ['TEST SHIPPING LLC'])
  assert.deepEqual((await valuesAt(q, S, v, 'registry_owner', '2026-01-01T00:00:00Z')).map((x) => x.value_raw), ['Test Maritime S.A.'])
})

test('owner, operator and manager coexist without being conflated', { skip }, async () => {
  const [v] = (await searchVessels(q, S, 'TEST OCEAN WIND')).map((s) => s.id)
  const [{ source_entity_id: ent }] = await q(`SELECT source_entity_id FROM ${S}.entity_links WHERE vessel_id = $1 AND status = 'accepted' LIMIT 1`, [v])
  assert.ok(ent)
  await withTx(pool, async (c) => {
    // Roles come from a separate (test) source entity linked to the same vessel.
    const e2 = await findOrCreateEntity(c, S, { sourceId: 'gfw-vessel-identity', kind: 'test_roles', anchor: 'roles-1', memberRefs: [] })
    const rec2 = await upsertRecord(c, S, { sourceId: 'gfw-vessel-identity', entityId: e2.id, payload: { test: 'roles', n: 2 } })
    const mk = (attribute, value) => ({ attribute, value_raw: value, value_norm: value.toUpperCase(), period_from: '2022-01-01T00:00:00.000Z',
      period_to: null, period_kind: 'validity', evidence_class: 'unverified' })
    await upsertAssertions(c, S, { entityId: e2.id, recordId: rec2.id, assertions: [
      mk('operator', 'Test Ops Ltd'), mk('ship_manager', 'Test Mgmt GmbH'), mk('registered_owner', 'Test Maritime S.A.')] })
    await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, decided_by)
                   VALUES ($1,$2,'accepted','MANUAL_REVIEW','test')`, [e2.id, v])
  })
  const at = '2024-01-01T00:00:00Z'
  assert.deepEqual((await valuesAt(q, S, v, 'operator', at)).map((x) => x.value_raw), ['Test Ops Ltd'])
  assert.deepEqual((await valuesAt(q, S, v, 'ship_manager', at)).map((x) => x.value_raw), ['Test Mgmt GmbH'])
  assert.deepEqual((await valuesAt(q, S, v, 'registered_owner', at)).map((x) => x.value_raw), ['Test Maritime S.A.'])
  assert.deepEqual((await valuesAt(q, S, v, 'beneficial_owner', at)), [])
})

test('ambiguous MMSI: two ships sharing an MMSI stay separate; lookup reports ambiguity', { skip }, async () => {
  const [a, b] = sharedMmsiPair()
  const ra = await ingestGfwEntry(pool, S, a)
  const rb = await ingestGfwEntry(pool, S, b)
  assert.notEqual(ra.resolution.vesselId, rb.resolution.vesselId)
  assert.equal(rb.resolution.candidates, 1) // MMSI_TEMPORAL candidate, not a merge
  const overlap = await vesselsForMmsiAt(q, S, '999000111', '2021-03-01T00:00:00Z')
  assert.equal(overlap.status, 'ambiguous')
  assert.equal(overlap.vesselIds.length, 2)
  assert.equal((await vesselsForMmsiAt(q, S, '999000111', '2020-03-01T00:00:00Z')).status, 'resolved')
})

test('conflicting IMOs inside one entity → flagged for review, not merged', { skip }, async () => {
  const r = await ingestGfwEntry(pool, S, conflictingImos())
  assert.equal(r.resolution.needsReview, true)
  const [v] = await q(`SELECT needs_review FROM ${S}.vessels WHERE id = $1`, [r.resolution.vesselId])
  assert.equal(v.needs_review, true)
})

test('duplicate ingestion and repeated imports leave the state unchanged', { skip }, async () => {
  const before1 = await snapshot()
  const again = await ingestGfwEntry(pool, S, fixture('gfw-doc-claudina.json'))
  const afterFirst = await snapshot()
  assert.equal(again.recordCreated, true)
  for (let i = 0; i < 3; i++) {
    const r = await ingestGfwEntry(pool, S, fixture('gfw-doc-claudina.json'))
    assert.equal(r.recordCreated, false)
    assert.equal(r.assertions.created, 0)
    assert.equal(r.resolution.action, 'keep')
  }
  assert.deepEqual(await snapshot(), afterFirst)
  assert.ok(afterFirst.source_records === before1.source_records + 1)
})

test('changing the interpretation does not modify the evidence', { skip }, async () => {
  const r = await ingestGfwEntry(pool, S, fixture('gfw-doc-miss-freya.json'))
  const evidenceBefore = await q(`SELECT id, payload_sha256 FROM ${S}.source_records ORDER BY id`)
  const assertsBefore = await q(`SELECT id, value_raw, value_norm, period::text, status FROM ${S}.assertions ORDER BY id`)
  // Re-interpret: move MISS FREYA's entity to a brand-new vessel (a manual correction).
  await withTx(pool, async (c) => {
    await c.query(`UPDATE ${S}.entity_links SET status = 'superseded', superseded_at = now()
                    WHERE source_entity_id = $1 AND status = 'accepted'`, [r.entityId])
    const { rows: [nv] } = await c.query(`INSERT INTO ${S}.vessels DEFAULT VALUES RETURNING id`)
    await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, decided_by)
                   VALUES ($1,$2,'accepted','MANUAL_REVIEW','test')`, [r.entityId, nv.id])
  })
  assert.deepEqual(await q(`SELECT id, payload_sha256 FROM ${S}.source_records ORDER BY id`), evidenceBefore)
  assert.deepEqual(await q(`SELECT id, value_raw, value_norm, period::text, status FROM ${S}.assertions ORDER BY id`), assertsBefore)
  // The old vessel no longer shows MISS FREYA; the new one does.
  const hits = await searchVessels(q, S, 'MISS FREYA')
  assert.equal(hits.length, 1)
  assert.notEqual(hits[0].id, r.resolution.vesselId)
})

test('source traceability: a displayed fact leads back to the exact raw payload', { skip }, async () => {
  const [hit] = await searchVessels(q, S, '8969513')
  const detail = await getVessel(q, S, hit.id)
  const imo = detail.assertions.find((a) => a.attribute === 'imo')
  const rec = await getRecord(q, S, imo.first_source_record_id)
  assert.equal(rec.source_id, 'gfw-vessel-identity')
  assert.ok(rec.payload.registryInfo.some((r) => r.imo === imo.value_raw))
  assert.equal(detail.sources[0].license, 'CC BY-NC 4.0')
})

test('a restated source supersedes claims it dropped, without deleting them', { skip }, async () => {
  const e = fixture('gfw-doc-don-tito.json')
  const r1 = await ingestGfwEntry(pool, S, e)
  const e2 = structuredClone(e)
  e2.selfReportedInfo[0].callsign = 'YD99999' // the source restates a different callsign
  await ingestGfwEntry(pool, S, e2)
  const rows = await q(`SELECT value_raw, status FROM ${S}.assertions WHERE source_entity_id = $1 AND attribute = 'callsign' ORDER BY id`, [r1.entityId])
  assert.deepEqual(rows, [{ value_raw: 'YD23136', status: 'superseded' }, { value_raw: 'YD99999', status: 'active' }])
  // Restating the original re-activates it (and supersedes the other): nothing is ever lost.
  await ingestGfwEntry(pool, S, e)
  const again = await q(`SELECT value_raw, status FROM ${S}.assertions WHERE source_entity_id = $1 AND attribute = 'callsign' ORDER BY id`, [r1.entityId])
  assert.deepEqual(again, [{ value_raw: 'YD23136', status: 'active' }, { value_raw: 'YD99999', status: 'superseded' }])
})

test('recorded live GABU REEFER resolves each real MMSI only inside its own window', { skip }, async () => {
  const r = await ingestGfwEntry(pool, S, fixture('gfw-live-gabu-reefer-2026-09-24.json'))
  const v = r.resolution.vesselId
  const at = async (mmsi, t) => (await vesselsForMmsiAt(q, S, mmsi, t)).vesselIds
  assert.ok((await at('629009266', '2025-06-01T00:00:00Z')).includes(v))
  assert.ok(!(await at('629009266', '2023-06-01T00:00:00Z')).includes(v))
  assert.ok((await at('616852000', '2015-06-01T00:00:00Z')).includes(v))
})

test('CRESTY and GOLDENEYE (recorded live) stay two vessels despite a shared AIS identity', { skip }, async () => {
  const rc = await ingestGfwEntry(pool, S, fixture('gfw-live-cresty-2026-09-24.json'))
  const rg = await ingestGfwEntry(pool, S, fixture('gfw-live-goldeneye-2026-09-24.json'))
  assert.notEqual(rc.entityId, rg.entityId)
  assert.notEqual(rc.resolution.vesselId, rg.resolution.vesselId)
  assert.equal(rg.resolution.needsReview, true) // overlapping MMSI windows → candidate, not merge
  // Re-importing both is a no-op (no flip-flop superseding between the two).
  const again = [await ingestGfwEntry(pool, S, fixture('gfw-live-cresty-2026-09-24.json')),
    await ingestGfwEntry(pool, S, fixture('gfw-live-goldeneye-2026-09-24.json'))]
  assert.deepEqual(again.map((r) => [r.recordCreated, r.assertions.created, r.assertions.superseded]), [[false, 0, 0], [false, 0, 0]])
})

test('LINNEA ROSE: GFW identity + real MarineCadastre AIS resolve to ONE vessel (MMSI + call sign)', { skip }, async () => {
  const { ensureMcSource, ingestMcMmsi } = await import('../ingestMc.js')
  const { aggregateRows } = await import('../marinecadastre.js')
  const { readFileSync } = await import('node:fs')
  await ensureMcSource(pool, S)
  const g = await ingestGfwEntry(pool, S, fixture('gfw-live-linnea-rose-2026-09-24.json'))
  const rows = readFileSync(new URL('./fixtures/mc-live-linnea-rose-2026-06-21.ndjson', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const m = await ingestMcMmsi(pool, S, aggregateRows(rows)[0])
  assert.equal(m.resolution.method, 'CALLSIGN_MATCH')
  assert.equal(m.resolution.vesselId, g.resolution.vesselId)
  // A track from 2026-06-21 now resolves to exactly that vessel (not "ambiguous").
  assert.deepEqual(await vesselsForMmsiAt(q, S, '368330140', '2026-06-21T18:00:00Z'), { status: 'resolved', vesselIds: [g.resolution.vesselId] })
  // Both views of its type survive side by side: NOAA/USCG code and GFW's model.
  const types = await valuesAt(q, S, g.resolution.vesselId, 'vessel_type', '2026-06-21T18:00:00Z')
  assert.deepEqual(new Set(types.map((t) => t.evidence_class)), new Set(['ais_published', 'inferred']))
  // Re-import is a no-op.
  const again = await ingestMcMmsi(pool, S, aggregateRows(rows)[0])
  assert.deepEqual([again.recordCreated, again.assertions.created, again.resolution.action], [false, 0, 'keep'])
})

test('re-resolving after a rule change merges what the new rule allows, and keeps the evidence and the old links', { skip }, async () => {
  const { reresolveAll } = await import('../reresolve.js')
  const { withTx: tx } = await import('../db.js')
  // Simulate a boat that an older resolver split in two: two AIS-only GFW entries,
  // same MMSI + call sign, overlapping windows, each forced onto its own vessel.
  const mk = (id, from, to) => ({ dataset: 'test', registryInfo: [], registryOwners: [], registryAuthorizations: [],
    selfReportedInfo: [{ id, ssvid: '367000777', shipname: 'TEST SPLIT', callsign: 'TSPLT', flag: 'USA', sourceCode: ['AIS'],
      transmissionDateFrom: from, transmissionDateTo: to }] })
  const a = await ingestGfwEntry(pool, S, mk('test-split-a', '2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z'))
  const b = await ingestGfwEntry(pool, S, mk('test-split-b', '2024-05-01T00:00:00Z', '2024-12-01T00:00:00Z'))
  assert.equal(b.resolution.vesselId, a.resolution.vesselId) // v1.1 already merges them…
  // …so force the old split, as a v1 run would have left it.
  await tx(pool, async (c) => {
    await c.query(`UPDATE ${S}.entity_links SET status = 'superseded' WHERE source_entity_id = $1 AND status = 'accepted'`, [b.entityId])
    const { rows: [v] } = await c.query(`INSERT INTO ${S}.vessels DEFAULT VALUES RETURNING id`)
    await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, decided_by) VALUES ($1,$2,'accepted','NEW_FROM_SOURCE_ENTITY','resolver:v1')`, [b.entityId, v.id])
  })
  assert.equal((await vesselsForMmsiAt(q, S, '367000777', '2024-05-15T00:00:00Z')).status, 'ambiguous')
  const before = await q(`SELECT count(*)::int n FROM ${S}.assertions`)
  const st = await reresolveAll(pool, S)
  assert.ok(st.vesselsRetired >= 1)
  assert.equal((await vesselsForMmsiAt(q, S, '367000777', '2024-05-15T00:00:00Z')).status, 'resolved')
  assert.deepEqual(await q(`SELECT count(*)::int n FROM ${S}.assertions`), before) // evidence untouched
  const old = await q(`SELECT count(*)::int n FROM ${S}.entity_links WHERE status = 'superseded' AND decided_by = 'resolver:v1'`)
  assert.ok(old[0].n >= 1) // the old interpretation is kept, not deleted
})
