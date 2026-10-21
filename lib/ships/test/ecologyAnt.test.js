// Ecology Advance Notice of Transfer parsing + matching to AIS (lib/ships/ecologyAnt.js, lib/ships/bunkerMatch.js): the pure pieces.
// Offline. Rows are shaped like the public records release (ANT_Pratt_8-24-2026, sheet "Vessel Oil Transfer (42)"); the first is its
// AntID 258842 (RB LISA, Elliott Bay West, 2025-01-03 12:00 Pacific).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { excelSerialToLocal, localToUtc, parseAntRow, antShipName, groupAntOperations } from '../ecologyAnt.js'
import { namesAgree, matchOperations, learnBunkerTugs } from '../bunkerMatch.js'

test('Excel serial → Pacific local → UTC, across daylight time', () => {
  assert.equal(excelSerialToLocal('45660.5'), '2025-01-03T12:00')
  assert.equal(localToUtc('2025-01-03T12:00'), '2025-01-03T20:00:00.000Z')       // PST, UTC−8
  assert.equal(localToUtc('2025-07-01T12:00'), '2025-07-01T19:00:00.000Z')       // PDT, UTC−7
  assert.equal(excelSerialToLocal('45658.000694444447'), '2025-01-01T00:01')
  assert.equal(excelSerialToLocal(''), null)
})

const row = (o) => ({ row_no: 1, AntID: '258842', Company: 'VANE LINE BUNKERING INC.', StartDateTime: '45660.5', Duration: '7', Deliverer: 'DOUBLE SKIN 311',
  Receiver: 'RB LISA', Location: 'Anchor - ELLIOT BAY WEST (SEATTLE)', LatNumber: '47.594439999999999', LongNumber: '-122.375',
  Product: 'Bunker Oil/HFO (IMO < 0.5% Sulfur)', TransferQtyInGallon: '229759', TransferType: 'Fueling', IsPreboomed: 'Y', IsTransferRateGT500: 'Y',
  ContactName: 'Patrick Dougan', ContactPhone: '206 240-0559', ...o })

test('a released row parses with its text kept (phone numbers stay text)', () => {
  const r = parseAntRow(row({}))
  assert.equal(r.startAt, '2025-01-03T20:00:00.000Z')
  assert.equal(r.gallons, 229759)
  assert.equal(r.isPreboomed, true)
  assert.equal(r.contactPhone, '206 240-0559')
  assert.equal(r.lat, 47.59444)
})

test('product rows of one notice, and a second notice within 12 h, are one operation', () => {
  const rows = [
    row({ row_no: 1 }),
    row({ row_no: 2, Product: 'Diesel/Marine Gas Oil (ECA < 0.1% Sulfur', TransferQtyInGallon: '46453' }),
    row({ row_no: 3, AntID: '258999', StartDateTime: '45660.75', TransferQtyInGallon: '1000', ContactName: 'Other Person' }),
    row({ row_no: 4, AntID: '259500', StartDateTime: '45662.5' }),   // two days later: its own operation
  ].map(parseAntRow)
  const ops = groupAntOperations(rows)
  assert.equal(ops.length, 2)
  assert.deepEqual(ops[0].antIds, ['258842', '258999'])
  assert.equal(ops[0].gallons, 229759 + 46453 + 1000)
  assert.equal(ops[0].contacts.length, 2)
})

test('notice names → AIS names', () => {
  assert.equal(antShipName('ATB TUG PRIDE'), 'PRIDE')
  assert.equal(antShipName('ATB TUG SOUND RELIANCE'), 'SOUND RELIANCE')
  assert.ok(namesAgree('MAERSK SAN VICENTE', 'SAN VICENTE'))
  assert.ok(namesAgree('ATB TUG DUBLIN SEA', 'Dublin Sea'))
  assert.ok(!namesAgree('OHIO', 'NEW OHIO'))   // one word is not enough to call two names one ship
})

const fueling = (o) => ({ t0: '2026-03-30T18:01:00.000Z', t1: '2026-03-30T23:52:00.000Z', hours: 5.9, outside: true,
  receiver: { mmsi: '563052800', vesselId: 'v-san-vicente', name: 'SAN VICENTE' },
  suppliers: [{ mmsi: '367741150', vesselId: 'v-waner', name: 'DR MILTON WANER' }, { mmsi: '367371840', vesselId: 'v-severn', name: 'SEVERN' }],
  anchorageKey: 'uscg-vts-ps-nondesignated|(a)(14)(ii)', anchorageCenter: { lat: 48.13, lon: -123.39 }, ...o })

test('a notice matches the AIS operation on the same ship within the window; others stay apart', () => {
  const op = { antIds: ['1'], receiver: 'MAERSK SAN VICENTE', ship: 'MAERSK SAN VICENTE', startAt: '2026-03-30T17:00:00.000Z', durationH: 7,
    vesselIds: new Set(['v-san-vicente']), lat: 48.133, lon: -123.43 }
  const far = { ...op, antIds: ['2'], startAt: '2026-03-25T17:00:00.000Z' }
  const r = matchOperations([op, far], [fueling({}), fueling({ receiver: { mmsi: '1', vesselId: 'v-other', name: 'OTHER' } })])
  assert.equal(r.matched.length, 1)
  assert.equal(r.matched[0].delayH, 1)
  assert.equal(r.matched[0].hoursDiff, -1.1)
  assert.equal(r.notSeen.length, 1)
  assert.equal(r.unmatched.length, 1)
  const tugs = learnBunkerTugs([...r.matched, ...r.matched])
  assert.deepEqual([...tugs.values()].map((t) => t.name).sort(), ['DR MILTON WANER', 'SEVERN'])
})
