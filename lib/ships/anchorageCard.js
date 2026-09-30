/**
 * Anchorage areas on the /ships map + the anchorage popup (Josh 2026-09-30). Rules: src/ships/CLAUDE.md.
 *
 *   claim           anchorages (009): the area, its legal status and citation, exactly as lib/ships/anchorages.js stores them
 *   aliases         anchorage_aliases (020): accepted "also known as" names, each with the source that uses it (anchorageAliases.js)
 *   counted         anchorage_stays (020): stays counted by EarthAtlas from MarineCadastre AIS (anchorageStays.js rule), resolved
 *                   to EarthAtlas ships at read time (vessels_for_mmsi_at)
 */
import { publicAnchorage } from './anchorages.js'
import { readAnchorageAliases } from './anchorageAliases.js'
import { readAnchorageStays, aisCoverage } from './anchorageStays.js'

/** Douglas–Peucker on one ring, tolerance in degrees (planar; fine for display at a few metres). Keeps first and last (pure). */
export function simplifyRing(r, tol) {
  if (!tol || r.length <= 4) return r
  const keep = new Uint8Array(r.length); keep[0] = keep[r.length - 1] = 1
  const stack = [[0, r.length - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()
    const [ax, ay] = r[i], [bx, by] = r[j]
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
    let best = -1, at = -1
    for (let k = i + 1; k < j; k++) {
      const [px, py] = r[k]
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy)
      if (d > best) { best = d; at = k }
    }
    if (best > tol) { keep[at] = 1; stack.push([i, at], [at, j]) }
  }
  const out = r.filter((_, k) => keep[k])
  return out.length >= 4 ? out : r
}

/** Round a geometry's coordinates to `dp` decimals (after simplifying by `tol` degrees) and drop repeated vertices (pure). */
export function roundGeometry(g, dp, tol = 0) {
  const f = 10 ** dp
  const ring = (r0) => {
    const r = simplifyRing(r0, tol)
    const out = []
    for (const [x, y] of r) {
      const p = [Math.round(x * f) / f, Math.round(y * f) / f]
      const l = out[out.length - 1]
      if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push(p)
    }
    return out.length >= 4 ? out : r0.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f])
  }
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map(ring) }
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map(ring)) }
  return g
}

/**
 * Every active anchorage area with a boundary as GeoJSON: i id, n name, l legal status (d designated / c DFO-listed /
 * n non-designated), x 1 = no-anchoring area, a 1 = the AIS box covers it (stays counted). Inside the AIS box the boundary is
 * exact to 5 decimals (~1 m, the polygon the stays were counted with); elsewhere it is simplified to ~20 m for display only.
 */
export async function anchoragesLayer(q, S) {
  const rows = await q(`SELECT id, source_id, source_key, name, legal_status, no_anchoring, geometry, min_lat, max_lat, min_lon, max_lon
                          FROM ${S}.anchorages WHERE status = 'active' AND geometry IS NOT NULL ORDER BY id`)
  const L = { designated: 'd', active_listed: 'c', non_designated: 'n' }
  return { type: 'FeatureCollection', features: rows.map((a) => {
    const cov = aisCoverage(a) === 'covered'
    return { type: 'Feature', id: Number(a.id), geometry: cov ? roundGeometry(a.geometry, 5) : roundGeometry(a.geometry, 4, 0.0002),
      properties: { i: Number(a.id), n: a.name, l: L[a.legal_status] || 'd', ...(a.no_anchoring ? { x: 1 } : {}), ...(cov ? { a: 1 } : {}) } }
  }) }
}

/** The popup: the area (public fields), its aliases, and the AIS stays for the picked months. win = parseCardWindow(). */
export async function readAnchorageCard(q, S, id, { win, top = 8 }) {
  const [a] = await q(`SELECT id, source_id, source_key, name, kind, legal_status, no_anchoring, citation, location, iso3, geometry IS NOT NULL AS has_geometry,
                              built_from, min_lat, max_lat, min_lon, max_lon, boundary_note, detail, source_record_id, status
                         FROM ${S}.anchorages WHERE id = $1`, [id])
  if (!a) return null
  const aliases = await readAnchorageAliases(q, S, a)
  const stays = await readAnchorageStays(q, S, { ...a, geometry: a.has_geometry ? true : null }, win, { top })
  return { anchorage: { ...publicAnchorage(a), no_anchoring: a.no_anchoring, status: a.status, source_key: a.source_key },
    aliases: aliases.filter((x) => x.status === 'accepted'), candidates: aliases.filter((x) => x.status === 'candidate').length, stays, window: win }
}
