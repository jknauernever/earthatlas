/**
 * InciWeb proxy — powers the /fire "Named incidents (InciWeb)" layer.
 *
 * GET /api/inciweb  → GeoJSON of named incident points parsed from the InciWeb
 * RSS (see api/_inciweb-core.js).
 *
 * Edge-cached; the RSS is national and small (~50 recent incidents). Always 200
 * with a (possibly empty) FeatureCollection so an upstream hiccup degrades
 * quietly. Mirrors api/cwfis.js.
 */

import { INCIWEB_RSS, parseInciwebRss } from './_inciweb-core.js'

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
    const r = await fetch(INCIWEB_RSS, { headers: { accept: 'application/rss+xml, text/xml' } })
    if (!r.ok) return json({ ...EMPTY, _upstream: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
    const xml = await r.text()
    return json(parseInciwebRss(xml), { status: 200, headers: { 'cache-control': 'public, s-maxage=600, stale-while-revalidate=1800' } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }
}
