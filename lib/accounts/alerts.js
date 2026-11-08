/**
 * Spike alert for account abuse (docs/USER_ACCOUNTS_PLAN.md Phase 4).
 *
 * Checked right after a suspicious event is written to the audit log (wrong password, sign-in lock,
 * wrong admin code, sign-up), never on a timer, so the users database isn't woken up just to look.
 * When the last hour crosses a threshold, a GitHub issue is opened (or updated) through the
 * accounts-alert workflow and assigned to Josh. At most one alert per 6 hours.
 *
 * Needs GH_DISPATCH_TOKEN (the fine-grained token api/cron/gh-dispatch.js uses). Without it
 * (localhost) the alert is only printed.
 */
import { SCHEMA, usersPool } from './auth.js'
import { audit } from './audit.js'

const REPO = 'jknauernever/earthatlas'
export const THRESHOLDS = {
  'user.signin_failed': { max: 30, label: 'wrong passwords' },
  'user.signin_locked': { max: 3, label: 'addresses locked after repeated wrong passwords' },
  'admin.unlock_failed': { max: 3, label: 'wrong admin codes' },
  'user.signup': { max: 20, label: 'new sign-ups' },
  'contact.blocked': { max: 50, label: 'contact-form messages blocked as bots, failed human checks or over the limit' },
}
const QUIET_HOURS = 6

export async function checkSpike(action) {
  if (!THRESHOLDS[action]) return
  try {
    const pool = usersPool()
    const { rows } = await pool.query(
      `SELECT action, count(*)::int AS n FROM ${SCHEMA}.audit_log
       WHERE at > now() - interval '1 hour' AND action = ANY($1) GROUP BY action`, [Object.keys(THRESHOLDS)])
    const over = rows.filter((r) => r.n >= THRESHOLDS[r.action].max)
    if (!over.length) return
    const { rows: recent } = await pool.query(
      `SELECT 1 FROM ${SCHEMA}.audit_log WHERE action = 'system.spike_alert' AND at > now() - make_interval(hours => $1) LIMIT 1`, [QUIET_HOURS])
    if (recent.length) return
    const lines = over.map((r) => `- ${r.n} ${THRESHOLDS[r.action].label} in the last hour (alert at ${THRESHOLDS[r.action].max})`)
    await audit({ action: 'system.spike_alert', details: Object.fromEntries(over.map((r) => [r.action, r.n])) })
    await sendAlert('Accounts: unusual sign-in activity', [
      'EarthAtlas accounts saw more than usual in the last hour:', '', ...lines, '',
      'Look at /admin/users → Audit log for the addresses and IPs involved. Per-IP and per-address limits are already slowing this down; nothing else happens automatically.',
      `Next alert no sooner than ${QUIET_HOURS} hours from now.`,
    ].join('\n'))
  } catch (e) {
    console.error(`[accounts] spike check failed: ${e.message}`)
  }
}

async function sendAlert(title, body) {
  const token = process.env.GH_DISPATCH_TOKEN
  if (!token) { console.warn(`[accounts] ALERT (not sent, no GH_DISPATCH_TOKEN): ${title}\n${body}`); return }
  const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/accounts-alert.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'earthatlas-accounts' },
    body: JSON.stringify({ ref: 'main', inputs: { title, body } }),
  })
  if (!r.ok) console.error(`[accounts] alert dispatch failed: ${r.status} ${(await r.text()).slice(0, 200)}`)
}
