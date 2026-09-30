/**
 * EU MRV (lib/ships/euMrv.js, resolver v1.8 decideMrvImo), pure logic, offline. The rows are REAL, copied verbatim from the EMSA
 * THETIS-MRV publication files 2021 v219 and 2024 v245 downloaded 2026-09-29, plus the portal's own details response for EURODAM
 * 2024 recorded the same day (fixtures/eu-mrv-live-2026-09-29.json; fixtures/README.md "EU MRV"). Cases built here are marked
 * SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  colLetter, headerColumns, mrvLayout, mrvNumber, mrvDate, mrvPeriod, technicalEfficiency, mapMrvRow, groupWorkbook, mrvAssertions,
  tonnesText, smallEuShare, smallShareYears, SMALL_EU_SHARE, shipYearUrl, MRV_SOURCE, LICENSE_QUOTE, EVIDENCE_CLASS, ATTRIBUTE, KIND,
} from '../euMrv.js'
import { decideMrvImo } from '../resolve.js'
import { fixture } from './scenarios.js'

const fx = fixture('eu-mrv-live-2026-09-29.json')
const sheetsOf = (k) => fx.files[k].sheets.map((s) => ({ name: s.name, rows: [...s.header_rows, ...s.rows.map((r) => r.cells)] }))
const fileOf = (k) => ({ name: fx.files[k].fileName, year: fx.files[k].year, version: fx.files[k].version, generated: fx.files[k].generated })
const wb24 = groupWorkbook(sheetsOf('2024-v245'), { year: 2024 })
const wb21 = groupWorkbook(sheetsOf('2021-v219'), { year: 2021 })
const g = (wb, imo) => wb.groups.find((x) => x.imo === imo)
const full = (wb, imo) => mapMrvRow(g(wb, imo).rows.find((r) => r.kind === 'full').cells, wb.layout)

test('column letters and merged header groups', () => {
  assert.deepEqual([0, 25, 26, 27, 112].map(colLetter), ['A', 'Z', 'AA', 'AB', 'DI'])
  const cols = headerColumns(fx.files['2024-v245'].sheets[0].header_rows[0], fx.files['2024-v245'].sheets[0].header_rows[1], fx.files['2024-v245'].sheets[0].header_rows[2])
  assert.equal(cols.length, 113)
  assert.deepEqual(cols[28], { col: 'AC', i: 28, group: 'Annual monitoring results', sub: 'CO₂ Emissions', leaf: 'Total CO₂ emissions [m tonnes]' })
  assert.equal(cols[8].group, 'Company') // the company's "IMO Number" is not the ship's
})

test('REAL layouts: both published layouts (62 columns 2018–2023, 113 from 2024) map by header text', () => {
  assert.equal(wb21.layout.columns, 62)
  assert.equal(wb24.layout.columns, 113)
  assert.equal(wb24.layout.fields.imo, 'A')
  assert.equal(wb24.layout.fields.company_imo, 'I')
  assert.equal(wb24.layout.fields.co2_t, 'AC')
  assert.equal(wb21.layout.fields.co2_t, 'Y')
  assert.equal(wb21.layout.fields.company_name, undefined) // no company columns before 2024
  assert.equal(wb24.layout.fields.time_at_sea_h, 'BS')     // "Time spent at sea [hours]" (Annual group), not the voluntary one
  assert.equal(wb21.layout.fields.time_at_sea_h, 'AG')     // "Annual Time spent at sea [hours]"
  assert.equal(wb24.layout.methods.length, 5)              // A, B, C, D, D as published
})

test('a file without a required column is refused (SYNTHETIC header)', () => {
  const [r1, r2, r3] = fx.files['2024-v245'].sheets[0].header_rows
  const broken = r3.map((h) => (h === 'Total CO₂ emissions [m tonnes]' ? 'Total CO2 [kt]' : h))
  assert.throws(() => mrvLayout(headerColumns(r1, r2, broken)), /layout changed: no column for co2_t/)
})

test('values: N/A and blank are null, never zero; dates and periods as written', () => {
  assert.equal(mrvNumber('298.0592'), 298.0592)
  assert.equal(mrvNumber('0.0'), 0)
  assert.equal(mrvNumber('N/A'), null)
  assert.equal(mrvNumber(''), null)
  assert.equal(mrvDate('20/03/2025'), '2025-03-20')
  assert.equal(mrvDate('2025-03-20'), null)
  assert.deepEqual(mrvPeriod('2024.0'), { year: 2024, partial: false, from: '2024-01-01', to: '2024-12-31', raw: '2024.0' })
  assert.deepEqual(mrvPeriod('2024 (1/1 - 24/10)'), { year: 2024, partial: true, from: '2024-01-01', to: '2024-10-24', raw: '2024 (1/1 - 24/10)' })
  assert.equal(mrvPeriod('FY2024'), null)
})

test('technical efficiency: every published form (forms as in the 2018–2025 files; SYNTHETIC numbers where noted)', () => {
  assert.deepEqual(technicalEfficiency('EEXI (10.5 gCO₂/t·nm)'), { kind: 'EEXI', value: 10.5, not_applicable: false, raw: 'EEXI (10.5 gCO₂/t·nm)' })
  assert.equal(technicalEfficiency('EIV (40.85 gCO₂/t·nm)').kind, 'EIV')
  assert.deepEqual(technicalEfficiency('Not Applicable'), { kind: null, value: null, not_applicable: true, raw: 'Not Applicable' })
  assert.deepEqual(technicalEfficiency('Not Applicable (5.2 gCO₂/t·nm)'), { kind: null, value: 5.2, not_applicable: true, raw: 'Not Applicable (5.2 gCO₂/t·nm)' })
  assert.deepEqual(technicalEfficiency('12.3 gCO₂/t·nm'), { kind: null, value: 12.3, not_applicable: false, raw: '12.3 gCO₂/t·nm' })
  assert.equal(technicalEfficiency('EEDI').kind, 'EEDI')
  assert.equal(technicalEfficiency(''), null)
})

test('REAL EURODAM 2024 (113-column layout): every figure and unit as published, and equal to the portal\'s own details API', () => {
  const m = full(wb24, '9378448')
  assert.equal(m.name, 'EURODAM')
  assert.deepEqual(m.period, { year: 2024, partial: false, from: '2024-01-01', to: '2024-12-31', raw: '2024.0' })
  assert.equal(m.fuel_t, 94.8)
  assert.equal(m.co2_t, 298.0592)
  assert.equal(m.ch4_t, 0.00474)
  assert.equal(m.n2o_t, 0.01706)
  assert.equal(m.co2eq_t, 302.71282)
  assert.equal(m.co2_between_ms_t, 0)
  assert.equal(m.co2_departed_ms_t, 166.21)
  assert.equal(m.co2_to_ms_t, 123.51)
  assert.equal(m.co2_at_berth_ms_t, 8.34)
  assert.equal(m.co2_ets_t, 153.2)
  assert.equal(m.co2eq_ets_t, 155.85)
  assert.equal(m.time_at_sea_h, 27.03)
  assert.equal(m.distance_through_ice_nm, null) // published "N/A"
  assert.equal(m.fuel_per_nm_kg, 334.75)
  assert.equal(m.co2_per_nm_kg, 1052.47)
  assert.equal(m.co2eq_per_nm_kg, 1068.9)
  assert.deepEqual(m.technical_efficiency, { kind: 'EEXI', value: 10.5, not_applicable: false, raw: 'EEXI (10.5 gCO₂/t·nm)' })
  assert.deepEqual(m.company, { name: 'Holland America Line N.V.', imo: '5375992' })
  assert.equal(m.verifier.name, 'DNV')
  assert.equal(m.verifier.country, 'Germany')
  assert.deepEqual(m.monitoring_methods, ['A'])
  assert.deepEqual(m.doc, { issue: '2025-03-20', expiry: '2026-06-30' })
  assert.deepEqual(m.transport_work.find((t) => t.what === 'co2' && t.basis === 'pax'), { what: 'co2', basis: 'pax', unit: 'g CO₂ / pax · n miles', value: 515.4 })
  // Same numbers as the portal's details endpoint for this report (erId 267085).
  const api = fx.api_details.response
  const tot = api.emissionsPostEts.find((e) => e.label === 'Total')
  assert.equal(tot.valuePerCode.CO2, m.co2_t)
  assert.equal(tot.valuePerCode.CH4, m.ch4_t)
  assert.equal(tot.valuePerCode.N2O, m.n2o_t)
  assert.equal(tot.totalValue, m.co2eq_t)
  assert.equal(Number(api.fuelConsumptionPostEts[0].value), m.fuel_t)
  assert.equal(Number(api.distanceAndTimePostEts[0].value), m.time_at_sea_h)
  assert.equal(api.distanceAndTimePostEts[0].metricUnit, 'hours')
  assert.equal(Number(api.energyEfficienciesEmissionsPostEts[0].co2Value), m.co2_per_nm_kg)
  assert.equal(api.verifierDetails.name, m.verifier.name)
})

test('REAL EURODAM 2021 (62-column layout): no CH₄/N₂O/CO₂eq or company columns yet; EIV', () => {
  const m = full(wb21, '9378448')
  assert.equal(m.co2_t, 19476.9)
  assert.equal(m.fuel_t, 6211)
  assert.equal(m.time_at_sea_h, 1297.9)
  assert.equal(m.co2_per_nm_kg, 1108.15)
  assert.equal(m.co2eq_t, undefined)
  assert.equal(m.ch4_t, undefined)
  assert.equal(m.company, null)
  assert.equal(m.technical_efficiency.kind, 'EIV')
  assert.equal(m.technical_efficiency.value, 40.85)
})

test('REAL MORNING CALM 2024: one ship-year, a Full row and a Partial row, kept as two claims (never added together)', () => {
  const grp = g(wb24, '9285615')
  assert.equal(grp.key, 'IMO 9285615 · 2024')
  assert.deepEqual(grp.rows.map((r) => r.kind).sort(), ['full', 'partial'])
  const cl = mrvAssertions(grp, wb24.layout, fileOf('2024-v245'))
  assert.equal(cl.length, 2)
  const f = cl.find((c) => c.sub_record_ref === 'full'), p = cl.find((c) => c.sub_record_ref !== 'full')
  assert.equal(f.value_raw, '7553.79568')
  assert.equal(p.value_raw, '6761.14424')
  assert.equal(p.sub_record_ref, 'partial 2024 (1/1 - 24/10)')
  assert.equal(p.period_from, '2024-01-01T00:00:00Z')
  assert.equal(p.period_to, '2024-10-25T00:00:00.000Z') // the day after the last day covered: [ )
  assert.equal(f.period_to, '2025-01-01T00:00:00.000Z')
  assert.ok(f.detail.co2_t >= p.detail.co2_t) // a Full row covers the whole year
  for (const c of cl) {
    assert.equal(c.attribute, ATTRIBUTE)
    assert.equal(c.evidence_class, EVIDENCE_CLASS)
    assert.equal(c.period_kind, 'validity')
    assert.equal(c.detail.page_url, 'https://mrv.emsa.europa.eu/#public/emission-report/ship/9285615/rp/2024')
    assert.equal(c.detail.file.version, 245)
    assert.match(c.detail.scope, /EU\/EEA/)
  }
})

test('evidence is kept as published: cells by column letter, empty cells absent, values untouched', () => {
  const r = g(wb24, '9378448').rows.find((x) => x.kind === 'full')
  assert.equal(r.cells.A, '9378448')
  assert.equal(r.cells.AC, '298.0592')
  assert.equal(r.cells.D, '2024.0')
  assert.equal('H' in r.cells, false) // Ice Class: empty in the file
  assert.equal(r.cells.BR, 'N/A')    // Distance through ice: "N/A" is kept as written
})

test('the source row: EMSA licence wording verbatim, attribution, scope', () => {
  assert.equal(LICENSE_QUOTE, 'Reproduction is authorised, provided the source is acknowledged, save where otherwise stated.')
  assert.ok(MRV_SOURCE.license.includes(LICENSE_QUOTE))
  assert.equal(MRV_SOURCE.license_url, 'https://www.emsa.europa.eu/disclaimer.html')
  assert.match(MRV_SOURCE.attribution_text, /^Source: EMSA THETIS-MRV/)
  assert.match(MRV_SOURCE.notes, /NOT the ship's global annual emissions/)
  assert.equal(shipYearUrl('9378448', 2024), 'https://mrv.emsa.europa.eu/#public/emission-report/ship/9378448/rp/2024')
})

test('tonnes in plain words', () => {
  assert.equal(tonnesText(298.0592), '298 t')
  assert.equal(tonnesText(94.8), '94.8 t')
  assert.equal(tonnesText(19476.9), '19,477 t')
  assert.equal(tonnesText(0.00474), '4.7 kg')
  assert.equal(tonnesText(0.01706), '17 kg')
  assert.equal(tonnesText(0), '0 t')
  assert.equal(tonnesText(null), null)
})

test('resolver v1.8: EU MRV ship-years attach only to the one registry holder of the IMO (SYNTHETIC holder lists)', () => {
  const base = { acceptedVesselId: null, kind: KIND.shipYear, imo: { imo: '9378448', valid: true }, registryHolders: ['v1'], aisHolders: 0 }
  assert.deepEqual(decideMrvImo(base), { action: 'accept', vesselId: 'v1', method: 'IMO_EXACT', via: 'registry_imo', needsReview: false, candidates: [] })
  assert.equal(decideMrvImo({ ...base, registryHolders: ['v1', 'v2'] }).reason, 'imo_on_several_vessels')
  assert.equal(decideMrvImo({ ...base, registryHolders: [], aisHolders: 1 }).reason, 'imo_only_ais_reported')
  assert.equal(decideMrvImo({ ...base, registryHolders: [] }).reason, 'no_vessel_with_imo')
  assert.equal(decideMrvImo({ ...base, imo: { imo: '9378449', valid: false } }).reason, 'imo_checksum_invalid')
  assert.equal(decideMrvImo({ ...base, kind: KIND.file }).reason, 'not_a_vessel_source')
  assert.equal(decideMrvImo({ ...base, acceptedVesselId: 'v9' }).action, 'keep')
})

test('small EU share: under 25% of the modelled CO₂ for the same year; no comparison without a modelled figure', () => {
  assert.equal(SMALL_EU_SHARE, 0.25)
  // REAL EU figure (EURODAM 2024, 298.0592 t) vs Climate TRACE's modelled CO₂ for its Salish trips in 2024 (52,122 t,
  // docs/SHIP_POLLUTION_SOURCES.md §1, local pull 2026-09-23).
  assert.equal(smallEuShare(298.0592, 52122), true)
  assert.equal(smallEuShare(24.9, 100), true)   // SYNTHETIC boundary
  assert.equal(smallEuShare(25, 100), false)    // SYNTHETIC boundary: exactly a quarter is not "small"
  assert.equal(smallEuShare(27002, 3860), false) // AEGEAN DREAM-like: EU larger than the modelled Salish trips
  assert.equal(smallEuShare(298, null), false)
  assert.equal(smallEuShare(298, 0), false)
  assert.equal(smallEuShare(null, 52122), false)
})

test('small-share years: whole-year reports only, per calendar year, newest first (REAL EURODAM + MORNING CALM claims; SYNTHETIC modelled totals)', () => {
  const claims = [...mrvAssertions(g(wb24, '9378448'), wb24.layout, fileOf('2024-v245')), ...mrvAssertions(g(wb21, '9378448'), wb21.layout, fileOf('2021-v219')),
    ...mrvAssertions(g(wb24, '9285615'), wb24.layout, fileOf('2024-v245'))]
  const eurodam = claims.filter((c) => c.detail.imo === '9378448')
  assert.deepEqual(smallShareYears(eurodam, { 2024: 52122 }), [2024])       // 2021 has no modelled figure: no claim about it
  assert.deepEqual(smallShareYears(eurodam, { 2024: 52122, 2021: 100000 }), [2024, 2021]) // 19,477 < 25,000
  assert.deepEqual(smallShareYears(eurodam, { 2024: 52122, 2021: 50000 }), [2024])       // 19,477 ≥ 12,500
  assert.deepEqual(smallShareYears(eurodam, null), [])
  // MORNING CALM 2024: its partial row (6,761 t) is never compared on its own; only the whole-year row (7,554 t) is.
  const calm = claims.filter((c) => c.detail.imo === '9285615')
  assert.deepEqual(smallShareYears(calm, { 2024: 28000 }), [])     // 7,554 ≥ 25% of 28,000
  assert.deepEqual(smallShareYears(calm, { 2024: 40000 }), [2024]) // 7,554 < 10,000
})
