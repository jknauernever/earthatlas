/**
 * NOAA HMS smoke-plume overlay for /inmotion — observational companion to
 * the modeled Wildfire smoke layer. NOAA analysts trace visible smoke
 * extents off GOES imagery several times a day; this draws today's plumes
 * as translucent washes (denser smoke = deeper wash) over the smoke layer,
 * so a US/NA view shows both the model's forecast AND where analysts
 * actually saw smoke in the imagery. Canvas overlay, repaints on camera
 * settle (same self-heal pattern as fireEventsOverlay); answers click
 * hit-tests so popups can say "analysts marked heavy smoke here".
 *
 * Data via /api/hms-smoke (~100 KB for the continent), refreshed every
 * 15 minutes while visible. North America only — elsewhere it's empty.
 */

import { CanvasFreezer } from './canvasFreeze.js'
import { getGlobeGeometry } from './globeGeom.js'

const MIN_DRAW_ZOOM = 2.6
const REFRESH_MS = 15 * 60e3
const MAX_DPR = 2

const DENSITY_STYLE = {
  light: { fill: 'rgba(150,142,128,0.07)', stroke: 'rgba(170,160,142,0.28)', minZoom: 4.5 },
  medium: { fill: 'rgba(150,138,118,0.12)', stroke: 'rgba(175,160,135,0.38)', minZoom: 0 },
  heavy: { fill: 'rgba(152,132,104,0.20)', stroke: 'rgba(185,165,132,0.5)', minZoom: 0 },
}

export class SmokePlumesOverlay {
  /** opts: { endpoint } — override the /api/hms-smoke URL (dev QA). */
  constructor(map, canvas, opts = {}) {
    this.map = map
    this.canvas = canvas
    this.endpoint = opts.endpoint || '/api/hms-smoke'
    this.visible = true
    this._destroyed = false
    this._ctx = canvas.getContext('2d')
    this._fc = null
    this._fetchedAt = 0
    this._loading = false
    this._drawn = [] // { f, screenRings } for hit tests

    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true }
    this._onMove = () => { if (this.visible) this._paint() }
    this._onMoveEnd = () => { this._moving = false; this._paint() }
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

  destroy() {
    this._destroyed = true
    this.map.off('movestart', this._onMoveStart)
    this.map.off('move', this._onMove)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this._freeze.destroy()
    this._clear()
  }

  /** Densest plume containing the screen point, or null. */
  hitTest(x, y) {
    const rank = { heavy: 3, medium: 2, light: 1 }
    let best = null
    for (const d of this._drawn) {
      if (!d.screenRings.length) continue
      // Outer ring contains, holes don't exclude — analyst holes are rare
      // and a near-miss answer beats a confusing null.
      if (!pointInPolygon(x, y, d.screenRings[0])) continue
      if (!best || rank[d.f.properties.density] > rank[best.properties.density]) best = d.f
    }
    return best
  }

  _ensureData() {
    if (this._destroyed || !this.visible || this._loading) return
    if (this._fc && Date.now() - this._fetchedAt < REFRESH_MS) return
    this._loading = true
    fetch(this.endpoint)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`hms-smoke ${r.status}`))))
      .then((fc) => {
        if (this._destroyed) return
        this._fc = fc
        this._fetchedAt = Date.now()
        this._paint()
      })
      .catch(() => { /* plumes are an enhancement — the modeled layer stands alone */ })
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
    if (!this.visible || !this._fc) return
    if (map.getZoom() < MIN_DRAW_ZOOM) return
    this._ensureData()

    const geo = getGlobeGeometry(map, w, h)
    const project = (ring) => {
      const out = []
      let anyOnScreen = false
      for (const [lng, lat] of ring) {
        if (geo && !geo.isVisible(lng, lat)) return null // behind the globe
        let p
        try { p = map.project([lng, lat]) } catch { return null }
        if (!p || !Number.isFinite(p.x)) return null
        if (p.x > -50 && p.y > -50 && p.x < w + 50 && p.y < h + 50) anyOnScreen = true
        out.push([p.x, p.y])
      }
      return anyOnScreen ? out : null
    }

    ctx.lineJoin = 'round'
    // Each density is ONE batched fill: on a bad fire season the analysts
    // trace hundreds of overlapping plumes, and per-feature translucent
    // fills stack into a murky continental slab — a union fill can't stack
    // with itself. Light first so heavier washes layer on top; analyst
    // "light" veils only appear past regional zoom (continental-scale
    // they're noise over the modeled wash). Outlines carry each plume's
    // identity and stay per-feature for hit-testing.
    const zoom = map.getZoom()
    for (const density of ['light', 'medium', 'heavy']) {
      const style = DENSITY_STYLE[density]
      if (zoom < style.minZoom) continue
      const feats = []
      ctx.beginPath()
      for (const f of this._fc.features) {
        if (f.properties.density !== density) continue
        const screenRings = []
        for (const ring of f.geometry.coordinates) {
          const pts = project(ring)
          if (!pts) continue
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.closePath()
          screenRings.push(pts)
        }
        if (screenRings.length) feats.push({ f, screenRings })
      }
      if (!feats.length) continue
      ctx.fillStyle = style.fill
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = style.stroke
      for (const d of feats) {
        ctx.beginPath()
        for (const pts of d.screenRings) {
          pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
          ctx.closePath()
        }
        ctx.stroke()
        this._drawn.push(d)
      }
    }
  }
}

function pointInPolygon(x, y, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
