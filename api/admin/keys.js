/**
 * Admin API — API Key management.
 *
 * GET    /api/admin/keys           — list all API keys
 * POST   /api/admin/keys           — create key { name }
 * PUT    /api/admin/keys           — update key { id, name?, enabled?, rateLimit? }
 * DELETE /api/admin/keys?id=5      — revoke key
 *
 * Requires: Authorization: Bearer <ADMIN_SECRET>
 */

import { migrate, getAllApiKeys, createApiKey, updateApiKey, deleteApiKey } from '../../lib/db.js'

export default { async fetch(req) {
  if (!authorize(req)) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { searchParams } = new URL(req.url)

  try {
    await migrate()

    switch (req.method) {
      case 'GET': {
        const keys = await getAllApiKeys()
        return json({ keys })
      }

      case 'POST': {
        const body = await req.json()
        if (!body.name) return json({ error: 'name is required' }, 400)
        const key = await createApiKey(body)
        return json({ key }, 201)
      }

      case 'PUT': {
        const body = await req.json()
        if (!body.id) return json({ error: 'id is required' }, 400)
        const key = await updateApiKey(body)
        if (!key) return json({ error: 'Key not found' }, 404)
        return json({ key })
      }

      case 'DELETE': {
        const id = searchParams.get('id')
        if (!id) return json({ error: 'id is required' }, 400)
        await deleteApiKey(parseInt(id, 10))
        return json({ deleted: true })
      }

      default:
        return json({ error: 'Method not allowed' }, 405)
    }
  } catch (err) {
    console.error('Admin keys error:', err)
    return json({ error: err.message }, 500)
  }
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
