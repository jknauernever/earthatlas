/**
 * Wikimedia Commons IMO categories → evidence → claims → interpretation
 * (docs/COMMONS_PHOTOS.md). Transport is scripts/ships/commonsClient.js; mapping
 * is lib/ships/commons.js. Used by scripts/ships/import-commons.mjs (batch) and
 * api/ships.js op=photos (one ship, on click).
 */
import { COMMONS_SOURCE, IMO_CATEGORY_KIND, COMMONS_FILE_KIND, FRESH_DAYS, imoCategory, harvestCategories, membersOf,
  mapImoCategory, pagesOf } from './commons.js'
import { upsertSource, findOrCreateEntity, upsertRecord, upsertAssertions } from './store.js'
import { resolveEntity } from './resolve.js'
import { withTx } from './db.js'

export async function ensureCommonsSource(pool, S) {
  await withTx(pool, (c) => upsertSource(c, S, COMMONS_SOURCE))
}

/**
 * Fetch everything we use for one IMO (no DB). `pre` = this title's page object from a
 * batched categoryinfo request ({ request, page }) when the caller already has it; a
 * missing category then costs no further request.
 * Returns { imo, title, catPage, responses, files, truncated, calls }.
 */
export async function fetchImo(client, imo, { pre = null, maxFiles = 200 } = {}) {
  const title = imoCategory(imo)
  const responses = []
  let catPage = pre?.page ?? null
  if (pre) responses.push({ request: pre.request, page: pre.page })
  const files = {}
  let truncated = false
  if (catPage && (catPage.missing !== undefined || catPage.invalid !== undefined)) return { imo, title, catPage, responses, files, truncated }
  const mem = await client.members(title)
  for (const r of mem) responses.push({ request: r.url, response: r.body })
  catPage = mem[0]?.body?.query?.pages?.[0] ?? catPage
  if (catPage?.missing !== undefined) return { imo, title, catPage, responses, files, truncated }
  let budget = maxFiles
  for (const cat of harvestCategories(title, membersOf(mem.map((r) => r.body)))) {
    if (budget <= 0) { truncated = true; break }
    const rs = await client.files(cat, { maxFiles: budget })
    for (const r of rs) responses.push({ request: r.url, response: r.body })
    files[cat] = rs.map((r) => r.body)
    const n = pagesOf(files[cat]).length
    budget -= n
    if (rs.at(-1)?.body?.continue) truncated = true
  }
  return { imo, title, catPage, responses, files, truncated }
}

/**
 * Store one fetched IMO category in one transaction: each file's page object as its own
 * raw record (commons_file), the category's responses as the category's raw record,
 * the image claims, then the resolver (attach-only, registry IMO). Idempotent.
 */
export async function ingestImo(pool, S, fetched, { runId = null } = {}) {
  return withTx(pool, async (c) => {
    const fileRecords = {}
    for (const bodies of Object.values(fetched.files)) {
      for (const page of pagesOf(bodies)) {
        if (fileRecords[page.title]) continue
        const fe = await findOrCreateEntity(c, S, { sourceId: COMMONS_SOURCE.id, kind: COMMONS_FILE_KIND, anchor: page.title })
        const sha = page.imageinfo?.[0]?.sha1
        const fr = await upsertRecord(c, S, { sourceId: COMMONS_SOURCE.id, entityId: fe.id, payload: page,
          datasetVersion: sha ? `sha1:${sha}` : null, retrievalUrl: fileUrl(fetched, page.title), runId })
        fileRecords[page.title] = fr.id
      }
    }
    const ent = await findOrCreateEntity(c, S, { sourceId: COMMONS_SOURCE.id, kind: IMO_CATEGORY_KIND, anchor: fetched.title })
    const payload = { imo: fetched.imo, category: fetched.title, truncated: fetched.truncated, responses: fetched.responses }
    const rec = await upsertRecord(c, S, { sourceId: COMMONS_SOURCE.id, entityId: ent.id, payload,
      datasetVersion: null, retrievalUrl: fetched.responses[0]?.request ?? null, runId })
    const m = mapImoCategory({ title: fetched.title, catPage: fetched.catPage, files: fetched.files, fileRecords })
    const a = await upsertAssertions(c, S, { entityId: ent.id, recordId: rec.id, assertions: m.assertions })
    const d = m.exists ? await resolveEntity(c, S, ent.id) : { action: 'unresolved', reason: 'no_category', candidates: [] }
    return { imo: fetched.imo, exists: m.exists, imoValid: m.imoValid, truncated: fetched.truncated, images: m.images,
      entityId: ent.id, recordId: rec.id, recordCreated: rec.created, assertions: a,
      resolution: { action: d.action, method: d.method ?? null, reason: d.reason ?? null, vesselId: d.vesselId ?? null } }
  })
}

/** The request that returned this file (the generator response it came from). */
function fileUrl(fetched, title) {
  for (const r of fetched.responses) if ((r.response?.query?.pages || []).some((p) => p.title === title)) return r.request
  return null
}

// ── Click lookup (api/ships.js op=photos) ─────────────────────────────────────

/**
 * Should the card look this vessel up on Commons? Guardrail: the vessel exists and holds
 * exactly one checksum-valid registry-class IMO; it has no photo yet; its IMO category
 * was not checked in the last FRESH_DAYS days. `q` = read query function.
 */
export async function commonsPlan(q, S, vesselId) {
  const [v] = await q(`SELECT id FROM ${S}.vessels WHERE id = $1`, [vesselId])
  if (!v) return { status: 'not_found' }
  const imos = await q(`SELECT DISTINCT value_norm FROM ${S}.vessel_assertions
                         WHERE vessel_id = $1 AND attribute = 'imo' AND evidence_class = 'registry'
                           AND (detail->>'checksum_ok')::boolean`, [vesselId])
  if (imos.length !== 1) return { status: imos.length ? 'several_registry_imos' : 'no_registry_imo' }
  const imo = imos[0].value_norm
  const [img] = await q(`SELECT 1 FROM ${S}.vessel_assertions WHERE vessel_id = $1 AND attribute = 'image' LIMIT 1`, [vesselId])
  const [chk] = await q(`SELECT last_seen_at FROM ${S}.source_entities
                          WHERE source_id = $1 AND entity_kind = $2 AND entity_key = $3`,
    [COMMONS_SOURCE.id, IMO_CATEGORY_KIND, imoCategory(imo)])
  const fresh = chk && Date.now() - new Date(chk.last_seen_at).getTime() < FRESH_DAYS * 86400e3
  return { status: img ? 'has_photo' : fresh ? 'checked_recently' : 'fetch', imo, checkedAt: chk?.last_seen_at ?? null }
}

/** A vessel's image claims, as the card reads them from op=vessel. */
export async function vesselImages(q, S, vesselId) {
  return q(`SELECT va.id, va.attribute, va.value_raw, va.value_norm, va.evidence_class, va.detail, va.source_id,
                   va.entity_key, va.first_source_record_id, va.last_source_record_id
              FROM ${S}.vessel_assertions va
             WHERE va.vessel_id = $1 AND va.attribute = 'image'
             ORDER BY va.id`, [vesselId])
}
