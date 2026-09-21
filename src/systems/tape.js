/**
 * History tapes for /systems — replay a scalar field over the last days/weeks.
 *
 * A tape is an index JSON (`<dataset>-tape.json`, baked by
 * api/_systems-datasets.js bakeTape / SYSTEMS_TAPES) plus one 8-bit grayscale
 * PNG per frame (value = byte / qscale + offset; when `nodata0`, byte 0 means
 * NO DATA — ocean-only layers). Frames are fetched lazily and decoded to
 * byte grids; sampling cross-fades between the two frames bracketing the
 * requested time so the field glides instead of stepping. `step_ms` is the
 * frame cadence (3 h for CAMS/GFS/WW3, 24 h for Coral Reef Watch) and
 * `frame_kind` the bake's own wording for what a frame is.
 *
 * The regular "latest" bake (the forecast valid now) is appended as a final
 * LIVE frame so a replay always lands on the present — and the live frame's
 * stamp says "forecast", the archive frames say "analysis/short-lead".
 *
 * Honesty rules: every frame keeps its own run/valid/lead metadata and
 * `metaAt()` hands the popup the stamp for the frame actually on screen.
 */

import { SOURCE_BASES } from './windField.js'
import { isLand } from './landMask.js'
import { computeFlow, flowAt } from './tapeFlow.js'

// ── PNG → bytes without a canvas ────────────────────────────────────────────
// Frames used to decode through createImageBitmap → OffscreenCanvas →
// getImageData: three GPU/canvas-backed objects per frame that only the
// garbage collector ever released. An hourly tape is hundreds of frames, and
// that — not the JS heap — is what pegged memory. Tape frames are plain 8-bit
// gray or RGB PNGs, so we inflate the IDAT stream ourselves
// (DecompressionStream) and undo the row filters: exact bytes, no canvas, no
// color management, nothing left for the GC to chase.
async function decodePngPlanes(buf) {
  const d = new Uint8Array(buf)
  const dv = new DataView(buf)
  if (dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG')
  let w = 0, h = 0, channels = 0
  const idat = []
  for (let o = 8; o < d.length;) {
    const len = dv.getUint32(o)
    const type = String.fromCharCode(d[o + 4], d[o + 5], d[o + 6], d[o + 7])
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8); h = dv.getUint32(o + 12)
      const depth = d[o + 16], color = d[o + 17], interlace = d[o + 20]
      channels = color === 0 ? 1 : color === 2 ? 3 : 0
      if (depth !== 8 || !channels || interlace) throw new Error('unsupported PNG layout')
    } else if (type === 'IDAT') idat.push(d.subarray(o + 8, o + 8 + len))
    else if (type === 'IEND') break
    o += 12 + len
  }
  const stream = new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))
  const raw = new Uint8Array(await new Response(stream).arrayBuffer())
  const n = w * channels
  if (raw.length !== (n + 1) * h) throw new Error('PNG size mismatch')
  const planes = Array.from({ length: channels }, () => new Uint8Array(w * h))
  let prev = new Uint8Array(n)
  let cur = new Uint8Array(n)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (n + 1)]
    const row = raw.subarray(y * (n + 1) + 1, (y + 1) * (n + 1))
    for (let i = 0; i < n; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev[i]
      const c = i >= channels ? prev[i - channels] : 0
      let pred = 0
      if (f === 1) pred = a
      else if (f === 2) pred = b
      else if (f === 3) pred = (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      cur[i] = (row[i] + pred) & 255
    }
    if (channels === 1) planes[0].set(cur, y * w)
    else for (let x = 0; x < w; x++) for (let k = 0; k < channels; k++) planes[k][y * w + x] = cur[x * channels + k]
    const t = prev; prev = cur; cur = t
  }
  return { w, h, planes }
}

// Fallback for browsers without DecompressionStream: the old canvas route,
// with the bitmap released as soon as its pixels are read.
async function decodeViaCanvas(blob, w, h) {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(bmp, 0, 0)
  bmp.close?.()
  const px = ctx.getImageData(0, 0, w, h).data
  const planes = [0, 1, 2].map((k) => { const out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + k]; return out })
  c.width = 0; c.height = 0
  return { w, h, planes }
}

export class TapeField {
  constructor(index, base) {
    this.index = index
    this.meta = {
      version: 1, kind: index.kind, source: index.source,
      nLat: index.nLat, nLon: index.nLon, lat0: index.lat0, dLat: index.dLat, lon0: index.lon0, dLon: index.dLon,
      scale: index.qscale, missing: -1,
      offset: index.offset || 0, nodata0: !!index.nodata0,
      step_ms: index.step_ms || 3 * 3.6e6, frame_kind: index.frame_kind || null,
    }
    this.step_ms = this.meta.step_ms
    this.daily = this.step_ms >= 23 * 3.6e6
    this.frames = index.frames.map((f) => ({ ...f, url: `${base}/${f.path.replace(/^systems\//, '')}`, live: false }))
    // Companion bands packed into the same frames as G and B (bird flight
    // u/v) — see bakeTapeDay `extraBands`. Decoded alongside the main plane.
    this.extraBands = index.extra_bands || null
    this._extra = new Map()     // frame idx → [Uint8Array, Uint8Array]
    this._bytes = new Map()     // frame idx → Uint8Array
    this._pending = new Map()   // frame idx → Promise
    this._images = new Map()    // `${idx}|${lutKey}` → canvas
    this._flows = new Map()     // frame idx i → optical flow i→i+1 (computed lazily)
    this.t = this.frames.length ? this.frames[this.frames.length - 1].valid_ms : 0
    // Motion-warping between frames is only physical at sub-daily cadence
    // (haze, waves, air temperature advect in hours). Daily/weekly ocean
    // fields get a plain blend — SST doesn't "flow" from one day to the next.
    this.useFlow = (index.step_ms || 3 * 3.6e6) <= 6 * 3.6e6
  }

  /** Load a tape index (Blob first, dev-data fallback). */
  static async load(dataset, expectKind) {
    let lastErr = null
    for (const base of SOURCE_BASES) {
      try {
        const r = await fetch(`${base}/${dataset}-tape.json`)
        if (!r.ok) throw new Error(`tape ${r.status}`)
        const index = await r.json()
        if (index?.version !== 1 || (expectKind && index.kind !== `${expectKind}-tape`)) throw new Error('unexpected tape')
        if (!index.frames?.length) throw new Error('empty tape')
        return new TapeField(index, base)
      } catch (err) { lastErr = err }
    }
    throw lastErr || new Error('no tape source reachable')
  }

  /**
   * Append the latest forecast grid (a GridField on the same lat/lon grid)
   * as the LIVE frame. Skipped if the grid geometry differs or it isn't
   * newer than the last archive frame.
   */
  appendLive(grid) {
    const m = grid.meta
    const last = this.frames[this.frames.length - 1]
    if (m.nLat !== this.meta.nLat || m.nLon !== this.meta.nLon || m.lat0 !== this.meta.lat0 || m.lon0 !== this.meta.lon0) return
    if (m.valid_ms <= last.valid_ms) return
    const n = m.nLat * m.nLon
    const bytes = new Uint8Array(n)
    const { scale: q, offset, nodata0 } = this.meta
    const lo = nodata0 ? 1 : 0
    for (let i = 0; i < n; i++) {
      const raw = grid._view.getInt16(i * 2, true)
      bytes[i] = raw === m.missing ? 0 : Math.max(lo, Math.min(255, Math.round((raw / m.scale - offset) * q)))
    }
    const idx = this.frames.length
    this.frames.push({ valid_ms: m.valid_ms, run_ms: m.run_ms, lead_h: Math.round((m.valid_ms - m.run_ms) / 3.6e6), live: true, url: null })
    this._bytes.set(idx, bytes)
    this.t = m.valid_ms
  }

  get start_ms() { return this.frames[0].valid_ms }
  get end_ms() { return this.frames[this.frames.length - 1].valid_ms }

  /** Index of the frame at/just before t, plus the mix toward the next. */
  locate(t = this.t) {
    const fr = this.frames
    if (t <= fr[0].valid_ms) return { i: 0, j: 0, mix: 0 }
    if (t >= fr[fr.length - 1].valid_ms) return { i: fr.length - 1, j: fr.length - 1, mix: 0 }
    let lo = 0, hi = fr.length - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fr[mid].valid_ms <= t) lo = mid; else hi = mid }
    const span = fr[hi].valid_ms - fr[lo].valid_ms
    // Gaps longer than 2 steps (missing bakes) snap rather than smear.
    const mix = span > 2 * this.step_ms ? (t - fr[lo].valid_ms > span / 2 ? 1 : 0) : (t - fr[lo].valid_ms) / span
    return { i: lo, j: hi, mix }
  }

  setTime(t) { this.t = Math.max(this.start_ms, Math.min(this.end_ms, t)) }

  hasFrame(i) { return this._bytes.has(i) }

  /** Ensure frame i is decoded; resolves to its bytes. */
  ensureFrame(i) {
    if (this._bytes.has(i)) return Promise.resolve(this._bytes.get(i))
    if (this._pending.has(i)) return this._pending.get(i)
    const f = this.frames[i]
    const { nLon: w, nLat: h } = this.meta
    const p = fetch(f.url)
      .then((r) => { if (!r.ok) throw new Error(`frame ${r.status}`); return r.arrayBuffer() })
      .then((buf) => (typeof DecompressionStream !== 'undefined'
        ? decodePngPlanes(buf).catch(() => decodeViaCanvas(new Blob([buf], { type: 'image/png' }), w, h))
        : decodeViaCanvas(new Blob([buf], { type: 'image/png' }), w, h)))
      .then((img) => {
        if (img.w !== w || img.h !== h) throw new Error('frame size mismatch')
        const bytes = img.planes[0]
        if (this.extraBands && img.planes.length >= 3) this._extra.set(i, [img.planes[1], img.planes[2]])
        this._bytes.set(i, bytes)
        this._pending.delete(i)
        return bytes
      })
      .catch((err) => { this._pending.delete(i); throw err })
    this._pending.set(i, p)
    return p
  }

  /** Are the frames needed to draw time t decoded? */
  ready(t = this.t) {
    const { i, j } = this.locate(t)
    if (!this._bytes.has(i) || !this._bytes.has(j)) return false
    // A pair must also have its motion estimate before it starts playing —
    // switching from plain blend to warp mid-step reads as a skip.
    return !this.useFlow || i === j || this._flows.has(i)
  }

  /** Resolves once the frames that draw time t are decoded (motion, when
   * used, is solved synchronously at draw time). Lets a painter that ran
   * too early repaint exactly when it can. */
  whenReady(t = this.t) {
    const { i, j } = this.locate(t)
    return Promise.all([this.ensureFrame(i), this.ensureFrame(j)]).then(() => undefined)
  }

  /** Kick off decoding for t and the next `ahead` frames. */
  prefetch(t = this.t, ahead = 3) {
    const { i } = this.locate(t)
    const last = Math.min(this.frames.length - 1, i + ahead + 1)
    for (let k = i; k <= last; k++) this.ensureFrame(k).catch(() => {})
    // Motion between upcoming pairs, solved on idle time BEFORE playback
    // reaches them (≈30 ms each warm — too long for a transition hitch).
    if (!this.useFlow) return
    for (let k = i; k < last; k++) {
      if (this._flows.has(k) || this._flowQueued?.has(k)) continue
      this._flowQueued = this._flowQueued || new Set()
      this._flowQueued.add(k)
      Promise.all([this.ensureFrame(k), this.ensureFrame(k + 1)])
        // Off the decode microtask, but promptly (≈30 ms each): playback
        // waits on the current pair's flow, so don't leave it to idle time.
        .then(() => new Promise((res) => setTimeout(res, 0)))
        .then(() => { this.flowBetween(k, k + 1) })
        .catch(() => {})
        .finally(() => this._flowQueued.delete(k))
    }
  }

  /** Optical flow from frame i to i+1 (both must be decoded); cached. */
  flowBetween(i, j) {
    if (j !== i + 1) return null
    const hit = this._flows.get(i)
    if (hit !== undefined) return hit
    // Run changes: when the bake has smoothed the analysis correction across
    // the previous run (frame.smoothed), the step is ordinary evolution and
    // warps fine. Unsmoothed run changes (a tape's newest run, before its
    // successor exists) blend plainly — warping the correction lurches.
    const fa = this.frames[i], fb = this.frames[j]
    if (fa && fb && fa.run_ms !== fb.run_ms && !fb.live && !fa.smoothed) { this._flows.set(i, null); return null }
    const a = this._bytes.get(i), b = this._bytes.get(j)
    if (!a || !b) return null
    const f = computeFlow(a, b, this.meta.nLon, this.meta.nLat)
    this._flows.set(i, f)
    if (this._flows.size > 256) this._flows.delete(this._flows.keys().next().value) // ~200 KB each; a 31-day 3-hourly tape fits
    return f
  }

  // GridField-compatible sampler at the current time: each bracketing frame
  // is sampled along the motion between them (same warp the GPU draws), then
  // blended in time — so popups/facts agree with the pixels on screen.
  sampleScalar(lng, lat) {
    const m = this.meta
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !(Math.abs(lat) <= 90)) return null
    const rf0 = (lat - m.lat0) / m.dLat
    if (rf0 < -0.5 || rf0 > m.nLat - 0.5) return null
    const rf = Math.min(m.nLat - 1, Math.max(0, rf0))
    let cf = ((((lng - m.lon0) % 360) + 360) % 360) / m.dLon
    // Regional grids must not wrap (see GridField._locate).
    if (m.nLon * m.dLon < 359 && cf > m.nLon - 0.5) {
      cf -= 360 / m.dLon
      if (cf < -0.5) return null
      cf = Math.max(0, cf)
    }
    const { i, j, mix } = this.locate()
    const a = this._bytes.get(i)
    const b = this._bytes.get(j)
    if (!a) return null
    const toValue = (byte) => (byte == null ? null : byte / m.scale + m.offset)
    if (!b || mix === 0 || i === j) return this._wrap(toValue(this._bilinear(a, rf, cf)))
    const flow = this.useFlow ? this.flowBetween(i, j) : null
    let dx = 0, dy = 0
    if (flow) { const d = flowAt(flow, cf, rf); dx = d.dx; dy = d.dy }
    const clampR = (r) => Math.min(m.nLat - 1, Math.max(0, r))
    let va = this._bilinear(a, clampR(rf - dy * mix), cf - dx * mix)
    let vb = this._bilinear(b, clampR(rf + dy * (1 - mix)), cf + dx * (1 - mix))
    if (va == null) va = this._bilinear(a, rf, cf) // warped onto no-data → unwarped
    if (vb == null) vb = this._bilinear(b, rf, cf)
    if (va == null && vb == null) return null
    if (va == null) return this._wrap(toValue(vb))
    if (vb == null) return this._wrap(toValue(va))
    return this._wrap(toValue(va * (1 - mix) + vb * mix))
  }

  _wrap(value) { return value == null ? null : { value } }

  /**
   * Edge feather plane (one byte per grid cell, 0 = at/outside the data's
   * edge … 255 = FEATHER_CELLS or more cells inside). The mask of a regional
   * tape is the same in every frame, so this is built once, from the first
   * decoded frame: a two-pass chamfer distance to the nearest missing cell
   * (the grid box's own border counts as missing), eased with a smoothstep.
   * Display only — it shapes alpha, never values. Null until a frame is in.
   */
  coverPlane() {
    if (this._cover) return this._cover
    const bytes = this._bytes.values().next().value
    const m = this.meta
    if (!bytes || !m.nodata0) return null
    const W = m.nLon, H = m.nLat, FEATHER_CELLS = 4
    const d = new Float32Array(W * H)
    const at = (r, c) => (r < 0 || c < 0 || r >= H || c >= W ? 0 : d[r * W + c])
    for (let k = 0; k < d.length; k++) d[k] = bytes[k] ? 1e3 : 0
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      if (!d[r * W + c]) continue
      d[r * W + c] = Math.min(d[r * W + c], at(r, c - 1) + 1, at(r - 1, c) + 1, at(r - 1, c - 1) + 1.414, at(r - 1, c + 1) + 1.414)
    }
    for (let r = H - 1; r >= 0; r--) for (let c = W - 1; c >= 0; c--) {
      if (!d[r * W + c]) continue
      d[r * W + c] = Math.min(d[r * W + c], at(r, c + 1) + 1, at(r + 1, c) + 1, at(r + 1, c + 1) + 1.414, at(r + 1, c - 1) + 1.414)
    }
    const out = new Uint8Array(W * H)
    for (let k = 0; k < d.length; k++) {
      const x = Math.min(1, Math.max(0, (d[k] - 1) / FEATHER_CELLS)) // the outermost valid cell is already 0
      out[k] = Math.round(255 * x * x * (3 - 2 * x))
    }
    this._cover = out
    return out
  }

  /** Feather (0–1) at a point: bilinear over coverPlane; 1 when there is no mask. */
  coverAt(lng, lat) {
    const plane = this.coverPlane()
    if (!plane) return 1
    const m = this.meta
    const rf = (lat - m.lat0) / m.dLat
    let cf = ((((lng - m.lon0) % 360) + 360) % 360) / m.dLon
    if (m.nLon * m.dLon < 359 && cf > m.nLon - 0.5) cf -= 360 / m.dLon
    if (rf < 0 || rf > m.nLat - 1 || cf < 0 || cf > m.nLon - 1) return 0
    const r0 = Math.min(m.nLat - 2, Math.floor(rf)), c0 = Math.min(m.nLon - 2, Math.floor(cf))
    const fr = rf - r0, fc = cf - c0, o = r0 * m.nLon + c0
    return ((plane[o] * (1 - fc) + plane[o + 1] * fc) * (1 - fr) + (plane[o + m.nLon] * (1 - fc) + plane[o + m.nLon + 1] * fc) * fr) / 255
  }


  // Bilinear in BYTE units. When `nodata0`, byte 0 corners are missing and
  // the remaining weights are renormalised (same spirit as GridField's
  // _bilinear); null if nothing valid is nearby.
  _bilinear(bytes, rf, cf) {
    const m = this.meta
    const r0 = Math.min(m.nLat - 2, Math.max(0, Math.floor(rf)))
    const c0 = ((Math.floor(cf) % m.nLon) + m.nLon) % m.nLon
    const c1 = (c0 + 1) % m.nLon
    const fr = Math.min(1, Math.max(0, rf - r0))
    const fc = cf - Math.floor(cf)
    const o0 = r0 * m.nLon, o1 = o0 + m.nLon
    if (!m.nodata0) {
      return (bytes[o0 + c0] * (1 - fc) + bytes[o0 + c1] * fc) * (1 - fr) + (bytes[o1 + c0] * (1 - fc) + bytes[o1 + c1] * fc) * fr
    }
    const vals = [bytes[o0 + c0], bytes[o0 + c1], bytes[o1 + c0], bytes[o1 + c1]]
    const wts = [(1 - fc) * (1 - fr), fc * (1 - fr), (1 - fc) * fr, fc * fr]
    let sum = 0, wsum = 0
    for (let k = 0; k < 4; k++) {
      if (vals[k] === 0) continue
      sum += vals[k] * wts[k]; wsum += wts[k]
    }
    if (wsum < 0.05) return null
    return sum / wsum
  }

  /** Provenance stamp for the frame(s) on screen. */
  metaAt(t = this.t) {
    const { i, j, mix } = this.locate(t)
    const f = mix < 0.5 ? this.frames[i] : this.frames[j]
    return { ...this.meta, run_ms: f.run_ms, valid_ms: f.valid_ms, lead_h: f.lead_h, live: f.live, smoothed: !!f.smoothed, tape: true }
  }

  /**
   * Mercator image (size×size, lat ±85.05) of one frame through a LUT —
   * cached per frame. Direct byte-grid rasterization (~20 ms at 1024²), not
   * the generic per-pixel sampler, so playback can bake frames ahead.
   */
  frameImage(i, lut, lutKey, min, max, bits, size) {
    const key = `${i}|${lutKey}|${size}|${bits ? 1 : 0}`
    const hit = this._images.get(key)
    if (hit) return hit
    const bytes = this._bytes.get(i)
    if (!bytes) return null
    const m = this.meta
    const c = document.createElement('canvas')
    c.width = size; c.height = size
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(size, size)
    const d = img.data
    const lutScale = (255 / (max - min)) / m.scale // byte → lut index factor
    const minByte = (min - m.offset) * m.scale     // lut origin in byte units
    const nodata0 = m.nodata0
    // Column tables (same for every row).
    const c0s = new Int32Array(size), c1s = new Int32Array(size), fcs = new Float32Array(size), lngs = new Float32Array(size)
    const cOk = new Uint8Array(size)
    const regional = m.nLon * m.dLon < 359
    for (let x = 0; x < size; x++) {
      const lng = -180 + (360 * (x + 0.5)) / size
      let cf = ((((lng - m.lon0) % 360) + 360) % 360) / m.dLon
      // Regional grids must not wrap (see GridField._locate).
      if (regional && cf > m.nLon - 0.5) {
        cf -= 360 / m.dLon
        if (cf < -0.5) { cOk[x] = 0; continue }
        cf = Math.max(0, cf)
      }
      cOk[x] = 1
      const c0 = Math.floor(cf) % m.nLon
      c0s[x] = c0; c1s[x] = (c0 + 1) % m.nLon; fcs[x] = cf - Math.floor(cf); lngs[x] = lng
    }
    for (let y = 0; y < size; y++) {
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / size))) * 180) / Math.PI
      const rf0 = (lat - m.lat0) / m.dLat
      if (rf0 < -0.5 || rf0 > m.nLat - 0.5) continue
      const rf = Math.min(m.nLat - 1, Math.max(0, rf0))
      const r0 = Math.min(m.nLat - 2, Math.max(0, Math.floor(rf)))
      const fr = Math.min(1, Math.max(0, rf - r0))
      const o0 = r0 * m.nLon, o1 = o0 + m.nLon
      for (let x = 0; x < size; x++) {
        if (!cOk[x]) continue
        if (bits && isLand(bits, lngs[x], lat)) continue
        const fc = fcs[x]
        const b00 = bytes[o0 + c0s[x]], b01 = bytes[o0 + c1s[x]], b10 = bytes[o1 + c0s[x]], b11 = bytes[o1 + c1s[x]]
        let v
        if (!nodata0) {
          v = (b00 * (1 - fc) + b01 * fc) * (1 - fr) + (b10 * (1 - fc) + b11 * fc) * fr
        } else {
          // Skip missing corners, renormalise the rest; nothing near → transparent.
          let sum = 0, wsum = 0
          if (b00) { sum += b00 * (1 - fc) * (1 - fr); wsum += (1 - fc) * (1 - fr) }
          if (b01) { sum += b01 * fc * (1 - fr); wsum += fc * (1 - fr) }
          if (b10) { sum += b10 * (1 - fc) * fr; wsum += (1 - fc) * fr }
          if (b11) { sum += b11 * fc * fr; wsum += fc * fr }
          if (wsum < 0.05) continue
          v = sum / wsum
        }
        let li = Math.round((v - minByte) * lutScale)
        if (li < 0) li = 0; else if (li > 255) li = 255
        li *= 4
        const o = (y * size + x) * 4
        d[o] = lut[li]; d[o + 1] = lut[li + 1]; d[o + 2] = lut[li + 2]; d[o + 3] = lut[li + 3]
      }
    }
    ctx.putImageData(img, 0, 0)
    this._images.set(key, c)
    // Bound the cache: ~4 MB per 1024² canvas.
    if (this._images.size > 24) this._images.delete(this._images.keys().next().value)
    return c
  }
}
