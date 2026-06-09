/**
 * fetch() with an automatic timeout via AbortController.
 *
 * Mobile networks (cellular hand-offs, captive portals, spotty wifi) can leave
 * a request hanging indefinitely. A plain fetch then never settles — and since
 * the homepage search runs Promise.all([iNaturalist, eBird, GBIF]), a single
 * stalled request kept the whole search pending, leaving the page stuck on
 * "Fetching observations…" with the map never loading. Aborting after
 * `timeoutMs` turns a stalled request into a normal rejection that callers
 * already handle (the per-source .catch wrappers degrade to empty results, and
 * loading always resolves).
 *
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs] — abort the request after this many ms (default 15s)
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
