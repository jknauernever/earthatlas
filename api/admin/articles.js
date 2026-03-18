/**
 * Admin API — Article management.
 *
 * GET   /api/admin/articles?species=sharks&status=published&limit=50
 * PATCH /api/admin/articles  — update article status { id, status }
 *
 * Requires: Authorization: Bearer <ADMIN_SECRET>
 */

import { migrate, getArticles, updateArticleStatus } from '../../lib/db.js'
import { authorizeRequest, json } from '../../lib/auth.js'

export default { async fetch(req) {
  if (!authorizeRequest(req)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { searchParams } = new URL(req.url)

  try {
    await migrate()

    switch (req.method) {
      case 'GET': {
        const species = searchParams.get('species')
        if (!species) return json({ error: 'species parameter required' }, 400)
        const status = searchParams.get('status') || 'published'
        const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200)
        const articles = await getArticles({ speciesSlug: species, status, limit })
        return json({ articles })
      }

      case 'PATCH': {
        const body = await req.json()
        if (!body.id || !body.status) {
          return json({ error: 'id and status are required' }, 400)
        }
        if (!['published', 'draft', 'rejected'].includes(body.status)) {
          return json({ error: 'status must be published, draft, or rejected' }, 400)
        }
        const article = await updateArticleStatus(body.id, body.status)
        if (!article) return json({ error: 'Article not found' }, 404)
        return json({ article })
      }

      default:
        return json({ error: 'Method not allowed' }, 405)
    }
  } catch (err) {
    console.error('Admin articles error:', err)
    return json({ error: err.message }, 500)
  }
}
}

