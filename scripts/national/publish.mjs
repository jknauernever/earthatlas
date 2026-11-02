#!/usr/bin/env node
/**
 * Publish one version of a national dataset to Vercel Blob and record it in the national catalog
 * (docs/NATIONAL_DATA.md). Every subsite finds national data through the catalog (src/lib/national/catalog.js), so a
 * new version goes live without a deploy.
 *
 *   node --env-file=.env.local scripts/national/publish.mjs <dataset> <version> [--check]
 *
 * Reads data/national/<dataset>/build/<version>/: every file there (subfolders included) is uploaded to
 * Blob `national/<dataset>/<version>/<path>`, never overwritten, long-cached; then dataset.json from that folder (name,
 * source, license, coverage, cadence, summary) becomes the dataset's catalog entry, with `version`, `published` and
 * `files` (path → URL) added. The catalog itself is rewritten with a 60 s cache. The three newest versions of each
 * dataset are kept; older ones are deleted.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { put, list, del } from '@vercel/blob'

const [dataset, version, flag] = process.argv.slice(2)
if (!/^[a-z0-9-]+$/.test(dataset || '') || !/^[\w.-]+$/.test(version || '')) throw new Error('usage: publish.mjs <dataset> <version> [--check]')
const check = flag === '--check'
if (!check && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing (use --env-file=.env.local)')
const DIR = join('data/national', dataset, 'build', version)
if (!existsSync(join(DIR, 'dataset.json'))) throw new Error(`missing ${join(DIR, 'dataset.json')}`)
const meta = JSON.parse(readFileSync(join(DIR, 'dataset.json')))
const BASE = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const TYPES = { '.json': 'application/json', '.geojson': 'application/geo+json', '.pmtiles': 'application/octet-stream', '.parquet': 'application/octet-stream', '.csv': 'text/csv' }

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name.startsWith('.') ? [] : e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
const files = walk(DIR).filter((f) => !f.endsWith('dataset.json'))
const total = files.reduce((n, f) => n + statSync(f).size, 0)
console.log(`${dataset} ${version}: ${files.length} files, ${(total / 1e6).toFixed(1)} MB`)
if (check) process.exit(0)

// Files of this version already on Blob are kept (a version never changes), so a publish can be re-run to re-register it.
const have = new Map()
let c0
do {
  const page = await list({ prefix: `national/${dataset}/${version}/`, cursor: c0, limit: 1000 })
  for (const b of page.blobs) have.set(b.pathname, b.url)
  c0 = page.cursor
} while (c0)
const urls = {}
for (const f of files) {
  const rel = relative(DIR, f)
  if (have.has(`national/${dataset}/${version}/${rel}`)) { urls[rel] = have.get(`national/${dataset}/${version}/${rel}`); continue }
  const size = statSync(f).size
  const { url } = await put(`national/${dataset}/${version}/${rel}`, size > 400e6 ? (await import('node:fs')).createReadStream(f) : readFileSync(f), {
    access: 'public', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 31536000,
    contentType: TYPES[extname(f)] || 'application/octet-stream', multipart: size > 20e6,
  })
  urls[rel] = url
}

// Catalog. Each version's entry is its own file, never overwritten (national/<dataset>/<version>/_entry.json); the
// catalog is rebuilt from the Blob listing of those entries, newest version of each dataset. (Reading the catalog back
// would not work: Blob's edge serves an overwritten file's old copy for up to a minute, so back-to-back publishes would
// drop each other's entries.)
const entry = { ...meta, id: dataset, version, published: new Date().toISOString(), base: `${BASE}/national/${dataset}/${version}/`, files: urls }
if (!have.has(`national/${dataset}/${version}/_entry.json`)) {
  await put(`national/${dataset}/${version}/_entry.json`, JSON.stringify(entry), {
    access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 31536000,
  })
}
const entries = []
let c1
do {
  const page = await list({ prefix: 'national/', cursor: c1, limit: 1000 })
  for (const b of page.blobs) if (b.pathname.endsWith('/_entry.json')) entries.push(b)
  c1 = page.cursor
} while (c1)
const datasets = {}
for (const b of entries.sort((a, b) => a.pathname.localeCompare(b.pathname))) {
  const e = b.pathname === `national/${dataset}/${version}/_entry.json` ? entry : await fetch(b.url).then((r) => r.json())
  const cur = datasets[e.id]
  if (!cur || e.version > cur.version) datasets[e.id] = e
}
const catalog = { about: 'EarthAtlas national datasets (docs/NATIONAL_DATA.md)', updated: new Date().toISOString(), datasets }
await put('national/catalog.json', JSON.stringify(catalog, null, 1), {
  access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', cacheControlMaxAge: 60,
})
console.log(`catalog → ${dataset} ${version} (${Object.keys(datasets).join(', ')})`)

// Keep the three newest versions.
const versions = new Map()
let cursor
do {
  const page = await list({ prefix: `national/${dataset}/`, cursor, limit: 1000 })
  for (const b of page.blobs) {
    const v = b.pathname.split('/')[2]
    if (v) (versions.get(v) || versions.set(v, []).get(v)).push(b.url)
  }
  cursor = page.cursor
} while (cursor)
const old = [...versions.keys()].sort().reverse().slice(3)
for (const v of old) await del(versions.get(v))
if (old.length) console.log(`deleted old versions: ${old.join(', ')}`)
