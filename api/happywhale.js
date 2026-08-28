/**
 * HappyWhale external API (hwx) proxy — powers the /happywhale tool.
 *
 * POST /api/happywhale?op=encounters        → POST {BASE}/encounters
 * GET  /api/happywhale?op=individual&id=N   → GET  {BASE}/individual/info/{id}
 * POST /api/happywhale?op=individualsByLoc  → POST {BASE}/individuals/byloc
 * GET  /api/happywhale?op=species           → GET  {BASE}/config/species
 *
 * Thin Edge wrapper over the shared core (api/_happywhale-core.js), which owns
 * the OAuth token dance — credentials (HAPPYWHALE_CLIENT_ID/SECRET) stay
 * server-side, tokens are cached per isolate, and the edge CDN caches what's
 * cacheable (species config for a week, searches briefly).
 *
 * Env: HAPPYWHALE_API_BASE (beta vs prod; auth endpoint derives from it),
 * HAPPYWHALE_CLIENT_ID, HAPPYWHALE_CLIENT_SECRET, HAPPYWHALE_SCOPE (default
 * 'hwx'). Missing credentials or upstream failures are signalled in-body
 * (`_upstream_status`) with HTTP 200, so the client degrades gracefully
 * instead of surfacing network errors (mirrors /api/ebird).
 */

import { HWX_DEFAULT_BASE, HWX_OPS, createHwxTokenManager, hwxFetch } from './_happywhale-core.js'

export const config = { runtime: 'edge' }

const BASE = process.env.HAPPYWHALE_API_BASE || HWX_DEFAULT_BASE
const CLIENT_ID = process.env.HAPPYWHALE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.HAPPYWHALE_CLIENT_SECRET || ''
const SCOPE = process.env.HAPPYWHALE_SCOPE || 'hwx'

const tokens = createHwxTokenManager({ base: BASE, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, scope: SCOPE })

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
  const op = HWX_OPS[searchParams.get('op')]
  if (!op) return json({ error: 'unknown op' }, { status: 400 })
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ _upstream_status: 0, _error: 'credentials not configured' }, { status: 200, headers: { 'cache-control': 'no-store' } })
  }

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
    const { res, badParams } = await hwxFetch({ base: BASE, tokens, op, searchParams, body })
    if (badParams) return json({ error: 'bad params' }, { status: 400 })

    if (res.ok) {
      const text = await res.text()
      return new Response(text, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/json; charset=utf-8',
          'cache-control': op.cacheControl,
          ...corsHeaders(),
        },
      })
    }
    return json({ _upstream_status: res.status }, { status: 200, headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    return json(
      { _upstream_status: err.status || 0, _error: String(err.message || err).slice(0, 120) },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    )
  }
}
