/**
 * Raw-detection overlay for /inmotion fires — the close-zoom rung of the fire
 * ladder. Past RAW_DETAIL_ZOOM the cluster glows and derived hulls hand off
 * to individual satellite detections driven by the transport bar's cursor.
 *
 * Three observation streams, one visual language (soft circles, one color,
 * opacity by the burn model):
 *   • VIIRS shards — the rolling ~2-day global files (10°×10°, 375 m pixels).
 *   • Per-fire histories — fire-hist-<id>.json, every VIIRS detection since
 *     the fire's discovery (advertised by hist:true on the events feed).
 *     History rows supersede duplicate shard rows.
 *   • GOES (NOAA HMS, US only) — sub-hourly geostationary detections that
 *     fill the hours between VIIRS overpasses with REAL observations
 *     (~2 km pixels, drawn larger and fainter).
 *
 * The burn model per stream: a detection appears at its acquisition, stays
 * lit until a later pass re-observes its ground (gentle handoff — the area
 * never flickers), and otherwise burns out slowly after one expected
 * revisit. Ramps ADAPT to each stream's real cadence (median gap between
 * successive same-spot observations): GOES dissolves in minutes-scale,
 * VIIRS in hours-scale, so the field breathes continuously instead of
 * stepping at satellite passes.
 */

import { CanvasFreezer } from './canvasFreeze.js'

export const RAW_DETAIL_ZOOM = 8.3

const MAX_DPR = 2
const SHARD_DEG = 10
const MAX_SHARDS_PER_VIEW = 8
const ALPHA_NEW = 0.92
// Burn scar: once a detection has burned out at the cursor, it leaves a
// dark residue instead of vanishing — the cumulative footprint is the
// fire's story (VIIRS pixels only; 2 km GOES pixels would smear it).
const SCAR_ALPHA = 0.28
// Wall-clock smoothing: an overpass delivers a whole flank in one timestamp,
// so ignitions sweep in along-track over SWEEP_MS instead of popping, and
// every dot's displayed opacity chases its target through a ~LERP_TAU
// low-pass — smooth appear AND disappear at any playback speed.
const SWEEP_MS = 600
const LERP_TAU_MS = 220
const HMS_MAX_AGE_MS = 5 * 60e3
const HMS_BASE = (import.meta.env.VITE_FIRE_API_BASE || '').trim()
  || (import.meta.env.DEV ? 'https://earthatlas.org' : '')

const clamp = (lo, v, hi) => Math.max(lo, Math.min(hi, v))

// Soft round detection sprite. The fade must go to the SAME color at zero
// alpha — fading to transparent black drags the gradient through dark muddy
// mid-tones and rings every circle with a black edge.
function makeSprite(r, g, b) {
  const S = 64
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  const grad = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(0.45, `rgba(${r},${g},${b},1)`)
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, S, S)
  return c
}

// Successor pass per detection: the nearest-in-time LATER detection within
// ~1.3 km (same fire ground), ignoring same-overpass neighbors. Times are
// ageMin (minutes before the source's fetch stamp — smaller = later).
function computeSuccessors(rows) {
  const CELL = 0.012
  const MIN_GAP_MIN = 45
  const grid = new Map()
  rows.forEach((row, i) => {
    if (row[3] == null) return
    const key = `${Math.round(row[0] / CELL)},${Math.round(row[1] / CELL)}`
    let arr = grid.get(key)
    if (!arr) grid.set(key, (arr = []))
    arr.push(i)
  })
  return rows.map((row, i) => {
    if (row[3] == null) return null
    const acqMin = row[3]
    const r0 = Math.round(row[0] / CELL)
    const c0 = Math.round(row[1] / CELL)
    let best = null
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const arr = grid.get(`${r0 + dr},${c0 + dc}`)
        if (!arr) continue
        for (const j of arr) {
          if (j === i) continue
          const aj = rows[j][3]
          if (aj == null) continue
          if (aj <= acqMin - MIN_GAP_MIN && (best == null || aj > best)) best = aj
        }
      }
    }
    return best
  })
}

/**
 * Prepare one observation stream for the burn model: successors, dedupe keys
 * (absolute-time 10-minute buckets, so streams can overlap), and dissolve
 * ramps adapted to the stream's REAL median revisit interval.
 */
function prepareSource(rows, { fetched_ms, satellites, sizeM, alphaScale = 1, px, orbital = true }) {
  const succ = computeSuccessors(rows)
  const gaps = []
  rows.forEach((r, i) => { if (succ[i] != null && r[3] != null) gaps.push(r[3] - succ[i]) })
  gaps.sort((a, b) => a - b)
  // Revisit cadence. Orbital streams (VIIRS): the gap between overpass
  // CLUSTERS, not between the satellites inside one — the three platforms
  // pass within ~an hour of each other, and the naive median lands in that
  // intra-cluster mode, making burn-out absurdly twitchy. Geostationary
  // (GOES) watches continuously, so its long gaps are REAL absence and its
  // plain (short) median is the honest cadence.
  const cross = orbital ? gaps.filter((g) => g > 180) : []
  const baseMin = cross.length >= 5 ? cross[Math.floor(cross.length / 2)]
    : gaps.length ? gaps[Math.floor(gaps.length / 2)] : 480
  const revH = Math.max(0.25, baseMin / 60)
  const ramps = {
    fadeIn: clamp(0.2, 0.25 * revH, 2),
    handoff: clamp(0.4, 0.35 * revH, 3),
    expect: clamp(0.75, 1.3 * revH, 9),
  }
  ramps.burnout = 1.5 * ramps.expect
  const keys = rows.map((r) => (r[3] == null ? null
    : `${r[0].toFixed(4)}|${r[1].toFixed(4)}|${Math.round((fetched_ms - r[3] * 60000) / 6e5)}`))
  // Within-pass sweep order: rows sharing an overpass (same satellite,
  // ~20-min bucket) share one timestamp but were SCANNED sequentially —
  // stagger their wall-clock ignition in along-track (latitude) order so a
  // pass blossoms across the fire instead of popping in as a block.
  const groups = new Map()
  rows.forEach((r, i) => {
    if (r[3] == null) return
    const key = `${r[4]}|${Math.round(r[3] / 20)}`
    let arr = groups.get(key)
    if (!arr) groups.set(key, (arr = []))
    arr.push(i)
  })
  const sweep = new Float32Array(rows.length)
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    idxs.sort((a, b) => rows[a][0] - rows[b][0])
    idxs.forEach((rowIdx, k) => { sweep[rowIdx] = (k / (idxs.length - 1)) * SWEEP_MS })
  }
  // Wall-clock animation state: displayed alpha (chases its target) and the
  // wall time each row first became visible at the current cursor.
  const disp = new Float32Array(rows.length)
  const born = new Float64Array(rows.length).fill(NaN)
  return { rows, succ, keys, ramps, sweep, disp, born, fetched_ms, satellites, sizeM, alphaScale, px }
}

export class FireRawDetectionsOverlay {
  /**
   * opts: {
   *   loadJson(name, kind) → Promise<json>   (the systems blob loader)
   *   onChange()                             (active-state / data arrived —
   *                                           lets the app swap glows off and
   *                                           refresh the transport window)
   * }
   */
  constructor(map, canvas, opts) {
    this.map = map
    this.canvas = canvas
    this.opts = opts
    this.visible = true
    this._destroyed = false
    this._ctx = canvas.getContext('2d')
    this._shardNames = null    // authoritative list from hotspot meta
    this._shards = new Map()   // name → prepared source | 'loading' | 'failed'
    this._histIndex = []       // [{irwin, lat, lng}] fires with a deep timeline
    this._hist = new Map()     // irwin → prepared source | 'loading' | 'failed'
    this._histKeys = new Set() // dedupe: hist rows supersede shard rows
    this._hms = null           // prepared GOES source | 'loading' | null
    this._hmsStamp = 0
    this._hmsBbox = null
    this._satellites = []
    this._t = null             // transport cursor (ms); null = Now
    this._drawn = []           // {x, y, r, d} for hit tests
    this._ember = makeSprite(240, 95, 50)
    this._scar = makeSprite(122, 54, 40) // burned-out residue: dark, desaturated
    this._animRaf = 0
    this._lastPaintMs = 0

    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true }
    this._onMove = () => { if (this.visible) this._paint() }
    this._onMoveEnd = () => { this._moving = false; this._ensureData(); this._paint() }
    this._onResize = () => this._paint()
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    this._ensureData()
    this._paint()
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) { this._clear(); this._drawn = [] } else { this._ensureData(); this._paint() }
  }

  /** Transport cursor: replay the burn model at time `t`; null = Now. */
  setTime(t) {
    if (t === this._t) return
    this._t = t
    this._paint()
  }

  setShardNames(names) {
    if (!Array.isArray(names)) return
    this._shardNames = new Set(names)
    this._ensureData()
    this._paint()
  }

  /** Fires with a since-discovery history file (from the events feed). */
  setHistIndex(fires) {
    if (!Array.isArray(fires)) return
    this._histIndex = fires
    this._ensureData()
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._animRaf)
    this.map.off('movestart', this._onMoveStart)
    this.map.off('move', this._onMove)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this._freeze.destroy()
    this._clear()
  }

  /**
   * True when this overlay is carrying the story for the current view: zoomed
   * past the handoff AND every shard under the viewport is either loaded or
   * known-empty. Histories and GOES enrich but never gate.
   */
  isActive() {
    if (!this.visible || this.map.getZoom() < RAW_DETAIL_ZOOM) return false
    const needed = this._neededShards()
    if (!needed) return false
    return needed.every((n) => {
      if (this._shardNames && !this._shardNames.has(n)) return true // no fire there
      const s = this._shards.get(n)
      return s && s !== 'loading' && s !== 'failed'
    })
  }

  /**
   * Acquisition-time span of everything loaded for this view — histories
   * push the start back to each fire's discovery, so the transport window
   * covers "first detection → now". Null until data arrives.
   */
  timeSpan() {
    let lo = Infinity
    let hi = -Infinity
    const eat = (src) => {
      if (!src || src === 'loading' || src === 'failed') return
      for (const row of src.rows) {
        if (row[3] == null) continue
        const acq = src.fetched_ms - row[3] * 60000
        if (acq < lo) lo = acq
        if (acq > hi) hi = acq
      }
    }
    const needed = this._neededShards()
    if (needed) for (const name of needed) eat(this._shards.get(name))
    for (const f of this._inViewHist()) eat(this._hist.get(f.irwin))
    eat(this._hms)
    return lo < hi ? { start_ms: lo, end_ms: hi } : null
  }

  /** Detection at a screen point — only among the currently shown circles. */
  hitTest(x, y, maxPx = 12) {
    let best = null
    let bestD = maxPx * maxPx
    for (const p of this._drawn) {
      const dist = (p.x - x) ** 2 + (p.y - y) ** 2
      if (dist < Math.max(bestD, p.r * p.r)) { bestD = dist; best = p.d }
    }
    return best
  }

  // Shards under the current viewport (null while the map has no bounds yet).
  _neededShards() {
    if (this.map.getZoom() < RAW_DETAIL_ZOOM) return null
    let b
    try { b = this.map.getBounds() } catch { return null }
    if (!b) return null
    const names = []
    const s0 = Math.floor(b.getSouth() / SHARD_DEG) * SHARD_DEG
    const n0 = Math.floor(b.getNorth() / SHARD_DEG) * SHARD_DEG
    const w = b.getWest()
    const e = b.getEast()
    for (let lat = s0; lat <= n0; lat += SHARD_DEG) {
      for (let lng = Math.floor(w / SHARD_DEG) * SHARD_DEG; lng <= e; lng += SHARD_DEG) {
        const norm = ((lng + 180) % 360 + 360) % 360 - 180
        const name = `firms-raw-${lat}_${norm}`
        if (!names.includes(name)) names.push(name)
        if (names.length >= MAX_SHARDS_PER_VIEW) return names
      }
    }
    return names
  }

  _inViewHist() {
    if (this.map.getZoom() < RAW_DETAIL_ZOOM) return []
    let b
    try { b = this.map.getBounds() } catch { return [] }
    if (!b) return []
    const pad = 0.5
    return this._histIndex.filter((f) =>
      f.lat > b.getSouth() - pad && f.lat < b.getNorth() + pad &&
      f.lng > b.getWest() - pad && f.lng < b.getEast() + pad)
  }

  _ensureData() {
    if (this._destroyed || !this.visible) return
    const needed = this._neededShards()
    if (!needed) return

    for (const name of needed) {
      if (this._shardNames && !this._shardNames.has(name)) continue // known-empty
      if (this._shards.has(name)) continue
      this._shards.set(name, 'loading')
      this.opts.loadJson(name, 'firms-raw')
        .then((j) => {
          if (this._destroyed) return
          this._shards.set(name, prepareSource(j.detections || [], {
            fetched_ms: j.fetched_ms, satellites: j.satellites || [], sizeM: 375, px: '375 m',
          }))
          this._satellites = j.satellites || this._satellites
          this._paint()
          this.opts.onChange?.()
        })
        .catch(() => {
          if (this._destroyed) return
          // Without the authoritative list a 404 is expected for empty
          // shards; with it, a listed shard failing is a real error — either
          // way the cluster glows stay on for this view.
          this._shards.set(name, this._shardNames
            ? 'failed'
            : prepareSource([], { fetched_ms: null, satellites: this._satellites, sizeM: 375, px: '375 m' }))
          this._paint()
          this.opts.onChange?.()
        })
    }

    // Per-fire deep histories for fires in (or near) the view.
    for (const f of this._inViewHist()) {
      if (this._hist.has(f.irwin)) continue
      this._hist.set(f.irwin, 'loading')
      const id = `fire-hist-${String(f.irwin).replace(/[^0-9a-f]/gi, '').toLowerCase()}`
      this.opts.loadJson(id, 'fire-hist')
        .then((j) => {
          if (this._destroyed) return
          const now = Date.now()
          const rows = (j.detections || []).map(([lat, lng, frp, tMin, sat]) => [
            lat, lng, frp, Math.max(0, Math.round((now - (j.t0_ms + tMin * 60000)) / 60000)), sat,
          ])
          const src = prepareSource(rows, {
            fetched_ms: now, satellites: j.satellites || [], sizeM: 375, px: '375 m',
          })
          this._hist.set(f.irwin, src)
          for (const k of src.keys) if (k) this._histKeys.add(k)
          this._paint()
          this.opts.onChange?.() // transport window may now reach discovery
        })
        .catch(() => { if (!this._destroyed) this._hist.set(f.irwin, 'failed') })
    }

    this._ensureHms()
  }

  // GOES via the NOAA HMS proxy — US only; elsewhere the bbox returns empty.
  // Refetched when the view leaves the last-fetched bbox or the data ages out.
  _ensureHms() {
    if (this.map.getZoom() < RAW_DETAIL_ZOOM) return
    let b
    try { b = this.map.getBounds() } catch { return }
    if (!b) return
    const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => Math.round(v * 20) / 20)
    const inside = this._hmsBbox
      && bbox[0] >= this._hmsBbox[0] && bbox[1] >= this._hmsBbox[1]
      && bbox[2] <= this._hmsBbox[2] && bbox[3] <= this._hmsBbox[3]
    if (this._hms === 'loading' || (inside && Date.now() - this._hmsStamp < HMS_MAX_AGE_MS)) return
    const pad = 0.3
    const q = [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad]
    this._hms = 'loading'
    fetch(`${HMS_BASE}/api/hms?bbox=${q.join(',')}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`hms ${r.status}`))))
      .then((fc) => {
        if (this._destroyed) return
        const now = Date.now()
        const sats = []
        const rows = []
        for (const f of fc.features || []) {
          const p = f.properties || {}
          if (!p.geo || !Number.isFinite(p.acq_ms)) continue // GOES only — VIIRS already covered
          const c = f.geometry?.coordinates
          if (!c) continue
          let si = sats.indexOf(p.sat)
          if (si < 0) { sats.push(p.sat); si = sats.length - 1 }
          rows.push([c[1], c[0], Number(p.frp) || 0, Math.max(0, Math.round((now - p.acq_ms) / 60000)), si])
        }
        this._hms = prepareSource(rows, {
          fetched_ms: now, satellites: sats, sizeM: 2000, alphaScale: 0.45, px: '~2 km', orbital: false,
        })
        this._hmsStamp = now
        this._hmsBbox = q
        this._paint()
        this.opts.onChange?.()
      })
      .catch(() => { if (!this._destroyed) { this._hms = null; this._hmsStamp = Date.now(); this._hmsBbox = null } })
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _paint() {
    if (this._destroyed) return
    const { map, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = this._ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this._drawn = []
    this._freeze.capture()
    if (!this.visible) return
    const zoom = map.getZoom()
    if (zoom < RAW_DETAIL_ZOOM) return

    const nowMs = Date.now()
    const cursor = this._t ?? nowMs
    const degPerPx = 360 / (512 * Math.pow(2, zoom))

    // Draw order: GOES underneath (context glow), then VIIRS shards, then
    // histories on top. Shard rows already present in a history are skipped.
    const sources = []
    if (this._hms && this._hms !== 'loading') sources.push({ src: this._hms, dedupe: false })
    const needed = this._neededShards() || []
    for (const name of needed) {
      const s = this._shards.get(name)
      if (s && s !== 'loading' && s !== 'failed') sources.push({ src: s, dedupe: true })
    }
    for (const f of this._inViewHist()) {
      const s = this._hist.get(f.irwin)
      if (s && s !== 'loading' && s !== 'failed') sources.push({ src: s, dedupe: false })
    }

    // Wall-clock smoothing state for this frame.
    const wallNow = performance.now()
    const dtMs = this._lastPaintMs ? Math.min(200, wallNow - this._lastPaintMs) : 16
    this._lastPaintMs = wallNow
    const hidden = document.hidden
    const k = 1 - Math.exp(-dtMs / LERP_TAU_MS)
    let animating = false

    // Per-row cursor-domain envelope; also reports ignited (has happened by
    // the cursor) for the scar pass.
    const envOf = (src, idx) => {
      const row = src.rows[idx]
      const ageMin = row[3]
      if (ageMin == null || !src.fetched_ms) return { env: 0.5, ignited: true }
      const acq = src.fetched_ms - ageMin * 60000
      const dtH = (cursor - acq) / 3.6e6
      if (dtH < 0) return { env: 0, ignited: false }
      const R = src.ramps
      const rise = Math.min(1, dtH / R.fadeIn)
      const succMin = src.succ[idx]
      let decay = 1
      if (succMin != null) {
        const afterH = (cursor - (src.fetched_ms - succMin * 60000)) / 3.6e6
        if (afterH > 0) decay = Math.max(0, 1 - afterH / R.handoff)
      } else {
        const overdueH = dtH - R.expect
        if (overdueH > 0) decay = Math.max(0, 1 - overdueH / R.burnout)
      }
      return { env: rise * decay, ignited: true }
    }
    const projectRow = (row) => {
      let pt
      try { pt = map.project([row[1], row[0]]) } catch { return null }
      if (!pt || !Number.isFinite(pt.x)) return null
      if (pt.x < -40 || pt.y < -40 || pt.x > w + 40 || pt.y > h + 40) return null
      return pt
    }
    const radiusOf = (src, lat) => {
      const mPerPx = degPerPx * 111320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180))
      return src.sizeM === 375
        ? Math.min(16, Math.max(3, 260 / mPerPx))
        : Math.min(30, Math.max(6, 1400 / mPerPx))
    }

    // Pass 1 — burn scars: every VIIRS detection that has happened by the
    // cursor leaves faint dark residue, so the cumulative footprint reads as
    // the fire's story and a quieted flank doesn't vanish into bare terrain.
    ctx.globalAlpha = SCAR_ALPHA
    for (const { src, dedupe } of sources) {
      if (src.sizeM !== 375) continue
      for (let idx = 0; idx < src.rows.length; idx++) {
        if (dedupe && src.keys[idx] && this._histKeys.has(src.keys[idx])) continue
        if (!envOf(src, idx).ignited) continue
        const row = src.rows[idx]
        const pt = projectRow(row)
        if (!pt) continue
        const r = radiusOf(src, row[0]) * 0.85
        ctx.drawImage(this._scar, pt.x - r, pt.y - r, r * 2, r * 2)
      }
    }

    // Pass 2 — active fire: displayed opacity chases the burn-model target
    // through a low-pass (smooth appear AND disappear at any playback
    // speed), with new ignitions swept in along-track instead of popping.
    for (const { src, dedupe } of sources) {
      for (let idx = 0; idx < src.rows.length; idx++) {
        if (dedupe && src.keys[idx] && this._histKeys.has(src.keys[idx])) continue
        const { env } = envOf(src, idx)
        let target = env > 0.02 ? ALPHA_NEW * env * src.alphaScale : 0
        if (target > 0 && !hidden) {
          // (hidden tabs skip the sweep — they get no follow-up frames)
          if (Number.isNaN(src.born[idx])) src.born[idx] = wallNow
          if (wallNow < src.born[idx] + src.sweep[idx]) { target = 0; animating = true }
        }
        let a = src.disp[idx]
        if (hidden) {
          a = target // frozen tabs render final state, no animation debt
        } else if (Math.abs(target - a) > 0.01) {
          a += (target - a) * k
          animating = true
        } else {
          a = target
        }
        src.disp[idx] = a
        if (env <= 0 && a <= 0.01) { src.born[idx] = NaN; src.disp[idx] = 0; continue }
        if (a <= 0.01) continue
        const row = src.rows[idx]
        const pt = projectRow(row)
        if (!pt) continue
        const r = radiusOf(src, row[0])
        ctx.globalAlpha = a
        ctx.drawImage(this._ember, pt.x - r, pt.y - r, r * 2, r * 2)
        const ageMin = row[3]
        this._drawn.push({
          x: pt.x,
          y: pt.y,
          r,
          d: {
            lat: row[0],
            lng: row[1],
            frp: row[2],
            ageH: ageMin == null || !src.fetched_ms ? null : (nowMs - (src.fetched_ms - ageMin * 60000)) / 3.6e6,
            sat: (src.satellites || this._satellites)[row[4]] || 'VIIRS',
            px: src.px,
          },
        })
      }
    }
    ctx.globalAlpha = 1

    // Keep animating until every dot settles (transport ticks also repaint,
    // but paused states — a fresh seek, a sweep mid-bloom — need their own
    // frames to finish dissolving).
    cancelAnimationFrame(this._animRaf)
    if (animating && !hidden && this.visible && !this._destroyed) {
      this._animRaf = requestAnimationFrame(() => this._paint())
    }
  }
}
