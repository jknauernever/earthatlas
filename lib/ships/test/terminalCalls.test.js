/**
 * Terminal calls from our own AIS (pure; offline): berth length / radius, the stopped-near-a-berth point rule, and the call
 * splitting (gap > 6 h = new call, keep >= 15 min). Fixture: REAL MarineCadastre rows (fixtures/README.md, "Terminal calls"),
 * MERCURY XVIII at Alliance Grain / Lantic, Vancouver, 2025-07-15/16. Points built by hand are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { berthLengthM, berthLength, berthLengthOf, berthRadiusM, stoppedHits, splitCalls, callSplitter, coveredMonths, inAisBox, CALL_RULE } from '../terminalCalls.js'
import { fixture } from './scenarios.js'

const fx = fixture('mc-ais-terminal-calls-alliance-grain-2025-07-15.json')
const iso = (t) => new Date(t).toISOString().replace('.000Z', 'Z')

test('berth length from the official records (REAL BC Ports and Terminals descriptions, USACE BERTHING_LARGEST)', () => {
  assert.equal(berthLengthM('Main dock 91.4 m long, 305 m between extreme mooring dolphins, depth 11 m for vessels up to 250 m in length'), 305)
  assert.equal(berthLengthM('Outer berth: 122 m length, depth 8.9 m with mooring dolphins'), 122)
  assert.equal(berthLengthM('#1: length 350 m, depth 22.9 m; #2: length 263 m, depth 19.4 m; rail access and capacity'), 350)
  assert.equal(berthLengthM('length 85 m (216 m between mooring buoys), limiting draft 12.5 m'), 216)
  assert.equal(berthLengthM('length 122 m, width 18 m, depth 10.2 m'), 122)
  assert.equal(berthLengthM('depth 14.0 m'), null)
  assert.equal(berthLengthM('Berth depths: #1:13.7 m; #2:11.2 m'), null)
  assert.deepEqual(berthLength({ usaceBerthingLargestFt: '1000' }), { m: 305, from: 'USACE BERTHING_LARGEST (ft)' })
  assert.equal(berthRadiusM(null), 150)
  assert.equal(berthRadiusM(122), 150, 'a short berth keeps the 150 m default')
  assert.equal(berthRadiusM(305), 203)
  assert.equal(berthRadiusM(900), 300, 'capped')
})

test('one numbered berth\'s official length (REAL BC Ports and Terminals descriptions: Westshore, Neptune, Viterra, Vancouver Wharves)', () => {
  const westshore = '#1: length 350 m, depth 22.9 m; #2: length 263 m, depth 19.4 m; rail access and capacity'
  assert.equal(berthLengthOf(westshore, '#1'), 350)
  assert.equal(berthLengthOf(westshore, '#2'), 263)
  assert.equal(berthLengthOf(westshore, '#3'), null, 'a berth the description does not list')
  const neptune = 'Berth #1: length 230 m, depth 15.24 m with floating dolphin; #2: length 230 m, depth 13.7 m with bollards; #3: length 100 m with mooring bollards depth 13 m'
  assert.equal(berthLengthOf(neptune, '#1'), 230)
  assert.equal(berthLengthOf(neptune, '3'), 100)
  assert.equal(berthLengthOf('Berth #1: length 185 m, depth 9.6 m, lay berth;  #2: length 215 m, depth 13.7 m, loading berth;  #4: length 305 m, depth 10.2 m', '#4'), 305)
  assert.equal(berthLengthOf('Berth depths: #1:13.7 m; #2:11.2 m', '#1'), null, 'a depth is not a length')
  assert.equal(berthLengthOf(null, '#1'), null)
  assert.equal(berthLengthOf(westshore, 'West'), null, 'only numbered berths are matched')
})

test('the AIS box: Woodfibre / Squamish (north of 49.6) are not covered; Shellburn is', () => {
  assert.equal(inAisBox(49.2893, -122.964), true)
  assert.equal(inAisBox(49.67, -123.25), false)
})

test('point rule (REAL rows): stopped only (sog < 0.5), within the radius, nearest berth wins, duplicates once', () => {
  const hits = stoppedHits(fx.rows, fx.berths)
  assert.ok(hits.every((h) => h.mmsi === '316040971'))
  // sog exactly 0.5 is not stopped (07-15 00:44:44).
  assert.ok(!hits.some((h) => iso(h.p.t) === '2025-07-15T00:44:44Z'))
  // Moored at Lantic's berth (~60 m) while also inside Alliance Grain's 157 m radius? No: 160+ m from bcpt-251, so Lantic only.
  const h0332 = hits.find((h) => iso(h.p.t) === '2025-07-15T03:32:04Z')
  assert.equal(h0332.terminal, 'bc-lantic'); assert.equal(h0332.p.also, null)
  // 07-15 13:10:19: 130 m from Alliance Grain but 37 m from Lantic → Lantic, with Alliance Grain recorded, never both.
  const h1310 = hits.find((h) => iso(h.p.t) === '2025-07-15T13:10:19Z')
  assert.equal(h1310.terminal, 'bc-lantic'); assert.deepEqual(h1310.p.also, ['bc-alliance-grain'])
  // MarineCadastre repeats 07-15 05:02:04 exactly: one hit.
  assert.equal(hits.filter((h) => iso(h.p.t) === '2025-07-15T05:02:04Z').length, 1)
})

test('call splitting (REAL rows): a 5 h silence stays one call, > 6 h starts a new one, < 15 min is dropped', () => {
  const hits = stoppedHits(fx.rows, fx.berths).filter((h) => h.terminal === 'bc-alliance-grain')
  const calls = splitCalls(hits.map((h) => h.p))
  // Stops at Alliance Grain: 00:47:50–01:01:53 (14 min 3 s: dropped); 07:24:43–07:49:43 then 12:48:14 (4 h 58 min later:
  // same call); 20:15:17–20:16:43 (7 h 27 min later: new call, 1.5 min: dropped); 07-16 12:48:54 … 18:48:45 (gaps 1 h 47,
  // 3 h 54: one call). The same two calls, with the same point counts, the DuckDB bake produced for this MMSI (terminal-calls.mjs import --dry-run).
  assert.deepEqual(calls.map((c) => [iso(c.t0), iso(c.t1), c.n]), [
    ['2025-07-15T07:24:43Z', '2025-07-15T12:48:14Z', 8],
    ['2025-07-16T12:48:54Z', '2025-07-16T18:48:45Z', 6], // 12:56:24 is 2 m nearer Lantic's berth, so it goes there
  ])
  assert.equal(calls[0].name, 'MERCURY XVIII')
  assert.equal(calls[0].type, 67, 'AIS reported type, as broadcast')
  assert.equal(calls[0].berth, 'bcpt-251')
  assert.deepEqual(calls[0].also, ['bc-lantic'], 'every stopped position here is also inside Lantic’s radius')
  assert.ok(calls[0].minM >= 130 && calls[0].minM <= 131)
})

test('streaming splitter = splitCalls per (terminal, mmsi) group (REAL rows, sorted as hits.csv is)', () => {
  const hits = stoppedHits(fx.rows, fx.berths).sort((a, b) => a.terminal.localeCompare(b.terminal) || a.p.t - b.p.t)
  const out = []
  const s = callSplitter((c) => out.push(c))
  for (const h of hits) s.push(h.terminal, h.mmsi, h.p)
  s.end()
  const byT = (t) => splitCalls(hits.filter((h) => h.terminal === t).map((h) => h.p))
  assert.deepEqual(out.filter((c) => c.terminal === 'bc-alliance-grain').map(({ terminal, mmsi, ...c }) => c), byT('bc-alliance-grain'))
  assert.deepEqual(out.filter((c) => c.terminal === 'bc-lantic').map(({ terminal, mmsi, ...c }) => c), byT('bc-lantic'))
  assert.ok(out.every((c) => c.mmsi === '316040971'))
})

test('SYNTHETIC points: exactly 6 h apart is still one call; exactly 15 min is kept', () => {
  const t = Date.parse('2026-01-01T00:00:00Z'), p = (min) => ({ t: t + min * 60e3, m: 50, berth: 'b' })
  assert.equal(splitCalls([p(0), p(15)]).length, 1)
  assert.equal(splitCalls([p(0), p(14.9)]).length, 0)
  assert.equal(splitCalls([p(0), p(15), p(15 + 360), p(15 + 375)]).length, 1)
  assert.equal(splitCalls([p(0), p(15), p(15 + 361), p(15 + 376)]).length, 2)
  assert.equal(CALL_RULE.gapHours, 6)
})

test('months: covered vs no AIS yet (never zero)', () => {
  assert.deepEqual(coveredMonths(['2026-05', '2026-06', '2026-07'], ['2026-05', '2026-06']), { covered: ['2026-05', '2026-06'], missing: ['2026-07'] })
})
