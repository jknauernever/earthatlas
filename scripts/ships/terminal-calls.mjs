#!/usr/bin/env node
/**
 * Terminal calls from our own AIS positions (lib/ships/terminalCalls.js; Josh 2026-09-28). Three steps:
 *
 *   node --env-file=.env.local scripts/ships/terminal-calls.mjs berths
 *       → scripts/ships/bake-ais/cache/terminal-calls/berths.json: every active berth of a listed terminal (DEV DB), with its
 *         length from the official record, the radius the rule uses, and whether it lies inside the AIS points box.
 *   cd scripts/ships/bake-ais && python3 terminal_calls.py [--days YYYY-MM-DD ...] [--export]
 *       → stopped positions near a berth (hits), per day, then hits.csv sorted by terminal, MMSI, time.
 *   node --env-file=.env.local scripts/ships/terminal-calls.mjs import [--schema <name>] [--dry-run]
 *       → splits hits.csv into calls (splitCalls) and stores them in <schema>.terminal_calls (DEV DB unless Josh says
 *         otherwise), plus one source record describing the bake (rule, berths + radii, days covered). Idempotent per
 *         BAKE_VERSION: a re-import replaces that version's calls in one transaction.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { upsertSource, startRun, finishRun } from '../../lib/ships/store.js'
import { BAKE_VERSION, CALL_RULE, TERMINAL_CALLS_SOURCE, berthLength, berthLengthOf, berthRadiusM, inAisBox, callSplitter, storeTerminalCalls } from '../../lib/ships/terminalCalls.js'

const DIR = 'scripts/ships/bake-ais/cache/terminal-calls'
const args = process.argv.slice(2)
const cmd = args[0]
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')

const pool = shipsPool()
const q = async (text, params) => (await pool.query(text, params)).rows
try {
  const host = new URL(process.env.SHIPS_DATABASE_URL).host
  if (cmd === 'berths') await berths()
  else if (cmd === 'import') { console.log(`terminal calls → schema "${schema}" on ${host}${dry ? ' (dry run)' : ''}`); await importCalls() }
  else { console.error('usage: terminal-calls.mjs berths | import [--schema s] [--dry-run]'); process.exitCode = 2 }
} finally { await pool.end() }

async function berths() {
  const rows = await q(`SELECT t.key AS terminal, t.kind, b.berth_key AS berth, b.lat, b.lon, b.basis, b.source_id, b.source_record_ids,
                               b.detail->>'berths_desc' AS desc, b.detail->>'official_berth' AS official_berth
                          FROM ${schema}.terminal_berths b JOIN ${schema}.terminals t ON t.id = b.terminal_id
                         WHERE b.status = 'active' AND t.list_status = 'listed' ORDER BY t.key, b.berth_key`)
  const usaceIds = rows.filter((r) => r.basis === 'usace_dock').flatMap((r) => r.source_record_ids.map(Number))
  const usace = usaceIds.length ? new Map((await q(`SELECT id, payload->>'BERTHING_LARGEST' AS ft FROM ${schema}.source_records WHERE id = ANY($1)`, [usaceIds]))
    .map((r) => [Number(r.id), r.ft])) : new Map()
  // An OSM berth numbered like an official berth (salish-terminals-osm.json official_berth) takes that berth's official length.
  const descOf = new Map(rows.filter((r) => r.basis === 'bc_ports_terminals' && r.desc).map((r) => [r.terminal, r.desc]))
  const out = rows.map((r) => {
    const ft = r.basis === 'usace_dock' ? r.source_record_ids.map((id) => usace.get(Number(id))).find((x) => x != null) ?? null : null
    const own = r.official_berth ? berthLengthOf(descOf.get(r.terminal), r.official_berth) : null
    const len = own ? { m: own, from: `BC Ports and Terminals berth description (${r.official_berth})` } : berthLength({ desc: r.desc, usaceBerthingLargestFt: ft })
    return { terminal: r.terminal, kind: r.kind, berth: r.berth, lat: r.lat, lon: r.lon, basis: r.basis,
      length_m: len?.m ?? null, length_from: len?.from ?? null, radius_m: berthRadiusM(len?.m), in_box: inAisBox(r.lat, r.lon) }
  })
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, 'berths.json'), JSON.stringify({ bake_version: BAKE_VERSION, rule: CALL_RULE, berths: out }, null, 1))
  const outside = [...new Set(out.filter((b) => !b.in_box).map((b) => b.terminal))]
  console.log(`${out.length} berths of ${new Set(out.map((b) => b.terminal)).size} terminals → ${DIR}/berths.json; outside the AIS box: ${outside.join(', ') || 'none'}`)
}

async function importCalls() {
  const meta = JSON.parse(await readFile(path.join(DIR, 'meta.json'), 'utf8'))
  const bj = JSON.parse(await readFile(path.join(DIR, 'berths.json'), 'utf8'))
  if (meta.bake_version !== BAKE_VERSION || bj.bake_version !== BAKE_VERSION) throw new Error(`bake version mismatch: meta ${meta.bake_version}, berths ${bj.bake_version}, code ${BAKE_VERSION}`)
  const calls = []
  const split = callSplitter((c) => calls.push(c))
  const rl = createInterface({ input: createReadStream(path.join(DIR, 'hits.csv')), crlfDelay: Infinity })
  let header = null, n = 0
  for await (const line of rl) {
    if (!header) { header = line.split(','); continue }
    const f = parseCsvLine(line)
    const r = Object.fromEntries(header.map((h, i) => [h, f[i]]))
    split.push(r.terminal, r.mmsi, { t: Date.parse(r.t), m: Number(r.m), berth: r.berth, also: r.also ? r.also.split('|') : null,
      name: r.name || null, imo: r.imo || null, type: r.type === '' ? null : Number(r.type), length: r.length === '' ? null : Number(r.length) })
    n++
  }
  split.end()
  const terminalsN = new Set(calls.map((c) => c.terminal)).size
  console.log(`${n.toLocaleString()} stopped positions → ${calls.length.toLocaleString()} calls at ${terminalsN} terminals`)
  if (dry) { for (const c of calls.slice(0, 5)) console.log(JSON.stringify(c)); return }

  const bake = { rule: CALL_RULE, input: meta.input, days: meta.days, months: meta.months, notCovered: meta.not_covered, hits: n, baked_at: meta.baked_at,
    berths: bj.berths.map(({ terminal, berth, lat, lon, length_m, length_from, radius_m, in_box }) => ({ terminal, berth, lat, lon, length_m, length_from, radius_m, in_box })) }
  await withTx(pool, async (c) => {
    await upsertSource(c, schema, TERMINAL_CALLS_SOURCE)
    const runId = await startRun(c, schema, TERMINAL_CALLS_SOURCE.id, { bake_version: BAKE_VERSION, days: meta.days.length })
    const r = await storeTerminalCalls(c, schema, { calls, bake, runId })
    await finishRun(c, schema, runId, { status: 'succeeded', stats: { hits: n, calls: calls.length, terminals: terminalsN }, datasetVersion: BAKE_VERSION })
    console.log(`stored ${r.calls} calls; bake record ${r.recordId}${r.recordCreated ? ' (new)' : ' (unchanged)'}`)
  })
}

/** hits.csv is written by DuckDB COPY (RFC 4180 quoting). */
function parseCsvLine(s) {
  const out = []
  let i = 0
  while (i <= s.length) {
    if (s[i] === '"') {
      let v = '', j = i + 1
      for (;;) {
        if (s[j] === '"' && s[j + 1] === '"') { v += '"'; j += 2 } else if (s[j] === '"') { j++; break } else if (j >= s.length) break; else v += s[j++]
      }
      out.push(v); i = j + 1
    } else {
      const j = s.indexOf(',', i)
      if (j < 0) { out.push(s.slice(i)); break }
      out.push(s.slice(i, j)); i = j + 1
    }
  }
  return out
}
