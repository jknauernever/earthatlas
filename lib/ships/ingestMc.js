/**
 * MarineCadastre per-MMSI identity → evidence → interpretation.
 * One transaction per MMSI; the same store/resolver as GFW (ingestGfw.js).
 */
import { MC_SOURCE, MC_ENTITY_KIND, mapMmsi } from './marinecadastre.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from './store.js'
import { resolveEntity } from './resolve.js'
import { withTx } from './db.js'

export async function ensureMcSource(pool, S) {
  await withTx(pool, (c) => upsertSource(c, S, MC_SOURCE))
}

/** `agg` = one aggregateRows() item: { mmsi, values }. */
export async function ingestMcMmsi(pool, S, agg, { runId = null, retrievalUrl = null } = {}) {
  const assertions = mapMmsi(agg)
  return withTx(pool, async (c) => {
    const ent = await findOrCreateEntity(c, S, { sourceId: MC_SOURCE.id, kind: MC_ENTITY_KIND, anchor: agg.mmsi })
    const rec = await upsertRecord(c, S, { sourceId: MC_SOURCE.id, entityId: ent.id, payload: agg, datasetVersion: null, retrievalUrl, runId })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions })
    const d = await resolveEntity(c, S, ent.id)
    return {
      entityId: ent.id, entityCreated: ent.created, regrouped: false, recordCreated: rec.created, assertions: a, warnings: [],
      resolution: { action: d.action, method: d.method ?? null, vesselId: d.vesselId ?? null, needsReview: d.needsReview, candidates: d.candidates.length },
    }
  })
}
