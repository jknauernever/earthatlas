/**
 * CWFIS proxy — powers the /fire "Active wildfires (Canada)" layer.
 *
 * GET /api/cwfis  → GeoJSON of current Canada M3 active-fire perimeters.
 *
 * Edge-cached, normalized (see api/_cwfis-core.js). Mirrors api/nifc.js. Always
 * returns 200 with a (possibly empty) FeatureCollection so an upstream hiccup
 * degrades quietly on the map. No auth — CWFIS GeoServer is public.
 */

import { resolveCwfisRequest, normalizeCwfis } from './_cwfis-core.js'

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

  const { url, cacheControl } = resolveCwfisRequest()
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return json({ ...EMPTY, _upstream: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    const raw = await r.json()
    return json(normalizeCwfis(raw), { status: 200, headers: { 'cache-control': cacheControl } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
