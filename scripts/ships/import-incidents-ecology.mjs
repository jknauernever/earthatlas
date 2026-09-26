#!/usr/bin/env node
/**
 * Import WA Ecology "Reported spills to water" rows with Source_Type = 'Vessel'
 * (docs/SHIP_INCIDENT_SOURCES.md §5, §13). Small (~1,350 rows): the whole vessel subset is
 * imported, grouped by ERTS number, then matched NAME-ONLY → candidates only, never accepted.
 *
 *   npm run ships:import-incidents-ecology
 *   npm run ships:import-incidents-ecology -- --replay lib/ships/test/fixtures/ecology-live-2026-09-26.json
 *   --from-file <saved query json> reuses a previous download (the run saves one in
 *   scripts/ships/bake-ais/build/incidents/ecology-vessel-rows.json)
 *
 * Anonymous ArcGIS query, 2 pages of ≤ 2,000 rows, one request at a time.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureIncidentSources, ingestIncident, tallyIncident } from '../../lib/ships/incidents.js'
import { ECOLOGY_SOURCE, ECOLOGY_LAYER, mapEcology, groupEcologyRows } from '../../lib/ships/incidentsEcology.js'
import { startRun, finishRun } from '../../lib/ships/store.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'incidents')
const SAVED = path.join(BUILD, 'ecology-vessel-rows.json')
const UA = 'EarthAtlas-ships/0.1 (+https://earthatlas.org; vessel incident research)'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA

const queryUrl = (offset) => `${ECOLOGY_LAYER}/query?${new URLSearchParams({ where: "Source_Type='Vessel'", outFields: '*',
  returnGeometry: 'false', orderByFields: 'OBJECTID', resultOffset: String(offset), resultRecordCount: '2000', f: 'json' })}`

async function download() {
  const rows = []
  for (let offset = 0; ; offset += 2000) {
    const res = await fetch(queryUrl(offset), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) })
    if (res.status === 401 || res.status === 403) throw new Error(`Ecology layer HTTP ${res.status}: access refused (not worked around)`)
    if (!res.ok) throw new Error(`Ecology layer HTTP ${res.status}`)
    const j = await res.json()
    if (j.error) throw new Error(`Ecology layer error: ${JSON.stringify(j.error)}`)
    rows.push(...(j.features || []).map((f) => f.attributes))
    if (!j.exceededTransferLimit && (j.features || []).length < 2000) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  return { retrieved_at: new Date().toISOString(), query: queryUrl(0), rows }
}

const pool = shipsPool()
const stats = {}
let runId = null
try {
  await ensureIncidentSources(pool, schema, [ECOLOGY_SOURCE])
  const params = Object.fromEntries(['replay', 'from-file'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  runId = await withTx(pool, (c) => startRun(c, schema, ECOLOGY_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}"`, params)
  let dl
  if (opt('replay') || opt('from-file')) dl = JSON.parse(await readFile(opt('replay') || opt('from-file'), 'utf8'))
  else {
    dl = await download()
    await mkdir(BUILD, { recursive: true })
    await writeFile(SAVED, JSON.stringify(dl))
  }
  const groups = groupEcologyRows(dl.rows)
  stats.rowsFetched = dl.rows.length
  stats.ertsGroups = groups.size
  for (const [erts, rows] of groups) {
    const m = mapEcology({ erts_number: erts, retrieved_at: dl.retrieved_at, query_url: dl.query, rows })
    if (!m) continue
    const r = await withRetry(() => ingestIncident(pool, schema, m, { runId, retrievalUrl: dl.query, nameOnly: true }))
    tallyIncident(stats, r)
    if (stats.events % 200 === 0) console.log(`  ${stats.events}/${groups.size}`, JSON.stringify(stats))
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats, datasetVersion: `retrieved:${String(dl.retrieved_at).slice(0, 10)}` }))
  console.log('done', JSON.stringify(stats, null, 1))
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
