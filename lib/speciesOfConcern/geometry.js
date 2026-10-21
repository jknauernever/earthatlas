// ArcGIS JSON geometry -> GeoJSON, clipped to a box around the lookup circle so a huge designation (Southern Resident
// critical habitat covers all of Washington's inland waters) arrives as just the part near the spot.

/** Box around a point: [w, s, e, n] in degrees, `km` from the point on every side. */
export function boxAround(lat, lng, km) {
  const dLat = km / 110.574, dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180))
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
}

// Sutherland–Hodgman: clip one closed ring to the box, edge by edge.
function clipRing(ring, [w, s, e, n]) {
  const edges = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ]
  let out = ring
  for (const [inside, cross] of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length]
      if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur) }
      else if (inside(prev)) out.push(cross(prev, cur))
    }
    if (!out.length) return null
  }
  if (out.length < 3) return null
  out.push(out[0])
  return out
}

// Shoelace sign: ArcGIS outer rings run clockwise (negative area in lng/lat), holes counter-clockwise.
const signedArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2 }
const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n

// Douglas–Peucker on one line or ring, tolerance in degrees.
function simplify(pts, tol) {
  if (pts.length < 4) return pts
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1
  const stack = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, ay] = pts[a], [bx, by] = pts[b]
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12
    let max = 0, idx = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len
      if (d > max) { max = d; idx = i }
    }
    if (max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]) }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5])
}

// A closed ring has no baseline (first point = last), so split it at the point farthest from the start.
function simplifyRing(ring, tol) {
  let far = 0, max = -1
  for (let i = 1; i < ring.length - 1; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > max) { max = d; far = i } }
  if (far === 0) return ring
  return [...simplify(ring.slice(0, far + 1), tol).slice(0, -1), ...simplify(ring.slice(far), tol)]
}

/** One ArcGIS geometry -> a GeoJSON geometry clipped to `box`, or null when nothing of it is inside. */
export function esriToGeoJSON(g, box) {
  const tol = (box[2] - box[0]) / 1500   // ~1 screen pixel when the box fills a wide map
  if (!g) return null
  if (Number.isFinite(g.x)) return inBox([g.x, g.y], box) ? { type: 'Point', coordinates: [g.x, g.y] } : null
  if (g.paths) {
    // keep the runs of each path that touch the box (one vertex of slack either side)
    const lines = []
    for (const path of g.paths) {
      let run = []
      path.forEach((p, i) => {
        const near = inBox(p, box) || (path[i - 1] && inBox(path[i - 1], box)) || (path[i + 1] && inBox(path[i + 1], box))
        if (near) run.push(p)
        else if (run.length) { if (run.length > 1) lines.push(run); run = [] }
      })
      if (run.length > 1) lines.push(run)
    }
    return lines.length ? { type: 'MultiLineString', coordinates: lines.map(l => simplify(l, tol)) } : null
  }
  if (g.rings) {
    const polys = []
    for (const ring of g.rings) {
      const outer = signedArea(ring) < 0
      let c = clipRing(ring.slice(0, -1), box)
      if (!c) continue
      c = simplifyRing(c, tol)
      if (c.length < 4) continue
      if (outer || !polys.length) polys.push([c])
      else polys[polys.length - 1].push(c)
    }
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }
  return null
}

// ─── Stored geometry (critical habitat baked by scripts/species-of-concern/bake-critical-habitat.mjs) ───────────────

/** ArcGIS geometry -> GeoJSON clipped to `box` at full precision (no simplification): what the bake stores. */
export function esriToGeoJSONExact(g, box) {
  if (!g) return null
  if (g.paths) {
    const lines = g.paths.filter((p) => p.some((pt) => inBox(pt, box)))
    return lines.length ? { type: 'MultiLineString', coordinates: lines } : null
  }
  if (g.rings) {
    const polys = []
    for (const ring of g.rings) {
      const outer = signedArea(ring) < 0
      const c = clipRing(ring.slice(0, -1), box)
      if (!c) continue
      if (outer || !polys.length) polys.push([c])
      else polys[polys.length - 1].push(c)
    }
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
  }
  return null
}

/** A stored GeoJSON geometry clipped to `box` and simplified for drawing (same detail as esriToGeoJSON). */
export function clipForMap(g, box) {
  const tol = (box[2] - box[0]) / 1500
  if (g.type === 'MultiLineString') {
    const lines = []
    for (const path of g.coordinates) {
      let run = []
      path.forEach((p, i) => {
        if (inBox(p, box) || (path[i - 1] && inBox(path[i - 1], box)) || (path[i + 1] && inBox(path[i + 1], box))) run.push(p)
        else if (run.length) { if (run.length > 1) lines.push(simplify(run, tol)); run = [] }
      })
      if (run.length > 1) lines.push(simplify(run, tol))
    }
    return lines.length ? { type: 'MultiLineString', coordinates: lines } : null
  }
  const polys = []
  for (const poly of g.coordinates) {
    const rings = []
    for (const ring of poly) {
      let c = clipRing(ring.slice(0, -1), box)
      if (!c) continue
      c = simplifyRing(c, tol)
      if (c.length >= 4) rings.push(c)
    }
    if (rings.length) polys.push(rings)
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
}

/** [w, s, e, n] of a GeoJSON geometry. */
export function bboxOf(g) {
  let w = 180, s = 90, e = -180, n = -90
  const walk = (c) => { if (typeof c[0] === 'number') { if (c[0] < w) w = c[0]; if (c[0] > e) e = c[0]; if (c[1] < s) s = c[1]; if (c[1] > n) n = c[1] } else c.forEach(walk) }
  walk(g.coordinates)
  return [w, s, e, n]
}

/**
 * Distance in km from a point to a polygon or line (0 when the point is inside a polygon), on a flat projection around
 * the point (accurate to well under 1% within 50 km). Returns { km, inside }.
 */
export function distanceToGeometry(lat, lng, g) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.574
  const P = (c) => [(c[0] - lng) * kx, (c[1] - lat) * ky]
  let best = Infinity
  const seg = (a, b) => {
    const [ax, ay] = a, [bx, by] = b, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0
    const d = Math.hypot(ax + t * dx, ay + t * dy)
    if (d < best) best = d
  }
  if (g.type === 'MultiLineString') {
    for (const line of g.coordinates) { const pts = line.map(P); for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]) }
    return { km: best, inside: false }
  }
  let inside = false
  for (const poly of g.coordinates) {
    let inPoly = false
    for (const ring of poly) {
      const pts = ring.map(P)
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        seg(pts[j], pts[i])
        const [xi, yi] = pts[i], [xj, yj] = pts[j]
        if ((yi > 0) !== (yj > 0) && 0 < ((xj - xi) * (0 - yi)) / (yj - yi) + xi) inPoly = !inPoly   // even-odd: holes cancel
      }
    }
    if (inPoly) inside = true
  }
  return { km: inside ? 0 : best, inside }
}

// ─── Tiles for the stored bake ───────────────────────────────────────────────
export const TILE = 0.25   // degrees
export const tileBox = (key) => { const [x, y] = key.split('_').map(Number); return [x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE] }
/** Keys of every tile a [w, s, e, n] box touches. */
export function tileKeysFor([w, s, e, n]) {
  const keys = []
  for (let x = Math.floor(w / TILE); x <= Math.floor(e / TILE); x++) for (let y = Math.floor(s / TILE); y <= Math.floor(n / TILE); y++) keys.push(`${x}_${y}`)
  return keys
}
/** A stored GeoJSON geometry clipped exactly to a box (no simplification). Lines keep the paths that touch it. */
export function clipExact(g, box) {
  if (g.type === 'MultiLineString') {
    const lines = []
    for (const path of g.coordinates) {
      let run = []
      path.forEach((p, i) => {
        if (inBox(p, box) || (path[i - 1] && inBox(path[i - 1], box)) || (path[i + 1] && inBox(path[i + 1], box))) run.push(p)
        else if (run.length) { if (run.length > 1) lines.push(run); run = [] }
      })
      if (run.length > 1) lines.push(run)
    }
    return lines.length ? { type: 'MultiLineString', coordinates: lines } : null
  }
  const polys = []
  for (const poly of g.coordinates) {
    const rings = []
    for (const ring of poly) { const c = clipRing(ring.slice(0, -1), box); if (c) rings.push(c) }
    if (rings.length) polys.push(rings)
  }
  return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
}

// ─── Map shapes: fill + clean outline ────────────────────────────────────────
/**
 * Drawable shapes for one item from its exact (unsimplified) polygon pieces, clipped to the view `box`:
 *   fill     MultiPolygon, simplified
 *   outline  MultiLineString of the item's real boundary only: edges shared by two of its pieces (a wetland mosaic,
 *            tile seams) appear twice and are dropped, as are edges along the view box (the cut we made). Real edges
 *            on a grid line (the US–Canada border at 49°N) stay.
 */
export function mapShapes(polys, box) {
  const tol = (box[2] - box[0]) / 1500
  const fill = [], counts = new Map(), segs = [], seenRings = new Set()
  const key = (a, b) => { const k1 = `${a[0].toFixed(7)},${a[1].toFixed(7)}`, k2 = `${b[0].toFixed(7)},${b[1].toFixed(7)}`; return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}` }
  const onLine = (v, edges) => edges.some((e) => Math.abs(v - e) < 1e-9)
  const cut = (a, b) => (a[0] === b[0] && onLine(a[0], [box[0], box[2]])) || (a[1] === b[1] && onLine(a[1], [box[1], box[3]]))
  for (const g of polys) {
    for (const poly of g.coordinates) {
      const rings = []
      for (const ring of poly) {
        const c = clipRing(ring.slice(0, -1), box)
        if (!c) continue
        // the same polygon can arrive twice (WDFW lists some wetlands under two source datasets): count it once
        const rk = c.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).sort().join(';')
        if (seenRings.has(rk)) continue
        seenRings.add(rk)
        for (let i = 1; i < c.length; i++) { const k = key(c[i - 1], c[i]); counts.set(k, (counts.get(k) || 0) + 1); segs.push([c[i - 1], c[i], k]) }
        const sim = simplifyRing(c, tol)
        if (sim.length >= 4) rings.push(sim)
      }
      if (rings.length) fill.push(rings)
    }
  }
  // chain the kept segments back into lines, then simplify those
  const lines = []
  let run = []
  for (const [a, b, k] of segs) {
    const keep = counts.get(k) === 1 && !cut(a, b)
    if (keep && run.length && run[run.length - 1] === a) run.push(b)
    else if (keep) { if (run.length > 1) lines.push(run); run = [a, b] }
    else if (run.length) { if (run.length > 1) lines.push(run); run = [] }
  }
  if (run.length > 1) lines.push(run)
  return {
    fill: fill.length ? { type: 'MultiPolygon', coordinates: fill } : null,
    // a fully kept boundary is a closed loop: simplify it as a ring (a plain line simplify collapses a loop to a point)
    outline: lines.length ? { type: 'MultiLineString', coordinates: lines.map((l) => (l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1] ? simplifyRing(l, tol) : simplify(l, tol))).filter((l) => l.length > 1) } : null,
  }
}
