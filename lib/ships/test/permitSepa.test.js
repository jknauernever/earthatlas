/**
 * SEPA per permit, offline (lib/ships/permitSepa.js). REAL documents and SEPA Register records recorded 2026-10-06/07
 * (fixtures/permit-sepa-live-2026-10-07.json, verbatim slices) and the real data file. No network, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  recordIds, idPattern, sepaPassages, classifyStatement, quoteOf, approvalsListed, projectPhrase, matchPermitSepa, sepaDocsFor, sepaSummary,
  sepaApplies, documentSepaText,
} from '../permitSepa.js'
import { loadFacilityData } from '../facilities.js'
import { fixture } from './scenarios.js'

const fx = fixture('permit-sepa-live-2026-10-07.json')
const data = await loadFacilityData()
const bp = data.facilities.find((f) => f.id === 'wa-bp-cherry-point-refinery')
const mpc = data.facilities.find((f) => f.id === 'wa-marathon-anacortes-refinery')
const R = fx.sepaRecords
const fetched = (k) => ({ ...fx.documents[k], pages: fx.documents[k].pages })
const docOf = (k, role, title, source) => ({ doc: { url: fx.documents[k].url, title, source }, role,
  text: documentSepaText({ url: fx.documents[k].url, title, source }, fetched(k), { air: role === 'air_operating_permit' }), record_id: 9 })

test('recordIds: permit numbers, agreed orders, air approvals and file numbers, from where the record names them', () => {
  const ids = recordIds(R['202002476'])
  assert.ok(ids.some((x) => x.kind === 'permit' && x.id === 'WAD069548154' && x.where === 'description'))
  assert.ok(ids.some((x) => x.kind === 'order' && x.id === 'DE 16296'))
  assert.ok(recordIds(R['202102998']).some((x) => x.kind === 'approval' && x.id === 'OAC 660' && x.where === 'proposal name'))
  assert.ok(recordIds(R['202203824']).some((x) => x.kind === 'approval' && x.id === 'OAC 1064' && x.where === 'document name'))
  assert.ok(recordIds(R['202105781']).some((x) => x.kind === 'file' && x.id === 'SEP2021-00086'))
  assert.ok(idPattern({ id: 'DE 16299', kind: 'order' }).test('the draft Agreed Order (No. DE 16299)'))
  assert.ok(idPattern({ id: 'OAC 1064', kind: 'approval' }).test('OAC 1064b, Condition 30'))
  assert.ok(!idPattern({ id: 'OAC 106', kind: 'approval' }).test('OAC 1064b'))
})

test('sepaPassages: the fact sheet SEPA section verbatim with its page; table-of-contents lines skipped', () => {
  const ps = sepaPassages(fx.documents.bp_npdes_fact_sheet.pages)
  const sec = ps.filter((p) => p.section)
  assert.equal(sec.length, 1)
  assert.equal(sec[0].page, 18)
  assert.equal(sec[0].heading, 'E. State Environmental Policy Act (SEPA) compliance')
  assert.match(sec[0].text, /^State law exempts the issuance, reissuance or modification of any wastewater discharge permit/)
  assert.match(sec[0].text, /\(RCW 43\.21C\.0383\)\. The exemption applies only to existing discharges, not to new discharges\.$/)
  assert.equal(classifyStatement(sec[0].text), 'exempt')
  assert.ok(!ps.some((p) => p.page === 3), 'the table of contents line is not a passage')
  assert.ok(ps.some((p) => p.page === 92 && !p.section && /SEP2021-00086/.test(p.text)), 'a comment-response paragraph is kept as a plain passage')
})

test('quoteOf keeps whole sentences and does not split "43.21C.0383"', () => {
  const t = sepaPassages(fx.documents.bp_npdes_fact_sheet.pages).find((p) => p.section).text
  assert.equal(quoteOf(t, 600), t)
  assert.match(quoteOf(t, 300), /^State law exempts .*\(RCW 43\.21C\.0383\)\. …$/)
})

test('approvalsListed: the approvals an Air Operating Permit lists, first page each', () => {
  const a = approvalsListed(fx.documents.bp_aop.pages)
  assert.equal(a.find((x) => x.id === 'OAC 1064').page, 12)
  assert.equal(a.find((x) => x.id === 'OAC 660').page, 16)
})

test('projectPhrase: the project words of a permit name, or null for a company name', () => {
  assert.equal(projectPhrase('BP CHERRY POINT REFINERY/ ADVANCE MITIGATION PROJECT 5 (AMP5)', bp), 'ADVANCE MITIGATION PROJECT 5')
  assert.equal(projectPhrase('BP CHERRY POINT REFINERY MS-3/MS-4 MAIN SUBSTATION UPGRADE PROJECT', bp), 'MS 3 MS 4 MAIN SUBSTATION UPGRADE PROJECT')
  assert.equal(projectPhrase('BP WEST COAST PRODUCTS LLC', bp), null)
  assert.equal(projectPhrase('BP CHERRY POINT REFINERY BROWNS RD', bp), null)
  assert.equal(projectPhrase('TESORO REFINING & MARKETING LLC', mpc), null)
})

test('names_permit: an Ecology record that names the hazardous-waste permit number', () => {
  const m = matchPermitSepa({ permit: { epa_system: 'RCRAInfo', permit_key: 'WAD069548154', name: 'BP CHERRY POINT REFINERY' }, facility: bp,
    issuer: 'WA Department of Ecology', records: [{ rec: R['202002476'], accepted: true, record_id: 1 }, { rec: R['200907090'], accepted: true, record_id: 2 }], docs: [] })
  assert.deepEqual(m.reviews.map((r) => [r.sepa, r.methods]), [['202002476', ['names_permit']]])
  assert.match(m.reviews[0].evidence[0].quote, /Draft Corrective Action Permit WAD069548154/)
  assert.deepEqual(m.candidates.map((c) => c.sepa), ['200907090'], 'same lead agency, nothing explicit: a candidate')
})

test('doc_cites_review: the support document names DE 16299; the record carries it; same lead agency', () => {
  const doc = docOf('marathon_rcra_support', 'support_document', 'Hazardous wast corrective action permit: support document', 'wa-ecology-industrial')
  const m = matchPermitSepa({ permit: { epa_system: 'RCRAInfo', permit_key: 'WAD009275082', name: 'TESORO REFINING & MARKETING COMPANY LLC' }, facility: mpc,
    issuer: 'WA Department of Ecology', records: [{ rec: R['202101793'], accepted: true, record_id: 3 }], docs: [doc] })
  assert.deepEqual(m.reviews.map((r) => r.methods), [['doc_cites_review']])
  assert.equal(m.reviews[0].evidence[0].page, 12)
  assert.equal(sepaSummary(m).status, 'linked')
  assert.equal(m.statements[0].kind, 'determination')
  assert.equal(m.statements[0].page, 4)
})

test('doc_cites_review needs the permit issuer as lead: a county DNS named in an NPDES fact sheet comment is not linked', () => {
  const doc = docOf('bp_npdes_fact_sheet', 'fact_sheet', 'WA0022900 fact sheet', 'wa-ecology-paris')
  const m = matchPermitSepa({ permit: { epa_system: 'ICIS-NPDES', permit_key: 'WA0022900', name: 'BP CHERRY POINT REFINERY' }, facility: bp,
    issuer: 'WA Department of Ecology', records: [{ rec: R['202105781'], accepted: true, record_id: 4 }], docs: [doc] })
  assert.equal(m.reviews.length, 0)
  assert.deepEqual(m.statements.map((s) => [s.kind, s.page]), [['exempt', 18]])
  assert.equal(sepaSummary(m).status, 'exempt')
})

test('approval_in_permit + register_related: NWCAA reviews of approvals the BP Air Operating Permit lists', () => {
  const doc = docOf('bp_aop', 'air_operating_permit', 'Air Operating Permit (Title V) (AOP)', 'nwcaa-aop')
  const recs = ['202102998', '202203824', '202200368', '201004893'].map((n, i) => ({ rec: R[n], accepted: true, record_id: 10 + i }))
  const m = matchPermitSepa({ permit: { epa_system: 'ICIS-Air', permit_key: 'WANCA0005307310007', name: 'BP WEST COAST PRODUCTS LLC' }, facility: bp,
    issuer: 'Northwest Clean Air Agency', records: recs, docs: [doc] })
  const by = Object.fromEntries(m.reviews.map((r) => [r.sepa, r.methods.join('+')]))
  assert.equal(by['202102998'], 'approval_in_permit')
  assert.equal(by['202203824'], 'approval_in_permit')
  assert.equal(by['201004893'], 'register_related', 'the 2010 Clean Fuels MDNS: the Register relates it to an addendum linked by its approval')
  assert.equal(by['202200368'], 'approval_in_permit')
  assert.equal(m.statements.length, 0, 'an air permit has no fact-sheet statement')
})

test('same_project: a construction stormwater coverage and the county review of the same project (proposal names only)', () => {
  const permit = { epa_system: 'ICIS-NPDES', permit_key: 'WAR311344', name: 'BP CHERRY POINT REFINERY WEST AVENUE D LAYDOWN AREA' }
  const m = matchPermitSepa({ permit, facility: bp, issuer: 'WA Department of Ecology', docs: [],
    records: [{ rec: R['202201096'], accepted: true, record_id: 5 }, { rec: R['202203824'], accepted: true, record_id: 6 }] })
  assert.deepEqual(m.reviews.map((r) => [r.sepa, r.methods]), [['202201096', ['same_project']]])
  // A later addendum whose description names the Clean Fuels Project is not the Clean Fuels coverage's review; the 2010 MDNS (no proposal name) is.
  const cf = matchPermitSepa({ permit: { epa_system: 'ICIS-NPDES', permit_key: 'WAR124763', name: 'BP CHERRY POINT CLEAN FUELS PROJECT' }, facility: bp,
    issuer: 'WA Department of Ecology', docs: [], records: [{ rec: R['201004893'], accepted: true, record_id: 7 }, { rec: R['202203824'], accepted: true, record_id: 6 }] })
  assert.deepEqual(cf.reviews.map((r) => r.sepa), ['201004893'])
  // Not matched to the facility → no same-project link.
  const off = matchPermitSepa({ permit, facility: bp, issuer: null, docs: [], records: [{ rec: R['202201096'], accepted: false, record_id: 5 }] })
  assert.equal(off.reviews.length, 0)
  assert.equal(sepaSummary(off).status, 'none')
})

test('sepaDocsFor: newest final fact sheet; every support document as fallback; the AOP for air', () => {
  const docs = [
    { source: 'wa-ecology-paris', type: 'Permit Documents', title: 'WA0000728-Fact_Sheet_for_PNOP-20240614.pdf', permitVersion: '7' },
    { source: 'wa-ecology-paris', type: 'Permit Documents', title: 'Phillips_66_Tacoma_Terminal-WA0000728-Fact_Sheet_for_Issuance-Effective_20240901.pdf', permitVersion: '7' },
    { source: 'wa-ecology-paris', type: 'Permit Documents', title: 'Phillips_66_TT-WA0000728-FactSheetAddendum-MINOR_Mod-20260203.pdf', permitVersion: '7' },
    { source: 'wa-ecology-paris', type: 'Permit Documents', title: 'WA0000728Fact Sheet', permitVersion: '5' },
  ]
  const u = (d, i) => ({ url: `https://example.invalid/${i}`, ...d })
  const picked = sepaDocsFor({ epa_system: 'ICIS-NPDES' }, docs.map(u))
  assert.equal(picked.length, 1)
  assert.match(picked[0].doc.title, /Fact_Sheet_for_Issuance/)
  // Phillips 66 Ferndale WAD009250366: Ecology's page lists two support documents under the same title; both are read, in a fixed order.
  const two = sepaDocsFor({ epa_system: 'RCRAInfo' }, [
    { source: 'wa-ecology-industrial', title: 'Hazardous waste permit: support document', url: 'https://fortress.wa.gov/ecy/industrial/UIPermit/ViewDocument.aspx?DocumentId=549' },
    { source: 'wa-ecology-industrial', title: 'Hazardous waste permit: support document', url: 'https://fortress.wa.gov/ecy/industrial/UIPermit/ViewDocument.aspx?DocumentId=398' }])
  assert.deepEqual(two.map((x) => [x.role, x.doc.url.slice(-3)]), [['support_document', '398'], ['support_document', '549']])
  assert.equal(sepaDocsFor({ epa_system: 'ICIS-Air' }, [{ source: 'nwcaa-aop', type: 'SOB', url: 'a' }, { source: 'nwcaa-aop', type: 'AOP', title: 'AOP', url: 'b' }])[0].doc.type, 'AOP')
  assert.deepEqual(sepaDocsFor({ epa_system: 'ICIS-NPDES' }, []), [])
  assert.ok(!sepaApplies({ epa_system: 'RCRAInfo' }, []), 'a hazardous-waste handler id with no permit document is not a permit')
  assert.ok(!sepaApplies({ epa_system: 'GHGRP' }, []))
})
