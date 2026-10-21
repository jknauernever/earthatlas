/**
 * Upload passes for the weekly /permits bake (.github/workflows/permits-bake.yml, scripts/permits/publish.mjs).
 *
 * Same pattern as api/cron/ships-upload-token.js: the bake runs in GitHub Actions and CI never holds the Blob
 * read-write token. CI asks here, with the CRON_SECRET bearer, for a short-lived client token scoped to ONE
 * allowlisted pathname under permits/, then uploads straight to Blob. Also serves the monthly critical habitat bake for
 * /species-of-concern (.github/workflows/soc-critical-habitat-bake.yml), whose files live under species-of-concern/.
 *
 *   POST { pathname } → { token }
 */

import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client'

// The Blob folder mirrors public/permits-data/ (what the bake writes), plus the Corps notice archive.
const DATA = /^permits\/(permits\.json|wq303d\.geojson|shellfish\.geojson|records\/[A-Za-z0-9_.-]{1,120}\.json)$/
const ARCHIVE = /^permits\/(corps-notices\/(\d{1,12}|index)\.json|notices\/\d{1,12}-\d{1,3}\.pdf)$/
// scripts/species-of-concern/bake-critical-habitat.mjs: a dated directory of tiles + index, and the pointer to it.
const SOC_CRITHAB = /^species-of-concern\/critical-habitat\/(wa-\d{14}\/(index\.json|t\/-?\d{1,4}_-?\d{1,4}\.json\.gz)|wa-latest\.json)$/

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) { res.statusCode = 401; return res.end('Unauthorized') }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('POST only') }
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const { pathname } = JSON.parse(Buffer.concat(chunks).toString() || '{}')
    const isPdf = /\.pdf$/.test(pathname || '')
    const soc = SOC_CRITHAB.test(pathname || '')
    if (!DATA.test(pathname || '') && !ARCHIVE.test(pathname || '') && !soc) throw new Error(`path not allowed: ${pathname}`)
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      addRandomSuffix: false,
      allowOverwrite: true, // each weekly bake replaces its own files
      maximumSizeInBytes: isPdf ? 50 * 1024 ** 2 : 20 * 1024 ** 2,
      // Data turns over weekly; an archived notice PDF never changes.
      // A dated critical habitat bake never changes; its pointer is re-read every few minutes.
      cacheControlMaxAge: soc ? (/wa-latest\.json$/.test(pathname) ? 300 : 60 * 60 * 24 * 365) : isPdf ? 60 * 60 * 24 * 30 : 60 * 60,
      validUntil: Date.now() + 60 * 60 * 1000,
    })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ token }))
  } catch (err) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: String(err).slice(0, 300) }))
  }
}
