#!/usr/bin/env node
/**
 * The detailed Salish tracks' Blob index (docs/SHIPS_ACTIVITY_FUSION.md Part 1, Josh 2026-10-07): the months NOAA has published,
 * read by api/ship-tracks.js (salishNow), the page (op=salishindex) and the GFW bake's NOAA-wins rule. Same pattern as
 * scripts/ships/bake-gfw/publish.mjs: one-file upload tokens from api/cron/ships-upload-token.js (CRON_SECRET), never a Blob token.
 *
 *   node scripts/ships/bake-ais/publish.mjs 2026-07 TILE_DIR [ID_DIR]   upload one month (build_tracks.py output tracks-YYYY-MM.{pmtiles,pack,json}
 *                                                                 + ID_DIR/identity-YYYY-MM.ndjson, gzipped) to ships/tracks/salish-v6/YYYY-MM/ and add it to the index
 *   node scripts/ships/bake-ais/publish.mjs --seed TILE_DIR ID_DIR   write the index once from trackSource.json's months (their existing
 *                                                                 URLs, unchanged) + each month's local manifest (sizes, counts), and upload each
 *                                                                 month's identity file (the NOAA ship-identity import reads every month)
 *
 * Blob: ships/tracks/salish-v6/index.json  { version, months: { YYYY-MM: { tiles, pack, manifest?, built, rules, pmtiles_bytes,
 *       pack_bytes, tracks, vessels } }, updated }. Months are only ever added or replaced, never removed.
 */
import { createReadStream, readFileSync, statSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { put } from '@vercel/blob/client'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'
const BLOB_BASE = process.env.SHIPS_BLOB_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const ts = JSON.parse(readFileSync(resolve(HERE, '../../../src/ships/trackSource.json'), 'utf8'))
const TILESET = ts.version // salish-v6
const INDEX = `ships/tracks/${TILESET}/index.json`

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

async function readIndex() {
  const cur = await fetch(`${BLOB_BASE}/${INDEX}?t=${Date.now()}`, { cache: 'no-store' })
  if (cur.ok) return cur.json()
  if (cur.status !== 404) throw new Error(`reading ${INDEX}: HTTP ${cur.status}`)
  return { version: TILESET, months: {} }
}

/** identity-YYYY-MM.ndjson → ships/tracks/<tileset>/YYYY-MM/identity.ndjson.gz (lib/ships/mcMonths.js reads it). */
async function uploadIdentity(ym, idDir) {
  const f = resolve(idDir, `identity-${ym}.ndjson`)
  if (!existsSync(f)) throw new Error(`no identity file for ${ym} (${f})`)
  const gz = resolve(mkdtempSync(resolve(tmpdir(), 'salish-id-')), 'identity.ndjson.gz')
  writeFileSync(gz, gzipSync(readFileSync(f)))
  return upload(`ships/tracks/${TILESET}/${ym}/identity.ndjson.gz`, gz, 'application/gzip')
}

const entryFrom = (m, urls) => ({ ...urls, built: m.built, rules: m.rules?.version, pmtiles_bytes: m.pmtiles_bytes, pack_bytes: m.pack?.bytes,
  tracks: m.stats?.tracks, vessels: m.stats?.vessels })

/** Read → merge → write → re-read until our months are in (another writer can race us). */
async function writeIndex(entries) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    const index = await readIndex()
    Object.assign(index.months, entries)
    index.months = Object.fromEntries(Object.entries(index.months).sort(([a], [b]) => a.localeCompare(b)))
    index.version = TILESET
    index.updated = new Date().toISOString()
    if (process.env.DRY_RUN) { console.log(JSON.stringify(index, null, 1)); console.log('DRY_RUN: not written'); return }
    await put(INDEX, JSON.stringify(index, null, 1), { access: 'public', token: await tokenFor(INDEX), contentType: 'application/json' })
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000))
    const check = await readIndex()
    if (Object.entries(entries).every(([m, e]) => check.months?.[m]?.built === e.built)) {
      console.log(`index ${INDEX}: ${Object.keys(check.months).length} months; wrote ${Object.keys(entries).join(' ')}`)
      return
    }
    console.warn(`  index write raced, merging again (${attempt})`)
  }
  throw new Error('index: could not confirm our months after 8 attempts')
}

const args = process.argv.slice(2)
if (args[0] === '--seed') {
  const dir = resolve(args[1] || resolve(HERE, 'build/v6/track_tiles'))
  const idDir = resolve(args[2] || resolve(HERE, 'build/v6'))
  const entries = {}
  for (const ym of ts.months || []) {
    const mf = resolve(dir, `tracks-${ym}.json`)
    if (!existsSync(mf)) throw new Error(`no local manifest for ${ym} (${mf})`)
    if (!ts.tiles?.[ym] || !ts.packs?.[ym]) throw new Error(`trackSource.json has no tiles/pack URL for ${ym}`)
    const identity = process.env.DRY_RUN ? `(would upload ${ym} identity)` : await uploadIdentity(ym, idDir)
    entries[ym] = entryFrom(JSON.parse(readFileSync(mf, 'utf8')), { tiles: ts.tiles[ym], pack: ts.packs[ym], identity })
  }
  await writeIndex(entries)
} else {
  const ym = args[0]
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym || '')) { console.error('usage: publish.mjs YYYY-MM TILE_DIR | --seed [TILE_DIR]'); process.exit(2) }
  const dir = resolve(args[1] || '.')
  const mf = resolve(dir, `tracks-${ym}.json`)
  const m = JSON.parse(readFileSync(mf, 'utf8'))
  if (m.month !== ym || m.region !== TILESET) throw new Error(`manifest is ${m.region} ${m.month}, not ${TILESET} ${ym}`)
  const base = `ships/tracks/${TILESET}/${ym}`
  const tiles = await upload(`${base}/tracks.pmtiles`, resolve(dir, `tracks-${ym}.pmtiles`), 'application/vnd.pmtiles')
  const pack = await upload(`${base}/tracks.pack`, resolve(dir, `tracks-${ym}.pack`), 'application/octet-stream')
  const manifest = await upload(`${base}/manifest.json`, mf, 'application/json')
  const identity = await uploadIdentity(ym, resolve(args[2] || resolve(dir, '..')))
  await writeIndex({ [ym]: entryFrom(m, { tiles, pack, manifest, identity }) })
}
