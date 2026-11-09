import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHIP_TYPE_GROUPS, shipGroupOf, cruiseSourceOf, CRUISE_SHIPS } from '../data/shipTypeGroups.js'

// Every vessel type Ecology's notices used, Jan 2025–Jun 2026 (production report, 2026-11-08).
const ECOLOGY_TYPES = ['FISHING VESSEL', 'TANK BARGE', 'PASSENGER SHIP', 'FERRY VESSEL', 'TUGBOAT', 'TANK SHIP', 'ATB BARGE', 'Un-regulated Vessel',
  'CONTAINER SHIP', 'WORK BOAT', 'MILITARY/LAW ENFORCEMENT', 'BULK CARRIER', 'GENERAL CARGO SHIP', 'ROLL-ON/ROLL-OFF VESSEL', 'ATB TUG', 'FISH PROCESSOR',
  'DECK BARGE', 'RECREATIONAL VESSEL', 'OFFSHORE SUPPLY VESSEL', 'RESEARCH VESSEL', 'ICEBREAKER', 'HOPPER/DREDGE', 'OCEANOGRAPHIC RESEARCH - INSPECTED',
  'SPILL RESPONSE VESSEL', 'Vessel', 'LNG/LPG/LG VESSEL', 'Z- UNKNOWN', 'CABLE LAYER/REPAIR SHIP', 'CONSTRUCTION BARGE', 'CARGO BARGE']

test('every Ecology vessel type is in exactly one group', () => {
  const listed = SHIP_TYPE_GROUPS.flatMap(([, ts]) => ts)
  assert.equal(new Set(listed).size, listed.length)
  for (const t of ECOLOGY_TYPES) assert.ok(listed.includes(t.toUpperCase()), t)
  assert.equal(shipGroupOf('tank ship'), 'Tankers')
  assert.equal(shipGroupOf(null), 'Recreational and other')
})

test('cruise ships only among notified passenger ships, each with a source link', () => {
  assert.equal(cruiseSourceOf('PASSENGER SHIP', 'Carnival  Spirit').url, 'https://www.wikidata.org/wiki/Q1044093')
  assert.equal(cruiseSourceOf('TANK SHIP', 'CARNIVAL SPIRIT'), null)
  assert.equal(cruiseSourceOf('PASSENGER SHIP', 'VICTORIA CLIPPER V'), null)
  for (const [n, s] of Object.entries(CRUISE_SHIPS)) assert.match(s.url, /^https:\/\/(www\.wikidata\.org\/wiki\/Q\d+|commons\.wikimedia\.org\/wiki\/Category:IMO_\d{7})$/, n)
})
