/**
 * Ordered, recorded, additive migrations for the whales schema (same contract
 * as lib/ships/migrate.js). Each lib/whales/migrations/NNN_*.sql runs once, in
 * its own transaction, with {{S}} replaced by the schema name, and is recorded
 * in <schema>.schema_migrations. Re-running is a no-op.
 */
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { schemaIdent, withTx } from './db.js'

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

export async function migrate(pool, schema, log = () => {}) {
  const S = schemaIdent(schema)
  const client = await pool.connect()
  try {
    // PostGIS lives in public, shared by every schema in this database.
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis')
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${S}`)
    await client.query(`CREATE TABLE IF NOT EXISTS ${S}.schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
  } finally {
    client.release()
  }
  const files = (await readdir(DIR)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()
  const applied = []
  for (const f of files) {
    const sql = (await readFile(path.join(DIR, f), 'utf8')).replaceAll('{{S}}', S)
    const did = await withTx(pool, async (c) => {
      const { rows } = await c.query(`SELECT 1 FROM ${S}.schema_migrations WHERE name = $1`, [f])
      if (rows.length) return false
      await c.query(sql)
      await c.query(`INSERT INTO ${S}.schema_migrations (name) VALUES ($1)`, [f])
      return true
    })
    if (did) { applied.push(f); log(`applied ${f} → ${S}`) }
  }
  return applied
}
