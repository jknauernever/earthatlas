/**
 * Ingest endpoint for the weather-imagery bakes: the GMGSI global cloud
 * mosaic and the precipitation tiers (JAXA GSMaP, NOAA MRMS).
 *
 * Same shape and the same reason as api/cron/liveocean-ingest.js: the bake is
 * python (h5py reads NOAA's HDF5) and runs in GitHub Actions, because this
 * project's Vercel preset is Vite and won't build python functions in api/.
 * Blob write tokens are sensitive so CI can't hold one — CI POSTs the finished
 * image here behind CRON_SECRET and the runtime writes it with its own token.
 *
 * Payload is ~1.6 MB of WebP as base64 (~2.1 MB on the wire), comfortably
 * under the 4.5 MB function body limit. That headroom is why the bake writes
 * lossless WebP rather than PNG: the same 4096x2048 frame is 9.5 MB as RGBA
 * PNG and would not fit.
 */

import { put, del } from '@vercel/blob'

export const maxDuration = 60

// Latest-frame artefacts, plus the rolling archives the sharp precipitation
// tiers keep so a replay does not have to fall back to 11 km data:
//   systems/mrms-conus/1790187600000.pmtiles   one archived frame
//   systems/mrms-conus-tape.json               the index of them
//   systems/gsmap-rain-tape/2026-09-23-2230.png  one half-hourly tape frame
//   systems/gsmap-rain-{tape.json,meta.json,grid.bin}  its index + newest grid
const ALLOWED = /^systems\/((gmgsi-clouds|gsmap-now|mrms-conus)(\.webp|\.pmtiles|-meta\.json|-tape\.json|\/\d+\.pmtiles)|gsmap-rain(-tape\.json|-meta\.json|-grid\.bin|-tape\/\d{4}-\d{2}-\d{2}-\d{4}\.png))$/

const BLOB_PUBLIC_BASE =
  process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'

const putOpts = (contentType) => ({
  access: 'public',
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType,
  // Frames are hourly; a short TTL keeps the CDN from serving a stale globe.
  cacheControlMaxAge: 300,
})

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) {
    res.statusCode = 401
    res.end('Unauthorized')
    return
  }
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('POST only')
    return
  }
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const { files, prune } = JSON.parse(Buffer.concat(chunks).toString())
    if (!Array.isArray(files) || !files.length || files.length > 4) throw new Error('bad files array')
    // A rolling archive has to drop its tail or it grows without bound: MRMS
    // alone would add ~86 MB a day. Deletes are held to the same allowlist as
    // writes, so this can only ever remove something it could have written.
    if (prune && !Array.isArray(prune)) throw new Error('bad prune array')
    const written = []
    for (const f of files) {
      if (!ALLOWED.test(f.path)) throw new Error(`path not allowed: ${f.path}`)
      const body = Buffer.from(f.b64, 'base64')
      await put(f.path, body, putOpts(f.contentType || 'application/octet-stream'))
      written.push({ path: f.path, bytes: body.length })
    }

    // Drop the tail of a rolling archive. Deletes run AFTER the writes, so a
    // failed upload can never leave the index pointing at a frame that has
    // already been removed. Held to the same allowlist as writes, so this can
    // only ever remove something it could have written.
    const dropped = []
    for (const path of (prune || []).slice(0, 64)) {
      if (!ALLOWED.test(path)) throw new Error(`path not allowed: ${path}`)
      try { await del(`${BLOB_PUBLIC_BASE}/${path}`); dropped.push(path) } catch { /* already gone */ }
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, written, dropped }))
  } catch (err) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: String(err).slice(0, 300) }))
  }
}
