#!/usr/bin/env node
/**
 * MEP Alliance scrubber lists → ships evidence + claims + links (lib/ships/mepAlliance.js; resolver v1.9 decideMep).
 * Permission via Friends of the San Juans (MEP Alliance founding member), 2026-09-30 (Josh). Attribution: "MEP Alliance".
 *
 * Pages live in the gitignored scripts/ships/mep/raw/ exactly as received, one set per retrieval date:
 *   list-of-scrubber-fitted-ships-<date>[-p<N>].html   "Polluting Scrubber Voyages" (100 rows per page)
 *   bulk-carriers|tankers|container-ships|cruise-ships-<date>[-p<N>].html   "Scrubber-Fitted Ships by Vessel Type"
 *
 *   npm run ships:import-mep -- fetch                  download a fresh set (robots.txt checked; generic User-Agent; one
 *                                                      request every 2 s; ~47 pages on 2026-09-30). Writes files only.
 *   npm run ships:import-mep -- [--date YYYY-MM-DD] [--limit N] [--schema S] [--dry-run]
 *                                                      parse the newest (or given) set → evidence, claims, resolution.
 *                                                      --limit N keeps the first N ships of each list (test runs).
 * Writes to SHIPS_DATABASE_URL (dev via .env.local). Production needs Josh's go-ahead. Idempotent: an unchanged page set stores
 * nothing new and re-decides the same way (accepted links are never moved).
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { shipsPool, DEFAULT_SCHEMA, withTx, withRetry } from '../../lib/ships/db.js'
import { startRun, finishRun, sha256 } from '../../lib/ships/store.js'
import {
  parseVoyagePage, parseFittedPage, checkVoyageHeader, checkFittedHeader, knownNames, lastPublished, nextPage, groupVoyages,
  groupFitted, voyageAssertions, fittedAssertions, ensureMepSources, importMepChunk, mepEntityIds, resolveMepIds, finishMep, VOYAGES_SOURCE,
  FITTED_SOURCE, FITTED_LISTS, SITE,
} from '../../lib/ships/mepAlliance.js'

const RAW = 'scripts/ships/mep/raw'
const UA = 'Mozilla/5.0 (compatible; EarthAtlas-research/1.0; +https://earthatlas.org)'
const args = process.argv.slice(2)
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const schema = opt('schema') || DEFAULT_SCHEMA
const dry = args.includes('--dry-run')
const limit = opt('limit') ? Number(opt('limit')) : null
const VOYAGE_SLUG = 'list-of-scrubber-fitted-ships'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchAll() {
  const robots = await fetch(`${SITE}/robots.txt`, { headers: { 'User-Agent': UA } }).then((r) => (r.ok ? r.text() : ''))
  if (/^\s*disallow:\s*\/\s*$/im.test(robots)) throw new Error('robots.txt disallows the site; stopping')
  const date = new Date().toISOString().slice(0, 10)
  await mkdir(RAW, { recursive: true })
  let n = 0
  for (const slug of [VOYAGE_SLUG, ...Object.keys(FITTED_LISTS)]) {
    let page = 1, key = null
    for (;;) {
      if (new RegExp(`^\\s*disallow:\\s*/${slug}`, 'im').test(robots)) throw new Error(`robots.txt disallows /${slug}`)
      const url = page === 1 ? `${SITE}/${slug}` : `${SITE}/${slug}?${key}_page=${page}`
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
      const html = await res.text()
      await writeFile(path.join(RAW, `${slug}-${date}${page === 1 ? '' : `-p${page}`}.html`), html)
      n++
      await sleep(2000)
      const nx = nextPage(html, page)
      if (!nx || page > 50) break
      key = /href="\?([0-9a-f]+)_page=\d+"/.exec(html)[1]; page = nx
    }
  }
  console.log(`fetched ${n} pages into ${RAW} (${date})`)
}

async function loadSet() {
  const files = (await readdir(RAW)).filter((f) => f.endsWith('.html'))
  const dates = [...new Set(files.map((f) => /-(\d{4}-\d{2}-\d{2})(?:-p\d+)?\.html$/.exec(f)?.[1]).filter(Boolean))].sort()
  const date = opt('date') || dates.at(-1)
  if (!date) throw new Error(`no pages in ${RAW}: run "fetch" first`)
  const pages = {}
  for (const slug of [VOYAGE_SLUG, ...Object.keys(FITTED_LISTS)]) {
    const mine = files.filter((f) => new RegExp(`^${slug}-${date}(-p\\d+)?\\.html$`).test(f))
      .sort((a, b) => Number(/-p(\d+)\.html$/.exec(a)?.[1] || 1) - Number(/-p(\d+)\.html$/.exec(b)?.[1] || 1))
    if (!mine.length) throw new Error(`no ${slug} pages for ${date}`)
    pages[slug] = []
    for (const f of mine) {
      const buf = await readFile(path.join(RAW, f))
      pages[slug].push({ file: f, sha256: sha256(buf), html: buf.toString('utf8') })
    }
    // The set must be complete: the last page has no next-page link.
    if (nextPage(pages[slug].at(-1).html, pages[slug].length)) throw new Error(`${slug} ${date}: the last saved page still links a next page`)
  }
  return { date, pages }
}

if (args[0] === 'fetch') { await fetchAll(); process.exit(0) }

const { date, pages } = await loadSet()
const published = lastPublished(pages[VOYAGE_SLUG][0].html)
const version = `mepalliance.org pages retrieved ${date} (site "Last Published: ${published || 'unknown'}")`
const fileList = Object.values(pages).flat().map((p) => ({ file: p.file, sha256: p.sha256 }))

const known = [...new Set(pages[VOYAGE_SLUG].flatMap((p) => knownNames(p.html)))]
const voyRows = pages[VOYAGE_SLUG].flatMap((p) => { checkVoyageHeader(p.html); return parseVoyagePage(p.html) })
const fitRows = Object.keys(FITTED_LISTS).flatMap((slug) => pages[slug].flatMap((p) => { checkFittedHeader(p.html); return parseFittedPage(p.html).map((r) => ({ ...r, list: slug })) }))
let voy = groupVoyages(voyRows), fit = groupFitted(fitRows)
if (limit) { voy = voy.slice(0, limit); fit = fit.slice(0, limit) }
const vClaims = voy.flatMap((g) => voyageAssertions(g, known)), fClaims = fit.flatMap(fittedAssertions)
console.log(`MEP Alliance ${date} → schema "${schema}" on ${new URL(process.env.SHIPS_DATABASE_URL).host}${dry ? ' (dry run)' : ''}${limit ? ` (first ${limit} ships per list)` : ''}`)
console.log(`  voyages: ${voyRows.length} rows → ${voy.length} ship names, ${vClaims.length} claims; owner named ${vClaims.filter((a) => a.detail.owner).length}, charterer named ${vClaims.filter((a) => a.detail.charterer).length}`)
console.log(`  vessel-type lists: ${fitRows.length} rows (${Object.keys(FITTED_LISTS).map((s) => `${s} ${fitRows.filter((r) => r.list === s).length}`).join(', ')}) → ${fit.length} ships (${fit.filter((g) => g.imo).length} with a valid IMO), ${fClaims.length} claims`)

if (!dry) {
  const pool = shipsPool()
  try {
    await withTx(pool, (c) => ensureMepSources(c, schema))
    const out = {}
    // Both lists are stored before anything is resolved, so a voyage name can see the vessel-type list's IMO for that name.
    for (const [src, groups] of [[FITTED_SOURCE, fit], [VOYAGES_SOURCE, voy]]) {
      const runId = await startRun(pool, schema, src.id, { date, files: fileList.filter((f) => src === VOYAGES_SOURCE ? f.file.startsWith(VOYAGE_SLUG) : !f.file.startsWith(VOYAGE_SLUG)), limit })
      const tot = { recordsCreated: 0, claimsCreated: 0, superseded: 0 }
      try {
        for (let i = 0; i < groups.length; i += 200) {
          const r = await withRetry(() => withTx(pool, (c) => importMepChunk(c, schema, src.id, groups.slice(i, i + 200), { runId, datasetVersion: version, known, pages: date })))
          tot.recordsCreated += r.recordsCreated; tot.claimsCreated += r.claimsCreated; tot.superseded += r.superseded
        }
        if (!limit) tot.goneFromList = (await withTx(pool, (c) => finishMep(c, schema, src.id, groups.map((g) => g.key)))).superseded
        out[src.id] = { runId, tot }
      } catch (e) { await finishRun(pool, schema, runId, { status: 'failed', stats: tot, error: String(e.message || e) }); throw e }
    }
    for (const src of [FITTED_SOURCE, VOYAGES_SOURCE]) {
      const { runId, tot } = out[src.id]
      const ids = await withTx(pool, (c) => mepEntityIds(c, schema, src.id))
      tot.resolved = {}
      for (let i = 0; i < ids.length; i += 200) {
        const t = await withRetry(() => withTx(pool, (c) => resolveMepIds(c, schema, ids.slice(i, i + 200))))
        for (const [k, v] of Object.entries(t)) tot.resolved[k] = (tot.resolved[k] || 0) + v
      }
      await finishRun(pool, schema, runId, { status: 'succeeded', stats: tot, datasetVersion: version })
      console.log(`${src.id}:`, JSON.stringify(tot))
    }
  } finally { await pool.end() }
}
