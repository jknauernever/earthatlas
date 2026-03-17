/**
 * Public news feed API.
 *
 * GET /api/news/feed?species=sharks&limit=10
 * GET /api/news/feed?species=sharks&limit=10&key=abc123  (third-party access)
 *
 * Same-origin requests from earthatlas.org are allowed without a key.
 * Third-party / cross-origin requests require a valid API key.
 * Cached at the edge for 10 minutes.
 */

import { getArticles, validateApiKey } from '../../lib/db.js'

export default async function handler(req) {
  const { searchParams, hostname } = new URL(req.url)
  const species = searchParams.get('species')
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50)

  // Allow same-origin (our own frontend) without a key.
  // Third-party / cross-origin callers need an API key.
  const referer = req.headers.get('referer') || ''
  const origin = req.headers.get('origin') || ''
  const isSameOrigin = referer.includes('earthatlas.org')
    || referer.includes('localhost')
    || origin.includes('earthatlas.org')
    || origin.includes('localhost')
    || !origin  // server-side calls from our own Vercel functions

  if (!isSameOrigin) {
    const apiKey = searchParams.get('key') || req.headers.get('x-api-key')
    const valid = await validateApiKey(apiKey)
    if (!valid) {
      return json({ error: 'API key required. Contact admin for access.' }, 401)
    }
  }

  if (!species) {
    return json({ error: 'species parameter required' }, 400)
  }

  try {
    const rows = await getArticles({ speciesSlug: species, limit })

    const articles = rows.map(row => ({
      id: `article-${row.id}`,
      type: 'news',
      title: row.title,
      description: row.summary ? row.summary.slice(0, 200).replace(/<[^>]+>/g, '') : null,
      source: row.source_name,
      image: row.image_url,
      imageCredit: row.image_credit,
      date: row.pub_date ? new Date(row.pub_date).toISOString().split('T')[0] : null,
      url: `/news/${row.species_slug}/${row.slug}`,
      sourceUrl: row.source_url,
      slug: row.slug,
      speciesSlug: row.species_slug,
    }))

    return json({ articles }, 200, {
      'Cache-Control': 's-maxage=600, stale-while-revalidate=300',
    })
  } catch (err) {
    console.error('Feed API error:', err)
    return json({ error: 'Internal error' }, 500)
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
