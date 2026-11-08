/**
 * Browser client for EarthAtlas accounts (/api/auth, Better Auth). Same-origin, so no baseURL.
 * Protected calls send the Turnstile token in `x-captcha-response`; sign-up also sends the
 * server-signed render time in `x-form-token` (lib/accounts/guard.js).
 */
import { createAuthClient } from 'better-auth/react'
import { adminClient, twoFactorClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({ plugins: [adminClient(), twoFactorClient(), passkeyClient()] })
export const { useSession, signOut } = authClient

/** { formToken, turnstileSiteKey, signupsOpen } for a form, fetched when it renders. */
export async function fetchFormConfig() {
  const r = await fetch('/api/auth/ea/form', { credentials: 'same-origin' })
  if (!r.ok) throw new Error('Could not load the form. Reload the page.')
  return r.json()
}

const MESSAGES = {
  INVALID_EMAIL_OR_PASSWORD: 'Email or password is incorrect.',
  EMAIL_NOT_VERIFIED: 'Please confirm your email first. We just sent you a new link.',
  PASSWORD_TOO_SHORT: 'Use at least 12 characters.',
  PASSWORD_TOO_LONG: 'That password is too long (128 characters max).',
  INVALID_TOKEN: 'This link is invalid or has expired. Ask for a new one.',
  PASSWORD_COMPROMISED: 'This password has appeared in a data breach. Please choose a different one.',
  MISSING_RESPONSE: 'Please complete the "verify you are human" check.',
  VERIFICATION_FAILED: 'The "verify you are human" check failed. Please try again.',
  INVALID_PASSWORD: 'That password is incorrect.',
  INVALID_CODE: 'That code is incorrect. Try again.',
  INVALID_TWO_FACTOR_COOKIE: 'Your sign-in timed out. Please sign in again.',
  INVALID_BACKUP_CODE: 'That backup code is incorrect or already used.',
  CREDENTIAL_ACCOUNT_NOT_FOUND: 'This account has no password yet.',
  SESSION_EXPIRED: 'For your security, please sign in again first.',
  FAILED_TO_UNLINK_LAST_ACCOUNT: "You can't remove your only way to sign in.",
  BANNED_USER: 'This account has been suspended.',
}

/** A user-facing sentence for a Better Auth error (or a fetch failure). */
export function errorText(err) {
  if (!err) return 'Something went wrong. Please try again.'
  if (err.code === 'ACCOUNT_LOCKED' && err.message) return err.message
  if (err.status === 429) return 'Too many attempts. Please wait a few minutes and try again.'
  return MESSAGES[err.code] || err.message || 'Something went wrong. Please try again.'
}

/** Messages for ?error= codes Better Auth puts on redirect URLs (Google sign-in, links). */
export const REDIRECT_ERRORS = {
  signup_disabled: 'EarthAtlas accounts are invite-only for now. Use the address your invite was sent to.',
  'signup disabled': 'EarthAtlas accounts are invite-only for now. Use the address your invite was sent to.',
  signups_closed: 'EarthAtlas accounts are invite-only for now. Use the address your invite was sent to.',
  account_not_linked: 'That Google account could not be linked. Sign in with your password first.',
  invalid_token: 'This link is invalid or has expired. Ask for a new one.',
  access_denied: 'Google sign-in was cancelled.',
}
