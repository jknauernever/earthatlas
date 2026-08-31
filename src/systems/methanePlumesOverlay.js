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

    // Gesture behavior matches the scalar wash underneath: freeze the canvas
    // and let the freezer slide it as one image, repainting on settle. A
    // per-frame live repaint here made the markers visibly detach from the
    // (frozen) raster during pan/zoom — they'd "swim" instead of sitting on
    // the field they annotate.
    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true; this._freeze.begin() }
    this._onMove = () => {}
    this._onMoveEnd = () => { this._moving = false; this._paint(); this._freeze.end() }
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

  /** Replay cursor (ms) or null for the live view: only plumes observed by
   * the cursor time draw, and ones imaged shortly before it ping brightest. */
  setTime(t_ms) {
    if (this._cursor === t_ms) return
    this._cursor = t_ms
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
        // rows: [lat, lng, kgh, unc, t_ms, platform, plume_id, sector]
        this._data = j.plumes.map((r) => ({ lat: r[0], lng: r[1], kgh: r[2], unc: r[3], t_ms: r[4], platform: r[5], plume_id: r[6], sector: r[7] || '' }))
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
    const clock = Date.now() // animation clock — always wall time
    const now = this._cursor ?? clock // reference time for filtering/freshness
    // Ease dots in over the first half-zoom so the handoff doesn't pop.
    const zoomAlpha = Math.min(1, (zoom - MIN_DRAW_ZOOM) / 0.5)
    // Sonar-ping phase (0→1, ~2 s): an expanding, fading detection ring —
    // deliberately unlike every other marker on the site (fire = warm glows,
    // quakes = magnitude circles), and in lime, the complement of the
    // magenta methane wash, so it pops hardest where the field saturates.
    const phase = (clock % 2000) / 2000
    // Distance guard independent of getGlobeGeometry: far-side points
    // project into the view during the globe↔mercator transition, world-copy
    // wrap can slide the far hemisphere on screen in mercator, and even
    // front-side points near the globe's limb compress into a band that
    // reads as "dots over the ocean". At the zooms where dots draw (z3.6+),
    // nothing beyond ~60° of arc from the map center is useful — cull it.
    const c = map.getCenter()
    const d2r = Math.PI / 180
    const cLat = c.lat * d2r
    const sinC = Math.sin(cLat)
    const cosC = Math.cos(cLat)
    for (const p of this._data) {
      if (p.t_ms > now + 12 * 3.6e6) continue // not yet observed at the cursor
      const pLat = p.lat * d2r
      const cosArc = sinC * Math.sin(pLat) + cosC * Math.cos(pLat) * Math.cos((p.lng - c.lng) * d2r)
      if (cosArc < 0.5) continue // > 60° of arc away
      if (geo && !geo.isVisible(p.lng, p.lat)) continue
      let pt
      try { pt = map.project([p.lng, p.lat]) } catch { continue }
      if (!pt || !Number.isFinite(pt.x)) continue
      if (pt.x < -20 || pt.y < -20 || pt.x > w + 20 || pt.y > h + 20) continue
      // Size by emission rate (log): ~100 kg/h → 4 px, 1 t/h → 6.5, 10 t/h → 9;
      // grows gently past z6 so single markers stay findable.
      const zScale = 1 + Math.min(1, Math.max(0, zoom - 6) * 0.18)
      const r = (3 + 2.5 * Math.log10(Math.max(1, p.kgh / 30))) * zScale
      const fresh = now - p.t_ms < FRESH_MS
      // Age never dims the reticle itself — a translucent lime ring over the
      // saturated magenta wash bleeds pink and gets lost (the Vancouver
      // plume, observed months back, was nearly invisible). Every marker
      // draws full strength; freshness shows in the ping instead (fresh =
      // two rings, older = one).
      const alpha = zoomAlpha
      // Expanding sonar ping; fresh plumes get a second, offset ring so the
      // pulse never fully rests.
      const LIME = '163,230,53'
      const ping = (ph, strength) => {
        if (ph <= 0.02 || ph >= 1) return
        const pr = r + 2 + (r * 2.6 + 6) * ph
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pr, 0, Math.PI * 2)
        ctx.lineWidth = 2 * (1 - ph) + 0.5
        ctx.strokeStyle = `rgba(${LIME},${(1 - ph) * strength * alpha})`
        ctx.stroke()
      }
      ping(phase, 0.9)
      if (fresh) ping((phase + 0.5) % 1, 0.55)
      // Target reticle: lime ring + four ticks around a white core — reads
      // as "detected at this exact spot", unlike any other marker here.
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, r + 2, 0, Math.PI * 2)
      ctx.lineWidth = 1.6
      ctx.strokeStyle = `rgba(${LIME},${0.95 * alpha})`
      ctx.stroke()
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.beginPath()
        ctx.moveTo(pt.x + dx * (r + 2), pt.y + dy * (r + 2))
        ctx.lineTo(pt.x + dx * (r + 5), pt.y + dy * (r + 5))
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, Math.max(2, r * 0.55), 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${0.95 * alpha})`
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(20,45,10,${0.85 * alpha})`
      ctx.stroke()
      this._drawn.push({ p, x: pt.x, y: pt.y, r })
    }
  }
}
