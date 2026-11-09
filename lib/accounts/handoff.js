/**
 * Sign-in on partner domains outside earthatlas.org (e.g. explore.sanjuans.org).
 *
 * Browsers never share cookies across domains, so a partner domain can't read the earthatlas.org session cookie.
 * Instead, people always sign in on earthatlas.org, which then hands the session to the partner domain:
 *
 *   1. partner page → https://earthatlas.org/api/auth/ea/handoff?to=<partner URL>
 *      Signed out: earthatlas.org's sign-in page first, then back here (?next=).
 *   2. earthatlas.org stores a one-time code (60 s, single use, bound to that one partner host) pointing at the
 *      signed-in session, and redirects to https://<partner>/api/auth/ea-handoff/finish?code=…&next=<path>
 *   3. The partner domain's own auth instance (lib/accounts/auth.js, getAuth(host)) consumes the code and sets its
 *      own host-only cookie for that SAME session, then redirects to the page.
 *
 * One session on every domain: admin unlock (keyed by session id) carries over, and signing out anywhere ends it
 * everywhere. Partner domains are the brand hosts in src/lib/brand.js that aren't under earthatlas.org; on
 * localhost, any *.localhost host stands in for one (explore.localhost:5173 vs localhost:5173).
 */
import { createHash, randomBytes } from 'crypto'
import { createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { BRANDS } from '../../src/lib/brand.js'

const ON_VERCEL = !!process.env.VERCEL
const CODE_TTL_MS = 60_000
const underMain = (h) => h === 'earthatlas.org' || h.endsWith('.earthatlas.org')

/** Partner hosts (production), from the brand list — adding a domain there is the only code change. */
export const PARTNER_HOSTS = BRANDS.flatMap((b) => b.hosts).filter((h) => !underMain(h))

/** Is `host` (may carry a :port) a partner domain that gets its own session cookie? */
export function isPartnerHost(host) {
  if (!host) return false
  return ON_VERCEL ? PARTNER_HOSTS.includes(host) : /^[a-z0-9-]+\.localhost(:\d+)?$/.test(host)
}

export const partnerOrigin = (host) => `${ON_VERCEL ? 'https' : 'http'}://${host}`

const codeId = (code) => `ea-handoff:${createHash('sha256').update(code).digest('base64url')}`

/** Only same-site paths ("/shoreline?edit"), never "//evil.com" or "/\evil.com". */
export function safePath(p, fallback = '/') {
  return typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : fallback
}

/**
 * GET /api/auth/ea/handoff?to=<partner URL> on earthatlas.org (step 1–2). `auth` is the main instance.
 * Returns a redirect Response.
 */
export async function startHandoff(req, auth, { audit, requestIp }) {
  const url = new URL(req.url)
  let to
  try { to = new URL(url.searchParams.get('to') || '') } catch { to = null }
  if (!to || !isPartnerHost(to.host) || to.origin !== partnerOrigin(to.host)) {
    return Response.json({ message: 'Unknown site.' }, { status: 400 })
  }
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session) {
    const back = `/api/auth/ea/handoff?to=${encodeURIComponent(to.href)}`
    return redirect(`/account/signin?next=${encodeURIComponent(back)}`)
  }
  const code = randomBytes(32).toString('base64url')
  const ctx = await auth.$context
  await ctx.internalAdapter.createVerificationValue({
    identifier: codeId(code),
    value: JSON.stringify({ token: session.session.token, host: to.host }),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  })
  await audit({ actorId: session.user.id, action: 'user.signin_handoff', targetId: session.user.id, ip: requestIp(req.headers), details: { host: to.host } })
  const next = to.pathname + to.search
  return redirect(`${to.origin}/api/auth/ea-handoff/finish?code=${encodeURIComponent(code)}&next=${encodeURIComponent(next)}`)
}

const redirect = (location) => new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } })

/**
 * Better Auth plugin for partner-domain instances only (step 3): GET /ea-handoff/finish?code&next.
 * Runs inside Better Auth so the cookie is set exactly as its own sign-in would (name, signing, flags), host-only.
 */
export const handoffFinishPlugin = () => ({
  id: 'ea-handoff',
  endpoints: {
    eaHandoffFinish: createAuthEndpoint('/ea-handoff/finish', { method: 'GET' }, async (c) => {
      const params = new URL(c.request.url).searchParams
      const host = new URL(c.request.url).host
      const next = safePath(params.get('next'))
      const code = params.get('code') || ''
      const v = code ? await c.context.internalAdapter.consumeVerificationValue(codeId(code)) : null
      let data = null
      try { data = v && new Date(v.expiresAt) > new Date() ? JSON.parse(v.value) : null } catch { data = null }
      const session = data?.host === host ? await c.context.internalAdapter.findSession(data.token) : null
      if (!session || new Date(session.session.expiresAt) < new Date()) {
        console.warn(`[accounts] handoff to ${host} refused (${!v ? 'unknown or used code' : !data ? 'expired code' : data.host !== host ? 'wrong host' : 'session gone'})`)
        throw c.redirect(next)
      }
      await setSessionCookie(c, session)
      throw c.redirect(next)
    }),
  },
})
