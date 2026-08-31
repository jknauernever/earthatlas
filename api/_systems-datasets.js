/**
 * /systems dataset registry — bake cores for every layer beyond wind.
 * (Wind keeps its own QA'd core in api/_gfs-wind-core.js; same format.)
 *
 * Each dataset entry fetches its authoritative open source, sanity-checks,
 * and encodes the standard /systems grid pair (see SYSTEMS-NOTES.md §1):
 * meta JSON + Int16LE binary (planes concatenated, row-major from lat0,
 * value = raw/scale, missing = -32768). Grid geometry (lat0/dLat/lon0/dLon)
 * is read from the response's own coordinate arrays, never hardcoded.
 *
 * Sources (each verified live before this file was written — see notes):
 * - currents: HYCOM/Navy ESPC-D-V02 global 1/12° analysis, surface water_u/v,
 *   via the HYCOM consortium's public THREDDS NCSS (no auth). OSCAR was the
 *   first choice but its public ERDDAP copies all ended years ago (v2 sits
 *   behind NASA Earthdata auth).
 * - sst: NOAA Coral Reef Watch CoralTemp (CRW_SST, 5 km daily) via CoastWatch
 *   ERDDAP, index-strided to 0.5°. (OISST *final* lags ~2 weeks; CoralTemp
 *   runs ~1 day behind.)
 * - waves: WaveWatch III global (significant wave height Thgt, 0.5°) via
 *   PacIOOS ERDDAP; time picked nearest to "now" from the forecast series.
 */

import { NetCDFReader } from 'netcdfjs'
import zlib from 'node:zlib'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simplifyNifc } from './_nifc-core.js'

const MISSING = -32768

// Public Blob base — used read-only here (previous fire-events state).
export const BLOB_PUBLIC_BASE =
  process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com'

// "Hour since 2026-08-13T00:00:00Z" / "hours since 2026-08-10 12:00:00.000 UTC"
// / "seconds since 1970-01-01T00:00:00Z" + offset → epoch ms.
function timeFromUnits(unitsAttr, offset) {
  const m = /^(\w+)\s+since\s+(.+)$/i.exec(unitsAttr || '')
  if (!m || !Number.isFinite(offset)) return null
  const base = Date.parse(m[2].trim())
  if (!Number.isFinite(base)) return null
  const per = /^hour/i.test(m[1]) ? 3.6e6 : /^sec/i.test(m[1]) ? 1000 : /^day/i.test(m[1]) ? 8.64e7 : null
  return per ? base + offset * per : null
}

async function fetchNetcdf(url) {
  const r = await fetch(url, { headers: { accept: 'application/x-netcdf, application/octet-stream' } })
  if (!r.ok) throw new Error(`upstream ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 50000) throw new Error(`response too small (${buf.length} bytes)`)
  return new NetCDFReader(buf)
}

const coordVar = (nc, names) => names.find((n) => nc.variables.some((v) => v.name === n))
const unitsOf = (nc, name) => nc.variables.find((v) => v.name === name)
  ?.attributes?.find((a) => a.name === 'units')?.value

// Axis geometry from the actual coordinate array (handles ascending south-first
// HYCOM and descending north-first alike — dLat's sign carries the direction).
function axisMeta(arr) {
  if (!arr || arr.length < 2) throw new Error('bad coordinate axis')
  return { origin: arr[0], step: (arr[arr.length - 1] - arr[0]) / (arr.length - 1), n: arr.length }
}

// Display-grade coastal gap fill: a missing cell with ≥3 valid neighbors
// (8-neighborhood, longitude-wrapped) takes their mean. One iteration extends
// ocean fields a single cell toward shore — closing the stair-step gaps that
// stride/land-masking leaves at coastlines — without inventing data anywhere
// that isn't hugging real values. Standard practice for gridded SST display
// products; noted in the client methodology.
function fillCoastalGaps(values, nLat, nLon, maxAbs, iterations = 1) {
  let cur = Array.from(values, (v) => (Number.isFinite(v) && Math.abs(v) < maxAbs ? v : NaN))
  for (let it = 0; it < iterations; it++) {
    const next = cur.slice()
    for (let r = 0; r < nLat; r++) {
      for (let c = 0; c < nLon; c++) {
        const i = r * nLon + c
        if (!Number.isNaN(cur[i])) continue
        let s = 0
        let n = 0
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr
          if (rr < 0 || rr >= nLat) continue
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue
            const v = cur[rr * nLon + ((c + dc + nLon) % nLon)]
            if (!Number.isNaN(v)) { s += v; n++ }
          }
        }
        if (n >= 3) next[i] = s / n
      }
    }
    cur = next
  }
  return cur
}

function encodePlanes(planes, scale, maxAbs, maxMissingFrac) {
  const n = planes[0].length
  const out = Buffer.alloc(n * planes.length * 2)
  let bad = 0
  planes.forEach((values, p) => {
    if (values.length !== n) throw new Error('plane length mismatch')
    for (let i = 0; i < n; i++) {
      const v = values[i]
      if (Number.isFinite(v) && Math.abs(v) < maxAbs) {
        out.writeInt16LE(Math.round(v * scale), (p * n + i) * 2)
      } else {
        out.writeInt16LE(MISSING, (p * n + i) * 2)
        bad++
      }
    }
  })
  if (bad > n * planes.length * maxMissingFrac) throw new Error(`too many missing values (${bad}/${n * planes.length})`)
  return out
}

function buildMeta(kind, source, latArr, lonArr, scale, run_ms, valid_ms) {
  const lat = axisMeta(latArr)
  const lon = axisMeta(lonArr)
  if (!run_ms || !valid_ms) throw new Error('could not parse run/valid time')
  return {
    version: 1, kind, run_ms, valid_ms, fetched_ms: Date.now(),
    nLat: lat.n, nLon: lon.n, lat0: lat.origin, dLat: lat.step, lon0: lon.origin, dLon: lon.step,
    scale, missing: MISSING, source,
  }
}

// ─── currents — HYCOM/Navy ESPC-D-V02 surface velocity ──────────────────────
async function fetchCurrents() {
  const url =
    'https://ncss.hycom.org/thredds/ncss/grid/FMRC_ESPC-D-V02_uv3z/FMRC_ESPC-D-V02_uv3z_best.ncd' +
    '?var=water_u&var=water_v&vertCoord=0&time=present&horizStride=6&accept=netcdf'
  const nc = await fetchNetcdf(url)
  const lat = nc.getDataVariable(coordVar(nc, ['lat', 'latitude']))
  const lon = nc.getDataVariable(coordVar(nc, ['lon', 'longitude']))
  const u = nc.getDataVariable('water_u')
  const v = nc.getDataVariable('water_v')
  if (u.length !== lat.length * lon.length) throw new Error(`field/axis mismatch ${u.length}`)
  const valid_ms = timeFromUnits(unitsOf(nc, 'time'), nc.getDataVariable('time')?.[0])
  const runVar = nc.variables.some((x) => x.name === 'time_run')
  const run_ms = runVar ? timeFromUnits(unitsOf(nc, 'time_run'), nc.getDataVariable('time_run')?.[0]) : valid_ms
  const meta = buildMeta(
    'hycom-currents-surface',
    'HYCOM/US Navy ESPC-D-V02 global ocean analysis (surface currents) via HYCOM.org THREDDS',
    lat, lon, 1000, run_ms || valid_ms, valid_ms,
  )
  const uF = fillCoastalGaps(u, lat.length, lon.length, 30)
  const vF = fillCoastalGaps(v, lat.length, lon.length, 30)
  // Ocean covers ~70% of the planet; up to 45% missing allows the land mask
  // plus the polar cap, and still catches a half-empty broken pull.
  return { meta, gridBuffer: encodePlanes([uF, vF], 1000, 30, 0.45) }
}

// ─── sst — NOAA Coral Reef Watch CoralTemp ──────────────────────────────────
async function fetchSst() {
  // Index-based stride (0.05° × 5 → 0.25°) keeps the request valid regardless
  // of the axis' native direction; geometry is read from the response. 0.25°
  // (vs the original 0.5°) halves the coastal stair-step; the grid is ~2 MB.
  const url =
    'https://coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW.nc' +
    '?CRW_SST%5B(last)%5D%5B0:5:3599%5D%5B0:5:7199%5D'
  const nc = await fetchNetcdf(url)
  const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
  const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
  const sst = nc.getDataVariable('CRW_SST')
  if (sst.length !== lat.length * lon.length) throw new Error(`field/axis mismatch ${sst.length}`)
  const valid_ms = timeFromUnits(unitsOf(nc, 'time'), nc.getDataVariable('time')?.[0])
  const meta = buildMeta(
    'crw-sst',
    'NOAA Coral Reef Watch CoralTemp daily 5 km sea-surface temperature via CoastWatch ERDDAP',
    lat, lon, 100, valid_ms, valid_ms,
  )
  return { meta, gridBuffer: encodePlanes([fillCoastalGaps(sst, lat.length, lon.length, 60)], 100, 60, 0.45) }
}

// ─── waves — WaveWatch III significant wave height ──────────────────────────
async function fetchWaves() {
  // The series extends ~6 days into the forecast; ask for the step nearest now
  // (ERDDAP picks the closest index to a value constraint).
  const nowIso = new Date().toISOString().slice(0, 19) + 'Z'
  const url =
    'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_global.nc' +
    `?Thgt%5B(${nowIso})%5D%5B0:1:0%5D%5B0:1:310%5D%5B0:1:719%5D`
  const nc = await fetchNetcdf(url)
  const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
  const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
  const h = nc.getDataVariable('Thgt')
  if (h.length !== lat.length * lon.length) throw new Error(`field/axis mismatch ${h.length}`)
  const valid_ms = timeFromUnits(unitsOf(nc, 'time'), nc.getDataVariable('time')?.[0])
  if (!valid_ms || Math.abs(valid_ms - Date.now()) > 12 * 3.6e6) {
    throw new Error(`wave step too far from now (${valid_ms && new Date(valid_ms).toISOString()})`)
  }
  const meta = buildMeta(
    'ww3-waves-hs',
    'WaveWatch III global significant wave height (NOAA NCEP model) via PacIOOS ERDDAP',
    lat, lon, 100, valid_ms, valid_ms,
  )
  return { meta, gridBuffer: encodePlanes([fillCoastalGaps(h, lat.length, lon.length, 40)], 100, 40, 0.5) }
}

// ─── airtemp — GFS 2 m air temperature (same THREDDS pipe as wind) ──────────
async function fetchAirTemp() {
  const url =
    'https://thredds.ucar.edu/thredds/ncss/grid/grib/NCEP/GFS/Global_0p25deg/Best' +
    '?var=Temperature_height_above_ground&vertCoord=2&time=present&horizStride=2&accept=netcdf3'
  const nc = await fetchNetcdf(url)
  const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
  const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
  const t = nc.getDataVariable('Temperature_height_above_ground')
  if (t.length !== lat.length * lon.length) throw new Error(`field/axis mismatch ${t.length}`)
  for (let i = 0; i < t.length; i++) t[i] -= 273.15 // K → °C at bake time
  const valid_ms = timeFromUnits(unitsOf(nc, 'time'), nc.getDataVariable('time')?.[0])
  const runVar = nc.variables.some((x) => x.name === 'reftime')
  const run_ms = runVar ? timeFromUnits(unitsOf(nc, 'reftime'), nc.getDataVariable('reftime')?.[0]) : valid_ms
  const meta = buildMeta(
    'gfs-airtemp-2m',
    'NOAA NCEP GFS (2 m air temperature) via Unidata THREDDS NCSS',
    lat, lon, 100, run_ms || valid_ms, valid_ms,
  )
  return { meta, gridBuffer: encodePlanes([t], 100, 90, 0.02) }
}

// ─── sstanom — Coral Reef Watch SST anomaly (same dataset as sst) ───────────
async function fetchSstAnom() {
  // maxAbs 30 doubles as the fill-value guard: CRW encodes missing as
  // −327.68, which lands well outside any real anomaly.
  const url =
    'https://coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW.nc' +
    '?CRW_SSTANOMALY%5B(last)%5D%5B0:5:3599%5D%5B0:5:7199%5D'
  const nc = await fetchNetcdf(url)
  const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
  const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
  const a = nc.getDataVariable('CRW_SSTANOMALY')
  if (a.length !== lat.length * lon.length) throw new Error(`field/axis mismatch ${a.length}`)
  const valid_ms = timeFromUnits(unitsOf(nc, 'time'), nc.getDataVariable('time')?.[0])
  const meta = buildMeta(
    'crw-sst-anomaly',
    'NOAA Coral Reef Watch daily sea-surface temperature anomaly vs. long-term average, via CoastWatch ERDDAP',
    lat, lon, 100, valid_ms, valid_ms,
  )
  return { meta, gridBuffer: encodePlanes([fillCoastalGaps(a, lat.length, lon.length, 30)], 100, 30, 0.75) }
}

// ─── fire events: clustering + linking helpers ──────────────────────────────
// GWIS/GlobFire-style fire events derived from the same FIRMS detections we
// already pull (their own event product is derived from these detections, at
// monthly latency — ours refreshes with the cron). Detections are gridded to
// 0.05° (~5 km) cells, joined into connected components (8-neighbor, with
// longitude wrap), and each component becomes an event with a convex-hull
// footprint. Events are linked run-to-run by centroid proximity/bbox overlap
// so `first_seen_ms` and labels persist; new events get one reverse-geocode
// (Mapbox, server token) for a human label. Everything is labeled downstream
// as a DETECTION FOOTPRINT, not a mapped perimeter.

const EVENT_CELL_DEG = 0.05
const EVENT_MIN_DETECTIONS = 10
const EVENT_MIN_CELLS = 3
const EVENT_MAX_COUNT = 600
const EVENT_LINK_DEG = 0.4
const GEOCODES_PER_RUN = 40

// Andrew's monotone-chain convex hull; points [[lng,lat], ...].
function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length <= 3) return pts
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const build = (arr) => {
    const out = []
    for (const p of arr) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  return [...build(pts), ...build(pts.reverse())]
}

function hullAreaKm2(hull, latCenter) {
  if (hull.length < 3) return 0
  let a = 0
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i]
    const [x2, y2] = hull[(i + 1) % hull.length]
    a += x1 * y2 - x2 * y1
  }
  const kmPerDegLat = 111.32
  const kmPerDegLng = 111.32 * Math.max(0.05, Math.cos((latCenter * Math.PI) / 180))
  return Math.abs(a / 2) * kmPerDegLat * kmPerDegLng
}

function buildFireEvents(detections, prevEvents, now) {
  // Grid to cells (component building operates on cells, not raw points).
  const inv = 1 / EVENT_CELL_DEG
  const nLon = Math.round(360 * inv)
  const cells = new Map() // "r,c" → {n, frp, latSum, lngSum, r, c}
  for (const d of detections) {
    const r = Math.round(d.lat * inv)
    const c = ((Math.round(d.lon * inv) % nLon) + nLon) % nLon
    const key = `${r},${c}`
    const cell = cells.get(key)
    if (cell) {
      cell.n++
      cell.latSum += d.lat
      cell.lngSum += d.lon
      cell.frpSum += d.frp
      if (d.frp > cell.frp) cell.frp = d.frp
    } else {
      cells.set(key, { n: 1, frp: d.frp, frpSum: d.frp, latSum: d.lat, lngSum: d.lon, r, c })
    }
  }

  // Connected components over 8-neighbor cells (lng-wrapped), DBSCAN-style:
  // only "core" cells (≥2 detections) expand the search. Border cells join a
  // component but can't bridge two — without this, sparse agricultural
  // burning chains whole subcontinents into one "event" (the first bake
  // produced a single 391,000 km² Zambia "fire").
  const CORE_N = 2
  const seen = new Set()
  const components = []
  for (const [key, cell] of cells) {
    if (seen.has(key) || cell.n < CORE_N) continue
    const comp = []
    const queue = [key]
    seen.add(key)
    while (queue.length) {
      const k = queue.pop()
      const cur = cells.get(k)
      comp.push(cur)
      if (cur.n < CORE_N) continue // border cell: joins, doesn't expand
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const nk = `${cur.r + dr},${(((cur.c + dc) % nLon) + nLon) % nLon}`
          if (cells.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk) }
        }
      }
    }
    components.push(comp)
  }

  // Components → candidate events.
  const events = []
  for (const comp of components) {
    const n = comp.reduce((s, c) => s + c.n, 0)
    if (n < EVENT_MIN_DETECTIONS || comp.length < EVENT_MIN_CELLS) continue
    const latSum = comp.reduce((s, c) => s + c.latSum, 0)
    const lngSum = comp.reduce((s, c) => s + c.lngSum, 0)
    const lat = latSum / n
    const lng = lngSum / n
    // Hull over cell centers (in a local frame around the centroid so the
    // antimeridian doesn't shred the polygon).
    const pts = comp.map((c) => {
      let x = c.c / inv
      if (x - lng > 180) x -= 360
      if (x - lng < -180) x += 360
      return [Math.round(x * 100) / 100, Math.round((c.r / inv) * 100) / 100]
    })
    let hull = convexHull(pts)
    if (hull.length > 24) {
      const step = hull.length / 24
      hull = Array.from({ length: 24 }, (_, i) => hull[Math.floor(i * step)])
    }
    const area_km2 = Math.round(hullAreaKm2(hull, lat))
    events.push({
      lat: Math.round(lat * 100) / 100,
      lng: Math.round(lng * 100) / 100,
      n,
      frp: Math.round(comp.reduce((m, c) => Math.max(m, c.frp), 0)),
      frp_sum: Math.round(comp.reduce((s, c) => s + c.frpSum, 0)),
      cells: comp.length,
      area_km2,
      // Anything still vast after DBSCAN linking is a burning REGION
      // (savanna/agricultural season), not a single fire — typed so the UI
      // can say so honestly.
      type: area_km2 > 20000 || comp.length > 400 ? 'regional' : 'fire',
      hull,
      first_seen_ms: now,
      last_seen_ms: now,
      label: null,
      country: null,
      growth: null,
    })
  }
  events.sort((a, b) => b.n - a.n)
  const kept = events.slice(0, EVENT_MAX_COUNT)

  // Link to previous run's events: nearest prior event within EVENT_LINK_DEG
  // carries its identity (first_seen, label) forward.
  const prev = Array.isArray(prevEvents) ? prevEvents : []
  const usedPrev = new Set()
  for (const ev of kept) {
    let best = null
    let bestD = EVENT_LINK_DEG
    for (let i = 0; i < prev.length; i++) {
      if (usedPrev.has(i)) continue
      const p = prev[i]
      const dLng = Math.abs(((p.lng - ev.lng + 540) % 360) - 180) * Math.max(0.05, Math.cos((ev.lat * Math.PI) / 180))
      const d = Math.hypot(p.lat - ev.lat, dLng)
      if (d < bestD) { bestD = d; best = i }
    }
    if (best != null) {
      usedPrev.add(best)
      const p = prev[best]
      ev.first_seen_ms = Math.min(p.first_seen_ms || now, now)
      ev.label = p.label || null
      ev.country = p.country || null
      ev.name_src = p.name_src || null
      ev.growth = p.n ? ev.n - p.n : null
    }
  }
  return kept
}

// US events take their OFFICIAL incident name from our own NIFC snapshot
// (fire/nifc-incidents.json, baked for /fire every 3 h) — "Park Fire" beats
// "Fire near Chico". Runs after linking so it also replaces stale geocoded
// labels; matched events skip the geocode budget entirely.
function titleCaseFireName(raw) {
  const t = raw.trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  // NIFC incident names usually omit the word "Fire" ("PARK" → "Park Fire"),
  // but prescribed burns and complexes carry their own descriptors.
  return /fire|rx|complex|prescribed|pile|burn|support|season/i.test(raw) ? t : `${t} Fire`
}

async function nameEventsFromNifc(events, now = Date.now()) {
  try {
    const r = await fetch(`${BLOB_PUBLIC_BASE}/fire/nifc-incidents.json`)
    if (!r.ok) return
    const fc = await r.json()
    const incidents = (fc.features || [])
      .filter((f) => f.geometry?.type === 'Point' && f.properties?.name)
      .map((f) => ({
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        name: f.properties.name,
        type: f.properties.type || null,
        irwin: f.properties.irwin || null,
        discovered_ms: f.properties.discovered_ms || null,
        acres: f.properties.acres ?? null,
        contained: f.properties.contained ?? null,
      }))
    if (!incidents.length) return
    for (const ev of events) {
      let best = null
      let bestD = 0.15 // ~15 km
      for (const inc of incidents) {
        const dLng = Math.abs(((inc.lng - ev.lng + 540) % 360) - 180) * Math.max(0.05, Math.cos((ev.lat * Math.PI) / 180))
        const d = Math.hypot(inc.lat - ev.lat, dLng)
        if (d < bestD) { bestD = d; best = inc }
      }
      if (best) {
        ev.label = titleCaseFireName(best.name)
        ev.country = 'United States'
        ev.name_src = 'nifc'
        ev.irwin = best.irwin
        ev._nifcName = best.name
        // Official metadata beats anything we can infer: discovery date gives
        // TRUE fire age (our run-linking only knows when we started tracking).
        if (best.discovered_ms) {
          ev.discovered_ms = best.discovered_ms
          ev.first_seen_ms = Math.min(ev.first_seen_ms, best.discovered_ms)
        }
        if (best.acres != null) ev.acres = best.acres
        if (best.contained != null) ev.contained = best.contained
      }
    }

    // NIFC incidents with NO fresh detections are still real, ongoing fires
    // (smoldering, contained, cloud-covered, or between overpasses) — a
    // 15,000-acre 45%-contained fire must not vanish because satellites
    // missed a day. Append them as `type:'incident'` events (n=0) so the
    // map answers "is there a fire here" from the official record, not just
    // the last 24 h of detections. Eligibility mirrors /fire's usfires
    // layer exactly (WF/CX only, zero-acre initial attacks age out after
    // 36 h) so both tools give one answer.
    const ZERO_ACRE_MAX_AGE_MS = 36 * 60 * 60 * 1000
    const matchedIrwins = new Set(events.filter((e) => e.irwin).map((e) => e.irwin))
    for (const inc of incidents) {
      if (inc.irwin && matchedIrwins.has(inc.irwin)) continue
      const t = String(inc.type || '').toUpperCase()
      if (t && t !== 'WF' && t !== 'CX') continue
      if ((inc.acres == null || inc.acres === 0) && inc.discovered_ms && now - inc.discovered_ms > ZERO_ACRE_MAX_AGE_MS) continue
      events.push({
        lat: Math.round(inc.lat * 1e4) / 1e4,
        lng: Math.round(inc.lng * 1e4) / 1e4,
        n: 0,
        frp: 0,
        frp_sum: 0,
        cells: 0,
        area_km2: 0,
        type: 'incident',
        hull: null,
        first_seen_ms: inc.discovered_ms || now,
        last_seen_ms: now,
        label: titleCaseFireName(inc.name),
        country: 'United States',
        name_src: 'nifc',
        irwin: inc.irwin,
        discovered_ms: inc.discovered_ms,
        acres: inc.acres,
        contained: inc.contained,
        growth: null,
        _nifcName: inc.name,
      })
    }

    // Matched events also get the OFFICIAL mapped perimeter (the simplified
    // variant /fire bakes for zoomed-out views) in place of our derived hull.
    const matched = events.filter((e) => e.name_src === 'nifc')
    if (matched.length) {
      try {
        // Prefer the simplified variant; if it's missing (its bake step has
        // been observed failing silently), pull the full file and simplify
        // with /fire's own helper.
        let pfc = null
        const pr = await fetch(`${BLOB_PUBLIC_BASE}/fire/nifc-perimeters-low.json`)
        if (pr.ok) {
          pfc = await pr.json()
        } else {
          const prFull = await fetch(`${BLOB_PUBLIC_BASE}/fire/nifc-perimeters.json`)
          if (prFull.ok) pfc = simplifyNifc(await prFull.json())
        }
        if (pfc) {
          const byIrwin = new Map()
          const byName = new Map()
          for (const f of pfc.features || []) {
            if (!f.geometry || (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon')) continue
            if (f.properties?.irwin) byIrwin.set(f.properties.irwin, f.geometry)
            if (f.properties?.name) byName.set(String(f.properties.name).toUpperCase(), f.geometry)
          }
          for (const ev of matched) {
            const geom = (ev.irwin && byIrwin.get(ev.irwin))
              || byName.get(String(ev._nifcName).toUpperCase())
            if (geom) {
              ev.perimeter = geom
              ev.perimeter_src = 'nifc'
            }
          }
        }
      } catch { /* perimeters unreachable — derived hulls remain */ }
    }
    for (const ev of events) delete ev._nifcName
  } catch { /* snapshot unreachable — geocode fallback covers it */ }
}

async function geocodeNewEvents(events) {
  const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN
  if (!token) return
  let budget = GEOCODES_PER_RUN
  for (const ev of events) {
    if (ev.label || budget <= 0) continue
    budget--
    try {
      const r = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${ev.lng},${ev.lat}.json` +
        `?types=place,locality,region&limit=1&language=en&access_token=${token}`,
      )
      if (!r.ok) continue
      const j = await r.json()
      const f = j.features?.[0]
      if (!f) continue
      ev.label = f.text || null
      ev.country = f.context?.find((c) => c.id?.startsWith('country'))?.text
        || (f.place_type?.includes('country') ? f.text : null)
    } catch { /* label stays null — the client falls back to coordinates */ }
  }
}

// ─── hotspots — FIRMS VIIRS active-fire detections, last 24 h, binned ───────
// The global CSV is ~16 MB of individual 375 m detections; a globe view wants
// clusters, so we aggregate (count + max fire radiative power) and publish
// compact JSON. Two variants from one pull: 0.5° bins for the world view and
// 0.25° for zoomed-in views (the client swaps by zoom). Each cluster is
// placed at the MEAN position of its detections — never the bin center — so
// the display shows where fires actually are instead of an artificial
// lattice. Low-confidence detections are dropped.
// All three operational VIIRS platforms. One satellite alone misses fires:
// each pass sees a strip a few hours apart, and (observed near Los Alamos)
// a fire's only detection of the day can come from NOAA-20 while Suomi-NPP
// saw nothing. A transient failure of one feed must not sink the bake —
// platforms are fetched independently and whatever succeeded is merged.
const FIRMS_PLATFORMS = [
  { sat: 'Suomi-NPP', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv' },
  { sat: 'NOAA-20', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv' },
  { sat: 'NOAA-21', url: 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv' },
]

async function fetchFirmsPlatform(url, satIdx) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`firms ${r.status}`)
  const text = await r.text()
  const lines = text.split('\n')
  if (lines.length < 100) throw new Error(`firms csv too small (${lines.length} lines)`)
  const header = lines[0].split(',')
  const iLat = header.indexOf('latitude')
  const iLon = header.indexOf('longitude')
  const iConf = header.indexOf('confidence')
  const iFrp = header.indexOf('frp')
  const iDate = header.indexOf('acq_date')
  const iTime = header.indexOf('acq_time')
  if (iLat < 0 || iLon < 0 || iConf < 0 || iFrp < 0) throw new Error('firms csv header changed')
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 5 || parts[iConf] === 'low') continue
    const lat = Number(parts[iLat])
    const lon = Number(parts[iLon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    // Overpass time (UTC): acq_date "2026-08-22" + acq_time "0016" (HHMM).
    // Drives the recency coloring of raw detections at close zoom.
    let acq_ms = null
    if (iDate >= 0 && iTime >= 0) {
      const t = String(parts[iTime]).padStart(4, '0')
      const ms = Date.parse(`${parts[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`)
      if (Number.isFinite(ms)) acq_ms = ms
    }
    out.push({ lat, lon, frp: Number(parts[iFrp]) || 0, acq_ms, sat: satIdx })
  }
  return out
}

async function fetchHotspots() {
  const settled = await Promise.allSettled(FIRMS_PLATFORMS.map((p, i) => fetchFirmsPlatform(p.url, i)))
  const okPlatforms = []
  const detections = []
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      okPlatforms.push(FIRMS_PLATFORMS[i].sat)
      // No spread here: ~200k args per platform overflows the call stack.
      for (const d of s.value) detections.push(d)
    } else {
      console.error(`firms ${FIRMS_PLATFORMS[i].sat} pull failed:`, String(s.reason).slice(0, 120))
    }
  })
  if (!okPlatforms.length) throw new Error('all FIRMS platform pulls failed')

  const VARIANTS = [
    { binDeg: 0.5, path: 'systems/firms-hotspots.json', bins: new Map() },
    { binDeg: 0.25, path: 'systems/firms-hotspots-fine.json', bins: new Map() },
    // ~5 km bins for zoomed-in views — enough dots to trace a fire's actual
    // shape (a shaped 50 km² fire is 2 blobs at 0.25°, ~15 at 0.05°).
    { binDeg: 0.05, path: 'systems/firms-hotspots-detail.json', bins: new Map() },
  ]
  let totalFrp = 0
  for (const { lat, lon, frp } of detections) {
    totalFrp += frp
    for (const v of VARIANTS) {
      const inv = 1 / v.binDeg
      const key = `${Math.round(lat * inv)},${Math.round(lon * inv)}`
      const b = v.bins.get(key)
      if (b) {
        b.n++
        b.latSum += lat
        b.lonSum += lon
        b.frpSum += frp
        if (frp > b.frp) b.frp = frp
      } else {
        v.bins.set(key, { n: 1, latSum: lat, lonSum: lon, frp, frpSum: frp })
      }
    }
  }
  const kept = detections.length
  if (kept < 500) throw new Error(`suspiciously few detections (${kept})`)

  const now = Date.now()

  // Raw-detection shards (10°×10°): zoomed in on a specific fire, users need
  // the ACTUAL 375 m detections — position, intensity, and how recent — not
  // 5 km cluster blobs. The globe is sharded so a viewport only fetches the
  // few files under it; the shard list rides in each variant's meta, so the
  // client never references a stale shard from an earlier run (no deletes
  // needed). Rows: [lat, lng, frpMW, minutesBeforeFetch|null, satIdx].
  const SHARD_DEG = 10
  const SHARD_MAX = 20000
  const shards = new Map()
  for (const d of detections) {
    const key = `${Math.floor(d.lat / SHARD_DEG) * SHARD_DEG}_${Math.floor(d.lon / SHARD_DEG) * SHARD_DEG}`
    let arr = shards.get(key)
    if (!arr) shards.set(key, (arr = []))
    arr.push(d)
  }
  const rawShardNames = []
  const shardJsons = []
  for (const [key, arr] of shards) {
    // Intensity-sorted so the per-shard cap keeps the detections that matter
    // (a savanna shard can exceed the cap; a fire being inspected won't).
    arr.sort((a, b) => b.frp - a.frp)
    const truncated = arr.length > SHARD_MAX
    const name = `firms-raw-${key}`
    rawShardNames.push(name)
    shardJsons.push({
      path: `systems/${name}.json`,
      json: {
        version: 1,
        kind: 'firms-raw',
        fetched_ms: now,
        valid_ms: now,
        run_ms: now,
        window: '24h',
        total: arr.length,
        ...(truncated ? { truncated: true } : {}),
        satellites: FIRMS_PLATFORMS.map((p) => p.sat),
        source: `NASA FIRMS — individual VIIRS (${okPlatforms.join(', ')}) active-fire detections, last 24 h, ≥nominal confidence`,
        detections: arr.slice(0, SHARD_MAX).map((d) => [
          Math.round(d.lat * 1e4) / 1e4,
          Math.round(d.lon * 1e4) / 1e4,
          Math.round(d.frp * 10) / 10,
          Number.isFinite(d.acq_ms) ? Math.max(0, Math.round((now - d.acq_ms) / 60000)) : null,
          d.sat,
        ]),
      },
    })
  }

  const jsons = VARIANTS.map((v) => ({
    path: v.path,
    json: {
      version: 1,
      kind: 'firms-hotspots',
      fetched_ms: now,
      valid_ms: now,
      run_ms: now,
      window: '24h',
      detections: kept,
      // Combined radiative power of all detections across the 24 h of
      // overpasses — the raw input for GFAS-style emission estimates.
      frp_sum_mw: Math.round(totalFrp),
      binDeg: v.binDeg,
      platforms: okPlatforms,
      raw_shards: rawShardNames,
      source: `NASA FIRMS — VIIRS (${okPlatforms.join(', ')}) active-fire detections, last 24 h, ≥nominal confidence`,
      // Most INTENSE clusters first (total radiative power, not detection
      // count), so any render cap keeps the fires that matter: 40 scattered
      // crop burns must not out-rank one megafire front.
      bins: [...v.bins.values()].sort((a, b) => b.frpSum - a.frpSum)
        .map((b) => [
          Math.round((b.latSum / b.n) * 100) / 100,
          Math.round((b.lonSum / b.n) * 100) / 100,
          b.n,
          Math.round(b.frp),
          Math.round(b.frpSum),
        ]),
    },
  }))

  jsons.push(...shardJsons)

  // Fire events (same detections, richer product) — guarded so an events
  // failure never blocks the hotspot files; the previous events file simply
  // stays in place (its stamps show the age).
  try {
    let prevEvents = null
    try {
      const pr = await fetch(`${BLOB_PUBLIC_BASE}/systems/fire-events.json`)
      if (pr.ok) prevEvents = (await pr.json())?.events
    } catch { /* first run / blob unreachable — all events read as new */ }
    const events = buildFireEvents(detections, prevEvents, now)
    await nameEventsFromNifc(events, now)
    await geocodeNewEvents(events)

    // Per-fire histories: route today's rows into each significant fire's
    // rolling file (plus budgeted backfill to discovery), and mark those
    // events hist:true BEFORE the feed below is serialized. Guarded so a
    // history failure never blocks the events feed.
    try {
      const { items, route } = prepareHistItems(events)
      for (const d of detections) route(d.lat, d.lon, d.frp, d.acq_ms, d.sat)
      jsons.push(...(await finalizeHistItems(items, now, { backfill: true })))
    } catch (err) {
      console.error('fire-hist build failed (events feed unaffected):', err)
    }
    jsons.push({
      path: 'systems/fire-events.json',
      json: {
        version: 1,
        kind: 'fire-events',
        fetched_ms: now,
        valid_ms: now,
        run_ms: now,
        window: '24h',
        events,
        platforms: okPlatforms,
        incidents: events.filter((e) => e.type === 'incident').length,
        source: `Derived by EarthAtlas from NASA FIRMS VIIRS detections (${okPlatforms.join(', ')}; event clustering — footprints are detection hulls unless an official NIFC perimeter is joined) merged with NIFC WFIGS incident records (US)`,
      },
    })
  } catch (err) {
    console.error('fire-events build failed (hotspot files unaffected):', err)
  }
  return { jsons }
}


// ─── Per-fire detection histories — "since first detection" scrubbing ──────
// One compact file per significant NIFC fire (fire-hist-<irwin-hex>.json):
// every VIIRS detection inside the fire's area since discovery. Three feeds
// keep it filled: the 3-hourly hotspots bake appends the fresh 24 h rows,
// the fire-daily bake seeds/merges the 7-day files, and a budgeted FIRMS
// area-API backfill (FIRMS_MAP_KEY) reaches back to the discovery date for
// fires older than the rolling files. Rows: [lat, lng, frpMW, minutes-from-
// t0, satIdx], deduped on ~10-minute/position keys so the three feeds can
// overlap freely. The merged fire-events feed marks these fires hist:true
// so the client knows a deep timeline exists.
const HIST_MIN_ACRES = 100
const HIST_MAX_ROWS = 50000
const HIST_BBOX_MARGIN = 0.03
const HIST_BACKFILL_BUDGET = 60      // FIRMS area-API requests per bake run
const HIST_BACKFILL_PER_FIRE = 15    // give up past this (very long fires)

const histIdOf = (irwin) => `fire-hist-${String(irwin).replace(/[^0-9a-f]/gi, '').toLowerCase()}`

function histBboxOf(e) {
  let w = Infinity
  let s = Infinity
  let e2 = -Infinity
  let n = -Infinity
  const eat = (lng, lat) => {
    if (lng < w) w = lng
    if (lng > e2) e2 = lng
    if (lat < s) s = lat
    if (lat > n) n = lat
  }
  if (e.perimeter) {
    const polys = e.perimeter.type === 'Polygon' ? [e.perimeter.coordinates] : e.perimeter.coordinates
    for (const poly of polys) for (const ring of poly) for (const c of ring) eat(c[0], c[1])
  } else if (Array.isArray(e.hull) && e.hull.length >= 3) {
    for (const c of e.hull) eat(c[0], c[1])
  }
  if (!Number.isFinite(w)) { eat(e.lng - 0.12, e.lat - 0.12); eat(e.lng + 0.12, e.lat + 0.12) }
  const m = HIST_BBOX_MARGIN
  return [w - m, s - m, e2 + m, n + m]
}

/**
 * Candidate fires (NIFC-matched, detection-active or ≥100 acres) with a
 * 1°-cell index so millions of CSV rows route to their fires cheaply.
 * route(lat, lng, frp, acq_ms, sat) files a row into every matching fire.
 */
export function prepareHistItems(events) {
  const cands = (events || []).filter((e) => e.irwin && e.name_src === 'nifc' && (e.n > 0 || (e.acres || 0) >= HIST_MIN_ACRES))
  const items = cands.map((e) => ({ e, id: histIdOf(e.irwin), bbox: histBboxOf(e), add: [] }))
  const grid = new Map()
  items.forEach((it, idx) => {
    const [w, s, e2, n] = it.bbox
    for (let gy = Math.floor(s); gy <= Math.floor(n); gy++) {
      for (let gx = Math.floor(w); gx <= Math.floor(e2); gx++) {
        const k = `${gy},${gx}`
        let arr = grid.get(k)
        if (!arr) grid.set(k, (arr = []))
        arr.push(idx)
      }
    }
  })
  const route = (lat, lng, frp, acq_ms, sat) => {
    if (!Number.isFinite(acq_ms)) return
    const arr = grid.get(`${Math.floor(lat)},${Math.floor(lng)}`)
    if (!arr) return
    for (const idx of arr) {
      const [w, s, e2, n] = items[idx].bbox
      if (lng >= w && lng <= e2 && lat >= s && lat <= n) items[idx].add.push({ lat, lng, frp, acq_ms, sat })
    }
  }
  return { items, route }
}

// FIRMS area-API pull for one source/bbox/date-chunk (backfill only).
async function fetchFirmsArea(key, source, bbox, dayRange, dateStr) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/` +
    `${bbox.map((v) => v.toFixed(3)).join(',')}/${dayRange}/${dateStr}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`firms area ${r.status}`)
  const text = await r.text()
  if (text.startsWith('Invalid') || text.startsWith('Error')) throw new Error(text.slice(0, 80))
  const lines = text.split('\n')
  if (lines.length < 2) return []
  const header = lines[0].split(',')
  const iLat = header.indexOf('latitude')
  const iLon = header.indexOf('longitude')
  const iConf = header.indexOf('confidence')
  const iFrp = header.indexOf('frp')
  const iDate = header.indexOf('acq_date')
  const iTime = header.indexOf('acq_time')
  if (iLat < 0 || iLon < 0 || iDate < 0 || iTime < 0) return []
  const out = []
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 5 || parts[iConf] === 'low' || parts[iConf] === 'l') continue
    const lat = Number(parts[iLat])
    const lon = Number(parts[iLon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const t = String(parts[iTime]).padStart(4, '0')
    const ms = Date.parse(`${parts[iDate]}T${t.slice(0, 2)}:${t.slice(2)}:00Z`)
    if (!Number.isFinite(ms)) continue
    out.push({ lat, lng: lon, frp: Number(parts[iFrp]) || 0, acq_ms: ms })
  }
  return out
}

const HIST_BACKFILL_SOURCES = [
  ['VIIRS_SNPP_NRT', 0],
  ['VIIRS_NOAA20_NRT', 1],
  ['VIIRS_NOAA21_NRT', 2],
]

/**
 * Merge routed rows over each fire's stored file (plus optional area-API
 * backfill to the discovery date) and return the blob writes. Marks each
 * written event hist:true so the events feed advertises the deep timeline.
 */
export async function finalizeHistItems(items, now, { backfill = false } = {}) {
  const jsons = []
  const budget = { left: backfill && process.env.FIRMS_MAP_KEY ? HIST_BACKFILL_BUDGET : 0 }
  for (let i = 0; i < items.length; i += 8) {
    await Promise.all(items.slice(i, i + 8).map(async (it) => {
      let prev = null
      try {
        const r = await fetch(`${BLOB_PUBLIC_BASE}/systems/${it.id}.json`)
        if (r.ok) prev = await r.json()
      } catch { /* first write */ }
      // Nothing known AND no way to learn more → skip. A quiet fire (no
      // fresh rows) still proceeds when backfill could reach its past.
      if (!prev && !it.add.length && !(backfill && it.e.discovered_ms && budget.left > 0)) return

      const t0 = prev?.t0_ms ?? (it.e.discovered_ms || now)
      let backfilled_ms = prev?.backfilled_ms ?? null

      // Backfill: reach from the file's earliest row back to discovery via
      // the FIRMS area API (NRT sources — active fires are weeks old at
      // most). One attempt per fire; partial coverage still counts as done
      // so a fire past NRT retention doesn't burn the budget every bake.
      if (backfill && !backfilled_ms && budget.left > 0 && it.e.discovered_ms) {
        const key = process.env.FIRMS_MAP_KEY
        const prevEarliest = prev?.detections?.length ? t0 + prev.detections[0][3] * 60000 : now
        const addEarliest = it.add.reduce((m, d) => Math.min(m, d.acq_ms), prevEarliest)
        const gapDays = Math.ceil((addEarliest - it.e.discovered_ms) / 8.64e7)
        if (gapDays >= 1) {
          const chunks = Math.min(Math.ceil(gapDays / 5), Math.floor(HIST_BACKFILL_PER_FIRE / HIST_BACKFILL_SOURCES.length))
          const wanted = chunks * HIST_BACKFILL_SOURCES.length
          if (budget.left >= wanted) {
            budget.left -= wanted
            for (let c = 0; c < chunks; c++) {
              const startMs = it.e.discovered_ms + c * 5 * 8.64e7
              const dateStr = new Date(startMs).toISOString().slice(0, 10)
              const range = Math.min(5, Math.max(1, Math.ceil((addEarliest - startMs) / 8.64e7)))
              for (const [src, satIdx] of HIST_BACKFILL_SOURCES) {
                try {
                  const rows = await fetchFirmsArea(key, src, it.bbox, range, dateStr)
                  for (const d of rows) it.add.push({ ...d, sat: satIdx })
                } catch (err) {
                  console.error(`hist backfill ${it.id} ${src} ${dateStr}:`, String(err).slice(0, 100))
                }
              }
            }
            backfilled_ms = now
          }
        } else {
          backfilled_ms = now // already reaches discovery
        }
      }

      const seen = new Set()
      const out = []
      const push = (lat, lng, frp, acqMin, sat) => {
        const key = `${lat.toFixed(4)}|${lng.toFixed(4)}|${Math.round((t0 / 60000 + acqMin) / 10)}`
        if (seen.has(key)) return
        seen.add(key)
        out.push([Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4, Math.round(frp * 10) / 10, acqMin, sat ?? 0])
      }
      for (const r of prev?.detections || []) push(r[0], r[1], r[2], r[3], r[4])
      for (const d of it.add) push(d.lat, d.lng, d.frp, Math.round((d.acq_ms - t0) / 60000), d.sat)
      // A 0-row file is still written once backfill has RUN — it records
      // backfilled_ms so a perpetually-quiet fire (or one past the NRT
      // window) doesn't re-drain the request budget every bake. Only files
      // with rows advertise a timeline to the client.
      if (!out.length && !backfilled_ms) return
      out.sort((a, b) => a[3] - b[3])
      const truncated = out.length > HIST_MAX_ROWS
      const rows = truncated ? out.slice(out.length - HIST_MAX_ROWS) : out

      if (rows.length) it.e.hist = true
      jsons.push({
        path: `systems/${it.id}.json`,
        json: {
          version: 1,
          kind: 'fire-hist',
          irwin: it.e.irwin,
          name: it.e.label || null,
          fetched_ms: now,
          valid_ms: now,
          run_ms: now,
          t0_ms: t0,
          first_ms: rows.length ? t0 + rows[0][3] * 60000 : null,
          total: out.length,
          ...(truncated ? { truncated: true } : {}),
          backfilled_ms,
          satellites: FIRMS_PLATFORMS.map((p) => p.sat),
          bbox: it.bbox.map((v) => Math.round(v * 1000) / 1000),
          source: 'NASA FIRMS — VIIRS active-fire detections within this fire’s area since discovery, ≥nominal confidence',
          detections: rows,
        },
      })
    }))
  }
  return jsons
}

// ─── hrrr-smoke — NOAA HRRR near-surface smoke, US at 3 km ─────────────────
// The CAMS smoke layer is global but ~44 km; HRRR-Smoke models actual plume
// transport at 3 km AND gives near-surface concentration (µg/m³ — what
// people breathe), which CAMS can't. We byte-range just the MASSDEN message
// (~0.7 MB of a 700 MB file) from the latest published cycle's 1-hour
// forecast, decode it (api/_grib2.js, verified against the same file's 2 m
// temperature), and resample the native Lambert grid onto a regular 0.05°
// grid; cells outside the HRRR footprint stay missing so the layer simply
// ends at the US border.
async function fetchHrrrSmoke() {
  const nowMs = Date.now()
  let url = null
  let run_ms = null
  // f01 publishes ~50–70 min after each hourly cycle starts.
  for (let back = 1; back <= 6; back++) {
    const t = new Date(nowMs - back * 3.6e6)
    const day = t.toISOString().slice(0, 10).replace(/-/g, '')
    const hh = String(t.getUTCHours()).padStart(2, '0')
    const u = `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.${day}/conus/hrrr.t${hh}z.wrfsfcf01.grib2`
    try {
      const r = await fetch(`${u}.idx`, { method: 'HEAD' })
      if (r.ok) {
        url = u
        run_ms = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours())
        break
      }
    } catch { /* keep looking back */ }
  }
  if (!url) throw new Error('no recent HRRR cycle published')

  const { fetchGribField } = await import('./_grib2.js')
  const { values, grid } = await fetchGribField(url, /:MASSDEN:8 m above ground:/)
  const rg = await hrrrRegularGrid(values, grid, 0.05, 3199)
  const scale = 10 // 0.1 µg/m³ resolution in int16
  const meta = buildMeta(
    'hrrr-smoke-massden',
    'NOAA HRRR-Smoke — near-surface smoke concentration (µg/m³), 3 km CONUS model, 1-hour forecast',
    rg.latArr, rg.lonArr, scale, run_ms, run_ms + 3.6e6,
  )
  // Outside-footprint cells are ~27% of the lat/lon box — expected missing.
  const gridBuffer = encodePlanes([rg.plane], scale, 3200, 0.75)
  return { meta, gridBuffer }
}

// Resample the native HRRR Lambert grid onto a regular lat/lon grid over its
// footprint (nearest neighbor; kg/m³ → µg/m³, clamped at `cap`). Shared by
// the live 0.05° grid bake and the 0.1° history-tape frames.
async function hrrrRegularGrid(values, grid, step, cap) {
  const { lambertProjector } = await import('./_grib2.js')
  const proj = lambertProjector(grid)
  const LAT0 = 21.1
  const LON0 = 225.9 // 0–360, like the other bakes
  const nLat = Math.round(32.5 / step) + 1   // → 53.6 N
  const nLon = Math.round(73.3 / step)       // → −60.8 W
  const plane = new Float32Array(nLat * nLon).fill(NaN)
  for (let r = 0; r < nLat; r++) {
    const lat = LAT0 + r * step
    for (let c = 0; c < nLon; c++) {
      const lng = LON0 + c * step - 360
      const p = proj(lat, lng)
      const i = Math.round(p.i)
      const j = Math.round(p.j)
      if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny) continue
      plane[r * nLon + c] = Math.min(cap, values[j * grid.nx + i] * 1e9)
    }
  }
  return {
    plane,
    latArr: Array.from({ length: nLat }, (_, i) => LAT0 + i * step),
    lonArr: Array.from({ length: nLon }, (_, i) => LON0 + i * step),
  }
}

// History tape: hourly ground-smoke frames at 0.1° (PNG-compressed bytes,
// µg/m³ at 1 µg steps, capped at 254 — the ramp tops out well below). The
// AWS archive keeps past cycles, so backfill just asks for older days.
function hrrrSmokeTape() {
  return {
    kind: 'hrrr-smoke-massden',
    source: 'NOAA HRRR-Smoke — near-surface smoke (µg/m³), 3 km CONUS model, hourly 1-hour forecasts',
    qscale: 1,
    offset: -1, // byte = µg/m³ + 1, so byte 0 stays the missing sentinel
    nodata0: true,
    stepH: 1,
    latencyH: 2,
    days: 4,
    maxMissingFrac: 0.6, // ~27% of the lat/lon box is outside the model
    frameKind: 'hourly smoke forecast (+1 h)',
    expectedTimes: (day, now) =>
      Array.from({ length: 24 }, (_, h) => dayMs(day, h)).filter((t) => now - t >= 2 * H),
    async fetchDay(day, wanted) {
      const { fetchGribField } = await import('./_grib2.js')
      const frames = []
      let axes = null
      for (const valid of wanted) {
        const run = valid - H
        const d = new Date(run)
        const dayStr = d.toISOString().slice(0, 10).replace(/-/g, '')
        const hh = String(d.getUTCHours()).padStart(2, '0')
        const url = `https://noaa-hrrr-bdp-pds.s3.amazonaws.com/hrrr.${dayStr}/conus/hrrr.t${hh}z.wrfsfcf01.grib2`
        try {
          const { values, grid } = await fetchGribField(url, /:MASSDEN:8 m above ground:/)
          const rg = await hrrrRegularGrid(values, grid, 0.1, 254)
          axes = rg
          frames.push({ run_ms: run, valid_ms: valid, lead_h: 1, values: rg.plane })
        } catch (err) {
          // A missing archive hour (rare cycle gap) skips its frame only.
          console.error(`hrrr tape ${new Date(valid).toISOString()}:`, String(err).slice(0, 100))
        }
      }
      if (!frames.length) throw new Error('no HRRR frames fetched')
      return { lat: axes.latArr, lon: axes.lonArr, frames }
    },
  }
}

// ─── fire-daily — rolling daily fire-presence rollup for the time slider ───
// The 7-day FIRMS CSVs (one per VIIRS platform, ~65 MB each) are binned per
// UTC day at 0.25°; each bake merges its fresh 7 days over the stored file,
// so history accumulates toward a 31-day window. Wide-zoom scrubbing swaps
// the glow layer to a day's bins. Per-day bins are capped by total radiative
// power (the live layer's significance rule); `total` records the pre-cap
// count so the truncation is never silent. Separate dataset/cron from the
// 3-hourly hotspots bake — a ~200 MB pull earns its own slower schedule.
const FIRE_DAILY_BIN_DEG = 0.25
const FIRE_DAILY_TOP = 6000
const FIRE_DAILY_KEEP_DAYS = 31

async function binFirmsDaily(url, days, route, satIdx) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`firms ${r.status}`)
  const text = await r.text()
  const lines = text.split('\n')
  if (lines.length < 100) throw new Error(`firms 7d csv too small (${lines.length} lines)`)
  const header = lines[0].split(',')
  const iLat = header.indexOf('latitude')
  const iLon = header.indexOf('longitude')
  const iConf = header.indexOf('confidence')
  const iFrp = header.indexOf('frp')
  const iDate = header.indexOf('acq_date')
  const iTime = header.indexOf('acq_time')
  if (iLat < 0 || iLon < 0 || iConf < 0 || iFrp < 0 || iDate < 0) throw new Error('firms 7d csv header changed')
  const inv = 1 / FIRE_DAILY_BIN_DEG
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',')
    if (parts.length < 5 || parts[iConf] === 'low') continue
    const lat = Number(parts[iLat])
    const lon = Number(parts[iLon])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const date = parts[iDate]
    if (!date || date.length !== 10) continue
    const frp = Number(parts[iFrp]) || 0
    let bins = days.get(date)
    if (!bins) days.set(date, (bins = new Map()))
    const key = `${Math.round(lat * inv)},${Math.round(lon * inv)}`
    const b = bins.get(key)
    if (b) {
      b.n++
      b.latSum += lat
      b.lonSum += lon
      b.frpSum += frp
      if (frp > b.frp) b.frp = frp
    } else {
      bins.set(key, { n: 1, latSum: lat, lonSum: lon, frp, frpSum: frp })
    }
    // Seed per-fire histories with a week of rows (route is a cheap
    // grid-indexed bbox check, so this adds little to the 4.5M-row parse).
    if (route && iTime >= 0) {
      const t = String(parts[iTime]).padStart(4, '0')
      const ms = Date.parse(`${date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`)
      if (Number.isFinite(ms)) route(lat, lon, frp, ms, satIdx)
    }
  }
}

async function fetchFireDaily() {
  const days = new Map() // 'YYYY-MM-DD' → Map(binKey → bin)
  const ok = []
  // Fire-history seeding: the 7-day rows also flow into the per-fire files
  // (candidates from the current events feed; absent/old feed → no-op).
  let hist = null
  try {
    const er = await fetch(`${BLOB_PUBLIC_BASE}/systems/fire-events.json`)
    if (er.ok) hist = prepareHistItems((await er.json())?.events)
  } catch { /* events feed unreachable — skip seeding this run */ }
  // Sequential on purpose: three ~65 MB text bodies at once is an OOM risk.
  for (const [i, p] of FIRMS_PLATFORMS.entries()) {
    try {
      await binFirmsDaily(p.url.replace('_24h.csv', '_7d.csv'), days, hist?.route, i)
      ok.push(p.sat)
    } catch (err) {
      console.error(`fire-daily ${p.sat} pull failed:`, String(err).slice(0, 120))
    }
  }
  if (!ok.length) throw new Error('all FIRMS 7d pulls failed')

  const now = Date.now()
  const freshDays = new Map()
  for (const [date, bins] of days) {
    const arr = [...bins.values()].sort((a, b) => b.frpSum - a.frpSum)
    freshDays.set(date, {
      date,
      start_ms: Date.parse(`${date}T00:00:00Z`),
      total: arr.length,
      bins: arr.slice(0, FIRE_DAILY_TOP).map((b) => [
        Math.round((b.latSum / b.n) * 100) / 100,
        Math.round((b.lonSum / b.n) * 100) / 100,
        b.n,
        Math.round(b.frp),
        Math.round(b.frpSum),
      ]),
    })
  }

  // Merge over the stored file: fresh days win (a re-baked day is more
  // complete), older days persist until they age out of the window.
  let prevDays = []
  try {
    const pr = await fetch(`${BLOB_PUBLIC_BASE}/systems/fire-daily.json`)
    if (pr.ok) prevDays = (await pr.json())?.days || []
  } catch { /* first bake */ }
  const merged = new Map(prevDays.map((d) => [d.date, d]))
  for (const [date, d] of freshDays) merged.set(date, d)
  const daysOut = [...merged.values()]
    .filter((d) => Number.isFinite(d.start_ms) && now - d.start_ms < (FIRE_DAILY_KEEP_DAYS + 1) * 8.64e7)
    .sort((a, b) => a.start_ms - b.start_ms)

  const jsons = [{
    path: 'systems/fire-daily.json',
    json: {
      version: 1,
      kind: 'fire-daily',
      fetched_ms: now,
      valid_ms: now,
      run_ms: now,
      binDeg: FIRE_DAILY_BIN_DEG,
      days: daysOut,
      source: `NASA FIRMS — VIIRS (${ok.join(', ')}) active-fire detections binned per UTC day, ≥nominal confidence, up to ${FIRE_DAILY_KEEP_DAYS} days`,
    },
  }]
  if (hist) {
    try {
      jsons.push(...(await finalizeHistItems(hist.items, now)))
    } catch (err) {
      console.error('fire-hist seeding failed (fire-daily unaffected):', err)
    }
  }
  return { jsons }
}

// ─── CAMS (Copernicus Atmosphere Data Store) — generic field bake ───────────
// ADS is an async job queue: submit → poll → download a zipped NetCDF4
// (HDF5, read with h5wasm; netcdfjs can't). Auth is the ADS personal access
// token in ADS_API_KEY; each dataset's licence must be accepted once in the
// ADS web UI or the API returns 403. Fields are float32 on a 0.4° grid,
// north-first, lon from 0. We ask for the freshest run likely published
// (runs at 00z/12z, ~8 h latency) with the lead time that lands nearest now.
const ADS_BASE = 'https://ads.atmosphere.copernicus.eu/api'
const ADS_POLL_MS = 5000
const ADS_TIMEOUT_MS = 230000 // inside the cron's 300 s maxDuration

function unzipFirstNc(buf) {
  let off = 0
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8)
    const compSize = buf.readUInt32LE(off + 18)
    const nameLen = buf.readUInt16LE(off + 26)
    const extraLen = buf.readUInt16LE(off + 28)
    const name = buf.toString('utf8', off + 30, off + 30 + nameLen)
    const start = off + 30 + nameLen + extraLen
    if (!compSize) throw new Error('zip entry without size (data descriptor) — unsupported')
    const data = buf.subarray(start, start + compSize)
    if (name.endsWith('.nc')) return method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data)
    off = start + compSize
  }
  throw new Error('no .nc entry in ADS zip')
}

async function adsRetrieve(dataset, inputs) {
  const token = process.env.ADS_API_KEY
  if (!token) throw new Error('ADS_API_KEY not configured')
  const H = { 'PRIVATE-TOKEN': token, 'content-type': 'application/json' }
  const sub = await fetch(`${ADS_BASE}/retrieve/v1/processes/${dataset}/execution`, {
    method: 'POST', headers: H, body: JSON.stringify({ inputs }),
  })
  if (!sub.ok) throw new Error(`ads submit ${sub.status}: ${(await sub.text()).slice(0, 160)}`)
  const job = await sub.json()
  const t0 = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, ADS_POLL_MS))
    const st = await (await fetch(`${ADS_BASE}/retrieve/v1/jobs/${job.jobID}`, { headers: H })).json()
    if (st.status === 'successful') break
    if (st.status === 'failed') throw new Error(`ads job failed: ${JSON.stringify(st).slice(0, 160)}`)
    if (Date.now() - t0 > ADS_TIMEOUT_MS) throw new Error('ads job timed out (will retry next run)')
  }
  const res = await (await fetch(`${ADS_BASE}/retrieve/v1/jobs/${job.jobID}/results`, { headers: H })).json()
  const href = res.asset?.value?.href
  if (!href) throw new Error('ads result without asset href')
  const dl = await fetch(href)
  if (!dl.ok) throw new Error(`ads download ${dl.status}`)
  return unzipFirstNc(Buffer.from(await dl.arrayBuffer()))
}

// Several species summed into one field (e.g. smoke = organic matter +
// black carbon AOD). Each variable is read from the same file.
async function readCamsFieldSum(ncBuf, varNames) {
  let acc = null
  for (const name of varNames) {
    const f = await readCamsField(ncBuf, name)
    if (!acc) acc = f
    else for (let i = 0; i < acc.values.length; i++) acc.values[i] += f.values[i]
  }
  return acc
}
async function readCamsFramesSum(ncBuf, varNames) {
  let acc = null
  for (const name of varNames) {
    const f = await readCamsFrames(ncBuf, name)
    if (!acc) acc = f
    else f.frames.forEach((fr, k) => { const a = acc.frames[k].values; for (let i = 0; i < a.length; i++) a[i] += fr.values[i] })
  }
  return acc
}

// Read one 2-D field (plus coords/times) from a CAMS NetCDF4 buffer.
async function readCamsField(ncBuf, varName) {
  const { default: h5wasm } = await import('h5wasm/node')
  await h5wasm.ready
  const path = join(tmpdir(), `cams-${process.pid}-${Date.now()}.nc`)
  writeFileSync(path, ncBuf)
  try {
    const f = new h5wasm.File(path, 'r')
    try {
      const lat = Array.from(f.get('latitude').value)
      const lon = Array.from(f.get('longitude').value)
      const v = f.get(varName)
      if (!v) throw new Error(`variable ${varName} missing (have: ${f.keys().join(',')})`)
      const raw = v.value
      const n = lat.length * lon.length
      if (raw.length !== n) throw new Error(`field length ${raw.length} ≠ ${n}`)
      const num = (x) => (typeof x === 'bigint' ? Number(x) : Number(x))
      const ref = num(f.get('forecast_reference_time')?.value?.[0]) * 1000
      const valid = num(f.get('valid_time')?.value?.[0]) * 1000
      return { lat, lon, values: Float32Array.from(raw), run_ms: ref || null, valid_ms: valid || ref || null }
    } finally { f.close() }
  } finally { try { unlinkSync(path) } catch { /* noop */ } }
}

// Latest CAMS run likely published, with the lead time nearest now.
function camsRunCandidates(latencyH = 10, leadStepH = 1) {
  const now = Date.now()
  const out = []
  for (let back = 0; back < 6; back++) {
    const t = new Date(now - back * 12 * 3.6e6)
    const hour = t.getUTCHours() >= 12 ? 12 : 0
    const run = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hour)
    const ageH = (now - run) / 3.6e6
    if (ageH < latencyH) continue // not published yet (observed: 12z run not yet served at +8 h; GHG runs lag ~a day)
    const lead = Math.min(120, Math.max(0, Math.round(ageH / leadStepH) * leadStepH))
    const day = new Date(run).toISOString().slice(0, 10)
    out.push({ run, day, time: `${String(hour).padStart(2, '0')}:00`, lead })
  }
  return out
}

/**
 * Bake one CAMS field to the standard grid pair.
 * cfg: { dataset, variable (ADS name), varName (NetCDF name), kind, source, scale, maxAbs }
 */
async function fetchCamsField(cfg) {
  let lastErr = null
  for (const cand of camsRunCandidates(cfg.latencyH ?? 10, cfg.leadStepH ?? 1)) {
    // Some CAMS products (greenhouse gases) run once daily at 00z — skip
    // the 12z candidates instead of burning a failed ADS job on each.
    if (cfg.runsPerDay === 1 && !String(cand.time).startsWith('00')) continue
    try {
      const inputs = {
        variable: cfg.variables || [cfg.variable],
        date: [`${cand.day}/${cand.day}`],
        time: [cand.time],
        leadtime_hour: [String(cand.lead)],
        type: ['forecast'],
        data_format: 'netcdf_zip',
        ...(cfg.extraInputs || {}),
      }
      // The greenhouse-gas dataset has no time-of-day or type dimension (one
      // 00z forecast run per day) and 400s on unknown keys.
      for (const k of cfg.omitInputs || []) delete inputs[k]
      const nc = await adsRetrieve(cfg.dataset, inputs)
      // Multi-variable configs sum their fields (smoke = OM + BC); single-
      // variable configs may list several candidate NetCDF names, since the
      // short name inside the file isn't always predictable from the ADS
      // variable id — first one present wins.
      let fld = null
      if (cfg.varNames) {
        fld = await readCamsFieldSum(nc, cfg.varNames)
      } else {
        let nameErr = null
        for (const name of cfg.varNameCandidates || [cfg.varName]) {
          try { fld = await readCamsField(nc, name); break } catch (e) { nameErr = e }
        }
        if (!fld) throw nameErr
      }
      if (cfg.convert) for (let i = 0; i < fld.values.length; i++) fld.values[i] = cfg.convert(fld.values[i])
      // The greenhouse-gas product ships at 0.1° — a 13 MB Int16 grid. Stride
      // it down to match the 0.4° composition grids (~800 KB) at bake.
      if (cfg.stride > 1) {
        const S = cfg.stride
        const nLat = Math.ceil(fld.lat.length / S), nLon = Math.ceil(fld.lon.length / S)
        const values = new Float32Array(nLat * nLon)
        for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) values[j * nLon + i] = fld.values[j * S * fld.lon.length + i * S]
        fld.values = values
        fld.lat = Array.from({ length: nLat }, (_, j) => fld.lat[j * S])
        fld.lon = Array.from({ length: nLon }, (_, i) => fld.lon[i * S])
      }
      const meta = buildMeta(cfg.kind, cfg.source, fld.lat, fld.lon, cfg.scale,
        fld.run_ms || cand.run, fld.valid_ms || cand.run + cand.lead * 3.6e6)
      return { meta, gridBuffer: encodePlanes([fld.values], cfg.scale, cfg.maxAbs, 0.02) }
    } catch (err) {
      lastErr = err
      if (/timed out|ADS_API_KEY/.test(String(err))) throw err
      // else try the previous run
    }
  }
  throw lastErr || new Error('no CAMS run available')
}

// ─── CAMS history tape ───────────────────────────────────────────────────────
// A rolling archive of short-lead CAMS fields (leads 0/3/6/9 h from each
// 00z/12z run → one frame every 3 h) so the client can replay the last
// week/month of dust & smoke actually moving. Lead 0 is the CAMS analysis
// (nudged to MODIS/VIIRS/PMAp satellite AOD); leads ≤9 h stay close to it.
// Frames are 8-bit grayscale PNGs (value = byte / qscale; 255 = saturated),
// ~60–120 KB each vs 800 KB for the Int16 pair, so a month streams lazily.
// Index: <blobBase>-tape.json { version, kind, grid…, qscale, frames:[{valid_ms, run_ms, lead_h, path}] }

const crc32Table = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crc32Table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
/** 8-bit grayscale PNG from a Uint8Array (row-major). */
function encodeGrayPng(bytes, width, height) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const raw = Buffer.alloc((width + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0 // filter: none
    raw.set(bytes.subarray(y * width, (y + 1) * width), y * (width + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// Read every (reference_time × lead) plane of one variable from a CAMS file.
async function readCamsFrames(ncBuf, varName) {
  const { default: h5wasm } = await import('h5wasm/node')
  await h5wasm.ready
  const path = join(tmpdir(), `cams-${process.pid}-${Date.now()}.nc`)
  writeFileSync(path, ncBuf)
  try {
    const f = new h5wasm.File(path, 'r')
    try {
      const lat = Array.from(f.get('latitude').value)
      const lon = Array.from(f.get('longitude').value)
      const v = f.get(varName)
      if (!v) throw new Error(`variable ${varName} missing (have: ${f.keys().join(',')})`)
      const num = (x) => (typeof x === 'bigint' ? Number(x) : Number(x))
      const refs = Array.from(f.get('forecast_reference_time').value, num)
      const periodDs = f.get('forecast_period')
      const leads = periodDs ? Array.from(periodDs.value, num) : [0]
      const n = lat.length * lon.length
      const raw = v.value
      const planes = refs.length * leads.length
      if (raw.length !== n * planes) throw new Error(`field length ${raw.length} ≠ ${planes}×${n} (shape ${JSON.stringify(v.shape)})`)
      // Plane order follows the variable's OWN shape: ADS multi-run files are
      // [forecast_period, forecast_reference_time, lat, lon] (lead-major),
      // not run-major — assuming run-major interleaved 12-hour-apart frames
      // and the replay ran forward/back (2026-08-21). Resolve via the shape
      // and double-check against the file's valid_time table.
      const shape = Array.from(v.shape || [])
      const leadMajor = shape.length === 4 ? shape[0] === leads.length && shape[1] === refs.length && !(leads.length === refs.length)
        : false
      if (shape.length === 4 && leads.length === refs.length) throw new Error('ambiguous plane order (leads == runs); request a different count')
      const vtDs = f.get('valid_time')
      const vt = vtDs ? Array.from(vtDs.value, num) : null // shape [ref, lead]
      const out = []
      for (let r = 0; r < refs.length; r++) {
        for (let l = 0; l < leads.length; l++) {
          const p = leadMajor ? l * refs.length + r : r * leads.length + l
          const valid = vt && vt.length === planes ? vt[r * leads.length + l] * 1000 : refs[r] * 1000 + leads[l] * 3.6e6
          if (Math.abs(valid - (refs[r] * 1000 + leads[l] * 3.6e6)) > 1) throw new Error('valid_time table disagrees with run+lead')
          out.push({
            run_ms: refs[r] * 1000,
            lead_h: leads[l],
            valid_ms: valid,
            values: Float32Array.from(raw.subarray(p * n, (p + 1) * n)),
          })
        }
      }
      return { lat, lon, frames: out }
    } finally { f.close() }
  } finally { try { unlinkSync(path) } catch { /* noop */ } }
}

const TAPE_LEADS = ['0', '3', '6', '9']
const TAPE_DAYS = 31
const H = 3.6e6

/**
 * Generic tape bake: one UTC day of frames for a tape config, merged into the
 * rolling index. tape = { kind, source, qscale, offset, nodata0, stepH,
 * frameKind, expectedTimes(day, now) → valid_ms[], fetchDay(day, times) →
 * { lat, lon, frames:[{run_ms, valid_ms, lead_h, values}] } }.
 * Byte = clamp(round((value − offset) × qscale), nodata0 ? 1 : 0, 255);
 * 0 = no data when nodata0 (ocean-only layers), else a real value.
 * Returns { jsons:[{path, json}], binaries:[{path, buffer, contentType}] }.
 */
async function bakeTapeDay(tape, { day, existing, blobBase }) {
  const now = Date.now()
  if (!day) day = new Date(now - (tape.latencyH ?? 3) * H).toISOString().slice(0, 10)
  const wanted = tape.expectedTimes(day, now)
  if (!wanted.length) throw new Error(`no published frames yet for ${day}`)
  const have = new Set((existing?.frames || []).map((f) => f.valid_ms))
  if (wanted.every((v) => have.has(v))) return { unchanged: true, day }

  const { lat, lon, frames } = await tape.fetchDay(day, wanted)
  if (!frames.length) throw new Error(`no frames returned for ${day}`)
  const latM = axisMeta(lat)
  const lonM = axisMeta(lon)
  const { qscale, offset = 0, nodata0 = false } = tape
  const lo = nodata0 ? 1 : 0
  const binaries = []
  const newFrames = []
  for (const fr of frames) {
    if (fr.values.length !== latM.n * lonM.n) throw new Error('frame/axis mismatch')
    const bytes = new Uint8Array(fr.values.length)
    let bad = 0
    for (let i = 0; i < bytes.length; i++) {
      const v = fr.values[i]
      if (!Number.isFinite(v) || Math.abs(v) >= (tape.maxAbs ?? 1e9)) { bytes[i] = 0; bad++; continue }
      bytes[i] = Math.max(lo, Math.min(255, Math.round((v - offset) * qscale)))
    }
    if (bad > bytes.length * (tape.maxMissingFrac ?? 0.02)) throw new Error(`frame ${new Date(fr.valid_ms).toISOString()} too many missing (${bad})`)
    const stamp = new Date(fr.valid_ms).toISOString().slice(0, 13).replace('T', '-')
    const path = `${blobBase}-tape/${stamp}.png`
    binaries.push({ path, buffer: encodeGrayPng(bytes, lonM.n, latM.n), contentType: 'image/png' })
    newFrames.push({ valid_ms: fr.valid_ms, run_ms: fr.run_ms, lead_h: fr.lead_h, path, ...(fr.smoothed ? { smoothed: true } : {}) })
  }
  // Merge: one frame per valid time, prefer the shorter lead (closer to analysis).
  const byValid = new Map()
  for (const f of [...(existing?.frames || []), ...newFrames]) {
    const prev = byValid.get(f.valid_ms)
    if (!prev || f.lead_h <= prev.lead_h) byValid.set(f.valid_ms, f) // re-bakes (e.g. smoothing) replace
  }
  const cutoff = now - (tape.days ?? TAPE_DAYS) * 8.64e7
  const merged = [...byValid.values()].filter((f) => f.valid_ms >= cutoff).sort((a, b) => a.valid_ms - b.valid_ms)
  const index = {
    version: 1, kind: `${tape.kind}-tape`, source: tape.source, fetched_ms: now,
    nLat: latM.n, nLon: lonM.n, lat0: latM.origin, dLat: latM.step, lon0: lonM.origin, dLon: lonM.step,
    qscale, offset, nodata0, step_ms: tape.stepH * H, days: tape.days ?? TAPE_DAYS, frame_kind: tape.frameKind || null,
    frames: merged,
  }
  return { day, jsons: [{ path: `${blobBase}-tape.json`, json: index }], binaries, added: newFrames.length }
}

const dayMs = (day, h) => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`)
const every3h = (day) => [0, 3, 6, 9, 12, 15, 18, 21].map((h) => dayMs(day, h))

// CAMS: leads 0/3/6/9 of the 00z and 12z runs (published ≥10 h after the run),
// with the twice-daily analysis correction SMOOTHED across each run
// (incremental-update style, Josh's call 2026-08-21): every run is also
// fetched at +12 h — the same moment as the next run's analysis — and the
// difference (next analysis − this run's +12 h forecast) is added to the run's
// +3/+6/+9 frames at ¼/½/¾ weight. Lead-0 frames are untouched analyses;
// smoothed frames are flagged so the UI can say so. Each bake re-emits the
// previous day's frames (their successors are now known) — the index merge
// lets a re-bake replace frames at the same valid time.
const CAMS_FETCH_LEADS = ['0', '3', '6', '9', '12']
function camsTape(cfg) {
  const runsOf = (day, now) => [0, 12].filter((h) => now - dayMs(day, h) >= 10 * H)
  return {
    kind: cfg.kind, source: cfg.source, qscale: cfg.qscale, offset: 0, nodata0: false, stepH: 3, latencyH: 10,
    frameKind: 'analysis',
    expectedTimes: (day, now) => runsOf(day, now).flatMap((h) => TAPE_LEADS.map((l) => dayMs(day, h) + Number(l) * H)),
    async fetchDay(day, wanted, now = Date.now()) {
      const prevDay = new Date(dayMs(day, 0) - 8.64e7).toISOString().slice(0, 10)
      const jobs = []
      for (const d of [prevDay, day]) {
        const hours = runsOf(d, now)
        if (!hours.length) continue
        jobs.push(adsRetrieve(cfg.dataset, {
          variable: cfg.variables || [cfg.variable], date: [`${d}/${d}`], time: hours.map((h) => `${String(h).padStart(2, '0')}:00`),
          leadtime_hour: CAMS_FETCH_LEADS, type: ['forecast'], data_format: 'netcdf_zip',
        }).then((nc) => readCamsFramesSum(nc, cfg.varNames || [cfg.varName])).then((p) => {
          if (cfg.convert) for (const f of p.frames) for (let i = 0; i < f.values.length; i++) f.values[i] = cfg.convert(f.values[i])
          return p
        }))
      }
      const parts = await Promise.all(jobs)
      const { lat, lon } = parts[0]
      const all = parts.flatMap((p) => p.frames)
      // Group by run; apply the increment where the next run's analysis exists.
      const byRun = new Map()
      for (const f of all) { if (!byRun.has(f.run_ms)) byRun.set(f.run_ms, new Map()); byRun.get(f.run_ms).set(f.lead_h, f) }
      const out = []
      for (const [run, leads] of byRun) {
        const next = byRun.get(run + 12 * H)?.get(0)
        const f12 = leads.get(12)
        const inc = next && f12 ? next.values.map((v, i) => v - f12.values[i]) : null
        for (const l of [0, 3, 6, 9]) {
          const f = leads.get(l)
          if (!f) continue
          if (inc && l > 0) {
            const w = l / 12
            const values = new Float32Array(f.values.length)
            for (let i = 0; i < values.length; i++) values[i] = f.values[i] + w * inc[i]
            out.push({ ...f, values, smoothed: true })
          } else out.push(f)
        }
      }
      out.sort((a, b) => a.valid_ms - b.valid_ms)
      return { lat, lon, frames: out }
    },
  }
}

// GHG tape: the greenhouse-gas product runs once daily at 00z with 3-hourly
// leads — one ADS job per day yields 8 frames of near-surface gas, which for
// methane animates the nocturnal boundary layer breathing in and out. Frames
// are strided like the grid bake so a 0.1° day stays ~1-2 MB.
function ghgTape(cfg, { qscale, offset, days = 14 }) {
  const leads = ['0', '3', '6', '9', '12', '15', '18', '21']
  return {
    kind: cfg.kind, source: cfg.source, qscale, offset, nodata0: false, stepH: 3, latencyH: 30, days,
    frameKind: 'forecast',
    expectedTimes: (day, now) => (now - dayMs(day, 0) >= 30 * H ? leads.map((l) => dayMs(day, 0) + Number(l) * H) : []),
    async fetchDay(day) {
      const inputs = {
        variable: [cfg.variable], date: [`${day}/${day}`], time: ['00:00'],
        leadtime_hour: leads, type: ['forecast'], data_format: 'netcdf_zip',
        ...(cfg.extraInputs || {}),
      }
      for (const k of cfg.omitInputs || []) delete inputs[k]
      const nc = await adsRetrieve(cfg.dataset, inputs)
      let { lat, lon, frames } = await readCamsFramesSum(nc, [cfg.varName])
      if (cfg.convert) for (const fr of frames) { const v = fr.values; for (let i = 0; i < v.length; i++) v[i] = cfg.convert(v[i]) }
      const S = cfg.stride || 1
      if (S > 1) {
        const nLat = Math.ceil(lat.length / S)
        const nLon = Math.ceil(lon.length / S)
        for (const fr of frames) {
          const out = new Float32Array(nLat * nLon)
          for (let j = 0; j < nLat; j++) for (let i = 0; i < nLon; i++) out[j * nLon + i] = fr.values[j * S * lon.length + i * S]
          fr.values = out
        }
        lat = Array.from({ length: nLat }, (_, j) => lat[j * S])
        lon = Array.from({ length: nLon }, (_, i) => lon[i * S])
      }
      return { lat, lon, frames }
    },
  }
}

// GFS (Unidata THREDDS Best series): 3-hourly analyses/short leads, ~1 week back.
function gfsTape({ kind, source, varName, vertCoord, qscale, offset, convert, stepH = 3 }) {
  const everyStep = (day) => Array.from({ length: 24 / stepH }, (_, k) => dayMs(day, k * stepH))
  return {
    kind, source, qscale, offset, nodata0: false, stepH, latencyH: 5, frameKind: 'analysis',
    expectedTimes: (day, now) => everyStep(day).filter((t) => now - t >= 5 * H),
    async fetchDay(day, wanted) {
      const t0 = new Date(wanted[0]).toISOString().slice(0, 19) + 'Z'
      const t1 = new Date(wanted[wanted.length - 1]).toISOString().slice(0, 19) + 'Z'
      const url = 'https://thredds.ucar.edu/thredds/ncss/grid/grib/NCEP/GFS/Global_0p25deg/Best' +
        `?var=${varName}${vertCoord != null ? `&vertCoord=${vertCoord}` : ''}&time_start=${t0}&time_end=${t1}&horizStride=2&accept=netcdf3`
      const nc = await fetchNetcdf(url)
      const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
      const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
      // The time axis is whatever the data variable's first dimension is
      // named — THREDDS emits `time`, `time1`, … depending on the request.
      const dataVar = nc.variables.find((x) => x.name === varName)
      if (!dataVar) throw new Error(`gfs variable ${varName} missing`)
      const timeName = nc.dimensions[dataVar.dimensions[0]].name
      const refName = timeName.replace(/^time/, 'reftime')
      const tUnits = unitsOf(nc, timeName)
      const times = Array.from(nc.getDataVariable(timeName), (t) => timeFromUnits(tUnits, t))
      const refs = nc.variables.some((x) => x.name === refName)
        ? Array.from(nc.getDataVariable(refName), (t) => timeFromUnits(unitsOf(nc, refName), t)) : times
      const all = nc.getDataVariable(varName)
      const n = lat.length * lon.length
      if (all.length !== n * times.length) throw new Error(`gfs planes ${all.length} ≠ ${times.length}×${n}`)
      const frames = []
      times.forEach((valid, k) => {
        if (!wanted.includes(valid)) return
        const values = Float32Array.from(all.subarray ? all.subarray(k * n, (k + 1) * n) : all.slice(k * n, (k + 1) * n))
        if (convert) for (let i = 0; i < n; i++) values[i] = convert(values[i])
        frames.push({ run_ms: refs[k], valid_ms: valid, lead_h: Math.round((valid - refs[k]) / H), values })
      })
      return { lat, lon, frames }
    },
  }
}

// Coral Reef Watch (CoastWatch ERDDAP): one daily field, stamped 12:00Z.
function crwTape({ kind, source, varName, qscale, offset, maxAbs, fillIters, maxMissingFrac = 0.45 }) {
  return {
    kind, source, qscale, offset, nodata0: true, stepH: 24, latencyH: 30, maxAbs, maxMissingFrac,
    frameKind: 'daily satellite analysis',
    expectedTimes: (day, now) => (now - dayMs(day, 12) >= 30 * H ? [dayMs(day, 12)] : []),
    async fetchDay(day) {
      const url = `https://coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW.nc?${varName}%5B(${day}T12:00:00Z)%5D%5B0:5:3599%5D%5B0:5:7199%5D`
      const nc = await fetchNetcdf(url)
      const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
      const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
      const v = nc.getDataVariable(varName)
      const valid = timeFromUnits(unitsOf(nc, 'time'), nc.getDataVariable('time')?.[0])
      if (Math.abs(valid - dayMs(day, 12)) > 12 * H) throw new Error(`crw served ${new Date(valid).toISOString()} for ${day}`)
      const values = fillCoastalGaps(v, lat.length, lon.length, maxAbs, fillIters ?? 1)
      return { lat, lon, frames: [{ run_ms: valid, valid_ms: valid, lead_h: 0, values }] }
    },
  }
}

// Year-long, weekly variant of a daily tape: one frame every 7 days (the
// Thursday 12:00Z field — Thursdays so the newest frame is never more than a
// week old when the Friday cron runs), 371-day rolling window. Shows the
// seasonal march that a 31-day daily loop can't (SST changes ~0.4 °C in two
// weeks; the warm pool moves thousands of km over a year).
function weeklyOf(dailyTape) {
  const isThursday = (day) => Math.floor(dayMs(day, 12) / 8.64e7) % 7 === 0 // 1970-01-01 was a Thursday
  return {
    ...dailyTape,
    stepH: 24 * 7, days: 371, frameKind: `${dailyTape.frameKind}, weekly`,
    expectedTimes: (day, now) => (isThursday(day) ? dailyTape.expectedTimes(day, now) : []),
  }
}

// WaveWatch III (PacIOOS ERDDAP): hourly series back to 2017; keep 3-hourly.
function ww3Tape({ kind, source, varName, qscale, offset, maxAbs }) {
  return {
    kind, source, qscale, offset, nodata0: true, stepH: 3, latencyH: 6, maxAbs, maxMissingFrac: 0.5,
    frameKind: 'model hindcast',
    expectedTimes: (day, now) => every3h(day).filter((t) => now - t >= 6 * H),
    async fetchDay(day, wanted) {
      const t0 = new Date(wanted[0]).toISOString().slice(0, 19) + 'Z'
      const t1 = new Date(wanted[wanted.length - 1]).toISOString().slice(0, 19) + 'Z'
      const url = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_global.nc' +
        `?${varName}%5B(${t0}):3:(${t1})%5D%5B0:1:0%5D%5B0:1:310%5D%5B0:1:719%5D`
      const nc = await fetchNetcdf(url)
      const lat = nc.getDataVariable(coordVar(nc, ['latitude', 'lat']))
      const lon = nc.getDataVariable(coordVar(nc, ['longitude', 'lon']))
      const tUnits = unitsOf(nc, 'time')
      const times = Array.from(nc.getDataVariable('time'), (t) => timeFromUnits(tUnits, t))
      const all = nc.getDataVariable(varName)
      const n = lat.length * lon.length
      if (all.length !== n * times.length) throw new Error(`ww3 planes ${all.length} ≠ ${times.length}×${n}`)
      const frames = []
      times.forEach((valid, k) => {
        if (!wanted.includes(valid)) return
        const raw = all.subarray ? all.subarray(k * n, (k + 1) * n) : all.slice(k * n, (k + 1) * n)
        const values = fillCoastalGaps(Float32Array.from(raw), lat.length, lon.length, maxAbs)
        frames.push({ run_ms: valid, valid_ms: valid, lead_h: 0, values })
      })
      return { lat, lon, frames }
    },
  }
}

const AEROSOL_CFG = {
  dataset: 'cams-global-atmospheric-composition-forecasts',
  variable: 'total_aerosol_optical_depth_550nm',
  varName: 'aod550',
  kind: 'cams-aod550',
  source: 'Copernicus CAMS global atmospheric composition forecast — total aerosol optical depth at 550 nm (ECMWF)',
  scale: 1000,
  maxAbs: 30,
  qscale: 50, // tape byte = AOD × 50 → 0…5.1, 0.02 steps
}

const SMOKE_CFG = {
  dataset: 'cams-global-atmospheric-composition-forecasts',
  variables: ['organic_matter_aerosol_optical_depth_550nm', 'black_carbon_aerosol_optical_depth_550nm'],
  varNames: ['omaod550', 'bcaod550'],
  kind: 'cams-smoke-aod550',
  source: 'Copernicus CAMS global atmospheric composition forecast — organic matter + black carbon aerosol optical depth at 550 nm (the biomass-burning aerosols; ECMWF)',
  scale: 1000, maxAbs: 30, qscale: 50,
}
const DUST_CFG = {
  dataset: 'cams-global-atmospheric-composition-forecasts',
  variable: 'dust_aerosol_optical_depth_550nm',
  varName: 'duaod550',
  kind: 'cams-dust-aod550',
  source: 'Copernicus CAMS global atmospheric composition forecast — mineral dust aerosol optical depth at 550 nm (ECMWF)',
  scale: 1000, maxAbs: 30, qscale: 50,
}
// ─── CAMS composition gases + particulates ───────────────────────────────────
// Same forecast product as the AOD fields above, different variables. Units
// are converted at bake so clients never see kg/m² or kg/kg:
//   CO   total column  kg/m²  → g/m²   (background ~15–25, big fire plumes 60+)
//   PM2.5 surface      kg/m³  → µg/m³  (the AQI particulate; WHO 24h guideline 15)
//   CH₄  total column  kg/m²  → g/m²   (~9.5 everywhere; wetlands/leaks nudge it up)
const CO_CFG = {
  dataset: 'cams-global-atmospheric-composition-forecasts',
  variable: 'total_column_carbon_monoxide',
  varName: 'tcco',
  varNameCandidates: ['tcco', 'total_column_carbon_monoxide'],
  kind: 'cams-co-column',
  source: 'Copernicus CAMS global atmospheric composition forecast — total column carbon monoxide (ECMWF)',
  convert: (v) => Math.min(v * 1000, 12), // typical column ~0.6–1 g/m², big plumes 2–7
  scale: 2000, maxAbs: 16, qscale: 32, // tape byte = g/m² × 32 → 0.03 steps, saturates at 7.97
}
const PM25_CFG = {
  dataset: 'cams-global-atmospheric-composition-forecasts',
  variable: 'particulate_matter_2.5um',
  varName: 'pm2p5',
  varNameCandidates: ['pm2p5', 'particulate_matter_2.5um'],
  kind: 'cams-pm25',
  source: 'Copernicus CAMS global atmospheric composition forecast — surface fine particulate matter (PM2.5, ECMWF)',
  convert: (v) => Math.min(v * 1e9, 1590), // clamp under maxAbs so fire cores saturate, never go missing
  scale: 20, maxAbs: 1600, qscale: 0.4, // tape byte = µg/m³ × 0.4 → saturates at 637
}
// Methane is NOT the column product: total-column CH₄ tracks surface pressure
// (mountains read as holes), burying the ±2% real signal under topography.
// Near-surface mixing ratio (ppb) shows wetlands, livestock belts and leaky
// gas fields honestly.
const CH4_CFG = {
  dataset: 'cams-global-greenhouse-gas-forecasts',
  variable: 'methane',
  varName: 'ch4',
  varNameCandidates: ['ch4', 'methane'],
  kind: 'cams-ch4-surface',
  source: 'Copernicus CAMS global greenhouse gas forecast — near-surface methane mixing ratio (model level 137, ECMWF)',
  extraInputs: { model_level: ['137'] },
  omitInputs: ['time', 'type'],
  runsPerDay: 1,
  latencyH: 26, leadStepH: 3, // GHG runs publish ~a day behind; 3-hourly leads
  convert: (v) => Math.min(v * (28.9647 / 16.0425) * 1e9, 3190), // kg/kg → ppb, clamped under maxAbs
  stride: 2, // 0.1° → 0.2° (~20 km): methane keeps more of the native detail (3.2 MB grid)
  scale: 10, maxAbs: 3200,
}
// CO₂ comes from CAMS's separate greenhouse-gas forecast (daily 00z run), at
// the lowest model level (137, ~10 m up) so the map shows the breathing
// biosphere and city/fire plumes rather than a flat well-mixed column.
const CO2_CFG = {
  dataset: 'cams-global-greenhouse-gas-forecasts',
  variable: 'carbon_dioxide',
  varName: 'co2',
  varNameCandidates: ['co2', 'carbon_dioxide', 'xco2'],
  kind: 'cams-co2-surface',
  source: 'Copernicus CAMS global greenhouse gas forecast — near-surface CO₂ mixing ratio (model level 137, ECMWF)',
  extraInputs: { model_level: ['137'] },
  omitInputs: ['time', 'type'],
  runsPerDay: 1,
  latencyH: 26, leadStepH: 3, // GHG runs publish ~a day behind; 3-hourly leads
  convert: (v) => Math.min(v * (28.9647 / 44.0095) * 1e6, 790), // kg/kg → ppm, clamped under maxAbs
  stride: 4, // 0.1° → 0.4°, matching the composition grids
  scale: 40, maxAbs: 800,
}
// ─── Carbon Mapper methane plumes ────────────────────────────────────────────
// Observational companion to the modeled methane layer: individual CH₄
// plumes imaged at ~30–60 m by Carbon Mapper's Tanager satellites and
// aircraft campaigns, with quantified emission rates. Their catalog API is
// public and unauthenticated. Snapshots, not a survey: coverage is targeted
// revisits of known source regions — an empty area means unsurveyed, never
// clean. Rows: [lat, lng, kg_per_hr, uncertainty, t_ms, platform, plume_id,
// sector] — sector is Carbon Mapper's IPCC attribution code (1B2 oil & gas,
// 6A landfill, 1B1a coal mine, …), translated to words client-side.
const CM_PLUMES_URL = 'https://api.carbonmapper.org/api/v1/catalog/plumes/annotated'
const CM_WINDOW_DAYS = 365
const CM_MAX_PLUMES = 9000

async function fetchMethanePlumes() {
  const since = new Date(Date.now() - CM_WINDOW_DAYS * 8.64e7).toISOString().slice(0, 19) + 'Z'
  const rows = []
  for (let offset = 0; offset < 30000; offset += 1000) {
    const u = `${CM_PLUMES_URL}?plume_gas=CH4&limit=1000&offset=${offset}&datetime=${encodeURIComponent(`${since}/..`)}`
    const r = await fetch(u, { headers: { accept: 'application/json' } })
    if (!r.ok) throw new Error(`carbonmapper ${r.status}`)
    const j = await r.json()
    for (const it of j.items || []) {
      const c = it.geometry_json?.coordinates
      if (!c || it.emission_auto == null) continue
      rows.push([
        Math.round(c[1] * 1e4) / 1e4, Math.round(c[0] * 1e4) / 1e4,
        Math.round(it.emission_auto), Math.round(it.emission_uncertainty_auto || 0),
        Date.parse(it.scene_timestamp), it.platform || it.instrument || '', it.plume_id,
        it.sector || '',
      ])
    }
    if (!j.items || j.items.length < 1000) break
  }
  rows.sort((a, b) => b[4] - a[4])
  const plumes = rows.slice(0, CM_MAX_PLUMES)
  return {
    json: {
      version: 1, kind: 'methane-plumes', fetched_ms: Date.now(),
      window_days: CM_WINDOW_DAYS, count: plumes.length, total_matched: rows.length,
      source: 'Carbon Mapper public catalog — individual CH₄ plumes with quantified emission rates (Tanager satellites + aircraft; ~30–60 m)',
      plumes,
    },
  }
}

async function fetchSmoke() { return fetchCamsField(SMOKE_CFG) }
async function fetchDust() { return fetchCamsField(DUST_CFG) }
async function fetchCo() { return fetchCamsField(CO_CFG) }
async function fetchPm25() { return fetchCamsField(PM25_CFG) }
async function fetchCh4() { return fetchCamsField(CH4_CFG) }
async function fetchCo2() { return fetchCamsField(CO2_CFG) }

async function fetchAerosol() {
  return fetchCamsField(AEROSOL_CFG)
}

// ─── History tapes (replay) — see bakeTapeDay ───────────────────────────────
export const SYSTEMS_TAPES = {
  aerosol: { blobBase: 'systems/cams-aod', tape: camsTape(AEROSOL_CFG) },
  smoke: { blobBase: 'systems/cams-smoke', tape: camsTape(SMOKE_CFG) },
  dust: { blobBase: 'systems/cams-dust', tape: camsTape(DUST_CFG) },
  co: { blobBase: 'systems/cams-co', tape: camsTape(CO_CFG) },
  pm25: { blobBase: 'systems/cams-pm25', tape: camsTape(PM25_CFG) },
  // byte = (ppb - 1800) × 0.17 → 6 ppb steps, saturating at 3300
  methane: { blobBase: 'systems/cams-ch4', tape: ghgTape(CH4_CFG, { qscale: 0.17, offset: 1800 }) },
  airtemp: {
    blobBase: 'systems/gfs-airtemp',
    tape: gfsTape({
      kind: 'gfs-airtemp-2m', source: 'NOAA NCEP GFS (2 m air temperature) via Unidata THREDDS NCSS',
      varName: 'Temperature_height_above_ground', vertCoord: 2, // 3-hourly: Unidata's Best series has no hourly steps (checked 2026-08-21)
      qscale: 2, offset: -70, convert: (k) => k - 273.15, // byte = (°C + 70) × 2 → −70…+57.5 °C, 0.5° steps
    }),
  },
  sst: {
    blobBase: 'systems/crw-sst',
    tape: crwTape({
      kind: 'crw-sst', source: 'NOAA Coral Reef Watch CoralTemp daily 5 km sea-surface temperature via CoastWatch ERDDAP',
      varName: 'CRW_SST', qscale: 5, offset: -3, maxAbs: 60, // byte = (°C + 3) × 5 → −2.8…+47.8 °C, 0.2° steps
    }),
  },
  sstanom: {
    blobBase: 'systems/crw-sst-anomaly',
    tape: crwTape({
      kind: 'crw-sst-anomaly', source: 'NOAA Coral Reef Watch daily sea-surface temperature anomaly vs. long-term average, via CoastWatch ERDDAP',
      varName: 'CRW_SSTANOMALY', qscale: 20, offset: -6.3, maxAbs: 30, // byte = (Δ + 6.3) × 20 → −6.25…+6.45 °C, 0.05° steps (extremes clip)
      maxMissingFrac: 0.6, // the anomaly product also masks sea ice; observed ≈45 % missing in August
    }),
  },
  'sst-year': { blobBase: 'systems/crw-sst-year', tape: null }, // filled below (weekly variant)
  'sstanom-year': { blobBase: 'systems/crw-sst-anomaly-year', tape: null },
  waves: {
    blobBase: 'systems/ww3-waves',
    tape: ww3Tape({
      kind: 'ww3-waves-hs', source: 'WaveWatch III global significant wave height (NOAA NCEP model) via PacIOOS ERDDAP',
      varName: 'Thgt', qscale: 12.7, offset: -1 / 12.7, maxAbs: 40, // byte = m × 12.7 + 1 → byte 1 = 0.00 m … 255 = 20 m, 0.08 m steps
    }),
  },
}
SYSTEMS_TAPES['hrrr-smoke'] = { blobBase: 'systems/hrrr-smoke', tape: hrrrSmokeTape() }
SYSTEMS_TAPES['sst-year'].tape = weeklyOf(SYSTEMS_TAPES.sst.tape)
SYSTEMS_TAPES['sstanom-year'].tape = weeklyOf(SYSTEMS_TAPES.sstanom.tape)

export const bakeTape = (name, opts) => {
  const e = SYSTEMS_TAPES[name]
  if (!e) throw new Error(`no tape "${name}"`)
  return bakeTapeDay(e.tape, { ...opts, blobBase: e.blobBase })
}

/**
 * Registry: id → { blobBase, fetchGrid }. Grid datasets publish the
 * `${blobBase}-meta.json` / `-grid.bin` pair; a fetch that returns `{ json }`
 * publishes a single `${blobBase}.json` instead.
 */
export const SYSTEMS_DATASETS = {
  currents: { blobBase: 'systems/hycom-currents', fetchGrid: fetchCurrents },
  sst: { blobBase: 'systems/crw-sst', fetchGrid: fetchSst },
  waves: { blobBase: 'systems/ww3-waves', fetchGrid: fetchWaves },
  airtemp: { blobBase: 'systems/gfs-airtemp', fetchGrid: fetchAirTemp },
  sstanom: { blobBase: 'systems/crw-sstanom', fetchGrid: fetchSstAnom },
  hotspots: { blobBase: 'systems/firms-hotspots', fetchGrid: fetchHotspots },
  'fire-daily': { blobBase: 'systems/fire-daily', fetchGrid: fetchFireDaily },
  'hrrr-smoke': { blobBase: 'systems/hrrr-smoke', fetchGrid: fetchHrrrSmoke },
  aerosol: { blobBase: 'systems/cams-aod', fetchGrid: fetchAerosol },
  smoke: { blobBase: 'systems/cams-smoke', fetchGrid: fetchSmoke },
  dust: { blobBase: 'systems/cams-dust', fetchGrid: fetchDust },
  co: { blobBase: 'systems/cams-co', fetchGrid: fetchCo },
  pm25: { blobBase: 'systems/cams-pm25', fetchGrid: fetchPm25 },
  methane: { blobBase: 'systems/cams-ch4', fetchGrid: fetchCh4 },
  'methane-plumes': { blobBase: 'systems/methane-plumes', fetchGrid: fetchMethanePlumes },
  co2: { blobBase: 'systems/cams-co2', fetchGrid: fetchCo2 },
}

// Test hook for scripts (shape probes); not used by the app.
export const _camsDebug = { adsRetrieve }
