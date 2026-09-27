/**
 * Kind-of-ship search: reading a query against the taxonomy (pure; offline). Josh, 2026-09-27:
 * "type: oil tanker and find all of the oil tankers, or 'ferry' and find all the ferries".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseTypeQuery, singular } from '../typeSearch.js'

test('singular: plurals people type', () => {
  assert.deepEqual(['ferries', 'tankers', 'tugs', 'yachts', 'glass', 'bus'].map(singular), ['ferry', 'tanker', 'tug', 'yacht', 'glass', 'bus'])
})

test('parseTypeQuery: class, group, longest phrase first, and the leftover words', () => {
  const p = (s) => { const r = parseTypeQuery(s); return r && [r.group, r.class, r.rest] }
  assert.deepEqual(p('oil tanker'), ['tanker', 'oil_tanker', ''])
  assert.deepEqual(p('Oil Tankers'), ['tanker', 'oil_tanker', ''])
  assert.deepEqual(p('tanker'), ['tanker', null, ''])
  assert.deepEqual(p('ferry'), ['passenger', 'ferry', ''])
  assert.deepEqual(p('washington ferries'), ['passenger', 'ferry', 'washington'])
  assert.deepEqual(p('tugs'), ['tug_tow', 'tug', ''])
  assert.deepEqual(p('container ship'), ['cargo', 'container_ship', ''])
  assert.deepEqual(p('cruise ships'), ['passenger', 'cruise_ship', ''])
  assert.deepEqual(p('LNG carrier'), ['tanker', 'lng_carrier', ''])
  assert.deepEqual(p('fishing'), ['fishing', null, ''])
  // Ship names that aren't kinds say nothing.
  assert.equal(parseTypeQuery('Cathlamet'), null)
  assert.equal(parseTypeQuery('Linnea Rose'), null)
})

test('PSIX sub-types name the kind inside the service (REAL stored values, HIGH LEADER 2026-09-27)', async () => {
  const { crosswalkClaim, combine } = await import('../taxonomy.js')
  const psix = (svc, sub) => crosswalkClaim({ source_id: 'uscg-psix', value_norm: `PSIX_${svc}`, evidence_class: 'registry', detail: { service_subtype: sub } })
  assert.equal(psix('TANKSHIP', 'Oil & Chemical Tank Ship').class, 'oil_chemical_tanker')
  assert.equal(psix('TANKSHIP', 'Crude Oil Tank Ship').class, 'oil_tanker')
  assert.equal(psix('TANKSHIP', 'General').class, null, 'an unhelpful sub-type falls back to the service')
  assert.equal(psix('PASSENGERINSPECTED', 'Ro-Ro Ferry (More Than 6, Gross Tonnage < 100)').class, 'ferry')
  assert.equal(psix('PASSENGERINSPECTED', 'Ro-Ro (More Than 12, Gross Tonnage >= 100)').class, null, 'not literally a ferry: group only')
  // HIGH LEADER: AIS 80 (tanker) + PSIX oil & chemical tank ship + Wikidata "ship" → Oil / chemical tanker.
  const ais = crosswalkClaim({ source_id: 'marinecadastre-ais', value_norm: 'AIS_80', evidence_class: 'ais_published', detail: { code: 80 } })
  const c = combine([ais, psix('TANKSHIP', 'Oil & Chemical Tank Ship')])
  assert.deepEqual([c.group, c.class, c.conflict], ['tanker', 'oil_chemical_tanker', false])
  assert.deepEqual([parseTypeQuery('oil/chemical tankers').class, parseTypeQuery('oil tanker').class], ['oil_chemical_tanker', 'oil_tanker'])
})
