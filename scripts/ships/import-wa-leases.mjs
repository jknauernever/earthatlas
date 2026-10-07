#!/usr/bin/env node
/**
 * WA DNR aquatic land use authorizations + the Whatcom County shoreline-permit pilot at our WA terminals' docks
 * (lib/ships/dnrLeases.js, lib/ships/countyShoreline.js; hand-checked data lib/ships/data/wa-leases-sites.json) → ships evidence +
 * terminal_land_records. SHIPS_DATABASE_URL from .env.local (dev). The terminals must exist (ships:import-terminals). Idempotent.
 *
 *   npm run ships:import-wa-leases -- [--schema <name>] [--only <terminal id>] [--dry-run] [--refresh]
 *
 * Requests (one at a time, 1.5 s apart, retried 4 times; cached in scripts/ships/facilities/cache/dnr-gis and …/county, gitignored,
 * reused, so a re-run makes none; --refresh re-fetches): DNR AQ_ENC_Public_Prod layers 1, 3, 2 and 25 = 4 counts + 6 pages of 2,000
 * (≈ 10 requests on an empty cache, ≈ 6 MB); one notice PDF per county.shoreline entry (2). SEPA Register records are read from the
 * facility import's cache (sepa-record-<n>.json) and fetched only if missing.
 * --dry-run prints, per terminal, the DNR records near its berths and the nearest port management area, next to what the data file
 * accepts, for hand review; nothing is written.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun, upsertSource } from '../../lib/ships/store.js'
import {
  DNR_SOURCE, DNR_PMA_LAYER, layerPageUrl, countUrl, buildIndex, useCandidates, nearestPma, validateLeaseSites, loadLeaseSites, importDnrLeases,
} from '../../lib/ships/dnrLeases.js'
import { validateShorelineEntry, importCountyShoreline } from '../../lib/ships/countyShoreline.js'
import { sepaRecordUrl } from '../../lib/ships/facilities.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships)'
const CACHE = 'scripts/ships/facilities/cache'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const only = opt('only'), dry = args.includes('--dry-run'), refresh = args.includes('--refresh')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let requests = 0

async function fetchRetry(url) {
  for (let i = 1; ; i++) {
    await sleep(1500)
    requests++
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res
    } catch (e) {
      if (i >= 4) throw new Error(`${e.message} (${url})`)
      console.warn(`  ${e.message}; retry ${i}`)
      await sleep(5000 * i)
    }
  }
}

/** A DNR query JSON, cached as { url, retrieved_at, body }. A raw page cached by the 2026-10-07 study (enc-L…json) is reused. */
async function dnrJson(name, url, rawName = null) {
  const file = path.join(CACHE, 'dnr-gis', `${name}.json`)
  if (!refresh) {
    try { return JSON.parse(await readFile(file, 'utf8')) } catch {}
    if (rawName) {
      try {
        const raw = path.join(CACHE, 'dnr-gis', rawName)
        const out = { url, retrieved_at: (await stat(raw)).mtime.toISOString(), body: JSON.parse(await readFile(raw, 'utf8')) }
        await writeFile(file, JSON.stringify(out))
        return out
      } catch {}
    }
  }
  const body = await (await fetchRetry(url)).json()
  if (body.error) throw new Error(`${name}: ${JSON.stringify(body.error)}`)
  const out = { url, retrieved_at: new Date().toISOString(), body }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(out))
  return out
}

async function dnrPages() {
  const pages = []
  let retrieved = null
  for (const layer of [1, 3, 2, DNR_PMA_LAYER]) {
    const { body: { count } } = await dnrJson(`dnr-count-${layer}`, countUrl(layer), `count-${layer}.json`)
    for (let off = 0; off < count; off += 2000) {
      const pg = await dnrJson(`dnr-L${layer}-o${off}`, layerPageUrl(layer, off), `enc-L${layer}-o${off}.json`)
      if ((pg.body.features || []).length === 0) throw new Error(`layer ${layer} offset ${off}: empty page`)
      pages.push({ layer, body: pg.body })
      retrieved = [retrieved, pg.retrieved_at.slice(0, 10)].filter(Boolean).sort()[0]
    }
    const got = pages.filter((p) => p.layer === layer).reduce((n, p) => n + p.body.features.length, 0)
    if (got !== count) throw new Error(`layer ${layer}: ${got} features read, count says ${count}`)
    console.log(`DNR layer ${layer}: ${count} features`)
  }
  return { pages, retrieved }
}

async function sepaPage(n) {
  const file = path.join(CACHE, `sepa-record-${n}.json`)
  if (!refresh) { try { return JSON.parse(await readFile(file, 'utf8')) } catch {} }
  const url = sepaRecordUrl(n)
  const html = await (await fetchRetry(url)).text()
  const out = { url, retrieved_at: new Date().toISOString(), html }
  await writeFile(file, JSON.stringify(out))
  return out
}

async function noticeDoc(url, name) {
  const file = path.join(CACHE, 'county', `${name}.pdf`), meta = path.join(CACHE, 'county', `${name}.meta.json`)
  let m = null
  if (!refresh) { try { await stat(file); m = JSON.parse(await readFile(meta, 'utf8')) } catch {} }
  if (!m) {
    let buf
    try { if (refresh) throw new Error('refresh'); buf = await readFile(file) } catch { buf = Buffer.from(await (await fetchRetry(url)).arrayBuffer()) }
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, buf)
    m = { url, retrieved_at: (await stat(file)).mtime.toISOString(), bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
    await writeFile(meta, JSON.stringify(m))
  }
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { maxBuffer: 1 << 28 }).toString('utf8')
  return { ...m, text }
}

const data = await loadLeaseSites()
const terminalsFile = JSON.parse(await readFile('lib/ships/data/salish-terminals.json', 'utf8'))
const osm = JSON.parse(await readFile('lib/ships/data/salish-terminals-osm.json', 'utf8'))
// Berths: the curated ones, plus the OSM-derived berth points the terminal names (osm_berths) when it has no curated berth.
const terminals = terminalsFile.terminals.map((t) => ({ ...t, berths: t.berths?.length ? t.berths
  : osm.berths.filter((b) => b.terminal === t.id && (t.osm_berths || []).includes(b.key)).map((b) => ({ key: b.key, lat: b.lat, lon: b.lon })) }))
const errs = [...validateLeaseSites(data, terminals),
  ...Object.entries(data.terminals).flatMap(([k, e]) => (e.county?.shoreline || []).flatMap((s) => validateShorelineEntry(k, s)))]
if (errs.length) { console.error(`wa-leases-sites.json invalid:\n  ${errs.join('\n  ')}`); process.exit(1) }

const { pages, retrieved } = await dnrPages()
const index = buildIndex(pages)

if (dry) {
  for (const t of terminals.filter((x) => x.country === 'US' && (!only || x.id === only))) {
    const e = data.terminals[t.id]
    const acc = new Set((e.dnr.uses || []).map((u) => u.lease))
    console.log(`\n${t.id} (${t.operator})${e.dnr.none ? `  none: ${e.dnr.none}` : ''}`)
    for (const c of useCandidates(t, index, 1).slice(0, 8)) {
      console.log(`  ${acc.has(c.lease) ? 'ACCEPTED ' : '         '} ${c.lease} ${c.typeName} ${c.statusWords} since ${c.effective ?? '?'} ${c.km.toFixed(2)} km | ${c.lessee}`)
    }
    const p = nearestPma(t, index)
    if (p) console.log(`  ${e.dnr.pma ? 'ACCEPTED ' : '         '} PMA ${p.payload.attributes.LEASE_JKT_NO} area ${p.payload.attributes.OBJECTID} ${p.metres === 0 ? 'inside' : `${Math.round(p.metres)} m`}`)
  }
}

const sepaPages = new Map(), notices = new Map()
for (const [k, e] of Object.entries(data.terminals)) {
  if (only && k !== only) continue
  for (const s of e.county?.shoreline || []) {
    for (const n of s.sepa) sepaPages.set(n, await sepaPage(n))
    notices.set(s.notice_doc, await noticeDoc(s.notice_doc, `${e.county.county.toLowerCase()}-${s.file}-noa`))
  }
}
console.log(`\nrequests made this run: ${requests}`)
if (dry) { console.log('dry run: nothing written'); process.exit(0) }

const pool = shipsPool()
try {
  console.log(`writing to schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
  const runId = await withTx(pool, async (c) => { await upsertSource(c, schema, DNR_SOURCE); return startRun(c, schema, DNR_SOURCE.id, { version: data.version, only: only ?? null }) })
  try {
    const r = await withTx(pool, (c) => importDnrLeases(c, schema, data, index, terminals, { runId, retrieved, only }))
    console.log(`DNR: ${JSON.stringify({ ...r, problems: r.problems.length })}`)
    for (const p of r.problems) console.log(`  ! ${p}`)
    const cs = await withTx(pool, (c) => importCountyShoreline(c, schema, data, sepaPages, notices, { runId, only }))
    console.log(`County shoreline: ${JSON.stringify({ ...cs, problems: cs.problems.length })}`)
    for (const p of cs.problems) console.log(`  ! ${p}`)
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: { dnr: { ...r, problems: r.problems.length }, county: { ...cs, problems: cs.problems.length } }, datasetVersion: retrieved }))
  } catch (e) {
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats: {}, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
} finally { await pool.end() }
