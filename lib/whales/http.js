/**
 * Polite upstream fetching for the whale feeds: a User-Agent that names us,
 * per-host spacing (iNaturalist asks for ≤1 request/second), and retries with
 * backoff on 429/5xx and network errors.
 */
const UA = 'EarthAtlas whale-sightings ingest (https://earthatlas.org; jknauer@gmail.com)'
const SPACING_MS = { 'api.inaturalist.org': 1100, 'api.obis.org': 300 }
const last = new Map()

async function space(host) {
  const gap = SPACING_MS[host]
  if (!gap) return
  const wait = (last.get(host) || 0) + gap - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last.set(host, Date.now())
}

export async function fetchJson(url, { attempts = 4, init = {}, allow404 = false } = {}) {
  const host = new URL(url).host
  for (let i = 1; ; i++) {
    await space(host)
    let res
    try {
      res = await fetch(url, { ...init, headers: { 'user-agent': UA, accept: 'application/json', ...(init.headers || {}) } })
    } catch (e) {
      if (i >= attempts) throw new Error(`${host}: ${e.message}`)
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)))
      continue
    }
    if (allow404 && res.status === 404) return null
    if (res.ok) {
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        // Maplify answers a PHP error page (HTTP 200) when a range is too big.
        throw new Error(`${host}: not JSON (${text.slice(0, 120).replace(/<[^>]+>/g, '').trim()})`)
      }
    }
    if (i >= attempts || !(res.status === 429 || res.status >= 500)) throw new Error(`${host}: HTTP ${res.status}`)
    await new Promise((r) => setTimeout(r, 2000 * 2 ** (i - 1)))
  }
}
