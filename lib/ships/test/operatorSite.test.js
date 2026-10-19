import { test } from 'node:test'
import assert from 'node:assert/strict'
import { operatorSourceId, operatorSource, intakeProblems, boatKey, boatClaims, OPERATOR_EVIDENCE } from '../operatorSite.js'

// Shaped like lib/ships/data/intake/islandexpresscharters.json (one boat, shortened text).
const intake = {
  page: { url: 'https://www.example-charters.com/vessels/', title: 'Vessels', retrieved_at: '2026-10-19T15:51:00Z' },
  operator: { name: 'Example Charters', url: 'https://www.example-charters.com/', country: 'US' },
  boats: [{ name: 'Sea Example', facts: { length_ft: 40, builder: 'Munson Boats', build_place: 'western Washington', max_capacity: 33,
    capacity_basis: 'USCG-certified passengers', speed_kn: '18-21' }, description: 'A 40 foot landing craft.',
    photos: [{ url: 'https://www.example-charters.com/a.jpg' }, { url: 'https://www.example-charters.com/b.jpg' }], match: null }],
}

test('source id is per operator host, without www', () => {
  assert.equal(operatorSourceId(intake.page.url), 'operator-site-example-charters.com')
  const src = operatorSource(intake)
  assert.equal(src.attribution_text, 'Example Charters')
  assert.equal(src.attribution_url, intake.page.url)
  assert.equal(src.commercial_use, false)
})

test('review needs no decisions; apply needs one per boat', () => {
  assert.deepEqual(intakeProblems(intake), [])
  assert.match(intakeProblems(intake, { forApply: true })[0], /no match decision/)
  const linked = { ...intake, boats: [{ ...intake.boats[0], match: { vessel_id: '41ed6044-0464-4379-b6dd-fe234a6e8e65' } }] }
  assert.match(intakeProblems(linked, { forApply: true })[0], /basis missing/)
  const none = { ...intake, boats: [{ ...intake.boats[0], match: { none: 'two same-name boats, no tie-breaker' } }] }
  assert.deepEqual(intakeProblems(none, { forApply: true }), [])
})

test('claims are operator-published, dated to the read, units kept as published', () => {
  const c = boatClaims(intake, intake.boats[0])
  assert.ok(c.every((x) => x.evidence_class === OPERATOR_EVIDENCE && x.period_kind === 'observed'))
  assert.ok(c.every((x) => x.period_from === '2026-10-19T15:51:00.000Z' && x.period_to === x.period_from))
  const len = c.find((x) => x.attribute === 'length_m')
  assert.equal(len.value_raw, '40 ft')
  assert.equal(len.value_norm, '12.19')
  assert.equal(c.find((x) => x.attribute === 'builder').value_raw, 'Munson Boats (western Washington)')
  assert.equal(c.find((x) => x.attribute === 'max_capacity').detail.basis, 'USCG-certified passengers')
  const imgs = c.filter((x) => x.attribute === 'image')
  assert.deepEqual(imgs.map((x) => [x.detail.photo_order, x.detail.best, x.detail.credit]), [[0, true, 'Example Charters'], [1, false, 'Example Charters']])
  assert.equal(imgs[0].detail.file_page_url, intake.page.url)
  assert.equal(boatKey(intake, intake.boats[0]), 'https://www.example-charters.com/vessels/#Sea Example')
})

test('facts the page does not state make no claim', () => {
  const c = boatClaims(intake, { name: 'Bare', facts: {}, photos: [] })
  assert.deepEqual(c.map((x) => x.attribute).sort(), ['name', 'operator'])
})

test('type: boat words and the operator\'s business words are separate claims', async () => {
  const { combine, crosswalkClaim, fromOperatorType } = await import('../taxonomy.js')
  const it = { ...intake, operator: { ...intake.operator, service: 'Whale Watching Tours', service_url: 'https://www.example-charters.com/' } }
  const types = boatClaims(it, { name: 'Osprey', facts: { vessel_type: 'landing craft' } }).filter((x) => x.attribute === 'vessel_type')
  assert.deepEqual(types.map((x) => [x.value_raw, x.detail.stated]), [['landing craft', 'boat'], ['Whale Watching Tours', 'operator_business']])
  assert.equal(fromOperatorType('landing craft'), null)
  assert.equal(fromOperatorType('water taxi').class, null)
  // AIS says passenger (no class); the operator fills the class, never the group.
  const src = 'operator-site-example-charters.com'
  const ais = { source_id: 'marinecadastre-ais', evidence_class: 'ais_published', value_norm: 'AIS_60', detail: { code: 60 } }
  const c = combine([crosswalkClaim(ais), ...types.map((x) => crosswalkClaim({ ...x, source_id: src }))])
  assert.deepEqual([c.group, c.class, c.refinedBy], ['passenger', 'whale_watching', [src]])
  const pleasure = { ...ais, value_norm: 'AIS_37', detail: { code: 37 } }
  const d = combine([crosswalkClaim(pleasure), ...types.map((x) => crosswalkClaim({ ...x, source_id: src }))])
  assert.equal(d.group, 'recreational') // the operator never moves the group
})

test('type: a boat the operator calls a water taxi is not re-typed by the business words', async () => {
  const { combine, crosswalkClaim } = await import('../taxonomy.js')
  const it = { ...intake, operator: { ...intake.operator, service: 'Whale Watching Tours' } }
  const types = boatClaims(it, { name: 'Larus', facts: { vessel_type: 'water taxi' } }).filter((x) => x.attribute === 'vessel_type')
  const ais = { source_id: 'marinecadastre-ais', evidence_class: 'ais_published', value_norm: 'AIS_60', detail: { code: 60 } }
  const c = combine([crosswalkClaim(ais), ...types.map((x) => crosswalkClaim({ ...x, source_id: 'operator-site-x' }))])
  assert.deepEqual([c.group, c.class], ['passenger', 'passenger_unspecified'])
})

test('type: whale / orca words → whale watching boat; other tour words stay excursion', async () => {
  const { fromOperatorType, labelOf } = await import('../taxonomy.js')
  assert.equal(fromOperatorType('Whale Watching in San Juan Islands').class, 'whale_watching')
  assert.equal(fromOperatorType('best orca watching from Friday Harbor').class, 'whale_watching')
  assert.equal(fromOperatorType('Adventure Tour vessel').class, 'excursion')
  assert.equal(fromOperatorType('wildlife viewing').class, 'excursion')
  assert.equal(labelOf('whale_watching'), 'Whale watching boat')
})
