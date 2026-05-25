/**
 * Live Globe data service
 * Fetches recent observations from iNaturalist and eBird, spread across
 * the visible hemisphere using land-based sample points.
 * eBird species photos via Macaulay Library.
 */

import { cached } from '../utils/cache'

// Route iNat observations through our own /api/inat-proxy edge function.
// Server-to-server has no CORS layer (so iNat throttling stops showing up as
// scary "blocked by CORS policy" client-side errors), and the proxy caches
// responses at the edge for 60s, sharply reducing upstream pressure when
// many users have /live open.
const INAT_PROXY = '/api/inat-proxy'
const EBIRD_API = 'https://api.ebird.org/v2'
const MACAULAY_API = 'https://search.macaulaylibrary.org/api/v1/search'
const MACAULAY_CDN = 'https://cdn.download.ams.birds.cornell.edu/api/v1/asset'
const EBIRD_KEY = import.meta.env.VITE_EBIRD_API_KEY

// ─── Land-based sample points distributed globally ───────────────────────
// Each point is { lat, lng } on or near a populated/observable land area.
const LAND_POINTS = [
  // North America
  { lat: 49, lng: -123 },  // Vancouver
  { lat: 45, lng: -93 },   // Minneapolis
  { lat: 40, lng: -74 },   // New York
  { lat: 34, lng: -118 },  // Los Angeles
  { lat: 30, lng: -97 },   // Austin
  { lat: 25, lng: -80 },   // Miami
  { lat: 19, lng: -99 },   // Mexico City
  { lat: 55, lng: -114 },  // Alberta
  // Central America / Caribbean
  { lat: 10, lng: -84 },   // Costa Rica
  { lat: 18, lng: -72 },   // Caribbean
  // South America
  { lat: 4, lng: -74 },    // Colombia
  { lat: -2, lng: -60 },   // Amazon
  { lat: -12, lng: -77 },  // Peru
  { lat: -23, lng: -43 },  // Rio de Janeiro
  { lat: -34, lng: -58 },  // Buenos Aires
  { lat: -33, lng: -71 },  // Santiago
  // Europe
  { lat: 51, lng: 0 },     // London
  { lat: 48, lng: 2 },     // Paris
  { lat: 52, lng: 13 },    // Berlin
  { lat: 40, lng: -4 },    // Madrid
  { lat: 41, lng: 12 },    // Rome
  { lat: 59, lng: 18 },    // Stockholm
  { lat: 55, lng: 37 },    // Moscow
  { lat: 38, lng: 24 },    // Athens
  // Africa
  { lat: 34, lng: -7 },    // Morocco
  { lat: 6, lng: 3 },      // Lagos
  { lat: 0, lng: 32 },     // Uganda
  { lat: -1, lng: 37 },    // Nairobi
  { lat: -34, lng: 18 },   // Cape Town
  { lat: -19, lng: 47 },   // Madagascar
  { lat: 30, lng: 31 },    // Cairo
  // Middle East
  { lat: 32, lng: 35 },    // Israel
  { lat: 25, lng: 55 },    // Dubai
  // Asia
  { lat: 28, lng: 77 },    // Delhi
  { lat: 13, lng: 80 },    // Chennai
  { lat: 35, lng: 104 },   // Central China
  { lat: 31, lng: 121 },   // Shanghai
  { lat: 35, lng: 137 },   // Japan
  { lat: 37, lng: 127 },   // Seoul
  { lat: 14, lng: 101 },   // Thailand
  { lat: 1, lng: 104 },    // Singapore
  { lat: -6, lng: 107 },   // Jakarta
  { lat: 14, lng: 121 },   // Philippines
  { lat: 22, lng: 114 },   // Hong Kong
  { lat: 47, lng: 107 },   // Mongolia
  // Oceania
  { lat: -34, lng: 151 },  // Sydney
  { lat: -37, lng: 145 },  // Melbourne
  { lat: -27, lng: 153 },  // Brisbane
  { lat: -41, lng: 175 },  // New Zealand
  { lat: -18, lng: 178 },  // Fiji
]

// ─── Per-land-point cache ─────────────────────────────────────────────────
// The /live globe refetches whenever the view shifts ≥10°, but most visible
// land points overlap between consecutive fetches. Caching per-point results
// for ~90s means a rotating globe only hits the API for the few NEW points
// that just rolled into view — the rest come from cache. Total API pressure
// stays similar to the old fixed-interval polling.
//
// We also negative-cache failures with a shorter TTL: if iNat 429-throttles us
// for a region, we MUST stop retrying it every tick — otherwise the storm of
// failed CORS-blocked requests floods the console and prolongs the throttle.
// And we limit cold-start concurrency so a 24-point first load doesn't fire
// 24 simultaneous requests.
const POINT_CACHE_TTL_MS = 90 * 1000
// Failed points are held out from re-fetch for several minutes. iNat (and to a
// lesser extent eBird) throttle by IP, and their 429 responses omit CORS
// headers — so the browser surfaces them as scary "CORS errors". If we retry
// the same point every 30s while throttled, we both spam the console AND
// prolong the throttle. A long fail-TTL breaks that loop.
const POINT_FAIL_TTL_MS = 5 * 60 * 1000
const FETCH_CONCURRENCY = 2
const FETCH_JITTER_MS = 120
const inatPointCache = new Map()  // key: "lat,lng" → { obs, expires }
const ebirdPointCache = new Map() // key: "lat,lng" → { obs, expires }
function pointKey(pt) { return `${pt.lat},${pt.lng}` }

// Run tasks with a concurrency limit; returns results in original order. Each
// worker waits a small jitter before starting so concurrent fetches don't all
// hit the server in the same millisecond (helps avoid burst-rate-limits).
async function limitedAll(tasks, limit = FETCH_CONCURRENCY) {
  const results = new Array(tasks.length)
  let i = 0
  async function worker(startDelay) {
    if (startDelay) await new Promise(r => setTimeout(r, startDelay))
    while (i < tasks.length) {
      const idx = i++
      results[idx] = await tasks[idx]()
    }
  }
  const workers = []
  const n = Math.min(limit, tasks.length)
  for (let w = 0; w < n; w++) workers.push(worker(w * (FETCH_JITTER_MS / n)))
  await Promise.all(workers)
  return results
}

// ─── Macaulay Library species photo cache ─────────────────────────────────
const macaulayCache = new Map()

async function fetchMacaulayPhoto(speciesCode) {
  if (macaulayCache.has(speciesCode)) return macaulayCache.get(speciesCode)
  try {
    const res = await fetch(
      `${MACAULAY_API}?taxonCode=${encodeURIComponent(speciesCode)}&mediaType=photo&sort=rating_rank_desc&count=1`
    )
    if (!res.ok) { macaulayCache.set(speciesCode, null); return null }
    const data = await res.json()
    const asset = data.results?.content?.[0]
    if (!asset?.assetId) { macaulayCache.set(speciesCode, null); return null }
    const url = `${MACAULAY_CDN}/${asset.assetId}/480`
    macaulayCache.set(speciesCode, url)
    return url
  } catch {
    macaulayCache.set(speciesCode, null)
    return null
  }
}

// ─── Geo helpers ──────────────────────────────────────────────────────────

function wrapLng(lng) {
  return ((lng + 540) % 360) - 180
}

// Angular distance between two points on the globe (degrees)
function angularDist(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180
  const dLng = toRad(lng1 - lng2)
  const a = toRad(lat1), b = toRad(lat2)
  const cos = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(dLng)
  return Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI
}

// Return LAND_POINTS visible from the current globe face (within ~90° of center)
function visibleLandPoints(center) {
  return LAND_POINTS.filter(pt => angularDist(center.lat, center.lng, pt.lat, pt.lng) < 90)
}

// ─── iNaturalist: fetch from visible land points ─────────────────────────
function mapINatResult(o) {
  return {
    id: `inat-${o.id}`,
    source: 'iNaturalist',
    taxonId: o.taxon?.id || null,
    commonName: o.taxon?.preferred_common_name || o.taxon?.name || 'Unknown',
    scientificName: o.taxon?.name || '',
    photoUrl: o.photos?.[0]?.url?.replace('square', 'small') || o.taxon?.default_photo?.medium_url || null,
    lat: o.geojson.coordinates[1],
    lng: o.geojson.coordinates[0],
    location: o.place_guess || '',
    // `time_observed_at` is ISO 8601 with the observation's timezone offset
    // — best for converting to the user's local time. Fall back to date-only
    // `observed_on`, then to UTC `created_at`.
    observedAt: o.time_observed_at || o.observed_on || o.created_at || '',
    iconicTaxon: o.taxon?.iconic_taxon_name || 'Unknown',
  }
}

// Zoom threshold: above this, use actual map bounds; below, use land points
const ZOOM_THRESHOLD = 3

export async function fetchRecentINat(mapView) {
  const center = mapView?.center
  const zoom = mapView?.zoom ?? 0
  const bounds = mapView?.bounds

  if (!center) {
    const res = await fetch(`${INAT_PROXY}?per_page=200&order=desc&order_by=created_at&captive=false&photos=true`)
    if (!res.ok) throw new Error(`iNaturalist error: ${res.status}`)
    const data = await res.json()
    if (data._upstream_status) return []
    return (data.results || []).filter(o => o.geojson?.coordinates).map(mapINatResult)
  }

  // Zoomed in: query the actual visible bounds directly
  if (zoom >= ZOOM_THRESHOLD && bounds) {
    const params = new URLSearchParams({
      per_page: 200,
      order: 'desc',
      order_by: 'created_at',
      captive: 'false',
      photos: 'true',
      swlat: Math.max(-90, bounds.swlat),
      nelat: Math.min(90, bounds.nelat),
      swlng: bounds.swlng,
      nelng: bounds.nelng,
    })
    const res = await fetch(`${INAT_PROXY}?${params}`)
    if (!res.ok) return []
    const data = await res.json()
    if (data._upstream_status) return []
    return (data.results || []).filter(o => o.geojson?.coordinates).map(mapINatResult)
  }

  // Zoomed out (globe view): scatter across visible land points
  const points = visibleLandPoints(center)
  const boxR = 5
  const now = Date.now()
  const perPage = Math.ceil(200 / Math.max(points.length, 1))

  const tasks = points.map(pt => async () => {
    const key = pointKey(pt)
    const cached = inatPointCache.get(key)
    if (cached && cached.expires > now) return cached.obs

    const params = new URLSearchParams({
      per_page: perPage,
      order: 'desc',
      order_by: 'created_at',
      captive: 'false',
      photos: 'true',
      swlat: Math.max(-90, pt.lat - boxR),
      nelat: Math.min(90, pt.lat + boxR),
      swlng: wrapLng(pt.lng - boxR),
      nelng: wrapLng(pt.lng + boxR),
    })
    try {
      const r = await fetch(`${INAT_PROXY}?${params}`)
      const d = r.ok ? await r.json() : null
      // The proxy returns 200 even on upstream errors (so Chrome doesn't
      // auto-log "Failed to load resource"); upstream failure is signalled
      // via `_upstream_status` in the body. Treat that as a fetch failure.
      if (!d || d._upstream_status) {
        inatPointCache.set(key, { obs: [], expires: now + POINT_FAIL_TTL_MS })
        return []
      }
      const obs = (d.results || []).filter(o => o.geojson?.coordinates).map(mapINatResult)
      inatPointCache.set(key, { obs, expires: now + POINT_CACHE_TTL_MS })
      return obs
    } catch {
      inatPointCache.set(key, { obs: [], expires: now + POINT_FAIL_TTL_MS })
      return []
    }
  })

  const results = await limitedAll(tasks)
  const seen = new Set()
  return results.flat().filter(o => {
    if (seen.has(o.id)) return false
    seen.add(o.id)
    return true
  })
}

// ─── eBird: notable observations from visible land points ────────────────
export async function fetchRecentEBird(mapView) {
  if (!EBIRD_KEY) return []
  const center = mapView?.center
  const zoom = mapView?.zoom ?? 0
  const bounds = mapView?.bounds
  if (!center) return []

  let points

  if (zoom >= ZOOM_THRESHOLD && bounds) {
    // Zoomed in: build a grid within the actual visible bounds
    const latSpan = bounds.nelat - bounds.swlat
    const lngSpan = bounds.nelng - bounds.swlng
    const rows = Math.max(2, Math.min(5, Math.ceil(latSpan / 2)))
    const cols = Math.max(2, Math.min(5, Math.ceil(lngSpan / 2)))
    points = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        points.push({
          lat: bounds.swlat + (r + 0.5) * latSpan / rows,
          lng: bounds.swlng + (c + 0.5) * lngSpan / cols,
        })
      }
    }
  } else {
    // Zoomed out: use curated land points
    points = visibleLandPoints(center)
  }

  const allObs = []
  const now = Date.now()

  const tasks = points.map(pt => async () => {
    const key = pointKey(pt)
    const cached = ebirdPointCache.get(key)
    if (cached && cached.expires > now) {
      allObs.push(...cached.obs)
      return
    }
    try {
      const res = await fetch(
        `${EBIRD_API}/data/obs/geo/recent/notable?lat=${pt.lat}&lng=${pt.lng}&dist=50&back=3&maxResults=30`,
        { headers: { 'x-ebirdapitoken': EBIRD_KEY } }
      )
      if (!res.ok) { ebirdPointCache.set(key, { obs: [], expires: now + POINT_FAIL_TTL_MS }); return }
      const data = await res.json()
      if (!Array.isArray(data)) { ebirdPointCache.set(key, { obs: [], expires: now + POINT_CACHE_TTL_MS }); return }

      const uniqueCodes = [...new Set(data.map(o => o.speciesCode).filter(Boolean))]
      await Promise.all(uniqueCodes.map(code => fetchMacaulayPhoto(code)))

      const pointObs = []
      for (const o of data) {
        if (o.lat == null || o.lng == null) continue
        pointObs.push({
          id: `ebird-${o.subId}-${o.speciesCode}`,
          source: 'eBird',
          commonName: o.comName || 'Unknown',
          scientificName: o.sciName || '',
          photoUrl: macaulayCache.get(o.speciesCode) || null,
          lat: o.lat,
          lng: o.lng,
          location: o.locName || '',
          observedAt: o.obsDt || '',
          iconicTaxon: 'Aves',
          speciesCode: o.speciesCode,
          howMany: o.howMany || null,
        })
      }
      ebirdPointCache.set(key, { obs: pointObs, expires: now + POINT_CACHE_TTL_MS })
      allObs.push(...pointObs)
    } catch {
      ebirdPointCache.set(key, { obs: [], expires: now + POINT_FAIL_TTL_MS })
    }
  })

  await limitedAll(tasks)

  // Deduplicate
  const seen = new Set()
  return allObs.filter(o => {
    if (seen.has(o.id)) return false
    seen.add(o.id)
    return true
  })
}

// ─── Combined fetch ───────────────────────────────────────────────────────
export async function fetchAllRecent(mapView) {
  const [inat, ebird] = await Promise.all([
    fetchRecentINat(mapView).catch(() => []),
    fetchRecentEBird(mapView).catch(() => []),
  ])
  return [...inat, ...ebird]
}
