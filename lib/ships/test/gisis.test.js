/**
 * IMO GISIS (lib/ships/gisis.js, resolver v1.6 decideGisisImo), pure logic, offline. The rows are REAL, copied verbatim from
 * the two GISIS exports downloaded 2026-09-28 UTC (fixtures/gisis-reg42-live-2026-09-28.json,
 * fixtures/gisis-isps-facilities-live-2026-09-28.json; see fixtures/README.md "IMO GISIS"). Cases built here are marked
 * SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGisisCsv, checkColumns, REG42_COLUMNS, FACILITY_COLUMNS, rowCategory, statedLoops, makerModel, rowImo, groupReg42,
  reg42Assertions, stripPersonal, gisisCoord, gisisDate, mapFacilityRow, checkCrosswalkRow, SCRUBBERS_SOURCE, FACILITIES_SOURCE, JOSH_DECISION,
} from '../gisis.js'
import { decideGisisImo } from '../resolve.js'
import { fixture } from './scenarios.js'

const reg = parseGisisCsv(fixture('gisis-reg42-live-2026-09-28.json').csv)
const fac = parseGisisCsv(fixture('gisis-isps-facilities-live-2026-09-28.json').csv)
const rowOf = (imo) => reg.filter((r) => r['IMO Number, if applicable'].trim() === `IMO ${imo}`)
const facOf = (n) => fac.find((r) => r['IMO Port Facility Number'] === n)

test('the REAL exports parse with the expected columns; a changed header is refused (SYNTHETIC header)', () => {
  assert.equal(reg.length, 17)
  checkColumns(reg, REG42_COLUMNS)
  checkColumns(fac, FACILITY_COLUMNS)
  assert.throws(() => checkColumns([{ 'Notifying Party': 'x' }], REG42_COLUMNS), /columns changed/)
})

test('sources carry Josh\'s decision verbatim, the IMO terms, and no commercial use', () => {
  for (const s of [SCRUBBERS_SOURCE, FACILITIES_SOURCE]) {
    assert.ok(s.notes.startsWith(JOSH_DECISION))
    assert.match(s.notes, /"For our purposes now, assume IMO has given us permission\. I don't care about casualty data\. Scrubber and facility info is a go\."/)
    assert.match(s.notes, /Used on Josh's instruction assuming IMO permission; written permission not yet obtained; the IMO Web Accounts policy otherwise forbids republishing\./)
    assert.equal(s.commercial_use, false)
  }
})

test('REAL rows: EGCS only when the row\'s own text says so; a maker-and-model-code row is not called a scrubber', () => {
  assert.equal(rowCategory(rowOf('9751509')[0]), 'egcs') // "Lang Tech Hybrid Scrubber"
  assert.equal(rowCategory(rowOf('9812468')[0]), 'egcs') // type column "Exhaust Gas Cleaning System", model GTM-R
  assert.equal(rowCategory(rowOf('9614141')[0]), 'egcs') // "Alternative Technology (EGCS)"
  assert.equal(rowCategory(rowOf('9697753')[0]), 'other') // "Apparatus", Wartsila Moss WM455-HS: the row never says EGCS
  assert.equal(rowCategory(rowOf('9247364')[0]), 'other') // Alternative fuel oils
  assert.equal(rowCategory(rowOf('9888560')[0]), 'other') // Thermal Waste Treatment Device
})

test('REAL rows: loop type only as the row states it (open, hybrid, OPEN/CLOSED, all three), else none', () => {
  assert.deepEqual(statedLoops(rowOf('9434474')[0]), ['open'])
  assert.deepEqual(statedLoops(rowOf('9751509')[0]), ['hybrid'])
  assert.deepEqual(statedLoops(rowOf('9880855')[0]), ['hybrid'])
  assert.deepEqual(statedLoops(rowOf('9771999')[0]), ['open', 'closed']) // "OPEN/CLOSED Loop"
  assert.deepEqual(statedLoops(rowOf('9365984')[0]), ['open', 'closed', 'hybrid']) // "(OPEN/CLOSED LOOP MODE-HYBRID)"
  assert.deepEqual(statedLoops(rowOf('9812468')[0]), []) // GTM-R: EGCS, loop not stated
  assert.deepEqual(statedLoops(rowOf('9614141')[0]), [])
})

test('maker + model without repeating the maker; empty ones say so', () => {
  assert.equal(makerModel(rowOf('9697753')[0]), 'Wartsila Moss AS, WM455-HS')
  assert.equal(makerModel(rowOf('9751509')[0]), 'Lang Tech Oy Ab Lang Tech Hybrid Scrubber')
  assert.equal(makerModel(rowOf('9812468')[0]), 'Yara Marine Technologies GTM-R')
  assert.equal(makerModel(rowOf('9614141')[0]), 'MED 2008421 to be fitted to DG3 and DG4')
  assert.equal(makerModel(rowOf('9247364')[0]), null) // N/A, N/A
  assert.equal(makerModel(rowOf('9075345')[0]), null)
})

test('IMO field: 7 digits (check digit reported, not fixed); anything else is no IMO', () => {
  assert.deepEqual(rowImo(rowOf('9751509')[0]), { value: '9751509', valid: true, raw: 'IMO 9751509' })
  assert.equal(rowImo(rowOf('8912470')[0]).valid, false)
  const odd = reg.filter((r) => !/^IMO \d{7}$/.test(r['IMO Number, if applicable'].trim())).map((r) => r['IMO Number, if applicable'])
  assert.deepEqual(odd.sort(), ['IMO 984647 ', 'IMO N° OMI '])
  for (const r of reg.filter((x) => odd.includes(x['IMO Number, if applicable']))) assert.equal(rowImo(r), null)
})

test('grouping: one group per IMO (two notifications for 9880855), exact duplicate rows kept once, no-IMO rows alone', () => {
  const g = groupReg42(reg)
  const by = Object.fromEntries(g.map((x) => [x.key, x]))
  assert.equal(by['IMO 9880855'].rows.length, 2)
  assert.equal(by['IMO 9075345'].rows.length, 1) // two identical lines in the export
  assert.equal(g.filter((x) => x.kind === 'marpol6_reg42_row').length, 2)
  assert.equal(by['IMO 8912470'].imo.valid, false)
  assert.equal(g.reduce((n, x) => n + x.rows.length, 0), reg.length - 1)
})

test('claims: period unknown (submitted date only in detail), registry class, attribute by category, loop basis stated', () => {
  const by = Object.fromEntries(groupReg42(reg).map((x) => [x.key, x]))
  const [bliss] = reg42Assertions(by['IMO 9751509'])
  assert.equal(bliss.attribute, 'scrubber')
  assert.equal(bliss.value_raw, 'Lang Tech Oy Ab Lang Tech Hybrid Scrubber')
  assert.equal(bliss.period_kind, 'unknown')
  assert.equal(bliss.period_from, null)
  assert.equal(bliss.evidence_class, 'registry')
  assert.equal(bliss.detail.flag, 'Bahamas')
  assert.equal(bliss.detail.submitted, '2018-04-20')
  assert.deepEqual(bliss.detail.loop, ['hybrid'])
  assert.equal(bliss.detail.loop_basis, 'stated in the row\'s text')
  const [ovation] = reg42Assertions(by['IMO 9697753'])
  assert.equal(ovation.attribute, 'equivalent_compliance')
  assert.equal(ovation.detail.type_raw, 'Apparatus')
  const two = reg42Assertions(by['IMO 9880855'])
  assert.equal(two.length, 2)
  assert.notEqual(two[0].sub_record_ref, two[1].sub_record_ref)
  assert.deepEqual(two.map((a) => a.detail.submitted), ['2021-06-28', '2021-06-30'])
  const [dup] = reg42Assertions(by['IMO 9075345'])
  assert.equal(dup.value_raw, 'maker and model not stated')
})

test('decideGisisImo: attach only to the ONE vessel holding the IMO as a registry claim (SYNTHETIC holders)', () => {
  const base = { acceptedVesselId: null, kind: 'marpol6_reg42_imo', imo: { imo: '9751509', valid: true }, registryHolders: [], aisHolders: 0 }
  assert.deepEqual(decideGisisImo({ ...base, registryHolders: ['v1'] }), { action: 'accept', vesselId: 'v1', method: 'IMO_EXACT', via: 'registry_imo', needsReview: false, candidates: [] })
  assert.equal(decideGisisImo({ ...base, registryHolders: ['v1', 'v2'] }).reason, 'imo_on_several_vessels')
  assert.equal(decideGisisImo({ ...base, aisHolders: 1 }).reason, 'imo_only_ais_reported')
  assert.equal(decideGisisImo(base).reason, 'no_vessel_with_imo')
  assert.equal(decideGisisImo({ ...base, imo: { imo: '8912470', valid: false }, registryHolders: ['v1'] }).reason, 'imo_checksum_invalid')
  assert.equal(decideGisisImo({ ...base, kind: 'marpol6_reg42_row', imo: null }).reason, 'no_imo_in_row')
  assert.equal(decideGisisImo({ ...base, acceptedVesselId: 'v9', registryHolders: ['v1'] }).action, 'keep')
})

test('facility coordinates are degrees + decimal minutes (REAL Westridge = 49° 17.26′ N 122° 57.00′ W, as its GISIS page shows)', () => {
  const w = mapFacilityRow(facOf('CAVAN-0022')).facility
  assert.equal(w.lat, Math.round((49 + 17.26 / 60) * 1e6) / 1e6)
  assert.equal(w.lon, -122.95)
  assert.equal(gisisCoord('0957N', 'lat'), 9.95) // REAL DDMM-only row (Cochin)
  assert.equal(gisisCoord('07617E', 'lon'), Math.round((76 + 17 / 60) * 1e6) / 1e6)
  assert.equal(gisisCoord('', 'lat'), null)
  assert.equal(gisisCoord('491722W', 'lat'), null) // SYNTHETIC: wrong hemisphere for the axis
  assert.equal(gisisCoord('496122N', 'lat'), null) // SYNTHETIC: 61 minutes
  assert.equal(gisisDate('23/07/2026 00:00:00'), '2026-07-23')
  assert.equal(gisisDate(''), null)
})

test('personal contact fields are dropped before storing (allow-list), REAL row + SYNTHETIC officer columns', () => {
  const real = mapFacilityRow(facOf('CABUB-0003'))
  assert.deepEqual(real.dropped, [])
  assert.deepEqual(Object.keys(real.payload), FACILITY_COLUMNS)
  const withPeople = { ...facOf('CABUB-0003'), 'PFSO Name': 'A Person', 'Contact Email': 'a@b.c', 'Phone': '+1 555', 'Security Officer': 'X' }
  const { kept, dropped } = stripPersonal(withPeople)
  assert.deepEqual(dropped.sort(), ['Contact Email', 'PFSO Name', 'Phone', 'Security Officer'])
  assert.ok(!JSON.stringify(kept).includes('A Person') && !JSON.stringify(kept).includes('a@b.c'))
  assert.match(mapFacilityRow({ ...facOf('CABUB-0003'), 'IMO Port Facility Number': '' }).error, /without an IMO Port Facility Number/)
})

test('REAL facility rows: status fields, US port area, missing coordinates', () => {
  const s = mapFacilityRow(facOf('CAYHS-0002')).facility
  assert.equal(s.withdrawn, true)
  assert.equal(s.withdrawn_date, '2023-03-30')
  const us = mapFacilityRow(facOf('USSEA-0001')).facility
  assert.equal(us.name, 'Puget Sound Port Area')
  assert.equal(us.lat, Math.round((47 + 35 / 60) * 1e6) / 1e6)
  const none = fac.map(mapFacilityRow).find((m) => m.facility && m.facility.lat == null)
  assert.ok(none, 'the fixture holds a row without coordinates')
})

test('crosswalk check: name + position agree (Westridge); a wrong GISIS point needs a position_note (Parkland); SYNTHETIC mismatches', () => {
  const w = mapFacilityRow(facOf('CAVAN-0022')).facility
  const westridge = { key: 'bc-westridge', name: 'Westridge Marine Terminal', berths: [{ lat: 49.290971, lon: -122.949893 }] }
  const ok = checkCrosswalkRow({ terminal: 'bc-westridge', facility: 'CAVAN-0022', facility_name: 'Westridge Marine Terminal', decision: 'link' }, w, westridge)
  assert.equal(ok.ok, true, ok.problems.join())
  assert.equal(ok.position_agrees, true)
  assert.ok(ok.km < 0.5)
  const p = mapFacilityRow(facOf('CAVAN-0021')).facility
  const parkland = { key: 'bc-parkland-burnaby', name: 'Burnaby Refinery marine terminal (BC Ports and Terminals: "Stanovan Terminal (Chevron Canada)")', berths: [{ lat: 49.292, lon: -123.0042 }] }
  const row = { terminal: 'bc-parkland-burnaby', facility: 'CAVAN-0021', facility_name: 'PARKLAND BURNABY REFINERY', decision: 'link' }
  const noNote = checkCrosswalkRow(row, p, parkland)
  assert.equal(noNote.ok, false)
  assert.match(noNote.problems.join(), /no position_note/)
  const withNote = checkCrosswalkRow({ ...row, position_note: 'GISIS point is in Victoria' }, p, parkland)
  assert.equal(withNote.ok, true)
  assert.equal(withNote.position_agrees, false)
  // SYNTHETIC: right place, unrelated name → never linked.
  assert.match(checkCrosswalkRow({ ...row, facility: 'CAVAN-0022', facility_name: 'Westridge Marine Terminal' }, w, { ...parkland, berths: westridge.berths }).problems.join(), /share no main word/)
  // SYNTHETIC: GISIS renamed the facility since the crosswalk was reviewed.
  assert.match(checkCrosswalkRow({ ...row, facility_name: 'Old name' }, p, parkland).problems.join(), /is now "PARKLAND BURNABY REFINERY"/)
  assert.equal(checkCrosswalkRow({ ...row, decision: 'candidate', position_note: 'x' }, p, parkland).ok, false)
})
