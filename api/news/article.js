/**
 * Single article API.
 *
 * GET /api/news/article?slug=bull-sharks-make-friends
 *
 * Same-origin requests allowed without key.
 * Third-party access requires API key via ?key= or x-api-key header.
 */

import { getArticleBySlug, validateApiKey } from '../../lib/db.js'

export default { async fetch(req) {
  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')

  const referer = req.headers.get('referer') || ''
  const origin = req.headers.get('origin') || ''
  const isSameOrigin = referer.includes('earthatlas.org')
    || referer.includes('localhost')
    || origin.includes('earthatlas.org')
    || origin.includes('localhost')
    || !origin

  if (!isSameOrigin) {
    const apiKey = searchParams.get('key') || req.headers.get('x-api-key')
    const valid = await validateApiKey(apiKey)
    if (!valid) {
      return json({ error: 'API key required' }, 401)
    }
  }

  if (!slug) {
    return json({ error: 'slug parameter required' }, 400)
  }

  try {
    const row = await getArticleBySlug(slug)
    if (!row) {
      return json({ error: 'Article not found' }, 404)
    }

    return json({
      article: {
        id: row.id,
        title: row.title,
        summary: row.summary,
        image: row.image_url,
        imageCredit: row.image_credit,
        source: row.source_name,
        sourceUrl: row.source_url,
        date: row.pub_date ? new Date(row.pub_date).toISOString() : null,
        slug: row.slug,
        speciesSlug: row.species_slug,
      },
    }, 200, {
      'Cache-Control': 's-maxage=3600, stale-while-revalidate=600',
    })
  } catch (err) {
    console.error('Article API error:', err)
    return json({ error: 'Internal error' }, 500)
  }
}
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  })
}
