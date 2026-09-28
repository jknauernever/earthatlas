/**
 * Terminal list + GFW stop matching (pure; offline). Fixtures (fixtures/README.md, "Terminals"):
 *   terminals-live-2026-09-27.json              REAL USACE / Ecology / BC Ports and Terminals / OSM / GEM responses + Climate TRACE refineries
 *   gfw-live-portvisits-salish-terminals-2026.json  REAL GFW port-visit events near listed terminals (2026-01..06)
 * plus the reviewed data files themselves (lib/ships/data/salish-terminals*.json). Cases the real data does not show are
 * built by hand and marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  loadTerminalData, validateTerminalData, requiredKeys, resolveBerths, osmPosition, parseCsv, monthWindow,
  mapUsaceDock, mapEcologyFacility, mapBcPortTerminal, mapOsmElement, mapGemRow, mapCtRefinery,
  nearestTerminals, matchStop, matchVisit, visitStops, MATCH_KM, AMBIGUITY_RATIO, KINDS,
} from '../terminals.js'
import { mapPortVisit } from '../portVisits.js'
import { haversineKm } from '../ports.js'
import { fixture } from './scenarios.js'

const fx = fixture('terminals-live-2026-09-27.json')
const ev = fixture('gfw-live-portvisits-salish-terminals-2026.json')
const data = await loadTerminalData()
const rawMaps = () => ({
  usace: new Map(fx.usace.features.map(mapUsaceDock).map((m) => [m.key, m.payload])),
  ecology: new Map(fx.ecology.features.map((f) => mapEcologyFacility(f)).map((m) => [m.key, m.payload])),
  bcpt: new Map(fx.bcpt.features.map((f) => mapBcPortTerminal(f)).map((m) => [m.key, m.payload])),
  osm: new Map(fx.osm.elements.map(mapOsmElement).map((m) => [m.key, m.payload])),
})
/** Every berth of the reviewed list, in the shape matchStop wants (positions as reviewed in the data files). */
const allBerths = [
  ...data.main.terminals.flatMap((t) => t.berths.map((b) => ({ terminal: t.id, key: b.key, lat: b.lat, lon: b.lon }))),
  ...data.osm.berths.map((b) => ({ terminal: b.terminal, key: b.key, lat: b.lat, lon: b.lon })),
]
const rowOf = (id) => mapPortVisit(ev.entries.find((e) => e.id.startsWith(id))).row

test('the reviewed data files pass validation; every kind is known; the ODbL slice holds only OSM berths', () => {
  assert.deepEqual(validateTerminalData(data), [])
  assert.ok(data.main.terminals.length >= 30 && data.main.terminals.length <= 60)
  for (const t of data.main.terminals) {
    assert.ok(KINDS.includes(t.kind), t.id)
    for (const b of t.berths) assert.ok(!b.basis.startsWith('osm_'), `${t.id}: OSM berth outside the ODbL file`)
    assert.ok(t.operator && /^https?:\/\//.test(t.operator_source_url), `${t.id}: operator needs a source URL`)
  }
  for (const b of data.osm.berths) assert.ok(b.basis.startsWith('osm_') && b.osm.length)
  assert.match(data.osm.about.licence, /ODbL/)
})

test('SYNTHETIC broken entries are rejected (duplicate id, unknown kind, operator without source, OSM berth in the main file)', () => {
  const t0 = structuredClone(data.main.terminals[0])
  const bad = { main: { terminals: [
    t0, { ...t0 },
    { ...structuredClone(t0), id: 'wa-x', kind: 'spaceport' },
    { ...structuredClone(t0), id: 'wa-y', operator_source_url: null },
    { ...structuredClone(t0), id: 'wa-z', berths: [{ key: 'osm-1', basis: 'osm_pier_centers', osm: ['way/1'], lat: 48.5, lon: -122.6 }] },
  ] }, osm: { berths: [] } }
  const errs = validateTerminalData(bad).join('\n')
  assert.match(errs, /duplicate id/)
  assert.match(errs, /kind spaceport/)
  assert.match(errs, /operator without a source URL/)
  assert.match(errs, /must live in salish-terminals-osm\.json/)
})

test('requiredKeys: one list per source; Climate TRACE refinery and ship-port ids stay separate', () => {
  const k = requiredKeys(data)
  assert.ok(k.usace.includes('02JT') && k.ecology.get(13) === 'Anacortes Refinery' && k.bcpt.get(261) === 'Kinder Morgan (Westridge Terminal)')
  assert.deepEqual(k.ctRefinery, [1753291, 1753312, 1753321, 1753325, 1753359, 3143778])
  assert.ok(k.ctPort.includes(1929322) && !k.ctPort.includes(1753291))
  assert.deepEqual(k.gem, ['T1050', 'T1087', 'T1407'])
})

test('raw mappers (REAL rows): keys, the BC WFS session id is dropped, name guards catch a renumbered layer (SYNTHETIC rename)', () => {
  const u = mapUsaceDock(fx.usace.features.find((f) => f.attributes.NAV_UNIT_ID === '02JT'))
  assert.equal(u.key, '02JT')
  const e = fx.ecology.features.find((f) => f.attributes.OBJECTID === 13)
  assert.equal(mapEcologyFacility(e, 'Anacortes Refinery').key, 'OBJECTID 13')
  const renamed = structuredClone(e); renamed.attributes.FacilityName = 'Something Else' // SYNTHETIC
  assert.match(mapEcologyFacility(renamed, 'Anacortes Refinery').error, /renumbered/)
  const b = fx.bcpt.features.find((f) => f.properties.FACILITY_NAME.startsWith('Kinder Morgan (Westridge'))
  const m = mapBcPortTerminal(b, 'Kinder Morgan (Westridge Terminal)')
  assert.equal(m.key, 'SOURCE_DATA_ID 261')
  assert.equal('id' in m.payload, false, 'the unstable WFS feature id is not stored')
  assert.equal(typeof b.properties.SOURCE_DATA_ID, 'string', 'the WFS sends SOURCE_DATA_ID as a string')
  assert.equal(mapOsmElement(fx.osm.elements[0]).key, `${fx.osm.elements[0].type}/${fx.osm.elements[0].id}`)
  const gem = parseCsv(fx.gem.csv).map(mapGemRow)
  assert.deepEqual(gem.map((g) => g.key), ['T1087/T01087'])
  assert.equal(gem[0].payload['coal-terminal-name'], 'Westshore Coal Terminals')
  const ct = fx.ct_refinery.features.map((f) => mapCtRefinery(f, fx.ct_refinery.release))
  assert.ok(ct.every((c) => c.payload.sub === 'oil-and-gas-refining' && !('m' in c.payload)))
})

test('parseCsv: quoted commas and doubled quotes (GEM owner field, REAL + SYNTHETIC)', () => {
  const rows = parseCsv('a,b\n"x, y","say ""hi"""\n')
  assert.deepEqual(rows, [{ a: 'x, y', b: 'say "hi"' }])
})

test('resolveBerths reproduces the reviewed positions from the REAL raw rows (USACE, BC Ports and Terminals, OSM)', () => {
  const raw = rawMaps()
  for (const id of fx.terminals) {
    const t = data.main.terminals.find((x) => x.id === id)
    const r = resolveBerths(t, data.osm.berths, raw)
    assert.deepEqual(r.problems, [], id)
    assert.equal(r.berths.length, t.berths.length + t.osm_berths.length, id)
    for (const b of r.berths) {
      const reviewed = [...t.berths, ...data.osm.berths.filter((o) => o.terminal === id)].find((x) => x.key === b.key)
      assert.ok(haversineKm(b.lat, b.lon, reviewed.lat, reviewed.lon) < 0.001, `${id}/${b.key}`)
      assert.equal(b.odbl, b.source === 'osm')
    }
  }
  // Puget LNG: the berth is the mean of 15 OSM pier/dolphin centres.
  const lng = resolveBerths(data.main.terminals.find((x) => x.id === 'wa-puget-lng-tacoma'), data.osm.berths, raw).berths[0]
  assert.equal(lng.basis, 'osm_pier_centers')
  assert.equal(lng.refs.length, 15)
})

test('resolveBerths reports OSM drift and missing rows instead of guessing (SYNTHETIC moved element)', () => {
  const raw = rawMaps()
  const k = [...raw.osm.keys()].find((x) => x !== 'way/687278374')
  const moved = structuredClone(raw.osm.get(k)); moved.center.lat += 0.01 // ~1.1 km north
  raw.osm.set(k, moved)
  const t = data.main.terminals.find((x) => x.id === 'wa-puget-lng-tacoma')
  assert.match(resolveBerths(t, data.osm.berths, raw).problems.join(), /moved 0\.0\d\d km|moved 0\.\d+ km/)
  const none = resolveBerths(data.main.terminals.find((x) => x.id === 'wa-t86-grain'), data.osm.berths, raw)
  assert.equal(none.berths.length, 0)
  assert.match(none.problems.join(), /USACE 0UMV not in the fetched rows/)
})

test('osmPosition: node lat/lon or way centre; null when any element has no position', () => {
  assert.deepEqual(osmPosition([{ lat: 1, lon: 2 }, { center: { lat: 3, lon: 4 } }]), { lat: 2, lon: 3 })
  assert.equal(osmPosition([{ lat: 1, lon: 2 }, {}]), null)
})

test('matchStop (REAL GFW stop): TORM DAVAO at Cherry Point anchorage 54859571 → BP Cherry Point, berthed (atDock true)', () => {
  const v = rowOf('d8bc440e')
  assert.equal(v.vessel_name_raw, 'TORM DAVAO')
  const m = matchStop({ lat: v.int_lat, lon: v.int_lon, atDock: v.int_at_dock }, allBerths)
  assert.equal(m.status, 'match')
  assert.equal(m.terminal, 'wa-bp-cherry-point')
  assert.equal(m.dock, 'berthed')
  assert.ok(m.km < MATCH_KM)
})

test('matchStop (REAL GFW stop): anchorage 5485774d off March Point is "one of" the two Anacortes refineries, never one', () => {
  const v = rowOf('c036e1b4')
  const m = matchStop({ lat: v.int_lat, lon: v.int_lon, atDock: v.int_at_dock }, allBerths)
  assert.equal(m.status, 'ambiguous')
  assert.deepEqual(m.oneOf.map((o) => o.terminal).sort(), ['wa-hfs-puget-sound', 'wa-marathon-anacortes'])
  assert.ok(m.oneOf[1].km <= m.oneOf[0].km * AMBIGUITY_RATIO)
  assert.equal(m.dock, 'nearby', 'GFW atDock false → nearby / at anchor')
})

test('matchStop: berthed only when GFW says atDock === true (null / false → nearby) (SYNTHETIC flags on a REAL position)', () => {
  const v = rowOf('d8bc440e')
  for (const [flag, dock] of [[true, 'berthed'], [false, 'nearby'], [null, 'nearby'], [undefined, 'nearby']]) {
    assert.equal(matchStop({ lat: v.int_lat, lon: v.int_lon, atDock: flag }, allBerths).dock, dock, String(flag))
  }
})

test('matchStop boundaries: exactly at 1.0 km matches, beyond does not; ratio exactly 1.5 is ambiguous (SYNTHETIC berths)', () => {
  const kmPerDegLat = haversineKm(48, -123, 49, -123)
  const B = [{ terminal: 'A', key: 'a', lat: 48, lon: -123 }]
  assert.equal(matchStop({ lat: 48 + (MATCH_KM - 1e-6) / kmPerDegLat, lon: -123, atDock: true }, B).status, 'match')
  assert.equal(matchStop({ lat: 48 + (MATCH_KM + 0.01) / kmPerDegLat, lon: -123, atDock: true }, B).status, 'none')
  // Stop 0.4 km north of A; B 0.6 km south of the stop (exactly 1.5×) → ambiguous; 0.61 km → match A.
  const s = { lat: 48 + 0.4 / kmPerDegLat, lon: -123, atDock: false }
  const two = (d) => [...B, { terminal: 'B', key: 'b', lat: s.lat + d / kmPerDegLat, lon: -123 }]
  assert.equal(matchStop(s, two(0.4 * AMBIGUITY_RATIO - 1e-6)).status, 'ambiguous')
  assert.equal(matchStop(s, two(0.4 * AMBIGUITY_RATIO + 0.01)).status, 'match')
  assert.equal(matchStop({ lat: null, lon: -123 }, B).status, 'none')
})

test('nearestTerminals: one entry per terminal, its nearest berth (SYNTHETIC)', () => {
  const B = [{ terminal: 'A', key: 'a1', lat: 48, lon: -123 }, { terminal: 'A', key: 'a2', lat: 48.001, lon: -123 }, { terminal: 'B', key: 'b', lat: 48.01, lon: -123 }]
  const n = nearestTerminals(48.0011, -123, B)
  assert.deepEqual(n.map((x) => [x.key, x.berth]), [['A', 'a2'], ['B', 'b']])
})

test('matchVisit uses every stop (REAL): a Burnaby → Roberts Bank visit counts for Parkland (start/intermediate) and Westshore (end)', () => {
  const v = rowOf('7d58c7a3')
  assert.equal(visitStops(v).length, 3)
  const m = matchVisit(v, allBerths)
  const park = m.terminals.get('bc-parkland-burnaby'), ws = m.terminals.get('bc-westshore')
  assert.deepEqual(park.slots, ['start', 'intermediate'])
  assert.equal(park.relation, 'match')
  assert.deepEqual(ws.slots, ['end'])
  assert.equal(ws.dock, 'berthed')
})

test('matchVisit: an unambiguous stop wins over an ambiguous one for the same terminal (SYNTHETIC visit from REAL anchorages)', () => {
  const amb = rowOf('c036e1b4') // 5485774d: one of the two Anacortes refineries
  const hfs = rowOf('eabfeb27') // end anchorage 54857755: nearest is HF Sinclair alone
  const v = { ...amb, end_lat: hfs.end_lat, end_lon: hfs.end_lon, end_at_dock: hfs.end_at_dock, end_anchorage_id: hfs.end_anchorage_id }
  const m = matchVisit(v, allBerths)
  assert.equal(m.terminals.get('wa-hfs-puget-sound').relation, 'match')
  assert.deepEqual(m.terminals.get('wa-hfs-puget-sound').slots, ['end'])
  const mar = m.terminals.get('wa-marathon-anacortes')
  assert.equal(mar.relation, 'ambiguous')
  assert.deepEqual(mar.oneOf, ['wa-hfs-puget-sound', 'wa-marathon-anacortes'])
})

test('monthWindow: inclusive months → exclusive end date; bad input rejected', () => {
  assert.deepEqual(monthWindow('2026-01', '2026-06'), { from: '2026-01-01', to: '2026-07-01' })
  assert.deepEqual(monthWindow('2025-12', '2025-12'), { from: '2025-12-01', to: '2026-01-01' })
  assert.deepEqual(monthWindow('2026-01-15', '2026-02-01'), { from: '2026-01-15', to: '2026-02-01' })
  assert.ok(monthWindow('2026-06', '2026-01').error)
  assert.ok(monthWindow('2026-06-01', '2026-01-01').error)
  assert.ok(monthWindow('June', '2026-01').error)
})
