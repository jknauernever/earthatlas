/**
 * Port card, pure logic (offline). Inputs are REAL responses recorded live 2026-09-27
 * (fixtures/portcard-live-2026-09-27.json, see fixtures/README.md); cases marked SYNTHETIC are built here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCardWindow, fetchIsFresh, matchingFetch, labelsInEvents, mapPwPort, pickPortWatch, smoothDaily, portWatchWindow, nextMonth,
  MAX_MONTHS, PW_JOIN_KM, PORTWATCH_SOURCE,
} from '../portCard.js'
import { gfwClient } from '../../../scripts/ships/gfwClient.js'
import { fixture } from './scenarios.js'

const fx = fixture('portcard-live-2026-09-27.json')
const NOW = new Date('2026-09-27T08:00:00Z')

test('parseCardWindow: the map selection, capped to 12 months and to today; the listed month defaults to the latest', () => {
  const w = parseCardWindow('2025-07', '2026-06', null, NOW)
  assert.deepEqual([w.from, w.to, w.month, w.monthFrom, w.monthTo, w.months.length], ['2025-07-01', '2026-07-01', '2026-06', '2026-06-01', '2026-07-01', 12])
  assert.equal(parseCardWindow('2025-07', '2026-06', '2025-09', NOW).month, '2025-09')
  assert.equal(parseCardWindow('2025-07', '2026-06', '2024-01', NOW).month, '2026-06', 'a month outside the window falls back to the latest')
  const long = parseCardWindow('2020-01', '2026-06', null, NOW)
  assert.equal(long.months.length, MAX_MONTHS); assert.equal(long.from, '2025-07-01'); assert.equal(long.capped, true)
  const cur = parseCardWindow('2026-09', '2027-02', null, NOW)
  assert.deepEqual([cur.from, cur.to, cur.monthTo], ['2026-09-01', '2026-09-28', '2026-09-28'], 'never past tomorrow (UTC)')
  assert.equal(parseCardWindow('2026-06', '2025-07', null, NOW).from, '2025-07-01', 'reversed range is reordered')
  assert.ok(parseCardWindow('2011-12', '2012-02', null, NOW).error)
  assert.ok(parseCardWindow('2026-13', null, null, NOW).error)
  assert.ok(parseCardWindow('2027-01', null, null, NOW).error)
  assert.equal(nextMonth('2025-12'), '2026-01')
})

test('fetchIsFresh / matchingFetch: 24 h; a settled window for good; same labels + window only', () => {
  const row = (o) => ({ kind: 'events', status: 'succeeded', port_labels: ['usa-seattle'], range_from: '2026-06-01', range_to: '2026-07-01', ...o })
  assert.equal(fetchIsFresh(row({ finished_at: '2026-09-27T01:00:00Z' }), NOW), true)
  assert.equal(fetchIsFresh(row({ finished_at: '2026-09-10T01:00:00Z' }), NOW), true, 'June was settled when fetched in September')
  assert.equal(fetchIsFresh(row({ finished_at: '2026-08-10T01:00:00Z' }), NOW), true, 'settled when fetched: kept for good (Josh 2026-09-27)')
  assert.equal(fetchIsFresh(row({ finished_at: '2026-07-05T01:00:00Z' }), NOW), false, 'fetched before June had settled, and older than 24 h')
  assert.equal(fetchIsFresh(row({ range_from: '2026-09-01', range_to: '2026-09-27', finished_at: '2026-09-25T01:00:00Z' }), NOW), false, 'the current month is not settled')
  assert.equal(fetchIsFresh(row({ status: 'failed', finished_at: '2026-09-27T01:00:00Z' }), NOW), false)
  const log = [row({ id: 1, finished_at: '2026-09-20T00:00:00Z' }), row({ id: 2, finished_at: '2026-09-26T00:00:00Z' }),
    row({ id: 3, port_labels: ['usa-tacoma'], finished_at: '2026-09-27T00:00:00Z' }), row({ id: 4, kind: 'stats', finished_at: '2026-09-27T00:00:00Z' })]
  assert.equal(matchingFetch(log, { kind: 'events', labels: ['usa-seattle'], from: '2026-06-01', to: '2026-07-01' }, NOW).id, 2)
  assert.equal(matchingFetch(log, { kind: 'events', labels: ['usa-seattle', 'usa-x'], from: '2026-06-01', to: '2026-07-01' }, NOW), null)
  // The current month's end moves daily: yesterday's fetch (to = today) still answers within 24 h.
  const cur = [row({ id: 5, range_from: '2026-09-01', range_to: '2026-09-27', finished_at: '2026-09-26T23:00:00Z' })]
  assert.equal(matchingFetch(cur, { kind: 'events', labels: ['usa-seattle'], from: '2026-09-01', to: '2026-09-28' }, NOW).id, 5)
})

test('labelsInEvents: the intermediate anchorage label of each event (REAL geometry response, Anacortes Aug 2026)', () => {
  const l = labelsInEvents(fx.gfw_geometry_anacortes_2026_08.body.entries)
  assert.deepEqual(l.map((x) => [x.label, x.visits]), [['usa-anacortes', 20]])
})

test('PortWatch join: same UN/LOCODE, one PortWatch port, within 25 km, nearest of the WPI ports sharing the code (REAL ports)', () => {
  const pw = fx.portwatch_ports.body.features.map((f) => mapPwPort(f).row)
  assert.equal(pw.find((p) => p.portid === 'port931').locode, null, 'Port Angeles has no LOCODE in PortWatch')
  const seattle = { id: 1, unlocode: 'US SEA', lat: 47.600000000000080, lon: -122.33333299999998 } // WPI 17730
  const j = pickPortWatch(seattle, pw)
  assert.equal(j.status, 'joined'); assert.equal(j.pw.portid, 'port1175'); assert.ok(j.km > 3 && j.km < 3.5)
  assert.equal(pickPortWatch({ unlocode: 'US FRD', lat: 48.53, lon: -123.02 }, pw).status, 'not_covered')
  assert.equal(pickPortWatch({ unlocode: null }, pw).status, 'no_locode')
  assert.deepEqual(pickPortWatch({ unlocode: 'TR BOT', lat: 36.9, lon: 36.2 }, pw), { status: 'ambiguous', candidates: ['port162', 'port163'] })
  // SYNTHETIC positions: a WPI port far from the PortWatch port, and a second WPI port with the same code that is nearer.
  assert.equal(pickPortWatch({ unlocode: 'US SEA', lat: 47.6 + (PW_JOIN_KM + 5) / 111, lon: -122.3458 }, pw).status, 'too_far')
  const peers = [seattle, { id: 2, unlocode: 'US SEA', lat: 47.5720, lon: -122.3457 }]
  assert.equal(pickPortWatch(seattle, pw, peers).status, 'other_wpi_nearer')
  assert.equal(pickPortWatch(peers[1], pw, peers).status, 'joined')
})

test('smoothDaily: trailing 7-day means, ≥ 4 days required (REAL PortWatch rows, Anacortes June 2026)', () => {
  const rows = fx.portwatch_daily_port47_2026_06.body.features.map((f) => f.attributes)
  const s = smoothDaily(rows, ['portcalls', 'import'])
  assert.equal(s.length, 30)
  assert.equal(s[0].date, '2026-06-01'); assert.equal(s[2].portcalls7, null, 'three days are not enough')
  const mean = (k, i) => Math.round((rows.slice(i - 6, i + 1).reduce((a, r) => a + r[k], 0) / 7) * 100) / 100
  assert.equal(s[6].portcalls7, mean('portcalls', 6))
  assert.equal(s[20].import7, mean('import', 20))
  assert.equal(s[3].portcalls7, Math.round((rows.slice(0, 4).reduce((a, r) => a + r.portcalls, 0) / 4) * 100) / 100)
  // SYNTHETIC: duplicated and out-of-order days are deduplicated and sorted.
  assert.deepEqual(smoothDaily([{ date: '2026-01-02', x: 2 }, { date: '2026-01-01', x: 1 }, { date: '2026-01-02', x: 3 }], ['x']).map((r) => r.x), [1, 3])
})

test('portWatchWindow: clamped to PortWatch\'s first day (2019-01-01)', () => {
  assert.deepEqual(portWatchWindow({ from: '2018-06-01', to: '2019-03-01' }), { from: '2019-01-01', to: '2019-03-01' })
  assert.equal(portWatchWindow({ from: '2017-01-01', to: '2018-01-01' }), null)
})

test('PortWatch source carries the FAQ\'s required citation and is non-commercial', () => {
  assert.equal(PORTWATCH_SOURCE.attribution_text, 'Sources: Kpler; UN Global Platform; IMF PortWatch (portwatch.imf.org).')
  assert.equal(PORTWATCH_SOURCE.commercial_use, false)
})

test('gfwClient port requests: GET port-ids[] + START-DATE; stats and geometry are POST bodies (no network)', async () => {
  const seen = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    return { ok: true, headers: { get: () => null }, json: async () => ({ entries: [] }) }
  }
  try {
    const g = gfwClient('test-token', { minIntervalMs: 0, log: () => {} })
    await g.portEvents({ portIds: ['usa-seattle', 'usa-tacoma'], from: '2026-06-01', to: '2026-07-01', offset: 1000 })
    await g.portStats({ portIds: ['usa-seattle'], from: '2025-07-01', to: '2026-07-01' })
    await g.eventsInPolygon({ geometry: { type: 'Polygon', coordinates: [] }, from: '2026-06-01', to: '2026-07-01' })
  } finally { globalThis.fetch = realFetch }
  const u = new URL(seen[0].url)
  assert.equal(u.pathname, '/v3/events'); assert.equal(seen[0].method, 'GET')
  assert.equal(u.searchParams.get('port-ids[0]'), 'usa-seattle'); assert.equal(u.searchParams.get('port-ids[1]'), 'usa-tacoma')
  assert.equal(u.searchParams.get('time-filter-mode'), 'START-DATE'); assert.equal(u.searchParams.get('offset'), '1000')
  assert.equal(new URL(seen[1].url).pathname, '/v3/events/stats'); assert.equal(seen[1].method, 'POST')
  assert.deepEqual(seen[1].body.portIds, ['usa-seattle']); assert.equal(seen[1].body.timeFilterMode, 'START-DATE'); assert.equal(seen[1].body.timeseriesInterval, 'MONTH')
  assert.equal(seen[2].method, 'POST'); assert.equal(new URL(seen[2].url).searchParams.get('sort'), '-start'); assert.ok(seen[2].body.geometry)
})
