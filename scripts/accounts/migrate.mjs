/**
 * Bring the accounts database (schema "auth") up to date with lib/accounts/auth.js.
 *
 *   node --env-file=.env.local scripts/accounts/migrate.mjs           # dry run: print the SQL
 *   node --env-file=.env.local scripts/accounts/migrate.mjs --apply   # apply it, and save the SQL
 *
 * Uses USERS_DATABASE_URL (.env.local = earthatlas-users-dev). Production is migrated once, at launch,
 * with the production URL passed in the environment for that one run.
 * Each applied Better Auth change is saved to lib/accounts/migrations/<UTC timestamp>.sql as the record of what ran.
 * Then our own tables: lib/accounts/sql/NNN_*.sql, each run once (recorded in auth.ea_migrations).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getMigrations } from 'better-auth/db/migration'
import { getAuth, usersPool } from '../../lib/accounts/auth.js'

const apply = process.argv.includes('--apply')
const host = new URL(process.env.USERS_DATABASE_URL).hostname.split('.')[0]
const auth = getAuth()
const { toBeCreated, toBeAdded, compileMigrations, runMigrations } = await getMigrations(auth.options, { throwOnUnsafe: true })
if (!toBeCreated.length && !toBeAdded.length) {
  console.log(`[${host}] schema is up to date`)
} else {
  const sql = await compileMigrations()
  console.log(`[${host}] pending: create ${toBeCreated.map((t) => t.table).join(', ') || '—'}; add columns to ${toBeAdded.map((t) => t.table).join(', ') || '—'}\n\n${sql}`)
  if (apply) {
    await runMigrations()
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../lib/accounts/migrations', `${stamp}.sql`)
    await writeFile(file, `-- applied to ${host} at ${new Date().toISOString()}\n${sql}\n`)
    console.log(`applied; saved ${path.relative(process.cwd(), file)}`)
  } else {
    console.log('\n(dry run — add --apply to run it)')
  }
}

// Our own tables (after Better Auth's, so schema "auth" exists).
const pool = usersPool()
const sqlDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../lib/accounts/sql')
const files = (await readdir(sqlDir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()
const { rows: hasTable } = await pool.query(`SELECT to_regclass('auth.ea_migrations') AS t`)
const done = new Set(hasTable[0].t ? (await pool.query('SELECT name FROM auth.ea_migrations')).rows.map((r) => r.name) : [])
const pending = files.filter((f) => !done.has(f))
if (!pending.length) console.log(`[${host}] our tables are up to date`)
for (const f of pending) {
  if (!apply) { console.log(`[${host}] pending: ${f}`); continue }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('CREATE TABLE IF NOT EXISTS auth.ea_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    await client.query(await readFile(path.join(sqlDir, f), 'utf8'))
    await client.query('INSERT INTO auth.ea_migrations (name) VALUES ($1)', [f])
    await client.query('COMMIT')
    console.log(`[${host}] applied ${f}`)
  } catch (e) {
    await client.query('ROLLBACK'); throw e
  } finally { client.release() }
}
await pool.end()
