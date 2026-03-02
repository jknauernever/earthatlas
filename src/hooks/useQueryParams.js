import { useMemo, useCallback } from 'react'
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
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      for (const [key, value] of Object.entries(updates)) {
        const def = schema[key]?.default
        if (value == null || value === def) {
          next.delete(key)
        } else {
          // Round numbers to 4 decimal places for coordinates
          const str = schema[key]?.type === 'number'
            ? String(Math.round(value * 10000) / 10000)
            : String(value)
          next.set(key, str)
        }
      }
      return next
    }, { replace: true })
  }, [setSearchParams, schema])

  return [params, setQP]
}
