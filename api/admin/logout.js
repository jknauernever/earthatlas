/**
 * Admin logout.
 *
 * POST /api/admin/logout — clears the session cookie.
 */

import { sessionCookie, json } from '../../lib/auth.js'

export default { async fetch(req) {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  return json({ ok: true }, 200, {
    'Set-Cookie': sessionCookie('', { clear: true }),
  })
}
}
