/**
 * Whale feeds, taxonomy, land flags and merge — pure tests, no network, no DB.
 * Inputs are REAL upstream rows captured 2026-10-17 (fixtures/feeds-2026-10-17.json;
 * one client IP in a Maplify comment redacted).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as maplify from '../feeds/maplify.js'
import * as salishsea from '../feeds/salishsea.js'
import * as happywhale from '../feeds/happywhale.js'
import * as inaturalist from '../feeds/inaturalist.js'
import * as obis from '../feeds/obis.js'
import { curatedScientific, fixMojibake, groupOf, happywhaleTaxon } from '../taxa.js'
import { locationQuality } from '../land.js'
import { mergeSighting } from '../merge.js'

const F = JSON.parse(readFileSync(new URL('./fixtures/feeds-2026-10-17.json', import.meta.url), 'utf8'))

test('curatedScientific: Maplify free-text names (12 months of real names)', () => {
  const cases = [
    ['Humpback', 'Megaptera novaeangliae', 'Megaptera novaeangliae'],
    ['Baleine Ã\u00a0 bosse', '', 'Megaptera novaeangliae'],   // real bytes: Ã + no-break space
    ['Southern Resident Killer Whale', '', 'Orcinus orca'],
    ["Killer whale(Bigg's (Transient))", '', 'Orcinus orca'],
    ['Gray', '', 'Eschrichtius robustus'],
    ['Grey whale', '', 'Eschrichtius robustus'],
    ['Finback Whale', 'Balaenoptera physalus', 'Balaenoptera physalus'],
    ['Rorqual commun', '', 'Balaenoptera physalus'],
    ['Right Whale', 'Eubalaena', 'Eubalaena'],
    ['Northern Right Whale Dolphin', 'Lissodelphis borealis', 'Lissodelphis borealis'],
    ['Grand dauphin', 'Delphinus', 'Tursiops truncatus'],
    ['Short Finned Pilot Whale', 'Globicephala macrorhynchus', 'Globicephala macrorhynchus'],
    ['Dwarf Sperm Whale', 'Kogia sima', 'Kogia sima'],
    ['Blue Shark', 'Prionace glauca', 'Prionace glauca'],
    ['Mola Mola / Sunfish', 'Mola mola', 'Mola mola'],
    ['Seals on Ice', 'N/A', 'Phocidae'],
    ['Unknown Whale', '', 'Cetacea'],
    ['Cetacean Collision', '', 'Cetacea'],
    ['minke_whale', '', 'Balaenoptera acutorostrata'],
  ]
  for (const [name, sci, want] of cases) assert.deepEqual(curatedScientific(name, sci), { scientific: want }, name)
  for (const name of ['Unspecified', 'Non spÃ©cifiÃ©', 'No especificado', 'Other (Specify in comments)', 'Other']) {
    assert.deepEqual(curatedScientific(name, 'N/A'), { unidentified: true }, name)
  }
  for (const name of ['Wood', 'Buoy', 'Object (See Description)', 'Unknown Hazard / Collision', 'Other Marine Megafauna (non-whale)']) {
    assert.deepEqual(curatedScientific(name, ''), { notAnimal: true }, name)
  }
  // OBIS passes only a Latin name: no common-name rule may fire on it (Orcaella ≠ orca).
  assert.deepEqual(curatedScientific('', 'Orcaella brevirostris'), { scientific: 'Orcaella brevirostris' })
})

test('fixMojibake / groupOf / happywhaleTaxon', () => {
  assert.equal(fixMojibake('Baleine Ã\u00a0 bosse'), 'Baleine à bosse')
  assert.equal(fixMojibake('Humpback'), 'Humpback')
  assert.equal(groupOf(41521, [48460, 1, 2, 355675, 40151, 848317, 152870, 925158, 152871]), 'cetacean')
  assert.equal(groupOf(41751, [48460, 372843, 41736]), 'pinniped')
  assert.equal(groupOf(1, []), 'other')
  assert.equal(happywhaleTaxon('humpback_whale').inat_id, 41566)
  assert.deepEqual(happywhaleTaxon(null), { unidentified: true })
  assert.deepEqual(happywhaleTaxon('marine_debris'), { notAnimal: true })
  assert.deepEqual(happywhaleTaxon('unidentified_baleen_whale'), { scientific: 'Cetacea' })
})

test('locationQuality: open water, shore, far inland, null island', () => {
  assert.equal(locationQuality(-123.2, 48.55), 'ok')         // Haro Strait
  assert.equal(locationQuality(-122.55, 47.326), 'ok')       // Orca Network shore report, Puget Sound
  assert.equal(locationQuality(-95.786, 37.133), 'inland')   // Kansas (real Whale Alert point)
  assert.equal(locationQuality(0, 0), 'null_island')
})

test('maplify: Orca Network channel + observer; IP header stripped from remarks and raw; test row flagged', () => {
  const [on, nullIsland, kansas, wras, api] = F.maplify.map(maplify.normalizeRow)
  assert.equal(on.key, `maplify:${F.maplify[0].source}:${F.maplify[0].id}`)
  assert.equal(on.norm.channel, 'Orca Network')
  assert.ok(on.norm.observer, 'observer parsed from "(Name)"')
  assert.equal(on.norm.license, 'CC-BY-4.0')
  assert.match(on.norm.observed_at, /Z$/)
  assert.ok(Math.abs(nullIsland.norm.lat) < 0.01 && Math.abs(nullIsland.norm.lon) < 0.01)
  assert.equal(locationQuality(nullIsland.norm.lon, nullIsland.norm.lat), 'null_island')
  assert.equal(kansas.norm.time_precision, 'exact')
  assert.equal(wras.norm.channel, 'Ocean Wise WhaleReport')
  assert.ok(!/SourceHeaders|cfConnectingIp/.test(wras.norm.remarks || ''))
  assert.ok(!/SourceHeaders/.test(wras.raw.comments || ''))
  assert.equal(api.norm.test, true)
})

test('salishsea: keys, kinds, licenses; its iNaturalist rows are skipped', () => {
  const s = F.salishsea
  const m = salishsea.normalizeRow(s.maplify, '2026-10-11')
  const src = / on (\S+)$/.exec(s.maplify.attribution)[1]
  assert.equal(m.key, `maplify:${src}:${s.maplify.id.slice(8)}`, 'same key as the Maplify feed gives that record')
  assert.equal(m.norm.license, 'CC-BY-4.0')
  assert.equal(m.norm.taxon.inat_id, s.maplify.taxon.species_id)
  const d = salishsea.normalizeRow(s.direct, '2026-10-11')
  assert.equal(d.key, `salishsea:${s.direct.id}`)
  assert.equal(d.norm.license, 'CC-BY-NC-4.0')
  const o = salishsea.normalizeRow(s.orcasound, '2026-10-11')
  assert.equal(o.norm.kind, 'acoustic')
  assert.equal(salishsea.normalizeRow(s.inaturalist, '2026-10-11'), null)
})

test('happywhale: date-only, individual link, photo; no species → unidentified', () => {
  const [a, b] = F.happywhale.map((e) => happywhale.normalizeEncounter(e))
  assert.equal(a.key, `hw:${F.happywhale[0].id}`)
  assert.equal(a.norm.time_precision, 'day')
  assert.equal(a.norm.observed_at, null)
  assert.equal(a.norm.observed_date, F.happywhale[0].date)
  assert.equal(a.norm.url, `https://happywhale.com/encounter/${F.happywhale[0].id}`)
  if (!F.happywhale[1].speciesKey) assert.deepEqual(b.norm.taxon, { unidentified: true })
})

test('inaturalist: license kept, unlicensed dropped, medium photo, trimmed raw', () => {
  const o = F.inaturalist[0]
  const r = inaturalist.normalizeObservation(o)
  assert.equal(r.key, `inat:${o.id}`)
  assert.equal(r.norm.taxon.inat_id, o.taxon.id)
  assert.ok(r.norm.license.startsWith('CC'))
  if (r.norm.photo_url) assert.match(r.norm.photo_url, /\/medium\./)
  assert.equal(inaturalist.normalizeObservation({ ...o, license_code: null }), null)
  assert.ok(!('identifications' in r.raw))
})

test('obis: human sightings only', () => {
  const [h, m] = F.obis
  const r = obis.normalizeOccurrence(h)
  assert.equal(r.key, `obis:${h.id}`)
  assert.equal(r.norm.taxon.raw_name, '')
  if (m) assert.equal(obis.normalizeOccurrence(m), null)
  assert.equal(obis.normalizeOccurrence({ ...h, basisOfRecord: 'MachineObservation' }), null)
})

test('merge: Maplify base + SalishSea.io enrichment; removed records; quality', () => {
  const base = maplify.normalizeRow(F.maplify[0])
  base.norm.inat_id = 41521
  const ss = { feed: 'salishsea', norm: { ...base.norm, inat_id: 41521, channel: 'Orca Network', observer: 'Someone Curated', organization: 'Orca Network' } }
  const s = mergeSighting(base.key, [{ feed: 'maplify', norm: base.norm }, ss], () => 'cetacean')
  assert.deepEqual(s.via, ['maplify', 'salishsea'])
  assert.equal(s.observer, 'Someone Curated')
  assert.equal(s.organization, 'Orca Network')
  assert.equal(s.animal_group, 'cetacean')
  assert.equal(s.origin, 'maplify')
  // SalishSea.io alone still carries a Maplify record (outside the Maplify window).
  assert.deepEqual(mergeSighting(base.key, [ss]).via, ['salishsea'])
  // Everything removed → the sighting is removed.
  assert.deepEqual(mergeSighting(base.key, [{ feed: 'maplify', norm: base.norm, removed_at: new Date() }]), { key: base.key, removed: true })
  // Inland / test flags.
  const k = maplify.normalizeRow(F.maplify[2])
  assert.equal(mergeSighting(k.key, [{ feed: 'maplify', norm: k.norm }]).quality, 'inland')
  const t = maplify.normalizeRow(F.maplify[4])
  assert.equal(mergeSighting(t.key, [{ feed: 'maplify', norm: t.norm }]).quality, 'test')
  assert.equal(mergeSighting(base.key, [{ feed: 'maplify', norm: base.norm }]).animal_group, 'unknown', 'no taxon group → unknown')
})

test('maplify keys: ids repeat across sources, and rwsas reuses its own — keys never collide', () => {
  const a = maplify.normalizeRow({ ...F.maplify[0], id: 250761, source: 'wras', created: '2026-10-14 03:30:00' })
  const b = maplify.normalizeRow({ ...F.maplify[0], id: 250761, source: 'whale_alert', created: '2026-06-23 11:01:00' })
  assert.notEqual(a.key, b.key)
  const c = maplify.normalizeRow({ ...F.maplify[0], id: 2570, source: 'rwsas', created: '2024-04-01 12:16:05' })
  const d = maplify.normalizeRow({ ...F.maplify[0], id: 2570, source: 'rwsas', created: '2024-03-18 17:03:37' })
  assert.notEqual(c.key, d.key)
  assert.equal(c.key, 'maplify:rwsas:2570:20240401121605')
  // SalishSea.io's copy of an rwsas record (UTC observed_at) lands on the same key.
  const ss = salishsea.normalizeRow({ ...F.salishsea.maplify, id: 'maplify:2570', attribution: 'x on rwsas', observed_at: '2024-04-01T12:16:05+00:00' }, '2024-04-01')
  assert.equal(ss.key, c.key)
})
