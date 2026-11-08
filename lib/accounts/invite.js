/**
 * Invites: the only way into EarthAtlas while sign-ups are closed (docs/USER_ACCOUNTS_PLAN.md §4, §7).
 *
 * An invite creates the user (email already counts as verified: the invite link proves it) and a
 * single-use, 7-day "set your password" token. The token is a normal Better Auth reset-password token
 * with a longer expiry, so accepting it runs Better Auth's own /reset-password (Turnstile, breached-password
 * check, single-use consume, hashed storage). The invitee can instead "Continue with Google" with the
 * same address, which links Google to the invited user.
 *
 * Better Auth has no invite API outside its organization plugin; creating the token uses
 * `internalAdapter.createVerificationValue`, the same call /request-password-reset makes.
 */
import { randomBytes } from 'node:crypto'
import { getAuth } from './auth.js'
import { sendAccountEmail } from './email.js'
import { checkEmail } from './guard.js'

export const INVITE_TTL_S = 7 * 24 * 60 * 60

async function issueInviteLink(userId, origin) {
  const ctx = await getAuth().$context
  const token = randomBytes(24).toString('base64url')
  await ctx.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + INVITE_TTL_S * 1000),
  })
  return `${origin}/account/invite?token=${encodeURIComponent(token)}`
}

/**
 * Invite someone. Returns { user, url, created }. If the address already has an account that never
 * set a password or linked Google, a fresh invite link is sent (re-invite); otherwise it refuses.
 */
export async function inviteUser({ email, name = '', role = 'user', origin = 'https://earthatlas.org', send = true }) {
  const problem = await checkEmail(email)
  if (problem) throw new Error(problem)
  if (!['user', 'admin'].includes(role)) throw new Error(`unknown role: ${role}`)
  const auth = getAuth()
  const ctx = await auth.$context
  const normalized = email.trim().toLowerCase()
  let found = await ctx.internalAdapter.findUserByEmail(normalized, { includeAccounts: true })
  let created = false
  if (found) {
    if (found.accounts?.length) throw new Error('That address already has an active account.')
  } else {
    const res = await auth.api.createUser({ body: { email: normalized, name: name.trim() || normalized.split('@')[0], role, data: { emailVerified: true } } })
    found = { user: res.user }
    created = true
  }
  const url = await issueInviteLink(found.user.id, origin)
  if (send) await sendAccountEmail(normalized, 'invite', { url, name: name.trim() })
  return { user: found.user, url, created }
}
