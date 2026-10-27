import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickDisplayName, isGenericName, cleanName } from '../displayName.js'

const n = (value_raw, to, o = {}) => ({ value_raw, to, evidence_class: 'ais_self_reported', source_id: 'gfw-vessel-identity', ...o })

test('AIS padding is not part of a name', () => {
  assert.equal(cleanName('US GOV VESSEL-------'), 'US GOV VESSEL')
  assert.equal(cleanName('@@SEA LEVEL II@@@'), 'SEA LEVEL II')
})

test('generic labels lose to a specific name (USS Somerset, dev 710998c3)', () => {
  for (const g of ['US GOV VESSEL-------', 'US WARSHIP 25', 'WAPSHIP 25', 'NAVYUNIT34', 'USS WARSHIP 25', 'US-WARSHIP----------', 'USGOVTVSL']) assert.ok(isGenericName(g), g)
  for (const s of ['USS SOMERSET LPD25', 'HOLDFAST', 'SIR WILFRED GRENFELL']) assert.ok(!isGenericName(s), s)
  const rows = [n('US GOV VESSEL-------', '2020-07-28'), n('US WARSHIP 25', '2020-04-30'), n('WAPSHIP 25', '2019-03-12'), n('USS SOMERSET LPD25', '2018-12-02'), n('NAVYUNIT34', '2016-08-09')]
  assert.equal(pickDisplayName(rows).value_raw, 'USS SOMERSET LPD25')
  // Only generic names: the latest one, cleaned.
  assert.equal(pickDisplayName([n('US GOV VESSEL-------', '2020-07-28'), n('NAVYUNIT34', '2016-08-09')]).value_raw, 'US GOV VESSEL')
})

test('one-letter variants: a stray end letter loses, a cut-off name does not (HARMATTAN, dev 0e6cfebb)', () => {
  assert.equal(pickDisplayName([n('HARMATTANA', '2026-09-06'), n('HARMATTAN', '2026-06-27', { source_id: 'marinecadastre-ais', evidence_class: 'ais_published' })]).value_raw, 'HARMATTAN')
  assert.equal(pickDisplayName([n('SOUTHPAWX', '2026-09-01'), n('SOUTHPAW', '2025-01-01', { source_id: 'marinecadastre-ais' })]).value_raw, 'SOUTHPAW')
  assert.equal(pickDisplayName([n('SWIFT OF SOUTHAMPTO', '2026-09-01'), n('SWIFT OF SOUTHAMPTON', '2025-01-01', { source_id: 'marinecadastre-ais' })]).value_raw, 'SWIFT OF SOUTHAMPTON')
  // A registry spelling always wins; a real rename (not one letter) keeps the latest name.
  assert.equal(pickDisplayName([n('AMPRO', '2026-05-27'), n('AMPARO', '2025-01-01', { evidence_class: 'registry', source_id: 'fcc-uls-ship' })]).value_raw, 'AMPARO')
  assert.equal(pickDisplayName([n('MORE COWBELL', '2026-01-01'), n('ADAGIO', '2024-01-01')]).value_raw, 'MORE COWBELL')
})
