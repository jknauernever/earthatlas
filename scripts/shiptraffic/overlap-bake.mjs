#!/usr/bin/env node
/**
 * /shiptraffic overlap bake (docs/WHALES_AND_SHIPTRAFFIC_PLAN.md Phases 3–4). Runs in GitHub Actions
 * (.github/workflows/shiptraffic-overlap-bake.yml), never on a laptop for real months.
 *
 * For each month it streams /ships' per-MMSI track packs from Blob — NOAA MarineCadastre (us-v2) and
 * Global Fishing Watch hourly lines (gfw-v1; GFW leaves out the boxes NOAA covers in months NOAA has
 * published, so the two never double-count) — keeps the Salish Sea box, and writes:
 *
 *   grid.json         every ~1 km cell with traffic or whales: distinct vessels per ship kind, and the
 *                     whale reports in it (from /api/whales, our whale database)
 *   closepasses.json  for each whale report: the vessels whose track passed within CLOSE_M metres of it
 *                     within ±CLOSE_H hours (date-only reports: the same day), nearest first
 *
 * to Blob shiptraffic/overlap-v1/YYYY-MM/, and lists the month in shiptraffic/overlap-v1/index.json with
 * the source builds it used. Uploads use one-file tokens from api/cron/ships-upload-token.js (CRON_SECRET).
 *
 *   node scripts/shiptraffic/overlap-bake.mjs --months auto            months whose sources changed, the last 45 days,
 *                                                                      and any month baked more than 30 days ago
 *   node scripts/shiptraffic/overlap-bake.mjs --months 2025-07,2026-10 [--out DIR] [--no-publish] [--shards N] [--force]
 *
 * A month whose packs, whale reports and bake code are all unchanged since its last bake is skipped (--force redoes it).
 *
 * --shards N reads only the first N of each pack's shards (local proving on a slice; never published).
 */
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { put } from '@vercel/blob/client'
import { groupSightings, locationRadiusM, spreadBox, groupPoints, nearPoints, APPROX_M, TOO_VAGUE_M } from '../../lib/whales/precision.js'
import { WHALE_SOURCES } from '../../lib/whales/sources.js'

const BLOB_BASE = process.env.SHIPS_BLOB_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'
const SITE = process.env.SITE_BASE || 'https://earthatlas.org'
const TOKEN_URL = `${SITE}/api/cron/ships-upload-token`
const TRACKS = JSON.parse(readFileSync(new URL('../../src/ships/trackSource.json', import.meta.url), 'utf8'))
export const VERSION = 'overlap-v1'
export const BBOX = [-125.5, 46.9, -122.0, 49.9] // w,s,e,n — Salish Sea, Strait of Juan de Fuca, outer coast, southern Strait of Georgia
export const CELL = { lngStep: 0.012, latStep: 0.0081 } // ≈ 0.9 km
export const CLOSE_M = 1000
export const CLOSE_H = 3
// Close passes measure against where ships actually were: our estimated water paths (GFW `est` lines) never count,
// and between two reported positions more than SEG_MAX_M apart (GFW is hourly) only the positions themselves count,
// not the straight line between them.
export const SEG_MAX_M = 2000
const FIRST_MONTH = '2024-01'
const KINDS = ['cargo', 'tanker', 'passenger', 'fishing', 'tug', 'pleasure', 'other', 'unknown']

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return acc
}, []))
const OUT = resolve(args.out || 'scripts/shiptraffic/cache/out')
const SHARDS = args.shards ? Number(args.shards) : null
const PUBLISH = !args['no-publish'] && !SHARDS

const [W, S, E, N] = BBOX
const NX = Math.ceil((E - W) / CELL.lngStep)
const inBox = (x, y) => x >= W && x <= E && y >= S && y <= N
const cellOf = (x, y) => Math.floor((y - S) / CELL.latStep) * NX + Math.floor((x - W) / CELL.lngStep)
const M_PER_DEG_LAT = 111320

function metres(ax, ay, bx, by) {
  const k = Math.cos(((ay + by) / 2) * Math.PI / 180)
  return Math.hypot((bx - ax) * k * M_PER_DEG_LAT, (by - ay) * M_PER_DEG_LAT)
}

// ─── Packs: 'SHTP', uint32 N, (N+1) uint32 offsets, N gzip'd NDJSON shards (api/ship-tracks.js) ───
async function range(url, a, b) {
  for (let i = 0; ; i++) {
    let buf = null, status = 0
    try {
      const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}`, 'Accept-Encoding': 'identity' } })
      status = r.status
      buf = r.ok ? Buffer.from(await r.arrayBuffer()) : null
    } catch (e) { status = e.message }
    if (buf && buf.length === b - a + 1) return buf
    if (i >= 20) throw new Error(`range ${a}-${b} of ${url}: ${status}`)
    await new Promise((ok) => setTimeout(ok, 500 * (i + 1)))
  }
}

/** Calls onLine(record) for every track line in the pack. The body is read in ~32 MB ranges (whole shards each),
 * every range retried on its own: one long GET of a 500 MB pack was cut off about a minute in (2026-10-17). */
const CHUNK = 32 * 1024 * 1024
async function eachLine(url, onLine) {
  const head = await range(url, 0, 7)
  if (head.toString('ascii', 0, 4) !== 'SHTP') throw new Error(`not a pack: ${url}`)
  const n = head.readUInt32LE(4)
  const offBuf = await range(url, 8, 8 + (n + 1) * 4 - 1)
  const off = (i) => offBuf.readUInt32LE(i * 4)
  const dataStart = 8 + (n + 1) * 4
  const last = SHARDS ? Math.min(n, SHARDS) : n
  let bytes = 0
  for (let a = 0; a < last;) {
    let b = a + 1
    while (b < last && off(b + 1) - off(a) <= CHUNK) b++
    const lo = off(a), hi = off(b)
    if (hi > lo) {
      const buf = await range(url, dataStart + lo, dataStart + hi - 1)
      bytes += buf.length
      for (let sh = a; sh < b; sh++) {
        const want = off(sh + 1) - off(sh)
        if (!want) continue
        const chunk = buf.subarray(off(sh) - lo, off(sh + 1) - lo)
        for (const line of zlib.gunzipSync(chunk).toString('utf8').split('\n')) if (line) onLine(JSON.parse(line))
      }
    }
    a = b
  }
  return { shards: last, of: n, bytes }
}

// ─── One month ───────────────────────────────────────────────────────────────
function monthBounds(ym) {
  const [y, m] = ym.split('-').map(Number)
  const from = `${ym}-01`
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { from, to, t0: Date.parse(`${from}T00:00:00Z`) / 1000, t1: Date.parse(`${to}T23:59:59Z`) / 1000 }
}

export async function whalesFor(ym) {
  const { from, to } = monthBounds(ym)
  const out = []
  // 7-day slices keep each answer under the API's 2,000-row cap; a slice that still overflows splits by day.
  const slices = []
  for (let d = Date.parse(`${from}T00:00:00Z`); d <= Date.parse(`${to}T00:00:00Z`); d += 7 * 86400000) {
    const a = new Date(d).toISOString().slice(0, 10)
    const b = new Date(Math.min(d + 6 * 86400000, Date.parse(`${to}T00:00:00Z`))).toISOString().slice(0, 10)
    slices.push([a, b])
  }
  while (slices.length) {
    const [a, b] = slices.shift()
    const url = `${SITE}/api/whales?bbox=${BBOX.join(',')}&from=${a}&to=${b}&limit=2000`
    const r = await fetch(url)
    if (!r.ok) throw new Error(`whales ${a}…${b}: HTTP ${r.status}`)
    const j = await r.json()
    if (j.truncated && a < b) {
      for (let d = Date.parse(`${a}T00:00:00Z`); d <= Date.parse(`${b}T00:00:00Z`); d += 86400000) {
        const day = new Date(d).toISOString().slice(0, 10)
        slices.push([day, day])
      }
      continue
    }
    if (j.truncated) console.warn(`  whales ${a}: more than 2,000 reports in one day; using the newest 2,000`)
    out.push(...(j.sightings || []))
  }
  return out
}

/** Reference time (unix s) and tolerance (s) for matching a whale report to vessel times. */
function whaleTime(w) {
  if (w.time_precision === 'exact' && w.observed_at) return { t: Date.parse(w.observed_at) / 1000, tol: CLOSE_H * 3600 }
  // Date-only (HappyWhale, some OBIS): local solar noon of that date, ± 12 h.
  const noon = Date.parse(`${w.observed_date}T12:00:00Z`) / 1000 - (w.lng / 15) * 3600
  return { t: noon, tol: 12 * 3600 }
}

/** Calls fn(cell) once for every in-box ~1 km cell a segment crosses. */
function eachCellOf(ax, ay, bx, by, fn) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax) / CELL.lngStep, Math.abs(by - ay) / CELL.latStep) * 2))
  const seen = new Set()
  for (let k = 0; k <= steps; k++) {
    const x = ax + ((bx - ax) * k) / steps
    const y = ay + ((by - ay) * k) / steps
    if (!inBox(x, y)) continue
    const c = cellOf(x, y)
    if (seen.has(c)) continue
    seen.add(c)
    fn(c)
  }
}

// ─── Ship side: everything a month needs from the packs, independent of whale reports ───
// { traffic: Map(cell → Uint32Array distinct vessels per KINDS), segList: [[vesselId, kind, ax, ay, ta, bx, by, tb, closeMode]…]
//   (closeMode 1 = endpoints only, 2 = whole segment; never-close segments aren't kept), stats, sources }
// Old months are redone every 30 days for late whale reports while their packs (0.5–1 GB each) rarely change, so the ship
// side is saved next to the month (ships-<key>.bin.gz, ~1–3% of the packs' size) and reused while both packs' builds match.
export async function shipSideFromPacks({ us, gfw }) {
  const vessels = new Map() // cell → Map(kind → Set(vessel id))
  const segList = []
  const stats = { lines: 0, inBox: 0, segments: 0 }

  const addSegment = (vid, kind, ax, ay, ta, bx, by, tb, closeMode) => {
    // Only segments that can count as a close pass are kept for that search (memory: full months hold ~1M segments).
    if (closeMode) segList.push([vid, kind, ax, ay, ta, bx, by, tb, closeMode])
    stats.segments++
    eachCellOf(ax, ay, bx, by, (c) => {
      let byKind = vessels.get(c)
      if (!byKind) vessels.set(c, (byKind = new Map()))
      let set = byKind.get(kind)
      if (!set) byKind.set(kind, (set = new Set()))
      set.add(vid)
    })
  }

  const onLine = (r) => {
    stats.lines++
    const c = r.c
    if (!Array.isArray(c) || c.length < 2) return
    let any = false
    for (const [x, y] of c) if (inBox(x, y)) { any = true; break }
    if (!any) return
    stats.inBox++
    const vid = r.mmsi ? String(r.mmsi) : `gfw:${r.vid}`
    const kind = KINDS.includes(r.kind) ? r.kind : 'unknown'
    // Vertex times: GFW gives one per vertex; NOAA lines give t0/t1 → spread by distance along the line.
    let ts = Array.isArray(r.ts) && r.ts.length === c.length ? r.ts : null
    if (!ts) {
      const cum = [0]
      for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + metres(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]))
      const L = cum[cum.length - 1] || 1
      ts = cum.map((d) => r.t0 + ((r.t1 - r.t0) * d) / L)
    }
    for (let i = 1; i < c.length; i++) {
      const [ax, ay] = c[i - 1]
      const [bx, by] = c[i]
      if (!inBox(ax, ay) && !inBox(bx, by)) continue
      const closeMode = r.est === 1 ? 0 : metres(ax, ay, bx, by) > SEG_MAX_M ? 1 : 2
      addSegment(vid, kind, ax, ay, ts[i - 1], bx, by, ts[i], closeMode)
    }
  }

  const sources = {}
  if (us) { sources.us = { built: us.built, ...(await eachLine(us.pack, onLine)) } }
  if (gfw) { sources.gfw = { built: gfw.built, ...(await eachLine(gfw.pack, onLine)) } }
  const traffic = new Map()
  for (const [c, byKind] of vessels) traffic.set(c, Uint32Array.from(KINDS, (k) => byKind.get(k)?.size || 0))
  return { traffic, segList, stats, sources }
}

/** Which packs (and bake rules) a saved ship side was made from; a different key means re-read the packs. */
export function shipSideKey({ us, gfw }) {
  const rules = { format: 1, BBOX, CELL, SEG_MAX_M, KINDS, SHARDS }
  return createHash('sha1').update(JSON.stringify({ us: us ? [us.pack, us.built] : null, gfw: gfw ? [gfw.pack, gfw.built] : null, rules })).digest('hex').slice(0, 12)
}

// File: 'OVSS', uint32 header bytes, header JSON (space-padded to an 8-byte boundary), then float64 segments
// (ax, ay, ta, bx, by, tb — full precision, so a reused month bakes byte-identical results), uint32 cells
// (cell, …KINDS counts), uint32 vessel index, uint8 (kind index, closeMode); gzip'd as a stream (a full month is
// millions of segments; one gzipSync of the joined parts would hold every byte twice).
export async function packShipSide(side, key) {
  const vids = [], vix = new Map()
  for (const s of side.segList) if (!vix.has(s[0])) { vix.set(s[0], vids.length); vids.push(s[0]) }
  const n = side.segList.length
  const cells = new Uint32Array(side.traffic.size * (1 + KINDS.length))
  let o = 0
  for (const [c, counts] of side.traffic) { cells[o++] = c; cells.set(counts, o); o += KINDS.length }
  const f = new Float64Array(n * 6), v = new Uint32Array(n), b = new Uint8Array(n * 2)
  side.segList.forEach(([vid, kind, ax, ay, ta, bx, by, tb, mode], i) => {
    const j = i * 6
    f[j] = ax; f[j + 1] = ay; f[j + 2] = ta; f[j + 3] = bx; f[j + 4] = by; f[j + 5] = tb
    v[i] = vix.get(vid); b[i * 2] = KINDS.indexOf(kind); b[i * 2 + 1] = mode
  })
  let header = JSON.stringify({ format: 1, key, kinds: KINDS, stats: side.stats, sources: side.sources, cells: side.traffic.size, segments: n, vids })
  header += ' '.repeat((8 - ((8 + Buffer.byteLength(header)) % 8)) % 8)
  const len = Buffer.alloc(4); len.writeUInt32LE(Buffer.byteLength(header))
  const gz = zlib.createGzip(), out = []
  gz.on('data', (c) => out.push(c))
  const done = new Promise((ok, no) => { gz.on('end', ok); gz.on('error', no) })
  for (const part of [Buffer.from('OVSS'), len, Buffer.from(header), f, cells, v, b]) gz.write(Buffer.from(part.buffer, part.byteOffset, part.byteLength))
  gz.end()
  await done
  return Buffer.concat(out)
}

export function unpackShipSide(gz, key) {
  const raw = zlib.gunzipSync(gz, { maxOutputLength: 2 ** 32 - 1 })
  if (raw.toString('ascii', 0, 4) !== 'OVSS') throw new Error('not a ship-side file')
  const hl = raw.readUInt32LE(4)
  const h = JSON.parse(raw.toString('utf8', 8, 8 + hl))
  if (h.key !== key || h.format !== 1 || h.kinds.join() !== KINDS.join()) throw new Error(`ship side is for ${h.key}, want ${key}`)
  let o = 8 + hl
  // Views where the bytes are aligned (no copy), copies otherwise.
  const take = (T, count) => {
    const at = raw.byteOffset + o, bytes = count * T.BYTES_PER_ELEMENT
    o += bytes
    return at % T.BYTES_PER_ELEMENT ? new T(raw.buffer.slice(at, at + bytes)) : new T(raw.buffer, at, count)
  }
  const K = KINDS.length
  const f = take(Float64Array, h.segments * 6), cells = take(Uint32Array, h.cells * (1 + K)), v = take(Uint32Array, h.segments), b = take(Uint8Array, h.segments * 2)
  const traffic = new Map()
  for (let i = 0; i < h.cells; i++) traffic.set(cells[i * (1 + K)], cells.slice(i * (1 + K) + 1, (i + 1) * (1 + K)))
  const segList = new Array(h.segments)
  for (let i = 0; i < h.segments; i++) {
    const j = i * 6
    segList[i] = [h.vids[v[i]], KINDS[b[i * 2]], f[j], f[j + 1], f[j + 2], f[j + 3], f[j + 4], f[j + 5], b[i * 2 + 1]]
  }
  return { traffic, segList, stats: h.stats, sources: h.sources }
}

// What a month's bake is made from besides the packs: this script and the whale rules it uses. A change to any of
// them redoes every month (the published files would differ), same as a change to the month's whale reports.
const CODE_HASH = createHash('sha1')
  .update(['./overlap-bake.mjs', '../../lib/whales/precision.js', '../../lib/whales/sources.js'].map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join('\0'))
  .digest('hex')

/** Everything a month's published files depend on: packs + rules (shipSideKey), whale reports, bake code. */
export function inputsKey(packs, whales) {
  return createHash('sha1').update(`${CODE_HASH}|${shipSideKey(packs)}|${JSON.stringify(whales)}`).digest('hex').slice(0, 16)
}

/** side: a ship side from shipSideFromPacks or unpackShipSide (else the packs are read here); whales: whalesFor(ym). */
export async function bakeMonth(ym, { us, gfw }, side = null, whalesIn = null) {
  const ship = side || (await shipSideFromPacks({ us, gfw }))
  const { traffic, segList, sources } = ship
  const stats = { ...ship.stats }
  // cell → [segment index…], in segment order (the close-pass search below).
  const segs = new Map()
  segList.forEach(([, , ax, ay, , bx, by], si) => eachCellOf(ax, ay, bx, by, (c) => {
    let list = segs.get(c)
    if (!list) segs.set(c, (list = []))
    list.push(si)
  }))

  // Whales: counts per cell + close passes.
  const whales = whalesIn || (await whalesFor(ym))
  // Whale weight per cell = WHALES, not reports (Josh 2026-10-17): the reports of one group of animals are grouped
  // (lib/whales/precision.js), each group counts its whales, and a group placed only roughly spreads its whales
  // evenly over the box it could be in. notes = what each cell's whales are, for the popup.
  const whaleCells = new Map() // whales placed precisely in the cell
  const areaCells = new Map()  // whales placed only roughly whose area covers the cell — the FULL count (Josh 2026-10-17: area level)
  const groupRows = [] // [lng, lat, whales, species, sources, dLat, dLng, reports, points] — the page derives a square's breakdown from these
  for (const g of groupSightings(whales.filter((w) => inBox(w.lng, w.lat)))) {
    const at = g.members.reduce((best, m) => (locationRadiusM(m) < locationRadiusM(best) ? m : best), g.members[0])
    if (locationRadiusM(at) > TOO_VAGUE_M) { stats.tooVague = (stats.tooVague || 0) + g.whales; continue }
    const box = spreadBox(at)
    const cellsHere = []
    const pts = box ? [] : groupPoints(g)
    if (!box) {
      // Every square within 1 km of any of its reports (lib/whales/precision.js nearPoints), full count in each.
      const seen = new Set()
      for (let p = 0; p < pts.length; p += 2) {
        const ci = Math.floor((pts[p] - W) / CELL.lngStep), cj = Math.floor((pts[p + 1] - S) / CELL.latStep)
        for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
          const i = ci + di, j = cj + dj
          if (i < 0 || j < 0 || i >= NX || W + (i + 1) * CELL.lngStep > E + CELL.lngStep || S + j * CELL.latStep >= N) continue
          const c = j * NX + i
          if (seen.has(c) || !nearPoints(pts, W + (i + 0.5) * CELL.lngStep, S + (j + 0.5) * CELL.latStep)) continue
          seen.add(c); cellsHere.push(c)
        }
      }
      if (!cellsHere.length) cellsHere.push(cellOf(at.lng, at.lat))
    } else {
      const seen = new Set()
      for (let y = Math.max(S, at.lat - box.dLat); y < Math.min(N, at.lat + box.dLat); y += CELL.latStep / 2) {
        for (let x = Math.max(W, at.lng - box.dLng); x < Math.min(E, at.lng + box.dLng); x += CELL.lngStep / 2) {
          const c = cellOf(x, y)
          if (!seen.has(c)) { seen.add(c); cellsHere.push(c) }
        }
      }
      if (!cellsHere.length) cellsHere.push(cellOf(at.lng, at.lat))
    }
    if (!box) for (const c of cellsHere) whaleCells.set(c, (whaleCells.get(c) || 0) + g.whales)
    else for (const c of cellsHere) areaCells.set(c, (areaCells.get(c) || 0) + g.whales)
    const srcs = [...new Set(g.members.map((m) => WHALE_SOURCES[m.source]?.label || m.source))].join(', ')
    groupRows.push([Math.round(at.lng * 1e5) / 1e5, Math.round(at.lat * 1e5) / 1e5, g.whales, g.species, srcs,
      box ? Math.round(box.dLat * 1e4) / 1e4 : 0, box ? Math.round(box.dLng * 1e4) / 1e4 : 0, g.members.length, pts])
  }
  const close = {}
  const radCellsX = Math.ceil(CLOSE_M / (M_PER_DEG_LAT * Math.cos(((S + N) / 2) * Math.PI / 180) * CELL.lngStep))
  const radCellsY = Math.ceil(CLOSE_M / (M_PER_DEG_LAT * CELL.latStep))
  for (const w of whales) {
    if (!inBox(w.lng, w.lat)) continue
    // A roughly placed report can't be judged against "within 1 km".
    if (locationRadiusM(w) >= APPROX_M) continue
    const { t, tol } = whaleTime(w)
    const ci = Math.floor((w.lng - W) / CELL.lngStep)
    const cj = Math.floor((w.lat - S) / CELL.latStep)
    const best = new Map() // vessel → [kind, metres, dtMin]
    const done = new Set()
    for (let dj = -radCellsY; dj <= radCellsY; dj++) {
      for (let di = -radCellsX; di <= radCellsX; di++) {
        const list = segs.get((cj + dj) * NX + (ci + di))
        if (!list) continue
        for (const si of list) {
          if (done.has(si)) continue
          done.add(si)
          const [vid, kind, ax, ay, ta, bx, by, tb, closeMode] = segList[si]
          if (!closeMode) continue
          // Closest point on the segment (local planar metres), then its interpolated time. Long segments: endpoints only.
          const k = Math.cos(w.lat * Math.PI / 180) * M_PER_DEG_LAT
          const px = (w.lng - ax) * k, py = (w.lat - ay) * M_PER_DEG_LAT
          const vx = (bx - ax) * k, vy = (by - ay) * M_PER_DEG_LAT
          const vv = vx * vx + vy * vy
          let u = vv ? Math.max(0, Math.min(1, (px * vx + py * vy) / vv)) : 0
          if (closeMode === 1) u = Math.hypot(px, py) <= Math.hypot(px - vx, py - vy) ? 0 : 1
          const d = Math.hypot(px - u * vx, py - u * vy)
          if (d > CLOSE_M) continue
          const tp = ta + (tb - ta) * u
          const dt = tp - t
          if (Math.abs(dt) > tol) continue
          const prev = best.get(vid)
          if (!prev || d < prev[1]) best.set(vid, [kind, Math.round(d), w.time_precision === 'exact' ? Math.round(dt / 60) : null])
        }
      }
    }
    if (best.size) close[w.id] = [...best.entries()].sort((a, b) => a[1][1] - b[1][1]).slice(0, 50).map(([vid, v]) => [vid, ...v])
  }

  // Only cells with whale reports matter for the overlap (ships × whales); the busiest cell per ship kind
  // (vmax) scales ship traffic region-wide. Cell rows: [i, j, whale reports, vessels per kind in KINDS order].
  const vmax = KINDS.map(() => 0)
  let vmaxAll = 0
  for (const counts of traffic.values()) {
    let all = 0
    KINDS.forEach((k, ix) => { const n = counts[ix]; all += n; if (n > vmax[ix]) vmax[ix] = n })
    if (all > vmaxAll) vmaxAll = all
  }
  const r2 = (v) => Math.round(v * 100) / 100
  const cells = []
  // Row: [i, j, whales here, …vessels per kind (KINDS order), whales in the area (roughly placed)].
  for (const c of new Set([...whaleCells.keys(), ...areaCells.keys()])) {
    const counts = traffic.get(c)
    const i = c % NX, j = Math.floor(c / NX)
    cells.push([i, j, r2(whaleCells.get(c) || 0), ...KINDS.map((k, ix) => counts?.[ix] || 0), r2(areaCells.get(c) || 0)])
  }
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const built = new Date().toISOString()
  const grid = { version: VERSION, month: ym, built, bbox: BBOX, cell: CELL, nx: NX, kinds: KINDS, sources, whales: whales.length,
    trafficCells: traffic.size, vmax, vmaxAll, cells, groups: groupRows,
    whaleRule: 'whales, not reports: one group of animals (same species, day, ≤2 km, ≤2 h) counts once; roughly placed groups count in full across the area they could be in (last cell column)' }
  const closepasses = { version: VERSION, month: ym, built, rule: { metres: CLOSE_M, hours: CLOSE_H, dateOnly: 'same local day', reportedPositionsOnlyBeyondMetres: SEG_MAX_M, estimatedPaths: 'excluded' }, whales: close }
  return { grid, closepasses, stats: { ...stats, trafficCells: traffic.size, whaleCells: cells.length, whales: whales.length, closeWhales: Object.keys(close).length } }
}

// ─── Publish ─────────────────────────────────────────────────────────────────
async function tokenFor(pathname) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}
async function upload(pathname, body, contentType = 'application/json') {
  for (let i = 1; ; i++) {
    try {
      const res = await put(pathname, body, { access: 'public', token: await tokenFor(pathname), contentType })
      return res.url
    } catch (e) {
      if (i >= 3) throw e
      await new Promise((ok) => setTimeout(ok, 4000 * i))
    }
  }
}
async function readIndex() {
  const r = await fetch(`${BLOB_BASE}/shiptraffic/${VERSION}/index.json?t=${Date.now()}`, { cache: 'no-store' })
  if (r.ok) return r.json()
  if (r.status === 404) return { version: VERSION, bbox: BBOX, cell: CELL, months: {} }
  throw new Error(`index: HTTP ${r.status}`)
}

async function sourceIndexes() {
  const us = await (await fetch(TRACKS.us.index, { cache: 'no-store' })).json()
  const gfw = await (await fetch(TRACKS.gfw.index, { cache: 'no-store' })).json()
  return { us: us.months || {}, gfw: gfw.months || {}, gfwThrough: gfw.fetched_through || null }
}

async function main() {
  const src = await sourceIndexes()
  const all = [...new Set([...Object.keys(src.us), ...Object.keys(src.gfw)])].filter((m) => m >= FIRST_MONTH).sort()
  const index = PUBLISH ? await readIndex() : { months: {} }
  const recent = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 7)
  let months
  if (args.months === 'auto' || !args.months) {
    // Whale reports for old months keep arriving (late uploads, corrections), so an old month is also looked at again
    // once it's 30 days since its bake or last check — and redone only if its whale reports (or the bake code) changed.
    const stale = Date.now() - 30 * 86400000
    months = all.filter((m) => {
      const have = index.months[m]
      if (!have || m >= recent) return true
      if (Date.parse(have.checked || have.built || 0) < stale) return true
      return (src.us[m]?.built || null) !== (have.sources?.us || null) || (src.gfw[m]?.built || null) !== (have.sources?.gfw || null)
    })
  } else months = String(args.months).split(',').filter((m) => all.includes(m))
  console.log(`overlap bake: ${months.length} month(s): ${months.join(' ')}${SHARDS ? ` (first ${SHARDS} shards only)` : ''}`)
  mkdirSync(OUT, { recursive: true })
  const failed = []
  for (const ym of months) {
    const t0 = Date.now()
    // A 500 MB pack stream can be cut mid-way ("other side closed"); redo the month, then move on.
    const packs = { us: src.us[ym] || null, gfw: src.gfw[ym] || null }
    // Same packs, same whale reports, same code → the published files would come out identical: note the check, skip.
    let whales = null
    try { whales = await whalesFor(ym) } catch (e) { console.warn(`  ${ym}: whale reports: ${e.message}`); failed.push(ym); continue }
    const inputs = inputsKey(packs, whales)
    if (!args.force && index.months[ym]?.inputs === inputs) {
      console.log(`  ${ym}: unchanged (same packs, whale reports and bake code); not redone`)
      if (PUBLISH) {
        index.months[ym].checked = new Date().toISOString()
        index.updated = index.months[ym].checked
        await upload(`shiptraffic/${VERSION}/index.json`, JSON.stringify(index))
      }
      continue
    }
    const key = shipSideKey(packs)
    const localSide = resolve(OUT, `${ym}-ships-${key}.bin.gz`)
    let side = null, sideFrom = 'packs', sideGz = null
    const saved = index.months[ym]?.shipSide
    try {
      if (existsSync(localSide)) { side = unpackShipSide(readFileSync(localSide), key); sideFrom = 'local' }
      else if (saved?.key === key) {
        const r = await fetch(saved.url)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        side = unpackShipSide(Buffer.from(await r.arrayBuffer()), key); sideFrom = 'saved'
      }
    } catch (e) { console.warn(`  ${ym}: saved ship side unusable (${e.message}); reading the packs`); side = null; sideFrom = 'packs' }
    let baked = null
    for (let attempt = 1; attempt <= 3 && !baked; attempt++) {
      try {
        if (!side) side = await shipSideFromPacks(packs)
        baked = await bakeMonth(ym, packs, side, whales)
      } catch (e) {
        console.warn(`  ${ym}: attempt ${attempt} failed: ${e.message}${e.cause ? ` (${e.cause.message || e.cause})` : ''}`)
        if (attempt < 3) await new Promise((ok) => setTimeout(ok, 15000 * attempt))
      }
    }
    if (!baked) { failed.push(ym); continue }
    // Keep the ship side for the next redo (months past the 45-day window, and local proving runs). Best effort: a
    // failure here only means the next redo reads the packs again.
    if (sideFrom === 'packs' && (ym < recent || !PUBLISH)) {
      try { sideGz = await packShipSide(side, key); writeFileSync(localSide, sideGz) } catch (e) { console.warn(`  ${ym}: ship side not kept (${e.message})`) }
    }
    const { grid, closepasses, stats } = baked
    const gj = JSON.stringify(grid)
    const cj = JSON.stringify(closepasses)
    writeFileSync(resolve(OUT, `${ym}-grid.json`), gj)
    writeFileSync(resolve(OUT, `${ym}-closepasses.json`), cj)
    console.log(`  ${ym}: ship side from ${sideFrom}${sideGz ? ` (${(sideGz.length / 1e6).toFixed(1)} MB saved)` : ''}; ${JSON.stringify(stats)} grid ${(gj.length / 1e3).toFixed(0)} kB, closepasses ${(cj.length / 1e3).toFixed(0)} kB (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    if (!PUBLISH) continue
    const g = await upload(`shiptraffic/${VERSION}/${ym}/grid.json`, gj)
    const c = await upload(`shiptraffic/${VERSION}/${ym}/closepasses.json`, cj)
    // The ship side is kept only for months past the 45-day window: newer months' packs are rebuilt most days, so a
    // saved copy would rarely be reused and each rebuild would leave another file behind. Best effort: a failed save
    // only means the next redo reads the packs again.
    let shipSide = saved?.key === key ? saved : null
    if (sideGz && ym < recent) {
      try { shipSide = { key, url: await upload(`shiptraffic/${VERSION}/${ym}/ships-${key}.bin.gz`, sideGz, 'application/gzip') } }
      catch (e) { console.warn(`  ${ym}: ship side not saved (${e.message})`) }
    }
    // One writer (the workflow's concurrency group): the index read at the start is kept in memory and written after
    // each month, so a crash never loses finished months. (Re-reading it per month dropped months: the Blob CDN can
    // answer with a copy up to a minute old, 2026-10-17.)
    const idx = index
    idx.months[ym] = {
      grid: g, closepasses: c, built: grid.built,
      sources: { us: src.us[ym]?.built || null, gfw: src.gfw[ym]?.built || null },
      through: src.gfw[ym] ? src.gfwThrough : null,
      whales: grid.whales,
      inputs,
      ...(shipSide ? { shipSide } : {}),
    }
    idx.months = Object.fromEntries(Object.entries(idx.months).sort(([a], [b]) => a.localeCompare(b)))
    idx.updated = new Date().toISOString()
    await upload(`shiptraffic/${VERSION}/index.json`, JSON.stringify(idx))
    console.log(`  ✓ published ${ym}`)
  }
  if (failed.length) { console.error(`failed months (next run retries them): ${failed.join(' ')}`); process.exit(1) }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
