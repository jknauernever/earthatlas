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
import { RAW_DETAIL_ZOOM } from './fireRawDetections.js'
import { drawFlame, flameStateOf } from '../components/flameGlyph.js'

const MIN_DRAW_ZOOM = 3.2
// Every named NIFC fire wears its flame marker at every zoom (matching
// /fire); markers shrink at continental scale so a bad season reads as a
// field of small flames, not a wall. Fire SHAPES (official perimeters,
// derived hulls) only appear once you're close enough for them to mean
// something on screen.
const SHAPES_MIN_ZOOM = 6.5
const flameZoomScale = (zoom) => (zoom >= 6 ? 1 : zoom >= 4 ? 0.8 : 0.6)
const MAX_LABELS = 25
const PROJ_TOLERANCE = 2
const MAX_DPR = 2

// Label/marker significance: detection count when the satellites see it,
// official size when they don't (a 15,000-acre quiet fire outranks a
// 40-detection grass fire).
const eventSignificance = (e) => e.n || (e.acres || 0) / 25

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
    // Flame markers draw at EVERY zoom (like /fire); hulls and labels wait
    // for MIN_DRAW_ZOOM where they stop being subpixel noise.

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

    const zoomNow = map.getZoom()
    const candidates = []
    for (const e of this.events) {
      // Below MIN_DRAW_ZOOM only flame-marked (named) fires draw; unnamed
      // detection clusters are carried by their glows alone down there.
      if (zoomNow < MIN_DRAW_ZOOM && e.name_src !== 'nifc') continue
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
    // Named-fire markers: the shared flame glyph (same icon family as
    // /fire), colored by containment — red fighting it, orange half held,
    // gray with a warm core mostly contained, all-gray fully contained.
    // Size scales with official acreage, shrunk at continental zooms; every
    // NIFC fire gets one at every zoom. Fire SHAPES wait for close zoom.
    const drawAll = zoomNow >= SHAPES_MIN_ZOOM
    const flameH = (e) => Math.max(11, Math.min(30, Math.max(14, 13 + Math.log10((e.acres || 0) + 1) * 3.5)) * flameZoomScale(zoomNow))
    for (const d of candidates) {
      const polys = []
      const quiet = d.e.type === 'incident'
      const flame = d.e.name_src === 'nifc'
      if (flame) drawFlame(ctx, d.cx, d.cy, flameH(d.e), flameStateOf(d.e.contained))
      const wantsOutline = drawAll
      if (!wantsOutline) { d.screenPolys = polys; this._drawn.push(d); continue }
      if (d.e.perimeter) {
        const geoms = d.e.perimeter.type === 'Polygon'
          ? [d.e.perimeter.coordinates]
          : d.e.perimeter.coordinates
        for (const poly of geoms) {
          const ring = projectRing(poly[0]) // outer ring
          if (!ring || ring.length < 3) continue
          if (quiet) drawRing(ring, 'rgba(255,140,50,0.06)', 'rgba(255,150,60,0.6)', [], 1.4)
          else drawRing(ring, 'rgba(255,120,40,0.10)', 'rgba(255,135,45,0.95)', [], 1.8)
          polys.push(ring)
        }
      } else if (d.e.hull && d.e.hull.length >= 3 && zoomNow < RAW_DETAIL_ZOOM) {
        // Past the raw-detection handoff the derived hull retires — the
        // actual 375 m detections trace the fire's real shape far better
        // than a convex hull of 5 km cells. Official perimeters stay.
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
    // Below MIN_DRAW_ZOOM the flames stand alone — names would smother the
    // continental view.
    const maxLabels = zoom < MIN_DRAW_ZOOM ? 0 : zoom >= 6 ? MAX_LABELS : zoom >= 4.5 ? 12 : 8
    const labelWorthy = (d) => {
      if (!d.e.label) return false
      // Looking AT a fire (raw-detection zoom): every named fire in view
      // keeps its name — the hull that used to earn the label is retired.
      if (zoom >= RAW_DETAIL_ZOOM) return true
      if (d.e.n >= 500 || d.e.perimeter) return true
      // Quiet incidents: big fires always deserve their name; the rest get
      // it at regional zoom (their ember is the only mark they have — the
      // maxLabels cap and significance sort still keep the biggest first).
      if (d.e.type === 'incident') return (d.e.acres || 0) >= 5000 || zoom >= 5.5
      if (!d.screenPolys?.length) return false
      const pts = d.screenPolys.flat()
      const xs = pts.map((p) => p[0])
      const ys = pts.map((p) => p[1])
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) >= 28
    }
    const labeled = candidates.filter(labelWorthy).sort((a, b) => eventSignificance(b.e) - eventSignificance(a.e)).slice(0, maxLabels)
    const placed = []
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    ctx.textAlign = 'center'
    for (const d of labeled) {
      const text = `${d.e.label}${d.e.type === 'regional' ? ' (regional burning)' : ''}`
      // Flame-marked fires get their name above the glyph, not through it.
      const ly = d.cy - (d.e.name_src === 'nifc' ? flameH(d.e) * 0.62 + 7 : 10)
      if (placed.some((p) => p.text === text && Math.hypot(p.x - d.cx, p.y - d.cy) < 180)) continue
      if (placed.some((p) => Math.abs(p.y - ly) < 14 && Math.abs(p.x - d.cx) < 90)) continue
      placed.push({ text, x: d.cx, y: ly })
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(10,14,23,0.85)'
      ctx.strokeText(text, d.cx, ly)
      ctx.fillStyle = 'rgba(255,220,180,0.95)'
      ctx.fillText(text, d.cx, ly)
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
