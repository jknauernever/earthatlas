/**
 * Fleets (migration 034, lib/ships/fleets.js) and the /whalewatch time module (src/whalewatch/timeline.js): pure tests,
 * no database, no network. Inputs are hand-built (labelled SYNTHETIC test data: shapes only, never shown anywhere).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memberProblems, FLEET_BASES } from '../fleets.js'
import { buildTimeline, positionAt, latestPosition, trailAt, homePort } from '../../../src/whalewatch/timeline.js'

const ok = { mmsi: '368026630', company: 'Western Prince Whale Watching', basis: 'fcc_licensee',
  source_label: 'FCC ship radio license (active)', source_url: 'https://wireless2.fcc.gov/UlsApp/UlsSearch/license.jsp?licKey=4009202' }

test('memberProblems: a complete member passes; each missing piece is named', () => {
  assert.deepEqual(memberProblems(ok), [])
  assert.deepEqual(memberProblems({ ...ok, mmsi: undefined, vessel_id: '1737559d-1de5-4f0e-abf4-73fea7118da0' }), [])
  assert.match(memberProblems({ ...ok, mmsi: '12' }).join(), /mmsi/)
  assert.match(memberProblems({ ...ok, company: ' ' }).join(), /company/)
  assert.match(memberProblems({ ...ok, basis: 'hunch' }).join(), /basis/)
  assert.match(memberProblems({ ...ok, source_url: 'fcc.gov' }).join(), /source_url/)
  assert.match(memberProblems({ ...ok, basis: 'manual' }).join(), /note/)
  assert.deepEqual(memberProblems({ ...ok, basis: 'manual', note: 'Operator confirmed by phone' }), [])
  assert.deepEqual(FLEET_BASES, ['fcc_licensee', 'tc_registered_owner', 'operator_website', 'manual'])
})

// SYNTHETIC: two tracks of one boat on one day, then a third the next day; times in epoch seconds.
const day = Date.parse('2026-08-15T00:00:00Z') / 1000
const HARBOR = [-123.016, 48.537]
const feats = [
  { geometry: { coordinates: [HARBOR, [-123.05, 48.55], [-123.1, 48.56]] }, properties: { t0: day + 16 * 3600, t1: day + 18 * 3600, ts: [day + 16 * 3600, day + 17 * 3600, day + 18 * 3600] } },
  { geometry: { coordinates: [[-123.1, 48.56], [-123.05, 48.55], HARBOR] }, properties: { t0: day + 19 * 3600, t1: day + 21 * 3600 } },
  { geometry: { coordinates: [HARBOR, [-123.0, 48.6]] }, properties: { t0: day + 40 * 3600, t1: day + 41 * 3600 } },
]

test('timeline: exact vertex times kept, other lines spread by distance; positions inside, held, and too old', () => {
  const segs = buildTimeline(feats)
  assert.equal(segs.length, 3)
  assert.equal(segs[0].exact, true)
  assert.equal(segs[1].exact, false)
  const mid = positionAt(segs, day + 17 * 3600)
  assert.deepEqual(mid.lngLat, [-123.05, 48.55])
  assert.equal(mid.moving, true)
  assert.ok(mid.kn > 0 && mid.kn < 10)                       // ~2.7 km in an hour ≈ 1.5 kn
  const held = positionAt(segs, day + 23 * 3600)            // after the day's last track: tied up at its end
  assert.deepEqual(held.lngLat, HARBOR)
  assert.equal(held.moving, false)
  assert.equal(held.at, day + 21 * 3600)
  assert.equal(positionAt(segs, day + 10 * 3600), null)     // before anything
  assert.equal(positionAt(segs, day + 41 * 3600 + 25 * 3600, 24 * 3600), null)   // nothing for over a day: not shown
  assert.equal(latestPosition(segs).at, day + 41 * 3600)
})

test('trailAt: the hours before T, cut at both ends', () => {
  const segs = buildTimeline(feats)
  const tr = trailAt(segs, day + 17.5 * 3600, 1)
  assert.equal(tr.length, 1)
  assert.ok(tr[0][0][0] < -123.0 && tr[0][0][0] > -123.05)                // starts inside segment 1, half an hour back
  assert.ok(tr[0].length >= 2)
  assert.deepEqual(trailAt(segs, day + 30 * 3600, 3), [])    // overnight: no movement, no trail
})

test('homePort: the most common end-of-day spot, named after the nearest port within reach', () => {
  const segs = buildTimeline(feats)
  const ports = [{ geometry: { coordinates: [-123.017, 48.538] }, properties: { i: 1725, n: 'Friday Harbor' } },
    { geometry: { coordinates: [-122.61, 48.51] }, properties: { i: 9, n: 'Anacortes' } }]
  const h = homePort(segs, ports)
  assert.equal(h.name, 'Friday Harbor')
  assert.equal(h.days, 2)
  assert.equal(h.nights, 1)                                 // day 1 ends in the harbor; day 2 ends out at sea
  assert.equal(homePort(segs, [ports[1]]).name, null)       // no port within 6 km: unnamed, with its spot
})
