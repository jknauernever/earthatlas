// Pure tests for lib/ships/recordedStops.js (no database, no network).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noaaMonthsIn, placeCoveredMonths, recordedOf } from '../recordedStops.js'

const bake = { months: ['2026-05', '2026-06', '2026-09', '2026-10'], recorded_months: ['2026-09', '2026-10'], recorded_not_covered: ['wa-egt-longview'] }

test('a recorded import refuses NOAA months only', () => {
  assert.deepEqual(noaaMonthsIn(bake, ['2026-06', '2026-09', '2026-11']), ['2026-06'])
  assert.deepEqual(noaaMonthsIn(bake, ['2026-10']), [])
  assert.deepEqual(noaaMonthsIn(null, ['2026-10']), [])
})

test('recorded months count only where the recorder reaches', () => {
  const win = ['2026-06', '2026-09', '2026-10', '2026-11']
  assert.deepEqual(placeCoveredMonths(win, bake, 'wa-bp-cherry-point'), { covered: ['2026-06', '2026-09', '2026-10'], missing: ['2026-11'] })
  assert.deepEqual(placeCoveredMonths(win, bake, 'wa-egt-longview'), { covered: ['2026-06'], missing: ['2026-09', '2026-10', '2026-11'] })
})

test('recordedOf picks the recorded months of a covered list', () => {
  assert.deepEqual(recordedOf(['2026-06', '2026-09'], bake), ['2026-09'])
  assert.deepEqual(recordedOf(['2026-06'], {}), [])
})
