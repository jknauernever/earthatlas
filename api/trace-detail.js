// Climate TRACE per-source detail — one shard (NDJSON, format 2; decode with
// src/systems/traceData.js) cut out of the release's single packed file.
//
//   /api/trace-detail?v=<version>&s=<shard>
//
// The bake writes all 16,384 shards into ONE file, trace-detail.pack, so a
// release is three uploads, not sixteen thousand:
//   bytes 0-3   'TRDP'
//   bytes 4-7   uint32 LE shard count N
//   then        (N + 1) uint32 LE offsets, relative to the data start
//   then        the shards' bytes, back to back
// We read the header once per release (cached), then range-read one shard.
// Immutable per `v`, so the CDN caches each shard hard.

import zlib from 'node:zlib'
import { traceReader } from './_trace-store.js'

const headers = new Map() // reader → { n, dataStart, offsets }

async function headerFor(src) {
  let h = headers.get(src)
  if (h) return h
  const head = Buffer.from((await src.getBytes(0, 8)).data)
  if (head.toString('ascii', 0, 4) !== 'TRDP') throw new Error('not a trace detail pack')
  const n = head.readUInt32LE(4)
  const offBuf = Buffer.from((await src.getBytes(8, (n + 1) * 4)).data)
  const offsets = new Uint32Array(n + 1)
  for (let i = 0; i <= n; i++) offsets[i] = offBuf.readUInt32LE(i * 4)
  h = { n, dataStart: 8 + (n + 1) * 4, offsets }
  headers.set(src, h)
  if (headers.size > 8) headers.delete(headers.keys().next().value)
  return h
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const v = searchParams.get('v') || ''
  const s = Number(searchParams.get('s'))
  const src = traceReader('trace-detail.pack', v)
  if (!src) { res.statusCode = 404; return res.end('unknown release') }
  let body
  try {
    const h = await headerFor(src)
    if (!Number.isInteger(s) || s < 0 || s >= h.n) { res.statusCode = 400; return res.end('bad shard') }
    const start = h.offsets[s], end = h.offsets[s + 1]
    body = end > start ? Buffer.from((await src.getBytes(h.dataStart + start, end - start)).data) : Buffer.alloc(0)
  } catch {
    headers.delete(src)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('detail read failed')
  }
  res.statusCode = 200
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Vary', 'Accept-Encoding')
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
  res.end(zlib.gzipSync(body))
}
