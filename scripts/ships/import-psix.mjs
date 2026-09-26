#!/usr/bin/env node
/**
 * Import USCG PSIX vessel records (docs/VESSEL_REGISTRIES.md §PSIX).
 *
 *   npm run ships:import-psix                     # search PSIX for our vessels, fetch the hits
 *   npm run ships:import-psix -- --ids 1763413,865188
 *   npm run ships:import-psix -- --replay lib/ships/test/fixtures/psix-live-2026-09-25.json
 *   add --resume to reuse the search log and skip PSIX vessels already stored; --limit N searches
 *
 * One search per vessel, by its strongest identifier: IMO (VIN = IMO), else a US official
 * number from an attached FCC licence (VIN), else its call sign (US MMSIs only). Each hit
 * (≤ 5 per search; more = ambiguous, skipped) is fetched in full: summary, particulars,
 * dimensions, tonnage, documents, cases = 6 requests. At most two requests in flight,
 * request starts ≥ 500 ms apart (≤ 2 requests/s).
 * Search log (for --resume): scripts/ships/bake-ais/build/registries/psix-searches.ndjson.
 */
import { mkdir, readFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureRegistrySources, ingestRegistryRecord } from '../../lib/ships/ingestRegistry.js'
import { tally } from '../../lib/ships/ingestGfw.js'
import { PSIX_SOURCE, PSIX_ENTITY_KIND, parseDataset } from '../../lib/ships/psix.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { psixClient } from './psixClient.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'registries')
const LOG = path.join(BUILD, 'psix-searches.ndjson')
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const limit = opt('limit') ? Number(opt('limit')) : Infinity
const MAX_HITS = 5
// Two requests in flight at most, request starts ≥ 500 ms apart (≤ 2 requests/s).
const LANES = 2

const pool = shipsPool()
const stats = {}
let runId = null
const count = (r) => {
  tally(stats, r)
  if (r.resolution.reason) stats[`unresolved_${r.resolution.reason}`] = (stats[`unresolved_${r.resolution.reason}`] || 0) + 1
}
try {
  await ensureRegistrySources(pool, schema)
  const params = Object.fromEntries(['ids', 'replay', 'limit'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  runId = await withTx(pool, (c) => startRun(c, schema, PSIX_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}"`, params)

  if (opt('replay')) {
    const rec = JSON.parse(await readFile(opt('replay'), 'utf8'))
    for (const v of rec.vessels) count(await withRetry(() => ingestRegistryRecord(pool, schema, 'psix', v, { runId, retrievalUrl: `replay:${path.basename(opt('replay'))}` })))
  } else {
    const px = psixClient({ pauseMs: 500 })
    let ids = (opt('ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (!ids.length) {
      // 1. One search per vessel, strongest identifier first.
      const { rows } = await pool.query(
        `SELECT v.id::text AS vessel_id,
                (SELECT min(value_norm) FROM ${schema}.vessel_assertions x WHERE x.vessel_id = v.id AND x.attribute = 'imo'
                   AND (x.detail->>'checksum_ok')::boolean AND x.evidence_class <> 'community_curated') AS imo,
                (SELECT min(value_norm) FROM ${schema}.vessel_assertions x WHERE x.vessel_id = v.id AND x.attribute = 'official_number'
                   AND x.detail->>'scheme' = 'us_official_number') AS official,
                (SELECT array_agg(DISTINCT value_raw) FROM ${schema}.vessel_assertions x WHERE x.vessel_id = v.id AND x.attribute = 'callsign'
                   AND x.evidence_class <> 'community_curated' AND length(x.value_norm) >= 3) AS callsigns,
                EXISTS (SELECT 1 FROM ${schema}.vessel_assertions x WHERE x.vessel_id = v.id AND x.attribute = 'mmsi'
                   AND left(x.value_norm, 3) IN ('338', '366', '367', '368', '369')) AS us
           FROM ${schema}.vessels v WHERE v.status = 'active'`)
      const searches = new Map()
      for (const r of rows) {
        if (r.imo) searches.set(`vin:${r.imo}`, { VIN: r.imo })
        else if (r.official) searches.set(`vin:${r.official}`, { VIN: r.official })
        else if (r.us && r.callsigns?.length) for (const cs of r.callsigns) searches.set(`cs:${cs.trim().toUpperCase()}`, { CallSign: cs.trim().toUpperCase() })
      }
      stats.searchesPlanned = searches.size
      await mkdir(BUILD, { recursive: true })
      const logged = new Map()
      if (args.includes('--resume')) {
        const txt = await readFile(LOG, 'utf8').catch(() => '')
        for (const l of txt.split('\n').filter(Boolean)) { const o = JSON.parse(l); logged.set(o.key, o.ids) }
      }
      const found = new Set()
      const todo = [...searches].slice(0, limit)
      let n = 0, k = 0
      const searchWorker = async () => {
        while (k < todo.length) {
          const [key, p] = todo[k++]
          let hits = logged.get(key)
          if (!hits) {
            const { xml } = await px.call('summary', p)
            hits = parseDataset(xml).map((r) => r.VesselId).filter(Boolean)
            await appendFile(LOG, `${JSON.stringify({ key, ids: hits, at: new Date().toISOString() })}\n`)
          } else stats.searchesReused = (stats.searchesReused || 0) + 1
          n++
          if (hits.length > MAX_HITS) { stats.searchesTooMany = (stats.searchesTooMany || 0) + 1; continue }
          stats[hits.length ? 'searchesWithHits' : 'searchesNoHit'] = (stats[hits.length ? 'searchesWithHits' : 'searchesNoHit'] || 0) + 1
          hits.forEach((h) => found.add(String(h)))
          if (n % 250 === 0) console.log(`  searches ${n}/${todo.length}, PSIX vessels found ${found.size} (requests ${px.calls})`)
        }
      }
      await Promise.all(Array.from({ length: LANES }, searchWorker))
      ids = [...found].sort((a, b) => Number(a) - Number(b))
      stats.psixVesselsFound = ids.length
      console.log(`PSIX: ${n} searches → ${ids.length} PSIX vessels`)
    }
    if (args.includes('--resume')) {
      const { rows } = await pool.query(
        `SELECT entity_key FROM ${schema}.source_entities WHERE source_id = $1 AND entity_kind = $2 AND entity_key = ANY($3)`,
        [PSIX_SOURCE.id, PSIX_ENTITY_KIND, ids])
      const have = new Set(rows.map((r) => r.entity_key))
      ids = ids.filter((i) => !have.has(i))
      stats.skippedAlreadyStored = have.size
    }
    // 2. Fetch each hit in full and ingest.
    let done = 0, j = 0
    const fetchWorker = async () => {
      while (j < ids.length) {
        const id = ids[j++]
        const payload = await px.vessel(id)
        const r = await withRetry(() => ingestRegistryRecord(pool, schema, 'psix', payload, { runId, retrievalUrl: px.endpoint }))
        count(r)
        for (const w of r.warnings) if (!/kept only in the raw record/.test(w)) console.warn(`  warn ${id}: ${w}`)
        if (++done % 100 === 0) console.log(`  fetched ${done}/${ids.length} (requests ${px.calls})`)
      }
    }
    await Promise.all(Array.from({ length: LANES }, fetchWorker))
    stats.psixRequests = px.calls
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
