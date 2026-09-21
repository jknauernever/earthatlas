/**
 * Canvas particle animation for /systems vector fields (wind, ocean
 * currents) — clean-room implementation.
 *
 * Technique (the standard one for animated flow maps): instead of projecting
 * every particle every frame, we build a SCREEN-SPACE vector field once per
 * camera move — unproject a coarse pixel grid to lng/lat, sample the data
 * there, and store the flow's screen-pixel direction/magnitude per node. The
 * particle loop then advects thousands of particles with nothing but array
 * lookups and 2D canvas strokes, which keeps 60 fps without touching the
 * map's projection math. Because the field is built through
 * map.project/unproject it works identically on globe and mercator, and
 * points behind the globe's horizon are detected (project→unproject
 * round-trip mismatch) and left empty.
 *
 * Perceptual speed shaping — every vector layer gets all three pieces:
 * 1. Time-based stepping (same real speed on 60 Hz and 120 Hz displays).
 * 2. Zoom normalization (projected px double per zoom level; scale back to
 *    the default view's feel so calm flow doesn't race when zoomed in).
 * 3. Speed gamma (advance ∝ speed^1.3 around opts.gammaPivot, so slow flow
 *    visibly crawls and fast flow visibly races — motion reinforces color).
 *
 * Per-dataset tuning comes from opts (src/systems/layerDefs.js `vector`):
 * currents move ~1/20th of wind speed, so their probe offset and pivot
 * differ by that order.
 */

import { CanvasFreezer } from './canvasFreeze.js'
import { buildWaterMask } from './scalarOverlay.js'
import { getGlobeGeometry } from './globeGeom.js'
import { loadLandMask, getLandMaskSync, buildGlobeWaterMask, toUnit, isLand } from './landMask.js'
import { runWhileAwake } from './activity.js'
import { buildBirdSprites } from './birdGlyph.js'

const GRID_STEP = 16          // css px between field nodes
const PROJ_TOLERANCE = 2      // px round-trip error ⇒ off-globe
const FADE = 0.94             // trail persistence per 60fps-frame
const MAX_DPR = 2
const BASE_ZOOM = 1.9
// Screen speed is normalized to the globe view's feel at EVERY zoom. The
// old floor of 0.05 let normalization stop at z≈6.2, so past that screen
// speed doubled per level — ~25× the intended feel at a fire-scale z11
// ("absurdly fast"). A vanishing floor only guards the arithmetic.
const MIN_ZOOM_SCALE = 1e-4
// Zoomed in, the 0.25° field is one uniform vector across the whole screen,
// and thousands of parallel identical streaks read as a blizzard at any
// speed. Thin the particle count from THIN_ZOOM, halving every two levels,
// never below THIN_FLOOR of the requested density.
const THIN_ZOOM = 7
const THIN_FLOOR = 0.3

export class ParticleLayer {
  /**
   * opts: { count, colorStops: [[value, css], …],
   *         speedFactor, gammaPivot, offsetDegPerMs, gamma }
   * gamma bends the speed→motion mapping around gammaPivot: >1 exaggerates
   * the contrast between slow and fast flow, 1 keeps it linear.
   */
  constructor(map, canvas, field, opts) {
    this.map = map
    this.canvas = canvas
    this.field = field
    this.count = opts.count
    this._stops = opts.colorStops
    this._speedFactor = opts.speedFactor
    this._gammaPivot = opts.gammaPivot
    this._gamma = opts.gamma ?? 1.3
    this._offsetDeg = opts.offsetDegPerMs
    // Ocean layers (currents) clip their trails to the basemap's water
    // polygons — rebuilt per camera settle, applied per frame as one
    // composite — so particles stop at the true shoreline.
    this._maskKind = opts.mask || null
    this._byCoverage = !!opts.countByCoverage
    this._coverageBoost = opts.coverageBoost ?? 1
    // Draw each particle as a flapping bird sprite instead of a streak:
    // { wingspanPx, beatsPerSec } — see birdGlyph.js.
    this._glyph = opts.glyph || null
    this._mask = null
    this.visible = true
    this._destroyed = false
    this._moving = false
    this._ctx = canvas.getContext('2d')

    // During a gesture the last trails frame stays visible, camera-glued by
    // the freezer; on settle we rebuild the field and restart trails fresh.
    this._freeze = new CanvasFreezer(map, canvas)
    // Globe in view: particles are re-projected live through the exact
    // globe geometry every frame of the gesture, so the field turns WITH the
    // planet (an affine slide of the trails is wrong on a sphere — it left
    // smears past the rim). Zoomed in (horizon off-screen) the view is near
    // enough to flat that the affine freezer is exact, and far cheaper.
    this._onMoveStart = () => {
      this._moving = true
      this._liveMove = !!this._geo
      if (this._liveMove) { this._geo0 = this._geo; this._clear() } else this._freeze.begin()
    }
    this._onMoveEnd = () => {
      this._moving = false
      this._liveMove = false
      this._rebuild(); this._clear(); this._freeze.end()
    }
    this._onResize = () => this._rebuild()
    // Water tiles for a freshly-panned area may still be loading at settle;
    // refresh just the mask once the map goes idle.
    this._onIdle = () => {
      if (this._maskKind && !this._moving && this._w && Date.now() - (this._maskAt || 0) > 400) {
        this._mask = this._buildMask(getGlobeGeometry(map, this._w, this._h))
        this._maskAt = Date.now()
      }
    }
    map.on('movestart', this._onMoveStart)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    map.on('idle', this._onIdle)

    this._rebuild()
    this._lastT = 0
    // No frames are even scheduled while the tab is hidden or the page has
    // sat idle (activity.js); waking restarts the loop.
    this._stopLoop = runWhileAwake((now) => { if (!this._destroyed) this._frame(now) })
  }

  _bucketIndex(speed) {
    for (let i = this._stops.length - 1; i >= 0; i--) {
      if (speed >= this._stops[i][0]) return i
    }
    return 0
  }

  setCount(count) {
    this.count = count
    this._spawnAll()
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) this._clear()
    else this._spawnAll()
  }

  destroy() {
    this._destroyed = true
    this._stopLoop()
    this.map.off('movestart', this._onMoveStart)
    this.map.off('moveend', this._onMoveEnd)
    this.map.off('resize', this._onResize)
    this.map.off('idle', this._onIdle)
    this._freeze.destroy()
    this._clear()
  }

  _clear() {
    this._ctx.setTransform(1, 0, 0, 1, 0, 0)
    this._ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  // ── Screen-space vector field ────────────────────────────────────────────
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

    // Fully normalized screen speed reads faint over zoomed-in imagery
    // (short trails, thin strokes on busy terrain) — let trails grow gently
    // past THIN_ZOOM (~2× by z11, ~2.8× by z13) and weight the stroke a
    // touch, so a localized fire still shows a legible wind.
    const zNow = map.getZoom()
    const boost = zNow > THIN_ZOOM ? Math.pow(2, (zNow - THIN_ZOOM) * 0.25) : 1
    const zoomScale = Math.max(MIN_ZOOM_SCALE, Math.pow(2, BASE_ZOOM - zNow)) * boost
    this._zoomScale = zoomScale
    this._lineWidth = zNow > THIN_ZOOM ? Math.min(1.7, 1.1 + 0.15 * (zNow - THIN_ZOOM)) : 1.1
    const cols = Math.ceil(w / GRID_STEP) + 1
    const rows = Math.ceil(h / GRID_STEP) + 1
    const n = cols * rows
    this._cols = cols
    this._rows = rows
    this._vx = new Float32Array(n)
    this._vy = new Float32Array(n)
    this._spd = new Float32Array(n)
    this._ok = new Uint8Array(n)

    // Exact globe inverse when the horizon is on screen (Mapbox's unproject
    // under-covers the disc there); Mapbox's own, round-trip checked, when
    // zoomed in. Everything through the projection stays guarded.
    const geo = getGlobeGeometry(map, w, h)
    this._geo = geo
    const unprojectAt = (x, y) => {
      if (geo) return geo.unproject(x, y)
      let ll, rt
      try { ll = map.unproject([x, y]) } catch { return null }
      if (!ll || !Number.isFinite(ll.lng) || !Number.isFinite(ll.lat)) return null
      try { rt = map.project(ll) } catch { return null }
      if (!rt || Math.abs(rt.x - x) + Math.abs(rt.y - y) > PROJ_TOLERANCE) return null
      return ll
    }

    const nodes = {
      x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), ok: new Uint8Array(n),
      lng: new Float32Array(n), lat: new Float32Array(n),
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const idx = j * cols + i
        const x = i * GRID_STEP
        const y = j * GRID_STEP
        const ll = unprojectAt(x, y)
        if (!ll) continue
        const u = toUnit(ll.lng, ll.lat)
        nodes.x[idx] = u[0]; nodes.y[idx] = u[1]; nodes.z[idx] = u[2]; nodes.ok[idx] = 1
        nodes.lng[idx] = ll.lng; nodes.lat[idx] = ll.lat
        this._sampleNode(idx, x, y, ll.lng, ll.lat)
      }
    }
    this._nodes = nodes
    this._spawnAll()
    this._mask = this._buildMask(geo)
    this._maskAt = Date.now()
    this._freeze.capture()
  }

  // One screen node's motion from the field at its lng/lat. `colorValue`
  // lets a field color its streaks by something other than speed (bird
  // flight is colored by how many birds are crossing, not how fast).
  _sampleNode(idx, x, y, lng, lat) {
    this._ok[idx] = 0
    const flow = this.field.sample(lng, lat)
    if (!flow) return
    let tip
    const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180))
    const tipLat = Math.max(-89.9, Math.min(89.9, lat + flow.v * this._offsetDeg))
    try { tip = this.map.project([lng + (flow.u * this._offsetDeg) / cosLat, tipLat]) } catch { return }
    if (!tip || !Number.isFinite(tip.x) || !Number.isFinite(tip.y)) return
    const shape = this._zoomScale * Math.pow(Math.max(flow.speed, this._gammaPivot / 50) / this._gammaPivot, this._gamma - 1)
    this._vx[idx] = (tip.x - x) * shape
    this._vy[idx] = (tip.y - y) * shape
    this._spd[idx] = flow.colorValue ?? flow.speed
    this._ok[idx] = 1
  }

  /**
   * Re-read the field at every node WITHOUT touching the camera, trails or
   * particles — for fields that change under a fixed view (a replay cursor
   * moving through time). Particles over cells that went quiet die at their
   * next step; new ones spawn onto cells that woke up.
   */
  resample() {
    const nodes = this._nodes
    if (!nodes || this._moving || !this._ok) return
    for (let j = 0; j < this._rows; j++) {
      for (let i = 0; i < this._cols; i++) {
        const idx = j * this._cols + i
        if (!nodes.ok[idx]) continue
        this._sampleNode(idx, i * GRID_STEP, j * GRID_STEP, nodes.lng[idx], nodes.lat[idx])
      }
    }
    if (this._byCoverage && this._age) {
      const n = this._activeCount()
      for (let i = this._n; i < n; i++) this._age[i] = 0 // newly active → spawn next frame
      this._n = n
    }
  }

  // Water mask: baked land raster at globe zooms (robust at the limb, honors
  // skinny peninsulas), basemap vector polygons when zoomed in (exact).
  _buildMask(geo) {
    if (this._maskKind !== 'water' || !this._nodes) return null
    const { map, canvas } = this
    if (geo) {
      const bits = getLandMaskSync()
      if (!bits) {
        loadLandMask().then(() => { if (!this._destroyed) this._mask = this._buildMask(getGlobeGeometry(map, this._w, this._h)) }).catch(() => {})
        return null
      }
      return buildGlobeWaterMask(bits, this._nodes, this._cols, this._rows, GRID_STEP, this._w, this._h, canvas.width, canvas.height)
    }
    return buildWaterMask(map, canvas.width, canvas.height, this._w, this._h, geo)
  }

  _spawnAll() {
    const z = this.map.getZoom()
    const thin = Math.max(THIN_FLOOR, Math.min(1, Math.pow(2, -(z - THIN_ZOOM) / 2)))
    const n = Math.max(0, Math.round(this.count * thin))
    this._cap = n
    this._px = new Float32Array(n)
    this._py = new Float32Array(n)
    this._age = new Float32Array(n)
    this._phase = new Float32Array(n)
    this._life = new Float32Array(n)  // glyph mode: age at spawn (for the fade-in)
    this._lvx = new Float32Array(n)   // glyph mode: last good velocity, so a bird
    this._lvy = new Float32Array(n)   // leaving the field glides out instead of vanishing
    this._lspd = new Float32Array(n)
    for (let i = 0; i < n; i++) this._phase[i] = Math.random()
    this._n = this._activeCount()
    for (let i = 0; i < this._n; i++) this._spawn(i)
  }

  // Regional / patchy fields (bird flight covers one country, and only where
  // birds are flying) keep the SAME streak density per unit of live area as a
  // global field: the particle budget scales with the share of on-screen
  // nodes that carry flow, instead of cramming the whole budget into it.
  _activeCount() {
    if (!this._byCoverage || !this._ok) return this._cap
    let live = 0, seen = 0
    const vis = this._nodes?.ok
    for (let i = 0; i < this._ok.length; i++) { if (!vis || vis[i]) seen++; if (this._ok[i]) live++ }
    return Math.min(this._cap, Math.round(this._cap * this._coverageBoost * (seen ? live / seen : 0)))
  }

  _spawn(i) {
    // Field not built yet (canvas had no size at construction) — park the
    // particle; the frame loop rebuilds once real dimensions exist.
    if (!this._ok) { this._age[i] = 0; return }
    // Rejection-sample onto valid cells (visible globe face, and for ocean
    // layers the water itself) so particles don't pool in dead space.
    for (let tries = 0; tries < 8; tries++) {
      const x = Math.random() * this._w
      const y = Math.random() * this._h
      const ci = Math.min(this._cols - 1, Math.round(x / GRID_STEP))
      const cj = Math.min(this._rows - 1, Math.round(y / GRID_STEP))
      if (this._ok[cj * this._cols + ci]) {
        this._px[i] = x
        this._py[i] = y
        // Streaks live ~1 s (the trail carries continuity). A bird is an
        // object the eye follows: it lives 10–25 s and eases in and out.
        this._age[i] = this._glyph ? 600 + Math.random() * 900 : 20 + Math.random() * 80
        if (this._life) { this._life[i] = this._age[i]; this._lvx[i] = 0; this._lvy[i] = 0 }
        return
      }
    }
    this._age[i] = 0
  }

  _fieldAt(x, y, out) {
    const gx = x / GRID_STEP
    const gy = y / GRID_STEP
    const i0 = Math.floor(gx)
    const j0 = Math.floor(gy)
    if (i0 < 0 || j0 < 0 || i0 >= this._cols - 1 || j0 >= this._rows - 1) return false
    const c = this._cols
    const a = j0 * c + i0
    if (!(this._ok[a] && this._ok[a + 1] && this._ok[a + c] && this._ok[a + c + 1])) return false
    const fx = gx - i0
    const fy = gy - j0
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
    out.vx = this._vx[a] * w00 + this._vx[a + 1] * w10 + this._vx[a + c] * w01 + this._vx[a + c + 1] * w11
    out.vy = this._vy[a] * w00 + this._vy[a + 1] * w10 + this._vy[a + c] * w01 + this._vy[a + c + 1] * w11
    out.spd = this._spd[a] * w00 + this._spd[a + 1] * w10 + this._spd[a + c] * w01 + this._spd[a + c + 1] * w11
    return true
  }

  // During a globe drag: map each particle (and its velocity tip) from the
  // screen space the field was built in → lng/lat → the current camera, and
  // draw it as a short comet. No fade history (trails can't be re-projected
  // cheaply); they regrow within a second of the gesture settling.
  _drawMoving() {
    const { map } = this
    const g0 = this._geo0
    if (!g0 || !this._px) return
    const w = this._w, h = this._h
    const g1 = getGlobeGeometry(map, w, h)
    const ctx = this._ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    if (!g1) return
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0)
    ctx.lineWidth = this._lineWidth || 1.1
    ctx.lineCap = 'round'
    const paths = this._stops.map(() => new Path2D())
    const sample = { vx: 0, vy: 0, spd: 0 }
    const tail = this._speedFactor * 6
    const bits = this._maskKind === 'water' ? getLandMaskSync() : null
    for (let i = 0; i < this._n; i++) {
      const x = this._px[i], y = this._py[i]
      if (!this._fieldAt(x, y, sample)) continue
      const a = g0.unproject(x, y)
      if (!a) continue
      if (bits && isLand(bits, a.lng, a.lat)) continue
      const pa = g1.project(a.lng, a.lat)
      if (!pa) continue
      const b = g0.unproject(x - sample.vx * tail, y - sample.vy * tail)
      const pb = b ? g1.project(b.lng, b.lat) : null
      const p = paths[this._bucketIndex(sample.spd)]
      p.moveTo(pb ? pb.x : pa.x, pb ? pb.y : pa.y)
      p.lineTo(pa.x, pa.y)
    }
    ctx.globalAlpha = 0.85
    for (let b = 0; b < paths.length; b++) { ctx.strokeStyle = this._stops[b][1]; ctx.stroke(paths[b]) }
    ctx.globalAlpha = 1
  }

  // ── Per-frame advection + draw ───────────────────────────────────────────
  // Glyph mode: same particles, same field, same relative speeds — each drawn
  // as a pre-rendered flapping sprite rotated to its heading. No trails.
  _frameGlyphs(k, dtMs) {
    const ctx = this._ctx
    const dpr = this._dpr
    const g = this._glyph
    if (!this._sprites || this._spritesDpr !== dpr) {
      this._sprites = this._stops.map(([, color]) => buildBirdSprites(color, g.wingspanPx, dpr))
      this._spritesDpr = dpr
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    const sample = { vx: 0, vy: 0, spd: 0 }
    const dPhase = (g.beatsPerSec * dtMs) / 1000
    for (let i = 0; i < this._n; i++) {
      if ((this._age[i] -= k) <= 0) { this._spawn(i); continue }
      const x = this._px[i]
      const y = this._py[i]
      const FADE_FRAMES = 45 // ≈0.75 s in and out
      if (this._fieldAt(x, y, sample)) { this._lvx[i] = sample.vx; this._lvy[i] = sample.vy; this._lspd[i] = sample.spd } else {
        // Flew out of the observed field (or the field went quiet under it):
        // keep its last heading and fade out, rather than blinking off.
        if (!this._lvx[i] && !this._lvy[i]) { this._spawn(i); continue }
        if (this._age[i] > FADE_FRAMES) { this._life[i] -= this._age[i] - FADE_FRAMES; this._age[i] = FADE_FRAMES }
        sample.vx = this._lvx[i]; sample.vy = this._lvy[i]; sample.spd = this._lspd[i]
      }
      const nx = x + sample.vx * this._speedFactor * k
      const ny = y + sample.vy * this._speedFactor * k
      this._px[i] = nx
      this._py[i] = ny
      const len = Math.hypot(sample.vx, sample.vy)
      if (len < 1e-4) continue
      const sp = this._sprites[this._bucketIndex(sample.spd)]
      const ph = (this._phase[i] = (this._phase[i] + dPhase * (0.85 + 0.3 * ((i * 0.618) % 1))) % 1)
      const c = sample.vx / len, sn = sample.vy / len
      ctx.globalAlpha = Math.max(0, Math.min(1, this._age[i] / FADE_FRAMES, (this._life[i] - this._age[i]) / FADE_FRAMES))
      ctx.setTransform(c, sn, -sn, c, nx * dpr, ny * dpr)
      ctx.drawImage(sp.canvas, Math.floor(ph * sp.phases) * sp.side, 0, sp.side, sp.side, -sp.side / 2, -sp.side / 2, sp.side, sp.side)
    }
    ctx.globalAlpha = 1
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  _frame(now) {
    // Time-based stepping so the animation runs at the same real speed on
    // 60 Hz and 120 Hz displays (and after background-tab gaps): k is "how
    // many 60fps frames of motion elapsed", clamped so a long stall doesn't
    // teleport particles.
    const dt = this._lastT ? Math.min(50, Math.max(4, now - this._lastT)) : 16.7
    this._lastT = now
    const k = dt / 16.7
    if (!this.visible || document.hidden) return
    if (this._moving) { if (this._liveMove && !this._glyph) this._drawMoving(); return }
    // Self-heal: the canvas can measure 0×0 at construction (pre-layout), and
    // window resizes don't always fire the map's resize event first — rebuild
    // whenever the css size disagrees with the field we built.
    const cw = this.canvas.clientWidth
    const ch = this.canvas.clientHeight
    if (!cw || !ch) return
    if (!this._ok || cw !== this._w || ch !== this._h) this._rebuild()
    if (!this._ok || !this._px) return
    const ctx = this._ctx
    const dpr = this._dpr
    if (this._glyph) { this._frameGlyphs(k, dt); return }

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = `rgba(0,0,0,${Math.pow(FADE, k)})`
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineWidth = this._lineWidth || 1.1
    ctx.lineCap = 'round'

    const paths = this._stops.map(() => new Path2D())
    const sample = { vx: 0, vy: 0, spd: 0 }
    for (let i = 0; i < this._n; i++) {
      if ((this._age[i] -= k) <= 0) { this._spawn(i); continue }
      const x = this._px[i]
      const y = this._py[i]
      if (!this._fieldAt(x, y, sample)) { this._spawn(i); continue }
      const nx = x + sample.vx * this._speedFactor * k
      const ny = y + sample.vy * this._speedFactor * k
      const p = paths[this._bucketIndex(sample.spd)]
      p.moveTo(x, y)
      p.lineTo(nx, ny)
      this._px[i] = nx
      this._py[i] = ny
    }
    for (let b = 0; b < paths.length; b++) {
      ctx.strokeStyle = this._stops[b][1]
      ctx.stroke(paths[b])
    }
    if (this._mask) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(this._mask, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}
