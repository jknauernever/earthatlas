/**
 * In-browser clip recorder for /inmotion — captures exactly what the user is
 * looking at (basemap + every overlay canvas) into a shareable video file.
 *
 * Pipeline: per output frame, composite the map's WebGL canvas and the 2D
 * overlay canvases into a fixed 1920×1080 canvas (center cover-crop of the
 * viewport), draw the burned-in branding (watermark + data-source line — the
 * inline-provenance rule applies to video too, and platforms strip metadata,
 * so the brand must live in the pixels), then hand the frame to an encoder:
 *
 *   - WebCodecs H.264 + mp4-muxer  → real .mp4 (Chrome, Edge, Safari 16.4+)
 *   - MediaRecorder fallback       → .mp4 or .webm, whatever the UA offers
 *
 * The recording ends with a ~2.4 s end card: wordmark, a QR code of the
 * sharer's exact view URL (the URL-state convention means location.href IS
 * the share), and full attribution.
 *
 * MapLibre hedge: everything vendor-specific is behind the basemap-source
 * seam below. A future MapLibre swap reimplements mapboxBasemapSource() —
 * same shape, zero changes elsewhere in this file or its callers.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'

export const CLIP_LENGTHS = [6, 15, 30] // seconds; default handled by the UI

const OUT_W = 1920
const OUT_H = 1080
const FPS = 30
// ~5 Mbps: platforms re-encode uploads to ~3.5–5 Mbps regardless, so higher
// bitrates buy nothing visible — but below this, particle trails and the
// burned-in text start to smear. Resolution stays 1080p (platforms serve at
// the uploaded resolution; a 720p source is locked soft forever).
const BITRATE = 5_000_000
const END_CARD_S = 2.4
const END_FADE_S = 0.5
const KEYFRAME_EVERY = FPS * 2

// ─── Basemap-source seam (the only vendor-specific code) ────────────────────
// canvas():       the basemap's WebGL canvas element.
// onFrame(cb):    call cb right after the basemap paints, while the drawing
//                 buffer is still readable (Mapbox clears it after compositing
//                 — reading outside 'render' returns blank without
//                 preserveDrawingBuffer). Returns an unsubscribe fn.
// requestFrame(): ask the basemap to paint soon even if idle.
export function mapboxBasemapSource(map) {
  return {
    canvas: () => map.getCanvas(),
    onFrame: (cb) => { map.on('render', cb); return () => map.off('render', cb) },
    requestFrame: () => map.triggerRepaint(),
  }
}

// What can this browser produce? → { engine, mime?, ext } | { engine: null }
export function clipSupport() {
  if (typeof window === 'undefined') return { engine: null }
  if ('VideoEncoder' in window && 'VideoFrame' in window) {
    return { engine: 'webcodecs', ext: 'mp4', mime: 'video/mp4' }
  }
  if (window.MediaRecorder) {
    for (const [mime, ext] of [
      ['video/mp4', 'mp4'],
      ['video/webm;codecs=vp9', 'webm'],
      ['video/webm', 'webm'],
    ]) {
      if (MediaRecorder.isTypeSupported(mime)) return { engine: 'mediarecorder', mime, ext }
    }
  }
  return { engine: null }
}

// H.264 level must cover 1080p30 (level 4.0); prefer High profile, walk down.
const AVC_LADDER = ['avc1.640028', 'avc1.4d4028', 'avc1.42e028']

async function pickAvcCodec() {
  for (const codec of AVC_LADDER) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec, width: OUT_W, height: OUT_H, bitrate: BITRATE, framerate: FPS,
      })
      if (supported) return codec
    } catch { /* try the next profile */ }
  }
  return null
}

export class ClipRecorder {
  /**
   * @param {object} opts
   *   basemap     — source from mapboxBasemapSource()
   *   overlays    — overlay canvas elements, bottom → top draw order
   *   getBrand    — () => { sourceLine, shareUrl, layerNames } read at start
   *   onProgress  — (elapsedSec, totalSec, phase 'record'|'finish') => void
   */
  constructor({ basemap, overlays, getBrand, onProgress }) {
    this._src = basemap
    this._overlays = overlays
    this._getBrand = getBrand
    this._onProgress = onProgress || (() => {})
    this._canvas = document.createElement('canvas')
    this._canvas.width = OUT_W
    this._canvas.height = OUT_H
    this._ctx = this._canvas.getContext('2d')
    this._state = 'idle'
  }

  get recording() { return this._state === 'recording' }

  /** Record for `seconds`, then append the end card. → { blob, ext, mime } */
  async start({ seconds }) {
    if (this._state !== 'idle') throw new Error('recorder busy')
    const support = clipSupport()
    if (!support.engine) throw new Error('This browser cannot record video')
    this._support = support
    this._brand = this._getBrand()
    this._qr = await makeQrCanvas(this._brand.shareUrl)
    this._liveFrames = Math.round(seconds * FPS)
    this._seconds = seconds
    this._frame = 0
    this._state = 'recording'

    if (support.engine === 'webcodecs') await this._initWebCodecs()
    else this._initMediaRecorder(support)

    return new Promise((resolve, reject) => {
      this._resolve = resolve
      this._reject = reject
      this._interval = 1000 / FPS
      this._next = performance.now()
      // Composite inside the basemap's paint callback (buffer readable there);
      // the rAF pump guarantees paints keep coming while the camera is idle.
      this._offFrame = this._src.onFrame(() => this._tick())
      const pump = () => {
        if (this._state !== 'recording') return
        this._src.requestFrame()
        this._raf = requestAnimationFrame(pump)
      }
      this._raf = requestAnimationFrame(pump)
    })
  }

  /** Finish early: keep what's recorded, still append the end card. */
  stop() {
    if (this._state === 'recording') this._liveFrames = this._frame
  }

  /** Abort entirely — no result, promise rejects. */
  cancel() {
    if (this._state !== 'recording') return
    this._teardownCapture()
    this._state = 'idle'
    try { this._encoder?.close() } catch { /* already closed */ }
    try { this._recorder?.stop() } catch { /* never started */ }
    this._reject?.(new Error('cancelled'))
  }

  _teardownCapture() {
    this._offFrame?.()
    this._offFrame = null
    cancelAnimationFrame(this._raf)
  }

  // ─── Per-frame capture ────────────────────────────────────────────────────
  _tick() {
    if (this._state !== 'recording') return
    const now = performance.now()
    if (now < this._next) return
    this._next = Math.max(this._next + this._interval, now - this._interval)
    // Encoder backpressure: drop this paint rather than queueing unboundedly.
    if (this._encoder && this._encoder.encodeQueueSize > 10) return

    this._composite()
    this._emitFrame()
    this._frame++
    this._onProgress(this._frame / FPS, this._seconds, 'record')
    if (this._frame >= this._liveFrames) this._finish()
  }

  _emitFrame() {
    if (this._support.engine === 'webcodecs') {
      const frame = new VideoFrame(this._canvas, {
        timestamp: Math.round(this._frame * 1e6 / FPS),
        duration: Math.round(1e6 / FPS),
      })
      this._encoder.encode(frame, { keyFrame: this._frame % KEYFRAME_EVERY === 0 })
      frame.close()
    } else {
      this._mrTrack.requestFrame()
    }
  }

  async _finish() {
    this._teardownCapture()
    this._state = 'finishing'
    this._onProgress(this._seconds, this._seconds, 'finish')
    try {
      // End card over the frozen last frame.
      const last = document.createElement('canvas')
      last.width = OUT_W; last.height = OUT_H
      last.getContext('2d').drawImage(this._canvas, 0, 0)
      const endFrames = Math.round(END_CARD_S * FPS)
      for (let j = 0; j < endFrames; j++) {
        this._drawEndCard(last, Math.min(1, (j / FPS) / END_FADE_S))
        if (this._support.engine === 'webcodecs') {
          this._emitFrame()
          this._frame++
        } else {
          // MediaRecorder stamps wall-clock time — pace the end card for real.
          this._mrTrack.requestFrame()
          await new Promise((r) => setTimeout(r, this._interval))
        }
      }

      let result
      if (this._support.engine === 'webcodecs') {
        await this._encoder.flush()
        this._encoder.close()
        this._muxer.finalize()
        result = { blob: new Blob([this._muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', mime: 'video/mp4' }
      } else {
        result = await new Promise((res) => {
          this._recorder.onstop = () => res({
            blob: new Blob(this._mrChunks, { type: this._support.mime.split(';')[0] }),
            ext: this._support.ext,
            mime: this._support.mime.split(';')[0],
          })
          this._recorder.stop()
        })
      }
      this._state = 'idle'
      this._resolve(result)
    } catch (err) {
      this._state = 'idle'
      this._reject(err)
    }
  }

  // ─── Encoders ─────────────────────────────────────────────────────────────
  async _initWebCodecs() {
    const codec = await pickAvcCodec()
    if (!codec) {
      // H.264 unavailable (rare) — fall back to MediaRecorder if it exists.
      const support = clipSupport()
      if (window.MediaRecorder) {
        this._support = { engine: 'mediarecorder', ...(support.engine === 'mediarecorder' ? support : { mime: 'video/webm', ext: 'webm' }) }
        this._initMediaRecorder(this._support)
        return
      }
      this._state = 'idle'
      throw new Error('No H.264 encoder available')
    }
    this._muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: OUT_W, height: OUT_H },
      fastStart: 'in-memory',
    })
    this._encoder = new VideoEncoder({
      output: (chunk, meta) => this._muxer.addVideoChunk(chunk, meta),
      error: (err) => { this._teardownCapture(); this._state = 'idle'; this._reject?.(err) },
    })
    this._encoder.configure({ codec, width: OUT_W, height: OUT_H, bitrate: BITRATE, framerate: FPS })
  }

  _initMediaRecorder(support) {
    const stream = this._canvas.captureStream(0) // frames pushed via requestFrame()
    this._mrTrack = stream.getVideoTracks()[0]
    this._mrChunks = []
    this._recorder = new MediaRecorder(stream, { mimeType: support.mime, videoBitsPerSecond: BITRATE })
    this._recorder.ondataavailable = (e) => { if (e.data.size) this._mrChunks.push(e.data) }
    this._recorder.start()
  }

  // ─── Compositor ───────────────────────────────────────────────────────────
  _composite() {
    const ctx = this._ctx
    const base = this._src.canvas()
    const vw = base.clientWidth
    const vh = base.clientHeight
    if (!vw || !vh) return
    // Center cover-crop of the viewport at the output aspect.
    const outAspect = OUT_W / OUT_H
    let cropW = vw, cropH = vh
    if (vw / vh > outAspect) cropW = vh * outAspect
    else cropH = vw / outAspect
    const cropX = (vw - cropW) / 2
    const cropY = (vh - cropH) / 2
    const k = OUT_W / cropW

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = 'rgb(6, 8, 16)' // space color behind the globe's horizon
    ctx.fillRect(0, 0, OUT_W, OUT_H)

    this._drawSource(base, cropX, cropY, k, false)
    for (const el of this._overlays) {
      if (el && el.width > 0) this._drawSource(el, cropX, cropY, k, true)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._drawWatermark()
    this._drawSourceLine()
  }

  // Draw one source canvas honoring its backing-store scale and — for the
  // overlays — the CSS transform the CanvasFreezer applies between repaints
  // (transform-origin is 0 0). Chain: backing px → CSS px → transform → crop.
  _drawSource(el, cropX, cropY, k, cssTransform) {
    const ctx = this._ctx
    const cssW = el.clientWidth
    const cssH = el.clientHeight
    if (!cssW || !cssH) return
    ctx.setTransform(k, 0, 0, k, -cropX * k, -cropY * k)
    if (cssTransform) {
      const t = getComputedStyle(el).transform
      if (t && t !== 'none') {
        const m = new DOMMatrix(t)
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
      }
    }
    ctx.scale(cssW / el.width, cssH / el.height)
    ctx.drawImage(el, 0, 0)
  }

  // ─── Burned-in branding ───────────────────────────────────────────────────
  _drawWatermark() {
    const ctx = this._ctx
    const pad = 28
    ctx.textBaseline = 'top'
    ctx.font = '400 24px system-ui, -apple-system, sans-serif'
    const preW = ctx.measureText('Powered by ').width
    ctx.font = '600 24px system-ui, -apple-system, sans-serif'
    const earthW = ctx.measureText('Earth').width
    ctx.font = 'italic 400 24px system-ui, -apple-system, sans-serif'
    const atlasW = ctx.measureText('Atlas').width
    const w = preW + earthW + atlasW
    const x = OUT_W - pad - w
    const y = pad
    pill(ctx, x - 14, y - 8, w + 28, 40)
    ctx.fillStyle = 'rgba(255,255,255,0.78)'
    ctx.font = '400 24px system-ui, -apple-system, sans-serif'
    ctx.fillText('Powered by ', x, y)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 24px system-ui, -apple-system, sans-serif'
    ctx.fillText('Earth', x + preW, y)
    ctx.fillStyle = '#67e8f9'
    ctx.font = 'italic 400 24px system-ui, -apple-system, sans-serif'
    ctx.fillText('Atlas', x + preW + earthW, y)
  }

  // sourceLine may be a function — a playing replay's date changes across the
  // clip, and the burned-in stamp must match the frame on screen.
  _sourceText() {
    const s = this._brand.sourceLine
    return typeof s === 'function' ? s() : s
  }

  _drawSourceLine() {
    const ctx = this._ctx
    const pad = 28
    ctx.font = '400 19px system-ui, -apple-system, sans-serif'
    ctx.textBaseline = 'top'
    const text = this._sourceText()
    const w = ctx.measureText(text).width
    const y = OUT_H - pad - 26
    pill(ctx, pad - 12, y - 7, w + 24, 36)
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.fillText(text, pad, y)
  }

  _drawEndCard(lastFrame, alpha) {
    const ctx = this._ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(lastFrame, 0, 0)
    ctx.fillStyle = `rgba(8, 11, 20, ${0.94 * alpha})`
    ctx.fillRect(0, 0, OUT_W, OUT_H)
    if (alpha <= 0.05) return
    ctx.globalAlpha = alpha
    const cx = OUT_W / 2

    // Wordmark + badge
    ctx.textBaseline = 'alphabetic'
    ctx.font = '600 64px system-ui, -apple-system, sans-serif'
    const earthW = ctx.measureText('Earth').width
    ctx.font = 'italic 400 64px system-ui, -apple-system, sans-serif'
    const atlasW = ctx.measureText('Atlas').width
    const wx = cx - (earthW + atlasW) / 2
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 64px system-ui, -apple-system, sans-serif'
    ctx.fillText('Earth', wx, 240)
    ctx.fillStyle = '#67e8f9'
    ctx.font = 'italic 400 64px system-ui, -apple-system, sans-serif'
    ctx.fillText('Atlas', wx + earthW, 240)
    ctx.fillStyle = '#67e8f9'
    ctx.font = '600 26px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('IN MOTION', cx, 292)

    // QR of the sharer's exact view (white quiet zone for scannability)
    if (this._qr) {
      const qs = 264
      const qx = cx - qs / 2
      const qy = 360
      ctx.fillStyle = '#ffffff'
      roundRect(ctx, qx - 16, qy - 16, qs + 32, qs + 32, 14)
      ctx.fill()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(this._qr, qx, qy, qs, qs)
      ctx.imageSmoothingEnabled = true
    }
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.font = '500 30px system-ui, -apple-system, sans-serif'
    ctx.fillText('Scan to see this view, live', cx, 712)
    ctx.fillStyle = '#67e8f9'
    ctx.font = '400 26px system-ui, -apple-system, sans-serif'
    ctx.fillText('earthatlas.org/inmotion', cx, 754)

    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '400 21px system-ui, -apple-system, sans-serif'
    ctx.fillText(this._sourceText(), cx, OUT_H - 64)
    ctx.textAlign = 'left'
    ctx.globalAlpha = 1
  }
}

// Translucent backing pill so the branding stays legible over bright basemaps.
function pill(ctx, x, y, w, h) {
  ctx.fillStyle = 'rgba(6, 8, 16, 0.55)'
  roundRect(ctx, x, y, w, h, h / 2)
  ctx.fill()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return }
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// QR of the share URL, rendered once at start. Dark modules on the white
// backing box drawn by the end card. Lazy import keeps it off the main bundle.
async function makeQrCanvas(url) {
  try {
    const { default: qrcode } = await import('qrcode-generator')
    const qr = qrcode(0, 'M')
    qr.addData(url)
    qr.make()
    const n = qr.getModuleCount()
    const cell = 8
    const c = document.createElement('canvas')
    c.width = c.height = n * cell
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#0a0e17'
    for (let r = 0; r < n; r++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(r, col)) ctx.fillRect(col * cell, r * cell, cell, cell)
      }
    }
    return c
  } catch (err) {
    console.warn('[systems] QR generation failed, end card will omit it:', err)
    return null
  }
}
