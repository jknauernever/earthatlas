/**
 * EarthAtlas /carbon proxy → the GEE tile server.
 *
 * Keeps the tile server's API key server-side so the browser never sees it.
 * Two modes:
 *   • POST { geometry: <GeoJSON Polygon> }
 *       → forwards to the tile server's /api/carbon zonal-stats endpoint,
 *         returns measured land-carbon for the drawn polygon.
 *   • GET ?overlay=<dataset>  (e.g. ndvi, urban)
 *       → asks the tile server for a GEE raster tile-URL template for the
 *         map overlay toggles. Returns { tileUrl }.
 *
 * Runs on Vercel Edge (like api/geo/*) so it doesn't count against the Hobby
 * plan's serverless-function ceiling.
 *
 * Env:
 *   GEE_TILE_SERVER_API_KEY  — the tile server's API_KEY (required)
 *   GEE_TILE_SERVER_URL      — base URL (default https://gee-tile-server.vercel.app)
 */

export const config = { runtime: 'edge' }

const DEFAULT_BASE = 'https://gee-tile-server.vercel.app'
// Datasets we expose as map overlays — guards against proxying arbitrary input.
const OVERLAYS = new Set(['ndvi', 'urban', 'evi', 'temperature'])

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })

  const apiKey = process.env.GEE_TILE_SERVER_API_KEY
  const base = (process.env.GEE_TILE_SERVER_URL || DEFAULT_BASE).replace(/\/$/, '')
  if (!apiKey) return json({ error: 'GEE_TILE_SERVER_API_KEY not configured' }, { status: 500 })

  // ── Overlay tile-URL lookup ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const { searchParams } = new URL(req.url)
    const overlay = String(searchParams.get('overlay') || '').toLowerCase()
    if (!OVERLAYS.has(overlay)) return json({ error: 'unknown overlay' }, { status: 400 })
    try {
      // NDVI comes from the dedicated Sentinel-2 endpoint (10 m, clean Mercator)
      // rather than /api/tiles' MODIS layer (250 m, sinusoidal — renders as
      // coarse, angled blocks at parcel zoom). Other overlays use /api/tiles.
      let upstream
      if (overlay === 'ndvi') {
        upstream = new URL(`${base}/api/s2-ndvi`)
        upstream.searchParams.set('apikey', apiKey)
      } else {
        upstream = new URL(`${base}/api/tiles`)
        upstream.searchParams.set('dataset', overlay)
        upstream.searchParams.set('autoLatest', 'true')
        upstream.searchParams.set('apikey', apiKey)
      }
      const r = await fetch(upstream, { headers: { accept: 'application/json' } })
      const data = await r.json()
      if (!r.ok || !data.tile_url) {
        return json({ error: data.error || 'overlay unavailable', details: data.suggestion }, { status: r.status || 502 })
      }
      return json({ tileUrl: data.tile_url, dataset: overlay, dataInfo: data.dataInfo })
    } catch (e) {
      return json({ error: 'overlay fetch failed', details: String(e) }, { status: 502 })
    }
  }

  // ── Carbon zonal stats ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try { body = await req.json() } catch { return json({ error: 'invalid JSON body' }, { status: 400 }) }
    const geometry = body?.geometry
    if (!geometry || geometry.type !== 'Polygon') {
      return json({ error: 'expected a GeoJSON Polygon in { geometry }' }, { status: 400 })
    }
    try {
      const r = await fetch(`${base}/api/carbon`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ geometry, apikey: apiKey }),
      })
      const text = await r.text()
      // Pass the tile server's JSON through verbatim (status included).
      return new Response(text, {
        status: r.status,
        headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders() },
      })
    } catch (e) {
      return json({ error: 'carbon calculation failed', details: String(e) }, { status: 502 })
    }
  }

  return json({ error: 'method not allowed' }, { status: 405 })
}
