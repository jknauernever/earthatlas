/**
 * Simple in-memory TTL cache for API responses.
 * Same data for all users — refreshes after `ttl` ms.
 */
const store = new Map()

/**
 * Wrap an async function with a time-based cache.
 * @param {string} key — unique cache key
 * @param {Function} fn — async function to call on cache miss
 * @param {number} ttl — time-to-live in ms (default: 1 hour)
 * @returns {Promise<any>}
 */
export function cached(key, fn, ttl = 60 * 60 * 1000) {
  const entry = store.get(key)
  if (entry && Date.now() - entry.ts < ttl) {
    return Promise.resolve(entry.data)
  }
  // If there's already an in-flight request for this key, return that promise
  if (entry?.pending) return entry.pending

  const pending = fn().then(data => {
    store.set(key, { data, ts: Date.now(), pending: null })
    return data
  }).catch(err => {
    // Clear pending on error so next call retries
    const current = store.get(key)
    if (current?.pending === pending) store.delete(key)
    throw err
  })

  store.set(key, { ...(entry || {}), pending })
  return pending
}
