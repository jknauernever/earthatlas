/**
 * Anchorage aliases (pure; offline). Fixture: REAL dev-DB rows (fixtures/README.md, "Anchorage aliases"): nine Salish anchorages
 * and the Global Fishing Watch named points near them. Hand-made inputs are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasCandidates, sameName, nameWords, aliasNorm, isAbbreviation, ANCHORAGE_WORD, DECISIONS } from '../anchorageAliases.js'
import { fixture } from './scenarios.js'

const fx = fixture('anchorage-aliases-dev-2026-09-30.json')
const found = aliasCandidates(fx.anchorages, fx.points)
const at = (name) => found.filter((f) => f.anchorage_name === name)

test('names: generic words are not the name; abbreviations and anchorage words (pure)', () => {
  assert.deepEqual(nameWords('Vendovi East General Anchorage'), ['VENDOVI', 'EAST'])
  assert.equal(sameName('VENDOVI ANCHORAGE', 'Vendovi East General Anchorage'), true, 'a shorter form of the same name is not an alias')
  assert.equal(sameName('Anacortes', 'Vendovi South General Anchorage'), false)
  assert.equal(aliasNorm('North Beach Anchorage'), 'NORTHBEACHANCHORAGE')
  assert.equal(isAbbreviation('CA VAN'), true)
  assert.equal(isAbbreviation('BD FLT'), true)
  assert.equal(isAbbreviation('Anacortes'), false)
  assert.equal(ANCHORAGE_WORD.test('North Beach Anchorage'), true)
  assert.equal(ANCHORAGE_WORD.test('Tacoma'), false)
})

test('Vendovi South: GFW files cell 54859d89 (label USA-1547) under ANACORTES; accepted by Josh’s decision (REAL)', () => {
  const v = at('Vendovi South General Anchorage')
  const aka = v.find((f) => f.alias === 'Anacortes' && f.source_id === 'gfw-anchorage-overrides')
  assert.ok(aka, 'the reviewed-list row inside the polygon gives "Anacortes"')
  assert.equal(aka.method, 'gfw_override_group_inside')
  assert.equal(aka.distance_m, 0)
  assert.equal(aka.status, 'accepted')
  assert.equal(aka.detail.decided, DECISIONS[0].decided)
  assert.equal(aka.detail.point.s2, '54859d89')
  assert.equal(aka.detail.point.label, 'USA-1547', 'the cell’s own label is a code, never offered as a name')
  assert.ok(aka.source_record_id > 0, 'links to the reviewed-list row as received')
  assert.ok(!v.some((f) => /usa-?1547/i.test(f.alias)), 'no code is ever an alias')
  // EarthAtlas's own place hint for the same spot stays a candidate: it says where the place is, not its name.
  const hint = v.find((f) => f.method.startsWith('earthatlas_place_hint'))
  assert.ok(hint && hint.status === 'candidate' && hint.alias === 'Anacortes')
})

test('without the decision the same row is only a candidate: a port group is not a name (REAL)', () => {
  const v = aliasCandidates(fx.anchorages, fx.points, undefined, []).filter((f) => f.anchorage_name === 'Vendovi South General Anchorage' && f.method === 'gfw_override_group_inside')
  assert.equal(v.length, 1)
  assert.equal(v[0].status, 'candidate')
  assert.match(v[0].detail.why, /port group/)
})

test('clear case auto-accepted: GFW names a point inside Jack Island South “North Beach Anchorage” (REAL)', () => {
  const j = at('Jack Island South Tug and Barge Holding Area').find((f) => f.alias === 'North Beach Anchorage' && f.distance_m === 0)
  assert.ok(j)
  assert.equal(j.status, 'accepted')
  assert.equal(j.source_id, 'gfw-port-visits')
})

test('place names, shared names and near misses stay candidates (REAL)', () => {
  const tac = at('Commencement Bay').filter((f) => f.alias === 'Tacoma')
  assert.ok(tac.length && tac.every((f) => f.status === 'candidate'), 'Tacoma is a city, not the anchorage’s name')
  const nv = [...at('Vancouver Harbour Anchorage A'), ...at('Vancouver Harbour Anchorage B')].filter((f) => f.alias === 'North Vancouver' && f.distance_m === 0)
  assert.ok(nv.length >= 2 && nv.every((f) => f.status === 'candidate'))
  for (const f of found.filter((x) => x.distance_m > 0)) assert.equal(f.status, 'candidate', `${f.anchorage_name} ← ${f.alias} is outside the polygon`)
  assert.ok(!at('Vendovi East General Anchorage').some((f) => f.alias.toUpperCase() === 'VENDOVI ANCHORAGE'), 'GFW’s "VENDOVI ANCHORAGE" is the same name, not an alias')
})

test('USCG VTS manual p. 3-6: VIS / VIE accepted (same named area), bare codes and probable matches only candidates (REAL anchorages)', async () => {
  const { vtsManualAliases, VTS_MANUAL_PAGE } = await import('../anchorageAliases.js')
  const rows = vtsManualAliases(fx.anchorages, 1)
  const vis = rows.find((r) => r.anchorage_source_key === '(a)(15)(i)')
  assert.equal(vis.alias, 'Vendovi Island South (VIS)')
  assert.equal(vis.status, 'accepted')
  assert.equal(vis.source_id, 'uscg-vts-ps-users-manual')
  assert.equal(vis.detail.page, '3-6')
  assert.equal(vis.detail.decided, 'Josh 2026-09-30')
  assert.equal(rows.find((r) => r.anchorage_source_key === '(a)(15)(ii)').alias, 'Vendovi Island East (VIE)')
  assert.equal(VTS_MANUAL_PAGE.accessed, '2026-09-27')
  // Every accepted row is a 1:1 same-area pairing; nothing else in this fixture set is accepted.
  assert.deepEqual(rows.filter((r) => r.status === 'accepted').map((r) => r.method), ['vts_manual_same_area', 'vts_manual_same_area'])
  // SYNTHETIC anchorage list: a bare code is only ever a candidate.
  const eb = vtsManualAliases([{ source_id: 'noaa-mc-anchorages', source_key: '602', name: 'Elliott Bay East' }], 1)
  assert.deepEqual(eb.map((r) => [r.alias, r.status]), [['EBE', 'candidate']])
})
