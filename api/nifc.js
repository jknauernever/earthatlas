/**
 * NIFC WFIGS proxy — powers the /fire "Active wildfires (US)" layer.
 *
 * GET /api/nifc?layer=perimeters|incidents
 *   → GeoJSON FeatureCollection (normalized to a canonical incident schema).
 *
 * Why a proxy (mirrors api/firms.js / api/ebird.js):
 *   1. Vercel's edge CDN caches each layer so every visitor shares one upstream
 *      pull — NIFC's load policy forbids relative-date queries, so we pull the
 *      whole current service and cache it rather than per-request filtering.
 *   2. One place to normalize WFIGS's 100+-field records down to the handful the
 *      popup needs (see api/_nifc-core.js).
 *
 * No auth — WFIGS services are public. Always returns 200 with a (possibly
 * empty) FeatureCollection so an upstream hiccup degrades quietly on the map.
 */

import { resolveNifcRequest, normalizeNifc, simplifyNifc } from './_nifc-core.js'

export const config = { runtime: 'edge' }

// The nifc-snapshot cron writes fire/nifc-<layer>.json to the project's Blob
// store at a deterministic public URL. We read it with a plain fetch — NOT the
// @vercel/blob SDK, whose node deps (undici/node:stream) the Edge runtime
// rejects. The store's public origin is stable for the store's lifetime (this is
// the same store api/vessel-tiles.js reads); override via BLOB_PUBLIC_BASE if the
// store is ever recreated. If it's ever wrong, the read 404s → live NIFC fallback.
const BLOB_BASE = (process.env.BLOB_PUBLIC_BASE || 'https://fxj3imydg9misw9w.public.blob.vercel-storage.com').replace(/\/+$/, '')

// Serve the pre-baked snapshot (incl. its `_fetched_ms` stamp), or null if
// there's no snapshot yet / Blob is unreachable — then we fall back to live NIFC.
async function readSnapshot(layer, detail = 'full') {
  try {
    const suffix = detail === 'low' ? '-low' : ''
    const r = await fetch(`${BLOB_BASE}/fire/nifc-${layer}${suffix}.json`, { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const fc = await r.json()
    return fc && fc.type === 'FeatureCollection' && fc.features.length ? fc : null
  } catch {
    return null
  }
}

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
  const resolved = resolveNifcRequest(searchParams)
  if (resolved.error) return json({ error: resolved.error }, { status: resolved.status })

  // Prefer the cron-baked snapshot (decoupled from NIFC's live quota). For
  // detail=low: the baked low snapshot first; failing that (cron predates the
  // low variant), simplify the full snapshot right here — still no NIFC pull.
  const snap = await readSnapshot(resolved.layer, resolved.detail)
  if (snap) return json(snap, { status: 200, headers: { 'cache-control': resolved.cacheControl } })
  if (resolved.detail === 'low') {
    const full = await readSnapshot(resolved.layer)
    if (full) {
      return json(simplifyNifc(full), { status: 200, headers: { 'cache-control': resolved.cacheControl } })
    }
  }

  // Fallback: live NIFC (before the first snapshot exists, or a Blob outage).
  try {
    const r = await fetch(resolved.url, { headers: { accept: 'application/json' } })
    if (!r.ok) {
      // Upstream rate-limited (429, common on NIFC's shared quota during fire
      // season) or down. Return a NON-cacheable 503 — never a 200-empty — so the
      // CDN keeps serving the last good copy (stale-while-revalidate) instead of
      // caching this blank over it. The client keeps its last render on failure.
      return json({ ...EMPTY, _upstream: r.status }, { status: 503, headers: { 'cache-control': 'no-store' } })
    }
    const raw = await r.json()
    // ArcGIS returns quota/errors as a 200 with an { error } body — treat that as
    // an upstream failure too, so we don't cache or render an empty map.
    if (raw && raw.error) {
      return json({ ...EMPTY, _upstream: raw.error.code || 'arcgis-error' }, { status: 503, headers: { 'cache-control': 'no-store' } })
    }
    let fc = normalizeNifc(raw, resolved.layer)
    if (resolved.detail === 'low') fc = simplifyNifc(fc)
    return json(fc, { status: 200, headers: { 'cache-control': resolved.cacheControl } })
  } catch (err) {
    return json({ ...EMPTY, _error: String(err).slice(0, 120) }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    })
  }
}
