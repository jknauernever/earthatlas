/**
 * Shared core for the eBird proxy — request builders + param sanitization.
 *
 * Imported by both the production Edge function (api/ebird.js) and the dev
 * middleware (ebirdProxyPlugin in vite.config.js) so every eBird-backed tool
 * behaves identically under `npm run dev`, `vercel dev`, and prod. The `_`
 * prefix keeps Vercel from treating this as its own serverless route.
 *
 * Why this exists: eBird's API 2.0 requires a private token, and Cornell now
 * caps each key at 10,000 requests/day (rolling) + a 1 req/sec burst. The old
 * design fetched eBird straight from the browser using a VITE_-exposed key, so
 * every visitor's map pans and every /live point hit eBird independently —
 * trivially blowing the daily cap. Routing through this proxy:
 *   1. Keeps the key server-side (process.env.EBIRD_API_KEY), out of the bundle.
 *   2. Lets Vercel's edge CDN cache responses so repeat hits across ALL visitors
 *      collapse to a single upstream call (the big win — eBird responses for a
 *      given region/date/point are identical for everyone).
 * Rather than proxy arbitrary eBird paths (an open relay), we accept a small set
 * of typed params and build one of a few known, locked-down requests.
 */

export const EBIRD_BASE = 'https://api.ebird.org/v2'

// ─── Param validators ────────────────────────────────────────────────────────
// eBird region codes: country ("US"), subnational1 ("US-NM"), subnational2
// ("US-NM-001"). Always uppercase.
const REGION_RE = /^[A-Z]{2}(-[A-Z0-9]+){0,2}$/
// Species codes are lowercase alphanumeric, e.g. "rethaw", "bkcchi".
const SPECIES_RE = /^[a-z0-9]+$/

function num(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : null
}

function clampInt(raw, min, max, def) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

function isCoord(lat, lng) {
  return lat != null && lng != null &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function validDate(y, m, d) {
  return Number.isInteger(y) && y >= 2000 && y <= 2100 &&
    Number.isInteger(m) && m >= 1 && m <= 12 &&
    Number.isInteger(d) && d >= 1 && d <= 31
}

// ─── Cache-Control per op ────────────────────────────────────────────────────
// Date-keyed endpoints (stats, historic): a past day's data is effectively
// immutable, so cache it for a day; "today" is still accumulating, so a short
// TTL with stale-while-revalidate keeps it fresh without hammering upstream.
function dateCacheControl(y, m, d) {
  const target = Date.UTC(y, m - 1, d)
  const todayUTC = new Date()
  const today = Date.UTC(todayUTC.getUTCFullYear(), todayUTC.getUTCMonth(), todayUTC.getUTCDate())
  const daysAgo = Math.round((today - target) / 86400000)
  if (daysAgo >= 2) {
    // Settled day — cache hard.
    return 'public, s-maxage=86400, stale-while-revalidate=604800'
  }
  // Today / yesterday — refresh every 15 min, serve stale for an hour.
  return 'public, s-maxage=900, stale-while-revalidate=3600'
}

// Rolling-window endpoints: notable/recent observations over the last N days.
// They drift slowly; a 10-min shared edge cache turns "every visitor × every
// /live point" into roughly one upstream call per point per 10 min, globally.
const CACHE_RECENT = 'public, s-maxage=600, stale-while-revalidate=1800'
// Taxonomy almost never changes — cache a week.
const CACHE_TAXONOMY = 'public, s-maxage=604800, stale-while-revalidate=86400'

// Empty fallbacks per op (what the client gets when upstream fails). eBird's obs
// endpoints return a JSON array; stats returns an object.
export const EMPTY = {
  taxonomy: [],
  stats: {},
  obsHistoric: [],
  obsRecent: [],
  obsNotable: [],
}

// ─── Operations: each builds a locked-down upstream path from sanitized params ─
const OPERATIONS = {
  // Full eBird taxonomy (species list). One call serves the whole app.
  taxonomy() {
    return { path: '/ref/taxonomy/ebird?fmt=json&locale=en', cacheControl: CACHE_TAXONOMY }
  },

  // Regional summary stats for a single day. ?region=US&y=&m=&d=
  stats(sp) {
    const region = (sp.get('region') || '').toUpperCase()
    if (!REGION_RE.test(region)) return { error: 'invalid region', status: 400 }
    const y = parseInt(sp.get('y'), 10), m = parseInt(sp.get('m'), 10), d = parseInt(sp.get('d'), 10)
    if (!validDate(y, m, d)) return { error: 'invalid date', status: 400 }
    return { path: `/product/stats/${region}/${y}/${m}/${d}`, cacheControl: dateCacheControl(y, m, d) }
  },

  // One observation per species in a region on a given day.
  // ?region=US-NM&y=&m=&d=&maxResults=
  obsHistoric(sp) {
    const region = (sp.get('region') || '').toUpperCase()
    if (!REGION_RE.test(region)) return { error: 'invalid region', status: 400 }
    const y = parseInt(sp.get('y'), 10), m = parseInt(sp.get('m'), 10), d = parseInt(sp.get('d'), 10)
    if (!validDate(y, m, d)) return { error: 'invalid date', status: 400 }
    const maxResults = clampInt(sp.get('maxResults'), 1, 10000, 10000)
    return {
      path: `/data/obs/${region}/historic/${y}/${m}/${d}?maxResults=${maxResults}&includeProvisional=true`,
      cacheControl: dateCacheControl(y, m, d),
    }
  },

  // Recent observations within a radius, optionally for one species.
  // ?lat=&lng=&dist=&back=&maxResults=&speciesCode=
  obsRecent(sp) {
    const lat = num(sp.get('lat')), lng = num(sp.get('lng'))
    if (!isCoord(lat, lng)) return { error: 'invalid lat/lng', status: 400 }
    const dist = clampInt(sp.get('dist'), 1, 50, 50)
    const back = clampInt(sp.get('back'), 1, 30, 14)
    const maxResults = clampInt(sp.get('maxResults'), 1, 10000, 200)
    const speciesCode = sp.get('speciesCode') || ''
    const seg = speciesCode ? (SPECIES_RE.test(speciesCode) ? `/${speciesCode}` : null) : ''
    if (seg === null) return { error: 'invalid speciesCode', status: 400 }
    return {
      path: `/data/obs/geo/recent${seg}?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&dist=${dist}&back=${back}&maxResults=${maxResults}&includeProvisional=true`,
      cacheControl: CACHE_RECENT,
    }
  },

  // Recent *notable* (rare/locally-unusual) observations within a radius.
  // Powers the /live globe. ?lat=&lng=&dist=&back=&maxResults=
  obsNotable(sp) {
    const lat = num(sp.get('lat')), lng = num(sp.get('lng'))
    if (!isCoord(lat, lng)) return { error: 'invalid lat/lng', status: 400 }
    const dist = clampInt(sp.get('dist'), 1, 50, 50)
    const back = clampInt(sp.get('back'), 1, 30, 3)
    const maxResults = clampInt(sp.get('maxResults'), 1, 200, 30)
    return {
      path: `/data/obs/geo/recent/notable?lat=${lat.toFixed(4)}&lng=${lng.toFixed(4)}&dist=${dist}&back=${back}&maxResults=${maxResults}`,
      cacheControl: CACHE_RECENT,
    }
  },
}

/**
 * Resolve a sanitized upstream eBird request from incoming query params.
 * @param {URLSearchParams} sp
 * @returns {{error:string,status:number} | {op:string,path:string,cacheControl:string,empty:any}}
 */
export function resolveEbirdRequest(sp) {
  const op = sp.get('op')
  if (!op || !OPERATIONS[op]) {
    return { error: `unknown op; expected one of ${Object.keys(OPERATIONS).join(', ')}`, status: 400 }
  }
  const built = OPERATIONS[op](sp)
  if (built.error) return built
  return { op, path: built.path, cacheControl: built.cacheControl, empty: EMPTY[op] }
}
