#!/usr/bin/env node
/**
 * Dock calls (lib/ships/dockCalls.js; Josh 2026-11-07). Three steps, as terminal calls (scripts/ships/terminal-calls.mjs):
 *
 *   node scripts/ships/dock-calls.mjs docks
 *       → scripts/ships/bake-ais/cache/dock-calls/berths.json: every dock of lib/ships/data/antDocks.js at the collection radius.
 *   cd scripts/ships/bake-ais && python3 terminal_calls.py --set dock-calls [--days YYYY-MM-DD ...] && python3 terminal_calls.py --set dock-calls --export
 *       → stopped positions near a dock, per day, then hits.csv sorted by dock, MMSI, time.
 *   node --env-file=.env.local scripts/ships/dock-calls.mjs import [--schema <name>] [--dry-run]
 *       → keeps hits inside each dock's own radius, splits them into calls and stores them in <schema>.dock_calls (DEV DB unless
 *         SHIPS_DATABASE_URL says otherwise; prod via scripts/ships/prod.sh dock-calls). Idempotent per DOCK_BAKE_VERSION.
 *   ... import --post <api> --month YYYY-MM   (ships-noaa-month workflow) → op=importAisMonth kind 'dock', no database opened.
 */
import { createReadStream } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { upsertSource, startRun, finishRun } from '../../lib/ships/store.js'
import { callSplitter } from '../../lib/ships/terminalCalls.js'
import { DOCK_BAKE_VERSION, DOCK_RULE, DOCK_CALLS_SOURCE, dockScanFile, dockRadius, storeDockCalls } from '../../lib/ships/dockCalls.js'
import { ANT_DOCKS, ANT_DOCKS_VERSION } from '../../lib/ships/data/antDocks.js'

const DIR = 'scripts/ships/bake-ais/cache/dock-calls'
const args = process.argv.slice(2)
const cmd = args[0]
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')
const post = opt('post'), postMonth = opt('month')
if (post && !/^\d{4}-(0[1-9]|1[0-2])$/.test(postMonth || '')) throw new Error('--post needs --month YYYY-MM')

if (cmd === 'docks') {
  const f = dockScanFile()
  await mkdir(DIR, { recursive: true })
  await writeFile(path.join(DIR, 'berths.json'), JSON.stringify(f, null, 1))
  const out = f.berths.filter((b) => !b.in_box).map((b) => b.terminal)
  console.log(`${f.berths.length} docks (${ANT_DOCKS_VERSION}) → ${DIR}/berths.json; outside the AIS box: ${out.join(', ') || 'none'}`)
} else if (cmd === 'import') {
  await importCalls()
} else { console.error('usage: dock-calls.mjs docks | import [--schema s] [--dry-run] [--post URL --month YYYY-MM]'); process.exitCode = 2 }

async function importCalls() {
  const meta = JSON.parse(await readFile(path.join(DIR, 'meta.json'), 'utf8'))
  const bj = JSON.parse(await readFile(path.join(DIR, 'berths.json'), 'utf8'))
  if (meta.bake_version !== DOCK_BAKE_VERSION || bj.bake_version !== DOCK_BAKE_VERSION) throw new Error(`bake version mismatch: meta ${meta.bake_version}, berths ${bj.bake_version}, code ${DOCK_BAKE_VERSION}`)
  if (bj.docks_version !== ANT_DOCKS_VERSION) throw new Error(`berths.json was written for docks ${bj.docks_version}, code has ${ANT_DOCKS_VERSION}: rerun "docks" and the scan`)
  const within = dockRadius()
  const calls = []
  const split = callSplitter((c) => calls.push(c), { ...DOCK_RULE })
  const rl = createInterface({ input: createReadStream(path.join(DIR, 'hits.csv')), crlfDelay: Infinity })
  let header = null, n = 0, kept = 0
  for await (const line of rl) {
    if (!header) { header = line.split(','); continue }
    const f = parseCsvLine(line)
    const r = Object.fromEntries(header.map((h, i) => [h, f[i]]))
    n++
    const m = Number(r.m)
    if (!within(r.terminal, m)) continue
    kept++
    split.push(r.terminal, r.mmsi, { t: Date.parse(r.t), m, berth: r.berth, also: null,
      name: r.name || null, imo: r.imo || null, type: r.type === '' ? null : Number(r.type), length: r.length === '' ? null : Number(r.length) })
  }
  split.end()
  const docksN = new Set(calls.map((c) => c.terminal)).size
  console.log(`${n.toLocaleString()} stopped positions within ${DOCK_RULE.collectM} m, ${kept.toLocaleString()} inside a dock radius → ${calls.length.toLocaleString()} calls at ${docksN} docks`)
  if (dry) { for (const c of calls.slice(0, 5)) console.log(JSON.stringify(c)); return }

  const bake = { rule: DOCK_RULE, input: meta.input, days: meta.days, months: meta.months, hits: n, baked_at: meta.baked_at,
    docks: ANT_DOCKS.map(({ key, ecology, lat, lon, radius_m }) => ({ key, ecology, lat, lon, radius_m })) }
  if (post) return postMonthRows({ kind: 'dock', month: postMonth, version: DOCK_BAKE_VERSION, bake, rows: calls })
  const pool = shipsPool()
  try {
    console.log(`dock calls → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
    await withTx(pool, async (c) => {
      await upsertSource(c, schema, DOCK_CALLS_SOURCE)
      const runId = await startRun(c, schema, DOCK_CALLS_SOURCE.id, { bake_version: DOCK_BAKE_VERSION, days: meta.days.length })
      const r = await storeDockCalls(c, schema, { calls, bake, runId })
      await finishRun(c, schema, runId, { status: 'succeeded', stats: { hits: n, kept, calls: calls.length, docks: docksN }, datasetVersion: DOCK_BAKE_VERSION })
      console.log(`stored ${r.calls} calls; bake record ${r.recordId}${r.recordCreated ? ' (new)' : ' (unchanged)'}`)
    })
  } finally { await pool.end() }
}

async function postMonthRows(body) {
  const r = await fetch(`${post}?op=importAisMonth`, { method: 'POST', body: JSON.stringify(body),
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json', 'user-agent': 'earthatlas-bake/1.0' } })
  const t = await r.text()
  if (!r.ok) throw new Error(`importAisMonth: HTTP ${r.status} ${t.slice(0, 300)}`)
  console.log(`posted: ${t.slice(0, 300)}`)
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
