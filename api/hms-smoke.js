/**
 * NOAA HMS smoke-plume proxy — analyst-drawn smoke extents (light/medium/
 * heavy) traced from GOES imagery, one cumulative file per UTC day.
 *
 * GET /api/hms-smoke → GeoJSON FeatureCollection of today's plumes
 * ({density, start_ms, end_ms, satellite}). Whole-continent payload
 * (~100 KB), edge-cached 15 min. Always 200 with a (possibly empty)
 * FeatureCollection so an upstream hiccup degrades quietly. Mirrors
 * api/hms.js.
 */

import { fetchHmsSmoke, HMS_SMOKE_CACHE } from './_hms-smoke-core.js'

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
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(), ...(init.headers || {}) },
  })
}

const EMPTY = { type: 'FeatureCollection', features: [], _count: 0 }

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })
  try {
    const fc = await fetchHmsSmoke()
    return json(fc, { status: 200, headers: { 'cache-control': HMS_SMOKE_CACHE } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
