#!/usr/bin/env node
/**
 * Import FCC ULS ship radio station licences (docs/VESSEL_REGISTRIES.md §FCC).
 *
 *   npm run ships:import-fcc -- --fetch        # download the weekly complete file first (~44 MB)
 *   npm run ships:import-fcc                   # licences whose MMSI or call sign our sources carry
 *   npm run ships:import-fcc -- --usi 4921984,4805138
 *   add --resume to skip licences already stored; --limit N to stop after N
 *
 * Input: l_ship.zip unzipped in scripts/ships/bake-ais/build/registries/l_ship/ (gitignored).
 * Scope: a licence is imported only when its MMSI (station number) or call sign is one our
 * AIS / GFW sources already carry. A registry record never creates a vessel (attach-only),
 * so the other ~395k licences would add storage but no vessel.
 * Privacy: personal data is withheld before storage (lib/ships/fccUls.js).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { ensureRegistrySources, ingestRegistryRecord } from '../../lib/ships/ingestRegistry.js'
import { tally } from '../../lib/ships/ingestGfw.js'
import { FCC_SOURCE, FCC_ENTITY_KIND, groupByUsi, buildLicenseRecord, fccStamp, splitLine, SH_FIELDS } from '../../lib/ships/fccUls.js'
import { normCallsign, normMmsi } from '../../lib/ships/normalize.js'
import { startRun, finishRun } from '../../lib/ships/store.js'

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'registries')
const URL_ZIP = 'https://data.fcc.gov/download/pub/uls/complete/l_ship.zip'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dir = opt('dir') || path.join(BUILD, 'l_ship')
const limit = opt('limit') ? Number(opt('limit')) : Infinity

function countResolution(stats, r) {
  tally(stats, r)
  if (r.resolution.reason) stats[`unresolved_${r.resolution.reason}`] = (stats[`unresolved_${r.resolution.reason}`] || 0) + 1
}

const pool = shipsPool()
const stats = {}
let runId = null
try {
  if (args.includes('--fetch')) {
    await mkdir(BUILD, { recursive: true })
    const zip = path.join(BUILD, 'l_ship.zip')
    console.log(`fetching ${URL_ZIP}`)
    const res = await fetch(URL_ZIP, { headers: { 'User-Agent': 'EarthAtlas-ships/0.1 (+https://earthatlas.org)' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await writeFile(zip, Buffer.from(await res.arrayBuffer()))
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir])
  }
  const created = /File Creation Date: (.*)/.exec(await readFile(path.join(dir, 'counts'), 'utf8'))?.[1]?.trim()
  const dataset = { file: 'l_ship.zip', url: URL_ZIP, created, created_utc: fccStamp(created) }
  if (!dataset.created_utc) throw new Error(`unreadable file creation date: ${created}`)
  const read = async (f) => readFile(path.join(dir, `${f}.dat`), 'latin1').catch(() => '')

  await ensureRegistrySources(pool, schema)
  const params = Object.fromEntries(['usi', 'limit'].map((k) => [k, opt(k)]).filter(([, v]) => v))
  params.dataset = dataset.created_utc
  runId = await withTx(pool, (c) => startRun(c, schema, FCC_SOURCE.id, params))
  console.log(`import run ${runId} → schema "${schema}" (FCC file created ${created})`)

  // 1. Which licences: explicit, or those whose MMSI / call sign we already carry.
  let usis = (opt('usi') || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!usis.length) {
    const { rows } = await pool.query(
      `SELECT DISTINCT attribute, value_norm FROM ${schema}.assertions
        WHERE attribute IN ('mmsi', 'callsign') AND status = 'active' AND value_norm <> ''
          AND evidence_class NOT IN ('community_curated', 'registry')`)
    const ourMmsi = new Set(rows.filter((r) => r.attribute === 'mmsi').map((r) => r.value_norm))
    const ourCs = new Set(rows.filter((r) => r.attribute === 'callsign').map((r) => r.value_norm))
    const set = new Set()
    let byMmsi = 0, byCs = 0
    for (const line of (await read('SH')).split('\n')) {
      if (!line) continue
      const f = splitLine(line)
      const m = normMmsi(f[SH_FIELDS.station_number]).value, cs = normCallsign(f[SH_FIELDS.callsign])
      if (m && ourMmsi.has(m)) { set.add(f[1]); byMmsi++ } else if (cs && ourCs.has(cs)) { set.add(f[1]); byCs++ }
    }
    usis = [...set].sort((a, b) => Number(a) - Number(b))
    Object.assign(stats, { licencesByMmsi: byMmsi, licencesByCallsignOnly: byCs })
    console.log(`FCC: ${usis.length} licences carry one of our ${ourMmsi.size} MMSIs / ${ourCs.size} call signs`)
  }
  if (args.includes('--resume')) {
    const { rows } = await pool.query(
      `SELECT entity_key FROM ${schema}.source_entities WHERE source_id = $1 AND entity_kind = $2 AND entity_key = ANY($3)`,
      [FCC_SOURCE.id, FCC_ENTITY_KIND, usis])
    const have = new Set(rows.map((r) => r.entity_key))
    usis = usis.filter((u) => !have.has(u))
    stats.skippedAlreadyStored = have.size
    console.log(`--resume: ${have.size} already stored, ${usis.length} to go`)
  }
  usis = usis.slice(0, limit)
  const keep = new Set(usis)
  const rowsByUsi = {}
  for (const f of ['HD', 'EN', 'SH', 'SR', 'SV', 'HS', 'CO', 'LA', 'SE']) {
    for (const [usi, ls] of groupByUsi(await read(f), keep)) ((rowsByUsi[usi] ||= {})[f] = ls)
  }
  // 2. Ingest. Registry entities only attach (never create vessels), so a few in parallel is safe.
  let i = 0, done = 0
  const worker = async () => {
    while (i < usis.length) {
      const usi = usis[i++]
      if (!rowsByUsi[usi]?.HD) { stats.noHeader = (stats.noHeader || 0) + 1; continue }
      const rec = buildLicenseRecord(usi, rowsByUsi[usi], dataset)
      const r = await withRetry(() => ingestRegistryRecord(pool, schema, 'fcc', rec, { runId, retrievalUrl: URL_ZIP }))
      countResolution(stats, r)
      for (const w of r.warnings) console.warn(`  warn ${usi}: ${w}`)
      if (++done % 500 === 0) console.log(`  ${done}/${usis.length}`)
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats, datasetVersion: `uls-complete:${dataset.created_utc.slice(0, 10)}` }))
  console.log('done', stats)
} catch (e) {
  if (runId) await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats, error: String(e.stack || e) })).catch(() => {})
  console.error(e)
  process.exitCode = 1
} finally {
  await pool.end()
}
