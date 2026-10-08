#!/usr/bin/env node
/**
 * Climate TRACE voyages, automated (Josh 2026-10-08): run by .github/workflows/ct-voyages-bake.yml, never needs localhost.
 *
 *   node scripts/ships/bake-ct-voyages/publish.mjs check <table.json>             anything new? (writes new=true|false to $GITHUB_OUTPUT)
 *   node scripts/ships/bake-ct-voyages/publish.mjs publish <build dir> <table.json> gates → upload → stays import → flip the pointer
 *
 * <table.json> = `bq show --format=json trace-data-383422:climate_trace.shipping_voyages` (metadata only, free): its release label
 * and lastModifiedTime say whether Climate TRACE changed the table since the live bake (ships/ct-voyages/latest.json).
 *
 * publish, in order (any failure stops it, and the previous bake keeps serving):
 *   1. Gates against the live bake: rows, ships and matched stays may not shrink by more than 5 / 5 / 10 %, the start dates
 *      may not end earlier, and must still begin in Jan 2024.
 *   2. Stays → terminals with PRODUCTION's own berths (api/ships op=ctStayBerths), the same rule as import-ct-stays.mjs.
 *   3. Uploads the two packs, the matched stays and the manifest to ships/ct-voyages/<version>/ with one-file tokens from
 *      api/cron/ships-upload-token.js (CRON_SECRET; CI never holds the Blob token), each verified at full size.
 *   4. api/ships op=importCtStays stores the stays version (bake record + rows in one transaction: the terminal cards switch).
 *   5. Writes latest.json (the ship cards' packs switch within 5 minutes, api/ship-tracks.js ctVoyagesNow).
 * Env: CRON_SECRET; FORCE=1 (check says new); SHIPS_API / SHIPS_TOKEN_URL / SHIPS_BLOB_BASE (default production);
 * DRY_RUN=1 (publish stops after step 2, writing the matched stays to the build dir).
 */
import { readFileSync, writeFileSync, statSync, createReadStream, appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { put } from '@vercel/blob/client'
import { planCtStays, notCoveredTerminals, CT_PULL_BOX } from '../../../lib/ships/ctStays.js'

const API = process.env.SHIPS_API || 'https://earthatlas.org/api/ships'
const TOKEN_URL = process.env.SHIPS_TOKEN_URL || 'https://earthatlas.org/api/cron/ships-upload-token'
const BLOB_BASE = process.env.SHIPS_BLOB_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const POINTER = 'ships/ct-voyages/latest.json'
// The hand-run v3 bake (2026-09-29) that serves until the first automated one: the gates' baseline.
const V3 = { version: 'v3', rows: 964517, startDates: { from: '2024-01-01', to: '2025-12-31' }, ships: { mmsi: 10284, imo: 5533 }, matched: 60108 }
const auth = () => {
  if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET missing')
  return { authorization: `Bearer ${process.env.CRON_SECRET}` }
}
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`) }

async function livePointer() {
  const r = await fetch(`${BLOB_BASE}/${POINTER}?t=${Date.now()}`, { cache: 'no-store' })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`reading ${POINTER}: HTTP ${r.status}`)
  return r.json()
}
function tableOf(file) {
  const t = JSON.parse(readFileSync(file, 'utf8'))
  const release = t.labels?.release
  if (!release || !t.lastModifiedTime) throw new Error(`${file}: no release label / lastModifiedTime`)
  return { release, modified: new Date(Number(t.lastModifiedTime)).toISOString(), rows: Number(t.numRows) }
}

async function check(tableFile) {
  const table = tableOf(tableFile), live = await livePointer()
  const fresh = !live || live.table?.release !== table.release || live.table?.modified !== table.modified
  console.log(`Climate TRACE table: release ${table.release}, modified ${table.modified}; live bake: ${live ? `${live.version} (release ${live.table?.release}, modified ${live.table?.modified})` : `none (trackSource.json ${V3.version})`}`)
  const go = fresh || process.env.FORCE === '1'
  console.log(go ? (fresh ? 'new → bake' : 'unchanged, FORCE=1 → bake') : 'unchanged → nothing to do')
  out('new', go ? 'true' : 'false')
}

async function tokenFor(pathname) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}
// Same as scripts/ships/bake-gfw/publish.mjs upload(): put, then read the last byte back to prove the full size is public.
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

function gate(m, summary, prev) {
  const bad = []
  if (m.startDates.from !== '2024-01-01') bad.push(`start dates begin ${m.startDates.from}, not 2024-01-01`)
  if (m.startDates.to < prev.startDates.to) bad.push(`start dates end ${m.startDates.to}, before the live bake's ${prev.startDates.to}`)
  if (m.rows < 0.95 * prev.rows) bad.push(`${m.rows} rows vs ${prev.rows} live`)
  for (const k of ['mmsi', 'imo']) if (m.packs[k].ships < 0.95 * prev.ships[k]) bad.push(`${m.packs[k].ships} ${k} ships vs ${prev.ships[k]} live`)
  if (summary.matched < 0.9 * prev.matched) bad.push(`${summary.matched} stays matched vs ${prev.matched} live`)
  if (bad.length) throw new Error(`gates refused this bake (the live one keeps serving):\n  ${bad.join('\n  ')}`)
}

async function publish(dir, tableFile) {
  const table = tableOf(tableFile)
  const m = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'))
  const version = m.version.replace(/^ct-voyages-/, '')
  if (!/^v\d+-\d{12}$/.test(version)) throw new Error(`version ${version}: expected v<N>-YYYYMMDDHHMM`)
  if (m.release !== table.release) throw new Error(`bake says release ${m.release}, table says ${table.release}`)
  const live = await livePointer()
  const prev = live || V3
  console.log(`bake ${version}: ${m.rows.toLocaleString()} rows, start dates ${m.startDates.from} – ${m.startDates.to}, release ${m.release}; live ${prev.version}`)

  // 2. Stays → terminals against production's berths.
  const br = await fetch(`${API}?op=ctStayBerths`, { headers: auth() })
  if (!br.ok) throw new Error(`berths: HTTP ${br.status}`)
  const { berths } = await br.json()
  const stays = readFileSync(resolve(dir, `ct-stays-${version}.ndjson`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const { matched, summary } = planCtStays(stays, berths)
  console.log(`${summary.stays.toLocaleString()} stays → ${summary.matched.toLocaleString()} matched at ${Object.keys(summary.byTerminal).length} terminals `
    + `(${berths.length} berths); ${summary.ambiguous} ambiguous, ${summary.disagree} disagree, ${summary.none.toLocaleString()} not near a terminal`)
  const matchedFile = resolve(dir, 'ct-stays-matched.ndjson.gz')
  writeFileSync(matchedFile, gzipSync(Buffer.from(matched.map((s) => JSON.stringify(s)).join('\n') + '\n')))
  gate(m, summary, prev)
  if (process.env.DRY_RUN === '1') { console.log(`DRY_RUN: gates passed; ${matchedFile} written; nothing uploaded`); return }

  // 3. Upload.
  const folder = `ships/ct-voyages/${version}`
  const urls = {
    mmsi: await upload(`${folder}/ct-voyages-mmsi.pack`, resolve(dir, m.packs.mmsi.file), 'application/octet-stream'),
    imo: await upload(`${folder}/ct-voyages-imo.pack`, resolve(dir, m.packs.imo.file), 'application/octet-stream'),
    matched: await upload(`${folder}/ct-stays-matched.ndjson.gz`, matchedFile, 'application/gzip'),
    manifest: await upload(`${folder}/manifest.json`, resolve(dir, 'manifest.json'), 'application/json'),
  }

  // 4. Stays into production's database.
  const bakedAt = new Date().toISOString()
  const bake = { release: m.release, pulled: m.pulled, bakedAt, area: m.area, pullBox: CT_PULL_BOX, startDates: m.startDates,
    input: { ...m.input, query: 'scripts/ships/bake-ct-voyages/pull.sql', table }, notCovered: notCoveredTerminals(berths),
    berths: berths.map(({ terminal, key, lat, lon }) => ({ terminal, berth: key, lat, lon })) }
  const ir = await fetch(`${API}?op=importCtStays`, { method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
    body: JSON.stringify({ version: `ct-stays-${version}`, url: urls.matched, bake, summary }) })
  const ij = await ir.json().catch(() => ({}))
  if (!ir.ok) throw new Error(`importCtStays: HTTP ${ir.status} ${ij.error || ''}`)
  console.log(`stays stored: ${ij.rows} rows (record ${ij.recordId}); ${ij.pruned} rows of older versions deleted`)

  // 5. Flip the pointer.
  const pointer = { version, mmsi: urls.mmsi, imo: urls.imo, manifest: urls.manifest, release: m.release, pulled: m.pulled, bakedAt,
    startDates: m.startDates, rows: m.rows, ships: { mmsi: m.packs.mmsi.ships, imo: m.packs.imo.ships }, stays: m.stays,
    matched: summary.matched, staysVersion: `ct-stays-${version}`, table, previous: prev.version }
  await put(POINTER, JSON.stringify(pointer, null, 1), { access: 'public', token: await tokenFor(POINTER), contentType: 'application/json' })
  const check = await livePointer()
  if (check?.version !== version) throw new Error(`pointer reads ${check?.version}, expected ${version}`)
  console.log(`live: ${version} (start dates ${m.startDates.from} – ${m.startDates.to})`)
}

const [cmd, a, b] = process.argv.slice(2)
try {
  if (cmd === 'check' && a) await check(a)
  else if (cmd === 'publish' && a && b) await publish(a, b)
  else { console.error('usage: publish.mjs check <table.json> | publish <build dir> <table.json>'); process.exit(2) }
} catch (e) { console.error(e.message); process.exit(1) }
