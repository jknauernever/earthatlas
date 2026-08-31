/**
 * Carbon Mapper methane-plume overlay for /inmotion — observational companion
 * to the modeled Methane layer. Each dot is one individual CH₄ plume imaged
 * at ~30–60 m by Carbon Mapper's Tanager satellites or aircraft, with a
 * quantified emission rate — real point sources (leaky gas fields, landfills,
 * feedlots) under the smooth modeled field. Canvas overlay in the
 * smokePlumesOverlay mold: repaints with the camera, answers click hit-tests
 * so popups can cite the plume. Dots appear from mid zoom (the layer's
 * "appropriate zoom" handoff: modeled field global, observed sources as you
 * come closer); recent plumes draw brighter than year-old ones.
 *
 * Coverage honesty: these are targeted snapshots, not a survey — an empty
 * region means unsurveyed, never clean. The panel and popups say so.
 */

import { CanvasFreezer } from './canvasFreeze.js'
import { getGlobeGeometry } from './globeGeom.js'
import { loadSystemsJson } from './windField.js'

const MIN_DRAW_ZOOM = 3.6
const REFRESH_MS = 6 * 60 * 60e3
const MAX_DPR = 2
const FRESH_MS = 45 * 8.64e7 // plumes newer than ~45 days draw at full strength

export class MethanePlumesOverlay {
  constructor(map, canvas) {
    this.map = map
    this.canvas = canvas
    this.visible = true
    this._destroyed = false
    this._ctx = canvas.getContext('2d')
    this._data = null
    this._fetchedAt = 0
    this._loading = false
    this._drawn = [] // { p, x, y, r } for hit tests

    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true }
    this._onMove = () => { if (this.visible) this._paint() }
    this._onMoveEnd = () => { this._moving = false; this._paint() }
    this._onResize = () => this._paint()
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    // Gentle attention pulse: repaint on a throttled rAF while dots are on
    // screen so they breathe (~2.4 s period). Skipped while hidden, while
    // the camera moves (the move handler already repaints), and below the
    // draw zoom — so the loop costs nothing when nothing is showing.
    this._lastPulse = 0
    this._pulseLoop = (now) => {
      if (this._destroyed) return
      this._pulseRaf = requestAnimationFrame(this._pulseLoop)
      if (!this.visible || document.hidden || this._moving || !this._data) return
      if (this.map.getZoom() < MIN_DRAW_ZOOM) return
      if (now - this._lastPulse < 50) return // ~20 fps is plenty for a slow pulse
      this._lastPulse = now
      this._paint()
    }
    this._pulseRaf = requestAnimationFrame(this._pulseLoop)
    this._ensureData()
    this._paint()
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) { this._clear(); this._drawn = [] } else { this._ensureData(); this._paint() }
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._pulseRaf)
    this.map.off('movestart', this._onMoveStart)
    this.map.off('move', this._onMove)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this._freeze.destroy()
    this._clear()
  }

  /** Nearest drawn plume within tap range of the screen point, or null. */
  hitTest(x, y) {
    let best = null
    let bestD = 14 * 14
    for (const d of this._drawn) {
      const dx = x - d.x
      const dy = y - d.y
      const dist = dx * dx + dy * dy
      const reach = Math.max(12, d.r + 6) ** 2
      if (dist <= reach && dist < bestD) { bestD = dist; best = d.p }
    }
    return best
  }

  _ensureData() {
    if (this._destroyed || !this.visible || this._loading) return
    if (this._data && Date.now() - this._fetchedAt < REFRESH_MS) return
    this._loading = true
    loadSystemsJson('methane-plumes', 'methane-plumes')
      .then((j) => {
        if (this._destroyed) return
        // rows: [lat, lng, kgh, unc, t_ms, platform, plume_id]
        this._data = j.plumes.map((r) => ({ lat: r[0], lng: r[1], kgh: r[2], unc: r[3], t_ms: r[4], platform: r[5], plume_id: r[6] }))
        this._fetchedAt = Date.now()
        this._paint()
      })
      .catch(() => { /* dots are an enhancement — the modeled layer stands alone */ })
      .finally(() => { this._loading = false })
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
    if (!this.visible || !this._data) return
    const zoom = map.getZoom()
    if (zoom < MIN_DRAW_ZOOM) return
    this._ensureData()

    const geo = getGlobeGeometry(map, w, h)
    const now = Date.now()
    // Ease dots in over the first half-zoom so the handoff doesn't pop.
    const zoomAlpha = Math.min(1, (zoom - MIN_DRAW_ZOOM) / 0.5)
    // Shared breathing phase (0…1…0, ~2.4 s): halo swells and brightens.
    const pulse = 0.5 + 0.5 * Math.sin((now % 2400) / 2400 * Math.PI * 2)
    for (const p of this._data) {
      if (geo && !geo.isVisible(p.lng, p.lat)) continue
      let pt
      try { pt = map.project([p.lng, p.lat]) } catch { continue }
      if (!pt || !Number.isFinite(pt.x)) continue
      if (pt.x < -20 || pt.y < -20 || pt.x > w + 20 || pt.y > h + 20) continue
      // Size by emission rate (log): ~100 kg/h → 4 px, 1 t/h → 6.5, 10 t/h → 9;
      // grows gently past z6 so single dots stay findable over a saturated wash.
      const zScale = 1 + Math.min(1, Math.max(0, zoom - 6) * 0.18)
      const r = (3 + 2.5 * Math.log10(Math.max(1, p.kgh / 30))) * zScale
      const fresh = now - p.t_ms < FRESH_MS
      const alpha = (fresh ? 1 : 0.65) * zoomAlpha
      const haloR = r * (2.0 + 0.9 * pulse)
      const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, haloR)
      grad.addColorStop(0, `rgba(232,121,249,${(0.42 + 0.22 * pulse) * alpha})`)
      grad.addColorStop(1, 'rgba(232,121,249,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, haloR, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(240,171,252,${0.85 * alpha})`
      ctx.fill()
      ctx.lineWidth = 1.2
      ctx.strokeStyle = `rgba(134,25,143,${0.9 * alpha})`
      ctx.stroke()
      // Thin white contrast ring: the modeled wash saturates near source
      // regions, and a magenta dot on magenta needs an edge to be findable.
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, r + 1.4, 0, Math.PI * 2)
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(255,255,255,${(0.45 + 0.25 * pulse) * alpha})`
      ctx.stroke()
      this._drawn.push({ p, x: pt.x, y: pt.y, r })
    }
  }
}
