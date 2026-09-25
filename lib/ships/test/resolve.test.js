import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../resolve.js'

const base = { acceptedVesselId: null, registryImos: [], imoVessels: {}, aisImoVessels: {}, mmsiOverlaps: [] }

test('no match → new vessel', () => {
  assert.equal(decide(base).action, 'new')
})
test('single registry IMO held by exactly one vessel → IMO_EXACT accept', () => {
  const d = decide({ ...base, registryImos: ['8300949'], imoVessels: { '8300949': ['v1'] } })
  assert.deepEqual([d.action, d.vesselId, d.method], ['accept', 'v1', 'IMO_EXACT'])
})
test('IMO held by two vessels → unresolved with candidates, never a forced merge', () => {
  const d = decide({ ...base, registryImos: ['8300949'], imoVessels: { '8300949': ['v1', 'v2'] } })
  assert.equal(d.action, 'unresolved')
  assert.equal(d.candidates.length, 2)
})
test('conflicting IMOs inside one entity → new vessel flagged for review', () => {
  const d = decide({ ...base, registryImos: ['9000013', '9000025'], imoVessels: { '9000013': ['v1'] } })
  assert.equal(d.action, 'new'); assert.equal(d.needsReview, true)
  assert.deepEqual(d.candidates.map((c) => c.vesselId), ['v1'])
})
test('MMSI overlap alone never merges; it only yields a candidate', () => {
  const d = decide({ ...base, mmsiOverlaps: [{ vesselId: 'v9', mmsi: '999000111' }] })
  assert.equal(d.action, 'new'); assert.equal(d.candidates[0].method, 'MMSI_TEMPORAL')
})
test('AIS-reported IMO alone never merges; it only yields a candidate', () => {
  const d = decide({ ...base, aisImoVessels: { '8300949': ['v1'] } })
  assert.equal(d.action, 'new'); assert.equal(d.candidates[0].evidence.basis, 'ais_self_reported')
})
test('an accepted entity is kept even when new evidence points elsewhere', () => {
  const d = decide({ ...base, acceptedVesselId: 'v1', registryImos: ['8300949'], imoVessels: { '8300949': ['v2'] } })
  assert.deepEqual([d.action, d.vesselId, d.needsReview], ['keep', 'v1', true])
})
