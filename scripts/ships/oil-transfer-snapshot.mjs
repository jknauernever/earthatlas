#!/usr/bin/env node
/**
 * Build and store the oil-transfer report (lib/ships/oilTransfers.js buildOilTransferSnapshot; migration 042). Run after the
 * bunkering snapshot (scripts/ships/bunker-snapshot.mjs), a terminal-call import or an Ecology release.
 *
 *   node --env-file=.env.local scripts/ships/oil-transfer-snapshot.mjs [--schema s]
 */
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { buildOilTransferSnapshot } from '../../lib/ships/oilTransfers.js'

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--schema')
  const pool = shipsPool()
  try {
    const q = async (t, p) => (await pool.query(t, p)).rows
    const t0 = Date.now()
    const r = await buildOilTransferSnapshot(q, i >= 0 ? args[i + 1] : DEFAULT_SCHEMA)
    console.log(`oil-transfer report stored (snapshot ${r.id}, ${((Date.now() - t0) / 1000).toFixed(1)} s): ${r.ops} operations, ${r.seen} seen, `
      + `${r.notSeen} not seen, ${r.cantCheck} can't be checked, ${r.small} small craft`)
  } finally { await pool.end() }
}
