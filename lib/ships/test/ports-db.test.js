/**
 * Database tests for the ports reference. DEV database in SHIPS_DATABASE_URL, throwaway schema
 * (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without
 * the URL. No network: the inputs are the REAL recorded extracts in fixtures/ports-live-2026-09-26.json
 * and the GFW port-visit responses recorded live 2026-09-26.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensureGfwSource, ingestGfwEntry } from '../ingestGfw.js'
import { ensurePortVisitSource, ingestPortVisitEvents, vesselPortVisits } from '../portVisits.js'
import {
  ensurePortSources, ingestCountries, ingestWpiPorts, ingestLocodeRows, checkLocodeAliases, ingestOverrides, matchPortLabels, nameVisits,
  parseCountryInfo, csvRows, mapLocodeRow, parseOverridesCsv, PORT_SOURCES,
} from '../ports.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const one = async (text, params) => (await q(text, params))[0]
const count = async (text, params) => Number((await one(text, params)).n)

const fx = fixture('ports-live-2026-09-26.json')
const ae = fixture('gfw-live-portvisits-american-endurance-2026-09-26.json').body.entries
const ed = fixture('gfw-live-portvisits-eurodam-2026-09-26.json').body.entries
const svi = fixture('gfw-live-portvisits-spirit-of-vancouver-island-2026-09-26.json').body.entries
const countries = parseCountryInfo([fx.countries.header, ...fx.countries.lines].join('\n'))
const locode = csvRows(fx.locode.lines.join('\n')).map(mapLocodeRow).filter((m) => m.key)
const ov = parseOverridesCsv(fx.overrides.lines.join('\n'))
const EURODAM_MAIN = '6d8a6e1eb-b3d2-0380-37fd-33d6c9a79741'
const WIN = { from: '2024-09-26', to: '2026-09-27' }

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensureGfwSource(pool, S)
  await ensurePortVisitSource(pool, S)
  await ensurePortSources(pool, S)
  // Port visits first (with no ports reference yet), as on a database where step 1 ran before step 2.
  await withTx(pool, (c) => ingestPortVisitEvents(c, S, [...ae, ...ed, ...svi, ...fx.gfw_events.entries], { datasetVersion: 'public-global-port-visits-events:v4.0' }))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA ${S} CASCADE`)
  await pool.end()
})

test('migration 008: tables exist; the four sources carry licence + attribution', { skip }, async () => {
  for (const t of ['ports', 'port_aliases', 'countries']) assert.ok(await one(`SELECT to_regclass('${S}.${t}') AS r`).then((r) => r.r))
  const src = await q(`SELECT id, license, attribution_text, commercial_use FROM ${S}.sources WHERE id = ANY($1)`, [PORT_SOURCES.map((s) => s.id)])
  assert.equal(src.length, 4)
  for (const s of src) { assert.ok(s.license); assert.ok(s.attribution_text) }
})

test('matching with no WPI loaded: names come from GFW (overrides / event names), labels still get a port', { skip }, async () => {
  await withTx(pool, (c) => ingestOverrides(c, S, [...ov.rows, ...ov.errors.map((e) => ({ key: 'unkeyed:test', raw: e.raw }))]))
  const r = await withTx(pool, (c) => matchPortLabels(c, S))
  assert.ok(r.labels > 20)
  assert.equal(r.byMethod.wpi_within_4km, undefined)
  const juneau = await one(`SELECT a.method, p.name, p.origin FROM ${S}.port_aliases a JOIN ${S}.ports p ON p.id = a.port_id
                             WHERE a.key_kind = 'gfw_port_label' AND a.key = 'usa-juneau' AND a.status = 'accepted'`)
  assert.deepEqual(juneau, { method: 'gfw_event_name', name: 'JUNEAU', origin: 'gfw_port_label' })
  assert.equal(await count(`SELECT count(*) AS n FROM ${S}.port_visits WHERE status = 'active' AND port_id IS NULL AND int_port_label IS NOT NULL`), 0)
})

test('countries + WPI + UN/LOCODE import: idempotent; WPI unloCode checked against UN/LOCODE', { skip }, async () => {
  const c1 = await withTx(pool, (c) => ingestCountries(c, S, countries))
  const c2 = await withTx(pool, (c) => ingestCountries(c, S, countries))
  assert.equal(c1.recordsCreated, countries.length)
  assert.equal(c2.recordsCreated, 0)
  assert.equal(c2.countriesChanged, 0)
  const w1 = await withTx(pool, (c) => ingestWpiPorts(c, S, fx.wpi.ports))
  const w2 = await withTx(pool, (c) => ingestWpiPorts(c, S, fx.wpi.ports))
  assert.equal(w1.portsCreated, fx.wpi.ports.length)
  assert.equal(w2.recordsCreated, 0)
  assert.equal(w2.portsWritten, 0)
  const sea = await one(`SELECT p.name, p.iso3, p.unlocode, p.harbor_size, p.name_source_id, sr.payload->>'portName' AS raw
                           FROM ${S}.ports p JOIN ${S}.source_records sr ON sr.id = p.name_source_record_id WHERE p.origin = 'wpi' AND p.origin_key = '17730'`)
  assert.deepEqual(sea, { name: 'Seattle', iso3: 'USA', unlocode: 'US SEA', harbor_size: 'L', name_source_id: 'nga-wpi', raw: 'Seattle' })
  await withTx(pool, (c) => ingestLocodeRows(c, S, locode))
  const chk = await withTx(pool, (c) => checkLocodeAliases(c, S))
  assert.ok(chk.found >= 3)
  const seaLo = await one(`SELECT detail->'locode' AS l FROM ${S}.port_aliases WHERE key_kind = 'unlocode' AND key = 'US SEA'`)
  assert.equal(seaLo.l.found, true)
  assert.equal(seaLo.l.is_port, true)
  const fri = await one(`SELECT detail->'locode' AS l FROM ${S}.port_aliases WHERE key_kind = 'unlocode' AND key = 'US FRD'`)
  assert.equal(fri.l.found, false) // not in the extract: recorded as not found, nothing invented
})

test('overrides: a repeated S2 cell keeps every row as its own record of one entity', { skip }, async () => {
  const n = await count(`SELECT count(*) AS n FROM ${S}.source_records sr JOIN ${S}.source_entities se ON se.id = sr.source_entity_id
                          WHERE se.source_id = 'gfw-anchorage-overrides' AND se.entity_key = '47624103'`)
  assert.equal(n, 2)
})

test('re-match after WPI arrives: the GFW-name decision is superseded (kept), WPI wins, visits move; evidence untouched', { skip }, async () => {
  const recsBefore = await count(`SELECT count(*) AS n FROM ${S}.source_records`)
  const shaBefore = await q(`SELECT id, content_sha256, status FROM ${S}.port_visits ORDER BY id`)
  const r = await withTx(pool, (c) => matchPortLabels(c, S))
  assert.ok(r.byMethod.wpi_within_4km >= 2) // Anacortes + Juneau are in the WPI extract
  const aliases = await q(`SELECT a.status, a.method, a.distance_km, p.name, p.origin FROM ${S}.port_aliases a JOIN ${S}.ports p ON p.id = a.port_id
                            WHERE a.key_kind = 'gfw_port_label' AND a.key = 'usa-juneau' ORDER BY a.id`)
  assert.equal(aliases.length, 2)
  assert.deepEqual(aliases.map((a) => [a.status, a.method, a.origin]), [['superseded', 'gfw_event_name', 'gfw_port_label'], ['accepted', 'wpi_within_4km', 'wpi']])
  assert.ok(aliases[1].distance_km > 1.5 && aliases[1].distance_km < 1.8)
  const jv = await q(`SELECT DISTINCT p.name FROM ${S}.port_visits pv JOIN ${S}.ports p ON p.id = pv.port_id WHERE pv.int_port_label = 'usa-juneau'`)
  assert.deepEqual(jv, [{ name: 'Juneau' }])
  const selby = await one(`SELECT a.method, a.detail->'candidates' AS c, p.name FROM ${S}.port_aliases a JOIN ${S}.ports p ON p.id = a.port_id
                            WHERE a.key_kind = 'gfw_port_label' AND a.key = 'usa-selby' AND a.status = 'accepted'`)
  assert.equal(selby.method, 'wpi_nearest_clear')
  assert.equal(selby.name, 'Oleum')
  assert.equal(selby.c.length, 2)
  const c279 = await one(`SELECT p.name, p.name_method, p.origin FROM ${S}.port_aliases a JOIN ${S}.ports p ON p.id = a.port_id
                           WHERE a.key_kind = 'gfw_port_label' AND a.key = 'can-can-279' AND a.status = 'accepted'`)
  // Josh 2026-09-26: nothing names it, so it reads "near Sidney" (approximate) on its own port row, not Sidney's.
  assert.deepEqual(c279, { name: 'Sidney', name_method: 'wpi_near_approx', origin: 'gfw_port_label' })
  // Evidence: no raw record added or changed by matching; claim rows keep their content hash and status.
  assert.equal(await count(`SELECT count(*) AS n FROM ${S}.source_records`), recsBefore)
  assert.deepEqual(await q(`SELECT id, content_sha256, status FROM ${S}.port_visits ORDER BY id`), shaBefore)
  // Re-running changes nothing.
  const aliasesBefore = await q(`SELECT id, port_id, key_kind, key, status, method FROM ${S}.port_aliases ORDER BY id`)
  const again = await withTx(pool, (c) => matchPortLabels(c, S))
  assert.equal(again.visitsUpdated, 0)
  assert.deepEqual(await q(`SELECT id, port_id, key_kind, key, status, method FROM ${S}.port_aliases ORDER BY id`), aliasesBefore)
  assert.equal(await count(`SELECT count(*) AS n FROM ${S}.port_aliases WHERE key_kind = 'gfw_port_label' AND status = 'accepted'`), r.labels)
})

test('nameVisits: nothing to do when every visit already has a port', { skip }, async () => {
  const r = await nameVisits(pool, S, [EURODAM_MAIN])
  assert.equal(r.visitsUpdated, 0)
})

test('card read: EURODAM visits carry our port name, its source record and the country name', { skip }, async () => {
  await ingestGfwEntry(pool, S, fixture('gfw-live-eurodam-2026-09-25.json'))
  const [{ vessel_id: vid }] = await q(`SELECT DISTINCT vessel_id FROM ${S}.vessel_assertions WHERE sub_record_ref = $1`, [EURODAM_MAIN])
  const out = await vesselPortVisits(q, S, vid, { ...WIN, limit: 1000 })
  assert.ok(out.visits.length > 0)
  const j = out.visits.find((v) => v.port_label === 'usa-juneau')
  assert.equal(j.port_name, 'Juneau')
  assert.equal(j.name_source_id, 'nga-wpi')
  assert.equal(j.country_name, 'United States')
  assert.ok(j.name_source_record_id && j.country_record_id)
  const rec = await one(`SELECT source_id, payload->>'portName' AS n FROM ${S}.source_records WHERE id = $1`, [j.name_source_record_id])
  assert.deepEqual(rec, { source_id: 'nga-wpi', n: 'Juneau' })
  const top = out.topPorts[0]
  assert.ok(top.key && top.n >= out.topPorts.at(-1).n)
  assert.ok(out.visits.every((v) => v.port_id))
})
