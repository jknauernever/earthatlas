/**
 * Shared HappyWhale hwx API core — used by both the production Edge function
 * (api/happywhale.js) and the Vite dev middleware (vite.config.js), so
 * /happywhale behaves identically under `npm run dev`, `vercel dev`, and prod.
 *
 * Owns the OAuth dance (docs: https://animal.us/apis/auth/): POST
 * {base}/../auth/org with {client_id, client_secret, scope} → bearer token
 * (~3 h expiry). The token is cached in module scope and re-acquired on
 * expiry or on a 401/403 mid-flight. Credentials come from the caller (env);
 * nothing here ever reaches the browser bundle.
 *
 * Live-API quirks (verified on beta 2026-06-12, spec at docs/happywhale/):
 *  - /individual/info/{id} is a GET (the hwx spec wrongly documents POST)
 *  - auth scope is the literal string 'hwx'
 */

export const HWX_DEFAULT_BASE = 'https://api.happywhale.com/v1/hwx'

// op → upstream request shape. `path` may be a function of the query params.
export const HWX_OPS = {
  species: {
    method: 'GET',
    path: () => '/config/species',
    cacheControl: 'public, s-maxage=604800, stale-while-revalidate=86400',
  },
  encounters: {
    method: 'POST',
    path: () => '/encounters',
    cacheControl: 'public, s-maxage=300',
  },
  individualsByLoc: {
    method: 'POST',
    path: () => '/individuals/byloc',
    cacheControl: 'public, s-maxage=300',
  },
  individual: {
    method: 'GET', // spec says POST; the live API 500s on POST and wants GET
    path: (sp) => {
      const id = sp.get('id')
      return /^\d+$/.test(id || '') ? `/individual/info/${id}` : null
    },
    cacheControl: 'public, s-maxage=3600',
  },
}

/**
 * Token manager for one set of org credentials. `base` is the hwx base URL —
 * the auth endpoint lives beside it (…/v1/hwx → …/v1/auth/org), so pointing
 * HAPPYWHALE_API_BASE at beta or prod moves auth along with it.
 */
export function createHwxTokenManager({ base, clientId, clientSecret, scope = 'hwx' }) {
  const authUrl = base.replace(/\/hwx\/?$/, '/auth/org')
  let cached = null // { header, exp(ms) }

  async function getAuthHeader(force = false) {
    if (!force && cached && Date.now() < cached.exp - 60_000) return cached.header
    const r = await fetch(authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, scope }),
    })
    if (!r.ok) {
      cached = null
      const err = new Error(`happywhale auth failed (${r.status})`)
      err.status = r.status
      throw err
    }
    const tok = await r.json()
    cached = {
      header: `${tok.token_type || 'Bearer'} ${tok.access_token}`,
      exp: Date.now() + (tok.expires_in || 3600) * 1000,
    }
    return cached.header
  }

  return { getAuthHeader, invalidate: () => { cached = null } }
}

/**
 * Perform one authorized hwx request. Retries exactly once with a fresh token
 * on 401/403 (expiry races the cache). Returns the upstream Response.
 */
export async function hwxFetch({ base, tokens, op, searchParams, body }) {
  const path = op.path(searchParams)
  if (!path) return { badParams: true }

  const doFetch = async (auth) => fetch(`${base}${path}`, {
    method: op.method,
    headers: {
      accept: 'application/json',
      Authorization: auth,
      ...(op.method === 'POST' ? { 'content-type': 'application/json' } : {}),
    },
    body: op.method === 'POST' ? (body || '{}') : undefined,
  })

  let res = await doFetch(await tokens.getAuthHeader())
  if (res.status === 401 || res.status === 403) {
    tokens.invalidate()
    res = await doFetch(await tokens.getAuthHeader(true))
  }
  return { res }
}
