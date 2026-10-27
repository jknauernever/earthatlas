/**
 * Whale paths (lib/whales/paths.js): which reports join, which stay apart — pure, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chainSightings, reportIds, pathSpan } from '../paths.js'

const ORCA = { id: 41521, scientific: 'Orcinus orca', common: 'Orca' }
const HUMP = { id: 41482, scientific: 'Megaptera novaeangliae', common: 'Humpback Whale' }
const at = (hhmm) => `2026-10-26T${hhmm}:00.000Z`
const r = (id, hhmm, lat, lng, extra = {}) => ({ id, taxon: ORCA, observed_at: at(hhmm), observed_date: '2026-10-26', time_precision: 'exact', lat, lng, ...extra })

test('ids: orca catalogue numbers and humpback catalogue numbers from the notes', () => {
  assert.deepEqual(reportIds(r('a', '20:00', 47.8, -122.4, { remarks: '[Orca Network] Biggs T37A, T37A2, T37A4 NB (Kim)' })), ['T37A', 'T37A2', 'T37A4'])
  assert.deepEqual(reportIds({ taxon: HUMP, remarks: 'BCY0324 "Big Mama" and calf' }), ['BCY0324'])
  assert.deepEqual(reportIds({ taxon: HUMP, remarks: 'seen from the J1 boat' }), [], 'J/K/L/T numbers only count for orcas')
  assert.deepEqual(reportIds({ taxon: HUMP, individual: { id: '123', label: 'Spinnaker' } }), ['SPINNAKER'])
})

test('a pod moving up the sound is one path, oldest first', () => {
  const p = chainSightings([
    r('c', '21:00', 47.90, -122.45), r('a', '20:00', 47.80, -122.45), r('b', '20:30', 47.85, -122.45),
  ])
  assert.equal(p.length, 1)
  assert.deepEqual(p[0].members.map((m) => m.id), ['a', 'b', 'c'])
  assert.equal(pathSpan(p[0]), 'seen 3× over 1 h')
})

test('too far for the time between them, or too long a silence: separate', () => {
  assert.equal(chainSightings([r('a', '20:00', 47.8, -122.45), r('b', '20:10', 48.2, -122.45)]).length, 0, '44 km in 10 min')
  assert.equal(chainSightings([r('a', '12:00', 47.8, -122.45), r('b', '16:00', 47.81, -122.45)]).length, 0, '4 h gap')
})

test('different species, or different named animals, never join', () => {
  assert.equal(chainSightings([r('a', '20:00', 47.8, -122.45), r('b', '20:20', 47.82, -122.45, { taxon: HUMP })]).length, 0)
  assert.equal(chainSightings([
    r('a', '20:00', 47.8, -122.45, { remarks: 'Biggs T37A' }), r('b', '20:20', 47.82, -122.45, { remarks: 'J pod J27' }),
  ]).length, 0)
})

test('the same named animals join across a longer gap; unnamed reports join named ones', () => {
  const p = chainSightings([
    r('a', '12:00', 47.80, -122.45, { remarks: 'T37A NB' }), r('b', '15:30', 47.95, -122.45, { remarks: 'T37A still NB' }),
    r('c', '15:50', 47.97, -122.45, { remarks: 'Orcas NB' }),
  ])
  assert.equal(p.length, 1)
  assert.deepEqual(p[0].ids, ['T37A'])
  assert.equal(p[0].members.length, 3)
})

test('date-only, obscured and 0.1°-rounded reports are left as single reports', () => {
  assert.equal(chainSightings([
    r('a', '20:00', 47.8, -122.45), { ...r('b', '20:20', 47.81, -122.45), time_precision: 'day', observed_at: null },
    r('c', '20:30', 47.9, -122.4), r('d', '20:40', 47.81, -122.44, { location_obscured: true }),
  ]).length, 0)
})

test('two observers reporting one spot at once is not a path', () => {
  assert.equal(chainSightings([r('a', '20:00', 47.8, -122.45), r('b', '20:05', 47.8, -122.45)]).length, 0)
})
