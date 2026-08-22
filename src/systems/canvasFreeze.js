/**
 * Camera-follow freeze for /systems canvas overlays.
 *
 * The overlay renderers repaint on camera settle (and, for the cheap ones,
 * on a throttle during gestures). Between repaints the freezer keeps the
 * last rendering glued to the geography with a CSS transform that tracks
 * the camera.
 *
 * The transform is a full AFFINE fit through three anchor points spread
 * across the view (captured as lng/lat at paint time, re-projected on every
 * move). A plain translate+scale was visibly wrong on the globe — rotation
 * isn't a translation, so rasters slid off coastlines until the settle
 * repaint snapped them back. The affine fit absorbs the local shear and
 * differential stretch of globe rotation; the residual is whatever
 * nonlinearity remains across the view, which the throttled repaints keep
 * small. Falls back to translate+scale if anchors land off the globe.
 */

export class CanvasFreezer {
  constructor(map, canvas) {
    this.map = map
    this.canvas = canvas
    this._anchor = null
    this._active = false
    this._onMove = () => this._apply()
  }

  /** Call after every successful full-canvas paint. */
  capture() {
    const w = this.canvas.clientWidth
    const h = this.canvas.clientHeight
    const c = this.map.getCenter()
    const anchor = { lng: c.lng, lat: c.lat, zoom: this.map.getZoom(), w, h, pts: null }
    // Three well-spread screen points → lng/lat, validated by round-trip so
    // an anchor beyond the globe's horizon can't poison the fit.
    const screen = [[w * 0.25, h * 0.3], [w * 0.75, h * 0.3], [w * 0.5, h * 0.8]]
    const pts = []
    for (const [x, y] of screen) {
      let ll, rt
      try { ll = this.map.unproject([x, y]); rt = this.map.project(ll) } catch { break }
      if (!ll || !rt || !Number.isFinite(ll.lng) || Math.abs(rt.x - x) + Math.abs(rt.y - y) > 2) break
      pts.push({ x, y, lng: ll.lng, lat: ll.lat })
    }
    if (pts.length === 3) anchor.pts = pts
    this._anchor = anchor
    this.reset()
  }

  /** Gesture started: track the camera each move event. */
  begin() {
    if (this._active) return
    this._active = true
    this.canvas.style.willChange = 'transform'
    this.map.on('move', this._onMove)
  }

  /** Gesture settled (call after the fresh repaint). */
  end() {
    if (this._active) {
      this._active = false
      this.map.off('move', this._onMove)
      this.canvas.style.willChange = ''
    }
    this.reset()
  }

  reset() {
    this.canvas.style.transform = ''
  }

  destroy() {
    this.end()
  }

  _apply() {
    const a = this._anchor
    if (!a) return
    this.canvas.style.transformOrigin = '0 0'

    if (a.pts) {
      // Current screen positions of the three anchors.
      const now = []
      for (const p of a.pts) {
        let q
        try { q = this.map.project([p.lng, p.lat]) } catch { break }
        if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.y)) break
        now.push(q)
      }
      if (now.length === 3) {
        const m = affineFromTriples(a.pts, now)
        if (m) {
          this.canvas.style.transform = `matrix(${m.join(',')})`
          return
        }
      }
    }
    // Fallback: translate + scale about the paint-time view center.
    let p
    try { p = this.map.project([a.lng, a.lat]) } catch { return }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return
    const s = Math.pow(2, this.map.getZoom() - a.zoom)
    this.canvas.style.transform = `translate(${p.x - (a.w / 2) * s}px, ${p.y - (a.h / 2) * s}px) scale(${s})`
  }
}

// Affine [a b c d e f] (CSS matrix order) mapping source points (x,y) to
// destination points: X = a·x + c·y + e, Y = b·x + d·y + f. Exact for three
// non-collinear pairs.
function affineFromTriples(src, dst) {
  const [p0, p1, p2] = src
  const [q0, q1, q2] = dst
  const det = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y)
  if (Math.abs(det) < 1e-6) return null
  const a = ((q1.x - q0.x) * (p2.y - p0.y) - (q2.x - q0.x) * (p1.y - p0.y)) / det
  const c = ((q2.x - q0.x) * (p1.x - p0.x) - (q1.x - q0.x) * (p2.x - p0.x)) / det
  const b = ((q1.y - q0.y) * (p2.y - p0.y) - (q2.y - q0.y) * (p1.y - p0.y)) / det
  const d = ((q2.y - q0.y) * (p1.x - p0.x) - (q1.y - q0.y) * (p2.x - p0.x)) / det
  const e = q0.x - a * p0.x - c * p0.y
  const f = q0.y - b * p0.x - d * p0.y
  const vals = [a, b, c, d, e, f]
  return vals.every(Number.isFinite) ? vals.map((v) => Math.round(v * 1e5) / 1e5) : null
}
