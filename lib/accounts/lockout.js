/**
 * Per-email sign-in lockout (docs/USER_ACCOUNTS_PLAN.md §4, §6). Better Auth rate-limits per IP; this
 * stops someone guessing one account's password from many IPs.
 *
 * Policy: 5 wrong passwords for an address within 15 minutes locks that address for 15 minutes.
 * Each further lock within 24 hours doubles the time (15 → 30 → 60 min …, capped at 24 hours).
 * A successful sign-in or a password reset clears it. Addresses with no account are treated exactly
 * the same, so the lock never reveals whether an account exists.
 *
 * Rows are keyed by an HMAC of the lowercased email (table auth.signin_failure, lib/accounts/sql/001).
 */
import { createHmac } from 'node:crypto'

export const MAX_FAILURES = 5
export const WINDOW_MIN = 15
export const BASE_LOCK_MIN = 15
export const MAX_LOCK_MIN = 24 * 60

export function lockKey(email) {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET not set')
  return createHmac('sha256', secret).update(`signin-lock:${String(email || '').trim().toLowerCase()}`).digest('base64url')
}

/** Minutes left on a lock for this address (0 = not locked). */
export async function lockedMinutes(pool, email) {
  const { rows } = await pool.query(
    `SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - now())) / 60)::int AS mins
       FROM auth.signin_failure WHERE key = $1 AND locked_until > now()`, [lockKey(email)])
  return rows[0]?.mins || 0
}

/** Count one wrong password; locks the address when it reaches MAX_FAILURES. Returns minutes locked (0 if not). */
export async function recordFailure(pool, email) {
  const key = lockKey(email)
  const { rows } = await pool.query(
    `INSERT INTO auth.signin_failure AS f (key, failures, window_start, updated_at)
          VALUES ($1, 1, now(), now())
     ON CONFLICT (key) DO UPDATE SET
       failures     = CASE WHEN f.window_start < now() - make_interval(mins => $2) THEN 1 ELSE f.failures + 1 END,
       window_start = CASE WHEN f.window_start < now() - make_interval(mins => $2) THEN now() ELSE f.window_start END,
       -- a quiet day forgets earlier locks
       lock_count   = CASE WHEN f.updated_at < now() - interval '24 hours' THEN 0 ELSE f.lock_count END,
       updated_at   = now()
     RETURNING failures, lock_count`, [key, WINDOW_MIN])
  const { failures, lock_count: prevLocks } = rows[0]
  if (failures < MAX_FAILURES) return 0
  const mins = Math.min(BASE_LOCK_MIN * 2 ** prevLocks, MAX_LOCK_MIN)
  await pool.query(
    `UPDATE auth.signin_failure
        SET locked_until = now() + make_interval(mins => $2), lock_count = lock_count + 1,
            failures = 0, window_start = now(), updated_at = now()
      WHERE key = $1`, [key, mins])
  return mins
}

export async function clearFailures(pool, email) {
  await pool.query('DELETE FROM auth.signin_failure WHERE key = $1', [lockKey(email)])
}

/** Daily tidy-up: rows untouched for 2 days and not locked. */
export async function pruneFailures(pool) {
  const { rowCount } = await pool.query(
    `DELETE FROM auth.signin_failure WHERE updated_at < now() - interval '2 days' AND (locked_until IS NULL OR locked_until < now())`)
  return rowCount
}

export function lockMessage(mins) {
  const when = mins >= 60 ? `${Math.ceil(mins / 60)} hour${Math.ceil(mins / 60) === 1 ? '' : 's'}` : `${mins} minute${mins === 1 ? '' : 's'}`
  return `Too many wrong passwords for this email. Try again in ${when}, or reset your password.`
}
