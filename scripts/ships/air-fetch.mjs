#!/usr/bin/env node
/**
 * WA clean air agency pages and documents (PSCAA, ORCAA, SWCAA) → the gitignored cache (scripts/ships/facilities/cache/), one known
 * URL at a time. Used by import-wa-air.mjs (cache first: a re-run, and the production run, make 0 requests) and by hand while
 * studying an agency or checking a terminal:  node scripts/ships/air-fetch.mjs <url> [<url> …]
 *
 * Requests: one at a time, ≥ 1.5 s apart, EarthAtlas User-Agent, retried 3 times; every request is appended to
 * cache/air-requests.log (the running count for the request budget). No login, form or protection is ever bypassed: a page that
 * answers with a challenge or an error is reported, not worked around.
 * A PDF is kept as is (<name>.pdf) and its text extracted with pdftotext -layout into <name>.json { url, retrieved_at, bytes,
 * sha256, content_type, text }; an HTML page is kept in the same JSON shape (text = the HTML).
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { airCacheName } from '../../lib/ships/waAirAgencies.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships)'
export const CACHE = 'scripts/ships/facilities/cache'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
export const counter = { requests: 0 }

// Scanned PDFs (no text layer) are read with macOS's Vision OCR (scripts/ships/ocr-pdf.swift); the cached JSON says so.
export const OCR_NOTE = 'text read by OCR (macOS Vision) from a scanned PDF'
const needsOcr = (text) => String(text || '').replace(/\s+/g, '').length < 200
const ocr = (file) => execFileSync('swift', [path.join(path.dirname(fileURLToPath(import.meta.url)), 'ocr-pdf.swift'), file], { maxBuffer: 1 << 28 }).toString('utf8')

/** Re-read a cached scanned PDF with OCR (0 requests). Returns the updated cache entry. */
export async function ocrCached(url) {
  const base = path.join(CACHE, airCacheName(url))
  const d = JSON.parse(await readFile(`${base}.json`, 'utf8'))
  if (!/pdf/i.test(d.content_type || '') || d.ocr || !needsOcr(d.text)) return d
  d.text = ocr(`${base}.pdf`); d.ocr = OCR_NOTE
  await writeFile(`${base}.json`, JSON.stringify(d))
  return d
}

/** The cached copy of one agency page or document, fetched once when missing (refresh = fetch again). */
export async function airDoc(url, { refresh = false, form = null } = {}) {
  // A public search form posted as the agency's own page does (SWCAA's permit search): cached under url + the form body.
  const body = form ? new URLSearchParams(form).toString() : null
  const key = body ? `${url} POST ${body}` : url
  const base = path.join(CACHE, airCacheName(key))
  if (!refresh) { try { await readFile(`${base}.json`); return await ocrCached(key) } catch {} }
  for (let i = 1; ; i++) {
    const wait = 1500 - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    last = Date.now()
    counter.requests++
    await mkdir(CACHE, { recursive: true })
    await appendFile(path.join(CACHE, 'air-requests.log'), `${new Date().toISOString()} ${key}\n`)
    try {
      const res = await fetch(url, body ? { method: 'POST', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'follow' }
        : { headers: { 'User-Agent': UA }, redirect: 'follow' })
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.final = [401, 403, 404, 410].includes(res.status); throw e }
      const buf = Buffer.from(await res.arrayBuffer())
      const type = res.headers.get('content-type') || ''
      const out = { url, ...(body ? { form: body } : {}), final_url: res.url, retrieved_at: new Date().toISOString(), bytes: buf.length,
        sha256: createHash('sha256').update(buf).digest('hex'), content_type: type }
      if (/pdf/i.test(type) || buf.subarray(0, 4).toString() === '%PDF') {
        await writeFile(`${base}.pdf`, buf)
        out.text = execFileSync('pdftotext', ['-layout', `${base}.pdf`, '-'], { maxBuffer: 1 << 28 }).toString('utf8')
        if (needsOcr(out.text)) { out.text = ocr(`${base}.pdf`); out.ocr = OCR_NOTE }
      } else out.text = buf.toString('utf8')
      await writeFile(`${base}.json`, JSON.stringify(out))
      return out
    } catch (e) {
      if (e.final || i >= 3) throw new Error(`${url}: ${e.message}`)
      await sleep(4000 * i)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const u of process.argv.slice(2)) {
    let d
    try { d = await airDoc(u) } catch (e) { console.log(`NOT FETCHED ${e.message}`); continue }
    console.log(`${airCacheName(u)} ${d.bytes} bytes ${d.content_type}${d.final_url && d.final_url !== u ? ` → ${d.final_url}` : ''}`)
  }
  console.log(`requests made: ${counter.requests}`)
}
