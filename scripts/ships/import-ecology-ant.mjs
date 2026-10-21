#!/usr/bin/env node
/**
 * Washington Ecology Advance Notice of Transfer records → <schema>.ecology_ant_rows (lib/ships/ecologyAnt.js; Josh 2026-10-20).
 *
 *   cd scripts/ships/bake-ais && python3 ant_export.py cache/ecology-ant/<release>.xlsx [--anchorages]
 *   node --env-file=.env.local scripts/ships/import-ecology-ant.mjs --release ant-2026-08-24 [--schema s] [--dry-run]
 *
 * The release id names the file Ecology released (its rows run to that date). Re-importing a release replaces its rows; the
 * notice records are versioned by content, so unchanged notices keep their record.
 */
import { readFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { snapshot } from './bunker-snapshot.mjs'
import { startRun, finishRun, upsertSource } from '../../lib/ships/store.js'
import { ANT_SOURCE, storeAntRelease, parseAntRow, groupAntOperations } from '../../lib/ships/ecologyAnt.js'

const DIR = 'scripts/ships/bake-ais/cache/ecology-ant'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const releaseId = opt('release')
if (!/^ant-\d{4}-\d{2}-\d{2}$/.test(releaseId || '')) { console.error('usage: import-ecology-ant.mjs --release ant-YYYY-MM-DD [--schema s] [--dry-run]'); process.exit(2) }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')

const meta = JSON.parse(await readFile(`${DIR}/ant-meta.json`, 'utf8'))
const raw = JSON.parse(await readFile(`${DIR}/ant-rows.json`, 'utf8'))
const typed = raw.map(parseAntRow)
const ops = groupAntOperations(typed.map((r) => ({ ...r })))
console.log(`${raw.length} rows (${meta.filter}) → ${new Set(raw.map((r) => r.AntID)).size} notices → ${ops.length} operations; `
  + `${typed[0]?.startLocal} … ${typed.reduce((m, r) => (r.startLocal > m ? r.startLocal : m), '')} Pacific`)
if (dry) { console.log(JSON.stringify(typed.slice(0, 2), null, 1)); process.exit(0) }

const pool = shipsPool()
try {
  await withTx(pool, async (c) => {
    await upsertSource(c, schema, ANT_SOURCE)
    const runId = await startRun(c, schema, ANT_SOURCE.id, { release: releaseId, file: meta.file, sha256: meta.sha256, filter: meta.filter })
    const r = await storeAntRelease(c, schema, { releaseId, meta, raw, runId })
    await finishRun(c, schema, runId, { status: 'succeeded', stats: r, datasetVersion: releaseId })
    console.log(`stored ${r.rows} rows of ${r.notices} notices in "${schema}"`)
  })
  // The bunkering report is stored, not built per request (migration 040): rebuild it now that an input changed.
  try { await snapshot(pool, schema) } catch (e) { console.warn(`bunkering report not rebuilt: ${e.message}`) }
} finally { await pool.end() }
