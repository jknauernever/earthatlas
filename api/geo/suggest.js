/**
 * Mapbox Search Box /suggest proxy.
 *
 * GET /api/geo/suggest?q=…&session_token=…&proximity=lng,lat&limit=8&types=…
 *
 * Keeps the Mapbox token server-side so any earthatlas.org site (and any
 * caller via CORS) can hit a uniform endpoint without bundling a token.
 * Pair with /api/geo/retrieve.
 *
 * Runs on Vercel Edge so it doesn't count against the Hobby plan's
 * 12-serverless-function ceiling. Matches the runtime used by
 * api/news-legacy.js.
 */

export const config = { runtime: 'edge' }

const ALLOWED_TYPES = new Set([
  'country','region','district','postcode',
  'place','locality','neighborhood',
  'street','address','poi',
])

const DEFAULT_TYPES = 'country,region,district,postcode,place,locality,neighborhood,street,address,poi'

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

function sanitizeTypes(raw) {
  if (!raw) return DEFAULT_TYPES
  const filtered = raw.split(',').map((t) => t.trim().toLowerCase()).filter((t) => ALLOWED_TYPES.has(t))
  return filtered.length ? filtered.join(',') : DEFAULT_TYPES
}

function sanitizeLimit(raw) {
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return 8
  return Math.min(n, 10)
}

function sanitizeProximity(raw) {
  if (!raw) return ''
  const m = String(raw).match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/)
  return m ? `${m[1]},${m[2]}` : ''
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
  const q = String(searchParams.get('q') || '').trim().slice(0, 200)
  const sessionToken = String(searchParams.get('session_token') || '').slice(0, 128)
  const limit = sanitizeLimit(searchParams.get('limit'))
  const types = sanitizeTypes(searchParams.get('types'))
  const proximity = sanitizeProximity(searchParams.get('proximity'))
  const language = String(searchParams.get('language') || '').slice(0, 8)

  if (q.length < 2) return json({ suggestions: [] })
  if (!sessionToken) return json({ error: 'session_token required' }, { status: 400 })

  const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN
  if (!token) return json({ error: 'MAPBOX_TOKEN not configured' }, { status: 500 })

  const upstream = new URLSearchParams({
    q,
    access_token: token,
    session_token: sessionToken,
    limit: String(limit),
    types,
  })
  if (proximity) upstream.set('proximity', proximity)
  if (language) upstream.set('language', language)

  try {
    const r = await fetch(`https://api.mapbox.com/search/searchbox/v1/suggest?${upstream}`)
    const body = await r.text()
    return new Response(body, {
      status: r.status,
      headers: {
        'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...corsHeaders(),
      },
    })
  } catch (err) {
    return json({ error: 'upstream fetch failed', detail: String(err) }, { status: 502 })
  }
}
