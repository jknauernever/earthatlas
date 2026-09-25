#!/usr/bin/env node
/**
 * Re-run identity resolution with the current resolver (lib/ships/reresolve.js).
 *   npm run ships:reresolve        # schema "ships" in the dev DB (.env.local)
 * Use after a resolver rule change; resolver-made vessel ids change.
 */
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { reresolveAll } from '../../lib/ships/reresolve.js'
import { RESOLVER } from '../../lib/ships/resolve.js'

const pool = shipsPool()
try {
  console.log(`re-resolving schema "${process.argv[2] || DEFAULT_SCHEMA}" with ${RESOLVER}`)
  console.log('done', await reresolveAll(pool, process.argv[2] || DEFAULT_SCHEMA, { log: console.log }))
} finally {
  await pool.end()
}
