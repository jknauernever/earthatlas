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
 *   node scripts/shiptraffic/overlap-bake.mjs --months 2025-07,2026-10 [--out DIR] [--no-publish] [--shards N]
 *
 * --shards N reads only the first N of each pack's shards (local proving on a slice; never published).
 */
import zlib from 'node:zlib'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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

async function whalesFor(ym) {
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

export async function bakeMonth(ym, { us, gfw }) {
  const vessels = new Map() // cell → Map(kind → Set(vessel id))
  const segs = new Map()    // cell → [segment index…]
  const segList = []        // [vesselId, kind, ax, ay, ta, bx, by, tb, closeMode] closeMode 0 = never, 1 = endpoints only, 2 = whole segment
  const stats = { lines: 0, inBox: 0, segments: 0 }

  const addSegment = (vid, kind, ax, ay, ta, bx, by, tb, closeMode) => {
    // Only segments that can count as a close pass are kept for that search (memory: full months hold ~1M segments).
    const si = closeMode ? segList.length : -1
    if (closeMode) segList.push([vid, kind, ax, ay, ta, bx, by, tb, closeMode])
    stats.segments++
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax) / CELL.lngStep, Math.abs(by - ay) / CELL.latStep) * 2))
    const seen = new Set()
    for (let k = 0; k <= steps; k++) {
      const x = ax + ((bx - ax) * k) / steps
      const y = ay + ((by - ay) * k) / steps
      if (!inBox(x, y)) continue
      const c = cellOf(x, y)
      if (seen.has(c)) continue
      seen.add(c)
      let byKind = vessels.get(c)
      if (!byKind) vessels.set(c, (byKind = new Map()))
      let set = byKind.get(kind)
      if (!set) byKind.set(kind, (set = new Set()))
      set.add(vid)
      if (si < 0) continue
      let list = segs.get(c)
      if (!list) segs.set(c, (list = []))
      list.push(si)
    }
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

  // Whales: counts per cell + close passes.
  const whales = await whalesFor(ym)
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
  for (const byKind of vessels.values()) {
    let all = 0
    KINDS.forEach((k, ix) => { const n = byKind.get(k)?.size || 0; all += n; if (n > vmax[ix]) vmax[ix] = n })
    if (all > vmaxAll) vmaxAll = all
  }
  const r2 = (v) => Math.round(v * 100) / 100
  const cells = []
  // Row: [i, j, whales here, …vessels per kind (KINDS order), whales in the area (roughly placed)].
  for (const c of new Set([...whaleCells.keys(), ...areaCells.keys()])) {
    const byKind = vessels.get(c)
    const i = c % NX, j = Math.floor(c / NX)
    cells.push([i, j, r2(whaleCells.get(c) || 0), ...KINDS.map((k) => byKind?.get(k)?.size || 0), r2(areaCells.get(c) || 0)])
  }
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const built = new Date().toISOString()
  const grid = { version: VERSION, month: ym, built, bbox: BBOX, cell: CELL, nx: NX, kinds: KINDS, sources, whales: whales.length,
    trafficCells: vessels.size, vmax, vmaxAll, cells, groups: groupRows,
    whaleRule: 'whales, not reports: one group of animals (same species, day, ≤2 km, ≤2 h) counts once; roughly placed groups count in full across the area they could be in (last cell column)' }
  const closepasses = { version: VERSION, month: ym, built, rule: { metres: CLOSE_M, hours: CLOSE_H, dateOnly: 'same local day', reportedPositionsOnlyBeyondMetres: SEG_MAX_M, estimatedPaths: 'excluded' }, whales: close }
  return { grid, closepasses, stats: { ...stats, trafficCells: vessels.size, whaleCells: cells.length, whales: whales.length, closeWhales: Object.keys(close).length } }
}

// ─── Publish ─────────────────────────────────────────────────────────────────
async function tokenFor(pathname) {
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ pathname }) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.token) throw new Error(`upload token for ${pathname}: ${r.status} ${j.error || ''}`)
  return j.token
}
async function upload(pathname, body) {
  for (let i = 1; ; i++) {
    try {
      const res = await put(pathname, body, { access: 'public', token: await tokenFor(pathname), contentType: 'application/json' })
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
  let months
  if (args.months === 'auto' || !args.months) {
    const recent = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 7)
    // Whale reports for old months keep arriving (late uploads, corrections), so an old month is also redone once
    // its bake is 30 days old — one month or so a day, instead of every pack every day.
    const stale = Date.now() - 30 * 86400000
    months = all.filter((m) => {
      const have = index.months[m]
      if (!have || m >= recent) return true
      if (Date.parse(have.built || 0) < stale) return true
      return (src.us[m]?.built || null) !== (have.sources?.us || null) || (src.gfw[m]?.built || null) !== (have.sources?.gfw || null)
    })
  } else months = String(args.months).split(',').filter((m) => all.includes(m))
  console.log(`overlap bake: ${months.length} month(s): ${months.join(' ')}${SHARDS ? ` (first ${SHARDS} shards only)` : ''}`)
  mkdirSync(OUT, { recursive: true })
  const failed = []
  for (const ym of months) {
    const t0 = Date.now()
    // A 500 MB pack stream can be cut mid-way ("other side closed"); redo the month, then move on.
    let baked = null
    for (let attempt = 1; attempt <= 3 && !baked; attempt++) {
      try { baked = await bakeMonth(ym, { us: src.us[ym] || null, gfw: src.gfw[ym] || null }) } catch (e) {
        console.warn(`  ${ym}: attempt ${attempt} failed: ${e.message}${e.cause ? ` (${e.cause.message || e.cause})` : ''}`)
        if (attempt < 3) await new Promise((ok) => setTimeout(ok, 15000 * attempt))
      }
    }
    if (!baked) { failed.push(ym); continue }
    const { grid, closepasses, stats } = baked
    const gj = JSON.stringify(grid)
    const cj = JSON.stringify(closepasses)
    writeFileSync(resolve(OUT, `${ym}-grid.json`), gj)
    writeFileSync(resolve(OUT, `${ym}-closepasses.json`), cj)
    console.log(`  ${ym}: ${JSON.stringify(stats)} grid ${(gj.length / 1e3).toFixed(0)} kB, closepasses ${(cj.length / 1e3).toFixed(0)} kB (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
    if (!PUBLISH) continue
    const g = await upload(`shiptraffic/${VERSION}/${ym}/grid.json`, gj)
    const c = await upload(`shiptraffic/${VERSION}/${ym}/closepasses.json`, cj)
    // One writer (the workflow's concurrency group): the index read at the start is kept in memory and written after
    // each month, so a crash never loses finished months. (Re-reading it per month dropped months: the Blob CDN can
    // answer with a copy up to a minute old, 2026-10-17.)
    const idx = index
    idx.months[ym] = {
      grid: g, closepasses: c, built: grid.built,
      sources: { us: src.us[ym]?.built || null, gfw: src.gfw[ym]?.built || null },
      through: src.gfw[ym] ? src.gfwThrough : null,
      whales: grid.whales,
    }
    idx.months = Object.fromEntries(Object.entries(idx.months).sort(([a], [b]) => a.localeCompare(b)))
    idx.updated = new Date().toISOString()
    await upload(`shiptraffic/${VERSION}/index.json`, JSON.stringify(idx))
    console.log(`  ✓ published ${ym}`)
  }
  if (failed.length) { console.error(`failed months (next run retries them): ${failed.join(' ')}`); process.exit(1) }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1) })
