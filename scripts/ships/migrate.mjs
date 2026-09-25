#!/usr/bin/env node
/**
 * Apply /ships schema migrations to the database in SHIPS_DATABASE_URL.
 *   npm run ships:migrate                  # schema "ships" in the dev DB (.env.local)
 * Production needs Josh's go-ahead: run with the prod SHIPS_DATABASE_URL in the environment.
 */
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { migrate } from '../../lib/ships/migrate.js'

const schema = process.argv[2] || DEFAULT_SCHEMA
const pool = shipsPool()
try {
  const host = new URL(process.env.SHIPS_DATABASE_URL).host
  console.log(`migrating schema "${schema}" on ${host}`)
  const applied = await migrate(pool, schema, console.log)
  console.log(applied.length ? `done: ${applied.length} applied` : 'up to date')
} finally {
  await pool.end()
}
