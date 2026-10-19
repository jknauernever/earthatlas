/**
 * Database test for merging records split only by a placeholder call sign (lib/ships/mergeSplits.js, resolver v1.10).
 * DEV database in SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>) dropped afterwards; never "ships", never
 * production. Skipped (NOT RUN) without the URL. Shaped like the real Blackfish VI split (MMSI 368616000): a full record and a
 * 5-day GFW entry whose call sign is GFW's placeholder "DATAHUB". Values are test values, not real claims.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from '../store.js'
import { findPlaceholderSplits, mergeVessel } from '../mergeSplits.js'
import { getVessel } from '../queries.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

before(async () => { if (skip) return; pool = shipsPool(); await migrate(pool, S) })
after(async () => { if (skip) return; await pool.query(`DROP SCHEMA ${S} CASCADE`); await pool.end() })

const SRC = { id: 'test-ais', name: 'test', publisher: 'test', homepage_url: null, license: 'test', license_url: null, commercial_use: false, attribution_text: 'test', attribution_url: null, notes: null }
const claim = (attribute, v, from, to) => ({ attribute, value_raw: v, value_norm: v, period_from: from, period_to: to, period_kind: 'observed', evidence_class: 'ais_self_reported' })

async function record(c, key, claims) {
  const e = await findOrCreateEntity(c, S, { sourceId: SRC.id, kind: 'test_vessel', anchor: key })
  const r = await upsertRecord(c, S, { sourceId: SRC.id, entityId: e.id, payload: { key }, retrievalUrl: null })
  await upsertAssertions(c, S, { entityId: e.id, recordId: r.id, assertions: claims })
  const { rows: [v] } = await c.query(`INSERT INTO ${S}.vessels (needs_review) VALUES (true) RETURNING id::text`)
  await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, decided_by) VALUES ($1, $2, 'accepted', 'NEW_FROM_SOURCE_ENTITY', 'resolver:v1.1')`, [e.id, v.id])
  return { entity: e.id, vessel: v.id }
}

test('a DATAHUB-only split merges into the fuller record, keeps every claim, and its old id still opens the boat', { skip }, async () => {
  const { full, frag } = await withTx(pool, async (c) => {
    await upsertSource(c, S, SRC)
    const full = await record(c, 'full', [claim('mmsi', '368616000', '2024-06-08', '2026-09-22'), claim('name', 'BLACKFISHVI', '2024-06-08', '2026-09-22'),
      claim('callsign', 'WDP4981', '2024-06-08', '2026-09-22'), claim('length_m', '18', '2024-06-08', '2026-09-22')])
    const frag = await record(c, 'frag', [claim('mmsi', '368616000', '2026-03-14', '2026-03-18'), claim('name', 'BLACKFISHVI', '2026-03-14', '2026-03-18'),
      claim('callsign', 'DATAHUB', '2026-03-14', '2026-03-18')])
    // The resolver's earlier verdict: the fragment's entity may also be the full record (same MMSI, overlapping time).
    await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by) VALUES ($1, $2, 'candidate', 'MMSI_TEMPORAL', $3, 'resolver:v1.1')`,
      [frag.entity, full.vessel, { mmsi: '368616000' }])
    return { full, frag }
  })
  const pairs = await findPlaceholderSplits(q, S)
  assert.deepEqual(pairs.map((p) => [p.keep, p.merge]), [[full.vessel, frag.vessel]])
  const r = await withTx(pool, (c) => mergeVessel(c, S, pairs[0]))
  assert.equal(r.links_moved, 1)
  assert.equal(r.keep_still_needs_review, false)
  const [m] = await q(`SELECT status, merged_into::text FROM ${S}.vessels WHERE id = $1`, [frag.vessel])
  assert.deepEqual(m, { status: 'merged', merged_into: full.vessel })
  // Every claim of both records now sits on the kept vessel; nothing was deleted.
  const onKeep = await q(`SELECT attribute, value_norm FROM ${S}.vessel_assertions WHERE vessel_id = $1 ORDER BY 1, 2`, [full.vessel])
  assert.ok(onKeep.some((a) => a.attribute === 'callsign' && a.value_norm === 'DATAHUB'))
  assert.equal(onKeep.filter((a) => a.attribute === 'mmsi').length, 2)
  // The fragment's old id opens the kept boat.
  const v = await getVessel(q, S, frag.vessel)
  assert.equal(v.vessel.id, full.vessel)
  assert.equal(v.merged_from, frag.vessel)
  // Run again: nothing left to merge.
  assert.equal((await findPlaceholderSplits(q, S)).length, 0)
})

test('a real call-sign conflict never merges', { skip }, async () => {
  const a = await withTx(pool, async (c) => {
    const x = await record(c, 'a', [claim('mmsi', '367000001', '2025-01-01', '2025-12-31'), claim('name', 'SEALION', '2025-01-01', '2025-12-31'), claim('callsign', 'WAA1111', '2025-01-01', '2025-12-31')])
    const y = await record(c, 'b', [claim('mmsi', '367000001', '2025-06-01', '2025-06-05'), claim('name', 'SEALION', '2025-06-01', '2025-06-05'),
      claim('callsign', 'WBB2222', '2025-06-01', '2025-06-05'), claim('callsign', 'DATAHUB', '2025-06-01', '2025-06-05')])
    await c.query(`INSERT INTO ${S}.entity_links (source_entity_id, vessel_id, status, method, evidence, decided_by) VALUES ($1, $2, 'candidate', 'MMSI_TEMPORAL', $3, 'resolver:v1.1')`,
      [y.entity, x.vessel, { mmsi: '367000001' }])
    return x
  })
  assert.equal((await findPlaceholderSplits(q, S, { vesselIds: [a.vessel] })).length, 0)
})
