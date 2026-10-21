import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dpsFromEncounters } from '../humpbackDps.js'

// Shaped like Happywhale /individual/info encounters (date, latlng [lat,lng], region, ocean).
const salish = { date: '2025-08-01', latlng: [48.5, -123.0], region: 'Washington, United States', ocean: 'North Pacific' }

test('a winter sighting off Maui makes a whale Hawaii population, not federally listed', () => {
  const r = dpsFromEncounters([salish, { date: '2026-01-18', latlng: [20.87, -156.7], region: 'Hawaii, United States', ocean: 'North Pacific' }])
  assert.equal(r.dps, 'hawaii')
  assert.equal(r.listed, false)
})

test('Pacific Mexico in winter = Mexico population (threatened); Central America = endangered', () => {
  assert.equal(dpsFromEncounters([salish, { date: '2024-02-10', latlng: [23.0, -109.7], region: 'Baja California Sur, Mexico', ocean: 'North Pacific' }]).dps, 'mexico')
  const ca = dpsFromEncounters([{ date: '2023-01-15', latlng: [9.6, -85.2], region: 'Puntarenas, Costa Rica', ocean: 'North Pacific' }])
  assert.equal(ca.dps, 'central-america')
  assert.equal(ca.status, 'federally endangered')
})

test('outside the breeding season, or on the Caribbean side, says nothing', () => {
  // Costa Rica in September = Southern Hemisphere humpbacks
  assert.equal(dpsFromEncounters([{ date: '2023-09-15', latlng: [9.6, -85.2], region: 'Puntarenas, Costa Rica', ocean: 'North Pacific' }]).dps, null)
  assert.equal(dpsFromEncounters([{ date: '2023-02-15', latlng: [9.4, -82.2], region: 'Bocas del Toro, Panama', ocean: 'Caribbean Sea' }]).dps, null)
  assert.equal(dpsFromEncounters([salish]).dps, null)
})

test('a whale seen on two breeding grounds is not assigned', () => {
  const r = dpsFromEncounters([
    { date: '2020-02-01', latlng: [20.8, -156.6], region: 'Hawaii, United States', ocean: 'North Pacific' },
    { date: '2022-02-01', latlng: [23.0, -109.7], region: 'Baja California Sur, Mexico', ocean: 'North Pacific' },
  ])
  assert.equal(r.dps, 'mixed')
})
