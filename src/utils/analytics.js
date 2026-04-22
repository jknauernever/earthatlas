/**
 * Dual-dispatch analytics tracker: fires an event to PostHog and GA4 at once.
 *
 * Usage:
 *   import { track } from '../utils/analytics'
 *   track(posthog, 'source_changed', { source: 'eBird' })
 *
 * The gtag snippet is loaded in index.html and exposes window.gtag globally.
 */
export function track(posthog, eventName, props) {
  posthog?.capture?.(eventName, props)
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, props || {})
  }
}
