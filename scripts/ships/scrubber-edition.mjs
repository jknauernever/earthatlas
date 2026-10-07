#!/usr/bin/env node
/**
 * Freeze the scrubber-ship calls report as a dated edition (lib/ships/scrubberReport.js createScrubberEdition; migration 029).
 * The edition is served at /ships/reports/scrubbers/<id> and never changes. DEV database unless run through prod.sh.
 *
 *   node --env-file=.env.local scripts/ships/scrubber-edition.mjs --id 2026-10 --from 2025-01 --to 2026-06 [--title "…"] [--schema s]
 *   node --env-file=.env.local scripts/ships/scrubber-edition.mjs --list
 */
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { createScrubberEdition, listScrubberEditions } from '../../lib/ships/scrubberReport.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const S = opt('schema') || DEFAULT_SCHEMA
const pool = shipsPool()
const q = async (t, a) => (await pool.query(t, a)).rows
try {
  if (args.includes('--list')) console.table(await listScrubberEditions(q, S))
  else {
    const r = await createScrubberEdition(q, S, { id: opt('id'), from: opt('from'), to: opt('to'), title: opt('title') || null })
    console.log(`edition ${r.id} created ${r.created_at.toISOString?.() || r.created_at} → /ships/reports/scrubbers/${r.id}`)
  }
} finally { await pool.end() }
