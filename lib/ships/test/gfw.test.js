import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapEntry, entryIdentity, memberIds } from '../gfw.js'
import { fixture, gabuReefer } from './scenarios.js'

const find = (as, attr, pred = () => true) => as.filter((a) => a.attribute === attr && pred(a))

test('MISS FREYA (real GFW doc entry): AIS and registry claims stay distinct', () => {
  const { assertions, warnings } = mapEntry(fixture('gfw-doc-miss-freya.json'))
  assert.deepEqual(warnings, [])
  // AIS never reported the IMO; only the registry did — and it is kept as registry evidence.
  const imos = find(assertions, 'imo')
  assert.equal(imos.length, 1)
  assert.equal(imos[0].evidence_class, 'registry')
  assert.equal(imos[0].detail.checksum_ok, true)
  assert.deepEqual(imos[0].detail.registries, ['IMO', 'USA'])
  // Two AIS identities → two MMSI claims with their own observed windows, plus the registry's.
  const mmsis = find(assertions, 'mmsi')
  assert.equal(mmsis.filter((a) => a.evidence_class === 'ais_self_reported').length, 2)
  assert.ok(mmsis.every((a) => a.period_kind === 'observed'))
  // Registry tonnage kept; null length NOT turned into a claim.
  assert.equal(find(assertions, 'tonnage_gt')[0].value_norm, '171')
  assert.equal(find(assertions, 'length_m').length, 0)
  // The callsign-less AIS identity yields no callsign claim (no invented values).
  assert.equal(find(assertions, 'callsign', (a) => a.sub_record_ref === '126221ace-e3b5-f4ed-6150-394809737c55').length, 0)
})

test('CLAUDINA (real GFW doc entry): registry owner stays a registry_owner, never upgraded', () => {
  const { assertions } = mapEntry(fixture('gfw-doc-claudina.json'))
  const owners = find(assertions, 'registry_owner')
  assert.equal(owners.length, 1)
  assert.equal(owners[0].value_raw, 'DESEADO PESQUERA')
  assert.equal(find(assertions, 'registered_owner').length + find(assertions, 'beneficial_owner').length, 0)
  // Model-derived classification is 'inferred', not registry or AIS.
  assert.ok(find(assertions, 'gear_type', (a) => a.value_norm === 'SQUID_JIGGER').every((a) => a.evidence_class === 'inferred'))
})

test('DON TITO (real GFW doc entry, AIS only): no registry claims, identified by its GFW vessel id', () => {
  const e = fixture('gfw-doc-don-tito.json')
  const { assertions } = mapEntry(e)
  assert.ok(assertions.every((a) => a.evidence_class === 'ais_self_reported'))
  assert.deepEqual(entryIdentity(e), { anchor: 'ais:c54923e64-46f3-9338-9dcb-ff09724077a3',
    refs: ['c54923e64-46f3-9338-9dcb-ff09724077a3'], refClass: 'ais_self_reported' })
})

test('GABU REEFER: three AIS identities map to three MMSIs, one IMO', () => {
  const e = gabuReefer()
  const { assertions } = mapEntry(e)
  assert.deepEqual(new Set(find(assertions, 'mmsi').map((a) => a.value_norm)), new Set(['616852000', '214182732', '613590000']))
  assert.deepEqual(new Set(find(assertions, 'imo').map((a) => a.value_norm)), new Set(['8300949']))
  assert.equal(memberIds(e).length, 3)
})

test('a zone-less timestamp drops only that sub-record, with a warning', () => {
  const e = fixture('gfw-doc-don-tito.json')
  e.selfReportedInfo[0].transmissionDateFrom = '2021-08-06 10:49:26'
  const { assertions, warnings } = mapEntry(e)
  assert.equal(assertions.length, 0)
  assert.match(warnings[0], /without explicit zone/)
})

test('GABU REEFER, recorded live (v4.0): four MMSIs over time, registry IMO + owner', () => {
  const { assertions, warnings } = mapEntry(fixture('gfw-live-gabu-reefer-2026-09-24.json'))
  assert.deepEqual(warnings, [])
  const ais = find(assertions, 'mmsi', (a) => a.evidence_class === 'ais_self_reported').map((a) => a.value_norm).sort()
  assert.deepEqual(ais, ['214182732', '613590000', '616852000', '629009266'])
  const regImo = find(assertions, 'imo', (a) => a.evidence_class === 'registry')
  assert.equal(regImo.length, 1); assert.equal(regImo[0].value_norm, '8300949'); assert.equal(regImo[0].detail.checksum_ok, true)
  assert.deepEqual(find(assertions, 'registry_owner').map((a) => a.value_raw), ['FISHING CARGO SERVICES'])
})

test('CRESTY vs GOLDENEYE (recorded live): shared AIS identity, but distinct entry identities', () => {
  const a = fixture('gfw-live-cresty-2026-09-24.json'), b = fixture('gfw-live-goldeneye-2026-09-24.json')
  const shared = memberIds(a).filter((id) => memberIds(b).includes(id))
  assert.ok(shared.length >= 1) // GFW placed the same AIS identity in both ships' entries
  const ia = entryIdentity(a), ib = entryIdentity(b)
  assert.equal(ia.refClass, 'registry'); assert.equal(ib.refClass, 'registry')
  assert.equal(ia.refs.filter((r) => ib.refs.includes(r)).length, 0) // registry refs never overlap
})

test('an inverted date range keeps the claim with unknown dates, and warns', () => {
  const e = fixture('gfw-doc-don-tito.json')
  e.selfReportedInfo[0].transmissionDateFrom = '2023-09-21T14:52:16Z'
  e.selfReportedInfo[0].transmissionDateTo = '2021-08-06T10:49:26Z'
  const { assertions, warnings } = mapEntry(e)
  assert.ok(assertions.length > 0)
  assert.ok(assertions.every((a) => a.period_kind === 'unknown' && a.period_from === null))
  assert.match(warnings[0], /after end/)
})
