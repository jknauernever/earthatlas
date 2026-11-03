#!/usr/bin/env node
// Uploads a /shoreline parcel bake (bake-parcels.py) to Vercel Blob:
//   parcels/shoreline-sjc-<version>.pmtiles          parcels + buildings tiles
//   shoreline/<version>/detail/<fid % 256>.json      property-popup detail shards
// Paths are stable (no random suffix); a new bake gets a new <version>, so old URLs stay immutable.
//
//   node --env-file=.env.local scripts/shoreline/upload.mjs <version> [--pointer] [--record] [--dry-run]
//     --pointer  then flip shoreline/latest.json to this bake (src/shoreline/bake.js reads it): the yearly Action
//     --record   write it into src/fire/parcelSources.json (region shoreline-sjc), the built-in fallback; for a
//                hand-run bake that will be committed
//     --dry-run  run the gates and print what would be uploaded
//
// Gates, before anything is uploaded: the download must be a full one (not a --pins sample), every detail shard must
// exist, and parcels / buildings / greenery must not have shrunk more than 10% against the bake now live.
// Uploads: BLOB_READ_WRITE_TOKEN locally; in GitHub Actions one-file passes from api/cron/permits-upload-token.js
// (PERMITS_TOKEN_URL + CRON_SECRET), never a Blob token in CI.

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import sources from '../../src/fire/parcelSources.json' with { type: 'json' }

const args = process.argv.slice(2)
const version = args.find((a) => !a.startsWith('--'))
const pointer = args.includes('--pointer'), record = args.includes('--record'), dry = args.includes('--dry-run')
if (!/^\d{4}-\d{2}-\d{2}$/.test(version || '')) throw new Error('usage: upload.mjs <YYYY-MM-DD> [--pointer] [--record] [--dry-run]')
const REGION = 'shoreline-sjc'
const SHARDS = 256
const DETAIL = 'data/shoreline/build/detail'
const PMTILES = `scripts/bake-parcels/build/${REGION}-${version}.pmtiles`
const BUILT_IN = sources[REGION]
const POINTER_URL = `${new URL(BUILT_IN.pmtilesUrl).origin}/shoreline/latest.json`
const fail = (msg) => { console.error(`refused: ${msg}`); process.exit(1) }

// ─── Gates ────────────────────────────────────────────────────────────────────
const fetched = JSON.parse(await readFile('data/shoreline/raw/fetch.json', 'utf8'))
if (fetched.where !== '1=1') fail(`the county download is a sample (${fetched.where})`)
if (!existsSync(PMTILES)) fail(`${PMTILES} is missing — run bake-parcels.py ${version}`)
const files = (await readdir(DETAIL)).filter((f) => /^\d+\.json$/.test(f))
if (files.length !== SHARDS) fail(`${files.length} detail shards, expected ${SHARDS}`)
const greenery = Object.keys(JSON.parse(await readFile('data/shoreline/build/greenery.json', 'utf8'))).length
const counts = { parcels: fetched.layers.parcels.count, buildings: fetched.layers.buildings.count, greenery }
// Against the live pointer when there is one, else the 2026-11 hand-run bake (19,020 / 30,968 / 19,018)
const live = await fetch(POINTER_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)
const before = live?.counts || { parcels: 19020, buildings: 30968, greenery: 19018 }
for (const [k, n] of Object.entries(counts)) {
  if (n < before[k] * 0.9) fail(`${k} fell from ${before[k]} to ${n}`)
}
console.log(`gates passed: ${Object.entries(counts).map(([k, n]) => `${k} ${n} (was ${before[k]})`).join(', ')}`)
if (dry) {
  console.log(`dry run: would upload ${PMTILES} + ${files.length} shards as ${version}${pointer ? ', then flip the pointer' : ''}`)
  process.exit(0)
}

// ─── Upload ───────────────────────────────────────────────────────────────────
const rw = process.env.BLOB_READ_WRITE_TOKEN
const tokenUrl = process.env.PERMITS_TOKEN_URL, cron = process.env.CRON_SECRET
if (!rw && !(tokenUrl && cron)) throw new Error('need BLOB_READ_WRITE_TOKEN (local) or PERMITS_TOKEN_URL + CRON_SECRET (CI)')
const blob = rw ? await import('@vercel/blob') : await import('@vercel/blob/client')
const tokenFor = async (pathname) => {
  if (rw) return rw
  const r = await fetch(tokenUrl, { method: 'POST', headers: { authorization: `Bearer ${cron}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  if (!r.ok) throw new Error(`upload pass for ${pathname}: HTTP ${r.status} ${await r.text()}`)
  return (await r.json()).token
}
// One-file passes carry their own cache age (permits-upload-token.js); a local token sets it here
const put = async (pathname, body, contentType, maxAge) => blob.put(pathname, body, {
  access: 'public', contentType, addRandomSuffix: false, allowOverwrite: true, ...(rw ? { cacheControlMaxAge: maxAge } : {}),
  token: await tokenFor(pathname),
})

const { url: pmtilesUrl } = await put(`parcels/${REGION}-${version}.pmtiles`, await readFile(PMTILES), 'application/octet-stream', 31536000)
console.log(pmtilesUrl)
let detailBase = null
for (let i = 0; i < files.length; i += 8) {
  await Promise.all(files.slice(i, i + 8).map(async (f) => {
    const { url } = await put(`shoreline/${version}/detail/${f}`, await readFile(`${DETAIL}/${f}`), 'application/json', 31536000)
    detailBase ??= url.slice(0, url.lastIndexOf('/') + 1)
  }))
  process.stdout.write(`\r  ${Math.min(i + 8, files.length)}/${files.length} detail shards`)
}
process.stdout.write('\n')

const entry = { pmtilesUrl, sourceLayer: 'parcels', version, detailBase, detailShards: files.length,
  updatedAt: new Date().toISOString().slice(0, 10) }
if (pointer) {
  await put('shoreline/latest.json', JSON.stringify({ ...entry, counts, county: fetched.fetchedAt }), 'application/json', 300)
  console.log(`shoreline/latest.json → ${version}`)
}
if (record) {
  const manifestPath = 'src/fire/parcelSources.json'
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest[REGION] = entry
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`${manifestPath}: ${REGION} → ${version}`)
}
