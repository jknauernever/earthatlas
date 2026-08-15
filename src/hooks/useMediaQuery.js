import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query from React.
 *
 * Returns false during SSR / before the first effect runs, so callers should
 * treat `false` as "desktop until proven otherwise" — the map tools all render
 * their desktop panel first and swap to the mobile sheet on mount.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** The breakpoint every EarthAtlas map tool switches to its mobile layout at. */
export const MOBILE_QUERY = '(max-width: 768px)'

export function useIsMobile() {
  return useMediaQuery(MOBILE_QUERY)
}
