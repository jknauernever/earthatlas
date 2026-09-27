/**
 * Port visits: pure mapping + identity choice + fetch planning (offline).
 * Fixtures are REAL GFW responses recorded live 2026-09-26 (fixtures/README.md, "Port visits").
 * Cases built by editing a copy of a real event are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPortVisit, ownIdentities, planFetch, parseWindow, defaultWindow, PORT_VISITS_SOURCE } from '../portVisits.js'
import { fixture } from './scenarios.js'

const ae = fixture('gfw-live-portvisits-american-endurance-2026-09-26.json').body.entries
const ed = fixture('gfw-live-portvisits-eurodam-2026-09-26.json').body.entries
const svi = fixture('gfw-live-portvisits-spirit-of-vancouver-island-2026-09-26.json').body.entries
const edIdentity = fixture('gfw-live-eurodam-2026-09-25.json')
const EURODAM_MAIN = '6d8a6e1eb-b3d2-0380-37fd-33d6c9a79741'

test('source row: GFW licence + attribution recorded (non-commercial)', () => {
  assert.equal(PORT_VISITS_SOURCE.id, 'gfw-port-visits')
  assert.equal(PORT_VISITS_SOURCE.license, 'CC BY-NC 4.0')
  assert.equal(PORT_VISITS_SOURCE.commercial_use, false)
  assert.equal(PORT_VISITS_SOURCE.attribution_text, 'Powered by Global Fishing Watch.')
})

test('maps a live AMERICAN ENDURANCE port visit field by field', () => {
  const ev = ae.at(-1) // SELBY, 2026-09-21 → 2026-09-22
  const m = mapPortVisit(ev)
  assert.equal(m.key, ev.id)
  const r = m.row
  assert.equal(r.event_id, ev.id)
  assert.equal(r.visit_id, ev.port_visit.visitId)
  assert.notEqual(r.visit_id, r.event_id)
  assert.equal(r.gfw_vessel_id, '19004d162-2295-8dd5-fbb3-284ff0561ce6')
  assert.equal(r.ssvid, '369040000')
  assert.equal(r.start_at, ev.start)
  assert.equal(r.end_at, ev.end)
  assert.equal(r.duration_hrs, ev.port_visit.durationHrs)
  assert.equal(r.confidence, 4)            // GFW sends the string "4"
  assert.equal(r.confidence_raw, '4')
  assert.equal(r.int_name, ev.port_visit.intermediateAnchorage.name)
  assert.equal(r.int_port_label, ev.port_visit.intermediateAnchorage.id)
  assert.equal(r.int_anchorage_id, ev.port_visit.intermediateAnchorage.anchorageId)
  assert.equal(r.int_iso3, 'USA')
  assert.equal(typeof r.int_lat, 'number')
  assert.equal(typeof r.int_at_dock, 'boolean')
  assert.equal(r.lat, ev.position.lat)
  // distanceFromShoreKm arrives as a string and is kept as sent
  assert.equal(r.detail.intermediate.distance_from_shore_km, ev.port_visit.intermediateAnchorage.distanceFromShoreKm)
  assert.equal(typeof r.detail.intermediate.distance_from_shore_km, 'string')
  assert.match(m.contentSha256, /^[0-9a-f]{64}$/)
})

test('duration equals end − start on every live event (GFW semantics)', () => {
  for (const ev of [...ae, ...ed, ...svi]) {
    const r = mapPortVisit(ev).row
    assert.ok(Math.abs((Date.parse(r.end_at) - Date.parse(r.start_at)) / 36e5 - r.duration_hrs) < 1e-6, ev.id)
  }
})

test('null anchorage names stay null; the GFW port label is kept (no invented name)', () => {
  const nameless = [...ae, ...ed].map(mapPortVisit).filter((m) => m.row.int_name === null)
  assert.ok(nameless.length > 0)
  for (const m of nameless) assert.ok(m.row.int_port_label, 'label present when name is null')
})

test('start and end anchorage of one visit can differ (live AMERICAN ENDURANCE data)', () => {
  const rows = ae.map((e) => mapPortVisit(e).row)
  // Every row keeps all three anchorages separately.
  for (const r of rows) for (const p of ['start', 'int', 'end']) assert.ok(r[`${p}_anchorage_id`])
})

test('mapping is deterministic (same event → same content hash)', () => {
  const a = mapPortVisit(structuredClone(ed[0])), b = mapPortVisit(structuredClone(ed[0]))
  assert.equal(a.contentSha256, b.contentSha256)
})

test('SYNTHETIC edit of a live event: a zone-less timestamp is rejected, not assumed UTC', () => {
  const ev = structuredClone(ae[0]); ev.start = '2026-09-21T14:59:02'
  const m = mapPortVisit(ev)
  assert.equal(m.row, undefined)
  assert.match(m.error, /without explicit zone/)
})

test('SYNTHETIC edit of a live event: end before start and non-port-visit types are rejected', () => {
  const ev = structuredClone(ae[0]); ev.end = '2000-01-01T00:00:00.000Z'
  assert.match(mapPortVisit(ev).error, /before start/)
  const ev2 = structuredClone(ae[0]); ev2.type = 'encounter'
  assert.match(mapPortVisit(ev2).error, /not a port visit/)
  assert.equal(mapPortVisit({}).key, null)
})

test('SYNTHETIC edit of a live event: an unexpected confidence is kept raw, not coerced', () => {
  const ev = structuredClone(ae[0]); ev.port_visit.confidence = '9'
  const r = mapPortVisit(ev).row
  assert.equal(r.confidence, null)
  assert.equal(r.confidence_raw, '9')
  assert.match(r.detail.confidence_note, /unexpected/)
})

test('EURODAM: only the ship\'s own GFW identity is used; its 14 tender/lifeboat identities are skipped', () => {
  const identities = edIdentity.selfReportedInfo.map((s) => ({ gfwId: s.id, mmsi: s.ssvid, name: s.shipname, messages: s.messagesCounter }))
  const registryNames = edIdentity.registryInfo.map((r) => r.shipname)
  const own = ownIdentities(identities, registryNames)
  assert.deepEqual(own.use, [EURODAM_MAIN])
  assert.equal(own.skipped.length, 14)
  for (const s of own.skipped) assert.notEqual(s.mmsi, '245206000')
  // Every live "visit" from a skipped identity is one of the long, overlapping tender visits.
  const skippedIds = new Set(own.skipped.map((s) => s.gfwId))
  const tender = ed.filter((e) => skippedIds.has(e.vessel.id))
  assert.equal(tender.length, 17)
  assert.ok(tender.every((e) => e.vessel.id !== EURODAM_MAIN))
  assert.ok(Math.max(...tender.map((e) => e.port_visit.durationHrs)) > 70000)
})

test('ownIdentities: a renamed/second identity is kept when its name is a registry name', () => {
  // SYNTHETIC identities (ids TEST-…)
  const own = ownIdentities([
    { gfwId: 'TEST-a', mmsi: '111111111', name: 'OLD NAME', messages: 100 },
    { gfwId: 'TEST-b', mmsi: '222222222', name: 'New-Name', messages: 900 },
    { gfwId: 'TEST-c', mmsi: '333333333', name: null, messages: 5 },
  ], ['OLDNAME', 'NEWNAME'])
  assert.deepEqual(own.use, ['TEST-a', 'TEST-b'])
  assert.deepEqual(own.skipped.map((s) => s.gfwId), ['TEST-c'])
  assert.deepEqual(ownIdentities([], []).use, [])
  assert.deepEqual(ownIdentities([{ gfwId: 'TEST-x', name: 'X', messages: null }, { gfwId: 'TEST-y', name: 'Y' }], []).use, ['TEST-x', 'TEST-y'])
})

test('windows: default is the last 2 years, end exclusive; bad input rejected', () => {
  const now = new Date('2026-09-26T20:00:00Z')
  assert.deepEqual(defaultWindow(now), { from: '2024-09-26', to: '2026-09-27' })
  assert.deepEqual(parseWindow(null, null, now), { from: '2024-09-26', to: '2026-09-27' })
  assert.deepEqual(parseWindow('2025-01-01', '2025-02-01', now), { from: '2025-01-01', to: '2025-02-01' })
  assert.deepEqual(parseWindow('2025-01-01', '2030-01-01', now), { from: '2025-01-01', to: '2026-09-27' }) // no future
  assert.ok(parseWindow('2011-12-31', null, now).error)
  assert.ok(parseWindow('2025-02-01', '2025-01-01', now).error)
  assert.ok(parseWindow('yesterday', null, now).error)
})

test('planFetch: fresh log → no call; older log → only the unsettled tail; other identities → full', () => {
  const now = new Date('2026-09-26T20:00:00Z')
  const ids = [EURODAM_MAIN]
  const base = { status: 'succeeded', gfw_vessel_ids: ids, range_from: '2024-09-26', range_to: '2026-09-27' }
  assert.deepEqual(planFetch([{ ...base, finished_at: '2026-09-26T10:00:00Z' }], { gfwIds: ids, from: '2024-09-26', to: '2026-09-27', now }), { fetch: false })
  const tail = planFetch([{ ...base, finished_at: '2026-09-24T10:00:00Z' }], { gfwIds: ids, from: '2024-09-26', to: '2026-09-27', now })
  assert.deepEqual(tail, { fetch: true, from: '2026-09-13', to: '2026-09-27', incremental: true })
  const other = planFetch([{ ...base, gfw_vessel_ids: ['x'], finished_at: '2026-09-26T10:00:00Z' }], { gfwIds: ids, from: '2024-09-26', to: '2026-09-27', now })
  assert.deepEqual(other, { fetch: true, from: '2024-09-26', to: '2026-09-27', incremental: false })
  assert.deepEqual(planFetch([], { gfwIds: ids, from: '2024-09-26', to: '2026-09-27', now }), { fetch: true, from: '2024-09-26', to: '2026-09-27', incremental: false })
  assert.equal(planFetch([{ ...base, status: 'failed', finished_at: '2026-09-26T10:00:00Z' }], { gfwIds: ids, from: '2024-09-26', to: '2026-09-27', now }).fetch, true)
})

// Josh 2026-09-26: a full re-fetch once the last full fetch is over 30 days old.
test('planFetch: last full fetch older than FULL_REFRESH_DAYS → whole window again', async () => {
  const { planFetch } = await import('../portVisits.js')
  const full = { status: 'succeeded', gfw_vessel_ids: ['a'], range_from: '2024-09-01', range_to: '2026-08-01', finished_at: '2026-08-01T00:00:00Z' }
  const recent = planFetch([full], { gfwIds: ['a'], from: '2024-09-01', to: '2026-08-20', now: new Date('2026-08-20T00:00:00Z') })
  assert.equal(recent.incremental, true)
  const old = planFetch([full], { gfwIds: ['a'], from: '2024-09-01', to: '2026-09-20', now: new Date('2026-09-20T00:00:00Z') })
  assert.deepEqual(old, { fetch: true, from: '2024-09-01', to: '2026-09-20', incremental: false })
})
