#!/usr/bin/env node
/**
 * Export the MMSI → type-over-time lookup for the track bake (lib/ships/typeLookup.js).
 *   node --env-file=.env.local scripts/ships/export-type-lookup.mjs [--out path] [--schema ships]
 * Default output: scripts/ships/bake-ais/build/type-lookup.json (gitignored). Read-only on the DB.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { shipsPool, DEFAULT_SCHEMA } from '../../lib/ships/db.js'
import { typeLookup } from '../../lib/ships/typeLookup.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const out = opt('out') || path.join(path.dirname(fileURLToPath(import.meta.url)), 'bake-ais', 'build', 'type-lookup.json')

const pool = shipsPool()
try {
  const q = async (t, p) => (await pool.query(t, p)).rows
  const data = await typeLookup(q, schema)
  await mkdir(path.dirname(out), { recursive: true })
  const json = JSON.stringify(data)
  await writeFile(out, json)
  console.log(`wrote ${out} (${(json.length / 1024).toFixed(0)} KB)`, data.meta.stats)
} finally {
  await pool.end()
}
