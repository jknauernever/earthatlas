#!/usr/bin/env node
/**
 * EU MRV (EMSA THETIS-MRV) publication files → ships evidence + 'emissions_report' claims (lib/ships/euMrv.js; facts:
 * docs/SHIP_POLLUTION_SOURCES.md §1). Phase 4, authorized by Josh 2026-09-29.
 *
 * Files live in the gitignored scripts/ships/mrv/raw/ as <year>-v<version>.xlsx (+ downloadable-files-<date>.json, the listing
 * they came from). --download asks EMSA's listing (1 request) and fetches only year files whose version we don't have yet
 * (~4–12 MB each), with a generic browser User-Agent. Without --download nothing is fetched.
 *
 *   npm run ships:import-eu-mrv -- (--imo 9378448,9645425 | --known | --all) [--years 2024,2025] [--download] [--schema <name>] [--dry-run]
 *     --imo     only these ships (dev proof runs)
 *     --known   only IMOs some EarthAtlas vessel already carries (any non-community claim, checksum-valid); the others stay out
 *               of the database (≈1.9k of ≈26k ships in prod on 2026-09-29) and can be added by re-running after new vessels arrive
 *     --all     every row (≈115k ship-years, ~300 MB of evidence: not recommended)
 *     --years   default: every year we hold a file for
 * Writes to SHIPS_DATABASE_URL (dev via .env.local). Production only via scripts/ships/prod.sh with Josh's go-ahead.
 * Idempotent: an unchanged file stores nothing new and re-decides the same way. A new file version stores new records only for
 * ship-years whose cells changed; claims the new version no longer makes are superseded (kept).
 */
import { readFile, readdir, writeFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { startRun, finishRun, sha256 } from '../../lib/ships/store.js'
import { sheetRows, sharedStrings } from '../../lib/ships/xlsx.js'
import {
  groupWorkbook, mrvAssertions, importMrvChunk, finishMrvYear, storeFileHeader, ensureMrvSource, MRV_SOURCE, FILES_URL, fileUrl,
} from '../../lib/ships/euMrv.js'

const RAW = 'scripts/ships/mrv/raw'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')
const only = opt('imo') ? new Set(opt('imo').split(',').map((s) => s.trim())) : null
const known = args.includes('--known'), all = args.includes('--all')
if (!only && !known && !all) { console.error('say which ships: --imo <list>, --known or --all'); process.exit(2) }
const wantYears = opt('years') ? new Set(opt('years').split(',').map(Number)) : null

async function listing() {
  const fs = (await readdir(RAW).catch(() => [])).filter((f) => /^downloadable-files-.*\.json$/.test(f)).sort()
  return fs.length ? JSON.parse(await readFile(path.join(RAW, fs.at(-1)), 'utf8')).results : []
}
async function download() {
  const r = await fetch(FILES_URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!r.ok) throw new Error(`EMSA listing: HTTP ${r.status}`)
  const j = await r.json()
  await writeFile(path.join(RAW, `downloadable-files-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(j))
  for (const f of j.results) {
    if (wantYears && !wantYears.has(f.reportingPeriod)) continue
    const out = path.join(RAW, `${f.reportingPeriod}-v${f.version}.xlsx`)
    if (await stat(out).catch(() => null)) continue
    const b = await fetch(fileUrl(f.reportingPeriod, f.version), { headers: { 'User-Agent': UA } })
    if (!b.ok) throw new Error(`EMSA ${f.reportingPeriod} v${f.version}: HTTP ${b.status}`)
    await writeFile(out, Buffer.from(await b.arrayBuffer()))
    console.log(`downloaded ${out}`)
    await new Promise((res) => setTimeout(res, 1000))
  }
}
/** Newest local file per year → [{ year, version, file }] */
async function localFiles() {
  const best = new Map()
  for (const f of await readdir(RAW)) {
    const m = /^(\d{4})-v(\d+)\.xlsx$/.exec(f)
    if (!m) continue
    const y = Number(m[1]), v = Number(m[2])
    if (wantYears && !wantYears.has(y)) continue
    if (!best.has(y) || best.get(y).version < v) best.set(y, { year: y, version: v, file: path.join(RAW, f) })
  }
  return [...best.values()].sort((a, b) => a.year - b.year)
}
function readWorkbook(file) {
  const un = (p) => execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 30 }).toString('utf8')
  const wb = un('xl/workbook.xml')
  const rels = un('xl/_rels/workbook.xml.rels')
  let ss = []
  try { ss = sharedStrings(un('xl/sharedStrings.xml')) } catch { /* no shared strings part: every cell is inline */ }
  return [...wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, name, rid]) => {
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1] || new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels)?.[1]
    return { name, rows: sheetRows(un(`xl/${target.replace(/^\/?xl\//, '')}`), ss) }
  })
}

const pool = shipsPool()
console.log(`EU MRV → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}${dry ? ' (dry run)' : ''}; ships: ${only ? [...only].join(',') : known ? 'known IMOs' : 'all'}`)
try {
  if (args.includes('--download')) await download()
  const meta = await listing()
  let knownImos = null
  if (known) {
    const { rows } = await pool.query(`SELECT DISTINCT value_norm FROM ${schema}.vessel_assertions
      WHERE attribute = 'imo' AND (detail->>'checksum_ok')::boolean AND evidence_class <> 'community_curated'`)
    knownImos = new Set(rows.map((r) => r.value_norm))
    console.log(`known IMOs in the database: ${knownImos.size}`)
  }
  if (!dry) await withTx(pool, (c) => ensureMrvSource(c, schema))
  for (const lf of await localFiles()) {
    const buf = await readFile(lf.file)
    const m = meta.find((x) => x.reportingPeriod === lf.year && x.version === lf.version)
    const file = { name: m?.fileName ? `${m.fileName}.xlsx` : path.basename(lf.file), year: lf.year, version: lf.version,
      generated: m?.generationDate ?? null, sha256: sha256(buf), bytes: buf.length }
    const { groups, layout, header } = groupWorkbook(readWorkbook(lf.file), { year: lf.year })
    const pick = groups.filter((g) => (only ? only.has(g.imo) : knownImos ? knownImos.has(g.imo) : true))
    const claims = pick.flatMap((g) => mrvAssertions(g, layout, file))
    console.log(`${lf.year} v${lf.version}: ${groups.length} ship-years (${groups.filter((g) => g.rows.some((r) => r.kind === 'partial')).length} with partial rows) → importing ${pick.length}, ${claims.length} claims`)
    if (dry || !pick.length) continue
    const runId = await startRun(pool, schema, MRV_SOURCE.id, { file: file.name, year: file.year, version: file.version, sha256: file.sha256, ships: only ? [...only] : known ? 'known' : 'all' })
    const tot = { recordsCreated: 0, claimsCreated: 0, superseded: 0, resolved: {} }
    try {
      await withTx(pool, (c) => storeFileHeader(c, schema, file, header, { runId }))
      const CHUNK = 100
      for (let i = 0; i < pick.length; i += CHUNK) {
        const r = await withRetry(() => withTx(pool, (c) => importMrvChunk(c, schema, pick.slice(i, i + CHUNK), layout, file, { runId })))
        tot.recordsCreated += r.recordsCreated; tot.claimsCreated += r.claimsCreated; tot.superseded += r.superseded
        for (const [k, v] of Object.entries(r.resolved)) tot.resolved[k] = (tot.resolved[k] || 0) + v
      }
      const fin = await withTx(pool, (c) => finishMrvYear(c, schema, lf.year, groups.map((g) => g.key)))
      tot.goneFromFile = fin.superseded
      await finishRun(pool, schema, runId, { status: 'succeeded', stats: tot, datasetVersion: `${lf.year} v${lf.version}` })
      console.log(`  ${JSON.stringify(tot)}`)
    } catch (e) { await finishRun(pool, schema, runId, { status: 'failed', stats: tot, error: String(e.message || e) }); throw e }
  }
} finally {
  await pool.end()
}
