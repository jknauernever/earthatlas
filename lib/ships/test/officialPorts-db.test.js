/**
 * Official port names / status, database tests. DEV database in SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>)
 * dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network: DFO, USACE, the
 * Transport Canada pages and the WPI ports are REAL responses recorded 2026-09-26/27
 * (fixtures/official-ports-live-2026-09-27.json, fixtures/ports-live-2026-09-26.json). Cases marked SYNTHETIC are built here.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensurePortSources, ingestCountries, ingestWpiPorts, parseCountryInfo } from '../ports.js'
import { portsLayer } from '../portCard.js'
import { ourPortsNear } from '../climateTrace.js'
import { ensureOfficialSources, importDfo, importUsace, importHandTable, portOfficial, DFO_SCH_SOURCE, SALISH_BBOX } from '../officialPorts.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const one = async (text, params) => (await q(text, params))[0]

const fx = fixture('official-ports-live-2026-09-27.json')
const ports = fixture('ports-live-2026-09-26.json')
const table = JSON.parse(readFileSync(new URL('../data/ca-official-ports.json', import.meta.url), 'utf8'))
const pages = new Map([...Object.entries(fx.tc_pages), ...Object.entries(fx.law_extracts).filter(([k]) => k.startsWith('http'))])
const dfoItems = fx.dfo_layers.flatMap((l) => l.body.features.map((feature) => ({ feature, layer: l.layer })))
const portId = async (wpi) => (await one(`SELECT id FROM ${S}.ports WHERE origin = 'wpi' AND wpi_number = $1`, [wpi])).id

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensurePortSources(pool, S)
  await ensureOfficialSources(pool, S)
  await withTx(pool, (c) => ingestCountries(c, S, parseCountryInfo([ports.countries.header, ...ports.countries.lines].join('\n'))))
  const byNum = new Map([...ports.wpi.ports, ...fx.wpi.ports].map((p) => [p.portNumber, p]))
  await withTx(pool, (c) => ingestWpiPorts(c, S, [...byNum.values()]))
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA ${S} CASCADE`)
  await pool.end()
})

test('migration 013: dfo_sch origin and the official alias kinds are allowed; sources carry their licences', { skip }, async () => {
  const src = await one(`SELECT license, commercial_use, attribution_text FROM ${S}.sources WHERE id = $1`, [DFO_SCH_SOURCE.id])
  assert.equal(src.license, 'Open Government Licence – Canada')
  assert.match(src.attribution_text, /^Contains information licensed under the Open Government Licence – Canada/)
  assert.equal(Number((await one(`SELECT count(*) AS n FROM ${S}.sources WHERE id = ANY($1)`, [['dfo-sch', 'usace-port-areas', 'ca-official-ports']])).n), 3)
})

test('hand table: CPA / public-port rows land on their WPI ports; pages and rows are stored as evidence', { skip }, async () => {
  const r = await withTx(pool, (c) => importHandTable(c, S, table, pages))
  assert.equal(r.ok, table.rows.length, JSON.stringify(r.problems))
  assert.equal(r.aliases, table.rows.reduce((n, x) => n + x.wpi.length, 0))
  const van = await portOfficial(q, S, await portId(18150))
  assert.deepEqual([van.name, van.status, van.sourceShort, van.kind], ['Vancouver Fraser Port Authority', 'Canada Port Authority', 'TC', 'ca_port_authority'])
  const rec = await one(`SELECT payload FROM ${S}.source_records WHERE id = $1`, [van.recordId])
  assert.equal(rec.payload.id, 'cpa-vancouver-fraser')
  const vic = await portOfficial(q, S, await portId(18670))
  assert.deepEqual([vic.name, vic.status], ['Victoria', 'Transport Canada public port'])
  assert.equal(Number((await one(`SELECT count(*) AS n FROM ${S}.source_records WHERE source_id = 'ca-official-ports'`)).n), pages.size + table.rows.length)
})

test('hand table SYNTHETIC: a row the pages do not confirm is stored as candidate and not shown', { skip }, async () => {
  const bad = { rows: [{ ...table.rows[2], id: 'test-unconfirmed', check: 'Not On Any Page Port Authority' }] }
  await withTx(pool, (c) => importHandTable(c, S, bad, pages))
  const a = await one(`SELECT status FROM ${S}.port_aliases WHERE key = 'test-unconfirmed'`)
  assert.equal(a.status, 'candidate')
  const pa = await portOfficial(q, S, await portId(18730))
  assert.equal(pa.name, 'Port Alberni Port Authority')
  assert.equal(pa.also.length, 0)
})

test('DFO: accepted / candidate / new port, recorded Salish harbours against the recorded WPI ports', { skip }, async () => {
  const r = await withTx(pool, (c) => importDfo(c, S, dfoItems, { bbox: SALISH_BBOX }))
  assert.equal(r.harbours, 57)
  assert.equal(r.accepted + r.candidate + r.new_port, 57)
  const d = (name) => r.decisions.find((x) => x.name === name)
  assert.equal(d('Ganges (Inner Harbour)').port_id, await portId(18600))
  assert.equal(d('Tsehum Harbour (Shoal Harbour)').decision, 'candidate')
  assert.equal(d('Sooke').decision, 'new_port')
  // Sooke is a map port now (hollow ring), with its official line from DFO.
  const sooke = await one(`SELECT id, origin, name, name_source_record_id FROM ${S}.ports WHERE origin = 'dfo_sch' AND origin_key = '6173'`)
  const fc = await portsLayer(q, S)
  const f = fc.features.find((x) => x.properties.i === Number(sooke.id))
  assert.deepEqual([f.properties.n, f.properties.g], ['Sooke', 1])
  const o = await portOfficial(q, S, sooke.id)
  assert.deepEqual([o.name, o.status, o.authority, o.sourceShort, o.recordId], ['Sooke', 'DFO core fishing harbour', 'Sooke Harbour Authority', 'DFO', Number(sooke.name_source_record_id)])
  // Candidates are stored but never shown.
  assert.equal(await portOfficial(q, S, await portId(18660)), null) // Sidney: Tsehum is a candidate only
  assert.equal((await one(`SELECT status FROM ${S}.port_aliases WHERE key_kind = 'dfo_sch_harbour' AND key = '6166'`)).status, 'candidate')
  // Vancouver keeps its CPA line first, the DFO False Creek harbour after it.
  const van = await portOfficial(q, S, await portId(18150))
  assert.deepEqual([van.name, van.also.map((x) => x.name)], ['Vancouver Fraser Port Authority', ['Vancouver (False Creek)']])
  // Climate TRACE sees the DFO port as one of ours (peer rule).
  assert.ok((await ourPortsNear(q, S, 48.37, -123.73, 5)).some((p) => String(p.id) === String(sooke.id)))
})

test('DFO: re-import is idempotent (no new records, same decisions, same ports)', { skip }, async () => {
  const before = await q(`SELECT id, port_id, key, status FROM ${S}.port_aliases WHERE key_kind = 'dfo_sch_harbour' ORDER BY id`)
  const nPorts = (await one(`SELECT count(*) AS n FROM ${S}.ports WHERE origin = 'dfo_sch'`)).n
  const r = await withTx(pool, (c) => importDfo(c, S, dfoItems, { bbox: SALISH_BBOX }))
  assert.equal(r.recordsCreated, 0)
  assert.deepEqual(await q(`SELECT id, port_id, key, status FROM ${S}.port_aliases WHERE key_kind = 'dfo_sch_harbour' ORDER BY id`), before)
  assert.equal((await one(`SELECT count(*) AS n FROM ${S}.ports WHERE origin = 'dfo_sch'`)).n, nPorts)
})

test('DFO SYNTHETIC: a map port appearing near a DFO-only harbour takes it over; the DFO port is kept but leaves the map', { skip }, async () => {
  const h = fx.dfo_layers[0].body.features.find((f) => f.attributes.Harbour_Name === 'Sooke').attributes
  await pool.query(`INSERT INTO ${S}.ports (origin, origin_key, name, name_source_id, name_method, iso2, iso3, lat, lon)
                    VALUES ('climate_trace', 'test-sooke', 'Sooke Harbour', 'nga-wpi', 'ct_port_name', 'CA', 'CAN', $1, $2)`, [h.Latitude + 0.005, h.Longitude])
  const r = await withTx(pool, (c) => importDfo(c, S, dfoItems, { bbox: SALISH_BBOX }))
  const d = r.decisions.find((x) => x.name === 'Sooke')
  const ct = await one(`SELECT id FROM ${S}.ports WHERE origin_key = 'test-sooke'`)
  assert.deepEqual([d.decision, String(d.port_id)], ['accepted', String(ct.id)])
  const old = await one(`SELECT id FROM ${S}.ports WHERE origin = 'dfo_sch' AND origin_key = '6173'`)
  assert.ok(old, 'the DFO port row is never deleted')
  assert.equal((await one(`SELECT status FROM ${S}.port_aliases WHERE port_id = $1 AND key_kind = 'dfo_sch_harbour'`, [old.id])).status, 'superseded')
  assert.equal((await portsLayer(q, S)).features.some((f) => f.properties.i === Number(old.id)), false)
  await pool.query(`UPDATE ${S}.port_aliases SET status = 'superseded' WHERE port_id = $1`, [ct.id]) // leave no test port behind as a decision
})

test('USACE: each WPI point inside exactly one recorded Port Area gets that code; others get nothing', { skip }, async () => {
  const r = await withTx(pool, (c) => importUsace(c, S, fx.usace.body.features, { bbox: SALISH_BBOX }))
  assert.equal(r.areas, 3)
  const pa = await portOfficial(q, S, await portId(17120))
  assert.deepEqual([pa.name, pa.status, pa.sourceShort], ['Clallam County Port District, WA', 'USACE port area 4707', 'USACE'])
  assert.equal((await portOfficial(q, S, await portId(17790))).name, 'Port of Everett, WA')
  assert.equal(await portOfficial(q, S, await portId(17730)), null) // Seattle: King County's area is not in this 3-feature extract
  const again = await withTx(pool, (c) => importUsace(c, S, fx.usace.body.features, { bbox: SALISH_BBOX }))
  assert.equal(again.recordsCreated, 0)
  assert.equal(again.accepted, r.accepted)
})

test('USACE SYNTHETIC: a point inside two Port Areas is not guessed (candidates only)', { skip }, async () => {
  const everett = fx.usace.body.features.find((f) => f.attributes.PORTIDPK === '4727')
  const twin = { ...everett, attributes: { ...everett.attributes, OBJECTID: -1, PORTIDPK: '9999', FEATURENAME: 'Test overlapping area' } }
  const r = await withTx(pool, (c) => importUsace(c, S, [...fx.usace.body.features, twin], { bbox: SALISH_BBOX }))
  assert.ok(r.ambiguous >= 1)
  const ev = await portId(17790)
  assert.deepEqual((await q(`SELECT key, status FROM ${S}.port_aliases WHERE port_id = $1 AND key_kind = 'usace_port_area' ORDER BY key`, [ev])).map((x) => [x.key, x.status]),
    [['4727', 'candidate'], ['9999', 'candidate']])
  assert.equal(await portOfficial(q, S, ev), null)
})
