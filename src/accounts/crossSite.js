/**
 * Which kind of EarthAtlas host this page is on, for sign-in (server side: lib/accounts/handoff.js).
 *
 *   main     earthatlas.org / www, or localhost — where people sign in and manage their account
 *   sub      *.earthatlas.org (sanjuans.earthatlas.org) — shares the main session cookie
 *   partner  a brand host outside earthatlas.org (explore.sanjuans.org); *.localhost stands in on localhost.
 *            Signs in by a handoff from the main host, which gives it its own cookie for the same session.
 */
import { BRANDS } from '../lib/brand.js'

const DEV = /^(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.localhost)$/

export function hostKind(hostname = window.location.hostname) {
  if (DEV.test(hostname)) return /\.localhost$/.test(hostname) ? 'partner' : 'main'
  if (hostname === 'earthatlas.org' || hostname === 'www.earthatlas.org') return 'main'
  if (hostname.endsWith('.earthatlas.org')) return 'sub'
  return BRANDS.some((b) => b.hosts.includes(hostname)) ? 'partner' : 'main'
}

/** Where accounts live: '' when already there, else the main origin. */
export function mainOrigin() {
  if (hostKind() === 'main') return ''
  const { hostname, port, protocol } = window.location
  return DEV.test(hostname) ? `${protocol}//localhost${port ? `:${port}` : ''}` : 'https://earthatlas.org'
}

/** The URL that signs a partner-domain visitor in and brings them back to `to` (default: this page). */
export const handoffUrl = (to = window.location.href) => `${mainOrigin()}/api/auth/ea/handoff?to=${encodeURIComponent(to)}`

/** A "Sign in" link that works on any host and returns to `to` (default: this page). */
export function signInHref(to = window.location.href) {
  if (hostKind() === 'partner') return handoffUrl(to)
  // earthatlas.org and its subdomains sign in on the page's own host (the cookie covers .earthatlas.org)
  const here = new URL(to, window.location.href)
  const next = here.pathname + here.search
  return `/account/signin${next.startsWith('/account') ? '' : `?next=${encodeURIComponent(next)}`}`
}
