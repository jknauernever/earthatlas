/**
 * BirdWeather GraphQL proxy — powers the EarthAtlas /birdsong tool.
 *
 * GET /api/birdweather?op=<stations|detections|topSpecies|station>&…
 *
 * Thin Edge wrapper over the shared core (api/_birdweather-core.js), which
 * builds a small set of locked-down queries against BirdWeather's public
 * GraphQL endpoint and caches them at the edge. Proxying server-side shields
 * the browser from the GraphQL/CORS layer and lets repeat hits across visitors
 * share a cached response instead of hammering upstream.
 *
 * Edge runtime: matches the rest of /api so we stay under the Hobby plan's
 * 12-serverless-function ceiling. Mirrors api/inat-proxy.js conventions.
 */

import { GRAPHQL_URL, resolveBirdweatherQuery } from './_birdweather-core.js'

export const config = { runtime: 'edge' }

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
  const resolved = resolveBirdweatherQuery(searchParams)
  if (resolved.error) return json({ error: resolved.error }, { status: resolved.status })

  const { query, variables, cacheControl, empty } = resolved

  try {
    const r = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    })

    if (!r.ok) {
      return json({ data: empty, _upstream_status: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    }

    const payload = await r.json()
    if (payload.errors) {
      return json({ data: empty, _upstream_errors: payload.errors }, { status: 200, headers: { 'cache-control': 'no-store' } })
    }

    return json({ data: payload.data || empty }, { status: 200, headers: { 'cache-control': cacheControl } })
  } catch (err) {
    return json({ data: empty, _upstream_status: 0, _upstream_error: String(err) }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
