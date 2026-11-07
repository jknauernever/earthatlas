import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partyKind, pickShip, productGroup, placeTerminals, findCall, isAnchorage, inAisBox } from '../oilTransfers.js'
import { packOps, unpackOps } from '../oilTransfersPack.js'
import { groupAntOperations } from '../ecologyAnt.js'

test('partyKind: Ecology vessel types → facility / barge / small / military / ship', () => {
  assert.equal(partyKind('Facility'), 'facility')
  assert.equal(partyKind('Mobile'), 'facility')
  assert.equal(partyKind('TANK BARGE'), 'barge')
  assert.equal(partyKind('ATB BARGE'), 'barge')
  assert.equal(partyKind('FISHING VESSEL'), 'small')
  assert.equal(partyKind('Un-regulated Vessel'), 'small')
  assert.equal(partyKind('MILITARY/LAW ENFORCEMENT'), 'military')
  assert.equal(partyKind('TANK SHIP'), 'ship')
  assert.equal(partyKind('ATB TUG'), 'ship')
  assert.equal(partyKind('Z- UNKNOWN'), 'unknown')
})

test('pickShip: the AIS-carrying party, receiver first; barges and facilities never', () => {
  const op = (receiver, receiverType, deliverer, delivererType) => ({ receiver, receiverType, deliverers: [deliverer], delivererType })
  assert.deepEqual(pickShip(op('CARNIVAL SPIRIT', 'PASSENGER SHIP', 'BARGE 1', 'TANK BARGE')).ship, 'CARNIVAL SPIRIT')
  // cargo from a tanker to a refinery: the deliverer
  const c = pickShip(op('Puget Sound Refinery', 'Facility', 'OHIO', 'TANK SHIP'))
  assert.equal(c.ship, 'OHIO'); assert.equal(c.role, 'deliverer'); assert.equal(c.group, 'ships')
  // refinery → ATB barge: nothing named broadcasts AIS
  assert.equal(pickShip(op('ATB BARGE 550-1', 'ATB BARGE', 'Puget Sound Refinery', 'Facility')).group, 'noAis')
  assert.equal(pickShip(op('NORTHERN LIGHT', 'FISHING VESSEL', 'Fuel dock', 'Facility')).group, 'small')
  const m = pickShip(op('USNS RAINIER', 'MILITARY/LAW ENFORCEMENT', 'Manchester', 'Facility'))
  assert.equal(m.group, 'ships'); assert.equal(m.military, true)
})

test('productGroup groups Ecology product names', () => {
  assert.equal(productGroup('CRUDE OIL'), 'Crude oil')
  assert.equal(productGroup('Bunker Oil/HFO (0.5 - 3.5% Sulfur)'), 'Heavy fuel oil, 0.5–3.5% sulfur')
  assert.equal(productGroup('Bunker Oil/HFO (IMO < 0.5% Sulfur)'), 'Heavy fuel oil, ≤0.5% sulfur')
  assert.equal(productGroup('Diesel/Marine Gas Oil (ECA < 0.1% Sulfur'), 'Marine gas oil / diesel')
  assert.equal(productGroup('DIESEL LOW SULPHUR (ULSD)'), 'Marine gas oil / diesel')
  assert.equal(productGroup('Renewable Diesel'), 'Renewable diesel / biodiesel')
  assert.equal(productGroup('Cat Feed/VGO'), 'Refinery feedstocks and blendstocks')
  assert.equal(productGroup('OILY WATER MIXTURE'), 'Oily water / waste oil')
})

test('isAnchorage / inAisBox', () => {
  assert.ok(isAnchorage('Anchor - PORT ANGELES'))
  assert.ok(!isAnchorage('SEATTLE PIER 91'))
  assert.ok(inAisBox(47.6, -122.4))
  assert.ok(!inAisBox(46.9, -124.1))   // Westport (Grays Harbor)
})

test('placeTerminals: the table first ([] and "gap"), else the nearest berth within autoKm', () => {
  const berths = [{ terminalKey: 'a', lat: 47.6, lon: -122.4 }, { terminalKey: 'b', lat: 47.6, lon: -122.398 }]
  const locs = [{ location: 'TABLE', lat: 47.6, lon: -122.4 }, { location: 'NONE', lat: 47.6, lon: -122.4 }, { location: 'GAP', lat: 47.6, lon: -122.4 },
    { location: 'AUTO', lat: 47.6001, lon: -122.4 }, { location: 'FAR', lat: 47.7, lon: -122.4 }]
  const m = placeTerminals(locs, berths, { TABLE: ['b'], NONE: [], GAP: 'gap' })
  assert.deepEqual(m.get('TABLE'), { terminals: ['b'], gap: false, from: 'table' })
  assert.deepEqual(m.get('NONE'), { terminals: [], gap: false, from: 'table' })
  assert.equal(m.get('GAP').gap, true)
  assert.deepEqual(m.get('AUTO').terminals, ['a'])
  assert.deepEqual(m.get('FAR').terminals, [])
})

test('findCall: same ship (MMSI or name), its terminal, overlapping the widened window', () => {
  const op = { ship: 'OHIO', startAt: '2025-01-01T08:00:00Z', durationH: 10 }
  const calls = [
    { terminalKey: 't', mmsi: '1', aisName: 'OTHER', t0: '2025-01-01T09:00:00Z', t1: '2025-01-01T12:00:00Z' },
    { terminalKey: 'u', mmsi: '2', aisName: 'OHIO', t0: '2025-01-01T09:00:00Z', t1: '2025-01-01T12:00:00Z' },
    { terminalKey: 't', mmsi: '3', aisName: 'OHIO', t0: '2025-01-02T06:00:00Z', t1: '2025-01-02T08:00:00Z' },   // after 08+10+6 h
  ]
  assert.equal(findCall(op, ['t'], calls, new Set()), null)
  assert.equal(findCall(op, ['t'], calls, new Set(['1'])).mmsi, '1')
  assert.equal(findCall(op, ['u'], calls, new Set()).mmsi, '2')
})

test('packOps / unpackOps round-trip', () => {
  const ops = [{ antIds: ['1', '2'], recordIds: [5, 6], startAt: '2025-01-01T08:01:00.000Z', durationH: 3.5, company: 'Co', receiver: 'OHIO', receiverType: 'TANK SHIP',
    deliverers: ['Refinery'], delivererType: 'Facility', location: 'X', city: null, region: 'King', transferTypes: ['Cargo'], products: [{ product: 'CRUDE OIL', gallons: 1000 }],
    gallons: 1000, isPreboomed: true, rateGt500: null, contacts: [{ name: 'A', phone: null }], ship: 'OHIO', shipType: 'TANK SHIP', group: 'ships', setting: 'dock',
    terminals: ['t'], status: 'seen', reason: null,
    seen: { kind: 'call', terminalKey: 't', t0: '2025-01-01T09:00:00.000Z', t1: '2025-01-01T12:00:00.000Z', mmsi: '1', aisName: 'OHIO', delayH: 1 } },
  { antIds: ['3'], recordIds: [7], startAt: '2025-02-01T08:00:00.000Z', durationH: null, company: null, receiver: 'S', receiverType: 'PASSENGER SHIP', deliverers: [],
    delivererType: null, location: 'Anchor - Y', city: 'Z', region: null, transferTypes: [], products: [], gallons: null, isPreboomed: false, rateGt500: true,
    contacts: [], ship: 'S', shipType: 'PASSENGER SHIP', group: 'ships', setting: 'anchorage', terminals: [], status: 'seen', reason: null,
    seen: { kind: 'alongside', t0: '2025-02-01T09:00:00.000Z', t1: '2025-02-01T11:00:00.000Z', hours: 2, place: 'Y', tugs: ['T1'], delayH: 1 } }]
  assert.deepEqual(unpackOps(JSON.parse(JSON.stringify(packOps(ops)))), ops)
})

test('groupAntOperations keyOf: a refinery receiving from two tankers is two operations', () => {
  const row = (antId, deliverer, t) => ({ antId, receiver: 'Refinery', receiverType: 'Facility', deliverer, delivererType: 'TANK SHIP', location: 'R', startAt: t,
    startLocal: t, product: 'CRUDE OIL', gallons: 1, transferType: 'Cargo' })
  const rows = [row('1', 'OHIO', '2025-01-01T08:00:00.000Z'), row('2', 'POLAR', '2025-01-01T10:00:00.000Z')]
  assert.equal(groupAntOperations(rows).length, 1)
  assert.equal(groupAntOperations(rows, { keyOf: (n) => pickShip(n).ship }).length, 2)
})
