// Baked precipitation raster tiles for the /inmotion Precipitation layer.
//
//   /api/rain-tiles?t=<gsmap|mrms>&z=<z>&x=<x>&y=<y>[&f=<ms>]
//
// Two tiers, one endpoint, one tile layout, one colour ramp (both bakes share
// scripts/_rain_common.py so they cannot drift apart):
//
//   gsmap  JAXA GSMaP_NOW   global,   11 km, ~30 min old   z0-z5
//   mrms   NOAA MRMS        CONUS,     1 km,  ~2 min old   z5-z7
//
// Each bake emits a real pyramid, max-pooled on the way down so a 1 km cell
// survives into the coarse levels instead of being averaged into nothing. (A
// single `image` source cannot do this: Mapbox draws it as one texture with no
// mipmaps, so minifying it skipped most texels and sparse rain vanished.)
//
// NOAA GOES RRQPE was a middle tier and was removed on 2026-09-23: an infrared
// estimate that misses light and stratiform rain (17% of central New Mexico
// raining against MRMS's 49% in the same ten minutes).
//
// Same shape as api/vessel-tiles.js: Mapbox's native .pmtiles source throws
// `__vite__injectQuery` under Vite's dev pipeline, so we range-read the
// archive here and hand back the stored WebP. Tiles are static per bake, so
// the CDN caches each one hard and a bake busts it with `?v=`.
//
// Local dev range-reads public/dev-data; production falls back to Blob.

import { openSync, readSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'

const BLOB_PUBLIC_BASE =
  process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'

const ARCHIVES = { gsmap: 'gsmap-now', mrms: 'mrms-conus' }
// `f` selects an archived frame instead of the latest one, so a replay at a
// zoomed-in view keeps the sharp product instead of falling back to the
// global 11 km one magnified sixty-four times.
const framePath = (name, f) => (f ? `${name}/${f}` : name)
const EMPTY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=', 'base64')
const localPath = (n) => resolve(process.cwd(), `public/dev-data/systems/${n}.pmtiles`)
const blobUrl = (n) => `${BLOB_PUBLIC_BASE}/systems/${n}.pmtiles`

class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path }
  getKey() { return this.path }
  async getBytes(offset, length) {
    // Buffer.alloc, NOT allocUnsafe. A range read that runs past the end of
    // the file (which happens while a bake is mid-rewrite, or on the last
    // tile) fills only part of the buffer; allocUnsafe would hand back
    // uninitialised heap for the remainder, and a WebP decoded from that
    // renders as an opaque black square over the map. Returning only the
    // bytes actually read makes a short read a decode failure instead, which
    // draws nothing.
    const buf = Buffer.alloc(length)
    const n = readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) }
  }
}

// One PMTiles instance across warm invocations, so the header and directory
// are read once rather than per tile. Re-opened if the local file is replaced
// by a fresh bake (mtime is the cheap way to notice).
const cache = new Map()
function archive(tier, frame) {
  const name = framePath(ARCHIVES[tier], frame)
  const local = localPath(name)
  let got = cache.get(name)
  if (existsSync(local)) {
    const mtime = statSync(local).mtimeMs
    if (!got || got.key !== local || got.mtime !== mtime) {
      got = { key: local, mtime, p: new PMTiles(new LocalFileSource(local)) }
      cache.set(name, got)
    }
    return got.p
  }
  const url = blobUrl(name)
  if (!got || got.key !== url) {
    got = { key: url, p: new PMTiles(new FetchSource(url)) }
    cache.set(name, got)
  }
  return got.p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const tier = searchParams.get('t') || 'gsmap'
  if (!ARCHIVES[tier]) { res.statusCode = 400; return res.end('bad tier') }
  const frame = searchParams.get('f')
  if (frame && !/^\d{10,16}$/.test(frame)) { res.statusCode = 400; return res.end('bad frame') }
  const z = Number(searchParams.get('z'))
  const x = Number(searchParams.get('x'))
  const y = Number(searchParams.get('y'))
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 24) {
    res.statusCode = 400
    return res.end('bad tile coords')
  }

  let tile
  try {
    tile = await archive(tier, frame).getZxy(z, x, y)
  } catch {
    cache.delete(framePath(ARCHIVES[tier], frame)) // drop a stale instance (file replaced mid-read)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  // A tile with no rain in it is never stored by the bake. It still has to be
  // answered with a DECODABLE IMAGE, not a 204: Mapbox hands a raster tile
  // body straight to the image decoder, and an empty one throws "the source
  // image could not be decoded" — 65 of them on a single dry view of Kansas,
  // which is both noise and a good way to hide a real error. A 1x1
  // transparent PNG scales to a transparent 256x256 and costs 68 bytes.
  if (!tile) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400')
    return res.end(EMPTY_PNG)
  }

  res.statusCode = 200
  res.setHeader('Content-Type', 'image/webp')
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400')
  res.end(Buffer.from(tile.data))
}
