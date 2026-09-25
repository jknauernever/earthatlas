#!/usr/bin/env node
/**
 * Import vessel identities from the GFW Vessels API into the /ships database.
 *
 *   npm run ships:import-gfw -- --query "GABU REEFER"
 *   npm run ships:import-gfw -- --imo 8300949,9241061
 *   npm run ships:import-gfw -- --mmsi 366999712
 *   npm run ships:import-gfw -- --mmsi-file mmsis.txt       # one MMSI per line, searched 10 per request
 *   npm run ships:import-gfw -- --where "flag = 'USA'" --max-pages 2
 *   npm run ships:import-gfw -- --replay path/to/saved.json   # ingest a saved detail response, no network
 *   add --save <dir> to keep the raw responses (for recorded test fixtures)
 *   add --resume to skip GFW vessel ids already stored (continue an interrupted run)
 *
 * Search only finds GFW vessel ids: it returns just each vessel's LATEST
 * registry record. What gets ingested is always the full detail response
 * (registries-info-data=ALL), so every import stores the same payload shape
 * and re-runs are idempotent.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureGfwSource, ingestGfwEntry, tally } from '../../lib/ships/ingestGfw.js'
import { GFW_SOURCE } from '../../lib/ships/gfw.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { gfwClient } from './gfwClient.js'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const list = (name) => (opt(name) || '').split(',').map((s) => s.trim()).filter(Boolean)
const schema = opt('schema') || DEFAULT_SCHEMA
const maxPages = Number(opt('max-pages') || 1)
const saveDir = opt('save')

const pool = shipsPool()
const stats = {}
let runId = null
let datasetVersion = null

async function save(name, body) {
  if (!saveDir) return
  await mkdir(saveDir, { recursive: true })
  await writeFile(path.join(saveDir, name), JSON.stringify(body, null, 1))
}

async function ingestAll(entries, retrievalUrl) {
  for (const e of entries) {
    const r = await withRetry(() => ingestGfwEntry(pool, schema, e, { runId, retrievalUrl }))
    tally(stats, r)
    for (const w of r.warnings) console.warn(`  warn: ${w}`)
    datasetVersion ||= e.dataset
  }
}

try {
  await ensureGfwSource(pool, schema)
  const params = Object.fromEntries(['query', 'where', 'imo', 'mmsi', 'mmsi-file', 'ids', 'replay'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  runId = await withTx(pool, (c) => startRun(c, schema, GFW_SOURCE.id, { ...params, maxPages }))
  console.log(`import run ${runId} → schema "${schema}"`, params)

  const replay = opt('replay')
  if (replay) {
    const body = JSON.parse(await readFile(replay, 'utf8'))
    await ingestAll(body.entries || [body], `replay:${path.basename(replay)}`)
  } else {
    const gfw = gfwClient(process.env.GFW_API_TOKEN)
    // 1. Discover GFW vessel ids (one representative id per GFW entry).
    const searches = []
    if (opt('query')) searches.push({ query: opt('query') })
    if (opt('where')) searches.push({ where: opt('where') })
    for (const imo of list('imo')) searches.push({ where: `imo = '${imo.replace(/\D/g, '')}'` })
    const mmsis = [...list('mmsi'), ...(opt('mmsi-file') ? (await readFile(opt('mmsi-file'), 'utf8')).split(/\s+/) : [])]
      .map((m) => m.replace(/\D/g, '')).filter((m) => m.length === 9)
    for (let i = 0; i < mmsis.length; i += 10) {
      searches.push({ where: mmsis.slice(i, i + 10).map((m) => `ssvid = '${m}'`).join(' OR '), pages: 3 })
    }
    const ids = new Set(list('ids'))
    for (const s of searches) {
      let since
      for (let page = 0; page < (s.pages || maxPages); page++) {
        const { body } = await gfw.search({ query: s.query, where: s.where, since })
        await save(`search-${runId}-${searches.indexOf(s)}-${page}.json`, body)
        if (searches.length > 20 && searches.indexOf(s) % 50 === 0 && page === 0) console.log(`  search ${searches.indexOf(s) + 1}/${searches.length} (ids so far ${ids.size})`)
        for (const e of body.entries || []) {
          const id = (e.selfReportedInfo || []).map((x) => x.id).filter(Boolean).sort()[0]
          if (id) ids.add(id)
        }
        stats.searchTotal = (stats.searchTotal || 0) + (body.total ?? 0)
        since = body.since
        if (!since || !(body.entries || []).length) break
      }
    }
    console.log(`discovered ${ids.size} GFW vessel ids`)
    if (args.includes('--resume')) {
      const { rows } = await pool.query(
        `SELECT DISTINCT a.sub_record_ref FROM ${schema}.assertions a JOIN ${schema}.source_entities se ON se.id = a.source_entity_id
          WHERE se.source_id = $1 AND a.evidence_class = 'ais_self_reported' AND a.sub_record_ref = ANY($2)`, [GFW_SOURCE.id, [...ids]])
      for (const r of rows) ids.delete(r.sub_record_ref)
      stats.skippedAlreadyStored = rows.length
      console.log(`--resume: ${rows.length} already stored, ${ids.size} to fetch`)
    }
    // 2. Fetch full detail in batches and ingest.
    const all = [...ids]
    for (let i = 0; i < all.length; i += 20) {
      const batch = all.slice(i, i + 20)
      const { url, body, datasets } = await gfw.byIds(batch)
      await save(`detail-${runId}-${i / 20}.json`, body)
      datasetVersion ||= datasets
      stats.idsNotFound = (stats.idsNotFound || 0) + (body.metadata?.idsNotFound?.length || 0)
      await ingestAll(body.entries || [], url)
      console.log(`  ${Math.min(i + 20, all.length)}/${all.length} ingested (GFW calls ${gfw.calls}, daily remaining ${gfw.remainingDaily ?? '?'})`)
    }
    stats.gfwCalls = gfw.calls
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats, datasetVersion }))
  console.log('done', stats)
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, datasetVersion, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
