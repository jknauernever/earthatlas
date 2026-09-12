/**
 * wildQuery — shared query-shaping for wildlife API calls (client + cron).
 *
 * The whole point of the /api/gbif-proxy and /api/inat-proxy edge caches is
 * that many users produce the SAME upstream request. Raw viewport bboxes
 * never collide — every pan is unique — so all area queries snap outward to
 * a fixed grid: two people looking at roughly the same coast now share one
 * cache entry, and the warm-explore cron can pre-fill exactly the keys real
 * users will ask for. Callers filter returned rows back down to their exact
 * viewport client-side, so nothing on screen changes.
 *
 * Pure functions only — imported by browser code AND by api/cron/, so keep
 * it free of vite-isms and DOM.
 */

export const GRID_DEG = 0.25

// Snap a bounds object OUTWARD to the grid (superset of the request).
export function quantizeBounds({ minLat, maxLat, minLng, maxLng }, step = GRID_DEG) {
  const down = (v) => Math.floor(v / step) * step
  const up = (v) => Math.ceil(v / step) * step
  return {
    minLat: Math.max(-90, down(Number(minLat))),
    maxLat: Math.min(90, up(Number(maxLat))),
    minLng: Math.max(-180, down(Number(minLng))),
    maxLng: Math.min(180, up(Number(maxLng))),
  }
}

// Viewport bounds from a center + zoom (mirror of ExploreApp.boundsFromZoom,
// shared here so the warm cron computes the same cells users will).
export function boundsFromZoom(lat, lng, z) {
  const latSpan = 180 / Math.pow(2, z)
  const lngSpan = 360 / Math.pow(2, z)
  return {
    minLat: Math.max(-90, lat - latSpan),
    maxLat: Math.min(90, lat + latSpan),
    minLng: Math.max(-180, lng - lngSpan),
    maxLng: Math.min(180, lng + lngSpan),
  }
}

export function inBounds(row, bb) {
  return row.lat >= bb.minLat && row.lat <= bb.maxLat && row.lng >= bb.minLng && row.lng <= bb.maxLng
}

// The rolling recent window, day-resolution. Day-stamped so the cache key is
// stable within a day (a per-request timestamp would defeat the shared cache).
export function recentWindow(days) {
  const d2 = new Date()
  const d1 = new Date(d2 - days * 86400000)
  const fmt = (d) => d.toISOString().split('T')[0]
  return { d1: fmt(d1), d2: fmt(d2) }
}
