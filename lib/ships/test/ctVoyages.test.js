/**
 * Climate TRACE voyages (pure; offline): who tracked a ship (asset_identifier prefix), the per-ship other11 / other12 facts
 * and their units, Climate TRACE's ship types → our taxonomy, and the port-stay → terminal matcher. Fixture: REAL rows
 * (fixtures/ct-voyages-salish-v5_11_0.json: Climate TRACE shipping_voyages rows from the 2026-09-29 Salish Sea pull, and the
 * dev database's real terminal berths that day). Values built by hand are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trackerOf, shipFacts, oneValuePerShip, CT_SHIP_FIELDS } from '../ctVoyages.js'
import { matchCtStay, planCtStays, dedupeCtStays, fromCtType, ctTime, notCoveredTerminals, CT_STAY_MATCH_KM } from '../ctStays.js'
import { fitRule, shipFit } from '../terminalCard.js'
import { fixture } from './scenarios.js'

const fx = fixture('ct-voyages-salish-v5_11_0.json')
const stay = (id, start) => fx.stays.find((s) => s.id === id && (!start || s.start === start))

test('tracker from the asset_identifier prefix (Climate TRACE, 2026-09-29): om- = OceanMind, gfw- = Global Fishing Watch', () => {
  assert.deepEqual(trackerOf('om-imo-9332755'), { prefix: 'om-imo', number: '9332755', id: 'oceanmind', name: 'OceanMind', url: 'https://www.oceanmind.global', idKind: 'imo' })
  assert.equal(trackerOf('gfw-imo-9378448').id, 'gfw')
  assert.equal(trackerOf('gfw-mmsi-316038244').idKind, 'mmsi')
  assert.equal(trackerOf('gfw-mmsi-316038244').url, 'https://globalfishingwatch.org')
  for (const bad of ['', null, 'imo-9332755', 'om-mmsi-1', 'om-imo-', 'om-imo-12a']) assert.equal(trackerOf(bad), null, String(bad))
  // every REAL asset id in the fixture resolves
  for (const r of fx.voyage_rows) assert.ok(trackerOf(r.asset_identifier), r.asset_identifier)
})

test('other11 / other12 on REAL rows: one value per ship, deadweight in tonnes and CO₂ kg per nautical mile (mapping follows the values)', () => {
  const coastal = fx.voyage_rows.filter((r) => r.asset_identifier === 'om-imo-9332755')
  assert.equal(coastal.length, 2)
  const one = oneValuePerShip(coastal.map((r) => [r.other11, r.other12]))
  assert.deepEqual(one.conflicts, [])
  assert.equal(one.o11, 2366)
  assert.ok(Math.abs(one.o12 - 496.2472229003906) < 1e-9)
  const f = shipFacts(one)
  assert.equal(f.deadweight_t, 2366, 'COASTAL RENAISSANCE deadweight, tonnes')
  assert.ok(Math.abs(f.co2_kg_per_nm - 496.247) < 0.001)
  // The ship's own trips agree with other12 being kg CO₂ per NM: CO2_emissions (t) × 1000 / activity (NM).
  for (const r of coastal) {
    const kgPerNm = (Number(r.CO2_emissions) * 1000) / Number(r.activity)
    assert.ok(kgPerNm > 0.8 * f.co2_kg_per_nm && kgPerNm < 1.4 * f.co2_kg_per_nm, `${kgPerNm} kg/NM vs other12 ${f.co2_kg_per_nm}`)
  }
  // A VLCC (REAL om-imo-9789283): other11 = 300,927 reads as deadweight (tonnes), far outside any per-NM factor.
  const vlcc = fx.voyage_rows.find((r) => r.asset_identifier === 'om-imo-9789283')
  assert.equal(shipFacts({ o11: vlcc.other11, o12: vlcc.other12 }).deadweight_t, 300927)
  assert.deepEqual(CT_SHIP_FIELDS, { deadweight_t: 'o11', co2_kg_per_nm: 'o12' })
  // GFW-tracked ships carry neither (REAL gfw-mmsi row: both empty).
  const g = fx.voyage_rows.find((r) => r.asset_identifier.startsWith('gfw-'))
  assert.equal(g.other11, ''); assert.equal(g.other12, '')
  assert.deepEqual(shipFacts(oneValuePerShip([[g.other11, g.other12]])), { deadweight_t: null, co2_kg_per_nm: null })
})

test('other11 / other12 SYNTHETIC edge cases: disagreeing rows are a conflict (kept null), implausible values are not shown', () => {
  assert.deepEqual(oneValuePerShip([['100', '5'], ['200', '5']]), { o11: null, o12: 5, conflicts: ['o11'] })
  assert.deepEqual(shipFacts({ o11: 0, o12: 5 }), { deadweight_t: null, co2_kg_per_nm: 5 })
  assert.deepEqual(shipFacts({ o11: 700000, o12: 25000 }), { deadweight_t: null, co2_kg_per_nm: null })
  assert.deepEqual(shipFacts({ o11: 'abc', o12: null }), { deadweight_t: null, co2_kg_per_nm: null })
})

test('Climate TRACE ship types → taxonomy; a GFW "passenger" is not a stated kind (Climate TRACE: it covers small craft)', () => {
  assert.deepEqual(fromCtType('oil_tanker', 'om-imo-1'), { group: 'tanker', class: 'oil_tanker' })
  assert.deepEqual(fromCtType('tanker.oil', 'gfw-mmsi-1'), { group: 'tanker', class: 'oil_tanker' })
  assert.deepEqual(fromCtType('passenger', 'gfw-mmsi-368154730'), { group: 'unknown', class: null })
  assert.deepEqual(fromCtType('passenger', 'om-imo-1'), { group: 'passenger', class: 'passenger_unspecified' })
  assert.deepEqual(fromCtType('something_new', 'om-imo-1'), { group: 'unknown', class: null })
  const refinery = fitRule('refinery_dock')
  assert.equal(shipFit(refinery, fromCtType('oil_tanker', 'om-imo-9642083')), 'fits')
  assert.equal(shipFit(refinery, fromCtType('tug', 'gfw-mmsi-1')), 'fits', 'tugs count at oil docks (decision of 2026-09-28)')
  // Josh 2026-09-29 (B3): was 'other' ("the AIS visit rule is unchanged") while chemical tankers counted for Climate TRACE stays
  // only; the AIS visits now use the same rule, so a chemical tanker fits a refinery dock on both paths.
  assert.equal(shipFit(refinery, fromCtType('chemical_tanker', 'om-imo-9607174')), 'fits', 'one rule for AIS visits and Climate TRACE stays')
  assert.equal(shipFit(fitRule('coal_terminal'), fromCtType('container', 'om-imo-9085522')), 'other')
})

test('one fit rule (Josh 2026-09-29, B3): a chemical tanker counts at refinery docks and crude / fuel-product terminals only', () => {
  const chem = fromCtType('chemical_tanker', 'om-imo-9607174') // REAL: HAFNIA EGRET, filed by Climate TRACE as chemical_tanker
  for (const k of ['refinery_dock', 'crude_terminal', 'product_terminal']) assert.equal(shipFit(fitRule(k), chem), 'fits', k)
  for (const k of ['coal_terminal', 'grain_terminal', 'lng_terminal']) assert.equal(shipFit(fitRule(k), chem), 'other', k)
  for (const k of ['bunkering_terminal', 'fuel_dock', 'military_fuel_pier']) assert.equal(shipFit(fitRule(k), chem), 'other', `${k}: not widened`)
  assert.equal(shipFit(fitRule('chemical_terminal'), chem), 'fits', 'already fitted at chemical terminals')
  // everything counted before still counts, and nothing else is widened
  assert.equal(shipFit(fitRule('refinery_dock'), fromCtType('oil_tanker', 'om-imo-9642083')), 'fits')
  assert.equal(shipFit(fitRule('refinery_dock'), fromCtType('container', 'om-imo-9085522')), 'other')
  // Was ['oil_tanker', 'oil_chemical_tanker', 'bunker_tanker', 'other_tanker'] (the AIS-only rule); chemical_tanker is the one addition.
  assert.deepEqual(fitRule('refinery_dock').classes, ['oil_tanker', 'oil_chemical_tanker', 'bunker_tanker', 'other_tanker', 'chemical_tanker'])
})

test('stay → terminal on REAL stays and berths: a tanker at Cherry Point matches; its berth and distance are kept', () => {
  const m = matchCtStay(stay('om-imo-9642083'), fx.berths)
  assert.equal(m.status, 'match')
  assert.equal(m.terminal, 'wa-bp-cherry-point')
  assert.ok(m.km < 0.1, `${m.km} km`)
  const two = matchCtStay(stay('om-imo-9607174'), fx.berths)
  assert.equal(two.status, 'match', 'both ends of a short LINESTRING stay at the same terminal')
  assert.equal(two.terminal, 'wa-bp-cherry-point')
})

test('stay → terminal on REAL rows: two terminals about as near → ambiguous; ends at different terminals → disagree; far → none', () => {
  const tac = matchCtStay(stay('om-imo-9232278'), fx.berths)
  assert.equal(tac.status, 'ambiguous')
  assert.deepEqual(tac.oneOf.map((o) => o.terminal), ['wa-puget-lng-tacoma', 'wa-us-oil-tacoma'])
  const ana = matchCtStay(stay('om-imo-9271432'), fx.berths)
  assert.equal(ana.status, 'disagree')
  assert.deepEqual(ana.terminals.sort(), ['wa-hfs-puget-sound', 'wa-marathon-anacortes'])
  const oly = matchCtStay(stay('gfw-mmsi-368154730'), fx.berths)
  assert.equal(oly.status, 'none')
  assert.ok(oly.nearest.km > CT_STAY_MATCH_KM)
  // Roberts Bank: one end by Westshore, the other ~1.9 km away at the neighbouring container terminal → not placed.
  assert.equal(matchCtStay(stay('om-imo-9085522'), fx.berths).status, 'none')
})

test('overlapping REAL duplicates (same ship, same start, different end) keep the longer one; the plan counts every outcome', () => {
  const pair = fx.stays.filter((s) => s.id === 'om-imo-9704805')
  assert.equal(pair.length, 2)
  const { kept, dropped } = dedupeCtStays(pair)
  assert.equal(kept.length, 1); assert.equal(dropped.length, 1)
  assert.equal(kept[0].end, '2024-01-08 11:19:45')
  const { matched, summary } = planCtStays(fx.stays, fx.berths)
  assert.equal(summary.rows, fx.stays.length)
  assert.equal(summary.overlapping, 1)
  assert.equal(summary.stays, fx.stays.length - 1)
  assert.equal(summary.matched + summary.ambiguous + summary.disagree + summary.none, summary.stays)
  assert.deepEqual([...new Set(matched.map((m) => m.terminal))].sort(), ['wa-bp-cherry-point', 'wa-marathon-anacortes'])
  assert.ok(summary.review.some((r) => r.status === 'ambiguous') && summary.review.some((r) => r.status === 'disagree'))
})

test('coverage: terminals with no berth inside the pull box are "not covered", never 0 (REAL berths)', () => {
  // The v1/v2 pulls stopped at 49.0° N: Roberts Bank and Burrard Inlet were outside.
  const old = notCoveredTerminals(fx.berths, [-124.85, 47.0, -122.05, 49.0])
  assert.ok(old.includes('bc-westshore') && old.includes('bc-westridge'))
  assert.ok(!old.includes('wa-bp-cherry-point') && !old.includes('bc-crofton'))
  // The v3 pull reaches 49.75° N: every listed terminal's berths are inside it.
  assert.deepEqual(notCoveredTerminals(fx.berths), [])
})

test('Climate TRACE timestamps: BigQuery TIMESTAMP text is UTC; anything else is rejected, never guessed', () => {
  assert.equal(ctTime('2024-01-05 03:41:06'), '2024-01-05T03:41:06Z')
  assert.equal(ctTime('2024-01-05 03:41:06 UTC'), '2024-01-05T03:41:06Z')
  assert.throws(() => ctTime('05/01/2024'))
  assert.throws(() => ctTime('2024-01-05 03:41:06+02:00'))
})
