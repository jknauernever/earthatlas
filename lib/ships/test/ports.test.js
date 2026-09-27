/**
 * Ports reference: pure parsing + label matching (offline).
 * Fixtures are REAL: fixtures/ports-live-2026-09-26.json holds verbatim extracts of the four downloads
 * (WPI JSON, UN/LOCODE 2025-1 CSV, GFW anchorage overrides CSV, GeoNames countryInfo) plus one GFW event
 * as stored by the step-1 fetch; the GFW port-visit responses are the ones recorded live 2026-09-26.
 * Cases that edit real values are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  csvRows, mapWpiPort, parseLocodeCoords, mapLocodeRow, parseCountryInfo, parseOverridesCsv, cellOverride, isCodeName,
  haversineKm, matchLabel, labelsFromAnchorages, tidyName, MATCH_KM, WPI_SOURCE, LOCODE_SOURCE, OVERRIDES_SOURCE, COUNTRIES_SOURCE,
} from '../ports.js'
import { fixture } from './scenarios.js'

const fx = fixture('ports-live-2026-09-26.json')
const ae = fixture('gfw-live-portvisits-american-endurance-2026-09-26.json').body.entries
const ed = fixture('gfw-live-portvisits-eurodam-2026-09-26.json').body.entries
const svi = fixture('gfw-live-portvisits-spirit-of-vancouver-island-2026-09-26.json').body.entries

const countries = parseCountryInfo([fx.countries.header, ...fx.countries.lines].join('\n'))
const iso3 = new Map(countries.map((c) => [c.country.iso2, c.country.iso3]))
const wpi = fx.wpi.ports.map((p) => mapWpiPort(p).port).map((p, i) => ({ ...p, iso3: iso3.get(p.iso2), record_id: 1000 + i }))
const ovParsed = parseOverridesCsv(fx.overrides.lines.join('\n'))
const overrides = new Map()
for (const r of ovParsed.rows) overrides.set(r.key, [...(overrides.get(r.key) || []), { ...r.override, record_id: 5000 + overrides.size }])

/** GFW events → label groups, the way matchPortLabels aggregates stored visits (all three anchorage slots). */
function labelsOf(entries) {
  const agg = new Map()
  for (const e of entries) for (const k of ['startAnchorage', 'intermediateAnchorage', 'endAnchorage']) {
    const a = e.port_visit[k]
    if (!a) continue
    const key = `${a.id}|${a.anchorageId}`
    const g = agg.get(key) || { port_label: a.id, anchorage_id: a.anchorageId, name: a.name, iso3: a.flag, lat: a.lat, lon: a.lon, visits: 0 }
    g.visits++
    agg.set(key, g)
  }
  return new Map(labelsFromAnchorages([...agg.values()]).map((l) => [l.label, l]))
}
const aeL = labelsOf(ae), edL = labelsOf(ed), sviL = labelsOf(svi), homerL = labelsOf(fx.gfw_events.entries)

test('sources: licence, commercial use and attribution recorded for all four', () => {
  assert.match(WPI_SOURCE.license, /no copyright claimed/i)
  assert.equal(WPI_SOURCE.commercial_use, true)
  assert.match(LOCODE_SOURCE.license, /CC BY 4\.0/)
  assert.match(LOCODE_SOURCE.notes, /LICENCE CONFLICT/)
  assert.match(LOCODE_SOURCE.attribution_text, /UNECE/)
  assert.match(OVERRIDES_SOURCE.license, /Apache-2\.0/)
  assert.match(COUNTRIES_SOURCE.license, /CC BY 4\.0/)
  assert.match(COUNTRIES_SOURCE.attribution_text, /GeoNames/)
})

test('csvRows: RFC 4180 quotes, doubled quotes, CRLF, BOM', () => {
  assert.deepEqual(csvRows('﻿a,"b,c","d ""e"""\r\n1,,3\n'), [['a', 'b,c', 'd "e"'], ['1', '', '3']])
})

test('WPI: live Seattle entry maps field by field; the raw name is kept next to the tidied one', () => {
  const sea = mapWpiPort(fx.wpi.ports.find((p) => p.portNumber === 17730))
  assert.equal(sea.key, '17730')
  assert.equal(sea.port.name, 'Seattle')
  assert.equal(sea.port.iso2, 'US')
  assert.equal(sea.port.unlocode, 'US SEA')
  assert.equal(sea.port.harbor_size, 'L')
  assert.ok(Math.abs(sea.port.lat - 47.6) < 1e-9) // WPI sends 47.60000000000008
  assert.ok(Math.abs(sea.port.lon + 122.333333) < 1e-5)
  const roche = mapWpiPort(fx.wpi.ports.find((p) => p.portNumber === 17940))
  assert.equal(roche.port.name_raw, 'Roche  Harbor') // two spaces, as WPI has it
  assert.equal(roche.port.name, 'Roche Harbor')
  assert.equal(tidyName('  a \t b '), 'a b')
})

test('WPI: an entry without portNumber or coordinates is reported, not guessed (SYNTHETIC edits of Seattle)', () => {
  const sea = fx.wpi.ports.find((p) => p.portNumber === 17730)
  assert.ok(mapWpiPort({ ...sea, portNumber: null }).error)
  assert.ok(mapWpiPort({ ...sea, ycoord: null }).error)
  assert.equal(mapWpiPort({ ...sea, unloCode: 'nonsense' }).port.unlocode, null)
})

test('UN/LOCODE: coordinates, port function, country header rows', () => {
  assert.deepEqual(parseLocodeCoords('4901N 12305W'), { lat: 49.016667, lon: -123.083333 })
  assert.equal(parseLocodeCoords(''), null)
  assert.equal(parseLocodeCoords('9901N 12305W'), null)
  const rows = csvRows(fx.locode.lines.join('\n')).map(mapLocodeRow)
  const by = new Map(rows.filter((r) => r.key).map((r) => [r.key, r.locode]))
  assert.equal(by.get('US SEA').is_port, true)          // 1--45---
  assert.equal(by.get('US SEA').coords, null)           // no coordinates in UN/LOCODE (docs §2)
  assert.equal(by.get('US SIT').is_port, false)         // ---4---- : airport only
  assert.equal(by.get('US CP4').is_port, false)         // --3----- : Cherry Point, though PortWatch lists it as a port
  assert.deepEqual(by.get('US CP4').coords, { lat: 48.866667, lon: -122.5 })
  assert.ok(rows.some((r) => r.skip === 'country header row'))
})

test('countries: GeoNames ISO2 → ISO3 → English name; comment lines skipped', () => {
  const us = countries.find((c) => c.key === 'US')
  assert.deepEqual(us.country, { iso2: 'US', iso3: 'USA', iso_numeric: '840', name: 'United States' })
  assert.equal(countries.find((c) => c.key === 'CA').country.iso3, 'CAN')
  assert.equal(countries.find((c) => c.key === 'SX').country.iso3, 'SXM')
  assert.ok(!countries.some((c) => c.line.startsWith('#')))
})

test('overrides: repeated S2 cells are all kept; a spreadsheet-mangled s2id is an error that keeps its raw row', () => {
  assert.deepEqual(ovParsed.header, ['s2id', 'latitude', 'longitude', 'label', 'sublabel', 'iso3'])
  assert.equal(ovParsed.rows.filter((r) => r.key === '47624103').length, 2)
  assert.equal(ovParsed.errors.length, 1)
  assert.equal(ovParsed.errors[0].raw.s2id, '1.46E+83')
})

test('cellOverride: one real label wins; code labels are not names; different real labels are not guessed', () => {
  assert.equal(cellOverride(overrides.get('47624103')).label, 'OLIB')            // OLIB twice (sublabel differs)
  assert.equal(cellOverride(overrides.get('12994ef7')).label, 'IBIZA')           // IBIZA + ESP-113
  assert.deepEqual(cellOverride(overrides.get('8fab0e03')), { ambiguous: ['COLON', 'MANZANILLO'] })
  assert.equal(cellOverride(undefined), null)
  assert.ok(isCodeName('USA-1843') && isCodeName('can-279') && !isCodeName('PORT ANGELES'))
})

test('haversineKm: 1° of latitude ≈ 111.2 km; symmetric', () => {
  assert.ok(Math.abs(haversineKm(48, -123, 49, -123) - 111.195) < 0.01)
  assert.equal(haversineKm(47.6, -122.3, 48.1, -123.4), haversineKm(48.1, -123.4, 47.6, -122.3))
})

test('(a) WPI within 4 km: AMERICAN ENDURANCE usa-anacortes → WPI Anacortes, distance recorded', () => {
  const d = matchLabel(aeL.get('usa-anacortes'), wpi, overrides)
  assert.equal(d.method, 'wpi_within_4km')
  assert.equal(d.name, 'Anacortes')
  assert.equal(d.name_source_id, 'nga-wpi')
  assert.equal(d.wpi_number, 18040)
  assert.ok(d.distance_km > 2 && d.distance_km < 2.2)
  assert.ok(d.name_record_id)
})

test('(a) several WPI ports in range, nearest clearly nearest: usa-selby → Oleum; the others kept as candidates', () => {
  const d = matchLabel(aeL.get('usa-selby'), wpi, overrides)
  assert.equal(d.method, 'wpi_nearest_clear')
  assert.equal(d.name, 'Oleum')
  assert.deepEqual(d.candidates.map((c) => c.name), ['South Vallejo', 'Crockett'])
  assert.ok(d.distance_km < 0.5 * d.candidates[0].distance_km)
})

test('(a) two WPI ports at similar distance: usa-homer is NOT given a WPI name; both recorded as candidates', () => {
  const d = matchLabel(homerL.get('usa-homer'), wpi, overrides)
  assert.deepEqual(d.candidates.filter((c) => c.kind === 'wpi').map((c) => c.name).sort(), ['Coal Point', 'Homer'])
  assert.notEqual(d.name_source_id, 'nga-wpi')
  assert.equal(d.method, 'gfw_event_name') // falls through to GFW's own name
  assert.equal(d.name, 'HOMER')
})

test('(a) a WPI port in another country is never used (SYNTHETIC: Anacortes anchorage relabelled CAN)', () => {
  const l = structuredClone(aeL.get('usa-anacortes'))
  l.iso3 = 'CAN'
  const d = matchLabel(l, wpi, overrides)
  assert.notEqual(d.name_source_id, 'nga-wpi')
  assert.equal(d.candidates[0].reason, 'other country')
})

test('(b) GFW overrides list: SPIRIT OF VANCOUVER ISLAND can-tsawwassen → TSAWWASSEN (no WPI port within 4 km)', () => {
  const d = matchLabel(sviL.get('can-tsawwassen'), wpi, overrides)
  assert.equal(d.method, 'gfw_override_label')
  assert.equal(d.name, 'TSAWWASSEN')
  assert.equal(d.name_source_id, 'gfw-anchorage-overrides')
  assert.equal(d.override_s2id, '5485e5b5')
})

test('(c) GFW event name: EURODAM mex-cabosanlucas → CABO SAN LUCAS', () => {
  const d = matchLabel(edL.get('mex-cabosanlucas'), wpi, overrides)
  assert.equal(d.method, 'gfw_event_name')
  assert.equal(d.name, 'CABO SAN LUCAS')
})

test('(d) approximate: CAN-279 (Swartz Bay terminal): no WPI within 4 km, no override, GFW name is a code → "near Sidney"', () => {
  const d = matchLabel(sviL.get('can-can-279'), wpi, overrides)
  assert.equal(d.method, 'wpi_near_approx')
  assert.equal(d.name, 'Sidney')
  assert.ok(d.notes.some((n) => /CAN-279.*code/.test(n)))
  // WPI Sidney is the nearest WPI port, about 9.4 km away: beyond GFW's 4 km port radius.
  const p = sviL.get('can-can-279').points[0]
  const sidney = wpi.find((w) => w.wpi_number === 18660)
  assert.ok(haversineKm(p.lat, p.lon, sidney.lat, sidney.lon) > MATCH_KM)
})

test('(d) approximate: usa-usa-399 (AMERICAN ENDURANCE, 39 visits): WPI Anacortes is 5.5 km away → "near Anacortes"', () => {
  const d = matchLabel(aeL.get('usa-usa-399'), wpi, overrides)
  assert.equal(d.method, 'wpi_near_approx')
  assert.equal(d.name, 'Anacortes')
  const p = aeL.get('usa-usa-399').points.sort((a, b) => b.visits - a.visits)[0]
  const ana = wpi.find((w) => w.wpi_number === 18040)
  assert.ok(haversineKm(p.lat, p.lon, ana.lat, ana.lon) > MATCH_KM)
})

test('labelsFromAnchorages: groups points by label, country by visit weight', () => {
  const g = labelsFromAnchorages([
    { port_label: 'x', anchorage_id: 'a', lat: 1, lon: 2, name: null, iso3: 'USA', visits: 3 },
    { port_label: 'x', anchorage_id: 'b', lat: 1.01, lon: 2, name: 'X', iso3: 'CAN', visits: 1 },
    { port_label: null, anchorage_id: 'c', lat: 0, lon: 0, visits: 1 },
  ])
  assert.equal(g.length, 1)
  assert.equal(g[0].iso3, 'USA')
  assert.equal(g[0].points.length, 2)
})

// Josh 2026-09-26: a WPI facility name gives way to a GFW label; GFW's nearest-override rule (≤ 4 km).
test('matchLabel: WPI terminal name gives way to the overrides label, WPI match kept', () => {
  const label = { label: 'xxx-port', iso3: 'XXX', points: [{ anchorage_id: 'abc1', lat: 10, lon: 20, visits: 3 }] }
  const wpi = [{ wpi_number: 1, name: 'Somewhere Oil Terminal', iso3: 'XXX', lat: 10.01, lon: 20, record_id: 7 }]
  const overrides = new Map([['abc1', [{ s2id: 'abc1', lat: 10, lon: 20, label: 'SOMEWHERE', iso3: 'XXX', record_id: 9 }]]])
  const d = matchLabel(label, wpi, overrides)
  assert.equal(d.name, 'SOMEWHERE')
  assert.equal(d.method, 'gfw_override_label_over_wpi_facility')
  assert.equal(d.wpi_number, 1)
  const plain = matchLabel(label, [{ ...wpi[0], name: 'Somewhere' }], overrides)
  assert.equal(plain.name, 'Somewhere')
  assert.equal(plain.method, 'wpi_within_4km')
})

test('matchLabel: nearest override point within 4 km names an otherwise unnamed label', () => {
  const label = { label: 'xxx-xxx-1', iso3: 'XXX', points: [{ anchorage_id: 'aaa1', lat: 10, lon: 20, visits: 2 }] }
  const near = [{ s2id: 'bbb2', lat: 10.02, lon: 20, label: 'NEARBY HARBOUR', iso3: 'XXX', record_id: 5 }]   // ~2.2 km
  const far = [{ s2id: 'ccc3', lat: 10.2, lon: 20, label: 'FAR AWAY', iso3: 'XXX', record_id: 6 }]           // ~22 km
  const d = matchLabel(label, [], new Map([['bbb2', near], ['ccc3', far]]))
  assert.equal(d.method, 'gfw_override_nearest')
  assert.equal(d.name, 'NEARBY HARBOUR')
  assert.equal(matchLabel(label, [], new Map([['ccc3', far]])).method, 'unnamed')
})

// Josh 2026-09-26 ("usa-usa-1065"): nothing names the spot → "near <nearest WPI port>" within 25 km, same country.
test('matchLabel: approximate "near" name from the nearest WPI port within 25 km', () => {
  const label = { label: 'usa-usa-1065', iso3: 'USA', points: [{ anchorage_id: '54859667', lat: 48.8024, lon: -122.7216, visits: 126 }] }
  const wpi = [
    { wpi_number: 1, name: 'Cherry Point', iso3: 'USA', lat: 48.8667, lon: -122.75, record_id: 1 },   // 7.4 km
    { wpi_number: 2, name: 'Bellingham', iso3: 'USA', lat: 48.75, lon: -122.5, record_id: 2 },        // 17 km
    { wpi_number: 3, name: 'Lyall Harbor', iso3: 'CAN', lat: 48.8, lon: -122.73, record_id: 3 },      // other country
  ]
  const d = matchLabel(label, wpi, new Map())
  assert.equal(d.method, 'wpi_near_approx')
  assert.equal(d.name, 'Cherry Point')
  assert.ok(d.distance_km > 7 && d.distance_km < 8)
  const far = matchLabel({ ...label, points: [{ ...label.points[0], lat: 49.5 }] }, wpi, new Map())
  assert.equal(far.method, 'unnamed')
})
