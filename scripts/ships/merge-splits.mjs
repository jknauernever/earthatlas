#!/usr/bin/env node
/**
 * Merge vessel records split only by a placeholder call sign (lib/ships/mergeSplits.js; resolver v1.10, Josh 2026-10-19).
 * DEV database unless run through `zsh scripts/ships/prod.sh merge-splits` (backs up production first).
 *
 *   npm run ships:merge-splits -- --dry-run                 # list the pairs, write nothing
 *   npm run ships:merge-splits -- --vessel <id> [--vessel <id>]   # only pairs touching these records (prove it on one boat)
 *   npm run ships:merge-splits -- --limit 2                 # the first N pairs
 *   npm run ships:merge-splits                              # every pair (repeat until it finds none: chains settle a step per run)
 */
import { shipsPool, DEFAULT_SCHEMA, schemaIdent, withTx } from '../../lib/ships/db.js'
import { findPlaceholderSplits, mergeVessel } from '../../lib/ships/mergeSplits.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const all = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []))
const S = schemaIdent(opt('schema') || DEFAULT_SCHEMA)
const pool = shipsPool()
const q = async (t, p) => (await pool.query(t, p)).rows
const host = new URL(process.env.SHIPS_DATABASE_URL).host.split('.')[0]
try {
  const pairs = await findPlaceholderSplits(q, S, { limit: opt('limit') ? Number(opt('limit')) : null, vesselIds: all('vessel').length ? all('vessel') : null })
  console.log(`${pairs.length} pair(s) to merge → schema ${S} on ${host}${args.includes('--dry-run') ? ' (dry run)' : ''}`)
  const tally = { merged: 0, stillReview: 0, skipped: 0 }
  for (const p of pairs) {
    if (args.includes('--dry-run')) { console.log(`  ${p.merge.slice(0, 8)} (${p.merge_claims} claims) → ${p.keep.slice(0, 8)} (${p.keep_claims}) MMSI ${p.mmsi}`); continue }
    const r = await withTx(pool, (c) => mergeVessel(c, S, p))
    if (r.skipped) { tally.skipped++; continue }
    tally.merged++; if (r.keep_still_needs_review) tally.stillReview++
    if (pairs.length <= 20) console.log(`  merged ${p.merge.slice(0, 8)} → ${p.keep.slice(0, 8)} (MMSI ${p.mmsi}), ${r.links_moved} link(s) moved${r.keep_still_needs_review ? ', still needs review (other records)' : ''}`)
  }
  if (!args.includes('--dry-run')) console.log('done', tally)
} finally {
  await pool.end()
}
