// SPUN underground-fungi raster tiles for the /inmotion Underground fungi layer.
//
//   /api/spun-tiles?m=<measure>&z=<z>&x=<x>&y=<y>&v=<bake>
//
// One PMTiles pyramid per map (scripts/bake-spun/tiles.py), z0-z6, one grey
// byte per pixel carrying the VALUE (0 = no prediction); the browser colours
// it with Mapbox `raster-color`. Same shape as api/rain-tiles.js (range-read
// the archive, hand back the stored image; Mapbox's native pmtiles source
// breaks under Vite's dev pipeline). Tiles never change within a bake, so the
// CDN caches hard and a new bake busts it through `v`.
//
// Local dev range-reads public/dev-data; production reads Blob.

import { openSync, readSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'

const BLOB_PUBLIC_BASE =
  process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'

const MEASURES = new Set(['hyphae', 'am-rich', 'ecm-rich', 'am-rare', 'am-rare-emp', 'ecm-rare', 'ecm-rare-emp', 'am-hot', 'ecm-hot'])
// Ocean and masked land are never stored; they must still decode (see rain-tiles).
const EMPTY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=', 'base64')
const localPath = (m) => resolve(process.cwd(), `public/dev-data/systems/spun-${m}.pmtiles`)
const blobUrl = (m) => `${BLOB_PUBLIC_BASE}/systems/spun-${m}.pmtiles`

class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.alloc(length) // not allocUnsafe: a short read must fail to decode, not draw garbage
    const n = readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }
  }
}

const cache = new Map()
function archive(m) {
  const local = localPath(m)
  let got = cache.get(m)
  if (existsSync(local)) {
    const mtime = statSync(local).mtimeMs
    if (!got || got.key !== local || got.mtime !== mtime) {
      got = { key: local, mtime, p: new PMTiles(new LocalFileSource(local)) }
      cache.set(m, got)
    }
    return got.p
  }
  const url = blobUrl(m)
  if (!got || got.key !== url) {
    got = { key: url, p: new PMTiles(new FetchSource(url)) }
    cache.set(m, got)
  }
  return got.p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const m = searchParams.get('m')
  if (!MEASURES.has(m)) { res.statusCode = 400; return res.end('bad measure') }
  const z = Number(searchParams.get('z'))
  const x = Number(searchParams.get('x'))
  const y = Number(searchParams.get('y'))
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24) {
    res.statusCode = 400
    return res.end('bad tile coords')
  }

  let tile
  try {
    tile = await archive(m).getZxy(z, x, y)
  } catch {
    cache.delete(m)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.statusCode = 200
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800')
  res.end(tile ? Buffer.from(tile.data) : EMPTY_PNG)
}
