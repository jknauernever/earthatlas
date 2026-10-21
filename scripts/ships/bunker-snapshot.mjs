#!/usr/bin/env node
/**
 * Build and store the bunkering report (lib/ships/bunkerMatch.js buildBunkerSnapshot; migration 040). Run after an AIS bunkering
 * bake (scripts/ships/bunker-events.mjs import) or an Ecology release (scripts/ships/import-ecology-ant.mjs); both call it at the end.
 *
 *   node --env-file=.env.local scripts/ships/bunker-snapshot.mjs [--schema s]
 */
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { buildBunkerSnapshot } from '../../lib/ships/bunkerMatch.js'

export async function snapshot(pool, schema) {
  const q = async (t, p) => (await pool.query(t, p)).rows
  const t0 = Date.now()
  const r = await buildBunkerSnapshot(q, schema)
  console.log(`bunkering report stored (snapshot ${r.id}, ${((Date.now() - t0) / 1000).toFixed(1)} s): ${r.matched} matched, ${r.notSeen} notified not seen, `
    + `${r.seenNoNotice} seen without a notice, ${r.counted} counted fuelings at all anchorages`)
  return r
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--schema')
  const pool = shipsPool()
  try { await snapshot(pool, i >= 0 ? args[i + 1] : DEFAULT_SCHEMA) } finally { await pool.end() }
}
