/**
 * BirdCast bird-migration cron — one hourly invocation keeps the whole layer
 * current: the history tape (traffic rate, with flight u/v packed into the
 * same RGB frames) and the live traffic grid — 4 small S3 reads, one PNG and
 * two small JSON/bin writes per new hour.
 *
 * Each run asks for yesterday and today (UTC): days already on tape return
 * `unchanged` without touching upstream, so a missed run heals itself on the
 * next one. `?days=d1,d2,…` backfills explicit days (upstream keeps years).
 * Same contract as api/cron/systems-bake.js: CRON_SECRET guard, a failed pull
 * is skipped (never overwrites good data), grid written before its meta.
 */

import { put } from '@vercel/blob'
import { SYSTEMS_DATASETS, SYSTEMS_TAPES, bakeTape, BLOB_PUBLIC_BASE } from '../_systems-datasets.js'

export const maxDuration = 300

const TAPES = ['birds']

const putOpts = (contentType, maxAge) => ({
  access: 'public',
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType,
  cacheControlMaxAge: maxAge,
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
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
  let days = (sp.get('days') || '').split(',').map((d) => d.trim()).filter(Boolean)
  if (!days.length) days = [...new Set([iso(Date.now() - 8.64e7), iso(Date.now() - 3.6e6)])]

  const t0 = Date.now()
  const out = { ok: true, tapes: {}, grid: null }
  for (const name of TAPES) {
    const entry = SYSTEMS_TAPES[name]
    // The index is carried in memory between days — reading it back from the
    // CDN between merges drops frames (see systems-bake.js).
    let existing = null
    try {
      const r = await fetch(`${BLOB_PUBLIC_BASE}/${entry.blobBase}-tape.json?nocache=${Date.now()}`, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } })
      if (r.ok) existing = await r.json()
    } catch { /* first bake */ }
    const results = []
    for (const day of days) {
      if (Date.now() - t0 > 240000) { results.push({ day, skipped: true, error: 'time budget' }); continue }
      try {
        const result = await bakeTape(name, { day, existing })
        if (result.unchanged) { results.push({ day, unchanged: true }); continue }
        for (const b of result.binaries) await put(b.path, b.buffer, putOpts(b.contentType, 31536000))
        existing = result.jsons[0].json
        for (const f of result.jsons) await put(f.path, JSON.stringify(f.json), putOpts('application/json', 60))
        results.push({ day, added: result.added, frames: existing.frames.length })
      } catch (err) {
        results.push({ day, skipped: true, error: String(err).slice(0, 200) })
      }
    }
    if (results.some((r) => r.skipped)) out.ok = false
    out.tapes[name] = results
  }

  try {
    const entry = SYSTEMS_DATASETS.birds
    const { meta, gridBuffer } = await entry.fetchGrid()
    await put(`${entry.blobBase}-grid.bin`, gridBuffer, putOpts('application/octet-stream', 300))
    await put(`${entry.blobBase}-meta.json`, JSON.stringify(meta), putOpts('application/json', 300))
    out.grid = { valid: new Date(meta.valid_ms).toISOString(), bytes: gridBuffer.length }
  } catch (err) {
    out.ok = false
    out.grid = { skipped: true, error: String(err).slice(0, 160) }
  }

  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(out))
}
