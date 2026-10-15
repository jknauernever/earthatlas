/**
 * Nearest registered offshore facility to a point (the oil slick card's check on SkyTruth's infrastructure matches).
 * Reads the bake's compact GeoJSON (scripts/ships/bake-offshore/): the local build on localhost, else the Blob copy named in
 * src/ships/trackSource.json (offshore.geojson). Kept in memory for an hour. Wind farm polygons count by their nearest edge.
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import manifest from '../../src/ships/trackSource.json' with { type: 'json' }

let cache = null
async function facilities() {
  const local = resolve(process.cwd(), `scripts/ships/bake-offshore/build/offshore-${manifest.offshore.version}.geojson`)
  const stamp = existsSync(local) ? statSync(local).mtimeMs : 'blob' // a re-bake on localhost replaces the file under the same name
  if (cache && cache.stamp === stamp && Date.now() - cache.at < 36e5) return cache.items
  let fc = null
  if (existsSync(local)) fc = JSON.parse(readFileSync(local, 'utf8'))
  else if (manifest.offshore.geojson) { const r = await fetch(manifest.offshore.geojson); if (r.ok) fc = await r.json() }
  if (!fc) return null
  // Each facility as a list of [lng, lat] points to measure to (points, or polygon vertices).
  const items = fc.features.map((f) => ({ p: f.properties, pts: f.geometry.type === 'Point' ? [f.geometry.coordinates] : f.geometry.coordinates.flat(f.geometry.type === 'MultiPolygon' ? 2 : 1),
    polys: f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : null }))
  cache = { at: Date.now(), stamp, items }
  return items
}

/** → { facility: props, km } nearest within maxKm, or { facility: null } (none registered nearby), or null (no data). */
export async function nearestFacility(lng, lat, maxKm = 5) {
  const items = await facilities()
  if (!items) return null
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 111.32
  let best = null
  // Inside a wind farm's outline = at the farm (distance 0); its corners alone would miss a point in the middle.
  const inside = (poly) => { let c = false; const ring = poly[0]; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c } return c }
  for (const it of items) if (it.polys?.some(inside)) return { facility: it.p, km: 0 }
  for (const it of items) {
    for (const [x, y] of it.pts) {
      if (Math.abs(y - lat) * ky > maxKm || Math.abs(x - lng) * kx > maxKm) continue
      const d = Math.hypot((x - lng) * kx, (y - lat) * ky)
      if (d <= maxKm && (!best || d < best.km)) best = { facility: it.p, km: Math.round(d * 100) / 100 }
    }
  }
  return best || { facility: null }
}
