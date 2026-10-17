/**
 * Location sanity flags for whale sightings.
 *
 * Shore-based observers report from land, so "on land" alone is normal. Only a
 * point that is on land AND still on land 0.1° (~10 km) away in all four
 * directions is flagged 'inland' (e.g. a Whale Alert report from Kansas, a
 * phone's default location). 0,0 is flagged 'null_island'.
 * Land = Natural Earth 1:50m (data/land50.json).
 */
import LAND from './data/land50.json' with { type: 'json' }

function inRing(lon, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function onLand(lon, lat) {
  for (const p of LAND.polys) {
    const [w, s, e, n] = p.b
    if (lon < w || lon > e || lat < s || lat > n) continue
    if (inRing(lon, lat, p.r)) return true
  }
  return false
}

const STEP = 0.1

/** 'ok' | 'null_island' | 'inland' */
export function locationQuality(lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return 'null_island'
  if (Math.abs(lon) < 0.01 && Math.abs(lat) < 0.01) return 'null_island'
  if (!onLand(lon, lat)) return 'ok'
  const around = [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]
  return around.every(([dx, dy]) => onLand(lon + dx, lat + dy)) ? 'inland' : 'ok'
}
