/**
 * Vercel Edge Middleware — injects SEO meta tags for article pages.
 *
 * Crawlers (Googlebot, Twitterbot, etc.) get proper og:title, og:image,
 * and NewsArticle JSON-LD without needing SSR. Normal browsers get the
 * standard SPA HTML and React hydrates the page client-side.
 */

export const config = {
  matcher: '/news/:path*',
}

export default async function middleware(req) {
  // Only rewrite for bots / crawlers / link previews.
  // Regular browsers get the normal SPA.
  const ua = (req.headers.get('user-agent') || '').toLowerCase()
  const isBot = /bot|crawl|spider|slurp|facebookexternalhit|twitterbot|linkedinbot|whatsapp|telegram|discord|preview/i.test(ua)

  if (!isBot) return

  // Extract slug from URL
  const url = new URL(req.url)
  const segments = url.pathname.split('/')
  const species = segments[2]
  const slug = segments[3]

  if (!slug) return

  // Fetch article data from our own API
  try {
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
    const canonicalUrl = `https://earthatlas.org/news/${species}/${slug}`
    const image = article.image || 'https://earthatlas.org/earthatlas-social.jpg'

    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: article.title,
      image: article.image ? [article.image] : [],
      datePublished: article.date,
      description,
      publisher: {
        '@type': 'Organization',
        name: 'EarthAtlas',
        url: 'https://earthatlas.org',
      },
    })

    // Build a minimal HTML page with meta tags for crawlers
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />

  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeAttr(title)}" />
  <meta property="og:description" content="${escapeAttr(description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <meta property="og:image" content="${escapeAttr(image)}" />
  <meta property="og:site_name" content="EarthAtlas" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeAttr(title)}" />
  <meta name="twitter:description" content="${escapeAttr(description)}" />
  <meta name="twitter:image" content="${escapeAttr(image)}" />

  <script type="application/ld+json">${jsonLd}</script>
</head>
<body>
  <h1>${escapeHtml(article.title)}</h1>
  ${article.image ? `<img src="${escapeAttr(article.image)}" alt="" />` : ''}
  <div>${article.summary || ''}</div>
  ${article.sourceUrl ? `<p>Source: <a href="${escapeAttr(article.sourceUrl)}">${escapeHtml(article.source || 'Original article')}</a></p>` : ''}
  <p><a href="${canonicalUrl}">View on EarthAtlas</a></p>
</body>
</html>`

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=600',
      },
    })
  } catch {
    return
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
