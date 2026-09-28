/**
 * Database tests for the terminal list (migration 012) and the terminal visit read. DEV database in SHIPS_DATABASE_URL,
 * throwaway schema (ships_t_<random>) dropped afterwards; never "ships", never production. Skipped (NOT RUN) without the URL.
 * No live calls: REAL recorded responses (fixtures/README.md, "Terminals"); the curated entries are the real ones from
 * lib/ships/data, cut down to the terminals whose raw rows the fixture holds. Edits are marked SYNTHETIC.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensurePortVisitSource, ingestPortVisitEvents } from '../portVisits.js'
import { loadTerminalData, importTerminals, ensureTerminalSources, listTerminals, terminalVisits, terminalGfwLabels, parseCsv } from '../terminals.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows

const fx = fixture('terminals-live-2026-09-27.json')
const ev = fixture('gfw-live-portvisits-salish-terminals-2026.json')
const full = await loadTerminalData()
const subset = (ids) => ({ main: { ...full.main, terminals: full.main.terminals.filter((t) => ids.includes(t.id)) },
  osm: { ...full.osm, berths: full.osm.berths.filter((b) => ids.includes(b.terminal)) } })
const data = subset(fx.terminals)
const raw = {
  usace: fx.usace.features, ecology: fx.ecology.features, bcpt: fx.bcpt.features,
  osm: { elements: fx.osm.elements, osmBase: fx.osm.osm_base }, gem: parseCsv(fx.gem.csv), ctRefinery: fx.ct_refinery.features,
  release: fx.ct_refinery.release,
  urls: { usace: fx.usace.url, ecology: fx.ecology.url, bcpt: fx.bcpt.url, osm: fx.osm.url, gem: fx.gem.url, ct: 'https://climatetrace.org/data' },
}

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await withTx(pool, (c) => ensureTerminalSources(c, S))
  await ensurePortVisitSource(pool, S)
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA ${S} CASCADE`)
  await pool.end()
})

test('import: evidence + claims from REAL rows; sources carry their licences; ODbL berths flagged; idempotent', { skip }, async () => {
  const r1 = await withTx(pool, (c) => importTerminals(c, S, data, raw))
  assert.equal(r1.terminals, fx.terminals.length)
  // Ship ports are imported by another script: here they are linked without a record, and said so.
  assert.ok(r1.problems.every((p) => /Climate TRACE ship port \d+ is not stored yet/.test(p)), r1.problems.join('\n'))
  const r2 = await withTx(pool, (c) => importTerminals(c, S, data, raw))
  assert.equal(r2.recordsCreated, 0, 'unchanged rows store nothing new')
  assert.equal(r2.berths, r1.berths)
  const src = Object.fromEntries((await q(`SELECT id, license, commercial_use FROM ${S}.sources`)).map((r) => [r.id, r]))
  assert.equal(src['wa-ecology-facilities'].commercial_use, false)
  assert.match(src['bc-ports-terminals'].license, /Open Government Licence - British Columbia/)
  assert.match(src.osm.license, /ODbL/)
  const b = await q(`SELECT t.key, b.basis, b.odbl, b.source_id, cardinality(b.source_record_ids) AS n FROM ${S}.terminal_berths b JOIN ${S}.terminals t ON t.id = b.terminal_id`)
  assert.ok(b.every((x) => x.odbl === (x.source_id === 'osm') && x.n >= 1))
  assert.deepEqual(b.filter((x) => x.odbl).map((x) => x.key), ['wa-puget-lng-tacoma'])
  // The berth record ids point at raw rows of the right source.
  const bad = await q(`SELECT b.berth_key FROM ${S}.terminal_berths b CROSS JOIN LATERAL unnest(b.source_record_ids) rid
                        JOIN ${S}.source_records sr ON sr.id = rid WHERE sr.source_id <> b.source_id`)
  assert.deepEqual(bad, [])
})

test('the ODbL flag cannot drift from the source (CHECK constraint)', { skip }, async () => {
  const [{ id }] = await q(`SELECT id FROM ${S}.terminals WHERE key = 'bc-westridge'`)
  await assert.rejects(q(`INSERT INTO ${S}.terminal_berths (terminal_id, berth_key, lat, lon, basis, source_id, source_record_ids, odbl)
                          VALUES ($1, 'x', 49.29, -122.95, 'osm_site_center', 'osm', '{1}', false)`, [id]), /check/i)
})

test('links: dock records, Climate TRACE refinery vs ship port kept apart, GEM unit rows', { skip }, async () => {
  const t = Object.fromEntries((await listTerminals(q, S)).map((x) => [x.key, x]))
  const roles = (k) => t[k].links.map((l) => `${l.role}:${l.source_id}:${l.entity_key}`).sort()
  assert.deepEqual(roles('wa-bp-cherry-point'), ['ct_refinery:climate-trace:1753291', 'dock_record:usace-docks:02JT', 'dock_record:wa-ecology-facilities:OBJECTID 1'])
  assert.ok(roles('wa-marathon-anacortes').includes('ct_ship_port:climate-trace:1934807'))
  assert.ok(roles('wa-marathon-anacortes').includes('ct_refinery:climate-trace:1753321'))
  assert.ok(roles('bc-westshore').includes('gem_coal_terminal:gem-gctt:T1087/T01087'))
  assert.equal(t['bc-westridge'].berths[0].basis, 'bc_ports_terminals')
  assert.equal(t['bc-westridge'].operator, 'Trans Mountain Corporation')
  assert.match(t['bc-westridge'].operator_source_url, /^https:\/\//)
})

test('a terminal dropped from the file is withdrawn, not deleted; a dropped berth is retired (SYNTHETIC edit)', { skip }, async () => {
  const less = subset(fx.terminals.filter((k) => k !== 'bc-shellburn'))
  const hfs = less.main.terminals.find((x) => x.id === 'wa-hfs-puget-sound')
  hfs.berths = hfs.berths.filter((b) => b.key !== 'ecology-2')
  const r = await withTx(pool, (c) => importTerminals(c, S, less, raw))
  assert.equal(r.withdrawn, 1)
  const [sh] = await q(`SELECT list_status FROM ${S}.terminals WHERE key = 'bc-shellburn'`)
  assert.equal(sh.list_status, 'withdrawn')
  const [e2] = await q(`SELECT b.status FROM ${S}.terminal_berths b JOIN ${S}.terminals t ON t.id = b.terminal_id WHERE t.key = 'wa-hfs-puget-sound' AND b.berth_key = 'ecology-2'`)
  assert.equal(e2.status, 'retired')
  assert.equal((await listTerminals(q, S)).some((x) => x.key === 'bc-shellburn'), false)
  // Restore: re-listed, berth active again.
  await withTx(pool, (c) => importTerminals(c, S, data, raw))
  const [back] = await q(`SELECT list_status FROM ${S}.terminals WHERE key = 'bc-shellburn'`)
  assert.equal(back.list_status, 'listed')
})

test('terminalVisits over REAL GFW events: Cherry Point berthed tankers; Anacortes "one of"; every stop used', { skip }, async () => {
  await withTx(pool, (c) => ingestPortVisitEvents(c, S, ev.entries, { retrievalUrl: 'fixture', datasetVersion: 'public-global-port-visits-events:v4.0' }))
  const cp = await terminalVisits(q, S, 'wa-bp-cherry-point', { from: '2026-01', to: '2026-06' })
  const names = cp.visits.map((v) => v.vessel.name).sort()
  assert.deepEqual(names, ['DION', 'DUBLIN SEA', 'TODD E PROPHET', 'TORM DAVAO'])
  assert.ok(cp.visits.every((v) => v.relation === 'match' && v.dock === 'berthed'))
  assert.equal(cp.summary.berthed, 4)
  assert.equal(cp.rule.matchKm, 1)

  const mar = await terminalVisits(q, S, 'wa-marathon-anacortes', { from: '2026-01', to: '2026-06' })
  assert.ok(mar.visits.length >= 1)
  assert.ok(mar.visits.every((v) => v.relation === 'ambiguous' && v.oneOf.includes('wa-hfs-puget-sound')), 'never assigned to Marathon alone')
  assert.equal(mar.summary.ambiguousWith['wa-hfs-puget-sound'], mar.visits.length)

  const ws = await terminalVisits(q, S, 'bc-westshore', { from: '2026-06', to: '2026-06' })
  const burnaby = ws.visits.find((v) => v.eventId.startsWith('7d58c7a3'))
  assert.deepEqual(burnaby.slots, ['end'], 'matched on the end anchorage only')
  assert.equal(burnaby.stops.find((s) => s.slot === 'start').terminal, 'bc-parkland-burnaby')

  // Window is by visit start: nothing before 2026-01.
  const none = await terminalVisits(q, S, 'wa-bp-cherry-point', { from: '2025-01', to: '2025-12' })
  assert.equal(none.visits.length, 0)
  assert.equal((await terminalVisits(q, S, 'no-such-terminal', { from: '2026-01', to: '2026-06' })), null)
  assert.ok((await terminalVisits(q, S, 'wa-bp-cherry-point', { from: 'x', to: 'y' })).error)
  // The GFW labels a fetcher would ask for at Cherry Point (only labels already seen in stored visits).
  assert.deepEqual((await terminalGfwLabels(q, S, 'wa-bp-cherry-point')).map((l) => l.label), ['usa-cherrypoint'])
})
