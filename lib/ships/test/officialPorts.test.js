/**
 * Official port names / status (pure; offline). Fixture: REAL responses recorded live 2026-09-27
 * (fixtures/official-ports-live-2026-09-27.json): DFO Small Craft Harbours (3 layers, Salish box), 3 USACE Port Areas,
 * the two Transport Canada pages, law extracts, and WPI port objects as downloaded 2026-09-26.
 * Cases marked SYNTHETIC are built here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  nameWords, shareWord, mapDfoFeature, dfoOfficial, matchDfoHarbour, pointInRings, areasContaining, mapUsaceFeature,
  checkHandRows, esriQueryUrl, DFO_URL,
} from '../officialPorts.js'
import { mapWpiPort } from '../ports.js'
import { fixture } from './scenarios.js'

const fx = fixture('official-ports-live-2026-09-27.json')
const table = JSON.parse(readFileSync(new URL('../data/ca-official-ports.json', import.meta.url), 'utf8'))
const dfo = fx.dfo_layers.flatMap((l) => l.body.features.map((f) => mapDfoFeature(f, l.layer)))
const harbour = (name) => dfo.find((m) => m.harbour.name === name)?.harbour
// Our WPI ports from the recorded WPI objects (ids = WPI numbers here; iso3 as the ports table would carry it).
const wpi = fx.wpi.ports.map((p) => mapWpiPort(p).port).map((p) => ({ id: p.wpi_number, name: p.name, lat: p.lat, lon: p.lon, iso2: p.iso2,
  iso3: p.iso2 === 'CA' ? 'CAN' : 'USA', origin: 'wpi' }))

test('nameWords / shareWord: generic words never make a match', () => {
  assert.deepEqual(nameWords('Ganges (Inner Harbour)'), ['GANGES'])
  assert.equal(shareWord('Ganges (Inner Harbour)', 'Ganges'), true)
  assert.equal(shareWord('Cowichan Bay', 'Cowichan Bay'), true)
  assert.equal(shareWord('Oak Bay (Turkey Head) - Breakwater', 'CADBORO BAY'), false)
  assert.equal(shareWord('Tsehum Harbour (Shoal Harbour)', 'Sidney'), false)
  assert.equal(shareWord("Mcivor's Landing (Langley)", 'MCIVOR'), true)
})

test('mapDfoFeature: every recorded Salish harbour maps; raw feature kept as received; known data errors handled', () => {
  assert.equal(dfo.length, 57)
  assert.ok(dfo.every((m) => !m.error))
  assert.deepEqual(dfo[0].payload.feature, fx.dfo_layers[0].body.features[0])
  const mus = dfo.find((m) => m.harbour.name_raw === 'Musgrave ')
  assert.equal(mus.harbour.name, 'Musgrave')
  assert.equal(mus.harbour.province, 'MB') // DFO's own error, kept as given (the card does not show province)
  const mci = dfo.find((m) => /^Mcivor/.test(m.harbour.name))
  assert.equal(mci.harbour.managed_by, null)
  assert.deepEqual(dfoOfficial(harbour('Sooke')), { name: 'Sooke', status: 'DFO core fishing harbour', authority: 'Sooke Harbour Authority',
    url: 'https://www.dfo-mpo.gc.ca/sch-ppb/list-liste/ha-list-liste-ap-eng.html?filter=HA0540' })
  assert.ok(mapDfoFeature({ attributes: { OBJECTID: 1 } }).error)
})

test('matchDfoHarbour: 4 km + shared name word accepts; distance only is a candidate; nothing near is a new port (REAL positions)', () => {
  const g = matchDfoHarbour(harbour('Ganges (Inner Harbour)'), wpi)
  assert.equal(g.decision, 'accepted'); assert.equal(g.port_id, 18600); assert.ok(g.distance_km < 4)
  assert.equal(matchDfoHarbour(harbour('Steveston (Paramount)'), wpi).port_id, 18090)
  const fc = matchDfoHarbour(harbour('Vancouver (False Creek)'), wpi)
  assert.equal(fc.decision, 'accepted'); assert.equal(fc.port_id, 18150)
  const ts = matchDfoHarbour(harbour('Tsehum Harbour (Shoal Harbour)'), wpi)
  assert.equal(ts.decision, 'candidate'); assert.equal(ts.port_id, null)
  assert.deepEqual(ts.candidates.map((c) => [c.port_id, c.reason]), [[18660, 'no shared name word']])
  const so = matchDfoHarbour(harbour('Sooke'), wpi)
  assert.equal(so.decision, 'new_port'); assert.deepEqual(so.candidates, [])
})

test('matchDfoHarbour SYNTHETIC: a same-named port in another country is never accepted, and blocks a new port', () => {
  const h = harbour('Sooke')
  const us = { id: 1, name: 'Sooke', lat: h.lat + 0.01, lon: h.lon, iso2: 'US', iso3: 'USA', origin: 'wpi' }
  const d = matchDfoHarbour(h, [us])
  assert.equal(d.decision, 'candidate'); assert.equal(d.candidates[0].reason, 'other country')
  // Two same-named Canadian ports at nearly the same distance: not guessed.
  const a = { id: 2, name: 'Sooke', lat: h.lat + 0.01, lon: h.lon, iso2: 'CA', origin: 'wpi' }
  const b = { id: 3, name: 'Sooke Basin', lat: h.lat - 0.011, lon: h.lon, iso2: 'CA', origin: 'wpi' }
  assert.equal(matchDfoHarbour(h, [a, b]).decision, 'candidate')
  assert.equal(matchDfoHarbour(h, [a, { ...b, lat: h.lat - 0.03 }]).port_id, 2)
})

test('USACE Port Areas: WPI points fall in their recorded polygons (REAL rings)', () => {
  const areas = fx.usace.body.features.map((f) => mapUsaceFeature(f)).map((m) => ({ ...m.area, rings: m.payload.geometry.rings }))
  assert.deepEqual(areas.map((a) => a.code).sort(), ['4707', '4727', '4736'])
  const at = (n) => wpi.find((p) => p.id === n)
  assert.deepEqual(areasContaining(at(17120).lat, at(17120).lon, areas).map((a) => a.code), ['4707']) // Port Angeles
  assert.deepEqual(areasContaining(at(17790).lat, at(17790).lon, areas).map((a) => a.code), ['4727']) // Everett
  assert.deepEqual(areasContaining(at(18050).lat, at(18050).lon, areas).map((a) => a.code), ['4736']) // Bellingham
  assert.deepEqual(areasContaining(at(18150).lat, at(18150).lon, areas), []) // Vancouver, BC
  assert.equal(areas.find((a) => a.code === '4707').name, 'Clallam County Port District, WA')
})

test('pointInRings SYNTHETIC: a hole excludes; two overlapping areas both contain (the importer then refuses to guess)', () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]
  assert.equal(pointInRings(0.5, 0.5, [sq(0, 0, 1, 1)]), true)
  assert.equal(pointInRings(0.5, 0.5, [sq(0, 0, 1, 1), sq(0.4, 0.4, 0.6, 0.6)]), false)
  const areas = [{ code: 'A', rings: [sq(0, 0, 1, 1)] }, { code: 'B', rings: [sq(0.2, 0.2, 2, 2)] }]
  assert.deepEqual(areasContaining(0.5, 0.5, areas).map((a) => a.code), ['A', 'B'])
})

test('checkHandRows: every row of the hand table is found in its recorded pages', () => {
  const pages = new Map([...Object.entries(fx.tc_pages), ...Object.entries(fx.law_extracts).filter(([k]) => k.startsWith('http'))])
  const have = new Set(wpi.map((p) => p.id))
  const r = checkHandRows(table, pages, have)
  assert.deepEqual(r.map((x) => [x.row.id, x.problems]), table.rows.map((row) => [row.id, []]))
  // A cited page we could not fetch, or a missing WPI port, makes the row a candidate (SYNTHETIC removals).
  const noLaw = new Map([...pages].filter(([k]) => !k.includes('C-6.7')))
  assert.ok(checkHandRows(table, noLaw, have).find((x) => x.row.id === 'cpa-nanaimo').problems.some((p) => p.startsWith('page not fetched')))
  const noHarmac = new Set([...have].filter((n) => n !== 18525))
  assert.deepEqual(checkHandRows(table, pages, noHarmac).find((x) => x.row.id === 'cpa-nanaimo').problems, ['no WPI port 18525'])
  // SYNTHETIC: a name the pages don't carry.
  const bad = { rows: [{ ...table.rows[0], check: 'Port Metro Vancouver' }] }
  assert.ok(checkHandRows(bad, pages, have)[0].problems.some((p) => p.includes('not found')))
})

test('esriQueryUrl: the recorded DFO request is what the importer asks', () => {
  const u = new URL(esriQueryUrl(`${DFO_URL}/0`, { bbox: [-125.5, 47, -122, 50.5] }))
  const rec = new URL(fx.dfo_layers[0].url)
  for (const k of ['where', 'geometry', 'geometryType', 'inSR', 'spatialRel', 'outFields', 'outSR', 'f']) assert.equal(u.searchParams.get(k), rec.searchParams.get(k), k)
})

test('matchDfoHarbour SYNTHETIC: a map port within 0.5 km wins whatever its name (Powell River South → Westview)', async () => {
  const { matchDfoHarbour, SAME_SPOT_KM } = await import('../officialPorts.js')
  const h = { name: 'Powell River South', lat: 49.8350, lon: -124.5250 }
  const westview = { id: 1, name: 'Westview', lat: 49.8350 + 0.19 / 111, lon: -124.5250, iso2: 'CA', iso3: 'CAN', origin: 'wpi' }
  const powell = { id: 2, name: 'Powell River', lat: 49.8350 + 3.55 / 111, lon: -124.5250, iso2: 'CA', iso3: 'CAN', origin: 'wpi' }
  const r = matchDfoHarbour(h, [westview, powell])
  assert.deepEqual([r.decision, r.port_id, r.method], ['accepted', 1, 'dfo_within_0_5km'])
  assert.ok(SAME_SPOT_KM === 0.5)
})
