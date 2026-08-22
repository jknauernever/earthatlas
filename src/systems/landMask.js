/**
 * Raster land mask for /systems globe views (Natural Earth 10 m land,
 * baked to 0.1° by scripts/bake-land-mask.mjs → public/systems/).
 *
 * Why a raster: at globe zooms, clipping ocean overlays to the basemap's
 * vector water tiles proved fragile — Mapbox culls/excludes tiles near the
 * limb (holes) and low-zoom generalized polygons bridged by 8 px node
 * interpolation let the wash paint over skinny land (Florida, Greece). A
 * 0.1° bitmask is deterministic, limb-independent, and under 2 px at every
 * zoom where the horizon is on screen. Zoomed in, the vector mask is exact
 * and stays in use.
 */

const RES = 0.1
const COLS = 3600
const ROWS = 1800
const D2R = Math.PI / 180

let bits = null
let loading = null

export function loadLandMask() {
  if (bits) return Promise.resolve(bits)
  if (!loading) {
    loading = fetch('/systems/land-mask-0p1.bin')
      .then((r) => { if (!r.ok) throw new Error(`land mask ${r.status}`); return r.arrayBuffer() })
      .then((buf) => { bits = new Uint8Array(buf); return bits })
      .catch((err) => { loading = null; throw err })
  }
  return loading
}

export function getLandMaskSync() {
  return bits
}

export function isLand(b, lng, lat) {
  const r = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / RES)))
  const c = Math.floor(((((lng + 180) % 360) + 360) % 360) / RES) % COLS
  const i = r * COLS + c
  return (b[i >> 3] & (0x80 >> (i & 7))) !== 0
}

/**
 * Build a water mask canvas (opaque where water) from a renderer's node grid.
 * nodes: { x, y, z: Float32Array unit vectors per node, ok: Uint8Array }
 * laid out cols×rows at `step` css px. Pixels interpolate the unit vectors
 * of their surrounding valid nodes (renormalized), convert to lng/lat, and
 * test the bitmask — computed at half resolution and upscaled with smoothing
 * for a soft ~1 px coast.
 */
export function buildGlobeWaterMask(b, nodes, cols, rows, step, w, h, devW, devH) {
  const rw = Math.ceil(w / 2)
  const rh = Math.ceil(h / 2)
  const off = document.createElement('canvas')
  off.width = rw
  off.height = rh
  const octx = off.getContext('2d')
  const img = octx.createImageData(rw, rh)
  const data = img.data
  const { x: nx, y: ny, z: nz, ok } = nodes
  for (let py = 0; py < rh; py++) {
    const gy = (py * 2 + 1) / step
    const j0 = Math.min(rows - 2, Math.floor(gy))
    const fy = gy - j0
    for (let px = 0; px < rw; px++) {
      const gx = (px * 2 + 1) / step
      const i0 = Math.min(cols - 2, Math.floor(gx))
      const fx = gx - i0
      const a = j0 * cols + i0
      let sx = 0, sy = 0, sz = 0, ws = 0
      const acc = (idx, wgt) => { if (ok[idx]) { sx += nx[idx] * wgt; sy += ny[idx] * wgt; sz += nz[idx] * wgt; ws += wgt } }
      acc(a, (1 - fx) * (1 - fy))
      acc(a + 1, fx * (1 - fy))
      acc(a + cols, (1 - fx) * fy)
      acc(a + cols + 1, fx * fy)
      if (ws < 0.05) continue
      const len = Math.hypot(sx, sy, sz) || 1
      const lat = Math.asin(sz / len) / D2R
      const lng = Math.atan2(sy, sx) / D2R
      if (isLand(b, lng, lat)) continue
      const o = (py * rw + px) * 4
      data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  const mask = document.createElement('canvas')
  mask.width = devW
  mask.height = devH
  const mctx = mask.getContext('2d')
  mctx.imageSmoothingEnabled = true
  mctx.drawImage(off, 0, 0, rw, rh, 0, 0, devW, devH)
  return mask
}

/** Unit vector for a lng/lat (for node grids). */
export function toUnit(lng, lat) {
  const cl = Math.cos(lat * D2R)
  return [cl * Math.cos(lng * D2R), cl * Math.sin(lng * D2R), Math.sin(lat * D2R)]
}
