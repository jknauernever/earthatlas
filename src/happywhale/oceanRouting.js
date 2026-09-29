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
      .then((d) => {
        const withBbox = (rings) => rings.map((ring) => {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
          for (const [x, y] of ring) {
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
          }
          return { ring, minX, minY, maxX, maxY }
        })
        // Composite mask (see the bake note in the file itself):
        //  - inside regionalBbox (NE Pacific): GSHHG full-res, the authority
        //  - elsewhere: (NE10-large AND NE50) OR NE10-small — NE50 reopens
        //    channels through large landmasses (Chatham Strait), while small
        //    islands NE50 can't even see (Galiano) stand as land on their own.
        return {
          regionalBbox: d.regionalBbox,
          regional: withBbox(d.polysRegional),
          big10: withBbox(d.polys10),
          small10: withBbox(d.islands10),
          p50: withBbox(d.polys50),
        }
      })
      .catch((err) => {
        landPromise = null // allow a retry on the next journey
        throw err
      })
  }
  return landPromise
}

// ─── Tunables ────────────────────────────────────────────────────────────────
const LONG_LEG_DEG = 6      // beyond this, use escape-gateway routing
const FINE_TARGET = 320     // cells across a short-leg / escape / repair grid
const COARSE_TARGET = 192   // cells across the open-ocean grid
const ESCAPE_HALF_DEG = 1.5 // half-size of an escape grid (~1 km cells)
const MAX_CELLS = 260000
const MAX_EXPANSIONS = 400000

/** Shift lng to within 180° of ref (antimeridian-safe frames). */
const shiftLng = (lng, ref) => {
  let L = lng
  while (L - ref > 180) L -= 360
  while (L - ref < -180) L += 360
  return L
}

// ─── Grid construction ───────────────────────────────────────────────────────
function buildGrid(land, minLng, minLat, maxLng, maxLat, target, maxCells = MAX_CELLS) {
  minLat = Math.max(-85, minLat)
  maxLat = Math.min(85, maxLat)
  let cell = Math.max(maxLng - minLng, maxLat - minLat) / target
  let w = Math.max(2, Math.ceil((maxLng - minLng) / cell))
  let h = Math.max(2, Math.ceil((maxLat - minLat) / cell))
  if (w * h > maxCells) {
    const scale = Math.sqrt((w * h) / maxCells)
    cell *= scale
    w = Math.max(2, Math.ceil((maxLng - minLng) / cell))
    h = Math.max(2, Math.ceil((maxLat - minLat) / cell))
  }
  const refLng = (minLng + maxLng) / 2

  const rasterizeSet = (polys) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#000'
    for (const p of polys) {
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
    const out = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) out[i] = img[i * 4 + 3] > 0 ? 1 : 0
    return out
  }

  // Base: (NE10-large AND NE50) OR NE10-small.
  const b10 = rasterizeSet(land.big10)
  const b50 = rasterizeSet(land.p50)
  const s10 = rasterizeSet(land.small10)
  const raw = new Uint8Array(w * h)
  for (let i = 0; i < raw.length; i++) raw[i] = (b10[i] & b50[i]) | s10[i]

  // Regional override: inside the GSHHG box, GSHHG full-res IS the coastline.
  if (land.regionalBbox) {
    const [rl0, rb0, rl1, rb1] = land.regionalBbox
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#000'
    for (const off of [0, 360, -360]) {
      if (rl0 + off > maxLng || rl1 + off < minLng || rb0 > maxLat || rb1 < minLat) continue
      const x0 = (rl0 + off - minLng) / cell
      const x1 = (rl1 + off - minLng) / cell
      const y0 = (rb0 - minLat) / cell
      const y1 = (rb1 - minLat) / cell
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    const areaImg = ctx.getImageData(0, 0, w, h).data
    let any = false
    for (let i = 0; i < w * h; i++) if (areaImg[i * 4 + 3] > 0) { any = true; break }
    if (any) {
      const reg = rasterizeSet(land.regional)
      for (let i = 0; i < w * h; i++) if (areaImg[i * 4 + 3] > 0) raw[i] = reg[i]
    }
  }

  // Dilate land one cell to keep the smoothed curve off the beach — but only
  // on coarse grids. On fine grids (cell < 0.01° ≈ 1 km) dilation SEALS real
  // channels like Seymour Narrows, which is worse than a curve near shore.
  let grid = raw
  if (cell >= 0.01) {
    grid = new Uint8Array(raw)
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
  }
  // Distance-to-land field (capped at 4 cells) for the open-water routing
  // preference: without it, shortest paths HUG coastlines and duck behind
  // islands — implying whale behavior no data supports. With a near-shore
  // cost penalty, routes take a neutral wide berth and only enter channels
  // when there is no open-water alternative.
  const pen = new Uint8Array(w * h).fill(4)
  {
    const qx = new Int32Array(w * h)
    const qy = new Int32Array(w * h)
    let head = 0, tail = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (grid[y * w + x]) { pen[y * w + x] = 0; qx[tail] = x; qy[tail] = y; tail++ }
      }
    }
    while (head < tail) {
      const x = qx[head], y = qy[head]; head++
      const d = pen[y * w + x]
      if (d >= 4) continue
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          if (pen[ny * w + nx] > d + 1) { pen[ny * w + nx] = d + 1; qx[tail] = nx; qy[tail] = ny; tail++ }
        }
      }
    }
  }

  const latScale = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
  return {
    grid, pen, w, h, cell, minLng, minLat, refLng, latScale,
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
  const { grid, pen, w, h, latScale } = g
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
        // Open-water preference: cells within 4 of land cost up to 3× —
        // strong enough that a 1-cell-wide sound isn't "shorter" than open
        // sea, weak enough that genuine channels still route.
        const shoreFactor = 1 + ((4 - pen[ni]) / 4) * 2
        const gNew = gScore[ci] + Math.hypot(dx * latScale, dy) * shoreFactor
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

/**
 * Light decimation of a cell path: endpoints + every 2nd cell. Deliberately
 * NOT line-of-sight simplification — LOS chords cut back toward the shore
 * the open-water cost pushed the path away from (and can re-clip land the
 * A* route detoured around). Chaikin smoothing handles the staircase.
 */
function decimateCells(cells) {
  const out = []
  for (let i = 0; i < cells.length; i++) {
    if (i === 0 || i === cells.length - 1 || i % 2 === 0) out.push(cells[i])
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
  return decimateCells(cells).map(([x, y]) => g.toCoord(x, y))
}

/**
 * Escape a channel-locked area: on a FINE grid centered on `from`, route to
 * whichever boundary water cell best advances toward `toward`. Returns
 * { path (control pts from `from` outward), gateway } or null.
 */
function escapeRoute(land, from, toward) {
  const refLng = from[0]
  const towardLng = shiftLng(toward[0], refLng)
  const attempt = (halfDeg, target, maxCells) => {
    const g = buildGrid(
      land,
      from[0] - halfDeg, from[1] - halfDeg,
      from[0] + halfDeg, from[1] + halfDeg,
      target, maxCells,
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
    const pts = decimateCells(cells).map(([x, y]) => g.toCoord(x, y))
    return { path: pts, gateway: pts[pts.length - 1] }
  }
  // Standard escape, then a max-resolution retry with a tighter box (~350 m
  // cells) for starts locked deep in narrow channels.
  return attempt(ESCAPE_HALF_DEG, FINE_TARGET) || attempt(0.9, 520, 480000)
}

// Chaikin corner-cutting. Unlike Catmull-Rom (which can overshoot OUTSIDE the
// validated chords and clip a headland), every Chaikin vertex lies ON an
// original chord and every new segment stays inside the corner triangle
// between two adjacent chords — with fine-validated short chords, the curve
// cannot stray meaningfully from checked water.
function chaikin(pts, iters = 2) {
  let cur = pts
  for (let k = 0; k < iters; k++) {
    if (cur.length < 3) return cur
    const out = [cur[0]]
    for (let i = 0; i < cur.length - 1; i++) {
      const [ax, ay] = cur[i]
      const [bx, by] = cur[i + 1]
      out.push([ax + (bx - ax) * 0.25, ay + (by - ay) * 0.25])
      out.push([ax + (bx - ax) * 0.75, ay + (by - ay) * 0.75])
    }
    out.push(cur[cur.length - 1])
    cur = out
  }
  return cur
}

// A chord validated only on a coarse grid may clip small islands. Re-route
// every long chord on a FINE grid local to it (splitting ocean-scale chords
// first so the fine grid stays fine). Throws when a chord can't be refined —
// the caller then omits the leg rather than draw over land.
const REFINE_MAX_CHORD = 0.35 // deg — chords shorter than this are trusted
class RefineFailure extends Error {}

function refineSegment(land, p, q, depth = 0) {
  const span = Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]))
  if (span <= REFINE_MAX_CHORD) return [q]
  if (span > 2 && depth < 5) {
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    return [...refineSegment(land, p, mid, depth + 1), ...refineSegment(land, mid, q, depth + 1)]
  }
  const pad = Math.max(0.25, span * 0.4)
  const g = buildGrid(
    land,
    Math.min(p[0], q[0]) - pad, Math.min(p[1], q[1]) - pad,
    Math.max(p[0], q[0]) + pad, Math.max(p[1], q[1]) + pad,
    FINE_TARGET,
  )
  const routed = routeOnGrid(g, p, q)
  if (!routed) throw new RefineFailure()
  return routed.slice(1)
}

/**
 * Validate EVERY chord of an assembled route at fine (~1 km) resolution and
 * repair the ones that touch land by re-routing them locally. This is what
 * catches small-island crossings that survive the coarse ocean grid — a
 * "short" chord is not a trusted chord. Uses a sliding 3.2° window grid so
 * consecutive chords share rasterizations. Throws RefineFailure when a chord
 * can be neither validated nor repaired (caller omits the leg).
 */
function validateAndRepair(land, pts) {
  const out = [pts[0]]
  let win = null
  const windowFor = (p, q) => {
    const pad = 0.35
    const okWin = win &&
      Math.min(p[0], q[0]) - pad >= win.minLng && Math.max(p[0], q[0]) + pad <= win.minLng + win.w * win.cell &&
      Math.min(p[1], q[1]) - pad >= win.minLat && Math.max(p[1], q[1]) + pad <= win.minLat + win.h * win.cell
    if (okWin) return win
    const cLng = (p[0] + q[0]) / 2
    const cLat = (p[1] + q[1]) / 2
    win = buildGrid(land, cLng - 1.6, cLat - 1.6, cLng + 1.6, cLat + 1.6, FINE_TARGET)
    return win
  }
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1]
    const q = pts[i]
    const span = Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]))
    if (span > 2) {
      // Ocean-scale chord: recursive split routes its halves on fine grids.
      out.push(...refineSegment(land, p, q))
      continue
    }
    const g = windowFor(p, q)
    const a = g.toCell(p[0], p[1])
    const b = g.toCell(q[0], q[1])
    if (waterLine(g, a[0], a[1], b[0], b[1])) { out.push(q); continue }
    let routed = routeOnGrid(g, p, q)
    if (!routed) {
      // Max-resolution retry local to the failing chord.
      const pad2 = 0.3
      const g2 = buildGrid(
        land,
        Math.min(p[0], q[0]) - pad2, Math.min(p[1], q[1]) - pad2,
        Math.max(p[0], q[0]) + pad2, Math.max(p[1], q[1]) + pad2,
        560, 480000,
      )
      routed = routeOnGrid(g2, p, q)
    }
    if (!routed) throw new RefineFailure()
    out.push(...routed.slice(1))
  }
  return out
}

const dedupe = (pts) => pts.filter((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) > 1e-9 || Math.abs(p[1] - pts[i - 1][1]) > 1e-9)

// True when the straight chord A→B stays in water at fine (~1 km, dilated)
// resolution end to end. Slides a window down the chord in ≤2° steps like
// validateAndRepair, but never repairs — used to prefer the honest straight
// line over a grid route that staircases and implies detours in open water.
function chordIsWater(land, A, B) {
  const span = Math.max(Math.abs(B[0] - A[0]), Math.abs(B[1] - A[1]))
  const steps = Math.max(1, Math.ceil(span / 2))
  for (let i = 0; i < steps; i++) {
    const p = [A[0] + (B[0] - A[0]) * (i / steps), A[1] + (B[1] - A[1]) * (i / steps)]
    const q = [A[0] + (B[0] - A[0]) * ((i + 1) / steps), A[1] + (B[1] - A[1]) * ((i + 1) / steps)]
    const g = buildGrid(land, (p[0] + q[0]) / 2 - 1.6, (p[1] + q[1]) / 2 - 1.6, (p[0] + q[0]) / 2 + 1.6, (p[1] + q[1]) / 2 + 1.6, FINE_TARGET)
    // The journey's true endpoints snap to water (a sighting can raster onto
    // a shore cell); interior samples lie ON the chord, so a land hit there
    // is a real crossing and must not be snapped away.
    const a = i === 0 ? nearestWater(g, ...g.toCell(p[0], p[1])) : g.toCell(p[0], p[1])
    const b = i === steps - 1 ? nearestWater(g, ...g.toCell(q[0], q[1])) : g.toCell(q[0], q[1])
    if (!a || !b || !waterLine(g, a[0], a[1], b[0], b[1])) return false
  }
  return true
}

/**
 * Route one leg through water. Returns [[lng,lat],…] incl. endpoints — or
 * NULL when no water route exists AND the straight fallback would cross land:
 * an omitted connector is honest, a connector across an island is a lie.
 */
function routeLeg(land, from, to) {
  const refLng = from.lng
  const toLng = shiftLng(to.lng, refLng)
  const A = [from.lng, from.lat]
  const B = [toLng, to.lat]
  const straight = [A, B]
  const span = Math.max(Math.abs(toLng - from.lng), Math.abs(to.lat - from.lat))
  if (span < 0.02) return straight // same anchorage

  // Only a land-free straight line may serve as a fallback.
  const straightOrNull = (g) => {
    const a = g.toCell(A[0], A[1])
    const b = g.toCell(B[0], B[1])
    return waterLine(g, a[0], a[1], b[0], b[1]) ? straight : null
  }

  let control
  let shortGrid = null
  if (span <= LONG_LEG_DEG) {
    const pad = Math.max(0.4, span * 0.45)
    shortGrid = buildGrid(
      land,
      Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad,
      Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad,
      FINE_TARGET,
    )
    // Straight-first: when the direct chord verifiably stays in water, draw
    // exactly that. A grid route between open-water points staircases at
    // close zooms and implies detours no data supports (Monterey Bay,
    // 2026-09-29). Endpoints snap to the nearest water cell exactly as
    // routeOnGrid's do — a sighting logged on a beach/harbor cell must not
    // veto the chord. A near-shore chord that clips one coastal cell at the
    // leg grid's resolution gets a max-resolution (~150 m) second opinion
    // before we give up on it. Wider legs additionally pass the dilated
    // ~1 km sliding windows; legs whose own grid is at least that fine are
    // their own authority (the resolution every A* repair path is trusted
    // at — the windows' dilation misreads points that sit close inshore).
    const straightOn = (g) => {
      const a = nearestWater(g, ...g.toCell(A[0], A[1]))
      const b = nearestWater(g, ...g.toCell(B[0], B[1]))
      return !!(a && b && waterLine(g, a[0], a[1], b[0], b[1]))
    }
    if ((straightOn(shortGrid) ||
         (span <= 1.5 && straightOn(buildGrid(
           land,
           Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad,
           Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad,
           560, 480000,
         )))) &&
        (shortGrid.cell <= 0.0105 || chordIsWater(land, A, B))) return straight
    control = routeOnGrid(shortGrid, A, B)
    if (!control && span <= 3.5) {
      // Last chance at maximum resolution (~300–700 m cells): GSHHG's real
      // coastline seals passages a mid-res grid can't thread.
      const g2 = buildGrid(
        land,
        Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad,
        Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad,
        560, 480000,
      )
      control = routeOnGrid(g2, A, B)
    }
    if (!control) return straightOrNull(shortGrid)
  } else {
    // Straight-first for ocean crossings too: a cheap coarse leg-wide pass
    // gates the fine sliding-window check of the whole chord; when it never
    // touches land, the honest straight line replaces escape/coarse routing.
    {
      const pad = 1
      const gc = buildGrid(
        land,
        Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad,
        Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad,
        COARSE_TARGET,
      )
      const a = nearestWater(gc, ...gc.toCell(A[0], A[1]))
      const b = nearestWater(gc, ...gc.toCell(B[0], B[1]))
      if (a && b && waterLine(gc, a[0], a[1], b[0], b[1]) && chordIsWater(land, A, B)) return straight
    }
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
      // Coarse mid failure falls to a gateway-to-gateway chord — refineChain
      // below re-routes it at fine resolution (or fails the leg honestly).
      const mid = routeOnGrid(g, gwA, gwB) || [gwA, gwB]
      const back = escB.path.map(([lng, lat]) => [shiftLng(lng, refLng), lat]).reverse()
      control = [...escA.path, ...mid, ...back]
    } else {
      // An end couldn't escape its channels — check the straight line on a
      // coarse leg-wide grid before daring to draw it.
      const pad = 1
      const g = buildGrid(
        land,
        Math.min(A[0], B[0]) - pad, Math.min(A[1], B[1]) - pad,
        Math.max(A[0], B[0]) + pad, Math.max(A[1], B[1]) + pad,
        COARSE_TARGET,
      )
      return straightOrNull(g)
    }
  }

  if (!control) return straight
  // Every chord longer than REFINE_MAX_CHORD gets re-routed at fine
  // resolution — the coarse mid-ocean segments of long legs are only
  // validated at ~5–10 km and can clip archipelagos (the BC Central Coast
  // taught us this the hard way).
  let refined
  try {
    refined = validateAndRepair(land, dedupe([A, ...control, B]))
  } catch (err) {
    if (!(err instanceof RefineFailure)) throw err
    const g = shortGrid || buildGrid(
      land,
      Math.min(A[0], B[0]) - 1, Math.min(A[1], B[1]) - 1,
      Math.max(A[0], B[0]) + 1, Math.max(A[1], B[1]) + 1,
      COARSE_TARGET,
    )
    return straightOrNull(g)
  }
  // Coordinates stay in the shifted frame (possibly beyond ±180): Mapbox
  // renders them continuously across the antimeridian.
  return chaikin(dedupe(refined), 2)
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
      const coords = routeLeg(land, from, to)
      if (coords) legs.push({ coords }) // null = would cross land → omit
    } catch {
      // Unknown state — omitting beats risking an over-land connector.
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
