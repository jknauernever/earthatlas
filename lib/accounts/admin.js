/**
 * Admin tools for user accounts (/admin/users, docs/USER_ACCOUNTS_PLAN.md §7).
 *
 * Who gets in: a signed-in user with role "admin" AND two-step verification turned on, who has
 * entered a fresh authenticator code on this session ("unlock", good for 12 hours, auth.admin_unlock).
 * Better Auth's own /api/auth/admin/* routes are closed to the web (api/auth.js) so nothing skips
 * this gate; everything goes through here and lands in the audit log (lib/accounts/audit.js).
 *
 * Admins never see or set passwords: new users get an invite link, existing ones a reset link.
 */
import { symmetricDecrypt } from 'better-auth/crypto'
import { createOTP } from '@better-auth/utils/otp'
import { getAuth, usersPool, SCHEMA } from './auth.js'
import { audit, requestIp } from './audit.js'
import { notify } from './contact.js'
import { checkSpike } from './alerts.js'
import { checkEmail } from './guard.js'
import { inviteUser } from './invite.js'
import { sendAccountEmail } from './email.js'
import { clearFailures, lockedMinutes, lockMessage, recordFailure } from './lockout.js'

export const UNLOCK_HOURS = 12
const IS_PROD = process.env.VERCEL_ENV === 'production'
const q = (sql, params = []) => usersPool().query(sql, params).then((r) => r.rows)

export class AdminError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code }
}

/**
 * The caller's admin standing: { state, session, user } where state is
 * 'signed-out' | 'not-admin' | 'needs-2fa' | 'locked' | 'unlocked'.
 */
export async function adminStanding(headers) {
  const session = await getAuth().api.getSession({ headers })
  if (!session) return { state: 'signed-out' }
  const { user } = session
  if (user.role !== 'admin' || user.banned) return { state: 'not-admin', session, user }
  if (!user.twoFactorEnabled) return { state: 'needs-2fa', session, user }
  const [row] = await q(`SELECT expires_at FROM ${SCHEMA}.admin_unlock WHERE session_id = $1 AND user_id = $2 AND expires_at > now()`, [session.session.id, user.id])
  return { state: row ? 'unlocked' : 'locked', session, user, unlockedUntil: row?.expires_at || null }
}

async function requireUnlocked(headers) {
  const s = await adminStanding(headers)
  if (s.state === 'signed-out') throw new AdminError(401, 'Sign in first.', 'SIGNED_OUT')
  if (s.state === 'not-admin') throw new AdminError(403, 'Admins only.', 'NOT_ADMIN')
  if (s.state === 'needs-2fa') throw new AdminError(403, 'Turn on two-step verification first.', 'NEEDS_2FA')
  if (s.state === 'locked') throw new AdminError(403, 'Enter your authenticator code to open admin tools.', 'LOCKED')
  return s
}

/** Unlock admin tools on this session with a code from the admin's authenticator app. */
export async function unlock(headers, code) {
  const s = await adminStanding(headers)
  if (!['locked', 'unlocked'].includes(s.state)) throw new AdminError(403, 'Admins with two-step verification only.', 'NOT_ADMIN')
  const key = `admin-unlock:${s.user.id}`
  const mins = await lockedMinutes(usersPool(), key)
  if (mins > 0) throw new AdminError(429, lockMessage(mins), 'ACCOUNT_LOCKED')
  const ip = requestIp(headers)
  const [tf] = await q(`SELECT secret FROM ${SCHEMA}."twoFactor" WHERE "userId" = $1 AND verified IS NOT FALSE`, [s.user.id])
  let ok = false
  if (tf && /^\d{6}$/.test(String(code || '').trim())) {
    const ctx = await getAuth().$context
    const secret = await symmetricDecrypt({ key: ctx.secretConfig, data: tf.secret })
    ok = await createOTP(secret, { period: 30, digits: 6 }).verify(String(code).trim())
  }
  if (!ok) {
    const locked = await recordFailure(usersPool(), key)
    await audit({ actorId: s.user.id, action: 'admin.unlock_failed', targetId: s.user.id, ip })
    await checkSpike('admin.unlock_failed')
    throw new AdminError(locked > 0 ? 429 : 400, locked > 0 ? lockMessage(locked) : "That code didn't work. Check your authenticator app and try again.", locked > 0 ? 'ACCOUNT_LOCKED' : 'INVALID_CODE')
  }
  await clearFailures(usersPool(), key)
  const expires = new Date(Math.min(Date.now() + UNLOCK_HOURS * 3600_000, new Date(s.session.session.expiresAt).getTime()))
  await q(`INSERT INTO ${SCHEMA}.admin_unlock (session_id, user_id, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (session_id) DO UPDATE SET unlocked_at = now(), expires_at = EXCLUDED.expires_at`, [s.session.session.id, s.user.id, expires])
  await audit({ actorId: s.user.id, action: 'admin.unlock', targetId: s.user.id, ip })
  return { unlockedUntil: expires }
}

export async function lock(headers) {
  const s = await adminStanding(headers)
  if (s.session) await q(`DELETE FROM ${SCHEMA}.admin_unlock WHERE session_id = $1`, [s.session.session.id])
  return { ok: true }
}

// ---- reads ----

const STATUS_SQL = `CASE WHEN u.banned THEN 'banned'
  WHEN NOT EXISTS (SELECT 1 FROM ${SCHEMA}.account a WHERE a."userId" = u.id) THEN 'invited'
  WHEN NOT u."emailVerified" THEN 'unverified' ELSE 'active' END`

export async function listUsers({ search = '', status = '', role = '', page = 1, pageSize = 50 } = {}) {
  const where = [], params = []
  if (search.trim()) { params.push(`%${search.trim().toLowerCase()}%`); where.push(`(lower(u.email) LIKE $${params.length} OR lower(u.name) LIKE $${params.length})`) }
  if (['user', 'admin'].includes(role)) { params.push(role); where.push(`u.role = $${params.length}`) }
  if (['banned', 'invited', 'unverified', 'active'].includes(status)) { params.push(status); where.push(`(${STATUS_SQL}) = $${params.length}`) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const size = Math.min(Math.max(1, +pageSize || 50), 100), off = (Math.max(1, +page || 1) - 1) * size
  const [{ total }] = await q(`SELECT count(*)::int AS total FROM ${SCHEMA}."user" u ${w}`, params)
  const users = await q(`SELECT u.id, u.name, u.email, u.image, u.role, u."createdAt", u."twoFactorEnabled", ${STATUS_SQL} AS status,
      (SELECT max(s."createdAt") FROM ${SCHEMA}.session s WHERE s."userId" = u.id) AS "lastSignIn"
    FROM ${SCHEMA}."user" u ${w} ORDER BY u."createdAt" DESC LIMIT ${size} OFFSET ${off}`, params)
  return { users, total, page: Math.max(1, +page || 1), pageSize: size }
}

export async function getUser(id) {
  const [user] = await q(`SELECT u.id, u.name, u.email, u.image, u.role, u."emailVerified", u."twoFactorEnabled", u.banned, u."banReason",
      u."createdAt", u."updatedAt", ${STATUS_SQL} AS status FROM ${SCHEMA}."user" u WHERE u.id = $1`, [id])
  if (!user) throw new AdminError(404, 'No such user.', 'NOT_FOUND')
  const [methods, sessions, passkeys, events] = await Promise.all([
    q(`SELECT "providerId" AS method, "createdAt" FROM ${SCHEMA}.account WHERE "userId" = $1 ORDER BY "createdAt"`, [id]),
    q(`SELECT id, "createdAt", "expiresAt", "ipAddress", "userAgent" FROM ${SCHEMA}.session WHERE "userId" = $1 AND "expiresAt" > now() ORDER BY "createdAt" DESC`, [id]),
    q(`SELECT name, "createdAt" FROM ${SCHEMA}.passkey WHERE "userId" = $1 ORDER BY "createdAt"`, [id]),
    q(`SELECT l.at, l.action, l.ip, l.details, l.actor_id AS "actorId", a.email AS "actorEmail", l.target_id AS "targetId", t.email AS "targetEmail"
       FROM ${SCHEMA}.audit_log l LEFT JOIN ${SCHEMA}."user" a ON a.id = l.actor_id LEFT JOIN ${SCHEMA}."user" t ON t.id = l.target_id
       WHERE l.target_id = $1 OR l.actor_id = $1 ORDER BY l.at DESC LIMIT 25`, [id]),
  ])
  return { user, methods, sessions, passkeys, events }
}

export async function auditLog({ page = 1, pageSize = 100 } = {}) {
  const size = Math.min(Math.max(1, +pageSize || 100), 200), off = (Math.max(1, +page || 1) - 1) * size
  const events = await q(`SELECT l.id, l.at, l.action, l.ip, l.details, l.actor_id AS "actorId", a.email AS "actorEmail",
      l.target_id AS "targetId", t.email AS "targetEmail"
    FROM ${SCHEMA}.audit_log l LEFT JOIN ${SCHEMA}."user" a ON a.id = l.actor_id LEFT JOIN ${SCHEMA}."user" t ON t.id = l.target_id
    ORDER BY l.at DESC LIMIT ${size} OFFSET ${off}`)
  return { events, page: Math.max(1, +page || 1), pageSize: size }
}

const VERDICTS = ['held', 'accepted', 'bot']

/** Contact-form messages (lib/accounts/contact.js), newest first, one verdict at a time, plus per-verdict counts. */
export async function contactMessages({ verdict = 'held', page = 1, pageSize = 50 } = {}) {
  const v = VERDICTS.includes(verdict) ? verdict : 'held'
  const size = Math.min(Math.max(1, +pageSize || 50), 100), off = (Math.max(1, +page || 1) - 1) * size
  const [messages, counts] = await Promise.all([
    q(`SELECT id, at, ip, name, email, topic, message, verdict, reasons, emailed_at AS "emailedAt"
       FROM ${SCHEMA}.contact_message WHERE verdict = $1 ORDER BY at DESC LIMIT ${size} OFFSET ${off}`, [v]),
    q(`SELECT verdict, count(*)::int AS n FROM ${SCHEMA}.contact_message GROUP BY verdict`),
  ])
  return { messages, counts: Object.fromEntries(counts.map((r) => [r.verdict, r.n])), verdict: v, page: Math.max(1, +page || 1), pageSize: size }
}

async function contactMessage(id) {
  const [m] = await q(`SELECT * FROM ${SCHEMA}.contact_message WHERE id = $1`, [String(id || '').replace(/\D/g, '') || '0'])
  if (!m) throw new AdminError(404, 'No such message.', 'NOT_FOUND')
  return m
}

// ---- writes ----

async function targetUser(id) {
  const [u] = await q(`SELECT id, email, name, role, banned FROM ${SCHEMA}."user" WHERE id = $1`, [id])
  if (!u) throw new AdminError(404, 'No such user.', 'NOT_FOUND')
  return u
}
const notSelf = (s, id, what) => { if (s.user.id === id) throw new AdminError(400, `You can't ${what} your own account here. Use your account page.`, 'SELF') }

/**
 * Run one admin action. `origin` = the site the links in emails point to.
 * Returns the action's result; every action is audited.
 */
export async function adminAction(headers, origin, action, body = {}) {
  const s = await requireUnlocked(headers)
  const ip = requestIp(headers)
  const log = (name, targetId, details = {}) => audit({ actorId: s.user.id, action: `admin.${name}`, targetId, ip, details })
  const site = IS_PROD ? 'https://earthatlas.org' : origin

  switch (action) {
    case 'releaseMessage': {
      // A held message that's real after all: send it on like any other, and mark it accepted.
      const m = await contactMessage(body.id)
      if (m.verdict === 'accepted') throw new AdminError(400, 'That message was already delivered.', 'ALREADY')
      const sent = await notify(m, m.id)
      await q(`UPDATE ${SCHEMA}.contact_message SET verdict = 'accepted', emailed_at = CASE WHEN $2 THEN now() ELSE emailed_at END WHERE id = $1`, [m.id, sent])
      await log('contact_release', null, { message: m.id, from: m.verdict, email: m.email })
      return { ok: true, emailed: sent }
    }
    case 'deleteMessage': {
      const m = await contactMessage(body.id)
      await q(`DELETE FROM ${SCHEMA}.contact_message WHERE id = $1`, [m.id])
      await log('contact_delete', null, { message: m.id, verdict: m.verdict, email: m.email })
      return { ok: true }
    }
    case 'invite': {
      const role = body.role === 'admin' ? 'admin' : 'user'
      let res
      try { res = await inviteUser({ email: String(body.email || ''), name: String(body.name || ''), role, origin: site }) }
      catch (e) { throw new AdminError(400, e.message, 'INVITE_FAILED') }
      await log(res.created ? 'invite' : 'reinvite', res.user.id, { role })
      return { userId: res.user.id, created: res.created }
    }
    case 'update': {
      const u = await targetUser(body.id)
      const sets = [], params = [], changed = {}
      if (typeof body.name === 'string' && body.name.trim() && body.name.trim() !== u.name) {
        params.push(body.name.trim().slice(0, 100)); sets.push(`name = $${params.length}`); changed.name = true
      }
      if (['user', 'admin'].includes(body.role) && body.role !== u.role) {
        notSelf(s, u.id, 'change the role of')
        params.push(body.role); sets.push(`role = $${params.length}`); changed.role = { from: u.role, to: body.role }
      }
      if (body.emailVerified === true) { sets.push(`"emailVerified" = true`); changed.emailVerified = true }
      if (!sets.length) return { ok: true }
      params.push(u.id)
      await q(`UPDATE ${SCHEMA}."user" SET ${sets.join(', ')}, "updatedAt" = now() WHERE id = $${params.length}`, params)
      if (changed.role) await q(`DELETE FROM ${SCHEMA}.admin_unlock WHERE user_id = $1`, [u.id])
      await log('update', u.id, changed)
      return { ok: true }
    }
    case 'changeEmail': {
      const u = await targetUser(body.id)
      notSelf(s, u.id, 'change the email of')
      // Changing another admin's address and then sending a reset link would hand over their account.
      if (u.role === 'admin') throw new AdminError(400, "Another administrator's email can't be changed here. Make them a regular user first, or ask them to change it on their account page.", 'TARGET_ADMIN')
      const email = String(body.email || '').trim().toLowerCase()
      const problem = await checkEmail(email)
      if (problem) throw new AdminError(400, problem, 'BAD_EMAIL')
      if (email === u.email) return { ok: true }
      const [taken] = await q(`SELECT 1 FROM ${SCHEMA}."user" WHERE lower(email) = $1`, [email])
      if (taken) throw new AdminError(400, 'Another account already uses that address.', 'EMAIL_TAKEN')
      await q(`UPDATE ${SCHEMA}."user" SET email = $1, "emailVerified" = false, "updatedAt" = now() WHERE id = $2`, [email, u.id])
      await getAuth().api.sendVerificationEmail({ body: { email, callbackURL: '/account/verified' } })
      await sendAccountEmail(u.email, 'emailChangedByAdmin', { newEmail: email }).catch((e) => console.error('[accounts] notice email failed', e.message))
      await log('change_email', u.id, { from: u.email, to: email })
      return { ok: true }
    }
    case 'resendVerification': {
      const u = await targetUser(body.id)
      await getAuth().api.sendVerificationEmail({ body: { email: u.email, callbackURL: '/account/verified' } })
      await log('resend_verification', u.id)
      return { ok: true }
    }
    case 'sendReset': {
      // No sign-in method yet → a fresh invite link; otherwise a normal password-reset link.
      const u = await targetUser(body.id)
      const [m] = await q(`SELECT 1 FROM ${SCHEMA}.account WHERE "userId" = $1 LIMIT 1`, [u.id])
      if (!m) {
        await inviteUser({ email: u.email, name: u.name, role: u.role, origin: site })
        await log('reinvite', u.id)
        return { sent: 'invite' }
      }
      await getAuth().api.requestPasswordReset({ body: { email: u.email, redirectTo: `${site}/account/reset` } })
      await log('send_reset', u.id)
      return { sent: 'reset' }
    }
    case 'revokeSessions': {
      const u = await targetUser(body.id)
      notSelf(s, u.id, 'sign out')
      const r = await usersPool().query(`DELETE FROM ${SCHEMA}.session WHERE "userId" = $1`, [u.id])
      await log('revoke_sessions', u.id, { count: r.rowCount })
      return { revoked: r.rowCount }
    }
    case 'ban': {
      const u = await targetUser(body.id)
      notSelf(s, u.id, 'ban')
      const reason = String(body.reason || '').trim().slice(0, 500)
      if (!reason) throw new AdminError(400, 'Give a reason for the ban.', 'REASON_REQUIRED')
      await q(`UPDATE ${SCHEMA}."user" SET banned = true, "banReason" = $1, "banExpires" = NULL, "updatedAt" = now() WHERE id = $2`, [reason, u.id])
      const r = await usersPool().query(`DELETE FROM ${SCHEMA}.session WHERE "userId" = $1`, [u.id])
      await log('ban', u.id, { reason, sessionsRevoked: r.rowCount })
      return { ok: true }
    }
    case 'unban': {
      const u = await targetUser(body.id)
      await q(`UPDATE ${SCHEMA}."user" SET banned = false, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = now() WHERE id = $1`, [u.id])
      await log('unban', u.id)
      return { ok: true }
    }
    case 'delete': {
      const u = await targetUser(body.id)
      notSelf(s, u.id, 'delete')
      if (String(body.confirmEmail || '').trim().toLowerCase() !== u.email.toLowerCase()) throw new AdminError(400, "The email you typed doesn't match this account.", 'CONFIRM_MISMATCH')
      // The admin re-enters their own password.
      const [cred] = await q(`SELECT password FROM ${SCHEMA}.account WHERE "userId" = $1 AND "providerId" = 'credential' AND password IS NOT NULL`, [s.user.id])
      const ctx = await getAuth().$context
      if (!cred || !body.password || !(await ctx.password.verify({ hash: cred.password, password: String(body.password) }))) {
        await log('delete_refused', u.id, { why: 'wrong admin password' })
        throw new AdminError(400, 'Your password was incorrect.', 'INVALID_PASSWORD')
      }
      await q(`DELETE FROM ${SCHEMA}."user" WHERE id = $1`, [u.id]) // sessions, sign-ins, passkeys, 2FA cascade
      await clearFailures(usersPool(), u.email)
      await log('delete', u.id, { email: u.email, role: u.role })
      await sendAccountEmail(u.email, 'accountDeleted').catch((e) => console.error('[accounts] notice email failed', e.message))
      return { ok: true }
    }
    default:
      throw new AdminError(400, 'Unknown action.', 'UNKNOWN_ACTION')
  }
}

/** For other parts of the site (ship intake): is this request from an admin with admin tools unlocked? */
export async function isUnlockedAdmin(headers) {
  try { return (await adminStanding(headers)).state === 'unlocked' } catch { return false }
}
