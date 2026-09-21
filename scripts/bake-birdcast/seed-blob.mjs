/**
 * One-time production seed for the bird-migration layer: bakes the last N
 * days of the `birds` tape and the live grid straight to Vercel Blob.
 *
 * Why not `bake-systems-tape.mjs birds 31`? A BirdCast day bakes in well under
 * a second, and that runner re-reads the tape index from the CDN before every
 * day — the CDN serves it for up to a minute, so rapid merges read a stale
 * index and drop each other's frames (SYSTEMS-NOTES "2026-08-21 lesson").
 * Here the index is carried in memory across all days and written ONCE.
 * After this, api/cron/birdcast.js keeps it current.
 *
 *   set -a; source .env.blob.local; set +a
 *   node scripts/bake-birdcast/seed-blob.mjs [days=31]
 */

import { put } from '@vercel/blob'
import { SYSTEMS_DATASETS, SYSTEMS_TAPES, bakeTape, BLOB_PUBLIC_BASE } from '../../api/_systems-datasets.js'

if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error('seed-blob: BLOB_READ_WRITE_TOKEN is not set'); process.exit(1) }
const nDays = Number(process.argv[2] || 31)
const opts = (contentType, maxAge) => ({ access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: maxAge })
const entry = SYSTEMS_TAPES.birds

let existing = null
try {
  const r = await fetch(`${BLOB_PUBLIC_BASE}/${entry.blobBase}-tape.json?nocache=${Date.now()}`, { cache: 'no-store' })
  if (r.ok) existing = await r.json()
} catch { /* first seed */ }
console.log(`seed-blob: ${existing ? existing.frames.length : 0} frames already on the production tape`)

const days = []
for (let i = nDays - 1; i >= 0; i--) days.push(new Date(Date.now() - 3.6e6 - i * 8.64e7).toISOString().slice(0, 10))
let uploaded = 0, bytes = 0
for (const day of days) {
  try {
    const result = await bakeTape('birds', { day, existing })
    if (result.unchanged) { console.log(`  ${day}: already on tape`); continue }
    // 8 uploads at a time — hundreds of ~14 KB frames.
    for (let i = 0; i < result.binaries.length; i += 8) {
      await Promise.all(result.binaries.slice(i, i + 8).map((b) => put(b.path, b.buffer, opts(b.contentType, 31536000))))
    }
    uploaded += result.binaries.length
    bytes += result.binaries.reduce((s, b) => s + b.buffer.length, 0)
    existing = result.jsons[0].json
    console.log(`  ${day}: +${result.added} frames (${existing.frames.length} on tape)`)
  } catch (err) {
    console.error(`  ${day}: FAILED — ${String(err).slice(0, 160)}`)
    process.exitCode = 1
  }
}
if (uploaded) {
  await put(`${entry.blobBase}-tape.json`, JSON.stringify(existing), opts('application/json', 60))
  console.log(`seed-blob: tape index written — ${existing.frames.length} frames, ${uploaded} uploaded (${(bytes / 1e6).toFixed(1)} MB)`)
}

const grid = SYSTEMS_DATASETS.birds
const { meta, gridBuffer } = await grid.fetchGrid()
await put(`${grid.blobBase}-grid.bin`, gridBuffer, opts('application/octet-stream', 300))
await put(`${grid.blobBase}-meta.json`, JSON.stringify(meta), opts('application/json', 300))
console.log(`seed-blob: live grid written — valid ${new Date(meta.valid_ms).toISOString()}`)
