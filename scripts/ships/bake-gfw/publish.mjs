// Uploads baked months of GFW hourly track lines to Vercel Blob and adds them to the index.
// Run by .github/workflows/ships-gfw-tracks-bake.yml after bake.py tile (same pattern as
// scripts/ships/bake-us/publish.mjs).
//
//   node scripts/ships/bake-gfw/publish.mjs 2026-08 OUT_DIR --entry-out F   upload one month; write its index entry to F
//   node scripts/ships/bake-gfw/publish.mjs --index DIR                      add every entry file in DIR to the index (one write)
//
// Each file gets a one-file upload token from api/cron/ships-upload-token.js (CRON_SECRET bearer); CI never
// holds the Blob write token. NOTE: that endpoint's allowlist must include ships/tracks/gfw-v<N>/ (a one-line
// regex change, see docs/SHIP_TRACK_SOURCES.md "GFW hourly lines: production pipeline").
// Every file is verified readable at full size before the index points at it.
//
// Blob layout: ships/tracks/gfw-v1/YYYY-MM/{tracks.pmtiles,tracks.pack,manifest.json}
//              ships/tracks/gfw-v1/index.json  { version, months: { YYYY-MM: {tiles, pack, manifest, built, areas, noaa_excluded, …} } }

import { createReadStream, readFileSync, statSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { put } from '@vercel/blob/client'

const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'
const BLOB_BASE = process.env.SHIPS_BLOB_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const args = process.argv.slice(2)

async function tokenFor(pathname) {
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET missing')
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ pathname }) })
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
      // A cache-busting query: right after an overwrite the Blob CDN can still answer with the previous copy (2026-10-02).
      const probe = await fetch(`${res.url}?verify=${Date.now()}`, { headers: { Range: `bytes=${size - 1}-${size - 1}` }, cache: 'no-store' })
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

async function readIndex(pathname, tileset) {
  const cur = await fetch(`${BLOB_BASE}/${pathname}?t=${Date.now()}`, { cache: 'no-store' })
  if (cur.ok) return cur.json()
  if (cur.status !== 404) throw new Error(`reading ${pathname}: HTTP ${cur.status}`)
  return { version: tileset, months: {} }
}

// Months now publish one at a time from separate runs (.github/workflows/ships-gfw-month.yml, 2026-10-01), so two runs
// can update the index at nearly the same moment and one could drop the other's month. Read → merge → write, then
// re-read: if any of our months is missing (another writer won), merge again. Converges; months are never removed here.
async function writeIndex(entries) {
  const tileset = entries[0].tileset
  if (entries.some((e) => e.tileset !== tileset)) throw new Error('entries span several tilesets')
  const pathname = `ships/tracks/${tileset}/index.json`
  const ours = entries.map((e) => e.month)
  // The daily run starts from fetched_through − 5 days; only advance it when every planned month published, never move it back.
  const expect = JSON.parse(process.env.EXPECT_MONTHS || '[]')
  const through = process.env.FETCHED_THROUGH && expect.every((m) => ours.includes(m)) ? process.env.FETCHED_THROUGH : null
  for (let attempt = 1; attempt <= 8; attempt++) {
    const index = await readIndex(pathname, tileset)
    for (const e of entries) index.months[e.month] = e.entry
    index.months = Object.fromEntries(Object.entries(index.months).sort(([a], [b]) => a.localeCompare(b)))
    index.updated = new Date().toISOString()
    if (through && !(index.fetched_through && index.fetched_through > through)) index.fetched_through = through
    const token = await tokenFor(pathname)
    await put(pathname, JSON.stringify(index, null, 1), { access: 'public', token, contentType: 'application/json' })
    await new Promise((r) => setTimeout(r, 4000 + Math.random() * 6000))
    const check = await readIndex(pathname, tileset)
    const missing = ours.filter((m) => !check.months?.[m] || check.months[m].built !== entries.find((e) => e.month === m).entry.built)
    if (!missing.length) {
      console.log(`index ${pathname}: ${Object.keys(check.months).length} months; wrote ${ours.join(' ')}`)
      return
    }
    console.warn(`  index write raced (missing ${missing.join(' ')}), merging again (${attempt})`)
  }
  throw new Error('index: could not confirm our months after 8 attempts')
}

if (args[0] === '--index') {
  const dir = resolve(args[1] || '.')
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.json'))
  const entries = files.map((f) => JSON.parse(readFileSync(resolve(dir, String(f)), 'utf8')))
  if (!entries.length) { console.log('no months to add'); process.exit(0) }
  await writeIndex(entries)
} else {
  const ym = args[0]
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym || '')) { console.error('usage: publish.mjs YYYY-MM OUT_DIR [--entry-out F] | --index DIR'); process.exit(2) }
  const out = resolve(args[1] || '.')
  const dir = resolve(out, ym)
  const m = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
  if (m.month !== ym) throw new Error(`manifest is for ${m.month}, not ${ym}`)
  for (const f of ['tracks.pmtiles', 'tracks.pack']) if (!existsSync(resolve(dir, f))) throw new Error(`missing ${f} in ${dir}`)
  const base = `ships/tracks/${m.tileset}/${ym}`
  const tiles = await upload(`${base}/tracks.pmtiles`, resolve(dir, 'tracks.pmtiles'), 'application/vnd.pmtiles')
  const pack = await upload(`${base}/tracks.pack`, resolve(dir, 'tracks.pack'), 'application/octet-stream')
  // The month's ship identities (bake.py: vessels.json.gz) for the GFW ship-records import (lib/ships/gfwAis.js).
  const vessels = existsSync(resolve(dir, 'vessels.json.gz')) ? await upload(`${base}/vessels.json.gz`, resolve(dir, 'vessels.json.gz'), 'application/gzip') : null
  const manifest = await upload(`${base}/manifest.json`, resolve(dir, 'manifest.json'), 'application/json')
  const e = { tileset: m.tileset, month: ym, entry: { tiles, pack, manifest, ...(vessels ? { vessels_url: vessels } : {}), built: m.built, rules: m.rules.version, areas: m.areas,
    noaa_excluded: m.noaa_excluded, pmtiles_bytes: m.pmtiles_bytes, pack_bytes: m.pack.bytes, lines: m.stats.lines, vessels: m.stats.vessels } }
  const i = args.indexOf('--entry-out')
  if (i > 0) { writeFileSync(args[i + 1], JSON.stringify(e)); console.log(`entry → ${args[i + 1]}`) }
  else await writeIndex([e])
}
