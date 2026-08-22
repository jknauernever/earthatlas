/**
 * Fire-event footprints + labels for /systems — canvas overlay over the fire
 * glows. Draws each event's detection-hull outline and, for the most
 * significant events in view, a name label — but only past a minimum zoom
 * (at globe scale the hulls are subpixel and the glows carry the story).
 * Static per camera (repaints on settle), same self-heal pattern as the
 * other overlays. Also answers click hit-tests (point-in-hull, then nearest
 * centroid) so popups can prefer rich events over raw clusters.
 */

import { CanvasFreezer } from './canvasFreeze.js'
import { getGlobeGeometry } from './globeGeom.js'

const MIN_DRAW_ZOOM = 3.2
const MAX_LABELS = 25
const PROJ_TOLERANCE = 2
const MAX_DPR = 2

export const fireEventName = (e) => {
  // Official incident names (NIFC join) stand on their own: "Park Fire".
  if (e.name_src === 'nifc' && e.label) return e.label
  const place = e.label
    ? `near ${e.label}${e.country && e.country !== e.label ? `, ${e.country}` : ''}`
    : `at ${Math.abs(e.lat).toFixed(1)}°${e.lat < 0 ? 'S' : 'N'} ${Math.abs(e.lng).toFixed(1)}°${e.lng < 0 ? 'W' : 'E'}`
  return e.type === 'regional' ? `Regional burning ${place}` : `Large fire ${place}`
}

export class FireEventsOverlay {
  constructor(map, canvas, events) {
    this.map = map
    this.canvas = canvas
    this.events = events
    this.visible = true
    this._destroyed = false
    this._moving = false
    this._ctx = canvas.getContext('2d')
    this._drawn = [] // { e, cx, cy, screenHull } for hit tests

    // During a gesture the last frame stays visible, camera-glued by the
    // freezer; the settle repaint redraws shapes/labels at true positions.
    // Gestures: repaint on every 'move' event (a few hundred shapes — cheap)
    // with no affine freezer; slide + throttled redraw disagreed per frame
    // and jittered.
    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true }
    this._onMoveEnd = () => { this._moving = false; this._paint() }
    this._onMove = () => { if (this.visible) this._paint() }
    this._onResize = () => this._paint()
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)

    this._paint()
    const loop = () => {
      if (this._destroyed) return
      if (this.visible && !this._moving && !document.hidden) {
        const cw = this.canvas.clientWidth
        const ch = this.canvas.clientHeight
        if (cw && ch && (cw !== this._w || ch !== this._h)) this._paint()
      }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) { this._clear(); this._drawn = [] } else this._paint()
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

  /** Event at a screen point: inside a drawn shape, else nearest centroid ≤ maxPx. */
  hitTest(x, y, maxPx = 20) {
    for (const d of this._drawn) {
      if (d.screenPolys?.some((poly) => pointInPolygon(x, y, poly))) return d.e
    }
    let best = null
    let bestD = maxPx * maxPx
    for (const d of this._drawn) {
      const dist = (d.cx - x) ** 2 + (d.cy - y) ** 2
      if (dist < bestD) { bestD = dist; best = d.e }
    }
    return best
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  _paint() {
    if (!this.visible) return
    const { map, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    this._w = w
    this._h = h
    this._paintedAt = Date.now()
    const ctx = this._ctx
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    this._drawn = []
    this._freeze.capture()
    if (map.getZoom() < MIN_DRAW_ZOOM) return

    // Same behind-globe test the ping renderer uses: exact limb test when
    // the horizon is on screen, unproject round-trip when zoomed in.
    const geo = getGlobeGeometry(map, w, h)
    const degPerPx = 360 / (512 * Math.pow(2, map.getZoom()))
    const tolDeg = degPerPx * 12 + 0.05
    const onFace = (lng, lat, pt) => {
      if (geo) return geo.isVisible(lng, lat)
      let rt
      try { rt = map.unproject([pt.x, pt.y]) } catch { return false }
      if (!rt || !Number.isFinite(rt.lng) || !Number.isFinite(rt.lat)) return false
      const dLng = Math.abs(((rt.lng - lng + 540) % 360) - 180)
      const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180))
      return dLng * cosLat + Math.abs(rt.lat - lat) <= tolDeg
    }

    const candidates = []
    for (const e of this.events) {
      let pt
      try { pt = map.project([e.lng, e.lat]) } catch { continue }
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue
      if (pt.x < -80 || pt.y < -80 || pt.x > w + 80 || pt.y > h + 80) continue
      if (!onFace(e.lng, e.lat, pt)) continue
      candidates.push({ e, cx: pt.x, cy: pt.y })
    }

    // Shapes for everything in view; labels only for the biggest. Events with
    // an OFFICIAL perimeter (NIFC join) draw its real geometry — solid and
    // brighter; everything else gets the derived detection hull.
    ctx.lineJoin = 'round'
    const projectRing = (ring) => {
      const out = []
      for (const [lng, lat] of ring) {
        let p
        try { p = map.project([lng, lat]) } catch { return null }
        if (!p || !Number.isFinite(p.x)) return null
        out.push([p.x, p.y])
      }
      return out
    }
    const drawRing = (ring, fill, stroke, dash, width) => {
      ctx.beginPath()
      ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = width
      ctx.strokeStyle = stroke
      ctx.setLineDash(dash)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // At mid-zoom, outlines earn their place too: official perimeters,
    // regional-burning envelopes, and the biggest fires in view. Everything
    // gets its outline once you're zoomed close (z ≥ 6.5); the rest of the
    // time small events are carried by their glows alone.
    const drawAll = map.getZoom() >= 6.5
    const outlineSet = new Set(
      drawAll ? candidates : [...candidates].sort((a, b) => b.e.n - a.e.n).slice(0, 30),
    )
    for (const d of candidates) {
      const polys = []
      const wantsOutline = drawAll || d.e.perimeter || d.e.type === 'regional' || outlineSet.has(d)
      if (!wantsOutline) { d.screenPolys = polys; this._drawn.push(d); continue }
      if (d.e.perimeter) {
        const geoms = d.e.perimeter.type === 'Polygon'
          ? [d.e.perimeter.coordinates]
          : d.e.perimeter.coordinates
        for (const poly of geoms) {
          const ring = projectRing(poly[0]) // outer ring
          if (!ring || ring.length < 3) continue
          drawRing(ring, 'rgba(255,120,40,0.10)', 'rgba(255,135,45,0.95)', [], 1.8)
          polys.push(ring)
        }
      } else if (d.e.hull && d.e.hull.length >= 3) {
        const ring = projectRing(d.e.hull)
        if (ring) {
          drawRing(
            ring,
            'rgba(255,140,50,0.08)',
            d.e.type === 'regional' ? 'rgba(255,180,90,0.55)' : 'rgba(255,150,60,0.85)',
            d.e.type === 'regional' ? [5, 4] : [],
            1.4,
          )
          polys.push(ring)
        }
      }
      d.screenPolys = polys
      this._drawn.push(d)
    }

    // Labels earn their place: only geocoded names (never the "N detections"
    // fallback — counts live in the popups), only for events that read as
    // significant at this zoom (big footprint on screen, or a major fire),
    // and only a handful at low zoom. Deduped: neighboring events often
    // geocode to the same nearest town — the biggest of the group keeps it.
    const zoom = map.getZoom()
    const maxLabels = zoom >= 6 ? MAX_LABELS : zoom >= 4.5 ? 12 : 8
    const labelWorthy = (d) => {
      if (!d.e.label) return false
      if (d.e.n >= 500 || d.e.perimeter) return true
      if (!d.screenPolys?.length) return false
      const pts = d.screenPolys.flat()
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= 28
    }
    const labeled = candidates.filter(labelWorthy).sort((a, b) => b.e.n - a.e.n).slice(0, maxLabels)
    const placed = []
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'center'
    for (const d of labeled) {
      const text = `${d.e.label}${d.e.type === 'regional' ? ' (regional burning)' : ''}`
      if (placed.some((p) => p.text === text && Math.hypot(p.x - d.cx, p.y - d.cy) < 180)) continue
      if (placed.some((p) => Math.abs(p.y - (d.cy - 10)) < 14 && Math.abs(p.x - d.cx) < 90)) continue
      placed.push({ text, x: d.cx, y: d.cy - 10 })
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(10,14,23,0.85)'
      ctx.strokeText(text, d.cx, d.cy - 10)
      ctx.fillStyle = 'rgba(255,220,180,0.95)'
      ctx.fillText(text, d.cx, d.cy - 10)
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
