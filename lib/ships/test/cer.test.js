/**
 * Canada Energy Regulator records for Westridge, offline tests (lib/ships/cer.js). REAL rows recorded 2026-10-07
 * (fixtures/cer-westridge-2026-10-07.json). Cases built by hand are marked SYNTHETIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  readCerCsv, decodeCp1252, cerRecords, matchCva, ncIsWestridge, matchCondition, cvaRow, incidentRow, omRow, contaminationRow, conditionRow,
  toolWords, cvaStatusWords, incidentTypeWords, orderText, ORDERS, regdocsUrl, datasetUrl,
} from '../cer.js'
import { fixture } from './scenarios.js'

const fx = fixture('cer-westridge-2026-10-07.json')
const BERTH = { lat: 49.290971, lon: -122.949893 }
const recs = cerRecords(fx.files, BERTH)
const by = (kind, id) => recs.find((r) => r.kind === kind && r.id === id)

test('CSV: Windows-1252 bytes read as their characters (SYNTHETIC bytes), UTF-8 files as UTF-8', () => {
  assert.equal(decodeCp1252(Buffer.from([0x41, 0x96, 0x42, 0x92, 0xe9])), 'A–B’é')
  const rows = readCerCsv(Buffer.from([...Buffer.from('Name ,Note\n'), 0x58, 0x2c, 0x93, 0x51, 0x94, 0x0a]))
  assert.deepEqual(rows, [{ Name: 'X', Note: '“Q”' }])
  assert.deepEqual(readCerCsv(Buffer.from('A,B\n"x, y",ü\n')), [{ A: 'x, y', B: 'ü' }])
})

test('matching: the record’s own facility field decides; coordinates alone and pipeline fields only make hidden candidates', () => {
  assert.equal(by('cva', 'CV1718-267').status, 'accepted')
  assert.equal(by('cva', 'CV1617-196').status, 'accepted')
  assert.equal(by('cva', 'CV2021-214').status, 'candidate')            // Trans Mountain, empty Facilities, rounded point 1.2 km away
  assert.equal(by('cva', 'CV2324-102'), undefined)                     // the BL-001-2023 inspection: Facilities empty, point in Abbotsford
  assert.equal(by('cva', '2005-1'), undefined)                         // another company
  assert.equal(by('incident', 'INC2023-091').status, 'accepted')
  assert.equal(by('incident', 'INC2015-059').status, 'accepted')      // no facility name; Trans Mountain; its point is 71 m from the berth
  assert.match(by('incident', 'INC2015-059').why, /71 m from the berth/)
  assert.equal(by('om', 'OM2019-014').status, 'accepted')
  assert.equal(by('om', 'OM2018-308').status, 'candidate')
  assert.equal(by('contamination', 'REM2021-052').status, 'accepted')
  // SYNTHETIC: a Trans Mountain activity whose point is at the berth but whose Facilities is "BURNABY" stays a candidate.
  assert.equal(matchCva({ Company: 'Trans Mountain Pipeline ULC', Facilities: 'BURNABY', Latitude: '49.29', Longitude: '-122.95' }, BERTH).status, 'candidate')
})

test('findings: only Westridge’s rows of a Westridge activity, exact duplicates once, observations without a tool counted apart', () => {
  const cva = fx.files.cva.find((r) => r['Activity Number'] === 'CV1718-267')
  assert.ok(fx.files.nc.every((r) => ncIsWestridge(r, cva)))
  assert.equal(ncIsWestridge({ 'Selected Facilities': 'BURNABY' }, cva), false)                                  // SYNTHETIC
  assert.equal(ncIsWestridge({ 'Selected Facilities': '' }, { Facilities: 'BURNABY; WESTRIDGE MARINE TERMINAL' }), false)   // SYNTHETIC
  const row = cvaRow(by('cva', 'CV1718-267').payload)
  assert.equal(new Set(fx.files.nc.map((r) => JSON.stringify(r))).size, row.findings.length + row.observations)
  assert.deepEqual(row.tools, { 'Notice of non-compliance': 2, 'Assurance of voluntary compliance': 1, 'Information request': 3 })
  assert.equal(row.type, 'Field Inspection')
  assert.equal(row.start, '2018-03-20')
  assert.equal(row.status, 'Closed: no further action required')
  assert.equal(row.findings[0].tool, 'Notice of non-compliance')
})

test('conditions: shown only when the title is about the marine terminal; quoted; REGDOCS link from the instruments file', () => {
  assert.equal(by('condition', 'OC-065#84').status, 'accepted')
  assert.equal(by('condition', 'OC-065#134').status, 'accepted')        // "Updated Vessel Acceptance Standard"
  assert.equal(by('condition', 'OC-065#98').status, 'candidate')        // Indigenous construction monitoring, pipeline-wide
  assert.equal(by('condition', 'OC-065#124').status, 'candidate')
  const c = conditionRow(by('condition', 'OC-065#84').payload)
  assert.equal(c.title, 'Emergency release system at the Westridge Marine Terminal')
  assert.equal(c.status, 'In Progress')
  assert.ok(c.quote.length > 40 && !/<|&nbsp;/.test(c.quote))
  assert.equal(c.regdocs, regdocsUrl('C00061'))
  assert.equal(matchCondition({ Condition: '<strong>Berths</strong> text without the place' }), null)   // SYNTHETIC: no Westridge at all
})

test('plain words', () => {
  assert.equal(toolWords('Notice of Non-compliance (NNC)'), 'Notice of non-compliance')
  assert.equal(toolWords('Corrected Non-compliance (CNC)'), 'Corrected on the spot')
  assert.equal(toolWords(''), null)
  assert.equal(cvaStatusWords('Final'), 'Open: company action still required')
  assert.equal(incidentTypeWords('Serious Injury (as defined in the OPR)'), 'Serious injury')
  const i = incidentRow(by('incident', 'INC2023-091').payload)
  assert.equal(i.type, 'Fire')
  assert.equal(i.closed, '2023-11-15')
  assert.equal(omRow(by('om', 'OM2019-014').payload).start, '2019-02-06')
  assert.equal(contaminationRow(by('contamination', 'REM2021-052').payload).status, 'Facility monitoring')
  assert.equal(datasetUrl('cva'), 'https://open.canada.ca/data/en/dataset/1462ab8d-ce91-49ab-8202-406877061267')
})

test('the order’s quote is in its recorded page', () => {
  const t = orderText(fx.order.html)
  assert.equal(fx.order.url, ORDERS[0].url)
  assert.ok(t.toLowerCase().includes(ORDERS[0].says.toLowerCase()))
  assert.match(t, /CV2324-102/)
})
