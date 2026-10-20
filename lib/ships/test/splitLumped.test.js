import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSplit } from '../splitLumped.js'

// Shaped like the real dev records from the B2 study (2026-10-20); entity ids and claim counts as found there.
const e = (entity, o = {}) => ({ entity: String(entity), claims: 8, docs: [], imos: [], mmsis: [], callsigns: [], names: [], ...o })
const us = (n) => `us_official_number:${n}`

test('SAKANA: two licences on two MMSIs split; the GFW entry carrying both stays with the kept boat', () => {
  const p = planSplit([
    e(4934, { claims: 30, mmsis: ['367708440', '367708450'], callsigns: ['WDI5428', 'WDI5429'] }), // GFW, mixes both
    e(12542, { claims: 7, mmsis: ['367708440'], callsigns: ['WDI5428'] }),
    e(20713, { claims: 7, mmsis: ['367708450'], callsigns: ['WDI5429'] }),
    e(28320, { docs: [us('1226006')], mmsis: ['367708440'], callsigns: ['WDI5428'] }),
    e(28321, { docs: [us('1169232')], mmsis: ['367708450'], callsigns: ['WDI5429'] }),
    e(36590, { claims: 18, docs: [us('1169232')] }), // PSIX: number, no MMSI → joins its number's group
  ])
  assert.equal(p.split, true)
  assert.deepEqual(p.keep.docs, [us('1169232')])
  assert.deepEqual(p.keep.entities.sort(), ['20713', '28321', '36590', '4934'])
  assert.deepEqual(p.moves.map((m) => [m.docs, m.entities.sort(), m.mmsis]), [[[us('1226006')], ['12542', '28320'], ['367708440']]])
  assert.deepEqual(p.mixed, ['4934'])
})

test('KODIAK: three numbers on three MMSIs → the fullest group keeps the id, the other two move', () => {
  const p = planSplit([
    e(4736, { claims: 76, imos: ['8987125'], mmsis: ['367314460', '366994170', '367634660', '367640780'] }),
    e(25012, { claims: 2, imos: ['8987125'] }), // Wikidata, IMO only → mixed, stays
    e(26492, { docs: [us('1119183')], mmsis: ['366994170'] }),
    e(27944, { claims: 10, docs: [us('637055')], mmsis: ['367634660'] }),
    e(27968, { claims: 10, docs: [us('1215169')], mmsis: ['367640780'] }),
  ])
  assert.equal(p.split, true)
  assert.deepEqual(p.keep.docs, [us('637055')]) // 10 claims, older entry than 27968's
  assert.deepEqual(p.moves.map((m) => m.docs[0]), [us('1215169'), us('1119183')])
  assert.deepEqual(p.mixed.sort(), ['25012', '4736'])
})

test('a typo or re-licence on the same MMSI never splits (MOLAMOLA, SOMERLED, WINDSONG)', () => {
  const p = planSplit([
    e(3793, { claims: 15, mmsis: ['366943540'], callsigns: ['WDB7520', 'WDJ6171'] }),
    e(26440, { docs: [us('1061905')], mmsis: ['366943540'], callsigns: ['WDB7520'] }),
    e(28872, { docs: [us('1061904')], mmsis: ['366943540'], callsigns: ['WDJ6171'] }),
  ])
  assert.equal(p.split, false)
  assert.match(p.reason, /same MMSI/)
})

test('a number with no MMSI evidence can not be told apart: no split', () => {
  const p = planSplit([e(1, { docs: [us('1')], mmsis: ['367000001'] }), e(2, { claims: 18, docs: [us('2')] })])
  assert.equal(p.split, false)
  assert.match(p.reason, /only one number has an MMSI/)
})
