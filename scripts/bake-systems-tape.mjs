/**
 * Local/backfill runner for the /systems history tapes (SYSTEMS_TAPES /
 * bakeTape in api/_systems-datasets.js).
 *
 *   node scripts/bake-systems-tape.mjs <name>            # newest published day
 *   node scripts/bake-systems-tape.mjs <name> 7          # backfill the last 7 days
 *   node scripts/bake-systems-tape.mjs <name> 2026-08-14 # one specific UTC day
 *
 * <name> ∈ aerosol | airtemp | sst | sstanom | waves.
 * With BLOB_READ_WRITE_TOKEN set, writes to Vercel Blob (merging into the live
 * index) exactly like the cron; without it, writes public/dev-data/systems/.
 * aerosol: one ADS job per day (~40–90 s); the others are one upstream pull
 * per day. Idempotent (days already on tape are skipped). Upstream archive
 * depth caps a backfill: GFS (airtemp) ≈ 7 days, CRW and WW3 go back years.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEMS_TAPES, bakeTape, BLOB_PUBLIC_BASE } from '../api/_systems-datasets.js'
const __dirname = dirname(fileURLToPath(import.meta.url))
const ds = process.argv[2]
const arg = process.argv[3]
if (!SYSTEMS_TAPES[ds]) { console.error(`bake-systems-tape: no tape for "${ds}" (have: ${Object.keys(SYSTEMS_TAPES).join(', ')})`); process.exit(1) }
const entry = SYSTEMS_TAPES[ds]
const outDir = join(__dirname, '..', 'public', 'dev-data', 'systems')
const base = basename(entry.blobBase)
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN

let days
if (!arg) days = [undefined]
else if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) days = [arg]
else {
  const n = Number(arg)
  days = []
  const latencyMs = (entry.tape.latencyH ?? 3) * 3.6e6 // newest day whose frames are published
  for (let i = n - 1; i >= 0; i--) days.push(new Date(Date.now() - latencyMs - i * 8.64e7).toISOString().slice(0, 10))
  // Weekly tapes only have frames on their anchor weekday — skip the rest quietly.
  days = days.filter((d) => entry.tape.expectedTimes(d, Date.now()).length > 0)
}

async function readIndex() {
  if (useBlob) {
    try { const r = await fetch(`${BLOB_PUBLIC_BASE}/${entry.blobBase}-tape.json`, { cache: 'no-store' }); if (r.ok) return await r.json() } catch { /* none */ }
    return null
  }
  const p = join(outDir, `${base}-tape.json`)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

for (const day of days) {
  try {
    const existing = await readIndex()
    const t0 = Date.now()
    const result = await bakeTape(ds, { day, existing })
    if (result.unchanged) { console.log(`tape[${ds}] ${result.day}: already on tape`); continue }
    if (useBlob) {
      const { put } = await import('@vercel/blob')
      const opts = (contentType, maxAge) => ({ access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType, cacheControlMaxAge: maxAge })
      for (const b of result.binaries) await put(b.path, b.buffer, opts(b.contentType, 31536000))
      for (const f of result.jsons) await put(f.path, JSON.stringify(f.json), opts('application/json', 300))
    } else {
      mkdirSync(join(outDir, `${base}-tape`), { recursive: true })
      for (const b of result.binaries) writeFileSync(join(outDir, `${base}-tape`, basename(b.path)), b.buffer)
      for (const f of result.jsons) writeFileSync(join(outDir, basename(f.path)), JSON.stringify(f.json))
    }
    const kb = Math.round(result.binaries.reduce((s, b) => s + b.buffer.length, 0) / 1024)
    console.log(`tape[${ds}] ${result.day}: +${result.added} frames (${kb} KB), ${result.jsons[0].json.frames.length} on tape, ${Math.round((Date.now() - t0) / 1000)} s`)
  } catch (err) {
    console.error(`tape[${ds}] ${day || 'latest'}: FAILED — ${err}`)
    process.exitCode = 1
  }
}
