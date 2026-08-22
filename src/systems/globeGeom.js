/**
 * Exact globe geometry for the /systems overlays.
 *
 * Mapbox's `map.unproject` is unreliable in the outer ~20% of the globe's
 * disc: measured at z2.1 it saturates at ~72° from the view center while the
 * visible limb sits near 80°+ (the disc is ~454 px, unproject round-trips
 * only out to ~357 px). Everything that derived "the horizon" from unproject
 * round-trips therefore agreed on a disc ~22% too small — no data samples in
 * the outer band, and a clip ring well inside the real limb.
 *
 * This module builds the inverse ourselves. With pitch 0 the globe is
 * rotationally symmetric about the view axis, so screen distance from the
 * globe center depends only on angular distance θ from the view-center
 * lng/lat. We tabulate d(θ) by PROJECTING (which is exact everywhere) along
 * one great circle until the distance peaks at the limb, then invert by
 * interpolation: (x, y) → (d, azimuth) → (θ, bearing) → lng/lat.
 *
 * Returns null when the horizon is off-screen (zoomed in) — callers then use
 * map.unproject, which is exact there.
 */

const D2R = Math.PI / 180

export function angDist(a, b) {
  const [l1, p1] = [a[0] * D2R, a[1] * D2R]
  const [l2, p2] = [b[0] * D2R, b[1] * D2R]
  const s = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function bearing(a, b) {
  const [l1, p1] = [a[0] * D2R, a[1] * D2R]
  const [l2, p2] = [b[0] * D2R, b[1] * D2R]
  const y = Math.sin(l2 - l1) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(l2 - l1)
  return Math.atan2(y, x)
}

export function destination(a, brg, theta) {
  const [l1, p1] = [a[0] * D2R, a[1] * D2R]
  const p2 = Math.asin(Math.sin(p1) * Math.cos(theta) + Math.cos(p1) * Math.sin(theta) * Math.cos(brg))
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(theta) * Math.cos(p1), Math.cos(theta) - Math.sin(p1) * Math.sin(p2))
  return [((l2 / D2R + 540) % 360) - 180, p2 / D2R]
}

/**
 * @returns {null | { cx, cy, r, thetaLimb, center, unproject(x,y), isVisible(lng,lat) }}
 */
export function getGlobeGeometry(map, w, h) {
  let c, pc
  try {
    c = map.getCenter()
    pc = map.project([c.lng, c.lat])
  } catch { return null }
  if (!pc || !Number.isFinite(pc.x)) return null
  const center = [c.lng, c.lat]

  // d(θ) along the eastward great circle, sampled until the limb (distance
  // peaks, then folds back onto the far side).
  const table = [[0, 0]]
  let best = { d: 0, theta: 0 }
  for (let th = 0.5; th <= 110; th += 0.5) {
    let p
    try { p = map.project(destination(center, Math.PI / 2, th * D2R)) } catch { break }
    if (!p || !Number.isFinite(p.x)) break
    const d = Math.hypot(p.x - pc.x, p.y - pc.y)
    if (d < best.d - 0.5) break
    table.push([th, d])
    if (d > best.d) best = { d, theta: th }
  }
  if (best.d < 10) return null
  // Horizon off-screen (zoomed in): the disc encloses the whole viewport.
  const farthestCorner = Math.max(
    Math.hypot(pc.x, pc.y), Math.hypot(w - pc.x, pc.y),
    Math.hypot(pc.x, h - pc.y), Math.hypot(w - pc.x, h - pc.y),
  )
  if (best.d > farthestCorner) return null

  const r = best.d
  const thetaLimb = best.theta * D2R
  const unproject = (x, y) => {
    const dx = x - pc.x
    const dy = y - pc.y
    const d = Math.hypot(dx, dy)
    if (d >= r) return null
    // Invert d(θ) by linear interpolation on the monotone table.
    let i = 1
    while (i < table.length && table[i][1] < d) i++
    if (i >= table.length) return null
    const [t0, d0] = table[i - 1]
    const [t1, d1] = table[i]
    const theta = (t0 + ((d - d0) / Math.max(1e-6, d1 - d0)) * (t1 - t0)) * D2R
    // Screen azimuth (north up at bearing 0): +x east, −y north.
    const brg = Math.atan2(dx, -dy)
    const ll = destination(center, brg, theta)
    return { lng: ll[0], lat: ll[1] }
  }
  const isVisible = (lng, lat) => angDist(center, [lng, lat]) < thetaLimb - 0.002
  // Screen radius at a given angular distance (forward table lookup).
  const radiusAt = (theta) => {
    const th = theta / D2R
    let i = 1
    while (i < table.length && table[i][0] < th) i++
    if (i >= table.length) return r
    const [t0, d0] = table[i - 1]
    const [t1, d1] = table[i]
    return d0 + ((th - t0) / Math.max(1e-6, t1 - t0)) * (d1 - d0)
  }
  // Forward projection (closed form, no Mapbox call): null beyond the limb.
  const project = (lng, lat) => {
    const theta = angDist(center, [lng, lat])
    if (theta >= thetaLimb - 0.002) return null
    const brg = bearing(center, [lng, lat])
    const d = radiusAt(theta)
    return { x: pc.x + d * Math.sin(brg), y: pc.y - d * Math.cos(brg) }
  }
  return { cx: pc.x, cy: pc.y, r, thetaLimb, center, unproject, project, isVisible, radiusAt }
}
