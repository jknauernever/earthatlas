// Where the Climate TRACE facility artifacts live, for the server routes
// (api/trace-tiles.js, api/trace-detail.js). See scripts/bake-climatetrace.
//
// Every release is published under its own immutable folder,
//   <blob>/trace/<version>/trace-facilities.pmtiles
//   <blob>/trace/<version>/trace-detail.pack
//   <blob>/trace/<version>/trace-index.json
// and <blob>/trace/latest.json points the client at the current one. Routes
// take `v` from the request, so a CDN-cached URL can never mix releases, and
// the monthly GitHub Action (climatetrace-bake.yml) publishes a new release
// without any code change or deploy.
//
// Local dev reads the files straight out of scripts/bake-climatetrace/build/
// (whatever was baked last), reopening them when a re-bake replaces them.

import { openSync, readSync, existsSync, statSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import cfg from '../src/systems/traceSource.json' with { type: 'json' }

export const TRACE_BLOB_BASE = (process.env.BLOB_PUBLIC_BASE || cfg.blobBase).replace(/\/+$/, '')
export const VERSION_RE = /^v\d+\.\d+\.\d+-\d{8}$/
const BUILD = resolve(process.cwd(), 'scripts/bake-climatetrace/build')

/** A byte-range reader over one artifact: local file in dev, Blob otherwise. */
class LocalRange {
  constructor(path) { this.path = path; this._open() }
  _open() { const st = statSync(this.path); this.fd = openSync(this.path, 'r'); this.stamp = `${st.ino}:${st.mtimeMs}` }
  fresh() { try { const st = statSync(this.path); return `${st.ino}:${st.mtimeMs}` === this.stamp } catch { return false } }
  close() { try { closeSync(this.fd) } catch { /* already closed */ } }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.allocUnsafe(length)
    const n = readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }
  }
}

class BlobRange {
  constructor(url) { this.url = url }
  fresh() { return true }
  close() {}
  getKey() { return this.url }
  async getBytes(offset, length) {
    const r = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } })
    if (r.status !== 206 && r.status !== 200) throw new Error(`blob ${r.status}`)
    const buf = await r.arrayBuffer()
    // A server that ignores Range returns the whole file — slice it ourselves.
    return { data: r.status === 200 ? buf.slice(offset, offset + length) : buf }
  }
}

const readers = new Map() // `${file}|${v}` → reader
/** Range reader for `file` of release `v` (dev: the local bake, any v). */
export function traceReader(file, v) {
  const local = resolve(BUILD, file)
  const devLocal = existsSync(local)
  const key = devLocal ? `${file}|local` : `${file}|${v}`
  let r = readers.get(key)
  if (r && !r.fresh()) { r.close(); readers.delete(key); r = null }
  if (!r) {
    if (devLocal) r = new LocalRange(local)
    else if (VERSION_RE.test(v || '')) r = new BlobRange(`${TRACE_BLOB_BASE}/trace/${v}/${file}`)
    else return null
    if (readers.size > 24) { for (const [k, old] of readers) { old.close(); readers.delete(k); break } }
    readers.set(key, r)
  }
  return r
}
