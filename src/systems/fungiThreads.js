/**
 * "Living threads" over the Fungal networks map (Josh, 2026-09-24): fine
 * golden threads that grow, branch and fade across the land, with pulses of
 * light running along them, like energy, nutrients and signals moving through
 * a mycelial network.
 *
 * AN ILLUSTRATION, and labelled as one in the legend note and the Explain
 * facts. SPUN measures how DENSE the networks are, not their paths or what
 * flows through them. What IS data here: where threads may start and grow.
 * A thread is seeded or extended only with a probability set by SPUN's hyphal
 * density at that spot (the same 0.1° field the popups read), so dense
 * networks teem with threads, sparse land barely flickers, and masked ground
 * (oceans, deserts, cities) gets none. The paths and pulses are invented.
 *
 * Threads live in screen space and are short-lived (12-20 s), so on a
 * camera move they simply clear and regrow for the new view. Nothing runs
 * while the page sleeps (activity.js).
 */

import { runWhileAwake } from './activity.js'
import { getGlobeGeometry } from './globeGeom.js'

// Density → chance a thread may start or keep growing here: none below
// 3.6 m/cm³ (the lower quarter of mapped land), near 1 in the dense top 5%.
// Softer than a smoothstep so middling networks fill in instead of showing
// lone threads (Josh: "increase the density where there are individual spark
// lines"), while the densest ground still gets the most.
const LO = 3.6
const HI = 5.7
const chance = (d) => {
  if (d == null) return 0
  const t = Math.min(1, Math.max(0, (d - LO) / (HI - LO)))
  return Math.sqrt(t)
}

const MAX_THREADS = 1300
const STEP_PX = 3

export class FungiThreadsLayer {
  constructor(map, canvas, field) {
    this.map = map
    this.canvas = canvas
    this.field = field
    this.threads = []
    this.visible = true
    this._moving = false
    this._last = 0
    this._geo = null
    this._geoAt = 0
    this._onMoveStart = () => { this._moving = true; this.threads = []; this._clear() }
    this._onMoveEnd = () => { this._moving = false; this._geo = null }
    this._onResize = () => { this._geo = null }
    map.on('movestart', this._onMoveStart)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    this._stop = runWhileAwake((now) => this._frame(now))
  }

  setVisible(v) {
    this.visible = v
    if (!v) { this.threads = []; this._clear() }
  }

  _clear() {
    const c = this.canvas
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
  }

  // Density at a screen point, or null off the globe / off the data.
  _density(x, y) {
    const g = this._geo
    if (g && Math.hypot(x - g.cx, y - g.cy) > g.r * 0.97) return null
    let ll
    try { ll = this.map.unproject([x, y]) } catch { return null }
    if (!ll || !Number.isFinite(ll.lat)) return null
    return this.field.sampleScalar(ll.lng, ll.lat)?.value ?? null
  }

  _spawn(w, h) {
    // Rejection sampling: try random points, keep one with the density's odds.
    for (let tries = 0; tries < 6; tries++) {
      const x = Math.random() * w
      const y = Math.random() * h
      const d = this._density(x, y)
      if (Math.random() < chance(d)) {
        this.threads.push(this._thread(x, y, Math.random() * Math.PI * 2, 0, chance(d)))
        return
      }
    }
  }

  _thread(x, y, heading, depth, vigor) {
    return {
      pts: [x, y],
      heading,
      depth,
      speed: 7 + Math.random() * 9, // px/s of growth: slow, like something alive
      maxLen: (depth ? 0.55 : 1) * (40 + Math.random() * 110 * (0.5 + vigor)),
      len: 0,
      growing: true,
      acc: 0,
      age: 0,
      life: 12 + Math.random() * 8,
      pulses: [],
      nextPulse: 1 + Math.random() * 3,
    }
  }

  _grow(t, dt, out) {
    if (!t.growing) return
    t.acc += t.speed * dt
    while (t.acc >= STEP_PX && t.growing) {
      t.acc -= STEP_PX
      t.heading += (Math.random() - 0.5) * 0.55 // hyphae wander
      const n = t.pts.length
      const x = t.pts[n - 2] + Math.cos(t.heading) * STEP_PX
      const y = t.pts[n - 1] + Math.sin(t.heading) * STEP_PX
      const d = this._density(x, y)
      // Growth, like seeding, follows the measured density: a thread stalls
      // where the network thins out and never crosses masked ground.
      if (d == null || Math.random() > 0.35 + 0.65 * chance(d)) { t.growing = false; break }
      t.pts.push(x, y)
      t.len += STEP_PX
      if (t.len >= t.maxLen) t.growing = false
      if (t.depth < 3 && Math.random() < 0.07 && this.threads.length + out.length < MAX_THREADS) {
        const side = Math.random() < 0.5 ? -1 : 1
        out.push(this._thread(x, y, t.heading + side * (0.5 + Math.random() * 0.6), t.depth + 1, chance(d)))
      }
    }
  }

  _frame(now) {
    const t0 = performance.now()
    this._draw(now)
    // Dev-only meter: the threads' real per-frame cost in THIS browser
    // (window.__fungiThreads.stats()). Headless Chrome has no GPU, so only a
    // real browser gives a true number.
    if (import.meta.env.DEV && this._drew) {
      const ms = performance.now() - t0
      const m = (this._meter ||= { n: 0, sum: 0, max: 0, since: performance.now() })
      m.n++; m.sum += ms; m.max = Math.max(m.max, ms)
      window.__fungiThreads = {
        stats: () => ({ frames: m.n, avgMs: +(m.sum / m.n).toFixed(2), maxMs: +m.max.toFixed(2), threads: this.threads.length, fps: +(m.n / ((performance.now() - m.since) / 1000)).toFixed(1) }),
        reset: () => { this._meter = null },
      }
    }
  }

  _draw(now) {
    this._drew = false
    const c = this.canvas
    // Cost control (measured 2026-09-24: up to ~1 s of script per second at
    // Retina density, 60 fps). The motion is slow, so 30 fps loses nothing,
    // and soft glowing lines don't need Retina pixels: 1× backing store is a
    // quarter of the fill work on a 2× screen.
    if (this._last && now - this._last < 31) return
    const dpr = 1
    const w = c.clientWidth
    const h = c.clientHeight
    if (!w || !h) return
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    const dt = Math.min(0.1, this._last ? (now - this._last) / 1000 : 0.016)
    this._last = now
    if (!this.visible || this._moving) return
    if (!this._geo || now - this._geoAt > 2000) {
      this._geo = getGlobeGeometry(this.map, w, h) || { cx: w / 2, cy: h / 2, r: Infinity }
      this._geoAt = now
    }

    // Population scales with the view's area; spawning is spread over time.
    const target = Math.min(MAX_THREADS, Math.round((w * h) / 1000))
    const spawns = Math.min(24, Math.max(0, target - this.threads.length))
    for (let i = 0; i < spawns; i++) this._spawn(w, h)

    const born = []
    for (const t of this.threads) {
      t.age += dt
      this._grow(t, dt, born)
      t.nextPulse -= dt
      if (t.nextPulse <= 0 && t.pts.length > 6) {
        // Slow sparks (Josh, 2026-09-24): ~12-24 px/s, a drift, not a zap.
        t.pulses.push({ s: 0, v: 12 + Math.random() * 12 })
        t.nextPulse = 2 + Math.random() * 4
      }
      for (const p of t.pulses) p.s += p.v * dt
      t.pulses = t.pulses.filter((p) => p.s < t.len)
    }
    this.threads = this.threads.filter((t) => t.age < t.life).concat(born)

    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const t of this.threads) {
      const a = Math.min(1, t.age / 0.8, (t.life - t.age) / 1.6)
      if (a <= 0 || t.pts.length < 4) continue
      ctx.beginPath()
      ctx.moveTo(t.pts[0], t.pts[1])
      for (let i = 2; i < t.pts.length; i += 2) ctx.lineTo(t.pts[i], t.pts[i + 1])
      // Soft glow under a fine core: warm gold, like energy in the thread.
      // Subtle (Josh, 2026-09-24): hairline core, narrow glow, small sparks.
      ctx.strokeStyle = `rgba(255,196,64,${0.08 * a})`
      ctx.lineWidth = 1.8 - t.depth * 0.3
      ctx.stroke()
      ctx.strokeStyle = `rgba(255,226,120,${0.5 * a})`
      ctx.lineWidth = 0.55 - t.depth * 0.08
      ctx.stroke()
      for (const p of t.pulses) {
        const i = Math.min(t.pts.length / 2 - 1, Math.floor(p.s / STEP_PX)) * 2
        const x = t.pts[i]
        const y = t.pts[i + 1]
        ctx.fillStyle = `rgba(255,200,70,${0.22 * a})`
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = `rgba(255,248,200,${0.95 * a})`
        ctx.beginPath(); ctx.arc(x, y, 0.95, 0, Math.PI * 2); ctx.fill()
      }
    }
    ctx.globalCompositeOperation = 'source-over'
    this._drew = true
  }

  destroy() {
    this._stop()
    this.map.off('movestart', this._onMoveStart)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this.threads = []
    this._clear()
  }
}
