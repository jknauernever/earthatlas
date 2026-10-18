/**
 * Port place names (lib/ships/placeNames.js): pure rule tests, no database, no network.
 * REAL: the GeoNames and CGNDB records used are copied from GeoNames' US/CA dumps (2026-10-18) and the CGNDB radius
 * search around Roberts Bank; the port points are the GFW anchorage points of the ports named.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPlace, pickPlaceName, applyPlaceName, parseGeonamesLine, GEONAMES_FIELDS } from '../placeNames.js'

const gn = (geonameid, name, lat, lon, fc, code) => mapPlace('geonames-places', { geonameid, name, latitude: String(lat), longitude: String(lon), feature_class: fc, feature_code: code, country_code: 'US' })
const places = [
  gn('7716939', 'Jones Island Marina', 48.61804, -123.04765, 'S', 'MAR'),
  gn('5798931', 'Jones Island', 48.6145, -123.0463, 'T', 'ISL'),
  gn('5810710', 'Skull Island', 48.6420, -122.9842, 'T', 'ISL'),
  gn('7716977', 'Semiahmoo Marina', 48.98810, -122.77080, 'S', 'MAR'),
  gn('5787475', 'Blaine', 48.99372, -122.74765, 'P', 'PPL'),
  gn('7716925', 'Cayou Quay Marina', 48.62110, -123.00352, 'S', 'MAR'),
  gn('5792113', 'Deer Harbor', 48.61816, -123.00194, 'P', 'PPL'),
  mapPlace('nrcan-cgndb', { id: 'JBJJY', name: 'Roberts Bank', latitude: '49.0186', longitude: '-123.1601', 'concise.code': 'MAR' }),
].map((p, i) => ({ ...p, record_id: i + 1 }))
const guess = (name) => ({ method: 'gfw_override_nearest', name, name_source_id: 'gfw-anchorage-overrides', candidates: [], notes: [] })

test('parseGeonamesLine reads the published columns', () => {
  const line = ['7716939', 'Jones Island Marina', 'Jones Island Marina', '', '48.61804', '-123.04765', 'S', 'MAR', 'US', '', 'WA', '055', '', '', '0', '', '3', 'America/Los_Angeles', '2011-06-15'].join('\t')
  const r = parseGeonamesLine(line)
  assert.equal(Object.keys(r).length, GEONAMES_FIELDS.length)
  assert.equal(r.feature_code, 'MAR')
})

test('a guessed name gives way to the nearest marina within 0.5 km, else the nearest island/bay/town within 2 km', () => {
  const d = applyPlaceName(guess('DEER HARBOR'), places, { lat: 48.6180, lon: -123.0477 })
  assert.equal(d.name, 'Jones Island Marina')
  assert.equal(d.method, 'geonames_maritime_nearest')
  assert.equal(d.name_source_id, 'geonames-places')
  assert.deepEqual(d.candidates.at(-1), { kind: 'previous_name', name: 'DEER HARBOR', method: 'gfw_override_nearest' })
  const e = applyPlaceName(guess('DEER HARBOR'), places, { lat: 48.6403, lon: -122.9835 })
  assert.equal(e.name, 'Skull Island')
  assert.equal(e.method, 'geonames_place_nearest')
})

test('GFW’s own name is replaced only by a much closer place', () => {
  const gfw = { method: 'gfw_event_name', name: 'BLAINE', candidates: [], notes: [] }
  const d = applyPlaceName(gfw, places, { lat: 48.9883, lon: -122.7705 })   // marina 30 m away, Blaine (town) ~1.8 km
  assert.equal(d.name, 'Semiahmoo Marina')
  assert.equal(d.method, 'geonames_maritime_nearest_over_gfw_name')
  const near = applyPlaceName(gfw, places, { lat: 48.9930, lon: -122.7520 }) // town 300 m away: GFW's name stands
  assert.equal(near.name, 'BLAINE')
  const dh = applyPlaceName({ method: 'gfw_event_name', name: 'DEER HARBOR', candidates: [], notes: [] }, places, { lat: 48.62096, lon: -123.00487 })
  assert.equal(dh.name, 'DEER HARBOR')   // the village is 380 m away: GFW's name is the place, not one of its marinas
  // REAL: GeoNames 5810102 Shaw Island (village); Blind Bay is a bay, which never outranks GFW's own name.
  const bay = [...places, mapPlace('geonames-places', { geonameid: '5786402', name: 'Blind Bay', latitude: '48.5797', longitude: '-122.9378', feature_class: 'H', feature_code: 'BAY', country_code: 'US' })]
  assert.equal(applyPlaceName({ method: 'gfw_event_name', name: 'SHAW ISLAND', candidates: [], notes: [] }, bay, { lat: 48.5792, lon: -122.9356 }).name, 'SHAW ISLAND')
})

test('Canadian ports fall back to CGNDB; WPI names are never replaced', () => {
  const d = applyPlaceName(guess('TSAWWASSEN'), places, { lat: 49.0106, lon: -123.1678 }, { canada: true })
  assert.equal(d.name, 'Roberts Bank')
  assert.equal(d.method, 'cgndb_nearest')
  assert.equal(applyPlaceName(guess('TSAWWASSEN'), places, { lat: 49.0106, lon: -123.1678 }).name, 'TSAWWASSEN')   // not in Canada: no CGNDB
  const wpi = { method: 'wpi_within_4km', name: 'Blaine', candidates: [], notes: [] }
  assert.equal(applyPlaceName(wpi, places, { lat: 48.9883, lon: -122.7705 }).name, 'Blaine')
  assert.equal(pickPlaceName(places, { lat: 47.0, lon: -122.0 }), null)
})
