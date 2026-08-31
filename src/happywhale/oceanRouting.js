/**
 * oceanRouting — water-only journey legs for /happywhale.
 *
 * Real encounters carry no route information, and straight connectors send
 * whales across peninsulas and islands. This module routes each leg through
 * water instead: rasterize a coastline land mask onto a grid, A* through it,
 * straighten with line-of-sight simplification, smooth with a centripetal
 * Catmull-Rom. Routes are ILLUSTRATIVE sea paths — plausible water corridors
 * between known points, not tracked movements.
 *
 * Land mask: /happywhale-land.json — Natural Earth 50m land, outer rings only
 * (~1 MB / ~340 KB gzipped; lazy-loaded on the first journey).
 *
 * Resolution strategy (the crux): one grid can't serve both scales. A
 * Juneau→Maui leg needs ~0.02° cells to thread Chatham Strait but would span
 * 35° — millions of cells. So legs longer than LONG_LEG_DEG route in three
 * stages: a FINE local grid escapes the origin's channels toward the
 * destination, a second fine grid does the same from the destination, and a
 * COARSE grid crosses the open ocean between the two escape gateways. Short
 * legs use a single fine grid. Any stage that fails degrades to a straight
 * segment rather than dropping the leg.
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

// ─── Tunables ────────────────────────────────────────────────────────────────
const LONG_LEG_DEG = 6      // beyond this, use escape-gateway routing
const FINE_TARGET = 256     // cells across a short-leg / escape grid
const COARSE_TARGET = 192   // cells across the open-ocean grid
const ESCAPE_HALF_DEG = 2.4 // half-size of an escape grid
const MAX_CELLS = 180000
const MAX_EXPANSIONS = 400000

/** Shift lng to within 180° of ref (antimeridian-safe frames). */
const shiftLng = (lng, ref) => {
  let L = lng
  while (L - ref > 180) L -= 360
  while (L - ref < -180) L += 360
  return L
}

// ─── Grid construction ───────────────────────────────────────────────────────
function buildGrid(land, minLng, minLat, maxLng, maxLat, target) {
  minLat = Math.max(-85, minLat)
  maxLat = Math.min(85, maxLat)
  let cell = Math.max(maxLng - minLng, maxLat - minLat) / target
  let w = Math.max(2, Math.ceil((maxLng - minLng) / cell))
  let h = Math.max(2, Math.ceil((maxLat - minLat) / cell))
  if (w * h > MAX_CELLS) {
    const scale = Math.sqrt((w * h) / MAX_CELLS)
    cell *= scale
    w = Math.max(2, Math.ceil((maxLng - minLng) / cell))
    h = Math.max(2, Math.ceil((maxLat - minLat) / cell))
  }
  const refLng = (minLng + maxLng) / 2

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#000'
  for (const p of land.polys) {
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
  const raw = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) raw[i] = img[i * 4 + 3] > 0 ? 1 : 0
  // Dilate land one cell: keeps the smoothed curve off the beach.
  const grid = new Uint8Array(raw)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!raw[y * w + x]) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) grid[ny * w + nx] = 1
        }
      }
    }
  }
  const latScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  return {
    grid, w, h, cell, minLng, minLat, refLng, latScale,
    toCell(lng, lat) {
      return [
        Math.min(w - 1, Math.max(0, Math.round((shiftLng(lng, refLng) - minLng) / cell))),
        Math.min(h - 1, Math.max(0, Math.round((lat - minLat) / cell))),
      ]
    },
    toCoord(x, y) {
      return [minLng + (x + 0.5) * cell, minLat + (y + 0.5) * cell]
    },
  }
}

/** Nearest water cell to (x,y) within r cells, or null. */
function nearestWater(g, x, y, r = 10) {
  const { grid, w, h } = g
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

// ─── A* (binary heap; goal may be a predicate for "reach any gateway") ───────
function astar(g, start, isGoal, hFn) {
  const { grid, w, h, latScale } = g
  const idx = (x, y) => y * w + x
  const gScore = new Float64Array(w * h).fill(Infinity)
  const came = new Int32Array(w * h).fill(-1)
  const closed = new Uint8Array(w * h)
  // heap of [f, cellIndex]
  const heap = [[hFn(start[0], start[1]), idx(start[0], start[1])]]
  gScore[heap[0][1]] = 0
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      const t = heap[p]; heap[p] = heap[i]; heap[i] = t
      i = p
    }
  }
  const down = (i) => {
    for (;;) {
      let s = i
      const l = 2 * i + 1, r = 2 * i + 2
      if (l < heap.length && heap[l][0] < heap[s][0]) s = l
      if (r < heap.length && heap[r][0] < heap[s][0]) s = r
      if (s === i) break
      const t = heap[s]; heap[s] = heap[i]; heap[i] = t
      i = s
    }
  }
  let expansions = 0
  while (heap.length) {
    const [, ci] = heap[0]
    heap[0] = heap[heap.length - 1]
    heap.pop()
    if (heap.length) down(0)
    if (closed[ci]) continue
    closed[ci] = 1
    const cx = ci % w, cy = (ci / w) | 0
    if (isGoal(cx, cy)) {
      const path = []
      let cur = ci
      while (cur !== -1) { path.push([cur % w, (cur / w) | 0]); cur = came[cur] }
      return path.reverse()
    }
    if (++expansions > MAX_EXPANSIONS) return null
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = cx + dx, ny = cy + dy
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const ni = idx(nx, ny)
        if (grid[ni] || closed[ni]) continue
        const gNew = gScore[ci] + Math.hypot(dx * latScale, dy)
        if (gNew < gScore[ni]) {
          gScore[ni] = gNew
          came[ni] = ci
          heap.push([gNew + hFn(nx, ny), ni])
          up(heap.length - 1)
        }
      }
    }
  }
  return null
}

/** Straight water line between cells? (Bresenham) */
function waterLine(g, x0, y0, x1, y1) {
  const { grid, w } = g
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy, x = x0, y = y0
  for (;;) {
    if (grid[y * w + x]) return false
    if (x === x1 && y === y1) return true
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
}

/** Greedy line-of-sight simplification of a cell path. */
function simplifyCells(g, cells) {
  const out = [cells[0]]
  let i = 0
  while (i < cells.length - 1) {
    let j = cells.length - 1
    while (j > i + 1 && !waterLine(g, cells[i][0], cells[i][1], cells[j][0], cells[j][1])) j--
    out.push(cells[j])
    i = j
  }
  return out
}

/** Route between two points on ONE grid → [[lng,lat],…] control pts, or null. */
function routeOnGrid(g, from, to) {
  const start = nearestWater(g, ...g.toCell(from[0], from[1]))
  const goal = nearestWater(g, ...g.toCell(to[0], to[1]))
  if (!start || !goal) return null
  const cells = astar(
    g, start,
    (x, y) => x === goal[0] && y === goal[1],
    (x, y) => Math.hypot((x - goal[0]) * g.latScale, y - goal[1]),
  )
  if (!cells) return null
  return simplifyCells(g, cells).map(([x, y]) => g.toCoord(x, y))
}

/**
 * Escape a channel-locked area: on a FINE grid centered on `from`, route to
 * whichever boundary water cell best advances toward `toward`. Returns
 * { path (control pts from `from` outward), gateway } or null.
 */
function escapeRoute(land, from, toward) {
  const refLng = from[0]
  const towardLng = shiftLng(toward[0], refLng)
  const g = buildGrid(
    land,
    from[0] - ESCAPE_HALF_DEG, from[1] - ESCAPE_HALF_DEG,
    from[0] + ESCAPE_HALF_DEG, from[1] + ESCAPE_HALF_DEG,
    FINE_TARGET,
  )
  const start = nearestWater(g, ...g.toCell(from[0], from[1]))
  if (!start) return null
  // Heuristic pulls toward the destination; the goal is ANY boundary water
  // cell, so the search naturally exits via channels pointing the right way.
  const t = g.toCell(towardLng, toward[1]) // may clamp to boundary — fine
  const cells = astar(
    g, start,
    (x, y) => x === 0 || y === 0 || x === g.w - 1 || y === g.h - 1,
    (x, y) => Math.hypot((x - t[0]) * g.latScale, y - t[1]),
  )
  if (!cells) return null
  const pts = simplifyCells(g, cells).map(([x, y]) => g.toCoord(x, y))
  return { path: pts, gateway: pts[pts.length - 1] }
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

const dedupe = (pts) => pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 1e-9 || Math.abs(p[1] - pts[i - 1][1]) > 1e-9)

/** Route one leg through water. Returns [[lng,lat],…] incl. endpoints. */
function routeLeg(land, from, to) {
  const refLng = from.lng
  const toLng = shiftLng(to.lng, refLng)
  const A = [from.lng, from.lat]
  const B = [toLng, to.lat]
  const straight = [A, B]
  const span = Math.max(Math.abs(toLng - from.lng), Math.abs(to.lat - from.lat))
  if (span < 0.02) return straight // same anchorage

  let control
  if (span <= LONG_LEG_DEG) {
    const pad = Math.max(0.4, span * 0.45)
    const g = buildGrid(
      land,
      Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad,
      Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad,
      FINE_TARGET,
    )
    control = routeOnGrid(g, A, B)
  } else {
    // Long leg: fine escapes at both ends, coarse crossing in the middle.
    const escA = escapeRoute(land, A, B)
    const escB = escapeRoute(land, [to.lng, to.lat], [from.lng, from.lat])
    if (escA && escB) {
      const gwA = escA.gateway
      const gwB = [shiftLng(escB.gateway[0], refLng), escB.gateway[1]]
      const pad = 1.5
      const g = buildGrid(
        land,
        Math.min(gwA[0], gwB[0]) - pad, Math.min(gwA[1], gwB[1]) - pad,
        Math.max(gwA[0], gwB[0]) + pad, Math.max(gwA[1], gwB[1]) + pad,
        COARSE_TARGET,
      )
      // Coarse mid-ocean failure is harmless open water — bridge directly.
      const mid = routeOnGrid(g, gwA, gwB) || [gwA, gwB]
      const back = escB.path.map(([lng, lat]) => [shiftLng(lng, refLng), lat]).reverse()
      control = [...escA.path, ...mid, ...back]
    } else {
      control = null
    }
  }

  if (!control) return straight
  const pts = dedupe([A, ...control, B])
  // Coordinates stay in the shifted frame (possibly beyond ±180): Mapbox
  // renders them continuously across the antimeridian.
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
    return legsFallback(encounters) // no mask → straight legs beat no legs
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
