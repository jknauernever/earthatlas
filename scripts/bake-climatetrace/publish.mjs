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
const PRUNE_URL = process.env.TRACE_PRUNE_URL || TOKEN_URL.replace(/trace-upload-token$/, 'trace-prune')

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
      // Readable at full size before anything points at it: fetch the LAST
      // byte with a range request (what the tile/detail routes do) and check
      // the total in Content-Range. (A HEAD right after upload can come back
      // without Content-Length — the first CI run misread that as 0 bytes.)
      const probe = await fetch(res.url, { headers: { Range: `bytes=${size - 1}-${size - 1}` }, cache: 'no-store' })
      const total = Number((probe.headers.get('content-range') || '').split('/')[1])
      await probe.arrayBuffer()
      if (probe.status !== 206 || total !== size) throw new Error(`verify ${pathname}: HTTP ${probe.status}, content-range total ${total || 'missing'} vs ${size} bytes`)
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
    pack: resolve(BUILD, 'trace-detail.pack'),
    index: resolve(BUILD, 'trace-index.json'),
  }
  for (const f of Object.values(files)) if (!existsSync(f)) throw new Error(`missing ${f} — run bake.mjs assemble first`)
  const index = JSON.parse(readFileSync(files.index, 'utf8'))
  // One tile file per measure (index.measures); older bakes had a single file.
  const tileFiles = index.measures
    ? Object.values(index.measures).map((m) => m.tiles)
    : ['trace-facilities.pmtiles']
  for (const t of tileFiles) if (!existsSync(resolve(BUILD, t))) throw new Error(`missing ${t} — run bake.mjs assemble first`)
  const live = await livePointer()

  // ── safety gates ──
  const problems = []
  const bad = (index.summaries || []).filter((s) => s.bad > 0)
  if (bad.length) problems.push(`malformed CSV rows in ${bad.map((s) => `${s.sub} (${s.bad})`).join(', ')}`)
  if (live?.count && index.count < live.count * 0.9) problems.push(`only ${index.count} sources vs ${live.count} live (< 90%)`)
  if (live?.months && index.months.length < live.months) problems.push(`${index.months.length} months vs ${live.months} live`)
  const primaryTiles = resolve(BUILD, index.measures ? index.measures[index.primary].tiles : tileFiles[0])
  if (statSync(primaryTiles).size < 20e6) problems.push('primary tiles file implausibly small')
  for (const [g, m] of Object.entries(index.measures || {})) {
    const prev = live?.measures?.[g]
    if (prev && m.count < prev * 0.9) problems.push(`${g}: only ${m.count} sources vs ${prev} live (< 90%)`)
  }
  if (statSync(files.pack).size < 50e6) problems.push('detail pack implausibly small')
  if (!/^v\d+\.\d+\.\d+-\d{8}(\d{4})?$/.test(index.build || '')) problems.push(`bad build id ${index.build}`)
  if (problems.length) {
    console.error(`✗ NOT publishing ${index.build} — production unchanged:\n  - ${problems.join('\n  - ')}`)
    process.exit(1)
  }

  console.log(`publishing ${index.build} (${index.count} sources, ${index.months[0]} → ${index.months.at(-1)})`)
  const dir = `trace/${index.build}`
  for (const t of tileFiles) await upload(`${dir}/${t}`, resolve(BUILD, t), 'application/octet-stream')
  await upload(`${dir}/trace-detail.pack`, files.pack, 'application/octet-stream')
  const indexUrl = await upload(`${dir}/trace-index.json`, files.index, 'application/json')

  const pointer = {
    build: index.build,
    release: index.release,
    index: indexUrl,
    count: index.count,
    months: index.months.length,
    lastMonth: index.months.at(-1),
    measures: index.measures ? Object.fromEntries(Object.entries(index.measures).map(([g, m]) => [g, m.count])) : null,
    sourceStamps: index.sourceStamps,
    published_ms: Date.now(),
    previous: live?.build || null,
  }
  const token = await tokenFor(cfg.pointer)
  await put(cfg.pointer, JSON.stringify(pointer, null, 1), { access: 'public', token, contentType: 'application/json' })
  console.log(`✓ live: ${index.build} (previous: ${pointer.previous || 'none'}) — ${POINTER_URL}`)

  // Storage: keep only the live release and the one before it. Never fatal —
  // the new release is already live; a failed prune just leaves extra files.
  try {
    // Name exactly what to keep: the build just made live and the one it
    // replaced. (Never let the route infer this from the pointer — right after
    // the flip a cached read returns the OLD pointer.)
    const keep = [index.build, live?.build].filter(Boolean)
    const r = await fetch(PRUNE_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ keep }),
    })
    const j = await r.json().catch(() => ({}))
    console.log(r.ok ? `✓ pruned ${j.deleted} old files (${((j.bytesFreed || 0) / 1e9).toFixed(2)} GB), kept ${j.kept?.join(', ')}` : `  prune skipped: ${r.status} ${j.error || ''}`)
  } catch (err) { console.warn(`  prune skipped: ${err.message}`) }

  // Final check: the release that's now live must still be readable. If
  // cleanup (or anything else) removed it, fail the run loudly — a green run
  // must mean a working layer.
  const after = await fetch(`${indexUrl}?t=${Date.now()}`, { cache: 'no-store' })
  await after.arrayBuffer().catch(() => {})
  if (!after.ok) {
    console.error(`✗ the live release ${index.build} is NOT readable after publish (index HTTP ${after.status}) — the layer is broken; investigate now`)
    process.exit(1)
  }
  console.log(`✓ live release readable after cleanup (${index.build})`)
}

const cmd = process.argv[2]
if (cmd === 'check') await check()
else if (cmd === 'publish') await publish()
else { console.error('usage: publish.mjs check|publish'); process.exit(1) }
