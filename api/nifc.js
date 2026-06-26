/**
 * NIFC WFIGS proxy — powers the /fire "Active wildfires (US)" layer.
 *
 * GET /api/nifc?layer=perimeters|incidents
 *   → GeoJSON FeatureCollection (normalized to a canonical incident schema).
 *
 * Why a proxy (mirrors api/firms.js / api/ebird.js):
 *   1. Vercel's edge CDN caches each layer so every visitor shares one upstream
 *      pull — NIFC's load policy forbids relative-date queries, so we pull the
 *      whole current service and cache it rather than per-request filtering.
 *   2. One place to normalize WFIGS's 100+-field records down to the handful the
 *      popup needs (see api/_nifc-core.js).
 *
 * No auth — WFIGS services are public. Always returns 200 with a (possibly
 * empty) FeatureCollection so an upstream hiccup degrades quietly on the map.
 */

import { resolveNifcRequest, normalizeNifc } from './_nifc-core.js'

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

const EMPTY = { type: 'FeatureCollection', features: [], _count: 0 }

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
  const resolved = resolveNifcRequest(searchParams)
  if (resolved.error) return json({ error: resolved.error }, { status: resolved.status })

  try {
    const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
    if (!r.ok) {
      return json({ ...EMPTY, _upstream: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    }
    const raw = await r.json()
    const fc = normalizeNifc(raw, resolved.layer)
    return json(fc, { status: 200, headers: { 'cache-control': resolved.cacheControl } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
