// /ships vessel-track vector tiles: MVT out of the baked per-month PMTiles
// (MarineCadastre daily AIS points → our own tracks; scripts/ships/bake-ais/).
//
//   /api/ship-tracks?t=<YYYY-MM>&z=<z>&x=<x>&y=<y>      density tiles (MVT; crowded tiles drop lines)
//   /api/ship-tracks?t=<YYYY-MM>&mmsi=<9 digits>        EVERY track of one MMSI that month (GeoJSON),
//                                                      read from tracks-YYYY-MM.pack; see
//                                                      scripts/ships/bake-ais/build_tracks.py
//   /api/ship-tracks?op=all&mmsi=<9 digits>&v=<key>     EVERY track of one MMSI across EVERY month we have
//                                                      (Salish detail inside its box, US-wide elsewhere),
//                                                      simplified for display; one request per ship
//   /api/ship-tracks?op=voyages&mmsi=<9 digits>|imo=<7 digits>
//                                                      Climate TRACE voyage emissions for one ship (Salish Sea pull,
//                                                      scripts/ships/bake-ct-voyages; ship card Emissions tab)
//   /api/ship-tracks?r=mpa&z=<z>&x=<x>&y=<y>           NOAA Marine Protected Areas (MVT; one bake,
//                                                      scripts/ships/bake-mpa/, trackSource.mpa)
//   /api/ship-tracks?r=gfw&t=<YYYY-MM>&z=&x=&y= | &mmsi=   GFW hourly-position lines (scripts/ships/bake-gfw/, index
//                                                      trackSource.gfw.index; months/places NOAA doesn't cover)
//   /api/ship-tracks?op=gfwindex                       the GFW months (local bake in dev, else the Blob index)
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
  if (p && !p.src.fresh && region === 'salish' && existsSync(localPathFor(t, 'pack'))) { packs.delete(key); p = null } // drive plugged back in
  if (p) return p
  let src = null
  if (region === 'us') { const u = await usUrls(t); if (u) src = new BlobRange(u.pack, u.pack_bytes) }
  else if (region === 'gfw') {
    const local = gfwLocal(t, 'pack')
    if (local) src = new LocalFileSource(local)
    else { const u = (await gfwIndexNow()).months?.[t]; if (u?.pack) src = new BlobRange(u.pack, u.pack_bytes) }
  } else {
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
    out.push({ type: 'Feature', properties: { mmsi: r.mmsi, kind: r.kind, vtype: r.vtype, t0: r.t0, t1: r.t1, n: r.n, month: t,
      ...(region === 'gfw' ? { src: 'gfw', ...(r.est ? { est: 1 } : {}) } : {}), ...(Array.isArray(r.ts) ? { ts: r.ts } : {}) },
      geometry: { type: 'LineString', coordinates: r.c } })
  }
  return out
}
const isTileset = (t) => /^\d{4}-\d{2}$/.test(t)

// ─── Climate TRACE voyages: one ship's trips and port stays (scripts/ships/bake-ct-voyages) ───
// Same pack layout as the track packs; one NDJSON line per ship starting {"key":<mmsi|imo>,.
const voyagePacks = new Map()
async function voyagePack(kind) {
  let p = voyagePacks.get(kind)
  if (p && p.src.fresh && !p.src.fresh()) { p.src.close(); voyagePacks.delete(kind); p = null }
  if (p) return p
  const local = resolve(process.cwd(), `scripts/ships/bake-ct-voyages/build/ct-voyages-${kind}-${manifest.ctVoyages?.version || 'v1'}.pack`)
  const src = existsSync(local) ? new LocalFileSource(local) : manifest.ctVoyages?.[kind] ? new BlobRange(manifest.ctVoyages[kind]) : null
  if (!src) return null
  const head = Buffer.from((await src.getBytes(0, 8)).data)
  if (head.toString('ascii', 0, 4) !== 'SHTP') throw new Error('not a voyage pack')
  const n = head.readUInt32LE(4)
  const off = Buffer.from((await src.getBytes(8, (n + 1) * 4)).data)
  const offsets = new Uint32Array(n + 1)
  for (let i = 0; i <= n; i++) offsets[i] = off.readUInt32LE(i * 4)
  p = { src, n, dataStart: 8 + (n + 1) * 4, offsets, local: existsSync(local) }
  voyagePacks.set(kind, p)
  return p
}
export async function voyagesFor(kind, key) {
  const p = await voyagePack(kind)
  if (!p) return null
  const s = key % p.n, a = p.offsets[s], b = p.offsets[s + 1]
  if (b <= a) return { found: false }
  const raw = zlib.gunzipSync(Buffer.from((await p.src.getBytes(p.dataStart + a, b - a)).data)).toString('utf8')
  const line = raw.split('\n').find((l) => l.startsWith(`{"key":${key},`))
  return line ? { found: true, local: p.local, ...JSON.parse(line) } : { found: false, local: p.local }
}

// ─── One ship, every month (Josh 2026-09-27: a picked ship shows all its years) ───
// Reads each month's pack server-side in parallel, so the browser makes one request instead of ~140.
// Salish months use the detailed pack inside the Salish box and the US pack outside it (as the page does).
// Lines are simplified to ~60 m and rounded to 4 decimals (~10 m): a busy ferry's 11 years were 15 MB / 681k
// points at full detail. That is under a pixel at the zooms a multi-year view uses; zoom in to a month for detail.
function simplify(coords, tol = 0.0006) {
  if (coords.length < 3) return coords
  const keep = new Uint8Array(coords.length); keep[0] = keep[coords.length - 1] = 1
  const stack = [[0, coords.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = coords[a], [bx, by] = coords[b]
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    let far = -1, fd = tol * tol
    for (let i = a + 1; i < b; i++) {
      const [px, py] = coords[i]
      let u = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
      u = Math.max(0, Math.min(1, u))
      const ex = ax + u * dx - px, ey = ay + u * dy - py, d = ex * ex + ey * ey
      if (d > fd) { fd = d; far = i }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  return coords.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4])
}
async function mapLimit(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]) } }))
  return out
}
export async function allTracksForMmsi(mmsi) {
  await usUrls(manifest.months?.[0] || '2000-01') // loads the US index
  const usM = Object.keys(usIndex?.months || {})
  const salishM = new Set(manifest.months || [])
  const [w, s, e, n] = manifest.bbox
  const inside = (f) => f.geometry.coordinates.every(([x, y]) => x >= w && x <= e && y >= s && y <= n)
  const months = [...new Set([...usM, ...salishM])].sort()
  let failed = 0
  const per = await mapLimit(months, 16, async (t) => {
    const got = []
    const read = async (region, keep) => {
      try { const fs = await tracksForMmsi(t, mmsi, region); if (fs) got.push(...fs.filter(keep)) }
      catch (err) { failed++; packs.delete(`${region}:${t}`); console.error('[ship-tracks] all', region, t, err?.message) }
    }
    if (salishM.has(t)) await read('salish', () => true)
    if (usM.includes(t)) await read('us', salishM.has(t) ? (f) => !inside(f) : () => true)
    return got
  })
  const features = per.flat()
  // GFW hourly lines for the months and places NOAA doesn't cover (the bake already dropped NOAA-covered positions).
  const gfwM = Object.keys((await gfwIndexNow().catch(() => ({ months: {} }))).months || {})
  const gfwPer = await mapLimit(gfwM, 8, async (t) => {
    try { return (await tracksForMmsi(t, mmsi, 'gfw')) || [] } catch (err) { failed++; packs.delete(`gfw:${t}`); console.error('[ship-tracks] all gfw', t, err?.message); return [] }
  })
  features.push(...gfwPer.flat())
  for (const f of features) f.geometry.coordinates = simplify(f.geometry.coordinates)
  return { features, months: new Set([...months, ...gfwM]).size, failed }
}

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

// GFW hourly lines (scripts/ships/bake-gfw/, tileset gfw-v1): one PMTiles + pack per month, listed in an
// index (Blob: trackSource.gfw.index). In dev a local bake (cache/out/gfw-v1/) wins over Blob.
const gfwLocalDir = () => resolve(process.cwd(), `scripts/ships/bake-gfw/cache/out/${manifest.gfw?.rules || 'gfw-v1'}`)
let gfwIndex = null, gfwIndexAt = 0
export async function gfwIndexNow() {
  const local = resolve(gfwLocalDir(), 'index.json')
  if (process.env.VERCEL_ENV !== 'production' && existsSync(local)) {
    const { readFileSync } = await import('node:fs')
    return { ...JSON.parse(readFileSync(local, 'utf8')), local: true }
  }
  if (!manifest.gfw?.index) return { months: {} }
  if (!gfwIndex || Date.now() - gfwIndexAt > 5 * 60 * 1000) {
    const r = await fetch(`${manifest.gfw.index}?t=${Math.floor(Date.now() / 300000)}`)
    gfwIndex = r.ok ? await r.json() : { months: {} } // no index yet (404) = no GFW months
    gfwIndexAt = Date.now()
  }
  return gfwIndex
}
function gfwLocal(t, ext) {
  const f = resolve(gfwLocalDir(), t, `tracks.${ext}`)
  return process.env.VERCEL_ENV !== 'production' && existsSync(f) ? f : null
}

// Local bakes change under us while developing: never let a browser keep them.
const LOCAL_CACHE = 'no-store'
const cache = new Map()
async function pmtilesFor(t, region) {
  if (region === 'mpa') {
    let p = cache.get('mpa')
    if (p?.local && !p.local.fresh()) { p.local.close(); cache.delete('mpa'); p = null }
    if (!p) {
      const localPath = resolve(process.cwd(), `scripts/ships/bake-mpa/build/mpa-${manifest.mpa.version}.pmtiles`)
      if (existsSync(localPath)) { const local = new LocalFileSource(localPath); p = new PMTiles(local); p.local = local }
      else p = new PMTiles(new BlobRange(manifest.mpa.tiles))
      cache.set('mpa', p)
    }
    return p
  }
  if (region === 'gfw') {
    const key = `gfw:${t}`
    let p = cache.get(key)
    if (p?.local && !p.local.fresh()) { p.local.close(); cache.delete(key); p = null } // a rebake replaced the file
    if (!p) {
      const local = gfwLocal(t, 'pmtiles')
      if (local) { const src = new LocalFileSource(local); p = new PMTiles(src); p.local = src }
      else { const u = (await gfwIndexNow()).months?.[t]; if (!u?.tiles) return null; p = new PMTiles(new BlobRange(u.tiles, u.pmtiles_bytes)) }
      cache.set(key, p)
    }
    return p
  }
  if (region === 'us') {
    const key = `us:${t}`
    if (!cache.has(key)) { const u = await usUrls(t); if (!u) return null; cache.set(key, new PMTiles(new BlobRange(u.tiles, u.pmtiles_bytes))) }
    return cache.get(key)
  }
  let p = cache.get(t)
  const localPath = localPathFor(t)
  if (p?.local && !p.local.fresh()) { p.local.close(); cache.delete(t); p = null }
  // Local bakes can live on an external drive (symlinked): unplugged → Blob above; plugged back in → local again.
  if (p && !p.local && existsSync(localPath)) { cache.delete(t); p = null }
  if (!p) {
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

const gfwProto = new Map()
async function gfwProtoTile(searchParams, res) {
  const t = searchParams.get('t')
  const z = Number(searchParams.get('z')), x = Number(searchParams.get('x')), y = Number(searchParams.get('y'))
  const path = resolve(process.cwd(), `scripts/ships/bake-ais/cache/sources/gfw/tracks-proto/gfw-${t}.pmtiles`)
  if (process.env.VERCEL_ENV === 'production' || !['raw', 'routed'].includes(t) || !existsSync(path)) { res.statusCode = 404; return res.end('not available') }
  if (searchParams.get('meta') === '1') { // the page puts this stamp in its tile URLs, so a rebake never mixes tiles
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', LOCAL_CACHE)
    return res.end(JSON.stringify({ stamp: stampOf(path).replace(/[^0-9]/g, '').slice(-12) }))
  }
  if (![z, x, y].every(Number.isInteger)) { res.statusCode = 400; return res.end('bad tile coords') }
  let p = gfwProto.get(t)
  if (p && !p.local.fresh()) { p.local.close(); p = null }
  if (!p) { const local = new LocalFileSource(path); p = new PMTiles(local); p.local = local; gfwProto.set(t, p) }
  const tile = await p.getZxy(z, x, y).catch(() => null)
  res.setHeader('Cache-Control', LOCAL_CACHE)
  if (!tile) { res.statusCode = 204; return res.end() }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/x-protobuf')
  res.setHeader('Content-Encoding', 'gzip')
  return res.end(zlib.gzipSync(Buffer.from(tile.data)))
}

export default async function handler(req, res) {
  const { searchParams } = new URL(req.url, 'http://localhost')
  if (searchParams.get('op') === 'voyages') {
    const mmsi = searchParams.get('mmsi'), imo = searchParams.get('imo')
    const kind = mmsi ? 'mmsi' : 'imo', key = mmsi || imo
    if (!(mmsi ? /^\d{9}$/.test(mmsi) : /^\d{7}$/.test(imo || ''))) { res.statusCode = 400; return res.end('mmsi (9 digits) or imo (7 digits)') }
    let r
    try { r = await voyagesFor(kind, Number(key)) } catch (e) { console.error('[ship-tracks] voyages', e?.message); voyagePacks.delete(kind); res.statusCode = 502; return res.end('voyages read failed') }
    if (!r) { res.statusCode = 404; return res.end('voyages not built') }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', r.local ? LOCAL_CACHE : 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
    const { local, ...body } = r
    return res.end(JSON.stringify({ kind, ...body, dataset: manifest.ctVoyages?.version || 'ct-voyages-v1', release: manifest.ctVoyages?.release || 'v5.10.0' }))
  }
  if (searchParams.get('op') === 'all') {
    const m = searchParams.get('mmsi') || ''
    if (!/^\d{9}$/.test(m)) { res.statusCode = 400; return res.end('bad mmsi') }
    let r
    try { r = await allTracksForMmsi(Number(m)) } catch (e) { console.error('[ship-tracks] all', e?.message); res.statusCode = 502; return res.end('tracks read failed') }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/geo+json')
    // A partial read (a month failed) must not be cached for a month; the page's &v= key changes when months are added.
    res.setHeader('Cache-Control', r.failed ? 'no-store' : 'public, max-age=3600, s-maxage=2592000, stale-while-revalidate=604800')
    const body = JSON.stringify({ type: 'FeatureCollection', months: r.months, failed: r.failed, features: r.features })
    res.setHeader('Vary', 'Accept-Encoding')
    if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return res.end(body)
    res.setHeader('Content-Encoding', 'gzip')
    return res.end(zlib.gzipSync(body))
  }
  if (searchParams.get('op') === 'gfwindex') {
    let idx
    try { idx = await gfwIndexNow() } catch (e) { console.error('[ship-tracks] gfw index', e?.message); idx = { months: {} } }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', idx.local ? LOCAL_CACHE : 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600')
    return res.end(JSON.stringify({ version: idx.version, updated: idx.updated, local: !!idx.local,
      months: Object.fromEntries(Object.entries(idx.months || {}).map(([m, e]) => [m, { areas: e.areas, built: e.built, noaa_excluded: e.noaa_excluded }])) }))
  }
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
  const region = searchParams.get('r') || 'salish'
  // DEV-ONLY PROTOTYPE (2026-09-29): GFW hourly positions → lines for BC + Alaska, read from a local bake
  // (scripts/ships/bake-ais/gfw/build_gfw_tracks.py). Never served in production; 404 when the file is absent.
  if (region === 'gfwproto') return gfwProtoTile(searchParams, res)
  if (!['salish', 'us', 'mpa', 'gfw'].includes(region)) { res.statusCode = 400; return res.end('bad region') }
  const t = region === 'mpa' ? 'mpa' : searchParams.get('t')
  const z = Number(searchParams.get('z')), x = Number(searchParams.get('x')), y = Number(searchParams.get('y'))
  if (region !== 'mpa' && !isTileset(t || '')) { res.statusCode = 400; return res.end('bad tileset') }
  const mmsiParam = region === 'mpa' ? null : searchParams.get('mmsi')
  if (mmsiParam != null) {
    if (!/^\d{9}$/.test(mmsiParam)) { res.statusCode = 400; return res.end('bad mmsi') }
    let features
    try { features = await tracksForMmsi(t, Number(mmsiParam), region) } catch (e) { console.error('[ship-tracks] pack', region, t, e?.message); packs.delete(`${region}:${t}`); res.statusCode = 502; return res.end('pack read failed') }
    if (!features) { res.statusCode = 404; return res.end('month not built') }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/geo+json')
    res.setHeader('Cache-Control', (region === 'salish' && existsSync(localPathFor(t, 'pack'))) || (region === 'gfw' && gfwLocal(t, 'pack')) ? LOCAL_CACHE
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
    cache.delete(region === 'us' || region === 'gfw' ? `${region}:${t}` : t) // (t is 'mpa' for r=mpa)
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
