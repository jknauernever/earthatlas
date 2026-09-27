// /ships vessel-track vector tiles: MVT out of the baked per-month PMTiles
// (MarineCadastre daily AIS points → our own tracks; scripts/ships/bake-ais/).
//
//   /api/ship-tracks?t=<YYYY-MM>&z=<z>&x=<x>&y=<y>      density tiles (MVT; crowded tiles drop lines)
//   /api/ship-tracks?t=<YYYY-MM>&mmsi=<9 digits>        EVERY track of one MMSI that month (GeoJSON),
//                                                      read from tracks-YYYY-MM.pack; see
//                                                      scripts/ships/bake-ais/build_tracks.py
//   add &r=us for the US-wide tracks (MarineCadastre monthly track files, baked
//   in GitHub Actions by scripts/ships/bake-us/; file URLs come from the Blob
//   index at trackSource.us.index). Default r=salish.
//
// Same approach as api/vessel-tiles.js (/shiptraffic), deliberately a sibling
// rather than a change to that live endpoint. It range-reads the PMTiles and
// emits gzipped MVT, because Mapbox's native pmtiles:// breaks under Vite.
// Dev reads the local bake, prod reads the Blob URL from src/ships/trackSource.json.

import zlib from 'node:zlib'
import { openSync, readSync, existsSync, statSync, closeSync } from 'node:fs'
import { resolve } from 'node:path'
import { PMTiles } from 'pmtiles'
import manifest from '../src/ships/trackSource.json' with { type: 'json' }
import { decodeMvt } from '../lib/ships/mvt.js'

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
// Range reader for Blob files, used for the per-MMSI packs AND as the PMTiles source.
// While Blob's CDN is still caching a file (first minute after a cold read) it can answer a range
// from a partial copy: "bytes 0-16383/16384" for a 59 MB file. Short bytes then fail to un-gzip
// ("unexpected end of file"), and the first tile of every unopened month 502'd (2026-09-26). Blob
// may also gzip a cold range reply unless asked for identity, which Node can't un-gzip. So
// every range is checked against the file's TRUE size (from the index, else a HEAD) and retried.
class BlobRange {
  constructor(url, total = null) { this.url = url; this.total = total }
  getKey() { return this.url }
  async trueSize() {
    if (!this.total) {
      const r = await fetch(this.url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } })
      this.total = Number(r.headers.get('content-length')) || null
      if (!this.total) throw new Error(`size of ${this.url}: HTTP ${r.status}`)
    }
    return this.total
  }
  async getBytes(offset, length) {
    const size = await this.trueSize()
    const want = Math.min(length, size - offset)
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(this.url, { headers: { Range: `bytes=${offset}-${offset + want - 1}`, 'Accept-Encoding': 'identity' } })
      const buf = r.ok ? await r.arrayBuffer() : null
      const total = Number((r.headers.get('content-range') || '').split('/')[1]) || null
      if (buf && buf.byteLength === want && total === size) return { data: buf }
      if (attempt >= 40) throw new Error(`range ${r.status}: got ${buf?.byteLength ?? 0}/${want} bytes, total ${total} vs ${size}`)
      // Poll finely: the bad replies stop the moment the fill completes, and backing off
      // exponentially overshot a 10 s window to 12+ s.
      await new Promise((res) => setTimeout(res, Math.min(250 * 1.25 ** attempt, 750)))
    }
  }
}
const packs = new Map() // t → { src, n, dataStart, offsets }
async function packFor(t, region) {
  const key = `${region}:${t}`
  let p = packs.get(key)
  if (p && p.src.fresh && !p.src.fresh()) { p.src.close(); packs.delete(key); p = null }
  if (p) return p
  let src = null
  if (region === 'us') { const u = await usUrls(t); if (u) src = new BlobRange(u.pack, u.pack_bytes) }
  else {
    const local = localPathFor(t, 'pack')
    src = existsSync(local) ? new LocalFileSource(local) : manifest.packs?.[t] ? new BlobRange(manifest.packs[t]) : null
  }
  if (!src) return null
  // The shard table lives at the start of the pack, but reading it first makes the shard read the
  // pack's SECOND request, which lands in Blob's cold-fill window (~10 s for a 370 MB pack, see
  // BlobRange). So each US month's manifest.json carries a copy of it (pack_table: base64 of the
  // pack's first 8+4(N+1) bytes, scripts/ships/bake-us/pack-table.mjs); the shard read is then the
  // pack's first, always-correct read. Months without it fall back to reading the pack.
  let head = null, off = null
  if (region === 'us') {
    const u = await usUrls(t)
    const r = u?.manifest ? await fetch(`${u.manifest}?pt=1`, { headers: { 'Accept-Encoding': 'identity' } }).catch(() => null) : null
    const tb = r?.ok ? (await r.json().catch(() => ({}))).pack_table : null
    if (tb) { const b = Buffer.from(tb, 'base64'); head = b.subarray(0, 8); off = b.subarray(8) }
  }
  if (!head) head = Buffer.from((await src.getBytes(0, 8)).data)
  if (head.toString('ascii', 0, 4) !== 'SHTP') throw new Error('not a ship-track pack')
  const n = head.readUInt32LE(4)
  if (!off || off.length !== (n + 1) * 4) off = Buffer.from((await src.getBytes(8, (n + 1) * 4)).data)
  const offsets = new Uint32Array(n + 1)
  for (let i = 0; i <= n; i++) offsets[i] = off.readUInt32LE(i * 4)
  p = { src, n, dataStart: 8 + (n + 1) * 4, offsets }
  packs.set(key, p)
  return p
}
export async function tracksForMmsi(t, mmsi, region) {
  const p = await packFor(t, region)
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

// US-wide months: the bake's Blob index says where each month's files are.
let usIndex = null, usIndexAt = 0
async function usUrls(t) {
  if (!usIndex || Date.now() - usIndexAt > 5 * 60 * 1000) {
    const r = await fetch(`${manifest.us.index}?t=${Math.floor(Date.now() / 300000)}`)
    if (!r.ok) throw new Error(`us index ${r.status}`)
    usIndex = await r.json(); usIndexAt = Date.now()
  }
  return usIndex.months?.[t] || null
}

// Local bakes change under us while developing: never let a browser keep them.
const LOCAL_CACHE = 'no-store'
const cache = new Map()
async function pmtilesFor(t, region) {
  if (region === 'us') {
    const key = `us:${t}`
    if (!cache.has(key)) { const u = await usUrls(t); if (!u) return null; cache.set(key, new PMTiles(new BlobRange(u.tiles, u.pmtiles_bytes))) }
    return cache.get(key)
  }
  let p = cache.get(t)
  if (p?.local && !p.local.fresh()) { p.local.close(); cache.delete(t); p = null }
  if (!p) {
    const localPath = localPathFor(t)
    const blobUrl = manifest.tiles?.[t] || null
    if (existsSync(localPath)) { const local = new LocalFileSource(localPath); p = new PMTiles(local); p.local = local }
    else if (blobUrl) p = new PMTiles(new BlobRange(blobUrl))
    else return null
    cache.set(t, p)
  }
  return p
}

// ─── op=near: which ships' tracks pass a point (zoomed-out click, Josh 2026-09-26) ───
// Zoomed-out US tiles merge lines per vessel type (no MMSI), so a click there can't name a
// ship. Instead read the z9 US tiles (one line per track, with its MMSI) around the point and
// return the ships whose lines pass within `tol` metres, nearest first.
const NEAR_Z = 9
const lngToX = (lng, z) => ((lng + 180) / 360) * 2 ** z
const latToY = (lat, z) => { const r = (lat * Math.PI) / 180; return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z }
const xToLng = (x, z) => (x / 2 ** z) * 360 - 180
const yToLat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI
function segDistM(px, py, ax, ay, bx, by) { // metres, local equirectangular frame (inputs already in metres)
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
  const u = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + u * dx), py - (ay + u * dy))
}
async function shipsNear(months, lng, lat, tol) {
  const mPerDegLat = 111320, mPerDegLng = 111320 * Math.cos((lat * Math.PI) / 180)
  const dLat = tol / mPerDegLat, dLng = tol / mPerDegLng
  const x0 = Math.floor(lngToX(lng - dLng, NEAR_Z)), x1 = Math.floor(lngToX(lng + dLng, NEAR_Z))
  const y0 = Math.floor(latToY(lat + dLat, NEAR_Z)), y1 = Math.floor(latToY(lat - dLat, NEAR_Z))
  const tiles = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y])
  const ships = new Map()
  await Promise.all(months.flatMap((t) => tiles.map(async ([tx, ty]) => {
    const p = await pmtilesFor(t, 'us')
    const tile = p && await p.getZxy(NEAR_Z, tx, ty)
    if (!tile) return
    const layer = decodeMvt(new Uint8Array(tile.data))[manifest.us.sourceLayer]
    if (!layer) return
    const toM = ([gx, gy]) => {
      const lo = xToLng(tx + gx / layer.extent, NEAR_Z), la = yToLat(ty + gy / layer.extent, NEAR_Z)
      return [(lo - lng) * mPerDegLng, (la - lat) * mPerDegLat]
    }
    for (const f of layer.features) {
      const { mmsi } = f.properties
      if (mmsi == null) continue
      let best = Infinity
      for (const part of f.parts) {
        let prev = toM(part[0])
        if (part.length === 1) best = Math.min(best, Math.hypot(...prev))
        for (let i = 1; i < part.length; i++) { const cur = toM(part[i]); best = Math.min(best, segDistM(0, 0, ...prev, ...cur)); prev = cur }
      }
      if (best > tol) continue
      const s = ships.get(mmsi) || { mmsi, kind: f.properties.kind, vtype: f.properties.vtype, dist: Infinity, months: new Set(), t0: null }
      if (best < s.dist) { s.dist = best; s.t0 = f.properties.t0 ?? s.t0 }
      s.months.add(t)
      ships.set(mmsi, s)
    }
  })))
  return [...ships.values()].sort((a, b) => a.dist - b.dist)
    .map((s) => ({ ...s, dist: Math.round(s.dist), months: [...s.months].sort() }))
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  if (searchParams.get('op') === 'near') {
    const months = (searchParams.get('t') || '').split(',').filter(isTileset)
    const lng = Number(searchParams.get('lng')), lat = Number(searchParams.get('lat'))
    const tol = Math.min(25000, Math.max(50, Number(searchParams.get('tol')) || 2000))
    if (!months.length || months.length > 12 || !(Math.abs(lng) <= 180) || !(Math.abs(lat) <= 85)) { res.statusCode = 400; return res.end('bad near query') }
    let ships
    try { ships = await shipsNear(months, lng, lat, tol) } catch (e) { console.error('[ship-tracks] near', e?.message); res.statusCode = 502; return res.end('near failed') }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400')
    return res.end(JSON.stringify({ total: ships.length, ships: ships.slice(0, 30) }))
  }
  const t = searchParams.get('t')
  const z = Number(searchParams.get('z')), x = Number(searchParams.get('x')), y = Number(searchParams.get('y'))
  if (!isTileset(t || '')) { res.statusCode = 400; return res.end('bad tileset') }
  const region = searchParams.get('r') || 'salish'
  if (region !== 'salish' && region !== 'us') { res.statusCode = 400; return res.end('bad region') }
  const mmsiParam = searchParams.get('mmsi')
  if (mmsiParam != null) {
    if (!/^\d{9}$/.test(mmsiParam)) { res.statusCode = 400; return res.end('bad mmsi') }
    let features
    try { features = await tracksForMmsi(t, Number(mmsiParam), region) } catch (e) { console.error('[ship-tracks] pack', region, t, e?.message); packs.delete(`${region}:${t}`); res.statusCode = 502; return res.end('pack read failed') }
    if (!features) { res.statusCode = 404; return res.end('month not built') }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/geo+json')
    res.setHeader('Cache-Control', region === 'salish' && existsSync(localPathFor(t, 'pack')) ? LOCAL_CACHE
      : 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
    return res.end(JSON.stringify({ type: 'FeatureCollection', features }))
  }
  if (![z, x, y].every(Number.isInteger)) { res.statusCode = 400; return res.end('bad tile coords') }
  let p
  try { p = await pmtilesFor(t, region) } catch (e) { console.error('[ship-tracks] index', e?.message); res.statusCode = 502; res.setHeader('Cache-Control', 'no-store'); return res.end('index read failed') }
  if (!p) { res.statusCode = 404; return res.end('tileset not built') }
  let tile
  try {
    tile = await p.getZxy(z, x, y)
  } catch (e) {
    console.error('[ship-tracks] tile', region, t, z, x, y, e?.message)
    cache.delete(region === 'us' ? `us:${t}` : t)
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
