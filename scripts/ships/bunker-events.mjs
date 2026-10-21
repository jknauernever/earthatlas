#!/usr/bin/env node
/**
 * Likely bunkering at anchorages from our own AIS positions (lib/ships/bunkerEvents.js; Josh 2026-10-18). Steps:
 *
 *   node --env-file=.env.local scripts/ships/anchorage-stays.mjs polygons      (once: the anchorage polygons both bakes use)
 *   cd scripts/ships/bake-ais && python3 bunker_events.py [--days YYYY-MM-DD ...] && python3 bunker_events.py --export
 *       → cache/bunker-events/events.json + meta.json
 *   node --env-file=.env.local scripts/ships/bunker-events.mjs import [--schema <name>] [--dry-run]
 *       → joins events cut at midnight (mergeAcrossDays) and stores them in <schema>.bunker_events with one bake record.
 *         Replaces the months it holds; only months with every day read are recorded as covered.
 */
import { readFile } from 'node:fs/promises'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { snapshot } from './bunker-snapshot.mjs'
import { upsertSource, startRun, finishRun } from '../../lib/ships/store.js'
import { BUNKER_BAKE_VERSION, BUNKER_RULE, BUNKER_EVENTS_SOURCE, mergeAcrossDays, storeBunkerEvents } from '../../lib/ships/bunkerEvents.js'

const DIR = 'scripts/ships/bake-ais/cache/bunker-events'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')
if (args[0] !== 'import') { console.error('usage: bunker-events.mjs import [--schema s] [--dry-run]'); process.exit(2) }

const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate() }
const meta = JSON.parse(await readFile(`${DIR}/meta.json`, 'utf8'))
if (meta.rule?.version !== BUNKER_BAKE_VERSION) throw new Error(`bake is ${meta.rule?.version}, code expects ${BUNKER_BAKE_VERSION}`)
const raw = JSON.parse(await readFile(`${DIR}/events.json`, 'utf8'))
const events = mergeAcrossDays(raw)
const aj = JSON.parse(await readFile('scripts/ships/bake-ais/cache/anchorage-stays/anchorages.json', 'utf8'))
const byMonth = new Map()
for (const d of meta.days) byMonth.set(d.slice(0, 7), (byMonth.get(d.slice(0, 7)) || 0) + 1)
const months = [...byMonth].filter(([m, n]) => n === daysIn(m)).map(([m]) => m).sort()
// Events are kept only in complete months (a part-read month would undercount and is never shown as counted).
const kept = events.filter((e) => months.includes(e.t0.slice(0, 7)))
console.log(`${raw.length} day-file events → ${events.length} after joining across midnight → ${kept.length} in complete months ${months.join(', ') || '(none)'}`)
if (dry) { for (const e of kept.slice(0, 5)) console.log(JSON.stringify(e)); process.exit(0) }

const pool = shipsPool()
try {
  const used = new Set(kept.map((e) => e.anchorage))
  const bake = { rule: { ...BUNKER_RULE, ...meta.rule }, input: meta.input, days: meta.days, months, baked_at: meta.baked_at,
    anchorages: aj.anchorages.filter((a) => used.has(a.key)).map(({ key, name, legal_status, source_id, source_key }) => {
      const [sid, ...rest] = key.split('|')
      return { key, name, legal_status, source_id: source_id || sid, source_key: source_key || rest.join('|') }
    }) }
  await withTx(pool, async (c) => {
    await upsertSource(c, schema, BUNKER_EVENTS_SOURCE)
    const runId = await startRun(c, schema, BUNKER_EVENTS_SOURCE.id, { bake_version: BUNKER_BAKE_VERSION, days: meta.days.length })
    const r = await storeBunkerEvents(c, schema, { events: kept, bake, runId, months })
    await finishRun(c, schema, runId, { status: 'succeeded', stats: { events: r.events, months: months.length }, datasetVersion: BUNKER_BAKE_VERSION })
    console.log(`stored ${r.events} likely bunkering events in "${schema}"; bake record ${r.recordId}`)
  })
  // The bunkering report is stored, not built per request (migration 040): rebuild it now that an input changed.
  try { await snapshot(pool, schema) } catch (e) { console.warn(`bunkering report not rebuilt: ${e.message}`) }
} finally { await pool.end() }
