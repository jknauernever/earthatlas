// Climate TRACE facility vector tiles — serves MVT out of the baked PMTiles
// (scripts/bake-climatetrace; every facility-level source in a release, each
// carrying its monthly series).
//
//   /api/trace-tiles?v=<version>&z=<z>&x=<x>&y=<y>
//
// Same approach as api/vessel-tiles.js: Mapbox's native .pmtiles source breaks
// under Vite's dev pipeline, so we range-read the PMTiles here and emit gzipped
// MVT. `v` names the release folder in Blob (see api/_trace-store.js), so each
// tile URL is immutable and the CDN caches it hard. Dev reads the local bake.

import zlib from 'node:zlib'
import { PMTiles } from 'pmtiles'
import { traceReader } from './_trace-store.js'

const pmCache = new Map() // reader → PMTiles (header/directories cached)

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const v = searchParams.get('v') || ''
  const z = Number(searchParams.get('z'))
  const x = Number(searchParams.get('x'))
  const y = Number(searchParams.get('y'))
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22) { res.statusCode = 400; return res.end('bad tile coords') }

  const src = traceReader('trace-facilities.pmtiles', v)
  if (!src) { res.statusCode = 404; return res.end('unknown release') }
  let p = pmCache.get(src)
  if (!p) {
    p = new PMTiles(src)
    pmCache.set(src, p)
    if (pmCache.size > 8) pmCache.delete(pmCache.keys().next().value)
  }

  let tile
  try {
    tile = await p.getZxy(z, x, y)
  } catch {
    pmCache.delete(src)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  // Vary so the CDN never serves a cached identity copy to gzip clients.
  res.setHeader('Vary', 'Accept-Encoding')
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
