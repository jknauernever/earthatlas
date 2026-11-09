import { test } from 'node:test'
import assert from 'node:assert/strict'
import { antShipName } from '../ecologyAnt.js'
import { namesAgree } from '../bunkerMatch.js'
import { shipMmsis, findCall } from '../oilTransfers.js'

test('notified names shortened as ships broadcast them', () => {
  assert.equal(antShipName('National Geographic  Venture'), 'NAT GEO VENTURE')
  assert.ok(namesAgree('NATIONAL GEOGRAPHIC QUEST', 'NAT GEO QUEST'))
  assert.ok(!namesAgree('NATIONAL GEOGRAPHIC QUEST', 'NAT GEO VENTURE'))
  const mm = new Map([['NATGEOVENTURE', new Set(['369358000'])], ['NATIONALGEOGRAPHICVENTURE', new Set(['1'])]])
  assert.deepEqual([...shipMmsis(mm, 'NATIONAL GEOGRAPHIC VENTURE')].sort(), ['1', '369358000'])
})

test('rule 9 lookup: a call at the other Seattle cruise terminal in the window (findCall)', () => {
  const op = { ship: 'QUEEN ELIZABETH', startAt: '2026-06-22T13:30:00Z', durationH: 6 }
  const calls = [{ terminalKey: 'wa-pos-pier66-bell-street', mmsi: '310625000', aisName: 'QUEEN ELIZABETH', t0: '2026-06-22T13:05:00Z', t1: '2026-06-22T23:33:00Z' }]
  assert.equal(findCall(op, ['wa-pos-pier66-bell-street'], calls, new Set())?.mmsi, '310625000')
  assert.equal(findCall({ ...op, startAt: '2026-06-24T13:30:00Z' }, ['wa-pos-pier66-bell-street'], calls, new Set()), null)
})
