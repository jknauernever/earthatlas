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
  const pool = new Pool({ connectionString: connString(), max: 4 })
  // Neon closes idle/long-lived websocket sessions. Without this listener the
  // pool re-throws that as an uncaught error and kills a multi-hour import
  // (happened 2026-09-25 at 3,940/7,890). The pool reconnects on next use.
  pool.on('error', (e) => console.warn(`ships pool: idle client dropped (${e.message}); reconnecting on next use`))
  return pool
}

const TRANSIENT = /Connection terminated|ECONNRESET|ETIMEDOUT|socket hang up|WebSocket|terminating connection|Client has encountered a connection error/i

/**
 * Retry fn on transient connection errors. Safe for our per-record
 * transactions, which are idempotent: a retry after a dropped commit either
 * redoes the work or finds it already there.
 */
export async function withRetry(fn, { attempts = 4, log = console.warn } = {}) {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i >= attempts || !TRANSIENT.test(String(e?.message || e))) throw e
      const wait = 2000 * 2 ** (i - 1)
      log(`  transient DB error (${String(e.message).slice(0, 80)}); retry ${i}/${attempts - 1} in ${wait / 1000}s`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
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
