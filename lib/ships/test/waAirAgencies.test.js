/**
 * WA local clean air agencies (lib/ships/waAirAgencies.js): parsers, data-file checks and text checks. Offline.
 * REAL: fixtures/wa-air-live-2026-10-07.json (recorded live, trimmed to verbatim slices) and lib/ships/data/wa-air-permits.json.
 * SYNTHETIC variants are marked where used.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  parseOrcaaNotice, parseSwcaaPermits, longDate, validateAirData, checkTexts, urlsNeeded, formKey, localAgencyOf, quoteIn, htmlText,
  airCacheName, AIR_SYSTEMS,
} from '../waAirAgencies.js'
import { fixture } from './scenarios.js'

const fx = fixture('wa-air-live-2026-10-07.json')
const data = JSON.parse(await readFile(new URL('../data/wa-air-permits.json', import.meta.url), 'utf8'))
const puget = data.entries.find((e) => e.terminal === 'wa-puget-lng-tacoma')

test('parseOrcaaNotice: the BWC Terminals notice (REAL) gives number, status, date finalized, address and every file', () => {
  const n = parseOrcaaNotice(fx.bwcNotice.text)
  assert.equal(n.notice, '24NOC1693')
  assert.equal(n.status, 'Approved')
  assert.equal(n.finalized, '2025-04-25')
  assert.equal(n.posted, '2025-03-31')
  assert.equal(n.business, 'BWC Terminals LLC')
  assert.equal(n.address, '3128 Port Industrial Road, Hoquiam, WA')
  assert.equal(n.source_class, 'RC2')
  assert.match(n.description, /^The applicant requests preapproval to modify Order of Approval 21NOC1533/)
  assert.deepEqual(n.links.map((l) => l.field), ['Application as Received', 'Related Files', 'Final Determination'])
  assert.equal(n.links[2].url, 'https://www.orcaa.org/wp-content/uploads/FinalDetermination-24NOC1693-25Apr2025.pdf')
})

test('parseSwcaaPermits: the EGT permit list (REAL) gives the plant, its earlier name and permits newest first with PDFs', () => {
  const r = parseSwcaaPermits(fx.egtList.text)
  assert.equal(r.plant, 'EGT LLC')
  assert.deepEqual(r.previous, ['EGT Development, LLC - 2/27/2013'])
  assert.deepEqual(r.permits.map((p) => p.number), ['23-3607', '19-3320'])
  assert.equal(r.permits[0].final, '2023-11-22')
  assert.equal(r.permits[0].permit_url, 'https://www.swcleanair.gov/docs/permits/Final/23-3607ADP.pdf')
  assert.equal(r.permits[0].tsd_url, 'https://www.swcleanair.gov/docs/permits/Final/23-3607TSD.pdf')
})

test('longDate / quoteIn / htmlText / localAgencyOf', () => {
  assert.equal(longDate('Tuesday, March 13, 2012'), '2012-03-13')
  assert.equal(longDate('April 25, 2025'), '2025-04-25')
  assert.equal(longDate('not a date'), null)
  assert.ok(quoteIn('The project includes marine\n   loading of natural gasoline', 'the project includes marine loading'))
  assert.equal(htmlText('<p>A&nbsp;&amp;<script>x()</script> B</p>'), 'A & B')
  assert.equal(localAgencyOf('WAPSC0005303316002'), 'Puget Sound Clean Air Agency')
  assert.equal(localAgencyOf('AIR/WANCA0005307310007'), 'Northwest Clean Air Agency')
  assert.equal(localAgencyOf('WA0022900'), null)
  assert.deepEqual(AIR_SYSTEMS, ['PSCAA', 'ORCAA', 'SWCAA'])
})

test('the data file is valid; every entry is searched and every terminal is a WA terminal', () => {
  assert.deepEqual(validateAirData(data), [])
  assert.ok(data.entries.length >= 39)
  for (const e of data.entries) assert.ok(e.none || e.permits?.length || e.attach?.length, e.terminal)
  // The cache needs the listing pages, main documents and quoted documents; the SWCAA list is a posted search form.
  const need = urlsNeeded(data)
  assert.ok(need.some((x) => x.url === 'https://www.swcleanair.gov/permits/permitADPlist.asp' && x.form?.PlantID === '2672~EGT LLC'))
  assert.equal(formKey('u', { a: '1', b: 'x y' }), 'u POST a=1&b=x+y')
  assert.match(airCacheName('https://pscleanair.gov/DocumentCenter/View/6544'), /^air-[0-9a-f]{16}$/)
})

test('validateAirData: SYNTHETIC broken entries are reported', () => {
  const bad = { searches: data.searches, entries: [
    { terminal: 'wa-x', agency: 'pscaa', searched: ['nope'], none: 'x' },                       // unknown search
    { terminal: 'wa-y', agency: 'pscaa', searched: ['pscaa-title-v'] },                          // nothing found and no none text
    { terminal: 'wa-z', agency: 'pscaa', searched: ['pscaa-title-v'], permits: [{ number: '1', label: 'x', kind: 'x', holder: 'x', address: 'x', status: 'x', why: 'x', docs: [] }] },
    { terminal: 'wa-q', agency: 'nwcaa', searched: [], none: 'x' },                              // not an agency read here
  ] }
  const errs = validateAirData(bad)
  assert.ok(errs.some((e) => e.startsWith('entry wa-x:pscaa: searched')))
  assert.ok(errs.some((e) => e.startsWith('entry wa-y:pscaa: permits, attach or none')))
  assert.ok(errs.some((e) => e.includes('wa-z:pscaa 1: docs[0]')))
  assert.ok(errs.some((e) => e.startsWith('entry wa-q:nwcaa: terminal / agency')))
})

test('checkTexts: Order 11386A and draft 12449 (REAL text) carry their numbers, holder and the TOTE fueling words; a wrong quote is caught', () => {
  const docs = new Map([fx.order11386A, fx.draft12449, fx.worksheet11386].map((d) => [d.url, d]))
  const sub = { ...data, entries: [{ ...puget, permits: puget.permits.filter((p) => ['11386A', '12449'].includes(p.number)) }] }
  assert.deepEqual(checkTexts(sub, docs), [])
  const tote = { ...data, entries: [{ ...puget, permits: puget.permits.filter((p) => p.number === '11386') }] }
  // 11386's main document (the final order) is not in the fixture: reported, not assumed.
  assert.deepEqual(checkTexts(tote, docs), ['wa-puget-lng-tacoma 11386: main document not cached'])
  // SYNTHETIC: the same entry with a quote the order doesn't contain.
  const wrong = structuredClone(sub)
  wrong.entries[0].permits[0].covers[0].says = 'LNG bunkering at Pier 99'
  assert.deepEqual(checkTexts(wrong, docs), ['wa-puget-lng-tacoma 11386A: quote not found: "LNG bunkering at Pier 99"'])
  // SYNTHETIC: a holder the order doesn't name.
  const holder = structuredClone(sub)
  holder.entries[0].permits[0].holder = 'Somebody Else Inc.'
  assert.deepEqual(checkTexts(holder, docs), ['wa-puget-lng-tacoma 11386A: "Somebody Else Inc." not in the main document'])
})
