#!/usr/bin/env node
/**
 * Ship photos from Wikimedia Commons "Category:IMO <n>" (docs/COMMONS_PHOTOS.md).
 *
 *   npm run ships:import-commons                       # Salish vessels (MarineCadastre-seen) with a registry IMO and no photo
 *   npm run ships:import-commons -- --all              # every vessel with a registry IMO and no photo
 *   npm run ships:import-commons -- --imos 9509401,9515395
 *   add --resume to skip IMOs checked in the last 30 days (--max-age-days N to change),
 *       --limit N to stop after N IMOs, --max-files N per ship (default 200),
 *       --save <dir> to keep every raw response (for recorded test fixtures)
 *
 * Only a vessel holding exactly ONE checksum-valid registry-class IMO is looked up, and the
 * category's photos attach only through that IMO (resolver v1.5, decideCommons). Idempotent:
 * re-running stores nothing new for unchanged responses.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { COMMONS_SOURCE, IMO_CATEGORY_KIND, FRESH_DAYS, imoCategory } from '../../lib/ships/commons.js'
import { ensureCommonsSource, fetchImo, ingestImo } from '../../lib/ships/ingestCommons.js'
import { normImo } from '../../lib/ships/normalize.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { commonsClient } from './commonsClient.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const limit = opt('limit') ? Number(opt('limit')) : Infinity
const maxFiles = opt('max-files') ? Number(opt('max-files')) : 200
const maxAgeDays = opt('max-age-days') ? Number(opt('max-age-days')) : FRESH_DAYS
const saveDir = opt('save')

const pool = shipsPool()
const stats = { imosChecked: 0, categoriesFound: 0, imosWithPhotos: 0, filesSeen: 0, filesKept: 0, vesselsGainedPhotos: 0 }
const bump = (k, n = 1) => { stats[k] = (stats[k] || 0) + n }
let runId = null

function tallyImo(r) {
  bump('imosChecked')
  if (!r.exists) return
  bump('categoriesFound')
  if (r.truncated) bump('truncated')
  const kept = r.images.filter((x) => x.status === 'kept')
  bump('filesSeen', r.images.length)
  bump('filesKept', kept.length)
  if (kept.length) bump('imosWithPhotos')
  for (const x of r.images) {
    if (x.status === 'kept') (stats.licencesKept ||= {})[x.license] = (stats.licencesKept[x.license] || 0) + 1
    else if (x.status === 'skipped_license') (stats.licencesSkipped ||= {})[x.license] = (stats.licencesSkipped[x.license] || 0) + 1
    else (stats.otherSkipped ||= {})[x.status] = (stats.otherSkipped[x.status] || 0) + 1
  }
  if (r.resolution.action === 'accept' || r.resolution.action === 'keep') { if (kept.length) bump('vesselsGainedPhotos') }
  else (stats.unlinked ||= {})[r.resolution.reason] = (stats.unlinked[r.resolution.reason] || 0) + 1
}

try {
  await ensureCommonsSource(pool, schema)
  const params = Object.fromEntries(['imos', 'limit', 'max-files', 'max-age-days'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  for (const f of ['all', 'resume']) if (args.includes(`--${f}`)) params[f] = true
  runId = await withTx(pool, (c) => startRun(c, schema, COMMONS_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}"`, params)

  let imos
  if (opt('imos')) {
    imos = opt('imos').split(',').map((s) => normImo(s.trim())).filter((i) => i.valid).map((i) => i.value)
  } else {
    // Vessels with exactly one checksum-valid registry IMO and no photo yet (Salish = seen by MarineCadastre's Salish bake).
    const { rows } = await pool.query(
      `WITH reg AS (
         SELECT vessel_id, array_agg(DISTINCT value_norm) AS imos FROM ${schema}.vessel_assertions
          WHERE attribute = 'imo' AND evidence_class = 'registry' AND (detail->>'checksum_ok')::boolean
          GROUP BY vessel_id)
       SELECT DISTINCT reg.imos[1] AS imo FROM reg
        WHERE cardinality(reg.imos) = 1
          AND NOT EXISTS (SELECT 1 FROM ${schema}.vessel_assertions i WHERE i.vessel_id = reg.vessel_id AND i.attribute = 'image')
          AND ($1 OR EXISTS (SELECT 1 FROM ${schema}.vessel_assertions m WHERE m.vessel_id = reg.vessel_id AND m.source_id = 'marinecadastre-ais'))
        ORDER BY 1`, [args.includes('--all')])
    imos = rows.map((r) => r.imo)
    stats.candidateImos = imos.length
  }
  if (args.includes('--resume')) {
    const { rows } = await pool.query(
      `SELECT entity_key FROM ${schema}.source_entities WHERE source_id = $1 AND entity_kind = $2
          AND entity_key = ANY($3) AND last_seen_at > now() - make_interval(days => $4)`,
      [COMMONS_SOURCE.id, IMO_CATEGORY_KIND, imos.map(imoCategory), maxAgeDays])
    const have = new Set(rows.map((r) => r.entity_key))
    imos = imos.filter((i) => !have.has(imoCategory(i)))
    stats.skippedCheckedRecently = have.size
    console.log(`--resume: ${have.size} checked in the last ${maxAgeDays} days, ${imos.length} to check`)
  }
  imos = imos.slice(0, limit)
  const client = commonsClient()

  for (let i = 0; i < imos.length; i += 50) {
    const batch = imos.slice(i, i + 50)
    // 1. One categoryinfo request per 50 IMOs: which categories exist at all.
    const ci = await client.categoryInfo(batch.map(imoCategory))
    if (saveDir) {
      await mkdir(saveDir, { recursive: true })
      await writeFile(path.join(saveDir, `categoryinfo-${runId}-${i / 50}.json`), JSON.stringify({ request: ci.url, retrieved_at: new Date().toISOString(), response: ci.body }, null, 1))
    }
    // 2. Existing categories: members, then each harvested category's files with imageinfo (serial, polite).
    const fetched = []
    for (const imo of batch) {
      const pre = { request: ci.url, page: ci.byTitle[imoCategory(imo)] ?? { title: imoCategory(imo), missing: true, note: 'title absent from response' } }
      const f = await fetchImo(client, imo, { pre, maxFiles })
      if (saveDir && f.responses.length > 1) await writeFile(path.join(saveDir, `imo-${imo}.json`), JSON.stringify(f, null, 1))
      fetched.push(f)
    }
    // 3. Store, a few IMOs at a time. Categories only ever attach to existing vessels (never create or
    //    merge them), and every write is an idempotent upsert, so concurrent IMOs cannot race into duplicates.
    let k = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (k < fetched.length) {
        const f = fetched[k++]
        const r = await withRetry(() => ingestImo(pool, schema, f, { runId }))
        tallyImo(r)
      }
    }))
    console.log(`  ${Math.min(i + 50, imos.length)}/${imos.length} checked · ${stats.categoriesFound} categories · ${stats.imosWithPhotos} with photos · ${stats.filesKept} files (Commons calls ${client.calls})`)
  }
  stats.commonsCalls = client.calls
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats }))
  console.log('done', JSON.stringify(stats, null, 1))
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
