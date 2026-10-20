import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgePair, isBlankMmsi } from '../matchRules.js'

// Shaped like real dev pairs from the B study (names normalized as stored).
const rec = (o = {}) => ({ claims: 4, names: [], callsigns: [], imos: [], official: [], lengths: [], mmsi: [], ...o })
const w = (mmsi, f, t) => [{ mmsi, f, t }]

test('blank MMSIs identify nothing', () => {
  for (const m of ['338000000', '366000000', '123456789', '111111111', '012345678', '99999999', '941219165', '970012345', '974123456']) assert.equal(isBlankMmsi(m), true, m)
  // Valid series: ships, a handheld radio, a tender (98), an aid to navigation (99).
  for (const m of ['368616000', '316041627', '538070070', '816012345', '983160052', '993661234']) assert.equal(isBlankMmsi(m), false, m)
})

test('R1: renamed boat tied by its USCG number (SOZO → SWEETER ESCAPE)', () => {
  const a = rec({ claims: 19, names: ['SOZO'], callsigns: ['WDK3881'], official: ['1163542'] })
  const b = rec({ claims: 26, names: ['SWEETERESCAPE'], callsigns: ['WDN2563'], official: ['1163542'], lengths: [17.5] })
  assert.deepEqual([judgePair(a, b, '368049620').verdict, judgePair(a, b, '368049620').keep], ['merge_r1', 'b'])
})

test('R2: exact name, no conflict; a near-miss name never counts', () => {
  const a = rec({ claims: 26, names: ['CASCADIA'], callsigns: ['WDP9793'], lengths: [11.8] })
  assert.equal(judgePair(a, rec({ names: ['CASCADIA'] }), '368402080').verdict, 'merge_r2')
  assert.equal(judgePair(rec({ names: ['SANDEMARINE68'] }), rec({ names: ['SANDEMARINE95'] }), '257000068').verdict, 'open')
  assert.equal(judgePair(rec({ names: ['BLACKFISHII'] }), rec({ names: ['BLACKFISHIII'] }), '367524220').verdict, 'open')
})

test('R3: a nameless entry merges only when its dates lie inside the named record’s', () => {
  const named = rec({ claims: 12, names: ['SHODAN'], callsigns: ['CZ8980'], mmsi: w('316004831', '2013-07-20', '2026-09-22') })
  const inside = rec({ claims: 3, mmsi: w('316004831', '2013-09-26', '2022-07-20') })
  const longer = rec({ claims: 3, mmsi: w('316004831', '2010-01-01', '2022-07-20') })
  const r = judgePair(inside, named, '316004831')
  assert.deepEqual([r.verdict, r.keep, r.merge], ['merge_r3', 'b', 'a'])
  assert.equal(judgePair(longer, named, '316004831').verdict, 'open')
})

test('two ships, blank MMSI and lumped records are never merged', () => {
  assert.equal(judgePair(rec({ names: ['X'], imos: ['9000001'] }), rec({ names: ['X'], imos: ['9000002'] }), '367000001').verdict, 'two_ships')
  assert.equal(judgePair(rec({ names: ['X'], callsigns: ['WAA1'], lengths: [11] }), rec({ names: ['X'], callsigns: ['WBB2'], lengths: [38] }), '367000001').verdict, 'two_ships')
  assert.equal(judgePair(rec({ names: ['X'] }), rec({ names: ['X'] }), '367000001', { same_minute_far: 3 }).verdict, 'two_ships')
  assert.equal(judgePair(rec({ names: ['BLACKFISHIII'] }), rec({ names: ['BLACKFISHIII'] }), '338000000').verdict, 'blank_mmsi')
  assert.equal(judgePair(rec({ names: ['KODIAK'], official: ['1215169', '1119183'] }), rec({ names: ['KODIAK'], official: ['1215169'] }), '367640780').verdict, 'lumped')
})
