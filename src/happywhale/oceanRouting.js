/**
 * oceanRouting — water-only journey legs for /happywhale.
 *
 * Real encounters carry no route information, and straight connectors send
 * whales across peninsulas and islands. This module routes each leg through
 * water instead: rasterize a coastline land mask onto an adaptive grid scoped
 * to the leg, run A*, straighten with line-of-sight simplification, then
 * smooth with a centripetal Catmull-Rom. Routes are ILLUSTRATIVE sea paths —
 * plausible water corridors between known points, not tracked movements.
 *
 * Land mask: /happywhale-land.json — Natural Earth 50m land, outer rings only
 * (baked ~1 MB / ~340 KB gzipped; lazy-loaded on the first journey). 50 m
 * resolution carries the Salish Sea test set: San Juan/Orcas/Whidbey islands
 * are present, the straits are water.
 *
 * Grid resolution adapts to leg length (≈192 cells across the padded bbox),
 * so a Victoria→Port Townsend hop routes through island channels while an
 * ocean crossing uses a coarse, cheap grid. Land is dilated one cell so the
 * smoothed curve keeps a little sea room. If anything fails — mask missing,
 * endpoints landlocked at grid resolution, no path — the leg falls back to a
 * straight line rather than no line.
 */

// ─── Land mask ───────────────────────────────────────────────────────────────
let landPromise = null
function loadLand() {
  if (!landPromise) {
    landPromise = fetch('/happywhale-land.json', { headers: { accept: 'application/json' } })
      .then((r) => {
        if (!r.ok) throw new Error(`land mask ${r.status}`)
        return r.json()
      })
      .then((d) => ({
        polys: d.polys.map((ring) => {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const [x, y] of ring) {
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
          }
          return { ring, minX, minY, maxX, maxY }
        }),
      }))
      .catch((err) => {
        landPromise = null // allow a retry on the next journey
        throw err
      })
  }
  return landPromise
}

// ─── Leg routing ─────────────────────────────────────────────────────────────
const GRID_TARGET = 192 // cells across the longer bbox dimension
const MAX_CELLS = 90000

/** Shift lng to within 180° of ref (antimeridian-safe frames). */
const shiftLng = (lng, ref) => {
  let L = lng
  while (L - ref > 180) L -= 360
  while (L - ref < -180) L += 360
  return L
}

function rasterizeLand(land, frame) {
  const { minLng, minLat, cell, w, h, refLng } = frame
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'
  const maxLng = minLng + w * cell
  const maxLat = minLat + h * cell
  for (const p of land.polys) {
    // Test intersection in the shifted frame (try the ring's own frame ±360).
    let ok = false
    for (const off of [0, 360, -360]) {
      if (p.minX + off <= maxLng && p.maxX + off >= minLng && p.minY <= maxLat && p.maxY >= minLat) { ok = true; break }
    }
    if (!ok) continue
    ctx.beginPath()
    for (let i = 0; i < p.ring.length; i++) {
      const x = (shiftLng(p.ring[i][0], refLng) - minLng) / cell
      const y = (p.ring[i][1] - minLat) / cell
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }
  const img = ctx.getImageData(0, 0, w, h).data
  const grid = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) grid[i] = img[i * 4 + 3] > 0 ? 1 : 0
  // Dilate land one cell: keeps the smoothed curve off the beach.
  const dilated = new Uint8Array(grid)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y * w + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) dilated[ny * w + nx] = 1
        }
      }
    }
  }
  return dilated
}

/** Nearest water cell to (x,y) within r cells, or null. */
function nearestWater(grid, w, h, x, y, r = 8) {
  if (x >= 0 && x < w && y >= 0 && y < h && !grid[y * w + x]) return [x, y]
  for (let d = 1; d <= r; d++) {
    for (let dy = -d; dy <= d; dy++) {
      for (let dx = -d; dx <= d; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue
        const nx = x + dx, ny = y + dy
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !grid[ny * w + nx]) return [nx, ny]
      }
    }
  }
  return null
}

/** Straight water line between cells? (supercover-ish Bresenham) */
function waterLine(grid, w, h, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy, x = x0, y = y0
  while (true) {
    if (grid[y * w + x]) return false
    if (x === x1 && y === y1) return true
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
}

function astar(grid, w, h, start, goal, latScale) {
  const idx = (x, y) => y * w + x
  const open = [[0, start[0], start[1]]] // binary-ish heap via sorted insert (grids are small)
  const gScore = new Float64Array(w * h).fill(Infinity)
  const came = new Int32Array(w * h).fill(-1)
  gScore[idx(start[0], start[1])] = 0
  const hcost = (x, y) => Math.hypot((x - goal[0]) * latScale, y - goal[1])
  const closed = new Uint8Array(w * h)
  while (open.length) {
    // extract min-f
    let mi = 0
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i
    const [, cx, cy] = open.splice(mi, 1)[0]
    const ci = idx(cx, cy)
    if (closed[ci]) continue
    closed[ci] = 1
    if (cx === goal[0] && cy === goal[1]) {
      const path = []
      let cur = ci
      while (cur !== -1) { path.push([cur % w, Math.floor(cur / w)]); cur = came[cur] }
      return path.reverse()
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ni = idx(nx, ny)
        if (grid[ni] || closed[ni]) continue
        const step = Math.hypot(dx * latScale, dy)
        const g = gScore[ci] + step
        if (g < gScore[ni]) {
          gScore[ni] = g
          came[ni] = ci
          open.push([g + hcost(nx, ny), nx, ny])
        }
      }
    }
    if (open.length > 40000) return null // runaway guard
  }
  return null
}

// Centripetal Catmull-Rom (overshoot-free with uneven point spacing).
function catmullRom(pts, samplesPerSeg = 6) {
  if (pts.length < 3) return pts
  const get = (i) => pts[Math.max(0, Math.min(pts.length - 1, i))]
  const knot = (a, b) => Math.sqrt(Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), 1e-9))
  const out = [pts[0]]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3)
    for (let s = 1; s <= samplesPerSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSeg
      out.push([0, 1].map((d) => {
        const a1 = ((t1 - t) * p0[d] + (t - t0) * p1[d]) / (t1 - t0)
        const a2 = ((t2 - t) * p1[d] + (t - t1) * p2[d]) / (t2 - t1)
        const a3 = ((t3 - t) * p2[d] + (t - t2) * p3[d]) / (t3 - t2)
        const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0)
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1)
        return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1)
      }))
    }
  }
  return out
}

/** Route one leg through water. Returns [[lng,lat],…] (incl. endpoints). */
function routeLeg(land, from, to) {
  const straight = [[from.lng, from.lat], [to.lng, to.lat]]
  const refLng = from.lng
  const toLng = shiftLng(to.lng, refLng)
  const spanLng = Math.abs(toLng - refLng)
  const spanLat = Math.abs(to.lat - from.lat)
  if (spanLng < 0.02 && spanLat < 0.02) return straight // same anchorage

  const pad = Math.max(0.4, Math.max(spanLng, spanLat) * 0.45)
  const minLng = Math.min(refLng, toLng) - pad
  const maxLng = Math.max(refLng, toLng) + pad
  const minLat = Math.max(-85, Math.min(from.lat, to.lat) - pad)
  const maxLat = Math.min(85, Math.max(from.lat, to.lat) + pad)
  let cell = Math.max(maxLng - minLng, maxLat - minLat) / GRID_TARGET
  let w = Math.ceil((maxLng - minLng) / cell)
  let h = Math.ceil((maxLat - minLat) / cell)
  if (w * h > MAX_CELLS) {
    const scale = Math.sqrt((w * h) / MAX_CELLS)
    cell *= scale
    w = Math.ceil((maxLng - minLng) / cell)
    h = Math.ceil((maxLat - minLat) / cell)
  }
  const frame = { minLng, minLat, cell, w, h, refLng: (minLng + maxLng) / 2 }
  const grid = rasterizeLand(land, frame)

  const toCell = (lng, lat) => [
    Math.min(w - 1, Math.max(0, Math.round((shiftLng(lng, frame.refLng) - minLng) / cell))),
    Math.min(h - 1, Math.max(0, Math.round((lat - minLat) / cell))),
  ]
  const start = nearestWater(grid, w, h, ...toCell(from.lng, from.lat))
  const goal = nearestWater(grid, w, h, ...toCell(to.lng, to.lat))
  if (!start || !goal) return straight

  const latScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  const cells = astar(grid, w, h, start, goal, latScale)
  if (!cells) return straight

  // Line-of-sight simplification: greedily jump to the furthest visible cell.
  const simplified = [cells[0]]
  let i = 0
  while (i < cells.length - 1) {
    let j = cells.length - 1
    while (j > i + 1 && !waterLine(grid, w, h, cells[i][0], cells[i][1], cells[j][0], cells[j][1])) j--
    simplified.push(cells[j])
    i = j
  }

  const mid = simplified.slice(1, -1).map(([cx, cy]) => [minLng + (cx + 0.5) * cell, minLat + (cy + 0.5) * cell])
  const pts = [
    [shiftLng(from.lng, frame.refLng), from.lat],
    ...mid,
    [shiftLng(to.lng, frame.refLng), to.lat],
  ]
  // Coordinates stay in the shifted frame (possibly beyond ±180): Mapbox
  // renders them continuously across the antimeridian, whereas normalizing
  // would split the line into a globe-spanning zigzag.
  return catmullRom(pts, 6)
}

/**
 * Route a journey's consecutive-encounter legs through water.
 * encounters: normalized, chronological. Returns [{ coords: [[lng,lat],…] }].
 */
export async function routeJourney(encounters) {
  let land
  try {
    land = await loadLand()
  } catch {
    // No mask → straight legs (better than no connectors at all).
    return legsFallback(encounters)
  }
  const legs = []
  for (let i = 1; i < encounters.length; i++) {
    const from = encounters[i - 1]
    const to = encounters[i]
    if (Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lng - to.lng) < 1e-5) continue
    try {
      legs.push({ coords: routeLeg(land, from, to) })
    } catch {
      legs.push({ coords: [[from.lng, from.lat], [to.lng, to.lat]] })
    }
  }
  return legs
}

function legsFallback(encounters) {
  const legs = []
  for (let i = 1; i < encounters.length; i++) {
    const from = encounters[i - 1]
    const to = encounters[i]
    if (Math.abs(from.lat - to.lat) < 1e-5 && Math.abs(from.lng - to.lng) < 1e-5) continue
    legs.push({ coords: [[from.lng, from.lat], [to.lng, to.lat]] })
  }
  return legs
}
