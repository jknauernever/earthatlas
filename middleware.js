/**
 * Vercel Edge Middleware — injects SEO meta tags for bots on SPA routes.
 *
 * Crawlers (Googlebot, Bingbot, Twitterbot, GPTBot, ClaudeBot, etc.) and
 * link-preview fetchers get static HTML with proper og:title, og:image,
 * canonical URL, and JSON-LD. Regular browsers receive the normal SPA
 * shell and React hydrates client-side.
 *
 * Covered routes:
 *   /news/:species/:slug  — NewsArticle schema (fetches article from DB)
 *   /species/:taxonId     — Taxon / CreativeWork schema (fetches from iNaturalist)
 *   /<subsite>            — CollectionPage schema (e.g. /whales, /sharks)
 */

export const config = {
  matcher: [
    '/news/:path*',
    '/species/:path*',
    '/bears',
    '/birds',
    '/butterflies',
    '/condors',
    '/dolphins',
    '/elephants',
    '/fungi',
    '/hippos',
    '/lions',
    '/monkeys',
    '/sharks',
    '/sloths',
    '/tigers',
    '/whales',
    '/wolves',
  ],
}

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|preview|embed|gptbot|claudebot|claude-web|perplexitybot|cohere|anthropic|ccbot|google-extended|applebot/i

const SITE = 'https://earthatlas.org'
const DEFAULT_IMAGE = `${SITE}/earthatlas-social.jpg`

// ─── Subsite meta (mirrors src/explore/configs/*.js seo blocks) ──────────────
const SUBSITES = {
  bears:       { name: 'Bears',              emoji: '🐻', title: 'Bear Sightings Near You',                description: 'Find bear sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                                               image: '/bear-hero.jpg' },
  birds:       { name: 'Birds',              emoji: '🐦', title: 'Bird Sightings',                          description: 'Explore bird sightings worldwide — seasonal migration patterns, species data, and real-time observations from GBIF, iNaturalist, and eBird.',                                                 image: '/bird-hero.jpg' },
  butterflies: { name: 'Butterflies',        emoji: '🦋', title: 'Butterfly Sightings Near You',            description: 'Explore butterfly and moth sightings near any location — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                              image: '/butterfly-hero.jpg' },
  condors:     { name: 'Condors',            emoji: '🦅', title: 'Condor Sightings',                        description: 'Explore California Condor and Andean Condor sightings across the Americas — seasonal patterns, conservation data, and real-time observations from GBIF and iNaturalist.',                    image: '/condor-hero.jpg' },
  dolphins:    { name: 'Dolphins',           emoji: '🐬', title: 'Dolphin Sightings Near You',              description: 'Find dolphin sightings near any coastline — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                                         image: '/dolphin-hero.jpg' },
  elephants:   { name: 'Elephants',          emoji: '🐘', title: 'Elephant Sightings',                      description: 'Explore elephant sightings and observations across Africa and Asia — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                   image: '/elephant-hero.jpg' },
  fungi:       { name: 'Fungi',              emoji: '🍄', title: 'Fungi Sightings',                         description: 'Explore fungi and mushroom sightings worldwide — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                                    image: '/fungi-hero.jpg' },
  hippos:      { name: 'Hippos',             emoji: '🦛', title: 'Hippo Sightings',                         description: 'Explore hippopotamus sightings and observations across Africa — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                      image: '/hippo-hero.jpg' },
  lions:       { name: 'Lions',              emoji: '🦁', title: 'Lion Sightings',                          description: 'Explore lion sightings and observations across Africa and India — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                    image: '/lion-hero.jpg' },
  monkeys:     { name: 'Monkeys & Primates', emoji: '🐒', title: 'Primate Sightings',                       description: 'Explore primate sightings and observations — from chimpanzees to macaques. Seasonal patterns and real-time data from GBIF and iNaturalist.',                                                 image: '/monkey-hero.jpg' },
  sharks:      { name: 'Sharks',             emoji: '🦈', title: 'Shark Sightings Near You',                description: "Discover which sharks have been sighted near any coastline — and when they're most likely to be there. Real-time data from GBIF and iNaturalist.",                                         image: '/shark-hero.jpg' },
  sloths:      { name: 'Sloths',             emoji: '🦥', title: 'Sloth Sightings',                         description: 'Explore sloth sightings across Central and South America — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                           image: '/sloth-hero.jpg' },
  tigers:      { name: 'Tigers',             emoji: '🐯', title: 'Tiger Sightings',                         description: 'Explore tiger sightings and observations across Asia — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                                image: '/tiger-hero.jpg' },
  whales:      { name: 'Whales',             emoji: '🐋', title: 'Whale Sightings Near You',                description: 'Find whales near any coastline — see recent sightings, seasonal patterns, and species data powered by GBIF and iNaturalist.',                                                              image: '/whale-hero.jpg' },
  wolves:      { name: 'Wolves',             emoji: '🐺', title: 'Wolf Sightings Near You',                 description: 'Find wolf sightings and observations — seasonal patterns, species data, and real-time observations from GBIF and iNaturalist.',                                                                image: '/wolf-hero.jpg' },
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
export default async function middleware(req) {
  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  if (!BOT_RE.test(ua)) return

  const url = new URL(req.url)
  const path = url.pathname

  try {
    if (path.startsWith('/news/')) {
      return await handleNews(req, url)
    }
    if (path.startsWith('/species/')) {
      return await handleSpecies(req, url)
    }
    const slug = path.replace(/^\//, '').replace(/\/$/, '')
    if (SUBSITES[slug]) {
      return handleSubsite(slug)
    }
  } catch {
    // On any failure, fall through to the SPA shell.
    return
  }
}

// ─── /news/:species/:slug ────────────────────────────────────────────────────
async function handleNews(req, url) {
  const segments = url.pathname.split('/')
  const species = segments[2]
  const slug = segments[3]
  if (!slug) return

  const apiUrl = new URL('/api/news/article', req.url)
  apiUrl.searchParams.set('slug', slug)
  const res = await fetch(apiUrl.toString())
  if (!res.ok) return
  const { article } = await res.json()
  if (!article) return

  const title = `${article.title} — EarthAtlas`
  const description = article.summary
    ? article.summary.replace(/<[^>]+>/g, '').slice(0, 160)
    : ''
  const canonical = `${SITE}/news/${species}/${slug}`
  const image = article.image || DEFAULT_IMAGE

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    image: article.image ? [article.image] : [],
    datePublished: article.date,
    description,
    publisher: {
      '@type': 'Organization',
      name: 'EarthAtlas',
      url: SITE,
    },
  }

  return botHtml({
    title,
    description,
    canonical,
    image,
    ogType: 'article',
    jsonLd,
    body: `
      <h1>${escapeHtml(article.title)}</h1>
      ${article.image ? `<img src="${escapeAttr(article.image)}" alt="" />` : ''}
      <div>${article.summary || ''}</div>
      ${article.sourceUrl ? `<p>Source: <a href="${escapeAttr(article.sourceUrl)}">${escapeHtml(article.source || 'Original article')}</a></p>` : ''}
      <p><a href="${canonical}">View on EarthAtlas</a></p>
    `,
  })
}

// ─── /species/:taxonId ───────────────────────────────────────────────────────
async function handleSpecies(req, url) {
  const raw = url.pathname.split('/')[2]
  if (!raw) return
  const numericMatch = raw.match(/^(\d+)/)
  if (!numericMatch) return
  const taxonId = numericMatch[1]

  // The ID in the URL may be an iNat taxon ID or a GBIF species key — the
  // SPA tries iNat first and falls back to GBIF. Mirror that here.
  const uaHeader = { 'User-Agent': 'EarthAtlas/1.0 (+https://earthatlas.org)' }
  let taxon = null
  const inatRes = await fetch(`https://api.inaturalist.org/v1/taxa/${taxonId}`, { headers: uaHeader })
  if (inatRes.ok) {
    const data = await inatRes.json()
    taxon = data?.results?.[0] || null
  }

  if (!taxon) {
    // Treat as a GBIF key: resolve to a scientific name via GBIF, then hit iNat autocomplete.
    const gbifRes = await fetch(`https://api.gbif.org/v1/species/${taxonId}`, { headers: uaHeader })
    if (!gbifRes.ok) return
    const gbif = await gbifRes.json()
    const sciName = gbif.species || gbif.canonicalName || gbif.scientificName
    if (!sciName) return
    const acRes = await fetch(`https://api.inaturalist.org/v1/taxa/autocomplete?q=${encodeURIComponent(sciName)}&per_page=5&rank=species`, { headers: uaHeader })
    if (!acRes.ok) return
    const acData = await acRes.json()
    const match = acData.results?.find(t => t.name?.toLowerCase() === sciName.toLowerCase())
    taxon = match || acData.results?.[0] || null
    if (!taxon) {
      // iNat doesn't know it, but GBIF does — synthesize a minimal taxon record
      // so we at least emit usable meta rather than giving up.
      taxon = {
        name: sciName,
        preferred_common_name: gbif.vernacularName || null,
        wikipedia_url: null,
        wikipedia_summary: null,
        default_photo: null,
        rank: gbif.rank?.toLowerCase() || null,
      }
    }
  }
  if (!taxon) return

  const common = taxon.preferred_common_name || taxon.name
  const sci = taxon.name
  const wikiSummary = (taxon.wikipedia_summary || '').replace(/<[^>]+>/g, '')
  const description = wikiSummary
    ? wikiSummary.slice(0, 200)
    : `Explore ${common} (${sci}) — photos, sightings, seasonality, and global distribution on EarthAtlas.`
  const title = common && common !== sci
    ? `${common} (${sci}) — EarthAtlas`
    : `${sci} — EarthAtlas`
  const image = taxon.default_photo?.medium_url || taxon.default_photo?.original_url || DEFAULT_IMAGE
  const canonical = `${SITE}/species/${taxonId}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Taxon',
    name: sci,
    alternateName: common && common !== sci ? common : undefined,
    url: canonical,
    image: image ? [image] : undefined,
    description,
    taxonRank: taxon.rank || undefined,
    sameAs: [
      `https://www.inaturalist.org/taxa/${taxonId}`,
      taxon.wikipedia_url || undefined,
    ].filter(Boolean),
  }

  return botHtml({
    title,
    description,
    canonical,
    image,
    ogType: 'article',
    jsonLd,
    body: `
      <h1>${escapeHtml(common)}${common !== sci ? ` <em>(${escapeHtml(sci)})</em>` : ''}</h1>
      ${image ? `<img src="${escapeAttr(image)}" alt="${escapeAttr(common)}" />` : ''}
      <p>${escapeHtml(description)}</p>
      ${taxon.wikipedia_url ? `<p><a href="${escapeAttr(taxon.wikipedia_url)}">Wikipedia</a></p>` : ''}
      <p><a href="${canonical}">View on EarthAtlas</a></p>
    `,
    cacheSeconds: 86400, // species data changes slowly — cache 24h at edge
  })
}

// ─── /:subsite ───────────────────────────────────────────────────────────────
function handleSubsite(slug) {
  const s = SUBSITES[slug]
  const title = `${s.title} — EarthAtlas`
  const description = s.description
  const canonical = `${SITE}/${slug}`
  const image = `${SITE}${s.image}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${s.name} on EarthAtlas`,
    url: canonical,
    description,
    about: s.name,
    isPartOf: { '@type': 'WebSite', name: 'EarthAtlas', url: SITE },
  }

  return botHtml({
    title,
    description,
    canonical,
    image,
    ogType: 'website',
    jsonLd,
    body: `
      <h1>${s.emoji} ${escapeHtml(s.name)} — EarthAtlas</h1>
      <p>${escapeHtml(description)}</p>
      <p><a href="${canonical}">Explore ${escapeHtml(s.name.toLowerCase())} on EarthAtlas</a></p>
    `,
    cacheSeconds: 86400,
  })
}

// ─── Shared HTML shell ───────────────────────────────────────────────────────
function botHtml({ title, description, canonical, image, ogType, jsonLd, body, cacheSeconds = 3600 }) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large" />
  <link rel="canonical" href="${canonical}" />

  <meta property="og:type" content="${ogType}" />
  <meta property="og:site_name" content="EarthAtlas" />
  <meta property="og:locale" content="en_US" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${escapeAttr(image)}" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image" content="${escapeAttr(image)}" />

  <script type="application/ld+json">${escapeJsonLd(jsonLd)}</script>
</head>
<body>
  ${body}
</body>
</html>`

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': `s-maxage=${cacheSeconds}, stale-while-revalidate=600`,
    },
  })
}

// Prevent </script> in user-supplied data from breaking out of the JSON-LD block
function escapeJsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
