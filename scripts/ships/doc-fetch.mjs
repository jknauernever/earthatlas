#!/usr/bin/env node
/**
 * Permit documents (WA Ecology PARIS / Industrial Section, NWCAA, PSCAA) → the gitignored cache, one known URL at a time, so their
 * text can be read for what they say about SEPA (lib/ships/permitSepa.js). Used by import-facilities.mjs (cache first: a re-run
 * and the production run make 0 requests) and by hand:  node scripts/ships/doc-fetch.mjs <url> [<url> …]
 *
 * Only document URLs the agencies' own listings give (already stored as documents) are fetched. One at a time, ≥ 1.5 s apart,
 * EarthAtlas User-Agent, retried 3 times. The PDF's text is extracted with pdftotext -layout into
 * <cache>/doc-<hash of url>.json { url, retrieved_at, bytes, sha256, content_type, pages: [text of page 1, …] }; the PDF itself
 * is not kept (layer 3, keeping copies, is not authorized; the hash identifies the file read).
 */
import { mkdir, readFile, writeFile, appendFile, unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships; permit documents)'
export const CACHE = 'scripts/ships/facilities/cache'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
export const counter = { requests: 0 }
export const docCacheName = (url) => `doc-${createHash('sha1').update(url).digest('hex').slice(0, 16)}`

/** The cached text of one permit document (by page), fetched once when missing. Returns null when the file is not a PDF. */
export async function permitDoc(url, { refresh = false } = {}) {
  const base = path.join(CACHE, docCacheName(url))
  if (!refresh) { try { return JSON.parse(await readFile(`${base}.json`, 'utf8')) } catch {} }
  for (let i = 1; ; i++) {
    const wait = 1500 - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    last = Date.now()
    counter.requests++
    await mkdir(CACHE, { recursive: true })
    await appendFile(path.join(CACHE, 'doc-requests.log'), `${new Date().toISOString()} ${url}\n`)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const type = res.headers.get('content-type') || ''
      const out = { url, retrieved_at: new Date().toISOString(), bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), content_type: type }
      if (buf.subarray(0, 4).toString() === '%PDF') {
        await writeFile(`${base}.pdf`, buf)
        try { out.pages = execFileSync('pdftotext', ['-layout', `${base}.pdf`, '-'], { maxBuffer: 1 << 28 }).toString('utf8').split('\f') }
        finally { await unlink(`${base}.pdf`).catch(() => {}) }
      } else out.pages = null
      await writeFile(`${base}.json`, JSON.stringify(out))
      return out
    } catch (e) {
      if (i >= 3) throw new Error(`${url}: ${e.message}`)
      await sleep(4000 * i)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const u of process.argv.slice(2)) {
    let d
    try { d = await permitDoc(u) } catch (e) { console.log(`NOT FETCHED ${e.message}`); continue }
    console.log(`${docCacheName(u)} ${d.bytes} bytes ${d.content_type} pages ${d.pages?.length ?? 'not a PDF'}`)
  }
  console.log(`requests made: ${counter.requests}`)
}
