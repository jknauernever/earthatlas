/**
 * NASA FIRMS active-fire proxy — powers the /fire "Active fires" layer.
 *
 * GET /api/firms?bbox=west,south,east,north&days=1[&src=VIIRS_NOAA20_NRT,...]
 *   → GeoJSON FeatureCollection of satellite hotspot detections.
 *
 * Why a proxy (mirrors api/ebird.js):
 *   1. The FIRMS MAP_KEY (FIRMS_MAP_KEY) stays server-side, never shipped to the
 *      browser bundle where it could be scraped and burned against the
 *      5000-per-10-min cap.
 *   2. Vercel's edge CDN caches each bbox/day response, so repeat pans across all
 *      visitors share one upstream pull. FIRMS only updates on overpass cadence,
 *      so a few minutes of edge staleness is invisible.
 *
 * The proxy also reshapes FIRMS CSV into GeoJSON and computes hours-since-
 * detection server-side (see api/_firms-core.js), so the client just styles
 * points by age. Always returns 200 with a (possibly empty) FeatureCollection so
 * a throttled upstream never surfaces as a scary CORS/network error.
 */

import { resolveFirmsRequest, firmsCsvToGeoJSON } from './_firms-core.js'

export const config = { runtime: 'edge' }

const MAP_KEY = process.env.FIRMS_MAP_KEY || ''

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
  const resolved = resolveFirmsRequest(searchParams, MAP_KEY)
  if (resolved.error) {
    // Bad input → 400; misconfig → 200-empty so the map degrades quietly.
    if (resolved.status === 500) return json({ ...EMPTY, _error: resolved.error }, { status: 200, headers: { 'cache-control': 'no-store' } })
    return json({ error: resolved.error }, { status: resolved.status })
  }

  try {
    const texts = await Promise.all(
      resolved.urls.map(({ src, url }) =>
        fetch(url, { headers: { accept: 'text/csv' } })
          .then((r) => (r.ok ? r.text() : ''))
          .then((text) => ({ src, text }))
          .catch(() => ({ src, text: '' }))
      )
    )
    const fc = firmsCsvToGeoJSON(texts, Date.now(), { minFrp: resolved.minFrp })
    return json(fc, { status: 200, headers: { 'cache-control': resolved.cacheControl } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, {
      status: 200,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
