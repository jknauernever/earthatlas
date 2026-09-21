/**
 * Pull BirdCast's georeferenced raster pyramid frames (see docs/BIRDCAST_DATA.md).
 *
 * Upstream publishes every 10-minute frame as a Zarr v2 web-mercator pyramid
 * (raster_<ts>.zarr, levels 0-5, 128px chunks, 4 float32 bands: mtr, vid, u, v).
 * Level 3 (1024x1024 global, ~30 km at 40N) matches the native cell size, and
 * CONUS falls entirely inside four chunks: 0.2.1 0.2.2 0.3.1 0.3.2.
 * This saves those four chunks untouched into
 *   scripts/bake-birdcast/raw/zarr-l3/YYYY/MM/DD/<ts>/<chunk>
 *
 * Resumable - a chunk already on disk is never requested again.
 *
 *   node scripts/bake-birdcast/fetch-zarr.mjs --days 30            # hourly frames
 *   node scripts/bake-birdcast/fetch-zarr.mjs --days 2 --step 10   # every frame
 */

import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const BUCKET = 'https://is-birdcast-observed-prod.s3.us-east-1.amazonaws.com'
export const LEVEL = 3
export const CHUNKS = ['0.2.1', '0.2.2', '0.3.1', '0.3.2']
export const RAW_ZARR_DIR = join(dirname(fileURLToPath(import.meta.url)), 'raw', `zarr-l${LEVEL}`)
const CONCURRENCY = 4 // be a polite guest on Cornell's bucket

export const stampOf = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12)
export const frameDir = (ms) => {
  const s = stampOf(ms)
  return join(RAW_ZARR_DIR, s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s)
}
const frameUrl = (ms, chunk) => {
  const s = stampOf(ms)
  return `${BUCKET}/zarr/${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)}/raster_${s}.zarr/${LEVEL}/values/${chunk}`
}

/** Fetch one frame's chunks. Returns 'cached' | 'fetched' | 'missing' (upstream has no such frame). */
export async function fetchFrame(ms) {
  const dir = frameDir(ms)
  if (CHUNKS.every((c) => existsSync(join(dir, c)))) return 'cached'
  mkdirSync(dir, { recursive: true })
  for (const chunk of CHUNKS) {
    const out = join(dir, chunk)
    if (existsSync(out)) continue
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(frameUrl(ms, chunk))
        if (res.status === 404 || res.status === 403) return 'missing'
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        writeFileSync(`${out}.part`, Buffer.from(await res.arrayBuffer()))
        renameSync(`${out}.part`, out)
        break
      } catch (err) {
        if (attempt >= 3) throw new Error(`${frameUrl(ms, chunk)}: ${err.message}`)
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    }
  }
  return 'fetched'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`)
    return i > 0 ? process.argv[i + 1] : dflt
  }
  const stepMs = Number(arg('step', 60)) * 60000
  const end = Math.floor(Date.now() / stepMs) * stepMs
  const start = end - Number(arg('days', 30)) * 86400000
  const times = []
  for (let t = start; t <= end; t += stepMs) times.push(t)

  const tally = { cached: 0, fetched: 0, missing: 0 }
  const missing = []
  let next = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < times.length) {
      const t = times[next++]
      const r = await fetchFrame(t)
      tally[r]++
      if (r === 'missing') missing.push(stampOf(t))
      if ((tally.cached + tally.fetched + tally.missing) % 100 === 0) console.log(`  ${next}/${times.length}…`)
    }
  }))
  console.log(`fetch-zarr: ${times.length} frames wanted - ${tally.fetched} fetched, ${tally.cached} cached, ${tally.missing} missing upstream`)
  if (missing.length) console.log(`  missing: ${missing.slice(0, 40).join(' ')}${missing.length > 40 ? ' …' : ''}`)
}
