/**
 * Keep account data out of analytics and error reports (docs/USER_ACCOUNTS_PLAN.md §8):
 * account and admin pages never send clicks, text or replays, and one-time tokens
 * (reset / invite / verify links) are stripped from every URL we report.
 * Used by the PostHog and Sentry setup in src/main.jsx; public/ga-init.js does the same for GA.
 */
export const PRIVATE_PATH = /^\/(account|admin|contact)(\/|$)/
const SECRET_PARAMS = ['token', 'code', 'secret', 'otp', 'callbackURL']

export const onPrivatePage = () => typeof window !== 'undefined' && PRIVATE_PATH.test(window.location.pathname)

/** The URL with one-time tokens removed (and Better Auth's /reset-password/<token> path shortened). */
export function scrubUrl(url) {
  if (!url || typeof url !== 'string') return url
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://earthatlas.org')
    for (const p of SECRET_PARAMS) if (u.searchParams.has(p)) u.searchParams.set(p, 'redacted')
    u.pathname = u.pathname.replace(/(\/api\/auth\/(?:reset-password|verify-email|delete-user\/callback))\/[^/]+/, '$1/redacted')
    return /^https?:/.test(url) ? u.href : u.pathname + u.search + u.hash
  } catch {
    return url.replace(/([?&](?:token|code|secret|otp)=)[^&#]*/g, '$1redacted')
  }
}

const URL_PROPS = ['$current_url', '$referrer', '$initial_current_url', '$initial_referrer', '$pathname']
const DROP_ON_PRIVATE = new Set(['$autocapture', '$rageclick', '$dead_click', '$snapshot', '$copy_autocapture', '$heatmap', '$exception'])

/** PostHog before_send: no interaction events on account pages; tokens out of URLs everywhere. */
export function posthogBeforeSend(event) {
  if (!event) return event
  if (onPrivatePage() && DROP_ON_PRIVATE.has(event.event)) return null
  const props = event.properties || {}
  for (const k of URL_PROPS) if (typeof props[k] === 'string') props[k] = scrubUrl(props[k])
  if (event.$set) for (const k of URL_PROPS) if (typeof event.$set[k] === 'string') event.$set[k] = scrubUrl(event.$set[k])
  if (event.$set_once) for (const k of URL_PROPS) if (typeof event.$set_once[k] === 'string') event.$set_once[k] = scrubUrl(event.$set_once[k])
  return event
}

/** Sentry beforeSend: tokens out of the page URL and breadcrumbs. */
export function sentryBeforeSend(event) {
  if (event?.request?.url) event.request.url = scrubUrl(event.request.url)
  if (event?.request?.query_string) event.request.query_string = undefined
  for (const b of event?.breadcrumbs || []) {
    if (b.data?.url) b.data.url = scrubUrl(b.data.url)
    if (b.data?.from) b.data.from = scrubUrl(b.data.from)
    if (b.data?.to) b.data.to = scrubUrl(b.data.to)
    if (b.category === 'ui.input' || (onPrivatePage() && b.category?.startsWith('ui.'))) b.message = '[account page]'
  }
  return event
}

/**
 * Account pages read a one-time token from the URL; call this right after, so the token isn't left
 * in the address bar, browser history, or URLs that analytics read later.
 */
export function dropTokenFromAddressBar() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (!u.searchParams.has('token')) return
  u.searchParams.delete('token')
  window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash)
}
