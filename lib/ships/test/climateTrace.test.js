/**
 * Climate TRACE ports → our ports (pure; offline). Fixture: REAL port sources from the v5.10.0 facility bake
 * (fixtures/climatetrace-ports-puget-v5.10.0.json). Our port positions are SYNTHETIC (WPI-like coordinates).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapCtPort, pickClimateTrace, CT_JOIN_KM } from '../climateTrace.js'
import { fixture } from './scenarios.js'

const fx = fixture('climatetrace-ports-puget-v5.10.0.json')
const cts = fx.features.map((f) => mapCtPort(f, 'v5.10.0').payload)

test('mapCtPort: shipping sources only; the monthly series is not copied', () => {
  const m = mapCtPort(fx.features[0], 'v5.10.0')
  assert.ok(m.key && m.payload.lat && m.payload.lon && m.payload.sub.endsWith('-shipping'))
  assert.equal('m' in m.payload, false)
  assert.ok(mapCtPort({ properties: { id: 1, sub: 'electricity-generation' }, geometry: { coordinates: [0, 0] } }).error)
})

test('pickClimateTrace: Seattle gets its own two sources; a nearer port of ours takes a source instead', () => {
  const seattle = { id: 1, name: 'Seattle', lat: 47.6, lon: -122.3333 } // SYNTHETIC, WPI-like
  const tacoma = { id: 2, name: 'Tacoma', lat: 47.2667, lon: -122.4167 }
  const got = pickClimateTrace(seattle, cts, [seattle, tacoma])
  const own = got.filter((c) => c.name === 'Seattle')
  assert.deepEqual(own.map((c) => c.sub).sort(), ['domestic-shipping', 'international-shipping'])
  assert.ok(own.every((c) => c.km < 1 && c.by === 'distance'))
  assert.ok(got.every((c) => c.km <= CT_JOIN_KM || c.by === 'name'))
  // A port of ours right on top of a Climate TRACE point wins it from Seattle.
  const fauntleroy = cts.find((c) => /Fauntleroy/.test(c.name))
  if (fauntleroy) {
    const onIt = { id: 3, name: 'Fauntleroy', lat: fauntleroy.lat, lon: fauntleroy.lon }
    assert.equal(pickClimateTrace(seattle, cts, [seattle, onIt]).some((c) => c.id === fauntleroy.id), false)
    assert.equal(pickClimateTrace(onIt, cts, [seattle, onIt]).some((c) => c.id === fauntleroy.id), true)
  }
})
