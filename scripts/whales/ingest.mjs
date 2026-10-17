#!/usr/bin/env node
/**
 * Run whale feeds by hand (localhost proving, backfills).
 *
 *   node --env-file=.env.local scripts/whales/ingest.mjs --feed maplify --from 2026-10-15 --to 2026-10-15 \
 *        --schema whales_t_proof --limit 2 [--drop]
 *
 * --schema  defaults to a fresh throwaway whales_t_<random>. Writing to "whales"
 *           (the real schema) needs --schema whales explicitly.
 * --limit   keep only the first N records (proving); disables removal.
 * --feed    salishsea | maplify | happywhale | inaturalist | obis | all (live feeds)
 * --drop    drop the schema afterwards.
 */
import { randomBytes } from 'node:crypto'
import { whalesPool, schemaIdent } from '../../lib/whales/db.js'
import { migrate } from '../../lib/whales/migrate.js'
import { runFeed, LIVE_FEEDS } from '../../lib/whales/ingest.js'

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return acc
}, []))

const S = schemaIdent(args.schema || `whales_t_${randomBytes(4).toString('hex')}`)
const feeds = args.feed === 'all' || !args.feed ? LIVE_FEEDS : String(args.feed).split(',')
const from = args.from
const to = args.to || args.from
if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
  console.error('need --from YYYY-MM-DD [--to YYYY-MM-DD]')
  process.exit(2)
}
const limit = args.limit ? parseInt(args.limit, 10) : undefined

const pool = whalesPool()
try {
  await migrate(pool, S, console.log)
  for (const feed of feeds) {
    console.log(`→ ${feed} ${from}…${to} into ${S}${limit ? ` (first ${limit})` : ''}`)
    const r = await runFeed(pool, S, feed, from, to, { mode: 'manual', limit, log: console.log })
    console.log(`  ${JSON.stringify(r)}`)
  }
  const { rows } = await pool.query(
    `SELECT key, origin, via, kind, s.animal_group, t.scientific_name, observed_date, round(lat::numeric,3) lat, round(lon::numeric,3) lon,
            channel, observer, license, quality, left(url, 60) url
     FROM ${S}.sightings s LEFT JOIN ${S}.taxa t USING (inat_id) ORDER BY origin, key LIMIT 50`,
  )
  console.table(rows)
} finally {
  if (args.drop) { await pool.query(`DROP SCHEMA ${S} CASCADE`); console.log(`dropped ${S}`) }
  await pool.end()
}
