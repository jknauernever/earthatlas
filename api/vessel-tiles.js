// Vessel-track vector-tile endpoint — serves MVT tiles out of the baked
// PER-MONTH PMTiles (real MarineCadastre AIS, Salish Sea, 2024–2025).
//
//   /api/vessel-tiles?m=<YYYY-MM>&z=<z>&x=<x>&y=<y>
//
// One PMTiles per month; the app stacks only the months in view (capped +
// sampled), so each tile stays ~150-460 KB. A single combined file produced
// ~16 MB tiles that hung the Mapbox worker, so we never merge months.
//
// Same approach as api/parcel-tiles.js: Mapbox's native .pmtiles source throws
// `__vite__injectQuery` under Vite's dev pipeline, so we range-read the PMTiles
// here and emit gzipped MVT. Tiles are static per data version, so the CDN
// caches each one hard.
//
// SOURCE: in local dev the function range-reads the baked file from disk
// (sub-ms); in production those files aren't bundled, so it falls back to the
// per-month Blob URL recorded in the manifest. Node runtime for node:zlib + fs.

import zlib from 'node:zlib'
import { openSync, readSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'
import manifest from '../src/shiptraffic/trackSource.json' with { type: 'json' }

// pmtiles Source that range-reads a local file (dev) — opens the fd once.
class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.allocUnsafe(length)
    readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) }
  }
}

const localPathFor = (month) =>
  resolve(process.cwd(), `scripts/bake-shiptraffic/track_tiles/tracks-${month}.pmtiles`)

// Reuse the PMTiles instance (cached header/directory) across warm invocations.
const cache = new Map()
function pmtilesFor(month) {
  let p = cache.get(month)
  if (!p) {
    const localPath = localPathFor(month)
    const blobUrl = manifest.tiles?.[month]
    if (existsSync(localPath)) p = new PMTiles(new LocalFileSource(localPath))
    else if (blobUrl) p = new PMTiles(new FetchSource(blobUrl))
    else return null
    cache.set(month, p)
  }
  return p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const month = searchParams.get('m')
  const z = Number(searchParams.get('z'))
  const x = Number(searchParams.get('x'))
  const y = Number(searchParams.get('y'))
  if (!/^\d{4}-\d{2}$/.test(month || '')) { res.statusCode = 400; return res.end('bad month') }
  if (![z, x, y].every(Number.isInteger)) { res.statusCode = 400; return res.end('bad tile coords') }

  const p = pmtilesFor(month)
  if (!p) { res.statusCode = 404; return res.end('month not deployed') }

  let tile
  try {
    tile = await p.getZxy(z, x, y)
  } catch {
    cache.delete(month) // drop a stale instance (e.g. file replaced)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!tile) {
    res.statusCode = 204
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.end()
  }

  const body = zlib.gzipSync(Buffer.from(tile.data))
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
  res.end(body)
}
