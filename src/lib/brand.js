/**
 * White-label brands: the same EarthAtlas site under a partner's name and logo, picked by hostname.
 * Content is identical on every host; only the upper-left chip (components/SiteBrand.jsx) and the
 * panel footer ("Powered by EarthAtlas", components/PoweredBy.jsx) change.
 *
 * Brand = {
 *   id        short key, also the ?brand= dev override
 *   hosts     hostnames that show this brand (each also needs adding as a domain in Vercel + DNS)
 *   title     the site's word title, shown above the tool's name
 *   chip      'dark'  — partner logo in white on the standard dark chip
 *             'light' — partner logo in its own colors on a white chip
 *   logo      { dark, light } — image for each chip style (white-on-transparent / original colors)
 *   logoAlt   organization name, for the logo's alt text
 *   href      the organization's own website (the logo links there)
 *   accent    tool-name color on the light chip (tool badge colors are tuned for the dark chip)
 *   shareImage  link-preview picture (1200×630) used in place of the EarthAtlas-logo default one
 * }
 *
 * On localhost, ?brand=<id> previews a brand (kept for the tab via sessionStorage); ?brand= clears it.
 */
export const BRANDS = [
  {
    id: 'friends',
    hosts: ['sanjuans.earthatlas.org'],
    title: 'Salish Sea Explorer',
    chip: 'dark',
    logo: { dark: '/brands/friends/logo-white.png', light: '/brands/friends/logo-black.png' },
    logoAlt: 'Friends of the San Juans',
    href: 'https://sanjuans.org',
    accent: '#0e7490',
    shareImage: '/brands/friends/share.jpg',
  },
]

const DEV_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|.+\.localhost)$/
const KEY = 'ea-brand'

function resolve() {
  if (typeof window === 'undefined') return null
  const host = window.location.hostname
  const byHost = BRANDS.find((b) => b.hosts.includes(host))
  if (byHost || !DEV_HOST.test(host)) return byHost || null
  let id = null
  try {
    const q = new URLSearchParams(window.location.search)
    if (q.has('brand')) {
      id = q.get('brand') || null
      if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY)
    } else id = sessionStorage.getItem(KEY)
  } catch { /* storage blocked: query param only */ }
  return BRANDS.find((b) => b.id === id) || null
}

/** The brand for this page load, or null on EarthAtlas's own hosts. */
export const brand = resolve()

/** True on a partner's real hostname (not a ?brand= preview on localhost). */
export const onBrandHost = typeof window !== 'undefined' && BRANDS.some((b) => b.hosts.includes(window.location.hostname))

/** "… · EarthAtlas" → "… · <partner title>" — for tab titles and link previews. */
export const brandTitle = (title, b) => String(title).replace(/EarthAtlas/g, b.title)

// Tab titles: every site sets document.title with "EarthAtlas" in it; on a brand host swap in the partner's
// title, including titles a site sets later. Rewritten titles contain no "EarthAtlas", so this settles at once.
if (brand && typeof document !== 'undefined') {
  const fix = () => { if (document.title.includes('EarthAtlas')) document.title = brandTitle(document.title, brand) }
  fix()
  new MutationObserver(fix).observe(document.head, { subtree: true, childList: true, characterData: true })
}
