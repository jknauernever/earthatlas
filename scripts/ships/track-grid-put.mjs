// One file of scripts/ships/track-grid.py to Vercel Blob, with a one-file upload token from
// api/cron/ships-upload-token.js (CRON_SECRET bearer; CI never holds the Blob write token).
//   node scripts/ships/track-grid-put.mjs ships/track-grid/grid.json FILE application/json
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { put } from '@vercel/blob/client'

const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'
const [pathname, file, contentType] = process.argv.slice(2)
if (!pathname || !file || !contentType) { console.error('usage: track-grid-put.mjs PATHNAME FILE CONTENT_TYPE'); process.exit(2) }
if (!process.env.CRON_SECRET) { console.error('CRON_SECRET missing'); process.exit(2) }

const size = statSync(file).size
for (let attempt = 1; ; attempt++) {
  try {
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ pathname }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
    const body = size > 8e6 ? createReadStream(file) : readFileSync(file)
    await put(pathname, body, { access: 'public', token: j.token, contentType, multipart: size > 8e6 })
    console.log(`  ✓ ${pathname} (${(size / 1e6).toFixed(2)} MB)`)
    break
  } catch (err) {
    if (attempt >= 3) throw err
    console.warn(`  retry ${pathname}: ${err.message}`)
    await new Promise((res) => setTimeout(res, 5000 * attempt))
  }
}
