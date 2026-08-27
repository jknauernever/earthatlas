/**
 * Shared flame marker glyph — the fire iconography used across earthatlas
 * map tools (same paths as /fire's Mapbox symbol icons in src/fire/usFires.js;
 * this module draws them straight onto 2D canvas overlays like /inmotion's).
 *
 * States follow containment, Watch-Duty-style semantics with our own
 * clean-room drawing: red flame = fighting it (<50% contained), orange =
 * half contained, gray flame with a warm core = mostly contained, all-gray
 * = fully contained. The white halo is what keeps the marker legible over
 * any terrain.
 */

// INTERIM ART: the original approved /fire flame (teardrop + inner glint)
// until the designed icon set arrives — this module is the single seam for
// that swap: replace the Path2D drawing in drawFlame with the provided
// per-state images and both /fire and /inmotion pick them up.
export const FLAME_PATH = 'M24 3 C 31 13 43 19 40.5 32 C 39 40.6 32.6 46 24 46 C 15.4 46 9 40.6 7.5 32 C 5 19 17 13 24 3 Z'
export const FLAME_INNER = 'M24 20 C 28 25 34 28 32 35 C 31 39.6 27.6 43 24 43 C 20.4 43 17 39.6 16 35 C 14 28 20 25 24 20 Z'

export const FLAME_STATES = {
  uncontained: { fill: '#ff3b30', inner: '#ffd98a', label: 'active — less than half contained' },
  partial: { fill: '#ff9500', inner: '#ffe6b0', label: 'active — half contained' },
  mostly: { fill: '#8e959c', inner: '#ffcf4d', label: 'mostly contained' },
  contained: { fill: '#9aa0a6', inner: '#d9dde1', label: 'fully contained' },
}

export const flameStateOf = (contained) =>
  contained == null || contained < 50 ? 'uncontained'
    : contained < 75 ? 'partial'
      : contained < 100 ? 'mostly'
        : 'contained'

let flamePath = null
let innerPath = null

/**
 * Draw one flame centered on (cx, cy) at height h (px) into a 2D context.
 * The native glyph box is 48×48 (paths span x 7.5–40.5, y 2.5–46).
 * opts.badge draws the light circular backing that keeps the marker legible
 * over busy satellite terrain.
 */
export function drawFlame(ctx, cx, cy, h, state, opts = {}) {
  if (!flamePath) { flamePath = new Path2D(FLAME_PATH); innerPath = new Path2D(FLAME_INNER) }
  const s = FLAME_STATES[state] || FLAME_STATES.uncontained
  const scale = h / 46
  ctx.save()
  if (opts.badge) {
    ctx.beginPath()
    ctx.arc(cx, cy + 1.5 * scale, 26 * scale, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(245,244,241,0.9)'
    ctx.fill()
    ctx.lineWidth = Math.max(1, 1.2 * scale)
    ctx.strokeStyle = 'rgba(10,14,23,0.25)'
    ctx.stroke()
  }
  ctx.translate(cx - 24 * scale, cy - 22.5 * scale)
  ctx.scale(scale, scale)
  ctx.lineJoin = 'round'
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3
  ctx.stroke(flamePath)
  ctx.stroke(flamePath) // doubled = solid halo
  ctx.fillStyle = s.fill
  ctx.fill(flamePath)
  ctx.globalAlpha = 0.85
  ctx.fillStyle = s.inner
  ctx.fill(innerPath)
  ctx.restore()
}
