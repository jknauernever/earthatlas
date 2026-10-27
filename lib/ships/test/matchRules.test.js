import { test } from 'node:test'
import assert from 'node:assert/strict'
import { judgePair, isBlankMmsi, hullNumbers, numberRelation } from '../matchRules.js'

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
  // Near-miss names never merge (since C they are judged numbered fleets: test below).
  assert.notEqual(judgePair(rec({ names: ['SANDEMARINE68'] }), rec({ names: ['SANDEMARINE95'] }), '257000068').verdict, 'merge_r2')
  assert.notEqual(judgePair(rec({ names: ['BLACKFISHII'] }), rec({ names: ['BLACKFISHIII'] }), '367524220').verdict, 'merge_r2')
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

test('lumped counts only lifelong numbers: a state registration beside a USCG number is not a second boat (B2)', () => {
  // HALCYON (prod): a state number and a PSIX-only state number on one boat → judged like any record, not "lumped".
  const halcyon = rec({ claims: 30, names: ['HALCYON'], callsigns: ['WDI6436'], official: ['WN7248SA', 'AK6255AU'], docs: [] })
  assert.notEqual(judgePair(halcyon, rec({ claims: 3 }), '367492150').verdict, 'lumped')
  const sakana = rec({ names: ['SAKANA'], official: ['1169232', '1226006'], docs: ['us_official_number:1169232', 'us_official_number:1226006'] })
  assert.equal(judgePair(sakana, rec({ claims: 3 }), '367708440').verdict, 'lumped')
})

test('C: numbered fleets are kept apart; Roman numerals and "1" vs "I" read as numbers', () => {
  assert.deepEqual(hullNumbers('SANDEMARINE068'), [{ stem: 'SANDEMARINE', n: 68, digits: '68' }])
  assert.equal(numberRelation(['WHISKERSIII'], ['WHISKERS111']), 'same')
  assert.equal(numberRelation(['YUEJIANGCHENGYU96'], ['YUEJIANGCHENGYU96133']), 'same')
  assert.equal(numberRelation(['MISTYKII'], ['MISTYKIII']), 'fleet')
  assert.equal(numberRelation(['BALLADEER1'], ['BALLADEERI']), 'same')
  assert.equal(numberRelation(['BLACKFISH'], ['BLACKFISHII']), null)
  assert.equal(judgePair(rec({ names: ['SANDEMARINE68'] }), rec({ names: ['SANDEMARINE95'] }), '257000068').verdict, 'numbered_fleet')
  assert.equal(judgePair(rec({ names: ['BLACKFISHII'] }), rec({ names: ['BLACKFISHIII'] }), '367524220').verdict, 'numbered_fleet')
  // Same call sign: not decided by the number alone.
  assert.equal(judgePair(rec({ names: ['ORCAII'], callsigns: ['WDA1'] }), rec({ names: ['ORCAIII'], callsigns: ['WDA1'] }), '367000001').verdict, 'open')
})

test('C: a crowded MMSI says nothing; a stub that fits two named boats is not merged into either', () => {
  assert.equal(judgePair(rec({ names: ['HSDNET'] }), rec({ names: ['ZETA'] }), '233312594', null, { crowd: 26, manyBoats: true }).verdict, 'shared_mmsi')
  assert.equal(judgePair(rec({ names: ['HSDNET'] }), rec({ names: ['ZETA'] }), '233312594', null, { crowd: 5 }).verdict, 'open')
  const named = rec({ claims: 12, names: ['SHODAN'], mmsi: w('316004831', '2013-07-20', '2026-09-22') })
  const stub = rec({ claims: 3, mmsi: w('316004831', '2013-09-26', '2022-07-20') })
  assert.equal(judgePair(stub, named, '316004831', null, { r3Hosts: 1 }).verdict, 'merge_r3')
  assert.equal(judgePair(stub, named, '316004831', null, { r3Hosts: 2, crowd: 3 }).verdict, 'open')
})

test('C: six fragments of one ship are not a "shared MMSI" (USCGC Munro)', async () => {
  const { mmsiContexts } = await import('../matchRules.js')
  const m = '303866000', recs = { a: rec({ names: ['MUNRO'], callsigns: ['NMUN'] }), b: rec({ names: ['USCG755'], callsigns: ['NMUN'] }), c: rec({ names: ['USCOASTGUARDMUNRO'], callsigns: ['NMUN'] }),
    d: rec({ names: ['USCGCMUNRO'] }), e: rec({ names: ['USVSL'] }), f: rec() }
  const pairs = ['b', 'c', 'd', 'e', 'f'].map((x) => ({ a: 'a', b: x, mmsi: m }))
  const ctx = mmsiContexts(pairs, recs)(pairs[3])
  assert.deepEqual([ctx.crowd, ctx.manyBoats], [6, false])
  assert.notEqual(judgePair(recs.a, recs.e, m, null, ctx).verdict, 'shared_mmsi')
  const buoys = Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`b${i}`, rec({ names: [`STJOHNBUOY10${i}`] })]))
  const bp = [2, 3, 4, 5, 6].map((i) => ({ a: 'b1', b: `b${i}`, mmsi: '244010143' }))
  assert.equal(mmsiContexts(bp, buoys)(bp[0]).manyBoats, true)
})

test('fishing gear: a battery level in the name means no ship conclusion, never a merge (prod 2026-10-27)', async () => {
  const { isGearName } = await import('../matchRules.js')
  for (const g of ['HSD-NET-85%', 'ST JOHN BUOY 10-61%', 'SANDEMARINE-91%', 'BM11 12.1V', 'IDA JUNE BUOY-77%']) assert.ok(isGearName(g), g)
  for (const s of ['SEA LEVEL II', 'USS SOMERSET LPD25', 'BLACKFISH III', 'WARSHIP 25']) assert.ok(!isGearName(s), s)
  // Same name (same battery level) on one MMSI: still not merged.
  assert.equal(judgePair(rec({ names: ['HSDNET85'], gear: true }), rec({ names: ['HSDNET85'], gear: true }), '233312594').verdict, 'gear')
  assert.equal(judgePair(rec({ names: ['HSDNET99'], gear: true }), rec({ names: ['HSDNET94'] }), '233312594').verdict, 'gear')
})
