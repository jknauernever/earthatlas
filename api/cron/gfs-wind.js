/**
 * GFS wind cron — refreshes the /systems live wind grid every 6 hours.
 *
 * Pulls the freshest GFS 10 m wind step (see api/_gfs-wind-core.js) and writes
 * the meta + binary grid pair to Vercel Blob at deterministic paths; the
 * /systems client fetches those directly. Mirrors api/cron/nifc-snapshot.js:
 * Node runtime (@vercel/blob needs node:stream), CRON_SECRET guard, and a
 * failed pull is SKIPPED — it never overwrites the last good snapshot.
 */

import { put } from '@vercel/blob'
import { fetchWindGrid, BLOB_META_PATH, BLOB_GRID_PATH } from '../_gfs-wind-core.js'

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
  let out
  try {
    const { meta, gridBuffer } = await fetchWindGrid()
    // Grid first, meta last — meta is the client's pointer, so a crash between
    // the two writes leaves a consistent (old) pair rather than a mixed one.
    await put(BLOB_GRID_PATH, gridBuffer, putOpts('application/octet-stream'))
    await put(BLOB_META_PATH, JSON.stringify(meta), putOpts('application/json'))
    out = { ok: true, run: new Date(meta.run_ms).toISOString(), valid: new Date(meta.valid_ms).toISOString(), bytes: gridBuffer.length }
  } catch (err) {
    out = { ok: false, skipped: true, error: String(err).slice(0, 160) }
  }
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(out))
}
