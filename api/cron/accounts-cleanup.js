/**
 * Nightly cleanup for EarthAtlas accounts (docs/USER_ACCOUNTS_PLAN.md Phase 4). Once a day so the
 * users database (Neon, scales to zero) is woken only once for it.
 *
 *  - Self sign-ups that never confirmed their email within 7 days are deleted. Only accounts that
 *    were never signed in to, never invited and never had their email changed by an admin qualify;
 *    invited accounts are always left for an admin to manage.
 *  - Expired: email / reset / invite tokens, admin unlocks, rate-limit counters older than a day,
 *    per-address sign-in failure counters (lib/accounts/lockout.js pruneFailures).
 *  - Contact-form messages (lib/accounts/contact.js): bot after 30 days, held after 90, accepted after a year.
 *  The audit log is never cleaned.
 *
 * GET /api/cron/accounts-cleanup[?dry=1] — CRON_SECRET-guarded (Vercel cron).
 */
import { usersPool, SCHEMA } from '../../lib/accounts/auth.js'
import { audit } from '../../lib/accounts/audit.js'
import { pruneFailures } from '../../lib/accounts/lockout.js'

export const UNVERIFIED_DAYS = 7

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers['authorization'] || req.headers['Authorization']
  if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' })
  if (!process.env.USERS_DATABASE_URL) return res.status(200).json({ skipped: 'accounts not launched' })
  const dry = req.query?.dry === '1'
  const pool = usersPool()
  const stale = `SELECT u.id, u.email FROM ${SCHEMA}."user" u
    WHERE u."emailVerified" = false AND u."createdAt" < now() - make_interval(days => ${UNVERIFIED_DAYS})
      AND COALESCE(u.role, 'user') = 'user'
      AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.session s WHERE s."userId" = u.id)
      AND NOT EXISTS (SELECT 1 FROM ${SCHEMA}.audit_log l WHERE l.target_id = u.id
                      AND l.action IN ('user.signin', 'admin.invite', 'admin.reinvite', 'admin.change_email', 'admin.update'))`
  try {
    const { rows: unverified } = await pool.query(stale)
    const out = { dry, unverified: unverified.length }
    if (!dry) {
      for (const u of unverified) {
        await pool.query(`DELETE FROM ${SCHEMA}."user" WHERE id = $1`, [u.id])
        await audit({ action: 'system.deleted_unverified', targetId: u.id, details: { email: u.email, days: UNVERIFIED_DAYS } })
      }
      out.tokens = (await pool.query(`DELETE FROM ${SCHEMA}.verification WHERE "expiresAt" < now()`)).rowCount
      out.adminUnlocks = (await pool.query(`DELETE FROM ${SCHEMA}.admin_unlock WHERE expires_at < now()`)).rowCount
      out.rateLimits = (await pool.query(`DELETE FROM ${SCHEMA}."rateLimit" WHERE "lastRequest" < $1`, [Date.now() - 86_400_000])).rowCount
      out.failureCounters = await pruneFailures(pool)
      out.contactMessages = (await pool.query(`DELETE FROM ${SCHEMA}.contact_message
        WHERE (verdict = 'bot' AND at < now() - interval '30 days') OR (verdict = 'held' AND at < now() - interval '90 days')
           OR at < now() - interval '1 year'`)).rowCount
    }
    console.log('[accounts-cleanup]', JSON.stringify(out))
    return res.status(200).json(out)
  } catch (e) {
    console.error('[accounts-cleanup] failed', e)
    return res.status(500).json({ error: e.message })
  }
}
