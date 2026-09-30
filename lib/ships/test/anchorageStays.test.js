/**
 * Anchorage stays from our own AIS (pure; offline): coverage, overlap priority, polygon edges, and the stay splitting (gap > 6 h
 * = new stay, keep >= 60 min). Fixtures: REAL anchorages from the dev DB (anchorage-aliases-dev-2026-09-30.json) and REAL
 * MarineCadastre rows at Vendovi South (mc-ais-anchorage-vendovi-south.json; fixtures/README.md "Anchorage stays").
 * Points built by hand are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aisCoverage, bakeAnchorages, polygonEdges, splitStays, staySplitter, stayDays, summarizeStays, STAY_RULE } from '../anchorageStays.js'
import { pointInGeometry } from '../anchorages.js'
import { fixture } from './scenarios.js'

const fx = fixture('anchorage-aliases-dev-2026-09-30.json')
const mc = fixture('mc-ais-anchorage-vendovi-south.json')
const VS = 'uscg-vts-ps-nondesignated|(a)(15)(i)'
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z')
const H = 3600e3

test('coverage and overlap priority (REAL anchorages): designated before DFO before non-designated, then smaller', () => {
  const list = bakeAnchorages(fx.anchorages)
  const vs = list.find((a) => a.key === VS)
  assert.equal(vs.coverage, 'covered', 'Vendovi South lies inside the salish-v6 box')
  assert.equal(aisCoverage({ min_lat: 29.9, max_lat: 30, min_lon: -90.1, max_lon: -90 }), 'none', 'a Gulf anchorage is outside')
  assert.equal(aisCoverage({ min_lat: 49.5, max_lat: 49.7, min_lon: -123, max_lon: -122.9 }), 'partial')
  const rank = (k) => list.find((a) => a.key === k).priority
  const designated = list.find((a) => a.legal_status === 'designated'), dfo = list.find((a) => a.legal_status === 'active_listed')
  assert.ok(rank(designated.key) < rank(dfo.key) && rank(dfo.key) < rank(VS))
})

test('polygon edges reproduce the polygon (REAL Vendovi South, even-odd rule)', () => {
  const a = fx.anchorages.find((x) => `${x.source_id}|${x.source_key}` === VS)
  const edges = polygonEdges(VS, a.geometry)
  assert.equal(edges.length, a.geometry.coordinates[0].length - 1)
  // The bake's crossing count (anchorage_stays.py) for a point = the same rule as pointInGeometry.
  const inside = (lat, lon) => edges.filter((e) => e.y1 !== e.y2 && lat >= Math.min(e.y1, e.y2) && lat < Math.max(e.y1, e.y2)
    && lon < ((e.x2 - e.x1) * (lat - e.y1)) / (e.y2 - e.y1) + e.x1).length % 2 === 1
  for (const r of mc.rows) assert.equal(inside(r.latitude, r.longitude), pointInGeometry(a.geometry, r.latitude, r.longitude), `${r.mmsi} ${r.base_date_time}`)
})

test('REAL MarineCadastre rows at Vendovi South → the stays the bake counted', () => {
  const a = fx.anchorages.find((x) => `${x.source_id}|${x.source_key}` === VS)
  const seen = new Set(), pts = new Map()
  for (const r of mc.rows) {
    if (!(r.sog < STAY_RULE.sogKn) || !pointInGeometry(a.geometry, r.latitude, r.longitude)) continue
    const t = Date.parse(`${r.base_date_time.replace(' ', 'T')}Z`)
    if (seen.has(`${r.mmsi}|${t}`)) continue
    seen.add(`${r.mmsi}|${t}`)
    const l = pts.get(r.mmsi) || pts.set(r.mmsi, []).get(r.mmsi)
    l.push({ t, also: null, name: r.vessel_name, imo: r.imo, type: r.vessel_type, length: r.length })
  }
  const got = []
  const sp = staySplitter((s) => got.push(s))
  for (const [mmsi, ps] of [...pts].sort()) for (const p of ps.sort((x, y) => x.t - y.t)) sp.push(VS, String(mmsi), p)
  sp.end()
  assert.deepEqual(got.map((s) => ({ mmsi: s.mmsi, t0: iso(s.t0), t1: iso(s.t1), n: s.n, name: s.name, type: s.type, length: s.length })), mc.expected)
})

test('SYNTHETIC points: a gap of more than 6 h starts a new stay; exactly 6 h does not; stays under 60 min are dropped', () => {
  const t0 = Date.UTC(2025, 7, 14, 0, 0)
  const p = (h, name = 'X') => ({ t: t0 + h * H, also: null, name, imo: null, type: 80, length: 180 })
  const s = splitStays([p(0), p(0.5), p(1), p(7), p(7.5), p(13.6), p(13.9), p(14.1)])
  assert.deepEqual(s.map((x) => [(x.t0 - t0) / H, (x.t1 - t0) / H]), [[0, 7.5]], 'a 6 h gap continues; 6.1 h splits; the 0.5 h tail is dropped')
  assert.equal(splitStays([p(0), p(0.99)]).length, 0, '59.4 minutes is not a stay')
  assert.equal(splitStays([p(0), p(1)]).length, 1, 'exactly 60 minutes is')
  assert.equal(splitStays([p(0, 'A'), p(0.5, 'B'), p(1, 'B')])[0].name, 'B', 'the name broadcast most often')
})

test('SYNTHETIC rows: summary counts stays, ships, ship-hours, UTC days; months without AIS are null, not 0', () => {
  const rows = [
    { mmsi: '1', t0: '2025-08-14T22:00:00Z', t1: '2025-08-15T02:00:00Z', ais_vessel_type: 80, ais_name: 'A' },
    { mmsi: '1', t0: '2025-08-20T10:00:00Z', t1: '2025-08-20T12:00:00Z', ais_vessel_type: 80, ais_name: 'A' },
    { mmsi: '2', t0: '2025-08-01T00:00:00Z', t1: '2025-08-01T01:00:00Z', ais_vessel_type: 52, ais_name: 'T' },
  ]
  const r = summarizeStays(rows, ['2025-08', '2025-09'], ['2025-08'])
  assert.equal(r.summary.stays, 3)
  assert.equal(r.summary.ships, 2)
  assert.equal(r.summary.hours, 7)
  assert.deepEqual(r.summary.perMonth, [{ month: '2025-08', n: 3 }, { month: '2025-09', n: null }])
  assert.equal(r.top[0].mmsi, '1')
  assert.equal(r.top[0].days, 3, 'a stay across midnight counts both UTC days')
  assert.deepEqual(r.summary.kinds.map((k) => [k.group, k.ships]).sort(), [['tanker', 1], ['tug_tow', 1]])
  assert.deepEqual(stayDays('2025-08-14T22:00:00Z', '2025-08-15T02:00:00Z'), ['2025-08-14', '2025-08-15'])
})
