/**
 * Ingest endpoint for the LiveOcean ocean-acidity bake.
 *
 * The bake itself runs in GitHub Actions (python h5py range-reads UW's 3.1 GB
 * daily HDF5 — see .github/workflows/liveocean-bake.yml); this project's
 * Vercel preset can't host python functions, and Blob write tokens are marked
 * sensitive so CI can't hold one. So CI POSTs the finished grid pair here
 * (CRON_SECRET bearer, same guard as the other crons) and this function
 * writes it to Blob with the runtime's own token. Payload is ~2.4 MB of
 * base64 — well under the 4.5 MB function body limit.
 */

import { put } from '@vercel/blob'

export const maxDuration = 60

const ALLOWED = /^systems\/(liveocean|cmems)-[a-z0-9-]+-(grid\.bin|meta\.json|tape\.json|tape\/\d{4}-\d{2}-\d{2}-\d{2}\.png)$/

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
    const { files } = JSON.parse(Buffer.concat(chunks).toString())
    if (!Array.isArray(files) || !files.length || files.length > 12) throw new Error('bad files array')
    const written = []
    for (const f of files) {
      if (!ALLOWED.test(f.path)) throw new Error(`path not allowed: ${f.path}`)
      const body = Buffer.from(f.b64, 'base64')
      await put(f.path, body, putOpts(f.contentType || 'application/octet-stream'))
      written.push({ path: f.path, bytes: body.length })
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, written }))
  } catch (err) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: false, error: String(err).slice(0, 300) }))
  }
}
