/**
 * BC permits pilot, offline tests (lib/ships/bcPermits.js). REAL rows recorded 2026-10-07 (fixtures/bc-permits-live-2026-10-07.json):
 * BC EMA register rows, two NRCED searches, four EAO EPIC searches. Cases built by hand are marked SYNTHETIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowsToObjects } from '../xlsx.js'
import {
  excelDate, emaFields, emaFieldsAll, emaPayload, emaCandidates, nrcedRecords, nrcedMatch, nrcedRow, nrcedAuthorization, eaoProjects, eaoClean, eaoRow,
  validateBcEntry, nrcedSearchUrl, eaoSearchUrl,
} from '../bcPermits.js'
import { loadFacilityData, validateFacilityData } from '../facilities.js'
import { nrcedResult, statusShort, statusTitle } from '../../../src/ships/permitStatus.js'
import { fixture } from './scenarios.js'

const fx = fixture('bc-permits-live-2026-10-07.json')
const objects = rowsToObjects([fx.ema.header, ...fx.ema.rows])
const byId = new Map(objects.map((o) => [o['Authorization Number'], o]))
const data = await loadFacilityData()
const westridge = data.facilities.find((f) => f.id === 'bc-westridge-marine-terminal')
const westshore = data.facilities.find((f) => f.id === 'bc-westshore-terminals')

test('the data file (WA + BC entries) validates; BC entries carry the BC rule, not the EPA one', () => {
  assert.deepEqual(validateFacilityData(data), [])
  assert.ok(westridge && westshore)
  assert.deepEqual(validateBcEntry({ ...westridge, point: { lat: 49 } }), ['bc-westridge-marine-terminal: point (lat, lon, from)'])
  const noWhy = { ...westridge, bc: { ...westridge.bc, ema: { ...westridge.bc.ema, accepted: [{ id: '3678' }] } } }   // SYNTHETIC: why removed
  assert.deepEqual(validateBcEntry(noWhy), ['bc-westridge-marine-terminal: ema 3678 needs id + why'])
})

test('all 33 BC terminals have an entry; one with no authorization says so in words', () => {
  const bc = data.facilities.filter((f) => f.country === 'CA')
  assert.equal(bc.length, 33)
  assert.equal(new Set(bc.flatMap((f) => f.terminals.map((t) => t.key))).size, 33)
  for (const f of bc) if (!f.bc.ema.accepted.length) assert.ok(f.bc.ema.none && f.bc.ema.none.length > 20, f.id)
  const silent = { ...westridge, bc: { ...westridge.bc, ema: { ...westridge.bc.ema, accepted: [] } } }   // SYNTHETIC: no ids, no note
  assert.deepEqual(validateBcEntry(silent), ['bc-westridge-marine-terminal: bc.ema.accepted (or bc.ema.none)'])
  assert.deepEqual(validateBcEntry({ ...silent, bc: { ...silent.bc, ema: { ...silent.bc.ema, none: 'No authorization found near the dock.' } } }), [])
})

test('one authorization on several register rows (Chemtrade 18: Air + Effluent) is read as one, all rows kept', () => {
  const rows18 = objects.filter((o) => o['Authorization Number'] === '18')
  assert.equal(rows18.length, 2)
  const e = emaFieldsAll(rows18)
  assert.equal(e.id, '18')
  assert.equal(e.waste, 'Air, Effluent')
  assert.equal(e.rowCount, 2)
  assert.deepEqual(emaPayload(rows18), { authorization: '18', rows: rows18 })
  assert.equal(emaPayload([byId.get('6819')]), byId.get('6819'))   // one row: the row itself, as in the pilot
  assert.equal(emaPayload(byId.get('6819')), byId.get('6819'))
})

test('excelDate: register serial days → ISO dates; blanks stay null', () => {
  assert.equal(excelDate('30495'), '1983-06-28')
  assert.equal(excelDate('43876'), '2020-02-15')
  assert.equal(excelDate(''), null)
  assert.equal(excelDate(' '), null)
})

test('emaFields: the register row read as listed; west longitude given without its sign is read as west', () => {
  const e = emaFields(byId.get('6819'))
  assert.equal(e.id, '6819')
  assert.equal(e.type, 'Permit')
  assert.equal(e.company, 'WESTSHORE TERMINALS LIMITED PARTNERSHIP')
  assert.equal(e.state, 'Active')
  assert.equal(e.waste, 'Effluent')
  assert.equal(e.issued, '1983-06-28')
  assert.equal(e.expires, null)
  assert.ok(Math.abs(e.lat - 49.0173) < 1e-9 && Math.abs(e.lon + 123.1637) < 1e-9)
  assert.equal(byId.get('6819').Longitude.startsWith('123.'), true)   // the stored cell keeps the register's own value
  const x = emaFields(byId.get('109085'))
  assert.equal(x.state, 'Expired')
  assert.equal(x.expires, '2020-02-15')
  assert.ok(!/_x000D_/.test(x.facilityType))
})

test('emaCandidates: rows near the berth or with the company name, nearest first; the data file reviews every one', () => {
  const c = emaCandidates(objects, westridge.bc.ema.berths, westridge.bc.ema.company_words, westridge.bc.ema.radius_m)
  const ids = c.map((x) => x.id)
  for (const id of ['3678', '14058', '109085', '6833']) assert.ok(c.find((x) => x.id === id)?.near, id)
  assert.equal(c.find((x) => x.id === '6945').near, false)               // Trans Mountain's Burnaby Terminal: name only, 3.4 km
  assert.equal(c.find((x) => x.id === '6945').company_word, 'Trans Mountain')
  assert.ok(!ids.includes('6819') && !ids.includes('14865'))              // Roberts Bank rows: neither near nor Trans Mountain
  assert.deepEqual(ids.slice(0, 1), ['3678'])
  const reviewed = new Set([...westridge.bc.ema.accepted, ...westridge.bc.ema.left_out].map((a) => a.id))
  for (const x of c) assert.ok(reviewed.has(x.id), `register row ${x.id} not reviewed in the data file`)
  const s = emaCandidates(objects, westshore.bc.ema.berths, westshore.bc.ema.company_words, westshore.bc.ema.radius_m)
  assert.deepEqual(s.map((x) => x.id), ['16534', '6819', '14865'])
  assert.equal(s.find((x) => x.id === '14865').company_word, null)        // GCT Deltaport: near only
})

test('NRCED: records without the search score; the rule accepts company + authorization or place, ignores other parties', () => {
  const wr = nrcedRecords(fx.nrced.Westridge.body)
  assert.equal(wr.total, 5)
  assert.ok(wr.records.every((r) => !('score' in r)))
  const emaW = westridge.bc.ema.accepted.map((a) => a.id)
  const m = wr.records.map((r) => [r._id, nrcedMatch(westridge, r, emaW)])
  assert.deepEqual(m.filter(([, x]) => x.status === 'accepted').map(([id]) => id).sort(),
    ['5ecea35b589694001a0880b5', '66196721f4605200229c4ec3', '67f6d8a89d970a0022705a0f'])
  assert.equal(m.filter(([, x]) => x.status === null).length, 2)          // Princeton "Westridge" subdivision; Westridge Road, Duncan
  const r2025 = wr.records.find((r) => r._id === '67f6d8a89d970a0022705a0f')
  assert.deepEqual(nrcedMatch(westridge, r2025, emaW).why, { company_word: 'Trans Mountain', authorization: '3678', place_word: 'Westridge' })
  const ws = nrcedRecords(fx.nrced['"Westshore Terminals"'].body)
  const emaS = westshore.bc.ema.accepted.map((a) => a.id)
  const dg = ws.records.find((r) => nrcedAuthorization(r) === 'DGIR231070')   // dangerous-goods inspection: no EMA number, place "1 Roberts Bank Rd"
  assert.deepEqual(nrcedMatch(westshore, dg, emaS), { status: 'accepted', why: { company_word: 'Westshore Terminals', authorization: null, place_word: 'Roberts Bank' } })
  assert.deepEqual(ws.records.map((r) => nrcedMatch(westshore, r, emaS).status), ['accepted', 'accepted', 'accepted', 'accepted'])
  // SYNTHETIC: the same record issued to the company but naming neither an authorization of the site nor the place → candidate.
  const moved = { ...r2025, location: 'Burnaby Terminal, 7815 Shellmont Street', description: 'Trigger or reason for inspection: Planned; Authorization Number: 6945' }
  assert.equal(nrcedMatch(westridge, moved, emaW).status, 'candidate')
})

test('nrcedRow: what the card shows, with the agency file links', () => {
  const r = nrcedRecords(fx.nrced.Westridge.body).records.find((x) => x._id === '67f6d8a89d970a0022705a0f')
  const row = nrcedRow(r)
  assert.equal(row.date, '2025-04-01')
  assert.equal(row.kind, 'Inspection')
  assert.equal(row.trigger, 'Planned')
  assert.equal(row.authorization, '3678')
  assert.equal(row.outcome, 'Out of Compliance - Warning Codes and Regs')
  assert.equal(row.issuedTo, 'TRANS MOUNTAIN PIPELINE ULC')
  assert.deepEqual(row.legislation, ['Environmental Management Act s. 109'])
  assert.deepEqual(row.documents, [{ title: '2025-03-31_IR239355_Warning_FINAL_.pdf',
    url: 'https://nrs.objectstore.gov.bc.ca/lteczn/69de16995789a70011fa9933/2025-03-31_IR239355_Warning_FINAL_.pdf' }])
})

test('EAO: staff contacts dropped before storing; the project row', () => {
  const ps = eaoProjects(fx.eao['Trans Mountain'].body)
  assert.equal(ps.length, 2)
  for (const p of ps) for (const k of Object.keys(p)) assert.ok(!/Email|Phone|^CELead$|^projectLead$|^responsibleEPD$/.test(k), k)
  assert.ok(!('addedBy' in ps[0].proponent))
  const tmx = eaoRow(ps.find((p) => p._id === '5885121eaaecd9001b82b274'))
  assert.equal(tmx.name, 'Trans Mountain Expansion (TMX)')
  assert.equal(tmx.proponent, 'Trans Mountain Pipeline ULC')
  assert.equal(tmx.decision, 'Certificate Issued')
  assert.equal(tmx.decisionDate, '2017-01-10')
  assert.equal(tmx.url, 'https://projects.eao.gov.bc.ca/p/5885121eaaecd9001b82b274/project-details')
  assert.ok(/Westridge Marine Terminal/.test(tmx.description))
  assert.deepEqual(eaoProjects(fx.eao.Westshore.body), [])
  assert.deepEqual(Object.keys(eaoClean({ name: 'x', projectLeadEmail: 'a', CELeadPhone: 'b', projectLead: 'c' })), ['name'])   // SYNTHETIC
  // Every accepted / candidate project named in the data file is in the recorded search results.
  const found = new Set(Object.values(fx.eao).flatMap((s) => eaoProjects(s.body)).map((p) => p._id))
  for (const f of [westridge, westshore]) for (const p of [...f.bc.eao.accepted, ...(f.bc.eao.candidates || [])]) assert.ok(found.has(p.id), p.id)
})

test('request URLs are the ones recorded', () => {
  assert.equal(nrcedSearchUrl('Westridge'), fx.nrced.Westridge.url)
  assert.equal(nrcedSearchUrl('"Westshore Terminals"'), fx.nrced['"Westshore Terminals"'].url)
  assert.equal(eaoSearchUrl('Trans Mountain'), fx.eao['Trans Mountain'].url)
})

test('plain words: register states and NRCED results; the source term stays on hover', () => {
  assert.equal(statusShort({ epa_system: 'BC-EMA', program_status: 'Active' }), 'In force')
  assert.equal(statusShort({ epa_system: 'BC-EMA', program_status: 'Cancelled' }), 'Cancelled')
  assert.equal(statusShort({ epa_system: 'BC-EMA', program_status: 'Expired' }), 'Expired')
  assert.match(statusTitle({ epa_system: 'BC-EMA', program_status: 'Active' }), /^The BC waste discharge authorizations register lists it as “Active”/)
  assert.match(statusTitle({ epa_system: 'ICIS-NPDES', program_status: 'Effective' }), /^EPA ECHO lists it as/)   // Washington unchanged
  assert.equal(nrcedResult('Compliant - Notice'), 'In compliance')
  assert.equal(nrcedResult('Out of Compliance - Advisory'), 'Out of compliance: advisory')
  assert.equal(nrcedResult('Out of Compliance - Warning 120(6)'), 'Out of compliance: warning')
  assert.equal(nrcedResult('Something else'), 'Something else')
})
