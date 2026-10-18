/**
 * /shiptraffic data helpers (rebuilt 2026-10-17, docs/WHALES_AND_SHIPTRAFFIC_PLAN.md).
 *
 *   Ships   : /ships' track tiles — NOAA MarineCadastre (US-wide) and Global Fishing Watch hourly lines
 *             (api/ship-tracks?r=us|gfw), one source per month, yellow, filtered by `kind`.
 *   Whales  : our whale database (/api/whales, src/lib/whales.js), magenta; hydrophone detections as rings.
 *   Overlap : per-month files baked by scripts/shiptraffic/overlap-bake.mjs (Blob shiptraffic/overlap-v1/):
 *             ships per ~1 km cell by kind × whale reports per cell, summed over the picked months.
 *   Close passes: the same bake — ships within 1 km of a whale report within ±3 h (date-only reports: same day).
 */
import trackSource from '../ships/trackSource.json'

export const BLOB_BASE = new URL(trackSource.us.index).origin
export const OVERLAP_INDEX_URL = `${BLOB_BASE}/shiptraffic/overlap-v1/index.json`
export const FIRST_MONTH = '2024-01'

export const SHIP_COLOR = '#fde047'   // the /ships track yellow
export const WHALE_COLOR = '#ec4899'  // magenta
export const OVERLAP_COLOR = '#ef4444'
// Risk areas (Josh 2026-10-17): fixed thresholds, not relative brightness — past a point, more ships and more whales
// don't change the message: ships here are likely to meet whales. Per ~1 km square, per month on average.
export const RISK_WHALES = 10
export const RISK_SHIPS = 50
export const OVERLAP_HEATMAP_RAMP = [
  // One hue, faint → deep red (never white, and no yellow/orange: the ship tracks are yellow).
  0, 'rgba(239,68,68,0)', 0.15, 'rgba(239,68,68,0.25)', 0.4, 'rgba(239,68,68,0.55)', 0.7, '#ef4444', 0.9, '#c81e1e', 1, '#8f1111',
]

export const KIND_LABELS = {
  cargo: 'Cargo', tanker: 'Tanker', passenger: 'Passenger', fishing: 'Fishing',
  tug: 'Tug / tow', pleasure: 'Pleasure craft', other: 'Other', unknown: 'Not reported',
}

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const fmtDay = (d) => (d ? `${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}` : '')

/** First and last day of a month range, the last capped at today. */
export function dateSpan(fromYm, toYm, today = new Date().toISOString().slice(0, 10)) {
  const [y, m] = toYm.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { from: `${fromYm}-01`, to: last < today ? last : today }
}

/**
 * Sum the picked months' overlap grids. Returns { cells: [{ i, j, lng, lat, w, a, v, byKind, iRaw, nI }], maxV }.
 * v = distinct vessels of the picked kinds summed over months (vessel-months); w = whales placed in the cell;
 * a = whales placed only roughly whose area (~10 km) covers the cell, at full count (Josh 2026-10-17: area level).
 * Ship score = v ÷ the busiest cell (vmax per month, summed); whale score = max(w, a) ÷ the most whales anywhere (one
 * scale); iRaw = ship score × whale score; nI is iRaw relative to the region's top cell (0..1).
 */
export function aggregateOverlap(grids, kinds) {
  if (!grids.length) return { cells: [], maxV: 0 }
  const meta = grids[0]
  const kindIdx = meta.kinds.map((k, i) => (kinds.includes(k) ? i : -1)).filter((i) => i >= 0)
  const byCell = new Map()
  let vScale = 0
  for (const g of grids) {
    vScale += kinds.length === g.kinds.length ? g.vmaxAll : kindIdx.reduce((a, i) => a + (g.vmax[i] || 0), 0)
    for (const row of g.cells) {
      const [i, j, w] = row
      const key = j * g.nx + i
      let c = byCell.get(key)
      if (!c) byCell.set(key, (c = { i, j, w: 0, a: 0, v: 0, byKind: {} }))
      c.w += w
      c.a += row[3 + g.kinds.length] || 0 // grids baked before 2026-10-17 have no area column
      for (const ix of kindIdx) {
        const n = row[3 + ix]
        if (!n) continue
        c.v += n
        c.byKind[g.kinds[ix]] = (c.byKind[g.kinds[ix]] || 0) + n
      }
    }
  }
  const cells = [...byCell.values()]
  // One scale for both: whales seen in the square OR in its ~10 km area, against the most whales anywhere — so 15
  // roughly placed whales don't rank with 65 placed precisely just because they're scored on a smaller scale.
  const maxW = Math.max(1, ...cells.map((c) => Math.max(c.w, c.a)))
  const [W, S] = meta.bbox
  for (const c of cells) {
    c.lng = W + (c.i + 0.5) * meta.cell.lngStep
    c.lat = S + (c.j + 0.5) * meta.cell.latStep
    c.whaleScore = Math.max(c.w, c.a) / maxW
    c.iRaw = (vScale ? Math.min(1, c.v / vScale) : 0) * c.whaleScore
  }
  const top = Math.max(0, ...cells.map((c) => c.iRaw))
  const n = grids.length
  for (const c of cells) {
    c.nI = top ? c.iRaw / top : 0
    c.wMonth = Math.max(c.w, c.a) / n // whales seen per month (in the square, or its ~10 km area for rough reports)
    c.vMonth = c.v / n                // ships of the picked kinds crossing per month
    c.risk = c.wMonth >= RISK_WHALES && c.vMonth >= RISK_SHIPS
  }
  return { cells, maxV: vScale, cell: meta.cell, months: n }
}

export const WATER_CELLS_URL = `${BLOB_BASE}/shiptraffic/overlap-v1/water-cells.json`

/**
 * The risk squares in view, drawn at their true size and only over water: `fill` = each ~1 km square (a shoreline
 * square = its water part, from `water`, scripts/shiptraffic/water-cells.py; all-land squares are skipped); `edges` =
 * only the sides where a risk area meets a non-risk square or the shore, so each connected area gets one clean outline.
 */
export function riskShapesInView(cells, cell, bounds, water, pad = 0.25) {
  const fill = [], edges = []
  const fc = (features) => ({ type: 'FeatureCollection', features })
  if (!cell) return { fill: fc(fill), edges: fc(edges) }
  const nx = water?.nx
  const land = water ? new Set(water.land) : null
  const risk = new Set(cells.filter((c) => c.risk).map((c) => `${c.i},${c.j}`))
  const hx = cell.lngStep / 2, hy = cell.latStep / 2, tol = 2e-5
  const line = (a, b) => edges.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [a, b] } })
  for (const c of cells) {
    if (!c.risk || c.lng < bounds.w - pad || c.lng > bounds.e + pad || c.lat < bounds.s - pad || c.lat > bounds.n + pad) continue
    const k = nx ? c.j * nx + c.i : -1
    if (land?.has(k)) continue
    const W = c.lng - hx, E = c.lng + hx, S = c.lat - hy, N = c.lat + hy
    const near = (di, dj) => risk.has(`${c.i + di},${c.j + dj}`)
    const rings = water?.part?.[k]
    if (!rings) {
      fill.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[W, S], [E, S], [E, N], [W, N], [W, S]]] } })
      if (!near(0, -1)) line([W, S], [E, S])
      if (!near(0, 1)) line([W, N], [E, N])
      if (!near(-1, 0)) line([W, S], [W, N])
      if (!near(1, 0)) line([E, S], [E, N])
      continue
    }
    for (const r of rings) {
      fill.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [r] } })
      for (let q = 1; q < r.length; q++) {
        const [a, b] = [r[q - 1], r[q]]
        const on = (v, x) => Math.abs(a[v] - x) < tol && Math.abs(b[v] - x) < tol
        // A side shared with another risk square has no line; the shore and outer sides do.
        if ((on(1, S) && near(0, -1)) || (on(1, N) && near(0, 1)) || (on(0, W) && near(-1, 0)) || (on(0, E) && near(1, 0))) continue
        line(a, b)
      }
    }
  }
  return { fill: fc(fill), edges: fc(edges) }
}

/** Heatmap points for the cells in view, weighted relative to the most-overlapping cell IN VIEW. */
export function overlapPointsInView(cells, bounds, pad = 0.25) {
  const inView = cells.filter((c) => c.iRaw > 0 && c.lng >= bounds.w - pad && c.lng <= bounds.e + pad && c.lat >= bounds.s - pad && c.lat <= bounds.n + pad)
  const top = Math.max(0, ...inView.map((c) => c.iRaw))
  return {
    type: 'FeatureCollection',
    features: inView.map((c) => ({ type: 'Feature', properties: { w: top ? c.iRaw / top : 0 }, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } })),
  }
}

export function overlapBand(nI) {
  if (nI >= 0.5) return { label: 'Very high overlap', tone: 'crit' }
  if (nI >= 0.25) return { label: 'High overlap', tone: 'high' }
  if (nI >= 0.08) return { label: 'Moderate overlap', tone: 'mod' }
  return { label: 'Low overlap', tone: 'low' }
}
