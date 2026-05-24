/**
 * Mapbox Search Box /retrieve proxy.
 *
 * GET /api/geo/retrieve?id=<mapbox_id>&session_token=…
 *
 * Pairs with /api/geo/suggest. The session_token must match the one used in
 * the suggest call (one session per "search transaction" — Mapbox billing).
 *
 * Runs on Vercel Edge so it doesn't count against the Hobby plan's
 * 12-serverless-function ceiling.
 */

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
  const id = String(searchParams.get('id') || '').slice(0, 256)
  const sessionToken = String(searchParams.get('session_token') || '').slice(0, 128)
  const language = String(searchParams.get('language') || '').slice(0, 8)

  if (!id) return json({ error: 'id required' }, { status: 400 })
  if (!sessionToken) return json({ error: 'session_token required' }, { status: 400 })

  const token = process.env.MAPBOX_TOKEN || process.env.VITE_MAPBOX_TOKEN
  if (!token) return json({ error: 'MAPBOX_TOKEN not configured' }, { status: 500 })

  const upstream = new URLSearchParams({
    access_token: token,
    session_token: sessionToken,
  })
  if (language) upstream.set('language', language)

  try {
    const r = await fetch(`https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(id)}?${upstream}`)
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
