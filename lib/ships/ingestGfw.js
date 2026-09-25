/**
 * GFW entry → evidence → interpretation, one transaction per entry.
 * Transport (HTTP) lives in scripts/ships/gfwClient.js. This module does no
 * network I/O, so recorded responses can be replayed in tests.
 */
import { GFW_SOURCE, GFW_ENTITY_KIND, mapEntry, entryIdentity } from './gfw.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from './store.js'
import { resolveEntity } from './resolve.js'
import { withTx } from './db.js'

export async function ensureGfwSource(pool, S) {
  await withTx(pool, (c) => upsertSource(c, S, GFW_SOURCE))
}

/** Ingest one entry. Returns per-entry diagnostics for the run's stats. */
export async function ingestGfwEntry(pool, S, entry, { runId = null, retrievalUrl = null } = {}) {
  const { assertions, warnings } = mapEntry(entry)
  return withTx(pool, async (c) => {
    const id = entryIdentity(entry)
    const ent = await findOrCreateEntity(c, S, {
      sourceId: GFW_SOURCE.id, kind: GFW_ENTITY_KIND, anchor: id.anchor, refs: id.refs, refClass: id.refClass,
    })
    const rec = await upsertRecord(c, S, {
      sourceId: GFW_SOURCE.id, entityId: ent.id, payload: entry, datasetVersion: entry.dataset ?? null, retrievalUrl, runId,
    })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions })
    const d = await resolveEntity(c, S, ent.id)
    return {
      entityId: ent.id, entityCreated: ent.created, regrouped: ent.regrouped,
      recordCreated: rec.created, assertions: a, warnings,
      resolution: { action: d.action, method: d.method ?? null, vesselId: d.vesselId ?? null,
        needsReview: d.needsReview, candidates: d.candidates.length },
    }
  })
}

/** Fold per-entry diagnostics into run stats. */
export function tally(stats, r) {
  const s = stats
  s.entries = (s.entries || 0) + 1
  s.entitiesCreated = (s.entitiesCreated || 0) + (r.entityCreated ? 1 : 0)
  s.regrouped = (s.regrouped || 0) + (r.regrouped ? 1 : 0)
  s.recordsCreated = (s.recordsCreated || 0) + (r.recordCreated ? 1 : 0)
  s.recordsUnchanged = (s.recordsUnchanged || 0) + (r.recordCreated ? 0 : 1)
  s.assertionsCreated = (s.assertionsCreated || 0) + r.assertions.created
  s.assertionsSeenAgain = (s.assertionsSeenAgain || 0) + r.assertions.seen
  s.assertionsSuperseded = (s.assertionsSuperseded || 0) + r.assertions.superseded
  s.warnings = (s.warnings || 0) + r.warnings.length
  const k = `resolution_${r.resolution.action}${r.resolution.method ? `_${r.resolution.method}` : ''}`
  s[k] = (s[k] || 0) + 1
  s.needsReview = (s.needsReview || 0) + (r.resolution.needsReview ? 1 : 0)
  s.candidateLinks = (s.candidateLinks || 0) + r.resolution.candidates
  return s
}
