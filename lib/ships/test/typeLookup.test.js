import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeWindows, buildTypeLookup } from '../typeLookup.js'

test('windows of one vessel merge; separate ones stay separate', () => {
  assert.deepEqual(mergeWindows([
    { from: '2026-06-01T00:00:00Z', to: '2026-06-10T00:00:00Z' },
    { from: '2026-06-05T00:00:00Z', to: '2026-06-20T00:00:00Z' },
    { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' }]),
  [{ from: '2026-06-01T00:00:00Z', to: '2026-06-20T00:00:00Z' }, { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' }])
})

// SYNTHETIC rows in the shape typeLookup() reads.
const type = (vessel_id, source_id, evidence_class, value_norm, code, from = null, to = null, period_kind = 'unknown') =>
  ({ vessel_id, source_id, evidence_class, value_norm, detail: { code }, period_kind, from, to })

test('type per MMSI window from the vessel it belongs to; model ranks below AIS; hazard flag carried', () => {
  const { lookup, stats } = buildTypeLookup(
    [{ mmsi: '245206000', vessel_id: 'v1', from: '2025-07-01T00:00:00Z', to: '2026-06-28T00:00:00Z' }],
    [type('v1', 'marinecadastre-ais', 'ais_published', 'AIS_60', 60, '2025-07-01T00:00:00Z', '2026-06-28T00:00:00Z', 'observed'),
      type('v1', 'gfw-vessel-identity', 'inferred', 'OTHER', null),
      type('v1', 'wikidata', 'community_curated', 'WD_Q39804', null)])
  assert.deepEqual(lookup['245206000'], [{ f: '2025-07-01T00:00:00Z', t: '2026-06-28T00:00:00Z', g: 'passenger', c: 'cruise_ship' }])
  assert.equal(stats.specificClass, 1)
  const h = buildTypeLookup([{ mmsi: '366000001', vessel_id: 'v2', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }],
    [type('v2', 'marinecadastre-ais', 'ais_published', 'AIS_83', 83, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z', 'observed')])
  assert.deepEqual(h.lookup['366000001'][0], { f: '2026-01-01T00:00:00Z', t: '2026-02-01T00:00:00Z', g: 'tanker', c: 'tanker_unspecified', h: 'C' })
})

test('one MMSI on two vessels in overlapping windows → both flagged ambiguous, never merged', () => {
  const { lookup, stats } = buildTypeLookup([
    { mmsi: '999000111', vessel_id: 'a', from: '2020-01-01T00:00:00Z', to: '2021-06-30T00:00:00Z' },
    { mmsi: '999000111', vessel_id: 'b', from: '2021-01-01T00:00:00Z', to: '2022-12-31T00:00:00Z' },
    { mmsi: '999000222', vessel_id: 'c', from: '2020-01-01T00:00:00Z', to: '2020-02-01T00:00:00Z' },
  ], [])
  assert.deepEqual(lookup['999000111'].map((e) => e.a), [1, 1])
  assert.equal(lookup['999000222'][0].a, undefined)
  assert.equal(lookup['999000222'][0].g, 'unknown')
  assert.equal(stats.ambiguous, 2)
})

test('a validity-bounded type counts only in windows it overlaps', () => {
  const rows = [type('v', 'wikidata', 'community_curated', 'WD_Q11903334', null, '1993-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 'validity'),
    type('v', 'wikidata', 'community_curated', 'WD_Q1623035', null, '2023-01-01T00:00:00Z', null, 'validity')]
  const { lookup } = buildTypeLookup([{ mmsi: '367000001', vessel_id: 'v', from: '2025-01-01T00:00:00Z', to: '2025-06-01T00:00:00Z' },
    { mmsi: '367000001', vessel_id: 'v', from: '2010-01-01T00:00:00Z', to: '2010-02-01T00:00:00Z' }], rows)
  assert.deepEqual(lookup['367000001'].map((e) => e.c), ['pollution_response', 'buoy_tender'])
})
