/**
 * /api/auth/* — EarthAtlas user accounts (Better Auth, lib/accounts/auth.js).
 * vercel.json rewrites /api/auth/:path* here; Better Auth routes on the original pathname.
 *
 * Plus one EarthAtlas endpoint:
 *   GET /api/auth/ea/form — { formToken, turnstileSiteKey, signupsOpen } for the account forms
 *       (formToken = server-signed render time, lib/accounts/guard.js)
 *   GET /api/auth/ea/export — the signed-in user's own data as a JSON download ("Download my data").
 *       Never includes password hashes, tokens, 2FA secrets or passkey keys.
 *   POST /api/auth/ea/contact — the /contact form (lib/accounts/contact.js; same-origin only)
 *   /api/auth/ea/admin/* — admin tools (lib/accounts/admin.js):
 *       GET  status                  → { state, unlockedUntil }  (state: signed-out | not-admin | needs-2fa | locked | unlocked)
 *       POST unlock { code }         → authenticator code opens admin tools on this session for 12 h
 *       POST lock
 *       GET  users?search&status&role&page · GET user?id · GET audit?page · GET messages?verdict&page
 *       POST action { action, ...fields }  (invite, update, changeEmail, resendVerification, sendReset,
 *                                           revokeSessions, ban, unban, delete,
 *                                           releaseMessage, deleteMessage)
 *
 * Better Auth's own /api/auth/admin/* routes are closed to the web: they would skip the 2FA unlock and
 * the audit log, and include set-user-password / impersonation, which EarthAtlas admins must not have.
 */
import { getAuth, turnstileSiteKey, SIGNUPS_OPEN, usersPool, SCHEMA } from '../lib/accounts/auth.js'
import { issueFormToken } from '../lib/accounts/guard.js'
import { ContactError, submitContact } from '../lib/accounts/contact.js'
import { AdminError, adminAction, adminStanding, auditLog, contactMessages, getUser, listUsers, lock, unlock } from '../lib/accounts/admin.js'

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

function withHeaders(res) {
  const out = new Response(res.body, res)
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(k)) out.headers.set(k, v)
  return out
}

async function sameOrigin(req) {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const ctx = await getAuth().$context
  return ctx.isTrustedOrigin ? ctx.isTrustedOrigin(origin) : (ctx.trustedOrigins || []).includes(origin)
}

async function exportMyData(req) {
  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session) return Response.json({ message: 'Sign in first.' }, { status: 401 })
  const id = session.user.id
  const q = (sql) => usersPool().query(sql, [id]).then((r) => r.rows)
  const [[user], signInMethods, sessions, passkeys] = await Promise.all([
    q(`SELECT name, email, "emailVerified", image, role, "twoFactorEnabled", "createdAt", "updatedAt" FROM ${SCHEMA}."user" WHERE id = $1`),
    q(`SELECT "providerId" AS method, "createdAt" AS added FROM ${SCHEMA}.account WHERE "userId" = $1 ORDER BY "createdAt"`),
    q(`SELECT "createdAt" AS "signedIn", "expiresAt", "ipAddress", "userAgent" FROM ${SCHEMA}.session WHERE "userId" = $1 ORDER BY "createdAt" DESC`),
    q(`SELECT name, "deviceType", "backedUp", "createdAt" FROM ${SCHEMA}.passkey WHERE "userId" = $1 ORDER BY "createdAt"`),
  ])
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), source: 'https://earthatlas.org', user, signInMethods, sessions, passkeys }, null, 2)
  return new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="earthatlas-my-data.json"' } })
}

async function adminApi(req, sub) {
  const url = new URL(req.url)
  const GET = req.method === 'GET', POST = req.method === 'POST'
  const body = POST ? await req.json().catch(() => ({})) : {}
  try {
    if (sub === 'status' && GET) {
      const s = await adminStanding(req.headers)
      return Response.json({ state: s.state, unlockedUntil: s.unlockedUntil || null, email: s.user?.email || null })
    }
    if (sub === 'unlock' && POST) return Response.json(await unlock(req.headers, body.code))
    if (sub === 'lock' && POST) return Response.json(await lock(req.headers))
    if (sub === 'action' && POST) return Response.json(await adminAction(req.headers, url.origin, body.action, body))
    if (GET && ['users', 'user', 'audit', 'messages'].includes(sub)) {
      // Reads use the same gate as actions (adminAction's requireUnlocked), via a no-op check.
      const s = await adminStanding(req.headers)
      if (s.state !== 'unlocked') throw new AdminError(s.state === 'signed-out' ? 401 : 403, 'Admin tools are locked.', s.state.toUpperCase().replace('-', '_'))
      const p = Object.fromEntries(url.searchParams)
      if (sub === 'users') return Response.json(await listUsers(p))
      if (sub === 'user') return Response.json(await getUser(p.id))
      if (sub === 'messages') return Response.json(await contactMessages(p))
      return Response.json(await auditLog(p))
    }
    return Response.json({ message: 'Not found.' }, { status: 404 })
  } catch (e) {
    if (e instanceof AdminError) return Response.json({ message: e.message, code: e.code }, { status: e.status })
    console.error('[accounts] admin error', e)
    return Response.json({ message: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

// The account-deletion email link. Better Auth answers a refused link with raw JSON (signed out: 404
// FAILED_TO_GET_USER_INFO; bad or used token: an error). Send people to a page that explains instead.
async function deleteCallback(req) {
  let res
  try { res = await getAuth().handler(req) } catch (e) { console.error('[accounts] delete callback', e) }
  if (res && res.status < 400) return res
  const signedIn = !!(await getAuth().api.getSession({ headers: req.headers }).catch(() => null))
  return new Response(null, { status: 302, headers: { Location: `/account/delete-link?reason=${signedIn ? 'expired' : 'signin'}` } })
}

export async function handleAuth(req) {
  // Dark until the accounts launch: without its settings, every accounts route is simply not there.
  if (!process.env.USERS_DATABASE_URL || !process.env.BETTER_AUTH_SECRET) return withHeaders(Response.json({ message: 'Not found.' }, { status: 404 }))
  const { pathname } = new URL(req.url)
  if (pathname === '/api/auth/ea/form' && req.method === 'GET') {
    return withHeaders(Response.json({ formToken: issueFormToken(), turnstileSiteKey: turnstileSiteKey(), signupsOpen: SIGNUPS_OPEN }))
  }
  if (pathname === '/api/auth/ea/export' && req.method === 'GET') return withHeaders(await exportMyData(req))
  if (pathname === '/api/auth/ea/contact' && req.method === 'POST') {
    if (!(await sameOrigin(req))) return withHeaders(Response.json({ message: 'Forbidden.' }, { status: 403 }))
    try {
      return withHeaders(Response.json(await submitContact(req)))
    } catch (e) {
      if (e instanceof ContactError) return withHeaders(Response.json({ message: e.message }, { status: e.status }))
      console.error('[contact] error', e)
      return withHeaders(Response.json({ message: 'Something went wrong. Please try again.' }, { status: 500 }))
    }
  }
  if (pathname.startsWith('/api/auth/ea/admin/')) {
    // State-changing admin calls must come from our own pages (Better Auth checks Origin on its routes; do the same here).
    if (req.method !== 'GET' && !(await sameOrigin(req))) return withHeaders(Response.json({ message: 'Forbidden.' }, { status: 403 }))
    return withHeaders(await adminApi(req, pathname.slice('/api/auth/ea/admin/'.length)))
  }
  if (pathname.startsWith('/api/auth/admin/')) return withHeaders(Response.json({ message: 'Not found.' }, { status: 404 }))
  if (pathname === '/api/auth/delete-user/callback' && req.method === 'GET') return withHeaders(await deleteCallback(req))
  try {
    return withHeaders(await getAuth().handler(req))
  } catch (e) {
    console.error('[accounts] handler error', e)
    return withHeaders(Response.json({ message: 'Something went wrong. Please try again.' }, { status: 500 }))
  }
}

export default { fetch: handleAuth }
