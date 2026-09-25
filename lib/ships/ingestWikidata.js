/**
 * Wikidata item → evidence → interpretation, one transaction per item.
 * Same store/resolver as GFW and NOAA (ingestGfw.js, ingestMc.js). Transport
 * (HTTP) lives in scripts/ships/wikidataClient.js, so recorded responses can
 * be replayed in tests.
 *
 * The raw record is the entity object exactly as wbgetentities returned it.
 * Labels / ISO codes / "is a kind of watercraft" for the items it references
 * come from a SPARQL lookup and are recorded in each claim's detail.
 */
import { WIKIDATA_SOURCE, WD_ENTITY_KIND, COMMONS_SOURCE, COMMONS_ENTITY_KIND, mapItem, imageFiles } from './wikidata.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from './store.js'
import { resolveEntity } from './resolve.js'
import { withTx } from './db.js'

export async function ensureWikidataSource(pool, S) {
  await withTx(pool, async (c) => { await upsertSource(c, S, WIKIDATA_SOURCE); await upsertSource(c, S, COMMONS_SOURCE) })
}

/**
 * `commonsPages[file]` = the Commons imageinfo page object for a P18 file, as
 * received (`commonsUrl` = the request). Each is stored as its own raw record
 * (source 'wikimedia-commons', one entity per file) and the image claim points
 * to that record, so the licence shown can always be traced to the exact response.
 */
export async function ingestWikidataItem(pool, S, entity, lookup, { runId = null, retrievalUrl = null, commonsPages = {}, commonsUrl = null } = {}) {
  if (!/^Q\d+$/.test(entity?.id || '')) throw new Error(`not a Wikidata item: ${entity?.id}`)
  return withTx(pool, async (c) => {
    const commons = {}
    for (const f of imageFiles(entity)) {
      const page = commonsPages[f]
      if (!page) continue
      const ce = await findOrCreateEntity(c, S, { sourceId: COMMONS_SOURCE.id, kind: COMMONS_ENTITY_KIND, anchor: page.title || `File:${f}` })
      const cr = await upsertRecord(c, S, { sourceId: COMMONS_SOURCE.id, entityId: ce.id, payload: page,
        datasetVersion: page.imageinfo?.[0]?.sha1 ? `sha1:${page.imageinfo[0].sha1}` : null, retrievalUrl: commonsUrl, runId })
      commons[f] = { page, recordId: cr.id }
    }
    const { assertions, warnings, isVessel, images } = mapItem(entity, lookup, commons)
    const ent = await findOrCreateEntity(c, S, { sourceId: WIKIDATA_SOURCE.id, kind: WD_ENTITY_KIND, anchor: entity.id })
    const rec = await upsertRecord(c, S, {
      sourceId: WIKIDATA_SOURCE.id, entityId: ent.id, payload: entity,
      datasetVersion: entity.lastrevid != null ? `rev:${entity.lastrevid}` : null, retrievalUrl, runId,
    })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions })
    const d = await resolveEntity(c, S, ent.id)
    return {
      qid: entity.id, isVessel, images,
      entityId: ent.id, entityCreated: ent.created, regrouped: false, recordCreated: rec.created, assertions: a, warnings,
      resolution: { action: d.action, method: d.method ?? null, reason: d.reason ?? null, via: d.via ?? null,
        vesselId: d.vesselId ?? null, needsReview: d.needsReview, candidates: d.candidates.length },
    }
  })
}
