/**
 * MEP Alliance scrubber lists (lib/ships/mepAlliance.js, lib/ships/mepMatch.js, resolver v1.9 decideMep), pure logic, offline.
 * Page rows are REAL, copied verbatim from www.mepalliance.org pages retrieved 2026-09-30 (fixtures/mep-live-2026-09-30.json;
 * see fixtures/README.md "MEP Alliance"). Owner / customer strings quoted in tests are REAL cells from the same retrieval.
 * Cases built here are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseVoyagePage, parseFittedPage, checkVoyageHeader, checkFittedHeader, knownNames, nextPage, mepDate, shipName, shipKey,
  companyName, stripContacts, benefitOf, groupVoyages, groupFitted, voyageAssertions, fittedAssertions, publicRecordPayload,
  companyOverlap, isBigShip, VOYAGES_SOURCE, FITTED_SOURCE, PERMISSION, CONTACT_COLUMNS, EVIDENCE_CLASS,
} from '../mepAlliance.js'
import { decideMep } from '../resolve.js'
import { fixture } from './scenarios.js'

const fx = fixture('mep-live-2026-09-30.json')
const voyHtml = fx.voyages.header_html + fx.voyages.options_html.join('') + fx.voyages.items_html.join('')
const fitHtml = fx.fitted.header_html + fx.fitted.items_html.join('')
const voy = parseVoyagePage(voyHtml)
const fit = parseFittedPage(fitHtml).map((r) => ({ ...r, list: 'cruise-ships' }))
const known = knownNames(voyHtml)
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/

test('REAL rows parse with the page\'s own headers; a changed header is refused (SYNTHETIC header)', () => {
  checkVoyageHeader(voyHtml)
  checkFittedHeader(fitHtml)
  assert.throws(() => checkVoyageHeader('<div class="pollutents-table-title">Ship</div>'), /header changed/)
  assert.equal(voy.length, 5)
  assert.deepEqual(voy.map((r) => r.cells['Ship Name']), ['GOLDEN FELLOW', 'OCEANA', 'SHANDONG XIN DE', 'KONKAR ASTERI', 'UM JIANGSU (66K/2025)'])
  const gf = voy[0].cells
  assert.equal(gf['Owner of Polluting Ship'], 'GOLDEN OCEAN ULRIK ANDERSEN - CEO www.goldenocean.bm')
  assert.equal(gf['Owner’s Contact Details'], 'operations@goldenocean.com')
  assert.equal(gf['Customer Leasing Polluting Ship'], 'NORDEN JAN RINDBO - CEO www.norden.com')
  assert.equal(gf['Reported date'], 'December 2, 2025')
  assert.equal(gf['Cargo-Loading are-Destination'], '') // empty on every row of the list
  assert.equal(voy[2].cells['Customer’s Contact Details'], '')
  assert.deepEqual(fit.map((r) => [r.cells['Ship Name'], r.cells['IMO NUMBER'], r.cells.Controller, r.cells.Year]),
    [['Adventure of the Seas', '9167227', 'Royal Caribbean Int', '2001'], ['AIDAbella', '9362542', '', '2008'], ['Eurodam', '9378448', 'Holland America Line', '2008']])
})

test('pages: the next-page link is the one after the current page (the last page links only back) (SYNTHETIC links)', () => {
  assert.equal(nextPage('<a href="?9e6caa88_page=2">', 1), 2)
  assert.equal(nextPage('<a href="?9e6caa88_page=4">', 5), null)
  assert.equal(nextPage('<a href="?9e6caa88_page=3"><a href="?9e6caa88_page=5">', 4), 5)
})

test('dates, ship names and the size hint in brackets', () => {
  assert.equal(mepDate('December 2, 2025'), '2025-12-02')
  assert.equal(mepDate('March 31, 2025'), '2025-03-31')
  assert.equal(mepDate('Q4 2025'), null)
  assert.deepEqual(shipName('UM JIANGSU (66K/2025)'), { name: 'UM JIANGSU', note: '66K/2025' })
  assert.equal(shipKey('SELINA  H'), 'SELINAH')
  assert.equal(shipKey('STAR NICOLE (81K)'), 'STARNICOLE')
})

test('REAL cells: contacts never survive; the company is kept, a person\'s name is not', () => {
  assert.equal(companyName('GOLDEN OCEAN ULRIK ANDERSEN - CEO www.goldenocean.bm', known), 'GOLDEN OCEAN')
  assert.equal(companyName('NORDEN JAN RINDBO - CEO www.norden.com', known), 'NORDEN')
  assert.equal(companyName('UNION MARITIME, Lewis Cadji  Chairman', known), 'UNION MARITIME')
  assert.equal(companyName('ALLIANZ BULK MURALI KRISHNA - DIRECTOR www.allianzwithus.com', known), 'ALLIANZ BULK')
  assert.equal(companyName('SHANDONG YUHE SHIPPING CO LTD', known), 'SHANDONG YUHE SHIPPING CO LTD')
  assert.equal(companyName('KONKAR SHIPPING VALENTIOS VALENTIS - CEO www.konkar.gr', known), 'KONKAR SHIPPING')
  assert.equal(companyName('OLAM (CHARTS BENEFIT) SUNNY VERGHESE - CEO www.olamgroup.com', known), 'OLAM')
  assert.equal(companyName('C TRANSPORT MARITIME JOHN MICHAEL RADZIWILL - CHAIRMAN www.ctmmc.com', known), 'C TRANSPORT MARITIME')
  assert.equal(companyName('PANOCEAN (OWS BENEFIT) JOONG-HO AHN - CEO www.panocean.com', known), 'PANOCEAN')
  assert.equal(companyName('BUNGE GREGORY HECKMAN - CEO www.bunge.com', known), 'BUNGE') // from its own web address
  assert.equal(companyName('STAR BULK - PETROS PAPPAS - CEO www.starbulk.com', known), 'STAR BULK')
  assert.equal(companyName('RICHLAND BULK +86 010-87108138', known), 'RICHLAND BULK')
  assert.equal(companyName('EAST 33 Katerina Mylona, CEO', known), null) // can't tell where the company ends: withheld
  assert.equal(companyName('N/A', known), null)
  assert.equal(stripContacts('National Navigation Co (Cairo) https://www.nnc.com.eg'), 'National Navigation Co (Cairo)')
  assert.equal(stripContacts('Address:  Room 413, 4th Floor, Lucky Centre, 165-171, Wan Chai Road'), '')
  assert.equal(stripContacts('safetyandqualitydept@nnc.com.eg   +20 2 2456 0624'), '')
})

test('REAL cells: who the list says gets the scrubber\'s saving', () => {
  assert.equal(benefitOf('OLAM (CHARTS BENEFIT) SUNNY VERGHESE - CEO www.olamgroup.com'), 'charterer')
  assert.equal(benefitOf('SAFE BULKERS (OWS BENEFIT)  POLYS HAJIOANNOU - CEO   www.safebulkers.com'), 'owner')
  assert.equal(benefitOf('COSCO (SCRUBBER BENEFIT 50/50), Gu Jingsong - Chairman'), 'shared')
  assert.equal(benefitOf('NORDEN JAN RINDBO - CEO www.norden.com'), null)
})

test('claims: one per row, evidence class unverified (an advocacy list), no contact detail anywhere in a claim', () => {
  assert.equal(EVIDENCE_CLASS, 'unverified')
  const groups = groupVoyages(voy)
  assert.equal(groups.length, 5)
  assert.equal(groups.find((g) => g.name_norm === 'UMJIANGSU').key, 'NAME UMJIANGSU')
  const claims = groups.flatMap((g) => voyageAssertions(g, known))
  assert.equal(claims.length, 5)
  for (const a of claims) {
    assert.equal(a.attribute, 'scrubber'); assert.equal(a.evidence_class, 'unverified'); assert.equal(a.period_kind, 'unknown')
    assert.doesNotMatch(JSON.stringify(a), EMAIL)
    assert.doesNotMatch(JSON.stringify(a), /\+\d[\d ]{6,}/)
  }
  const gf = claims.find((a) => a.detail.ship_name === 'GOLDEN FELLOW').detail
  assert.deepEqual([gf.owner, gf.charterer, gf.reported], ['GOLDEN OCEAN', 'NORDEN', '2025-12-02'])
  assert.doesNotMatch(JSON.stringify(gf), /ULRIK|RINDBO/)
  const um = claims.find((a) => a.detail.ship_name === 'UM JIANGSU').detail
  assert.deepEqual([um.ship_note, um.owner, um.charterer], ['66K/2025', 'UNION MARITIME', 'ALLIANZ BULK'])
  const fg = groupFitted(fit)
  assert.deepEqual(fg.map((g) => g.key), ['IMO 9167227', 'IMO 9362542', 'IMO 9378448'])
  const fc = fg.flatMap(fittedAssertions)
  assert.deepEqual([fc[2].detail.controller, fc[2].detail.year_built, fc[2].detail.category, fc[2].detail.pending_possible], ['Holland America Line', 2008, 'Cruise Ships', true])
  assert.equal(fc[1].detail.controller, null)
})

test('the record as shown publicly: contact columns and row HTML withheld', () => {
  const p = publicRecordPayload({ name_norm: 'GOLDENFELLOW', rows: [voy[0]] })
  assert.doesNotMatch(JSON.stringify(p), EMAIL)
  assert.equal(p.rows[0].html, undefined)
  for (const k of CONTACT_COLUMNS) assert.match(p.rows[0].cells[k], /withheld/)
  assert.equal(p.rows[0].cells['Owner of Polluting Ship'], 'GOLDEN OCEAN ULRIK ANDERSEN - CEO') // web address stripped
})

test('sources: permission recorded verbatim, attribution "MEP Alliance", the site\'s own terms quoted', () => {
  for (const s of [VOYAGES_SOURCE, FITTED_SOURCE]) {
    assert.equal(s.license, 'Permission via Friends of the San Juans (MEP Alliance founding member), 2026-09-30')
    assert.equal(s.license, PERMISSION)
    assert.equal(s.attribution_text, 'MEP Alliance')
    assert.match(s.notes, /personal use only/)
    assert.equal(s.commercial_use, false)
  }
})

test('matching helpers: company words and big ships (SYNTHETIC vessel facts)', () => {
  assert.deepEqual(companyOverlap(['HOLLAND AMERICA LINE'], ['HOLLAND AMERICA LINE NV']), ['HOLLAND', 'AMERICA'])
  assert.deepEqual(companyOverlap(['STARBULK'], ['STAR BULK CARRIERS CORP']), ['STARBULK'])
  assert.deepEqual(companyOverlap(['GOLDEN OCEAN'], ['GOLDEN UNION SHIPPING']), []) // generic words never corroborate
  assert.equal(isBigShip({ lengths: ['285.3'], types: [] }), true)
  assert.equal(isBigShip({ lengths: ['24'], types: ['Cargo'] }), false) // a known length under 100 m is never big
  assert.equal(isBigShip({ lengths: [], types: ['Bulk Carrier'] }), true)
  assert.equal(isBigShip({ lengths: [], types: ['Pleasure craft'] }), false)
})

test('decideMep: IMO rows by registry IMO only (SYNTHETIC holders)', () => {
  const b = { acceptedVesselId: null, kind: 'mep_fitted_imo', imo: { imo: '9378448', valid: true }, aisHolders: 0 }
  assert.deepEqual([decideMep({ ...b, registryHolders: ['v1'] }).action, decideMep({ ...b, registryHolders: ['v1'] }).method], ['accept', 'IMO_EXACT'])
  assert.equal(decideMep({ ...b, registryHolders: ['v1', 'v2'] }).reason, 'imo_on_several_vessels')
  assert.equal(decideMep({ ...b, registryHolders: [], aisHolders: 1 }).reason, 'imo_only_ais_reported')
  assert.equal(decideMep({ ...b, registryHolders: [] }).reason, 'no_vessel_with_imo')
  assert.equal(decideMep({ ...b, acceptedVesselId: 'v9', registryHolders: ['v1'] }).action, 'keep') // never moved
})

test('decideMep: name rows — corroborated, Salish+size inferred, otherwise candidates or nothing (SYNTHETIC matches)', () => {
  const b = { acceptedVesselId: null, kind: 'mep_voyage_ship', nameNorm: 'GOLDENFELLOW' }
  const m = (o) => ({ vesselId: 'v1', salish: false, big: false, companyShared: [], yearMatch: false, imoListMatch: false, imoListConflict: false, ...o })
  // unique name + a second fact → corroborated, not inferred
  let d = decideMep({ ...b, nameMatches: [m({ companyShared: ['GOLDEN'] })] })
  assert.deepEqual([d.action, d.method, d.inferred], ['accept', 'MEP_NAME_CORROBORATED', false])
  // unique big Salish ship, nothing else agrees → accepted, INFERRED (Josh 2026-09-30)
  d = decideMep({ ...b, nameMatches: [m({ salish: true, big: true }), m({ vesselId: 'v2' })] })
  assert.deepEqual([d.action, d.method, d.inferred, d.vesselId], ['accept', 'MEP_NAME_SALISH_SIZE', true, 'v1'])
  // name-only, not in the Salish Sea → candidate only
  d = decideMep({ ...b, nameMatches: [m({ big: true })] })
  assert.deepEqual([d.action, d.candidates.map((c) => c.method)], ['unresolved', ['MEP_NAME_ONLY']])
  // two big Salish ships share the name → never pick one
  d = decideMep({ ...b, nameMatches: [m({ salish: true, big: true }), m({ vesselId: 'v2', salish: true, big: true })] })
  assert.deepEqual([d.action, d.reason, d.candidates.length], ['unresolved', 'name_on_several_big_salish_ships', 2])
  // only small craft in the Salish Sea → not accepted
  d = decideMep({ ...b, nameMatches: [m({ salish: true, big: false })] })
  assert.deepEqual([d.action, d.reason], ['unresolved', 'name_only_on_small_salish_craft'])
  // the vessel-type list gives this name with ANOTHER ship's IMO → this vessel is never accepted
  d = decideMep({ ...b, nameMatches: [m({ salish: true, big: true, imoListConflict: true })] })
  assert.equal(d.action, 'unresolved')
  // the vessel-type list's IMO for this name IS this vessel's → corroborated
  d = decideMep({ ...b, nameMatches: [m({ imoListMatch: true })] })
  assert.deepEqual([d.method, d.evidence.corroborated_by], ['MEP_NAME_CORROBORATED', ['imo_list']])
  assert.equal(decideMep({ ...b, nameMatches: [] }).reason, 'no_name_match')
})
