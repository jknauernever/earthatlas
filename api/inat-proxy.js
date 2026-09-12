/**
 * iNaturalist /observations proxy.
 *
 * GET /api/inat-proxy?per_page=…&swlat=…&nelat=…&swlng=…&nelng=…
 * GET /api/inat-proxy?agg=place_counts&place_ids=1,6712,…&d1=…&d2=…
 *
 * The /live globe queries iNat from ~24 visible land points in parallel. When
 * iNat IP-throttles us, their 429 responses omit CORS headers — which Chrome
 * surfaces as scary "blocked by CORS policy" console errors even though the
 * actual response is just rate-limit signalling. Proxying server-side
 * (1) eliminates the CORS layer entirely, (2) lets us cache responses at the
 * edge so repeat hits across users don't multiply upstream load, and
 * (3) gives us real HTTP status codes the client can act on.
 *
 * Edge runtime: matches the rest of /api so we stay under Hobby plan's
 * 12-serverless-function ceiling.
 */

export const config = { runtime: 'edge' }

const INAT_BASE = 'https://api.inaturalist.org/v1/observations'

// Whitelist of query params our app actually uses against /observations.
// Anything else gets dropped to keep this proxy from becoming an open relay.
const ALLOWED_PARAMS = new Set([
  'per_page',
  'page',
  'order',
  'order_by',
  'captive',
  'photos',
  'quality_grade',
  'swlat', 'nelat', 'swlng', 'nelng',
  'lat', 'lng', 'radius',
  'taxon_id',
  'iconic_taxa',
  'd1', 'd2',
  'geo',
])

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  }
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...(init.headers || {}),
    },
  })
}

function clampInt(raw, min, max, def) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, n))
}

function isFiniteCoord(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= -360 && n <= 360
}

// Aggregate mode (?agg=place_counts&place_ids=1,6712,…): one observation count
// per place, in a single response. The "top countries" leaderboard needs a
// count for each of ~15 places; doing that from the browser is 15 parallel
// requests per view, which Sentry's performance detector files as an N+1 API
// call and which multiplies our exposure to iNat's per-IP throttling. Fan out
// here instead — the client makes one request, the edge caches one entry, and
// iNat sees a single origin.
const MAX_PLACE_IDS = 20
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

async function placeCounts(searchParams) {
  const ids = (searchParams.get('place_ids') || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, MAX_PLACE_IDS)
  if (!ids.length) return json({ error: 'place_ids required' }, { status: 400 })

  const shared = new URLSearchParams({ per_page: '0' })
  for (const k of ['d1', 'd2']) {
    const v = searchParams.get(k)
    if (v && ISO_DATE.test(v)) shared.set(k, v)
  }

  const results = await Promise.all(ids.map(async (placeId) => {
    const params = new URLSearchParams(shared)
    params.set('place_id', String(placeId))
    try {
      const r = await fetch(`${INAT_BASE}?${params}`, { headers: { accept: 'application/json' } })
      if (!r.ok) return { place_id: placeId, total_results: null, _upstream_status: r.status }
      const data = await r.json()
      return { place_id: placeId, total_results: data.total_results || 0 }
    } catch (err) {
      return { place_id: placeId, total_results: null, _upstream_error: String(err) }
    }
  }))

  // Counts move slowly, so a partial result is worth returning — but don't let
  // the edge cache pin one in place; only a clean sweep gets cached.
  const complete = results.every((r) => r.total_results != null)
  return json({ results }, {
    headers: {
      'cache-control': complete
        ? 'public, s-maxage=600, stale-while-revalidate=3600'
        : 'no-store',
    },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
  if (searchParams.get('agg') === 'place_counts') return placeCounts(searchParams)

  const slim = searchParams.get('slim') === '1'
  const upstream = new URLSearchParams()

  for (const [key, value] of searchParams) {
    if (!ALLOWED_PARAMS.has(key)) continue
    upstream.set(key, value)
  }

  // Sanitize / clamp the values we know are bounded
  if (upstream.has('per_page')) {
    upstream.set('per_page', String(clampInt(upstream.get('per_page'), 1, 200, 30)))
  }
  for (const k of ['swlat', 'nelat', 'swlng', 'nelng']) {
    const v = upstream.get(k)
    if (v != null && !isFiniteCoord(v)) upstream.delete(k)
  }

  try {
    const r = await fetch(`${INAT_BASE}?${upstream}`, {
      headers: { 'accept': 'application/json' },
    })

    // Always return 200 to the client. Forwarding the upstream status (e.g.
    // 429 throttling) causes Chrome to auto-log "Failed to load resource" for
    // every failed sub-request — and the /live globe makes ~24 of them per
    // load. We signal upstream failures via `_upstream_status` in the body
    // instead; the client checks that to trigger its negative cache.
    if (r.ok) {
      // slim=1 (explore subsites): strip each observation to the handful of
      // fields the client actually renders. A 200-result page of full iNat
      // objects is ~28 MB — too big for the edge cache to store at all, and
      // an absurd transfer per visitor. Slimmed it's ~100 KB, cacheable,
      // and byte-stable for the warm cron. Full payloads stay available to
      // /live and the main page, which use richer fields.
      if (slim) {
        const data = JSON.parse(await r.text())
        const slimmed = {
          total_results: data.total_results,
          page: data.page,
          per_page: data.per_page,
          results: (data.results || []).map((o) => ({
            id: o.id,
            observed_on: o.observed_on,
            place_guess: o.place_guess,
            geojson: o.geojson ? { coordinates: o.geojson.coordinates } : null,
            taxon: o.taxon ? { name: o.taxon.name, preferred_common_name: o.taxon.preferred_common_name } : null,
            user: o.user ? { login: o.user.login } : null,
            photos: o.photos?.[0]?.url ? [{ url: o.photos[0].url }] : [],
          })),
        }
        return new Response(JSON.stringify(slimmed), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': upstream.has('d1')
              ? 'public, s-maxage=3600, stale-while-revalidate=7200'
              : 'public, s-maxage=60, stale-while-revalidate=300',
            ...corsHeaders(),
          },
        })
      }
      const body = await r.text()
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
          // Live-ish queries cache 60s; a day-stamped d1/d2 window (the
          // explore subsites' "past N days", stable keys within a day)
          // caches 1h — freshness within the hour is immaterial there and
          // shared hits are what keep iNat off our backs at scale.
          'cache-control': upstream.has('d1')
            ? 'public, s-maxage=3600, stale-while-revalidate=7200'
            : 'public, s-maxage=60, stale-while-revalidate=300',
          ...corsHeaders(),
        },
      })
    }
    return json(
      { results: [], total_results: 0, _upstream_status: r.status },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    )
  } catch (err) {
    return json(
      { results: [], total_results: 0, _upstream_status: 0, _upstream_error: String(err) },
      { status: 200, headers: { 'cache-control': 'no-store' } }
    )
  }
}
