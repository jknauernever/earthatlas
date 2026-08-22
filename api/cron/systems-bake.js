/**
 * Generic /systems dataset cron — bakes one registry dataset per invocation
 * (`?ds=currents|sst|waves`; see api/_systems-datasets.js and vercel.json's
 * per-dataset schedules). Same shape as api/cron/gfs-wind.js: Node runtime,
 * CRON_SECRET guard, failed pulls are skipped (never overwrite a good
 * snapshot), grid written before meta so the pair is always consistent.
 */

import { put } from '@vercel/blob'
import { SYSTEMS_DATASETS, SYSTEMS_TAPES, bakeTape, BLOB_PUBLIC_BASE } from '../_systems-datasets.js'

// Rolling history tapes: `?ds=<name>&tape=1[&day=YYYY-MM-DD]` bakes one UTC day
// of frames into the named tape (SYSTEMS_TAPES registry) and merges the
// index. The cron calls it with no day (newest published run); backfills pass
// explicit days. The existing index is read from the tape's OWN blobBase
// (it can differ from the grid dataset's — e.g. sstanom).

// HYCOM's NCSS can take a couple of minutes to slice the global grid.
export const maxDuration = 300

const putOpts = (contentType) => ({
  access: 'public',
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType,
  cacheControlMaxAge: 300,
})

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (secret && auth !== `Bearer ${secret}`) {
    res.statusCode = 401
    res.end('Unauthorized')
    return
  }
  const sp = new URL(req.url, 'http://x').searchParams
  const ds = sp.get('ds')
  const entry = SYSTEMS_DATASETS[ds]
  let out
  if (sp.get('tape') && SYSTEMS_TAPES[ds]) {
    // `day=YYYY-MM-DD` or `days=d1,d2,…` (backfills): days are baked in
    // sequence with the index carried in memory between them. Reading the
    // index back from Blob between calls is unsafe — the CDN serves it for
    // up to a minute, and two quick merges would drop each other's frames
    // (that happened on the first prod seed).
    const days = (sp.get('days') || sp.get('day') || '').split(',').map((d) => d.trim()).filter(Boolean)
    if (!days.length) days.push(undefined)
    const results = []
    let existing = null
    try {
      const r = await fetch(`${BLOB_PUBLIC_BASE}/${SYSTEMS_TAPES[ds].blobBase}-tape.json?nocache=${Date.now()}`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
      if (r.ok) existing = await r.json()
    } catch { /* first bake */ }
    const t0 = Date.now()
    for (const day of days) {
      if (Date.now() - t0 > 240000) { results.push({ day, skipped: true, error: 'time budget' }); continue }
      try {
        const result = await bakeTape(ds, { day, existing })
        if (result.unchanged) { results.push({ day: result.day, unchanged: true }); continue }
        let bytes = 0
        for (const b of result.binaries) {
          await put(b.path, b.buffer, { ...putOpts(b.contentType), cacheControlMaxAge: 31536000 })
          bytes += b.buffer.length
        }
        existing = result.jsons[0].json
        for (const f of result.jsons) await put(f.path, JSON.stringify(f.json), { ...putOpts('application/json'), cacheControlMaxAge: 60 })
        results.push({ day: result.day, added: result.added, frames: existing.frames.length, bytes })
      } catch (err) {
        results.push({ day, skipped: true, error: String(err).slice(0, 200) })
      }
    }
    out = { ok: results.every((r) => !r.skipped), ds, tape: true, frames: existing?.frames.length ?? 0, results }
  } else if (!entry) {
    out = { ok: false, error: `unknown dataset "${ds}"` }
  } else {
    try {
      const result = await entry.fetchGrid()
      if (result.jsons) {
        let bytes = 0
        for (const f of result.jsons) {
          const body = JSON.stringify(f.json)
          await put(f.path, body, putOpts('application/json'))
          bytes += body.length
        }
        out = { ok: true, ds, valid: new Date(result.jsons[0].json.valid_ms).toISOString(), files: result.jsons.length, bytes }
      } else if (result.json) {
        const body = JSON.stringify(result.json)
        await put(`${entry.blobBase}.json`, body, putOpts('application/json'))
        out = { ok: true, ds, valid: new Date(result.json.valid_ms).toISOString(), bytes: body.length }
      } else {
        const { meta, gridBuffer } = result
        await put(`${entry.blobBase}-grid.bin`, gridBuffer, putOpts('application/octet-stream'))
        await put(`${entry.blobBase}-meta.json`, JSON.stringify(meta), putOpts('application/json'))
        out = { ok: true, ds, run: new Date(meta.run_ms).toISOString(), valid: new Date(meta.valid_ms).toISOString(), bytes: gridBuffer.length }
      }
    } catch (err) {
      out = { ok: false, ds, skipped: true, error: String(err).slice(0, 160) }
    }
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(out))
}
