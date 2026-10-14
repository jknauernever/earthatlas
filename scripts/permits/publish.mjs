#!/usr/bin/env node
// /permits weekly publish (.github/workflows/permits-bake.yml). Two steps around the bake:
//
//   node scripts/permits/publish.mjs --pull       before the bake: copy the Corps notice archive from Blob into
//                                                data/permits/corps-notices/ (notices close and vanish from the
//                                                Corps' list, so the archive is the only copy)
//   node scripts/permits/publish.mjs [--dry-run]  after the bake: gate the fresh output against the live one, then
//                                                upload public/permits-data/ to Blob permits/ (permits.json last,
//                                                so the map never points at records that aren't up yet)
//
// Uploads use one-file tokens from api/cron/permits-upload-token.js (CRON_SECRET), never a Blob token.
// --force skips the gate (only when the drop is understood).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { put } from '@vercel/blob/client'
import { tmpdir } from 'node:os'

const TOKEN_URL = process.env.PERMITS_TOKEN_URL || 'https://earthatlas.org/api/cron/permits-upload-token'
const BLOB = (process.env.PERMITS_BLOB_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com') + '/permits'
const OUT = 'public/permits-data'
const ARCHIVE = 'data/permits/corps-notices'
const args = new Set(process.argv.slice(2))
const dry = args.has('--dry-run')

async function getJson(url) {
  const r = await fetch(`${url}?t=${Date.now()}`)
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}

// ── --pull: the archive index lists every notice ever saved; each is fetched unless already here ──
if (args.has('--pull')) {
  mkdirSync(ARCHIVE, { recursive: true })
  const index = await getJson(`${BLOB}/corps-notices/index.json`)
  let n = 0
  for (const id of index?.ids || []) {
    const file = `${ARCHIVE}/${id}.json`
    if (existsSync(file)) continue
    const j = await getJson(`${BLOB}/corps-notices/${id}.json`)
    if (j) { writeFileSync(file, JSON.stringify(j, null, 1)); n++ }
  }
  console.log(`archive: ${index?.ids?.length ?? 0} notices on Blob, ${n} pulled`)
  process.exit(0)
}

// ── Gate: never replace the live data with a bake that lost a lot of it (an agency down, a feed changed) ──
const fresh = JSON.parse(readFileSync(`${OUT}/permits.json`, 'utf8'))
const live = await getJson(`${BLOB}/permits.json`).catch(() => null)
const count = (d) => ({ records: d.projects.length + d.npdes.length, corps: d.projects.filter((p) => String(p.id).startsWith('orm-')).length, npdes: d.npdes.length, wq303d: d.meta.counts.wq303d, shellfish: d.meta.counts.shellfish })
const now = count(fresh)
const problems = []
if (live) {
  const was = count(live)
  for (const k of Object.keys(now)) if (now[k] < Math.floor(was[k] * 0.9)) problems.push(`${k}: ${now[k]} now vs ${was[k]} live`)
}
// Per category too: the Corps feed can silently drop a whole category (its 408 requests, 2026-10-14), which the
// totals above would miss.
if (live) {
  const kinds = (d) => d.projects.filter((p) => p.source === 'orm-feed').reduce((m, p) => ({ ...m, [p.corpsKind]: (m[p.corpsKind] || 0) + 1 }), {})
  const was = kinds(live), nowK = kinds(fresh)
  for (const [k, n] of Object.entries(was)) if ((nowK[k] || 0) < Math.ceil(n * 0.5)) problems.push(`Corps ${k}: ${nowK[k] || 0} now vs ${n} live`)
}
const withViolations = fresh.npdes.filter((r) => (r.trail || []).some((t) => t.title)).length
if (withViolations < fresh.npdes.length * 0.5) problems.push(`only ${withViolations} of ${fresh.npdes.length} discharge permits have EPA violation records (EPA's facility reports may have failed)`)
console.log(`fresh: ${JSON.stringify(now)}${live ? `; live: ${JSON.stringify(count(live))}` : '; nothing live yet'}`)
if (problems.length && !args.has('--force')) { console.error(`REFUSED, not published:\n  ${problems.join('\n  ')}`); process.exit(1) }

// ── Upload ──
async function token(pathname) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}
const TYPE = { json: 'application/json', geojson: 'application/geo+json', pdf: 'application/pdf' }
async function upload(pathname, file) {
  if (dry) return
  const body = readFileSync(file)
  for (let attempt = 1; ; attempt++) {
    try { await put(pathname, body, { access: 'public', token: await token(pathname), contentType: TYPE[file.split('.').pop()] }); return }
    catch (e) { if (attempt >= 3) throw e; await new Promise((r) => setTimeout(r, 2000 * attempt)) }
  }
}
async function pool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x) } }))
}

const files = []
// Notice PDFs: new ones only (they never change once saved).
if (existsSync(`${OUT}/notices`)) {
  for (const f of readdirSync(`${OUT}/notices`).filter((f) => f.endsWith('.pdf'))) {
    const head = await fetch(`${BLOB}/notices/${f}`, { method: 'HEAD' })
    if (!head.ok) files.push([`permits/notices/${f}`, `${OUT}/notices/${f}`])
  }
}
// The archive: every notice JSON, then its index.
const ids = existsSync(ARCHIVE) ? readdirSync(ARCHIVE).filter((f) => /^\d+\.json$/.test(f)).map((f) => f.replace('.json', '')) : []
for (const id of ids) files.push([`permits/corps-notices/${id}.json`, `${ARCHIVE}/${id}.json`])
const indexFile = `${tmpdir()}/permits-corps-notices-index.json`
writeFileSync(indexFile, JSON.stringify({ ids, updated: new Date().toISOString() }))
// Source records, then the layers.
for (const f of readdirSync(`${OUT}/records`)) files.push([`permits/records/${f}`, `${OUT}/records/${f}`])
files.push(['permits/wq303d.geojson', `${OUT}/wq303d.geojson`], ['permits/shellfish.geojson', `${OUT}/shellfish.geojson`])

const bytes = files.reduce((s, [, f]) => s + statSync(f).size, 0)
console.log(`${dry ? 'DRY RUN, would upload' : 'uploading'} ${files.length + 2} files, ${(bytes / 1e6).toFixed(1)} MB + index + permits.json`)
await pool(files, 6, ([p, f]) => upload(p, f))
await upload('permits/corps-notices/index.json', indexFile)
await upload('permits/permits.json', `${OUT}/permits.json`) // last: the map switches over only when everything it names is up
console.log(dry ? 'dry run done' : `published to ${BLOB}/`)
