#!/usr/bin/env node
/**
 * BC permits pilot (lib/ships/bcPermits.js; data: the 'bc-…' entries of lib/ships/data/salish-facilities.json) → ships evidence
 * + claims. SHIPS_DATABASE_URL from .env.local (dev); production via `zsh scripts/ships/prod.sh import-bc-permits`. The terminals must exist (ships:import-terminals). Idempotent.
 *
 *   npm run ships:import-bc-permits -- [--schema <name>] [--only <facility id>] [--dry-run] [--refresh] [--refresh-mv]
 *
 * Requests (one at a time, 1.5 s apart, retried 4 times; every response cached in scripts/ships/facilities/cache/, gitignored,
 * and reused, so a re-run makes none; --refresh re-fetches):
 *   - the BC EMA authorizations register all_ams_authorizations.xlsx (1.7 MB), once for all facilities;
 *   - per facility: each NRCED search in bc.nrced.searches (50 records a page; stops after --max-pages pages, default 2, and says so);
 *   - per facility: each EAO EPIC project search in bc.eao.searches;
 *   - Metro Vancouver air quality permit documents named in bc.mv (scripts/ships/mv-fetch.mjs: known URLs only, ≥ 2 s apart).
 * All 33 BC facilities ≈ 1 + 35 NRCED + 41 EAO ≈ 77 requests on an empty cache (the 2026-10-07 rollout made 64 new ones plus 3 page reads to confirm addresses; the pilot's were cached).
 * --dry-run also prints the register rows near each facility's berths (or with its company words) to hand-check bc.ema.
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import { loadFacilityData, validateFacilityData, FACILITIES_LIST_SOURCE } from '../../lib/ships/facilities.js'
import { sharedStrings, sheetRows, rowsToObjects } from '../../lib/ships/xlsx.js'
import {
  EMA_XLSX_URL, emaFieldsAll, emaCandidates, nrcedSearchUrl, nrcedRecords, nrcedMatch, nrcedRow, eaoSearchUrl, eaoProjects, eaoRow,
  ensureBcSources, importBcFacilities,
} from '../../lib/ships/bcPermits.js'
import { importMvPermits } from '../../lib/ships/metroVancouver.js'
import { mvDoc, counter as mvCounter } from './mv-fetch.mjs'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships)'
const CACHE = 'scripts/ships/facilities/cache'
const MAX_PAGES = Number(process.argv.includes('--max-pages') ? process.argv[process.argv.indexOf('--max-pages') + 1] : 2)
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const only = opt('only'), dry = args.includes('--dry-run'), refresh = args.includes('--refresh')
// Metro Vancouver replaces permit files in place (same URL, new content): --refresh-mv re-reads only the Metro Vancouver documents the
// entries name (about 30 requests); a changed file becomes a new evidence version, an unchanged one creates nothing.
const refreshMv = args.includes('--refresh-mv')
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

async function cachedJson(name, url) {
  const file = path.join(CACHE, `${name.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
  if (!refresh) { try { return JSON.parse(await readFile(file, 'utf8')) } catch {} }
  const text = await (await fetchRetry(url)).text()
  if (!/^\s*[[{]/.test(text)) throw new Error(`${name}: not JSON (${url})`)
  const out = { url, retrieved_at: new Date().toISOString(), body: JSON.parse(text) }
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, JSON.stringify(out))
  return out
}

/** The register file (downloaded once) → { url, retrieved_at, objects }. */
async function emaRegister() {
  const file = path.join(CACHE, 'bc-ema-all_ams_authorizations.xlsx'), meta = path.join(CACHE, 'bc-ema-all_ams_authorizations.meta.json')
  let m = null
  if (!refresh) { try { await stat(file); m = JSON.parse(await readFile(meta, 'utf8')) } catch {} }
  if (!m) {
    const buf = Buffer.from(await (await fetchRetry(EMA_XLSX_URL)).arrayBuffer())
    await mkdir(CACHE, { recursive: true })
    await writeFile(file, buf)
    m = { url: EMA_XLSX_URL, retrieved_at: new Date().toISOString(), bytes: buf.length }
    await writeFile(meta, JSON.stringify(m))
  }
  const un = (p) => execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 30 }).toString('utf8')
  const ss = sharedStrings(un('xl/sharedStrings.xml'))
  // The register sheet is the one whose header starts "Authorization Number" (the workbook also holds an empty Sheet1).
  for (const n of [1, 2, 3]) {
    let rows
    try { rows = sheetRows(un(`xl/worksheets/sheet${n}.xml`), ss) } catch { continue }
    if (rows[0]?.[0] === 'Authorization Number') return { ...m, objects: rowsToObjects(rows) }
  }
  throw new Error('register sheet not found in all_ams_authorizations.xlsx')
}

const data = await loadFacilityData()
const errs = validateFacilityData(data)
if (errs.length) { console.error(`facility data invalid:\n  ${errs.join('\n  ')}`); process.exit(1) }
const bcData = { ...data, facilities: data.facilities.filter((f) => f.country === 'CA' && (!only || f.id === only)) }
if (!bcData.facilities.length) { console.error('no BC facility selected'); process.exit(1) }

const reg = await emaRegister()
console.log(`BC EMA register: ${reg.objects.length} rows (${reg.url}, read ${reg.retrieved_at.slice(0, 10)})`)
const raw = { ema: { url: reg.url, retrieved_at: reg.retrieved_at, rows: new Map() }, nrced: new Map(), eao: new Map() }
// One authorization can fill several rows (one per waste type): keep them all.
for (const o of reg.objects) {
  const id = String(o['Authorization Number']).trim()
  if (!raw.ema.rows.has(id)) raw.ema.rows.set(id, [])
  raw.ema.rows.get(id).push(o)
}

for (const f of bcData.facilities) {
  console.log(`\n${f.id} (${f.name})`)
  const accepted = new Set(f.bc.ema.accepted.map((a) => String(a.id))), left = new Set((f.bc.ema.left_out || []).map((a) => String(a.id)))
  for (const a of f.bc.ema.accepted) {
    const r = raw.ema.rows.get(String(a.id))
    console.log(`  EMA ${a.id}: ${r ? (({ type, company, state, waste, address }) => `${type} | ${company} | ${state} | ${waste} | ${address}`)(emaFieldsAll(r)) : 'NOT IN THE REGISTER'}`)
  }
  if (dry) {
    for (const e of emaCandidates(reg.objects, f.bc.ema.berths, f.bc.ema.company_words, f.bc.ema.radius_m)) {
      const tag = accepted.has(e.id) ? 'ACCEPTED ' : left.has(e.id) ? 'left out ' : 'UNREVIEWED'
      console.log(`    ${tag} ${e.id} ${e.distance_m ?? '?'} m | ${e.type} | ${e.company} | ${e.state} | ${e.address}`)
    }
  }
  const emaIds = [...accepted]
  const searches = []
  for (const kw of f.bc.nrced.searches) {
    const recs = []
    let total = 0, url = null, retrieved = null
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) { console.log(`  ! NRCED "${kw}": ${total} records, more than ${MAX_PAGES} pages read — stopped; narrow the search`); break }
      const got = await cachedJson(`bc-nrced-${kw}-p${page}`, nrcedSearchUrl(kw, page))
      const r = nrcedRecords(got.body)
      if (r.error) throw new Error(`NRCED "${kw}" p${page}: ${r.error}`)
      total = r.total; url ??= got.url; retrieved ??= got.retrieved_at
      recs.push(...r.records)
      if (!r.records.length || recs.length >= total) break
    }
    searches.push({ search: kw, url, retrieved_at: retrieved, total, records: recs })
    const tally = { accepted: 0, candidate: 0, ignored: 0 }
    for (const rec of recs) {
      const m = nrcedMatch(f, rec, emaIds)
      tally[m.status ?? 'ignored']++
      if (dry && m.status) { const x = nrcedRow(rec); console.log(`    NRCED ${m.status.padEnd(9)} ${x.date} ${x.kind} | ${x.issuedTo} | ${x.location} | auth ${x.authorization} | ${x.outcome}`) }
    }
    console.log(`  NRCED "${kw}": ${total} records → accepted ${tally.accepted}, candidate ${tally.candidate}, other parties ${tally.ignored}`)
  }
  raw.nrced.set(f.id, searches)
  const eao = []
  for (const kw of f.bc.eao.searches) {
    const got = await cachedJson(`bc-eao-${kw}`, eaoSearchUrl(kw))
    const projects = eaoProjects(got.body)
    eao.push({ search: kw, url: got.url, retrieved_at: got.retrieved_at, projects })
    console.log(`  EAO "${kw}": ${projects.length} projects${projects.length ? `: ${projects.map((p) => `${eaoRow(p).name} (${eaoRow(p).proponent})`).join('; ')}` : ''}`)
  }
  raw.eao.set(f.id, eao)
}
// Metro Vancouver air quality permits (bc.mv): every document the entries name, from the cache (fetched once when missing).
const mvDocs = new Map()
for (const f of bcData.facilities) {
  const mv = f.bc.mv
  if (mv?.jurisdiction !== 'in') { console.log(`  ${f.id} Metro Vancouver: ${mv?.jurisdiction === 'outside' ? 'outside its region' : 'no bc.mv block'}`); continue }
  for (const p of mv.permits || []) {
    for (const u of [p.doc_url, p.application_url, p.notice_url, ...(p.extra_docs || []).map((x) => x.url)].filter(Boolean)) {
      try { mvDocs.set(u, await mvDoc(u, { refresh: refresh || refreshMv })) } catch (e) { console.log(`  ! ${f.id} ${p.gva}: ${e.message}`) }
    }
  }
  console.log(`  ${f.id} Metro Vancouver: ${(mv.permits || []).map((p) => `${p.gva} (${p.status})`).join(', ') || 'none found'}`)
}
console.log(`\nrequests made this run: ${requests} (BC APIs) + ${mvCounter.requests} (Metro Vancouver)`)
if (dry) { console.log('dry run: nothing written'); process.exit(0) }

const pool = shipsPool()
try {
  console.log(`writing to schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}`)
  await withTx(pool, (c) => ensureBcSources(c, schema))
  const runId = await withTx(pool, (c) => startRun(c, schema, FACILITIES_LIST_SOURCE.id, { version: data.version, only: only ?? null, bc: true }))
  try {
    const r = await withTx(pool, (c) => importBcFacilities(c, schema, bcData, raw, { runId, partial: Boolean(only) }))
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: { ...r, problems: r.problems.length }, datasetVersion: data.version }))
    console.log(JSON.stringify({ ...r, problems: r.problems.length }))
    for (const p of r.problems) console.log(`  ! ${p}`)
    const mv = await withTx(pool, (c) => importMvPermits(c, schema, bcData, mvDocs, { runId }))
    console.log(`Metro Vancouver: ${JSON.stringify({ ...mv, problems: mv.problems.length })}`)
    for (const p of mv.problems) console.log(`  ! ${p}`)
  } catch (e) {
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats: {}, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
} finally { await pool.end() }
