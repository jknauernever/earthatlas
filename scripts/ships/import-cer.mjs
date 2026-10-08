#!/usr/bin/env node
/**
 * Canada Energy Regulator records → the Westridge Marine Terminal facility (lib/ships/cer.js). DEV database by default
 * (SHIPS_DATABASE_URL from .env.local); production through scripts/ships/prod.sh import-cer (backs up first). Idempotent.
 *
 *   npm run ships:import-cer -- [--schema <name>] [--dry-run]
 *
 * Reads the CER open-data CSVs cached in scripts/ships/facilities/cache/cer/ (downloaded once, 2026-10-07) and the cached order
 * pages in cache/cer/pages/: 0 requests when cached (a missing order page is fetched once, scripts/ships/cer-fetch.mjs).
 * The facility must exist (npm run ships:import-bc-permits) and migration 033 must be applied.
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { loadFacilityData } from '../../lib/ships/facilities.js'
import { CER_DATASETS, ORDERS, readCerCsv, cerRecords, ensureCerSources, importCer, CER_SOURCE } from '../../lib/ships/cer.js'
import { cerPage, counter } from './cer-fetch.mjs'

const FACILITY = 'bc-westridge-marine-terminal'
const CACHE = 'scripts/ships/facilities/cache/cer'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')

const fac = (await loadFacilityData()).facilities.find((f) => f.id === FACILITY)
if (!fac) { console.error(`${FACILITY} not in the facility data`); process.exit(1) }
const berth = fac.bc.ema.berths[0]
const files = {}
let version = null
for (const [k, d] of Object.entries(CER_DATASETS)) {
  const file = path.join(CACHE, d.file)
  files[k] = readCerCsv(await readFile(file))
  const m = (await stat(file)).mtime.toISOString().slice(0, 10)
  if (!version || m > version) version = m
  console.log(`  ${d.file}: ${files[k].length} rows`)
}
const records = cerRecords(files, berth)
const tally = {}
for (const r of records) tally[`${r.kind} ${r.status}`] = (tally[`${r.kind} ${r.status}`] || 0) + 1
console.log('matched:', JSON.stringify(tally))
const pages = new Map()
for (const o of ORDERS) {
  for (const u of [o.url, ...o.related.map((x) => x.url)]) {
    try { pages.set(u, await cerPage(u)) } catch (e) { console.log(`  ! ${o.id}: ${e.message}`) }
  }
}
console.log(`requests made this run: ${counter.requests}`)
if (dry) { console.log('dry run: nothing written'); process.exit(0) }

const pool = shipsPool()
try {
  console.log(`writing to schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
  await withTx(pool, (c) => ensureCerSources(c, schema))
  const runId = await withTx(pool, (c) => startRun(c, schema, CER_SOURCE.id, { facility: FACILITY, version }))
  try {
    const r = await withTx(pool, (c) => importCer(c, schema, FACILITY, records, pages, { version, runId }))
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: { ...r, problems: r.problems.length }, datasetVersion: version }))
    console.log(JSON.stringify({ ...r, problems: r.problems.length }))
    for (const p of r.problems) console.log(`  ! ${p}`)
  } catch (e) {
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats: {}, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
} finally { await pool.end() }
