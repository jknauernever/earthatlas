/**
 * EarthAtlas contact form (/contact → POST /api/auth/ea/contact). Contact forms are a favorite spam
 * target, so a message reaches the inbox only after every layer below passes. Cheapest checks run first.
 *
 *  1. Same-origin POST only (api/auth.js), body at most 20 KB.
 *  2. Honeypot field filled, or the signed form timer (lib/accounts/guard.js) missing / tampered / under
 *     3 s / over 2 h → "bot": silently "sent" (bots learn nothing), stored truncated, never emailed.
 *  3. Cloudflare Turnstile, verified server-side (action "contact"; hostname checked in production).
 *  4. Rate limits per IP (3 an hour, 5 a day) and per sender address (3 a day).
 *  5. Field checks: name, topic, message 20–5,000 characters, and a real, permanent email address
 *     (syntax, disposable-domain list, the domain must accept mail).
 *  6. Content filters → "held" (stored, not emailed, sender still sees "sent"): more than 2 links,
 *     HTML / BBCode links, common spam pitches (SEO, backlinks, crypto, loans, …), mostly capitals.
 *  7. At most 20 messages emailed a day, whatever gets through; the rest are held.
 *
 * Nothing is ever sent to the address typed into the form: no auto-reply, no copy. That keeps the form
 * from being used to send mail to other people. The notification goes only to CONTACT_TO (env), as
 * plain text, with the sender as Reply-To. Without CONTACT_TO (localhost) it is printed instead.
 * Admins review held messages (and release or delete them) on /admin/users → Messages (lib/accounts/admin.js).
 */
import { SCHEMA, turnstileSecret, usersPool } from './auth.js'
import { checkEmail, checkFormToken } from './guard.js'
import { audit, requestIp } from './audit.js'
import { checkSpike } from './alerts.js'
import { FROM, esc } from './email.js'

export const TOPICS = {
  question: 'A question about EarthAtlas',
  data: 'A problem with the data',
  bug: 'Something is broken',
  partner: 'Working together / sharing data',
  account: 'My account',
  other: 'Something else',
}
const LIMITS = { ipHour: 3, ipDay: 5, emailDay: 3, emailedDay: 20 }
const MAX_BODY = 20_000

const SPAM_RE = new RegExp([
  '\\bseo\\b', 'backlinks?', 'guest ?post', 'link ?building', 'first page of google', 'rank(ing)? (on|in) google',
  'increase (your )?(website )?traffic', 'web ?design (services|company)', 'website redesign', 'app development (services|company)',
  'lead generation', 'marketing (services|agency)', 'virtual assistant', 'outsourc', 'crypto', 'bitcoin', 'forex',
  'casino', '\\bbetting\\b', 'viagra', 'cialis', '\\bloans?\\b', 'whats ?app', 'telegram', 'dear (sir|madam)',
  'unsubscribe', 'opt[- ]out', 'click here', 'limited time offer',
].join('|'), 'i')

export class ContactError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
const oneLine = (v) => v.replace(/\s+/g, ' ')

async function verifyTurnstile(token, ip) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false
  const form = new URLSearchParams({ secret: turnstileSecret() || '', response: token })
  if (ip) form.set('remoteip', ip)
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
    const out = await r.json()
    if (!out.success) return false
    // Cloudflare's test keys (localhost) don't report a real action or hostname.
    if (process.env.VERCEL && (out.action !== 'contact' || !/(^|\.)earthatlas\.org$/.test(out.hostname || ''))) return false
    return true
  } catch (e) {
    console.error(`[contact] turnstile verify failed: ${e.message}`)
    return false
  }
}

/** Reasons a message looks like spam (empty = fine). */
export function spamReasons({ name, message }) {
  const reasons = []
  const links = (message.match(/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|info|biz|xyz|ru|top|shop|site|online)\b\/?/gi) || []).length
  if (links > 2) reasons.push('links')
  if (/<a\s|href=|\[url|\[link/i.test(message)) reasons.push('markup')
  if (SPAM_RE.test(message) || SPAM_RE.test(name)) reasons.push('pitch')
  if (/https?:\/\/|www\./i.test(name)) reasons.push('link-in-name')
  const letters = message.replace(/[^A-Za-z]/g, '')
  if (letters.length > 40 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) reasons.push('caps')
  return reasons
}

async function store(pool, row) {
  const { rows } = await pool.query(
    `INSERT INTO ${SCHEMA}.contact_message (ip, name, email, topic, message, verdict, reasons)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [row.ip, row.name, row.email, row.topic, row.message, row.verdict, JSON.stringify(row.reasons)])
  return rows[0].id
}

export async function notify(row, id) {
  const to = process.env.CONTACT_TO
  const subject = `EarthAtlas contact: ${TOPICS[row.topic]} (from ${oneLine(row.name).slice(0, 60)})`
  const text = [
    `From: ${row.name} <${row.email}>`, `Topic: ${TOPICS[row.topic]}`, `Message #${id}`, '',
    row.message, '', '—', 'Sent from the contact form at earthatlas.org/contact. Reply to this email to answer.',
  ].join('\n')
  if (!to) { console.log(`\n[contact → CONTACT_TO not set] ${subject}\n${text}\n`); return false }
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#1d2a24">
    <p><strong>From:</strong> ${esc(row.name)} &lt;${esc(row.email)}&gt;<br><strong>Topic:</strong> ${esc(TOPICS[row.topic])}<br><strong>Message #</strong>${id}</p>
    <div style="white-space:pre-wrap;border-left:3px solid #c9d6cf;padding-left:12px">${esc(row.message)}</div>
    <p style="color:#5b6b63;font-size:13px">Sent from the contact form at earthatlas.org/contact. Reply to this email to answer.</p></div>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: row.email, subject, text, html }),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return true
}

/** Handle one submission. Returns { ok: true } for every message we accept OR quietly drop. */
export async function submitContact(req) {
  const raw = await req.text()
  if (raw.length > MAX_BODY) throw new ContactError(413, 'That message is too long.')
  let body
  try { body = JSON.parse(raw) } catch { throw new ContactError(400, 'Something went wrong. Please try again.') }
  const ip = requestIp(req.headers)
  const row = {
    ip,
    name: clean(body.name, 80),
    email: clean(body.email, 254).toLowerCase(),
    topic: TOPICS[body.topic] ? body.topic : 'other',
    message: clean(body.message, 5000),
    reasons: [],
  }
  const pool = usersPool()

  // 2. Bots: pretend it worked.
  const tokenProblem = checkFormToken(body.formToken)
  if (clean(body.website, 200) || tokenProblem) {
    row.verdict = 'bot'
    row.reasons = [clean(body.website, 200) ? 'honeypot' : `form-${tokenProblem}`]
    row.message = row.message.slice(0, 500)
    await store(pool, row).catch((e) => console.error(`[contact] store failed: ${e.message}`))
    await audit({ action: 'contact.blocked', ip, details: { reason: row.reasons[0] } })
    await checkSpike('contact.blocked')
    return { ok: true }
  }

  // 3. Human check.
  if (!(await verifyTurnstile(req.headers.get('x-captcha-response'), ip))) {
    await audit({ action: 'contact.blocked', ip, details: { reason: 'turnstile' } })
    await checkSpike('contact.blocked')
    throw new ContactError(400, 'The human check didn’t pass. Please try it again.')
  }

  // 4. Rate limits.
  const { rows: [n] } = await pool.query(
    `SELECT count(*) FILTER (WHERE ip = $1 AND at > now() - interval '1 hour')::int AS ip_hour,
            count(*) FILTER (WHERE ip = $1 AND at > now() - interval '1 day')::int AS ip_day,
            count(*) FILTER (WHERE lower(email) = $2 AND at > now() - interval '1 day')::int AS email_day,
            count(*) FILTER (WHERE emailed_at > now() - interval '1 day')::int AS emailed_day
     FROM ${SCHEMA}.contact_message WHERE at > now() - interval '1 day'`, [ip || '', row.email])
  if ((ip && (n.ip_hour >= LIMITS.ipHour || n.ip_day >= LIMITS.ipDay)) || n.email_day >= LIMITS.emailDay) {
    await audit({ action: 'contact.blocked', ip, details: { reason: 'rate-limit' } })
    await checkSpike('contact.blocked')
    throw new ContactError(429, 'You’ve sent several messages already. Please wait a day before sending another.')
  }

  // 5. Fields.
  if (!row.name) throw new ContactError(400, 'Please enter your name.')
  if (row.message.length < 20) throw new ContactError(400, 'Please write a little more (at least 20 characters).')
  const emailProblem = await checkEmail(row.email)
  if (emailProblem) throw new ContactError(400, emailProblem)

  // 6–7. Content filters and the daily cap.
  row.reasons = spamReasons(row)
  if (!row.reasons.length && n.emailed_day >= LIMITS.emailedDay) row.reasons.push('daily-cap')
  row.verdict = row.reasons.length ? 'held' : 'accepted'
  const id = await store(pool, row)
  if (row.verdict === 'accepted') {
    try {
      if (await notify(row, id)) await pool.query(`UPDATE ${SCHEMA}.contact_message SET emailed_at = now() WHERE id = $1`, [id])
    } catch (e) {
      // Kept in the table either way; say so loudly.
      console.error(`[contact] notify failed for #${id}: ${e.message}`)
    }
  }
  await audit({ action: row.verdict === 'accepted' ? 'contact.received' : 'contact.held', ip, details: { id, reasons: row.reasons } })
  return { ok: true }
}
