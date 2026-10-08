#!/usr/bin/env node
/**
 * Weekly Metro Vancouver air-permit check (Josh 2026-10-08: "weekly refresh"; run by scripts/ships/mv-weekly.sh from launchd).
 * Metro Vancouver replaces permit files in place and renews permits under new file names (Chemtrade GVA0010 → GVA1281), so once a week:
 *   1. re-read every Metro Vancouver document our data names (permit PDFs, application pages, notices);
 *   2. re-read Metro Vancouver's public list of current permits and its site search for our companies;
 *   3. classify: unchanged · CHANGED IN PLACE (same address, new content: the cache is updated so the next import stores it as a new
 *      evidence version) · GONE (address now 302s: nothing changes; a person checks) · NEW (a file for one of our permits or companies
 *      that our data doesn't name: nothing changes; a person checks holder + address before it is accepted).
 * Writes a Markdown report and a JSON summary to scripts/ships/facilities/cache/mv-weekly/ (gitignored). Exit code: 0 = ran (see
 * summary.changed / summary.flagged), 2 = could not run (network, Chrome) so the wrapper retries next hour.
 * Requests: 1 list page + one search per company (~30, headless Chrome) + one GET per named document (~25), ≥ 2 s apart.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mvDoc, CACHE, counter } from './mv-fetch.mjs'
import { mvIndex, mvSearch } from './mv-index.mjs'
import { mvCacheName, mvPageText, oneLine } from '../../lib/ships/metroVancouver.js'

const OUT = path.join(CACHE, 'mv-weekly')
const data = JSON.parse(await readFile('lib/ships/data/salish-facilities.json', 'utf8'))
const mvFacilities = data.facilities.filter((f) => f.bc?.mv?.jurisdiction === 'in')
const fileOf = (u) => decodeURI(String(u)).split('/').pop()
const gvaOfFile = (file) => (/^(\d{4})/.exec(file) ? `GVA${file.slice(0, 4)}` : null)

// What our data names: documents, permit numbers (ours and left-out ones), and the companies to search for.
const named = new Map()   // url → facility id
const ourGva = new Map()  // GVA number → facility id
const leftOut = new Set()
const terms = new Set()
for (const f of mvFacilities) {
  for (const p of f.bc.mv.permits || []) {
    for (const u of [p.doc_url, p.application_url, p.notice_url, ...(p.extra_docs || []).map((x) => x.url)].filter(Boolean)) named.set(u, f.id)
    ourGva.set(p.gva.replace(/^GVU/, 'GVA'), f.id)
    if (p.holder) terms.add(p.holder.replace(/\b(Inc|Ltd|Limited|Partnership|Corporation|Corp|LP|ULC|Co)\b\.?/gi, '').replace(/[.,]/g, '').trim().split(/\s+/).slice(0, 3).join(' '))
  }
  for (const x of f.bc.mv.left_out || []) leftOut.add(String(x.gva).replace(/^GVU/, 'GVA'))
  for (const m of String(f.bc.mv.none || '').matchAll(/“([^”]+)”/g)) terms.add(m[1])
}

const now = new Date().toISOString()
const result = { ran_at: now, unchanged: [], changed: [], gone: [], fetchErrors: [], newFiles: [] }
const comparable = (d) => (/html/i.test(d?.content_type || '') ? oneLine(mvPageText(d.text)) : d?.sha256)

try {
  // 1. Every document our data names.
  for (const [url, fac] of named) {
    let old = null
    try { old = JSON.parse(await readFile(path.join(CACHE, `${mvCacheName(url)}.json`), 'utf8')) } catch {}
    try {
      const fresh = await mvDoc(url, { refresh: true })
      if (old && comparable(old) === comparable(fresh)) result.unchanged.push({ fac, file: fileOf(url) })
      else result.changed.push({ fac, file: fileOf(url), url, was: old?.retrieved_at ?? null })
    } catch (e) {
      if (/moved: HTTP 3/.test(e.message)) result.gone.push({ fac, file: fileOf(url), url })
      else result.fetchErrors.push({ fac, file: fileOf(url), error: e.message })
    }
  }
  // 2. Metro Vancouver's own list and its site search.
  const index = await mvIndex({ refresh: true })
  const searches = await mvSearch([...terms], { refresh: true })
  const known = new Set([...named.keys()].map(fileOf))
  const seen = new Map()   // file → where it was seen
  for (const r of index.rows) seen.set(r.file, `list of current permits (${r.holder ?? 'no holder listed'})`)
  // A search result counts only when its file name carries every word of the company searched (the search ORs and stems words:
  // “Pacific Coast” also finds Pacific Coast Cedar Products).
  const hasAll = (file, term) => term.toLowerCase().split(/\s+/).every((w) => file.toLowerCase().includes(w))
  for (const s of searches) for (const file of s.links) if (!seen.has(file) && hasAll(file, s.term)) seen.set(file, `site search “${s.term}”`)
  for (const [file, where] of seen) {
    if (known.has(file)) continue
    const gva = gvaOfFile(file)
    if (gva && leftOut.has(gva)) continue
    const fromSearch = where.startsWith('site search')
    if ((gva && ourGva.has(gva)) || fromSearch) result.newFiles.push({ file, where, gva, fac: gva ? ourGva.get(gva) ?? null : null })
  }
  // Network trouble on everything = couldn't run (retry), not "everything is gone".
  if (result.fetchErrors.length && !result.unchanged.length && !result.changed.length) throw new Error(`no document could be read (${result.fetchErrors[0].error})`)
} catch (e) {
  console.error(`mv-weekly: could not run: ${e.message}`)
  process.exit(2)
}

result.requests = counter.requests + terms.size
result.flagged = result.gone.length + result.newFiles.length + result.fetchErrors.length
const day = now.slice(0, 10)
const lines = [`# Metro Vancouver air permits — weekly check ${day}`, '',
  `${result.unchanged.length} unchanged · ${result.changed.length} changed in place · ${result.gone.length} gone · ${result.newFiles.length} new to check · ${result.fetchErrors.length} not readable · ${counter.requests} documents + ${terms.size} searches read`, '']
if (result.changed.length) lines.push('## Changed in place (stored automatically; check the dates and wording in salish-facilities.json still match)', ...result.changed.map((x) => `- ${x.fac}: ${x.file}`), '')
if (result.gone.length) lines.push('## Gone (Metro Vancouver now answers “page not found”; look for the replacement)', ...result.gone.map((x) => `- ${x.fac}: ${x.file}`), '')
if (result.newFiles.length) lines.push('## New files to check (holder + address before accepting)', ...result.newFiles.map((x) => `- ${x.fac ? `${x.fac} (same permit number): ` : ''}${x.file} — seen in ${x.where}`), '')
if (result.fetchErrors.length) lines.push('## Could not read', ...result.fetchErrors.map((x) => `- ${x.fac}: ${x.file} — ${x.error}`), '')
await mkdir(OUT, { recursive: true })
await writeFile(path.join(OUT, `${day}.md`), lines.join('\n'))
await writeFile(path.join(OUT, 'last.json'), JSON.stringify(result, null, 1))
console.log(lines.join('\n'))
