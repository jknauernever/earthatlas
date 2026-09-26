/**
 * Database tests for vessel incidents (docs/SHIP_INCIDENT_SOURCES.md §13).
 * DEV database in SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>) dropped afterwards;
 * never "ships", never production. Skipped (NOT RUN) without the URL.
 * Fixtures: real recorded data (fixtures/README.md), except cases marked SYNTHETIC.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensureMcSource, ingestMcMmsi } from '../ingestMc.js'
import { ensureRegistrySources, ingestRegistryRecord } from '../ingestRegistry.js'
import { aggregateRows } from '../marinecadastre.js'
import { ensureIncidentSources, ingestIncident } from '../incidents.js'
import { IIR_SOURCE, PSIX_SOURCE, mapIir, mapPsixOpControl, mapPsixDeficiencies } from '../incidentsCgmix.js'
import { ECOLOGY_SOURCE, mapEcology, groupEcologyRows } from '../incidentsEcology.js'
import { NRC_SOURCE, INCIDENTNEWS_SOURCE, mapNrc } from '../incidentsNames.js'
import { WITHHELD_TEXT } from '../incidentsPublic.js'
import { getVessel, getRecord, getIncidentRecord } from '../queries.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const mc = (name) => aggregateRows(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)))[0]
const psix = fixture('psix-live-2026-09-25.json')
const pv = (id) => structuredClone(psix.vessels.find((v) => v.vessel_id === id))
const cg = fixture('cgmix-live-2026-09-26.json')
const iir = (id) => structuredClone(cg.iir.find((x) => x.activity_id === id))
const eco = fixture('ecology-live-2026-09-26.json')
const names = fixture('names-live-2026-09-26.json')
const vesselCount = async () => Number((await q(`SELECT count(*) FROM ${S}.vessels`))[0].count)

// SYNTHETIC source for hand-built identifier cases (TSB-like records carry IMO / MMSI / official number).
const TEST_SOURCE = { id: 'test-incidents', name: 'TEST incidents (synthetic)', publisher: 'tests', homepage_url: null, license: 'test',
  license_url: null, commercial_use: false, attribution_text: 'test', attribution_url: null, notes: 'SYNTHETIC, throwaway schema only' }
const synthetic = (key, at, refs) => ({
  source: TEST_SOURCE, entityKind: 'test_event', key, payload: { test: key, refs },
  event: { event_kinds: ['casualty'], event_types: ['grounding'], event_type_raw: 'TEST', title: null,
    occurred_from: at, occurred_to: at, period_kind: 'observed', time_raw: at, time_quality: 'test', severity_rank: 1,
    narrative: 'TEST narrative naming a TEST PERSON', report_url: 'https://example.invalid/test', report_ref: key,
    evidence_class: 'official_record', detail: { narrative: { display: false } } },
  refs,
})

const V = {}
before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S); await ensureMcSource(pool, S); await ensureRegistrySources(pool, S)
  await ensureIncidentSources(pool, S, [IIR_SOURCE, PSIX_SOURCE, ECOLOGY_SOURCE, NRC_SOURCE, INCIDENTNEWS_SOURCE, TEST_SOURCE])
  V.blackfish = (await ingestMcMmsi(pool, S, mc('mc-live-368616000-2025-07_2026-06.ndjson'))).resolution.vesselId
  V.eurodam = (await ingestGfwEntry(pool, S, fixture('gfw-live-eurodam-2026-09-25.json'))).resolution.vesselId
  // PSIX links the USCG vessel ids (MISLE 865188 → EURODAM, 1763413 → BLACKFISH VI), as the registry import did.
  await ingestRegistryRecord(pool, S, 'psix', pv('865188'))
  await ingestRegistryRecord(pool, S, 'psix', pv('1763413'))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('migration 006: incident tables exist in the throwaway schema; sources carry licence terms', { skip }, async () => {
  const t = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name LIKE 'incident%' ORDER BY 1`, [S])
  assert.deepEqual(t.map((r) => r.table_name), ['incident_events', 'incident_links', 'incident_vessel_refs'])
  const src = await q(`SELECT id, commercial_use FROM ${S}.sources WHERE id IN ('uscg-cgmix-iir', 'wa-ecology-spills', 'uscg-nrc', 'noaa-incidentnews') ORDER BY id`)
  assert.deepEqual(src.map((r) => [r.id, r.commercial_use]), [['noaa-incidentnews', true], ['uscg-cgmix-iir', true], ['uscg-nrc', true], ['wa-ecology-spills', false]])
})

test('IIR EURODAM (8016476): MISLE vessel id → the PSIX-linked vessel (USCG_VESSEL_ID); no vessel created', { skip }, async () => {
  const n0 = await vesselCount()
  const r = await ingestIncident(pool, S, mapIir(iir('8016476')))
  assert.deepEqual([r.eventCreated, r.refs, r.accepted, r.methods], [true, 1, 1, { USCG_VESSEL_ID: 1 }])
  const [l] = await q(`SELECT l.vessel_id::text v, l.method, l.evidence FROM ${S}.incident_links l JOIN ${S}.incident_vessel_refs r ON r.id = l.vessel_ref_id
                        WHERE r.incident_event_id = $1 AND l.status = 'accepted'`, [r.eventId])
  assert.deepEqual([l.v, l.method, l.evidence.matches.map((m) => m.method).sort()], [V.eurodam, 'USCG_VESSEL_ID', ['IMO_EXACT', 'USCG_VESSEL_ID']])
  assert.equal(await vesselCount(), n0)
})

test('IIR WALLA WALLA / ALEUTIAN ISLE / KODIAK ENTERPRISE: not among our vessels → stored, unresolved, no candidates, no vessel', { skip }, async () => {
  const n0 = await vesselCount()
  for (const id of ['7669720', '7543400', '7665123']) {
    const r = await ingestIncident(pool, S, mapIir(iir(id)))
    assert.deepEqual([r.accepted, r.candidates], [0, 0], id)
  }
  assert.equal(await vesselCount(), n0)
})

test('re-import is idempotent: same payload → same event, no new rows; changed content → new version, old superseded', { skip }, async () => {
  const p = iir('6250030')
  const a = await ingestIncident(pool, S, mapIir(p))
  const b = await ingestIncident(pool, S, mapIir(structuredClone(p)))
  assert.deepEqual([b.eventId, b.eventCreated, b.recordCreated, b.accepted], [a.eventId, false, false, 1])
  const refs = await q(`SELECT count(*)::int n FROM ${S}.incident_vessel_refs WHERE incident_event_id = $1`, [a.eventId])
  const links = await q(`SELECT count(*)::int n FROM ${S}.incident_links l JOIN ${S}.incident_vessel_refs r ON r.id = l.vessel_ref_id WHERE r.incident_event_id = $1`, [a.eventId])
  assert.deepEqual([refs[0].n, links[0].n], [1, 1])
  // SYNTHETIC change: the source restates the water segment.
  const changed = iir('6250030')
  changed.responses.water = changed.responses.water.replace('PORT OF SITKA', 'PORT OF SITKA (TEST RESTATED)')
  const c = await ingestIncident(pool, S, mapIir(changed))
  assert.deepEqual([c.eventCreated, c.superseded], [true, 1])
  const rows = await q(`SELECT status FROM ${S}.incident_events WHERE source_id = 'uscg-cgmix-iir' AND source_event_key = '6250030' ORDER BY id`)
  assert.deepEqual(rows.map((r) => r.status), ['superseded', 'active'], 'the old version is kept, never deleted')
  const v = await getVessel(q, S, V.eurodam)
  assert.equal(v.incidents.filter((i) => i.source_event_key === '6250030').length, 1, 'the card shows the active version once')
  // Restoring the original content re-activates that version instead of duplicating it.
  const d = await ingestIncident(pool, S, mapIir(p))
  assert.deepEqual([d.eventId, d.eventCreated], [a.eventId, false])
})

test('PSIX op control + deficiencies attach to EURODAM by USCG vessel id', { skip }, async () => {
  const o = await ingestIncident(pool, S, mapPsixOpControl(structuredClone(cg.psix_opcontrols[0])))
  const d = await ingestIncident(pool, S, mapPsixDeficiencies(structuredClone(cg.psix_deficiencies[0])))
  assert.deepEqual([o.methods, d.methods], [{ USCG_VESSEL_ID: 1 }, { USCG_VESSEL_ID: 1 }])
})

test('getVessel: accepted incidents newest first, display-safe fields only (no narrative, no title), with source + record links', { skip }, async () => {
  await ingestIncident(pool, S, mapIir(iir('6520747')))
  const v = await getVessel(q, S, V.eurodam)
  const keys = v.incidents.map((i) => i.source_event_key)
  assert.deepEqual(keys, ['8237466', '8202052', '8016476', '6520747', '6250030'])
  for (const i of v.incidents) {
    assert.ok(!('narrative' in i) && !('title' in i), 'no narrative / title')
    assert.ok(!('narrative' in i.detail), 'no narrative flag object either')
    assert.ok(i.report_url && i.report_ref && i.first_source_record_id && i.match_method)
  }
  const inj = v.incidents.find((i) => i.source_event_key === '6520747')
  assert.deepEqual([inj.injuries, inj.detail.injury_reported], [null, true])
  assert.ok(v.sources.some((s) => s.id === 'uscg-cgmix-iir'))
  // Serialized card payload never contains the narrative text.
  assert.ok(!/elderly|Hospital|diagnosed/i.test(JSON.stringify(v)))
})

test('raw record ops blank narratives server-side (getRecord and getIncidentRecord)', { skip }, async () => {
  const [e] = await q(`SELECT id, last_source_record_id FROM ${S}.incident_events WHERE source_event_key = '6520747' AND status = 'active'`)
  const rec = await getRecord(q, S, e.last_source_record_id)
  assert.ok(rec.payload.responses.brief.includes(WITHHELD_TEXT))
  assert.ok(!/diagnosed/.test(JSON.stringify(rec)))
  const ir = await getIncidentRecord(q, S, e.id)
  assert.equal(ir.incident.source_event_key, '6520747')
  assert.ok(!/diagnosed/.test(JSON.stringify(ir)))
  assert.deepEqual(ir.refs.map((r) => [r.uscg_vessel_id, r.accepted?.vessel_id, r.accepted?.method]), [['865188', V.eurodam, 'USCG_VESSEL_ID']])
  assert.equal(ir.source.id, 'uscg-cgmix-iir')
  // The stored evidence itself is untouched.
  const [raw] = await q(`SELECT payload FROM ${S}.source_records WHERE id = $1`, [e.last_source_record_id])
  assert.match(raw.payload.responses.brief, /diagnosed/)
})

test('name-only sources never accept: Ecology / NRC name matches stay candidates and never reach the card (SYNTHETIC Ecology row on real shape)', { skip }, async () => {
  const rows = groupEcologyRows(eco.rows).get('661444').map((r) => ({ ...r, ERTS_number: 999000001, CaseName: 'F/V Blackfish VI Diesel Spill TEST' }))
  const r = await ingestIncident(pool, S, mapEcology({ erts_number: '999000001', retrieved_at: eco.retrieved_at, rows }), { nameOnly: true })
  assert.deepEqual([r.accepted, r.unresolved], [0, 1])
  const c = await q(`SELECT l.vessel_id::text v, l.method, l.status FROM ${S}.incident_links l JOIN ${S}.incident_vessel_refs r ON r.id = l.vessel_ref_id WHERE r.incident_event_id = $1`, [r.eventId])
  assert.deepEqual(c.map((x) => [x.v, x.method, x.status]), [[V.blackfish, 'NAME_DATE_PLACE', 'candidate']])
  // The real NRC names (COASTAL PROGRESS, FORTRESS, MATSON KODIAK) match nothing in this schema: unresolved.
  for (const p of names.nrc) {
    const n = await ingestIncident(pool, S, mapNrc(structuredClone(p)), { nameOnly: true })
    assert.equal(n.accepted, 0)
  }
  const v = await getVessel(q, S, V.blackfish)
  assert.deepEqual(v.incidents, [], 'candidates are not shown on the card')
})

test('identifier rules (SYNTHETIC events): IMO + name, official number + name, MMSI inside / outside our observed window', { skip }, async () => {
  const one = async (key, at, ref) => {
    const r = await ingestIncident(pool, S, synthetic(key, at, [{ ref_key: 'v1', role: 'subject', ...ref }]))
    const l = await q(`SELECT l.vessel_id::text v, l.method, l.status FROM ${S}.incident_links l JOIN ${S}.incident_vessel_refs r ON r.id = l.vessel_ref_id
                        WHERE r.incident_event_id = $1 ORDER BY l.status, l.method`, [r.eventId])
    return l.map((x) => [x.status, x.method, x.v])
  }
  // Registry IMO held by exactly one vessel → accepted even without a name (type stated).
  assert.deepEqual(await one('T-IMO', '2025-06-13T19:17:00Z', { imo_raw: '9378448', name_raw: 'EURODAM' }), [['accepted', 'IMO_EXACT', V.eurodam]])
  // Same IMO, number type unstated (IIR-style) and a different name → candidate only.
  assert.deepEqual(await one('T-IMO-UNSTATED', '2025-06-13T19:17:00Z', { imo_raw: '9378448', name_raw: 'TEST OTHER', detail: { primary_id_type: 'unstated' } }),
    [['candidate', 'IMO_AMBIGUOUS', V.eurodam]])
  // US official number + name (BLACKFISH VI's ON 1344473 via PSIX) → accepted.
  assert.deepEqual(await one('T-ON', '2026-01-27T18:00:00Z', { official_number_raw: '1344473', official_number_scheme: 'us_official_number', name_raw: 'Blackfish VI' }),
    [['accepted', 'OFFICIAL_NUMBER_NAME', V.blackfish]])
  // MMSI + name inside the observed window → MMSI_NAME accepted.
  assert.deepEqual(await one('T-MMSI-IN', '2026-01-15T12:00:00Z', { mmsi_raw: '368616000', name_raw: 'BLACKFISH VI' }), [['accepted', 'MMSI_NAME', V.blackfish]])
  // Same MMSI + name years before our observations (MMSIs are reused) → candidate only.
  assert.deepEqual(await one('T-MMSI-OUT', '2012-01-15T12:00:00Z', { mmsi_raw: '368616000', name_raw: 'BLACKFISH VI' }), [['candidate', 'MMSI_TEMPORAL', V.blackfish]])
  // MMSI inside the window but another name → candidate only.
  assert.deepEqual(await one('T-MMSI-NAME', '2026-01-15T12:00:00Z', { mmsi_raw: '368616000', name_raw: 'TEST OTHER BOAT' }), [['candidate', 'MMSI_TEMPORAL', V.blackfish]])
  // Two identifiers pointing at different vessels → unresolved, both kept as candidates.
  assert.deepEqual(await one('T-CONFLICT', '2026-01-15T12:00:00Z', { imo_raw: '9378448', mmsi_raw: '368616000', name_raw: 'BLACKFISH VI' }),
    [['candidate', 'IMO_EXACT', V.eurodam], ['candidate', 'MMSI_NAME', V.blackfish]].sort())
})
