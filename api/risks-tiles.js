// /risks sea-level-rise scenario tiles (San Juan County / ESA 2024): MVT tiles out of one PMTiles archive with one
// vector layer per scenario (scripts/bake-risks/bake.mjs).
//
//   /api/risks-tiles?v=<version>&z=<z>&x=<x>&y=<y>
//
// Same shape as api/parcel-tiles.js and api/spun-tiles.js (Mapbox's native pmtiles source breaks under Vite's dev
// pipeline). Local dev range-reads public/dev-data/risks; production reads Blob. Tiles never change within a bake (the
// version is in the file name), so the CDN caches hard.

import zlib from 'node:zlib'
import { openSync, readSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'
import { PMTILES_FILE } from '../src/risks/risksLayers.js'

const BLOB_PUBLIC_BASE =
  process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const localPath = resolve(process.cwd(), `public/dev-data/risks/${PMTILES_FILE}`)
const blobUrl = `${BLOB_PUBLIC_BASE}/risks/${PMTILES_FILE}`

class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length)
    const n = readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }
  }
}

let got = null
function archive() {
  if (existsSync(localPath)) {
    const mtime = statSync(localPath).mtimeMs
    if (!got || got.key !== localPath || got.mtime !== mtime) got = { key: localPath, mtime, p: new PMTiles(new LocalFileSource(localPath)) }
    return got.p
  }
  if (!got || got.key !== blobUrl) got = { key: blobUrl, p: new PMTiles(new FetchSource(blobUrl)) }
  return got.p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const z = Number(searchParams.get('z'))
  const x = Number(searchParams.get('x'))
  const y = Number(searchParams.get('y'))
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24) { res.statusCode = 400; return res.end('bad tile coords') }

  let tile
  try {
    tile = await archive().getZxy(z, x, y)
  } catch {
    got = null
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
  // tippecanoe stores tiles gzipped already; pass them through, gzip anything that isn't
  const buf = Buffer.from(tile.data)
  res.end(buf[0] === 0x1f && buf[1] === 0x8b ? buf : zlib.gzipSync(buf))
}
