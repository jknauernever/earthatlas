// Uploads one baked month of US-wide /ships tracks to Vercel Blob and adds it
// to the index. Run by .github/workflows/ships-us-tracks-bake.yml after
// build_us_tracks.py.
//
//   node scripts/ships/bake-us/publish.mjs 2025-06 [BUILD_DIR]
//
// Each file gets a one-file upload token from api/cron/ships-upload-token.js
// (CRON_SECRET bearer); CI never holds the Blob write token. Every file is
// verified readable at full size (range request on its last byte) before the
// index points at it, so a failed run never leaves the index pointing at a
// half-uploaded month.
//
// Blob layout: ships/tracks/us-v1/YYYY-MM/{tracks.pmtiles,tracks.pack,manifest.json}
//              ships/tracks/us-v1/index.json  { version, months: { YYYY-MM: {tiles, pack, manifest, built, ...} } }

import { createReadStream, readFileSync, statSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { put } from '@vercel/blob/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'

const ym = process.argv[2]
if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym || '')) { console.error('usage: publish.mjs YYYY-MM [BUILD_DIR]'); process.exit(2) }
const BUILD = resolve(process.argv[3] || resolve(HERE, 'build', ym))
const manifest = JSON.parse(readFileSync(resolve(BUILD, 'manifest.json'), 'utf8'))
if (manifest.month !== ym) throw new Error(`manifest is for ${manifest.month}, not ${ym}`)
if (manifest.test_limit_rows) throw new Error('refusing to publish a test bake (SHIPS_US_LIMIT was set)')
const VERSION = manifest.rules.version            // e.g. us-v1
const BASE = `ships/tracks/${VERSION}`

async function tokenFor(pathname) {
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET missing')
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pathname }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}

async function upload(pathname, file, contentType) {
  const size = statSync(file).size
  for (let attempt = 1; ; attempt++) {
    try {
      const token = await tokenFor(pathname)
      const body = size > 8e6 ? createReadStream(file) : readFileSync(file)
      const res = await put(pathname, body, { access: 'public', token, contentType, multipart: size > 8e6 })
      const probe = await fetch(res.url, { headers: { Range: `bytes=${size - 1}-${size - 1}` }, cache: 'no-store' })
      const total = Number((probe.headers.get('content-range') || '').split('/')[1])
      await probe.arrayBuffer()
      if (probe.status !== 206 || total !== size) throw new Error(`verify ${pathname}: HTTP ${probe.status}, total ${total || 'missing'} vs ${size}`)
      console.log(`  ✓ ${pathname} (${(size / 1e6).toFixed(1)} MB)`)
      return res.url
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`  retry ${pathname}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
}

const files = { tiles: 'tracks.pmtiles', pack: 'tracks.pack' }
for (const f of Object.values(files)) if (!existsSync(resolve(BUILD, f))) throw new Error(`missing ${f} in ${BUILD}`)

const urls = {}
urls.tiles = await upload(`${BASE}/${ym}/tracks.pmtiles`, resolve(BUILD, files.tiles), 'application/vnd.pmtiles')
urls.pack = await upload(`${BASE}/${ym}/tracks.pack`, resolve(BUILD, files.pack), 'application/octet-stream')
urls.manifest = await upload(`${BASE}/${ym}/manifest.json`, resolve(BUILD, 'manifest.json'), 'application/json')

// Merge into the index (read the live one, add/replace this month).
const indexUrl = urls.tiles.replace(/\/\d{4}-\d{2}\/tracks\.pmtiles$/, '/index.json')
let index = { version: VERSION, months: {} }
const cur = await fetch(`${indexUrl}?t=${Date.now()}`, { cache: 'no-store' })
if (cur.ok) index = await cur.json()
else if (cur.status !== 404) throw new Error(`reading ${indexUrl}: HTTP ${cur.status}`)
index.months[ym] = { tiles: urls.tiles, pack: urls.pack, manifest: urls.manifest, built: manifest.built,
  pmtiles_bytes: manifest.pmtiles_bytes, pack_bytes: manifest.pack.bytes, lines: manifest.stats.lines, vessels: manifest.stats.vessels }
index.updated = new Date().toISOString()
const token = await tokenFor(`${BASE}/index.json`)
await put(`${BASE}/index.json`, JSON.stringify(index, null, 1), { access: 'public', token, contentType: 'application/json' })
console.log(`index: ${indexUrl} (${Object.keys(index.months).length} months)`)
