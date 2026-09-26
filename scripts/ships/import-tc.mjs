#!/usr/bin/env node
/**
 * Import Transport Canada's Canadian Register of Vessels (large vessels)
 * (docs/VESSEL_REGISTRIES.md §Transport Canada).
 *
 *   npm run ships:import-tc -- --fetch     # download the open.canada.ca export first (~3 MB)
 *   npm run ships:import-tc                # rows whose IMO, or name (Canadian MMSIs), our sources carry
 *   npm run ships:import-tc -- --official 844174,816503
 *   add --resume to skip rows already stored; --limit N; --no-api to skip the per-vessel API
 *
 * Scope: rows whose checksum-valid IMO one of our vessels carries (these also get the
 * Vessel Registration Query System API record: status, builder, certificate expiry),
 * plus rows whose name equals the name of one of our vessels transmitting a Canadian
 * MMSI (316…), which can at most become name + length CANDIDATES (never attached).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureRegistrySources, ingestRegistryRecord } from '../../lib/ships/ingestRegistry.js'
import { tally } from '../../lib/ships/ingestGfw.js'
import { TC_SOURCE, TC_ENTITY_KIND, officialNumber } from '../../lib/ships/tcRegistry.js'
import { sharedStrings, sheetRows, rowsToObjects } from '../../lib/ships/xlsx.js'
import { normImo, normName } from '../../lib/ships/normalize.js'
import { startRun, finishRun } from '../../lib/ships/store.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'registries')
const XLSX_URL = 'https://opendatatc.tc.canada.ca/large-vessel-registry_dataset_en.xlsx'
const API = 'http://data.tc.gc.ca/v1.3/api/eng/vessel-registration-query-system/canadian-registry-large-vessels/official-number/'
const UA = 'EarthAtlas-ships/0.1 (+https://earthatlas.org)'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const file = opt('file') || path.join(BUILD, 'tc-large.xlsx')
const metaFile = `${file}.meta.json`
const limit = opt('limit') ? Number(opt('limit')) : Infinity
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pool = shipsPool()
const stats = {}
let runId = null
try {
  if (args.includes('--fetch')) {
    await mkdir(path.dirname(file), { recursive: true })
    const res = await fetch(XLSX_URL, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await writeFile(file, Buffer.from(await res.arrayBuffer()))
    const lm = res.headers.get('last-modified')
    await writeFile(metaFile, JSON.stringify({ url: XLSX_URL, last_modified: lm ? new Date(lm).toISOString() : null, fetched_at: new Date().toISOString() }, null, 1))
    console.log(`fetched ${XLSX_URL} (Last-Modified ${lm})`)
  }
  const meta = JSON.parse(await readFile(metaFile, 'utf8'))
  const dataset = { file: path.basename(XLSX_URL), url: XLSX_URL, last_modified: meta.last_modified }
  const un = (p) => execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 30 }).toString('utf8')
  const rows = rowsToObjects(sheetRows(un('xl/worksheets/sheet1.xml'), sharedStrings(un('xl/sharedStrings.xml'))))
  stats.exportRows = rows.length

  await ensureRegistrySources(pool, schema)
  const params = Object.fromEntries(['official', 'limit'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  params.dataset = dataset.last_modified
  runId = await withTx(pool, (c) => startRun(c, schema, TC_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}" (export Last-Modified ${dataset.last_modified}, ${rows.length} rows)`)

  let pick
  const explicit = (opt('official') || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (explicit.length) pick = rows.filter((r) => explicit.includes(officialNumber(r['Official Number']))).map((r) => ({ row: r, api: true }))
  else {
    const { rows: ours } = await pool.query(
      `SELECT DISTINCT attribute, value_norm FROM ${schema}.vessel_assertions
        WHERE evidence_class NOT IN ('community_curated', 'registry') AND value_norm <> ''
          AND ((attribute = 'imo' AND (detail->>'checksum_ok')::boolean)
            OR (attribute = 'name' AND vessel_id IN (SELECT vessel_id FROM ${schema}.vessel_assertions
                                                      WHERE attribute = 'mmsi' AND value_norm LIKE '316%')))`)
    const imo = new Set(ours.filter((r) => r.attribute === 'imo').map((r) => r.value_norm))
    const names = new Set(ours.filter((r) => r.attribute === 'name').map((r) => r.value_norm))
    pick = []
    for (const r of rows) {
      const i = normImo(r['IMO Vessel Number'])
      if (i.valid && imo.has(i.value)) pick.push({ row: r, api: true })
      else if (names.has(normName(r['Vessel Name']))) pick.push({ row: r, api: false })
    }
    stats.rowsByImo = pick.filter((p) => p.api).length
    stats.rowsByNameOnly = pick.filter((p) => !p.api).length
    console.log(`TC: ${stats.rowsByImo} rows by IMO, ${stats.rowsByNameOnly} by name only (candidates at most)`)
  }
  if (args.includes('--no-api')) for (const p of pick) p.api = false
  if (args.includes('--resume')) {
    const keys = pick.map((p) => officialNumber(p.row['Official Number']))
    const { rows: have } = await pool.query(
      `SELECT entity_key FROM ${schema}.source_entities WHERE source_id = $1 AND entity_kind = $2 AND entity_key = ANY($3)`,
      [TC_SOURCE.id, TC_ENTITY_KIND, keys])
    const h = new Set(have.map((r) => r.entity_key))
    pick = pick.filter((p) => !h.has(officialNumber(p.row['Official Number'])))
    stats.skippedAlreadyStored = h.size
  }
  pick = pick.slice(0, limit)
  let done = 0
  for (const p of pick) {
    const on = officialNumber(p.row['Official Number'])
    const payload = { official_number: on, dataset, row: p.row, api: null }
    if (p.api) {
      const u = API + encodeURIComponent(on)
      await sleep(1000) // polite: one API request per second
      const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) }).catch((e) => ({ ok: false, status: String(e.message) }))
      if (res.ok) { payload.api = await res.json(); payload.api_url = u; payload.api_retrieved_at = new Date().toISOString(); stats.apiRecords = (stats.apiRecords || 0) + 1 }
      else { stats.apiFailed = (stats.apiFailed || 0) + 1; console.warn(`  API ${on}: ${res.status}`) }
    }
    const r = await withRetry(() => ingestRegistryRecord(pool, schema, 'tc', payload, { runId, retrievalUrl: payload.api_url ?? XLSX_URL }))
    tally(stats, r)
    if (r.resolution.reason) stats[`unresolved_${r.resolution.reason}`] = (stats[`unresolved_${r.resolution.reason}`] || 0) + 1
    for (const w of r.warnings) console.warn(`  warn ${on}: ${w}`)
    if (++done % 100 === 0) console.log(`  ${done}/${pick.length}`)
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats, datasetVersion: `export:${String(dataset.last_modified).slice(0, 10)}` }))
  console.log('done', stats)
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
