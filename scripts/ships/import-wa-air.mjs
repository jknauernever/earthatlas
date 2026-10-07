#!/usr/bin/env node
/**
 * WA local clean air agency permits (PSCAA, ORCAA; SWCAA pilot) for our terminals → ships evidence + claims
 * (lib/ships/waAirAgencies.js; data lib/ships/data/wa-air-permits.json; sources docs/PERMITS_SOURCES.md).
 * DEV database unless run through scripts/ships/prod.sh. Run ships:import-terminals and ships:import-facilities first (the
 * terminals, facilities and EPA-listed permits must exist). Idempotent.
 *
 *   npm run ships:import-wa-air -- [--schema <name>] [--dry-run] [--refresh]
 *
 * Requests: only the pages and documents the data file needs (listing pages, main documents, quoted documents; ~25 URLs),
 * each fetched once into scripts/ships/facilities/cache (gitignored) by scripts/ships/air-fetch.mjs, ≥ 1.5 s apart. A re-run,
 * and the production run, make 0 requests. --dry-run checks every number, holder and dock quote against the cached text and
 * writes nothing.
 */
import { readFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { validateAirData, urlsNeeded, formKey, checkTexts, importWaAir, ensureAirSources, AGENCIES } from '../../lib/ships/waAirAgencies.js'
import { airDoc, counter } from './air-fetch.mjs'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run'), refresh = args.includes('--refresh')

const data = JSON.parse(await readFile(new URL('../../lib/ships/data/wa-air-permits.json', import.meta.url), 'utf8'))
const errs = validateAirData(data)
if (errs.length) { console.error(`wa-air-permits.json invalid:\n  ${errs.join('\n  ')}`); process.exit(1) }

const docs = new Map()
for (const { url, form } of urlsNeeded(data)) {
  try { docs.set(formKey(url, form), await airDoc(url, { refresh, form })) } catch (e) { console.log(`  ! not fetched: ${e.message}`) }
}
const problems = checkTexts(data, docs)
for (const e of data.entries) {
  const ps = (e.permits || []).map((p) => `${p.number ?? p.key} (${p.status})`)
  console.log(`  ${e.terminal} ${AGENCIES[e.agency].system}: ${ps.join(', ') || (e.attach?.length ? `documents/quotes for ${e.attach.map((a) => a.permit.key).join(', ')}` : 'none found')}`)
}
for (const p of problems) console.log(`  ! ${p}`)
console.log(`\nrequests made this run: ${counter.requests}`)
if (dry) { console.log(`dry run: ${problems.length} text-check problem(s); nothing written`); process.exit(problems.length ? 1 : 0) }

const pool = shipsPool()
try {
  console.log(`writing to schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
  await withTx(pool, (c) => ensureAirSources(c, schema))
  const runId = await withTx(pool, (c) => startRun(c, schema, AGENCIES.pscaa.source.id, { version: data.version, wa_air: true }))
  let r
  try { r = await withTx(pool, (c) => importWaAir(c, schema, data, docs, { runId })) } catch (e) {
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats: {}, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: { ...r, problems: r.problems.length }, datasetVersion: data.version }))
  console.log(JSON.stringify({ ...r, problems: r.problems.length }))
  for (const p of r.problems) console.log(`  ! ${p}`)
} finally { await pool.end() }
