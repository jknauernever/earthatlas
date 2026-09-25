#!/usr/bin/env node
/**
 * Import MarineCadastre AIS identity (built by scripts/ships/bake-ais/build_tracks.py)
 * into the /ships database as claims, then resolve each MMSI to a vessel.
 *
 *   npm run ships:import-mc                     # every build/identity-*.ndjson
 *   npm run ships:import-mc -- --months 2026-06
 *
 * Months are aggregated first, so each value carries its overall first/last
 * seen. Re-running after new months are baked supersedes the shorter periods
 * (never deletes them). Idempotent.
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { aggregateRows, MC_SOURCE } from '../../lib/ships/marinecadastre.js'
import { ensureMcSource, ingestMcMmsi } from '../../lib/ships/ingestMc.js'
import { tally } from '../../lib/ships/ingestGfw.js'
import { startRun, finishRun } from '../../lib/ships/store.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build')
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const want = opt('months')?.split(',')
const CONCURRENCY = 6 // distinct MMSIs never merge with each other by rule, so parallel is safe

const files = (await readdir(BUILD)).filter((f) => /^identity-\d{4}-\d{2}\.ndjson$/.test(f))
  .filter((f) => !want || want.includes(f.slice(9, 16))).sort()
if (!files.length) { console.error(`no identity files in ${BUILD}`); process.exit(1) }
const rows = []
for (const f of files) {
  for (const line of (await readFile(path.join(BUILD, f), 'utf8')).split('\n')) if (line.trim()) rows.push(JSON.parse(line))
}
const aggs = aggregateRows(rows)
console.log(`${files.length} month(s): ${files.join(', ')} → ${aggs.length.toLocaleString()} MMSIs`)

const pool = shipsPool()
const stats = {}
let runId = null
try {
  await ensureMcSource(pool, schema)
  runId = await withTx(pool, (c) => startRun(c, schema, MC_SOURCE.id, { files }))
  let i = 0, done = 0
  const worker = async () => {
    while (i < aggs.length) {
      const a = aggs[i++]
      tally(stats, await ingestMcMmsi(pool, schema, a, { runId, retrievalUrl: `bake:${files.join('+')}` }))
      if (++done % 250 === 0) console.log(`  ${done}/${aggs.length}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats }))
  console.log('done', stats)
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e); process.exitCode = 1
} finally {
  await pool.end()
}
