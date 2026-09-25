#!/usr/bin/env node
/**
 * Import Wikidata ship items into the /ships database (docs/WIKIDATA_SHIPS.md).
 *
 *   npm run ships:import-wikidata                    # items whose IMO or MMSI is already in our DB
 *   npm run ships:import-wikidata -- --ids Q548546   # explicit items
 *   npm run ships:import-wikidata -- --replay lib/ships/test/fixtures/wd-live-eurodam-2026-09-25.json
 *   npm run ships:import-wikidata -- --from-db       # re-ingest the items already stored (no wbgetentities
 *                                                    # refetch): fresh labels + Commons image licences, new resolver
 *   add --save <dir> to keep the raw responses (for recorded test fixtures)
 *   add --resume to skip items already stored; --limit N to stop after N items
 *
 * Default discovery: the full IMO (P458) and MMSI (P587) statement indexes via
 * SPARQL (written to scripts/ships/bake-ais/build/wikidata/ for audit), matched
 * against IMOs/MMSIs our sources already carry. Only those items are fetched:
 * a Wikidata item never creates an EarthAtlas vessel (attach-only resolver), so
 * the other ~95k items would add storage but no vessel.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureWikidataSource, ingestWikidataItem } from '../../lib/ships/ingestWikidata.js'
import { tally } from '../../lib/ships/ingestGfw.js'
import { WIKIDATA_SOURCE, referencedQids, imageFiles } from '../../lib/ships/wikidata.js'
import { normImo, normMmsi } from '../../lib/ships/normalize.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { wikidataClient } from './wikidataClient.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'wikidata')
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const saveDir = opt('save')
const limit = opt('limit') ? Number(opt('limit')) : Infinity

const pool = shipsPool()
const stats = {}
let runId = null

async function save(name, body) {
  if (!saveDir) return
  await mkdir(saveDir, { recursive: true })
  await writeFile(path.join(saveDir, name), JSON.stringify(body, null, 1))
}

function count(r) {
  tally(stats, r)
  if (r.resolution.reason) stats[`unresolved_${r.resolution.reason}`] = (stats[`unresolved_${r.resolution.reason}`] || 0) + 1
  if (r.resolution.via) stats[`accepted_via_${r.resolution.via}`] = (stats[`accepted_via_${r.resolution.via}`] || 0) + 1
  stats.notVessel = (stats.notVessel || 0) + (r.isVessel ? 0 : 1)
  for (const im of r.images || []) {
    stats.imagesFound = (stats.imagesFound || 0) + 1
    const k = `images_${im.status}`
    stats[k] = (stats[k] || 0) + 1
    if (im.status === 'skipped_license') (stats.imagesSkippedByLicense ||= {})[im.license] = (stats.imagesSkippedByLicense[im.license] || 0) + 1
  }
}

/** Commons licence metadata for every P18 file of these items (50 titles per call). */
async function commonsFor(wd, entities) {
  const files = [...new Set(entities.flatMap((e) => (e.claims ? imageFiles(e) : [])))]
  const pages = {}
  const urls = []
  for (let i = 0; i < files.length; i += 50) {
    const { url, body, byFile } = await wd.commonsImageInfo(files.slice(i, i + 50))
    Object.assign(pages, byFile)
    urls.push(url)
    await save(`commons-${runId}-${Date.now()}.json`, { request: url, retrieved_at: new Date().toISOString(), response: body })
  }
  return { pages, url: urls.length === 1 ? urls[0] : urls.length ? `${urls[0]} (+${urls.length - 1} more)` : null }
}

// Items only ever attach to existing vessels (never create or merge them), so
// ingesting several at once cannot race into duplicate vessels.
const CONCURRENCY = 5
async function ingestBatch(entities, lookup, retrievalUrl, commons = { pages: {}, url: null }) {
  let i = 0
  const worker = async () => {
    while (i < entities.length) {
      const e = entities[i++]
      if (e.missing !== undefined || !e.claims) { stats.missing = (stats.missing || 0) + 1; continue }
      const r = await withRetry(() => ingestWikidataItem(pool, schema, e, lookup,
        { runId, retrievalUrl: typeof retrievalUrl === 'function' ? retrievalUrl(e) : retrievalUrl,
          commonsPages: commons.pages, commonsUrl: commons.url }))
      count(r)
      for (const w of r.warnings) console.warn(`  warn ${e.id}: ${w}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

try {
  await ensureWikidataSource(pool, schema)
  const params = Object.fromEntries(['ids', 'replay', 'limit'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  if (args.includes('--from-db')) params.fromDb = true
  runId = await withTx(pool, (c) => startRun(c, schema, WIKIDATA_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}"`, params)

  const replay = opt('replay')
  if (replay) {
    const rec = JSON.parse(await readFile(replay, 'utf8'))
    await ingestBatch(Object.values(rec.response.entities), rec.lookup, `replay:${path.basename(replay)}`)
  } else if (args.includes('--from-db')) {
    // The newest stored raw record of every Wikidata item: no refetch from Wikidata.
    const wd = wikidataClient()
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (r.source_entity_id) r.payload, r.retrieval_url FROM ${schema}.source_records r
        WHERE r.source_id = $1 ORDER BY r.source_entity_id, r.last_retrieved_at DESC, r.id DESC`, [WIKIDATA_SOURCE.id])
    const items = rows.slice(0, limit)
    console.log(`--from-db: ${items.length} stored items`)
    for (let i = 0; i < items.length; i += 50) {
      const batch = items.slice(i, i + 50)
      const entities = batch.map((r) => r.payload)
      const refs = { all: new Set(), classes: new Set() }
      for (const e of entities) { const r = referencedQids(e); r.all.forEach((q) => refs.all.add(q)); r.classes.forEach((q) => refs.classes.add(q)) }
      const { lookup } = await wd.lookup([...refs.all].sort(), [...refs.classes].sort())
      const commons = await commonsFor(wd, entities)
      // Same payload → same raw record; retrieval_url stays the original wbgetentities request.
      const urlOf = new Map(batch.map((r) => [r.payload.id, r.retrieval_url]))
      await ingestBatch(entities, lookup, (e) => urlOf.get(e.id), commons)
      console.log(`  ${Math.min(i + 50, items.length)}/${items.length} re-ingested (Wikimedia calls ${wd.calls})`)
    }
    stats.wikimediaCalls = wd.calls
  } else {
    const wd = wikidataClient()
    let qids = (opt('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!qids.length) {
      // 1. Indexes of every IMO / MMSI statement in Wikidata.
      const imoIdx = await wd.imoIndex()
      const mmsiIdx = await wd.mmsiIndex()
      await mkdir(BUILD, { recursive: true })
      const stamp = new Date().toISOString().slice(0, 10)
      await writeFile(path.join(BUILD, `imo-index-${stamp}.json`), JSON.stringify(imoIdx))
      await writeFile(path.join(BUILD, `mmsi-index-${stamp}.json`), JSON.stringify(mmsiIdx))
      stats.wdImoStatements = imoIdx.length
      stats.wdImoItems = new Set(imoIdx.map((r) => r.qid)).size
      stats.wdMmsiItems = new Set(mmsiIdx.map((r) => r.qid)).size
      // 2. Match against identifiers our (non-curated) sources already carry.
      const { rows: ours } = await pool.query(
        `SELECT DISTINCT attribute, value_norm FROM ${schema}.assertions
          WHERE attribute IN ('imo', 'mmsi') AND status = 'active' AND evidence_class <> 'community_curated'`)
      const ourImo = new Set(ours.filter((r) => r.attribute === 'imo').map((r) => r.value_norm))
      const ourMmsi = new Set(ours.filter((r) => r.attribute === 'mmsi').map((r) => r.value_norm))
      const byImo = new Set(imoIdx.filter((r) => r.rank !== 'DeprecatedRank' && normImo(r.imo).valid && ourImo.has(normImo(r.imo).value)).map((r) => r.qid))
      const byMmsi = new Set(mmsiIdx.filter((r) => r.rank !== 'DeprecatedRank' && ourMmsi.has(normMmsi(r.mmsi).value)).map((r) => r.qid))
      stats.matchedByImo = byImo.size
      stats.matchedByMmsiOnly = [...byMmsi].filter((q) => !byImo.has(q)).length
      qids = [...new Set([...byImo, ...byMmsi])].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      console.log(`Wikidata: ${stats.wdImoItems} items with IMO, ${stats.wdMmsiItems} with MMSI → ${qids.length} match our DB (${byImo.size} by IMO)`)
    }
    if (args.includes('--resume')) {
      const { rows } = await pool.query(
        `SELECT entity_key FROM ${schema}.source_entities WHERE source_id = $1 AND entity_key = ANY($2)`, [WIKIDATA_SOURCE.id, qids])
      const have = new Set(rows.map((r) => r.entity_key))
      qids = qids.filter((q) => !have.has(q))
      stats.skippedAlreadyStored = have.size
      console.log(`--resume: ${have.size} already stored, ${qids.length} to fetch`)
    }
    qids = qids.slice(0, limit)
    // 3. Fetch full items 50 at a time, look up what they reference, ingest.
    for (let i = 0; i < qids.length; i += 50) {
      const batch = qids.slice(i, i + 50)
      const { url, body } = await wd.getEntities(batch)
      const entities = Object.values(body.entities || {})
      const refs = { all: new Set(), classes: new Set() }
      for (const e of entities) if (e.claims) { const r = referencedQids(e); r.all.forEach((q) => refs.all.add(q)); r.classes.forEach((q) => refs.classes.add(q)) }
      const { lookup, raw } = await wd.lookup([...refs.all].sort(), [...refs.classes].sort())
      await save(`wd-${runId}-${i / 50}.json`, { request: url, retrieved_at: new Date().toISOString(), response: body, lookup, lookup_raw: raw })
      const commons = await commonsFor(wd, entities)
      await ingestBatch(entities, lookup, url, commons)
      console.log(`  ${Math.min(i + 50, qids.length)}/${qids.length} ingested (Wikidata calls ${wd.calls})`)
    }
    stats.wikidataCalls = wd.calls
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats }))
  console.log('done', stats)
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
