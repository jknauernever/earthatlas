#!/usr/bin/env node
// Climate TRACE → production, run by .github/workflows/climatetrace-bake.yml
// (or by hand with the same env).
//
//   node scripts/bake-climatetrace/publish.mjs check     # is upstream newer than what's live?
//   node scripts/bake-climatetrace/publish.mjs publish   # validate build/, upload, flip the pointer
//
// Env: CRON_SECRET (same secret every cron uses); TRACE_TOKEN_URL (default
// https://earthatlas.org/api/cron/trace-upload-token); FORCE=1 skips the
// "nothing new" answer in check.
//
// HOW A RELEASE GOES LIVE
//   1. Upload trace/<build>/{trace-facilities.pmtiles, trace-detail.pack,
//      trace-index.json} to Blob — each with a one-file upload token from
//      api/cron/trace-upload-token.js (CI never holds the Blob write token).
//   2. Verify every uploaded file is publicly readable at its full size.
//   3. Only then overwrite trace/latest.json, which the site reads (60 s
//      cache). Nothing on the site changes until step 3, and a failed run
//      leaves the previous release serving untouched.
//
// SAFETY GATES (publish refuses, exit 1): any malformed CSV rows; fewer than
// 90% of the live release's sources; fewer months than live; implausibly
// small files. A refused run changes nothing in production.

import { createReadStream, readFileSync, statSync, appendFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { put } from '@vercel/blob/client'
import { upstreamStamps } from './bake.mjs'
import cfg from '../../src/systems/traceSource.json' with { type: 'json' }

const HERE = dirname(fileURLToPath(import.meta.url))
const BUILD = resolve(HERE, 'build')
const BLOB = cfg.blobBase.replace(/\/+$/, '')
const POINTER_URL = `${BLOB}/${cfg.pointer}`
const TOKEN_URL = process.env.TRACE_TOKEN_URL || 'https://earthatlas.org/api/cron/trace-upload-token'

const out = (k, v) => {
  console.log(`${k}=${v}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
}

async function livePointer() {
  const r = await fetch(`${POINTER_URL}?t=${Date.now()}`, { cache: 'no-store' })
  if (r.status === 404 || r.status === 403) return null
  if (!r.ok) throw new Error(`pointer ${r.status}`)
  return r.json()
}

async function check() {
  const [live, upstream] = await Promise.all([livePointer(), upstreamStamps()])
  const changed = !live?.sourceStamps || Object.keys(upstream).some((k) => upstream[k] !== live.sourceStamps[k])
  console.log(live ? `live: ${live.build} (${live.count} sources, through ${live.lastMonth})` : 'live: none yet')
  out('new', changed || process.env.FORCE === '1' ? 'true' : 'false')
}

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
      // Readable at full size before anything points at it.
      const head = await fetch(res.url, { method: 'HEAD', cache: 'no-store' })
      const len = Number(head.headers.get('content-length'))
      if (!head.ok || len !== size) throw new Error(`verify ${pathname}: HTTP ${head.status}, ${len} of ${size} bytes`)
      console.log(`  ✓ ${pathname} (${(size / 1e6).toFixed(1)} MB)`)
      return res.url
    } catch (err) {
      if (attempt >= 3) throw err
      console.warn(`  retry ${pathname}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
}

async function publish() {
  const files = {
    tiles: resolve(BUILD, 'trace-facilities.pmtiles'),
    pack: resolve(BUILD, 'trace-detail.pack'),
    index: resolve(BUILD, 'trace-index.json'),
  }
  for (const f of Object.values(files)) if (!existsSync(f)) throw new Error(`missing ${f} — run bake.mjs assemble first`)
  const index = JSON.parse(readFileSync(files.index, 'utf8'))
  const live = await livePointer()

  // ── safety gates ──
  const problems = []
  const bad = (index.summaries || []).filter((s) => s.bad > 0)
  if (bad.length) problems.push(`malformed CSV rows in ${bad.map((s) => `${s.sub} (${s.bad})`).join(', ')}`)
  if (live?.count && index.count < live.count * 0.9) problems.push(`only ${index.count} sources vs ${live.count} live (< 90%)`)
  if (live?.months && index.months.length < live.months) problems.push(`${index.months.length} months vs ${live.months} live`)
  if (statSync(files.tiles).size < 20e6) problems.push('tiles file implausibly small')
  if (statSync(files.pack).size < 50e6) problems.push('detail pack implausibly small')
  if (!/^v\d+\.\d+\.\d+-\d{8}$/.test(index.build || '')) problems.push(`bad build id ${index.build}`)
  if (problems.length) {
    console.error(`✗ NOT publishing ${index.build} — production unchanged:\n  - ${problems.join('\n  - ')}`)
    process.exit(1)
  }

  console.log(`publishing ${index.build} (${index.count} sources, ${index.months[0]} → ${index.months.at(-1)})`)
  const dir = `trace/${index.build}`
  await upload(`${dir}/trace-facilities.pmtiles`, files.tiles, 'application/octet-stream')
  await upload(`${dir}/trace-detail.pack`, files.pack, 'application/octet-stream')
  const indexUrl = await upload(`${dir}/trace-index.json`, files.index, 'application/json')

  const pointer = {
    build: index.build,
    release: index.release,
    index: indexUrl,
    count: index.count,
    months: index.months.length,
    lastMonth: index.months.at(-1),
    sourceStamps: index.sourceStamps,
    published_ms: Date.now(),
    previous: live?.build || null,
  }
  const token = await tokenFor(cfg.pointer)
  await put(cfg.pointer, JSON.stringify(pointer, null, 1), { access: 'public', token, contentType: 'application/json' })
  console.log(`✓ live: ${index.build} (previous: ${pointer.previous || 'none'}) — ${POINTER_URL}`)
}

const cmd = process.argv[2]
if (cmd === 'check') await check()
else if (cmd === 'publish') await publish()
else { console.error('usage: publish.mjs check|publish'); process.exit(1) }
