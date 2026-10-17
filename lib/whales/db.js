/**
 * Whale-sightings database access: the Neon database `earthatlas-whales` in
 * WHALES_DATABASE_URL. There is no separate dev database (Josh 2026-10-17):
 * localhost uses the same database, and tests write only to throwaway
 * `whales_t_<random>` schemas, never to "whales".
 *
 * - `whalesHttp()`: stateless HTTP queries, for read-only API calls.
 * - `whalesPool()`: websocket sessions, for migrations, ingest and transactions.
 *
 * All SQL is schema-qualified through `S`, the validated schema identifier.
 */
import { neon, Pool, neonConfig } from '@neondatabase/serverless'

if (typeof globalThis.WebSocket === 'function' && !neonConfig.webSocketConstructor) {
  neonConfig.webSocketConstructor = globalThis.WebSocket
}

export const DEFAULT_SCHEMA = 'whales'

export function schemaIdent(name = DEFAULT_SCHEMA) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`invalid schema name: ${name}`)
  return name
}

function connString() {
  const url = process.env.WHALES_DATABASE_URL
  if (!url) throw new Error('WHALES_DATABASE_URL not set')
  return url
}

let http = null
export function whalesHttp() {
  if (!http) http = neon(connString())
  return http
}

export function whalesPool() {
  const pool = new Pool({ connectionString: connString(), max: 4 })
  pool.on('error', (e) => console.warn(`whales pool: idle client dropped (${e.message}); reconnecting on next use`))
  return pool
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
