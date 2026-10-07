#!/usr/bin/env node
/**
 * Metro Vancouver air quality permit documents → the gitignored cache (scripts/ships/facilities/cache/), one known URL at a time.
 * Used by import-bc-permits.mjs (cache first: a re-run, and the production run, make 0 requests) and by hand while checking a
 * terminal:  node scripts/ships/mv-fetch.mjs <url> [<url> …]
 *
 * Only URLs already known (from a public web search or a public application page) are fetched. The permit library's listing is
 * access-controlled (401) and is never enumerated. Requests: one at a time, ≥ 2 s apart, EarthAtlas User-Agent, retried 3 times.
 * A PDF is kept as is (<name>.pdf) and its text extracted with pdftotext -layout into <name>.json { url, retrieved_at, bytes,
 * sha256, content_type, text }; an HTML page is kept as its HTML in the same JSON shape (text = the HTML).
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mvCacheName } from '../../lib/ships/metroVancouver.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships)'
export const CACHE = 'scripts/ships/facilities/cache'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
export const counter = { requests: 0 }

/** The cached copy of one Metro Vancouver document, fetched once when missing (refresh = fetch again). */
export async function mvDoc(url, { refresh = false } = {}) {
  const base = path.join(CACHE, mvCacheName(url))
  if (!refresh) { try { return JSON.parse(await readFile(`${base}.json`, 'utf8')) } catch {} }
  for (let i = 1; ; i++) {
    const wait = 2000 - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    last = Date.now()
    counter.requests++
    await mkdir(CACHE, { recursive: true })
    await appendFile(path.join(CACHE, 'mv-requests.log'), `${new Date().toISOString()} ${url}\n`)
    try {
      // Redirects are not followed: Metro Vancouver answers a document that is no longer there with a 302 to its page-not-found.
      const res = await fetch(encodeURI(decodeURI(url)), { headers: { 'User-Agent': UA }, redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) { const e = new Error(`moved: HTTP ${res.status} → ${res.headers.get('location')}`); e.final = true; throw e }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      const type = res.headers.get('content-type') || ''
      const out = { url, retrieved_at: new Date().toISOString(), bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'), content_type: type }
      if (/pdf/i.test(type) || buf.subarray(0, 4).toString() === '%PDF') {
        await writeFile(`${base}.pdf`, buf)
        out.text = execFileSync('pdftotext', ['-layout', `${base}.pdf`, '-'], { maxBuffer: 1 << 28 }).toString('utf8')
      } else if (/\.pdf($|[?#])/i.test(url)) { const e = new Error(`not a PDF (${type})`); e.final = true; throw e }
      else out.text = buf.toString('utf8')
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
    try { d = await mvDoc(u) } catch (e) { console.log(`NOT FETCHED ${e.message}`); continue }
    console.log(`${mvCacheName(u)} ${d.bytes} bytes ${d.content_type} — ${String(d.text).replace(/\s+/g, ' ').slice(0, 300)}`)
  }
  console.log(`requests made: ${counter.requests}`)
}
