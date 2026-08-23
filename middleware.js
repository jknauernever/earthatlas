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
 *   /<map tool>?<state>   — per-view share cards: if a snapshot of this exact
 *                           view was uploaded (src/lib/shareCard.js keys it by
 *                           SHA-1 of pathname+search), serve it as og:image so
 *                           a plain copy/pasted URL unfurls with the actual
 *                           view. No snapshot / no params → fall through to
 *                           the tool's static SEO html.
 */

export const config = {
  matcher: [
    '/news/:path*',
    '/species/:path*',
    '/inmotion',
    '/fire',
    '/quakes',
    '/forestmonitor',
    '/carbon',
    '/birdsong',
    '/happywhale',
    '/shiptraffic',
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

// ─── Map-tool meta (mirrors scripts/generate-route-html.js ROUTES) ───────────
const TOOLS = {
  inmotion:      { title: 'In Motion — Earth’s systems, animated · EarthAtlas',
                   description: 'Watch Earth’s systems in motion — global winds animated as flowing particles on a live globe, with plain-language explanations of what you’re seeing and where every value comes from. An EarthAtlas tool.' },
  fire:          { title: 'FireApp — Wildfire risk & fuels · EarthAtlas',
                   description: 'Explore wildfire hazard potential, vegetation fuel state, and land cover across the United States and beyond. An EarthAtlas tool.' },
  quakes:        { title: 'Quakes — Live earthquake map · EarthAtlas',
                   description: 'Explore worldwide earthquakes from the past 30 days — search any location, set a radius, filter by time, and inspect magnitude and depth. Live USGS data. An EarthAtlas tool.' },
  forestmonitor: { title: 'Forest Monitor — Near-real-time global forest disturbance · EarthAtlas',
                   description: 'Track forest loss anywhere on Earth, updated every 12 hours. 30-meter NASA OPERA DIST-ALERT data with crop-aware cause inference, named-fire context, and per-pixel diagnostics.' },
  carbon:        { title: 'Carbon — Land carbon calculator · EarthAtlas',
                   description: 'Draw any parcel and estimate the carbon stored in its vegetation and soil — from measured satellite datasets (NASA/ORNL biomass, OpenLandMap soil, ESA WorldCover). An EarthAtlas tool.' },
  birdsong:      { title: 'Birdsong — Live bird-audio map · EarthAtlas',
                   description: 'Hear what birds are calling anywhere on Earth — a live map of BirdWeather’s global acoustic monitoring network. An EarthAtlas tool.' },
  happywhale:    { title: 'HappyWhale — Whale encounters & individual journeys · EarthAtlas',
                   description: 'Explore whale encounters from HappyWhale’s photo-ID network — search any coast, filter by species and time, and follow a named whale’s journey across oceans. An EarthAtlas tool.' },
  shiptraffic:   { title: 'Ship Traffic & Whales — Salish Sea · EarthAtlas',
                   description: 'Explore vessel traffic by class against observed whale presence across the Salish Sea, for any month/year range — with a derived interaction surface showing where heavy traffic overlaps whales. An EarthAtlas tool.' },
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
    if (TOOLS[slug]) {
      return await handleToolShare(url, TOOLS[slug])
    }
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

// ─── /<map tool>?<view state> — per-view share card ──────────────────────────
async function handleToolShare(url, tool) {
  if (!url.search) return // bare route → static SEO html (designed hero card)
  const id = await sha1Hex(url.pathname + url.search)
  // Existence check goes through our own node API — @vercel/blob's SDK can't
  // run on the Edge runtime (node:stream deps), and this keeps the blob store
  // URL out of both the middleware and the markup.
  const check = await fetch(`${url.origin}/api/share-card?id=${id}&check=1`)
  if (!check.ok || !(await check.json()).exists) return // no snapshot → static html
  const canonical = `${SITE}${url.pathname}${url.search}`
  return botHtml({
    title: tool.title,
    description: `A shared live view. ${tool.description}`,
    canonical,
    image: `${SITE}/api/share-card?id=${id}`,
    // Explicit dimensions: without them Facebook fetches the image async and
    // renders the FIRST share of a URL without its picture.
    imageWidth: 1920,
    imageHeight: 1080,
    imageType: 'image/jpeg',
    ogType: 'website',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: tool.title,
      url: canonical,
      description: tool.description,
      isPartOf: { '@type': 'WebSite', name: 'EarthAtlas', url: SITE },
    },
    body: `
      <h1>${escapeHtml(tool.title)}</h1>
      <p>${escapeHtml(tool.description)}</p>
      <p><a href="${escapeAttr(canonical)}">Open this live view on EarthAtlas</a></p>
    `,
    cacheSeconds: 3600,
  })
}

async function sha1Hex(s) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
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
function botHtml({ title, description, canonical, image, imageWidth, imageHeight, imageType, ogType, jsonLd, body, cacheSeconds = 3600 }) {
  const imageDims = imageWidth && imageHeight
    ? `\n  <meta property="og:image:width" content="${imageWidth}" />` +
      `\n  <meta property="og:image:height" content="${imageHeight}" />` +
      (imageType ? `\n  <meta property="og:image:type" content="${imageType}" />` : '')
    : ''
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
  <meta property="og:image" content="${escapeAttr(image)}" />${imageDims}

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
