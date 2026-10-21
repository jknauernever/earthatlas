// Likely bunkering (lib/ships/bunkerEvents.js): the pure pieces. Offline; the pairs are shaped like bunker_events.py export rows
// from the March 2026 bake (Port Angeles, SAN VICENTE with SEVERN and DR MILTON WANER alongside at once).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeAcrossDays, groupFuelings, summarizeBunkering } from '../bunkerEvents.js'

const ev = (o) => ({ anchorage: 'uscg-vts-ps-nondesignated|(a)(14)(ii)', inside: false, receiver: '563052800', supplier: '367371840',
  minutes: 30, min_m: 60, median_m: 80, ...o })

test('events cut at midnight join; short leftovers drop', () => {
  const out = mergeAcrossDays([
    ev({ t0: '2026-03-30T22:30:00Z', t1: '2026-03-30T23:59:00Z', minutes: 40, min_m: 55 }),
    ev({ t0: '2026-03-31T00:00:00Z', t1: '2026-03-31T02:10:00Z', minutes: 50, min_m: 41, inside: true }),
    ev({ t0: '2026-03-31T09:00:00Z', t1: '2026-03-31T09:30:00Z' }),                 // 30 min on its own: dropped
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].t0, '2026-03-30T22:30:00Z')
  assert.equal(out[0].t1, '2026-03-31T02:10:00Z')
  assert.equal(out[0].minutes, 90)
  assert.equal(out[0].min_m, 41)
  assert.equal(out[0].inside, true)
})

test('a break longer than 15 minutes keeps two events', () => {
  const out = mergeAcrossDays([
    ev({ t0: '2026-03-10T01:00:00Z', t1: '2026-03-10T02:30:00Z' }),
    ev({ t0: '2026-03-10T03:00:00Z', t1: '2026-03-10T04:10:00Z' }),
  ])
  assert.equal(out.length, 2)
})

const side = (mmsi, name, vesselId = null) => ({ mmsi, name, vesselId, kind: { label: 'Towing / pushing' } })
const ship = { mmsi: '563052800', name: 'SAN VICENTE', vesselId: 'v-san-vicente', kind: { label: 'Cargo' } }

test('two tugs overlapping on one ship are one fueling', () => {
  const fs = groupFuelings([
    { t0: '2026-03-30T18:04:00.000Z', t1: '2026-03-30T21:55:00.000Z', outside: true, minM: 58, receiver: ship, supplier: side('367371840', 'SEVERN') },
    { t0: '2026-03-30T18:01:00.000Z', t1: '2026-03-30T23:52:00.000Z', outside: true, minM: 41, receiver: ship, supplier: side('367741150', 'DR MILTON WANER') },
    { t0: '2026-03-31T10:00:00.000Z', t1: '2026-03-31T12:00:00.000Z', outside: false, minM: 70, receiver: ship, supplier: side('367371840', 'SEVERN') },
  ])
  assert.equal(fs.length, 2)
  assert.deepEqual(fs[0].suppliers.map((s) => s.name), ['DR MILTON WANER', 'SEVERN'])
  assert.equal(fs[0].t1, '2026-03-30T23:52:00.000Z')
  assert.equal(fs[0].hours, 5.9)
  assert.equal(fs[0].minM, 41)
})

test('summary counts fuelings, ships, suppliers; uncounted months are null', () => {
  const evs = [
    { t0: '2026-03-30T18:04:00.000Z', t1: '2026-03-30T21:55:00.000Z', outside: true, minM: 58, receiver: ship, supplier: side('367371840', 'SEVERN') },
    { t0: '2026-03-30T18:01:00.000Z', t1: '2026-03-30T23:52:00.000Z', outside: true, minM: 41, receiver: ship, supplier: side('367741150', 'DR MILTON WANER') },
  ]
  const s = summarizeBunkering(evs, ['2026-02', '2026-03'], ['2026-03'])
  assert.equal(s.summary.fuelings, 1)
  assert.equal(s.summary.ships, 1)
  assert.equal(s.summary.suppliers, 2)
  assert.deepEqual(s.summary.perMonth, [{ month: '2026-02', n: null }, { month: '2026-03', n: 1 }])
})
