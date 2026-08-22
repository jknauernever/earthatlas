/**
 * Scalar color overlay for /systems (sea-surface temperature, wave height) —
 * paints the field as translucent colored cells on a canvas above the map.
 *
 * Same screen-space approach as the particle layer: on each camera settle,
 * walk a coarse pixel grid, unproject each cell center (with the globe
 * horizon round-trip check), sample the scalar field, and fill the cell from
 * a color LUT. Nothing runs per-frame — the paint is static until the camera
 * moves — so the rAF loop only watches for size changes (self-heal) and
 * movement. Missing data (land, ice mask) stays transparent.
 */

import { CanvasFreezer } from './canvasFreeze.js'
import { TapeWarpGL } from './tapeWarpGL.js'
import { getGlobeGeometry, angDist, bearing, destination } from './globeGeom.js'
import { loadLandMask, getLandMaskSync, buildGlobeWaterMask, toUnit, isLand } from './landMask.js'

const NODE_PX = 8            // css px between projection/sample nodes
const IMG_SIZE = 2048        // globe-mode mercator image (px per side)
const PROJ_TOLERANCE = 3     // px round-trip error ⇒ off-globe
const LUT_SIZE = 256
const RASTER_SCALE = 2       // raster at 1/2 css resolution, smoothed up
const TAPE_IMG_SIZE = 1024   // replay frames (data is 0.4°; 1024 px ≈ 0.35°/px)

// Parse the small set of color forms layerDefs uses: rgb()/rgba(). Alpha
// (0–1, default 1) lets ramps fade to transparent — smoke/haze layers paint
// nothing where the air is clear.
function parseColor(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css)
  const parts = m[1].split(',').map(Number)
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] * 255 : 255]
}

// value → packed rgba, LUT_SIZE levels across [min, max].
export function buildLut(stops, min, max) {
  const lut = new Uint8ClampedArray(LUT_SIZE * 4)
  const parsed = stops.map(([v, c]) => [v, parseColor(c)])
  for (let i = 0; i < LUT_SIZE; i++) {
    const v = min + ((max - min) * i) / (LUT_SIZE - 1)
    let lo = parsed[0], hi = parsed[parsed.length - 1]
    for (let s = 0; s < parsed.length - 1; s++) {
      if (v >= parsed[s][0] && v <= parsed[s + 1][0]) { lo = parsed[s]; hi = parsed[s + 1]; break }
    }
    const span = hi[0] - lo[0] || 1
    const f = Math.min(1, Math.max(0, (v - lo[0]) / span))
    for (let ch = 0; ch < 4; ch++) lut[i * 4 + ch] = lo[1][ch] + (hi[1][ch] - lo[1][ch]) * f
  }
  return lut
}

// Bake the field into a full-world web-mercator image (lat ±85.05) for the
// Mapbox canvas source: one pass per layer activation, land-masked with the
// 0.1° raster so coasts are clean at globe zooms. Opacity is applied by the
// Mapbox layer, so pixels are fully opaque here.
function bakeMercatorImage(field, lut, min, max, bits, size) {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  const data = img.data
  const lutScale = (LUT_SIZE - 1) / (max - min)
  for (let y = 0; y < size; y++) {
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / size))) * 180) / Math.PI
    for (let x = 0; x < size; x++) {
      const lng = -180 + (360 * (x + 0.5)) / size
      if (bits && isLand(bits, lng, lat)) continue
      const s = field.sampleScalar(lng, lat)
      if (!s) continue
      const v = Math.min(max, Math.max(min, s.value))
      const li = Math.round((v - min) * lutScale) * 4
      const o = (y * size + x) * 4
      data[o] = lut[li]
      data[o + 1] = lut[li + 1]
      data[o + 2] = lut[li + 2]
      data[o + 3] = lut[li + 3]
    }
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// The globe's horizon circle on screen, or null when it's off-screen. Now
// derived from the exact geometry in globeGeom.js — the earlier round-trip
// search inherited Mapbox's unproject saturation and under-measured the disc
// by ~20% in large viewports (an empty ring of bare ocean around the rim).
export function findGlobeCircle(map, w, h) {
  const geo = getGlobeGeometry(map, w, h)
  return geo ? { cx: geo.cx, cy: geo.cy, r: geo.r } : null
}

// Coastline-accurate clipping: gridded ocean data can never match the
// basemap's vector shoreline (at 0.25° the boundary is a visible lattice that
// undershoots or overshoots the coast). So ocean layers paint generously —
// the bake dilates one cell toward land and the sampler tolerates missing
// corners — and then get MASKED to the style's own water polygons, which the
// renderer already has for every visible tile. Only applied once the globe's
// horizon is off-screen (polygons straddling the horizon project garbage);
// at world zoom coasts are ~1 px anyway.
/**
 * Build a water mask canvas (opaque where the basemap says water) at the
 * given device-pixel size for a css-pixel viewport of w×h. Returns null if
 * no water geometry is available. Works at every zoom: when the globe's
 * horizon is on screen (`circle`), vertices projecting from the far side of
 * the globe are pushed radially OUTSIDE the horizon circle, so front-face
 * coastlines stay exact and the far-side garbage lands where the globe clip
 * erases it anyway. Shared by the scalar wash and the particle layers.
 */
export function buildWaterMask(map, devW, devH, w, h, geo) {
  const circle = geo
  let layerIds
  try {
    layerIds = map.getLayer('systems-water-mask')
      ? ['systems-water-mask']
      : (map.getStyle()?.layers || [])
        .filter((l) => l.type === 'fill' && l['source-layer'] === 'water')
        .map((l) => l.id)
  } catch { return null }
  if (!layerIds.length) return null
  let feats
  try { feats = map.queryRenderedFeatures({ layers: layerIds }) } catch { return null }
  if (!feats.length) return null

  // Globe horizon handling: vertices on the far side are clamped onto the
  // horizon along the great circle from the view center, so a coastline
  // ring that wraps behind the globe follows the limb instead of turning
  // into chords across the disc (or requiring an unmasked rim band). The
  // horizon's angular radius is measured, not assumed: unproject a point
  // just inside the rim and take its angular distance from the center.
  const center = geo ? geo.center : null
  const thetaH = geo ? geo.thetaLimb - 0.005 : null
  const projectVertex = (lngLat) => {
    let target = lngLat
    if (center && thetaH != null && angDist(center, lngLat) > thetaH) {
      target = destination(center, bearing(center, lngLat), thetaH)
    }
    let p
    try { p = map.project(target) } catch { return null }
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null
    return p
  }
  // Walk a ring into a path, densifying long edges into short great-circle
  // steps when the horizon is on screen. Without this, an edge whose two
  // endpoints both sit behind the globe clamps to two far-apart limb points
  // and is drawn as a straight chord ACROSS the disc — the big black wedges.
  // Densified, the clamped points trace the limb arc instead.
  const STEP = 2 * Math.PI / 180
  const tracePath = (ctx2, ring) => {
    let started = false
    const n = ring.length
    for (let i = 0; i < n; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % n]
      let pts = [a]
      if (center) {
        const d = angDist(a, b)
        const steps = Math.min(180, Math.ceil(d / STEP))
        if (steps > 1) {
          const brg = bearing(a, b)
          pts = [a]
          for (let s = 1; s < steps; s++) pts.push(destination(a, brg, (d * s) / steps))
        }
      }
      for (const ll of pts) {
        const p = projectVertex(ll)
        if (!p) continue
        if (!started) { ctx2.moveTo(p.x, p.y); started = true } else ctx2.lineTo(p.x, p.y)
      }
    }
    if (started) ctx2.closePath()
    return started
  }

  const mask = document.createElement('canvas')
  mask.width = devW
  mask.height = devH
  const mctx = mask.getContext('2d')
  mctx.setTransform(devW / w, 0, 0, devH / h, 0, 0)
  mctx.fillStyle = '#000'
  for (const f of feats) {
    const g = f.geometry
    if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    for (const rings of polys) {
      mctx.beginPath()
      for (const ring of rings) tracePath(mctx, ring)
      mctx.fill('evenodd') // holes = islands
    }
  }
  // "No polygon here" must mean "no information", not "land": Mapbox does not
  // render vector tiles all the way to the horizon, and tiles in a freshly
  // panned area may still be loading. So the mask keeps the wash wherever it
  // is water OR wherever no water tile is currently rendered — the genuine
  // tile coverage from the source cache, not a guess. Without coverage
  // info at globe zoom we don't clip at all (never erase on a guess).
  let coverage = null
  try {
    const sc = map.style?.getSourceCache?.('composite')
    const ids = sc?.getRenderableIds?.() || []
    if (ids.length) {
      coverage = document.createElement('canvas')
      coverage.width = devW
      coverage.height = devH
      const cctx = coverage.getContext('2d')
      cctx.setTransform(devW / w, 0, 0, devH / h, 0, 0)
      cctx.fillStyle = '#000'
      for (const id of ids) {
        const t = sc.getTileByID ? sc.getTileByID(id) : sc.getTile(id)
        const c = t?.tileID?.canonical
        if (!c) continue
        const n = 2 ** c.z
        const lng0 = (c.x / n) * 360 - 180
        const lng1 = ((c.x + 1) / n) * 360 - 180
        const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
        const lat0 = latOf(c.y)
        const lat1 = latOf(c.y + 1)
        cctx.beginPath()
        if (tracePath(cctx, [[lng0, lat0], [lng1, lat0], [lng1, lat1], [lng0, lat1]])) cctx.fill()
      }
    }
  } catch { coverage = null }

  mctx.setTransform(1, 0, 0, 1, 0, 0)
  if (coverage) {
    // keep = water ∪ ¬coverage
    const notCov = document.createElement('canvas')
    notCov.width = devW
    notCov.height = devH
    const nctx = notCov.getContext('2d')
    nctx.fillStyle = '#000'
    nctx.fillRect(0, 0, devW, devH)
    nctx.globalCompositeOperation = 'destination-out'
    nctx.drawImage(coverage, 0, 0)
    mctx.globalCompositeOperation = 'source-over'
    mctx.drawImage(notCov, 0, 0)
  } else if (geo) {
    mctx.fillStyle = '#000'
    mctx.fillRect(0, 0, devW, devH)
  }
  return mask
}


function paintWaterMask(map, ctx, w, h, geo) {
  const mask = buildWaterMask(map, ctx.canvas.width, ctx.canvas.height, w, h, geo)
  if (!mask) return false
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0)
  ctx.globalCompositeOperation = 'source-over'
  return true
}

export class ScalarOverlayLayer {
  /** opts: { colorStops, min, max, opacity, mask: 'water' | undefined } */
  constructor(map, canvas, field, opts) {
    this.map = map
    this.canvas = canvas
    this.field = field
    this._min = opts.min
    this._max = opts.max
    this._mask = opts.mask || null
    this._opacity = opts.opacity ?? 0.6
    this._lut = buildLut(opts.colorStops, opts.min, opts.max)
    this._lutKey = JSON.stringify([opts.colorStops, opts.min, opts.max])
    // Replay: `field` is a TapeField; frames are composited (cross-faded)
    // into one persistent canvas that Mapbox re-uploads each render.
    this._tape = opts.tape ? field : null
    this.visible = true
    this._destroyed = false
    this._moving = false
    this._ctx = canvas.getContext('2d')

    // Globe mode: the field is baked ONCE into a mercator image and handed
    // to Mapbox as a canvas source draped on the globe, so the GPU projects
    // it in lockstep with the basemap — no screen-space repaint, no freeze
    // approximation, no drift during rotation. Zoomed in (horizon
    // off-screen) the screen-space painter takes over for crisp,
    // vector-masked coasts at full resolution.
    this._imgId = `systems-scalar-${Math.random().toString(36).slice(2, 8)}`
    this._img = null
    this._imgHasMask = false
    this._mode = null // 'globe' | 'screen'
    this._onStyle = () => { this._imgAdded = false; this._maskDirty = true; this._paint() }
    map.on('style.load', this._onStyle)

    // During a gesture the last wash stays visible, camera-glued by the
    // freezer; the settle repaint swaps in the true reprojection.
    this._freeze = new CanvasFreezer(map, canvas)
    this._onMoveStart = () => { this._moving = true; if (this._mode === 'screen') this._freeze.begin() }
    this._onMoveEnd = () => { this._moving = false; this._maskDirty = true; this._paint(); this._freeze.end() }
    // Screen mode only: live repaint on a throttle during gestures, with
    // the freezer's affine transform bridging the ~150 ms gaps.
    // No mid-gesture repaints: the freezer's slide and a throttled repaint
    // are two different estimates of the same pixels and alternate as
    // jitter. Zoomed in the view is near-flat, so the slide alone is exact
    // enough until moveend repaints.
    this._onMove = () => {}
    this._onResize = () => { this._maskDirty = true; this._paint() }
    // Water-masked layers repaint once the basemap settles: at moveend the
    // new area's water tiles may still be loading, and the mask would clip
    // against an incomplete coastline.
    this._onIdle = () => {
      if (this._mask && this.visible && !this._moving && Date.now() - (this._paintedAt || 0) > 400) { this._maskDirty = true; this._paint() }
    }
    map.on('movestart', this._onMoveStart)
    map.on('move', this._onMove)
    map.on('moveend', this._onMoveEnd)
    map.on('resize', this._onResize)
    map.on('idle', this._onIdle)

    this._paint()
    const loop = () => {
      if (this._destroyed) return
      // Self-heal only: repaint when layout size changes under us.
      if (this.visible && !this._moving && !document.hidden) {
        const cw = this.canvas.clientWidth
        const ch = this.canvas.clientHeight
        if (cw && ch && (cw !== this._w || ch !== this._h)) this._paint()
      }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }

  /** Replay: the tape's time changed — redraw the frame on screen. */
  tick() {
    if (!this.visible || !this._tape) return
    if (this._mode === 'globe') this._drawTapeFrame()
    else if (!this._moving && Date.now() - (this._paintedAt || 0) > 120) this._paint()
  }

  // GPU path: warp the two bracketing frames along their optical flow and
  // blend (tapeWarpGL.js). Falls back to a CPU cross-fade if WebGL is out.
  _drawTapeFrame() {
    const tape = this._tape
    if (!this._img) return
    const bits = this._mask === 'water' ? getLandMaskSync() : null
    const { i, j, mix } = tape.locate()
    const a = tape._bytes.get(i)
    if (!a) return
    const b = j !== i && mix > 0 ? tape._bytes.get(j) : null
    if (this._gl) {
      const gl = this._gl
      gl.setLut(this._lut, this._lutKey)
      gl.setMask(bits)
      const m = tape.meta
      const texA = gl.frameTexture(i, a, m.nLon, m.nLat)
      const texB = b ? gl.frameTexture(j, b, m.nLon, m.nLat) : null
      const flow = b && tape.useFlow ? tape.flowBetween(i, j) : null
      const flowTex = flow ? gl.flowTexture(i, flow) : null
      gl.draw({ meta: m, texA, texB, flowTex, flowDs: flow?.ds || 1, mix, min: this._min, max: this._max })
    } else {
      const A = tape.frameImage(i, this._lut, this._lutKey, this._min, this._max, bits, TAPE_IMG_SIZE)
      if (!A) return
      const B = b ? tape.frameImage(j, this._lut, this._lutKey, this._min, this._max, bits, TAPE_IMG_SIZE) : null
      const ctx = this._img.getContext('2d')
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.clearRect(0, 0, TAPE_IMG_SIZE, TAPE_IMG_SIZE)
      if (B) {
        // Exact linear blend (additive, premultiplied) — B *over* A at
        // alpha=mix throbbed: a translucent wash is more opaque mid-blend.
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 1 - mix; ctx.drawImage(A, 0, 0)
        ctx.globalAlpha = mix; ctx.drawImage(B, 0, 0)
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'
      } else {
        ctx.drawImage(A, 0, 0)
      }
    }
    this._drawnFrame = `${i}|${j}|${mix.toFixed(2)}`
    this.map.triggerRepaint()
  }

  setVisible(visible) {
    this.visible = visible
    if (!visible) { this._clear(); this._setImgVisible(false) }
    else this._paint()
  }

  destroy() {
    this._destroyed = true
    cancelAnimationFrame(this._raf)
    this.map.off('style.load', this._onStyle)
    this._removeImg()
    if (this._gl) { this._gl.destroy(); this._gl = null }
    this.map.off('movestart', this._onMoveStart)
    this.map.off('move', this._onMove)
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

  // ── Globe mode: mercator image draped by Mapbox ─────────────────────────
  _ensureImg() {
    const { map } = this
    const bits = getLandMaskSync()
    if (this._mask === 'water' && !bits) {
      loadLandMask().then(() => { if (!this._destroyed) { this._img = null; this._paint() } }).catch(() => {})
    }
    if (this._tape) {
      if (!this._img) {
        try {
          this._gl = new TapeWarpGL(TAPE_IMG_SIZE)
          this._img = this._gl.canvas
        } catch (err) {
          console.warn('[systems] tape WebGL unavailable, using cross-fade:', err)
          this._gl = null
          this._img = document.createElement('canvas')
          this._img.width = TAPE_IMG_SIZE
          this._img.height = TAPE_IMG_SIZE
        }
        this._imgAdded = false
      }
      this._drawTapeFrame()
    } else if (!this._img || (this._mask === 'water' && bits && !this._imgHasMask)) {
      this._img = bakeMercatorImage(this.field, this._lut, this._min, this._max,
        this._mask === 'water' ? bits : null, IMG_SIZE)
      this._imgHasMask = !!(this._mask === 'water' && bits)
      this._imgAdded = false
    }
    if (this._imgAdded && map.getSource(this._imgId)) return
    try {
      if (map.getLayer(this._imgId)) map.removeLayer(this._imgId)
      if (map.getSource(this._imgId)) map.removeSource(this._imgId)
      map.addSource(this._imgId, {
        type: 'canvas',
        canvas: this._img,
        animate: !!this._tape,
        coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]],
      })
      // Below the style's labels so place names stay readable over the wash.
      const firstSymbol = (map.getStyle()?.layers || []).find((l) => l.type === 'symbol')?.id
      map.addLayer({
        id: this._imgId,
        type: 'raster',
        source: this._imgId,
        paint: { 'raster-opacity': this._opacity, 'raster-fade-duration': 0 },
      }, firstSymbol)
      this._imgAdded = true
    } catch (err) {
      console.warn('[systems] scalar image layer failed:', err)
    }
  }

  _setImgVisible(visible) {
    try {
      if (this.map.getLayer(this._imgId)) {
        this.map.setLayoutProperty(this._imgId, 'visibility', visible ? 'visible' : 'none')
      }
    } catch { /* style mid-swap */ }
  }

  _removeImg() {
    try {
      if (this.map.getLayer(this._imgId)) this.map.removeLayer(this._imgId)
      if (this.map.getSource(this._imgId)) this.map.removeSource(this._imgId)
    } catch { /* style gone */ }
    this._imgAdded = false
  }

  // Smooth painting: sample the field on a sparse node grid (NODE_PX css px,
  // with the globe-horizon round-trip check per node), then bilinearly
  // interpolate node VALUES per pixel into a half-resolution ImageData and
  // draw it scaled up with browser smoothing. Value interpolation is
  // antimeridian-safe (unlike interpolating lng/lat) and turns both the
  // paint cells and the data grid into continuous gradients. Pixels whose
  // surrounding nodes are partly invalid (coasts, globe rim) take the
  // nearest valid node's value, so edges stay within ~NODE_PX of truth.
  _paint() {
    if (!this.visible) return
    const { map, canvas } = this
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (!w || !h) return
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    this._w = w
    this._h = h
    this._paintedAt = Date.now()

    const geo = getGlobeGeometry(map, w, h)

    // Globe mode → Mapbox-draped image; clear our canvas and bail.
    if (geo) {
      if (this._mode !== 'globe') { this._mode = 'globe'; this._freeze.end() }
      this._clear()
      this._ensureImg()
      this._setImgVisible(true)
      return
    }
    if (this._mode !== 'screen') { this._mode = 'screen'; this._setImgVisible(false) }

    // 1. Node grid: value or NaN per node. Exact globe inverse when the
    // horizon is on screen (Mapbox's unproject under-covers the disc there);
    // Mapbox's own unproject (with round-trip check) when zoomed in.
    const unprojectAt = (x, y) => {
      if (geo) return geo.unproject(x, y)
      let ll, rt
      try { ll = map.unproject([x, y]) } catch { return null }
      if (!ll || !Number.isFinite(ll.lng) || !Number.isFinite(ll.lat)) return null
      try { rt = map.project(ll) } catch { return null }
      if (!rt || Math.abs(rt.x - x) + Math.abs(rt.y - y) > PROJ_TOLERANCE) return null
      return ll
    }
    const cols = Math.ceil(w / NODE_PX) + 1
    const rows = Math.ceil(h / NODE_PX) + 1
    const vals = new Float32Array(cols * rows).fill(NaN)
    // Unit vectors per node feed the raster land mask at globe zooms.
    const nodes = {
      x: new Float32Array(cols * rows), y: new Float32Array(cols * rows),
      z: new Float32Array(cols * rows), ok: new Uint8Array(cols * rows),
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const ll = unprojectAt(i * NODE_PX, j * NODE_PX)
        if (!ll) continue
        const k = j * cols + i
        const u = toUnit(ll.lng, ll.lat)
        nodes.x[k] = u[0]; nodes.y[k] = u[1]; nodes.z[k] = u[2]; nodes.ok[k] = 1
        const s = this.field.sampleScalar(ll.lng, ll.lat)
        if (s) vals[k] = Math.min(this._max, Math.max(this._min, s.value))
      }
    }

    // 2. Half-resolution raster, bilinear across nodes.
    const rw = Math.ceil(w / RASTER_SCALE)
    const rh = Math.ceil(h / RASTER_SCALE)
    if (!this._off || this._off.width !== rw || this._off.height !== rh) {
      this._off = document.createElement('canvas')
      this._off.width = rw
      this._off.height = rh
      this._offCtx = this._off.getContext('2d')
    }
    const img = this._offCtx.createImageData(rw, rh)
    const data = img.data
    const lut = this._lut
    const lutScale = (LUT_SIZE - 1) / (this._max - this._min)
    const alpha = Math.round(this._opacity * 255)
    const nodeStep = NODE_PX / RASTER_SCALE // node spacing in raster px

    for (let y = 0; y < rh; y++) {
      const gy = y / nodeStep
      const j0 = Math.min(rows - 2, Math.floor(gy))
      const fy = gy - j0
      for (let x = 0; x < rw; x++) {
        const gx = x / nodeStep
        const i0 = Math.min(cols - 2, Math.floor(gx))
        const fx = gx - i0
        const a = j0 * cols + i0
        const v00 = vals[a], v10 = vals[a + 1], v01 = vals[a + cols], v11 = vals[a + cols + 1]
        let v, cov = 1
        if (v00 === v00 && v10 === v10 && v01 === v01 && v11 === v11) {
          v = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy
        } else {
          // Partial validity (coasts, globe rim): weight-average the valid
          // corners and feather alpha by their coverage — edges fade out
          // smoothly instead of snapping to 8px blocks. (NaN-safe via
          // self-equality checks.)
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy
          let ws = 0, vs = 0
          if (v00 === v00) { ws += w00; vs += v00 * w00 }
          if (v10 === v10) { ws += w10; vs += v10 * w10 }
          if (v01 === v01) { ws += w01; vs += v01 * w01 }
          if (v11 === v11) { ws += w11; vs += v11 * w11 }
          if (ws < 0.05) continue // effectively invalid → transparent
          v = vs / ws
          cov = ws
        }
        const li = Math.round((v - this._min) * lutScale) * 4
        const px = (y * rw + x) * 4
        data[px] = lut[li]
        data[px + 1] = lut[li + 1]
        data[px + 2] = lut[li + 2]
        data[px + 3] = ((alpha * cov * lut[li + 3]) / 255) | 0
      }
    }
    this._offCtx.putImageData(img, 0, 0)

    // 3. Scale up with smoothing onto the visible canvas.
    const ctx = this._ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(this._off, 0, 0, rw, rh, 0, 0, w, h)

    this._freeze.capture()
    // 4. Clip to the globe's true horizon circle: crisp edge exactly at the
    // rim with a few px of soft falloff inside it, erasing the smeared
    // foreshortened fringe the node interpolation produces out there.
    const circle = geo
    // 5. Ocean layers: trim to the coastline. Zoomed in (no horizon) the
    // basemap's vector water polygons are exact; at globe zooms they proved
    // fragile near the limb, so the baked 0.1° land raster takes over there.
    if (this._mask === 'water') {
      if (geo) {
        const bits = getLandMaskSync()
        if (bits) {
          const m = buildGlobeWaterMask(bits, nodes, cols, rows, NODE_PX, w, h, canvas.width, canvas.height)
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.globalCompositeOperation = 'destination-in'
          ctx.drawImage(m, 0, 0)
          ctx.globalCompositeOperation = 'source-over'
        } else {
          loadLandMask().then(() => { if (!this._destroyed) this._paint() }).catch(() => {})
        }
      } else {
        // Replay repaints every tick; the basemap water mask is rebuilt only
        // when the camera or tile set changes (moveend/idle), otherwise a
        // half-loaded tile pass would flicker the coastline between ticks.
        const camKey = `${map.getCenter().lng.toFixed(4)}|${map.getCenter().lat.toFixed(4)}|${map.getZoom().toFixed(3)}|${w}x${h}`
        const reuse = this._tape && this._maskCache && this._maskCache.key === camKey && !this._maskDirty
        const mask = reuse ? this._maskCache.mask : buildWaterMask(map, ctx.canvas.width, ctx.canvas.height, w, h, geo)
        if (mask) {
          if (!reuse) { this._maskCache = { key: camKey, mask }; this._maskDirty = false }
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.globalCompositeOperation = 'destination-in'
          ctx.drawImage(mask, 0, 0)
          ctx.globalCompositeOperation = 'source-over'
        }
      }
    }
    if (circle) {
      const { cx, cy, r } = circle
      ctx.globalCompositeOperation = 'destination-in'
      const g = ctx.createRadialGradient(cx, cy, Math.max(0, r - 10), cx, cy, Math.max(1, r - 2))
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}
