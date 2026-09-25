import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aggregateRows, mapMmsi, mcTime, vesselGroup } from '../marinecadastre.js'
import { matchByMmsiIdentity, decide } from '../resolve.js'

const lr = readFileSync(new URL('./fixtures/mc-live-linnea-rose-2026-06-21.ndjson', import.meta.url), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('MarineCadastre timestamps are UTC by source spec; explicit zones are kept', () => {
  assert.equal(mcTime('2026-06-21 15:15:23'), '2026-06-21T15:15:23.000Z')
  assert.equal(mcTime('2026-06-21T15:15:23-07:00'), '2026-06-21T22:15:23.000Z')
})

test('vessel groups follow the NOAA/USCG code tables, including pre-2018 extended codes', () => {
  assert.equal(vesselGroup(37), 'Pleasure craft / sailing')
  assert.equal(vesselGroup(1019), 'Pleasure craft / sailing')
  assert.equal(vesselGroup(52), 'Tug / tow')
  assert.equal(vesselGroup(84), 'Tanker')
  assert.equal(vesselGroup(0), 'Not available')
})

test('LINNEA ROSE (real 2026-06-21 rows): MMSI is transmitted; static fields are "published"', () => {
  const [agg] = aggregateRows(lr)
  const as = mapMmsi(agg)
  const by = (attr) => as.filter((a) => a.attribute === attr)
  assert.equal(by('mmsi')[0].evidence_class, 'ais_self_reported')
  assert.ok(['name', 'callsign', 'vessel_type', 'transceiver'].every((k) => by(k)[0].evidence_class === 'ais_published'))
  assert.equal(by('vessel_type')[0].value_norm, 'AIS_37')
  assert.equal(by('vessel_type')[0].detail.group, 'Pleasure craft / sailing')
  assert.equal(by('mmsi')[0].period_from, '2026-06-21T15:15:23.000Z')
})

test('aggregating months keeps each value once, with overall first/last seen', () => {
  const later = lr.map((r) => ({ ...r, first_seen: '2026-07-04 18:00:00', last_seen: '2026-07-04 20:00:00' }))
  const [agg] = aggregateRows([...lr, ...later])
  const name = agg.values.find((v) => v.attr === 'name')
  assert.deepEqual([name.first, name.last], ['2026-06-21T15:15:23.000Z', '2026-07-04T20:00:00.000Z'])
})

test('second-identifier match: call signs decide when both sides have one', () => {
  const mine = { callsign: new Set(['WN0431D']), name: new Set(['LINNEAROSE']) }
  assert.deepEqual(matchByMmsiIdentity(mine, [{ vesselId: 'v1', mmsi: '368330140', callsigns: ['WN0431D'], names: [] }]).map((m) => m.via), ['callsign'])
  // Same name but a DIFFERENT call sign → conflict, no match.
  assert.equal(matchByMmsiIdentity(mine, [{ vesselId: 'v2', mmsi: '368330140', callsigns: ['XX1'], names: ['LINNEAROSE'] }]).length, 0)
  // No call sign on their side → the name decides.
  assert.deepEqual(matchByMmsiIdentity(mine, [{ vesselId: 'v3', mmsi: '368330140', callsigns: [], names: ['LINNEAROSE'] }]).map((m) => m.via), ['name'])
  // Different registry IMOs are different ships, even with the same call sign.
  assert.equal(matchByMmsiIdentity({ ...mine, registryImo: new Set(['9637143']) },
    [{ vesselId: 'v4', mmsi: '1', callsigns: ['WN0431D'], names: [], registry_imos: ['9637131'] }]).length, 0)
})

test('rule 4b: one second-identifier match → accept; two → unresolved', () => {
  const base = { acceptedVesselId: null, registryImos: [], imoVessels: {}, aisImoVessels: {}, mmsiOverlaps: [] }
  const one = decide({ ...base, mmsiIdMatches: [{ vesselId: 'v1', mmsi: 'm', via: 'callsign' }] })
  assert.deepEqual([one.action, one.vesselId, one.method], ['accept', 'v1', 'CALLSIGN_MATCH'])
  const two = decide({ ...base, mmsiIdMatches: [{ vesselId: 'v1', mmsi: 'm', via: 'name' }, { vesselId: 'v2', mmsi: 'm', via: 'name' }] })
  assert.equal(two.action, 'unresolved')
})
