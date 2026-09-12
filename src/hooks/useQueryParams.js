import { useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Sync React state to URL query parameters.
 *
 * @param {Record<string, { type: 'string' | 'number', default?: any }>} schema
 * @returns {[Record<string, any>, (updates: Record<string, any>) => void]}
 *
 * Usage:
 *   const [params, setQP] = useQueryParams({
 *     lat:    { type: 'number' },
 *     source: { type: 'string', default: 'iNaturalist' },
 *   })
 *   params.lat    // number | null
 *   setQP({ lat: 47.6 })        // merges into URL
 *   setQP({ species: null })    // removes key from URL
 */
export function useQueryParams(schema) {
  const [searchParams, setSearchParams] = useSearchParams()

  // Merging base must be the LIVE URL, not React state: a ref refreshed on
  // render still goes stale when two setQP calls land in the same tick
  // (write z, then write month — the second rebuilds from a pre-first-call
  // snapshot and silently drops z). react-router pushes history
  // synchronously, so window.location.search is always current.

  const params = useMemo(() => {
    const result = {}
    for (const [key, { type, default: def }] of Object.entries(schema)) {
      const raw = searchParams.get(key)
      if (raw == null) {
        result[key] = def !== undefined ? def : null
        continue
      }
      if (type === 'number') {
        const n = Number(raw)
        result[key] = Number.isFinite(n) ? n : (def !== undefined ? def : null)
      } else {
        result[key] = raw
      }
    }
    return result
  }, [searchParams, schema])

  const setQP = useCallback((updates) => {
    const next = new URLSearchParams(window.location.search)
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) {
        next.delete(key)
      } else {
        // Round numbers to 4 decimal places for coordinates
        const str = schema[key]?.type === 'number'
          ? String(Math.round(value * 10000) / 10000)
          : String(value)
        next.set(key, str)
      }
    }
    setSearchParams(next, { replace: true })
  }, [setSearchParams, schema])

  return [params, setQP]
}
