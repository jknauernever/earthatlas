/**
 * Shared admin authentication helpers.
 *
 * Supports two auth methods:
 *   1. Bearer token (for curl / scripts): Authorization: Bearer <ADMIN_SECRET>
 *   2. HTTP-only session cookie (for browser admin UI)
 */

import { createHmac } from 'crypto'

const COOKIE_NAME = 'admin_session'
const SESSION_TTL = 86400 // 24 hours in seconds

/**
 * Create an HMAC-signed session token encoding the current timestamp.
 */
export function createSessionToken() {
  const secret = process.env.ADMIN_SECRET
  if (!secret) throw new Error('ADMIN_SECRET not set')
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const sig = createHmac('sha256', secret).update(timestamp).digest('hex')
  return `${timestamp}.${sig}`
}

/**
 * Verify an HMAC-signed session token. Returns true if valid and not expired.
 */
export function verifySessionToken(token) {
  const secret = process.env.ADMIN_SECRET
  if (!secret || !token) return false
  const parts = token.split('.')
  if (parts.length !== 2) return false
  const [timestamp, sig] = parts
  const ts = parseInt(timestamp, 10)
  if (isNaN(ts)) return false
  // Check expiry
  if (Math.floor(Date.now() / 1000) - ts > SESSION_TTL) return false
  // Check signature
  const expected = createHmac('sha256', secret).update(timestamp).digest('hex')
  return sig === expected
}

/**
 * Build a Set-Cookie header value for the session cookie.
 */
export function sessionCookie(token, { clear = false } = {}) {
  const isLocal = process.env.VERCEL_ENV === 'development' || !process.env.VERCEL_ENV
  const parts = [
    `${COOKIE_NAME}=${clear ? '' : token}`,
    'HttpOnly',
    'Path=/api',
    `SameSite=Lax`,
    `Max-Age=${clear ? 0 : SESSION_TTL}`,
  ]
  if (!isLocal) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Parse a specific cookie from the Cookie header.
 */
function getCookie(req, name) {
  const header = req.headers.get('cookie') || ''
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return match ? match[1] : null
}

/**
 * Authorize a request via Bearer token OR session cookie.
 * Returns true if authorized.
 */
export function authorizeRequest(req) {
  const secret = process.env.ADMIN_SECRET
  if (!secret) return false

  // Method 1: Bearer token
  const auth = req.headers.get('authorization') || ''
  if (auth === `Bearer ${secret}`) return true

  // Method 2: Session cookie
  const token = getCookie(req, COOKIE_NAME)
  return verifySessionToken(token)
}

/**
 * JSON response helper.
 */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}
