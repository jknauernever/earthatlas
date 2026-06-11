/**
 * eBird API 2.0 proxy — powers every eBird-backed EarthAtlas tool (the main
 * search, /live notable observations, region stats, taxonomy).
 *
 * GET /api/ebird?op=<taxonomy|stats|obsHistoric|obsRecent|obsNotable>&…
 *
 * Thin Edge wrapper over the shared core (api/_ebird-core.js), which builds a
 * small set of locked-down requests against eBird and attaches a per-op edge
 * cache policy. Two reasons this proxy exists:
 *   1. The eBird token (EBIRD_API_KEY) stays server-side instead of shipping in
 *      the browser bundle — so it can't be scraped and burned by anyone.
 *   2. Vercel's edge CDN caches the responses, so repeat hits across all
 *      visitors share one upstream call. eBird now caps keys at 10,000 req/day
 *      (rolling) + 1 req/sec burst; caching is what keeps us under that.
 *
 * Edge runtime: matches the rest of /api. Mirrors api/birdweather.js and
 * api/inat-proxy.js conventions — always returns 200 so a throttled upstream
 * (429) doesn't surface in the browser as a scary CORS/network error; the
 * client reads `_upstream_status` (and the empty body) to degrade gracefully.
 */

import { EBIRD_BASE, resolveEbirdRequest } from './_ebird-core.js'

export const config = { runtime: 'edge' }

// Server-side only. Prefer the clean name; fall back to the legacy VITE_ name so
// this keeps working before the Vercel env var is renamed. (Even when VITE_-named
// it's no longer exposed to the browser, since no client code references it.)
const API_KEY = process.env.EBIRD_API_KEY || process.env.VITE_EBIRD_API_KEY || ''

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
  if (!API_KEY) return json({ error: 'eBird key not configured' }, { status: 500, headers: { 'cache-control': 'no-store' } })

  const { searchParams } = new URL(req.url)
  const resolved = resolveEbirdRequest(searchParams)
  if (resolved.error) return json({ error: resolved.error }, { status: resolved.status })

  const { path, cacheControl, empty } = resolved

  try {
    const r = await fetch(`${EBIRD_BASE}${path}`, {
      headers: { 'x-ebirdapitoken': API_KEY, accept: 'application/json' },
    })

    if (r.ok) {
      // Pass the upstream body through verbatim (eBird obs endpoints return a
      // JSON array; stats returns an object) with our edge cache policy.
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

    // Upstream failure (e.g. 429 daily-cap / burst). Return the op's empty value
    // so the client renders cleanly; signal the real status in the body header
    // and don't cache the failure.
    return json(empty, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'x-ebird-upstream': String(r.status) },
    })
  } catch (err) {
    return json(empty, {
      status: 200,
      headers: { 'cache-control': 'no-store', 'x-ebird-upstream': '0', 'x-ebird-error': String(err).slice(0, 120) },
    })
  }
}
