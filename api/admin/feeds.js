/**
 * Admin API — Feed CRUD.
 *
 * GET    /api/admin/feeds?species=sharks  — list feeds
 * POST   /api/admin/feeds                 — create feed
 * PUT    /api/admin/feeds                 — update feed
 * DELETE /api/admin/feeds?id=5            — delete feed
 *
 * All require: Authorization: Bearer <ADMIN_SECRET>
 */

import { migrate, getAllFeeds, createFeed, updateFeed, deleteFeed } from '../../lib/db.js'

export default async function handler(req) {
  if (!authorize(req)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { searchParams } = new URL(req.url)

  try {
    await migrate()

    switch (req.method) {
      case 'GET': {
        const species = searchParams.get('species') || null
        const feeds = await getAllFeeds(species)
        return json({ feeds })
      }

      case 'POST': {
        const body = await req.json()
        if (!body.speciesSlug || !body.name || !body.url) {
          return json({ error: 'speciesSlug, name, and url are required' }, 400)
        }
        const feed = await createFeed(body)
        return json({ feed }, 201)
      }

      case 'PUT': {
        const body = await req.json()
        if (!body.id) return json({ error: 'id is required' }, 400)
        const feed = await updateFeed(body)
        if (!feed) return json({ error: 'Feed not found' }, 404)
        return json({ feed })
      }

      case 'DELETE': {
        const id = searchParams.get('id')
        if (!id) return json({ error: 'id is required' }, 400)
        await deleteFeed(parseInt(id, 10))
        return json({ deleted: true })
      }

      default:
        return json({ error: 'Method not allowed' }, 405)
    }
  } catch (err) {
    console.error('Admin feeds error:', err)
    return json({ error: err.message }, 500)
  }
}

function authorize(req) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') || ''
  return auth === `Bearer ${secret}`
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
