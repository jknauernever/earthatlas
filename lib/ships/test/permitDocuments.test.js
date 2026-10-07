/**
 * Permit documents (layer 1), offline: lib/ships/permitDocuments.js parsers on REAL pages recorded 2026-10-06
 * (fixtures/permit-documents-live-2026-10-06.json, trimmed verbatim slices). No network, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseParisDocs, parisPostbackFields, parseEcologyPage, ecologyPermitKind, parseNwcaaRow } from '../permitDocuments.js'
import { fixture } from './scenarios.js'

const fx = fixture('permit-documents-live-2026-10-06.json')

test('PARIS: page 1 rows, the stated total, and the page-2 postback target', () => {
  const p = parseParisDocs(fx.paris)
  assert.equal(p.total, 17)
  assert.equal(p.rows.length, 10)
  const permit = p.rows.find((r) => r.doc_id === '478691')
  assert.equal(permit.title, 'WA0000761-2024-03-18-Tesoro-NPDES-Permit2022.pdf')
  assert.equal(permit.permit, 'WA0000761')
  assert.equal(permit.permit_version, '5')
  assert.equal(permit.size_bytes, 963933)
  assert.equal(permit.description, 'Permit, issued March 18, 2024; effective April 1, 2024.')
  assert.equal(permit.url, 'https://apps.ecology.wa.gov/paris/DownloadDocument.aspx?id=478691')
  const p2 = p.pages.find((x) => x.page === 2)
  assert.match(p2.target, /RadGridPermitSearchResults\$ctl00\$ctl03\$ctl01\$ctl\d+$/)
  const f = parisPostbackFields(fx.paris, p2.target)
  assert.equal(f.__EVENTTARGET, p2.target)
})

test('Ecology page: document links with section and parent; site navigation left out', () => {
  const links = parseEcologyPage(fx.ecologyTesoro)
  const permit = links.find((l) => l.label === 'Wastewater permit')
  assert.equal(permit.section, 'Permit information')
  assert.equal(ecologyPermitKind(permit), 'npdes')
  const support = links.filter((l) => l.label === 'Support document')
  assert.deepEqual(support.map((l) => l.parent), ['Wastewater permit', 'Hazardous wast corrective action permit'])
  assert.deepEqual(support.map(ecologyPermitKind), ['npdes', 'rcra'])
  const penalty = links.find((l) => l.label === 'Penalty Document')
  assert.match(penalty.section, /Penalized 1\.39 Million/)
  assert.equal(ecologyPermitKind(penalty), null)
  assert.ok(!links.some((l) => /PermitLookup\.aspx$|industrial\/Default\.aspx$/.test(l.url)))
})

test('NWCAA: the facility row by location name; files with their labels; emissions as numbers', () => {
  const bp = parseNwcaaRow(fx.nwcaaRows, 'BP Cherry Point Refinery')
  assert.equal(bp.permit_date, 'Jun. 15, 2022')
  assert.equal(bp.permit_status, 'Renewal application received Jun. 11, 2026')
  assert.equal(bp.emissions_tpy.co2, 2188015)
  assert.deepEqual(bp.files.map((f) => f.label), ['AOP', 'SOB', 'OACs', 'Orders', 'PSDs', 'MISC', 'Renewal Application'])
  assert.equal(bp.files[2].what, 'Orders of Approval to Construct (new source review)')
  assert.ok(!JSON.stringify(bp).includes('email-protection'))
  assert.equal(parseNwcaaRow(fx.nwcaaRows, 'Tesoro (Marathon) Anacortes Refinery').files.length, 6)
  assert.equal(parseNwcaaRow(fx.nwcaaRows, 'Nowhere'), null)
})

test('PARIS facility page: permits with every version’s dates (no staff names), documents page 1 and its pager, point', async () => {
  const { parseParisFacility, parisVersions } = await import('../permitDocuments.js')
  const r = parseParisFacility(fx.parisFacility6344)
  assert.equal(r.name, 'TESORO LOGISTICS ANACORTES CROS')
  assert.equal(r.address, '7969 N TEXAS RD')
  assert.ok(Math.abs(r.lat - 48.4786) < 0.001)
  assert.deepEqual(r.permits.map((p) => `${p.permit} v${p.version} ${p.status}`).sort(), ['ST0045528 v1 Inactive', 'ST0045528 v2 Active', 'ST0045528 v3 Draft'])
  const v2 = r.permits.find((p) => p.version === '2')
  assert.deepEqual([v2.issued, v2.effective, v2.expires], ['2019-02-14', '2019-03-01', '2024-02-29'])
  assert.ok(!JSON.stringify(r.permits).includes('Penfield') && !JSON.stringify(r.permits).includes('@ecy'))
  assert.equal(r.documents.length, 15)
  assert.equal(r.documents[0].doc_type, 'Inspection Related')
  assert.deepEqual(r.pages.map((p) => p.page), [2, 3])
  const v = parisVersions(r.permits, 'ST0045528')
  assert.equal(v.current.version, '2')   // the active version, not the draft renewal
  assert.equal(v.draft.version, '3')
})
