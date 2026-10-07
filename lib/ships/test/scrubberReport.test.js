// Scrubber-ship calls report (docs/SHIPS_SCRUBBER_REPORT.md): the pure pieces. Offline; USACE owner strings are real rows read
// 2026-10-07 from the USACE Docks FeatureServer (NAV_UNIT_ID in the comments); the Census response is the shape the geocoder returned
// for Smith Cove (47.626389, -122.38277) the same day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ownershipOf, loadTerminalData, validateTerminalData, KINDS } from '../terminals.js'
import { placesOf, placeLabel } from '../terminalPlaces.js'
import { monthsBetween } from '../scrubberReport.js'
import { aisRegionOf, inAisBox, AIS_BOX } from '../terminalCalls.js'
import { SHIP_FIT } from '../terminalCard.js'

const own = (owner, extra = {}) => ownershipOf({ sources: { 'usace-docks': ['X'] }, ...extra }, new Map([['X', { OWNERS: owner }]]))

test('ownership: port districts, private companies and government bodies from USACE owner text', () => {
  assert.equal(own('Current Owner: Port of Seattle.').ownership, 'port_authority')                               // 0UNB
  assert.equal(own('Current Owner: PORT OF LONGVIEW BERTH 9 Phone: 360-425-3305').ownership, 'port_authority')    // 11TB
  assert.equal(own('Current Owner: Klickitat County Port District No. 1.').ownership, 'port_authority')
  assert.equal(own('Current Owner and Operator: Weyerhaeuser Co. Phone: 360/537-').ownership, 'private')           // 0TH6
  assert.equal(own('Current Owner: U.S. Oil & Refining Co.').ownership, 'private')        // "U.S." in a company name is not government
  assert.equal(own('Current Owner and Operator: State of Washington, DOT').ownership, 'government')
  assert.equal(own('Current Owner: U.S. Navy.').ownership, 'government')
  assert.equal(own('Current Owner: Port of Seattle.').basis.says, 'Port of Seattle.')
  assert.deepEqual(own(''), { ownership: null, basis: null })
})

test('ownership: a hand-checked entry wins over the USACE text', () => {
  const r = own('Current Owner: Port of Tacoma.', { id: 'wa-x', ownership: { class: 'private', source_url: 'https://example.org/a', says: 'PSE' } })
  assert.equal(r.ownership, 'private')
  assert.equal(r.basis.source, 'earthatlas-terminals')
})

test('terminal data file: valid, every kind has a ship-fit rule', async () => {
  const data = await loadTerminalData()
  assert.deepEqual(validateTerminalData(data), [])
  for (const k of KINDS) assert.ok(SHIP_FIT[k], `SHIP_FIT has ${k}`)
})

test('Census places: incorporated place, CDP, unincorporated', () => {
  const g = (places = {}) => ({ result: { geographies: { States: [{ STUSAB: 'WA' }], Counties: [{ NAME: 'King County', GEOID: '53033' }], ...places } } })
  assert.deepEqual(placesOf(g({ 'Incorporated Places': [{ NAME: 'Seattle city', GEOID: '5363000' }] })),
    { state_code: 'WA', county_name: 'King County', county_fips: '53033', place_name: 'Seattle city', place_geoid: '5363000', place_kind: 'incorporated' })
  assert.equal(placesOf(g({ 'Census Designated Places': [{ NAME: 'Manchester CDP', GEOID: '5342555' }] })).place_kind, 'cdp')
  assert.equal(placesOf(g()).place_kind, null)
  assert.equal(placeLabel('Port Angeles city'), 'Port Angeles')
})

test('months between, across a year end', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02'])
  assert.deepEqual(monthsBetween('2026-03', '2026-03'), ['2026-03'])
})

test('AIS boxes: Salish, Columbia River, neither', () => {
  assert.equal(aisRegionOf(47.6264, -122.3828), 'salish-v6')          // Smith Cove
  assert.equal(aisRegionOf(46.1072, -122.9561), 'wa-columbia-v1')     // Port of Longview berth 1 (USACE 0T72)
  assert.equal(aisRegionOf(46.9648, -123.8522), 'wa-columbia-v1')     // Port of Grays Harbor T2 (0UWW)
  assert.equal(aisRegionOf(50.1, -123.0), null)                       // Squamish
  assert.equal(inAisBox(46.1072, -122.9561), true)
  assert.equal(inAisBox(46.1072, -122.9561, AIS_BOX), false)          // the explicit salish box only
})
