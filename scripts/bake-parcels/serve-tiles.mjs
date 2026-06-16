#!/usr/bin/env node
// Standalone clone of /api/parcel-tiles for LOCAL QA on the plain-vite preview
// (which has no serverless functions). Serves gzipped MVT at:
//   /api/parcel-tiles?r=<region>&v=<v>&z=<z>&x=<x>&y=<y>
// Reads each region's PMTiles straight from the build/ dir.
//
//   node scripts/bake-parcels/serve-tiles.mjs [port]
// Point the app at it with VITE_PARCEL_TILES_BASE=http://localhost:8100

import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { PMTiles, FileSource } from 'pmtiles'

const __dirname = dirname(fileURLToPath(import.meta.url))
const port = Number(process.argv[2]) || 8100

// Minimal node FileSource so pmtiles can range-read a local file.
class NodeFile {
  constructor(path) { this.path = path; this.buf = readFileSync(path) }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const slice = this.buf.subarray(offset, offset + length)
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) }
  }
}

const cache = new Map()
function pmtilesFor(region, version) {
  const key = `${region}-${version}`
  let p = cache.get(key)
  if (!p) { p = new PMTiles(new NodeFile(resolve(__dirname, 'build', `${key}.pmtiles`))); cache.set(key, p) }
  return p
}

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const { searchParams, pathname } = new URL(req.url, 'http://localhost')
  if (!pathname.startsWith('/api/parcel-tiles')) { res.statusCode = 404; return res.end('nope') }
  // Accept BOTH query-style (?r&v&z&x&y) and path-style (/r/v/z/x/y[.mvt]).
  let r, v, z, x, y
  const seg = pathname.replace(/^\/api\/parcel-tiles\/?/, '').replace(/\.mvt$/, '').split('/').filter(Boolean)
  if (seg.length === 5) {
    [r, v, z, x, y] = [seg[0], seg[1], Number(seg[2]), Number(seg[3]), Number(seg[4])]
  } else {
    r = searchParams.get('r'); v = searchParams.get('v')
    z = Number(searchParams.get('z')); x = Number(searchParams.get('x')); y = Number(searchParams.get('y'))
  }
  if (![z, x, y].every(Number.isInteger)) { res.statusCode = 400; return res.end('bad coords') }
  let tile
  try { tile = await pmtilesFor(r, v).getZxy(z, x, y) } catch (e) { res.statusCode = 502; return res.end('read failed: ' + e.message) }
  if (!tile) { res.statusCode = 204; return res.end() }
  const body = gzipSync(Buffer.from(tile.data))
  res.writeHead(200, { 'Content-Type': 'application/x-protobuf', 'Content-Encoding': 'gzip' })
  res.end(body)
}).listen(port, () => console.log(`parcel tiles at http://localhost:${port}/api/parcel-tiles`))
