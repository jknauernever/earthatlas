/**
 * AIS-inferred berths (pure; offline): stop clustering, the footprint guard, and how the reviewed berths enter the terminal list.
 * Fixture: REAL data (fixtures/README.md, "AIS-inferred berths"): long stops from our MarineCadastre AIS cache at Richardson,
 * the Cargill pier and a tanker spot by Pacific Terminal / Vanterm, plus OpenStreetMap outlines of those sites (ODbL).
 * Anything built by hand is marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AIS_BERTH_RULE, stitchRings, footprintDistanceM, clusterStops, attributeClusters, typeFits, orderAlongDock } from '../aisBerths.js'
import { loadTerminalData, validateTerminalData, resolveBerths, BASES } from '../terminals.js'
import { fixture } from './scenarios.js'

const fx = fixture('ais-berths-burrard-2026-09-28.json')
const el = (id) => fx.osm.find((e) => `${e.type}/${e.id}` === id)
const rings = (id) => { const e = el(id); return e.type === 'way' ? [e.geometry] : stitchRings(e.outer.map((w) => w.geometry)).rings }
const fp = (ids, name) => ({ rings: ids.flatMap(rings), osm: ids, name })
const RICHARDSON = { key: 'bc-richardson', footprint: fp(['relation/15803613'], 'Richardson'), fitTypes: [[70, 79]],
  berths: [{ key: 'bcpt-268', lat: 49.3048999, lon: -123.0708901, radius_m: 150 }] }
const CARGILL = { key: 'bc-cargill', footprint: fp(['relation/15803612', 'way/525504891'], 'Cargill'), fitTypes: [[70, 79]],
  berths: [{ key: 'bcpt-269', lat: 49.3053027, lon: -123.0570262, radius_m: 164 }, { key: 'osm-way525504891', lat: 49.3051085, lon: -123.058748, radius_m: 150 }] }
const PACIFIC = { key: 'bc-viterra-pacific', footprint: fp(['way/1174883978'], 'Pacific Terminal'), fitTypes: [[70, 79]],
  berths: [{ key: 'bcpt-254', lat: 49.2879611, lon: -123.0674207, radius_m: 203 }] }
const OTHERS = [{ id: 'relation/15852167', name: 'GCT Vanterm', rings: rings('relation/15852167') }]
const { clusters, dropped } = clusterStops(fx.stops)
const near = (lat, lon) => clusters.find((c) => Math.abs(c.lat - lat) < 0.0004 && Math.abs(c.lon - lon) < 0.0006)

test('OSM multipolygons are stitched into closed rings (REAL Richardson and Cargill relations, which share a boundary way)', () => {
  for (const id of ['relation/15803613', 'relation/15803612']) {
    const r = stitchRings(el(id).outer.map((w) => w.geometry))
    assert.equal(r.open.length, 0, `${id} closes`)
    assert.equal(r.rings.length, 1)
    assert.deepEqual(r.rings[0][0], r.rings[0].at(-1))
  }
  assert.deepEqual(stitchRings([[[0, 0], [1, 0]], [[1, 1], [1, 0]]]).rings, [], 'SYNTHETIC: an unclosed chain is not a ring')
  assert.equal(stitchRings([[[0, 0], [1, 0]], [[1, 1], [1, 0]]]).open.length, 1)
})

test('distance to a footprint: 0 inside, metres outside (REAL outlines; SYNTHETIC probe points)', () => {
  const r = RICHARDSON.footprint
  const ring = r.rings[0]
  const inside = [ring.reduce((s, p) => s + p[1], 0) / ring.length, ring.reduce((s, p) => s + p[0], 0) / ring.length]
  assert.equal(footprintDistanceM(inside[0], inside[1], r), 0, 'SYNTHETIC: the vertex mean of the (convex-ish) site is inside it')
  const d = footprintDistanceM(49.30447, -123.06706, r)
  assert.ok(d > 5 && d < 40, `the Richardson stop cluster lies alongside the site: ${d} m`)
  assert.ok(footprintDistanceM(49.30447, -123.06706, CARGILL.footprint) > 400, 'and far from Cargill')
})

test('clustering: anchored (swinging) stops are dropped; three separate berth spots are found (REAL stops)', () => {
  assert.equal(dropped, 2, 'the two stops with a spread > 50 m')
  assert.equal(clusters.length, 3)
  assert.deepEqual(clusters.map((c) => c.stops), [14, 12, 10])
  const rich = near(49.30447, -123.06706)
  assert.ok(rich, 'a cluster at the Richardson berth')
  assert.equal(rich.stops, 14)
  assert.equal(rich.ships, new Set(fx.stops.slice(0, 14).map((s) => s.mmsi)).size)
  assert.ok(rich.first <= rich.last)
})

test('the footprint guard: Richardson\'s cluster goes to Richardson, never to Cargill; the rest is rejected with reasons (REAL)', () => {
  const { accepted, rejected } = attributeClusters(clusters, [RICHARDSON, CARGILL, PACIFIC], OTHERS)
  assert.equal(accepted.length, 1)
  assert.equal(accepted[0].terminal, 'bc-richardson')
  assert.ok(accepted[0].footprintM <= AIS_BERTH_RULE.footprintMarginM)
  assert.equal(accepted[0].nearestOther.id, 'bc-cargill')
  assert.ok(accepted[0].nearestOther.m > 400)
  const cargill = rejected.find((r) => r.terminal === 'bc-cargill')
  assert.match(cargill.why.join(), /already counted: \d+ m from berth osm-way525504891/)
  const tank = rejected.find((r) => r.terminal === 'bc-viterra-pacific')
  assert.match(tank.why.join(), /ambiguous: GCT Vanterm/)
  assert.match(tank.why.join(), /ships do not fit: 0%/, 'tankers at a grain terminal do not fit')
})

test('guard: with Richardson\'s own footprint unknown, its cluster is NOT given to its neighbour Cargill (REAL stops, SYNTHETIC empty footprint)', () => {
  const noOwn = { ...RICHARDSON, footprint: { rings: [], osm: [], name: 'Richardson' } }
  const { accepted, rejected } = attributeClusters(clusters, [noOwn, CARGILL, PACIFIC], OTHERS)
  assert.ok(!accepted.some((a) => a.terminal === 'bc-cargill' && Math.abs(a.lon + 123.06706) < 0.001))
  assert.ok(!rejected.some((a) => a.terminal === 'bc-cargill' && Math.abs(a.lon + 123.06706) < 0.001), 'too far from Cargill to even be considered')
  assert.equal(accepted.length, 0)
})

test('guard: an ambiguous cluster is not attributed (REAL stops; SYNTHETIC rival outline drawn around the Richardson cluster)', () => {
  const box = [[-123.0675, 49.3043], [-123.0666, 49.3043], [-123.0666, 49.3047], [-123.0675, 49.3047], [-123.0675, 49.3043]]
  const { accepted, rejected } = attributeClusters(clusters, [RICHARDSON, CARGILL, PACIFIC], [...OTHERS, { id: 'test/rival', name: 'TEST rival', rings: [box] }])
  assert.equal(accepted.length, 0)
  assert.match(rejected.find((r) => r.terminal === 'bc-richardson').why.join(), /ambiguous: TEST rival is 0 m away/)
})

test('guard: too little evidence, or already inside an existing berth radius, is rejected (REAL stops)', () => {
  const few = clusterStops(fx.stops.slice(0, 4)).clusters
  assert.match(attributeClusters(few, [RICHARDSON], OTHERS).rejected[0].why.join(), /too little evidence: 4 stops/)
  const covered = { ...RICHARDSON, berths: [{ key: 'SYNTHETIC-berth', lat: 49.30447, lon: -123.06706, radius_m: 150 }] }
  assert.match(attributeClusters(clusters, [covered], OTHERS).rejected[0].why.join(), /already counted: \d+ m from berth SYNTHETIC-berth/)
  assert.equal(typeFits(79, [[70, 79]]), true)
  assert.equal(typeFits(null, [[70, 79]]), false)
  assert.equal(typeFits('84', [[70, 79], [80, 89]]), true)
})

test('the reviewed AIS berths enter the list as ais_inferred, apart from official / OSM berths (REAL data files)', async () => {
  const data = await loadTerminalData()
  assert.deepEqual(validateTerminalData(data), [])
  assert.equal(BASES.ais_inferred, 'earthatlas-ais-berths')
  const vw = data.main.terminals.find((t) => t.id === 'bc-vancouver-wharves')
  const raw = { usace: new Map(), ecology: new Map(), osm: new Map(), gisis: new Map(),
    bcpt: new Map([['SOURCE_DATA_ID 272', { properties: { FACILITY_NAME: 'Kinder Morgan (Vancouver Wharves)', LATITUDE: 49.309433, LONGITUDE: -123.117837 } }]]) }
  const r = resolveBerths(vw, data.osm.berths, raw, { aisBerths: data.ais.berths })
  assert.deepEqual(r.problems, [])
  const ais = r.berths.filter((b) => b.basis === 'ais_inferred')
  assert.equal(ais.length, 2)
  for (const b of ais) {
    assert.equal(b.source, 'earthatlas-ais-berths')
    assert.equal(b.odbl, false)
    assert.match(b.detail.estimated, /not an official position/)
    assert.ok(b.detail.stops >= AIS_BERTH_RULE.minStops && b.detail.ships >= AIS_BERTH_RULE.minShips)
  }
  assert.equal(r.berths.filter((b) => b.basis === 'bc_ports_terminals').length, 1, 'the official point is kept as is')
  // West → east along the wharf: the west-end estimate, the middle one, then the official point.
  assert.deepEqual(orderAlongDock(r.berths.map((b) => ({ key: b.key, lat: b.lat, lon: b.lon }))), ['ais-1', 'ais-2', 'bcpt-272'])
  const bad = { ...data, ais: { ...data.ais, berths: [{ ...data.ais.berths[0], basis: 'bc_ports_terminals', key: 'x1', evidence: {} }] } }
  const errs = validateTerminalData(bad).join('\n')
  assert.match(errs, /must have basis ais_inferred/, 'SYNTHETIC bad entry')
  assert.match(errs, /key must start with ais-/)
  assert.match(errs, /evidence needs stops/)
})
