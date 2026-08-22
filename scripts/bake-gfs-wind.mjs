/**
 * Local runner for the GFS wind bake (see api/_gfs-wind-core.js).
 *
 * With BLOB_READ_WRITE_TOKEN in the environment it writes to Vercel Blob
 * exactly like the cron. Without it, it writes the pair to
 * public/dev-data/systems/ (gitignored) so `npm run dev` / localhost QA has
 * real live wind data — the client falls back to that path when the Blob
 * copy isn't reachable.
 *
 *   node scripts/bake-gfs-wind.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchWindGrid, BLOB_META_PATH, BLOB_GRID_PATH } from '../api/_gfs-wind-core.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const { meta, gridBuffer } = await fetchWindGrid()
const stamp = `run ${new Date(meta.run_ms).toISOString()} · valid ${new Date(meta.valid_ms).toISOString()} · ${gridBuffer.length} bytes`

if (process.env.BLOB_READ_WRITE_TOKEN) {
  const { put } = await import('@vercel/blob')
  const putOpts = (contentType) => ({
    access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: 300,
  })
  await put(BLOB_GRID_PATH, gridBuffer, putOpts('application/octet-stream'))
  const res = await put(BLOB_META_PATH, JSON.stringify(meta), putOpts('application/json'))
  console.log(`bake-gfs-wind: uploaded to Blob (${res.url}) — ${stamp}`)
} else {
  const outDir = join(__dirname, '..', 'public', 'dev-data', 'systems')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'gfs-wind-grid.bin'), gridBuffer)
  writeFileSync(join(outDir, 'gfs-wind-meta.json'), JSON.stringify(meta))
  console.log(`bake-gfs-wind: no BLOB_READ_WRITE_TOKEN — wrote public/dev-data/systems/ for local dev — ${stamp}`)
}
