// /ships vessel-track vector tiles: MVT out of the baked per-month PMTiles
// (MarineCadastre daily AIS points → our own tracks; scripts/ships/bake-ais/).
//
//   /api/ship-tracks?t=<YYYY-MM>&z=<z>&x=<x>&y=<y>      density tiles (MVT; crowded tiles drop lines)
//   /api/ship-tracks?t=<YYYY-MM>&mmsi=<9 digits>        EVERY track of one MMSI that month (GeoJSON),
//                                                      read from tracks-YYYY-MM.pack; see
//                                                      scripts/ships/bake-ais/build_tracks.py
//
// Same approach as api/vessel-tiles.js (/shiptraffic), deliberately a sibling
// rather than a change to that live endpoint. It range-reads the PMTiles and
// emits gzipped MVT, because Mapbox's native pmtiles:// breaks under Vite.
// Dev reads the local bake, prod reads the Blob URL from src/ships/trackSource.json.

import zlib from 'node:zlib'
import { openSync, readSync, existsSync, statSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles, FetchSource } from 'pmtiles'
import manifest from '../src/ships/trackSource.json' with { type: 'json' }

// Local dev: a re-bake replaces the file (os.replace), so remember which file we
// opened and reopen when it changes, as api/_trace-store.js does.
const stampOf = (path) => { try { const st = statSync(path); return `${st.ino}:${st.mtimeMs}` } catch { return null } }
class LocalFileSource {
  constructor(path) { this.fd = openSync(path, 'r'); this.path = path; this.stamp = stampOf(path) }
  fresh() { return stampOf(this.path) === this.stamp }
  close() { try { closeSync(this.fd) } catch { /* already closed */ } }
  getKey() { return this.path }
  async getBytes(offset, length) {
    const buf = Buffer.allocUnsafe(length)
    readSync(this.fd, buf, 0, length, offset)
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + length) }
  }
}

const localPathFor = (t, ext = 'pmtiles') => resolve(process.cwd(), `scripts/ships/bake-ais/track_tiles/tracks-${t}.${ext}`)

// ─── Per-MMSI pack: 'SHTP', uint32 N, (N+1) uint32 offsets, N gzip'd NDJSON shards ───
class BlobRange {
  constructor(url) { this.url = url }
  async getBytes(offset, length) {
    const r = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } })
    if (!r.ok) throw new Error(`pack range ${r.status}`)
    return { data: await r.arrayBuffer() }
  }
}
const packs = new Map() // t → { src, n, dataStart, offsets }
async function packFor(t) {
  let p = packs.get(t)
  if (p && p.src.fresh && !p.src.fresh()) { p.src.close(); packs.delete(t); p = null }
  if (p) return p
  const local = localPathFor(t, 'pack')
  const src = existsSync(local) ? new LocalFileSource(local) : manifest.packs?.[t] ? new BlobRange(manifest.packs[t]) : null
  if (!src) return null
  const head = Buffer.from((await src.getBytes(0, 8)).data)
  if (head.toString('ascii', 0, 4) !== 'SHTP') throw new Error('not a ship-track pack')
  const n = head.readUInt32LE(4)
  const off = Buffer.from((await src.getBytes(8, (n + 1) * 4)).data)
  const offsets = new Uint32Array(n + 1)
  for (let i = 0; i <= n; i++) offsets[i] = off.readUInt32LE(i * 4)
  p = { src, n, dataStart: 8 + (n + 1) * 4, offsets }
  packs.set(t, p)
  return p
}
async function tracksForMmsi(t, mmsi) {
  const p = await packFor(t)
  if (!p) return null
  const s = mmsi % p.n
  const a = p.offsets[s], b = p.offsets[s + 1]
  if (b <= a) return []
  const raw = zlib.gunzipSync(Buffer.from((await p.src.getBytes(p.dataStart + a, b - a)).data)).toString('utf8')
  const out = []
  for (const line of raw.split('\n')) {
    if (!line || !line.startsWith(`{"mmsi":${mmsi},`)) continue
    const r = JSON.parse(line)
    out.push({ type: 'Feature', properties: { mmsi: r.mmsi, kind: r.kind, vtype: r.vtype, t0: r.t0, t1: r.t1, n: r.n, month: t },
      geometry: { type: 'LineString', coordinates: r.c } })
  }
  return out
}
const isTileset = (t) => /^\d{4}-\d{2}$/.test(t)

// Local bakes change under us while developing: never let a browser keep them.
const LOCAL_CACHE = 'no-store'
const cache = new Map()
function pmtilesFor(t) {
  let p = cache.get(t)
  if (p?.local && !p.local.fresh()) { p.local.close(); cache.delete(t); p = null }
  if (!p) {
    const localPath = localPathFor(t)
    const blobUrl = manifest.tiles?.[t] || null
    if (existsSync(localPath)) { const local = new LocalFileSource(localPath); p = new PMTiles(local); p.local = local }
    else if (blobUrl) p = new PMTiles(new FetchSource(blobUrl))
    else return null
    cache.set(t, p)
  }
  return p
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  const t = searchParams.get('t')
  const z = Number(searchParams.get('z')), x = Number(searchParams.get('x')), y = Number(searchParams.get('y'))
  if (!isTileset(t || '')) { res.statusCode = 400; return res.end('bad tileset') }
  const mmsiParam = searchParams.get('mmsi')
  if (mmsiParam != null) {
    if (!/^\d{9}$/.test(mmsiParam)) { res.statusCode = 400; return res.end('bad mmsi') }
    let features
    try { features = await tracksForMmsi(t, Number(mmsiParam)) } catch { packs.delete(t); res.statusCode = 502; return res.end('pack read failed') }
    if (!features) { res.statusCode = 404; return res.end('month not built') }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/geo+json')
    res.setHeader('Cache-Control', existsSync(localPathFor(t, 'pack')) ? LOCAL_CACHE
      : 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
    return res.end(JSON.stringify({ type: 'FeatureCollection', features }))
  }
  if (![z, x, y].every(Number.isInteger)) { res.statusCode = 400; return res.end('bad tile coords') }
  const p = pmtilesFor(t)
  if (!p) { res.statusCode = 404; return res.end('tileset not built') }
  let tile
  try {
    tile = await p.getZxy(z, x, y)
  } catch {
    cache.delete(t)
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    return res.end('tile read failed')
  }
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Vary', 'Accept-Encoding') // see api/vessel-tiles.js: keeps gzip/identity CDN variants apart
  if (!tile) {
    res.statusCode = 204
    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
    return res.end()
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  res.setHeader('Cache-Control', p.local ? LOCAL_CACHE : 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
  res.end(zlib.gzipSync(Buffer.from(tile.data)))
}
