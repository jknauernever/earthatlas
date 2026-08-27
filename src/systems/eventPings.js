/**
 * Pulsating event markers for /systems (earthquakes, fire clusters) — canvas
 * overlay, clean-room.
 *
 * Events are point records, projected to screen once per camera settle (with
 * the globe-horizon round-trip check), then animated per frame:
 *   mode 'ring' — sonar pings: an expanding, fading circle plus a solid core
 *     dot; period/size/color per event (earthquakes: by magnitude, brightness
 *     by recency).
 *   mode 'glow' — a soft radial sprite whose size breathes; drawn via
 *     drawImage so thousands of markers stay cheap (fire clusters).
 *
 * Per-event phase offsets (hashed from position) keep the field organic —
 * pings shimmer across the globe instead of blinking in unison. All timing is
 * wall-clock, so speed is display-refresh independent.
 */

import { CanvasFreezer } from './canvasFreeze.js'
import { getGlobeGeometry } from './globeGeom.js'

const PROJ_TOLERANCE = 2
const MAX_DPR = 2

const hash01 = (a, b) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export class EventPingLayer {
  /**
   * events: array of { lat, lng, … }
   * opts: {
   *   mode: 'ring' | 'glow',
   *   maxRender,                       // cap (events must arrive pre-sorted by importance)
   *   color(e), dotR(e), maxR(e), periodMs(e), baseAlpha(e),
   *   glowColor,                       // 'glow' mode sprite tint
   * }
   */
  constructor(map, canvas, events, opts) {
    this.map = map
    this.canvas = canvas
    // Keep ALL events — the render cap is applied per viewport in _rebuild.
    // A global top-N slice silently deleted small events from zoomed-in
    // views (a lone fire near Bandar Abbas ranked ~9,800 of 47,000 worldwide
    // and vanished on zoom-in even though it was the only thing on screen).
    this.events = events
    this._cap = opts.maxRender || Infinity
    this.opts = opts
    this.visible = true
    this._destroyed = false
    this._moving = false
    this._ctx = canvas.getContext('2d')
    if (opts.mode === 'glow') {
      this._sprite = makeGlowSprite(opts.glowColor)
      this._spriteHot = opts.glowColorHot ? makeGlowSprite(opts.glowColorHot) : null
    }

    // During a gesture the last frame stays visible, camera-glued by the
    // freezer; the settle rebuild resumes live animation at true positions.
    // Gestures: events are few, so every animation frame during a move
    // re-projects them exactly (see _frame) — no affine freezer. Sliding the
    // canvas AND redrawing on a throttle gave two disagreeing positions per
    // point, which read as jitter.
    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true }
    this._onMoveEnd = () => { this._moving = false; this._rebuild() }
    this._onMove = () => {}
    this._onResize = () => this._rebuild()
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)

    this._rebuild()
    const loop = (now) => {
      if (this._destroyed) return
      this._frame(now)
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) this._clear()
  }

  /**
   * Replay cursor: null = live (all events, pulsing by recency); a time =
   * only events that had happened by then. An event that crosses the cursor
   * bursts once (expanding ring) in real time, then settles to a dot that
   * fades with its age AT THE CURSOR. Scrubbing back un-happens events.
   */
  setTime(t, mode = 'flow') {
    // A jump backwards re-arms bursts for everything (they'll re-burst as
    // the cursor reaches them again).
    if (this._t != null && t != null && t < this._t - 1000) this._shown?.clear()
    this._t = t == null ? null : t
    this._cursorMode = mode
    if (!this._shown) this._shown = new Map()
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._raf)
    this.map.off('movestart', this._onMoveStart)
    this.map.off('move', this._onMove)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this._freeze.destroy()
    this._clear()
  }

  /** Swap the event set in place (time-scrubbed fire presence frames). */
  setEvents(events) {
    this.events = events
    this._rebuild()
  }

  /** Nearest rendered event within maxPx of a screen point, or null. */
  nearest(x, y, maxPx) {
    if (!this._pts) return null
    let best = null
    let bestD = maxPx * maxPx
    for (const p of this._pts) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bestD) { bestD = d; best = p.e }
    }
    return best
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _rebuild() {
    const { map, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    this._dpr = dpr
    this._w = w
    this._h = h

    // Degrees per screen px at this zoom — used to cap glow size at each
    // cluster's true geographic footprint.
    this._zoom = map.getZoom()
    this._degPerPx = 360 / (512 * Math.pow(2, this._zoom))

    // Viewport-aware selection: pre-filter to the visible bbox (cheap lat/lng
    // compares), THEN apply the render cap to what's actually in view.
    // Events arrive sorted by importance, so when a dense world view still
    // exceeds the cap, the biggest survive — but a zoomed-in view keeps its
    // small local events no matter their global rank.
    let list = this.events
    try {
      const b = map.getBounds()
      const west = b.getWest()
      const east = b.getEast()
      if (east - west < 359) {
        const s = b.getSouth() - 1
        const n = b.getNorth() + 1
        const span = east - west + 2
        list = list.filter((e) => {
          if (e.lat < s || e.lat > n) return false
          const d = (((e.lng - (west - 1)) % 360) + 360) % 360
          return d <= span
        })
      }
    } catch { /* globe at extreme zoom-out — keep the full list */ }
    if (list.length > this._cap) list = list.slice(0, this._cap)

    const pts = []
    const pad = 30
    // Behind-the-globe test: a hidden event still projects onto some screen
    // pixel, but unprojecting that pixel returns the FRONT-face location
    // there — compare it to the event's own lng/lat IN DEGREES (comparing
    // screen points always agrees with itself and hides nothing). Tolerance
    // scales with zoom: a few screen pixels' worth of degrees.
    // Behind-the-globe test: exact angular test against the measured limb
    // when the horizon is on screen; unproject round-trip (in degrees) when
    // zoomed in, where Mapbox's unproject is exact.
    const geo = getGlobeGeometry(map, w, h)
    const degPerPx = 360 / (512 * Math.pow(2, map.getZoom()))
    const tolDeg = degPerPx * 12 + 0.05
    for (const e of list) {
      if (geo && !geo.isVisible(e.lng, e.lat)) continue
      let pt
      try { pt = map.project([e.lng, e.lat]) } catch { continue }
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue
      if (pt.x < -pad || pt.y < -pad || pt.x > w + pad || pt.y > h + pad) continue
      if (!geo) {
        let rt
        try { rt = map.unproject([pt.x, pt.y]) } catch { continue }
        if (!rt || !Number.isFinite(rt.lng) || !Number.isFinite(rt.lat)) continue
        const dLng = Math.abs(((rt.lng - e.lng + 540) % 360) - 180)
        const cosLat = Math.max(0.05, Math.cos((e.lat * Math.PI) / 180))
        if (dLng * cosLat + Math.abs(rt.lat - e.lat) > tolDeg) continue
      }
      pts.push({ x: pt.x, y: pt.y, phase: hash01(e.lng, e.lat), e })
    }
    this._pts = pts
    // (Do NOT clear _moving here — during a gesture _frame rebuilds every
    // frame, and clearing it after the first froze the points mid-drag.)
    this._builtAt = Date.now()
  }

  _frame(now) {
    if (!this.visible || document.hidden) return
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    if (!cw || !ch) return
    if (this._moving || !this._pts || cw !== this._w || ch !== this._h) this._rebuild()
    if (!this._pts) return

    const ctx = this._ctx
    const dpr = this._dpr
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const o = this.opts
    if (o.mode === 'ring') {
      // Biggest last so a major quake's ring and halo sit on top.
      const pts = o.maxR ? [...this._pts].sort((a, b) => o.maxR(a.e) - o.maxR(b.e)) : this._pts
      const cursor = this._t
      for (const p of pts) {
        const e = p.e
        const period = o.periodMs(e)
        let phase = ((now / period) + p.phase) % 1
        let alpha = o.baseAlpha(e)
        let ringOn = true
        if (cursor != null) {
          if (this._cursorMode === 'last24') {
            // NOW: everything from the past 24 hours, steady.
            const age = cursor - e.time
            if (age < 0 || age > 8.64e7) { this._shown.delete(e.id); continue }
            alpha = 1
          } else if (this._cursorMode === 'flow') {
            // Playing: the cursor advances in 3-h ticks; a quake appears at
            // its tick and fades over the next three (9 h) — days flow into
            // each other instead of flipping.
            const age = cursor - e.time
            if (age < 0 || age > 12 * 3.6e6) { this._shown.delete(e.id); continue }
            alpha = Math.max(0.08, 1 - age / (12 * 3.6e6))
          } else {
            // Paused / stepped: the whole UTC day of the cursor, steady.
            if (Math.floor(e.time / 8.64e7) !== Math.floor(cursor / 8.64e7)) { this._shown.delete(e.id); continue }
            alpha = 1
          }
          let shownAt = this._shown.get(e.id)
          if (shownAt == null) { shownAt = now; this._shown.set(e.id, shownAt) }
          const burst = (now - shownAt) / (period * 1.3)
          if (burst < 1) phase = burst
          else ringOn = false
        }
        const color = o.color(e)
        const maxR = o.maxR(e)
        // Steady translucent halo for big quakes (their footprint), under the ring.
        const halo = o.halo ? o.halo(e) : 0
        if (halo > 0) {
          ctx.globalAlpha = alpha * halo
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(p.x, p.y, maxR * 0.6, 0, Math.PI * 2)
          ctx.fill()
        }
        // Expanding, fading ring.
        if (ringOn) {
          ctx.lineWidth = o.lineWidth ? o.lineWidth(e) : 1.4
          ctx.globalAlpha = alpha * (1 - phase) * 0.9
          ctx.strokeStyle = color
          ctx.beginPath()
          ctx.arc(p.x, p.y, o.dotR(e) + phase * maxR, 0, Math.PI * 2)
          ctx.stroke()
        }
        // Solid core.
        ctx.globalAlpha = alpha
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(p.x, p.y, o.dotR(e), 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    } else {
      // 'glow': breathing sprite per event. At world zooms dots keep their
      // stylized size (standard minimum-symbol cartography — a fire must stay
      // visible at 2px-per-continent scales). As zoom rises past ~3, the cap
      // fades in toward each cluster's true geographic extent so dense
      // regions (savanna burning season) can't smear into a false
      // "everything is on fire" wall. The pulse modulates the CAPPED radius,
      // so it stays visible at every zoom instead of flattening against the
      // cap.
      const styleFalloff = Math.min(1, Math.max(0, (5.5 - this._zoom) / 2.5))
      for (const p of this._pts) {
        const e = p.e
        const period = o.periodMs(e)
        const phase = ((now / period) + p.phase) % 1
        const breathe = 0.75 + 0.25 * Math.sin(phase * Math.PI * 2)
        const geoCapPx = e.km ? (e.km / 111 / this._degPerPx) * 0.65 : Infinity
        // sizeFloor (0..1) lets an event's IMPORTANCE keep a fraction of its
        // stylized size past the geographic cap — the cap exists to stop
        // fields of weak events smearing into a false wall, not to shrink a
        // megafire front to its footprint pixels at regional zoom. A glow is
        // light, not a footprint claim; the hull outlines carry the truth.
        const keep = o.sizeFloor ? o.sizeFloor(e) : 0
        const allowed = Math.max(2.5, geoCapPx, o.maxR(e) * Math.max(styleFalloff, keep))
        const rMax = Math.min(o.maxR(e), allowed)
        const r = Math.max(1.2, rMax * breathe)
        ctx.globalAlpha = o.baseAlpha(e)
        const sprite = this._spriteHot && o.hot?.(e) ? this._spriteHot : this._sprite
        ctx.drawImage(sprite, p.x - r, p.y - r, r * 2, r * 2)
      }
      ctx.globalAlpha = 1
    }
  }
}

// Soft radial glow sprite, tinted once at construction.
function makeGlowSprite(color) {
  const S = 64
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, color)
  g.addColorStop(0.35, color)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  return c
}
