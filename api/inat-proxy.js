/**
 * iNaturalist /observations proxy.
 *
 * GET /api/inat-proxy?per_page=…&swlat=…&nelat=…&swlng=…&nelng=…
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
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
      const body = await r.text()
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
          // Edge cache 60s, stale-while-revalidate 5min. Live observations
          // don't change minute-to-minute, and cache hits dramatically reduce
          // upstream iNat pressure across all visitors.
          'cache-control': 'public, s-maxage=60, stale-while-revalidate=300',
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
