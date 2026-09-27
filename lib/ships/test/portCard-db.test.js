/**
 * Port card, database tests. DEV database in SHIPS_DATABASE_URL, throwaway schema (ships_t_<random>) dropped
 * afterwards; never "ships", never production. Skipped (NOT RUN) without the URL. No network: GFW and PortWatch are
 * replayed from REAL responses recorded live 2026-09-27 (fixtures/portcard-live-2026-09-27.json) and the WPI / GeoNames
 * extracts of 2026-09-26 (fixtures/ports-live-2026-09-26.json). Cases marked SYNTHETIC are built here.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { shipsPool, withTx } from '../db.js'
import { migrate } from '../migrate.js'
import { ensurePortVisitSource, ingestPortVisitEvents } from '../portVisits.js'
import { ensurePortSources, ingestCountries, ingestWpiPorts, parseCountryInfo } from '../ports.js'
import {
  ensurePortCardSources, ingestPortWatchPorts, ensurePortCard, readPortCard, portsLayer, portAndLabels, savePortShip, parseCardWindow,
  DAILY_GFW_CALLS, PORTWATCH_SOURCE,
} from '../portCard.js'
import { fixture } from './scenarios.js'

const url = process.env.SHIPS_DATABASE_URL || ''
const skip = !url ? 'SHIPS_DATABASE_URL not set (NOT RUN)' : process.env.VERCEL_ENV === 'production' ? 'refusing in production' : false
const S = `ships_t_${randomBytes(4).toString('hex')}`
let pool
const q = async (text, params) => (await pool.query(text, params)).rows
const one = async (text, params) => (await q(text, params))[0]

const fx = fixture('portcard-live-2026-09-27.json')
const ports = fixture('ports-live-2026-09-26.json')
const NOW = new Date('2026-09-27T08:00:00Z')
const WIN = parseCardWindow('2025-07', '2026-06', null, NOW) // the map's default selection; lists June 2026
const EVENTS = fx.gfw_port_events_anacortes_2026_06
const DISC = fx.gfw_geometry_anacortes_2026_08

/** A GFW client that replays the recorded responses and counts calls (the real one's method names). */
function fakeGfw({ events = EVENTS.body } = {}) {
  const calls = []
  return {
    calls,
    async eventsInPolygon(a) { calls.push(['eventsInPolygon', a]); return { url: 'https://gateway.api.globalfishingwatch.org/v3/events?limit=1000&offset=0&sort=-start', body: DISC.body, datasets: null } },
    async portStats(a) { calls.push(['portStats', a]); return { url: fx.gfw_port_stats_anacortes_2025_07_2026_06.url, body: fx.gfw_port_stats_anacortes_2025_07_2026_06.body, datasets: null } },
    async portEvents(a) { calls.push(['portEvents', a]); return { url: EVENTS.url, body: events, datasets: EVENTS.datasets } },
    async byIds() { calls.push(['byIds']); return { url: 'x', body: { entries: [] } } },
  }
}
const fetchJson = (log) => async (u) => { log.push(u); return fx.portwatch_daily_port47_2026_06.body }
let anacortes, seattle

before(async () => {
  if (skip) return
  pool = shipsPool()
  await migrate(pool, S)
  await ensurePortVisitSource(pool, S)
  await ensurePortSources(pool, S)
  await ensurePortCardSources(pool, S)
  await withTx(pool, (c) => ingestCountries(c, S, parseCountryInfo([ports.countries.header, ...ports.countries.lines].join('\n'))))
  await withTx(pool, (c) => ingestWpiPorts(c, S, ports.wpi.ports))
  await withTx(pool, (c) => ingestPortWatchPorts(c, S, fx.portwatch_ports.body.features))
  anacortes = (await one(`SELECT id FROM ${S}.ports WHERE origin = 'wpi' AND wpi_number = 18040`)).id
  seattle = (await one(`SELECT id FROM ${S}.ports WHERE origin = 'wpi' AND wpi_number = 17730`)).id
})
after(async () => {
  if (skip) return
  await pool.query(`DROP SCHEMA ${S} CASCADE`)
  await pool.end()
})

test('migration 010: port_card_fetches exists; PortWatch registered with its required citation', { skip }, async () => {
  assert.ok((await one(`SELECT to_regclass('${S}.port_card_fetches') AS r`)).r)
  const src = await one(`SELECT license, attribution_text, commercial_use FROM ${S}.sources WHERE id = $1`, [PORTWATCH_SOURCE.id])
  assert.equal(src.attribution_text, 'Sources: Kpler; UN Global Platform; IMF PortWatch (portwatch.imf.org).')
  assert.equal(src.commercial_use, false)
  assert.equal(Number((await one(`SELECT count(*) AS n FROM ${S}.source_records WHERE source_id = $1`, [PORTWATCH_SOURCE.id])).n), 8)
})

test('ports layer: every WPI port, sized by harbour size', { skip }, async () => {
  const fc = await portsLayer(q, S)
  assert.equal(fc.features.filter((f) => f.properties.g === 0).length, ports.wpi.ports.length)
  const s = fc.features.find((f) => f.properties.i === Number(seattle))
  assert.deepEqual([s.properties.n, s.properties.s, s.geometry.coordinates], ['Seattle', 'L', [-122.33333, 47.6]])
})

test('first open of WPI Anacortes: discover the GFW label (1 call), then totals + June visits + PortWatch', { skip }, async () => {
  const gfw = fakeGfw(), pw = []
  const r = await ensurePortCard(pool, S, anacortes, { win: WIN, gfw, fetchJson: fetchJson(pw), now: NOW })
  assert.deepEqual([r.discover, r.stats, r.events, r.portwatch], ['fetched', 'fetched', 'fetched', 'fetched'])
  assert.deepEqual(gfw.calls.map((c) => c[0]).sort(), ['eventsInPolygon', 'portEvents', 'portStats'])
  assert.equal(r.calls.gfw, 3); assert.equal(pw.length, 1)
  // Discovery is one 4 km circle around the WPI position, for the listed month.
  const d = gfw.calls.find((c) => c[0] === 'eventsInPolygon')[1]
  assert.equal(d.from, '2026-06-01'); assert.equal(d.geometry.type, 'Polygon')
  // The label was named by the step-2 matcher (WPI within 4 km) and is now this port's alias.
  const pl = await portAndLabels(q, S, anacortes)
  assert.deepEqual(pl.labels.map((l) => [l.label, l.method]), [['usa-anacortes', 'wpi_within_4km']])
  const ev = gfw.calls.find((c) => c[0] === 'portEvents')[1]
  assert.deepEqual([ev.portIds, ev.from, ev.to], [['usa-anacortes'], '2026-06-01', '2026-07-01'])
  assert.ok(pw[0].includes("portid%3D%27port47%27"), 'PortWatch asked for the joined port only')
})

test('second open: everything fresh, zero outbound calls', { skip }, async () => {
  const gfw = fakeGfw(), pw = []
  const r = await ensurePortCard(pool, S, anacortes, { win: WIN, gfw, fetchJson: fetchJson(pw), now: NOW })
  assert.deepEqual([r.discover, r.stats, r.events, r.portwatch], ['none', 'fresh', 'fresh', 'fresh'])
  assert.equal(gfw.calls.length, 0); assert.equal(pw.length, 0)
})

test('the card, read from the database: totals, ships in June with their evidence, PortWatch series', { skip }, async () => {
  const c = await readPortCard(q, S, anacortes, { win: WIN, now: NOW })
  assert.equal(c.port.name, 'Anacortes'); assert.equal(c.port.harbor_size, 'S'); assert.equal(c.port.country_name, 'United States')
  assert.equal(c.stats.numEvents, fx.gfw_port_stats_anacortes_2025_07_2026_06.body.numEvents)
  assert.equal(c.stats.months.length, 12)
  assert.equal(c.stats.months.reduce((s, m) => s + m.n, 0), c.stats.numEvents, 'monthly series sums to the total')
  const jun = EVENTS.body.entries
  assert.equal(c.ships.arrivals, jun.length)
  assert.equal(c.ships.total, new Set(jun.map((e) => e.vessel.id)).size)
  assert.equal(c.ships.list.reduce((s, x) => s + x.calls, 0), jun.length)
  assert.equal(c.ships.gfwTotal, 180, 'GFW said 180 arrivals (the fixture keeps 25 of them)')
  const top = c.ships.list[0]
  assert.equal(top.calls, 2, 'the ship with two June arrivals first')
  const rec = await one(`SELECT source_id, payload FROM ${S}.source_records WHERE id = $1`, [top.recordId])
  assert.equal(rec.source_id, 'gfw-port-visits'); assert.equal(rec.payload.vessel.id, top.gfwId)
  assert.equal(c.portwatch.join, 'joined'); assert.equal(c.portwatch.portid, 'port47'); assert.equal(c.portwatch.days, 30)
  assert.equal(c.portwatch.lastDate, '2026-06-30')
  assert.equal(c.portwatch.totals.portcalls, fx.portwatch_daily_port47_2026_06.body.features.reduce((s, f) => s + f.attributes.portcalls, 0))
})

test('one GFW event = one piece of evidence, whoever asked (ship card or port card)', { skip }, async () => {
  const before = Number((await one(`SELECT count(*) AS n FROM ${S}.source_records WHERE source_id = 'gfw-port-visits'`)).n)
  const r = await withTx(pool, (c) => ingestPortVisitEvents(c, S, EVENTS.body.entries, { datasetVersion: 'public-global-port-visits-events:v4.0' }))
  assert.equal(r.recordsCreated, 0); assert.equal(r.visitsCreated, 0)
  assert.equal(Number((await one(`SELECT count(*) AS n FROM ${S}.source_records WHERE source_id = 'gfw-port-visits'`)).n), before)
})

test('a visit GFW stops returning for a complete port-month is kept, marked withdrawn', { skip }, async () => {
  // Settled months are kept for good (Josh 2026-09-27), so a re-pull is deliberate (force); GFW now returns all but the
  // first event (SYNTHETIC answer).
  await pool.query(`UPDATE ${S}.port_card_fetches SET finished_at = now() - interval '40 days' WHERE port_id = $1 AND kind = 'events'`, [anacortes])
  const gone = EVENTS.body.entries[0].id
  assert.equal((await ensurePortCard(pool, S, anacortes, { win: WIN, gfw: fakeGfw(), now: new Date() })).events, 'fresh', 'settled: not re-asked')
  const gfw = fakeGfw({ events: { ...EVENTS.body, entries: EVENTS.body.entries.slice(1) } })
  const r = await ensurePortCard(pool, S, anacortes, { win: WIN, gfw, now: new Date(), force: true })
  assert.equal(r.events, 'fetched')
  assert.equal((await one(`SELECT status FROM ${S}.port_visits WHERE event_id = $1`, [gone])).status, 'withdrawn')
})

test('Seattle (no GFW label yet, discovery finds only Anacortes\'s): card says so and lists Anacortes as nearby', { skip }, async () => {
  const gfw = fakeGfw()
  const r = await ensurePortCard(pool, S, seattle, { win: WIN, gfw, now: NOW })
  assert.equal(r.discover, 'fetched'); assert.equal(r.events, 'none')
  const c = await readPortCard(q, S, seattle, { win: WIN, now: NOW })
  assert.equal(c.labels.length, 0)
  assert.deepEqual(c.nearby.map((n) => n.label), ['usa-anacortes'])
  // Discovery is not repeated for 30 days.
  const again = await ensurePortCard(pool, S, seattle, { win: WIN, gfw: fakeGfw(), now: NOW })
  assert.equal(again.discover, 'fresh')
})

test('guardrail: past the daily GFW budget nothing is asked (SYNTHETIC log row)', { skip }, async () => {
  await pool.query(`INSERT INTO ${S}.port_card_fetches (port_id, kind, range_from, range_to, status, calls, finished_at)
                    VALUES ($1, 'stats', '2020-01-01', '2020-02-01', 'succeeded', $2, now())`, [seattle, DAILY_GFW_CALLS])
  const gfw = fakeGfw()
  const w = parseCardWindow('2025-01', '2025-03', null, NOW)
  const r = await ensurePortCard(pool, S, anacortes, { win: w, gfw, now: NOW })
  assert.deepEqual([r.stats, r.events], ['budget', 'budget'])
  assert.equal(gfw.calls.length, 0)
})

test('only our ports: unknown ids and unsaved GFW identities are refused', { skip }, async () => {
  assert.equal(await portAndLabels(q, S, 999999999), null)
  assert.equal(await portAndLabels(q, S, 'x'), null)
  const r = await ensurePortCard(pool, S, 999999999, { win: WIN, gfw: fakeGfw(), now: NOW })
  assert.equal(r.status, 'not_found')
  assert.deepEqual(await savePortShip(pool, S, 'not an id', fakeGfw()), { status: 'bad_id' })
  assert.deepEqual(await savePortShip(pool, S, '00000000a-0000-0000-0000-000000000000', fakeGfw()), { status: 'not_in_port_visits' })
  const listed = EVENTS.body.entries[3].vessel.id
  const gfw = fakeGfw()
  assert.equal((await savePortShip(pool, S, listed, gfw)).status, 'unknown', 'GFW returned no identity (replayed empty)')
  assert.deepEqual(gfw.calls.map((c) => c[0]), ['byIds'])
})
