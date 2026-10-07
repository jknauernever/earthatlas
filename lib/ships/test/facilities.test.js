/**
 * Facilities pilot, offline (lib/ships/facilities.js). REAL responses recorded 2026-10-06 (fixtures/facilities-live-2026-10-06.json)
 * and the real data file. No network, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dfrPermits, dfrEnforcement, parseSepaSearch, parseSepaRecord, sepaMatch, loadFacilityData, validateFacilityData, frsIdsOf,
} from '../facilities.js'
import { fixture } from './scenarios.js'

const fx = fixture('facilities-live-2026-10-06.json')
const data = await loadFacilityData()
const bp = data.facilities.find((f) => f.id === 'wa-bp-cherry-point-refinery')
const mpc = data.facilities.find((f) => f.id === 'wa-marathon-anacortes-refinery')

test('the data file is valid and names each FRS id once', () => {
  assert.deepEqual(validateFacilityData(data), [])
  const all = data.facilities.flatMap(frsIdsOf)
  assert.equal(new Set(all).size, all.length)
  assert.deepEqual(validateFacilityData({ facilities: [{ ...bp, frs_primary: '123' }] }), ['wa-bp-cherry-point-refinery: frs_primary'])
})

test('dfrPermits: BP Cherry Point program records, values as ECHO gives them', () => {
  const m = dfrPermits(fx.dfr['110070752633'].body)
  assert.equal(m.frs, '110070752633')
  assert.equal(m.name, 'BP CHERRY POINT REFINERY')
  assert.equal(m.permits.length, 27) // every DFR Permits row except the FRS row itself (incl. 3 ICIS facility-id rows)
  const npdes = m.permits.find((p) => p.permit_key === 'WA0022900')
  assert.equal(npdes.epa_system, 'ICIS-NPDES')
  assert.equal(npdes.statute, 'CWA')
  assert.equal(npdes.universe, 'Major: NPDES Individual Permit')
  assert.equal(npdes.expires, '2027-06-30')
  assert.equal(npdes.program_status, 'Effective')
  const air = m.permits.find((p) => p.epa_system === 'ICIS-Air')
  assert.match(air.areas, /CAATVP/)
  assert.equal(air.expires, null)
  assert.ok(m.permits.every((p) => p.epa_system !== 'FRS'))
  assert.ok(Math.abs(m.lat - 48.891937) < 1e-6)
})

test('dfrPermits rejects a non-success response', () => {
  assert.match(dfrPermits({ Results: { Message: 'Error' } }).error, /not a success/)
  assert.match(dfrPermits({}).error, /no Results/)
})

test('dfrEnforcement: notices and formal actions keep ECHO’s values and its date window', () => {
  const e = dfrEnforcement(fx.dfr['110070752633'].body)
  assert.ok(e.notices.length > 0)
  assert.ok(e.notices.every((n) => /^\d{4}-\d{2}-\d{2}$/.test(n.date) && n.type))
  assert.ok(e.formal.every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.date) && a.type))
  assert.ok(e.windows.notices.some((w) => w.program === 'CAA' && /^\d{4}-/.test(w.from)))
})

test('parseSepaSearch: rows, lead agency, county, file number, pages', () => {
  const r = parseSepaSearch(fx.sepaSearch.html)
  assert.ok(r.rows.length > 0)
  const amp5 = r.rows.find((x) => x.sepa === '202303911')
  assert.equal(amp5.lead, 'Whatcom County')
  assert.equal(amp5.issued, '2023-08-16')
  assert.equal(amp5.county, 'WHATCOM')
  assert.equal(amp5.proposalName, 'bp Cherry Point Advance Mitigation Project 5')
  assert.equal(amp5.fileNumber, 'SEPA2023-00051')
  assert.ok(r.lastPage >= 1)
})

test('parseSepaRecord: fields, parcels, documents; contacts not kept', () => {
  const r = parseSepaRecord(fx.sepaRecords['202303911'].html)
  assert.equal(r.sepa, '202303911')
  assert.equal(r.lead, 'Whatcom County')
  assert.equal(r.fileNumber, 'SEPA2023-00051')
  assert.equal(r.type, 'MDNS')
  assert.equal(r.issued, '2023-08-16')
  assert.equal(r.commentsDue, '2023-08-30')
  assert.equal(r.parcels.length, 16)
  assert.ok(r.parcels.includes('390105038276'))
  assert.match(r.applicant, /bp Products North America/)
  assert.equal(r.documents.length, 1)
  assert.match(r.documents[0].url, /DocumentOpenHandler\.ashx\?DocumentId=163352$/)
  assert.ok(!('contact' in r) && !JSON.stringify(r).includes('ECaubo@'))
  assert.match(parseSepaRecord('<html></html>').error, /no SEPA number/)
})

test('sepaMatch: accepted only when county, applicant and place all match', () => {
  const ok = sepaMatch(bp, parseSepaRecord(fx.sepaRecords['202303911'].html))
  assert.equal(ok.status, 'accepted')
  assert.deepEqual(ok.why, { county: 'WHATCOM', applicant_word: 'BP', place_word: 'Cherry Point' })
  // BP's own record, but the text names a church site on Jackson Road, not the refinery: kept as a candidate.
  assert.equal(sepaMatch(bp, parseSepaRecord(fx.sepaRecords['201801445'].html)).status, 'candidate')
  // A Tesoro gas station in Skagit County: applicant and county match, no refinery place: candidate.
  const st = sepaMatch(mpc, parseSepaRecord(fx.sepaRecords['201204345'].html))
  assert.equal(st.status, 'candidate')
  assert.equal(st.why.applicant_word, 'Tesoro')
  assert.equal(st.why.place_word, null)
  // Wrong county never matches.
  assert.equal(sepaMatch(mpc, parseSepaRecord(fx.sepaRecords['202303911'].html)).status, 'candidate')
})

test('enforcement: ECHO cases by permit; Ecology documents joined to ECHO rows by date, the rest kept as their own rows', async () => {
  const { dfrCases, joinEnforcementDocs } = await import('../facilities.js')
  const cases = dfrCases(fx.dfr['110070752633'].body)
  assert.ok(cases.every((c) => c.id && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && !c.permit_key.includes('/')))
  // Rows and documents as the live data gave them for WA0000761 on 2026-10-06 (titles / descriptions copied verbatim).
  const rows = [
    { kind: 'formal', date: '2025-05-14', type: 'State CWA Penalty AO', permit_key: 'WA0000761' },
    { kind: 'notice', date: '2026-07-23', type: 'Industrial Stormwater - Letter of Violation/ Warning Letter', permit_key: 'WA0000761' },
    { kind: 'notice', date: '2026-09-02', type: 'Industrial Stormwater - Agency Enforcement Review', permit_key: 'WA0000761' },
  ]
  const docs = [
    { id: 1, type: 'Enforcement Documents', description: 'Civil Penalty Issued: 05/14/2025 Docket: 23528', title: 'WA0000761-2025-05-14-Tesoro-NOP23528-OtherViolations.pdf', url: 'u1', record_id: 9 },
    { id: 2, type: 'Enforcement Documents', description: null, title: '2026-07-23-Tesoro-WarningLetter-pH.pdf', url: 'u2', record_id: 9 },
    { id: 3, type: 'Enforcement Documents', description: 'Civil Penalty Issued: 03/09/2017 Docket: 14030', title: 'WA0000761_2017_03_09_TesoroNoticeOfPenalty14030.pdf', url: 'u3', record_id: 9 },
    { id: 4, type: 'Enforcement Submittals', description: 'Enforcement/corrective action Submittal Received: 12/29/2020', title: 'x.pdf', url: 'u4', record_id: 9 },
  ]
  const out = joinEnforcementDocs(rows, docs)
  assert.deepEqual(out[0].documents.map((d) => [d.what, d.docket]), [['Civil Penalty', '23528']])
  assert.deepEqual(out[1].documents.map((d) => d.what), ['Warning letter'])
  assert.deepEqual(out[2].documents, [])
  const own = out.filter((r) => r.source === 'paris')
  assert.deepEqual(own.map((r) => [r.date, r.type, r.documents[0].docket]), [['2017-03-09', 'Civil Penalty', '14030']])   // submittals are not enforcement documents
})

test('PARIS detail on enforcement rows: same-day decision, violations since the previous action, inspections with their report', async () => {
  const { withParisDetail } = await import('../facilities.js')
  // Values as WA Ecology PARIS listed them for WA0000761 on 2026-10-06 (facility 6), copied verbatim.
  const rows = [
    { kind: 'notice', date: '2026-07-07', type: 'Industrial Stormwater - Agency Enforcement Review' },
    { kind: 'notice', date: '2026-07-23', type: 'Industrial Stormwater - Letter of Violation/ Warning Letter' },
  ]
  const pages = [{ recordId: 7, violations: [
    { permit: 'WA0000761', violation: 'Warning Limit Exceedance', date: '2026-07-10', parameter: 'pH (Hydrogen Ion) Daily Max', units: 'Standard Units', value: 9.2, max_limit: 9, point: '001' },
    { permit: 'WA0000761', violation: 'Warning Limit Exceedance', date: '2026-06-03', parameter: 'pH (Hydrogen Ion) Daily Max', units: 'Standard Units', value: 9.3, max_limit: 9, point: '001' },
    { permit: 'WAR302760', violation: 'Other permit', date: '2026-07-11' },
  ], enforcements: [{ type: 'Informal Action - Letter', status: 'Complete', date: '2026-07-23' }, { type: 'No enforcement action necessary', status: 'Complete', date: '2026-07-07' }],
  inspections: [{ permit: 'WA0000761', type: 'Compliance Inspection-Without Sampling', status: 'Complete', announced: 'Y', start: '2025-04-22', id: '599670' }] }]
  const docs = [{ type: 'Inspection Related', description: 'Compliance Inspection-Without Sampling Date: 04/22/2025', title: 'r.pdf', url: 'ur', record_id: 7 }]
  const { rows: out, violations } = withParisDetail(rows, pages, 'WA0000761', docs)
  assert.equal(violations.length, 2)                                   // the other permit's violation is not this permit's
  const letter = out.find((r) => r.date === '2026-07-23')
  assert.equal(letter.outcome, 'Informal Action - Letter')
  assert.deepEqual(letter.violations.map((v) => v.date), ['2026-07-10'])   // after the 07-07 review, up to the letter
  assert.equal(letter.violationsSince, '2026-07-07')
  const review = out.find((r) => r.date === '2026-07-07')
  assert.deepEqual(review.violations.map((v) => v.date), ['2026-06-03'])
  const insp = out.find((r) => r.kind === 'inspection')
  assert.equal(insp.documents[0].what, 'Inspection report')
  assert.equal(insp.inspectionId, '599670')
})

test('no_facility notes and air agencies are validated (SYNTHETIC entries built from the real data file)', () => {
  const ok = { terminal: 'wa-test-terminal', says: 'No facility found.', searched: [{ what: 'EPA ECHO within 0.75 mi of the berth' }], air_agency: 'SWCAA' }
  assert.deepEqual(validateFacilityData({ facilities: [], no_facility: [ok] }), [])
  assert.deepEqual(validateFacilityData({ facilities: [], no_facility: [{ ...ok, searched: [] }] }), ['no_facility wa-test-terminal: says + searched needed'])
  assert.deepEqual(validateFacilityData({ facilities: [], no_facility: [{ ...ok, air_agency: 'XYZ' }] }), ['no_facility wa-test-terminal: air_agency XYZ'])
  assert.deepEqual(validateFacilityData({ facilities: [bp], no_facility: [{ ...ok, terminal: 'wa-bp-cherry-point' }] }), ['no_facility wa-bp-cherry-point: a facility entry names it'])
  assert.deepEqual(validateFacilityData({ facilities: [{ ...bp, air_agency: 'NWCAA' }] }), [])
  assert.deepEqual(validateFacilityData({ facilities: [{ ...bp, air_agency: 'NOPE' }] }), ['wa-bp-cherry-point-refinery: air_agency NOPE'])
})
