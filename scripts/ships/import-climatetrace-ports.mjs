#!/usr/bin/env node
/**
 * Climate TRACE port sources (domestic + international shipping) → ships evidence, for the port cards' Emissions
 * tab (lib/ships/climateTrace.js). Reads the facility bake EarthAtlas already runs for /inmotion:
 * scripts/bake-climatetrace/build/features.geojsonl (+ public/dev-data/trace/trace-index.json for the release).
 * Idempotent: an unchanged source stores nothing new.
 *
 *   npm run ships:import-climatetrace-ports -- [--schema <name>] [--limit N] [--bbox W,S,E,N]
 *     --limit / --bbox  test on a few ports first (docs: test small, run big only on production)
 *     --make-ports      also make map ports for Climate TRACE locations with no WPI / GFW port within 10 km
 *                       (lib/ships/climateTrace.js makeCtPorts; limited to --bbox when given)
 */
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { upsertSource } from '../../lib/ships/store.js'
import { CLIMATE_TRACE_SOURCE, CT_SHIPPING_SUBS, ingestCtPorts, makeCtPorts } from '../../lib/ships/climateTrace.js'

const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const limit = Number(opt('limit')) || null
const bbox = opt('bbox')?.split(',').map(Number)
const FEATURES = 'scripts/bake-climatetrace/build/features.geojsonl'
const index = JSON.parse(await readFile('public/dev-data/trace/trace-index.json', 'utf8'))
const release = `${index.release} (${index.build})`

const wanted = []
const rl = createInterface({ input: createReadStream(FEATURES), crlfDelay: Infinity })
for await (const line of rl) {
  if (!CT_SHIPPING_SUBS.some((s) => line.includes(`"sub":"${s}"`))) continue
  const f = JSON.parse(line)
  const [lon, lat] = f.geometry.coordinates
  if (bbox && !(lon >= bbox[0] && lat >= bbox[1] && lon <= bbox[2] && lat <= bbox[3])) continue
  wanted.push(f)
  if (limit && wanted.length >= limit) break
}
console.log(`${wanted.length} Climate TRACE port sources (${release}) → schema "${schema}"`)
const pool = shipsPool()
try {
  await withTx(pool, (c) => upsertSource(c, schema, CLIMATE_TRACE_SOURCE))
  const t = { stored: 0, recordsCreated: 0, errors: [] }
  for (let i = 0; i < wanted.length; i += 1000) {
    const r = await withTx(pool, (c) => ingestCtPorts(c, schema, wanted.slice(i, i + 1000), { release, retrievalUrl: 'https://climatetrace.org/data' }))
    t.stored += r.stored; t.recordsCreated += r.recordsCreated; t.errors.push(...r.errors)
  }
  console.log(JSON.stringify({ ...t, errors: t.errors.slice(0, 5) }))
  if (args.includes('--make-ports')) console.log('map ports:', JSON.stringify(await withTx(pool, (c) => makeCtPorts(c, schema, { bbox }))))
} finally { await pool.end() }
