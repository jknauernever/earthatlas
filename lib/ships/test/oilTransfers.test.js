import { test } from 'node:test'
import assert from 'node:assert/strict'
import { partyKind, pickShip, productGroup, placeTerminals, findCall, isAnchorage, inAisBox, scrubberOf } from '../oilTransfers.js'
import { dockScanFile, dockRadius } from '../dockCalls.js'
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
    terminals: ['t'], status: 'seen', reason: null, scrubberVessel: 'v1', scrubberSrc: 'gisis',
    seen: { kind: 'call', terminalKey: 't', t0: '2025-01-01T09:00:00.000Z', t1: '2025-01-01T12:00:00.000Z', mmsi: '1', aisName: 'OHIO', delayH: 1 } },
  { antIds: ['3'], recordIds: [7], startAt: '2025-02-01T08:00:00.000Z', durationH: null, company: null, receiver: 'S', receiverType: 'PASSENGER SHIP', deliverers: [],
    delivererType: null, location: 'Anchor - Y', city: 'Z', region: null, transferTypes: [], products: [], gallons: null, isPreboomed: false, rateGt500: true,
    contacts: [], ship: 'S', shipType: 'PASSENGER SHIP', group: 'ships', setting: 'anchorage', terminals: [], status: 'seen', reason: null,
    scrubberVessel: null, scrubberSrc: null,
    seen: { kind: 'alongside', t0: '2025-02-01T09:00:00.000Z', t1: '2025-02-01T11:00:00.000Z', hours: 2, place: 'Y', tugs: ['T1'], delayH: 1 } },
  { antIds: ['4'], recordIds: [8], startAt: '2025-03-01T08:00:00.000Z', durationH: 1, company: null, receiver: 'COHO', receiverType: 'PASSENGER SHIP', deliverers: ['Truck'],
    delivererType: 'Mobile', location: 'PORT ANGELES FERRY TERM', city: null, region: null, transferTypes: ['Fueling'], products: [], gallons: 10, isPreboomed: null, rateGt500: null,
    contacts: [], ship: 'COHO', shipType: 'PASSENGER SHIP', group: 'ships', setting: 'dock', terminals: ['ant-port-angeles-ferry-term'], status: 'seen', reason: null,
    scrubberVessel: null, scrubberSrc: null,
    seen: { kind: 'dock', terminalKey: 'ant-port-angeles-ferry-term', t0: '2025-03-01T07:00:00.000Z', t1: '2025-03-01T21:00:00.000Z', mmsi: '9', aisName: 'COHO', delayH: -1 } }]
  assert.deepEqual(unpackOps(JSON.parse(JSON.stringify(packOps(ops)))), ops)
})

test('groupAntOperations keyOf: a refinery receiving from two tankers is two operations', () => {
  const row = (antId, deliverer, t) => ({ antId, receiver: 'Refinery', receiverType: 'Facility', deliverer, delivererType: 'TANK SHIP', location: 'R', startAt: t,
    startLocal: t, product: 'CRUDE OIL', gallons: 1, transferType: 'Cargo' })
  const rows = [row('1', 'OHIO', '2025-01-01T08:00:00.000Z'), row('2', 'POLAR', '2025-01-01T10:00:00.000Z')]
  assert.equal(groupAntOperations(rows).length, 1)
  assert.equal(groupAntOperations(rows, { keyOf: (n) => pickShip(n).ship }).length, 2)
})

test('scrubberOf: flagged only when every ship carrying the name is fitted; the seen MMSI narrows it', () => {
  const a = { vesselId: 'a', mmsis: new Set(['1']) }, b = { vesselId: 'b', mmsis: new Set(['2']) }
  const fitted = new Map([['a', 'gisis']])
  assert.deepEqual(scrubberOf([a], fitted), { vesselId: 'a', src: 'gisis' })
  assert.equal(scrubberOf([a, b], fitted), null)                       // the name also belongs to a ship without one
  assert.deepEqual(scrubberOf([a, b], fitted, '1'), { vesselId: 'a', src: 'gisis' })
  assert.equal(scrubberOf([a, b], fitted, '2'), null)
  assert.equal(scrubberOf([a], fitted, '7'), null)                     // AIS saw an MMSI none of them holds
  assert.equal(scrubberOf([], fitted), null)
})

test('dock scan file: every dock at the collection radius, its own radius applied at export; dockRadius', () => {
  const docks = [{ key: 'd1', ecology: 'X', lat: 48.1, lon: -122.7, radius_m: 250 }, { key: 'd2', ecology: 'Y', lat: 48.1, lon: -122.7 }]
  const f = dockScanFile(docks)
  assert.equal(f.overlap, 'all')
  assert.deepEqual(f.berths.map((b) => [b.terminal, b.radius_m, b.call_radius_m, b.in_box]), [['d1', 1000, 250, true], ['d2', 1000, 150, true]])
  const within = dockRadius(docks)
  assert.ok(within('d1', 240)); assert.ok(!within('d1', 260)); assert.ok(within('d2', 150)); assert.ok(!within('zz', 1))
})

test('proposePairs: the tug present through most notified transfers; escorts that come and go are not proposed', async () => {
  const { proposePairs, findTugCall } = await import('../bargeTugs.js')
  const H = 3600e3, day = (i) => Date.parse('2025-03-01T00:00:00Z') + i * 24 * H
  const ops = [0, 1, 2, 3, 4, 5].map((i) => ({ barge: 'BARGE X', startAt: new Date(day(i)).toISOString(), durationH: 10, places: ['t1'] }))
  const calls = ops.flatMap((o, i) => [
    { mmsi: '111', aisName: 'WORKER', t0: day(i) - 2 * H, t1: day(i) + 12 * H },           // stays through
    { mmsi: '222', aisName: 'ESCORT', t0: day(i) - 1 * H, t1: day(i) + 1 * H },            // arrival only
  ])
  const [p, ...rest] = proposePairs(ops, new Map([['t1', calls]]))
  assert.equal(rest.length, 0)
  assert.deepEqual([p.barge, p.mmsi, p.aisName, p.ops, p.full], ['BARGE X', '111', 'WORKER', 6, 6])
  assert.equal(proposePairs(ops.slice(0, 4), new Map([['t1', calls]])).length, 0)   // under minOps
  const tc = calls.map((c) => ({ ...c, terminalKey: 't1' }))
  assert.equal(findTugCall(ops[2], ['t1'], tc, '111').t0, day(2) - 2 * H)
  assert.equal(findTugCall(ops[2], ['t2'], tc, '111'), null)
  assert.equal(findTugCall({ startAt: new Date(day(20)).toISOString(), durationH: 5 }, ['t1'], tc, '111'), null)
})
