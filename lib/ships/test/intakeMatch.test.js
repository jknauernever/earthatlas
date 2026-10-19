import { test } from 'node:test'
import assert from 'node:assert/strict'
import { namesOperator, suggest, midPlace } from '../intakeMatch.js'

test('a licensee names the operator only with all its distinctive words (place words are common)', () => {
  assert.equal(namesOperator('San Juan Safaris LLC', 'San Juan Safaris'), true)
  assert.equal(namesOperator('SAN JUAN CHARTERS', 'San Juan Safaris'), false)
  assert.equal(namesOperator('Fishers Island Ferry District', 'Island Express Charters'), false)
  assert.equal(namesOperator('ISLAND EXPRESS CHARTERS INC', 'Island Express Charters'), true)
  assert.equal(namesOperator('Skyline Charters LLC', 'Island Express Charters'), false)
  assert.equal(namesOperator('Anything', 'Charters LLC'), false) // nothing distinctive to match on
})

test('pre-select only one candidate with a strong tie and no failed check', () => {
  const v = (id, signals) => ({ vessel_id: id, signals })
  const strong = { ok: true, strong: true, text: 'licensee names the operator' }
  assert.equal(suggest([v('a', [strong]), v('b', [{ ok: true, text: 'seen on AIS' }])]).vessel_id, 'a')
  assert.equal(suggest([v('a', [strong]), v('b', [strong])]), null)
  assert.equal(suggest([v('a', [strong, { ok: false, text: 'length differs' }])]), null)
  assert.equal(suggest([]), null)
})

test('MMSI country from its first digits', () => {
  assert.deepEqual(['368162000', '303366000', '316041627', '205435000'].map(midPlace), ['US', 'US (Alaska)', 'Canada', 'MID 205'])
})

test('a smaller same-MMSI record folds under the fuller one and is never pre-selected', async () => {
  const { markFragments } = await import('../intakeMatch.js')
  const strong = { ok: true, strong: true, text: 'same licensee' }
  const full = { vessel_id: 'full', mmsis: ['368616000'], records: 50, built_from: [{}, {}, {}, {}], signals: [strong] }
  const frag = { vessel_id: 'frag', mmsis: ['368616000'], records: 6, built_from: [{}], signals: [strong] }
  const other = { vessel_id: 'other', mmsis: ['367000000'], records: 3, built_from: [{}], signals: [] }
  markFragments([full, frag, other])
  assert.equal(frag.fragment_of, 'full')
  assert.equal(full.fragment_of, undefined)
  assert.equal(other.fragment_of, undefined)
  assert.equal(suggest([full, frag, other]).vessel_id, 'full') // the fragment's strong tie doesn't make it ambiguous
})

test('owners compare without their legal suffix', async () => {
  const { companyKey } = await import('../intakeMatch.js')
  assert.equal(companyKey('Outer Island Expeditions, LLC'), companyKey('Outer Island Expeditions'))
  assert.equal(companyKey('Skyline Charters LLC'), companyKey('SKYLINE CHARTERS'))
  assert.equal(companyKey('ISLAND EXPRESS CHARTERS INC'), companyKey('Island Express Charters'))
  assert.notEqual(companyKey('San Juan Charters'), companyKey('San Juan Safaris LLC'))
})
