/**
 * Metro Vancouver air quality permits, offline tests (lib/ships/metroVancouver.js). REAL documents recorded 2026-10-07
 * (fixtures/mv-permits-live-2026-10-07.json, trimmed verbatim slices). Cases built by hand are marked SYNTHETIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gvaNumbers, mvPageText, quoteIn, mvCacheName, validateMvBlock, parseMvIndex, mvFileUrl } from '../metroVancouver.js'
import { loadFacilityData } from '../facilities.js'
import { fixture } from './scenarios.js'

const fx = fixture('mv-permits-live-2026-10-07.json')
const data = await loadFacilityData()
const bc = data.facilities.filter((f) => f.country === 'CA')

test('GVA numbers read from OCR text: look-alike letters are read as digits', () => {
  assert.match(fx.neptune.text, /PERMIT GVAOO81/)                  // the scan's own OCR
  assert.deepEqual(gvaNumbers(fx.neptune.text), ['GVA0081'])
  assert.match(fx.fraser.text, /GVA11G7/)
  assert.deepEqual(gvaNumbers(fx.fraser.text), ['GVA1167'])
  assert.deepEqual(gvaNumbers('GVAOLD GVA 0200, GVA-1284'), ['GVA0200', 'GVA1284'])   // SYNTHETIC: a word is not a number
})

test('the application page: its own block (company, number, purpose, address, status), no navigation', () => {
  const t = mvPageText(fx.richardsonApp.text)
  assert.match(t, /^Richardson International Limited Richardson International Limited GVA1284 The purpose of this application/)
  assert.match(t, /operating under permit GVA0617, which expires November 30, 2025/)
  assert.match(t, /Application Under Review/)
  assert.ok(!/Public Notification|<div|&lt;/.test(t))
  assert.deepEqual(gvaNumbers(t), ['GVA1284', 'GVA0617'])
  assert.equal(mvPageText('<html><body>Please turn on JavaScript and try again. Permit Application</body></html>'), '')   // SYNTHETIC: empty template
})

test('a dock quote is checked against the document text, ignoring line breaks and spacing', () => {
  const nep = bc.find((f) => f.id === 'bc-neptune-site').bc.mv.permits[0]
  assert.ok(quoteIn(fx.neptune.text, nep.covers[0].says))
  assert.ok(!quoteIn(fx.neptune.text, 'Loading of marine vessel with grain'))   // SYNTHETIC: wrong words
  assert.ok(quoteIn(fx.richardsonNotice.text, 'Richardson is currently operating under permit GVA0617, which expires November 30, 2025'))
})

test('every BC entry says whether Metro Vancouver applies; inside it, permits or a "none found" note', () => {
  assert.equal(bc.length, 33)
  for (const f of bc) assert.deepEqual(validateMvBlock(f), [], f.id)
  const inside = bc.filter((f) => f.bc.mv.jurisdiction === 'in'), outside = bc.filter((f) => f.bc.mv.jurisdiction === 'outside')
  assert.equal(inside.length, 24)
  assert.equal(outside.length, 9)
  assert.deepEqual(inside.flatMap((f) => f.bc.mv.permits.map((p) => p.gva)).sort(),
    ['GVA0081', 'GVA0086', 'GVA0153', 'GVA0154', 'GVA0175', 'GVA0200', 'GVA0205', 'GVA0248', 'GVA0261', 'GVA0294', 'GVA0571', 'GVA0616', 'GVA0617',
      'GVA0618', 'GVA0619', 'GVA1080', 'GVA1167', 'GVA1216', 'GVA1281', 'GVU1296'])
  // A "none found" note never claims there is no permit: Metro Vancouver's site search is incomplete (2026-10-08).
  for (const f of inside.filter((x) => !x.bc.mv.permits.length)) assert.match(f.bc.mv.none, /not found in Metro Vancouver’s list of current permits or its site search/i, f.id)
  const noWhy = { id: 'bc-x', bc: { mv: { jurisdiction: 'in', permits: [{ gva: 'GVA0081', holder: 'x', address: 'y', status: 'Issued', doc_url: 'u' }] } } }   // SYNTHETIC
  assert.deepEqual(validateMvBlock(noWhy), ['bc-x: mv GVA0081 needs gva, holder, address, status, why'])
  assert.deepEqual(validateMvBlock({ id: 'bc-y', bc: { mv: { jurisdiction: 'in', permits: [] } } }), ['bc-y: bc.mv.permits (or bc.mv.none)'])   // SYNTHETIC
})

test('approvals (GVU) are numbers too; the index page\u2019s rows are read with their file, date and holder', () => {
  assert.deepEqual(gvaNumbers('Approval GVU1296 Page 2 of 20; permit GVAO617'), ['GVU1296', 'GVA0617'])
  // SYNTHETIC: one row in the shape of the Current Permits and Approvals table (columns: link, URL, title, date, holder).
  const html = '<tr><td><a href="https://metrovancouver.org/x/AirQualityPermits/0153 - Westshore Terminals Limited Partnership - Air Quality Permit Amendment - Issued April 11, 2025.pdf">0153</a></td>'
    + '<td>u</td><td>0153 - Westshore Terminals Limited Partnership - Air Quality Permit Amendment - Issued April 11, 2025</td><td>4/11/2025 7:00:00 AM</td><td>Westshore Terminals Limited Partnership</td></tr>'
  const [r] = parseMvIndex(html)
  assert.equal(r.gva, 'GVA0153')
  assert.equal(r.date, '2025-04-11')
  assert.equal(r.holder, 'Westshore Terminals Limited Partnership')
  assert.equal(mvFileUrl('1281 - Chemtrade Electrochem Inc. - Air Quality Permit – Issued April 30 2026.pdf'),
    'https://metrovancouver.org/services/environmental-regulation-enforcement/air-quality-regulatory-program/AirQualityPermits/1281%20-%20Chemtrade%20Electrochem%20Inc.%20-%20Air%20Quality%20Permit%20%E2%80%93%20Issued%20April%2030%202026.pdf')
})

test('the cache name is the same for the encoded and the plain URL', () => {
  const u = 'https://metrovancouver.org/x/0205%20-%20Pacific%20Coast%20Terminals.pdf'
  assert.equal(mvCacheName(u), mvCacheName(decodeURI(u)))
  assert.equal(mvCacheName(fx.neptune.url), 'mv-ac91340ef4189896')
})
