#!/usr/bin/env node
/**
 * Climate TRACE port stays → our terminals (lib/ships/ctStays.js; Josh 2026-09-29). Input: the voyage bake's
 * scripts/ships/bake-ct-voyages/build/ct-stays-<v>.ndjson + manifest.json (node scripts/ships/bake-ct-voyages/bake.mjs first).
 *
 *   node --env-file=.env.local scripts/ships/import-ct-stays.mjs [--dry-run] [--schema <name>] [--terminals key1,key2]
 *
 * Reads every active berth of every listed terminal from the database it writes to, matches every stay (ctStays.js rule),
 * prints the counts per terminal and the ambiguous positions, then stores the bake record and this version's rows in one
 * transaction (DEV DB unless Josh says otherwise). --terminals writes only those terminals' rows (a small proving import; the site shows a
 * partial bake only where no complete one exists, ctStays.js currentCtStaysBake);
 * the bake record still carries the full summary. Idempotent per CT_STAYS_VERSION.
 */
import { readFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun, upsertSource } from '../../lib/ships/store.js'
import { allBerths } from '../../lib/ships/terminals.js'
import { CT_STAYS_VERSION, CT_VOYAGES_SOURCE, CT_PULL_BOX, planCtStays, notCoveredTerminals, storeCtStays } from '../../lib/ships/ctStays.js'

const DIR = 'scripts/ships/bake-ct-voyages/build'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')
const only = opt('terminals') ? opt('terminals').split(',').map((s) => s.trim()).filter(Boolean) : null
const fileVersion = CT_STAYS_VERSION.replace(/^ct-stays-/, '')

const pool = shipsPool()
const q = async (text, params) => (await pool.query(text, params)).rows
try {
  const host = new URL(process.env.SHIPS_DATABASE_URL).host
  console.log(`Climate TRACE stays ${CT_STAYS_VERSION} → schema "${schema}" on ${host}${dry ? ' (dry run)' : ''}${only ? ` (rows for ${only.join(', ')} only)` : ''}`)
  const manifest = JSON.parse(await readFile(`${DIR}/manifest.json`, 'utf8'))
  if (manifest.version !== `ct-voyages-${fileVersion}`) throw new Error(`manifest is ${manifest.version}, code expects ct-voyages-${fileVersion}`)
  const stays = (await readFile(`${DIR}/ct-stays-${fileVersion}.ndjson`, 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
  const berths = await allBerths(q, schema)
  const { matched, summary } = planCtStays(stays, berths)
  const notCovered = notCoveredTerminals(berths)
  console.log(`${summary.stays.toLocaleString()} stays → ${summary.matched.toLocaleString()} matched at ${Object.keys(summary.byTerminal).length} terminals; `
    + `${summary.ambiguous} ambiguous, ${summary.disagree} positions disagree, ${summary.none.toLocaleString()} not near a terminal`)
  for (const [k, v] of Object.entries(summary.byTerminal).sort()) console.log(`  ${k.padEnd(28)} ${String(v.stays).padStart(6)} stays  ${v.co2e.toLocaleString()} t CO2e`)
  console.log(`not covered by the pull (no berth inside ${CT_PULL_BOX.join(', ')}): ${notCovered.length} terminals`)
  console.log(`review (${summary.review.length} positions, biggest first):`)
  for (const r of summary.review.slice(0, 10)) console.log(`  ${r.status} ${JSON.stringify(r.at)} ${r.port}: ${r.terminals.join(' / ')} (${r.stays} stays, ${r.co2e} t)`)
  if (only) { const bad = only.filter((k) => !berths.some((b) => b.terminal === k)); if (bad.length) throw new Error(`unknown terminal(s): ${bad.join(', ')}`) }
  if (dry) process.exit(0)
  const bake = { release: manifest.release, pulled: manifest.pulled, area: manifest.area, pullBox: CT_PULL_BOX, startDates: manifest.startDates,
    input: manifest.input, notCovered, berths: berths.map(({ terminal, key, lat, lon }) => ({ terminal, berth: key, lat, lon })) }
  await withTx(pool, async (c) => {
    await upsertSource(c, schema, CT_VOYAGES_SOURCE)
    const runId = await startRun(c, schema, CT_VOYAGES_SOURCE.id, { bake_version: CT_STAYS_VERSION, only })
    const r = await storeCtStays(c, schema, { matched, summary, bake, runId, only })
    await finishRun(c, schema, runId, { status: 'succeeded', stats: { stays: summary.stays, matched: summary.matched, written: r.rows }, datasetVersion: CT_STAYS_VERSION })
    console.log(`stored ${r.rows} rows; bake record ${r.recordId}${r.recordCreated ? ' (new)' : ' (unchanged)'}`)
  })
} finally { await pool.end() }
