/**
 * Database tests for official registries (USCG PSIX, FCC ULS, Transport Canada).
 * DEV database in SHIPS_DATABASE_URL, throwaway schemas (ships_t_<random>) dropped
 * afterwards; never "ships", never production. Skipped (NOT RUN) without the URL.
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
import { getVessel, getRecord } from '../queries.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const mc = (name) => aggregateRows(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l)))[0]
const fcc = fixture('fcc-live-uls-2026-09-20.json')
const lic = (usi) => structuredClone(fcc.records.find((r) => r.usi === usi))
const psix = fixture('psix-live-2026-09-25.json')
const pv = (id) => structuredClone(psix.vessels.find((v) => v.vessel_id === id))
const tc = fixture('tc-live-2026-09-25.json')
const tcr = (on) => structuredClone(tc.records.find((r) => r.official_number === on))
const vesselCount = async () => Number((await q(`SELECT count(*) FROM ${S}.vessels`))[0].count)

const V = {}
before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S); await ensureMcSource(pool, S); await ensureRegistrySources(pool, S)
  // The AIS side, as the Salish import builds it (real NOAA identity rows + GFW entries).
  V.blackfish = (await ingestMcMmsi(pool, S, mc('mc-live-368616000-2025-07_2026-06.ndjson'))).resolution.vesselId
  V.linnea = (await ingestMcMmsi(pool, S, mc('mc-live-linnea-rose-2026-06-21.ndjson'))).resolution.vesselId
  V.eurodam = (await ingestGfwEntry(pool, S, fixture('gfw-live-eurodam-2026-09-25.json'))).resolution.vesselId
  V.spirit = (await ingestMcMmsi(pool, S, mc('mc-live-316001269-2025-07_2026-06.ndjson'))).resolution.vesselId
  V.raptor = (await ingestMcMmsi(pool, S, mc('mc-live-316042022-2025-07_2026-06.ndjson'))).resolution.vesselId
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA IF EXISTS ${S} CASCADE`)
  await pool.end()
})

test('sources registered with licence terms', { skip }, async () => {
  const rows = await q(`SELECT id, license, commercial_use FROM ${S}.sources WHERE id IN ('uscg-psix', 'fcc-uls-ship', 'tc-vessel-registry') ORDER BY id`)
  assert.deepEqual(rows.map((r) => [r.id, r.commercial_use]), [['fcc-uls-ship', true], ['tc-vessel-registry', true], ['uscg-psix', true]])
  assert.match(rows.find((r) => r.id === 'tc-vessel-registry').license, /Open Government Licence – Canada/)
})

test('FCC BLACKFISH VI: licence MMSI (overlapping term) + call sign + name → REG_MMSI_CALLSIGN_NAME; no vessel created', { skip }, async () => {
  const n0 = await vesselCount()
  const r = await ingestRegistryRecord(pool, S, 'fcc', lic('4921984'))
  assert.deepEqual([r.resolution.action, r.resolution.method, r.resolution.vesselId], ['accept', 'REG_MMSI_CALLSIGN_NAME', V.blackfish])
  assert.equal(await vesselCount(), n0)
  // Idempotent re-import: same record, same claims, same link.
  const again = await ingestRegistryRecord(pool, S, 'fcc', lic('4921984'))
  assert.deepEqual([again.recordCreated, again.assertions.created, again.resolution.action], [false, 0, 'keep'])
})

test('FCC reused MMSI: 1997 and 2010 licences with the same MMSI do not overlap our observations → unresolved, no candidates', { skip }, async () => {
  for (const usi of ['1545921', '3202504']) {
    const r = await ingestRegistryRecord(pool, S, 'fcc', lic(usi))
    assert.deepEqual([r.resolution.action, r.resolution.reason, r.resolution.candidates], ['unresolved', 'no_match', 0], usi)
  }
})

test('FCC LINNEA ROSE: MMSI + name + registration number in the AIS call-sign field → REG_MMSI_REGNO_NAME; licensee withheld everywhere', { skip }, async () => {
  const r = await ingestRegistryRecord(pool, S, 'fcc', lic('4805138'))
  assert.deepEqual([r.resolution.action, r.resolution.method, r.resolution.vesselId], ['accept', 'REG_MMSI_REGNO_NAME', V.linnea])
  const v = await getVessel(q, S, V.linnea)
  const l = v.assertions.find((a) => a.attribute === 'radio_licensee')
  assert.deepEqual([l.value_norm, l.detail.display, l.detail.display_reason], ['WITHHELD', false, 'private_individual'])
  const rec = await getRecord(q, S, l.first_source_record_id)
  const en = rec.payload.lines.find((x) => x.file === 'EN')
  assert.equal(en.text.split('|')[7], '[withheld]')
  // No stored claim or raw record of this licence contains anything but the placeholder in the name fields.
  const stored = await q(`SELECT count(*)::int n FROM ${S}.assertions WHERE attribute = 'radio_licensee' AND source_entity_id = $1 AND value_norm <> 'WITHHELD'`, [r.entityId])
  assert.equal(stored[0].n, 0)
})

test('FCC conflict (SYNTHETIC licence): BLACKFISH MMSI in an overlapping term but another name → candidate only', { skip }, async () => {
  const rec = lic('4921984')
  rec.usi = '999000001'
  rec.lines = rec.lines.map((l) => ({ ...l, text: l.text.replace('|4921984|', '|999000001|').replace('Blackfish VI', 'TEST OTHER BOAT') }))
  const r = await ingestRegistryRecord(pool, S, 'fcc', rec)
  assert.equal(r.resolution.action, 'unresolved')
  const cs = await q(`SELECT vessel_id::text, method, evidence FROM ${S}.entity_links WHERE source_entity_id = $1 AND status = 'candidate' ORDER BY method`, [r.entityId])
  // Both the overlapping MMSI and the shared official number point at BLACKFISH VI; the name disagrees, so neither accepts.
  assert.deepEqual(cs.map((c) => [c.vessel_id, c.method, c.evidence.reason]),
    [[V.blackfish, 'MMSI_TEMPORAL', 'name differs'], [V.blackfish, 'REGISTRY_LINK', 'name differs']])
})

test('PSIX BLACKFISH VI: call sign + name → REG_CALLSIGN_NAME on the same vessel; year built, service type, certificates attached', { skip }, async () => {
  const r = await ingestRegistryRecord(pool, S, 'psix', pv('1763413'))
  assert.deepEqual([r.resolution.action, r.resolution.method, r.resolution.vesselId], ['accept', 'REG_CALLSIGN_NAME', V.blackfish])
  const v = await getVessel(q, S, V.blackfish)
  const got = (attr, src) => v.assertions.filter((a) => a.attribute === attr && (!src || a.source_id === src)).map((a) => a.value_norm)
  assert.deepEqual(got('year_built'), ['2024'])
  assert.ok(got('vessel_type', 'uscg-psix').includes('PSIX_PASSENGERINSPECTED'))
  assert.ok(got('certificate', 'uscg-psix').length >= 5)
  assert.deepEqual([...new Set(got('official_number'))], ['1344473']) // FCC and PSIX agree
  assert.equal(v.classification.group, 'passenger')
})

test('PSIX EURODAM: IMO held as a registry IMO (GFW) → IMO_EXACT', { skip }, async () => {
  const r = await ingestRegistryRecord(pool, S, 'psix', pv('865188'))
  assert.deepEqual([r.resolution.action, r.resolution.method, r.resolution.vesselId], ['accept', 'IMO_EXACT', V.eurodam])
})

test('PSIX name only (SYNTHETIC: BLACKFISH with the call sign removed): never attached by name; a name + length candidate at most', { skip }, async () => {
  const p = pv('1763413')
  p.vessel_id = '999000002'
  for (const op of ['summary', 'particulars']) p.responses[op] = p.responses[op].replace('<VesselCallSign>WDP4981</VesselCallSign>', '<VesselCallSign>N/A</VesselCallSign>')
    .replace('<VesselId>1763413</VesselId>', '<VesselId>999000002</VesselId>').replace('<Identification>1344473</Identification>', '<Identification>9990002</Identification>')
  const r = await ingestRegistryRecord(pool, S, 'psix', p)
  assert.equal(r.resolution.action, 'unresolved')
  const links = await q(`SELECT method, vessel_id::text FROM ${S}.entity_links WHERE source_entity_id = $1`, [r.entityId])
  assert.deepEqual(links, [{ method: 'NAME_DIMENSION_MATCH', vessel_id: V.blackfish }])
})

test('TC SEASPAN RAPTOR: AIS IMO + the same name → IMO_AIS_NAME', { skip }, async () => {
  const r = await ingestRegistryRecord(pool, S, 'tc', tcr('844174'))
  assert.deepEqual([r.resolution.action, r.resolution.method, r.resolution.vesselId], ['accept', 'IMO_AIS_NAME', V.raptor])
  const v = await getVessel(q, S, V.raptor)
  assert.ok(v.assertions.some((a) => a.attribute === 'builder' && a.source_id === 'tc-vessel-registry'))
})

test('TC SPIRIT OF VANCOUVER ISLAND: AIS IMO but AIS name "SPIRIT OF V I" → not corroborated, IMO candidate only', { skip }, async () => {
  const r = await ingestRegistryRecord(pool, S, 'tc', tcr('816503'))
  assert.deepEqual([r.resolution.action, r.resolution.reason], ['unresolved', 'no_accepted_match'])
  const [c] = await q(`SELECT vessel_id::text, method FROM ${S}.entity_links WHERE source_entity_id = $1 AND status = 'candidate'`, [r.entityId])
  assert.deepEqual([c.vessel_id, c.method], [V.spirit, 'IMO_EXACT'])
})

test('registry claims never create vessels, and never change the AIS evidence', { skip }, async () => {
  const [{ n }] = await q(`SELECT count(*)::int n FROM ${S}.entity_links l JOIN ${S}.source_entities se ON se.id = l.source_entity_id
                            WHERE se.source_id IN ('uscg-psix', 'fcc-uls-ship', 'tc-vessel-registry') AND l.method = 'NEW_FROM_SOURCE_ENTITY'`)
  assert.equal(n, 0)
  const [{ m }] = await q(`SELECT count(*)::int m FROM ${S}.assertions a JOIN ${S}.source_entities se ON se.id = a.source_entity_id
                            WHERE se.source_id = 'marinecadastre-ais' AND a.status <> 'active'`)
  assert.equal(m, 0)
})
