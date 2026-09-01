/**
 * Water-aware reverse geocode proxy.
 *
 * GET /api/geo/reverse?lat=34.12&lng=-119.58
 * → { name: "42 km from Goleta, CA, US", kind: "near", km: 42, place: "Goleta, CA, US" }
 *
 * Keeps the Mapbox token server-side and — the real win — lets the CDN cache
 * the nearest-place probe fan-out (up to ~40 upstream calls for a deep-ocean
 * point) per rounded coordinate. Callers should round lat/lng to 2 decimals
 * so cache keys collapse; the handler rounds anyway to enforce it.
 *
 * Edge runtime like the other /api/geo functions (doesn't count against the
 * Hobby plan's serverless-function ceiling).
 */

import { resolveReverse } from '../_geo-reverse-core.js'

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
  const lat = Number(searchParams.get('lat'))
  const lng = Number(searchParams.get('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return json({ error: 'valid lat and lng required' }, { status: 400 })
  }

  const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN
  if (!token) return json({ error: 'MAPBOX_TOKEN not configured' }, { status: 500 })

  const result = await resolveReverse({
    lat: Math.round(lat * 100) / 100,
    lng: Math.round(lng * 100) / 100,
    token,
  })

  return json(result, {
    headers: {
      // Place names don't move: cache at the edge for 30 days
      'cache-control': 'public, s-maxage=2592000, stale-while-revalidate=86400',
    },
  })
}
