/**
 * Vessel incidents (docs/SHIP_INCIDENT_SOURCES.md §13): mappers, time handling, name
 * extraction, the matching decision and the privacy filter. Offline; no network.
 * Fixtures are REAL recorded data (fixtures/README.md); cases built by hand are marked
 * SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cgmixUtc, decideRef, typesFromText, roleFromText, refIdentifiers } from '../incidents.js'
import { mapIir, mapPsixOpControl, mapPsixDeficiencies } from '../incidentsCgmix.js'
import { mapEcology, groupEcologyRows, vesselNameFromCaseName } from '../incidentsEcology.js'
import { mapNrc, mapIncidentNews, redactNrcCall, nrcVesselName, dayOf, dms, incidentNewsWanted } from '../incidentsNames.js'
import { publicIncidentPayload, INCIDENT_DETAIL_KEYS, WITHHELD_TEXT } from '../incidentsPublic.js'
import { fixture } from './scenarios.js'

const cg = fixture('cgmix-live-2026-09-26.json')
const iir = (id) => structuredClone(cg.iir.find((x) => x.activity_id === id))
const eco = fixture('ecology-live-2026-09-26.json')
const ecoEvent = (erts) => mapEcology({ erts_number: String(erts), retrieved_at: eco.retrieved_at, rows: groupEcologyRows(eco.rows).get(String(erts)) })
const names = fixture('names-live-2026-09-26.json')

test('CGMIX time: the -04:00 offset is ignored, the wall clock is UTC (verified quirk)', () => {
  assert.equal(cgmixUtc('2023-04-15T23:32:00-04:00'), '2023-04-15T23:32:00.000Z')
  assert.equal(cgmixUtc('2017-08-23T16:30:00-05:00'), '2017-08-23T16:30:00.000Z')
  assert.equal(cgmixUtc('April 7, 2023'), null)
  assert.equal(cgmixUtc(''), null)
})

test('IIR WALLA WALLA (7669720): grounding + loss of propulsion in Rich Passage, official number, significant casualty', () => {
  const m = mapIir(iir('7669720'))
  assert.deepEqual([m.source.id, m.entityKind, m.key], ['uscg-cgmix-iir', 'iir_activity', '7669720'])
  const e = m.event
  assert.deepEqual(e.event_types, ['grounding', 'loss_of_propulsion'])
  assert.deepEqual([e.occurred_from, e.period_kind, e.time_quality, e.time_raw], ['2023-04-15T23:32:00.000Z', 'observed', 'utc_mislabelled_offset', '2023-04-15T23:32:00-04:00'])
  assert.deepEqual([e.lat, e.lon], [47.5985, -122.54765])
  assert.deepEqual([e.severity_rank, e.severity_raw, e.evidence_class], [2, 'Significant Marine Casualty', 'official_investigation'])
  assert.equal(m.refs.length, 1)
  assert.deepEqual([m.refs[0].uscg_vessel_id, m.refs[0].official_number_raw, m.refs[0].official_number_scheme, m.refs[0].imo_raw, m.refs[0].role],
    ['47442', '546382', 'us_official_number', undefined, 'subject'])
  assert.equal(e.detail.narrative.display, false)
  assert.equal(e.detail.title_display, false)
})

test('IIR ALEUTIAN ISLE (7543400): sinking, "Actual Total Loss" → most serious rank', () => {
  const e = mapIir(iir('7543400')).event
  assert.deepEqual(e.event_types, ['flooding', 'sinking'])
  assert.equal(e.severity_rank, 3)
  assert.deepEqual(e.detail.vessel_damage_status, ['Actual Total Loss'])
  assert.equal(e.deaths, null)
})

test('IIR KODIAK ENTERPRISE (7665123): fire, Major Marine Casualty, two vessels with their own roles', () => {
  const m = mapIir(iir('7665123'))
  assert.deepEqual(m.event.event_types, ['fire'])
  assert.equal(m.event.severity_rank, 3)
  assert.deepEqual(m.refs.map((r) => [r.name_raw, r.role, r.uscg_vessel_id]),
    [['KODIAK ENTERPRISE', 'subject', '49041'], ['AMERICAN CONSTELLATION', 'other', '1377936']])
  // Fire at ~0300 local on 2023-04-08 (per the brief) = 10:00 UTC: confirms the time quirk.
  assert.equal(m.event.occurred_from, '2023-04-08T10:00:00.000Z')
})

test('IIR EURODAM injury (6520747): injury reported, count NOT given → counts stay null (no invented number)', () => {
  const e = mapIir(iir('6520747')).event
  assert.ok(e.event_kinds.includes('injury'))
  assert.deepEqual([e.injuries, e.deaths, e.detail.injury_reported], [null, null, true])
  assert.ok(e.narrative.length > 50, 'narrative kept as evidence')
})

test('IIR EURODAM discharge of oil (6250030): pollution + responsible role; IMO-shaped primary id kept as both, type unstated', () => {
  const m = mapIir(iir('6250030'))
  assert.ok(m.event.event_kinds.includes('pollution'))
  assert.equal(m.refs[0].role, 'responsible')
  assert.deepEqual([m.refs[0].imo_raw, m.refs[0].official_number_raw, m.refs[0].detail.primary_id_type], ['9378448', '9378448', 'unstated'])
})

test('PSIX operational control (EURODAM 8202052): COTP order, validity period, never called a detention', () => {
  const e = mapPsixOpControl(structuredClone(cg.psix_opcontrols[0])).event
  assert.deepEqual(e.event_types, ['cotp_order'])
  assert.deepEqual([e.occurred_from, e.occurred_to, e.period_kind], ['2025-08-02T08:21:00.000Z', '2025-08-02T12:49:00.000Z', 'validity'])
  assert.ok(!e.event_types.includes('detention'))
  assert.equal(e.detail.imo_reportable, false)
  assert.equal(mapPsixOpControl({ activity_id: '1', retrieved_at: '2026-09-26T00:00:00Z', xml: '<NewDataSet />' }), null)
})

test('PSIX deficiencies (EURODAM 8237466): one event, per-deficiency codes, descriptions only as (hidden) narrative', () => {
  const m = mapPsixDeficiencies(structuredClone(cg.psix_deficiencies[0]))
  assert.equal(m.event.detail.count, 5)
  assert.ok(m.event.detail.deficiencies.every((d) => !('description' in d)))
  assert.equal(m.event.detail.detention_action_code, false)
  assert.equal(m.event.occurred_from, '2025-09-22T15:47:37.000Z')
  assert.deepEqual([m.refs[0].uscg_vessel_id, m.refs[0].name_raw], ['865188', 'EURODAM'])
})

test('Ecology ALEUTIAN ISLE (ERTS 716940): two product rows → one event, 3,895 gal to water, day precision, name-only ref', () => {
  const m = ecoEvent(716940)
  const e = m.event
  assert.equal(e.quantity_to_water, 1428 + 2467)
  assert.deepEqual([e.occurred_from, e.occurred_to, e.time_quality], ['2022-08-13T00:00:00.000Z', '2022-08-14T00:00:00.000Z', 'date_only_local_zone_unstated'])
  assert.equal(e.severity_rank, 3)
  assert.deepEqual(m.refs.map((r) => [r.name_raw, r.detail.name_only]), [['Aleutian Isle', true]])
  assert.equal(ECO_COMMERCIAL(), false)
})
const ECO_COMMERCIAL = () => mapEcology({ erts_number: '716940', retrieved_at: eco.retrieved_at, rows: groupEcologyRows(eco.rows).get('716940') }).source.commercial_use

test('Ecology: recreational rows get no vessel name; an inland Puget Sound point is rejected', () => {
  const rec = ecoEvent(657839)
  assert.deepEqual(rec.refs, [])
  const inland = ecoEvent(747793)
  assert.deepEqual([inland.event.lat, inland.event.position_quality], [null, 'rejected_implausible_for_state_or_waterbody'])
  assert.equal(ecoEvent(661444).refs[0].name_raw, 'Blackfish')
})

test('vessel names from free text: only when marked as a vessel; recreational and unmarked → none', () => {
  const cases = {
    'FV KODIAK ENTERPRISE Vessel Fire - Tacoma, 4/8/2023': 'KODIAK ENTERPRISE',
    'Tug GLADYS M Diesel Spill to Duwamish, Seattle, 11/14/23': 'GLADYS M',
    'Fishing Vessel NEW ST. JOSEPH Sinking': 'NEW ST. JOSEPH',
    'F/V "OKIE" Diesel Spill Port of B-Ham 12.06.2020': 'OKIE',
    'North Star-Oil Spill': null,
    'Pleasure Craft Goldfinch Sinking and Diesel Spill': null,
    'Westport Marina Mystery Spill, January 7, 2019': null,
  }
  for (const [t, want] of Object.entries(cases)) assert.equal(vesselNameFromCaseName(t), want, t)
})

test('NRC: responsible-party columns dropped before storage, hash of the original row kept (SYNTHETIC row)', () => {
  const row = { SEQNOS: '1', DATE_TIME_RECEIVED: '1/1/2026 10:00', CALLTYPE: 'INC', RESPONSIBLE_COMPANY: 'TEST PERSON', RESPONSIBLE_CITY: 'X', RESPONSIBLE_ZIP: '0', SOURCE: 'WEB' }
  const { call, redaction } = redactNrcCall(row)
  assert.deepEqual(Object.keys(call).sort(), ['CALLTYPE', 'DATE_TIME_RECEIVED', 'SEQNOS', 'SOURCE'])
  assert.deepEqual(redaction.dropped_columns, ['RESPONSIBLE_COMPANY', 'RESPONSIBLE_CITY', 'RESPONSIBLE_ZIP'])
  assert.match(redaction.original_row_sha256, /^[0-9a-f]{64}$/)
})

test('NRC reports (CY26): initial reports, day precision, names only; the pleasure-craft BLACKFISH gets no name', () => {
  const byId = Object.fromEntries(names.nrc.map((p) => [p.seqnos, mapNrc(structuredClone(p))]))
  assert.deepEqual(byId['1472632'].refs, [], 'pleasure craft: no name')
  const cp = byId['1452347']
  assert.deepEqual([cp.event.evidence_class, cp.event.time_quality, cp.refs[0].name_raw], ['initial_report', 'date_only_local_zone_unstated', 'COASTAL PROGRESS'])
  assert.ok(cp.event.narrative && cp.event.detail.narrative.display === false)
  assert.equal(byId['1452528'].refs[0].name_raw, 'FORTRESS')
  assert.equal(nrcVesselName({ VESSEL_NAME: 'UNKNOWN', VESSEL_TYPE: 'FISHING' }), null)
  assert.deepEqual(dayOf('1/12/2026 2:14'), { from: '2026-01-12T00:00:00.000Z', to: '2026-01-13T00:00:00.000Z' })
  assert.equal(dms('46', '54', '20', 'N').toFixed(4), '46.9056')
  assert.equal(dms('124', '', '', 'W'), -124)
})

test('IncidentNews: title name only for marked commercial vessels; notification date; link to the incident page', () => {
  const byId = Object.fromEntries(names.incidentnews.map((p) => [p.row.id, mapIncidentNews(structuredClone(p))]))
  assert.equal(byId['11081'].refs[0].name_raw, 'MOLLUSK')
  assert.equal(byId['11195'].refs[0].name_raw, 'NEW ST. JOSEPH')
  assert.equal(byId['10785'].refs[0].name_raw, 'North American')
  assert.deepEqual(byId['11065'].refs, [], 'recreational vessel: no name')
  assert.equal(byId['11081'].event.report_url, 'https://incidentnews.noaa.gov/incident/11081')
  assert.equal(byId['11081'].event.time_quality, 'date_only_noaa_notified')
  assert.ok(names.incidentnews.every((p) => incidentNewsWanted(p.row)))
})

test('matching decision: one strong target accepts; two targets never do; a name-only source never accepts (SYNTHETIC)', () => {
  const s = (v, method) => ({ vesselId: v, method, evidence: {} })
  assert.deepEqual([decideRef({ strong: [s('A', 'USCG_VESSEL_ID'), s('A', 'IMO_EXACT')] }).action, decideRef({ strong: [s('A', 'USCG_VESSEL_ID')] }).vesselId], ['accept', 'A'])
  const two = decideRef({ strong: [s('A', 'USCG_VESSEL_ID'), s('B', 'IMO_EXACT')] })
  assert.deepEqual([two.action, two.reason, two.candidates.map((c) => c.vesselId).sort()], ['unresolved', 'identifiers_disagree', ['A', 'B']])
  const nameOnly = decideRef({ nameOnly: true, strong: [s('A', 'IMO_EXACT')], candidates: [s('A', 'NAME_DATE_PLACE')] })
  assert.equal(nameOnly.action, 'unresolved')
  assert.ok(nameOnly.candidates.every((c) => c.method === 'NAME_DATE_PLACE'))
  assert.equal(decideRef({ candidates: [s('A', 'MMSI_TEMPORAL')] }).action, 'unresolved')
  assert.equal(decideRef({ strong: [s('A', 'NAME_DATE_PLACE')] }).action, 'unresolved', 'a weak method passed as strong is ignored')
  assert.equal(decideRef({ acceptedVesselId: 'A', strong: [s('B', 'IMO_EXACT')] }).vesselId, 'A', 'accepted links are never moved')
})

test('vocabulary: types and roles from source wording', () => {
  assert.deepEqual(typesFromText('Pollution - Oil'), ['spill'])
  assert.deepEqual(typesFromText('LOP/Grounding'), ['grounding', 'loss_of_propulsion'])
  assert.equal(roleFromText('Moored/Anchored  in Vicinity of Primary Subject'), 'other')
  assert.equal(roleFromText('Acknowledged Pollution Source'), 'responsible')
  assert.deepEqual(refIdentifiers({ imo_raw: '9378448', mmsi_raw: '111111111', name_raw: 'Eurodam' }), {
    name: 'EURODAM', imo: '9378448', mmsi: null, callsign: null, official: null, uscgId: null })
})

test('privacy on read: narratives, deficiency descriptions and case names are withheld; detail keys whitelisted', () => {
  const brief = publicIncidentPayload('uscg-cgmix-iir', 'iir_activity', iir('6520747'))
  assert.ok(brief.responses.brief.includes(WITHHELD_TEXT))
  assert.ok(!/passenger \(US Citizen\)/.test(brief.responses.brief))
  const def = publicIncidentPayload('uscg-psix', 'psix_deficiencies', structuredClone(cg.psix_deficiencies[0]))
  assert.ok(!/PSCO observed/.test(def.xml))
  const ecoP = publicIncidentPayload('wa-ecology-spills', 'ecology_erts', { rows: eco.rows.slice(0, 2) })
  assert.ok(ecoP.rows.every((r) => r.CaseName === WITHHELD_TEXT))
  const nrcP = publicIncidentPayload('uscg-nrc', 'nrc_report', structuredClone(names.nrc[1]))
  assert.equal(nrcP.commons.DESCRIPTION_OF_INCIDENT, WITHHELD_TEXT)
  const psixVessel = { responses: { cases: '<x/>' } }
  assert.equal(publicIncidentPayload('uscg-psix', 'psix_vessel', psixVessel), psixVessel, 'other records pass through')
  for (const k of ['narrative', 'title', 'case_name', 'name_note']) assert.ok(!INCIDENT_DETAIL_KEYS.has(k), k)
})
