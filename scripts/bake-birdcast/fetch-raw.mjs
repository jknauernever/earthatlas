/**
 * One-time / catch-up pull of BirdCast observed-migration grid frames
 * (see docs/BIRDCAST_DATA.md). Saves the upstream grid_<ts>.tar.gz files
 * untouched into scripts/bake-birdcast/raw/YYYY/MM/DD/ (gitignored).
 *
 * Resumable: a frame already on disk is never requested again, so re-running
 * only fetches what is missing. Skips the vp_*.RData siblings.
 *
 *   node scripts/bake-birdcast/fetch-raw.mjs --days 30
 *   node scripts/bake-birdcast/fetch-raw.mjs --from 2026-08-22 --to 2026-09-21
 */

import { existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const BUCKET = 'https://is-birdcast-observed-prod.s3.us-east-1.amazonaws.com'
const RAW_DIR = join(dirname(fileURLToPath(import.meta.url)), 'raw')
const CONCURRENCY = 4 // be a polite guest on Cornell's bucket

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : null
}
const DAY_MS = 86400000
const to = arg('to') ? new Date(`${arg('to')}T00:00:00Z`) : new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS)
const from = arg('from')
  ? new Date(`${arg('from')}T00:00:00Z`)
  : new Date(to.getTime() - (Number(arg('days') || 30)) * DAY_MS)

async function listDay(prefix) {
  const keys = []
  let token = null
  do {
    const url = `${BUCKET}/?list-type=2&prefix=${encodeURIComponent(prefix)}` +
      (token ? `&continuation-token=${encodeURIComponent(token)}` : '')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`list ${prefix}: HTTP ${res.status}`)
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1])
    token = xml.match(/<NextContinuationToken>([^<]+)</)?.[1] || null
  } while (token)
  return keys.filter((k) => /\/grid_\d{12}\.tar\.gz$/.test(k))
}

async function fetchKey(key) {
  const out = join(RAW_DIR, key.replace(/^grid\//, ''))
  if (existsSync(out)) return 0
  mkdirSync(dirname(out), { recursive: true })
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BUCKET}/${key}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(`${out}.part`, buf)
      renameSync(`${out}.part`, out)
      return buf.length
    } catch (err) {
      if (attempt >= 3) { console.error(`  FAILED ${key}: ${err.message}`); return -1 }
      await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
}

let fetched = 0, skipped = 0, failed = 0, bytes = 0
for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
  const d = new Date(t).toISOString().slice(0, 10).replaceAll('-', '/')
  const keys = await listDay(`grid/${d}/`)
  let next = 0, dayNew = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < keys.length) {
      const n = await fetchKey(keys[next++])
      if (n > 0) { fetched++; dayNew++; bytes += n } else if (n === 0) skipped++; else failed++
    }
  }))
  console.log(`${d}: ${keys.length} frames upstream, ${dayNew} new`)
}
console.log(`fetch-raw: ${fetched} fetched (${(bytes / 1e6).toFixed(1)} MB), ${skipped} already on disk, ${failed} failed`)
if (failed) process.exit(1)
