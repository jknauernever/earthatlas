/**
 * GFW ship records (lib/ships/gfwAis.js): pure tests, offline. Vessels: REAL rows (fixtures/gfw4w-vessels-salish-2026-08-01.json).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeMonths, mapVessel, completedMonths, payloadOf } from '../gfwAis.js'
import { fixture } from './scenarios.js'

const { vessels } = fixture('gfw4w-vessels-salish-2026-08-01.json')
const byName = (n) => vessels.find((v) => v.values.some((x) => x.attr === 'name' && x.value === n))

test('mergeMonths: same vessel in two months → one item, earliest first / latest last, counts summed', () => {
  const v = byName('SALISH SEA GLORY')
  const later = { vid: v.vid, values: v.values.map((x) => ({ ...x, first: '2026-09-03T04:00:00Z', last: '2026-09-20T10:00:00Z', n: 2 })) }
  const [m] = mergeMonths([[v], [later]])
  const name = m.values.find((x) => x.attr === 'name')
  assert.equal(name.first, '2026-08-01T00:00:00Z')
  assert.equal(name.last, '2026-09-20T10:00:00Z')
  assert.equal(name.n, v.values.find((x) => x.attr === 'name').n + 2)
})

test('mapVessel: MMSI ais_self_reported; name/call sign/IMO/flag ais_published; GFW type inferred (low rank)', () => {
  const [m] = mergeMonths([[byName('EURODAM')]])
  const a = mapVessel(m)
  const cls = Object.fromEntries(a.map((x) => [x.attribute, x.evidence_class]))
  assert.equal(cls.mmsi, 'ais_self_reported')
  assert.equal(cls.name, 'ais_published')
  assert.equal(cls.imo, 'ais_published')
  assert.equal(cls.flag, 'ais_published')
  assert.equal(cls.vessel_type, 'inferred')
  assert.equal(a.find((x) => x.attribute === 'imo').detail.checksum_ok, true)   // 9378448 is a valid IMO
  for (const x of a) assert.equal(x.period_kind, 'observed')
  assert.ok(a.every((x) => x.period_from <= x.period_to))
})

test('payloadOf ignores position counts (a record version changes only with what was seen)', () => {
  const [m] = mergeMonths([[byName('EURODAM')]])
  const more = { ...m, values: m.values.map((x) => ({ ...x, n: x.n + 100 })) }
  assert.deepEqual(payloadOf(m), payloadOf(more))
})

test('completedMonths: only months entirely older than fetched_through − 5 days, and only with a vessels file', () => {
  const idx = { fetched_through: '2026-09-28', months: {
    '2026-07': { vessels_url: 'u7', vessels: 1, built: 'b' }, '2026-08': { vessels_url: 'u8', vessels: 1, built: 'b' }, '2026-09': { vessels_url: 'u9', vessels: 1, built: 'b' }, '2026-06': { vessels: 3023, built: 'b' } } }
  assert.deepEqual(completedMonths(idx).map((m) => m.month), ['2026-07', '2026-08'])
  assert.deepEqual(completedMonths({ fetched_through: '2026-09-03', months: idx.months }).map((m) => m.month), ['2026-07'])
  assert.deepEqual(completedMonths({ months: idx.months }), [])
})
