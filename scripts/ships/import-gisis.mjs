#!/usr/bin/env node
/**
 * IMO GISIS exports → ships evidence + claims (lib/ships/gisis.js; facts and terms: docs/IMO_GISIS.md).
 * Josh, 2026-09-27: "For our purposes now, assume IMO has given us permission. I don't care about casualty data. Scrubber and
 * facility info is a go." Used on Josh's instruction assuming IMO permission; written permission not yet obtained; the IMO Web
 * Accounts policy otherwise forbids republishing.
 *
 * This script never contacts IMO. It reads the files Josh's GISIS account downloaded with the official buttons, kept in the
 * gitignored scripts/ships/gisis/raw/ (never committed: IMO terms):
 *   IMO-<stamp>.csv                               MARPOL Annex VI Reg. 4.2 "Download all data"
 *   MaritimeSecurity-CheckOnlineForLatest-<stamp>.csv  ISPS "Declared port facilities" (all countries; CAN + USA stored)
 *
 *   npm run ships:import-gisis -- [scrubbers|facilities|all] [--schema <name>] [--reg42 <csv>] [--isps <csv>] [--dry-run]
 *     scrubbers   Reg. 4.2 rows → per-IMO evidence, 'scrubber' / 'equivalent_compliance' claims, resolver v1.6 (IMO_EXACT only)
 *     facilities  ISPS rows (Canada + United States; personal fields dropped) → evidence; then the terminal crosswalk
 *                 (lib/ships/data/gisis-terminal-crosswalk.json) → terminal_links role imo_port_facility
 *     all         (default) both
 * Writes to SHIPS_DATABASE_URL (dev via .env.local). Production needs Josh's go-ahead. Idempotent: an unchanged file stores
 * nothing new and re-decides the same way.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { startRun, finishRun, sha256 } from '../../lib/ships/store.js'
import {
  parseGisisCsv, checkColumns, REG42_COLUMNS, FACILITY_COLUMNS, groupReg42, reg42Assertions, importReg42Chunk, finishReg42,
  importFacilities, ensureGisisSources, loadCrosswalk, linkFacilitiesToTerminals, SCRUBBERS_SOURCE, FACILITIES_SOURCE,
} from '../../lib/ships/gisis.js'

const RAW = 'scripts/ships/gisis/raw'
const COUNTRIES = ['CAN', 'USA']
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const what = args.find((a) => ['scrubbers', 'facilities', 'all'].includes(a)) || 'all'
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')

async function newest(prefix) {
  const fs = (await readdir(RAW).catch(() => [])).filter((f) => f.startsWith(prefix) && f.endsWith('.csv')).sort()
  if (!fs.length) throw new Error(`no ${prefix}*.csv in ${RAW} (download it from GISIS with the official button first)`)
  return path.join(RAW, fs.at(-1))
}
/** The file, its checksum and the export stamp in its name (UTC, as GISIS names it). */
async function load(file) {
  const buf = await readFile(file)
  const stamp = /(\d{8})-(\d{6})/.exec(path.basename(file))
  const version = `${path.basename(file)} (GISIS export ${stamp ? `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6)} UTC` : 'date unknown'})`
  return { file: path.basename(file), size: (await stat(file)).size, sha256: sha256(buf), version, rows: parseGisisCsv(buf.toString('utf8')) }
}

console.log(`IMO GISIS: ${what} → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}${dry ? ' (dry run)' : ''}`)
const pool = shipsPool()
try {
  if (!dry) await withTx(pool, (c) => ensureGisisSources(c, schema))

  if (what === 'scrubbers' || what === 'all') {
    const f = await load(opt('reg42') || await newest('IMO-'))
    checkColumns(f.rows, REG42_COLUMNS)
    const groups = groupReg42(f.rows)
    const claims = groups.flatMap(reg42Assertions)
    const n = (p) => claims.filter(p).length
    console.log(`Reg. 4.2: ${f.file} ${f.size} bytes sha256 ${f.sha256}; ${f.rows.length} rows → ${groups.length} groups `
      + `(${groups.filter((g) => g.imo?.valid).length} valid IMO, ${groups.filter((g) => g.imo && !g.imo.valid).length} failing the check digit, `
      + `${groups.filter((g) => !g.imo).length} rows without an IMO); claims: scrubber ${n((a) => a.attribute === 'scrubber')} `
      + `(loop stated ${n((a) => a.attribute === 'scrubber' && a.detail.loop.length)}), equivalent_compliance ${n((a) => a.attribute === 'equivalent_compliance')}`)
    if (!dry) {
      const runId = await startRun(pool, schema, SCRUBBERS_SOURCE.id, { file: f.file, sha256: f.sha256, size: f.size })
      const tot = { recordsCreated: 0, claimsCreated: 0, superseded: 0, resolved: {} }
      try {
        const CHUNK = 200
        for (let i = 0; i < groups.length; i += CHUNK) {
          const r = await withRetry(() => withTx(pool, (c) => importReg42Chunk(c, schema, groups.slice(i, i + CHUNK), { runId, datasetVersion: f.version, file: f.file })))
          tot.recordsCreated += r.recordsCreated; tot.claimsCreated += r.claimsCreated; tot.superseded += r.superseded
          for (const [k, v] of Object.entries(r.resolved)) tot.resolved[k] = (tot.resolved[k] || 0) + v
          if ((i / CHUNK) % 5 === 4) console.log(`  ${Math.min(i + CHUNK, groups.length)}/${groups.length}`)
        }
        const fin = await withTx(pool, (c) => finishReg42(c, schema, groups.map((g) => g.key)))
        tot.goneFromExport = fin.superseded
        await finishRun(pool, schema, runId, { status: 'succeeded', stats: tot, datasetVersion: f.version })
      } catch (e) { await finishRun(pool, schema, runId, { status: 'failed', stats: tot, error: String(e.message || e) }); throw e }
      console.log('scrubbers:', JSON.stringify(tot))
    }
  }

  if (what === 'facilities' || what === 'all') {
    const f = await load(opt('isps') || await newest('MaritimeSecurity-'))
    checkColumns(f.rows, FACILITY_COLUMNS)
    const rows = f.rows.filter((r) => COUNTRIES.includes(r['Country Code']))
    console.log(`ISPS facilities: ${f.file} ${f.size} bytes sha256 ${f.sha256}; ${f.rows.length} rows, ${rows.length} for ${COUNTRIES.join(' + ')}`)
    if (!dry) {
      const runId = await startRun(pool, schema, FACILITIES_SOURCE.id, { file: f.file, sha256: f.sha256, size: f.size, countries: COUNTRIES })
      const r = await withTx(pool, (c) => importFacilities(c, schema, rows, { runId, datasetVersion: f.version, file: f.file }))
      const cw = await loadCrosswalk()
      const l = await withTx(pool, (c) => linkFacilitiesToTerminals(c, schema, cw))
      const stats = { facilities: r.facilities, recordsCreated: r.recordsCreated, errors: r.errors.length, droppedColumns: r.dropped, linked: l.linked, retired: l.retired, notLinked: l.notLinked.length }
      await finishRun(pool, schema, runId, { status: 'succeeded', stats, datasetVersion: f.version })
      console.log('facilities:', JSON.stringify(stats))
      for (const e of r.errors) console.log(`  error: ${e}`)
      for (const x of l.checks) {
        console.log(`  ${x.ok ? 'linked   ' : x.decision === 'link' ? 'NOT LINKED' : 'candidate'} ${x.terminal.padEnd(24)} ${x.facility}  ${x.km ?? '?'} km`
          + `${x.position_agrees === false ? ' (position disagrees)' : ''}${x.shared?.length ? ` · shared: ${x.shared.join(', ')}` : ''}${x.problems?.length && !x.ok ? ` · ${x.problems.join('; ')}` : ''}`)
      }
    }
  }
} finally { await pool.end() }
