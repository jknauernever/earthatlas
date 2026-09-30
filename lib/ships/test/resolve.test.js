import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../resolve.js'

const base = { acceptedVesselId: null, registryImos: [], imoVessels: {}, aisImoVessels: {}, mmsiOverlaps: [] }

test('no match → new vessel', () => {
  assert.equal(decide(base).action, 'new')
})
test('single registry IMO held by exactly one vessel → IMO_EXACT accept', () => {
  const d = decide({ ...base, registryImos: ['8300949'], imoVessels: { '8300949': ['v1'] } })
  assert.deepEqual([d.action, d.vesselId, d.method], ['accept', 'v1', 'IMO_EXACT'])
})
test('IMO held by two vessels → unresolved with candidates, never a forced merge', () => {
  const d = decide({ ...base, registryImos: ['8300949'], imoVessels: { '8300949': ['v1', 'v2'] } })
  assert.equal(d.action, 'unresolved')
  assert.equal(d.candidates.length, 2)
})
test('conflicting IMOs inside one entity → new vessel flagged for review', () => {
  const d = decide({ ...base, registryImos: ['9000013', '9000025'], imoVessels: { '9000013': ['v1'] } })
  assert.equal(d.action, 'new'); assert.equal(d.needsReview, true)
  assert.deepEqual(d.candidates.map((c) => c.vesselId), ['v1'])
})
test('MMSI overlap alone never merges; it only yields a candidate', () => {
  const d = decide({ ...base, mmsiOverlaps: [{ vesselId: 'v9', mmsi: '999000111' }] })
  assert.equal(d.action, 'new'); assert.equal(d.candidates[0].method, 'MMSI_TEMPORAL')
})
test('AIS-reported IMO alone never merges; it only yields a candidate', () => {
  const d = decide({ ...base, aisImoVessels: { '8300949': ['v1'] } })
  assert.equal(d.action, 'new'); assert.equal(d.candidates[0].evidence.basis, 'ais_self_reported')
})
test('an accepted entity is kept even when new evidence points elsewhere', () => {
  const d = decide({ ...base, acceptedVesselId: 'v1', registryImos: ['8300949'], imoVessels: { '8300949': ['v2'] } })
  assert.deepEqual([d.action, d.vesselId, d.needsReview], ['keep', 'v1', true])
})

test('only vessel-describing entity kinds are resolvable, and they match the importers\' own kind constants', async () => {
  const { VESSEL_ENTITY_KINDS } = await import('../resolve.js')
  const { GFW_ENTITY_KIND } = await import('../gfw.js')
  const { MC_ENTITY_KIND } = await import('../marinecadastre.js')
  const { PSIX_ENTITY_KIND } = await import('../psix.js')
  const { FCC_ENTITY_KIND } = await import('../fccUls.js')
  const { TC_ENTITY_KIND } = await import('../tcRegistry.js')
  const { WD_ENTITY_KIND } = await import('../wikidata.js')
  const { IMO_CATEGORY_KIND, COMMONS_FILE_KIND } = await import('../commons.js')
  const { KIND: GISIS } = await import('../gisis.js')
  const { KIND: MRV } = await import('../euMrv.js')
  const { KIND: MEP } = await import('../mepAlliance.js')
  assert.deepEqual(new Set(VESSEL_ENTITY_KINDS), new Set([GFW_ENTITY_KIND, MC_ENTITY_KIND, PSIX_ENTITY_KIND, FCC_ENTITY_KIND,
    TC_ENTITY_KIND, WD_ENTITY_KIND, IMO_CATEGORY_KIND, GISIS.imo, MRV.shipYear, MEP.voyageShip, MEP.fittedImo, MEP.fittedName]))
  // Non-vessel kinds that share the evidence tables are never resolvable.
  const { KIND: PORT } = await import('../ports.js')
  const { RAW_KIND, GISIS_FACILITY_KIND } = await import('../terminals.js')
  const { CT_KIND } = await import('../climateTrace.js')
  const { PORT_VISIT_ENTITY_KIND } = await import('../portVisits.js')
  const { NRC_ENTITY_KIND, INCIDENTNEWS_ENTITY_KIND } = await import('../incidentsNames.js')
  const { IIR_ENTITY_KIND, PSIX_OPCONTROL_KIND, PSIX_DEFICIENCY_KIND } = await import('../incidentsCgmix.js')
  const { ECOLOGY_ENTITY_KIND } = await import('../incidentsEcology.js')
  for (const k of [...Object.values(PORT), ...Object.values(RAW_KIND), GISIS_FACILITY_KIND, GISIS.row, GISIS.facility, CT_KIND,
    PORT_VISIT_ENTITY_KIND, NRC_ENTITY_KIND, INCIDENTNEWS_ENTITY_KIND, IIR_ENTITY_KIND, PSIX_OPCONTROL_KIND, PSIX_DEFICIENCY_KIND,
    ECOLOGY_ENTITY_KIND, COMMONS_FILE_KIND, 'terminal_call_bake', MRV.file]) {
    assert.equal(VESSEL_ENTITY_KINDS.has(k), false, k)
  }
})
