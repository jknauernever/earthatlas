/**
 * /ships database access: the separate Neon database in SHIPS_DATABASE_URL
 * (dev: earthatlas-ships-dev via .env.local; prod: earthatlas-ships via Vercel).
 * The news database (DATABASE_URL) is never touched here.
 *
 * - `shipsHttp()`: stateless HTTP queries, for the read-only API.
 * - `shipsPool()`: websocket sessions, for migrations, imports and
 *   transactions (scripts and tests only).
 *
 * All SQL is schema-qualified through `S`, the validated schema identifier:
 * "ships" normally, "ships_t_<random>" inside tests.
 */
import { neon, Pool, neonConfig } from '@neondatabase/serverless'

if (typeof globalThis.WebSocket === 'function' && !neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = globalThis.WebSocket
}

export const DEFAULT_SCHEMA = 'ships'

export function schemaIdent(name = DEFAULT_SCHEMA) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`invalid schema name: ${name}`)
  return name
}

function connString() {
  const url = process.env.SHIPS_DATABASE_URL
  if (!url) throw new Error('SHIPS_DATABASE_URL not set')
  return url
}

let http = null
export function shipsHttp() {
  if (!http) http = neon(connString())
  return http
}

export function shipsPool() {
  return new Pool({ connectionString: connString(), max: 4 })
}

/** Run fn(client) inside one transaction on a pooled session. */
export async function withTx(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
