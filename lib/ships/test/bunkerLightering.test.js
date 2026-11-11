import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aisShipOf, matchOperations, MATCH_RULE } from '../bunkerMatch.js'
import { groupFuelings } from '../bunkerEvents.js'

const op = (deliverer, delivererType, receiver, receiverType, kind = 'lightering') => ({ kind, deliverers: [deliverer], delivererType, receiver, receiverType })

test('lightering is matched on the side that is not a barge (bm2)', () => {
  assert.equal(MATCH_RULE.version, 'bm3')
  // Port Angeles: a tanker unloads to a bunker barge → the tanker (deliverer).
  assert.equal(aisShipOf(op('OHIO', 'TANK SHIP', 'DOUBLE SKIN 505', 'TANK BARGE')), 'OHIO')
  // Vendovi / March Point: an ATB barge loads a tanker → the tanker (receiver), as AIS shows its tug beside CABO FUJI.
  assert.equal(aisShipOf(op('ATB BARGE 650-7', 'ATB BARGE', 'CABO FUJI', 'TANK SHIP')), 'CABO FUJI')
  assert.equal(aisShipOf(op('OLYMPIC SPIRIT', 'TANK BARGE', 'CABO KAMUI', 'TANK SHIP')), 'CABO KAMUI')
  // Barge to barge: the deliverer, as before.
  assert.equal(aisShipOf(op('ATB BARGE 550-4', 'ATB BARGE', 'ATB BARGE 550-2', 'ATB BARGE')), 'ATB BARGE 550-4')
  // Fueling is always the receiver.
  assert.equal(aisShipOf(op('BARGE X', 'TANK BARGE', 'MAERSK SAN VICENTE', 'CONTAINER SHIP', 'fueling')), 'MAERSK SAN VICENTE')
})

// Real case (production, 2025-12-19/20): OHIO at Port Angeles, four notices, four tug sessions each about 4 h before its notice.
const ohio = { mmsi: '338227000', vesselId: 'v-ohio', name: 'OHIO' }
const PA = { lat: 48.141, lon: -123.376 }
const notice = (id, startAt, durationH) => ({ antIds: [id], ship: 'OHIO', receiver: 'DOUBLE SKIN 505', startAt, durationH, vesselIds: new Set(['v-ohio']), ...PA })
const session = (t0, t1, tug) => ({ t0, t1, hours: Math.round((new Date(t1) - new Date(t0)) / 3600e3 * 10) / 10, outside: true, receiver: ohio,
  suppliers: [{ mmsi: tug, vesselId: `v-${tug}`, name: tug }], anchorageKey: 'pa', anchorageCenter: { lat: 48.135, lon: -123.40 } })

test('one ship\'s notices pair with its sessions in time order (bm3)', () => {
  const ops = [notice('a', '2025-12-19T17:00:00.000Z', 4), notice('b', '2025-12-20T00:00:00.000Z', 4),
    notice('c', '2025-12-20T07:00:00.000Z', 6), notice('d', '2025-12-20T15:00:00.000Z', 3)]
  const fs = [session('2025-12-19T12:36:00.000Z', '2025-12-19T20:45:00.000Z', 'ELIZABETH ANNE'), session('2025-12-19T20:54:00.000Z', '2025-12-20T03:42:00.000Z', 'HUDSON'),
    session('2025-12-20T03:54:00.000Z', '2025-12-20T13:21:00.000Z', 'SEVERN'), session('2025-12-20T13:42:00.000Z', '2025-12-20T20:42:00.000Z', 'HUDSON')]
  const r = matchOperations(ops, fs)
  assert.equal(r.matched.length, 4)                      // closest-start pairing found 3
  assert.deepEqual(r.matched.map((m) => m.fueling.suppliers[0].name), ['ELIZABETH ANNE', 'HUDSON', 'SEVERN', 'HUDSON'])
  assert.equal(r.notSeen.length, 0)
  assert.ok(r.matched.every((m) => !m.late))
})

test('a late ship: a leftover notice takes the next free session at the same anchorage within lateH (bm3)', () => {
  // Real case (production, 2026-03-25/26): OHIO entered the Strait on 3/26; notice a was lightered ~21 h after its start.
  const ops = [notice('a', '2026-03-25T14:00:00.000Z', 8), notice('b', '2026-03-26T22:00:00.000Z', 8)]
  const fs = [session('2026-03-26T11:09:00.000Z', '2026-03-26T18:30:00.000Z', 'ELIZABETH ANNE'), session('2026-03-26T18:42:00.000Z', '2026-03-27T03:15:00.000Z', 'SEVERN')]
  const r = matchOperations(ops, fs)
  assert.equal(r.matched.length, 2)
  const a = r.matched.find((m) => m.op.antIds[0] === 'a')
  assert.equal(a.late, true)
  assert.equal(a.delayH, 21.2)
  // Never when the session is inside another notice's window, or too far away.
  const r2 = matchOperations([ops[0], { ...ops[1], startAt: '2026-03-26T10:00:00.000Z' }], [fs[0]])
  assert.equal(r2.matched.length, 1); assert.equal(r2.matched[0].op.antIds[0], 'b')
  const r3 = matchOperations([ops[0]], [{ ...fs[0], anchorageCenter: { lat: 48.6, lon: -122.55 } }])
  assert.equal(r3.matched.length, 0)
})

test('the same tug back beside the same ship within an hour is one operation (be5)', () => {
  const ev = (t0, t1, name) => ({ t0, t1, outside: true, minM: 20, receiver: ohio, supplier: { mmsi: name, vesselId: `v-${name}`, name } })
  // Real case: OVERSEAS HOUSTON 2025-09-06, Severn 04:09–12:24 in three AIS pieces, then Elizabeth Anne 12:31–19:45 in two.
  const fs = groupFuelings([ev('2025-09-06T04:09:00.000Z', '2025-09-06T06:37:00.000Z', 'SEVERN'), ev('2025-09-06T06:58:00.000Z', '2025-09-06T09:29:00.000Z', 'SEVERN'),
    ev('2025-09-06T09:55:00.000Z', '2025-09-06T12:24:00.000Z', 'SEVERN'), ev('2025-09-06T12:31:00.000Z', '2025-09-06T14:18:00.000Z', 'ELIZABETH ANNE'),
    ev('2025-09-06T14:59:00.000Z', '2025-09-06T19:45:00.000Z', 'ELIZABETH ANNE')])
  assert.deepEqual(fs.map((f) => [f.t0.slice(11, 16), f.t1.slice(11, 16), f.suppliers.map((s) => s.name).join()]),
    [['04:09', '12:24', 'SEVERN'], ['12:31', '19:45', 'ELIZABETH ANNE']])
})
