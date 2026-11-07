#!/usr/bin/env node
/**
 * Publish the baked /spillrisk scenarios (public/spillrisk-data, ~32 MB, 21 files) to Vercel Blob `spillrisk/<stamp>/`.
 * Files are written once under the stamp and never overwritten (one-year cache). In production the page reads
 * `${BLOB}/spillrisk/<stamp>/` (DATA_STAMP in src/spillrisk/SpillriskApp.jsx), so a re-bake goes live by uploading
 * under a new stamp and changing DATA_STAMP. Localhost reads /spillrisk-data/ from public/.
 *
 *   node --env-file=.env.local scripts/spillrisk/upload.mjs <stamp>           e.g. 20261106
 *   node --env-file=.env.local scripts/spillrisk/upload.mjs <stamp> --check   (list what would be uploaded)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { put } from '@vercel/blob'

const [stamp, flag] = process.argv.slice(2)
if (!stamp || !/^[\w.-]+$/.test(stamp)) throw new Error('usage: upload.mjs <stamp> [--check]')
const check = flag === '--check'
if (!check && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('BLOB_READ_WRITE_TOKEN missing (use --env-file=.env.local)')
const DIR = 'public/spillrisk-data'
const BASE = 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'

const index = JSON.parse(readFileSync(join(DIR, 'scenarios.json')))
const files = ['scenarios.json', ...index.scenarios.map((id) => `${id}.json`)]
for (const f of files) statSync(join(DIR, f))   // throws if a listed scenario is missing
const extra = readdirSync(DIR).filter((f) => f.endsWith('.json') && !files.includes(f))
if (extra.length) console.log('not listed in scenarios.json, skipped:', extra.join(', '))
const total = files.reduce((n, f) => n + statSync(join(DIR, f)).size, 0)
console.log(`${files.length} files, ${(total / 1e6).toFixed(1)} MB → ${BASE}/spillrisk/${stamp}/`)
if (check) process.exit(0)

for (const f of files) {
  const { url } = await put(`spillrisk/${stamp}/${f}`, readFileSync(join(DIR, f)), {
    access: 'public', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 31536000,
  })
  console.log(' ', url)
}
console.log('done')
