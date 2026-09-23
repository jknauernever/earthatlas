/**
 * Upload passes for the Climate TRACE bake (.github/workflows/climatetrace-bake.yml).
 *
 * The bake runs in GitHub Actions — it streams ~40 GB of CSV, far beyond a
 * Vercel function — and its outputs (~100 MB tiles, ~0.5 GB detail pack) are
 * far too big to POST through a function body (the liveocean-ingest pattern).
 * Blob write tokens are sensitive in Vercel env, so CI can't hold one either.
 *
 * So CI asks here, with the CRON_SECRET bearer every cron uses, for a
 * short-lived CLIENT token scoped to ONE allowlisted pathname, then uploads
 * straight to Blob with it (@vercel/blob/client put). The read-write token
 * never leaves this function.
 *
 *   POST { pathname } → { token }
 */

import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'

// Release files are immutable per version; the pointer is the only overwrite.
const RELEASE_FILE = /^trace\/v\d+\.\d+\.\d+-\d{8}(\d{4})?\/(trace-facilities(-[a-z0-9_]{2,16})?\.pmtiles|trace-detail\.pack|trace-index\.json)$/
const POINTER = 'trace/latest.json'

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const { pathname } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const isPointer = pathname === POINTER
    if (!isPointer && !RELEASE_FILE.test(pathname || '')) throw new Error(`path not allowed: ${pathname}`)
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      addRandomSuffix: false,
      allowOverwrite: true, // a re-run of the same bake day replaces its own files
      maximumSizeInBytes: isPointer ? 64 * 1024 : 2 * 1024 ** 3,
      // The pointer must turn over quickly; release files never change.
      cacheControlMaxAge: isPointer ? 60 : 60 * 60 * 24 * 365,
      validUntil: Date.now() + 2 * 60 * 60 * 1000,
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ token }))
  } catch (err) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: String(err).slice(0, 300) }))
  }
}
