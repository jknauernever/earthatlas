// Vector tiles of the EarthAtlas national datasets (docs/NATIONAL_DATA.md): MVT out of one PMTiles archive per dataset
// version.
//
//   /api/national-tiles?d=<dataset>&v=<version>&z=<z>&x=<x>&y=<y>
//
// Same shape as api/risks-tiles.js and api/parcel-tiles.js. Local dev range-reads data/national/<dataset>/build/<version>/
// tiles.pmtiles (data/national links big builds to the offload drive); production reads Blob
// national/<dataset>/<version>/tiles.pmtiles. A version never changes, so the CDN caches hard.

import zlib from 'node:zlib'
import { openSync, readSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'

const BLOB_PUBLIC_BASE = process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const SAFE = /^[\w.-]+$/

class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length)
    const n = readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }
  }
}

const open = new Map()
function archive(dataset, version) {
  const key = `${dataset}/${version}`
  const localPath = resolve(process.cwd(), `data/national/${dataset}/build/${version}/tiles.pmtiles`)
  const blobUrl = `${BLOB_PUBLIC_BASE}/national/${dataset}/${version}/tiles.pmtiles`
  let got = open.get(key)
  if (existsSync(localPath)) {
    const mtime = statSync(localPath).mtimeMs
    if (!got || got.key !== localPath || got.mtime !== mtime) open.set(key, got = { key: localPath, mtime, p: new PMTiles(new LocalFileSource(localPath)) })
    return got.p
  }
  if (!got || got.key !== blobUrl) open.set(key, got = { key: blobUrl, p: new PMTiles(new FetchSource(blobUrl)) })
  return got.p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const d = searchParams.get('d') || '', v = searchParams.get('v') || ''
  const z = Number(searchParams.get('z')), x = Number(searchParams.get('x')), y = Number(searchParams.get('y'))
  if (!SAFE.test(d) || !SAFE.test(v)) { res.statusCode = 400; return res.end('bad dataset or version') }
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24) { res.statusCode = 400; return res.end('bad tile coords') }

  let tile
  try {
    tile = await archive(d, v).getZxy(z, x, y)
  } catch {
    open.delete(`${d}/${v}`)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Vary', 'Accept-Encoding')   // see api/parcel-tiles.js: keep gzip and identity variants apart at the CDN
  if (!tile) {
    res.statusCode = 204
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.end()
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
  const buf = Buffer.from(tile.data)
  res.end(buf[0] === 0x1f && buf[1] === 0x8b ? buf : zlib.gzipSync(buf))
}
