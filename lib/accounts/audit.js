/**
 * Append-only audit log (auth.audit_log, lib/accounts/sql/002_audit_admin.sql).
 * Never store passwords, tokens, codes or secrets in `details`.
 */
import { SCHEMA, usersPool } from './auth.js'

/** Client IP as Vercel reports it (never a client-supplied value on Vercel); null on localhost. */
export function requestIp(headers) {
  const get = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]) || ''
  const ip = (get('x-vercel-forwarded-for') || get('x-forwarded-for')).split(',')[0].trim()
  return ip || null
}

export async function audit({ actorId = null, action, targetId = null, ip = null, details = {} }) {
  try {
    await usersPool().query(
      `INSERT INTO ${SCHEMA}.audit_log (actor_id, action, target_id, ip, details) VALUES ($1, $2, $3, $4, $5)`,
      [actorId, action, targetId, ip, JSON.stringify(details)])
  } catch (e) {
    // Logging must never break sign-in; but say so loudly.
    console.error(`[accounts] audit write failed (${action}): ${e.message}`)
  }
}
