import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromAisCode, fromGfwType, fromWikidataClass, combine, crosswalkClaim, CLASSES, GROUPS, WIKIDATA_CLASSES, TAXONOMY, labelOf, aisHazard } from '../taxonomy.js'

test('every class belongs to a defined group', () => {
  for (const [k, [g]] of Object.entries(CLASSES)) assert.ok(GROUPS[g], `${k} → ${g}`)
  for (const [q, m] of Object.entries(WIKIDATA_CLASSES)) if (m) assert.ok(GROUPS[m.group] && (!m.class || CLASSES[m.class]), q)
})

test('AIS codes map to coarse groups; specific only where the code is specific', () => {
  assert.deepEqual(fromAisCode(60), { group: 'passenger', class: null })
  assert.deepEqual(fromAisCode(52), { group: 'tug_tow', class: 'tug' })
  assert.equal(fromAisCode(37).group, 'recreational')
  assert.equal(fromAisCode(0).group, 'unknown')
  assert.equal(fromAisCode(255).group, 'unknown')
  assert.equal(fromAisCode(1019).group, 'recreational')
})

test('GFW "gear" is not a vessel; "carrier" is a reefer', () => {
  assert.equal(fromGfwType('gear').group, 'non_vessel')
  assert.equal(fromGfwType('CARRIER').class, 'reefer')
  assert.equal(fromGfwType('NA').group, 'unknown')
})

test('Wikidata: "ship" is known but says nothing; unmapped classes are undefined', () => {
  assert.equal(fromWikidataClass('Q11446'), null)
  assert.equal(fromWikidataClass('Q39804').class, 'cruise_ship')
  assert.equal(fromWikidataClass('Q999999999'), undefined)
})

const claim = (source_id, evidence_class, value_norm, detail) => crosswalkClaim({ source_id, evidence_class, value_norm, detail })

test('EURODAM: AIS 60 + GFW PASSENGER + Wikidata cruise ship → passenger / cruise ship', () => {
  const c = combine([
    claim('marinecadastre-ais', 'ais_published', 'AIS_60', { code: 60 }),
    claim('gfw-vessel-identity', 'inferred', 'PASSENGER'),
    claim('gfw-vessel-identity', 'inferred', 'NA'),
    claim('wikidata', 'community_curated', 'WD_Q39804'),
  ])
  assert.deepEqual(c, { group: 'passenger', class: 'cruise_ship', conflict: false, groups: ['passenger'], classes: ['cruise_ship'],
    basis: 'ranked', dissent: [], hazardous_cargo: [] })
})

test('decision 2026-09-25: GFW model type ranks below AIS; its disagreement is a dissent, not a conflict (LINNEA ROSE)', () => {
  const c = combine([claim('marinecadastre-ais', 'ais_published', 'AIS_37', { code: 37 }), claim('gfw-vessel-identity', 'inferred', 'PASSENGER')])
  assert.deepEqual([c.group, c.class, c.conflict, c.basis], ['recreational', 'recreational_unspecified', false, 'ranked'])
  assert.deepEqual(c.dissent, [{ group: 'passenger', class: null, source: 'gfw-vessel-identity' }])
})

test('the GFW model decides only when no ranked source votes', () => {
  const c = combine([claim('gfw-vessel-identity', 'inferred', 'FISHING'), claim('marinecadastre-ais', 'ais_published', 'AIS_0', { code: 0 })])
  assert.deepEqual([c.group, c.basis], ['fishing', 'model_only'])
})

test('disagreement among ranked sources stays a conflict', () => {
  const c = combine([fromAisCode(70), fromWikidataClass('Q39804')])
  assert.deepEqual([c.group, c.conflict], [null, true])
  const d = combine([claim('marinecadastre-ais', 'ais_published', 'AIS_70', { code: 70 }), claim('wikidata', 'community_curated', 'WD_Q39804'),
    claim('gfw-vessel-identity', 'inferred', 'CARGO')])
  assert.equal(d.conflict, true) // the model can't break a tie between ranked sources
  assert.equal(combine([fromAisCode(90), fromAisCode(60)]).group, 'passenger') // bare "other" abstains
})

test('GFW self-reported AIS type (not the model) is ranked', () => {
  const c = combine([claim('gfw-vessel-identity', 'ais_self_reported', 'CARGO'), claim('gfw-vessel-identity', 'inferred', 'PASSENGER')])
  assert.deepEqual([c.group, c.basis, c.dissent.length], ['cargo', 'ranked', 1])
})

test('decision 2026-09-25: service split into government and port_service; ferries stay a passenger class', () => {
  assert.equal(GROUPS.service, undefined)
  assert.deepEqual([fromAisCode(55).group, fromAisCode(51).group, fromAisCode(50).group, fromAisCode(33).group],
    ['government', 'government', 'port_service', 'port_service'])
  assert.equal(CLASSES.ferry[0], 'passenger')
})

test('decision 2026-09-25: group-only sources give <group>_unspecified, never a guessed class', () => {
  assert.deepEqual([combine([fromAisCode(70)]).group, combine([fromAisCode(70)]).class], ['cargo', 'cargo_unspecified'])
  const two = combine([fromWikidataClass('Q17210'), fromWikidataClass('Q15276')]) // container ship vs bulk carrier
  assert.deepEqual([two.group, two.class, two.conflict], ['cargo', 'cargo_unspecified', true])
  assert.deepEqual([combine([]).group, combine([]).class], ['unknown', 'unknown_unspecified'])
  assert.deepEqual([combine([fromAisCode(90)]).group, combine([fromAisCode(90)]).class], ['other', 'other_unspecified'])
})

test('TAXONOMY: one exported list, unique stable ids, every group has an unspecified bucket, every id has a label', () => {
  const ids = TAXONOMY.flatMap((g) => [g.id, ...g.classes.map((c) => c.id)])
  assert.equal(new Set(ids).size, ids.length)
  for (const g of TAXONOMY) assert.equal(g.classes.at(-1).id, `${g.id}_unspecified`)
  for (const id of ids) assert.ok(labelOf(id), id)
  assert.equal(labelOf('passenger_unspecified'), 'Passenger, type not known')
})

test('decision 2026-09-25: AIS hazardous-cargo categories A–D are a separate self-declared flag', () => {
  assert.deepEqual([aisHazard(71)?.category, aisHazard(84)?.category, aisHazard(62)?.category, aisHazard(43)?.category], ['A', 'D', 'B', 'C'])
  assert.equal(aisHazard(70), null); assert.equal(aisHazard(75), null); assert.equal(aisHazard(31), null); assert.equal(aisHazard(52), null)
  const c = combine([crosswalkClaim({ source_id: 'marinecadastre-ais', evidence_class: 'ais_published', value_norm: 'AIS_73', detail: { code: 73 } })])
  assert.deepEqual([c.group, c.class, c.hazardous_cargo], ['cargo', 'cargo_unspecified', ['C']])
})
