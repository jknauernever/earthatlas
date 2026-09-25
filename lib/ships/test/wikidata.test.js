/**
 * Wikidata mapping + community-curated resolver decisions (offline).
 * Fixtures are REAL recorded Wikidata responses (see fixtures/README.md).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapItem, wdTime, referencedQids, commonsLicense, imageFiles, stripHtml } from '../wikidata.js'
import { decideCurated, curatedNames } from '../resolve.js'
import { fixture } from './scenarios.js'

const eurodamRec = fixture('wd-live-eurodam-2026-09-25.json')
const miscRec = fixture('wd-live-misc-2026-09-25.json')
const item = (rec, q) => rec.response.entities[q]
const find = (as, attr) => as.filter((a) => a.attribute === attr)

test('EURODAM (real Q548546): identity, classification, operator, all community-curated', () => {
  const { assertions, warnings, isVessel } = mapItem(item(eurodamRec, 'Q548546'), eurodamRec.lookup)
  assert.deepEqual(warnings, [])
  assert.equal(isVessel, true)
  assert.ok(assertions.every((a) => a.evidence_class === 'community_curated'))
  assert.ok(assertions.every((a) => /^Q548546\$/.test(a.sub_record_ref))) // each claim → its exact statement
  const imo = find(assertions, 'imo')[0]
  assert.deepEqual([imo.value_norm, imo.detail.checksum_ok, imo.detail.item_label], ['9378448', true, 'MS Eurodam'])
  assert.equal(find(assertions, 'mmsi')[0].value_norm, '245206000')
  assert.equal(find(assertions, 'callsign')[0].value_norm, 'PHOS')
  const type = find(assertions, 'vessel_type')
  assert.deepEqual(type.map((t) => [t.value_norm, t.value_raw]), [['WD_Q39804', 'cruise ship (Q39804)']])
  assert.equal(find(assertions, 'operator')[0].value_raw, 'Holland America Line (Q1624735)')
  // "owned by" is not upgraded to a registered or beneficial owner.
  assert.equal(find(assertions, 'owner')[0].value_norm, 'HOLLANDAMERICALINE')
  assert.equal(find(assertions, 'registered_owner').length + find(assertions, 'registry_owner').length, 0)
  assert.equal(find(assertions, 'tonnage_gt')[0].value_norm, '86273')
  assert.equal(find(assertions, 'length_m')[0].value_norm, '285.43')
  assert.deepEqual(find(assertions, 'width_m').map((a) => a.detail.property).sort(), ['P2049', 'P2261'])
  assert.equal(find(assertions, 'service_entry')[0].value_norm, '2008')
  // Q55's ISO code NLD is deprecated in Wikidata (it belongs to the Kingdom, Q29999): no code is guessed.
  assert.equal(find(assertions, 'flag')[0].value_norm, 'WD_Q55')
  // No start/end qualifiers → no invented dates.
  assert.ok(assertions.every((a) => a.period_kind === 'unknown' && a.period_from === null && a.period_to === null))
})

test('Horizon Kodiak (real Q52331308): name history becomes validity periods at year precision', () => {
  const { assertions } = mapItem(item(miscRec, 'Q52331308'), miscRec.lookup)
  const names = find(assertions, 'name').map((a) => [a.value_raw, a.period_kind, a.period_from, a.period_to])
  assert.deepEqual(names, [
    ['Sea Land Kodiak', 'validity', '1987-01-01T00:00:00.000Z', '2001-01-01T00:00:00.000Z'],
    ['CSX Kodiak', 'validity', '2000-01-01T00:00:00.000Z', '2004-01-01T00:00:00.000Z'],
    ['Horizon Kodiak', 'validity', '2003-01-01T00:00:00.000Z', null], // open end = unknown, not "forever"
  ])
  assert.equal(find(assertions, 'flag')[0].value_norm, 'USA')
})

test('Point Nemo / New Jersey Responder (real Q135414827): type changes over time are both kept', () => {
  const { assertions } = mapItem(item(miscRec, 'Q135414827'), miscRec.lookup)
  const types = find(assertions, 'vessel_type').map((a) => [a.value_norm, a.period_from, a.period_to])
  assert.deepEqual(types, [
    ['WD_Q11903334', '1993-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z'],
    ['WD_Q1623035', '2023-01-01T00:00:00.000Z', null],
  ])
})

test('a company carrying an IMO company number (real Q5338367) is not a vessel and its IMO fails the ship checksum', () => {
  const { assertions, isVessel, warnings } = mapItem(item(miscRec, 'Q5338367'), miscRec.lookup)
  assert.equal(isVessel, false)
  assert.equal(find(assertions, 'vessel_type').length, 0)
  assert.deepEqual(find(assertions, 'instance_of').map((a) => a.value_norm).sort(), ['WD_Q4830453', 'WD_Q783794'])
  assert.equal(find(assertions, 'imo')[0].detail.checksum_ok, false)
  assert.match(warnings[0], /deprecated rank/) // a deprecated IMO statement stays only in the raw record
})

test('referencedQids lists P31 classes separately (they need the watercraft check)', () => {
  const r = referencedQids(item(eurodamRec, 'Q548546'))
  assert.deepEqual(r.classes, ['Q39804'])
  assert.ok(r.all.includes('Q1624735'))
})

test('Wikidata times: precision is honoured, coarser than a year is refused', () => {
  assert.deepEqual(wdTime({ time: '+2008-00-00T00:00:00Z', precision: 9 }),
    { iso: '2008-01-01T00:00:00.000Z', until: '2009-01-01T00:00:00.000Z', text: '2008', precision: 'year' })
  assert.equal(wdTime({ time: '+2008-06-16T00:00:00Z', precision: 11 }).until, '2008-06-17T00:00:00.000Z')
  assert.equal(wdTime({ time: '+2008-06-00T00:00:00Z', precision: 10 }).text, '2008-06')
  assert.equal(wdTime({ time: '+1990-00-00T00:00:00Z', precision: 8 }), null) // "the 1990s"
  assert.equal(wdTime({ time: '-0500-00-00T00:00:00Z', precision: 9 }), null)
})

const base = { acceptedVesselId: null, isVessel: true, imos: ['9378448'], holders: {} }
test('curated: registry IMO held by exactly one vessel → IMO_EXACT', () => {
  const d = decideCurated({ ...base, holders: { 9378448: [{ vesselId: 'v1', registry: true, corroboratedBy: [] }] } })
  assert.deepEqual([d.action, d.vesselId, d.method, d.via], ['accept', 'v1', 'IMO_EXACT', 'registry_imo'])
})
test('curated: AIS-only IMO needs a second identifier', () => {
  const lone = decideCurated({ ...base, holders: { 9378448: [{ vesselId: 'v1', registry: false, corroboratedBy: [] }] } })
  assert.equal(lone.action, 'unresolved'); assert.equal(lone.reason, 'ais_imo_not_corroborated')
  assert.equal(lone.candidates[0].evidence.holder_imo_basis, 'ais')
  const ok = decideCurated({ ...base, holders: { 9378448: [{ vesselId: 'v1', registry: false, corroboratedBy: ['mmsi', 'callsign'] }] } })
  assert.deepEqual([ok.action, ok.vesselId, ok.via, ok.method], ['accept', 'v1', 'ais_imo+mmsi+callsign', 'IMO_AIS_MMSI'])
})
test('decision 2026-09-25: an AIS-IMO attachment names its corroboration; name-only is IMO_AIS_NAME', () => {
  const m = (corroboratedBy) => decideCurated({ ...base, holders: { 9378448: [{ vesselId: 'v1', registry: false, corroboratedBy }] } }).method
  assert.equal(m(['callsign', 'name']), 'IMO_AIS_CALLSIGN')
  assert.equal(m(['name']), 'IMO_AIS_NAME')
  assert.equal(m(['mmsi', 'name']), 'IMO_AIS_MMSI')
})
test('curated: IMO on two vessels → unresolved with both as candidates, never a merge', () => {
  const d = decideCurated({ ...base, holders: { 9378448: [{ vesselId: 'v1', registry: false, corroboratedBy: [] },
    { vesselId: 'v2', registry: false, corroboratedBy: [] }] } })
  assert.equal(d.action, 'unresolved'); assert.equal(d.candidates.length, 2)
})
test('curated: never creates a vessel; non-vessels and MMSI-only items stay unresolved', () => {
  assert.equal(decideCurated(base).reason, 'no_vessel_with_imo')
  assert.equal(decideCurated({ ...base, imos: [] }).reason, 'no_valid_imo')
  assert.equal(decideCurated({ ...base, isVessel: false, holders: { 9378448: [{ vesselId: 'v1', registry: true, corroboratedBy: [] }] } }).reason, 'not_a_vessel')
  assert.equal(decideCurated({ ...base, imos: ['9378448', '8419166'] }).reason, 'conflicting_imos')
})
test('curated: an accepted item is kept even if new evidence points elsewhere', () => {
  const d = decideCurated({ ...base, acceptedVesselId: 'v1', holders: { 9378448: [{ vesselId: 'v2', registry: true, corroboratedBy: [] }] } })
  assert.deepEqual([d.action, d.vesselId, d.needsReview], ['keep', 'v1', true])
})
test('curatedNames strips a ship prefix only for comparison', () => {
  assert.deepEqual([...curatedNames(['EURODAM'], 'MS Eurodam')].sort(), ['EURODAM', 'MSEURODAM'])
  assert.deepEqual([...curatedNames([], 'Horizon Kodiak')], ['HORIZONKODIAK'])
})

// ── Images (Commons licence metadata; real recorded response for EURODAM's two P18 files) ──
const commonsRec = fixture('commons-live-eurodam-2026-09-25.json')
const commonsFor = (files) => Object.fromEntries(files.map((f) => [f,
  { page: Object.values(commonsRec.response.query.pages).find((p) => p.title === `File:${f}`), recordId: 7 }]))

test('EURODAM images (real Commons metadata): kept with licence, author, credit line, file page and thumbnail', () => {
  const e = item(eurodamRec, 'Q548546')
  const { assertions, images } = mapItem(e, eurodamRec.lookup, commonsFor(imageFiles(e)))
  assert.deepEqual(images.map((i) => [i.status, i.license]), [['kept', 'CC BY 2.0'], ['kept', 'CC BY-SA 4.0']])
  const img = find(assertions, 'image')
  assert.equal(img.length, 2)
  const sa = img.find((a) => a.detail.license_kind === 'cc_by_sa')
  assert.equal(sa.detail.rank, 'preferred')
  assert.equal(sa.detail.artist, 'Gordon Leggett')
  assert.equal(sa.detail.credit_line, 'Gordon Leggett / CC BY-SA 4.0 / via Wikimedia Commons')
  assert.equal(sa.detail.license_url, 'https://creativecommons.org/licenses/by-sa/4.0')
  assert.equal(sa.detail.commons_record_id, 7) // → the Commons raw record
  assert.match(sa.detail.file_page_url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
  assert.match(sa.detail.thumb_url, /^https:\/\/thumb\.wikimedia\.org\/.*px-/)
  assert.doesNotMatch(sa.detail.thumb_url, /utm_/)
  assert.equal(sa.evidence_class, 'community_curated') // the choice of photo is Wikidata's
})

test('images without Commons metadata are not stored (no licence = no image)', () => {
  const { assertions, images } = mapItem(item(eurodamRec, 'Q548546'), eurodamRec.lookup)
  assert.equal(find(assertions, 'image').length, 0)
  assert.ok(images.every((i) => i.status === 'no_commons_info'))
})

test('licence filter: CC0 / PD / CC BY / CC BY-SA kept; NC, ND, GFDL-only and unknown skipped (SYNTHETIC metadata)', () => {
  const L = (short, code) => commonsLicense({ LicenseShortName: { value: short }, License: { value: code } })
  assert.equal(L('CC0', 'cc0').ok, true)
  assert.equal(L('Public domain', 'pd').ok, true)
  assert.equal(L('CC BY 2.0', 'cc-by-2.0').kind, 'cc_by')
  assert.equal(L('CC BY-SA 3.0 de', 'cc-by-sa-3.0-de').kind, 'cc_by_sa')
  assert.equal(L('CC BY-NC-SA 2.0', 'cc-by-nc-sa-2.0').ok, false)
  assert.equal(L('CC BY-ND 4.0', 'cc-by-nd-4.0').ok, false)
  assert.equal(L('GFDL', 'gfdl').ok, false)
  assert.equal(L('', '').ok, false)
  assert.equal(stripHtml('<a href="//x">Gordon &amp; Co</a>'), 'Gordon & Co')
})
