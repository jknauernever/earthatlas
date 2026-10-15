#!/usr/bin/env node
/**
 * Record the oil slick + offshore facility sources in ships.sources (licence, attribution, notes): SkyTruth Cerulean
 * (read live, nothing else stored) and the offshore registers (baked to Blob). Idempotent (upsert by id).
 *   node --env-file=.env.local scripts/ships/register-sources.mjs [--schema <name>]     (production: zsh scripts/ships/prod.sh register-sources)
 */
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { upsertSource } from '../../lib/ships/store.js'
import { CERULEAN_SOURCE } from '../../lib/ships/cerulean.js'
import { OFFSHORE_SOURCE_ROWS } from '../../lib/ships/offshoreFacilities.js'

const i = process.argv.indexOf('--schema')
const S = i >= 0 ? process.argv[i + 1] : DEFAULT_SCHEMA
const pool = shipsPool()
const rows = [CERULEAN_SOURCE, ...OFFSHORE_SOURCE_ROWS]
await withTx(pool, async (c) => { for (const r of rows) await upsertSource(c, S, r) })
const { rows: got } = await pool.query(`SELECT id, license FROM ${S}.sources WHERE id = ANY($1) ORDER BY id`, [rows.map((r) => r.id)])
console.log(`schema ${S}:`, got.map((r) => r.id).join(', '))
await pool.end()
