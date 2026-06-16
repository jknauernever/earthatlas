// Parcel vector-tile endpoint — serves MVT tiles out of a region's PMTiles file.
//
//   /api/parcel-tiles?r=<region>&v=<version>&z=<z>&x=<x>&y=<y>
//
// Why this instead of Mapbox's native .pmtiles source: Mapbox GL JS's PMTiles
// support loads a provider plugin that throws `__vite__injectQuery` under Vite's
// dev pipeline — i.e. it breaks on localhost, where we QA. This endpoint is
// version-independent and behaves identically in dev and prod. Tiles are static
// per data version, so responses are cached hard at the CDN.
//
// Node runtime (not edge) so we can (a) gzip with node:zlib — vercel-dev's edge
// emulation lacks CompressionStream — and (b) read the baked PMTiles straight
// from disk in local dev (see below).
//
// SOURCE SELECTION: in local dev the function range-reads the baked file from
// disk (sub-ms); reading the remote Blob from a dev machine is ~1s/tile, which
// starves Mapbox's tile loader and renders tiles inconsistently. In production
// the file isn't in the bundle, so it falls back to the Blob URL (the function
// sits next to Blob on Vercel's network, and the CDN caches every tile).

import zlib from 'node:zlib'
import { openSync, readSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'
import sources from '../src/fire/parcelSources.json' with { type: 'json' }

// A pmtiles Source that range-reads a local file (used in dev). Opens the fd
// once and reads only the requested byte range — no loading the whole file.
class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.allocUnsafe(length)
    readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) }
  }
}

// Reuse PMTiles instances (and their cached header/directory) across warm
// invocations — avoids re-reading the header/directory per tile.
const cache = new Map()
function pmtilesFor(region, version, blobUrl) {
  const key = `${region}-${version}`
  let p = cache.get(key)
  if (!p) {
    const localPath = resolve(process.cwd(), 'scripts/bake-parcels/build', `${key}.pmtiles`)
    const src = existsSync(localPath) ? new LocalFileSource(localPath) : new FetchSource(blobUrl)
    p = new PMTiles(src)
    cache.set(key, p)
  }
  return p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const r = searchParams.get('r')
  const v = searchParams.get('v')
  const z = Number(searchParams.get('z'))
  const x = Number(searchParams.get('x'))
  const y = Number(searchParams.get('y'))

  const region = sources[r]
  if (!region || !region.pmtilesUrl) { res.statusCode = 404; return res.end('unknown region') }
  if (![z, x, y].every(Number.isInteger)) { res.statusCode = 400; return res.end('bad tile coords') }
  const version = v || region.version

  let tile
  try {
    tile = await pmtilesFor(r, version, region.pmtilesUrl).getZxy(z, x, y)
  } catch {
    cache.delete(`${r}-${version}`) // drop a stale instance (e.g. file replaced)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }

  res.setHeader('Access-Control-Allow-Origin', '*')
  if (!tile) {
    // No data for this tile — 204 tells Mapbox "empty", and we still cache it.
    res.statusCode = 204
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.end()
  }

  const body = zlib.gzipSync(Buffer.from(tile.data))
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  // Versioned request (&v=) ⇒ safe to cache hard; data only changes on re-bake.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
  res.end(body)
}
