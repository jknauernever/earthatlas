#!/usr/bin/env node
/**
 * Upload the SPUN underground-fungi bake (bake.py grids + tiles.py pyramids)
 * from public/dev-data/systems to Vercel Blob `systems/`, where production
 * reads them (windField.js grids, api/spun-tiles.js pyramids).
 *
 * Order matters, as in every /systems publish: binaries before the JSON that
 * points at them, and spun-tiles.json (the tiles index) last. A static
 * research product, so a short CDN max-age just keeps re-bakes from going stale.
 *
 * Usage: node --env-file=.env.blob.local scripts/bake-spun/upload.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { put } from '@vercel/blob'

const DIR = 'public/dev-data/systems'
if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing (use --env-file=.env.blob.local)')

const files = readdirSync(DIR).filter((f) => f.startsWith('spun-'))
const rank = (f) => (f === 'spun-tiles.json' ? 3 : f.endsWith('-meta.json') ? 2 : 1)
files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
const type = (f) => (f.endsWith('.json') ? 'application/json' : 'application/octet-stream')

let bytes = 0
for (const f of files) {
  const size = statSync(join(DIR, f)).size
  const t0 = Date.now()
  await put(`systems/${f}`, readFileSync(join(DIR, f)), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true,
    contentType: type(f), cacheControlMaxAge: 3600, multipart: size > 20e6,
  })
  bytes += size
  console.log(`${f.padEnd(34)} ${(size / 1e6).toFixed(1).padStart(6)} MB  ${((Date.now() - t0) / 1000).toFixed(1)} s`)
}
console.log(`uploaded ${files.length} files, ${(bytes / 1e6).toFixed(0)} MB`)
