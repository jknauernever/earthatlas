/**
 * HappyWhale external API (hwx) proxy — powers the /happywhale tool.
 *
 * POST /api/happywhale?op=encounters        → POST {BASE}/encounters
 * POST /api/happywhale?op=individual&id=N   → POST {BASE}/individual/info/{id}
 * POST /api/happywhale?op=individualsByLoc  → POST {BASE}/individuals/byloc
 * GET  /api/happywhale?op=species           → GET  {BASE}/config/species
 *
 * Spec: docs/happywhale/openapi.yml (https://animal.us/apis/hwx/). The proxy
 * exists for the same two reasons as /api/ebird: any future API key stays
 * server-side, and the edge can cache what's cacheable (species config).
 *
 * Status (2026-06-11): the upstream API is NOT deployed yet — both prod and
 * beta return 500 until HappyWhale's next release. The client (happywhaleService)
 * treats an in-body `_upstream_status` as "not live" and falls back to its demo
 * dataset, so this proxy can ship ahead of the upstream. To point at beta when
 * Ken enables it: set HAPPYWHALE_API_BASE=https://api.beta.happywhale.com/v1/hwx.
 *
 * Auth: the spec defines no auth scheme (open question with Ken Southerland).
 * If a key materializes, set HAPPYWHALE_API_KEY and adjust the header below to
 * whatever scheme they confirm.
 */

export const config = { runtime: 'edge' }

const BASE = process.env.HAPPYWHALE_API_BASE || 'https://api.happywhale.com/v1/hwx'
const API_KEY = process.env.HAPPYWHALE_API_KEY || ''

// op → upstream request shape. `path` may be a function of the query params.
const OPS = {
  species: { method: 'GET', path: () => '/config/species', cacheControl: 'public, s-maxage=604800, stale-while-revalidate=86400' },
  encounters: { method: 'POST', path: () => '/encounters', cacheControl: 'public, s-maxage=300' },
  individualsByLoc: { method: 'POST', path: () => '/individuals/byloc', cacheControl: 'public, s-maxage=300' },
  individual: {
    method: 'POST',
    path: (sp) => {
      const id = sp.get('id')
      return /^\d+$/.test(id || '') ? `/individual/info/${id}` : null
    },
    cacheControl: 'public, s-maxage=3600',
  },
}

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
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...(init.headers || {}),
    },
  })
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method not allowed' }, { status: 405 })

  const { searchParams } = new URL(req.url)
  const op = OPS[searchParams.get('op')]
  if (!op) return json({ error: 'unknown op' }, { status: 400 })
  const path = op.path(searchParams)
  if (!path) return json({ error: 'bad params' }, { status: 400 })

  let body
  if (op.method === 'POST') {
    try {
      body = await req.text()
      JSON.parse(body || '{}') // forward only well-formed JSON
    } catch {
      return json({ error: 'invalid JSON body' }, { status: 400 })
    }
  }

  try {
    const r = await fetch(`${BASE}${path}`, {
      method: op.method,
      headers: {
        accept: 'application/json',
        ...(op.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      body: op.method === 'POST' ? (body || '{}') : undefined,
    })

    if (r.ok) {
      const text = await r.text()
      return new Response(text, {
        status: 200,
        headers: {
          'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': op.cacheControl,
          ...corsHeaders(),
        },
      })
    }

    // Upstream failure (including "API not released yet" 500s). Always 200 with
    // the status in-body — the client reads _upstream_status and degrades to
    // its demo dataset instead of surfacing a network error.
    return json({ _upstream_status: r.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    return json(
      { _upstream_status: 0, _error: String(err).slice(0, 120) },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  }
}
