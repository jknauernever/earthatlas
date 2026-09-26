// Uploads one baked month of US-wide /ships tracks to Vercel Blob and adds it
// to the index. Run by .github/workflows/ships-us-tracks-bake.yml after
// build_us_tracks.py.
//
//   node scripts/ships/bake-us/publish.mjs 2025-06 [BUILD_DIR]             upload + add to the index
//   node scripts/ships/bake-us/publish.mjs 2025-06 BUILD_DIR --entry-out F  upload only; write the index
//                                                                         entry to F (parallel jobs)
//   node scripts/ships/bake-us/publish.mjs --index DIR                     add every entry file in DIR
//                                                                         to the index in one write
//
// Each file gets a one-file upload token from api/cron/ships-upload-token.js
// (CRON_SECRET bearer); CI never holds the Blob write token. Every file is
// verified readable at full size (range request on its last byte) before the
// index points at it, so a failed run never leaves the index pointing at a
// half-uploaded month.
//
// Blob layout: ships/tracks/us-v1/YYYY-MM/{tracks.pmtiles,tracks.pack,manifest.json}
//              ships/tracks/us-v1/index.json  { version, months: { YYYY-MM: {tiles, pack, manifest, built, ...} } }

import { createReadStream, readFileSync, statSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { put } from '@vercel/blob/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'

const args = process.argv.slice(2)
const INDEX_MODE = args[0] === '--index'
const ENTRY_OUT = args.includes('--entry-out') ? args[args.indexOf('--entry-out') + 1] : null

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

async function writeIndex(entries) {
  // entries: [{ tileset, month, indexUrl, entry }], all for one tileset
  const tileset = entries[0].tileset, indexUrl = entries[0].indexUrl
  if (entries.some((e) => e.tileset !== tileset)) throw new Error('entries span several tilesets')
  let index = { version: tileset, months: {} }
  const cur = await fetch(`${indexUrl}?t=${Date.now()}`, { cache: 'no-store' })
  if (cur.ok) index = await cur.json()
  else if (cur.status !== 404) throw new Error(`reading ${indexUrl}: HTTP ${cur.status}`)
  for (const e of entries) index.months[e.month] = e.entry
  index.months = Object.fromEntries(Object.entries(index.months).sort(([a], [b]) => a.localeCompare(b)))
  index.updated = new Date().toISOString()
  const token = await tokenFor(`ships/tracks/${tileset}/index.json`)
  await put(`ships/tracks/${tileset}/index.json`, JSON.stringify(index, null, 1), { access: 'public', token, contentType: 'application/json' })
  console.log(`index: ${indexUrl} (${Object.keys(index.months).length} months; added ${entries.map((e) => e.month).join(' ')})`)
}

if (INDEX_MODE) {
  const dir = resolve(args[1] || '.')
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json'))
  const entries = files.map((f) => JSON.parse(readFileSync(resolve(dir, String(f)), 'utf8')))
  if (!entries.length) { console.log('no months to add'); process.exit(0) }
  await writeIndex(entries)
} else {
  const ym = args[0]
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym || '')) { console.error('usage: publish.mjs YYYY-MM [BUILD_DIR] [--entry-out F] | --index DIR'); process.exit(2) }
  const BUILD = resolve(args[1] && !args[1].startsWith('--') ? args[1] : resolve(HERE, 'build', ym))
  const manifest = JSON.parse(readFileSync(resolve(BUILD, 'manifest.json'), 'utf8'))
  if (manifest.month !== ym) throw new Error(`manifest is for ${manifest.month}, not ${ym}`)
  if (manifest.test_limit_rows) throw new Error('refusing to publish a test bake')
  const VERSION = manifest.tileset || manifest.rules.version  // Blob folder, e.g. us-v2
  const BASE = `ships/tracks/${VERSION}`
  const files = { tiles: 'tracks.pmtiles', pack: 'tracks.pack' }
  for (const f of Object.values(files)) if (!existsSync(resolve(BUILD, f))) throw new Error(`missing ${f} in ${BUILD}`)
  const urls = {}
  urls.tiles = await upload(`${BASE}/${ym}/tracks.pmtiles`, resolve(BUILD, files.tiles), 'application/vnd.pmtiles')
  urls.pack = await upload(`${BASE}/${ym}/tracks.pack`, resolve(BUILD, files.pack), 'application/octet-stream')
  urls.manifest = await upload(`${BASE}/${ym}/manifest.json`, resolve(BUILD, 'manifest.json'), 'application/json')
  const e = { tileset: VERSION, month: ym, indexUrl: urls.tiles.replace(/\/\d{4}-\d{2}\/tracks\.pmtiles$/, '/index.json'),
    entry: { tiles: urls.tiles, pack: urls.pack, manifest: urls.manifest, built: manifest.built, rules: manifest.rules.version,
      pmtiles_bytes: manifest.pmtiles_bytes, pack_bytes: manifest.pack.bytes, lines: manifest.stats.lines, vessels: manifest.stats.vessels } }
  if (ENTRY_OUT) { writeFileSync(ENTRY_OUT, JSON.stringify(e)); console.log(`entry → ${ENTRY_OUT}`) }
  else await writeIndex([e])
}
