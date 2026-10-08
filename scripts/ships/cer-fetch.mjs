#!/usr/bin/env node
/**
 * Canada Energy Regulator web pages (inspection officer orders and their notices) → the gitignored cache
 * (scripts/ships/facilities/cache/cer/pages/<name>.json { url, retrieved_at, bytes, sha256, content_type, html }), one known URL at a
 * time. Used by import-cer.mjs (cache first: a re-run and the production run make 0 requests) and by hand:
 *   node scripts/ships/cer-fetch.mjs <url> [<url> …]
 * Requests: ≥ 2 s apart, EarthAtlas User-Agent, redirects not followed, retried 3 times on network errors; every request logged.
 */
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cerPageName } from '../../lib/ships/cer.js'

const UA = 'EarthAtlas-ships/1.0 (+https://earthatlas.org/ships)'
export const PAGES = 'scripts/ships/facilities/cache/cer/pages'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
export const counter = { requests: 0 }

export async function cerPage(url, { refresh = false } = {}) {
  const file = path.join(PAGES, `${cerPageName(url)}.json`)
  if (!refresh) { try { return JSON.parse(await readFile(file, 'utf8')) } catch {} }
  for (let i = 1; ; i++) {
    const wait = 2000 - (Date.now() - last)
    if (wait > 0) await sleep(wait)
    last = Date.now()
    counter.requests++
    await mkdir(PAGES, { recursive: true })
    await appendFile(path.join(PAGES, 'requests.log'), `${new Date().toISOString()} ${url}\n`)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) { const e = new Error(`moved: HTTP ${res.status} → ${res.headers.get('location')}`); e.final = true; throw e }
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.final = res.status === 404; throw e }
      const buf = Buffer.from(await res.arrayBuffer())
      const out = { url, retrieved_at: new Date().toISOString(), bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
        content_type: res.headers.get('content-type') || '', html: buf.toString('utf8') }
      await writeFile(file, JSON.stringify(out))
      return out
    } catch (e) {
      if (e.final || i >= 3) throw new Error(`${url}: ${e.message}`)
      await sleep(4000 * i)
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  for (const u of process.argv.slice(2)) {
    try { const d = await cerPage(u); console.log(`${cerPageName(u)} ${d.bytes} bytes`) } catch (e) { console.log(`NOT FETCHED ${e.message}`) }
  }
  console.log(`requests made: ${counter.requests}`)
}
