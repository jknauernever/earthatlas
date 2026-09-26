/**
 * Official registries (USCG PSIX, FCC ULS, Transport Canada): mapping, privacy,
 * resolver decisions and type crosswalks. Offline; no network.
 * Fixtures are REAL recorded data (fixtures/README.md); cases built by hand are
 * marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDate, partyPrivacy, flagIso3, plainNumber } from '../registry.js'
import { buildLicenseRecord, mapLicense, fccStamp, shipNumberScheme, publicLicenseRecord, groupByUsi, splitLine } from '../fccUls.js'
import { parseDataset, mapPsix } from '../psix.js'
import { mapTc, tcYear, apiFields, officialNumber } from '../tcRegistry.js'
import { sharedStrings, sheetRows, rowsToObjects, colIndex } from '../xlsx.js'
import { decideRegistry, lengthsAgree } from '../resolve.js'
import { fromPsixService, fromFccClass, fromTcDescriptor, crosswalkClaim, combine, classifyClaims } from '../taxonomy.js'
import { fixture } from './scenarios.js'

const fcc = fixture('fcc-live-uls-2026-09-20.json')
const lic = (usi) => structuredClone(fcc.records.find((r) => r.usi === usi))
const psix = fixture('psix-live-2026-09-25.json')
const pv = (id) => structuredClone(psix.vessels.find((v) => v.vessel_id === id))
const tc = fixture('tc-live-2026-09-25.json')
const tcr = (on) => structuredClone(tc.records.find((r) => r.official_number === on))
const by = (as, attr) => as.filter((a) => a.attribute === attr)

// ── shared helpers ────────────────────────────────────────────────────────────

test('registry dates: three formats, day precision, invalid dates rejected', () => {
  assert.deepEqual(parseDate('03/26/2034'), { from: '2034-03-26T00:00:00.000Z', until: '2034-03-27T00:00:00.000Z', text: '2034-03-26' })
  assert.equal(parseDate('March 31,2027').text, '2027-03-31')
  assert.equal(parseDate('2019-04-15').until, '2019-04-16T00:00:00.000Z')
  assert.equal(parseDate('02/30/2020'), null)
  assert.equal(parseDate(''), null)
  assert.equal(fccStamp('Sun Sep 20 10:49:57 EDT 2026'), '2026-09-20T14:49:57.000Z')
  assert.equal(fccStamp('Sun Sep 20 10:49:57 PDT 2026'), null)
  assert.equal(plainNumber('152527.0'), '152527')
  assert.equal(flagIso3('Netherlands'), 'NLD')
  assert.equal(flagIso3('Atlantis'), null)
})

test('privacy rule: individuals never stored; organisations shown only on commercial licences', () => {
  assert.deepEqual(partyPrivacy({ applicantType: 'I', recreational: false }), { storeName: false, display: false, reason: 'private_individual', kind: 'individual' })
  assert.equal(partyPrivacy({ applicantType: 'T' }).storeName, false) // trusts often carry people's names
  assert.equal(partyPrivacy({ applicantType: 'P' }).storeName, false)
  assert.equal(partyPrivacy({ applicantType: '' }).storeName, false)
  assert.deepEqual(partyPrivacy({ applicantType: 'L', recreational: true }), { storeName: true, display: false, reason: 'organisation_on_recreational_licence', kind: 'organisation' })
  assert.equal(partyPrivacy({ applicantType: 'C', recreational: false }).display, true)
})

// ── FCC ULS ──────────────────────────────────────────────────────────────────

test('FCC BLACKFISH VI licence: MMSI, call sign, name, official number with the licence term as validity', () => {
  const { assertions, warnings } = mapLicense(lic('4921984'))
  assert.deepEqual(warnings, [])
  const one = (attr) => by(assertions, attr)[0]
  assert.equal(one('mmsi').value_norm, '368616000')
  assert.equal(one('callsign').value_norm, 'WDP4981')
  assert.equal(one('name').value_norm, 'BLACKFISHVI')
  assert.deepEqual([one('official_number').value_norm, one('official_number').detail.scheme], ['1344473', 'us_official_number'])
  assert.deepEqual([one('mmsi').period_kind, one('mmsi').period_from, one('mmsi').period_to],
    ['validity', '2024-03-26T00:00:00.000Z', '2034-03-27T00:00:00.000Z'])
  assert.ok(assertions.every((a) => a.evidence_class === 'registry'))
  assert.equal(one('vessel_type').value_norm, 'FCC_PL_PA')
  const s = one('registration_status')
  assert.deepEqual([s.value_norm, s.period_kind, s.period_from], ['FCC_A', 'observed', '2026-09-20T14:49:57.000Z'])
  // An organisation on a compulsory (commercial) licence: stored and displayable.
  const l = one('radio_licensee')
  assert.equal(l.detail.display, true)
  assert.notEqual(l.value_norm, 'WITHHELD')
  assert.match(l.detail.role_note, /does not state that it owns/)
})

test('FCC reused MMSI: the same MMSI on three licences in three separate terms (1997, 2010, 2024)', () => {
  const terms = ['1545921', '3202504', '4921984'].map((u) => by(mapLicense(lic(u)).assertions, 'mmsi')[0])
  assert.ok(terms.every((t) => t.value_norm === '368616000'))
  assert.deepEqual(terms.map((t) => t.period_from.slice(0, 4)), ['1997', '2010', '2024'])
  for (let i = 1; i < terms.length; i++) assert.ok(terms[i - 1].period_to <= terms[i].period_from)
})

test('FCC LINNEA ROSE: private individual → name never stored; state registration number kept as an AIS call-sign alias', () => {
  const rec = lic('4805138')
  const en = rec.lines.find((l) => l.file === 'EN')
  assert.ok(en.withheld.includes('entity_name') && en.withheld.includes('last') && en.withheld.includes('frn'))
  assert.match(en.original_sha256, /^[0-9a-f]{64}$/)
  const f = splitLine(en.text)
  for (const i of [7, 8, 10, 22]) assert.ok(f[i] === '' || f[i] === '[withheld]', `field ${i} withheld`)
  const { assertions } = mapLicense(rec)
  const l = by(assertions, 'radio_licensee')[0]
  assert.deepEqual([l.value_norm, l.detail.display, l.detail.display_reason], ['WITHHELD', false, 'private_individual'])
  const on = by(assertions, 'official_number')[0]
  assert.deepEqual([on.detail.scheme, on.detail.ais_callsign_alias], ['us_state_registration', 'WN0431D'])
})

test('FCC redaction (SYNTHETIC rows): HD certifier + EN contact always withheld; individual names withheld; publicLicenseRecord hides recreational-org names', () => {
  const hd = 'HD|9|F1||WTEST1|A|SA|01/01/2020|01/01/2030||||||||||||||||||||||Jane|Q|Doe||Owner|F||||||||01/01/2020|||||||||||||||'
  const enOrg = 'EN|9|||WTEST1|L|L000|Test Boats LLC|||||5551234567||a@b.c|1 Main St|Anytown|WA|98000||Attn X||0001|L||||||'
  const rec = buildLicenseRecord('9', { HD: [hd], EN: [enOrg], SH: ['SH|9|||WTEST1|R||PL|YAT|Test Boat|WA1234AB|N|N|||||||||367000999|||||'] }, { created_utc: '2026-09-20T14:49:57.000Z' })
  const HD = splitLine(rec.lines.find((l) => l.file === 'HD').text)
  assert.deepEqual([HD[30], HD[32], HD[34], HD[35]], ['[withheld]', '[withheld]', '[withheld]', '[withheld]'])
  const EN = splitLine(rec.lines.find((l) => l.file === 'EN').text)
  assert.equal(EN[7], 'Test Boats LLC') // organisation name stored…
  assert.deepEqual([EN[12], EN[14], EN[15]], ['[withheld]', '[withheld]', '[withheld]'])
  const l = by(mapLicense(rec).assertions, 'radio_licensee')[0]
  assert.deepEqual([l.value_raw, l.detail.display, l.detail.display_reason], ['Test Boats LLC', false, 'organisation_on_recreational_licence'])
  // …but not on the raw-record output of a recreational licence.
  assert.equal(splitLine(publicLicenseRecord(rec).lines.find((l) => l.file === 'EN').text)[7], '[withheld]')
})

test('FCC ship number schemes', () => {
  assert.deepEqual(shipNumberScheme('1344473'), { scheme: 'us_official_number', value: '1344473' })
  assert.equal(shipNumberScheme('WN0431DM').ais_callsign_alias, 'WN0431D')
  assert.equal(shipNumberScheme('CF 1234 AB').scheme, 'us_state_registration')
  assert.equal(shipNumberScheme('ABC-1').scheme, 'as_filed')
})

test('FCC .dat grouping by unique system identifier', () => {
  const g = groupByUsi('SH|1|a\r\nSH|2|b\nSH|1|c\n', new Set(['1']))
  assert.deepEqual([...g.entries()], [['1', ['SH|1|a', 'SH|1|c']]])
})

// ── USCG PSIX ────────────────────────────────────────────────────────────────

test('PSIX BLACKFISH VI: snapshot identity, US official number, service type, certificates with validity, inspections observed', () => {
  const { assertions, warnings } = mapPsix(pv('1763413'))
  assert.deepEqual(warnings, [])
  const one = (attr) => by(assertions, attr)[0]
  assert.deepEqual([one('callsign').value_norm, one('name').value_norm], ['WDP4981', 'BLACKFISHVI'])
  assert.equal(one('name').period_kind, 'observed')
  assert.equal(one('name').period_from, one('name').period_to)
  assert.deepEqual([one('official_number').value_norm, one('official_number').detail.scheme], ['1344473', 'us_official_number'])
  assert.equal(one('year_built').value_norm, '2024')
  assert.equal(one('flag').value_norm, 'USA')
  assert.equal(one('vessel_type').value_norm, 'PSIX_PASSENGERINSPECTED')
  assert.equal(one('length_m').value_norm, '16.46') // 54 ft
  assert.deepEqual(by(assertions, 'tonnage_gt').map((a) => a.value_norm), ['44'])
  const cod = by(assertions, 'certificate').find((a) => a.detail.document === 'CERTIFICATE OF DOCUMENTATION')
  assert.deepEqual([cod.period_kind, cod.period_from, cod.period_to], ['validity', '2026-03-02T08:05:20.307Z', '2027-04-01T00:00:00.000Z'])
  const act = by(assertions, 'uscg_activity')
  assert.ok(act.length >= 1 && act.every((a) => a.period_kind === 'observed' && a.period_from === a.period_to))
  assert.equal(by(assertions, 'mmsi').length, 0) // PSIX has no MMSI
})

test('PSIX EURODAM: foreign ship identified by IMO; gross/net from the Long/Short Ton rows; draft; LBP not a length', () => {
  const { assertions, warnings } = mapPsix(pv('865188'))
  const imo = by(assertions, 'imo')[0]
  assert.deepEqual([imo.value_norm, imo.detail.checksum_ok], ['9378448', true])
  assert.equal(by(assertions, 'official_number').length, 0)
  assert.equal(by(assertions, 'flag')[0].value_norm, 'NLD')
  assert.deepEqual(by(assertions, 'tonnage_gt').map((a) => a.value_norm), ['86273'])
  assert.deepEqual(by(assertions, 'net_tonnage').map((a) => a.value_norm), ['53711'])
  assert.deepEqual(by(assertions, 'draft_m').map((a) => a.value_norm), ['10.82'])
  assert.ok(!by(assertions, 'length_m').some((a) => a.value_norm === '253.99'))
  assert.ok(warnings.some((w) => /Perpendiculars/.test(w)))
})

test('PSIX dataset parser: rows, entities, empty set', () => {
  assert.deepEqual(parseDataset('<NewDataSet><T><A>x &amp; y</A><B /></T><T><A>2</A></T></NewDataSet>'), [{ _tag: 'T', A: 'x & y' }, { _tag: 'T', A: '2' }])
  assert.deepEqual(parseDataset('<NewDataSet />'), [])
})

// ── Transport Canada ─────────────────────────────────────────────────────────

test('TC SEASPAN RAPTOR: export row + API → particulars, builder, certificate validity, flag from REGISTERED', () => {
  const { assertions, warnings } = mapTc(tcr('844174'))
  assert.deepEqual(warnings, [])
  const one = (attr) => by(assertions, attr)[0]
  assert.deepEqual([one('official_number').value_norm, one('official_number').detail.scheme], ['844174', 'ca_official_number'])
  assert.equal(one('imo').value_norm, '9766994')
  assert.equal(one('year_built').value_norm, '2015')
  assert.equal(one('vessel_type').value_norm, 'TC_TUG')
  assert.deepEqual([one('tonnage_gt').value_norm, one('net_tonnage').value_norm], ['312', '94'])
  assert.deepEqual([one('length_m').value_norm, one('depth_m').value_norm], ['23.07', '4.38'])
  assert.equal(one('hull_material').value_norm, 'STEEL')
  assert.match(one('builder').value_raw, /SANMAR/)
  assert.equal(one('flag').value_norm, 'CAN')
  const cert = one('certificate')
  assert.deepEqual([cert.period_kind, cert.period_from.slice(0, 10), cert.period_to.slice(0, 10)], ['validity', '2021-01-08', '2027-01-01'])
  assert.equal(by(assertions, 'mmsi').length + by(assertions, 'callsign').length, 0)
})

test('TC year-of-build format YYYYMM; odd values not interpreted', () => {
  assert.deepEqual(tcYear('201904'), { year: '2019', month: 4 })
  assert.deepEqual(tcYear('192400'), { year: '1924', month: null })
  assert.deepEqual(tcYear('1993'), { year: '1993', month: null })
  assert.equal(tcYear('0'), null)
  assert.equal(tcYear('19931'), null)
  assert.equal(officialNumber('816503.0'), '816503')
  assert.equal(apiFields({ ResultSet: [[{ Name: 'Status', Value: { Literal: 'REGISTERED' } }]] }).Status, 'REGISTERED')
})

test('XLSX reader (SYNTHETIC sheet): shared strings, inline strings, numbers as stored, gaps', () => {
  const ss = sharedStrings('<sst><si><t>Name</t></si><si><r><t>A</t></r><r><t>B &amp; C</t></r></si></sst>')
  assert.deepEqual(ss, ['Name', 'AB & C'])
  const rows = sheetRows('<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>X</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>152527.0</v></c></row></sheetData>', ss)
  assert.deepEqual(rows, [['Name', '', 'X'], ['AB & C', '', '152527.0']])
  assert.deepEqual(rowsToObjects(rows), [{ Name: 'AB & C', '': '', X: '152527.0' }])
  assert.equal(colIndex('AA'), 26)
})

// ── Resolver decisions (pure) ────────────────────────────────────────────────

const V1 = 'v-1', V2 = 'v-2'
const base = { acceptedVesselId: null, imos: [], holders: {}, idMatches: [], candidates: [] }

test('registry resolver: an accepted link is kept; new evidence only adds candidates', () => {
  const d = decideRegistry({ ...base, acceptedVesselId: V1, idMatches: [{ vesselId: V2, method: 'REG_CALLSIGN_NAME', evidence: {} }] })
  assert.deepEqual([d.action, d.vesselId, d.needsReview, d.candidates.length], ['keep', V1, true, 1])
})

test('registry resolver: IMO rule = the Wikidata attach rule (registry IMO, or AIS IMO + second identifier)', () => {
  assert.deepEqual(decideRegistry({ ...base, imos: ['9378448'], holders: { 9378448: [{ vesselId: V1, registry: true, corroboratedBy: [] }] } }).method, 'IMO_EXACT')
  assert.equal(decideRegistry({ ...base, imos: ['9766994'], holders: { 9766994: [{ vesselId: V1, registry: false, corroboratedBy: ['name'] }] } }).method, 'IMO_AIS_NAME')
  const u = decideRegistry({ ...base, imos: ['9030682'], holders: { 9030682: [{ vesselId: V1, registry: false, corroboratedBy: [] }] } })
  assert.deepEqual([u.action, u.candidates[0].method], ['unresolved', 'IMO_EXACT'])
  assert.equal(decideRegistry({ ...base, imos: ['1', '2'] }).reason, 'conflicting_imos')
  assert.equal(decideRegistry({ ...base, imos: ['9'], holders: { 9: [{ vesselId: V1, registry: true, corroboratedBy: [] }, { vesselId: V2, registry: true, corroboratedBy: [] }] } }).reason, 'imo_on_several_vessels')
})

test('registry resolver: identifier matches accept one vessel; two vessels or IMO vs identifiers disagreeing → unresolved', () => {
  const m = (vesselId, method) => ({ vesselId, method, evidence: {} })
  assert.deepEqual(Object.values((({ action, vesselId, method }) => ({ action, vesselId, method }))(decideRegistry({ ...base, idMatches: [m(V1, 'REG_MMSI_CALLSIGN_NAME')] }))),
    ['accept', V1, 'REG_MMSI_CALLSIGN_NAME'])
  assert.equal(decideRegistry({ ...base, idMatches: [m(V1, 'REG_CALLSIGN_NAME'), m(V2, 'REG_CALLSIGN_NAME')] }).reason, 'identifiers_match_several_vessels')
  assert.equal(decideRegistry({ ...base, imos: ['9'], holders: { 9: [{ vesselId: V1, registry: true, corroboratedBy: [] }] },
    idMatches: [m(V2, 'REG_CALLSIGN_NAME')] }).reason, 'imo_and_identifiers_disagree')
  // Candidates alone (name + dimensions, MMSI with a different name) never accept.
  const c = decideRegistry({ ...base, candidates: [{ vesselId: V1, method: 'NAME_DIMENSION_MATCH', evidence: {} }] })
  assert.deepEqual([c.action, c.reason, c.needsReview], ['unresolved', 'no_match', true])
  assert.equal(decideRegistry(base).action, 'unresolved') // never 'new'
})

test('length agreement for candidates: within 1 m or 10 %', () => {
  assert.ok(lengthsAgree(16.46, 17))
  assert.ok(lengthsAgree(159.3, 167)) // SPIRIT OF VANCOUVER ISLAND: registry 159.3 m, AIS 167 m
  assert.ok(!lengthsAgree(10, 12))
  assert.ok(!lengthsAgree(0, 5))
})

// ── Type crosswalks ──────────────────────────────────────────────────────────

test('PSIX / FCC / TC crosswalks', () => {
  assert.deepEqual(fromPsixService('PSIX_PASSENGERINSPECTED'), { group: 'passenger', class: null })
  assert.equal(fromPsixService('PSIX_TOWINGVESSEL').group, 'tug_tow')
  assert.equal(fromPsixService('PSIX_NOSUCH').group, 'unknown')
  assert.deepEqual(fromFccClass('FCC_PL_YAT'), { group: 'recreational', class: 'yacht', lowRank: true })
  assert.equal(fromFccClass('FCC_PL_MTB'), null) // motorboat: hull/propulsion, not a job
  assert.equal(fromFccClass('FCC_FV_-').group, 'fishing')
  assert.equal(fromTcDescriptor('TC_TUG').class, 'tug')
  assert.equal(fromTcDescriptor('TC_NONCOMMERCIAL'), null)
})

test('LINNEA ROSE: AIS 37 pleasure craft + FCC "PL / PA passenger ship" → pleasure craft, FCC only dissents (low rank)', () => {
  const c = classifyClaims([
    { attribute: 'vessel_type', source_id: 'marinecadastre-ais', evidence_class: 'ais_published', value_norm: 'AIS_37', detail: { code: 37 }, period_kind: 'observed' },
    { attribute: 'vessel_type', source_id: 'fcc-uls-ship', evidence_class: 'registry', value_norm: 'FCC_PL_PA', period_kind: 'validity', from: '2023-08-19', to: '2033-08-20' },
  ], { from: '2026-06-21', to: '2026-06-21' })
  assert.deepEqual([c.group, c.class, c.conflict], ['recreational', 'recreational_unspecified', false])
  assert.deepEqual(c.dissent.map((d) => [d.group, d.source]), [['passenger', 'fcc-uls-ship']])
})

test('BLACKFISH VI: AIS 60 + PSIX Passenger (Inspected) + FCC PA agree → passenger', () => {
  const c = combine([
    crosswalkClaim({ source_id: 'marinecadastre-ais', evidence_class: 'ais_published', value_norm: 'AIS_60', detail: { code: 60 } }),
    crosswalkClaim({ source_id: 'uscg-psix', evidence_class: 'registry', value_norm: 'PSIX_PASSENGERINSPECTED' }),
    crosswalkClaim({ source_id: 'fcc-uls-ship', evidence_class: 'registry', value_norm: 'FCC_PL_PA' }),
  ])
  assert.deepEqual([c.group, c.class, c.conflict, c.dissent.length], ['passenger', 'passenger_unspecified', false, 0])
})

test('an FCC class alone decides when nothing else votes (SYNTHETIC)', () => {
  const c = combine([crosswalkClaim({ source_id: 'fcc-uls-ship', evidence_class: 'registry', value_norm: 'FCC_MM_TUG' })])
  assert.deepEqual([c.group, c.class, c.basis], ['tug_tow', 'tug', 'model_only'])
})

test('FCC placeholder cancellation date before the grant is ignored (SYNTHETIC rows)', () => {
  const hd = 'HD|8|||WTEST2|E|SB|09/08/2004|09/08/2014|01/01/1900|||||||||||||||||||||||||||||||||||||||||||||||'
  const { assertions, warnings } = mapLicense(buildLicenseRecord('8', { HD: [hd], SH: ['SH|8|||WTEST2|R||MM|TUG|TEST TUG|1234567|N|N|||||||||367000998|||||'] }, { created_utc: '2026-09-20T14:49:57.000Z' }))
  const m = by(assertions, 'mmsi')[0]
  assert.deepEqual([m.period_from.slice(0, 10), m.period_to.slice(0, 10)], ['2004-09-08', '2014-09-09'])
  assert.ok(warnings.some((w) => /precedes the grant/.test(w)))
})
