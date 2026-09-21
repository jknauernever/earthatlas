/**
 * Bird glyph for the flight layer (bird migration).
 *
 * Art: one silhouette from "Flock of Birds" by Joe Looney, the Noun Project
 * (noun_FlockofBirds_60214), CC BY 3.0. The required credit lives in the
 * "How this is sourced" modal (SystemsApp.jsx, "Artwork") — keep the two
 * together: if this art ships, that credit ships.
 *
 * The art is a single outline (no separate wings), so the wingbeat is made by
 * splitting it along the body line and folding each half toward the body,
 * wingtips sweeping back on the downstroke. Frames are pre-rendered once per
 * colour into small sprites; the per-frame cost is one drawImage per bird.
 */

const ART = new Path2D('M45.254,5.646c0.655,1.1,1.717,1.812,2.648,2.622 c-1.059-0.356-2.059-0.846-3.083-1.274c-0.087,0.059-0.238,0.176-0.325,0.235c1.074,1.079,1.745,2.503,2.964,3.433 c-0.126,0.213-0.24,0.416-0.377,0.618c1.505,1.069,2.633,2.538,3.742,3.984c1.286,1.645,3.108,2.823,4.221,4.626 c1.015,1.85,2.539,3.338,3.556,5.167c0.52,0.881,1.012,1.551,1.785,1.93c0.59,1.159,1.484,2.14,1.604,3.505 c-2.45,1.12-5.098,1.505-7.703,2.169c-1.803,0.494-3.775,0.427-5.489,1.239c0.798,0.552,1.773,0.486,2.677,0.207 c0.724,0.78,1.829,0.835,2.804,0.592c-0.01,0.188-0.02,0.376-0.039,0.573c0.634,0.063,1.27,0.105,1.905,0.147 c0.054,0.171,0.108,0.341,0.173,0.521c0.929,0.235,1.783,0.696,2.714,0.932c0.732,0.173,0.976,0.969,1.464,1.443 c1.012,0.877,1.639,2.122,2.003,3.405c0.067,0.317,0.407,0.429,0.66,0.577c0.179,0.615,0.346,1.241,0.63,1.819 c0.163-0.326,0.327-0.674,0.419-1.034c0.67-3.135,1.061-6.314,1.762-9.438c0.012-0.448,0.674-0.51,0.932-0.225 c1.145,1.136,2.875,1.243,4.181,2.114c0.484,0.339,0.959,0.686,1.477,0.974c4.794,1.998,8.914,5.28,13.777,7.136 c0.781,0.269,1.317,1.038,2.159,1.154c0.862,0.116,1.487,0.765,2.197,1.198c0.022-0.24,0.056-0.467,0.077-0.707 c0.609,0.563,1.174,1.21,1.94,1.551c-0.158-0.594-0.422-1.172-0.719-1.72c0.485,0.338,0.971,0.677,1.477,0.995 c-0.374-1.493-1.423-2.676-2.216-3.949c0.517,0.329,1.044,0.648,1.583,0.938c-0.464-1.373-1.595-2.361-2.504-3.431 c-2.036-2.32-4.382-4.341-6.615-6.482c-1.687-1.381-3.745-2.248-5.788-2.989c-1.72-0.735-3.429-1.479-5.078-2.378 c0.279-0.944,0.527-1.541,0.955-2.138c0.18,0.177,0.349,0.363,0.539,0.529c-0.058-0.526-0.248-1.11-0.816-1.254 c-1.421-0.845-3.138,0.448-4.501-0.51c-0.57-0.3-0.907-0.893-1.278-1.392c-1.055-1.476-2.076-3.002-2.904-4.622 c-1.088-1.864-2.462-3.647-4.36-4.758c-2.108-1.319-4.104-2.821-6.313-3.988c-1.905-0.985-3.584-2.335-5.419-3.462 c0.182,0.751,0.771,1.293,1.2,1.901C48.357,7.339,46.915,6.273,45.254,5.646z')
const CX = 69.2, CY = 27.6            // shoulder point in art units
const ART_HEADING = (-60 * Math.PI) / 180 // the drawn bird flies up-right
const HALF_SPAN = 31                  // art units, shoulder → wingtip
const PHASES = 16

/** Sprite strip for one colour: PHASES frames, each `side` px square, bird heading +x. */
export function buildBirdSprites(color, wingspanPx, dpr) {
  const side = Math.ceil(wingspanPx * dpr * 1.25)
  const c = document.createElement('canvas')
  c.width = side * PHASES
  c.height = side
  const ctx = c.getContext('2d')
  ctx.fillStyle = color
  const u = (wingspanPx * dpr) / 2 / HALF_SPAN
  for (let k = 0; k < PHASES; k++) {
    const flap = 0.5 + 0.5 * Math.cos((k / PHASES) * Math.PI * 2) // 1 = spread
    const s = 0.42 + 0.58 * flap
    const sweep = 0.55 * (1 - flap)
    for (const half of [1, -1]) {
      ctx.save()
      ctx.beginPath(); ctx.rect(k * side, 0, side, side); ctx.clip()
      ctx.translate(k * side + side / 2, side / 2)
      ctx.scale(u, u)
      ctx.beginPath(); ctx.rect(-80, half > 0 ? 0 : -80, 160, 80); ctx.clip()
      ctx.transform(1, 0, -sweep * half, s, 0, 0)
      ctx.rotate(-ART_HEADING)
      ctx.translate(-CX, -CY)
      ctx.fill(ART)
      ctx.restore()
    }
  }
  return { canvas: c, side, phases: PHASES }
}
