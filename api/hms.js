/**
 * NOAA HMS fire-detection proxy — powers the /fire "GOES + satellite fire
 * detections" layer.
 *
 * GET /api/hms?bbox=west,south,east,north  → GeoJSON of HMS detections in view.
 *
 * Viewport-gated + edge-cached over the public NESDIS/NIFC ArcGIS service.
 * Normalizes to {sat, geo, frp, hours_ago} (see api/_hms-core.js). Always 200
 * with a (possibly empty) FeatureCollection so an upstream hiccup degrades
 * quietly. Mirrors api/nifc.js / api/fire-history.js.
 */

import { resolveHmsRequest, normalizeHms } from './_hms-core.js'

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

  const { searchParams } = new URL(req.url)
  const resolved = resolveHmsRequest(searchParams)
  if (resolved.error) return json({ error: resolved.error }, { status: resolved.status })

  try {
    const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
    if (!r.ok) return json({ ...EMPTY, _upstream: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    const raw = await r.json()
    return json(normalizeHms(raw, Date.now()), { status: 200, headers: { 'cache-control': resolved.cacheControl } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
