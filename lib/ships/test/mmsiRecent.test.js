/**
 * vesselsForMmsiRecent (lib/ships/queries.js): the decision logic with a stubbed query function (no database, no network).
 * The SQL itself is exercised against the dev database by the localhost check (SEASPAN RAIDER, MMSI 316033783).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vesselsForMmsiRecent, RECENT_MMSI_DAYS } from '../queries.js'

const stub = (exact, recent) => { let n = 0; return async () => (n++ === 0 ? exact : recent).map((vessel_id) => ({ vessel_id })) }
const A = '37b8e03a-93ef-4ad2-b851-d6c3ee1a387c', B = '01bcd88c-0b38-4489-9f9e-32584006b5e6'

test('an exact holder at the time wins; the fallback is not asked', async () => {
  assert.deepEqual(await vesselsForMmsiRecent(stub([A], [B]), 'ships', '316033783', '2026-10-18T19:00:00Z'), { status: 'resolved', vesselIds: [A] })
})
test('no holder at the time: the one ship that held the MMSI in the window before', async () => {
  const r = await vesselsForMmsiRecent(stub([], [A]), 'ships', '316033783', '2026-10-18T19:00:00Z')
  assert.equal(r.status, 'resolved')
  assert.deepEqual(r.vesselIds, [A])
  assert.equal(r.basis, 'latest_before')
  assert.equal(r.window_days, RECENT_MMSI_DAYS)
})
test('several ships held it in the window: ambiguous, never a guess; none: unresolved', async () => {
  assert.equal((await vesselsForMmsiRecent(stub([], [A, B]), 'ships', '316033783', '2026-10-18T19:00:00Z')).status, 'ambiguous')
  assert.equal((await vesselsForMmsiRecent(stub([], []), 'ships', '316033783', '2026-10-18T19:00:00Z')).status, 'unresolved')
})
