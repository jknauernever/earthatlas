/**
 * Minimal Global Fishing Watch Vessels API client (transport only).
 * Server-side only: the token must never reach a browser (GFW Terms §2.G).
 * Paced at 1 request/second, with backoff on 429/5xx. Logs the rate-limit
 * headers so a run can stop well before the 50k/day cap. Reference:
 * docs/GFW_VESSELS_API.md.
 */
const BASE = 'https://gateway.api.globalfishingwatch.org/v3'
export const DATASET = 'public-global-vessel-identity:latest'

export function gfwClient(token, { minIntervalMs = 1000, log = console.log } = {}) {
  if (!token) throw new Error('GFW_API_TOKEN not set (add it to .env.local; see docs/GFW_VESSELS_API.md)')
  let last = 0
  let calls = 0
  let remainingDaily = null

  async function get(path, params) {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x, i) => qs.append(`${k}[${i}]`, x))
      else if (v !== undefined && v !== null) qs.append(k, String(v))
    }
    const url = `${BASE}${path}?${qs}`
    for (let attempt = 0; ; attempt++) {
      const wait = last + minIntervalMs - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      last = Date.now()
      calls++
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      const rem = res.headers.get('x-ratelimit-daily-remaining-requests')
      if (rem !== null) remainingDaily = Number(rem)
      if (res.ok) {
        return { url, body: await res.json(), datasets: res.headers.get('x-datasets') }
      }
      const body = await res.text()
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const backoff = 2000 * 2 ** attempt
        log(`GFW ${res.status}; retrying in ${backoff / 1000}s`)
        await new Promise((r) => setTimeout(r, backoff))
        continue
      }
      throw new Error(`GFW ${res.status} for ${path}: ${body.slice(0, 300)}`)
    }
  }

  return {
    get calls() { return calls },
    get remainingDaily() { return remainingDaily },
    /** One page of search results. `query` XOR `where`. */
    search({ query, where, since, limit = 50 }) {
      return get('/vessels/search', {
        'datasets': [DATASET], query, where, since, limit,
        'includes': ['MATCH_CRITERIA', 'OWNERSHIP', 'AUTHORIZATIONS'],
      })
    },
    /** Full identity detail (all registry history) for up to ~50 GFW vessel ids. */
    byIds(ids) {
      return get('/vessels', {
        'datasets': [DATASET], 'ids': ids, 'registries-info-data': 'ALL',
        'includes': ['POTENTIAL_RELATED_SELF_REPORTED_INFO'],
      })
    },
  }
}
