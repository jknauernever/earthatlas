/**
 * AIS-inferred berths (Josh 2026-09-28): where a terminal has several berths but only one citable position, a berth point is
 * ESTIMATED from where large ships actually stop, in EarthAtlas's own AIS positions. Rules: src/ships/CLAUDE.md.
 *
 *   evidence        MarineCadastre AIS daily points (CC0), bake-ais points cache; step 1 (scripts/ships/bake-ais/berth_stops.py)
 *                   reduces them to long stops: one MMSI stopped (SOG < 0.5 kn) for 2 h+, its median position and spread.
 *   derived         clusterStops() below groups the stop positions; attributeClusters() keeps a cluster for a terminal only when
 *                   it passes the FOOTPRINT GUARD (it lies alongside that terminal's own mapped site / pier, and no other mapped
 *                   facility is comparably close), the ships fit the terminal, and enough different ships stopped there.
 *                   scripts/ships/ais-berths.mjs runs both and writes a proposal; the reviewed berths live in
 *                   lib/ships/data/salish-terminals-ais-berths.json and are stored as terminal_berths basis 'ais_inferred'
 *                   (source 'earthatlas-ais-berths', evidence class inferred): never an official position.
 *   interpretation  none stored beyond the berth point; the terminal-calls bake treats it like any other berth (150 m radius,
 *                   or the official length of the berth it is paired with).
 *
 * All pure: no I/O. Geometry is done in a local flat projection (metres east / north of a reference point), which is exact to
 * well under a metre over the few kilometres involved.
 */

export const AIS_BERTH_RULE = Object.freeze({
  maxSpreadM: 50,        // a stop whose positions spread more than this (90th percentile) is a ship swinging at anchor, not moored
  seedRadiusM: 40,       // density of a stop = other stops within this distance (the densest stop seeds the next cluster)
  clusterRadiusM: 60,    // a cluster = the stops within this distance of the seed's cluster median
  minStops: 10,          // evidence: at least this many stops …
  minShips: 5,           // … by at least this many different ships (MMSIs)
  minFitShare: 0.8,      // at least this share of the cluster's stops by ships whose AIS type fits the terminal
  footprintMarginM: 80,  // a moored ship's AIS position lies alongside the quay: up to this far outside the mapped site / pier
  otherRatio: 2,         // any OTHER mapped facility must be at least this many times farther away (and beyond the margin)
})

const R = 6371008.8
const rad = (d) => (d * Math.PI) / 180

/** A local flat projection around lat0/lon0: ([lon, lat]) → [x metres east, y metres north]. */
export function projector(lat0, lon0) {
  const k = Math.cos(rad(lat0))
  return {
    xy: (lon, lat) => [rad(lon - lon0) * R * k, rad(lat - lat0) * R],
    ll: (x, y) => [lon0 + (x / (R * k)) * (180 / Math.PI), lat0 + (y / R) * (180 / Math.PI)],
  }
}

// ── Footprints (OSM site / pier outlines) ────────────────────────────────────

/**
 * Closed rings from an OSM multipolygon's outer member ways (each a list of [lon, lat]): ways are joined end to end, reversing
 * as needed, until each ring closes. Returns { rings, open } (open = ways that could not be closed; the caller reports them).
 */
export function stitchRings(ways) {
  const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`
  const left = ways.filter((w) => w && w.length >= 2).map((w) => w.slice())
  const rings = [], open = []
  while (left.length) {
    let ring = left.shift()
    for (;;) {
      if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) { rings.push(ring); break }
      const end = key(ring[ring.length - 1])
      const i = left.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end)
      if (i < 0) { open.push(ring); break }
      const w = left.splice(i, 1)[0]
      ring = ring.concat((key(w[0]) === end ? w : w.slice().reverse()).slice(1))
    }
  }
  return { rings, open }
}

function inRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function segDist(x, y, [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1
  const t = dx || dy ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) : 0
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

/**
 * Distance in metres from a point to a footprint (0 when inside). footprint = { rings: [[[lon, lat], ...], ...] } (outer rings;
 * a pier mapped as an open line counts as its line).
 */
export function footprintDistanceM(lat, lon, footprint) {
  const P = projector(lat, lon)
  let best = Infinity
  for (const ring of footprint.rings || []) {
    const pts = ring.map(([lo, la]) => P.xy(lo, la))
    const closed = pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]
    if (closed && inRing(0, 0, pts)) return 0
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(0, 0, pts[i - 1], pts[i]))
  }
  return best
}

// ── Clustering the stops (pure) ──────────────────────────────────────────────

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

/**
 * Stops → clusters. stops: [{ mmsi, t0, t1, lat, lon, spread_m, type, length }] (berth_stops.py rows). Stops that spread more
 * than maxSpreadM are dropped first (reported in `dropped`). Then, repeatedly: the stop with the most other stops within
 * seedRadiusM seeds a cluster; the cluster takes every stop within clusterRadiusM of the seed, its centre moves to their median,
 * and it takes every stop within clusterRadiusM of that centre; those stops leave the pool (so clusters never chain along a quay).
 * Ties: the earlier stop (t0, then mmsi). Returns { clusters: [{ lat, lon, stops, ships, first, last, stopsList }], dropped }.
 */
export function clusterStops(stops, rule = AIS_BERTH_RULE) {
  const kept = stops.filter((s) => Number(s.spread_m) <= rule.maxSpreadM && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)))
  const dropped = stops.length - kept.length
  if (!kept.length) return { clusters: [], dropped }
  const P = projector(median(kept.map((s) => Number(s.lat))), median(kept.map((s) => Number(s.lon))))
  let pool = kept.map((s) => { const [x, y] = P.xy(Number(s.lon), Number(s.lat)); return { s, x, y } })
    .sort((a, b) => String(a.s.t0).localeCompare(String(b.s.t0)) || String(a.s.mmsi).localeCompare(String(b.s.mmsi)))
  const within = (cx, cy, r) => (p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r
  const clusters = []
  while (pool.length) {
    let seed = pool[0], best = -1
    for (const p of pool) { const n = pool.filter(within(p.x, p.y, rule.seedRadiusM)).length; if (n > best) { best = n; seed = p } }
    const first = pool.filter(within(seed.x, seed.y, rule.clusterRadiusM))
    const cx = median(first.map((p) => p.x)), cy = median(first.map((p) => p.y))
    const members = pool.filter(within(cx, cy, rule.clusterRadiusM))
    const take = members.length ? members : [seed]
    const ids = new Set(take)
    pool = pool.filter((p) => !ids.has(p))
    const [lon, lat] = P.ll(median(take.map((p) => p.x)), median(take.map((p) => p.y)))
    const list = take.map((p) => p.s)
    clusters.push({ lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, stops: list.length, ships: new Set(list.map((s) => String(s.mmsi))).size,
      first: list.map((s) => s.t0).sort()[0], last: list.map((s) => s.t1).sort().at(-1), stopsList: list })
  }
  clusters.sort((a, b) => b.stops - a.stops || a.lat - b.lat || a.lon - b.lon)
  return { clusters, dropped }
}

// ── The guard: which terminal (if any) a cluster belongs to (pure) ───────────

/** Does an AIS ship-and-cargo type code fall in one of the ranges [[70, 79], …]? */
export const typeFits = (type, ranges) => type != null && type !== '' && ranges.some(([a, b]) => Number(type) >= a && Number(type) <= b)

/**
 * Clusters → { accepted, rejected }. terminals: [{ key, footprint: { rings, osm: [ids], name }, fitTypes: [[70, 79]],
 * berths: [{ key, lat, lon, radius_m }] (its official / OSM berths) }]. others: [{ id, name, rings }] = every OTHER mapped facility
 * in the area (sites and piers that are not the terminal's own). A cluster is accepted for terminal T when ALL hold:
 *   1. footprint: its centre is inside T's footprint or within footprintMarginM of it;
 *   2. unambiguous: no other terminal's footprint and no other mapped facility is within footprintMarginM, or closer than
 *      otherRatio × T's distance;
 *   3. fit: >= minFitShare of its stops are by ships whose AIS type fits T;
 *   4. evidence: >= minStops stops by >= minShips ships;
 *   5. new: its centre is outside every existing berth radius of T (inside one, those ships are already counted).
 * Clusters farther than 2 × footprintMarginM from every terminal are ignored (not near a listed terminal); every other cluster
 * that fails a test (including one just outside the margin) is returned in `rejected` with the reasons.
 */
export function attributeClusters(clusters, terminals, others = [], rule = AIS_BERTH_RULE) {
  const accepted = [], rejected = []
  for (const c of clusters) {
    const dT = terminals.map((t) => ({ t, m: footprintDistanceM(c.lat, c.lon, t.footprint) })).sort((a, b) => a.m - b.m)
    if (!dT.length || dT[0].m > 2 * rule.footprintMarginM) continue
    const own = dT[0]
    const rivals = [...dT.slice(1).map((x) => ({ id: x.t.key, name: x.t.footprint.name || x.t.key, m: x.m })),
      ...others.map((o) => ({ id: o.id, name: o.name, m: footprintDistanceM(c.lat, c.lon, o) }))].sort((a, b) => a.m - b.m)
    const rival = rivals[0] || null
    const why = []
    if (own.m > rule.footprintMarginM) why.push(`outside the footprint: ${Math.round(own.m)} m from ${own.t.footprint.name || own.t.key} (margin ${rule.footprintMarginM} m)`)
    if (rival && (rival.m <= rule.footprintMarginM || rival.m < rule.otherRatio * Math.max(own.m, 1))) why.push(`ambiguous: ${rival.name} is ${Math.round(rival.m)} m away (own footprint ${Math.round(own.m)} m)`)
    const fit = c.stopsList.filter((s) => typeFits(s.type, own.t.fitTypes)).length / c.stops
    if (fit < rule.minFitShare) why.push(`ships do not fit: ${Math.round(fit * 100)}% of stops by a fitting AIS type`)
    if (c.stops < rule.minStops || c.ships < rule.minShips) why.push(`too little evidence: ${c.stops} stops by ${c.ships} ships`)
    const inside = (own.t.berths || []).map((b) => ({ b, m: footprintDistanceM(c.lat, c.lon, { rings: [[[b.lon, b.lat], [b.lon, b.lat]]] }) }))
      .filter((x) => x.m <= x.b.radius_m).sort((a, b) => a.m - b.m)[0]
    if (inside) why.push(`already counted: ${Math.round(inside.m)} m from berth ${inside.b.key} (radius ${inside.b.radius_m} m)`)
    const out = { terminal: own.t.key, lat: c.lat, lon: c.lon, stops: c.stops, ships: c.ships, first: c.first, last: c.last,
      footprintM: Math.round(own.m), footprint: own.t.footprint.osm || [], nearestOther: rival ? { id: rival.id, name: rival.name, m: Math.round(rival.m) } : null,
      fitShare: Math.round(fit * 1000) / 1000, spreadP50M: Math.round(median(c.stopsList.map((s) => Number(s.spread_m))) * 10) / 10,
      medianLengthM: median(c.stopsList.map((s) => Number(s.length)).filter(Number.isFinite)) }
    if (why.length) rejected.push({ ...out, why }); else accepted.push(out)
  }
  return { accepted, rejected }
}

/**
 * Order berths along a straight dock (pure): projects each point onto the line through the two farthest-apart points and
 * returns the keys sorted from `from` ('west' | 'east' | 'north' | 'south') end. Used to pair AIS-inferred berths with an
 * official list that numbers berths along the dock.
 */
export function orderAlongDock(points, from = 'west') {
  if (points.length < 2) return points.map((p) => p.key)
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length, lon0 = points.reduce((s, p) => s + p.lon, 0) / points.length
  const P = projector(lat0, lon0)
  const xy = points.map((p) => ({ key: p.key, v: P.xy(p.lon, p.lat) }))
  const axis = { west: [1, 0], east: [-1, 0], south: [0, 1], north: [0, -1] }[from]
  return xy.sort((a, b) => (a.v[0] * axis[0] + a.v[1] * axis[1]) - (b.v[0] * axis[0] + b.v[1] * axis[1])).map((p) => p.key)
}
