/**
 * SkyTruth Cerulean helpers (pure; offline). Values mirror real API replies seen 2026-10-14 (slick 3582918's source
 * ranking; tile arrays arrive as Postgres literals); the ship periods are SYNTHETIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { credibleFilter, idList, matchWords, slicksForPeriods } from '../cerulean.js'

test('credibleFilter: SkyTruth rule; the 72-hour window ends at `to` or tomorrow, whichever is first', () => {
  assert.equal(credibleFilter('2026-06-01', '2026-10-14'),
    "max_source_collated_score > 0 OR (slick_confidence >= 0.8 AND slick_timestamp > TIMESTAMP('2026-05-29T00:00:00'))")
  assert.match(credibleFilter('2026-11-01', '2026-10-14'), /TIMESTAMP\('2026-10-12T00:00:00'\)/)
  assert.doesNotMatch(credibleFilter('2026-11-01', '2026-10-14'), /Z'\)/) // a zone marker makes the API answer 500
  assert.throws(() => credibleFilter("2026-01-01') OR 1=1 --"))
})

test('idList: tile literals and JSON arrays', () => {
  assert.deepEqual(idList('{366515000,367414780}'), ['366515000', '367414780'])
  assert.deepEqual(idList(['538006807', 636020384]), ['538006807', '636020384'])
  assert.deepEqual(idList(null), [])
})

test('matchWords: model score in words, never a percentage', () => {
  assert.equal(matchWords(0.4707), 'Possible match')   // slick 3582918, rank 1
  assert.equal(matchWords(-0.5426), 'Weak match')      // slick 3582918, rank 2
  assert.equal(matchWords(0.5), 'Good match')
  assert.equal(matchWords(1.142), 'Strong match')
  assert.equal(matchWords(null), null)
})

test('slicksForPeriods: a slick counts only while this ship held the MMSI', () => {
  const rows = [
    { mmsi: '538006807', slick_id: 1, slick_timestamp: '2024-01-13T16:56:11' },
    { mmsi: '538006807', slick_id: 2, slick_timestamp: '2021-03-01T00:00:00' },
    { mmsi: '999999999', slick_id: 3, slick_timestamp: '2024-01-13T16:56:11' },
  ]
  const periods = [{ mmsi: '538006807', from: '2022-05-01T00:00:00Z', to: '2024-01-13T00:00:00Z' }]
  assert.deepEqual(slicksForPeriods(rows, periods).map((r) => r.slick_id), [1]) // last sighting's day is inclusive
  assert.deepEqual(slicksForPeriods(rows, [{ mmsi: '538006807', from: null, to: null }]).map((r) => r.slick_id), [1, 2])
})
