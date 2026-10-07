#!/usr/bin/env node
/**
 * Facilities pilot (lib/ships/facilities.js; data lib/ships/data/salish-facilities.json) → ships evidence + claims.
 * DEV database only unless Josh says otherwise (SHIPS_DATABASE_URL from .env.local). Run ships:import-terminals first (the
 * terminals and their Climate TRACE refinery records must exist). Idempotent.
 *
 *   npm run ships:import-facilities -- [--schema <name>] [--only <facility id>] [--dry-run] [--refresh] [--refresh-paris]
 *
 * Requests (all small, one at a time, 1.5 s apart): one ECHO Detailed Facility Report per FRS id the data file names
 * (BP 6, Marathon 11); each SEPA Register search (50 per page, every page); one SEPA record page per search hit whose
 * county matches the facility; documents (layer 1, lib/ships/permitDocuments.js): one PARIS document list per NPDES permit
 * number (every page), the facility's Ecology Industrial Section page, and NWCAA's Air Operating Permits page (once);
 * SEPA per permit (lib/ships/permitSepa.js, migration 031): one permit document per permit read for SEPA (newest final fact sheet,
 * Ecology support document, or the Air Operating Permit; scripts/ships/doc-fetch.mjs) and one SEPA Register "All text" search per
 * water / state / hazardous-waste permit number, plus the record page of each hit. The Register answers a search in ~20 s.
 * Every response is cached in scripts/ships/facilities/cache/ (gitignored) and reused on the
 * next run, so a re-run makes no requests; --refresh re-fetches. ECHO returns intermittent 503s: retried 4 times.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx } from '../../lib/ships/db.js'
import { startRun, finishRun } from '../../lib/ships/store.js'
import {
  loadFacilityData, validateFacilityData, ensureFacilitySources, importFacilities, importCoverage, frsIdsOf, dfrUrl, dfrPermits,
  sepaSearchUrl, sepaRecordUrl, parseSepaSearch, parseSepaRecord, sepaMatch, FACILITIES_LIST_SOURCE,
} from '../../lib/ships/facilities.js'
import {
  ensureDocumentSources, importPermitDocuments, parisDocsUrl, parseParisDocs, parisPostbackFields, parseEcologyPage, parseNwcaaRow,
  ECOLOGY_INDUSTRIAL_BASE, NWCAA_AOP_URL, PSCAA_TITLE_V_URL, parsePscaaRow, parisFacilityUrl, parseParisFacility, gridPostbackFields, importParisFacilities,
} from '../../lib/ships/permitDocuments.js'
import { planPermitSepa, importPermitSepa } from '../../lib/ships/permitSepaDb.js'
import { permitDoc, counter as docCounter } from './doc-fetch.mjs'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships; facility permits pilot)'
const CACHE = 'scripts/ships/facilities/cache'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const only = opt('only'), dry = args.includes('--dry-run'), refresh = args.includes('--refresh'), refreshParis = args.includes('--refresh-paris')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let requests = 0

async function cached(name, url, kind) {
  const file = path.join(CACHE, `${name.replace(/[^A-Za-z0-9_.-]/g, '_')}.json`)
  if (!refresh) { try { return JSON.parse(await readFile(file, 'utf8')) } catch {} }
  for (let i = 1; ; i++) {
    await sleep(1500)
    requests++
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const out = { url, retrieved_at: new Date().toISOString() }
      if (kind === 'json') { if (!text.trimStart().startsWith('{')) throw new Error('not JSON'); out.body = JSON.parse(text) } else out.html = text
      await mkdir(CACHE, { recursive: true })
      await writeFile(file, JSON.stringify(out))
      return out
    } catch (e) {
      if (i >= 4) throw new Error(`${name}: ${e.message} (${url})`)
      console.warn(`  ${name}: ${e.message}; retry ${i}`)
      await sleep(5000 * i)
    }
  }
}

const data = await loadFacilityData()
// Washington entries only; BC entries (country CA) are imported by scripts/ships/import-bc-permits.mjs.
data.facilities = data.facilities.filter((f) => f.country !== 'CA')
if (only) data.facilities = data.facilities.filter((f) => f.id === only)
const errs = validateFacilityData(data)
if (errs.length || !data.facilities.length) { console.error(`facility data invalid:\n  ${errs.join('\n  ') || 'no facility'}`); process.exit(1) }

const raw = { dfr: new Map(), sepa: new Map(), sepaHits: new Map(), ctRecordIds: new Map() }
for (const f of data.facilities) {
  for (const frs of frsIdsOf(f)) {
    const d = await cached(`dfr-${frs}`, dfrUrl(frs), 'json')
    raw.dfr.set(frs, d)
    const m = dfrPermits(d.body)
    console.log(`  ${f.id} FRS ${frs}: ${m.error ?? `${m.name} — ${m.permits.length} program records`}`)
  }
  // SEPA: every page of every search; record pages only for hits in the facility's county.
  const hits = new Map()
  for (const s of f.sepa.searches) {
    let page = 1, last = 1
    do {
      const r = parseSepaSearch((await cached(`sepa-search-${s.field}-${s.text}-p${page}`, sepaSearchUrl(s.field, s.text, page), 'html')).html)
      last = r.lastPage
      for (const row of r.rows) {
        if (String(row.county || '').toUpperCase() !== f.sepa.county) continue
        if (!hits.has(row.sepa)) hits.set(row.sepa, { sepa: row.sepa, searches: [] })
        hits.get(row.sepa).searches.push(`${s.field}: ${s.text}`)
      }
    } while (++page <= last)
  }
  for (const h of hits.values()) raw.sepa.set(h.sepa, await cached(`sepa-record-${h.sepa}`, sepaRecordUrl(h.sepa), 'html'))
  raw.sepaHits.set(f.id, [...hits.values()])
  const tally = { accepted: 0, candidate: 0 }
  for (const h of hits.values()) {
    const r = parseSepaRecord(raw.sepa.get(h.sepa).html)
    const m = r.error ? { status: 'candidate' } : sepaMatch(f, r)
    tally[m.status]++
    if (dry) console.log(`    SEPA ${h.sepa} ${m.status.padEnd(9)} ${r.issued} ${r.type} | ${r.lead} | ${r.applicant} | ${r.proposalName}`)
  }
  console.log(`  ${f.id}: SEPA hits in ${f.sepa.county} ${hits.size} → accepted ${tally.accepted}, candidate ${tally.candidate}`)
}
// ── Documents (layer 1: lists + links) ──
/** A PARIS FacilityDetails page with its documents from every pager page (GridView postbacks, one at a time). */
async function parisFacility(id) {
  const file = path.join(CACHE, `paris-facility-${id}.json`)
  if (!refresh && !refreshParis) {
    try { const c = JSON.parse(await readFile(file, 'utf8')); if (c.page?.violations) return c } catch {}   // older caches lack the grids
  }
  const url = parisFacilityUrl(id)
  let cookie = ''
  const get = async (init = {}) => {
    for (let i = 1; ; i++) {
      await sleep(1500)
      requests++
      try {
        const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) } })
        const sc = res.headers.getSetCookie?.() || []
        if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.text()
      } catch (e) {
        if (i >= 4) throw new Error(`PARIS facility ${id}: ${e.message}`)
        await sleep(5000 * i)
      }
    }
  }
  let html = await get()
  const page = parseParisFacility(html)
  const seen = new Set(page.documents.map((d) => d.doc_id))
  for (let n = 2; n < 200; n++) {
    const next = parseParisFacility(html).pages.find((x) => x.page === n)
    if (!next) break
    html = await get({ method: 'POST', body: new URLSearchParams(gridPostbackFields(html, next.target, next.arg)),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const more = parseParisFacility(html).documents.filter((d) => !seen.has(d.doc_id))
    if (!more.length) break
    for (const d of more) { seen.add(d.doc_id); page.documents.push(d) }
  }
  // Violations grid: its own pager (each postback page carries the other grids at page 1). Restart from page 1's form.
  html = await get()
  const vseen = new Set(page.violations.map((v) => JSON.stringify(v)))
  for (let n = 2; n < 400; n++) {
    const next = parseParisFacility(html).violationPages.find((x) => x.page === n)
    if (!next) break
    html = await get({ method: 'POST', body: new URLSearchParams(gridPostbackFields(html, next.target, next.arg)),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    const more = parseParisFacility(html).violations.filter((v) => !vseen.has(JSON.stringify(v)))
    if (!more.length) break
    for (const v of more) { vseen.add(JSON.stringify(v)); page.violations.push(v) }
  }
  page.pages = []
  page.violationPages = []
  const out = { url, retrieved_at: new Date().toISOString(), page }
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, JSON.stringify(out))
  return out
}

async function parisDocs(permit) {
  const file = path.join(CACHE, `paris-docs-${permit}.json`)
  if (!refresh) { try { return JSON.parse(await readFile(file, 'utf8')) } catch {} }
  const url = parisDocsUrl(permit)
  let cookie = ''
  const get = async (init = {}) => {
    for (let i = 1; ; i++) {
      await sleep(1500)
      requests++
      try {
        const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}), ...(init.headers || {}) } })
        const sc = res.headers.getSetCookie?.() || []
        if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return await res.text()
      } catch (e) {
        if (i >= 4) throw new Error(`PARIS ${permit}: ${e.message}`)
        await sleep(5000 * i)
      }
    }
  }
  const first = await get()
  const p1 = parseParisDocs(first)
  const rows = [...p1.rows]
  for (const pg of p1.pages.filter((x) => x.page > 1)) {
    const html = await get({ method: 'POST', body: new URLSearchParams(parisPostbackFields(first, pg.target)),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    for (const r of parseParisDocs(html).rows) if (!rows.some((x) => x.doc_id === r.doc_id)) rows.push(r)
  }
  const out = { url, retrieved_at: new Date().toISOString(), total: p1.total, rows }
  await mkdir(CACHE, { recursive: true })
  await writeFile(file, JSON.stringify(out))
  return out
}
const docsRaw = { paris: new Map(), ecology: new Map(), nwcaa: null, parisFac: new Map(), parisCovered: new Set() }
for (const f of data.facilities) {
  for (const id of f.paris_facility_ids || []) {
    const got = await parisFacility(id)
    docsRaw.parisFac.set(id, got)
    for (const p of got.page.permits) docsRaw.parisCovered.add(p.permit)
    console.log(`  ${f.id} PARIS facility ${id} (${got.page.name}): ${new Set(got.page.permits.map((p) => p.permit)).size} permits, ${got.page.documents.length} documents`)
  }
}
for (const f of data.facilities) {
  const npdes = new Set()
  for (const frs of frsIdsOf(f)) for (const p of dfrPermits(raw.dfr.get(frs).body).permits || []) if (p.epa_system === 'ICIS-NPDES') npdes.add(p.permit_key)
  for (const k of npdes) {
    if (docsRaw.parisCovered.has(k)) continue   // listed on a PARIS facility page already
    const d = await parisDocs(k)
    docsRaw.paris.set(k, d)
    console.log(`  ${f.id} PARIS ${k}: ${d.rows.length} of ${d.total} documents`)
  }
  if (f.documents?.ecology_page) {
    const pg = await cached(`ecology-page-${f.documents.ecology_page}`, `${ECOLOGY_INDUSTRIAL_BASE}/${f.documents.ecology_page}`, 'html')
    docsRaw.ecology.set(f.documents.ecology_page, { url: pg.url, retrieved_at: pg.retrieved_at, links: parseEcologyPage(pg.html) })
    console.log(`  ${f.id} Ecology page: ${docsRaw.ecology.get(f.documents.ecology_page).links.length} links`)
  }
}
if (data.facilities.some((f) => f.documents?.nwcaa)) {
  const pg = await cached('nwcaa-aop-page', NWCAA_AOP_URL, 'html')
  const rows = new Map()
  for (const f of data.facilities) {
    if (!f.documents?.nwcaa) continue
    const r = parseNwcaaRow(pg.html, f.documents.nwcaa.location)
    if (r) rows.set(r.location, r)
    console.log(`  ${f.id} NWCAA row: ${r ? `${r.files.length} files` : 'NOT FOUND'}`)
  }
  docsRaw.nwcaa = { url: pg.url, retrieved_at: pg.retrieved_at, rows }
}
if (data.facilities.some((f) => f.documents?.pscaa)) {
  const pg = await cached('pscaa-title-v-page', PSCAA_TITLE_V_URL, 'html')
  const rows = new Map()
  for (const f of data.facilities) {
    if (!f.documents?.pscaa) continue
    const r = parsePscaaRow(pg.html, f.documents.pscaa.permit_number)
    if (r) rows.set(r.permit_number, r)
    console.log(`  ${f.id} PSCAA Title V ${f.documents.pscaa.permit_number}: ${r ? `${r.files.length} files (${r.source_name})` : 'NOT FOUND'}`)
  }
  docsRaw.pscaa = { url: pg.url, retrieved_at: pg.retrieved_at, rows }
}
console.log(`requests made before the database phase: ${requests}`)
if (dry) { console.log('dry run: nothing written'); process.exit(0) }

const pool = shipsPool()
try {
  const ctIds = data.facilities.flatMap((f) => f.ct_refinery || []).map(String)
  const { rows } = await pool.query(`SELECT se.entity_key, max(sr.id) AS id FROM ${schema}.source_entities se
      JOIN ${schema}.source_records sr ON sr.source_entity_id = se.id
     WHERE se.source_id = 'climate-trace' AND se.entity_kind = 'ct_refinery' AND se.entity_key = ANY($1) GROUP BY se.entity_key`, [ctIds])
  for (const r of rows) raw.ctRecordIds.set(Number(r.entity_key), Number(r.id))
  await withTx(pool, (c) => ensureFacilitySources(c, schema))
  const runId = await withTx(pool, (c) => startRun(c, schema, FACILITIES_LIST_SOURCE.id, { version: data.version, only: only ?? null }))
  try {
    const r = await withTx(pool, (c) => importFacilities(c, schema, data, raw, { runId, partial: Boolean(only) }))
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'succeeded', stats: { ...r, problems: r.problems.length }, datasetVersion: data.version }))
    console.log(JSON.stringify({ ...r, problems: r.problems.length }))
    for (const p of r.problems) console.log(`  ! ${p}`)
    await withTx(pool, (c) => ensureDocumentSources(c, schema))
    const pf = await withTx(pool, (c) => importParisFacilities(c, schema, data, docsRaw, { runId }))
    console.log(`PARIS facilities: ${JSON.stringify({ ...pf, problems: pf.problems.length })}`)
    for (const x of pf.problems) console.log(`  ! ${x}`)
    const d = await withTx(pool, (c) => importPermitDocuments(c, schema, data, docsRaw, { runId }))
    console.log(`documents: ${JSON.stringify({ ...d, problems: d.problems.length })}`)
    for (const p of d.problems) console.log(`  ! ${p}`)
    const cv = await withTx(pool, (c) => importCoverage(c, schema, data))
    console.log(`coverage: ${JSON.stringify({ ...cv, problems: cv.problems.length })}`)
    for (const p of cv.problems) console.log(`  ! ${p}`)
    // SEPA per permit (lib/ships/permitSepa.js): read each permit's fact sheet / support document / Air Operating Permit for
    // SEPA, and search the SEPA Register for each water / hazardous-waste permit number. Cached; a re-run makes 0 requests.
    const plan = await planPermitSepa(async (t, p) => (await pool.query(t, p)).rows, schema, data)
    const sraw = { docs: new Map(), permitSearch: new Map(), sepa: new Map() }
    const before = requests
    for (const x of plan) {
      for (const d of x.docs) {
        if (sraw.docs.has(d.doc.url)) continue
        try { sraw.docs.set(d.doc.url, await permitDoc(d.doc.url, { refresh })) } catch (e) { console.warn(`  ! ${e.message}`) }
      }
      if (x.search && !sraw.permitSearch.has(x.search)) {
        const hits = []
        let page = 1, last = 1
        do {
          const r = parseSepaSearch((await cached(`sepa-search-All-${x.search}-p${page}`, sepaSearchUrl('All', x.search, page), 'html')).html)
          last = r.lastPage
          for (const row of r.rows) if (!hits.includes(row.sepa)) hits.push(row.sepa)
        } while (++page <= last)
        sraw.permitSearch.set(x.search, { url: sepaSearchUrl('All', x.search), hits })
        for (const n of hits) if (!sraw.sepa.has(n)) sraw.sepa.set(n, await cached(`sepa-record-${n}`, sepaRecordUrl(n), 'html'))
      }
    }
    console.log(`SEPA per permit: ${plan.length} permits, ${sraw.docs.size} documents, ${sraw.permitSearch.size} permit-number searches `
      + `(${[...sraw.permitSearch.values()].filter((s) => s.hits.length).length} with hits); requests ${requests - before + docCounter.requests}`)
    const ps = await withTx(pool, (c) => importPermitSepa(c, schema, data, sraw, { runId }))
    console.log(`SEPA per permit: ${JSON.stringify({ ...ps, problems: ps.problems.length })}`)
    for (const p of ps.problems) console.log(`  ! ${p}`)
  } catch (e) {
    await withTx(pool, (c) => finishRun(c, schema, runId, { status: 'failed', stats: {}, error: String(e.message).slice(0, 500) })).catch(() => {})
    throw e
  }
} finally { await pool.end() }
