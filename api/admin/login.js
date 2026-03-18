/**
 * Admin login.
 *
 * POST /api/admin/login  — { username, password }
 * Sets an HTTP-only session cookie on success.
 */

import { createSessionToken, sessionCookie, json } from '../../lib/auth.js'

export default { async fetch(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const { username, password } = await req.json().catch(() => ({}))

  const adminUser = process.env.ADMIN_USER
  const adminPassword = process.env.ADMIN_PASSWORD

  if (!adminUser || !adminPassword) {
    console.error('ADMIN_USER or ADMIN_PASSWORD not configured')
    return json({ error: 'Admin login not configured' }, 500)
  }

  if (username !== adminUser || password !== adminPassword) {
    return json({ error: 'Invalid credentials' }, 401)
  }

  const token = createSessionToken()
  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie(token),
  })
}
}
