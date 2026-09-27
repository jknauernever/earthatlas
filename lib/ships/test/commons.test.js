/**
 * Wikimedia Commons IMO categories → photo claims (pure; offline).
 * Fixture: commons-live-imo-2026-09-27.json, REAL responses recorded live by
 * scripts/ships/commonsClient.js (categoryinfo for three titles; members + files with
 * imageinfo for IMO 9509401 JUPITER SPIRIT and IMO 9515395 PARSIFAL). Cases that alter
 * a real page are marked SYNTHETIC in the test name.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseImoCategory, imoCategory, mapImoCategory, captureDate, harvestCategories, membersOf, notBestReason, pagesOf } from '../commons.js'
import { fetchImo } from '../ingestCommons.js'
import { fromCommonsCategory, crosswalkClaim, combine } from '../taxonomy.js'
import { decideCommons } from '../resolve.js'
import { fixture } from './scenarios.js'

const rec = fixture('commons-live-imo-2026-09-27.json')
const parentsRec = fixture('commons-parents-live-2026-09-27.json')
const catPage = (imo) => rec.categoryInfo.response.query.pages.find((p) => p.title === imoCategory(imo))
const filesOf = (imo) => Object.fromEntries(Object.entries(rec.byImo[imo].files).map(([c, rs]) => [c, rs.map((r) => r.response)]))
/** A client that replays the recorded responses (no network). */
const replayClient = (r = rec) => ({
  calls: 0,
  async members(title) { const imo = parseImoCategory(title).imo; return (r.byImo[imo]?.members || []).map((x) => ({ url: x.request, body: x.response })) },
  // REAL prop=categories responses (fixtures/commons-parents-live-2026-09-27.json), found by the titles asked for.
  async parents(titles) {
    const all = [...Object.values(parentsRec.parents).flat(), ...parentsRec.cathlamet.parents]
    return all.filter((x) => (x.response.query?.pages || []).some((pg) => titles.includes(pg.title))).map((x) => ({ url: x.request, body: x.response }))
  },
  async files(cat) {
    for (const e of Object.values(r.byImo)) if (e.files[cat]) return e.files[cat].map((x) => ({ url: x.request, body: x.response }))
    return []
  },
})

test('IMO category titles: parsed with the IMO checksum; anything else is not an IMO category', () => {
  assert.deepEqual(parseImoCategory('Category:IMO 9509401'), { imo: '9509401', valid: true })
  assert.deepEqual(parseImoCategory('Category:IMO 9500001'), { imo: '9500001', valid: false })
  assert.equal(parseImoCategory('Category:Jupiter Spirit (ship, 2011)'), null)
  assert.equal(parseImoCategory('Category:IMO 95094011'), null)
})

test('missing category (real categoryinfo "missing"): no claims', () => {
  const m = mapImoCategory({ title: imoCategory('9500001'), catPage: catPage('9500001'), files: {} })
  assert.equal(m.exists, false)
  assert.deepEqual(m.assertions, [])
})

test('real members: the IMO category holds one ship subcategory, which is what we harvest', () => {
  const mem = membersOf(rec.byImo['9509401'].members.map((r) => r.response))
  assert.deepEqual(harvestCategories(imoCategory('9509401'), mem), ['Category:Jupiter Spirit (ship, 2011)'])
  // Files directly in the IMO category are harvested too (SYNTHETIC member list).
  assert.deepEqual(harvestCategories('Category:IMO 1', [{ type: 'file', title: 'File:a.jpg' }, { type: 'subcat', title: 'Category:B' }]),
    ['Category:IMO 1', 'Category:B'])
})

test('JUPITER SPIRIT (real): both files kept with licence, author, file page; newest whole-ship photo is the main one', () => {
  const m = mapImoCategory({ title: imoCategory('9509401'), catPage: catPage('9509401'), files: filesOf('9509401'),
    fileRecords: { 'File:Car carrier Jupiter Spirit.jpg': 11 } })
  assert.equal(m.exists, true)
  assert.equal(m.assertions.length, 2)
  const [best, other] = m.assertions
  assert.match(best.value_raw, /Port of Auckland/)
  assert.equal(best.detail.capture_date, '2025-07-22')
  assert.equal(best.detail.best, true)
  assert.equal(best.detail.license_short_name, 'CC BY-SA 4.0')
  assert.equal(best.detail.share_alike, true)
  assert.equal(best.detail.artist, 'XiaYZ2023')
  assert.match(best.detail.file_page_url, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
  assert.doesNotMatch(best.detail.thumb_url, /utm_/)
  assert.deepEqual([best.evidence_class, best.period_kind, best.sub_record_ref.startsWith('File:')], ['community_curated', 'unknown', true])
  assert.deepEqual([best.detail.via, best.detail.imo, best.detail.imo_category, best.detail.category],
    ['commons_imo_category', '9509401', 'Category:IMO 9509401', 'Category:Jupiter Spirit (ship, 2011)'])
  assert.equal(other.value_raw, 'Car carrier Jupiter Spirit.jpg')
  assert.deepEqual([other.detail.license_kind, other.detail.commons_record_id, other.detail.best], ['cc0', 11, false])
})

test('PARSIFAL (real, 15 files): a photo that also shows a tugboat is never the main one; the newest whole-ship photo is', () => {
  const m = mapImoCategory({ title: imoCategory('9515395'), catPage: catPage('9515395'), files: filesOf('9515395') })
  assert.equal(m.assertions.length, 15)
  assert.equal(m.assertions[0].value_raw, 'Parsifal, Fremantle, 2017 (01).jpg')
  const tug = m.assertions.find((a) => a.value_raw === 'Parsifal, Fremantle, 2015 (08).JPG')
  assert.match(tug.detail.not_best_reason, /other ships too \(Svitzer Eagle \(tugboat, 2008\)\)/)
  assert.equal(tug.detail.photo_order, 14) // last: the only one with a reason
  assert.deepEqual(m.assertions.map((a) => a.detail.photo_order), [...Array(15).keys()])
  assert.equal(m.images.filter((i) => i.best).length, 1)
})

test('licence gate and photo filter (SYNTHETIC edits of a real page): NC → skipped; PDF → not a photo; interior → not the main photo', () => {
  const files = filesOf('9509401')
  const [a, b] = pagesOf(Object.values(files)[0])
  const nc = structuredClone(a); nc.imageinfo[0].extmetadata.LicenseShortName.value = 'CC BY-NC 2.0'; nc.imageinfo[0].extmetadata.License.value = 'cc-by-nc-2.0'
  const pdf = structuredClone(b); pdf.title = 'File:Deck plan.pdf'; pdf.imageinfo[0].mime = 'application/pdf'
  const inside = structuredClone(b); inside.title = 'File:Jupiter Spirit engine control room.jpg'; inside.imageinfo[0].extmetadata.DateTimeOriginal.value = '2026-01-01'
  const m = mapImoCategory({ title: imoCategory('9509401'), catPage: catPage('9509401'),
    files: { 'Category:Jupiter Spirit (ship, 2011)': [{ query: { pages: [nc, pdf, inside, b] } }] } })
  assert.deepEqual(m.images.find((i) => i.file === a.title.slice(5)), { file: a.title.slice(5), status: 'skipped_license', license: 'CC BY-NC 2.0', kind: 'nc_nd_or_nonfree' })
  assert.equal(m.images.find((i) => i.file === 'Deck plan.pdf').status, 'not_a_photo')
  const ins = m.assertions.find((x) => x.value_raw.includes('engine control'))
  assert.match(ins.detail.not_best_reason, /^detail_or_interior/)
  assert.equal(ins.detail.best, false) // newer, but an interior
  assert.equal(notBestReason({ title: 'File:Eurodam at sea.jpg', imageinfo: [{ width: 1200, height: 800, extmetadata: {} }] }), null)
})

test('capture dates: free text / HTML → YYYY[-MM[-DD]], implausible years ignored', () => {
  assert.equal(captureDate({ DateTimeOriginal: { value: '2025-07-22 13:10:05' } }), '2025-07-22')
  assert.equal(captureDate({ DateTimeOriginal: { value: '<time class="dtstart" datetime="2012">2012</time>' } }), '2012')
  assert.equal(captureDate({ DateTimeOriginal: { value: '2008:06:29 08:11:23' } }), '2008-06-29')
  assert.equal(captureDate({ DateTimeOriginal: { value: 'unknown' } }), null)
  assert.equal(captureDate({ DateTimeOriginal: { value: '3050' } }), null)
  assert.equal(captureDate({}), null)
})

test('fetchImo replays the real responses: a missing category costs no further call; a present one harvests its subcategory', async () => {
  const miss = await fetchImo(replayClient(), '9500001', { pre: { request: rec.categoryInfo.request, page: catPage('9500001') } })
  assert.deepEqual([miss.responses.length, Object.keys(miss.files).length], [1, 0])
  const f = await fetchImo(replayClient(), '9515395', { pre: { request: rec.categoryInfo.request, page: catPage('9515395') } })
  assert.deepEqual(Object.keys(f.files), ['Category:Parsifal (ship, 2011)'])
  assert.equal(f.responses.length, 4) // categoryinfo page + members + the ship category's parents + one files page
  assert.deepEqual(f.parents['Category:Parsifal (ship, 2011)'].includes('Category:Car carriers'), true)
  assert.equal(f.truncated, false)
})

test('decideCommons: attaches only through one registry-class holder of a checksum-valid IMO', () => {
  const base = { acceptedVesselId: null, kind: 'commons_imo_category', imo: { imo: '9509401', valid: true }, registryHolders: ['v1'], aisHolders: 0 }
  assert.deepEqual(decideCommons(base), { action: 'accept', vesselId: 'v1', method: 'IMO_EXACT', via: 'registry_imo', needsReview: false, candidates: [] })
  assert.equal(decideCommons({ ...base, registryHolders: ['v1', 'v2'] }).reason, 'imo_on_several_vessels')
  assert.equal(decideCommons({ ...base, registryHolders: [], aisHolders: 1 }).reason, 'imo_only_ais_reported')
  assert.equal(decideCommons({ ...base, registryHolders: [] }).reason, 'no_vessel_with_imo')
  assert.equal(decideCommons({ ...base, imo: { imo: '9500001', valid: false } }).reason, 'imo_checksum_invalid')
  assert.equal(decideCommons({ ...base, kind: 'commons_file' }).reason, 'file_entity_not_linked_directly')
  assert.equal(decideCommons({ ...base, acceptedVesselId: 'v9' }).action, 'keep')
})

test('Commons type categories → vessel_type claims; CATHLAMET is a ferry (REAL responses, IMO 7808138)', () => {
  const c = parentsRec.cathlamet
  const parents = {}
  for (const r of c.parents) for (const pg of r.response.query.pages) parents[pg.title] = (pg.categories || []).map((x) => x.title)
  const m = mapImoCategory({ title: 'Category:IMO 7808138', catPage: c.members[0].response.query.pages[0], files: {}, parents })
  const types = m.assertions.filter((a) => a.attribute === 'vessel_type').map((a) => a.value_raw).sort()
  assert.deepEqual(types, ['Automobile ferries', 'Double ended ferries', 'Ferry ships by name', 'Issaquah class ferries', 'Passenger ships of the United States'])
  assert.ok(m.assertions.every((a) => a.evidence_class === 'community_curated' && a.sub_record_ref === 'Category:Cathlamet (ship, 1981)'))
  // Operator, builder, place and "by name" categories say nothing about type.
  for (const cat of ['Category:Washington State Ferries vessels', 'Category:Ships built in 1981', 'Category:Ships registered in Seattle', 'Category:Ships by name (flat list)'])
    assert.equal(fromCommonsCategory(cat), null, cat)
  const cls = combine(m.assertions.map((a) => crosswalkClaim({ ...a, source_id: 'wikimedia-commons' })))
  assert.deepEqual([cls.group, cls.class, cls.conflict], ['passenger', 'ferry', false])
})
