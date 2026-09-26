/**
 * Official registry record → evidence → interpretation, one transaction per
 * record. Same store/resolver as GFW, NOAA and Wikidata (ingestGfw.js, ingestMc.js,
 * ingestWikidata.js). Transport (HTTP, file reading) lives in scripts/ships/import-*.mjs,
 * so recorded responses can be replayed in tests.
 */
import { FCC_SOURCE, FCC_ENTITY_KIND, mapLicense } from './fccUls.js'
import { PSIX_SOURCE, PSIX_ENTITY_KIND, mapPsix } from './psix.js'
import { TC_SOURCE, TC_ENTITY_KIND, mapTc, officialNumber } from './tcRegistry.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from './store.js'
import { resolveEntity } from './resolve.js'
import { withTx } from './db.js'

export const REGISTRIES = {
  fcc: { source: FCC_SOURCE, kind: FCC_ENTITY_KIND, map: mapLicense, key: (p) => String(p.usi),
    version: (p) => (p.dataset?.created_utc ? `uls-complete:${p.dataset.created_utc.slice(0, 10)}` : null) },
  psix: { source: PSIX_SOURCE, kind: PSIX_ENTITY_KIND, map: mapPsix, key: (p) => String(p.vessel_id),
    version: (p) => `retrieved:${String(p.retrieved_at).slice(0, 10)}` },
  tc: { source: TC_SOURCE, kind: TC_ENTITY_KIND, map: mapTc, key: (p) => officialNumber(p.official_number),
    version: (p) => (p.dataset?.last_modified ? `export:${String(p.dataset.last_modified).slice(0, 10)}` : null) },
}

export async function ensureRegistrySources(pool, S) {
  await withTx(pool, async (c) => { for (const r of Object.values(REGISTRIES)) await upsertSource(c, S, r.source) })
}

/** Ingest one registry payload ('fcc' | 'psix' | 'tc'). Returns per-record diagnostics (tally-compatible). */
export async function ingestRegistryRecord(pool, S, which, payload, { runId = null, retrievalUrl = null } = {}) {
  const R = REGISTRIES[which]
  if (!R) throw new Error(`unknown registry ${which}`)
  const { assertions, warnings, summary } = R.map(payload)
  return withTx(pool, async (c) => {
    const ent = await findOrCreateEntity(c, S, { sourceId: R.source.id, kind: R.kind, anchor: R.key(payload) })
    const rec = await upsertRecord(c, S, { sourceId: R.source.id, entityId: ent.id, payload,
      datasetVersion: R.version(payload), retrievalUrl, runId })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions })
    const d = await resolveEntity(c, S, ent.id)
    return {
      key: R.key(payload), summary,
      entityId: ent.id, entityCreated: ent.created, regrouped: false, recordCreated: rec.created, assertions: a, warnings,
      resolution: { action: d.action, method: d.method ?? null, reason: d.reason ?? null, via: d.via ?? null,
        vesselId: d.vesselId ?? null, needsReview: d.needsReview, candidates: d.candidates.length },
    }
  })
}
