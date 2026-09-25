import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normName, normImo, normMmsi, imoChecksumOk, parseUtc, rangeLiteral } from '../normalize.js'

test('name normalization is deterministic and punctuation/case/diacritic-insensitive', () => {
  for (const v of ['PACIFIC STAR', 'Pacific Star', 'PACIFIC-STAR', ' pacific  star ', 'Pacífic Star']) {
    assert.equal(normName(v), 'PACIFICSTAR')
  }
  assert.equal(normName(null), '')
})

test('IMO checksum: documented real IMOs pass, typos fail', () => {
  assert.equal(imoChecksumOk('8300949'), true) // GABU REEFER (GFW docs)
  assert.equal(imoChecksumOk('7831410'), true) // CLAUDINA (GFW docs)
  assert.equal(imoChecksumOk('8969513'), true) // MISS FREYA (GFW docs)
  assert.equal(imoChecksumOk('8300948'), false)
  assert.equal(imoChecksumOk('0000000'), false)
  assert.deepEqual(normImo('IMO 8300949'), { value: '8300949', valid: true })
})

test('MMSI: 9 digits; ship-station range flagged', () => {
  assert.deepEqual(normMmsi('368045130'), { value: '368045130', valid: true, ship: true })
  assert.deepEqual(normMmsi('003669999'), { value: '003669999', valid: true, ship: false }) // coast station
  assert.equal(normMmsi('12345').valid, false)
})

test('timestamps: both GFW formats parse to UTC; zone-less input is rejected, not guessed', () => {
  assert.equal(parseUtc('2019-04-06T13:12:43Z'), '2019-04-06T13:12:43.000Z')
  assert.equal(parseUtc('2012-05-25 15:16:29 UTC'), '2012-05-25T15:16:29.000Z')
  assert.equal(parseUtc('2022-07-17T11:48:43.52Z'), '2022-07-17T11:48:43.520Z')
  assert.equal(parseUtc(null), null)
  assert.throws(() => parseUtc('2019-04-06 13:12:43'), /without explicit zone/)
})

test('ranges: observed is inclusive, validity is [from,to), missing bounds stay unknown', () => {
  assert.equal(rangeLiteral('2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z', 'observed'), '["2020-01-01T00:00:00.000Z","2021-01-01T00:00:00.000Z"]')
  assert.equal(rangeLiteral('2020-01-01T00:00:00.000Z', null, 'validity'), '["2020-01-01T00:00:00.000Z",)')
  assert.equal(rangeLiteral(null, null, 'unknown'), '(,)')
})
