/**
 * GBIF occurrence-search proxy — the shared cache in front of api.gbif.org
 * for every explore subsite and the main Species Explorer.
 *
 * GET /api/gbif-proxy?<occurrence/search params>
 *
 * Why it exists (mirrors api/inat-proxy.js and api/ebird.js): Vercel's edge
 * CDN caches responses, so repeat queries across ALL visitors share one
 * upstream call. Clients quantize their bboxes to a fixed grid (see
 * src/explore/wildQuery.js) precisely so those cache keys collide — without
 * that, every pan is a unique URL and a cache does nothing.
 *
 * Cache TTLs by query class:
 *   facet=month (seasonal patterns) — history barely moves: 24h
 *   eventDate (recent-window search) — day-stamped keys, fresh enough: 1h
 *   anything else                                                    : 30min
 *
 * Params are whitelisted so this can't be used as an open relay; taxonKey
 * and basisOfRecord repeat (GBIF's multi-value convention) and are forwarded
 * as-is. Upstream failures return 200 with `_upstream_status` (same contract
 * as inat-proxy) so throttling never spams the console as network errors.
 */

export const config = { runtime: 'edge' }

const GBIF_BASE = 'https://api.gbif.org/v1/occurrence/search'

const ALLOWED_SINGLE = new Set([
  'hasCoordinate', 'occurrenceStatus',
  'decimalLatitude', 'decimalLongitude',
  'eventDate', 'month', 'limit', 'offset',
  'facet', 'month.facetLimit',
])
const ALLOWED_MULTI = new Set(['taxonKey', 'basisOfRecord'])

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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
  const upstream = new URLSearchParams()
  for (const [key, value] of searchParams) {
    if (ALLOWED_SINGLE.has(key)) upstream.set(key, value)
    else if (ALLOWED_MULTI.has(key)) upstream.append(key, value)
  }
  if (!upstream.has('taxonKey')) {
    return json({ error: 'taxonKey required' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  }
  if (upstream.has('limit')) {
    const n = parseInt(upstream.get('limit'), 10)
    upstream.set('limit', String(Number.isFinite(n) ? Math.max(0, Math.min(300, n)) : 100))
  }

  // max-age adds BROWSER caching on top of the edge cache: a user reloading
  // the exact same view serves from disk with zero requests. Kept shorter
  // than s-maxage so freshness is bounded by the user's own session scale.
  const cacheControl = upstream.get('facet') === 'month'
    ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200'
    : upstream.has('eventDate')
      ? 'public, max-age=900, s-maxage=3600, stale-while-revalidate=7200'
      : 'public, max-age=600, s-maxage=1800, stale-while-revalidate=3600'

  try {
    const r = await fetch(`${GBIF_BASE}?${upstream}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (r.ok) {
      const body = await r.text()
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': cacheControl,
          ...corsHeaders(),
        },
      })
    }
    // Throttled/erroring upstream: 200 + signal, briefly cached so a herd
    // of clients doesn't hammer a struggling GBIF.
    return json({ results: [], count: 0, _upstream_status: r.status }, {
      headers: { 'cache-control': 'public, s-maxage=60' },
    })
  } catch (err) {
    return json({ results: [], count: 0, _upstream_error: String(err).slice(0, 200) }, {
      headers: { 'cache-control': 'public, s-maxage=60' },
    })
  }
}
