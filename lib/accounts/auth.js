/**
 * EarthAtlas user accounts: Better Auth 1.7 config (docs/USER_ACCOUNTS_PLAN.md).
 *
 * Database: Neon `earthatlas-users` (prod) / `earthatlas-users-dev` (localhost), env USERS_DATABASE_URL,
 * tables in schema "auth". Migrations: scripts/accounts/migrate.mjs.
 *
 * Launch mode is invite-only: SIGNUPS_OPEN !== "true" refuses public sign-up (email and Google);
 * accounts are created only by admins (lib/accounts/invite.js), then the invitee sets a password or
 * signs in with Google using the invited address.
 */
import { betterAuth } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { admin, captcha, haveIBeenPwned, twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { PostgresDialect } from 'kysely'
import pg from 'pg'
import { sendAccountEmail } from './email.js'
import { checkEmail, checkFormToken } from './guard.js'
import { clearFailures, lockedMinutes, lockMessage, recordFailure } from './lockout.js'
import { audit, requestIp } from './audit.js'
import { checkSpike } from './alerts.js'

const ON_VERCEL = !!process.env.VERCEL
const IS_PROD = process.env.VERCEL_ENV === 'production'
export const SIGNUPS_OPEN = process.env.SIGNUPS_OPEN === 'true'
export const SCHEMA = 'auth'

// Cloudflare's published test keys (always pass) on localhost, so local testing never uses the real widget.
// https://developers.cloudflare.com/turnstile/troubleshooting/testing/
const TURNSTILE_TEST_SITE = '1x00000000000000000000AA'
const TURNSTILE_TEST_SECRET = '1x0000000000000000000000000000000AA'
export const turnstileSiteKey = () => (ON_VERCEL ? process.env.TURNSTILE_SITE_KEY : TURNSTILE_TEST_SITE)
export const turnstileSecret = () => (ON_VERCEL ? process.env.TURNSTILE_SECRET_KEY : TURNSTILE_TEST_SECRET)

const LOCAL_HOSTS = ['localhost:5173', 'localhost:3000', 'localhost:5199']

let pool = null
export function usersPool() {
  if (!pool) {
    const url = process.env.USERS_DATABASE_URL
    if (!url) throw new Error('USERS_DATABASE_URL not set')
    // Neon gives sslmode=require; pg already treats it as verify-full, so say so explicitly (silences pg's v9 warning).
    const connectionString = url.replace(/sslmode=require/, 'sslmode=verify-full')
    pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 5_000 })
    pool.on('error', (e) => console.warn(`users pool: idle client dropped (${e.message})`))
  }
  return pool
}

// Runs before Better Auth's own handling (Turnstile + per-IP rate limits are separate: captcha plugin, rateLimit).
const beforeHook = createAuthMiddleware(async (ctx) => {
  if (ctx.path === '/sign-in/email') {
    // Per-email lockout (lib/accounts/lockout.js): same answer whether or not the address has an account.
    const mins = await lockedMinutes(usersPool(), ctx.body?.email)
    if (mins > 0) throw new APIError('TOO_MANY_REQUESTS', { message: lockMessage(mins), code: 'ACCOUNT_LOCKED' })
    return
  }
  if (ctx.path !== '/sign-up/email') return
  if (!SIGNUPS_OPEN) throw new APIError('FORBIDDEN', { message: 'EarthAtlas accounts are invite-only for now.' })
  const body = ctx.body || {}
  // Honeypot: people never see this field. Bots that fill it get a fake success and nothing is created.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    console.warn('[accounts] honeypot hit on sign-up')
    throw ctx.json({ token: null, user: null }) // same shape as Better Auth's anti-enumeration answer
  }
  const tokenProblem = checkFormToken(ctx.headers?.get('x-form-token'))
  if (tokenProblem) {
    console.warn(`[accounts] sign-up form token: ${tokenProblem}`)
    throw new APIError('BAD_REQUEST', { message: tokenProblem === 'too-fast' ? 'That was quick! Please wait a moment and try again.' : 'This form expired. Reload the page and try again.' })
  }
  const emailProblem = await checkEmail(body.email)
  if (emailProblem) throw new APIError('BAD_REQUEST', { message: emailProblem })
})

// After sign-in: count wrong passwords per email, clear the count on success.
// Security events written to the audit log (lib/accounts/audit.js), by Better Auth route.
const AUDITED = {
  '/sign-in/email': 'user.signin', '/callback/:id': 'user.signin', '/passkey/verify-authentication': 'user.signin',
  '/two-factor/verify-totp': 'user.signin', '/two-factor/verify-backup-code': 'user.signin',
  '/change-password': 'user.password_changed', '/two-factor/enable': 'user.2fa_setup_started', '/two-factor/disable': 'user.2fa_off',
  '/two-factor/generate-backup-codes': 'user.2fa_new_backup_codes',
  '/passkey/verify-registration': 'user.passkey_added', '/passkey/delete-passkey': 'user.passkey_removed',
  '/unlink-account': 'user.signin_method_removed', '/change-email': 'user.email_change_requested', '/verify-email': 'user.email_verified',
  '/update-user': 'user.profile_updated', '/revoke-session': 'user.session_revoked', '/revoke-other-sessions': 'user.other_sessions_revoked',
  '/sign-out': 'user.signout', '/sign-up/email': 'user.signup',
}
const SIGNIN_METHOD = { '/sign-in/email': 'password', '/callback/:id': 'google', '/passkey/verify-authentication': 'passkey', '/two-factor/verify-totp': 'password + authenticator', '/two-factor/verify-backup-code': 'password + backup code' }

async function auditRoute(ctx, r) {
  const action = AUDITED[ctx.path]
  if (!action || r instanceof APIError || (r instanceof Response && r.status >= 400)) return
  const ip = requestIp(ctx.headers || ctx.request?.headers)
  const newUser = ctx.context.newSession?.user
  const user = newUser || ctx.context.session?.user
  if (action === 'user.signin') {
    if (!newUser) return // password accepted but a 2FA code is still due: logged when the code is entered
    // A code entered while already signed in is turning 2FA on (Better Auth issues a new session for it).
    if (ctx.path === '/two-factor/verify-totp' && ctx.context.session?.user) return audit({ actorId: newUser.id, action: 'user.2fa_on', targetId: newUser.id, ip })
    if (ctx.path === '/callback/:id' && ctx.context.session?.user) return
    // Google sign-in and Google linking share the callback; linking leaves the same session in place.
    const method = SIGNIN_METHOD[ctx.path]
    return audit({ actorId: newUser.id, action, targetId: newUser.id, ip, details: { method } })
  }
  if (action === 'user.2fa_setup_started') return audit({ actorId: user?.id, action, targetId: user?.id, ip })
  if (action === 'user.signup') {
    // Better Auth answers the same for new and existing addresses; log the attempt, not the address.
    await audit({ action, ip })
    return checkSpike(action)
  }
  if (!user) return
  return audit({ actorId: user.id, action, targetId: user.id, ip })
}

const afterHook = createAuthMiddleware(async (ctx) => {
  const r = ctx.context.returned
  await auditRoute(ctx, r)
  const NOTICES = { '/change-password': 'passwordChanged', '/two-factor/disable': 'twoFactorOff', '/passkey/delete-passkey': 'passkeyRemoved', '/unlink-account': 'signinRemoved' }
  if (NOTICES[ctx.path]) {
    const email = ctx.context.session?.user?.email || ctx.context.newSession?.user?.email
    if (email && !(r instanceof APIError)) await sendAccountEmail(email, NOTICES[ctx.path]).catch((e) => console.error('[accounts] notice email failed', e.message))
    return
  }
  if (ctx.path === '/passkey/verify-registration' && !(r instanceof APIError) && ctx.context.session?.user?.email) {
    await sendAccountEmail(ctx.context.session.user.email, 'passkeyAdded').catch((e) => console.error('[accounts] notice email failed', e.message))
    return
  }
  if (ctx.path !== '/sign-in/email' || !ctx.body?.email) return
  if (r instanceof APIError) {
    if (r.body?.code !== 'INVALID_EMAIL_OR_PASSWORD') return
    const mins = await recordFailure(usersPool(), ctx.body.email)
    const ip = requestIp(ctx.headers)
    const [known] = (await usersPool().query(`SELECT id FROM ${SCHEMA}."user" WHERE lower(email) = lower($1)`, [String(ctx.body.email)])).rows
    const event = mins > 0 ? 'user.signin_locked' : 'user.signin_failed'
    await audit({ action: event, targetId: known?.id || null, ip, details: known ? {} : { account: 'none' } })
    await checkSpike(event)
    if (mins > 0) {
      console.warn('[accounts] sign-in locked for an address after repeated wrong passwords')
      throw new APIError('TOO_MANY_REQUESTS', { message: lockMessage(mins), code: 'ACCOUNT_LOCKED' })
    }
  } else if (r && !(r instanceof Response && r.status >= 400)) {
    await clearFailures(usersPool(), ctx.body.email)
  }
})

/** The `picture` claim from a Google ID token (already verified by Better Auth when it was stored). */
export function googlePicture(idToken) {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'))
    const url = typeof claims.picture === 'string' ? claims.picture : ''
    return /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(url) ? url : null
  } catch { return null }
}

let authInstance = null
export function getAuth() {
  if (authInstance) return authInstance
  authInstance = betterAuth({
    appName: 'EarthAtlas',
    baseURL: IS_PROD
      ? 'https://earthatlas.org'
      : { allowedHosts: ON_VERCEL ? ['earthatlas.org'] : LOCAL_HOSTS, protocol: ON_VERCEL ? 'https' : 'http', fallback: ON_VERCEL ? 'https://earthatlas.org' : 'http://localhost:5173' },
    basePath: '/api/auth',
    trustedOrigins: ON_VERCEL ? ['https://earthatlas.org', 'https://*.earthatlas.org'] : LOCAL_HOSTS.map((h) => `http://${h}`),
    database: { dialect: new PostgresDialect({ pool: usersPool() }), type: 'postgres', schemaName: SCHEMA },
    telemetry: { enabled: false },

    emailAndPassword: {
      enabled: true,
      disableSignUp: !SIGNUPS_OPEN,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => { await sendAccountEmail(user.email, 'reset', { url }) },
      onPasswordReset: async ({ user }) => {
        await clearFailures(usersPool(), user.email) // a fresh password lifts any sign-in lock
        await audit({ actorId: user.id, action: 'user.password_reset', targetId: user.id })
        // Accepting an invite also goes through reset-password; only tell people about a real change.
        const { rows } = await usersPool().query(
          `SELECT "createdAt", "updatedAt" FROM ${SCHEMA}.account WHERE "userId" = $1 AND "providerId" = 'credential'`, [user.id])
        const firstPassword = rows[0] && Math.abs(new Date(rows[0].updatedAt) - new Date(rows[0].createdAt)) < 2_000
        if (!firstPassword) await sendAccountEmail(user.email, 'passwordChanged')
      },
      onExistingUserSignUp: async ({ user }) => { await sendAccountEmail(user.email, 'signupAttemptExisting') },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 24 * 60 * 60,
      sendVerificationEmail: async ({ user, url }) => { await sendAccountEmail(user.email, 'verify', { url }) },
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        prompt: 'select_account',
        disableSignUp: !SIGNUPS_OPEN, // invite-only: Google can sign in / link invited users, never create new ones
      },
    },
    account: {
      accountLinking: { enabled: true, allowDifferentEmails: false, allowUnlinkingAll: false },
    },

    user: {
      // Email change: approval link to the CURRENT address first, then Better Auth sends a confirm link
      // to the new address (sendVerificationEmail); the email changes only after both.
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendAccountEmail(user.email, 'changeEmailApprove', { url, newEmail })
        },
      },
      // Delete account: password (if the account has one) + a confirmation link emailed to the account.
      deleteUser: {
        enabled: true,
        deleteTokenExpiresIn: 60 * 60,
        sendDeleteAccountVerification: async ({ user, url }) => { await sendAccountEmail(user.email, 'deleteConfirm', { url }) },
        afterDelete: async (user) => {
          await clearFailures(usersPool(), user.email)
          await audit({ actorId: user.id, action: 'user.deleted_own_account', targetId: user.id, details: { email: user.email } })
          await sendAccountEmail(user.email, 'accountDeleted')
        },
      },
      // Defense in depth for invite-only: only admins create users while sign-ups are closed.
      validateUserInfo: async ({ source }) => {
        if (source.action === 'create-user' && source.method !== 'admin' && !SIGNUPS_OPEN) {
          return { error: 'signups_closed', errorDescription: 'EarthAtlas accounts are invite-only for now.' }
        }
      },
    },

    session: {
      expiresIn: 30 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      freshAge: 15 * 60, // sensitive actions (delete account, change email) need a sign-in from the last 15 min
    },

    // Google profile photo: when Google is linked to an account that has no photo yet, use the
    // picture from Google's sign-in token. Only on link, so a photo the user removes stays removed.
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            await audit({ actorId: account.userId, action: 'user.signin_method_added', targetId: account.userId, details: { method: account.providerId } })
            if (account.providerId !== 'google' || !account.idToken) return
            const picture = googlePicture(account.idToken)
            if (picture) await usersPool().query(`UPDATE ${SCHEMA}."user" SET image = $1, "updatedAt" = now() WHERE id = $2 AND image IS NULL`, [picture, account.userId])
          },
        },
      },
    },

    verification: { storeIdentifier: 'hashed' }, // reset / invite tokens stored only as hashes

    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 60 * 60, max: 3 },
        '/sign-in/email': { window: 15 * 60, max: 10 },
        '/sign-in/social': { window: 15 * 60, max: 20 },
        '/request-password-reset': { window: 60 * 60, max: 5 },
        '/send-verification-email': { window: 60 * 60, max: 5 },
        '/reset-password': { window: 15 * 60, max: 10 },
        '/change-email': { window: 60 * 60, max: 5 },
        '/delete-user': { window: 60 * 60, max: 5 },
        '/change-password': { window: 15 * 60, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: 'earthatlas',
      useSecureCookies: ON_VERCEL,
      crossSubDomainCookies: ON_VERCEL ? { enabled: true, domain: 'earthatlas.org' } : undefined,
      // Vercel sets this from the real client connection and never forwards a client-supplied value.
      ipAddress: { ipAddressHeaders: ['x-vercel-forwarded-for', 'x-forwarded-for'] },
      database: { validateSchema: !IS_PROD },
    },

    hooks: { before: beforeHook, after: afterHook },

    plugins: [
      captcha({
        provider: 'cloudflare-turnstile',
        secretKey: turnstileSecret(),
        endpoints: ['/sign-up/email', '/sign-in/email', '/request-password-reset', '/send-verification-email', '/reset-password'],
      }),
      haveIBeenPwned({ customPasswordCompromisedMessage: 'This password has appeared in a data breach. Please choose a different one.' }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      // Authenticator-app codes + backup codes. Asked for on password sign-in only (Google and passkey
      // sign-ins are already strong), so the profile offers it to accounts that have a password.
      twoFactor({
        issuer: 'EarthAtlas',
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
      }),
      passkey({
        rpID: ON_VERCEL ? 'earthatlas.org' : 'localhost',
        rpName: 'EarthAtlas',
        origin: ON_VERCEL ? 'https://earthatlas.org' : LOCAL_HOSTS.map((h) => `http://${h}`),
      }),
    ],
  })
  return authInstance
}
