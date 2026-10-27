import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nameRelation, pairFeatures, fitEM, weightsOf, scorePair, reasons, portRelation } from '../matchScore.js'

const rec = (o = {}) => ({ claims: 4, names: [], callsigns: [], imos: [], official: [], lengths: [], types: [], flags: [], mmsi: [], ...o })

test('name relation: typos, prefixes, numbered fleets and missing names', () => {
  assert.equal(nameRelation(['AHOLDFAST'], ['HOLDFAST']), 'typo')
  assert.equal(nameRelation(['SOTHERNBELLEII'], ['SOUTHERNBELLEII']), 'typo')
  assert.equal(nameRelation(['MISTYKII'], ['MISTYKIII']), 'different') // numbered fleet, never a typo
  assert.equal(nameRelation(['NAUTIOTTER2'], ['UNDAUNTED']), 'different')
  assert.equal(nameRelation(['SERENA'], []), 'one_missing')
  assert.equal(nameRelation([], []), 'both_missing')
})

test('features: GFW "passenger" and AIS pleasure craft are one family; dates sticking out are measured', () => {
  const m = '316022832'
  const a = rec({ claims: 12, names: ['SEALEVELII'], types: ['marinecadastre-ais:AIS_37'], mmsi: [{ mmsi: m, f: '2016-01-01', t: '2026-01-01' }] })
  const b = rec({ claims: 3, types: ['gfw-vessel-identity:PASSENGER'], mmsi: [{ mmsi: m, f: '2015-11-01', t: '2025-01-01' }] })
  const x = pairFeatures(a, b, m, { crowd: 2 })
  assert.deepEqual([x.type, x.name, x.window, x.fragment, x.crowd], ['agree', 'one_missing', 'out_le180d', 'small', '2'])
})

test('a fit from labels: agreement counts for, conflict against, missing never counts', () => {
  const same = { name: 'typo', callsign: 'agree', length: 'missing', type: 'agree', flag: 'agree', window: 'nested', fragment: 'small', crowd: '2' }
  const diff = { ...same, name: 'different', callsign: 'conflict', type: 'conflict', window: 'out_gt180d', crowd: '3-5' }
  const rows = [...Array(8)].map(() => ({ x: same, label: 1 })).concat([...Array(8)].map(() => ({ x: diff, label: 0 })))
  const w = weightsOf(fitEM(rows, { unlabeled: false }))
  assert.ok(w.callsign.agree > 0 && w.callsign.conflict < 0)
  assert.equal(w.length.missing, 0)
  const model = { lambda: 0.5, weights: w, bands: { probably: 0.9, separate: 0.1 } }
  const s = scorePair(same, model), d = scorePair(diff, model)
  assert.equal(s.band, 'merge') // typo + same call sign, nothing conflicting
  assert.equal(d.band, 'separate')
  assert.ok(reasons(s).some((r) => r.text === 'same call sign' && r.for))
})

test('a conflict keeps a pair out of "probably" however high the score', () => {
  const w = { name: { exact: 9, typo: 0, prefix: 0, different: 0, one_missing: 0, both_missing: 0 }, callsign: { agree: 0, conflict: -1, missing: 0 },
    length: { agree: 0, conflict: 0, missing: 0 }, type: { agree: 0, conflict: 0, missing: 0 }, flag: { agree: 0, conflict: 0, missing: 0 },
    window: { nested: 0, out_le180d: 0, out_gt180d: 0, disjoint: 0, missing: 0 }, fragment: { small: 0, larger: 0 }, crowd: { 2: 0, '3-5': 0 } }
  const x = { name: 'exact', callsign: 'conflict', length: 'missing', type: 'missing', flag: 'missing', window: 'missing', fragment: 'small', crowd: '2' }
  assert.equal(scorePair(x, { lambda: 0.5, weights: w }).band, 'unknown')
})

test('ports: two places at once beats sharing a port; one side unseen = missing', () => {
  const v = (who, s, e, port, lat, lon) => ({ who, s, e, port, lat, lon })
  // WAWA-like (dev pair 5 shape): St Petersburg FL vs Northeast Harbor ME, 2 hours apart → impossible.
  assert.equal(portRelation([v('A', '2014-03-17T18:00Z', '2014-03-18T00:00Z', 'NORTHEAST HARBOR', 44.3, -68.3), v('B', '2014-03-17T16:00Z', '2014-03-17T20:00Z', 'ST PETERSBURG', 27.8, -82.6)]), 'impossible')
  assert.equal(portRelation([v('A', '2020-01-01T00:00Z', '2020-01-05T00:00Z', 'ESQUIMALT', 48.43, -123.43), v('B', '2020-01-02T00:00Z', '2020-01-03T00:00Z', 'ESQUIMALT', 48.43, -123.43)]), 'together')
  assert.equal(portRelation([v('A', '2020-01-01T00:00Z', '2020-01-05T00:00Z', 'ESQUIMALT', 48.43, -123.43)]), 'missing')
})
