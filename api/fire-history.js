/**
 * NIFC IFPH historical-perimeter proxy — powers the /fire "Past fires (US)" layer.
 *
 * GET /api/fire-history?bbox=west,south,east,north
 *   → GeoJSON of historical fire perimeters intersecting the viewport.
 *
 * Viewport-gated (the client only calls it zoomed in) + hard edge-caching, since
 * historical perimeters are static. Normalizes IFPH's fields (and cleans the
 * FIRE_YEAR_INT 9999 sentinels) down to {name, year, acres, agency, category};
 * see api/_fire-history-core.js. Always 200 with a (possibly empty) collection.
 *
 * NOTE: this serves IFPH live from the ArcGIS FeatureServer. A future
 * optimization is to bake Welty-Jeffries (the deduped USGS spine) to PMTiles on
 * Blob for global-smooth pan/zoom — but live IFPH ships the historical layer now.
 */

import { resolveFireHistoryRequest, normalizeFireHistory } from './_fire-history-core.js'

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
  const resolved = resolveFireHistoryRequest(searchParams)
  if (resolved.error) return json({ error: resolved.error }, { status: resolved.status })

  try {
    const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
    if (!r.ok) return json({ ...EMPTY, _upstream: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    const raw = await r.json()
    const fc = normalizeFireHistory(raw, resolved.max)
    return json(fc, { status: 200, headers: { 'cache-control': resolved.cacheControl } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
