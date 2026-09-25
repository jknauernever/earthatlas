#!/usr/bin/env node
/**
 * Re-run identity resolution with the current resolver (lib/ships/reresolve.js).
 *   npm run ships:reresolve        # schema "ships" in the dev DB (.env.local)
 *   npm run ships:reresolve -- --source wikidata   # only that (attach-only) source's links
 * Use after a resolver rule change; resolver-made vessel ids change.
 */
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { reresolveAll, reresolveSource } from '../../lib/ships/reresolve.js'
import { RESOLVER } from '../../lib/ships/resolve.js'

const args = process.argv.slice(2)
const si = args.indexOf('--source')
const source = si >= 0 ? args[si + 1] : null
const schema = args.filter((a, i) => !a.startsWith('--') && (si < 0 || i !== si + 1))[0] || DEFAULT_SCHEMA
const pool = shipsPool()
try {
  console.log(`re-resolving schema "${schema}"${source ? ` (source ${source} only)` : ''} with ${RESOLVER}`)
  const stats = source ? await reresolveSource(pool, schema, source, { log: console.log })
    : await reresolveAll(pool, schema, { log: console.log })
  console.log('done', stats)
} finally {
  await pool.end()
}
