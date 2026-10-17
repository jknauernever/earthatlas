/**
 * /api/whales request parsing and WHERE building — pure, no database.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseWhaleQuery, whereFor } from '../query.js'

const P = (qs) => parseWhaleQuery(new URLSearchParams(qs), '2026-10-17')

test('parse: area, dates, defaults', () => {
  const a = P('bbox=-125,47,-122,49.5')
  assert.equal(a.ok, true)
  assert.deepEqual(a.q.bbox, [-125, 47, -122, 49.5])
  assert.equal(a.q.to, '2026-10-17')
  assert.equal(a.q.from, '2026-09-18', 'default = last 30 days')
  assert.deepEqual(a.q.groups, ['cetacean'], 'default group without a taxon')
  assert.equal(a.q.limit, 500)
  const b = P('lat=47.6&lng=-122.4&radius_km=25&from=2026-10-01&to=2026-10-05&limit=99999')
  assert.deepEqual(b.q.point, { lat: 47.6, lng: -122.4, r: 25 })
  assert.equal(b.q.limit, 2000)
})

test('parse: a taxon alone means worldwide, and the taxon decides the group', () => {
  const t = P('taxon=41521')
  assert.equal(t.ok, true)
  assert.equal(t.q.bbox, undefined)
  assert.equal(t.q.groups, null)
  assert.deepEqual(P('taxon=41521&group=pinniped').q.groups, ['pinniped'])
  assert.equal(P('bbox=-1,-1,1,1&group=all').q.groups, null)
})

test('parse: rejects bad input', () => {
  assert.equal(P('').ok, false)
  assert.equal(P('bbox=1,2,3').ok, false)
  assert.equal(P('bbox=0,10,1,5').ok, false)
  assert.equal(P('lat=91&lng=0').ok, false)
  assert.equal(P('lat=0&lng=0&radius_km=900').ok, false)
  assert.equal(P('taxon=1&from=2026-10-05&to=2026-10-01').ok, false)
  assert.equal(P('taxon=1&from=2010-01-01&to=2026-10-01').ok, false)
  assert.equal(P('taxon=1&from=yesterday').ok, false)
})

test('parse: unknown sources/groups are ignored, not passed to SQL', () => {
  const q = P('bbox=-1,-1,1,1&sources=maplify,evil;drop&exclude=nope&group=cetacean,bogus').q
  assert.deepEqual(q.sources, ['maplify'])
  assert.equal(q.exclude, null)
  assert.deepEqual(q.groups, ['cetacean'])
})

test('where: antimeridian bbox, point radius, taxon subtree — all parameterized', () => {
  const am = whereFor(P('bbox=170,-50,-170,-30').q, 'whales')
  assert.match(am.where, /s\.lon >= \$\d+ OR s\.lon <= \$\d+/)
  const pt = whereFor(P('lat=47.6&lng=-122.4&radius_km=10').q, 'whales')
  assert.match(pt.where, /ST_DWithin/)
  assert.ok(pt.params.includes(10000))
  const tx = whereFor(P('taxon=152871').q, 'whales')
  assert.match(tx.where, /= ANY\(ancestor_ids\)/)
  assert.ok(!/152871/.test(tx.where), 'values never inlined')
})
