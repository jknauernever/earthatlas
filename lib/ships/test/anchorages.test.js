/**
 * Official anchorage areas: pure mapping, geometry and matching (offline).
 * Fixture is REAL: fixtures/anchorages-live-2026-09-27.json holds verbatim extracts of the live downloads
 * (MarineCadastre FeatureServer GeoJSON, DFO MapServer GeoJSON, the GPO text of 82 FR 10313, the eCFR Part 110
 * version list) and real GFW port-visit positions. Cases that build or edit values are marked SYNTHETIC.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANCHORAGE_SOURCES, amendedSince, mapMcFeature, mapDfoFeature, parseProposedParagraphs, mapProposedParagraph, proposedGeometry,
  parseNumberWords, coordPairs, circlePolygon, pointInGeometry, distanceToGeometryM, bbox, matchPoint, publicAnchorage, NEAR_M,
} from '../anchorages.js'
import { haversineKm } from '../ports.js'
import { fixture } from './scenarios.js'

const fx = fixture('anchorages-live-2026-09-27.json')
const amended = amendedSince(fx.ecfr)
const mc = Object.fromEntries(fx.mc.features.map((f) => [f.properties.objectid, f]))
const dfo = Object.fromEntries(fx.dfo.features.map((f) => [f.properties.OBJECTID, f]))
const paras = parseProposedParagraphs(fx.fr_lines.join('\n'))
const pos = Object.fromEntries(fx.positions.map((p) => [p.case.split(' ')[0], p.position]))
const rowsOf = (list) => list.filter((m) => m.row).map((m) => ({ ...m.row, name: m.row.name, source_key: m.key }))
const all = [
  ...rowsOf(fx.mc.features.map((f) => mapMcFeature(f, { amended, amendRid: 1 }))).map((r) => ({ ...r, source_id: 'noaa-mc-anchorages' })),
  ...rowsOf(fx.dfo.features.map(mapDfoFeature)).map((r) => ({ ...r, source_id: 'dfo-pacific-commercial-anchorages' })),
  ...rowsOf(paras.map(mapProposedParagraph)).map((r) => ({ ...r, source_id: 'uscg-vts-ps-nondesignated' })),
]
const dms = (d, m, s) => d + m / 60 + s / 3600

test('sources: each carries a licence, commercial-use flag and attribution before use', () => {
  assert.deepEqual(ANCHORAGE_SOURCES.map((s) => s.id), ['noaa-mc-anchorages', 'dfo-pacific-commercial-anchorages', 'uscg-vts-ps-nondesignated', 'ecfr-part110-versions'])
  for (const s of ANCHORAGE_SOURCES) { assert.ok(s.license && s.attribution_text && s.homepage_url); assert.equal(typeof s.commercial_use, 'boolean') }
  assert.match(ANCHORAGE_SOURCES[1].license, /Open Government Licence – Canada 2\.0/)
  assert.match(ANCHORAGE_SOURCES[2].attribution_text, /withdrawn/)
})

test('eCFR: substantive amendments after 2022-11-17 per section; editorial (substantive:false) ones are ignored', () => {
  assert.deepEqual(amended.get('110.228'), ['2024-12-04', '2024-12-16', '2025-01-03', '2025-01-15', '2026-06-17', '2026-07-17'])
  assert.deepEqual(amended.get('110.214'), ['2025-09-09', '2025-10-09'])
  assert.equal(amended.get('110.230'), undefined) // Puget Sound: not amended since the layer's CFR
  const editorial = fx.ecfr.content_versions.filter((v) => v.substantive === false && v.amendment_date > '2022-11-17')
  assert.ok(editorial.length > 0)
  const onlyEditorial = amendedSince({ content_versions: editorial })
  assert.equal(onlyEditorial.size, 0)
})

test('MarineCadastre: Cherry Point is a designated 33 CFR 110.230(a)(9) polygon with no boundary flag', () => {
  const m = mapMcFeature(mc[605], { amended, amendRid: 7 })
  assert.equal(m.key, '605')
  assert.equal(m.row.name, 'Cherry Point')
  assert.equal(m.row.kind, 'general')
  assert.equal(m.row.legal_status, 'designated')
  assert.equal(m.row.citation, '33 CFR 110.230(a)(9)')
  assert.equal(m.row.built_from, 'polygon')
  assert.equal(m.row.iso3, 'USA')
  assert.equal(m.row.no_anchoring, false)
  assert.equal(m.row.boundary_note, null)
  assert.deepEqual(m.row.geometry, mc[605].geometry) // geometry exactly as given
  const [a, b, c, d] = bbox(mc[605].geometry)
  assert.deepEqual([m.row.min_lat, m.row.max_lat, m.row.min_lon, m.row.max_lon], [a, b, c, d])
  // The CFR centre (48°48′29.39″ N, 122°46′04.66″ W) is inside; the layer's circle has r ≈ 1,463 m.
  assert.ok(pointInGeometry(m.row.geometry, dms(48, 48, 29.39), -dms(122, 46, 4.66)))
})

test('MarineCadastre: amended regions are flagged "older boundary" with the eCFR dates and evidence record', () => {
  const col = mapMcFeature(mc[591], { amended, amendRid: 7 })
  assert.match(col.row.citation, /^33 CFR 110\.228/)
  assert.match(col.row.boundary_note, /^older boundary: this layer is dated 2023-10 and was compiled from the CFR of 2022-11-17; 33 CFR 110\.228 has been amended since \(2024-12-04, .*2026-07-17\)$/)
  assert.equal(col.row.detail.amendment_record_id, 7)
  assert.match(mapMcFeature(mc[543], { amended }).row.boundary_note, /110\.214/) // LA Anchorage F
  assert.equal(mapMcFeature(mc[600], { amended }).row.boundary_note, null)  // Smith Cove West (110.230)
})

test('MarineCadastre: the Port Angeles non-anchorage area never counts as an anchorage; null-CFR and MultiPolygon rows map', () => {
  const pa = mapMcFeature(mc[612], { amended })
  assert.equal(pa.row.citation, '33 CFR 110.230(a)(14)')
  assert.equal(pa.row.no_anchoring, true)
  const [x0, y0] = pa.row.geometry.coordinates[0].slice(0, -1).reduce(([x, y], [a, b], _, l) => [x + a / l.length, y + b / l.length], [0, 0])
  assert.ok(pointInGeometry(pa.row.geometry, y0, x0))
  assert.equal(matchPoint([{ ...pa.row }], y0, x0).inside, null)
  const nc = mapMcFeature(mc[676], { amended })
  assert.equal(nc.row.citation, null)
  assert.match(nc.row.detail.note, /no CFR citation/)
  const mp = mapMcFeature(mc[587], { amended })
  assert.equal(mp.row.geometry.type, 'MultiPolygon')
  assert.ok(Number.isFinite(mp.row.min_lat))
})

test('DFO: English Bay U becomes a 64-vertex circle of its 556 m swing radius, marked as built by us', () => {
  const m = mapDfoFeature(dfo[27])
  assert.equal(m.row.name, 'English Bay Anchorage U')
  assert.equal(m.row.legal_status, 'active_listed')
  assert.equal(m.row.built_from, 'circle_from_centre_radius')
  assert.equal(m.row.detail.alternate_name, 'English Bay Anchorage Uniform')
  assert.equal(m.row.detail.radius_m, 556)
  assert.match(m.row.boundary_note, /built by EarthAtlas/)
  const ring = m.row.geometry.coordinates[0]
  assert.equal(ring.length, 65)
  assert.deepEqual(ring[0], ring[64])
  for (const [lon, lat] of ring) assert.ok(Math.abs(haversineKm(49.29583, -123.25366, lat, lon) * 1000 - 556) < 1)
  assert.equal(mapDfoFeature(dfo[9]).row.name, 'English Bay Anchorage 1') // "English Bay Anchorage  1" tidied; raw kept in the record
})

test('DFO: a radius of "unknown" gives a named reference with no geometry', () => {
  const m = mapDfoFeature(dfo[81])
  assert.equal(m.row.name, 'Royal Roads Anchorage A')
  assert.equal(m.row.geometry, null)
  assert.equal(m.row.built_from, 'not_built')
  assert.equal(m.row.min_lat, null)
  assert.match(m.row.boundary_note, /"unknown"/)
})

test('82 FR 10313: 16 proposed paragraphs; 14 are anchorages not in today\'s §110.230; 11 have a boundary', () => {
  assert.deepEqual(paras.map((p) => p.para), ['(a)(3)(iii)', '(a)(13)(i)', '(a)(13)(ii)', '(a)(14)(i)', '(a)(14)(ii)', '(a)(14)(iii)', '(a)(14)(iv)',
    '(a)(14)(v)', '(a)(15)(i)', '(a)(15)(ii)', '(a)(15)(iii)', '(a)(15)(iv)', '(a)(15)(v)', '(a)(16)', '(a)(17)(i)', '(a)(17)(ii)'])
  const m = paras.map(mapProposedParagraph)
  assert.deepEqual(m.filter((x) => x.skip).map((x) => x.key), ['(a)(13)(i)', '(a)(14)(i)'])
  assert.equal(m.filter((x) => x.row).length, 14)
  assert.equal(m.filter((x) => x.row?.geometry).length, 11)
  assert.deepEqual(m.filter((x) => x.row && !x.row.geometry).map((x) => x.row.name),
    ['Port Angeles Tug and Barge Holding Area West', 'Quartermaster Harbor General Anchorage', 'Budd Inlet General Anchorage'])
  for (const x of m.filter((y) => y.row)) {
    assert.equal(x.row.legal_status, 'non_designated')
    assert.match(x.row.citation, new RegExp(`^33 CFR 110\\.230${x.key.replace(/[()]/g, '\\$&')} as proposed in 82 FR 10313 \\(2017-02-10\\); proposal withdrawn 2018-04-27 \\(83 FR 18491\\)$`))
    assert.match(x.row.boundary_note, /WITHDRAWN 2017 proposed rule/)
  }
  // The (A)–(D) rules of the non-anchorage area stay with their paragraph's text.
  assert.match(paras.find((p) => p.para === '(a)(14)(i)').text, /\(D\) The city of Port Angeles/)
  assert.equal(mapProposedParagraph(paras[0]).row.name, 'Port Townsend General Anchorage')
})

test('82 FR 10313: Vendovi East is the box as written; Vendovi South is its shore line closed by a chord; Jack Island is a 600-yd circle', () => {
  const byName = Object.fromEntries(paras.map(mapProposedParagraph).filter((x) => x.row).map((x) => [x.row.name, x.row]))
  const ve = byName['Vendovi East General Anchorage']
  assert.equal(ve.detail.geometry_method, 'polygon_as_written')
  assert.ok(Math.abs(ve.min_lat - dms(48, 35, 43)) < 1e-9 && Math.abs(ve.max_lat - dms(48, 37, 43)) < 1e-9)
  assert.ok(Math.abs(ve.min_lon + dms(122, 34, 45.5)) < 1e-9 && Math.abs(ve.max_lon + dms(122, 31, 44)) < 1e-9)
  const vs = byName['Vendovi South General Anchorage']
  assert.equal(vs.detail.geometry_method, 'open_line_closed_by_chord')
  assert.match(vs.boundary_note, /covers less water than described/)
  const jn = byName['Jack Island North Tug and Barge Holding Area']
  assert.equal(jn.detail.geometry_method, 'circle')
  assert.equal(jn.detail.radius_yd, 600)
  assert.equal(jn.detail.radius_m, 548.6)
  assert.equal(parseNumberWords('six hundred'), 600)
  assert.equal(parseNumberWords('2,000'), 2000)
  assert.equal(parseNumberWords('many'), null)
})

test('proposed geometry: lone latitude lines or no coordinates build nothing (no invented shoreline)', () => {
  const qh = paras.find((p) => p.para === '(a)(16)')
  assert.equal(coordPairs(qh.body).length, 2)
  assert.equal(proposedGeometry(qh.body).geometry, null)
  assert.equal(proposedGeometry(paras.find((p) => p.para === '(a)(17)(i)').body).geometry, null)
})

test('geometry: circle, even-odd point-in-polygon with a hole, distance to the edge (SYNTHETIC shapes)', () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
  const donut = { type: 'Polygon', coordinates: [sq(-123, 48, -122, 49), sq(-122.6, 48.4, -122.4, 48.6)] }
  assert.ok(pointInGeometry(donut, 48.2, -122.8))
  assert.ok(!pointInGeometry(donut, 48.5, -122.5)) // in the hole
  assert.ok(!pointInGeometry(donut, 49.5, -122.5))
  const c = circlePolygon(48, -122, 1000)
  assert.ok(pointInGeometry(c, 48, -122))
  assert.ok(Math.abs(distanceToGeometryM(c, 48, -122) - 1000) < 5)
})

test('matching the real GFW positions: in, near and outside', () => {
  const at = (k) => matchPoint(all, pos[k].lat, pos[k].lon)
  assert.equal(at('Cherry').inside, null)                                    // ~2 km outside Cherry Point
  assert.equal(at('Cherry').near, null)
  const cp = all.find((a) => a.name === 'Cherry Point')
  assert.ok(Math.abs(distanceToGeometryM(cp.geometry, pos.Cherry.lat, pos.Cherry.lon) - 1980) < 40)
  assert.equal(at('Vendovi').inside.name, 'Vendovi East General Anchorage')
  assert.equal(at('Vendovi').inside.legal_status, 'non_designated')
  assert.equal(at('Port').inside.name, 'Port Angeles General Anchorage')
  assert.equal(at('English').inside.name, 'English Bay Anchorage U')
  assert.equal(at('Seattle').inside.name, 'Smith Cove West')
  assert.equal(at('Seattle').inside.legal_status, 'designated')
  const ol = at('Oleum')
  assert.equal(ol.inside, null)
  assert.equal(ol.near.a.name, 'Anchorage 20')
  assert.ok(ol.near.distance_m > 0 && ol.near.distance_m <= NEAR_M)
  assert.equal(at('Anacortes').inside, null)
  assert.equal(at('Anacortes').near, null)
})

test('precedence: designated beats non-designated when both contain the stop (SYNTHETIC overlap)', () => {
  const ve = all.find((a) => a.name === 'Vendovi East General Anchorage')
  const fake = { ...ve, name: 'TEST designated copy', legal_status: 'designated', min_lat: ve.min_lat - 0.01, max_lat: ve.max_lat + 0.01, min_lon: ve.min_lon - 0.01, max_lon: ve.max_lon + 0.01,
    geometry: { type: 'Polygon', coordinates: [[[ve.min_lon - 0.01, ve.min_lat - 0.01], [ve.max_lon + 0.01, ve.min_lat - 0.01], [ve.max_lon + 0.01, ve.max_lat + 0.01], [ve.min_lon - 0.01, ve.max_lat + 0.01], [ve.min_lon - 0.01, ve.min_lat - 0.01]]] } }
  const m = matchPoint([ve, fake], pos.Vendovi.lat, pos.Vendovi.lon)
  assert.equal(m.inside.name, 'TEST designated copy')
  assert.deepEqual(m.alsoInside, ['Vendovi East General Anchorage'])
  const p = publicAnchorage({ ...ve, id: '3', source_record_id: '9' })
  assert.equal(p.geometry, undefined) // the card never gets geometry
  assert.equal(p.id, 3)
})
