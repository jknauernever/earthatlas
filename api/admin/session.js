/**
 * Admin session check.
 *
 * GET /api/admin/session — returns { authenticated: true/false }
 */

import { authorizeRequest, json } from '../../lib/auth.js'

export default { async fetch(req) {
  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405)
  }

  return json({ authenticated: authorizeRequest(req) })
}
}
