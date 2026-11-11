/**
 * Step 3 of the Open Waters archive backfill: scripts/ships/bake-ais/cache/owarchive/{points/*.parquet, index.json} → Blob
 * ships/bake-inputs/salish-v6/owarchive/ (index last), where scripts/ships/bake-ais/fetch_owarchive_points.py reads them in the
 * ships-aisstream-month workflow. A separate prefix from the recorder's own days (…/aisstream/), so the two never write the same
 * file. Uses BLOB_READ_WRITE_TOKEN (.env.local). --dry-run lists what it would upload.
 *   node --env-file=.env.local scripts/ships/aisstream/owarchive-upload.mjs [--dry-run]
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { put } from '@vercel/blob'

const DIR = 'scripts/ships/bake-ais/cache/owarchive/points'
const PREFIX = 'ships/bake-inputs/salish-v6/owarchive'
const dry = process.argv.includes('--dry-run')
const token = process.env.BLOB_READ_WRITE_TOKEN
if (!dry && !token) throw new Error('BLOB_READ_WRITE_TOKEN missing')
const days = (await readdir(DIR)).filter((f) => /^\d{4}-\d{2}-\d{2}\.parquet$/.test(f)).sort()
let bytes = 0
for (const f of days) {
  const size = (await stat(`${DIR}/${f}`)).size; bytes += size
  if (dry) continue
  await put(`${PREFIX}/points/${f}`, await readFile(`${DIR}/${f}`), { access: 'public', token, contentType: 'application/vnd.apache.parquet', addRandomSuffix: false, allowOverwrite: true })
}
if (!dry) await put(`${PREFIX}/index.json`, await readFile('scripts/ships/bake-ais/cache/owarchive/index.json'), { access: 'public', token, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 })
console.log(`${dry ? 'would upload' : 'uploaded'} ${days.length} days (${(bytes / 1e6).toFixed(1)} MB) + index.json → ${PREFIX}/`)
