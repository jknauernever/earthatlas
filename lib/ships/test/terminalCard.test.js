/**
 * Terminal card logic (pure; offline): decision 1 ship-kind fit, GISIS berth positions, GEM GGIT LNG rows, the GISIS crosswalk's
 * name evidence. Fixtures (fixtures/README.md, "Terminals"): REAL GEM GGIT features, a REAL IMO GISIS facility row, the reviewed
 * data files. Classifications built by hand are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHIP_FIT, fitRule, shipFit, visitKind, fitWords } from '../terminalCard.js'
import { loadTerminalData, validateTerminalData, requiredKeys, resolveBerths, mapGemLngFeature, KINDS, BASES } from '../terminals.js'
import { parseGisisCsv, mapFacilityRow, checkCrosswalkRow, loadCrosswalk } from '../gisis.js'
import { fixture } from './scenarios.js'

const gem = fixture('gem-ggit-lng-salish-2024-12-20.json')
const isps = fixture('gisis-isps-facilities-live-2026-09-28.json')
const facilities = new Map(parseGisisCsv(isps.csv).map(mapFacilityRow).filter((m) => !m.error).map((m) => [m.key, m.facility]))
const data = await loadTerminalData()
const T = (id) => data.main.terminals.find((t) => t.id === id)

test('every terminal kind has a ship-fit rule', () => {
  for (const k of KINDS) assert.ok(SHIP_FIT[k], k)
})

test('decision 1 (SYNTHETIC classifications): tankers fit oil docks, bulk carriers coal, gas carriers LNG; ferries never', () => {
  const oil = fitRule('refinery_dock'), coal = fitRule('coal_terminal'), lng = fitRule('lng_terminal')
  assert.equal(shipFit(oil, { group: 'tanker', class: 'oil_tanker' }), 'fits')
  assert.equal(shipFit(oil, { group: 'tanker', class: 'tanker_unspecified' }), 'fits', 'AIS 80-89 = tanker is enough at an oil dock')
  assert.equal(shipFit(oil, { group: 'tanker', class: 'lng_carrier' }), 'other')
  assert.equal(shipFit(oil, { group: 'passenger', class: 'ferry' }), 'other')
  assert.equal(shipFit(coal, { group: 'cargo', class: 'bulk_carrier' }), 'fits')
  assert.equal(shipFit(coal, { group: 'cargo', class: 'container_ship' }), 'other')
  assert.equal(shipFit(lng, { group: 'tanker', class: 'lng_carrier' }), 'fits')
  assert.equal(shipFit(lng, { group: 'tanker', class: 'oil_tanker' }), 'other')
})

test('Josh 2026-09-28 (SYNTHETIC): tugs count at oil and fuel docks (likely moving a barge) and at aggregate / cement / forest docks, not at coal or grain', () => {
  const tug = { group: 'tug_tow', class: 'tug' }
  for (const k of ['refinery_dock', 'crude_terminal', 'product_terminal', 'bunkering_terminal', 'fuel_dock', 'military_fuel_pier']) {
    assert.equal(shipFit(fitRule(k), tug), 'fits', k)
    assert.equal(fitRule(k).tugNote, true, k)
  }
  for (const k of ['dry_bulk_terminal', 'cement_terminal', 'forest_products_terminal']) assert.equal(shipFit(fitRule(k), tug), 'fits', k)
  for (const k of ['coal_terminal', 'grain_terminal', 'lng_terminal']) assert.equal(shipFit(fitRule(k), tug), 'other', k)
  assert.equal(shipFit(fitRule('fuel_dock'), { group: 'fishing', class: 'fishing_unspecified' }), 'fits', 'small craft refuel at fuel docks')
})

test('cargo of unstated kind at coal / grain docks is "maybe" (listed, not counted); unknown kinds are never guessed (SYNTHETIC)', () => {
  assert.equal(shipFit(fitRule('coal_terminal'), { group: 'cargo', class: 'cargo_unspecified' }), 'maybe')
  assert.equal(shipFit(fitRule('grain_terminal'), { group: 'cargo', class: 'cargo_unspecified' }), 'maybe')
  assert.equal(shipFit(fitRule('coal_terminal'), { group: 'other', class: null }), 'unknown')
  assert.equal(shipFit(fitRule('coal_terminal'), { group: null, class: null }), 'unknown', 'sources disagree')
  assert.equal(shipFit(fitRule('coal_terminal'), { group: 'unknown', class: 'unknown_unspecified' }), 'unknown')
})

test('a terminal\'s own ship_fit widens its kind\'s rule: Vancouver Wharves (dry AND liquid bulk) also takes tankers', () => {
  const vw = T('bc-vancouver-wharves')
  const r = fitRule(vw.kind, vw.ship_fit)
  assert.equal(shipFit(r, { group: 'tanker', class: 'oil_tanker' }), 'fits')
  assert.equal(shipFit(r, { group: 'cargo', class: 'bulk_carrier' }), 'fits')
  assert.ok(fitWords(r).includes('oil tanker'))
})

test('visitKind: EarthAtlas\'s kind wins; a bare "other" falls back to the visit\'s GFW type; GFW "bunker" = bunkering tanker (SYNTHETIC)', () => {
  const byVessel = new Map([['v1', { group: 'tanker', class: 'oil_tanker', label: 'Oil tanker', basis: 'earthatlas' }],
    ['v2', { group: 'other', class: 'other_unspecified', label: 'Other', basis: 'earthatlas' }]])
  assert.equal(visitKind({ vessel: { vesselId: 'v1', gfwType: 'other' } }, byVessel).class, 'oil_tanker')
  const b = visitKind({ vessel: { vesselId: 'v2', gfwType: 'bunker' } }, byVessel)
  assert.equal(b.class, 'bunker_tanker'); assert.equal(b.basis, 'gfw')
  assert.equal(shipFit(fitRule('bunkering_terminal'), b), 'fits')
  assert.equal(visitKind({ vessel: { vesselId: null, gfwType: 'cargo' } }, byVessel).class, 'cargo_unspecified')
})

test('GISIS berths (REAL row CAVAC-0001): Univar\'s berth is the GISIS point; a missing facility is reported, not guessed', () => {
  const t = T('bc-univar-nv')
  assert.equal(BASES.gisis_facility, 'imo-gisis-port-facilities')
  assert.deepEqual(requiredKeys(data).gisis.sort(), ['CACHM-0002', 'CAVAC-0001'])
  const r = resolveBerths(t, [], { usace: new Map(), ecology: new Map(), bcpt: new Map(), osm: new Map(), gisis: facilities })
  assert.deepEqual(r.problems, [])
  assert.equal(r.berths[0].source, 'imo-gisis-port-facilities')
  assert.ok(Math.abs(r.berths[0].lat - 49.290833) < 1e-4 && Math.abs(r.berths[0].lon + 123.023) < 1e-4)
  const none = resolveBerths(t, [], { usace: new Map(), ecology: new Map(), bcpt: new Map(), osm: new Map(), gisis: new Map() })
  assert.equal(none.berths.length, 0)
  assert.match(none.problems.join(), /CAVAC-0001 is not stored/)
})

test('data file: decisions 5 and 6 recorded with sources; the files validate', () => {
  assert.deepEqual(validateTerminalData(data), [])
  const i = T('wa-intalco-wharf')
  assert.equal(i.kind, 'lpg_terminal')
  assert.deepEqual(i.commodities, ['liquefied petroleum gas'])
  assert.equal(i.commodities_history[0].commodity, 'alumina')
  assert.match(i.commodities_history[0].note, /Out of date/)
  for (const id of ['bc-crofton', 'bc-port-mellon', 'wa-point-wells']) {
    assert.ok(['closed', 'idle'].includes(T(id).status) && T(id).status_date && /^https?:\/\//.test(T(id).status_source_url), id)
  }
  const bad = structuredClone(data); bad.main.terminals.find((t) => t.id === 'bc-univar-nv').berths[0].ref = 'Univar' // SYNTHETIC
  assert.match(validateTerminalData(bad).join(), /IMO Port Facility Number/)
})

test('GEM GGIT (REAL features): LNG unit rows map by unit id; Tilbury and Woodfibre are credited to them', () => {
  const m = gem.features.map(mapGemLngFeature)
  assert.deepEqual(m.map((x) => x.key).sort(), ['T035101', 'T037401', 'T104401', 'T104402'])
  assert.equal(m.find((x) => x.key === 'T104401').payload.properties.owner, 'FortisBC [100.00%]')
  assert.match(mapGemLngFeature({ properties: { id: 'T1', 'tracker-acro': 'GGIT-pipeline' } }).error, /not an LNG/)
  const need = requiredKeys(data).gemLng
  assert.deepEqual(need, ['T037401', 'T104401', 'T104402'])
  assert.ok(need.every((k) => m.some((x) => x.key === k)))
})

test('GISIS crosswalk: a sourced name_evidence stands in for a shared word; without a URL it does not (REAL row + SYNTHETIC edit)', async () => {
  const cw = await loadCrosswalk()
  const row = cw.rows.find((r) => r.facility === 'CAVAC-0010')
  assert.equal(row.decision, 'link')
  const f = { name: 'PKM Canada Marine Terminal Limited Partnership', port: 'North Vancouver', lat: 49.306333, lon: -123.119833 }
  const t = { name: 'Vancouver Wharves (North Vancouver)', berths: [{ lat: 49.309433, lon: -123.117837 }] }
  const ok = checkCrosswalkRow(row, f, t)
  assert.equal(ok.ok, true, ok.problems.join())
  assert.equal(ok.name_basis, 'name_evidence')
  const noUrl = checkCrosswalkRow({ ...row, name_evidence: 'trust me' }, f, t)
  assert.equal(noUrl.ok, false)
  assert.equal(cw.rows.find((r) => r.facility === 'CADEL-0003').decision, 'candidate', 'Seaspan Tilbury stays unlinked')
})
